/* Tests für den Content-as-Data-Loader (#348): NPCs + Smalltalk als JSON.
 * Prüft sowohl die geladenen ECHTEN Daten (Vollständigkeit, referenzielle
 * Integrität) als auch das Schema-Verhalten der Parser bei KAPUTTEN Eingaben –
 * die Validierung muss explizit fehlschlagen (werfen), nie still durchwinken.
 * Ausführen mit:  npm test
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  NPCS,
  SMALLTALK,
  getQuests,
  getCmdCards,
  getQuizCards,
  getQuestTopics,
  parseNpcs,
  parseSmalltalk,
  parseQuests,
  assembleQuests,
  parseCmdCards,
  assembleCmdCards,
  parseQuizCards,
  assembleQuizCards,
  parseQuestTopics,
  groupQuestsByTopic,
  ContentValidationError,
  type CmdCard,
  type QuizCard,
} from "../src/content/loader";
import type { Quest } from "../src/types";

// #435: Quests/Karten/Quiz/Themen sind im Loader jetzt lazy (memoisierte Getter). Für die
// „echte Daten"-Tests hier einmalig materialisieren – so bleiben alle Test-Bodies unverändert.
const QUESTS = getQuests();
const CMD_CARDS = getCmdCards();
const CRAB_QUIZ = getQuizCards();
const QUEST_TOPICS = getQuestTopics();

/** Minimal-Quest für die Assembler-Tests (Inhalt egal, nur id/giver/topic zählen). */
const mkQuest = (id: string): Quest => ({ id, title: id, giver: "ole", topic: "docker", rewardXp: 0, rewardCoins: 0, steps: [] });

/* ---------- Echte Daten: vollständig & konsistent geladen ---------- */

test("loader: NPCS lädt alle erwarteten NPCs mit vollständigen Feldern", () => {
  // Die zugereisten NPCs (argo/lumi/knut) müssen erhalten bleiben – Szenen
  // (archipel/lighthouse/warehouse) hängen an genau diesen Schlüsseln.
  for (const id of ["ole", "bo", "ada", "runa", "theo", "pelle", "kralle", "juno", "argo", "lumi", "knut"]) {
    const npc = NPCS[id];
    assert.ok(npc, `NPC „${id}" fehlt nach dem Laden`);
    assert.equal(typeof npc.name, "string");
    assert.ok(npc.name.trim().length > 0, `NPC „${id}": leerer Name`);
    assert.equal(typeof npc.title, "string");
    assert.ok(Number.isInteger(npc.sprite), `NPC „${id}": sprite keine Ganzzahl`);
    assert.ok(npc.tex.startsWith("char_"), `NPC „${id}": tex-Key unerwartet`);
  }
  // Stichprobe gegen versehentliche Daten-Verschiebung beim JSON-Umzug.
  assert.equal(NPCS.argo.tex, "char_argos");
  assert.equal(NPCS.kralle.name, "Krabbe Kralle");
  assert.equal(NPCS.knut.sprite, 100);
});

test("loader: SMALLTALK lädt nicht-leere Zeilen, jeder Schlüssel ist ein bekannter NPC", () => {
  assert.ok(Array.isArray(SMALLTALK.bo) && SMALLTALK.bo.length > 0, "bo ohne Smalltalk");
  for (const [id, lines] of Object.entries(SMALLTALK)) {
    assert.ok(NPCS[id], `Smalltalk für unbekannten NPC „${id}"`);
    assert.ok(lines.length > 0, `Smalltalk „${id}": keine Zeilen`);
    for (const line of lines) assert.ok(line.trim().length > 0, `Smalltalk „${id}": leere Zeile`);
  }
});

/* ---------- parseNpcs: gültige Daten ---------- */

test("parseNpcs: akzeptiert wohlgeformte Daten", () => {
  const ok = parseNpcs({ x: { name: "X", title: "Titel", sprite: 7, tex: "char_x" } });
  assert.equal(ok.x.sprite, 7);
  assert.equal(ok.x.name, "X");
});

/* ---------- parseNpcs: kaputte Daten MÜSSEN explizit werfen (Negativfälle) ----------
 * Diese Tests sind die Red-Green-Absicherung: Würde der Loader eine dieser
 * Prüfungen weglassen, bliebe der jeweilige Test rot. Geprüft wird zusätzlich,
 * dass die Fehlermeldung den konkreten Feld-PFAD nennt (nicht nur „ungültig"). */

test("parseNpcs: wirft bei Nicht-Objekt", () => {
  assert.throws(() => parseNpcs([]), ContentValidationError);
  assert.throws(() => parseNpcs(null), ContentValidationError);
  assert.throws(() => parseNpcs("nope"), ContentValidationError);
});

test("parseNpcs: wirft bei leerem Katalog", () => {
  assert.throws(() => parseNpcs({}), ContentValidationError);
});

test("parseNpcs: wirft bei fehlendem Pflichtfeld (mit Pfad)", () => {
  assert.throws(
    () => parseNpcs({ ole: { title: "T", sprite: 1, tex: "char_o" } }),
    (e: unknown) => e instanceof ContentValidationError && /npcs\.ole\.name/.test(e.message),
  );
});

test("parseNpcs: wirft bei leerem Namen", () => {
  assert.throws(
    () => parseNpcs({ ole: { name: "   ", title: "T", sprite: 1, tex: "char_o" } }),
    ContentValidationError,
  );
});

test("parseNpcs: wirft bei sprite ohne Ganzzahl (String oder Float)", () => {
  assert.throws(
    () => parseNpcs({ ole: { name: "Ole", title: "T", sprite: "100", tex: "char_o" } }),
    (e: unknown) => e instanceof ContentValidationError && /npcs\.ole\.sprite/.test(e.message),
  );
  assert.throws(
    () => parseNpcs({ ole: { name: "Ole", title: "T", sprite: 1.5, tex: "char_o" } }),
    ContentValidationError,
  );
});

/* ---------- parseSmalltalk: kaputte Daten MÜSSEN explizit werfen ---------- */

const known = new Set(["ole", "bo"]);

test("parseSmalltalk: wirft bei unbekanntem NPC-Schlüssel (mit Pfad)", () => {
  assert.throws(
    () => parseSmalltalk({ gibtsnicht: ["hi"] }, known),
    (e: unknown) => e instanceof ContentValidationError && /smalltalk\.gibtsnicht/.test(e.message),
  );
});

test("parseSmalltalk: wirft bei leerer Zeilen-Liste", () => {
  assert.throws(() => parseSmalltalk({ ole: [] }, known), ContentValidationError);
});

test("parseSmalltalk: wirft bei nicht-textueller Zeile", () => {
  assert.throws(
    () => parseSmalltalk({ ole: ["ok", 123] }, known),
    (e: unknown) => e instanceof ContentValidationError && /smalltalk\.ole\[1\]/.test(e.message),
  );
});

test("parseSmalltalk: akzeptiert wohlgeformte Daten", () => {
  const ok = parseSmalltalk({ ole: ["Zeile eins", "Zeile zwei"] }, known);
  assert.equal(ok.ole.length, 2);
});

/* ---------- Quests: echte Daten korrekt in Laufzeit-Form geladen ---------- */

test("loader: QUESTS geladen, accept als RegExp, check als Funktion (Laufzeit-Form)", () => {
  assert.ok(QUESTS.length > 0, "keine Quests geladen");
  let sawAccept = false;
  let sawCheck = false;
  for (const quest of QUESTS) {
    assert.ok(quest.id.length > 0);
    for (const step of quest.steps) {
      const tasks =
        step.type === "teach" ? [step.cmd] : step.type === "terminal" ? step.tasks : [];
      for (const t of tasks) {
        // accept muss zu echten RegExp kompiliert sein (nicht mehr String).
        assert.ok(Array.isArray(t.accept) && t.accept.length > 0, `${quest.id}/${t.id}: kein accept`);
        for (const re of t.accept) {
          assert.ok(re instanceof RegExp, `${quest.id}/${t.id}: accept kein RegExp`);
          sawAccept = true;
        }
        // check (falls vorhanden) muss zur Funktion aufgelöst sein (nicht mehr Key-String).
        if (t.check !== undefined) {
          assert.equal(typeof t.check, "function", `${quest.id}/${t.id}: check keine Funktion`);
          sawCheck = true;
        }
      }
    }
  }
  assert.ok(sawAccept, "kein einziger accept-RegExp – Revival hat nichts getan?");
  assert.ok(sawCheck, "kein einziger aufgelöster check – Revival hat nichts getan?");
});

/* ---------- parseQuests: gültige Daten ---------- */

const minimalQuest = {
  id: "qx",
  title: "Test",
  giver: "ole",
  topic: "docker",
  rewardXp: 10,
  rewardCoins: 5,
  steps: [
    { type: "dialog", npc: "ole", lines: ["Hallo"] },
    { type: "teach", brief: "B", cmd: { id: "t-x", intro: "I", text: "T", accept: ["^x$"], solution: "x", hint: "H", check: "qx/t-x" } },
  ],
};

test("parseQuests: akzeptiert wohlgeformte Quest ohne check", () => {
  const q = parseQuests([{ ...minimalQuest, steps: [{ type: "dialog", npc: "ole", lines: ["Hi"] }] }]);
  assert.equal(q.length, 1);
  assert.equal(q[0].steps[0].type, "dialog");
});

/* ---------- parseQuests: optionale Voraussetzungen + Wiederholbar-Flag (#410) ----------
 * Basis ohne den Test-`check`-Key (der sonst zuerst wirft), damit gezielt requires/repeatable
 * geprüft werden. */
const reqQuest = { ...minimalQuest, steps: [{ type: "dialog", npc: "ole", lines: ["Hi"] }] };

test("parseQuests: requires/repeatable fehlen standardmäßig (optional)", () => {
  const q = parseQuests([reqQuest]);
  assert.equal(q[0].requires, undefined);
  assert.equal(q[0].repeatable, undefined);
});

test("parseQuests: übernimmt gültige requires-Liste und repeatable-Flag", () => {
  const q = parseQuests([{ ...reqQuest, requires: ["docker-first-container"], repeatable: true }]);
  assert.deepEqual(q[0].requires, ["docker-first-container"]);
  assert.equal(q[0].repeatable, true);
});

test("parseQuests: wirft bei requires mit leerem String (mit Pfad)", () => {
  assert.throws(
    () => parseQuests([{ ...reqQuest, requires: [""] }]),
    (e: unknown) => e instanceof ContentValidationError && /requires\[0\]/.test((e as Error).message),
  );
});

test("parseQuests: wirft bei requires, das kein Array ist", () => {
  assert.throws(
    () => parseQuests([{ ...reqQuest, requires: "docker-first-container" }]),
    (e: unknown) => e instanceof ContentValidationError && /requires/.test((e as Error).message),
  );
});

test("parseQuests: wirft bei repeatable mit falschem Typ", () => {
  assert.throws(
    () => parseQuests([{ ...reqQuest, repeatable: "ja" }]),
    (e: unknown) => e instanceof ContentValidationError && /repeatable/.test((e as Error).message),
  );
});

/* ---------- parseQuests: kaputte Daten MÜSSEN explizit werfen ---------- */

test("parseQuests: wirft bei Nicht-Array", () => {
  assert.throws(() => parseQuests({}), ContentValidationError);
});

test("parseQuests: wirft bei unbekanntem Schritt-Typ (mit Pfad)", () => {
  assert.throws(
    () => parseQuests([{ ...minimalQuest, steps: [{ type: "zauberei", npc: "ole", lines: ["x"] }] }]),
    (e: unknown) => e instanceof ContentValidationError && /steps\[0\]\.type/.test((e as Error).message),
  );
});

test("parseQuests: wirft bei leerem accept-Array", () => {
  assert.throws(
    () => parseQuests([{ ...minimalQuest, steps: [{ type: "teach", brief: "B", cmd: { id: "t", intro: "I", text: "T", accept: [], solution: "x", hint: "H" } }] }]),
    ContentValidationError,
  );
});

test("parseQuests: wirft bei ungültigem RegExp-Pattern (mit Pfad)", () => {
  assert.throws(
    () => parseQuests([{ ...minimalQuest, steps: [{ type: "teach", brief: "B", cmd: { id: "t", intro: "I", text: "T", accept: ["("], solution: "x", hint: "H" } }] }]),
    (e: unknown) => e instanceof ContentValidationError && /accept\[0\]/.test((e as Error).message),
  );
});

test("parseQuests: wirft bei unbekanntem check-Key (mit Pfad)", () => {
  assert.throws(
    () => parseQuests([{ ...minimalQuest, steps: [{ type: "teach", brief: "B", cmd: { id: "t", intro: "I", text: "T", accept: ["^x$"], solution: "x", hint: "H", check: "gibtsnicht/nie" } }] }]),
    (e: unknown) => e instanceof ContentValidationError && /check/.test((e as Error).message),
  );
});

test("parseQuests: wirft bei dialog-Schritt ohne Zeilen", () => {
  assert.throws(
    () => parseQuests([{ ...minimalQuest, steps: [{ type: "dialog", npc: "ole", lines: [] }] }]),
    ContentValidationError,
  );
});

test("parseQuests: wirft bei choice ohne wohlgeformte Optionen", () => {
  assert.throws(
    () => parseQuests([{ ...minimalQuest, steps: [{ type: "choice", npc: "ole", q: "?", options: [{ t: "A", ok: "ja", reply: "R" }] }] }]),
    ContentValidationError,
  );
});

test("parseQuests: wirft bei fehlendem topic (struktureller Pflicht-String, #327, mit Pfad)", () => {
  // topic ist strukturell Pflicht (wie title/giver) – fehlend MUSS hart scheitern,
  // sonst rutschte eine Quest ohne Thema durch.
  const { topic: _weg, ...ohneTopic } = minimalQuest;
  assert.throws(
    () => parseQuests([ohneTopic]),
    (e: unknown) => e instanceof ContentValidationError && /\.topic/.test((e as Error).message),
  );
});

/* ---------- parseQuestTopics: Themen-Taxonomie (#327) ---------- */

test("parseQuestTopics: akzeptiert eine wohlgeformte, geordnete Liste", () => {
  const ts = parseQuestTopics([{ id: "docker", label: "Docker" }, { id: "helm", label: "Helm" }]);
  assert.deepEqual(ts.map((t) => t.id), ["docker", "helm"]);
  assert.equal(ts[0].label, "Docker");
});

test("parseQuestTopics: wirft bei Nicht-Array bzw. leerer Liste", () => {
  assert.throws(() => parseQuestTopics({}), ContentValidationError);
  assert.throws(() => parseQuestTopics([]), ContentValidationError);
});

test("parseQuestTopics: wirft bei Eintrag ohne id/label (mit Pfad)", () => {
  assert.throws(
    () => parseQuestTopics([{ id: "docker" }]),
    (e: unknown) => e instanceof ContentValidationError && /\[0\]\.label/.test((e as Error).message),
  );
});

test("parseQuestTopics: wirft bei doppelter Themen-ID", () => {
  assert.throws(
    () => parseQuestTopics([{ id: "docker", label: "Docker" }, { id: "docker", label: "Nochmal" }]),
    (e: unknown) => e instanceof ContentValidationError && /doppelte Themen-ID/.test((e as Error).message),
  );
});

test("loader: QUEST_TOPICS lädt die echte Taxonomie (geordnet, eindeutig, mit Labels)", () => {
  assert.ok(QUEST_TOPICS.length >= 10, "unerwartet wenige Themen");
  const ids = QUEST_TOPICS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "doppelte Themen-ID in der echten Taxonomie");
  for (const t of QUEST_TOPICS) assert.ok(t.label.trim().length > 0, `Thema „${t.id}" ohne Label`);
  // Stichprobe: der Lernpfad beginnt mit Einstieg → Docker.
  assert.deepEqual(ids.slice(0, 2), ["onboarding", "docker"]);
});

/* ---------- groupQuestsByTopic: Gruppierung fürs Logbuch-Accordion (#327/#326) ---------- */

test("groupQuestsByTopic: Themen in Taxonomie-Reihenfolge, Quests in Eingabe-Reihenfolge", () => {
  const topics = [{ id: "docker", label: "Docker" }, { id: "helm", label: "Helm" }];
  const quests: Quest[] = [
    { ...mkQuest("d2"), topic: "docker" },
    { ...mkQuest("h1"), topic: "helm" },
    { ...mkQuest("d1"), topic: "docker" },
  ];
  const groups = groupQuestsByTopic(quests, topics);
  assert.deepEqual(groups.map((g) => g.id), ["docker", "helm"]);
  // Quests behalten ihre Eingabe-Reihenfolge innerhalb des Themas (d2 vor d1).
  assert.deepEqual(groups[0].quests.map((q) => q.id), ["d2", "d1"]);
  assert.deepEqual(groups[1].quests.map((q) => q.id), ["h1"]);
});

test("groupQuestsByTopic: echte Quests verteilen sich lückenlos auf die echten Themen", () => {
  const groups = groupQuestsByTopic(QUESTS, QUEST_TOPICS);
  const total = groups.reduce((n, g) => n + g.quests.length, 0);
  assert.equal(total, QUESTS.length, "Quests gehen beim Gruppieren verloren oder doppelt");
  for (const g of groups) assert.ok(g.quests.length > 0, `Thema „${g.id}" ist leer (totes Thema)`);
});

/* ---------- assembleQuests: Regionen + explizite Reihenfolge zusammenführen ---------- */

test("assembleQuests: ordnet nach order-Liste, NICHT nach Regionen-Reihenfolge", () => {
  // Regionen liefern docker-run-options,docker-first-container / docker-list-containers,onboarding-sign-on – die order erzwingt onboarding-sign-on..docker-run-options.
  const regions = [[mkQuest("docker-run-options"), mkQuest("docker-first-container")], [mkQuest("docker-list-containers"), mkQuest("onboarding-sign-on")]];
  const out = assembleQuests(regions, ["onboarding-sign-on", "docker-first-container", "docker-list-containers", "docker-run-options"]);
  assert.deepEqual(out.map((q) => q.id), ["onboarding-sign-on", "docker-first-container", "docker-list-containers", "docker-run-options"]);
});

test("assembleQuests: wirft bei doppelter Quest-ID über Regionen hinweg", () => {
  assert.throws(
    () => assembleQuests([[mkQuest("docker-first-container")], [mkQuest("docker-first-container")]], ["docker-first-container"]),
    (e: unknown) => e instanceof ContentValidationError && /doppelte Quest-ID/.test((e as Error).message),
  );
});

test("assembleQuests: wirft bei order-Eintrag ohne passende Quest (Tippfehler)", () => {
  assert.throws(
    () => assembleQuests([[mkQuest("docker-first-container")]], ["docker-first-container", "q-tippfehler"]),
    (e: unknown) => e instanceof ContentValidationError && /q-tippfehler/.test((e as Error).message),
  );
});

test("assembleQuests: wirft, wenn eine Quest nicht in der order steht (unerreichbar)", () => {
  assert.throws(
    () => assembleQuests([[mkQuest("docker-first-container"), mkQuest("docker-list-containers")]], ["docker-first-container"]),
    (e: unknown) => e instanceof ContentValidationError && /docker-list-containers.*fehlt in quest-order/.test((e as Error).message),
  );
});

test("assembleQuests: wirft bei doppeltem Eintrag in der order", () => {
  assert.throws(
    () => assembleQuests([[mkQuest("docker-first-container")]], ["docker-first-container", "docker-first-container"]),
    ContentValidationError,
  );
});

test("loader: echte QUESTS sind eindeutig und beginnen mit onboarding-sign-on (Reihenfolge erhalten)", () => {
  assert.equal(QUESTS.length, new Set(QUESTS.map((q) => q.id)).size, "doppelte Quest-IDs geladen");
  assert.equal(QUESTS[0].id, "onboarding-sign-on", "erste Quest sollte onboarding-sign-on sein (order-Reihenfolge)");
});

/* ===================== Befehls-Karten (Content-as-Data, #352) ===================== */

/** Minimal-Karte (rohe JSON-Form: accept als String-Pattern) für die Parser-Tests. */
const minimalCard = {
  id: "c-x",
  chapter: "docker-first-container",
  q: "Zeige alle laufenden Container.",
  accept: ["^docker\\s+ps$"],
  solution: "docker ps",
  explain: "ps zeigt nur die laufenden Container.",
};

/** Minimal-Karte in Laufzeit-Form für die Assembler-Tests (nur id zählt dort). */
const mkCard = (id: string): CmdCard => ({ id, chapter: "docker-first-container", q: "q", accept: [/^x$/], solution: "x", explain: "e" });

/* ---------- Echte Daten: vollständig & konsistent geladen ---------- */

test("loader: CMD_CARDS geladen, accept als RegExp, chapter+explain vorhanden, IDs eindeutig", () => {
  assert.ok(CMD_CARDS.length > 0, "keine Befehls-Karten geladen");
  assert.equal(CMD_CARDS.length, new Set(CMD_CARDS.map((c) => c.id)).size, "doppelte Karten-IDs geladen");
  let sawAccept = false;
  for (const c of CMD_CARDS) {
    assert.ok(c.id.length > 0);
    assert.ok(c.chapter.length > 0, `${c.id}: chapter fehlt`);
    assert.ok(c.explain.trim().length > 0, `${c.id}: explain leer`);
    assert.ok(Array.isArray(c.accept) && c.accept.length > 0, `${c.id}: kein accept`);
    for (const re of c.accept) {
      assert.ok(re instanceof RegExp, `${c.id}: accept kein RegExp`);
      sawAccept = true;
    }
    // Beweist, dass das Pattern korrekt aus dem String kompiliert wurde: die
    // Musterlösung muss ihre eigene accept-Regex treffen (Whitespace wie in der UI normalisiert).
    const norm = c.solution.trim().replace(/\s+/g, " ");
    assert.ok(c.accept.some((re) => re.test(norm)), `${c.id}: Lösung „${c.solution}" matcht keine eigene accept-Regex`);
  }
  assert.ok(sawAccept, "kein einziger accept-RegExp – Revival hat nichts getan?");
});

/* ---------- parseCmdCards: gültige Daten ---------- */

test("parseCmdCards: akzeptiert wohlgeformte Karte (accept → RegExp)", () => {
  const cards = parseCmdCards([minimalCard]);
  assert.equal(cards.length, 1);
  assert.ok(cards[0].accept[0] instanceof RegExp, "accept nicht zu RegExp kompiliert");
  assert.ok(cards[0].accept[0].test("docker ps"), "kompiliertes RegExp matcht die Lösung nicht");
  assert.equal(cards[0].introducedIn, undefined, "introducedIn ist optional (fehlt → undefined)");
});

test("parseCmdCards: übernimmt optionales introducedIn (#412)", () => {
  const cards = parseCmdCards([{ ...minimalCard, introducedIn: "docker-list-containers" }]);
  assert.equal(cards[0].introducedIn, "docker-list-containers");
});

test("parseCmdCards: wirft bei leerem introducedIn (mit Pfad)", () => {
  assert.throws(
    () => parseCmdCards([{ ...minimalCard, introducedIn: "" }]),
    (e: unknown) => e instanceof ContentValidationError && /cmdcard c-x\.introducedIn/.test((e as Error).message),
  );
});

/* ---------- parseCmdCards: kaputte Daten MÜSSEN explizit werfen (Negativfälle) ---------- */

test("parseCmdCards: wirft bei Nicht-Array", () => {
  assert.throws(() => parseCmdCards({}), ContentValidationError);
});

test("parseCmdCards: wirft bei leerer Liste", () => {
  assert.throws(() => parseCmdCards([]), ContentValidationError);
});

test("parseCmdCards: wirft bei fehlendem chapter (mit Pfad)", () => {
  assert.throws(
    () => parseCmdCards([{ id: "c-x", q: "q", accept: ["^x$"], solution: "x", explain: "e" }]),
    (e: unknown) => e instanceof ContentValidationError && /cmdcard c-x\.chapter/.test((e as Error).message),
  );
});

test("parseCmdCards: wirft bei fehlendem explain (mit Pfad)", () => {
  assert.throws(
    () => parseCmdCards([{ id: "c-x", chapter: "docker-first-container", q: "q", accept: ["^x$"], solution: "x" }]),
    (e: unknown) => e instanceof ContentValidationError && /cmdcard c-x\.explain/.test((e as Error).message),
  );
});

test("parseCmdCards: wirft bei leerem accept-Array", () => {
  assert.throws(() => parseCmdCards([{ ...minimalCard, accept: [] }]), ContentValidationError);
});

test("parseCmdCards: wirft bei ungültigem RegExp-Pattern (mit Pfad)", () => {
  assert.throws(
    () => parseCmdCards([{ ...minimalCard, accept: ["("] }]),
    (e: unknown) => e instanceof ContentValidationError && /accept\[0\]/.test((e as Error).message),
  );
});

/* ---------- assembleCmdCards: Geber-Listen zusammenführen ---------- */

test("assembleCmdCards: führt Geber-Listen zusammen, Reihenfolge bleibt erhalten", () => {
  const out = assembleCmdCards([[mkCard("c-1"), mkCard("c-2")], [mkCard("c-3")]]);
  assert.deepEqual(out.map((c) => c.id), ["c-1", "c-2", "c-3"]);
});

test("assembleCmdCards: wirft bei doppelter Karten-ID über Geber-Dateien hinweg", () => {
  assert.throws(
    () => assembleCmdCards([[mkCard("c-dup")], [mkCard("c-dup")]]),
    (e: unknown) => e instanceof ContentValidationError && /doppelte Karten-ID/.test((e as Error).message),
  );
});

/* ===================== Quiz-Karteikarten (Content-as-Data, #368) ===================== */

/** Minimal-Quiz-Karte (rohe JSON-Form) für die Parser-Tests. */
const minimalQuiz = {
  id: "q-x",
  q: "Was zeigt docker ps?",
  options: ["Laufende Container.", "Alle Images."],
  correct: 0,
  explain: "ps zeigt die laufenden Container.",
};

/** Minimal-Quiz-Karte in Laufzeit-Form für die Assembler-Tests (nur id zählt dort). */
const mkQuiz = (id: string): QuizCard => ({ id, q: "q", options: ["a", "b"], correct: 0, explain: "e" });

/* ---------- Echte Daten: vollständig & konsistent geladen ---------- */

test("loader: CRAB_QUIZ geladen, IDs eindeutig, Optionen/correct/explain wohlgeformt", () => {
  assert.ok(CRAB_QUIZ.length > 0, "keine Quiz-Karten geladen");
  assert.equal(CRAB_QUIZ.length, new Set(CRAB_QUIZ.map((c) => c.id)).size, "doppelte Quiz-IDs geladen");
  for (const c of CRAB_QUIZ) {
    assert.ok(c.id.length > 0);
    assert.ok(c.q.trim().length > 0, `${c.id}: leere Frage`);
    assert.ok(Array.isArray(c.options) && c.options.length >= 2, `${c.id}: <2 Optionen`);
    assert.ok(Number.isInteger(c.correct) && c.correct >= 0 && c.correct < c.options.length, `${c.id}: correct-Index außerhalb`);
    assert.ok(c.explain.trim().length > 0, `${c.id}: explain leer`);
  }
});

/* ---------- parseQuizCards: gültige Daten ---------- */

test("parseQuizCards: akzeptiert wohlgeformte Karte", () => {
  const cards = parseQuizCards([minimalQuiz]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].correct, 0);
  assert.equal(cards[0].options.length, 2);
  assert.equal(cards[0].introducedIn, undefined, "introducedIn ist optional (fehlt → undefined)");
});

test("parseQuizCards: übernimmt optionales introducedIn (#412)", () => {
  const cards = parseQuizCards([{ ...minimalQuiz, introducedIn: "docker-first-container" }]);
  assert.equal(cards[0].introducedIn, "docker-first-container");
});

test("parseQuizCards: wirft bei leerem introducedIn (mit Pfad)", () => {
  assert.throws(
    () => parseQuizCards([{ ...minimalQuiz, introducedIn: "" }]),
    (e: unknown) => e instanceof ContentValidationError && /quizcard q-x\.introducedIn/.test((e as Error).message),
  );
});

/* ---------- parseQuizCards: kaputte Daten MÜSSEN explizit werfen (Negativfälle) ---------- */

test("parseQuizCards: wirft bei Nicht-Array", () => {
  assert.throws(() => parseQuizCards({}), ContentValidationError);
});

test("parseQuizCards: wirft bei leerer Liste", () => {
  assert.throws(() => parseQuizCards([]), ContentValidationError);
});

test("parseQuizCards: wirft bei nur einer Option (mit Pfad)", () => {
  assert.throws(
    () => parseQuizCards([{ ...minimalQuiz, options: ["nur eine"] }]),
    (e: unknown) => e instanceof ContentValidationError && /quizcard q-x\.options/.test((e as Error).message),
  );
});

test("parseQuizCards: wirft bei correct-Index außerhalb der Optionen (mit Pfad)", () => {
  assert.throws(
    () => parseQuizCards([{ ...minimalQuiz, correct: 5 }]),
    (e: unknown) => e instanceof ContentValidationError && /quizcard q-x\.correct/.test((e as Error).message),
  );
});

test("parseQuizCards: wirft bei correct ohne Ganzzahl", () => {
  assert.throws(() => parseQuizCards([{ ...minimalQuiz, correct: 1.5 }]), ContentValidationError);
});

test("parseQuizCards: wirft bei fehlendem explain (mit Pfad)", () => {
  assert.throws(
    () => parseQuizCards([{ id: "q-x", q: "q", options: ["a", "b"], correct: 0 }]),
    (e: unknown) => e instanceof ContentValidationError && /quizcard q-x\.explain/.test((e as Error).message),
  );
});

/* ---------- assembleQuizCards: Thema-Listen zusammenführen ---------- */

test("assembleQuizCards: führt Thema-Listen zusammen, Reihenfolge bleibt erhalten", () => {
  const out = assembleQuizCards([[mkQuiz("q-1"), mkQuiz("q-2")], [mkQuiz("q-3")]]);
  assert.deepEqual(out.map((c) => c.id), ["q-1", "q-2", "q-3"]);
});

test("assembleQuizCards: wirft bei doppelter Quiz-ID über Thema-Dateien hinweg", () => {
  assert.throws(
    () => assembleQuizCards([[mkQuiz("q-dup")], [mkQuiz("q-dup")]]),
    (e: unknown) => e instanceof ContentValidationError && /doppelte Quiz-ID/.test((e as Error).message),
  );
});

/* ===================== Lazy-/memoisiertes Laden (#435) ===================== */

test("loader: lazy Sammlungen sind memoisiert – zwei Aufrufe liefern dieselbe Referenz (pro Sammlung nur einmal geparst)", () => {
  // get*() parst beim ERSTEN Aufruf und cached danach: zwei Aufrufe MÜSSEN exakt
  // dieselbe Array-Referenz liefern. Ein nicht-memoisierter (bei jedem Aufruf neu
  // parsender) Loader bräche das – die Red-Green-Absicherung der Lazy-Umstellung.
  assert.equal(getQuests(), getQuests(), "QUESTS nicht memoisiert (jeder Zugriff parst neu)");
  assert.equal(getCmdCards(), getCmdCards(), "CMD_CARDS nicht memoisiert");
  assert.equal(getQuizCards(), getQuizCards(), "CRAB_QUIZ nicht memoisiert");
  assert.equal(getQuestTopics(), getQuestTopics(), "QUEST_TOPICS nicht memoisiert");
});
