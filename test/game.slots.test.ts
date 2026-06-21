/* Tests für die Slot-Orchestrierung in der Game-Fassade (#306).
 * game.ts kennt nur „aktiver Slot": newSlot/switchSlot/renameSlot/deleteSlot delegieren an
 * SaveStore, slots() leitet die Anzeige (Rang/Quest-Titel) aus den Roh-Zahlen ab. Jeder Test
 * läuft mit frischem Modul + eigenem localStorage-Stub, damit sich die Slots nicht vermischen.
 */
import { test, expect, vi, afterEach } from "vitest";
import { KQContent } from "../src/content";

function freshWindow() {
  const map = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
    },
  });
  return map;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function freshGame() {
  freshWindow();
  vi.resetModules();
  const { Game } = await import("../src/game");
  Game.load();
  return Game;
}

test("slots(): frisch genau ein aktiver, neuer Default-Slot", async () => {
  const Game = await freshGame();
  const slots = Game.slots();
  expect(slots).toHaveLength(1);
  expect(slots[0].active).toBe(true);
  expect(slots[0].isNew).toBe(true);                       // character null nach frischem Laden
  expect(slots[0].questTotal).toBe(KQContent.QUESTS.length);
});

test("newSlot + switchSlot: unabhängige Stände, Wechsel zurück erhält den Fortschritt", async () => {
  const Game = await freshGame();
  Game.state.xp = 500;
  Game.state.character = 0; // als „gespielt" markieren
  Game.save();

  Game.newSlot("Vorführung");
  Game.load(); // simuliert den Reload nach dem Wechsel
  expect(Game.state.xp).toBe(0); // frischer, leerer Slot

  expect(Game.switchSlot("slot-1")).toBe(true);
  Game.load();
  expect(Game.state.xp).toBe(500); // Slot 1 ist unberührt geblieben
});

test("slots(): nicht-aktiver Slot zeigt seine gespeicherte Vorschau, aktiver den Live-Zustand", async () => {
  const Game = await freshGame();
  Game.state.xp = 320;
  Game.state.character = 0;
  Game.save();

  const id2 = Game.newSlot("Zweiter"); // stempelt Slot 1 (xp 320), wechselt auf Slot 2
  Game.load();                          // aktiv = Slot 2 (frisch)

  const slots = Game.slots();
  const s1 = slots.find((s) => s.id === "slot-1")!;
  const s2 = slots.find((s) => s.id === id2)!;
  expect(s1.active).toBe(false);
  expect(s1.xp).toBe(320);  // aus der gespeicherten Vorschau
  expect(s2.active).toBe(true);
  expect(s2.isNew).toBe(true);
});

test("renameSlot: neuer Name erscheint in slots(); unbekannte ID → false", async () => {
  const Game = await freshGame();
  const id2 = Game.newSlot("Alt");
  Game.load();
  expect(Game.renameSlot(id2, "Neu")).toBe(true);
  expect(Game.slots().find((s) => s.id === id2)!.name).toBe("Neu");
  expect(Game.renameSlot("gibt-es-nicht", "X")).toBe(false);
});

test("deleteSlot: nicht-aktiv → reload:false; aktiv → reload:true + Rückfall auf Default", async () => {
  const Game = await freshGame();
  const id2 = Game.newSlot("Zweiter");
  Game.load(); // aktiv = Slot 2

  // Slot 1 ist nicht aktiv → kein Reload nötig.
  expect(Game.deleteSlot("slot-1")).toEqual({ ok: true, reload: false });
  expect(Game.slots().some((s) => s.id === "slot-1")).toBe(false);

  // Slot 2 ist aktiv → Löschen verschiebt den aktiven Zeiger, Aufrufer muss neu laden.
  const r2 = Game.deleteSlot(id2);
  expect(r2.ok).toBe(true);
  expect(r2.reload).toBe(true);
});
