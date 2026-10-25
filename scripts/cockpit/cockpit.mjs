// Kein Shebang: wird per `npm run cockpit` gestartet UND von test/cockpit/ importiert.
/* Harness-Cockpit (ADR 0029): lokale, nur lesende Sicht auf die Harness-Quellen.
 *
 *   npm run cockpit [-- --projekt <pfad>] [--port <n>]    Standard: cwd und Port 4180; --port 0 wählt einen freien
 *
 * `main` liefert eine Exit-Zahl (2 Aufruf-Fehler, 1 Startfehler, z.B. belegter Port) oder im Erfolg `schliessen` (der laufende Server). Quellen: registry.mjs; Vertrag: quelle.mjs; Ablauf: docs/agent-harness.md › §2a. */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { AUFRUF_EXIT, flagsLesen } from "../flag-lib.mjs";
import { istDirektaufruf } from "../direktaufruf.mjs";
import { laufe } from "./lauf.mjs";
import { QUELLEN } from "./registry.mjs";
import { starteServer as starteServerStandard } from "./server.mjs";

export const STANDARD_PORT = 4180;

function istVerzeichnis(pfad) {
  try {
    return statSync(pfad).isDirectory();
  } catch {
    return false;
  }
}

/** `{ projekt, port }` oder `{ fehler }` (Text für den Aufruf-Fehler). */
export function leseArgs(argv, cwd) {
  const { werte, fehler } = flagsLesen(argv, { projekt: { type: "string" }, port: { type: "string" } });
  if (fehler) return { fehler: fehler.text };
  const projekt = resolve(cwd, werte.projekt ?? ".");
  if (!istVerzeichnis(projekt)) return { fehler: `--projekt ist kein Verzeichnis: ${projekt}` };
  const roh = werte.port ?? String(STANDARD_PORT);
  if (!/^\d+$/.test(roh) || Number(roh) > 65535) return { fehler: `--port braucht eine ganze Zahl von 0 bis 65535: ${roh}` };
  return { projekt, port: Number(roh) };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd(), { starteServer = starteServerStandard } = {}) {
  const a = leseArgs(argv, cwd);
  if (a.fehler) {
    console.error(`${a.fehler}\nAufruf: npm run cockpit [-- --projekt <pfad>] [--port <n>]`);
    return AUFRUF_EXIT;
  }
  const ctxFuer = (signal) => ({ projekt: a.projekt, lauf: (id) => laufe(id, { cwd: a.projekt, signal }) });
  try {
    const s = await starteServer({ port: a.port, quellen: QUELLEN, projekt: a.projekt, ctxFuer });
    console.log(`Cockpit: http://127.0.0.1:${s.port}/ (Projekt ${a.projekt})`);
    return s.schliessen;
  } catch (e) {
    console.error(`Cockpit startet nicht: ${e?.code === "EADDRINUSE" ? `Port ${a.port} ist belegt` : e?.message}`);
    return 1;
  }
}

if (istDirektaufruf(import.meta.url)) {
  const ergebnis = await main();
  if (typeof ergebnis === "number") process.exitCode = ergebnis;
}
