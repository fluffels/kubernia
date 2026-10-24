#!/usr/bin/env node
/**
 * Prüfung verwaister Claims (#1699): meldet Tickets, deren Bearbeitung ohne Lebenszeichen liegt, und räumt Erledigtes auf.
 *
 *   node scripts/claims-pruefen.mjs [--stunden <n>]         # meldet und räumt auf
 *   node scripts/claims-pruefen.mjs --json [--stunden <n>]   # nur lesen: kein Aufräumen, keine Wiederaufnahme-Zeilen (Vertrag für das Cockpit)
 *
 * Ohne `--json` räumt das Skript auf (nur Erledigtes, siehe `aufraeumbar`); mehrere gleichzeitige Läufe sind unkritisch, weil `git worktree remove`
 * ohne `--force` läuft und vorher geprüft wird (der Verlierer meldet Exit 1).
 *
 * Kandidaten sind alle Nummern mit einer lokalen Spur (Lock-Datei, registrierter Worktree, Ticket-Branch lokal oder remote) oder einer
 * offenen Zuweisung an die eigene Identität. Bewusste Grenzen: ein reiner Remote-Branch gilt nicht als lokale Spur (ein Klon ohne eigenen Lock
 * übernimmt nichts); ein bewusst angehaltenes Ticket erkennt das Skript nur am Label `labels.festgefahren` (Projekt-Config) auf Issue oder PR, ein
 * Hand-off nach dem Review-Cap ohne PR und ohne Label bleibt als verwaist sichtbar; Labels, Assignees und PRs je Issue sind auf 30, 10 und 5 begrenzt
 * (darüber hinaus fail-open für das Label, fail-closed für das Aufräumen).
 * Je Nummer ein Urteil (`beurteileClaim`, pur):
 *   unbekannt        GitHub-Daten fehlen: keine Aktion (fail-closed).
 *   lebendig         offen, Lebenszeichen (Lock `zuletzt`/`erstellt`/Übergabe/Stopp, Commit-Zeit der Branch-Köpfe) jünger als N Stunden (Standard 3).
 *   verwaist         offen, lokale Spur, Lebenszeichen älter als N Stunden oder keins feststellbar: Zeile `WIEDERAUFNAHME`; die Übernahme
 *                    geschieht atomar mit `node scripts/ticket-lock.mjs claim <nr> --wiederaufnahme`. Ein fremd zugewiesenes Ticket wird behalten.
 *   ohne-lokale-spur offen und zugewiesen, aber ohne Lock, Worktree und lokalen Branch: nur Meldung (evtl. eine andere Maschine).
 *   (offen und festgefahren: `behalten`, keine Wiederaufnahme.)
 *   lock-unlesbar    nur Meldung, der Lock wird nie gelöscht.
 *   aufraeumbar      geschlossen: Lock löschen und, mit Worktree, den Worktree entfernen. Ein Worktree nur bei gemergtem PR, sauberem Stand,
 *                    HEAD gleich dem Kopf eines gemergten PR, nicht gesperrt und ohne Lebenszeichen der letzten 30 min (`git worktree remove`,
 *                    nie `--force`; der Lock erst nach verifiziertem Entfernen). Ein Lock ohne Worktree und ohne Branch wird auch ohne PR gelöscht (Epic).
 *   behalten         alles andere, mit Grund.
 * Das Skript entfernt nie einen Assignee und ändert nie ein Issue.
 *
 * Exit 0 = ok, 1 = ein Aufräumschritt ist gescheitert (der Rest wird gemeldet), 2 = Aufruf-, git- oder gh-Fehler (nichts aufgeräumt),
 * 5 = GitHub-API-Kontingent knapp.
 */
import { istDirektaufruf } from "./hook-io.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { REPO, teilantwortAusStdout } from "./board-lib.mjs";
import { fehlerMeldung, ghJson, ghText } from "./gh-cli.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { labelAus, ladeProjektConfig, zerlegeRepo } from "./projekt-config-lib.mjs";
import { INAKTIV_MS, lebenszeichenMs, lockVerzeichnis, oeffentlicheSicht, parseLock } from "./ticket-lock-lib.mjs";
import { ladeTicketNamen, ticketNamen, worktreePraefix } from "./ticket-namen.mjs";
import { lensWorktreeName, ticketAusRef } from "./ticket-refs.mjs";
import { parseWorktreeBloecke } from "./worktree-aufraeumen.mjs";

/** Standard-Schwelle in Stunden: ohne Lebenszeichen darüber gilt ein offener Claim als verwaist (über `VERWAIST_MS` von 2 h). */
export const STANDARD_STUNDEN = 3;
const STUNDE = 60 * 60_000;
/** Höchstzahl Issues je GraphQL-Abfrage. */
const ALIAS_MAX = 40;

/** Argumente: `{ json, stunden }` oder `{ fehler }`. Pur. */
export function parseArgs(argv) {
  const unbekannt = (flag) => `unbekanntes Argument: ${flag}`;
  const meldung = { "ohne-wert": "--stunden braucht eine positive Zahl (bekam: nichts)", unbekannt, positional: unbekannt };
  const { werte, fehler } = flagsLesen(argv, { json: { type: "boolean" }, stunden: { type: "string" } }, { meldung });
  if (fehler) return { fehler: fehler.text };
  let stunden = STANDARD_STUNDEN;
  if (werte.stunden !== undefined) {
    const n = Number(werte.stunden);
    if (werte.stunden.trim() === "" || !Number.isFinite(n) || n <= 0) return { fehler: `--stunden braucht eine positive Zahl (bekam: ${werte.stunden})` };
    stunden = n;
  }
  return { json: werte.json === true, stunden };
}

/** Das Urteil zu einem Claim (`{ urteil, grund, aktion }`); `aktion`: was aufzuräumen ist (`worktree`, `lock`). Pur, Eingabe siehe `sammle`. */
export function beurteileClaim({ claim: c, jetzt, schwelleMs, inaktivMs = INAKTIV_MS }) {
  const ohneAktion = { worktree: false, lock: false };
  const ergebnis = (urteil, grund, aktion = ohneAktion) => ({ urteil, grund, aktion });
  if (!c.issue) return ergebnis("unbekannt", "GitHub-Daten fehlen (keine Aktion)");
  if (c.lock === "unlesbar") return ergebnis("lock-unlesbar", "Lock unlesbar, nie löschen (von Hand prüfen)");
  const lz = c.lebenszeichenMs;
  const alter = Number.isFinite(lz) ? jetzt - lz : Number.POSITIVE_INFINITY;
  const spur = Boolean(c.lock || c.worktree || c.branchLokal);
  if (c.issue.zustand !== "CLOSED") {
    if (!spur) return ergebnis("ohne-lokale-spur", c.issue.assignees.length ? "zugewiesen, aber ohne Lock, Worktree und lokalen Branch (evtl. andere Maschine)" : "offen, keine lokale Spur");
    if (c.festgefahren) return ergebnis("behalten", "festgefahren (Label), bewusst angehalten: keine Wiederaufnahme");
    if (alter < schwelleMs) return ergebnis("lebendig", "Lebenszeichen jünger als die Schwelle");
    const fremd = c.issue.assignees.some((a) => a !== c.viewer);
    if (fremd) return ergebnis("behalten", "fremd zugewiesen, keine Wiederaufnahme");
    return ergebnis("verwaist", Number.isFinite(lz) ? "kein Lebenszeichen seit der Schwelle" : "kein Lebenszeichen feststellbar");
  }
  const gemergt = c.prs.filter((p) => p.zustand === "MERGED");
  const lockAktion = Boolean(c.lock);
  if (c.worktree) {
    const w = c.worktree;
    if (gemergt.length === 0) return ergebnis("behalten", "Worktree ohne gemergten PR");
    if (!w.sauber) return ergebnis("behalten", "Worktree mit uncommitteten Änderungen oder Status unlesbar");
    if (!w.head || !gemergt.some((p) => p.headRefOid === w.head)) return ergebnis("behalten", "Worktree-HEAD ist nicht der Kopf eines gemergten PR");
    if (w.locked) return ergebnis("behalten", "Worktree gesperrt");
    if (alter < inaktivMs) return ergebnis("behalten", "Lebenszeichen der letzten 30 min");
    return ergebnis("aufraeumbar", "geschlossen, PR gemergt, Worktree sauber und gleich dem PR-Kopf", { worktree: true, lock: lockAktion });
  }
  if (!c.lock) return ergebnis("behalten", c.branch ? "nur Branch (node scripts/cleanup-worktrees.mjs --branches --fix)" : "nichts aufzuräumen");
  if (alter < inaktivMs) return ergebnis("behalten", "Lock mit Lebenszeichen der letzten 30 min");
  if (c.branch && gemergt.length === 0) return ergebnis("behalten", "Lock mit Branch, aber ohne gemergten PR");
  return ergebnis("aufraeumbar", c.branch ? "geschlossen, PR gemergt, Lock ohne Worktree" : "geschlossen, Lock ohne Worktree und Branch", { worktree: false, lock: true });
}

/** Gebündelte GraphQL-Abfragen (`viewer` und je Nummer ein Alias `i<k>`), je bis zu `ALIAS_MAX` Nummern. Pur. */
export function aliasAbfragen(nummern, repo = REPO) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Ungültiges Repo: ${String(repo)}`);
  if (nummern.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error("Nummern müssen positive Ganzzahlen sein");
  const { owner, name } = zerlegeRepo(repo);
  const felder = "state labels(first:30){ nodes{ name } } assignees(first:10){ nodes{ login } } closedByPullRequestsReferences(first:5, includeClosedPrs:true){ nodes{ number state headRefOid labels(first:30){ nodes{ name } } } }";
  const bloecke = [];
  for (let von = 0; von < nummern.length; von += ALIAS_MAX) {
    const teil = nummern.slice(von, von + ALIAS_MAX);
    const aliase = teil.map((n, k) => `i${k}: issue(number: ${n}){ ${felder} }`).join(" ");
    bloecke.push({ nummern: teil, query: `query{ viewer{ login } repository(owner:"${owner}",name:"${name}"){ ${aliase} } }` });
  }
  return bloecke;
}

/** Issue-Daten eines Alias (`null` bei unbekanntem Issue): `{ zustand, assignees, prs }`. Pur. */
export function issueAus(knoten) {
  if (!knoten || typeof knoten !== "object" || typeof knoten.state !== "string") return null;
  return {
    zustand: knoten.state,
    assignees: (knoten.assignees?.nodes ?? []).map((a) => a.login),
    labels: (knoten.labels?.nodes ?? []).map((l) => l.name),
    prs: (knoten.closedByPullRequestsReferences?.nodes ?? []).map((p) => ({ nummer: p.number, zustand: p.state, headRefOid: p.headRefOid ?? null, labels: (p.labels?.nodes ?? []).map((l) => l.name) })),
  };
}

/** Eine Abfrage ausführen; ein unbekanntes Issue (`NOT_FOUND`) gilt als Teilantwort, jeder andere Fehler wirft. */
function frageGraphql(deps, query) {
  try {
    return deps.graphql(query);
  } catch (e) {
    const antwort = teilantwortAusStdout(e?.stdout);
    if (antwort) return antwort;
    throw e;
  }
}

/** Liegt `pfad` unter `<Hauptcheckout>/.claude/worktrees/` und gehört zur Nummer? Pur. */
export function pfadErlaubt({ pfad, hauptcheckout, nr, namen = ladeTicketNamen() }) {
  const rel = relative(resolve(hauptcheckout, ".claude", "worktrees"), resolve(pfad));
  return !/[\\/]/.test(rel) && ticketAusRef(`worktrees/${rel}`, namen) === nr && !lensWorktreeName(namen).test(rel);
}

/** Sammelt Kandidaten und ihre Daten: `{ jetzt, viewer, hauptcheckout, claims }`. Wirft bei git-/gh-Fehlern. */
export function sammle(deps) {
  const jetzt = deps.jetzt();
  const namen = deps.namen ?? ladeTicketNamen();
  const lensName = lensWorktreeName(namen);
  const bloecke = parseWorktreeBloecke(deps.git(["worktree", "list", "--porcelain"]));
  const hauptcheckout = bloecke[0]?.pfad ?? "";
  const ticketWorktrees = bloecke.slice(1).filter((b) => !lensName.test(basename(b.pfad)) && ticketAusRef(b.pfad, namen) !== null);
  const refs = deps
    .git(["for-each-ref", "--format=%(refname)\t%(committerdate:unix)", "refs/heads", "refs/remotes"])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((z) => {
      const [name, sek] = z.split("\t");
      return { nr: ticketAusRef(name, namen), ms: Number(sek) * 1000, lokal: name.startsWith("refs/heads/") };
    })
    .filter((r) => r.nr !== null);
  let dateien = [];
  try {
    dateien = deps.liste(deps.lockDir).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    /* kein Lock-Verzeichnis: keine Locks */
  }
  const locks = new Map(
    dateien.map((n) => {
      let lock = "unlesbar";
      try {
        lock = parseLock(deps.liesDatei(join(deps.lockDir, n))) ?? "unlesbar";
      } catch {
        /* unlesbar */
      }
      return [Number(n.replace(".json", "")), lock];
    }),
  );
  const nummern = [...new Set([...locks.keys(), ...ticketWorktrees.map((b) => ticketAusRef(b.pfad, namen)), ...refs.map((r) => r.nr), ...deps.zugewiesen()])].sort((a, b) => a - b);
  const issues = new Map();
  let viewer = null;
  for (const b of aliasAbfragen(nummern)) {
    const antwort = frageGraphql(deps, b.query);
    viewer = antwort?.data?.viewer?.login ?? viewer;
    b.nummern.forEach((nr, k) => issues.set(nr, issueAus(antwort?.data?.repository?.[`i${k}`])));
  }
  const claims = nummern.map((nr) => {
    const w = ticketWorktrees.find((b) => ticketAusRef(b.pfad, namen) === nr) ?? null;
    let sauber = false;
    if (w) {
      try {
        sauber = deps.git(["-C", w.pfad, "status", "--porcelain"]).trim() === "";
      } catch {
        /* Status unlesbar: gilt als nicht sauber */
      }
    }
    const lock = locks.get(nr) ?? null;
    const meine = refs.filter((r) => r.nr === nr);
    const lz = [lebenszeichenMs(typeof lock === "object" ? lock : null), ...meine.map((r) => r.ms)].filter((x) => Number.isFinite(x));
    const issue = issues.get(nr) ?? null;
    return {
      nr,
      viewer,
      issue: issue && { zustand: issue.zustand, assignees: issue.assignees },
      prs: issue?.prs ?? [],
      festgefahren: Boolean(deps.festgefahrenLabel && issue && (issue.labels.includes(deps.festgefahrenLabel) || issue.prs.some((p) => p.labels.includes(deps.festgefahrenLabel)))),
      lock,
      worktree: w && { pfad: w.pfad, branch: w.branch, sauber, head: w.head, locked: w.locked },
      branch: meine.length > 0,
      branchLokal: meine.some((r) => r.lokal),
      lebenszeichenMs: lz.length ? Math.max(...lz) : null,
    };
  });
  return { jetzt, viewer, hauptcheckout, claims };
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const stundenSeit = (jetzt, ms) => (Number.isFinite(ms) ? Math.floor((jetzt - ms) / STUNDE) : null);

/** Das `--json`-Dokument (nie Nonce oder Hash). Pur. */
export function jsonDokument({ jetzt, viewer, schwelleStunden, urteile }) {
  return {
    jetzt: iso(jetzt),
    schwelleStunden,
    viewer,
    claims: urteile.map(({ claim: c, urteil }) => ({
      nr: c.nr,
      issue: c.issue,
      lock: c.lock === null || c.lock === "unlesbar" ? c.lock : oeffentlicheSicht(c.lock),
      worktree: c.worktree && { pfad: c.worktree.pfad, branch: c.worktree.branch, sauber: c.worktree.sauber, head: c.worktree.head },
      branch: c.branch,
      branchLokal: c.branchLokal,
      festgefahren: c.festgefahren,
      prs: c.prs.map((p) => ({ nummer: p.nummer, zustand: p.zustand })),
      lebenszeichen: iso(c.lebenszeichenMs),
      urteil: urteil.urteil,
      grund: urteil.grund,
    })),
  };
}

/** Entfernt den Worktree und den Lock eines Claims; liefert eine Ausgabezeile und ob es gelang. */
function raeumeAuf(deps, c, urteil, lockPfad, hauptcheckout) {
  const getan = [];
  if (urteil.aktion.worktree) {
    if (!pfadErlaubt({ pfad: c.worktree.pfad, hauptcheckout, nr: c.nr, namen: deps.namen ?? ladeTicketNamen() })) return { ok: false, zeile: `FEHLER #${c.nr}: Worktree-Pfad liegt nicht unter dem Worktree-Ordner des Hauptcheckouts, nichts entfernt` };
    try {
      deps.git(["worktree", "remove", c.worktree.pfad]);
      const noch = parseWorktreeBloecke(deps.git(["worktree", "list", "--porcelain"])).some((b) => b.pfad === c.worktree.pfad);
      if (noch || deps.existiert(c.worktree.pfad)) return { ok: false, zeile: `FEHLER #${c.nr}: Worktree ${c.worktree.pfad} ist nach dem Entfernen noch da (Lock bleibt)` };
    } catch (e) {
      return { ok: false, zeile: `FEHLER #${c.nr}: git worktree remove scheiterte (${String(e?.message ?? e).split("\n")[0]}); Lock bleibt` };
    }
    getan.push(`Worktree ${c.worktree.pfad}`);
  }
  if (urteil.aktion.lock) {
    try {
      deps.loesche(lockPfad);
      getan.push("Lock");
    } catch (e) {
      return { ok: false, zeile: `FEHLER #${c.nr}: Lock nicht gelöscht (${String(e?.message ?? e).split("\n")[0]})` };
    }
  }
  return { ok: true, zeile: `AUFGERAEUMT #${c.nr}: ${getan.join(", ")} (${urteil.grund})` };
}

const aufrufFehler = (fehler) => `✖ claims-pruefen: ${fehler}
Aufruf: claims-pruefen [--json] [--stunden <n>]`;
const ergebnisAus = (code, out = "", err = "") => ({ code, out: out ? `${out}\n` : "", err: err ? `${err}\n` : "" });

/**
 * Ausführung mit injizierbarer I/O: `{ code, out, err }`. `depsOderFabrik` ist das Deps-Objekt oder eine Fabrik dafür;
 * die Fabrik läuft erst nach dem Parsen, ein Aufruf-Fehler kommt also vor jedem I/O (Kontingent, gh, git, Config).
 */
export function fuehreAus(argv, depsOderFabrik) {
  const args = parseArgs(argv);
  if (args.fehler) return ergebnisAus(AUFRUF_EXIT, "", aufrufFehler(args.fehler));
  let deps = depsOderFabrik;
  if (typeof depsOderFabrik === "function") {
    try {
      deps = depsOderFabrik();
    } catch (e) {
      return ergebnisAus(AUFRUF_EXIT, "", fehlerMeldung(e, { praefix: "claims-pruefen: " }));
    }
  }
  let stand;
  try {
    stand = sammle(deps);
  } catch (e) {
    return ergebnisAus(2, "", `✖ claims-pruefen: git oder gh fehlgeschlagen, nichts aufgeräumt: ${String(e?.message ?? e).split("\n")[0]}`);
  }
  const schwelleMs = args.stunden * STUNDE;
  const urteile = stand.claims.map((claim) => ({ claim, urteil: beurteileClaim({ claim, jetzt: stand.jetzt, schwelleMs }) }));
  if (urteile.length > 0 && urteile.every((u) => u.urteil.urteil === "unbekannt")) return ergebnisAus(2, "", "✖ claims-pruefen: keine GitHub-Daten zu den Kandidaten, nichts aufgeräumt");
  if (args.json) return ergebnisAus(0, JSON.stringify(jsonDokument({ jetzt: stand.jetzt, viewer: stand.viewer, schwelleStunden: args.stunden, urteile }), null, 2));
  const zeilen = [];
  let code = 0;
  for (const { claim: c, urteil } of urteile.filter((u) => u.urteil.urteil === "aufraeumbar")) {
    const r = raeumeAuf(deps, c, urteil, join(deps.lockDir, `${c.nr}.json`), stand.hauptcheckout);
    zeilen.push(r.zeile);
    if (!r.ok) code = 1;
  }
  const verwaist = urteile.filter((u) => u.urteil.urteil === "verwaist").sort((a, b) => (a.claim.lebenszeichenMs ?? -Infinity) - (b.claim.lebenszeichenMs ?? -Infinity));
  for (const { claim: c, urteil } of verwaist) {
    const h = stundenSeit(stand.jetzt, c.lebenszeichenMs);
    zeilen.push(`WIEDERAUFNAHME #${c.nr}: ${urteil.grund}, letztes Lebenszeichen ${iso(c.lebenszeichenMs) ?? "unbekannt"}${h === null ? "" : ` (vor ${h} h)`}; Weg: node scripts/ticket-lock.mjs claim ${c.nr} --wiederaufnahme, dann Fortsetzungsauftrag`);
  }
  for (const { claim: c, urteil } of urteile.filter((u) => !["aufraeumbar", "verwaist"].includes(u.urteil.urteil))) zeilen.push(`BEHALTEN #${c.nr}: ${urteil.urteil}, ${urteil.grund}`);
  return ergebnisAus(code, zeilen.join("\n"));
}

/** Echte I/O: git und gh über die gemeinsamen Wrapper, Lock-Verzeichnis im gemeinsamen git-Verzeichnis. */
export function echteDeps({ config: vorgabe } = {}) {
  const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const gemeinsam = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const config = vorgabe ?? ladeProjektConfig();
  return {
    namen: ticketNamen(config),
    jetzt: () => Date.now(),
    git,
    graphql: (query) => JSON.parse(ghText(["api", "graphql", "-f", `query=${query}`])),
    zugewiesen: () => {
      const liste = ghJson(["issue", "list", "--assignee", "@me", "--state", "open", "--json", "number", "--limit", "200"]);
      if (liste.length >= 200) process.stderr.write("Warnung: 200 offene Zuweisungen, die Liste ist an der Grenze und kann unvollständig sein\n");
      return liste.map((i) => i.number);
    },
    festgefahrenLabel: labelAus(config, "festgefahren"),
    lockDir: lockVerzeichnis({ gemeinsam, praefixWorktree: worktreePraefix(config) }),
    liste: (d) => readdirSync(d),
    liesDatei: (p) => readFileSync(p, "utf8"),
    loesche: unlinkSync,
    existiert: existsSync,
  };
}

if (istDirektaufruf(import.meta.url)) {
  let r;
  try {
    r = fuehreAus(process.argv.slice(2), () => {
      mitKontingent("claims-pruefen");
      return echteDeps();
    });
  } catch (e) {
    r = ergebnisAus(2, "", fehlerMeldung(e, { praefix: "claims-pruefen: " }));
  }
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
