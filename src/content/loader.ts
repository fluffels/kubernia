/* ===== Inhalte: Daten-Loader (Content-as-Data, #348) — Barrel (#517) =====
 * Erster Baustein des Skalierungs-Fundaments aus ADR 0004
 * (docs/adr/0004-skalierungs-fundament.md, „Content ist TypeScript-Code"):
 * Spielinhalt lebt als **Daten-Datei** (JSON), nicht als hartcodiertes TS-Objekt-
 * Literal. TypeScript beschreibt nur noch *Typen und Mechaniken*, die *Inhalte*
 * stehen in `./data/*.json`.
 *
 * **Warum JSON-`import` statt `fetch` zur Laufzeit?** Der Offline-Build
 * (`vite-plugin-singlefile`) inlinet alle `import`s in eine self-contained
 * `index.html` – ein Laufzeit-`fetch` würde dort ins Leere greifen und den
 * „eine-Datei-zum-Verschenken"-Kernwert brechen. Vite bündelt JSON-`import`s fest
 * in den Build; die Validierung läuft trotzdem **zur Laufzeit** (beim Modul-Laden
 * bzw. — seit #435 — beim ersten Zugriff auf die lazy Getter, im Browser wie im
 * Node-Test).
 *
 * **Warum ein handgeschriebener Validator statt Zod?** Das Repo hält bewusst
 * null Laufzeit-Abhängigkeiten außer Phaser (siehe `validate.ts` + package.json).
 *
 * **Aufteilung (#517):** Jede Sammlung wiederholte dasselbe Loader-Quartett
 * (parseOne → parse → assemble → get). Die generischen Bausteine (`loadGroups`,
 * `assembleUnique`, `makeGlobLoader`, `reviveAccept`) leben jetzt in `./loader/shared.ts`;
 * jede Sammlung hat ihre eigene Leaf-Datei (`./loader/<sammlung>.ts`), und diese Datei
 * ist nur noch das **Barrel**, das die öffentliche API unverändert re-exportiert
 * (Muster wie drills/#457, sim/kubectl/#397). Bestehende `import … from "./loader"`
 * (content.ts, entities.ts, game/shared.ts, hud/album.ts, Tests) laufen unverändert.
 *
 * `ContentValidationError` liegt seit #411 im Leaf `./parse.ts` (bricht den Zyklus
 * loader → check-dsl → loader) und wird hier re-exportiert.
 */
export { ContentValidationError } from "./parse";

// NPC-Stammdaten + Smalltalk (#348).
export { type NpcMeta, parseNpcs, parseSmalltalk, NPCS, SMALLTALK } from "./loader/npcs";

// Quests: der komplette Story-/Lerninhalt, pro Region/Geber + explizite Reihenfolge (#348).
export { parseQuests, assembleQuests, getQuests } from "./loader/quests";

// Quest-Themen/Kapitel: Taxonomie fürs Logbuch-Accordion (#327/#326).
export { type QuestTopic, type TopicGroup, parseQuestTopics, getQuestTopics, groupQuestsByTopic } from "./loader/topics";

// Befehls-Karten (Spaced-Repetition-Drills), pro Geber (#352).
export { type CmdCard, parseCmdCards, assembleCmdCards, getCmdCards } from "./loader/cmdcards";

// Quiz-Karteikarten (Krabbe Kralle), pro Thema (#368).
export { type QuizCard, parseQuizCards, assembleQuizCards, getQuizCards } from "./loader/quizcards";

// Terraform-Konfig-Inhalte: benannte Beispiel-Szenarien, per `scenarioRef` referenziert (#147).
export { type TfConfig, parseTfConfigs, assembleTfConfigs, getTfConfigs } from "./loader/tfconfigs";

// Freies-Funken-Erklärungen „Was ist gerade passiert?", pro Tool (#362).
export { parseFunkExplains, assembleFunkExplains, getFunkExplains } from "./loader/funkexplain";

// Übungs-Pools je NPC (welcher Drill nach welcher Quest freigeschaltet wird, #521).
export { type PracticeEntry, parsePractice, PRACTICE } from "./loader/practice";
