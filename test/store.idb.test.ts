/* Tests für das IndexedDB-Backend der Persistenz-Schicht (#350).
 *
 * Die sync-API von SaveStore (read/write/readState/writeState) bleibt unverändert –
 * NEU ist nur, dass nach `await SaveStore.init()` IndexedDB als unbegrenztes, dauerhaftes
 * Backend dahinterliegt (synchroner In-Memory-Cache davor). Diese Datei deckt genau den
 * IndexedDB-Pfad ab; der reine localStorage-/In-Memory-Pfad steckt in store.test.ts.
 *
 * `fake-indexeddb` liefert ein vollständiges IndexedDB im Node-Test. Pro Test legen wir
 * eine FRISCHE IDBFactory an (leere DB-Welt), sodass sich Tests nicht beeinflussen.
 * Persistenz beweisen wir über einen simulierten „Reload": vi.resetModules() + erneuter
 * Import + init() startet store.ts mit leerem Modul-Cache neu – überlebt der Stand das,
 * lag er WIRKLICH in IndexedDB (und nicht nur im flüchtigen Modul-Cache).
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";

const SAVE_KEY = "kubernia-save-v3";       // muss zu store.ts passen
const DB_NAME = "kubernia";
const DB_VERSION = 1;
const STORE = "saves";

/** window-Stub MIT localStorage (Map-gestützt), inkl. Zugriff auf die rohe Map. */
function makeLocalStorageStub() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

/** localStorage, dessen ECHTE Schreibvorgänge scheitern (Quota voll) – nur die Init-Probe
 *  läuft durch. Simuliert den Stardew-Scale-Fall, in dem localStorage zu klein ist. */
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

/** window-Stub OHNE localStorage → store.ts fällt auf den In-Memory-Backend zurück.
 *  Damit ist IndexedDB der EINZIGE dauerhafte Speicher: was einen „Reload" überlebt,
 *  kam zwingend aus IndexedDB. */
function stubWindowWithoutLocalStorage() {
  vi.stubGlobal("window", {
    get localStorage(): Storage { throw new Error("localStorage blockiert"); },
  });
}

/* ----- direkter IndexedDB-Zugriff im Test (umgeht SaveStore, prüft die DB selbst) ----- */

function openTestDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function directWriteIdb(key: string, value: string): Promise<void> {
  const db = await openTestDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

/** Liest direkt aus IndexedDB. Wartet implizit auf alle vorherigen readwrite-Transaktionen
 *  (IndexedDB serialisiert nach Scope), eignet sich also auch als „settle"-Punkt nach den
 *  fire-and-forget-Schreibvorgängen von SaveStore. */
async function directReadIdb(key: string): Promise<string | null> {
  const db = await openTestDb();
  const v = await new Promise<string | null>((res, rej) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => res(typeof req.result === "string" ? req.result : null);
    req.onerror = () => rej(req.error);
  });
  db.close();
  return v;
}

beforeEach(() => {
  // Frische, leere IndexedDB-Welt pro Test (über vi.stubGlobal, damit afterEach sie räumt).
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

test("init(): schaltet auf IndexedDB – writeState überlebt einen Neustart (ohne localStorage)", async () => {
  stubWindowWithoutLocalStorage(); // einziger dauerhafter Speicher = IndexedDB
  vi.resetModules();
  {
    const { SaveStore } = await import("../src/store");
    await SaveStore.init();
    expect(SaveStore.writeState({ xp: 42, coins: 7 })).toBe(true);
    expect(SaveStore.readState()).toEqual({ xp: 42, coins: 7 }); // synchron aus dem Cache
  }
  await directReadIdb(SAVE_KEY); // settle: wartet, bis der fire-and-forget-Put committet ist

  // „Reload": frischer Modul-Stand, leerer In-Memory-Backend – nur IndexedDB bleibt.
  vi.resetModules();
  const { SaveStore } = await import("../src/store");
  await SaveStore.init();
  expect(SaveStore.readState()).toEqual({ xp: 42, coins: 7 }); // kam aus IndexedDB
});

test("init(): migriert einen bestehenden localStorage-Stand einmalig nach IndexedDB", async () => {
  const ls = makeLocalStorageStub();
  // Vorhandener Stand aus der localStorage-Ära (aktuelle Versions-Hülle).
  const raw = JSON.stringify({ v: 3, data: { xp: 5, questIdx: 2 } });
  ls._map.set(SAVE_KEY, raw);
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await SaveStore.init(); // IndexedDB leer + localStorage hat Stand → Migration

  expect(await directReadIdb(SAVE_KEY)).toBe(raw); // liegt jetzt 1:1 in IndexedDB
  expect(SaveStore.readState()).toEqual({ xp: 5, questIdx: 2 }); // und ist normal lesbar
});

test("Fallback: ohne IndexedDB bleibt der synchrone localStorage-Modus aktiv", async () => {
  vi.stubGlobal("indexedDB", undefined); // IndexedDB nicht verfügbar
  const ls = makeLocalStorageStub();
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await SaveStore.init(); // No-op, darf nicht werfen

  expect(SaveStore.writeState({ xp: 1 })).toBe(true);
  expect(SaveStore.readState()).toEqual({ xp: 1 });
  expect(ls._map.has(SAVE_KEY)).toBe(true); // landet weiterhin in localStorage
});

test("Limit aufgehoben: voller localStorage + IndexedDB → großer Stand wird trotzdem gespeichert (#350)", async () => {
  // Das Kernversprechen des Tickets: localStorage ist zu klein, IndexedDB rettet es.
  // Mit dem ALTEN store.ts (nur localStorage) wäre writeState hier false und readState null.
  const quota = makeQuotaStub();
  vi.stubGlobal("window", { localStorage: quota });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();

  const bigState = { deck: "x".repeat(6 * 1024 * 1024) }; // ~6 MB, über dem localStorage-Limit
  {
    const { SaveStore } = await import("../src/store");
    await SaveStore.init(); // IndexedDB aktiv (localStorage leer + Quota)
    expect(SaveStore.writeState(bigState)).toBe(true);     // gelingt – via IndexedDB
    expect(SaveStore.readState()).toEqual(bigState);       // synchron aus dem Cache
  }
  await directReadIdb(SAVE_KEY); // settle

  // „Reload": der große Stand muss aus IndexedDB zurückkommen, obwohl localStorage ihn nie hielt.
  vi.resetModules();
  const { SaveStore } = await import("../src/store");
  await SaveStore.init();
  expect(SaveStore.readState()).toEqual(bigState);
  expect(quota._map.has(SAVE_KEY)).toBe(false); // localStorage hat den großen Stand NIE bekommen
  warn.mockRestore();
});

test("Backup-Slot greift auch im IndexedDB-Modus (Alt-Stand wird vor Migration gesichert)", async () => {
  stubWindowWithoutLocalStorage();
  // Alt-Stand der Format-Version 0 (blanker GameState ohne Hülle) direkt in IndexedDB legen.
  const legacyRaw = JSON.stringify({ xp: 999, coins: 5 });
  await directWriteIdb(SAVE_KEY, legacyRaw);
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await SaveStore.init(); // hydriert den Cache aus IndexedDB (legacyRaw)

  expect(SaveStore.readBackup()).toBe(null);          // vorher nichts gesichert
  expect(SaveStore.readState()).toEqual({ xp: 999, coins: 5 }); // migriert (v0 → aktuell)
  expect(SaveStore.readBackup()).toBe(legacyRaw);     // Original vor dem Überschreiben gesichert
  expect(await directReadIdb("kubernia-save-backup-v1")).toBe(legacyRaw); // Backup liegt in IndexedDB
});

test("init() ist idempotent – ein zweiter Aufruf ändert nichts und wirft nicht", async () => {
  stubWindowWithoutLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  await SaveStore.init();
  SaveStore.writeState({ xp: 3 });
  await expect(SaveStore.init()).resolves.toBeUndefined(); // zweiter Aufruf: No-op
  expect(SaveStore.readState()).toEqual({ xp: 3 });        // Stand unangetastet
});

test("remove(): löscht den Stand aus IndexedDB (Reset lässt nichts zurück)", async () => {
  stubWindowWithoutLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  await SaveStore.init();
  SaveStore.writeState({ xp: 88 });
  expect(SaveStore.readState()).toEqual({ xp: 88 });

  SaveStore.remove();
  expect(SaveStore.read()).toBe(null);                 // synchron sofort weg
  expect(await directReadIdb(SAVE_KEY)).toBe(null);    // auch aus IndexedDB entfernt
});
