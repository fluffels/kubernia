/* ===== Inhalte: Daten-Loader (Content-as-Data, #348) =====
 * Erster Baustein des Skalierungs-Fundaments aus ADR 0004
 * (docs/adr/0004-skalierungs-fundament.md, Abschnitt „Content ist
 * TypeScript-Code"): Spielinhalt lebt als **Daten-Datei** (JSON), nicht als
 * hartcodiertes TS-Objekt-Literal. TypeScript beschreibt nur noch *Typen und
 * Mechaniken*, die *Inhalte* stehen in `./data/*.json`.
 *
 * Migriert sind hier:
 *  - **NPC-Stammdaten** (`./data/npcs.json`) + **Smalltalk** (`./data/smalltalk.json`)
 *  - **Quests** – der komplette Story-/Lerninhalt, **pro Region/Geber aufgeteilt**
 *    (`./data/quests/<giver>.json`) plus eine explizite Reihenfolge-Liste
 *    (`./data/quest-order.json`). So teilt ein Stardew-großes Spiel Content auf
 *    (pro Ort/NPC, kein Monolith): navigierbar, merge-isolation pro Region,
 *    bereit für Lazy-Load pro Szene. Der Loader sammelt die Regionen-Dateien und
 *    ordnet sie nach quest-order.json (die Reihenfolge ist load-bearing: `questIdx`).
 *
 * Quests sind zu ~90% reine Daten (Dialoge, Choices, Texte, Drill-Referenzen,
 * scenario-Zustände). Die zwei „Code"-Ränder werden sauber überbrückt, statt
 * Daten und Mechanik zu vermischen:
 *  - `accept`-RegExp liegen als **String-Pattern** in der JSON und werden hier
 *    beim Laden zu `RegExp` kompiliert.
 *  - `check`-Prädikate (Sim-Zustand prüfen) sind **Mechanik** und bleiben Code:
 *    sie stehen als benannte Registry in `./checks.ts`; die JSON referenziert
 *    sie per Key, der Loader löst Key → Funktion auf. Genau das meint ADR 0004
 *    mit „TS beschreibt Mechanik, Daten beschreiben Inhalt".
 *  - `(sim) => DrillTask`-Generatoren in `drills.ts` sind ebenfalls Mechanik und
 *    bleiben Code; Quests referenzieren Drills ohnehin nur per ID (`pool`).
 *
 * Ebenfalls migriert (#352): die **Befehls-Karten** (Spaced-Repetition-Drills),
 * **pro Geber aufgeteilt** wie die Quests (`./data/cmdcards/<giver>.json`, kein
 * Monolith bei Stardew-Scope). Ihre `accept`-Pattern werden – wie bei den Quests –
 * hier als String geladen und zu `RegExp` kompiliert.
 *
 * Und migriert (#368): die **Quiz-Karteikarten** `CRAB_QUIZ` (Krabbe Kralle,
 * Multiple Choice). Anders als Quests/Befehls-Karten **pro THEMA aufgeteilt**
 * (`./data/crabquiz/<thema>.json`, z.B. docker/kubernetes/helm/rbac …), nicht pro
 * Geber: ein Wissens-Quiz ist nach Thema organisiert (die ID kodiert es), und ein
 * Thema ist stabil, auch wenn seine Region/sein Geber noch gar nicht gebaut ist
 * (z.B. RBAC – Wachturm #130 ist zurückgestellt, hat weder Quest noch Geber). Reine
 * Daten ohne RegExp; damit ist `quiz.ts` entfallen.
 *
 * **Warum JSON-`import` statt `fetch` zur Laufzeit?** Der Offline-Build
 * (`vite-plugin-singlefile`) inlinet alle `import`s in eine self-contained
 * `index.html` – ein Laufzeit-`fetch` würde dort ins Leere greifen und den
 * „eine-Datei-zum-Verschenken"-Kernwert brechen. Vite bündelt JSON-`import`s
 * fest in den Build; die Validierung unten läuft trotzdem **zur Laufzeit**
 * (beim Modul-Laden, im Browser wie im Node-Test).
 *
 * **Warum ein handgeschriebener Validator statt Zod?** Das Repo hält bewusst
 * null Laufzeit-Abhängigkeiten außer Phaser (siehe `validate.ts` + package.json).
 * Eine Schema-Library nur fürs Laden wäre unnötiger Bundle-Ballast. Der
 * Validator hier ist klein, Phaser-frei und unit-getestet.
 *
 * Hier liegt nur die NPC-*Identität* (Name/Titel/Sprite). WO ein NPC steht, ist
 * seit #349 eigene Daten in `./data/entities.json` (Entity-Registry, `entities.ts`):
 * `{ id, map, x, y }` je Standplatz, referenziert die `id` aus npcs.json. Diese
 * Schlüssel müssen in npcs.json bleiben, sonst findet die Registry (und damit die
 * Szene) ihren NPC nicht – der entities-Loader wirft dann `ContentValidationError`.
 */
import npcsData from "./data/npcs.json";
import smalltalkData from "./data/smalltalk.json";
import questOrder from "./data/quest-order.json";
import questTopicsData from "./data/quest-topics.json";
// Quests liegen pro Region/Geber in einer eigenen Datei (data/quests/<giver>.json) –
// so wie ein Stardew-großes Spiel Content aufteilt (pro Ort/NPC, nicht ein Monolith):
// navigierbar, merge-isolation pro Region, bereit für Lazy-Load pro Szene (#198).
// Vite sammelt sie zur Build-Zeit (eager) und bündelt sie in beide Builds
// (Host-Multi-File + Offline-Single-File). Die load-bearing Reihenfolge (questIdx!)
// steht explizit in quest-order.json – die Datei-/Glob-Reihenfolge zählt NICHT.
const questRegionModules = import.meta.glob<{ default: unknown }>("./data/quests/*.json", { eager: true });
// Befehls-Karten (#352) liegen analog zu den Quests pro Geber in data/cmdcards/<giver>.json.
const cmdCardModules = import.meta.glob<{ default: unknown }>("./data/cmdcards/*.json", { eager: true });
// Quiz-Karteikarten (#368) liegen pro THEMA in data/crabquiz/<thema>.json (nicht pro Geber).
const crabQuizModules = import.meta.glob<{ default: unknown }>("./data/crabquiz/*.json", { eager: true });
// Terraform-Konfig-Inhalte (#147) liegen pro Region in data/terraform/<region>.json: benannte
// Beispiel-Szenarien (die simulierten .tf-Dateien + ihr Sim-Zustand), auf die Quests per
// `scenarioRef` verweisen, statt sie zu duplizieren (DRY über den ganzen Arc – Stardew-Scope).
const tfConfigModules = import.meta.glob<{ default: unknown }>("./data/terraform/*.json", { eager: true });
// Freies-Funken-Erklärungen (#362) liegen pro Tool in data/funk-explain/<tool>.json:
// verb-/befehlsweite Muster + kurze In-World-Einordnung „Was ist gerade passiert?".
const funkExplainModules = import.meta.glob<{ default: unknown }>("./data/funk-explain/*.json", { eager: true });
import { QUEST_CHECKS } from "./checks";
import { compileCheck } from "./check-dsl";
// Scenario-Validierung (#494) liegt als eigenes Leaf-Modul neben dem Loader (wie check-dsl):
// geschlossene Feld-Allowlist + fail-fast gegen stille Tippfehler im Inline-`scenario`.
import { reviveScenario } from "./scenario";
// Manifest-Bibliothek (#514): benannte YAML-/Datei-Inhalte als Daten. Der Loader löst die
// `scenario.manifests`-Kurzform (manifestRef) über `resolveScenarioManifests` auf; das
// Leaf-Modul importiert nur parse.ts, sodass auch die Drills es zyklusfrei nutzen.
import { resolveScenarioManifests } from "./manifest-lib";
// Geteilte Parse-Primitiven liegen seit #411 im Leaf-Modul `parse.ts` (bricht den
// Zyklus loader → check-dsl → loader, den #390 verbietet). `ContentValidationError`
// wird hier re-exportiert, damit bestehende `import … from "./loader"` (entities.ts,
// Tests) unverändert laufen.
import {
  ContentValidationError,
  fail,
  asRecord,
  asNonEmptyString,
  asInt,
  asNonEmptyStringArray,
  asBool,
  asArray,
  assertNoUnknownKeys,
  memo,
} from "./parse";
import type { Sim } from "../sim";
import type { FunkExplanation } from "../funkexplain";
import type {
  Quest,
  QuestStep,
  QuestTask,
  TeachCommand,
  ChoiceOption,
  StepBase,
} from "../types";
import type { Scenario } from "../sim";

export { ContentValidationError };

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

/* ===================== Quests (Content-as-Data, #348) ===================== */

/** `accept`-Pattern (Strings aus der JSON) zu `RegExp` kompilieren. */
function reviveAccept(v: unknown, path: string): RegExp[] {
  const arr = asArray(v, path);
  if (arr.length === 0) fail(path, "nicht-leeres accept-Array erwartet");
  return arr.map((s, i) => {
    const src = asNonEmptyString(s, `${path}[${i}]`);
    try {
      return new RegExp(src);
    } catch {
      return fail(`${path}[${i}]`, `ungültiges RegExp-Pattern: ${src}`);
    }
  });
}

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
 *   - keine Quest fehlt in `order` (sonst wäre sie unerreichbar). */
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
 *  `./data/quests/<giver>.json` + `./data/quest-order.json` + `./checks.ts`.
 *  Lazy (#435): die Regionen-Dateien werden erst beim ersten Zugriff geparst,
 *  deterministisch nach Pfad sortiert und nach quest-order.json zusammengeführt;
 *  danach gecacht. Die Reihenfolge bleibt load-bearing (`questIdx`), sie kommt
 *  weiterhin allein aus quest-order.json (nicht aus der Glob-Reihenfolge). */
export const getQuests = memo<Quest[]>(() =>
  assembleQuests(
    Object.entries(questRegionModules)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, mod]) => parseQuests(mod.default, path)),
    parseOrder(questOrder),
  ),
);

/* ===================== Quest-Themen / Kapitel (Content-as-Data, #327) =====================
 * Die Themen-Taxonomie (`./data/quest-topics.json`): eine GEORDNETE Liste von
 * `{ id, label }`. Sie ist die SSOT der gültigen Quest-Themen und zugleich die
 * Anzeigereihenfolge fürs Logbuch-Accordion (#326), angelehnt an den
 * README-Lernpfad. Wie quest-order.json bewusst eigene Daten (nicht aus den
 * Quests abgeleitet): ein Thema kann mehrere, im Lernpfad NICHT zusammenhängende
 * Quests bündeln (z.B. Helm: Grundlagen früh + Umbrella-Chart deutlich später),
 * und ein Geber kann Quests aus mehreren Themen geben.
 *
 * NICHT zu verwechseln mit der Datei-Aufteilung des Quiz (`./data/crabquiz/<thema>.json`):
 * jene „Themen" sind nur eine Ordner-Konvention (auch ohne Quest/Geber gültig, z.B. RBAC),
 * hier ist es die VALIDIERTE Pro-Quest-Registry für die Logbuch-Gruppierung. */

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

/** Validierte Themen-Taxonomie (geordnet) – Quelle: `./data/quest-topics.json`.
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

/* ===================== Befehls-Karten (Content-as-Data, #352) =====================
 * Die Spaced-Repetition-Drill-Karten: Aufgabe (`q`) + akzeptierte Eingaben
 * (`accept` → RegExp) + Musterlösung (`solution`) + Begründung (`explain`,
 * Pflichtfeld #233 „verstehen statt auswendig"). Wie die Quests **pro Geber**
 * aufgeteilt (`./data/cmdcards/<giver>.json`), damit es bei Stardew-Scope kein
 * Monolith wird. `chapter` referenziert die Quest-ID, in deren Kapitel die Karte
 * drillt; dass dieser Verweis auf eine echte Quest zeigt, prüft – wie schon vor
 * der Migration – der referenzielle `validateContent` (`content/validate.ts`),
 * nicht der Loader (der Loader hat hier keine Quest-Liste). */

/** Befehls-Karte in Laufzeit-Form (`accept` als kompiliertes RegExp). */
export interface CmdCard {
  id: string;
  /** Quest-ID, nach deren Abschluss die Karte in den SR-Pool kommt (Freischaltung). */
  chapter: string;
  /** Quest-ID, in der das Konzept eingeführt wird (Lernreihenfolge-Wächter #235).
   *  Optional (#412): fehlt es, gilt `chapter` – nur setzen, wenn das Konzept
   *  FRÜHER eingeführt wird als die Karte freigeschaltet wird. */
  introducedIn?: string;
  q: string;
  accept: RegExp[];
  solution: string;
  explain: string;
}

/** Validiert EINE rohe Befehls-Karte und gibt sie in Laufzeit-Form zurück
 *  (`accept` als RegExp). Wirft `ContentValidationError` beim ersten Verstoß. */
const CMDCARD_KEYS = ["id", "chapter", "introducedIn", "q", "accept", "solution", "explain"] as const;

function parseOneCmdCard(v: unknown, where: string): CmdCard {
  const o = asRecord(v, where);
  assertNoUnknownKeys(o, where, CMDCARD_KEYS);
  const id = asNonEmptyString(o.id, `${where}.id`);
  const path = `cmdcard ${id}`;
  const introducedIn = o.introducedIn !== undefined ? asNonEmptyString(o.introducedIn, `${path}.introducedIn`) : undefined;
  return {
    id,
    chapter: asNonEmptyString(o.chapter, `${path}.chapter`),
    ...(introducedIn !== undefined && { introducedIn }),
    q: asNonEmptyString(o.q, `${path}.q`),
    accept: reviveAccept(o.accept, `${path}.accept`),
    solution: asNonEmptyString(o.solution, `${path}.solution`),
    explain: asNonEmptyString(o.explain, `${path}.explain`),
  };
}

/** Validiert eine rohe Karten-Liste (eine Geber-Datei) gegen das Schema und gibt
 *  sie in Laufzeit-Form zurück. Wirft `ContentValidationError` beim ersten Verstoß. */
export function parseCmdCards(raw: unknown, where = "cmdcards"): CmdCard[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens eine Befehls-Karte erwartet");
  return arr.map((c, i) => parseOneCmdCard(c, `${where}[${i}]`));
}

/** Führt die Geber-Listen zu einer Karten-Sammlung zusammen und prüft auf
 *  doppelte IDs über die Dateien hinweg. Anders als die Quests brauchen die
 *  Karten KEINE Reihenfolge (sie werden per `id`/`chapter` referenziert, nicht per
 *  Index) – aber eindeutige IDs sind Pflicht: die Karten-ID ist im Spielstand
 *  persistiert (die Spaced-Repetition-Box hängt an ihr), eine Dublette würde zwei
 *  Karten denselben Lernfortschritt teilen lassen. */
export function assembleCmdCards(regions: CmdCard[][]): CmdCard[] {
  const seen = new Set<string>();
  const out: CmdCard[] = [];
  for (const region of regions) {
    for (const c of region) {
      if (seen.has(c.id)) fail("cmdcards", `doppelte Karten-ID „${c.id}" (über Geber-Dateien hinweg)`);
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/** Validierte Befehls-Karten in Laufzeit-Form – Quelle: `./data/cmdcards/<giver>.json`.
 *  Lazy (#435): die Geber-Dateien werden erst beim ersten Zugriff geparst (Funkgerät/
 *  Spaced-Repetition), deterministisch nach Pfad sortiert zusammengeführt; dann gecacht. */
export const getCmdCards = memo<CmdCard[]>(() =>
  assembleCmdCards(
    Object.entries(cmdCardModules)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, mod]) => parseCmdCards(mod.default, path)),
  ),
);

/* ===================== Quiz-Karteikarten (Content-as-Data, #368) =====================
 * Die Verständnis-Karten der Quiz-Krabbe Kralle (Multiple Choice): Frage (`q`),
 * `options` (≥2), Index der richtigen Antwort (`correct`) + Begründung (`explain`,
 * Pflichtfeld #233). Anders als Quests/Befehls-Karten **pro THEMA aufgeteilt**
 * (`./data/crabquiz/<thema>.json`) – ein Wissens-Quiz ist nach Wissensgebiet
 * organisiert, nicht nach Geber, und ein Thema (z.B. RBAC) existiert auch dann
 * schon, wenn seine Region/sein Geber noch nicht gebaut ist. Welche Quest eine
 * Karte über `reviewId` einbindet, prüft `validateContent` (`content/validate.ts`). */

/** Quiz-Karteikarte in Laufzeit-Form (Multiple Choice). */
export interface QuizCard {
  id: string;
  /** Quest-ID, nach deren Abschluss diese Karte in den SR-Pool kommt (analog zu CmdCard.chapter). */
  chapter?: string;
  /** Quest-ID, in der das Konzept eingeführt wird (Lernreihenfolge-Wächter #235).
   *  Optional (#412): fehlt es, gilt `chapter` – nur setzen, wenn das Konzept
   *  FRÜHER eingeführt wird als die Karte freigeschaltet wird. */
  introducedIn?: string;
  q: string;
  options: string[];
  correct: number;
  explain: string;
}

/** Validiert EINE rohe Quiz-Karte und gibt sie typisiert zurück.
 *  Wirft `ContentValidationError` beim ersten Verstoß. */
const QUIZCARD_KEYS = ["id", "chapter", "introducedIn", "q", "options", "correct", "explain"] as const;

function parseOneQuizCard(v: unknown, where: string): QuizCard {
  const o = asRecord(v, where);
  assertNoUnknownKeys(o, where, QUIZCARD_KEYS);
  const id = asNonEmptyString(o.id, `${where}.id`);
  const path = `quizcard ${id}`;
  const options = asNonEmptyStringArray(o.options, `${path}.options`);
  if (options.length < 2) fail(`${path}.options`, "mindestens zwei Optionen erwartet");
  const correct = asInt(o.correct, `${path}.correct`);
  if (correct < 0 || correct >= options.length) {
    fail(`${path}.correct`, `Index ${correct} außerhalb der ${options.length} Optionen`);
  }
  const chapter = o.chapter !== undefined ? asNonEmptyString(o.chapter, `${path}.chapter`) : undefined;
  const introducedIn = o.introducedIn !== undefined ? asNonEmptyString(o.introducedIn, `${path}.introducedIn`) : undefined;
  return {
    id,
    ...(chapter !== undefined && { chapter }),
    ...(introducedIn !== undefined && { introducedIn }),
    q: asNonEmptyString(o.q, `${path}.q`),
    options,
    correct,
    explain: asNonEmptyString(o.explain, `${path}.explain`),
  };
}

/** Validiert eine rohe Quiz-Liste (eine Thema-Datei). Wirft beim ersten Verstoß. */
export function parseQuizCards(raw: unknown, where = "crabquiz"): QuizCard[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens eine Quiz-Karte erwartet");
  return arr.map((c, i) => parseOneQuizCard(c, `${where}[${i}]`));
}

/** Führt die Thema-Listen zusammen und prüft auf doppelte IDs über die Dateien
 *  hinweg (die Karten-ID ist im Spielstand persistiert – die Spaced-Repetition-Box
 *  hängt an ihr, eine Dublette würde den Lernfortschritt teilen). Keine Reihenfolge
 *  nötig: Karten werden per `id` referenziert, nicht per Index. */
export function assembleQuizCards(topics: QuizCard[][]): QuizCard[] {
  const seen = new Set<string>();
  const out: QuizCard[] = [];
  for (const topic of topics) {
    for (const c of topic) {
      if (seen.has(c.id)) fail("crabquiz", `doppelte Quiz-ID „${c.id}" (über Thema-Dateien hinweg)`);
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/** Validierte Quiz-Karteikarten in Laufzeit-Form – Quelle: `./data/crabquiz/<thema>.json`.
 *  Lazy (#435): die Thema-Dateien werden erst beim ersten Zugriff geparst (Krabben-Quiz),
 *  deterministisch nach Pfad sortiert zusammengeführt; dann gecacht. */
export const getQuizCards = memo<QuizCard[]>(() =>
  assembleQuizCards(
    Object.entries(crabQuizModules)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, mod]) => parseQuizCards(mod.default, path)),
  ),
);

/* ===================== Terraform-Konfig-Inhalte (Content-as-Data, #147) =====================
 * Die Expeditions-Flotte (Phase 9) braucht plausible Beispiel-Konfigurationen als
 * Spielinhalt für die in der Sim-Grundlage (#146) angelegten Befehle: ein wieder-
 * verwendbares Modul (Variablen/Ressourcen/Outputs), Remote State (`backend`-Block),
 * mehrere `provider`-Blöcke (Multi-Cloud) und sauber durchgereichte Variablen/Outputs.
 *
 * Eine Terraform-Konfig ist ein **benanntes Beispiel-Szenario**: die simulierten
 * `.tf`-Dateien (was der Spieler per `cat` liest) PLUS der passende Sim-Zustand
 * (`tfModules`/`tfProviders`/`tfBackend`/`tfOutputs`/`tfResources`), beides zusammen
 * als ein `Scenario`. Die Quests des Arcs (#150–#153) verweisen per `scenarioRef`
 * auf diese Konfigs, statt die langen `.tf`-Texte zu duplizieren – DRY über den
 * ganzen Arc (Stardew-Scope: vier Quests teilen sich eine Quelle der Wahrheit).
 *
 * Wie die Quests **pro Region aufgeteilt** (`./data/terraform/<region>.json`), kein
 * Monolith. Hier nur STRUKTURELLE Prüfung (id/label/Szenario-Objekt + nicht-leeres
 * `files`); die Sim-Semantik (läuft init→plan→apply? passt der Text zum Modell?) ist
 * keine Loader-Aufgabe, sondern wird in `test/tf-configs.test.ts` abgesichert. */

/** Eine benannte Terraform-Konfig: ein Beispiel-Szenario, auf das Quests per
 *  `scenarioRef` verweisen. `scenario` trägt die simulierten `.tf`-Dateien (`files`)
 *  und den dazugehörigen Sim-Zustand. */
export interface TfConfig {
  id: string;
  /** Kurzes, sprechendes Anzeige-Label (Doku/Tooling). */
  label: string;
  scenario: Scenario;
}

/** Validiert EINE rohe Terraform-Konfig und gibt sie typisiert zurück. Sichert
 *  strukturell ab, dass ein nicht-leeres `files` mit rein textuellen Inhalten da ist
 *  (diese Konfigs existieren, damit der Spieler sie per `cat` lesen kann). */
function parseOneTfConfig(v: unknown, where: string): TfConfig {
  const o = asRecord(v, where);
  assertNoUnknownKeys(o, where, ["id", "label", "scenario"]);
  const id = asNonEmptyString(o.id, `${where}.id`);
  const path = `tf-config ${id}`;
  const label = asNonEmptyString(o.label, `${path}.label`);
  // Scenario strukturell gegen die Feld-Allowlist prüfen (#494) statt ungeprüft casten.
  const scenario = reviveScenario(o.scenario, `${path}.scenario`);
  // tf-config-spezifisch: der Spieler MUSS etwas per `cat` lesen können → nicht-leeres
  // `files` mit nicht-leeren Inhalten (strenger als das generische reviveScenario).
  const files = asRecord(scenario.files, `${path}.scenario.files`);
  const fileNames = Object.keys(files);
  if (fileNames.length === 0) fail(`${path}.scenario.files`, "mindestens eine .tf-Datei erwartet");
  for (const fn of fileNames) asNonEmptyString(files[fn], `${path}.scenario.files["${fn}"]`);
  return { id, label, scenario };
}

/** Validiert eine rohe Konfig-Liste (eine Regionen-Datei). Wirft beim ersten Verstoß. */
export function parseTfConfigs(raw: unknown, where = "tf-configs"): TfConfig[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens eine Terraform-Konfig erwartet");
  return arr.map((c, i) => parseOneTfConfig(c, `${where}[${i}]`));
}

/** Führt die Regionen-Listen zusammen und prüft auf doppelte IDs über die Dateien
 *  hinweg – eine Dublette ließe zwei `scenarioRef`-Ziele kollidieren. */
export function assembleTfConfigs(regions: TfConfig[][]): TfConfig[] {
  const seen = new Set<string>();
  const out: TfConfig[] = [];
  for (const region of regions) {
    for (const c of region) {
      if (seen.has(c.id)) fail("tf-configs", `doppelte Konfig-ID „${c.id}" (über Regionen-Dateien hinweg)`);
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/** Validierte Terraform-Konfigs in Laufzeit-Form – Quelle: `./data/terraform/<region>.json`.
 *  Lazy (#435) wie die übrigen Sammlungen: erst beim ersten Zugriff geparst, dann gecacht. */
export const getTfConfigs = memo<TfConfig[]>(() =>
  assembleTfConfigs(
    Object.entries(tfConfigModules)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, mod]) => parseTfConfigs(mod.default, path)),
  ),
);

/* ===================== Freies-Funken-Erklärungen (Content-as-Data, #362) =====================
 * Die kurzen „Was ist gerade passiert?"-Einordnungen, die im freien Funken nach einem
 * Befehl erscheinen (dosiert, vom puren `funkexplain.ts` ausgewählt). Wie die übrigen
 * Sammlungen **pro Tool aufgeteilt** (`./data/funk-explain/<tool>.json`), kein Monolith
 * bei Stardew-Scope. Jede Erklärung trägt `match`-Pattern (Strings → RegExp, befehls-/
 * verb-weit, NICHT arg-genau wie die Drill-Karten) + den In-World-Text. */

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
  const seen = new Set<string>();
  const out: FunkExplanation[] = [];
  for (const tool of tools) {
    for (const e of tool) {
      if (seen.has(e.id)) fail("funk-explain", `doppelte Erklärungs-ID „${e.id}" (über Tool-Dateien hinweg)`);
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

/** Validierte Freies-Funken-Erklärungen – Quelle: `./data/funk-explain/<tool>.json`.
 *  Lazy (#435): erst beim ersten Zugriff (freies Funken) geparst, nach Pfad sortiert
 *  zusammengeführt; dann gecacht. */
export const getFunkExplains = memo<FunkExplanation[]>(() =>
  assembleFunkExplains(
    Object.entries(funkExplainModules)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, mod]) => parseFunkExplains(mod.default, path)),
  ),
);

/** Löst einen `scenarioRef` (Konfig-ID) zum hinterlegten Beispiel-Szenario auf.
 *  Wirft `ContentValidationError`, wenn die ID auf keine Konfig zeigt (Tippfehler
 *  fällt beim Laden hart auf, nicht erst still im Spiel). */
function resolveScenarioRef(ref: string, path: string): Scenario {
  const cfg = getTfConfigs().find(c => c.id === ref);
  if (!cfg) fail(path, `unbekannte Konfig-Referenz „${ref}" (nicht in data/terraform/*.json)`);
  return cfg.scenario;
}
