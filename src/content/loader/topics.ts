/* ===== Quest-Themen / Kapitel (Content-as-Data, #327) =====
 * Die Themen-Taxonomie (`../data/quest-topics.json`): eine GEORDNETE Liste von
 * `{ id, label }`. Sie ist die SSOT der gültigen Quest-Themen und zugleich die
 * Anzeigereihenfolge fürs Logbuch-Accordion (#326), angelehnt an den
 * README-Lernpfad. Wie quest-order.json bewusst eigene Daten (nicht aus den
 * Quests abgeleitet): ein Thema kann mehrere, im Lernpfad NICHT zusammenhängende
 * Quests bündeln (z.B. Helm: Grundlagen früh + Umbrella-Chart deutlich später),
 * und ein Geber kann Quests aus mehreren Themen geben.
 *
 * NICHT zu verwechseln mit der Datei-Aufteilung des Quiz (`../data/crabquiz/<thema>.json`):
 * jene „Themen" sind nur eine Ordner-Konvention (auch ohne Quest/Geber gültig, z.B. RBAC),
 * hier ist es die VALIDIERTE Pro-Quest-Registry für die Logbuch-Gruppierung. */
import questTopicsData from "../data/quest-topics.json";
import { fail, asArray, asNonEmptyString, asRecord, assertNoUnknownKeys, memo } from "../parse";
import type { Quest } from "../../types";

/** Ein Quest-Thema: stabile ID (kebab-case) + Anzeige-Label. */
export interface QuestTopic {
  id: string;
  label: string;
}

/** Validiert die rohe Themen-Taxonomie gegen das Schema und gibt sie geordnet
 *  zurück. Wirft `ContentValidationError` bei leerer Liste, kaputtem Eintrag
 *  oder doppelter ID (eine Dublette ließe zwei Themen kollidieren). */
export function parseQuestTopics(raw: unknown, where = "quest-topics"): QuestTopic[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens ein Thema erwartet");
  const seen = new Set<string>();
  return arr.map((t, i) => {
    const o = asRecord(t, `${where}[${i}]`);
    assertNoUnknownKeys(o, `${where}[${i}]`, ["id", "label"]);
    const id = asNonEmptyString(o.id, `${where}[${i}].id`);
    if (seen.has(id)) fail(`${where}[${i}].id`, `doppelte Themen-ID „${id}"`);
    seen.add(id);
    return { id, label: asNonEmptyString(o.label, `${where}[${i}].label`) };
  });
}

/** Validierte Themen-Taxonomie (geordnet) – Quelle: `../data/quest-topics.json`.
 *  Lazy (#435): erst beim ersten Zugriff geparst (Logbuch-Accordion #326), dann gecacht. */
export const getQuestTopics = memo<QuestTopic[]>(() => parseQuestTopics(questTopicsData));

/** Eine Themen-Gruppe: das Thema + die ihm zugeordneten Quests (in Spielreihenfolge). */
export interface TopicGroup {
  id: string;
  label: string;
  quests: Quest[];
}

/** Gruppiert Quests nach Thema – Themen in Taxonomie-Reihenfolge, Quests INNERHALB
 *  eines Themas in der übergebenen Reihenfolge (i.d.R. quest-order). Pure Funktion
 *  (kein Spielzustand), Grundlage fürs Logbuch-Accordion (#326). Leere Themen
 *  bleiben als Gruppe ohne Quests erhalten – dass kein Thema leer ist, sichert der
 *  „kein totes Thema"-Check in validateContent (content/validate.ts) ab. */
export function groupQuestsByTopic(quests: Quest[], topics: QuestTopic[]): TopicGroup[] {
  return topics.map(t => ({
    id: t.id,
    label: t.label,
    quests: quests.filter(q => q.topic === t.id),
  }));
}
