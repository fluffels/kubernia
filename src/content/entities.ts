/* ===== Entity-Registry: datengesteuerte NPC-Platzierung (Content-as-Data, #349) =====
 * Zweiter Baustein des Skalierungs-Fundaments aus ADR 0004
 * (docs/adr/0004-skalierungs-fundament.md, Abschnitt „Entities sind hard-codiert"):
 * WO ein NPC steht, lebt als **Daten** in `./data/entities.json`, nicht mehr als
 * hartcodiertes Array/Objekt im Code. Damit gilt für jede Karte: ein neuer NPC =
 * ein neuer JSON-Eintrag, KEIN Code-Edit. Genau das skaliert auf Stardew-Größe
 * (50+ NPCs über viele Welten), wo NPC-Standplätze wie im Map-Editor platziert
 * werden – nicht aus Geometrie-Konstanten gerechnet.
 *
 * **Trennung wer ↔ wo:** Die *Identität* eines NPC (Name, Titel, Sprite) steht in
 * `./data/npcs.json` (vom Loader `loader.ts` validiert). Diese Registry hier trägt
 * nur die *Platzierung* (welche Karte, welche Kachel) und referenziert die Identität
 * per `id`. Der Validator unten prüft referenzielle Integrität: jede `id` muss ein
 * bekannter NPC aus npcs.json sein (fängt Tippfehler, bevor ein NPC stumm fehlt).
 *
 * **Bewusste Ausnahme – Kralle:** Die Quiz-Krabbe steht NICHT in dieser Registry.
 * Ihr Standplatz ist schiff-relativ (`SHIP_KRALLE` in world.ts) und wird erst zur
 * Laufzeit relativ zum Deck ergänzt – das ist Schiffs-Geometrie, kein Karten-Standplatz.
 *
 * Phaser-frei und unit-getestet (`test/entities.test.ts`), wie der Quest-/NPC-Loader.
 * Validierung läuft beim Modul-Laden (im Browser wie im Node-Test) und wirft bei
 * kaputten Daten explizit `ContentValidationError` (dieselbe Klasse wie loader.ts).
 */
import { NPCS } from "./loader";
// Die Parse-/Validier-Primitiven kommen aus dem geteilten Leaf `./parse` (#519), statt hier
// erneut nachgebaut zu werden – dieselben Bausteine nutzt auch der Loader. `fail` wirft die
// gemeinsame `ContentValidationError` mit dem Präfix „Content …" (die Pfadangabe unten sagt
// ohnehin `entities.…`, die Herkunft bleibt also erkennbar). `asFiniteNumber`/`asPositiveInt`
// sind registry-spezifisch (Bruch-Koordinaten bzw. Fußabdruck ≥1) und bleiben lokal.
import { fail, asRecord, asArray, asNonEmptyString, assertNoUnknownKeys } from "./parse";
import entitiesData from "./data/entities.json";

/** Ein NPC-Standplatz auf einer Karte (Kachel-Koordinaten). Bewusst hier definiert
 *  (nicht in world.ts), damit world.ts diese Registry importieren kann, ohne einen
 *  Import-Zyklus zu bauen; world.ts re-exportiert `Spawn` für seine Altaufrufer. */
export interface Spawn { id: string; x: number; y: number }

/** Registry-Eintrag = Standplatz + Karte. Die `map`-ID gruppiert NPCs je Szene
 *  (z.B. "harbor", "archipel", "lighthouse", "warehouse"). */
export interface EntityNpc extends Spawn { map: string }

/** Endliche Zahl (Kachel-Koordinaten dürfen Brüche sein, z.B. 14.6 – darum NICHT
 *  asInt). NaN/Infinity werden abgewiesen. Registry-spezifisch → bleibt lokal. */
function asFiniteNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "endliche Zahl erwartet");
  return v;
}

/** Validiert die rohe Registry gegen das Schema und gibt sie typisiert + in
 *  Datei-Reihenfolge zurück. Wirft `ContentValidationError` beim ersten Verstoß
 *  (nie still durchwinken). Die Reihenfolge ist load-bearing: der Hafen baut aus
 *  ihr `NPC_SPAWNS` und serialisiert sie verlustfrei in harbor.tmj. */
export function parseEntities(raw: unknown): EntityNpc[] {
  const obj = asRecord(raw, "entities");
  const list = asArray(obj.npcs, "entities.npcs");
  if (list.length === 0) fail("entities.npcs", "mindestens ein Eintrag erwartet");
  const seen = new Set<string>();
  return list.map((entry, i) => {
    const o = asRecord(entry, `entities.npcs[${i}]`);
    assertNoUnknownKeys(o, `entities.npcs[${i}]`, ["id", "map", "x", "y"]);
    const id = asNonEmptyString(o.id, `entities.npcs[${i}].id`);
    const map = asNonEmptyString(o.map, `entities.npcs[${i}].map`);
    const x = asFiniteNumber(o.x, `entities.npcs[${i}].x`);
    const y = asFiniteNumber(o.y, `entities.npcs[${i}].y`);
    if (!(id in NPCS)) fail(`entities.npcs[${i}].id`, `kein bekannter NPC „${id}" (nicht in npcs.json)`);
    const key = `${map}/${id}`;
    if (seen.has(key)) fail(`entities.npcs[${i}]`, `doppelter Standplatz „${key}"`);
    seen.add(key);
    return { id, map, x, y };
  });
}

/** Validierte Registry – Quelle: `./data/entities.json`. */
export const ENTITY_NPCS: EntityNpc[] = parseEntities(entitiesData);

/** Alle NPC-Standplätze einer Karte, in Datei-Reihenfolge. Leeres Array, wenn die
 *  Karte (noch) keine NPCs hat. Szenen loopen darüber → neuer NPC = nur JSON-Eintrag. */
export function npcSpawnsForMap(map: string): Spawn[] {
  return ENTITY_NPCS.filter((e) => e.map === map).map(({ id, x, y }) => ({ id, x, y }));
}

/** Der primäre (erste) NPC-Standplatz einer Karte. Für Geometrie-Module, deren
 *  Bereich genau einen Standplatz hat (Insel-NPCs). Wirft laut, wenn die Karte
 *  keinen Eintrag hat – so fällt ein Karten-Tippfehler beim Laden sofort auf,
 *  statt dass der NPC stumm verschwindet. */
export function npcSpawnForMap(map: string): Spawn {
  const all = npcSpawnsForMap(map);
  if (all.length === 0) fail(`npcSpawnForMap(${map})`, "keine NPC-Platzierung für diese Karte");
  return all[0];
}

/* ===== Objekte / Interaktables in der Registry (#357, Folge zu #349) =====
 * Zweiter Teil aus dem #349-Umfang, der dort bewusst noch ausstand: Nicht nur WO ein
 * NPC steht ist jetzt ein Daten-Eintrag, sondern auch WO platzierte **Objekte** stehen
 * (Quest-Trigger, Verladekräne, Container, Monitoring-Tafel/-Glocke, Leuchtturm). Vorher
 * waren das Geometrie-Konstanten in den Insel-Modulen (z.B. `WAREHOUSE_CRANES`,
 * `LIGHTHOUSE_TOWER`) – bei Stardew-Scope (viele Welten mit zahlreichen Triggern/Kränen/
 * Schildern) reproduziert das genau das Problem, das #349 für NPCs gelöst hat. Jetzt gilt
 * auch hier: ein neues platziertes Objekt = ein JSON-Eintrag, kein Code-Edit.
 *
 * Trennung wie bei NPCs: diese Registry trägt die **Platzierung** (Karte/Kachel/Typ);
 * das **Render-Tuning** (Sprite-Skalierung, Schattengröße) bleibt Präsentation
 * (`scenes/shared.ts` › `PROP_RENDER`), die **Sim-Mechanik** eines Triggers bleibt Code.
 * Prozedural gestreute Deko (`decor.ts`/`scatterDecor`, Bäume/Felsen/Lager-Güter) ist
 * bewusst KEIN Registry-Objekt – das ist eine eigene, generative Mechanik. */

/** Objekt-Typ – steuert, wie Geometrie & Szene den Eintrag behandeln:
 *  - `quest_trigger`: begehbarer Interaktionspunkt (Schild/Statue); Geometrie hält ihn frei.
 *  - `prop`: solides 1×1-Sprite (Kran/Container/Tafel/Glocke …).
 *  - `tower`: solides Mehr-Kachel-Bauwerk mit eigener Darstellung (Leuchtturm). */
export type EntityObjectType = "quest_trigger" | "prop" | "tower";

/** Ein platziertes Objekt auf einer Karte. `sprite` ist Pflicht für `prop`/`tower`
 *  (Textur-Key) und bei `quest_trigger` verboten; `label` ist Pflicht für `quest_trigger`
 *  (Schild-Text) und sonst verboten. `w`/`h` ist der Kachel-Fußabdruck (Default 1×1,
 *  >1 nur für Bauwerke wie den Turm), verankert an (x,y) als rechte untere Ecke. */
export interface EntityObject {
  id: string; map: string; x: number; y: number;
  type: EntityObjectType;
  sprite?: string;
  label?: string;
  w?: number; h?: number;
}

const OBJECT_TYPES: readonly EntityObjectType[] = ["quest_trigger", "prop", "tower"];

/** Positive ganze Zahl ≥1 (Fußabdruck-Maße). NaN/Brüche/0/negativ werden abgewiesen. */
function asPositiveInt(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) fail(path, "ganze Zahl ≥ 1 erwartet");
  return v;
}

/** Validiert die rohe Objekt-Liste gegen das Schema und gibt sie typisiert + in
 *  Datei-Reihenfolge zurück. `objects` ist **optional** (Karten ohne Objekte sind ok →
 *  leeres Array); ist der Schlüssel da, muss er ein Array sein. Wirft `ContentValidationError`
 *  beim ersten Verstoß (nie still durchwinken). */
export function parseObjects(raw: unknown): EntityObject[] {
  const obj = asRecord(raw, "entities");
  if (obj.objects === undefined) return [];
  const list = asArray(obj.objects, "entities.objects");
  const seen = new Set<string>();
  return list.map((entry, i) => {
    const o = asRecord(entry, `entities.objects[${i}]`);
    assertNoUnknownKeys(o, `entities.objects[${i}]`, ["id", "map", "x", "y", "type", "sprite", "label", "w", "h"]);
    const id = asNonEmptyString(o.id, `entities.objects[${i}].id`);
    const map = asNonEmptyString(o.map, `entities.objects[${i}].map`);
    const x = asFiniteNumber(o.x, `entities.objects[${i}].x`);
    const y = asFiniteNumber(o.y, `entities.objects[${i}].y`);
    const typeStr = asNonEmptyString(o.type, `entities.objects[${i}].type`);
    if (!OBJECT_TYPES.includes(typeStr as EntityObjectType)) {
      fail(`entities.objects[${i}].type`, `unbekannter Typ „${typeStr}" (erlaubt: ${OBJECT_TYPES.join(", ")})`);
    }
    const type = typeStr as EntityObjectType;

    // Typ-abhängige Pflicht-/Verbotsfelder, damit keine toten/widersprüchlichen Daten entstehen.
    let sprite: string | undefined;
    let label: string | undefined;
    if (type === "quest_trigger") {
      label = asNonEmptyString(o.label, `entities.objects[${i}].label`);
      if (o.sprite !== undefined) fail(`entities.objects[${i}].sprite`, "quest_trigger trägt kein sprite");
    } else {
      sprite = asNonEmptyString(o.sprite, `entities.objects[${i}].sprite`);
      if (o.label !== undefined) fail(`entities.objects[${i}].label`, `${type} trägt kein label`);
    }

    const w = o.w === undefined ? 1 : asPositiveInt(o.w, `entities.objects[${i}].w`);
    const h = o.h === undefined ? 1 : asPositiveInt(o.h, `entities.objects[${i}].h`);

    const key = `${map}/${id}`;
    if (seen.has(key)) fail(`entities.objects[${i}]`, `doppeltes Objekt „${key}"`);
    seen.add(key);
    return { id, map, x, y, type, sprite, label, w, h };
  });
}

/** Validierte Objekt-Registry – Quelle: `./data/entities.json`. */
export const ENTITY_OBJECTS: EntityObject[] = parseObjects(entitiesData);

/** Alle Objekte einer Karte, in Datei-Reihenfolge. Leeres Array, wenn die Karte keine
 *  hat. Geometrie & Szenen loopen darüber → neues Objekt = nur JSON-Eintrag. */
export function objectsForMap(map: string): EntityObject[] {
  return ENTITY_OBJECTS.filter((o) => o.map === map);
}

/** Ein benanntes Objekt einer Karte per id. Für Geometrie-Module, die einen bestimmten
 *  Standplatz brauchen (Turm, Quest-Trigger). Wirft laut bei Tippfehler/Fehlen – so fällt
 *  ein falscher id/map-Bezug beim Laden sofort auf, statt dass das Objekt stumm verschwindet. */
export function objectForId(map: string, id: string): EntityObject {
  const hit = ENTITY_OBJECTS.find((o) => o.map === map && o.id === id);
  if (!hit) fail(`objectForId(${map}, ${id})`, "kein Objekt mit dieser id auf dieser Karte");
  return hit;
}

/** Die vom Objekt belegten Kacheln (Fußabdruck). Der Anker (x,y) ist die rechte untere
 *  Ecke; ein w×h-Bauwerk erstreckt sich nach links/oben (so wie der 2×2-Leuchtturm-Fuß
 *  schon vorher modelliert war). Für Default-1×1-Objekte genau die Ankerkachel. */
export function objectFootprint(o: EntityObject): { x: number; y: number }[] {
  const w = o.w ?? 1, h = o.h ?? 1;
  const tiles: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) tiles.push({ x: o.x - dx, y: o.y - dy });
  return tiles;
}
