/* ===== Freies-Funken-Erklärungen (Content-as-Data, #362) =====
 * Die kurzen „Was ist gerade passiert?"-Einordnungen, die im freien Funken nach einem
 * Befehl erscheinen (dosiert, vom puren `funkexplain.ts` ausgewählt). Wie die übrigen
 * Sammlungen **pro Tool aufgeteilt** (`../data/funk-explain/<tool>.json`), kein Monolith
 * bei Stardew-Scope. Jede Erklärung trägt `match`-Pattern (Strings → RegExp, befehls-/
 * verb-weit, NICHT arg-genau wie die Drill-Karten) + den In-World-Text. */
import { fail, asRecord, asArray, asNonEmptyString, assertNoUnknownKeys } from "../parse";
import { assembleUnique, makeGlobLoader, reviveAccept } from "./shared";
import type { FunkExplanation } from "../../hud/funkexplain";

// Freies-Funken-Erklärungen (#362) liegen pro Tool in data/funk-explain/<tool>.json.
const funkExplainModules = import.meta.glob<{ default: unknown }>("../data/funk-explain/*.json", { eager: true });

/** Validiert EINE rohe Erklärung und gibt sie in Laufzeit-Form zurück (`match` als RegExp). */
function parseOneFunkExplain(v: unknown, where: string): FunkExplanation {
  const o = asRecord(v, where);
  assertNoUnknownKeys(o, where, ["id", "match", "text"]);
  const id = asNonEmptyString(o.id, `${where}.id`);
  const path = `funk-explain ${id}`;
  return {
    id,
    match: reviveAccept(o.match, `${path}.match`),
    text: asNonEmptyString(o.text, `${path}.text`),
  };
}

/** Validiert eine rohe Erklärungs-Liste (eine Tool-Datei). Wirft beim ersten Verstoß. */
export function parseFunkExplains(raw: unknown, where = "funk-explain"): FunkExplanation[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens eine Erklärung erwartet");
  return arr.map((c, i) => parseOneFunkExplain(c, `${where}[${i}]`));
}

/** Führt die Tool-Listen zusammen und prüft auf doppelte IDs über die Dateien hinweg
 *  (eine Dublette ließe die Sitzungs-„schon gezeigt"-Buchführung kollidieren). */
export function assembleFunkExplains(tools: FunkExplanation[][]): FunkExplanation[] {
  return assembleUnique(tools, "funk-explain", "Erklärungs-ID", "Tool-Dateien");
}

/** Validierte Freies-Funken-Erklärungen – Quelle: `../data/funk-explain/<tool>.json`.
 *  Lazy (#435): erst beim ersten Zugriff (freies Funken) geparst, nach Pfad sortiert
 *  zusammengeführt; dann gecacht. */
export const getFunkExplains = makeGlobLoader(funkExplainModules, parseFunkExplains, assembleFunkExplains);
