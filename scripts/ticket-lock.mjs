#!/usr/bin/env node
/**
 * Ticket-Lock (#1561 Z4) — verhindert, dass zwei Agenten-Sessions dasselbe Ticket bearbeiten, obwohl beide „claim und verifiziere“
 * durchlaufen haben: alle Agenten laufen unter demselben GitHub-Konto, der Assignee ist darum kein Lock (Evidenz: zwei Sessions im selben
 * Worktree, eine löschte dem Gegenüber `node_modules`).
 *
 *   node scripts/ticket-lock.mjs claim <nr> [--wiederaufnahme]    # vor `gh issue edit --add-assignee`; Exit 0 + `nonce=<x>`
 *   node scripts/ticket-lock.mjs pruefe <nr> [--nonce <x>]       # rein lesend: vor Spawn und vor Übernahme eines Worktrees
 *   node scripts/ticket-lock.mjs uebernehmen <nr> --nonce <x> --nachfolger   # nur Nachfolger/Fortsetzung (#1593): wie `pruefe`, verbraucht zusätzlich Übergabe bzw. Stopp-Vermerk; ohne `--nachfolger` Exit 2 (der Hauptchat prüft nur mit `pruefe`)
 *   node scripts/ticket-lock.mjs freigeben <nr> --nonce <x>      # nach verifiziertem Cleanup
 *   node scripts/ticket-lock.mjs uebergeben <nr> --nonce <x>     # Phasen-Schnitt (#1592): letzte Aktion des Vorgängers vor `ERGEBNIS: uebergabe`
 *   node scripts/ticket-lock.mjs gestoppt <nr> --nonce <x>       # nach `TaskStop` des eigenen Umsetzers (#1693): das nächste `pruefe --nonce` meldet `uebernehmbar`
 *   node scripts/ticket-lock.mjs lebenszeichen <nr> --nonce <x> [--schritt <text>]   # Plan-Schritt (#1699): frischt `zuletzt` im eigenen Lock auf
 *   node scripts/ticket-lock.mjs lebenszeichen --commit          # post-commit-Hook (#1699): frischt `zuletzt` des Locks zum Ticket-Branch auf, sonst stiller No-op
 *
 * Exit 0 = ok (`claim`: gewonnen; `pruefe`: `frei` oder `uebernehmbar`; `uebernehmen`: wie `pruefe`, verbraucht Übergabe bzw. Stopp-Vermerk; `freigeben`, `uebergeben`, `gestoppt`, `lebenszeichen`: erledigt), 4 = nicht anfassen (belegt, fremd,
 * aktiv), 2 = falscher Aufruf oder Fehler.
 *
 * Mechanik: die Lock-Datei `<git-common-dir>/<praefixe.worktree>locks/<nr>.json` (gemeinsam für alle Worktrees einer Maschine, nie unter
 * `.claude/worktrees/`) entsteht atomar per `openSync(…, "wx")`: genau ein Aufrufer gewinnt. Inhalt `{ nr, nonceHash, erstellt, sandbox }` (SHA-256 der Nonce; Altformat mit Klartext-`nonce` bleibt gültig; `sandbox` = `AGENT_SANDBOX` oder `null`) plus bei Bedarf `zuletzt: { zeit, quelle: "commit"|"schritt" }` (+ `schritt`), `uebergabe`, `gestoppt`. Das Format (Pfad, Parser, `lebenszeichenMs`) steht in `ticket-lock-lib.mjs`.
 * `claim` prüft vorher, ob ein Worktree `<praefixe.worktree><nr>` oder ein Branch `<praefixe.branch><nr>-*` (lokal oder remote) existiert (Exit 4). Ein
 * fremder Lock, dessen jüngstes Lebenszeichen (`lebenszeichenMs`) jünger als `VERWAIST_MS` (2 h) ist, gilt (Exit 4); ein älterer wird per `renameSync` auf `<nr>.json.verwaist-<Hash-Präfix>`
 * beiseite gelegt (nur einer gewinnt das Umbenennen) und neu angelegt. `pruefe` mit `--nonce` verlangt den eigenen Lock (`fremd`
 * bei fremdem oder fehlendem Lock), ohne `--nonce` meldet ein Lock, dessen `erstellt` jünger als 2 h ist, `fremd` (bewusste Grenze: hier zählt `zuletzt` nicht); existieren Worktree oder Branch, gilt die letzte Aktivität (Max aus Commit-Zeit der Branch-
 * Köpfe, jüngstem Reflog-Eintrag, mtime der geänderten Dateien laut `git status` und mtime von `node_modules`): jünger als
 * `INAKTIV_MS` (30 min) ist `aktiv` (Exit 4), sonst `uebernehmbar`. `freigeben` löscht nur den eigenen Lock. `uebergeben` vermerkt im eigenen Lock `uebergabe: { gesetzt, verbraucht: null }` (eine je Lock, sonst Exit 4); `pruefe --nonce` des Nachfolgers meldet dann `uebernehmbar` statt `aktiv` (Worktree oder Branch müssen existieren); `pruefe` ändert nie etwas (#1593), erst `uebernehmen` (gleiche Prüfung, gleiche Exit-Codes) verbraucht die Übergabe bzw. den Stopp-Vermerk (`verbraucht` = Zeitpunkt, ein zweites `uebernehmen` oder `pruefe` meldet wieder `aktiv`). `claim` räumt dabei ab: jede `*.verwaist-*`-Datei und jede `<nr>.json` älter als `ALTLAST_MS` (24 h nach mtime: jedes Lebenszeichen schreibt die Datei neu, ein lebender Lauf behält seinen Lock). `lebenszeichen` setzt nur `zuletzt`/`schritt` am frisch gelesenen eigenen Lock (Lost-Update-Grenze: ein gleichzeitiges `uebergeben`/`gestoppt` kann überschrieben werden; der Hook ändert nie Besitzfelder). Ein `zuletzt` der letzten 30 min zählt bei `pruefe` als Aktivität (`aktiv`). `claim <nr> --wiederaufnahme` (#1699) übernimmt auch eine belegte Nummer (Worktree/Branch), wenn die Prüfung ohne Nonce `frei` oder `uebernehmbar` ergäbe (Lock ≥ 2 h ohne Lebenszeichen, Aktivität ≥ 30 min alt); der alte Lock wird wie bei einem verwaisten beiseite gelegt.
 *
 * Bewusste Grenzen: `claim --wiederaufnahme` prüft kein Festgefahren-Label (das tut `claims-pruefen.mjs`; ein ausdrückliches „mach weiter“ der Maintainerin ist eine menschliche Entscheidung); nur maschinenlokal (der Lock liegt im lokalen `.git`; maschinenübergreifend bleibt der Assignee die einzige
 * Sperre);
 * ein Lock eines gemergten, geschlossenen Tickets sperrt nichts (die Auswahl nimmt nur offene Todo-Items), wird aber nur durch das Aufräumen (`freigeben` mit der Nonce) oder den Verfall per `VERWAIST_MS`/`ALTLAST_MS` frei; `pruefe` kann nach dem Merge bis dahin `aktiv` melden, solange Worktree oder Branch noch existieren (erst `cleanup-worktrees.mjs --branches --fix`, das selbst `git fetch --prune` fährt);
 * kein Freigabeweg ohne Nonce (Absicht);
 * Selbstauskunft, keine Authentifizierung (wer die Nonce kennt, ist der Besitzer; aus der Lock-Datei ist sie nicht lesbar). Jede Exit-4-Ausgabe nennt: den Lock nie von Hand lösen.
 *
 * Reines Node-Skript (nur Builtins + git). Die Entscheidungen sind pur exportiert, git und Dateisystem injizierbar.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, openSync, closeSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { ALTLAST_MS, INAKTIV_MS, VERWAIST_MS, herzschlagMs, lebenszeichenMs, lockVerzeichnis, parseLock } from "./ticket-lock-lib.mjs";
import { ticketNamen, ladeTicketNamen } from "./ticket-namen.mjs";
import { belegteNummern, ticketAusRef } from "./ticket-refs.mjs";
import { parseWorktreeBloecke } from "./worktree-aufraeumen.mjs";

export { ALTLAST_MS, INAKTIV_MS, VERWAIST_MS };

/**
 * Welche Dateien im Lock-Verzeichnis `claim` abräumt (#1572): jede `*.verwaist-*` (Rest eines Übernahme-Wettlaufs) und jede
 * `<nr>.json` und jede `<nr>.json.tmp-*` (Rest eines abgebrochenen atomaren Schreibens), deren mtime älter als `ALTLAST_MS` ist (eine nicht lesbare mtime zählt als jung, nie löschen ohne Beleg). Pur.
 */
export function aufzuraeumen({ eintraege, jetzt }) {
  return eintraege
    .filter((e) => /\.json\.verwaist-/.test(e.name) || (/^\d+\.json(\.tmp-.+)?$/.test(e.name) && Number.isFinite(e.mtime) && jetzt - e.mtime > ALTLAST_MS))
    .map((e) => e.name);
}

/** Entscheidung für `claim` bei bestehender Lock-Datei: `fremd` (gilt noch) oder `ersetzen` (verwaist). Pur. */
export function entscheideClaim({ erstellt, jetzt, verwaistMs = VERWAIST_MS }) {
  const alter = Number.isFinite(erstellt) ? jetzt - erstellt : Number.POSITIVE_INFINITY;
  return alter < verwaistMs ? "fremd" : "ersetzen";
}

/** Jüngste Aktivität in ms aus allen Quellen (nicht endliche Werte entfallen); `null`, wenn keine bekannt ist. Pur. */
export function letzteAktivitaet({ commitMs = [], reflogMs = [], dateiMs = [], nodeModulesMs = null, lockMs = null } = {}) {
  const alle = [...commitMs, ...reflogMs, ...dateiMs, nodeModulesMs, lockMs].filter((w) => Number.isFinite(w));
  return alle.length ? Math.max(...alle) : null;
}

/**
 * Ergebnis von `pruefe`. `lock`: Inhalt der Lock-Datei oder null; `nonce`: Argument oder null; `vorhanden`: Worktree oder Branch
 * existiert; `aktivitaet`: ms oder null; `uebergabeOffen`: der Lock trägt eine unverbrauchte Übergabe (#1592, zählt nur mit eigener Nonce, unabhängig von der Aktivität). Ohne Nonce gilt ein Lock jünger als `VERWAIST_MS` als `fremd` (#1625), sonst zählt nur die Aktivität; null (nichts feststellbar) ist fail-closed `aktiv`. Pur.
 */
export function entscheidePruefung({ lock, nonce, vorhanden, aktivitaet, jetzt, inaktivMs = INAKTIV_MS, uebergabeOffen = false, gestopptOffen = false }) {
  if (nonce && !gehoertZu(lock, nonce)) return "fremd";
  if (!nonce && lock && entscheideClaim({ erstellt: Date.parse(lock.erstellt), jetzt }) === "fremd") return "fremd";
  if (!vorhanden) return "frei";
  if (nonce && (uebergabeOffen || gestopptOffen)) return "uebernehmbar";
  if (aktivitaet === null || jetzt - aktivitaet < inaktivMs) return "aktiv";
  return "uebernehmbar";
}

const hashVon = (nonce) => createHash("sha256").update(nonce).digest("hex");

/** Gehört der Lock zu dieser Nonce? Neu liegt nur `nonceHash` in der Datei (die Nonce ist daraus nicht lesbar); Altformat: Klartext `nonce`. Pur. */
export function gehoertZu(lock, nonce) {
  if (!lock || typeof nonce !== "string" || nonce === "") return false;
  if (typeof lock.nonceHash === "string") return lock.nonceHash === hashVon(nonce);
  return typeof lock.nonce === "string" && lock.nonce === nonce;
}

/** Hinweis in jeder Ausgabe mit Exit 4: der Lock wird nie von Hand gelöst. */
export const NICHT_VON_HAND = "Nicht von Hand lösen: kein mv/rm der Lock-Datei, kein freigeben mit fremder Nonce; einen verwaisten Lock (älter als 2 h) übernimmt claim selbst.";

const NUMMER = /^\d+$/;

const lockPfad = (deps, nr) => join(deps.lockDir, `${nr}.json`);

function liesLock(deps, nr) {
  try {
    return parseLock(deps.liesDatei(lockPfad(deps, nr)));
  } catch {
    return null;
  }
}

/** Legt den Lock atomar an; `true` bei Gewinn, `false` bei vorhandener Datei, wirft sonst. */
function legeAn(deps, nr, nonce) {
  try {
    deps.schreibeNeu(lockPfad(deps, nr), `${JSON.stringify({ nr, nonceHash: hashVon(nonce), erstellt: new Date(deps.jetzt()).toISOString(), sandbox: deps.sandbox ?? null })}\n`);
    return true;
  } catch (e) {
    if (e && e.code === "EEXIST") return false;
    throw e;
  }
}

/** Namen aus den Deps (Test) oder aus der echten Projekt-Config; ein fehlender Schlüssel wirft (kein Standardwert). */
const namenVon = (deps) => deps.namen ?? ladeTicketNamen();

/** Gibt es einen Worktree `<praefixe.worktree><nr>` oder einen Branch `<praefixe.branch><nr>-*`? */
function ermittleBelegung(deps, nr) {
  const namen = namenVon(deps);
  const refs = deps.git(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).split(/\r?\n/).filter(Boolean);
  const bloecke = parseWorktreeBloecke(deps.git(["worktree", "list", "--porcelain"]));
  const worktrees = bloecke.flatMap((b) => [b.pfad, b.branch].filter(Boolean));
  const belegt = belegteNummern({ refs, worktrees }, namen).has(nr);
  const wtPfad = bloecke.find((b) => ticketAusRef(b.pfad, namen) === nr)?.pfad ?? null;
  return { belegt, refs: refs.filter((r) => ticketAusRef(r, namen) === nr), wtPfad };
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

/** Räumt alte Lock-Dateien ab (siehe `aufzuraeumen`); fail-open: ein Fehler beim Auflisten oder Löschen stört den Claim nie. */
function raeumeAuf(deps) {
  try {
    const eintraege = deps.liste(deps.lockDir).map((name) => ({ name, mtime: deps.mtime(join(deps.lockDir, name)) }));
    for (const name of aufzuraeumen({ eintraege, jetzt: deps.jetzt() })) {
      try {
        deps.loesche(join(deps.lockDir, name));
      } catch {
        /* weg oder gesperrt: der nächste claim versucht es erneut */
      }
    }
  } catch {
    /* kein Verzeichnis oder keine `liste`: nichts abzuräumen */
  }
}

function claim(deps, nr, wiederaufnahme = false) {
  try {
    deps.git(["fetch", "-q", "--prune", "origin"]);
  } catch {
    /* fail-open: ohne Netz zählen die lokalen Refs */
  }
  const b = ermittleBelegung(deps, nr);
  if (b.belegt) {
    const lock = liesLock(deps, nr);
    const urteil = wiederaufnahme ? entscheidePruefung({ lock, nonce: null, vorhanden: true, aktivitaet: letzteAktivitaet(sammleAktivitaet(deps, b)), jetzt: deps.jetzt() }) : "belegt";
    // Ein Herzschlag (`zuletzt`) schützt hier über `entscheideClaim` im Weiterlauf unten (`lebenszeichenMs`), nicht über die Aktivität.
    if (urteil !== "frei" && urteil !== "uebernehmbar") return ergebnis(4, "", `✖ ticket-lock: zu #${nr} gibt es schon einen Worktree oder Branch (${namenVon(deps).branchName(nr, "*")})${wiederaufnahme ? ` mit Lebenszeichen oder jungem Lock (${urteil})` : ""}: nicht claimen, nächstes Item. ${NICHT_VON_HAND}`);
  }
  deps.legeVerzeichnisAn(deps.lockDir);
  raeumeAuf(deps);
  const nonce = deps.nonce();
  if (legeAn(deps, nr, nonce)) return ergebnis(0, `nonce=${nonce}`);
  const vorhanden = liesLock(deps, nr);
  const erstellt = lebenszeichenMs(vorhanden) ?? Number.NaN;
  if (entscheideClaim({ erstellt, jetzt: deps.jetzt() }) === "fremd") return ergebnis(4, "", `✖ ticket-lock: #${nr} ist von einer anderen Session gelockt (letztes Lebenszeichen ${new Date(erstellt).toISOString()}, frei ab ${new Date(erstellt + VERWAIST_MS).toISOString()}): nicht claimen, nächstes Item. ${NICHT_VON_HAND}`);
  try {
    deps.benenneUm(lockPfad(deps, nr), `${lockPfad(deps, nr)}.verwaist-${hashVon(nonce).slice(0, 16)}`);
  } catch {
    return ergebnis(4, "", `✖ ticket-lock: der verwaiste Lock von #${nr} wurde gerade von einer anderen Session übernommen. ${NICHT_VON_HAND}`);
  }
  if (legeAn(deps, nr, nonce)) return ergebnis(0, `nonce=${nonce}`);
  return ergebnis(4, "", `✖ ticket-lock: #${nr} wurde beim Übernehmen des verwaisten Locks von einer anderen Session belegt. ${NICHT_VON_HAND}`);
}

/** Hinweis für `aktiv` nach einer schon verbrauchten Übergabe bzw. einem verbrauchten Stopp-Vermerk: Verbrauchszeit und Ausweg `gestoppt` (nach `TaskStop` des laufenden Umsetzers). Pur. */
export function verbrauchtHinweis(lock) {
  const zeit = lock?.uebergabe?.verbraucht ?? lock?.gestoppt?.verbraucht ?? null;
  return zeit ? ` Die Übergabe bzw. der Stopp-Vermerk wurde schon ${zeit} verbraucht; ein weiterer Nachfolger braucht zuerst "gestoppt <nr> --nonce <x>" (nach TaskStop des laufenden Umsetzers).` : "";
}

/** `verbrauche` (nur `uebernehmen`, #1593): verbraucht eine offene Übergabe bzw. einen Stopp-Vermerk; `pruefe` ist rein lesend. */
function pruefe(deps, nr, nonce, verbrauche = false) {
  const lock = liesLock(deps, nr);
  const b = ermittleBelegung(deps, nr);
  const aktivitaet = b.belegt ? letzteAktivitaet({ ...sammleAktivitaet(deps, b), lockMs: herzschlagMs(lock) }) : null;
  const uebergabeOffen = Boolean(lock?.uebergabe && !lock.uebergabe.verbraucht);
  const gestopptOffen = Boolean(lock?.gestoppt && !lock.gestoppt.verbraucht);
  const urteil = entscheidePruefung({ lock, nonce, vorhanden: b.belegt, aktivitaet, jetzt: deps.jetzt(), uebergabeOffen, gestopptOffen });
  if (urteil === "fremd") return ergebnis(4, urteil, `✖ ticket-lock: der Lock zu #${nr} gehört nicht zu dieser Nonce (fremd, fehlt oder ohne Nonce noch keine 2 h alt): nicht anfassen, Befund melden. ${NICHT_VON_HAND}`);
  if (urteil === "aktiv") return ergebnis(4, urteil, `✖ ticket-lock: zu #${nr} gibt es Worktree/Branch mit Aktivität in den letzten 30 min (oder ohne feststellbare Aktivität): nicht übernehmen.${verbrauchtHinweis(lock)} ${NICHT_VON_HAND}`);
  const verbraucht = new Date(deps.jetzt()).toISOString();
  const frischeUebergabe = verbrauche && urteil === "uebernehmbar" && uebergabeOffen && nonce;
  const frischeStopp = verbrauche && (urteil === "uebernehmbar" || urteil === "frei") && gestopptOffen && nonce;
  if (frischeUebergabe || frischeStopp) {
    schreibeLock(deps, nr, {
      ...lock,
      ...(frischeUebergabe ? { uebergabe: { ...lock.uebergabe, verbraucht } } : {}),
      ...(frischeStopp ? { gestoppt: { ...lock.gestoppt, verbraucht } } : {}),
    });
  }
  return ergebnis(0, urteil);
}

/** Vermerkt die Übergabe im eigenen Lock (Phasen-Schnitt, #1592): eine je Lock; fremde Nonce, fehlender Lock oder schon vorhandene Übergabe → Exit 4. */
function uebergeben(deps, nr, nonce) {
  const lock = liesLock(deps, nr);
  if (!gehoertZu(lock, nonce)) return ergebnis(4, "", `✖ ticket-lock: der Lock zu #${nr} fehlt oder gehört einer anderen Session, nichts übergeben. ${NICHT_VON_HAND}`);
  if (lock.uebergabe) return ergebnis(4, "", `✖ ticket-lock: zu #${nr} gab es schon eine Übergabe (eine je Lock), kein zweiter Schnitt. ${NICHT_VON_HAND}`);
  schreibeLock(deps, nr, { ...lock, uebergabe: { gesetzt: new Date(deps.jetzt()).toISOString(), verbraucht: null } });
  return ergebnis(0, "uebergeben");
}

/** Stopp-Vermerk (#1693): der Hauptchat hat den eigenen Umsetzer per `TaskStop` beendet. Das nächste `pruefe --nonce` meldet `uebernehmbar` statt `aktiv`; erst `uebernehmen` verbraucht den Vermerk (`pruefe` ändert nie etwas).
 *  Kein Phasen-Schnitt: das Feld `uebergabe` bleibt unberührt, "eine Übergabe je Lock" gilt weiter. Jeder TaskStop darf einen neuen Vermerk setzen; fremde Nonce oder fehlender Lock → Exit 4. */
function gestoppt(deps, nr, nonce) {
  const lock = liesLock(deps, nr);
  if (!gehoertZu(lock, nonce)) return ergebnis(4, "", `✖ ticket-lock: der Lock zu #${nr} fehlt oder gehört einer anderen Session, kein Stopp vermerkt. ${NICHT_VON_HAND}`);
  schreibeLock(deps, nr, { ...lock, gestoppt: { gesetzt: new Date(deps.jetzt()).toISOString(), verbraucht: null } });
  return ergebnis(0, "gestoppt");
}

/** Kurztext für `schritt`: einzeilig, getrimmt, höchstens 80 Zeichen; leer wird `null`. Pur. */
export function bereinigeSchritt(text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return s === "" ? null : s;
}

/** Lebenszeichen eines Plan-Schritts (#1699): nur der eigene Lock, sonst Exit 4. Frisch gelesen, nur `zuletzt` und `schritt` gesetzt. */
function lebenszeichen(deps, nr, nonce, schritt) {
  const lock = liesLock(deps, nr);
  if (!gehoertZu(lock, nonce)) return ergebnis(4, "", `✖ ticket-lock: der Lock zu #${nr} fehlt oder gehört einer anderen Session (eine andere Session hat den Claim übernommen?), kein Lebenszeichen. ${NICHT_VON_HAND}`);
  const s = bereinigeSchritt(schritt);
  schreibeLock(deps, nr, { ...lock, zuletzt: { zeit: new Date(deps.jetzt()).toISOString(), quelle: "schritt" }, ...(s ? { schritt: s } : {}) });
  return ergebnis(0, "lebenszeichen");
}

/** Lebenszeichen eines Commits (#1699, post-commit-Hook): Nummer aus dem Branch, nur `zuletzt`; ohne Ticket-Branch, ohne Lock oder bei jedem Fehler ein stiller No-op (Exit 0, der Hook darf nie stören). */
function lebenszeichenCommit(deps) {
  try {
    const nr = ticketAusRef(deps.git(["rev-parse", "--abbrev-ref", "HEAD"]).trim(), namenVon(deps));
    const lock = nr === null ? null : liesLock(deps, nr);
    if (lock) schreibeLock(deps, nr, { ...lock, zuletzt: { zeit: new Date(deps.jetzt()).toISOString(), quelle: "commit" } });
  } catch {
    /* nie stören */
  }
  return ergebnis(0);
}

/** Schreibt eine bestehende Lock-Datei neu (nur für den eigenen Lock). */
function schreibeLock(deps, nr, lock) {
  deps.ersetze(lockPfad(deps, nr), `${JSON.stringify(lock)}\n`);
}

function freigeben(deps, nr, nonce) {
  const lock = liesLock(deps, nr);
  if (!lock) return ergebnis(0, "kein Lock");
  if (!gehoertZu(lock, nonce)) return ergebnis(4, "", `✖ ticket-lock: der Lock zu #${nr} gehört einer anderen Session, nicht gelöscht. ${NICHT_VON_HAND}`);
  deps.loesche(lockPfad(deps, nr));
  return ergebnis(0, "freigegeben");
}

/** Die Befehle und ihre Flag-Menge (Format von `flagsLesen`) samt Pflicht-Flags: die einzige Befehlsliste, Prüfung per `Object.hasOwn`. */
const FLAG_MENGEN = {
  claim: { optionen: { wiederaufnahme: { type: "boolean" } }, pflicht: [] },
  pruefe: { optionen: { nonce: { type: "string" } }, pflicht: [] },
  freigeben: { optionen: { nonce: { type: "string" } }, pflicht: ["nonce"] },
  uebergeben: { optionen: { nonce: { type: "string" } }, pflicht: ["nonce"] },
  gestoppt: { optionen: { nonce: { type: "string" } }, pflicht: ["nonce"] },
  uebernehmen: { optionen: { nonce: { type: "string" }, nachfolger: { type: "boolean" } }, pflicht: ["nonce"] },
  lebenszeichen: { optionen: { nonce: { type: "string" }, schritt: { type: "string" } }, pflicht: ["nonce"] },
};

const USAGE ="Aufruf: claim <nr> [--wiederaufnahme] | pruefe <nr> [--nonce <x>] | freigeben <nr> --nonce <x> | uebergeben <nr> --nonce <x> | gestoppt <nr> --nonce <x> | uebernehmen <nr> --nonce <x> --nachfolger | lebenszeichen <nr> --nonce <x> [--schritt <text>] | lebenszeichen --commit";

/**
 * Liest den Aufruf vor jedem I/O: `{ commit: true }` für `lebenszeichen --commit` (genau diese zwei Argumente, post-commit-Hook), sonst
 * `{ befehl, nr, nonce, wiederaufnahme, schritt }` (`nonce` und `schritt` null ohne Flag) oder `{ fehler }`. Befehl und Nummer stehen fest an Position 1 und 2,
 * die Flags danach lesen `flagsLesen` je Befehl. Eine leere Nonce ist ein Fehler. Pur.
 */
export function aufrufLesen(argv) {
  if (argv.length === 2 && argv[0] === "lebenszeichen" && argv[1] === "--commit") return { commit: true };
  const [befehl, nrText, ...rest] = argv;
  if (typeof befehl !== "string" || !Object.hasOwn(FLAG_MENGEN, befehl)) return { fehler: befehl === undefined ? "kein Befehl angegeben" : `unbekannter Befehl ${befehl}` };
  if (!NUMMER.test(nrText ?? "")) return { fehler: nrText === undefined ? "Ticketnummer fehlt" : `ungültige Ticketnummer ${nrText}` };
  const { optionen, pflicht } = FLAG_MENGEN[befehl];
  const r = flagsLesen(rest, optionen, { pflicht });
  if (r.fehler) return { fehler: r.fehler.text };
  if (r.werte.nonce === "") return { fehler: "--nonce braucht einen Wert" };
  if (befehl === "uebernehmen" && r.werte.nachfolger !== true) return { fehler: "uebernehmen ruft nur der Nachfolger (--nachfolger); der Hauptchat prüft mit pruefe <nr> --nonce <x>" };
  return { befehl, nr: Number(nrText), nonce: r.werte.nonce ?? null, wiederaufnahme: r.werte.wiederaufnahme === true, schritt: r.werte.schritt ?? null };
}

/** Der Aufruf-Fehler als Ergebnis: Rahmen, Grund, Aufrufzeile. */
const aufrufFehler = (grund) => ergebnis(AUFRUF_EXIT, "", `✖ ticket-lock: ${grund}\n${USAGE}`);

/** Ausführung mit injizierbarer I/O: `{ code, out, err }`. `deps`: git, jetzt, nonce, sandbox, lockDir, liesDatei, schreibeNeu, ersetze, benenneUm, loesche, legeVerzeichnisAn, liste, mtime. */
export function fuehreAus(argv, deps) {
  const aufruf = aufrufLesen(argv);
  if (aufruf.fehler) return aufrufFehler(aufruf.fehler);
  if (aufruf.commit) return lebenszeichenCommit(deps);
  const { befehl, nr, nonce, wiederaufnahme, schritt } = aufruf;
  try {
    if (befehl === "claim") return claim(deps, nr, wiederaufnahme);
    if (befehl === "lebenszeichen") return lebenszeichen(deps, nr, nonce, schritt);
    if (befehl === "pruefe") return pruefe(deps, nr, nonce);
    if (befehl === "uebernehmen") return pruefe(deps, nr, nonce, true);
    if (befehl === "uebergeben") return uebergeben(deps, nr, nonce);
    if (befehl === "gestoppt") return gestoppt(deps, nr, nonce);
    return freigeben(deps, nr, nonce);
  } catch (e) {
    return ergebnis(2, "", `✖ ticket-lock: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Echte I/O: git per `execFileSync`, Lock-Verzeichnis im gemeinsamen git-Verzeichnis aller Worktrees. */
export function echteDeps({ config } = {}) {
  const namen = ticketNamen(config ?? ladeProjektConfig());
  const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const gemeinsam = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  return {
    git,
    jetzt: () => Date.now(),
    nonce: () => randomUUID(),
    lockDir: lockVerzeichnis({ gemeinsam, praefixWorktree: namen.praefixe.worktree }),
    namen,
    sandbox: process.env.AGENT_SANDBOX ?? null,
    liesDatei: (p) => readFileSync(p, "utf8"),
    schreibeNeu: (p, text) => {
      const fd = openSync(p, "wx");
      try {
        writeSync(fd, text);
      } finally {
        closeSync(fd);
      }
    },
    // Atomar: erst in eine Temp-Datei, dann umbenennen; ein Leser sieht nie einen halb geschriebenen Lock.
    ersetze: (p, text) => {
      const tmp = `${p}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
      try {
        writeFileSync(tmp, text);
        renameSync(tmp, p);
      } catch (e) {
        try {
          unlinkSync(tmp);
        } catch {
          /* nichts angelegt oder schon weg */
        }
        throw e;
      }
    },
    benenneUm: renameSync,
    loesche: unlinkSync,
    legeVerzeichnisAn: (d) => mkdirSync(d, { recursive: true }),
    liste: (d) => readdirSync(d),
    mtime: (p) => {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return Number.NaN;
      }
    },
  };
}

if (istDirektaufruf(import.meta.url)) {
  let r;
  try {
    // Aufruf zuerst: `echteDeps()` ruft git, ein falscher Aufruf braucht kein I/O (#1817).
    const argv = process.argv.slice(2);
    const vorab = aufrufLesen(argv);
    r = vorab.fehler ? aufrufFehler(vorab.fehler) : fuehreAus(argv, echteDeps());
  } catch (e) {
    r = ergebnis(2, "", `✖ ticket-lock: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
