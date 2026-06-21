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
import { QUEST_CHECKS } from "./checks";
import { compileCheck } from "./check-dsl";
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
} from "./parse";
import type { Sim } from "../sim";
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

/** Lazy-Memoizer (#435): `make` läuft beim ERSTEN Aufruf, das Ergebnis wird gecacht.
 *  So wandert das Parsen+Validieren der Inhalte vom Modul-Import (Boot-Pfad) auf die
 *  erste tatsächliche Nutzung und passiert pro Sammlung genau einmal. Wichtig für
 *  Stardew-Scope: hunderte Quests/Karten werden nicht mehr alle beim Boot geparst,
 *  sondern erst, wenn die jeweilige Sammlung gebraucht wird (Funkgerät/Quiz/Logbuch).
 *  Der `import.meta.glob`-Import bleibt eager (der Single-File-Build inlinet die JSON-
 *  Module weiterhin) – nur das AUSWERTEN ist verzögert. */
function memo<T>(make: () => T): () => T {
  let value: T;
  let computed = false;
  return () => {
    if (!computed) {
      value = make();
      computed = true;
    }
    return value;
  };
}

/** NPC-Stammdaten: Anzeigename, Funktions-Titel, Spritesheet-Frame, Textur-Key. */
export interface NpcMeta {
  name: string;
  title: string;
  sprite: number;
  tex: string;
}

/** Validiert rohe NPC-Daten gegen das Schema und gibt sie typisiert zurück.
 *  Wirft `ContentValidationError` beim ersten Verstoß (nie still durchwinken). */
export function parseNpcs(raw: unknown): Record<string, NpcMeta> {
  const obj = asRecord(raw, "npcs");
  const ids = Object.keys(obj);
  if (ids.length === 0) fail("npcs", "mindestens ein NPC erwartet");
  const out: Record<string, NpcMeta> = {};
  for (const id of ids) {
    const m = asRecord(obj[id], `npcs.${id}`);
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

/** Gemeinsame Felder von Teach-Befehl und Terminal-Aufgabe (ohne `intro`). */
function reviveTaskCommon(o: Record<string, unknown>, path: string): QuestTask {
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
  return { ...reviveTaskCommon(o, path), intro: asNonEmptyString(o.intro, `${path}.intro`) };
}

function reviveOptions(v: unknown, path: string): ChoiceOption[] {
  const arr = asArray(v, path);
  if (arr.length === 0) fail(path, "nicht-leere Optionsliste erwartet");
  return arr.map((opt, i) => {
    const r = asRecord(opt, `${path}[${i}]`);
    return {
      t: asNonEmptyString(r.t, `${path}[${i}].t`),
      ok: asBool(r.ok, `${path}[${i}].ok`),
      reply: asNonEmptyString(r.reply, `${path}[${i}].reply`),
    };
  });
}

/** Die an jedem Schritt erlaubten Zusatzfelder (`scenario`, `unlockAbbrev`). */
function reviveStepBase(o: Record<string, unknown>, path: string): StepBase {
  const base: StepBase = {};
  if (o.scenario !== undefined) {
    // Scenario ist die serialisierbare Sim-Zustandsform (= GameState.clusterSnapshot);
    // hier nur strukturell als Objekt absichern, die Sim-Semantik prüft der Sim selbst.
    if (typeof o.scenario !== "object" || o.scenario === null || Array.isArray(o.scenario)) {
      fail(`${path}.scenario`, "Scenario-Objekt erwartet");
    }
    base.scenario = o.scenario as Scenario;
  }
  if (o.unlockAbbrev !== undefined) base.unlockAbbrev = asNonEmptyString(o.unlockAbbrev, `${path}.unlockAbbrev`);
  return base;
}

function reviveStep(v: unknown, path: string): QuestStep {
  const o = asRecord(v, path);
  const type = asNonEmptyString(o.type, `${path}.type`);
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
function parseOneQuest(q: unknown, where: string): Quest {
  const o = asRecord(q, where);
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
function parseOneCmdCard(v: unknown, where: string): CmdCard {
  const o = asRecord(v, where);
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
function parseOneQuizCard(v: unknown, where: string): QuizCard {
  const o = asRecord(v, where);
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
