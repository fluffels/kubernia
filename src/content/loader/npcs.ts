/* ===== Inhalte: NPC-Stammdaten + Smalltalk (Content-as-Data, #348) =====
 * Die NPC-*Identität* (Name/Titel/Sprite/Textur-Key) + die Standard-Dialoge je NPC.
 * WO ein NPC steht, ist seit #349 eigene Daten in `./data/entities.json`
 * (Entity-Registry, `entities.ts`), das die `id` aus npcs.json referenziert — diese
 * Schlüssel müssen hier bleiben, sonst findet die Registry ihren NPC nicht.
 *
 * Anders als die Glob-Sammlungen (Quests/Karten/…) sind das zwei einzelne JSON-Dateien
 * ohne Datei-Aufteilung und ohne das Loader-Quartett — sie werden hier beim Modul-Laden
 * einmal validiert und als Konstante gehalten.
 */
import npcsData from "../data/npcs.json";
import smalltalkData from "../data/smalltalk.json";
import { fail, asRecord, asNonEmptyString, asInt, asNonEmptyStringArray, assertNoUnknownKeys } from "../parse";

/** NPC-Stammdaten: Anzeigename, Funktions-Titel, Spritesheet-Frame, Textur-Key. */
export interface NpcMeta {
  name: string;
  title: string;
  sprite: number;
  tex: string;
}

const NPC_KEYS = ["name", "title", "sprite", "tex"] as const;

/** Validiert rohe NPC-Daten gegen das Schema und gibt sie typisiert zurück.
 *  Wirft `ContentValidationError` beim ersten Verstoß (nie still durchwinken). */
export function parseNpcs(raw: unknown): Record<string, NpcMeta> {
  const obj = asRecord(raw, "npcs");
  const ids = Object.keys(obj);
  if (ids.length === 0) fail("npcs", "mindestens ein NPC erwartet");
  const out: Record<string, NpcMeta> = {};
  for (const id of ids) {
    const m = asRecord(obj[id], `npcs.${id}`);
    assertNoUnknownKeys(m, `npcs.${id}`, NPC_KEYS);
    out[id] = {
      name: asNonEmptyString(m.name, `npcs.${id}.name`),
      title: asNonEmptyString(m.title, `npcs.${id}.title`),
      sprite: asInt(m.sprite, `npcs.${id}.sprite`),
      tex: asNonEmptyString(m.tex, `npcs.${id}.tex`),
    };
  }
  return out;
}

/** Validiert rohe Smalltalk-Daten. Jeder Schlüssel muss ein bekannter NPC sein
 *  (referenzielle Integrität), jede Zeilen-Liste nicht-leer und rein textuell.
 *  Wirft `ContentValidationError` beim ersten Verstoß. */
export function parseSmalltalk(raw: unknown, knownNpcIds: Set<string>): Record<string, string[]> {
  const obj = asRecord(raw, "smalltalk");
  const out: Record<string, string[]> = {};
  for (const id of Object.keys(obj)) {
    if (!knownNpcIds.has(id)) fail(`smalltalk.${id}`, "kein bekannter NPC (nicht in npcs.json)");
    out[id] = asNonEmptyStringArray(obj[id], `smalltalk.${id}`);
  }
  return out;
}

/** Validierte NPC-Stammdaten – Quelle: `./data/npcs.json`. */
export const NPCS: Record<string, NpcMeta> = parseNpcs(npcsData);

/** Validierte Standard-Dialoge je NPC – Quelle: `./data/smalltalk.json`. */
export const SMALLTALK: Record<string, string[]> = parseSmalltalk(smalltalkData, new Set(Object.keys(NPCS)));
