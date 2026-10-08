/** Setup-Datei (vite.config.ts › test.setupFiles, #1428 Z1): wendet `mitSafecrlfAus` (git-umgebung-env.ts) auf die Prozess-Umgebung an. */
import { mitSafecrlfAus } from "./git-umgebung-env";

// Nur einmal je Prozess anwenden (das Setup läuft je Testdatei, die Worker können Prozesse teilen).
if (process.env.KQ_GIT_SAFECRLF !== "1") {
  Object.assign(process.env, mitSafecrlfAus(process.env), { KQ_GIT_SAFECRLF: "1" });
}
