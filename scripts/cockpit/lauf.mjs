// Kein Shebang: Lib. Die einzige Prüfstelle für „nur lesend“ (ADR 0029 (d)): das Cockpit startet Unterprozesse nur aus dieser Allowlist,
// ohne Shell. Ein neuer Unterprozess ist eine Zeile hier plus die Quelle, die ihn nutzt.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BEFEHLE = {
  "langfuse-vorbedingung": [process.execPath, fileURLToPath(new URL("../langfuse-vorbedingung.mjs", import.meta.url)), "--json"],
};

/** Lesbarer Grund eines Prozessfehlers: Fehlercode, sonst das Abbruch-Signal (dann ist `code` null), sonst die Meldung. Pur. */
export const fehlerText = (err) => String(err.code ?? err.signal ?? err.message);

/** Ergebnis aus dem execFile-Callback: `code` null bei Spawn-Fehler oder Abbruch, dann `fehler` = lesbarer Grund. Pur. */
export function ergebnisAus(err, stdout, stderr) {
  const code = err ? (typeof err.code === "number" ? err.code : null) : 0;
  return { code, stdout: String(stdout), stderr: String(stderr), fehler: err && code === null ? fehlerText(err) : null };
}

/** Führt einen Befehl der Allowlist aus; Ergebnis `{ code, stdout, stderr, fehler }` (`code` null bei Spawn-Fehler oder Abbruch). Wirft nur bei unbekannter id. */
export function laufe(id, { cwd, signal, env = process.env } = {}) {
  if (!Object.hasOwn(BEFEHLE, id)) throw new Error(`Befehl nicht in der Allowlist: ${id}`);
  const [datei, ...args] = BEFEHLE[id];
  return new Promise((resolve) => {
    execFile(datei, args, { cwd, signal, env, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => resolve(ergebnisAus(err, stdout, stderr)));
  });
}
