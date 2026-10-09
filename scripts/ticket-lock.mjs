#!/usr/bin/env node
/**
 * Ticket-Lock (#1561 Z4) — verhindert, dass zwei Agenten-Sessions dasselbe Ticket bearbeiten, obwohl beide „claim und verifiziere“
 * durchlaufen haben: alle Agenten laufen als `fluffels`, der Assignee ist darum kein Lock (Evidenz: zwei Sessions im selben
 * Worktree `kq-1549`, eine löschte dem Gegenüber `node_modules`).
 *
 *   node scripts/ticket-lock.mjs claim <nr>                      # vor `gh issue edit --add-assignee`; Exit 0 + `nonce=<x>`
 *   node scripts/ticket-lock.mjs pruefe <nr> [--nonce <x>]       # vor Spawn und vor Übernahme eines Worktrees
 *   node scripts/ticket-lock.mjs freigeben <nr> --nonce <x>      # nach verifiziertem Cleanup
 *
 * Exit 0 = ok (`claim`: gewonnen; `pruefe`: `frei` oder `uebernehmbar`; `freigeben`: erledigt), 4 = nicht anfassen (belegt, fremd,
 * aktiv), 2 = falscher Aufruf oder Fehler.
 *
 * Mechanik: die Lock-Datei `<git-common-dir>/kq-locks/<nr>.json` (gemeinsam für alle Worktrees einer Maschine, nie unter
 * `.claude/worktrees/`) entsteht atomar per `openSync(…, "wx")`: genau ein Aufrufer gewinnt. Inhalt `{ nr, nonce, erstellt }`.
 * `claim` prüft vorher, ob ein Worktree `kq-<nr>` oder ein Branch `feature/kq-<nr>-*` (lokal oder remote) existiert (Exit 4). Ein
 * fremder Lock jünger als `VERWAIST_MS` (2 h) gilt (Exit 4); ein älterer wird per `renameSync` auf `<nr>.json.verwaist-<nonce>`
 * beiseite gelegt (nur einer gewinnt das Umbenennen) und neu angelegt. `pruefe` mit `--nonce` verlangt den eigenen Lock (`fremd`
 * bei fremdem oder fehlendem Lock); existieren Worktree oder Branch, gilt die letzte Aktivität (Max aus Commit-Zeit der Branch-
 * Köpfe, jüngstem Reflog-Eintrag, mtime der geänderten Dateien laut `git status` und mtime von `node_modules`): jünger als
 * `INAKTIV_MS` (30 min) ist `aktiv` (Exit 4), sonst `uebernehmbar`. `freigeben` löscht nur den eigenen Lock.
 *
 * Bewusste Grenzen: nur maschinenlokal (der Lock liegt im lokalen `.git`; maschinenübergreifend bleibt der Assignee die einzige
 * Sperre); der Workflow-Pfad (`.claude/workflows/kubernia-ticket.js`) hält keine Nonce und prüft darum nur die Aktivität; Selbstauskunft,
 * keine Authentifizierung (wer die Nonce kennt, ist der Besitzer).
 *
 * Reines Node-Skript (nur Builtins + git). Die Entscheidungen sind pur exportiert, git und Dateisystem injizierbar.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { belegteNummern, ticketAusRef } from "./naechstes-ticket.mjs";

/** Ein fremder Lock, der älter ist, gilt als verwaist (Session abgestürzt, bevor ein Worktree entstand). */
export const VERWAIST_MS = 2 * 60 * 60_000;
/** Ein vorhandener Worktree/Branch ohne Aktivität in dieser Zeit ist übernehmbar. */
export const INAKTIV_MS = 30 * 60_000;

/** Entscheidung für `claim` bei bestehender Lock-Datei: `fremd` (gilt noch) oder `ersetzen` (verwaist). Pur. */
export function entscheideClaim({ erstellt, jetzt, verwaistMs = VERWAIST_MS }) {
  const alter = Number.isFinite(erstellt) ? jetzt - erstellt : Number.POSITIVE_INFINITY;
  return alter < verwaistMs ? "fremd" : "ersetzen";
}

/** Jüngste Aktivität in ms aus allen Quellen (nicht endliche Werte entfallen); `null`, wenn keine bekannt ist. Pur. */
export function letzteAktivitaet({ commitMs = [], reflogMs = [], dateiMs = [], nodeModulesMs = null } = {}) {
  const alle = [...commitMs, ...reflogMs, ...dateiMs, nodeModulesMs].filter((w) => Number.isFinite(w));
  return alle.length ? Math.max(...alle) : null;
}

/**
 * Ergebnis von `pruefe`. `lock`: Inhalt der Lock-Datei oder null; `nonce`: Argument oder null; `vorhanden`: Worktree oder Branch
 * existiert; `aktivitaet`: ms oder null. Ohne Nonce zählt nur die Aktivität; null (nichts feststellbar) ist fail-closed `aktiv`. Pur.
 */
export function entscheidePruefung({ lock, nonce, vorhanden, aktivitaet, jetzt, inaktivMs = INAKTIV_MS }) {
  if (nonce && (!lock || lock.nonce !== nonce)) return "fremd";
  if (!vorhanden) return "frei";
  if (aktivitaet === null || jetzt - aktivitaet < inaktivMs) return "aktiv";
  return "uebernehmbar";
}

const NUMMER = /^\d+$/;

/** Wert hinter `--nonce` (oder `--nonce=<x>`) aus argv; `null`, wenn nicht angegeben; `""`, wenn der Wert fehlt. Pur. */
export function nonceAus(argv) {
  const i = argv.findIndex((a) => a === "--nonce" || a.startsWith("--nonce="));
  if (i < 0) return null;
  return argv[i].includes("=") ? argv[i].slice("--nonce=".length) : (argv[i + 1] ?? "");
}

const lockPfad = (deps, nr) => join(deps.lockDir, `${nr}.json`);

function liesLock(deps, nr) {
  try {
    const l = JSON.parse(deps.liesDatei(lockPfad(deps, nr)));
    return l && typeof l === "object" && typeof l.nonce === "string" ? l : null;
  } catch {
    return null;
  }
}

/** Legt den Lock atomar an; `true` bei Gewinn, `false` bei vorhandener Datei, wirft sonst. */
function legeAn(deps, nr, nonce) {
  try {
    deps.schreibeNeu(lockPfad(deps, nr), `${JSON.stringify({ nr, nonce, erstellt: new Date(deps.jetzt()).toISOString() })}\n`);
    return true;
  } catch (e) {
    if (e && e.code === "EEXIST") return false;
    throw e;
  }
}

/** Gibt es einen Worktree `kq-<nr>` oder einen Branch `feature/kq-<nr>-*`? */
function ermittleBelegung(deps, nr) {
  const refs = deps.git(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).split(/\r?\n/).filter(Boolean);
  const wtZeilen = deps.git(["worktree", "list", "--porcelain"]).split(/\r?\n/);
  const worktrees = wtZeilen.filter((z) => /^(worktree|branch) /.test(z));
  const belegt = belegteNummern({ refs, worktrees }).has(nr);
  const wtPfad = wtZeilen.find((z) => z.startsWith("worktree ") && ticketAusRef(z) === nr)?.slice("worktree ".length) ?? null;
  return { belegt, refs: refs.filter((r) => ticketAusRef(r) === nr), wtPfad };
}

/** Sammelt die Aktivitäts-Zeitpunkte (ms) zu Branch-Köpfen, Reflog, geänderten Dateien und `node_modules`. */
function sammleAktivitaet(deps, { refs, wtPfad }) {
  const sek = (text) => Number(String(text).trim()) * 1000;
  const commitMs = refs.map((r) => {
    try {
      return sek(deps.git(["log", "-1", "--format=%ct", r]));
    } catch {
      return Number.NaN;
    }
  });
  const reflogMs = [];
  const dateiMs = [];
  let nodeModulesMs = null;
  if (wtPfad) {
    try {
      reflogMs.push(sek(deps.git(["-C", wtPfad, "reflog", "-1", "--format=%ct", "HEAD"])));
    } catch {
      /* kein Reflog */
    }
    try {
      for (const z of deps.git(["-C", wtPfad, "status", "--porcelain", "-uall"]).split(/\r?\n/).filter(Boolean)) {
        const pfad = z.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, "");
        dateiMs.push(deps.mtime(join(wtPfad, pfad)));
      }
    } catch {
      /* kein status */
    }
    nodeModulesMs = deps.mtime(join(wtPfad, "node_modules"));
  }
  return { commitMs, reflogMs, dateiMs, nodeModulesMs };
}

const ergebnis = (code, out = "", err = "") => ({ code, out: out ? `${out}\n` : "", err: err ? `${err}\n` : "" });

function claim(deps, nr) {
  try {
    deps.git(["fetch", "-q", "origin"]);
  } catch {
    /* fail-open: ohne Netz zählen die lokalen Refs */
  }
  if (ermittleBelegung(deps, nr).belegt) return ergebnis(4, "", `✖ ticket-lock: zu #${nr} gibt es schon einen Worktree oder Branch (feature/kq-${nr}-*): nicht claimen, nächstes Item.`);
  deps.legeVerzeichnisAn(deps.lockDir);
  const nonce = deps.nonce();
  if (legeAn(deps, nr, nonce)) return ergebnis(0, `nonce=${nonce}`);
  const vorhanden = liesLock(deps, nr);
  const erstellt = vorhanden ? Date.parse(vorhanden.erstellt) : Number.NaN;
  if (entscheideClaim({ erstellt, jetzt: deps.jetzt() }) === "fremd") return ergebnis(4, "", `✖ ticket-lock: #${nr} ist von einer anderen Session gelockt (jünger als 2 h): nicht claimen, nächstes Item.`);
  try {
    deps.benenneUm(lockPfad(deps, nr), `${lockPfad(deps, nr)}.verwaist-${nonce}`);
  } catch {
    return ergebnis(4, "", `✖ ticket-lock: der verwaiste Lock von #${nr} wurde gerade von einer anderen Session übernommen.`);
  }
  if (legeAn(deps, nr, nonce)) return ergebnis(0, `nonce=${nonce}`);
  return ergebnis(4, "", `✖ ticket-lock: #${nr} wurde beim Übernehmen des verwaisten Locks von einer anderen Session belegt.`);
}

function pruefe(deps, nr, nonce) {
  const lock = liesLock(deps, nr);
  const b = ermittleBelegung(deps, nr);
  const aktivitaet = b.belegt ? letzteAktivitaet(sammleAktivitaet(deps, b)) : null;
  const urteil = entscheidePruefung({ lock, nonce, vorhanden: b.belegt, aktivitaet, jetzt: deps.jetzt() });
  if (urteil === "fremd") return ergebnis(4, urteil, `✖ ticket-lock: der Lock zu #${nr} gehört nicht zu dieser Nonce (fremd oder fehlt): nicht anfassen, Befund melden.`);
  if (urteil === "aktiv") return ergebnis(4, urteil, `✖ ticket-lock: zu #${nr} gibt es Worktree/Branch mit Aktivität in den letzten 30 min (oder ohne feststellbare Aktivität): nicht übernehmen.`);
  return ergebnis(0, urteil);
}

function freigeben(deps, nr, nonce) {
  const lock = liesLock(deps, nr);
  if (!lock) return ergebnis(0, "kein Lock");
  if (lock.nonce !== nonce) return ergebnis(4, "", `✖ ticket-lock: der Lock zu #${nr} gehört einer anderen Session, nicht gelöscht.`);
  deps.loesche(lockPfad(deps, nr));
  return ergebnis(0, "freigegeben");
}

/** Ausführung mit injizierbarer I/O: `{ code, out, err }`. `deps`: git, jetzt, nonce, lockDir, liesDatei, schreibeNeu, benenneUm, loesche, legeVerzeichnisAn, mtime. */
export function fuehreAus(argv, deps) {
  const [befehl, nrText, ...rest] = argv;
  const nonce = nonceAus(argv);
  const nr = NUMMER.test(nrText ?? "") ? Number(nrText) : null;
  const usage = ergebnis(2, "", "✖ ticket-lock: Aufruf: claim <nr> | pruefe <nr> [--nonce <x>] | freigeben <nr> --nonce <x>");
  if (nr === null || !["claim", "pruefe", "freigeben"].includes(befehl)) return usage;
  if (befehl === "freigeben" && !nonce) return usage;
  if (nonce === "" || (befehl === "claim" && rest.length > 0)) return usage;
  try {
    if (befehl === "claim") return claim(deps, nr);
    if (befehl === "pruefe") return pruefe(deps, nr, nonce);
    return freigeben(deps, nr, nonce);
  } catch (e) {
    return ergebnis(2, "", `✖ ticket-lock: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Echte I/O: git per `execFileSync`, Lock-Verzeichnis im gemeinsamen git-Verzeichnis aller Worktrees. */
export function echteDeps() {
  const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const gemeinsam = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  return {
    git,
    jetzt: () => Date.now(),
    nonce: () => randomUUID(),
    lockDir: join(gemeinsam, "kq-locks"),
    liesDatei: (p) => readFileSync(p, "utf8"),
    schreibeNeu: (p, text) => {
      const fd = openSync(p, "wx");
      try {
        writeSync(fd, text);
      } finally {
        closeSync(fd);
      }
    },
    benenneUm: renameSync,
    loesche: unlinkSync,
    legeVerzeichnisAn: (d) => mkdirSync(d, { recursive: true }),
    mtime: (p) => {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return Number.NaN;
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let r;
  try {
    r = fuehreAus(process.argv.slice(2), echteDeps());
  } catch (e) {
    r = ergebnis(2, "", `✖ ticket-lock: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
