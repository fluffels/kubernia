/**
 * Test-Setup (vite.config.ts › test.setupFiles, #1428 Z1): Temp-Git-Repos in Tests lösen unter `core.autocrlf=true`
 * (Windows-Standard) bei jedem `git add` die Warnung „LF will be replaced by CRLF“ aus. `core.safecrlf=false` stellt
 * sie ab, ohne die Zeilenenden-Behandlung zu ändern (bewusst nicht `autocrlf=false`). Gesetzt über die
 * Umgebungsvariablen `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, damit es für jeden Kindprozess gilt und keine globale
 * Git-Config verändert wird.
 */

/** Hängt `core.safecrlf=false` an eine Umgebung an; ein schon gesetzter Zähler wird respektiert (n = alter Zähler). */
export function mitSafecrlfAus(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const roh = env.GIT_CONFIG_COUNT;
  const n = roh !== undefined && /^\d+$/.test(roh) ? Number(roh) : 0;
  return {
    ...env,
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: "core.safecrlf",
    [`GIT_CONFIG_VALUE_${n}`]: "false",
  };
}

// Nur einmal je Prozess anwenden (das Setup läuft je Testdatei, die Worker können Prozesse teilen).
if (process.env.KQ_GIT_SAFECRLF !== "1") {
  Object.assign(process.env, mitSafecrlfAus(process.env), { KQ_GIT_SAFECRLF: "1" });
}
