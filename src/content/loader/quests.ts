/* ===== Quests (Content-as-Data, #348) =====
 * Der komplette Story-/Lerninhalt, **pro Region/Geber aufgeteilt**
 * (`../data/quests/<giver>.json`) plus eine explizite Reihenfolge-Liste
 * (`../data/quest-order.json`). So teilt ein Stardew-großes Spiel Content auf
 * (pro Ort/NPC, kein Monolith): navigierbar, merge-isolation pro Region, bereit für
 * Lazy-Load pro Szene. Der Loader sammelt die Regionen-Dateien und ordnet sie nach
 * quest-order.json (die Reihenfolge ist load-bearing: `questIdx`).
 *
 * Quests sind zu ~90% reine Daten (Dialoge, Choices, Texte, Drill-Referenzen,
 * scenario-Zustände). Die zwei „Code"-Ränder werden sauber überbrückt:
 *  - `accept`-RegExp liegen als **String-Pattern** in der JSON und werden beim Laden
 *    zu `RegExp` kompiliert (`reviveAccept`, geteilt über `./shared`).
 *  - `check`-Prädikate (Sim-Zustand prüfen) sind **Mechanik** und bleiben Code:
 *    benannte Registry in `../checks.ts` (Sonderfälle) bzw. deklarative DSL
 *    (`../check-dsl.ts`); die JSON referenziert sie, der Loader löst auf.
 *  - `(sim) => DrillTask`-Generatoren in `../drills.ts` bleiben Code; Quests
 *    referenzieren Drills nur per ID (`pool`). */
import { QUEST_CHECKS } from "../checks";
import { compileCheck } from "../check-dsl";
import { reviveScenario } from "../scenario";
import { resolveScenarioManifests } from "../manifest-lib";
import questOrder from "../data/quest-order.json";
import {
  fail,
  asRecord,
  asNonEmptyString,
  asInt,
  asNonEmptyStringArray,
  asBool,
  asArray,
  assertNoUnknownKeys,
  memo,
} from "../parse";
import { loadGroups, reviveAccept } from "./shared";
import { resolveScenarioRef } from "./tfconfigs";
import type { Sim } from "../../sim";
import type {
  Quest,
  QuestStep,
  QuestTask,
  TeachCommand,
  ChoiceOption,
  StepBase,
} from "../../types";

// Quests liegen pro Region/Geber in einer eigenen Datei (data/quests/<giver>.json). Vite sammelt
// sie zur Build-Zeit (eager) und bündelt sie in beide Builds. Die load-bearing Reihenfolge
// (questIdx!) steht explizit in quest-order.json – die Datei-/Glob-Reihenfolge zählt NICHT.
const questRegionModules = import.meta.glob<{ default: unknown }>("../data/quests/*.json", { eager: true });

/** Optionalen `check` zur Mechanik-Funktion auflösen (#411).
 *  Zwei Formen:
 *   - **String** → Key in `QUEST_CHECKS` (die wenigen echten Code-Sonderfälle,
 *     z.B. transiente Aktions-Marker wie `sim.lastDeletedPod`).
 *   - **Objekt** → deklarative Check-DSL-Regel (`check-dsl.ts` → `compileCheck`),
 *     die der Regelfall ist: existiert/heil/Anzahl/Flag gegen den Sim-Zustand,
 *     komplett als Daten. Eine neue Standard-Quest braucht so KEINEN Code mehr. */
function reviveCheck(v: unknown, path: string): ((sim: Sim) => unknown) | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") {
    const key = asNonEmptyString(v, path);
    const fn = QUEST_CHECKS[key];
    if (!fn) fail(path, `unbekannter check-Key (nicht in QUEST_CHECKS): ${key}`);
    return fn;
  }
  return compileCheck(v, path);
}

/* Schema-Drift-Wächter (#498): vom Reviver konsumierte JSON-Schlüssel je Objektform (unbekannte scheitern beim Laden; Begründung in parse.ts). */
const TASK_KEYS = ["id", "text", "accept", "solution", "hint", "check"] as const;
const OPTION_KEYS = ["t", "ok", "reply"] as const;
const STEP_BASE_KEYS = ["type", "scenario", "scenarioRef", "unlockAbbrev"] as const;
/** Typ-spezifische Schritt-Felder; `Record<QuestStep["type"],…>` zwingt bei neuem Schritt-Typ eine Zeile (Type→Loader-Kopplung). */
const STEP_TYPE_KEYS: Record<QuestStep["type"], readonly string[]> = {
  dialog: ["npc", "lines"],
  choice: ["npc", "q", "options", "reviewId"],
  teach: ["brief", "cmd"],
  drill: ["brief", "pool", "count", "intro"],
  terminal: ["brief", "tasks"],
  minigame: ["npc", "game", "brief"],
};

/** Gemeinsame Felder von Teach-Befehl und Terminal-Aufgabe (ohne `intro`). `keys` schließt
 *  die erlaubten Schlüssel (Schema-Drift-Wächter #498): Terminal-Aufgabe = TASK_KEYS,
 *  Teach-Befehl = TASK_KEYS + `intro`. */
function reviveTaskCommon(o: Record<string, unknown>, path: string, keys: readonly string[] = TASK_KEYS): QuestTask {
  assertNoUnknownKeys(o, path, keys);
  const task: QuestTask = {
    id: asNonEmptyString(o.id, `${path}.id`),
    text: asNonEmptyString(o.text, `${path}.text`),
    accept: reviveAccept(o.accept, `${path}.accept`),
    solution: asNonEmptyString(o.solution, `${path}.solution`),
    hint: asNonEmptyString(o.hint, `${path}.hint`),
  };
  const check = reviveCheck(o.check, `${path}.check`);
  if (check) task.check = check;
  return task;
}

function reviveTeachCmd(v: unknown, path: string): TeachCommand {
  const o = asRecord(v, path);
  return { ...reviveTaskCommon(o, path, [...TASK_KEYS, "intro"]), intro: asNonEmptyString(o.intro, `${path}.intro`) };
}

function reviveOptions(v: unknown, path: string): ChoiceOption[] {
  const arr = asArray(v, path);
  if (arr.length === 0) fail(path, "nicht-leere Optionsliste erwartet");
  return arr.map((opt, i) => {
    const r = asRecord(opt, `${path}[${i}]`);
    assertNoUnknownKeys(r, `${path}[${i}]`, OPTION_KEYS);
    return {
      t: asNonEmptyString(r.t, `${path}[${i}].t`),
      ok: asBool(r.ok, `${path}[${i}].ok`),
      reply: asNonEmptyString(r.reply, `${path}[${i}].reply`),
    };
  });
}

/** Die an jedem Schritt erlaubten Zusatzfelder (`scenario`/`scenarioRef`, `unlockAbbrev`). */
function reviveStepBase(o: Record<string, unknown>, path: string): StepBase {
  const base: StepBase = {};
  // Ein Schritt bereitet die Welt entweder mit einem INLINE-Szenario (`scenario`) vor
  // oder verweist per `scenarioRef` auf ein benanntes Beispiel-Szenario aus der
  // Terraform-Konfig-Bibliothek (#147) – beides zugleich wäre mehrdeutig.
  if (o.scenario !== undefined && o.scenarioRef !== undefined) {
    fail(`${path}`, "scenario und scenarioRef gleichzeitig gesetzt – nur eines erlaubt");
  }
  if (o.scenarioRef !== undefined) {
    // Referenz wird HIER (beim Laden) zur konkreten `scenario` expandiert – die Laufzeit
    // sieht nur noch das fertige Szenario, genau wie bei einem inline geschriebenen.
    base.scenario = resolveScenarioRef(asNonEmptyString(o.scenarioRef, `${path}.scenarioRef`), `${path}.scenarioRef`);
  } else if (o.scenario !== undefined) {
    // Scenario ist die serialisierbare Sim-Zustandsform (= GameState.clusterSnapshot);
    // strukturell gegen die geschlossene Feld-Allowlist prüfen (#494), die Sim-Semantik
    // prüft der Sim selbst. Ein Tippfehler im Schlüssel scheitert jetzt hart beim Laden.
    // Vorher die `manifests`-Kurzform (manifestRef, #514) zu `files` auflösen.
    base.scenario = reviveScenario(resolveScenarioManifests(o.scenario, `${path}.scenario`), `${path}.scenario`);
  }
  if (o.unlockAbbrev !== undefined) base.unlockAbbrev = asNonEmptyString(o.unlockAbbrev, `${path}.unlockAbbrev`);
  return base;
}

function reviveStep(v: unknown, path: string): QuestStep {
  const o = asRecord(v, path);
  const type = asNonEmptyString(o.type, `${path}.type`);
  const typeKeys = STEP_TYPE_KEYS[type as QuestStep["type"]]; // unbekannter Typ → switch-default
  if (typeKeys) assertNoUnknownKeys(o, path, [...STEP_BASE_KEYS, ...typeKeys]);
  const base = reviveStepBase(o, path);
  switch (type) {
    case "dialog":
      return { ...base, type: "dialog", npc: asNonEmptyString(o.npc, `${path}.npc`), lines: asNonEmptyStringArray(o.lines, `${path}.lines`) };
    case "choice": {
      const step = {
        ...base,
        type: "choice" as const,
        npc: asNonEmptyString(o.npc, `${path}.npc`),
        q: asNonEmptyString(o.q, `${path}.q`),
        options: reviveOptions(o.options, `${path}.options`),
      };
      return o.reviewId !== undefined ? { ...step, reviewId: asNonEmptyString(o.reviewId, `${path}.reviewId`) } : step;
    }
    case "teach":
      return { ...base, type: "teach", brief: asNonEmptyString(o.brief, `${path}.brief`), cmd: reviveTeachCmd(o.cmd, `${path}.cmd`) };
    case "drill":
      return {
        ...base,
        type: "drill",
        brief: asNonEmptyString(o.brief, `${path}.brief`),
        pool: asNonEmptyStringArray(o.pool, `${path}.pool`),
        count: asInt(o.count, `${path}.count`),
        intro: asNonEmptyString(o.intro, `${path}.intro`),
      };
    case "terminal":
      return {
        ...base,
        type: "terminal",
        brief: asNonEmptyString(o.brief, `${path}.brief`),
        tasks: asArray(o.tasks, `${path}.tasks`).map((t, i) => reviveTaskCommon(asRecord(t, `${path}.tasks[${i}]`), `${path}.tasks[${i}]`)),
      };
    case "minigame": {
      const game = asNonEmptyString(o.game, `${path}.game`);
      if (game !== "stack") fail(`${path}.game`, `unbekanntes Minispiel: ${game}`);
      return { ...base, type: "minigame", npc: asNonEmptyString(o.npc, `${path}.npc`), game: "stack", brief: asNonEmptyString(o.brief, `${path}.brief`) };
    }
    default:
      return fail(`${path}.type`, `unbekannter Schritt-Typ: ${type}`);
  }
}

/** Validiert EINE rohe Quest und gibt sie in Laufzeit-Form zurück
 *  (`accept` als RegExp, `check` als Funktion). */
const QUEST_KEYS = ["id", "title", "giver", "topic", "rewardXp", "rewardCoins", "steps", "requires", "repeatable"] as const;

function parseOneQuest(q: unknown, where: string): Quest {
  const o = asRecord(q, where);
  assertNoUnknownKeys(o, where, QUEST_KEYS);
  const id = asNonEmptyString(o.id, `${where}.id`);
  const path = `quest ${id}`;
  const quest: Quest = {
    id,
    title: asNonEmptyString(o.title, `${path}.title`),
    giver: asNonEmptyString(o.giver, `${path}.giver`),
    // `topic` wird hier nur STRUKTURELL geprüft (Pflicht-String, wie `giver`) –
    // ob es ein bekanntes Thema ist (referenziell) prüft validateContent
    // (content/validate.ts), genau wie beim Geber. Ein fehlendes/leeres topic
    // ist dagegen ein struktureller Defekt und scheitert hart beim Laden.
    topic: asNonEmptyString(o.topic, `${path}.topic`),
    rewardXp: asInt(o.rewardXp, `${path}.rewardXp`),
    rewardCoins: asInt(o.rewardCoins, `${path}.rewardCoins`),
    steps: asArray(o.steps, `${path}.steps`).map((s, j) => reviveStep(s, `${path}.steps[${j}]`)),
  };
  // Optionale Voraussetzungen (#410): hier nur STRUKTURELL (Liste nicht-leerer Strings) –
  // dass jede ID auf eine echte Quest zeigt (und keine Zyklen/Selbst-Verweise), prüft
  // referenziell validateContent (content/validate.ts), wie bei giver/topic.
  if (o.requires !== undefined) quest.requires = asNonEmptyStringArray(o.requires, `${path}.requires`);
  if (o.repeatable !== undefined) quest.repeatable = asBool(o.repeatable, `${path}.repeatable`);
  return quest;
}

/** Validiert eine rohe Quest-Liste (eine Regionen-Datei) gegen das Schema und gibt
 *  sie in Laufzeit-Form zurück. Wirft `ContentValidationError` beim ersten Verstoß. */
export function parseQuests(raw: unknown, where = "quests"): Quest[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens eine Quest erwartet");
  return arr.map((q, i) => parseOneQuest(q, `${where}[${i}]`));
}

/** Die explizite, load-bearing Spielreihenfolge (quest-order.json) prüfen. */
function parseOrder(raw: unknown): string[] {
  const arr = asArray(raw, "quest-order");
  if (arr.length === 0) fail("quest-order", "mindestens eine Quest-ID erwartet");
  return arr.map((id, i) => asNonEmptyString(id, `quest-order[${i}]`));
}

/** Fügt die Regionen-Listen zur global geordneten Quest-Sequenz zusammen.
 *  Die Reihenfolge kommt AUSSCHLIESSLICH aus `order` (nicht aus der Datei-/Glob-
 *  Reihenfolge), weil `GameState.questIdx` ein Index in diese Sequenz ist.
 *  Validiert referenziell und explizit:
 *   - keine doppelte Quest-ID über die Regionen-Dateien hinweg,
 *   - jede ID aus `order` existiert genau einmal,
 *   - keine Quest fehlt in `order` (sonst wäre sie unerreichbar).
 *  Anders als die id-eindeutigen Sammlungen (`assembleUnique`) braucht diese die
 *  externe Reihenfolge und bleibt darum ein eigener Assembler. */
export function assembleQuests(regions: Quest[][], order: string[]): Quest[] {
  const byId = new Map<string, Quest>();
  for (const region of regions) {
    for (const q of region) {
      if (byId.has(q.id)) fail("quests", `doppelte Quest-ID „${q.id}" (über Regionen-Dateien hinweg)`);
      byId.set(q.id, q);
    }
  }
  const ordered: Quest[] = [];
  const used = new Set<string>();
  for (const id of order) {
    const q = byId.get(id);
    if (!q) fail("quest-order", `nennt unbekannte Quest-ID „${id}"`);
    if (used.has(id)) fail("quest-order", `nennt „${id}" doppelt`);
    used.add(id);
    ordered.push(q);
  }
  for (const id of byId.keys()) {
    if (!used.has(id)) fail("quest-order", `Quest „${id}" fehlt in quest-order.json (wäre unerreichbar)`);
  }
  return ordered;
}

/** Validierte Quests in Laufzeit-Form, global geordnet – Quellen:
 *  `../data/quests/<giver>.json` + `../data/quest-order.json` + `../checks.ts`.
 *  Lazy (#435): die Regionen-Dateien werden erst beim ersten Zugriff geparst,
 *  deterministisch nach Pfad sortiert (`loadGroups`) und nach quest-order.json
 *  zusammengeführt; danach gecacht. Die Reihenfolge bleibt load-bearing (`questIdx`),
 *  sie kommt weiterhin allein aus quest-order.json (nicht aus der Glob-Reihenfolge). */
export const getQuests = memo<Quest[]>(() =>
  assembleQuests(loadGroups(questRegionModules, parseQuests), parseOrder(questOrder)),
);
