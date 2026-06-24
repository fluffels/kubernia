/* Tests für die Wiederspiel-Sandbox (#332, Stufe 2 aus #326).
 *
 * Eine abgeschlossene Quest lässt sich erneut spielen, OHNE den Live-Stand zu
 * zerstören: Beim Reinspringen wird der komplette Live-Spielstand als Lesezeichen
 * in den ARBEITSSPEICHER geklont; solange das Lesezeichen gesetzt ist, ist save()
 * ein No-Op (kein Auto-Save, keine doppelte XP/Wirtschaft). Beim Beenden wird das
 * Lesezeichen 1:1 zurückgespielt – man landet exakt an der gemerkten Live-Position.
 *
 * Bewusst auch Negativfälle: nicht abgeschlossene/ungültige Quest, doppeltes
 * Reinspringen, Beenden ohne laufendes Wiederspiel.
 *
 * Harness wie game.test.ts: window/localStorage stubben, Game dynamisch importieren.
 */
import { test, expect, beforeAll, beforeEach } from "vitest";
import { vi } from "vitest";
import { KQContent } from "../src/content";

let Game: typeof import("../src/game").Game;
let Sim: typeof import("../src/sim").Sim;
let SaveStore: typeof import("../src/store").SaveStore;

beforeAll(async () => {
  const map = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
    },
  });
  ({ Game } = await import("../src/game"));
  ({ Sim } = await import("../src/sim"));
  ({ SaveStore } = await import("../src/store"));
});

beforeEach(() => {
  Game.replayBookmark = null; // ein evtl. offenes Wiederspiel des Vortests lösen, sonst bleibt save() ein No-Op
  Game.reset();               // frischer Default-Spielstand
  Game.sim = new Sim({});     // leerer Cluster als bekannte Basis
});

/** Tiefe Kopie eines beliebigen serialisierbaren Werts (für „vorher == nachher"). */
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

test("startReplay: springt an den Anfang einer abgeschlossenen Quest und merkt das Lesezeichen (RAM)", () => {
  Game.jumpToQuest(3);                 // q0..q2 erledigt, aktuell q3
  Game.state.questStep = 2;            // mittendrin in q3
  Game.state.player = { x: 123, y: 456 };
  Game.save(false);
  const persistedBefore = clone(SaveStore.readState());

  const ok = Game.startReplay(1);      // q1 wiederspielen
  expect(ok).toBe(true);
  expect(Game.isReplaying()).toBe(true);
  expect(Game.state.questIdx).toBe(1);
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[1].id);
  expect(Game.state.questStep).toBe(0);

  // Der echte Save wurde NICHT angefasst (immer noch q3-Stand).
  expect(SaveStore.readState()).toEqual(persistedBefore);
});

test("startReplay funktioniert für JEDE abgeschlossene Quest – unabhängig vom repeatable-Flag (#410)", () => {
  Game.jumpToQuest(3);                 // q0..q2 erledigt (keine ist repeatable)
  expect(KQContent.QUESTS[2].repeatable).toBeFalsy();
  expect(Game.startReplay(2)).toBe(true);   // trotzdem wiederspielbar (Sandbox ≠ Live-startQuest)
});

test("Wiederspiel: save() ist ein No-Op – keine doppelte XP/Wirtschaft im echten Stand", () => {
  Game.jumpToQuest(3);
  Game.state.xp = 100; Game.state.coins = 50;
  Game.save(false);
  const before = clone(SaveStore.readState());

  Game.startReplay(2);
  // Im Wiederspiel XP/Münzen „kassieren", Müll in completedQuests, und speichern:
  Game.state.xp += 999;
  Game.state.coins += 999;
  Game.state.completedQuests.push("sandbox-junk");
  Game.save();

  expect(SaveStore.readState()).toEqual(before); // echter Save unverändert
});

test("endReplay: stellt Position + questIdx + questStep des Live-Stands exakt wieder her und persistiert", () => {
  Game.jumpToQuest(4);
  Game.state.questStep = 1;
  Game.state.player = { x: 222, y: 333 };
  Game.state.xp = 777;
  const liveCompleted = clone(Game.state.completedQuests);
  Game.save(false);

  Game.startReplay(0);
  Game.state.xp += 5000;       // im Wiederspiel verdient -> muss verfallen
  Game.state.questStep = 9;
  Game.state.completedQuests.push("sandbox-junk");

  const ok = Game.endReplay();
  expect(ok).toBe(true);
  expect(Game.isReplaying()).toBe(false);
  expect(Game.state.questIdx).toBe(4);
  expect(Game.state.questStep).toBe(1);
  expect(Game.state.player).toEqual({ x: 222, y: 333 });
  expect(Game.state.xp).toBe(777);                       // keine Wiederspiel-XP
  expect(Game.state.completedQuests).toEqual(liveCompleted); // kein Sandbox-Müll
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[4].id);

  // Der wiederhergestellte Stand ist jetzt auch persistiert.
  expect((SaveStore.readState() as { currentQuestId?: string }).currentQuestId).toBe(KQContent.QUESTS[4].id);
});

test("startReplay: nicht abgeschlossene/ungültige Quest oder laufendes Wiederspiel -> false, kein Effekt", () => {
  Game.jumpToQuest(3);                 // q3 aktuell, NICHT abgeschlossen
  const snap = clone(Game.state);

  expect(Game.startReplay(3)).toBe(false);   // q3 nicht abgeschlossen
  expect(Game.startReplay(999)).toBe(false); // ungültiger Index
  expect(Game.startReplay(-1)).toBe(false);  // ungültiger Index
  expect(Game.isReplaying()).toBe(false);
  expect(Game.state).toEqual(snap);          // Stand unangetastet

  expect(Game.startReplay(1)).toBe(true);    // jetzt ein gültiges Wiederspiel
  expect(Game.startReplay(2)).toBe(false);   // ein zweites blockt, solange eines läuft
  Game.endReplay();
});

test("endReplay: ohne laufendes Wiederspiel -> false", () => {
  expect(Game.isReplaying()).toBe(false);
  expect(Game.endReplay()).toBe(false);
});

/* #451: Bos einmaliger Kralle-Wegweiser nur beim ALLERERSTEN Abschluss der
 * Docker-Einstiegsquest – nicht in der Sandbox-Wiederholung. Die UI hängt den
 * Hinweistext an, wenn pointsToKralleAfterFirstQuest() true ist. */
const FIRST_QUEST_IDX = KQContent.QUESTS.findIndex(q => q.id === "docker-first-container");

test("#451: pointsToKralleAfterFirstQuest – true am letzten Schritt der Docker-Einstiegsquest (Erstdurchlauf)", () => {
  expect(FIRST_QUEST_IDX).toBeGreaterThanOrEqual(0);
  const quest = KQContent.QUESTS[FIRST_QUEST_IDX];
  Game.jumpToQuest(FIRST_QUEST_IDX);
  Game.state.questStep = quest.steps.length - 1;   // Bos Abschiedsworte
  expect(Game.isReplaying()).toBe(false);
  expect(Game.pointsToKralleAfterFirstQuest()).toBe(true);
});

test("#451: pointsToKralleAfterFirstQuest – false vor dem letzten Schritt", () => {
  Game.jumpToQuest(FIRST_QUEST_IDX);
  Game.state.questStep = 0;                          // ganz am Anfang
  expect(Game.pointsToKralleAfterFirstQuest()).toBe(false);
});

test("#451: pointsToKralleAfterFirstQuest – false in einer anderen Quest", () => {
  Game.jumpToQuest(FIRST_QUEST_IDX + 1);             // nächste Quest, letzter Schritt
  const q = Game.currentQuest()!;
  Game.state.questStep = q.steps.length - 1;
  expect(q.id).not.toBe("docker-first-container");
  expect(Game.pointsToKralleAfterFirstQuest()).toBe(false);
});

test("#451: pointsToKralleAfterFirstQuest – false im Wiederspiel der Einstiegsquest (nicht bei Wiederholung)", () => {
  Game.jumpToQuest(FIRST_QUEST_IDX + 1);             // Einstiegsquest damit abgeschlossen
  expect(Game.startReplay(FIRST_QUEST_IDX)).toBe(true);
  Game.state.questStep = KQContent.QUESTS[FIRST_QUEST_IDX].steps.length - 1;
  expect(Game.isReplaying()).toBe(true);
  expect(Game.pointsToKralleAfterFirstQuest()).toBe(false);
  Game.endReplay();
});
