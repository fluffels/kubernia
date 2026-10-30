// Kein Shebang: wird per `node scripts/pr-warten.mjs <pr>` gestartet UND von test/pr-warten.test.ts importiert.
/**
 * Auf die CI eines PR warten, ohne den Kontext zu fluten und ohne den Prompt-Cache ablaufen zu lassen (#1559).
 *
 *   node scripts/pr-warten.mjs <pr> [--max-sekunden 240] [--intervall 30]
 *
 * Ein Aufruf pollt höchstens `--max-sekunden` (Standard 240, unter der 5-Minuten-Cache-TTL der Subagenten: eine längere
 * Pause baut den ganzen Kontext neu auf, docs/model-routing.md § Umsetzer-Kontext) und gibt eine kompakte Zeile aus (bei rotem Nicht-Pflicht-Check zusätzlich eine `HINWEIS`-Zeile):
 *   Exit 0  `MERGED <sha>`
 *   Exit 1  `ROT <check> <url>` je rotem Check (Log nur bei Bedarf: `gh run view <id> --log-failed | tail -n 80`)
 *   Exit 2  `OFFEN x/y grün, wartend: …` nach Ablauf des Zeitbudgets: erneut aufrufen
 *   Exit 3  `KONFLIKT` | `GESCHLOSSEN` | `GRÜN OHNE AUTO-MERGE` | `GH-FEHLER …` (braucht Handeln), auch ein Aufruf-Fehler (unbekanntes Flag, Flag ohne Wert, doppeltes Flag, keine oder falsche PR-Nummer: Meldung und Aufrufzeile auf stderr)
 *   Zusatz bei Exit 1, 2, 3: `HINWEIS <check> <url> (kein Pflicht-Check, kein Merge-Gate)` je rotem Check außerhalb der Pflicht-Checks (kein ROT, zählt nicht mit).
 * Pflicht-Checks: `gh pr checks <pr> --required --json name`; nur sie gaten. Schlägt das Holen fehl oder ist die Liste leer, gatet jeder Check (fail-closed).
 * `KONFLIKT` meldet erst eine zweite Abfrage im Abstand von mindestens 15 s (`mergeable` flackert, auch UNKNOWN).
 * Läuft das Zeitbudget nach gh-Fehlern ab, steht die letzte `GH-FEHLER`-Zeile mit Exit 2 da; erst drei Fehler in Folge sind Exit 3.
 * `statusCheckRollup` liefert `gh` mit der Standardgrenze (rund 100 Einträge); die CI hat deutlich weniger Checks.
 * Der Kern `bewerte` ist pur, `holePflicht` nimmt den `gh`-Aufruf als Parameter (getestet); nur CLI und Schlaf sind dünne, ungetestete IO.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { flagsLesen } from "./flag-lib.mjs";
import { ghText } from "./gh-cli.mjs";

const ROT = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const GRUEN = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
/** Mindestabstand der zwei Abfragen, bevor ein Konflikt gemeldet wird: `mergeable` ist kurz nach einem Push UNKNOWN oder flackert. */
export const KONFLIKT_ABSTAND_MS = 15_000;
export const FELDER = "state,mergeable,statusCheckRollup,autoMergeRequest,mergeCommit";

/** Ein Rollup-Eintrag (CheckRun oder StatusContext) → `{ name, art: "rot" | "gruen" | "offen", url }`. */
function eintrag(e) {
  if (e?.__typename === "StatusContext" || e?.context) {
    const s = String(e.state ?? "").toUpperCase();
    return { name: e.context ?? "?", art: ROT.has(s) ? "rot" : s === "SUCCESS" ? "gruen" : "offen", url: e.targetUrl ?? "" };
  }
  const fertig = String(e?.status ?? "").toUpperCase() === "COMPLETED";
  const c = String(e?.conclusion ?? "").toUpperCase();
  return { name: e?.name ?? "?", art: !fertig ? "offen" : ROT.has(c) ? "rot" : GRUEN.has(c) ? "gruen" : "rot", url: e?.detailsUrl ?? "" };
}

/** Zeitstempel für die Aktualität eines CheckRuns; ein noch nicht fertiger Lauf (queued/in progress) gilt als jüngster (sein startedAt kann der Nullwert sein). */
const stempel = (e) => (String(e?.status ?? "").toUpperCase() === "COMPLETED" ? String(e?.startedAt || e?.completedAt || "") : "\uffff");

/**
 * Je (workflowName, name) nur der jüngste CheckRun, StatusContexts je context: ein Rerun überschreibt den früheren Lauf
 * (ein alter CANCELLED neben einem neueren SUCCESS desselben Workflows ist kein Rot). Ein alleinstehender CANCELLED bleibt rot. Pur.
 */
export function juengste(rollup) {
  const je = new Map();
  for (const e of rollup ?? []) {
    const status = e?.__typename === "StatusContext" || e?.context;
    const key = status ? `ctx\u0000${e.context ?? "?"}` : `run\u0000${e?.workflowName ?? ""}\u0000${e?.name ?? "?"}`;
    const alt = je.get(key);
    // Bei gleichem Stempel gewinnt der spätere Eintrag der Liste (gh liefert sie in Startreihenfolge).
    if (!alt || status || stempel(e) >= stempel(alt)) je.set(key, e);
  }
  return [...je.values()];
}

/**
 * `gh pr view --json ${FELDER}` → `{ exit, zeilen }`. Exit 2 heißt: noch offen, weiter warten.
 * `pflicht`: Namen der Pflicht-Checks (exakt); nur sie gaten, ein rotes anderes Check wird ein `HINWEIS`. Fehlt die Liste
 * oder ist sie leer, gatet jedes Check (fail-closed).
 */
export function bewerte(pr, pflicht = null) {
  if (pr?.state === "MERGED") return { exit: 0, zeilen: [`MERGED ${String(pr.mergeCommit?.oid ?? "").slice(0, 7)}`.trim()] };
  if (pr?.state === "CLOSED") return { exit: 3, zeilen: ["GESCHLOSSEN"] };
  const alle = juengste(pr?.statusCheckRollup).map(eintrag);
  // Nicht-Pflicht-Checks sperren den Merge nicht: sie zählen weder zu rot noch zu grün noch zu wartend.
  const gatet = Array.isArray(pflicht) && pflicht.length ? new Set(pflicht) : null;
  const checks = gatet ? alle.filter((c) => gatet.has(c.name)) : alle;
  const hinweise = alle.filter((c) => c.art === "rot" && !checks.includes(c)).map((c) => `HINWEIS ${c.name} ${c.url} (kein Pflicht-Check, kein Merge-Gate)`);
  const mit = (exit, zeilen) => ({ exit, zeilen: [...zeilen, ...hinweise] });
  if (pr?.mergeable === "CONFLICTING") return mit(3, ["KONFLIKT"]);
  const rot = checks.filter((c) => c.art === "rot");
  if (rot.length) return mit(1, rot.map((c) => `ROT ${c.name} ${c.url}`.trim()));
  const gruen = checks.filter((c) => c.art === "gruen").length;
  const offen = checks.filter((c) => c.art === "offen");
  // Ein leerer Rollup ist nicht grün: die Checks sind noch nicht gestartet.
  if (!offen.length && checks.length) {
    return pr?.autoMergeRequest ? mit(2, [`OFFEN ${gruen}/${checks.length} grün, Merge steht aus`]) : mit(3, ["GRÜN OHNE AUTO-MERGE"]);
  }
  return mit(2, [`OFFEN ${gruen}/${checks.length} grün, wartend: ${offen.map((c) => c.name).join(", ") || "Checks starten"}`]);
}

/**
 * Entscheidung über einen gesehenen Konflikt: `seit` ist der Zeitpunkt der ersten Beobachtung (null: noch keine).
 * Bestätigt ist er erst, wenn die erste mindestens `KONFLIKT_ABSTAND_MS` zurückliegt. → `{ bestaetigt, seit }`.
 */
export function konfliktStand(seit, jetzt) {
  if (seit === null || seit === undefined) return { bestaetigt: false, seit: jetzt };
  return { bestaetigt: jetzt - seit >= KONFLIKT_ABSTAND_MS, seit };
}

/**
 * Pollt `hole()` bis ein Ergebnis ≠ Exit 2 kommt oder das Zeitbudget abläuft. Drei gh-Fehler in Folge → Exit 3.
 * `pflicht()` liefert die Namen der Pflicht-Checks (einmal nicht leer geholt, sonst bei jeder Abfrage neu; ein Fehler oder eine leere Liste heißt: alle gaten).
 * Ein Konflikt wird erst gemeldet, wenn eine zweite Abfrage mindestens `KONFLIKT_ABSTAND_MS` später ihn bestätigt (auch über das Budget hinaus).
 * @param {{ hole: () => object, pflicht?: () => readonly string[], schlafe: (ms: number) => void, jetzt: () => number, maxMs: number, intervallMs: number }} e
 */
export function warten({ hole, pflicht = () => [], schlafe, jetzt, maxMs, intervallMs }) {
  const ende = jetzt() + maxMs;
  let fehler = 0;
  let letzte;
  let liste = null;
  let konfliktSeit = null;
  for (;;) {
    try {
      if (!liste) {
        try {
          const geholt = pflicht();
          liste = geholt?.length ? geholt : null; // leer gilt wie ein Fehler: nicht cachen, nächste Abfrage holt neu
        } catch {
          liste = null;
        }
      }
      letzte = bewerte(hole(), liste);
      fehler = 0;
    } catch (err) {
      fehler += 1;
      letzte = { exit: 2, zeilen: [`GH-FEHLER ${String(err?.message ?? err).split("\n")[0].slice(0, 120)}`] };
      if (fehler >= 3) return { exit: 3, zeilen: letzte.zeilen };
    }
    if (letzte.exit === 3 && letzte.zeilen[0] === "KONFLIKT") {
      const k = konfliktStand(konfliktSeit, jetzt());
      if (k.bestaetigt) return letzte;
      konfliktSeit = k.seit;
      schlafe(KONFLIKT_ABSTAND_MS);
      continue;
    }
    konfliktSeit = null;
    if (letzte.exit !== 2 || jetzt() + intervallMs >= ende) return letzte;
    schlafe(intervallMs);
  }
}

// ── CLI (dünn, ungetestet: gh und Schlaf) ────────────────────────────────────

export function parseArgs(argv) {
  const { werte, positionale, fehler } = flagsLesen(argv, { "max-sekunden": { type: "string" }, intervall: { type: "string" } }, { positionale: true });
  const a = { pr: null, maxSekunden: 240, intervall: 30 };
  if (fehler) a.fehler = fehler.text;
  else if (positionale.length > 1) a.fehler = `Unbekanntes Argument: ${positionale[1]}`;
  else if (positionale.length === 1 && !/^\d+$/.test(positionale[0])) a.fehler = `PR-Nummer erwartet, nicht ${positionale[0]}`;
  else if (positionale.length === 1) a.pr = positionale[0];
  if (werte["max-sekunden"] !== undefined) a.maxSekunden = Number(werte["max-sekunden"]);
  if (werte.intervall !== undefined) a.intervall = Number(werte.intervall);
  return a;
}

/** Namen der Pflicht-Checks. `gh pr checks` endet mit Exit 8, solange Checks laufen; die JSON-Ausgabe steht dann trotzdem in stdout. */
export function holePflicht(pr, gh = ghText) {
  let text;
  try {
    text = gh(["pr", "checks", pr, "--required", "--json", "name"], { timeout: 30_000 });
  } catch (err) {
    text = String(err?.stdout ?? "");
    if (!text.trim().startsWith("[")) throw err;
  }
  return JSON.parse(text).map((c) => c.name);
}

/** Pur: die Werkzeugnamen der Regel `code_scanning` aus den Branch-Regeln (`gh api repos/{owner}/{repo}/rules/branches/<base>`); kaputte Form → leer. */
export function codeScanningWerkzeuge(regeln) {
  if (!Array.isArray(regeln)) return [];
  return regeln
    .filter((r) => r?.type === "code_scanning")
    .flatMap((r) => (Array.isArray(r.parameters?.code_scanning_tools) ? r.parameters.code_scanning_tools : []))
    .map((t) => t?.tool)
    .filter((n) => typeof n === "string" && n.trim() !== "");
}

/** Pur: Pflicht-Checks plus Code-Scanning-Werkzeuge. Eine leere Basis bleibt leer (fail-closed: dann gatet jeder Check). */
export const pflichtListe = (basis, werkzeuge) => (basis.length ? [...basis, ...werkzeuge] : []);

/** Pur: hängt die Hinweiszeile an, außer nach MERGED (Exit 0) oder ohne Hinweis. */
export const mitHinweis = (r, hinweis) => (hinweis && r.exit !== 0 ? { ...r, zeilen: [...r.zeilen, hinweis] } : r);

/**
 * Code-Scanning-Werkzeuge der live gesetzten Ruleset-Regel `code_scanning` des Basis-Branches (nicht des Spiegels). Ein Server-Block gatet wie ein Required Check,
 * darum gatet `pr-warten` sie mit. Nicht lesbar: keine Werkzeuge, dafür ein `HINWEIS` (kein Absturz).
 */
export function holeWerkzeuge(pr, gh = ghText) {
  try {
    const base = JSON.parse(gh(["pr", "view", pr, "--json", "baseRefName"], { timeout: 30_000 })).baseRefName;
    const regeln = JSON.parse(gh(["api", `repos/{owner}/{repo}/rules/branches/${base}?per_page=100`], { timeout: 30_000 }));
    return { werkzeuge: codeScanningWerkzeuge(regeln), hinweis: null };
  } catch (err) {
    return { werkzeuge: [], hinweis: `HINWEIS Ruleset-Regeln nicht lesbar: ${String(err?.message ?? err).split("\n")[0].slice(0, 120)}` };
  }
}

/**
 * Ein Wartelauf für PR `a.pr`: Werkzeuge der Ruleset-Regel `code_scanning` einmal lesen, dann warten (Pflicht-Checks plus diese Werkzeuge gaten), Hinweiszeile anhängen.
 * `gh` (Aufrufe von `gh pr view/checks`, `gh api`), `schlafe` und `jetzt` sind die Test-Nähte; Standard ist echtes `gh` und Wanduhr. Rückgabe `{ exit, zeilen }`.
 */
export function lauf(a, { gh = ghText, schlafe = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), jetzt = () => Date.now() } = {}) {
  const w = holeWerkzeuge(a.pr, gh); // einmal je Lauf
  return mitHinweis(warten({
    hole: () => JSON.parse(gh(["pr", "view", a.pr, "--json", FELDER], { timeout: 30_000 })),
    pflicht: () => pflichtListe(holePflicht(a.pr, gh), w.werkzeuge),
    schlafe,
    jetzt,
    maxMs: a.maxSekunden * 1000,
    intervallMs: a.intervall * 1000,
  }), w.hinweis);
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.fehler || !a.pr || !(a.maxSekunden > 0) || !(a.intervall > 0)) {
    console.error(`${a.fehler ? `${a.fehler}\n` : ""}Aufruf: node scripts/pr-warten.mjs <pr> [--max-sekunden 240] [--intervall 30]`);
    process.exit(3);
  }
  const r = lauf(a);
  console.log(r.zeilen.join("\n"));
  process.exit(r.exit);
}

if (istDirektaufruf(import.meta.url)) main();
