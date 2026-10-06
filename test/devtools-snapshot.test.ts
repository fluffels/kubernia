import { describe, it, expect } from "vitest";
import { buildDevSnapshot, isDevViewable, DEV_SNAPSHOT_VERSION, type DevSnapshotSource } from "../src/devtools/snapshot";
import { TILE } from "../src/world/world";
import { HAZARD_UNLOCK } from "../src/world/hazards";

function src(over: Partial<DevSnapshotSource> = {}): DevSnapshotSource {
  return {
    scenes: ["World"], scene: "World", map: "harbor",
    player: { x: 8 * TILE + 8, y: 5 * TILE + 8, face: "down", moving: false },
    readyLatched: false,
    currentQuestId: "onboarding-sign-on", questIdx: 0, questStep: 0, questTask: 0,
    stepType: "dialog", taskText: null,
    activeQuests: { "onboarding-sign-on": { step: 0, task: 0 } },
    completedQuestCount: 0,
    dialogue: null, overlays: [], blocking: false,
    clock: { day: 1, hhmm: "06:00", weekday: "Mo", seasonName: "Frühling", gameDays: 0 },
    coins: 40, xp: 0,
    hazards: { pirate: null, kraken: null, storm: null },
    ...over,
  };
}

describe("buildDevSnapshot (#1284)", () => {
  it("Happy Path: Version, Szene, Spieler samt Kachel", () => {
    const s = buildDevSnapshot(src());
    expect(s.v).toBe(DEV_SNAPSHOT_VERSION);
    expect(s.scene).toBe("World");
    expect(s.map).toBe("harbor");
    expect(s.player).toEqual({ x: 136, y: 88, tx: 8, ty: 5, face: "down", moving: false });
    expect(s.ready).toBe(true);
    expect(s.quest).toMatchObject({ id: "onboarding-sign-on", idx: 0, step: 0 });
    expect(s.clock).toEqual({ day: 1, hhmm: "06:00", weekday: "Mo", season: "Frühling", gameDays: 0 });
    expect(s.coins).toBe(40);
  });

  it("Kachel wird abgeschnitten, nicht gerundet (x = 8.9 Kacheln → tx 8)", () => {
    const s = buildDevSnapshot(src({ player: { x: 8.9 * TILE, y: 0, face: "up", moving: true } }));
    expect(s.player?.tx).toBe(8);
  });

  it("Endzustand (currentQuestId leer) → quest null", () => {
    expect(buildDevSnapshot(src({ currentQuestId: "" })).quest).toBeNull();
  });

  it("ohne Spielszene/Spieler: player/scene null, ready false", () => {
    const s = buildDevSnapshot(src({ scenes: ["Boot"], scene: null, map: null, player: null }));
    expect(s.player).toBeNull();
    expect(s.scene).toBeNull();
    expect(s.ready).toBe(false);
  });

  it("eingerastetes ready bleibt wahr, auch ohne Spieler (Szenenwechsel)", () => {
    expect(buildDevSnapshot(src({ player: null, readyLatched: true })).ready).toBe(true);
  });

  it("nicht-endliche Koordinaten → player null statt NaN im JSON", () => {
    expect(buildDevSnapshot(src({ player: { x: NaN, y: 1, face: "down", moving: false } })).player).toBeNull();
    expect(buildDevSnapshot(src({ player: { x: 1, y: Infinity, face: "down", moving: false } })).player).toBeNull();
  });

  it("activeQuests sind nach id sortiert", () => {
    const s = buildDevSnapshot(src({ activeQuests: { z: { step: 1, task: 0 }, a: { step: 2, task: 1 }, m: { step: 0, task: 0 } } }));
    expect(s.activeQuests).toEqual([{ id: "a", step: 2, task: 1 }, { id: "m", step: 0, task: 0 }, { id: "z", step: 1, task: 0 }]);
  });

  it("Dialog: read / choice / menu", () => {
    const read = buildDevSnapshot(src({ dialogue: { npcId: "ole", lines: ["a", "b"], idx: 1, choice: null } })).dialog;
    expect(read).toEqual({ npcId: "ole", line: "b", lines: 2, kind: "read" });
    const choice = buildDevSnapshot(src({ dialogue: { npcId: "ole", lines: [], idx: 0, choice: { q: "Was ist ein Pod?" } } })).dialog;
    expect(choice).toEqual({ npcId: "ole", line: "Was ist ein Pod?", lines: 0, kind: "choice" });
    const menu = buildDevSnapshot(src({ dialogue: { npcId: "ole", lines: [], idx: 0, choice: { menu: true } } })).dialog;
    expect(menu?.kind).toBe("menu");
    expect(buildDevSnapshot(src()).dialog).toBeNull();
  });

  it("Lese-Dialog mit Index außerhalb der Zeilen liefert leere Zeile statt undefined", () => {
    expect(buildDevSnapshot(src({ dialogue: { npcId: "x", lines: ["a"], idx: 5, choice: null } })).dialog?.line).toBe("");
  });

  it("hazards: nur aktive, in fester Reihenfolge", () => {
    expect(buildDevSnapshot(src()).hazards).toEqual([]);
    const h = buildDevSnapshot(src({ hazards: { pirate: { until: 1 }, kraken: null, storm: { until: 2 } } })).hazards;
    expect(h).toEqual(["storm", "pirate"]); // Reihenfolge von HAZARD_UNLOCK
  });

  it("hazards: jede Art einzeln aktiv ergibt genau diese Art (Arten kommen aus HAZARD_UNLOCK)", () => {
    for (const kind of Object.keys(HAZARD_UNLOCK) as (keyof typeof HAZARD_UNLOCK)[]) {
      const hazards = { pirate: null, kraken: null, storm: null, [kind]: { until: 1 } };
      expect(buildDevSnapshot(src({ hazards })).hazards, kind).toEqual([kind]);
    }
  });

  it("hazards: unbekannte Zusatzschlüssel tauchen nicht auf, falsy-Werte zählen als inaktiv", () => {
    const hazards = { pirate: 0, kraken: undefined, storm: null, ufo: { until: 1 } };
    expect(buildDevSnapshot(src({ hazards })).hazards).toEqual([]);
  });

  it("isDevViewable erkennt nur Objekte mit devView()-Methode", () => {
    expect(isDevViewable({ devView: () => ({ map: null, player: null }) })).toBe(true);
    for (const bad of [null, undefined, 5, "x", {}, { devView: 1 }]) expect(isDevViewable(bad), String(bad)).toBe(false);
  });

  it("Vollabbild: jedes Feld kommt aus der passenden Quelle (unterscheidbare Werte)", () => {
    const s = buildDevSnapshot(src({
      scenes: ["Interior", "World"], scene: "Interior", map: "interior:haus",
      player: { x: 8.6 * TILE, y: 5.6 * TILE, face: "west", moving: true },
      currentQuestId: "q-x", questIdx: 4, questStep: 2, questTask: 1, stepType: "terminal", taskText: "tippe help",
      activeQuests: { "q-x": { step: 2, task: 1 } }, completedQuestCount: 3,
      dialogue: { npcId: "ole", lines: [], idx: 0, choice: { menu: true } },
      overlays: ["menu", "shop"], blocking: true,
      clock: { day: 3, hhmm: "14:30", weekday: "Mi", seasonName: "Sommer", gameDays: 2.5 },
      coins: 77, xp: 7,
      hazards: { pirate: null, kraken: { until: 1 }, storm: null },
    }));
    expect(s).toEqual({
      v: DEV_SNAPSHOT_VERSION, ready: true,
      scenes: ["Interior", "World"], scene: "Interior", map: "interior:haus",
      player: { x: Math.round(8.6 * TILE), y: Math.round(5.6 * TILE), tx: 8, ty: 5, face: "west", moving: true },
      quest: { id: "q-x", idx: 4, step: 2, task: 1, stepType: "terminal", taskText: "tippe help" },
      activeQuests: [{ id: "q-x", step: 2, task: 1 }],
      completedQuests: 3,
      dialog: { npcId: "ole", line: "", lines: 0, kind: "menu" },
      overlays: ["menu", "shop"], blocking: true,
      clock: { day: 3, hhmm: "14:30", weekday: "Mi", season: "Sommer", gameDays: 2.5 },
      coins: 77, xp: 7,
      hazards: ["kraken"],
    });
  });

  it("überlebt einen JSON-Roundtrip unverändert", () => {
    const s = buildDevSnapshot(src({ dialogue: { npcId: "ole", lines: ["x"], idx: 0, choice: null }, overlays: ["menu"], blocking: true }));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
