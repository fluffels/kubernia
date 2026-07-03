/* Aktualisiert das Quiz-Korrektheits-Golden-File (#597) aus dem Live-Content.
 *
 * Setzt KQ_UPDATE_QUIZ_GOLDEN=1 (cross-platform) und lässt test/quizcheck.test.ts das
 * File neu schreiben – aus DEMSELBEN Content + derselben Normalisierung, gegen die der
 * Wächter sonst prüft (eine Quelle, kein Duplikat der Normalisierung hier). Nach einem
 * bewussten Review der geänderten korrekten Antwort ausführen: `npm run quiz:golden`.
 */
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["vitest", "run", "test/quizcheck.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, KQ_UPDATE_QUIZ_GOLDEN: "1" },
});
process.exit(r.status ?? 1);
