/* Tests für mehrere lokale Spielstände / Save-Slots (#306).
 *
 * Die Slot-Logik lebt bewusst in der Persistenz-Schicht (SaveStore): read/write/readState/
 * writeState routen auf den AKTIVEN Slot, ein kleiner Slot-Index (kubernia-slots-v1) hält
 * Liste + aktiven Zeiger. Backward-Kompatibilität ist der Kern: der Default-Slot ("slot-1")
 * speichert seine Daten unter dem bisherigen Einzel-Key (kubernia-save-v3) – ein bestehender
 * Stand ist damit ohne Kopieren/Bump automatisch "Slot 1", und solange es NUR den Default-Slot
 * gibt, wird gar kein Index geschrieben (Single-Slot bleibt byte-identisch zu vorher).
 *
 * Wie store.test.ts stubben wir window/localStorage selbst (kein jsdom) und importieren das
 * Modul je Test frisch (resetModules) – so ist der "Reload" über einen erneuten Import + init()
 * darstellbar, was Persistenz beweist.
 */
import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";

const SAVE_KEY = "kubernia-save-v3";        // = Daten-Key des Default-Slots (Legacy)
const SLOTS_KEY = "kubernia-slots-v1";
const DEFAULT_SLOT_ID = "slot-1";

function makeLocalStorageStub() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

/** localStorage, dessen ECHTE Schreibvorgänge scheitern (Quota voll) – nur die Init-Probe läuft. */
function makeQuotaStub() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (k === "__kubernia_probe__") { map.set(k, String(v)); return; }
      throw new Error("QuotaExceededError");
    },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/* ===================== localStorage-Modus (synchron, ohne IndexedDB) ===================== */

test("frisch: genau ein Default-Slot, kein Index in den Speicher geschrieben", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  expect(SaveStore.activeSlotId()).toBe(DEFAULT_SLOT_ID);
  expect(SaveStore.listSlots().map(s => s.id)).toEqual([DEFAULT_SLOT_ID]);
  // Reines Lesen darf den Speicher NICHT mit einem Index aufblähen (Single-Slot bleibt pristine).
  expect(ls._map.has(SLOTS_KEY)).toBe(false);
});

test("Default-Slot nutzt den Legacy-Key: ein bestehender Einzelstand ist automatisch Slot 1", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  // So liegt ein Vor-Slots-Stand vor: unter dem festen Einzel-Key, kein Index.
  ls._map.set(SAVE_KEY, JSON.stringify({ v: 3, data: { xp: 42, coins: 7 } }));

  expect(SaveStore.activeSlotId()).toBe(DEFAULT_SLOT_ID);
  expect(SaveStore.readState()).toEqual({ xp: 42, coins: 7 }); // ohne jede Migration lesbar
});

test("Single-Slot bleibt byte-identisch: writeState schreibt nur den Save-Key, keinen Index", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  SaveStore.writeState({ xp: 1 });
  expect(ls._map.has(SAVE_KEY)).toBe(true);   // Daten landen unter dem Legacy-Key
  expect(ls._map.has(SLOTS_KEY)).toBe(false); // kein Index, solange nur der Default-Slot existiert
});

test("createSlot: legt einen zweiten Slot an, persistiert den Index, wechselt aber NICHT", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const id = SaveStore.createSlot("Vorführung");
  expect(id).not.toBe(DEFAULT_SLOT_ID);
  expect(ls._map.has(SLOTS_KEY)).toBe(true); // ab dem 2. Slot existiert der Index
  const slots = SaveStore.listSlots();
  expect(slots.map(s => s.id)).toEqual([DEFAULT_SLOT_ID, id]);
  expect(slots.find(s => s.id === id)!.name).toBe("Vorführung");
  expect(SaveStore.activeSlotId()).toBe(DEFAULT_SLOT_ID); // createSlot wechselt nicht von selbst
});

test("Isolation: zwei Slots halten unabhängige Stände nebeneinander", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  SaveStore.writeState({ xp: 100 });            // Slot 1
  const id2 = SaveStore.createSlot("Zweiter");
  expect(SaveStore.switchSlot(id2)).toBe(true);
  expect(SaveStore.readState()).toBe(null);      // frischer, leerer Slot
  SaveStore.writeState({ xp: 5 });               // Slot 2

  expect(SaveStore.switchSlot(DEFAULT_SLOT_ID)).toBe(true);
  expect(SaveStore.readState()).toEqual({ xp: 100 }); // Slot 1 unberührt
  expect(SaveStore.switchSlot(id2)).toBe(true);
  expect(SaveStore.readState()).toEqual({ xp: 5 });   // Slot 2 unberührt
});

test("switchSlot persistiert den aktiven Zeiger über einen Reload hinweg", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  let id2: string;
  {
    const { SaveStore } = await import("../src/store");
    id2 = SaveStore.createSlot("Zweiter");
    expect(SaveStore.switchSlot(id2)).toBe(true);
  }
  // "Reload": frischer Modul-Stand, gleicher localStorage.
  vi.resetModules();
  const { SaveStore } = await import("../src/store");
  expect(SaveStore.activeSlotId()).toBe(id2);
});

test("switchSlot auf unbekannten Slot: false, aktiver Slot unverändert", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  SaveStore.createSlot("Zweiter");
  expect(SaveStore.switchSlot("gibt-es-nicht")).toBe(false);
  expect(SaveStore.activeSlotId()).toBe(DEFAULT_SLOT_ID);
});

test("deleteSlot: entfernt einen nicht-aktiven Slot samt seiner Daten", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const id2 = SaveStore.createSlot("Zweiter");
  SaveStore.switchSlot(id2);
  SaveStore.writeState({ xp: 9 });          // Slot 2 hat Daten unter seinem eigenen Key
  SaveStore.switchSlot(DEFAULT_SLOT_ID);
  const keyCountBefore = ls._map.size;

  expect(SaveStore.deleteSlot(id2)).toBe(true);
  expect(SaveStore.listSlots().map(s => s.id)).toEqual([DEFAULT_SLOT_ID]);
  expect(ls._map.size).toBeLessThan(keyCountBefore); // der Daten-Key von Slot 2 ist weg
});

test("deleteSlot des AKTIVEN Slots: fällt auf einen verbliebenen Slot zurück", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  SaveStore.writeState({ xp: 1 });       // Slot 1
  const id2 = SaveStore.createSlot("Zweiter");
  SaveStore.switchSlot(id2);
  SaveStore.writeState({ xp: 2 });       // Slot 2 aktiv

  expect(SaveStore.deleteSlot(id2)).toBe(true); // aktiven Slot löschen
  expect(SaveStore.activeSlotId()).toBe(DEFAULT_SLOT_ID); // fällt auf Slot 1 zurück
  expect(SaveStore.readState()).toEqual({ xp: 1 });        // dessen Stand ist intakt
});

test("deleteSlot auf unbekannten Slot: false, nichts ändert sich", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  SaveStore.createSlot("Zweiter");
  const before = SaveStore.listSlots().length;
  expect(SaveStore.deleteSlot("gibt-es-nicht")).toBe(false);
  expect(SaveStore.listSlots().length).toBe(before);
});

test("renameSlot: ändert den Namen; unbekannter Slot → false", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const id2 = SaveStore.createSlot("Alt");
  expect(SaveStore.renameSlot(id2, "Neu")).toBe(true);
  expect(SaveStore.listSlots().find(s => s.id === id2)!.name).toBe("Neu");
  expect(SaveStore.renameSlot("gibt-es-nicht", "X")).toBe(false);
});

test("kaputter Slot-Index: fällt sicher auf den Default-Slot zurück, kein Crash", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  ls._map.set(SLOTS_KEY, "{kaputt-kein-json");
  expect(SaveStore.activeSlotId()).toBe(DEFAULT_SLOT_ID);
  expect(SaveStore.listSlots().map(s => s.id)).toEqual([DEFAULT_SLOT_ID]);
});

test("setActiveSlotSummary: ohne Index No-op; mit Index landet die Vorschau am aktiven Slot", async () => {
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  // Single-Slot: keine Vorschau-Schreiberei, kein Index (kein Churn alle 5 s).
  SaveStore.setActiveSlotSummary({ xp: 1 });
  expect(ls._map.has(SLOTS_KEY)).toBe(false);

  // Sobald ein zweiter Slot existiert, wird die Vorschau am aktiven Slot vermerkt.
  SaveStore.createSlot("Zweiter");
  SaveStore.setActiveSlotSummary({ xp: 123, questIdx: 4 });
  const active = SaveStore.listSlots().find(s => s.id === SaveStore.activeSlotId())!;
  expect(active.summary).toEqual({ xp: 123, questIdx: 4 });
});

test("voller localStorage: Slot-Operationen crashen nicht", async () => {
  const ls = makeQuotaStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  expect(() => {
    const id = SaveStore.createSlot("Zweiter");
    SaveStore.switchSlot(id);
    SaveStore.renameSlot(id, "X");
    SaveStore.deleteSlot(id);
  }).not.toThrow();
});

/* ===================== IndexedDB-Modus (über fake-indexeddb) ===================== */

function stubWindowWithoutLocalStorage() {
  vi.stubGlobal("window", {
    get localStorage(): Storage { throw new Error("localStorage blockiert"); },
  });
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

test("IndexedDB: Slots + aktiver Zeiger überleben einen Reload (einziger Speicher = IndexedDB)", async () => {
  stubWindowWithoutLocalStorage();
  vi.resetModules();
  let id2: string;
  {
    const { SaveStore } = await import("../src/store");
    await SaveStore.init();
    SaveStore.writeState({ xp: 100 });        // Slot 1
    id2 = SaveStore.createSlot("Zweiter");
    SaveStore.switchSlot(id2);
    SaveStore.writeState({ xp: 5 });          // Slot 2
  }
  // "Reload": frischer Modul-Stand, leerer In-Memory-Speicher → nur IndexedDB bleibt.
  vi.resetModules();
  {
    const { SaveStore } = await import("../src/store");
    await SaveStore.init();
    expect(SaveStore.activeSlotId()).toBe(id2);
    expect(SaveStore.readState()).toEqual({ xp: 5 });   // aktiver Slot kam aus IndexedDB
    expect(SaveStore.switchSlot(DEFAULT_SLOT_ID)).toBe(true);
  }
  // Noch ein "Reload" – jetzt muss Slot 1 hydriert werden.
  vi.resetModules();
  const { SaveStore } = await import("../src/store");
  await SaveStore.init();
  expect(SaveStore.activeSlotId()).toBe(DEFAULT_SLOT_ID);
  expect(SaveStore.readState()).toEqual({ xp: 100 });
});
