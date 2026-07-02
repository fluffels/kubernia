/* ===== Inhalte: Übungs-Pools je NPC (Content-as-Data, #521) =====
 * WELCHE Drills ein NPC nach WELCHER Quest zum freien Üben anbietet — reine
 * Daten (`../data/practice.json`), nicht länger ein TS-Objekt-Literal in
 * `drills.ts`. Die DRILLS selbst bleiben zu Recht Code (Funktionen, die eine
 * Zufallsaufgabe bauen); nur dieses Freischalt-Mapping war Content-im-Code.
 *
 * **Datenform (gruppiert):** In der JSON steht `npc → questId → [drillIds]`, also
 * die Folge-Quest EINMAL als Schlüssel statt (wie früher) je Drill wiederholt
 * (`docker-common-images` stand allein bei Bo dreimal). Der Loader expandiert das
 * beim Laden in die vertraute Laufzeitform `{ drill, after }[]` je NPC – so bleiben
 * die Konsumenten (`game/progression.ts`, `content/validate.ts`) unverändert.
 *
 * **Nur STRUKTUR wird hier geprüft** (Objektform, nicht-leere Drill-Listen, keine
 * doppelten Drills je NPC). Die REFERENZIELLE Integrität (NPC/Drill/Quest existieren
 * wirklich) prüft weiterhin `validateContent` (`content/validate.ts`) – der Loader
 * kennt weder die NPC- noch die Drill- noch die Quest-Liste (Leaf, keine Zyklen).
 *
 * Einzelne JSON-Datei ohne Aufteilung (wie npcs.json/smalltalk.json) – kein
 * Glob-Loader-Quartett; beim Modul-Laden einmal validiert und als Konstante gehalten.
 */
import practiceData from "../data/practice.json";
import { asRecord, asNonEmptyString, asNonEmptyStringArray, fail } from "../parse";

/** Ein freischaltbarer Übungs-Drill: `drill` kommt in den freien-Übungs-Pool,
 *  sobald die Quest `after` abgeschlossen ist. */
export interface PracticeEntry {
  drill: string;
  after: string;
}

/** Validiert die gruppierten Roh-Daten (`npc → questId → [drillIds]`) und expandiert
 *  sie in die Laufzeitform `npc → { drill, after }[]`. Wirft `ContentValidationError`
 *  beim ersten Verstoß (nie still durchwinken). */
export function parsePractice(raw: unknown): Record<string, PracticeEntry[]> {
  const byNpc = asRecord(raw, "practice");
  const out: Record<string, PracticeEntry[]> = {};
  for (const npcId of Object.keys(byNpc)) {
    const groups = asRecord(byNpc[npcId], `practice.${npcId}`);
    const questIds = Object.keys(groups);
    if (questIds.length === 0) fail(`practice.${npcId}`, "mindestens eine Folge-Quest erwartet");
    const pool: PracticeEntry[] = [];
    const seenDrills = new Set<string>();
    for (const after of questIds) {
      // JSON erlaubt einen leeren Objekt-Schlüssel (`{"": …}`) – defensiv abfangen.
      asNonEmptyString(after, `practice.${npcId} (Quest-Schlüssel)`);
      const drills = asNonEmptyStringArray(groups[after], `practice.${npcId}.${after}`);
      for (const drill of drills) {
        if (seenDrills.has(drill)) fail(`practice.${npcId}`, `doppelter Drill „${drill}"`);
        seenDrills.add(drill);
        pool.push({ drill, after });
      }
    }
    out[npcId] = pool;
  }
  return out;
}

/** Validierte Übungs-Pools je NPC – Quelle: `../data/practice.json`. */
export const PRACTICE: Record<string, PracticeEntry[]> = parsePractice(practiceData);
