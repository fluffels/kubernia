// Einstieg für Agenten (factory#213): `node scripts/langfuse-auftrag.mjs <session-id>` legt einen Nachliefer-Auftrag ab, ohne Key und ohne Netz.
// Importiert nur `direktaufruf.mjs` und die Lib `langfuse-auftrag-lib.mjs` (beide nur Node-Builtins): `test/harness/langfuse-auftrag.test.ts` hält die Import-Hülle fest,
// der Prozess kann `langfuse-zugang.mjs` also gar nicht laden. Einordnung: docs/langfuse-hook-patch.md (Fabrik) › Fehlende Sessions, Absatz „Nachliefern auslösen ohne Key“.
import { homedir } from "node:os";
import { join } from "node:path";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { auftragAufruf } from "./langfuse-auftrag-lib.mjs";

if (istDirektaufruf(import.meta.url)) {
  const { exitCode, text } = auftragAufruf(process.argv.slice(2), join(homedir(), ".claude", "state"));
  (exitCode === 0 ? console.log : console.error)(text);
  process.exitCode = exitCode;
}
