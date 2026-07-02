/* Tests für die Entity-Registry (#349): datengesteuerte NPC-Platzierung als JSON.
 * Prüft die geladenen ECHTEN Daten (Vollständigkeit, referenzielle Integrität, exakte
 * Standplätze, Verdrahtung der Szenen/Geometrie) UND das Schema-Verhalten von
 * parseEntities bei KAPUTTEN Eingaben – die Validierung muss explizit werfen, nie
 * still durchwinken (Red-Green: ein gültiger Datensatz wird ausdrücklich akzeptiert).
 * Ausführen mit:  npm test
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  ENTITY_NPCS,
  ENTITY_OBJECTS,
  parseEntities,
  parseObjects,
  npcSpawnsForMap,
  npcSpawnForMap,
  objectsForMap,
  objectForId,
  objectFootprint,
} from "../src/content/entities";
import { NPCS, ContentValidationError } from "../src/content/loader";
import { NPC_SPAWNS } from "../src/world/world";
import { ARCHIPEL_NPC, ARCHIPEL_QUEST_TRIGGER } from "../src/world/regions/archipel";
import { LIGHTHOUSE_NPC, LIGHTHOUSE_QUEST_TRIGGER, LIGHTHOUSE_TOWER, LIGHTHOUSE_GRAFANA, LIGHTHOUSE_BELL } from "../src/world/regions/lighthouse";
import { WAREHOUSE_NPC, WAREHOUSE_QUEST_TRIGGER, WAREHOUSE_CRANES, WAREHOUSE_CONTAINERS } from "../src/world/regions/warehouse";

/* ---------- Echte Daten: vollständig, integer & korrekt platziert ---------- */

test("entities: jeder Eintrag referenziert einen bekannten NPC (referenzielle Integrität)", () => {
  assert.ok(ENTITY_NPCS.length > 0, "Registry ist leer");
  for (const e of ENTITY_NPCS) {
    assert.ok(e.id in NPCS, `Standplatz „${e.id}" auf „${e.map}" zeigt auf keinen NPC in npcs.json`);
    assert.ok(e.map.trim().length > 0, `Standplatz „${e.id}": leere Karte`);
    assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `Standplatz „${e.id}": x/y keine Zahl`);
  }
});

test("entities: jeder NPC (außer der schiff-relativen Kralle) hat genau einen Standplatz", () => {
  // Stardew-Scope-Wächter: ein NPC in npcs.json, der nirgends platziert ist, würde
  // im Spiel stumm fehlen. Kralle ist die bewusste Ausnahme (Standplatz schiff-relativ
  // in world.ts SHIP_KRALLE, erst zur Laufzeit ergänzt – kein Registry-Eintrag).
  for (const id of Object.keys(NPCS)) {
    if (id === "kralle") {
      assert.equal(ENTITY_NPCS.filter((e) => e.id === id).length, 0, "Kralle darf NICHT in der Registry stehen");
      continue;
    }
    assert.equal(
      ENTITY_NPCS.filter((e) => e.id === id).length,
      1,
      `NPC „${id}" muss genau einen Registry-Standplatz haben`,
    );
  }
});

test("entities: Hafen liefert die erwarteten 7 NPCs in load-bearing Reihenfolge", () => {
  // Diese Reihenfolge/Koordinaten serialisiert harbormap.ts verlustfrei in harbor.tmj –
  // ändert sie sich, brechen harbormap-/world-Tests. Bewusst exakt festgenagelt.
  assert.deepEqual(npcSpawnsForMap("harbor"), [
    { id: "ole", x: 26, y: 14.6 },
    { id: "bo", x: 8, y: 25 },
    { id: "ada", x: 40, y: 13.6 },
    { id: "runa", x: 13, y: 13 },
    { id: "theo", x: 44, y: 20.6 },
    { id: "pelle", x: 31, y: 17.2 },
    { id: "juno", x: 45.8, y: 24.2 },
  ]);
});

test("entities: world.NPC_SPAWNS ist genau die Hafen-Registry (abgeleitet, nicht doppelt)", () => {
  assert.deepEqual([...NPC_SPAWNS], npcSpawnsForMap("harbor"));
});

test("entities: Insel-NPCs stehen an ihren reservierten Standplätzen", () => {
  assert.deepEqual(npcSpawnForMap("archipel"), { id: "argo", x: 12, y: 8 });
  assert.deepEqual(npcSpawnForMap("lighthouse"), { id: "lumi", x: 11, y: 9 });
  assert.deepEqual(npcSpawnForMap("warehouse"), { id: "knut", x: 12, y: 8 });
});

test("entities: die Geometrie-Konstanten der Szenen kommen aus der Registry (Verdrahtung)", () => {
  // archipel.ts/lighthouse.ts/warehouse.ts leiten ihre NPC-Konstante aus der Registry ab.
  assert.deepEqual(ARCHIPEL_NPC, npcSpawnForMap("archipel"));
  assert.deepEqual(LIGHTHOUSE_NPC, npcSpawnForMap("lighthouse"));
  assert.deepEqual(WAREHOUSE_NPC, npcSpawnForMap("warehouse"));
});

test("entities: npcSpawnsForMap liefert [] für eine Karte ohne NPCs (kein Wurf)", () => {
  assert.deepEqual(npcSpawnsForMap("gibt-es-nicht"), []);
});

test("entities: npcSpawnForMap wirft laut bei unbekannter Karte (Tippfehler fällt auf)", () => {
  assert.throws(() => npcSpawnForMap("habor"), ContentValidationError);
});

/* ---------- Schema-Verhalten: KAPUTTE Eingaben müssen werfen (Red-Green) ---------- */

const OK = { npcs: [{ id: "ole", map: "harbor", x: 1, y: 2 }] };

test("parseEntities: akzeptiert einen gültigen Datensatz (Gegenprobe gegen False Positives)", () => {
  // Beweist, dass die Negativtests unten NICHT trivial immer werfen: gute Daten gehen durch.
  assert.deepEqual(parseEntities(OK), [{ id: "ole", map: "harbor", x: 1, y: 2 }]);
  // Brüche/0 sind erlaubte Koordinaten (kein asInt!).
  assert.deepEqual(parseEntities({ npcs: [{ id: "ole", map: "harbor", x: 0, y: 14.6 }] }), [
    { id: "ole", map: "harbor", x: 0, y: 14.6 },
  ]);
});

test("parseEntities: wirft bei Nicht-Objekt / fehlendem npcs-Array", () => {
  assert.throws(() => parseEntities(null), ContentValidationError);
  assert.throws(() => parseEntities([]), ContentValidationError);
  assert.throws(() => parseEntities({}), ContentValidationError);
  assert.throws(() => parseEntities({ npcs: {} }), ContentValidationError);
});

test("parseEntities: wirft bei leerem npcs-Array", () => {
  assert.throws(() => parseEntities({ npcs: [] }), ContentValidationError);
});

test("parseEntities: wirft bei fehlender/leerer id oder Karte", () => {
  assert.throws(() => parseEntities({ npcs: [{ map: "harbor", x: 1, y: 2 }] }), ContentValidationError);
  assert.throws(() => parseEntities({ npcs: [{ id: "", map: "harbor", x: 1, y: 2 }] }), ContentValidationError);
  assert.throws(() => parseEntities({ npcs: [{ id: "ole", map: "", x: 1, y: 2 }] }), ContentValidationError);
});

test("parseEntities: wirft bei unbekannter NPC-id (nicht in npcs.json)", () => {
  assert.throws(() => parseEntities({ npcs: [{ id: "niemand", map: "harbor", x: 1, y: 2 }] }), ContentValidationError);
});

test("parseEntities: wirft bei fehlender/ungültiger Koordinate (NaN/Infinity/String)", () => {
  assert.throws(() => parseEntities({ npcs: [{ id: "ole", map: "harbor", y: 2 }] }), ContentValidationError);
  assert.throws(() => parseEntities({ npcs: [{ id: "ole", map: "harbor", x: "1", y: 2 }] }), ContentValidationError);
  assert.throws(() => parseEntities({ npcs: [{ id: "ole", map: "harbor", x: NaN, y: 2 }] }), ContentValidationError);
  assert.throws(() => parseEntities({ npcs: [{ id: "ole", map: "harbor", x: Infinity, y: 2 }] }), ContentValidationError);
});

test("parseEntities: wirft bei doppeltem Standplatz (gleiche Karte + id)", () => {
  assert.throws(
    () => parseEntities({ npcs: [
      { id: "ole", map: "harbor", x: 1, y: 2 },
      { id: "ole", map: "harbor", x: 3, y: 4 },
    ] }),
    ContentValidationError,
  );
  // Gleiche id auf VERSCHIEDENEN Karten ist erlaubt (derselbe NPC kann woanders auftreten).
  assert.doesNotThrow(() => parseEntities({ npcs: [
    { id: "ole", map: "harbor", x: 1, y: 2 },
    { id: "ole", map: "archipel", x: 3, y: 4 },
  ] }));
});

/* ============================================================================
 * Objekt-Registry (#357): platzierte Objekte/Interaktables als Daten.
 * Wie oben: echte Daten (Vollständigkeit, Verdrahtung der Geometrie-Konstanten)
 * UND Schema-Verhalten von parseObjects bei kaputten Eingaben (Red-Green).
 * ========================================================================== */

/* ---------- Echte Daten: vollständig, integer & korrekt verdrahtet ---------- */

test("objects: jeder Eintrag hat valide Felder + typkonforme sprite/label-Belegung", () => {
  assert.ok(ENTITY_OBJECTS.length > 0, "Objekt-Registry ist leer");
  for (const o of ENTITY_OBJECTS) {
    assert.ok(o.id.trim().length > 0 && o.map.trim().length > 0, `Objekt „${o.id}": leere id/map`);
    assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y), `Objekt „${o.id}": x/y keine Zahl`);
    assert.ok(["quest_trigger", "prop", "tower"].includes(o.type), `Objekt „${o.id}": Typ „${o.type}"`);
    if (o.type === "quest_trigger") {
      assert.ok(o.label && o.label.trim().length > 0, `quest_trigger „${o.id}" braucht ein label`);
      assert.equal(o.sprite, undefined, `quest_trigger „${o.id}" darf kein sprite tragen`);
    } else {
      assert.ok(o.sprite && o.sprite.trim().length > 0, `${o.type} „${o.id}" braucht ein sprite`);
      assert.equal(o.label, undefined, `${o.type} „${o.id}" darf kein label tragen`);
    }
  }
});

test("objects: objectsForMap liefert genau die erwarteten Objekte je Insel", () => {
  // Eine Schleife über diese Karten ersetzt die früheren Geometrie-Konstanten je Szene (#357).
  assert.deepEqual(objectsForMap("archipel").map((o) => o.id), ["gitops-altar"]);
  assert.deepEqual(objectsForMap("lighthouse").map((o) => o.id).sort(), ["alarm-glocke", "grafana-tafel", "leuchtturm", "monitoring-station"]);
  assert.deepEqual(objectsForMap("warehouse").map((o) => o.id).sort(),
    ["container-1", "container-2", "container-3", "container-4", "container-5", "kran-ost", "kran-west", "lager-kontor"]);
  // Karte ohne Objekte (Hafen) → leeres Array, kein Wurf.
  assert.deepEqual(objectsForMap("harbor"), []);
  assert.deepEqual(objectsForMap("gibt-es-nicht"), []);
});

test("objects: die Geometrie-Konstanten der Szenen kommen aus der Registry (Verdrahtung)", () => {
  // archipel.ts/lighthouse.ts/warehouse.ts leiten ihre Objekt-Konstanten aus der Registry ab –
  // verschiebt sich ein Standplatz in entities.json, ziehen Konstanten + Reachability-Tests mit.
  assert.deepEqual(ARCHIPEL_QUEST_TRIGGER, objectForId("archipel", "gitops-altar"));
  assert.deepEqual(LIGHTHOUSE_QUEST_TRIGGER, objectForId("lighthouse", "monitoring-station"));
  assert.deepEqual(WAREHOUSE_QUEST_TRIGGER, objectForId("warehouse", "lager-kontor"));
  assert.deepEqual(LIGHTHOUSE_TOWER, objectForId("lighthouse", "leuchtturm"));
  assert.deepEqual(LIGHTHOUSE_GRAFANA, objectForId("lighthouse", "grafana-tafel"));
  assert.deepEqual(LIGHTHOUSE_BELL, objectForId("lighthouse", "alarm-glocke"));
  // Kräne/Container sind alle prop-Objekte ihrer Karte mit passendem Sprite (Reihenfolge egal).
  assert.deepEqual([...WAREHOUSE_CRANES].map((o) => o.id).sort(), ["kran-ost", "kran-west"]);
  assert.deepEqual([...WAREHOUSE_CONTAINERS].map((o) => o.id).sort(),
    ["container-1", "container-2", "container-3", "container-4", "container-5"]);
});

test("objects: der Leuchtturm belegt seinen 2×2-Fußabdruck (links/oben vom Anker)", () => {
  const tower = objectForId("lighthouse", "leuchtturm");   // Anker (13,5), w=h=2
  const fp = objectFootprint(tower).map((t) => `${t.x},${t.y}`).sort();
  assert.deepEqual(fp, ["12,4", "12,5", "13,4", "13,5"]);
  // 1×1-Default-Objekt belegt genau die Ankerkachel.
  assert.deepEqual(objectFootprint(objectForId("lighthouse", "alarm-glocke")), [{ x: 16, y: 10 }]);
});

test("objectForId wirft laut bei unbekannter id/Karte (Tippfehler fällt auf)", () => {
  assert.throws(() => objectForId("lighthouse", "gibt-es-nicht"), ContentValidationError);
  assert.throws(() => objectForId("habor", "lager-kontor"), ContentValidationError);
});

/* ---------- Schema-Verhalten: KAPUTTE Eingaben müssen werfen (Red-Green) ---------- */

const OK_OBJ = { objects: [{ id: "kran", map: "warehouse", x: 1, y: 2, type: "prop", sprite: "crane" }] };

test("parseObjects: akzeptiert gültige Datensätze + Default-Fußabdruck 1×1 (Gegenprobe)", () => {
  // Beweist, dass die Negativtests unten NICHT trivial immer werfen: gute Daten gehen durch.
  assert.deepEqual(parseObjects(OK_OBJ), [{ id: "kran", map: "warehouse", x: 1, y: 2, type: "prop", sprite: "crane", label: undefined, w: 1, h: 1 }]);
  // quest_trigger mit label statt sprite; w/h optional.
  assert.deepEqual(parseObjects({ objects: [{ id: "t", map: "archipel", x: 0, y: 3.5, type: "quest_trigger", label: "Hallo" }] }),
    [{ id: "t", map: "archipel", x: 0, y: 3.5, type: "quest_trigger", sprite: undefined, label: "Hallo", w: 1, h: 1 }]);
  // objects ist OPTIONAL: fehlt der Schlüssel ganz, ist das gültig (leeres Array).
  assert.deepEqual(parseObjects({ npcs: [] }), []);
  assert.deepEqual(parseObjects({ objects: [] }), []);
});

test("parseObjects: wirft bei Nicht-Objekt oder Nicht-Array objects", () => {
  assert.throws(() => parseObjects(null), ContentValidationError);
  assert.throws(() => parseObjects([]), ContentValidationError);
  assert.throws(() => parseObjects({ objects: {} }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: "x" }), ContentValidationError);
});

test("parseObjects: wirft bei fehlender/leerer id, Karte oder Koordinate", () => {
  assert.throws(() => parseObjects({ objects: [{ map: "m", x: 1, y: 2, type: "prop", sprite: "s" }] }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: [{ id: "", map: "m", x: 1, y: 2, type: "prop", sprite: "s" }] }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "", x: 1, y: 2, type: "prop", sprite: "s" }] }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "m", x: NaN, y: 2, type: "prop", sprite: "s" }] }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "m", x: "1", y: 2, type: "prop", sprite: "s" }] }), ContentValidationError);
});

test("parseObjects: wirft bei unbekanntem Typ", () => {
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "m", x: 1, y: 2, type: "haus", sprite: "s" }] }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "m", x: 1, y: 2, type: "", sprite: "s" }] }), ContentValidationError);
});

test("parseObjects: erzwingt typkonforme sprite/label-Belegung (keine toten/widersprüchlichen Felder)", () => {
  // prop/tower BRAUCHEN ein sprite …
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "m", x: 1, y: 2, type: "prop" }] }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "m", x: 1, y: 2, type: "tower" }] }), ContentValidationError);
  // … und dürfen KEIN label tragen.
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "m", x: 1, y: 2, type: "prop", sprite: "s", label: "x" }] }), ContentValidationError);
  // quest_trigger BRAUCHT ein label …
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "m", x: 1, y: 2, type: "quest_trigger" }] }), ContentValidationError);
  // … und darf KEIN sprite tragen.
  assert.throws(() => parseObjects({ objects: [{ id: "a", map: "m", x: 1, y: 2, type: "quest_trigger", label: "x", sprite: "s" }] }), ContentValidationError);
});

test("parseObjects: wirft bei ungültigem Fußabdruck w/h (0, negativ, Bruch, NaN)", () => {
  const base = { id: "a", map: "m", x: 1, y: 2, type: "tower" as const, sprite: "s" };
  assert.throws(() => parseObjects({ objects: [{ ...base, w: 0 }] }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: [{ ...base, w: -2 }] }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: [{ ...base, h: 1.5 }] }), ContentValidationError);
  assert.throws(() => parseObjects({ objects: [{ ...base, h: NaN }] }), ContentValidationError);
  // Gültige Maße ≥1 gehen durch (Gegenprobe).
  assert.doesNotThrow(() => parseObjects({ objects: [{ ...base, w: 2, h: 3 }] }));
});

test("parseObjects: wirft bei doppeltem Objekt (gleiche Karte + id)", () => {
  assert.throws(
    () => parseObjects({ objects: [
      { id: "kran", map: "warehouse", x: 1, y: 2, type: "prop", sprite: "crane" },
      { id: "kran", map: "warehouse", x: 3, y: 4, type: "prop", sprite: "crane" },
    ] }),
    ContentValidationError,
  );
  // Gleiche id auf VERSCHIEDENEN Karten ist erlaubt.
  assert.doesNotThrow(() => parseObjects({ objects: [
    { id: "kran", map: "warehouse", x: 1, y: 2, type: "prop", sprite: "crane" },
    { id: "kran", map: "lighthouse", x: 3, y: 4, type: "prop", sprite: "crane" },
  ] }));
});
