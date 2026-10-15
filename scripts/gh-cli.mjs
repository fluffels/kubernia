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
 * (`["ignore", "pipe", "pipe"]`; `"inherit"` reicht die Ausgabe ans Terminal durch und liefert dann null), `exec` ersetzt den
 * Prozessaufruf (Tests injizieren einen Spy; ein Fake-gh auf dem PATH scheitert unter Windows an `.cmd`-Shims).
 */
export function ghText(args, { token, timeout, stdio = ["ignore", "pipe", "pipe"], exec = execFileSync } = {}) {
  const out = exec("gh", args, {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
    stdio,
    windowsHide: true,
    ...(timeout ? { timeout } : {}),
    ...(token ? { env: { ...process.env, GH_TOKEN: token } } : {}),
  });
  return out ?? "";
}

/**
 * Fehlertext eines geworfenen `gh`-Aufrufs (#1609): erste Zeile von `err.message`, danach der Rest der Meldung und `err.stderr`
 * (bei einem `gh api`-Fehler steht dort der API-Text), getrimmt und auf `max` Zeichen gekürzt. Nimmt auch einen String oder
 * Nicht-Error. Ohne den Rest zeigte der Takt-Lauf vom 2026-10-12 nur `Command failed: gh api …` und nie die Ursache.
 */
export function fehlerText(err, max = 2000) {
  const message = String(err?.message ?? err);
  const stderr = String(err?.stderr ?? "").trim();
  const [erste, ...rest] = message.split("\n");
  const rest2 = rest.join("\n").trim();
  const detail = [rest2, stderr && !rest2.includes(stderr) ? stderr : ""].filter(Boolean).join("\n");
  const gekuerzt = detail.length > max ? `${detail.slice(0, max)}… (gekürzt)` : detail;
  return `${erste}${gekuerzt ? `\n${gekuerzt}` : ""}`;
}

/** Log-Text eines abgebrochenen Takts (#1609): `::error::` (Annotation im Actions-Lauf) + `praefix` + `fehlerText`, danach `zusatz` in einer eigenen Zeile. */
export function fehlerMeldung(err, { praefix = "", zusatz = "", max } = {}) {
  return `::error::${praefix}${fehlerText(err, max)}${zusatz ? `\n${zusatz}` : ""}`;
}

/** Wie `ghText`, die Ausgabe als JSON geparst. */
export const ghJson = (args, opts = {}) => JSON.parse(ghText(args, opts));
