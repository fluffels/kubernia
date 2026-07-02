/* Schema-Drift-Wächter: JSON ↔ TS-Typen (#498).
 *
 * Der Content wird als `unknown` aus JSON geladen (loader.ts) – der Compiler sieht die
 * ~13k Zeilen JSON nie. Die EINZIGE Kopplung Form↔Typ sind die handgeschriebenen `revive*`-
 * Funktionen; ändert jemand einen Typ, zwang bis #498 NICHTS die JSON/Reviver nachzuziehen,
 * und ein JSON-Schlüssel, den kein Reviver liest (Tippfehler, veraltetes/neues Feld), wurde
 * still verworfen. Seit #498 sind alle Content-Reviver GESCHLOSSEN (assertNoUnknownKeys):
 * ein unbekannter Schlüssel scheitert hart beim Laden – wie `reviveScenario` (#494) es schon
 * für das fehleranfälligste Feld tat.
 *
 * Dieser Test ist die Fitness-Function dazu (Vorbild test/docmap.test.ts):
 *  1. der ECHTE Content lädt sauber → beweist „0 Drift heute" (kein toter/vertippter Schlüssel);
 *  2. je Reviver/QuestStep-Variante beweist ein Negativfall, dass der Wächter wirklich beißt
 *     (Red-Green: ohne die Prüfung bliebe der Zusatz-Schlüssel unbemerkt).
 * Die Type→Allowlist-Kopplung für `Scenario`/`ApplyEffect` ist zusätzlich AN DEN COMPILER
 * gebunden (scenario.ts: `Record<keyof Scenario,…>`), die Schritt-Typen an `QuestStep["type"]`
 * (loader.ts: `STEP_TYPE_KEYS`) – ein neues Typ-Feld bricht dort den Build.
 * Ausführen mit:  npm test
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  parseQuests,
  parseCmdCards,
  parseQuizCards,
  parseTfConfigs,
  parseFunkExplains,
  parseNpcs,
  parseQuestTopics,
  getQuests,
  getCmdCards,
  getQuizCards,
  getTfConfigs,
  getFunkExplains,
  getQuestTopics,
  NPCS,
  SMALLTALK,
} from "../src/content/loader";
import { parseEntities, parseObjects, ENTITY_NPCS, ENTITY_OBJECTS } from "../src/content/entities";
import { ContentValidationError } from "../src/content/parse";

/* ---------- 1. Der echte Content lädt sauber: 0 Drift heute ---------- */

test("Schema-Drift: der GESAMTE echte Content lädt ohne unbekannte Schlüssel", () => {
  // Jede Sammlung fährt ihre geschlossenen Reviver über die echten data/*.json-Dateien.
  // Ein toter/vertippter Schlüssel in irgendeiner Datei ließe genau das hier scheitern.
  assert.doesNotThrow(() => {
    getQuests();
    getCmdCards();
    getQuizCards();
    getTfConfigs();
    getFunkExplains();
    getQuestTopics();
    // NPCS/SMALLTALK/Entities werden schon beim Modul-Import geparst – hier nur referenziert,
    // damit der Test bei einem künftigen Lazy-Umbau nicht still leerläuft.
    assert.ok(Object.keys(NPCS).length > 0);
    assert.ok(Object.keys(SMALLTALK).length > 0);
    assert.ok(ENTITY_NPCS.length > 0);
    assert.ok(ENTITY_OBJECTS.length > 0);
  });
});

/* ---------- 2. Red-Green: der Wächter beißt je Reviver ---------- */

/** Erwartet, dass `fn` mit einer ContentValidationError scheitert, deren Meldung den
 *  eingeschmuggelten Schlüssel nennt (beweist: es ist der Drift-Wächter, nicht eine
 *  andere Validierung, die feuert). */
function rejectsKey(fn: () => unknown, key: string): void {
  assert.throws(
    fn,
    (e: unknown) => e instanceof ContentValidationError && new RegExp(key).test((e as Error).message),
  );
}

const validQuest = () => ({
  id: "q", title: "T", giver: "ole", topic: "docker", rewardXp: 1, rewardCoins: 1,
  steps: [{ type: "dialog", npc: "ole", lines: ["hallo"] }],
});

test("Schema-Drift: gültige Minimal-Quest passt (Happy-Path-Basis der Negativfälle)", () => {
  assert.doesNotThrow(() => parseQuests([validQuest()]));
});

test("Schema-Drift: unbekannter Schlüssel auf Quest-Ebene scheitert", () => {
  rejectsKey(() => parseQuests([{ ...validQuest(), bogus: 1 }]), "bogus");
});

/* Jede QuestStep-Variante: ein gültiger Schritt + ein Fremd-Schlüssel muss scheitern. */
const STEP_FIXTURES: Record<string, Record<string, unknown>> = {
  dialog: { type: "dialog", npc: "ole", lines: ["x"] },
  choice: { type: "choice", npc: "ole", q: "?", options: [{ t: "a", ok: true, reply: "r" }] },
  teach: { type: "teach", brief: "b", cmd: { id: "c", text: "t", accept: ["^x$"], solution: "x", hint: "h", intro: "i" } },
  drill: { type: "drill", brief: "b", pool: ["p"], count: 1, intro: "i" },
  terminal: { type: "terminal", brief: "b", tasks: [{ id: "c", text: "t", accept: ["^x$"], solution: "x", hint: "h" }] },
  minigame: { type: "minigame", npc: "ole", game: "stack", brief: "b" },
};

for (const [type, step] of Object.entries(STEP_FIXTURES)) {
  test(`Schema-Drift: gültiger ${type}-Schritt passt`, () => {
    assert.doesNotThrow(() => parseQuests([{ ...validQuest(), steps: [step] }]));
  });
  test(`Schema-Drift: unbekannter Schlüssel im ${type}-Schritt scheitert`, () => {
    rejectsKey(() => parseQuests([{ ...validQuest(), steps: [{ ...step, bogus: 1 }] }]), "bogus");
  });
}

test("Schema-Drift: unbekannter Schlüssel in einer Antwortoption (choice) scheitert", () => {
  const step = { type: "choice", npc: "ole", q: "?", options: [{ t: "a", ok: true, reply: "r", bogus: 1 }] };
  rejectsKey(() => parseQuests([{ ...validQuest(), steps: [step] }]), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel in einer Terminal-Aufgabe scheitert", () => {
  const step = { type: "terminal", brief: "b", tasks: [{ id: "c", text: "t", accept: ["^x$"], solution: "x", hint: "h", bogus: 1 }] };
  rejectsKey(() => parseQuests([{ ...validQuest(), steps: [step] }]), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel im Teach-Befehl (cmd) scheitert", () => {
  const step = { type: "teach", brief: "b", cmd: { id: "c", text: "t", accept: ["^x$"], solution: "x", hint: "h", intro: "i", bogus: 1 } };
  rejectsKey(() => parseQuests([{ ...validQuest(), steps: [step] }]), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel in einer Befehls-Karte scheitert", () => {
  const valid = { id: "c", chapter: "q", q: "?", accept: ["^x$"], solution: "x", explain: "e" };
  assert.doesNotThrow(() => parseCmdCards([valid]));
  rejectsKey(() => parseCmdCards([{ ...valid, bogus: 1 }]), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel in einer Quiz-Karte scheitert", () => {
  const valid = { id: "z", chapter: "q", q: "?", options: ["a", "b"], correct: 0, explain: "e" };
  assert.doesNotThrow(() => parseQuizCards([valid]));
  rejectsKey(() => parseQuizCards([{ ...valid, bogus: 1 }]), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel in einer Terraform-Konfig scheitert", () => {
  const valid = { id: "t", label: "L", scenario: { files: { "a.tf": "x" } } };
  assert.doesNotThrow(() => parseTfConfigs([valid]));
  rejectsKey(() => parseTfConfigs([{ ...valid, bogus: 1 }]), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel in einer Funk-Erklärung scheitert", () => {
  const valid = { id: "f", match: ["^x$"], text: "t" };
  assert.doesNotThrow(() => parseFunkExplains([valid]));
  rejectsKey(() => parseFunkExplains([{ ...valid, bogus: 1 }]), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel in NPC-Stammdaten scheitert", () => {
  const valid = { n: { name: "N", title: "T", sprite: 0, tex: "t" } };
  assert.doesNotThrow(() => parseNpcs(valid));
  rejectsKey(() => parseNpcs({ n: { ...valid.n, bogus: 1 } }), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel in einem Quest-Thema scheitert", () => {
  assert.doesNotThrow(() => parseQuestTopics([{ id: "docker", label: "L" }]));
  rejectsKey(() => parseQuestTopics([{ id: "docker", label: "L", bogus: 1 }]), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel in einem Entity-NPC scheitert", () => {
  const realId = Object.keys(NPCS)[0]; // ein echter NPC – sonst griffe die Existenz-Prüfung zuerst
  const valid = { npcs: [{ id: realId, map: "harbor", x: 1, y: 1 }] };
  assert.doesNotThrow(() => parseEntities(valid));
  rejectsKey(() => parseEntities({ npcs: [{ id: realId, map: "harbor", x: 1, y: 1, bogus: 1 }] }), "bogus");
});

test("Schema-Drift: unbekannter Schlüssel in einem Entity-Objekt scheitert", () => {
  const valid = { objects: [{ id: "o", map: "harbor", x: 1, y: 1, type: "prop", sprite: "s" }] };
  assert.doesNotThrow(() => parseObjects(valid));
  rejectsKey(() => parseObjects({ objects: [{ id: "o", map: "harbor", x: 1, y: 1, type: "prop", sprite: "s", bogus: 1 }] }), "bogus");
});
