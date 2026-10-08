// Kein Shebang: Bibliothek für die scripts/-Wächter, importiert nichts aus board-lib (kein Zyklus).
/**
 * Der EINE `gh`-Aufruf der Skripte (#1428 Z32): utf8, großer Puffer, stdin zu, windowsHide. Bis dahin hatte jedes
 * Skript eine eigene Kopie mit abweichenden Grenzen. Neue Skripte importieren `ghText`/`ghJson` von hier; der
 * Wächter `test/harness/gh-cli.test.ts` verbietet einen direkten `execFileSync("gh"` außerhalb dieser Datei.
 */
import { execFileSync } from "node:child_process";

/** Standard-Puffer: Seiten von `gh api --paginate` und Lauflisten sind groß. */
export const GH_MAX_BUFFER = 256 * 1024 * 1024;

/**
 * `gh <args>` ausführen und stdout als Text liefern; wirft bei Fehler.
 * `token` setzt `GH_TOKEN` (Projekt-Scope im Workflow), `timeout` in ms, `stdio` überschreibt den Standard
 * (`["ignore", "pipe", "pipe"]`; `"inherit"` reicht die Ausgabe ans Terminal durch und liefert dann null).
 */
export function ghText(args, { token, timeout, stdio = ["ignore", "pipe", "pipe"] } = {}) {
  const out = execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
    stdio,
    windowsHide: true,
    ...(timeout ? { timeout } : {}),
    ...(token ? { env: { ...process.env, GH_TOKEN: token } } : {}),
  });
  return out ?? "";
}

/** Wie `ghText`, die Ausgabe als JSON geparst. */
export const ghJson = (args, opts = {}) => JSON.parse(ghText(args, opts));
