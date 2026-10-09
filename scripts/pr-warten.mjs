// Kein Shebang: wird per `node scripts/pr-warten.mjs <pr>` gestartet UND von test/pr-warten.test.ts importiert.
/**
 * Auf die CI eines PR warten, ohne den Kontext zu fluten und ohne den Prompt-Cache ablaufen zu lassen (#1559).
 *
 *   node scripts/pr-warten.mjs <pr> [--max-sekunden 240] [--intervall 30]
 *
 * Ein Aufruf pollt höchstens `--max-sekunden` (Standard 240, unter der 5-Minuten-Cache-TTL der Subagenten: eine längere
 * Pause baut den ganzen Kontext neu auf, docs/model-routing.md § Umsetzer-Kontext) und gibt EINE kompakte Zeile aus:
 *   Exit 0  `MERGED <sha>`
 *   Exit 1  `ROT <check> <url>` je rotem Check (Log nur bei Bedarf: `gh run view <id> --log-failed | tail -n 80`)
 *   Exit 2  `OFFEN x/y grün, wartend: …` nach Ablauf des Zeitbudgets: erneut aufrufen
 *   Exit 3  `KONFLIKT` | `GESCHLOSSEN` | `GRÜN OHNE AUTO-MERGE` | `GH-FEHLER …` (braucht Handeln)
 * Läuft das Zeitbudget nach gh-Fehlern ab, steht die letzte `GH-FEHLER`-Zeile mit Exit 2 da; erst drei Fehler in Folge sind Exit 3.
 * `statusCheckRollup` liefert `gh` mit der Standardgrenze (rund 100 Einträge); die CI hat deutlich weniger Checks.
 * Der Kern `bewerte` ist pur; CLI und `ghJson`-Aufruf sind dünne, ungetestete IO.
 */
import { pathToFileURL } from "node:url";
import { ghJson } from "./gh-cli.mjs";

const ROT = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const GRUEN = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
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

/** `gh pr view --json ${FELDER}` → `{ exit, zeilen }`. Exit 2 heißt: noch offen, weiter warten. */
export function bewerte(pr) {
  if (pr?.state === "MERGED") return { exit: 0, zeilen: [`MERGED ${String(pr.mergeCommit?.oid ?? "").slice(0, 7)}`.trim()] };
  if (pr?.state === "CLOSED") return { exit: 3, zeilen: ["GESCHLOSSEN"] };
  if (pr?.mergeable === "CONFLICTING") return { exit: 3, zeilen: ["KONFLIKT"] };
  const checks = (pr?.statusCheckRollup ?? []).map(eintrag);
  const rot = checks.filter((c) => c.art === "rot");
  if (rot.length) return { exit: 1, zeilen: rot.map((c) => `ROT ${c.name} ${c.url}`.trim()) };
  const gruen = checks.filter((c) => c.art === "gruen").length;
  const offen = checks.filter((c) => c.art === "offen");
  // Ein leerer Rollup ist nicht grün: die Checks sind noch nicht gestartet.
  if (!offen.length && checks.length) {
    return pr?.autoMergeRequest ? { exit: 2, zeilen: [`OFFEN ${gruen}/${checks.length} grün, Merge steht aus`] } : { exit: 3, zeilen: ["GRÜN OHNE AUTO-MERGE"] };
  }
  return { exit: 2, zeilen: [`OFFEN ${gruen}/${checks.length} grün, wartend: ${offen.map((c) => c.name).join(", ") || "Checks starten"}`] };
}

/**
 * Pollt `hole()` bis ein Ergebnis ≠ Exit 2 kommt oder das Zeitbudget abläuft. Drei gh-Fehler in Folge → Exit 3.
 * @param {{ hole: () => object, schlafe: (ms: number) => void, jetzt: () => number, maxMs: number, intervallMs: number }} e
 */
export function warten({ hole, schlafe, jetzt, maxMs, intervallMs }) {
  const ende = jetzt() + maxMs;
  let fehler = 0;
  let letzte;
  for (;;) {
    try {
      letzte = bewerte(hole());
      fehler = 0;
    } catch (err) {
      fehler += 1;
      letzte = { exit: 2, zeilen: [`GH-FEHLER ${String(err?.message ?? err).split("\n")[0].slice(0, 120)}`] };
      if (fehler >= 3) return { exit: 3, zeilen: letzte.zeilen };
    }
    if (letzte.exit !== 2 || jetzt() + intervallMs >= ende) return letzte;
    schlafe(intervallMs);
  }
}

// ── CLI (dünn, ungetestet: gh und Schlaf) ────────────────────────────────────

export function parseArgs(argv) {
  const a = { pr: null, maxSekunden: 240, intervall: 30 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-sekunden") a.maxSekunden = Number(argv[++i]);
    else if (argv[i] === "--intervall") a.intervall = Number(argv[++i]);
    else if (/^\d+$/.test(argv[i])) a.pr = argv[i];
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.pr || !(a.maxSekunden > 0) || !(a.intervall > 0)) {
    console.error("Aufruf: node scripts/pr-warten.mjs <pr> [--max-sekunden 240] [--intervall 30]");
    process.exit(3);
  }
  const r = warten({
    hole: () => ghJson(["pr", "view", a.pr, "--json", FELDER], { timeout: 30_000 }),
    schlafe: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    jetzt: () => Date.now(),
    maxMs: a.maxSekunden * 1000,
    intervallMs: a.intervall * 1000,
  });
  console.log(r.zeilen.join("\n"));
  process.exit(r.exit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
