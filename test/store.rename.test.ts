/* Tests für die Namensraum-Rename-Migration KubeQuest → Kubernia (#557).
 *
 * Der Rename zieht die persistente Storage-Identität um: Save-Keys `kubequest-*` → `kubernia-*`
 * und den IndexedDB-DB-Namen `kubequest` → `kubernia`. Weil „was live geht, darf NIE einen
 * bestehenden Stand brechen" (AGENTS.md), MUSS ein Alt-Stand aus der KubeQuest-Ära verlustfrei
 * in den neuen Namensraum wandern. Diese Datei beweist genau das – für BEIDE Backends:
 *   • localStorage-Modus (kein IndexedDB): deterministische Slot-Key-Migration.
 *   • IndexedDB-Modus: Umzug aus der Alt-DB "kubequest" in die neue DB "kubernia".
 * inkl. der Sicherheits-Eigenschaften: no-clobber (ein vorhandener Neu-Stand wird nie
 * überschrieben) und der Alt-Bestand bleibt als Netz erhalten.
 *
 * Wie store.idb.test.ts stubben wir window/localStorage/indexedDB selbst und importieren das
 * Modul je Test frisch (resetModules) – ein erneuter Import + init() ist der simulierte "Boot".
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ABBREVS } from "../src/content/abbrev";

// Neue (Kubernia-)Identität – muss zu store.ts passen.
const SAVE_KEY = "kubernia-save-v3";
const BACKUP_KEY = "kubernia-save-backup-v1";
const SLOTS_KEY = "kubernia-slots-v1";
const DB_NAME = "kubernia";
// Alte (KubeQuest-)Identität – so lag ein Stand VOR dem Rename #557 vor.
const OLD_SAVE_KEY = "kubequest-save-v3";
const OLD_SLOTS_KEY = "kubequest-slots-v1";
const OLD_DB_NAME = "kubequest";
const DB_VERSION = 1;
const STORE = "saves";

// Ein ECHTER, voller Alt-Stand (aktuelle Format-Version) – beweist, dass nicht nur ein
// Spielzeug-Payload, sondern ein realistischer Spielstand den Namensraum-Umzug übersteht.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixtureRaw = readFileSync(join(FIXTURES, "savegame-v5-current.json"), "utf8").trim();
const fixtureData = JSON.parse(fixtureRaw).data as unknown;

// #574: die Migration (v6->v7) hebt das alte additive unlockedAbbrev/abbrevUsage dieses
// Fixture-Stands ("-a"/"-n" verdient+gekauft, "docker-ps-all": 5 Nutzungen) in die Komfort-
// Kauf-Mechanik (owned/unlockedComfort/comfortUsage) – das ist die nach readState() erwartete
// Form (cmdHistoryUnlocked bleibt auf DIESER rohen Store-Ebene unverändert liegen, sanitizeState
// in game/save.ts liest/verwirft es erst später).
const { unlockedAbbrev: _fixtureUnlockedAbbrev, abbrevUsage: _fixtureAbbrevUsage, ...fixtureRest } =
  fixtureData as Record<string, unknown>;
const migratedFixtureData = {
  ...fixtureRest,
  owned: [...(fixtureRest.owned as string[]), "-a", "-n"],
  unlockedComfort: ["-a", "-n"],
  comfortUsage: { "docker-ps-all": 5 },
};

/** #574: ein minimaler `{ xp }`-Testpayload OHNE unlockedAbbrev-Feld ist (bei xp>0) genau der
 *  uralte Vor-#297-Fall, den migrations[6] grandfathert – alle aktuellen Abkürzungen gelten
 *  dann als verdient+gekauft. Diese Datei prüft die Namensraum-Migration, nicht die Abkürzungs-
 *  Mechanik; der Helfer hält die dadurch nötige Zusatz-Erwartung an einer Stelle. */
function grandfathered(xp: number) {
  return { xp, owned: ABBREVS.map(a => a.id), unlockedComfort: ABBREVS.map(a => a.id), comfortUsage: {} };
}

function makeLocalStorageStub() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

function stubWindowWithoutLocalStorage() {
  vi.stubGlobal("window", {
    get localStorage(): Storage { throw new Error("localStorage blockiert"); },
  });
}

/* ----- direkter IndexedDB-Zugriff im Test, für eine BELIEBIGE DB (umgeht SaveStore) ----- */

function openNamedDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function directWrite(dbName: string, key: string, value: string): Promise<void> {
  const db = await openNamedDb(dbName);
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

async function directRead(dbName: string, key: string): Promise<string | null> {
  const db = await openNamedDb(dbName);
  const v = await new Promise<string | null>((res, rej) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => res(typeof req.result === "string" ? req.result : null);
    req.onerror = () => rej(req.error);
  });
  db.close();
  return v;
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory()); // frische, leere IndexedDB-Welt pro Test
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/* ===================== localStorage-Modus (ohne IndexedDB) ===================== */

test("localStorage: ein echter Alt-Stand unter kubequest-save-v3 wird nach kubernia-save-v3 gehoben", async () => {
  vi.stubGlobal("indexedDB", undefined); // reiner localStorage-Modus
  const ls = makeLocalStorageStub();
  ls._map.set(OLD_SAVE_KEY, fixtureRaw); // Stand aus der KubeQuest-Ära
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await SaveStore.init(); // No-op fürs Backend, aber die Namensraum-Migration läuft

  expect(ls._map.get(SAVE_KEY)).toBe(fixtureRaw);     // liegt jetzt unter dem neuen Key
  expect(ls._map.get(OLD_SAVE_KEY)).toBe(fixtureRaw); // Alt-Key bleibt als Netz erhalten
  expect(SaveStore.readState()).toEqual(migratedFixtureData); // und ist voll lesbar (+ #574-Migration)
});

test("localStorage: Mehr-Slot-Alt-Stand (Index + Slot-2-Daten) wird komplett migriert", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const ls = makeLocalStorageStub();
  ls._map.set(OLD_SLOTS_KEY, JSON.stringify({ activeId: "slot-1", slots: [{ id: "slot-1", name: "A" }, { id: "slot-2", name: "B" }] }));
  ls._map.set(OLD_SAVE_KEY, JSON.stringify({ v: 5, data: { xp: 1 } }));            // Slot 1
  ls._map.set(OLD_SAVE_KEY + ":slot-2", JSON.stringify({ v: 5, data: { xp: 2 } })); // Slot 2
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await SaveStore.init();

  expect(ls._map.get(SLOTS_KEY)).toBeTruthy();                       // Index gehoben
  expect(SaveStore.listSlots().map(s => s.id)).toEqual(["slot-1", "slot-2"]);
  expect(SaveStore.readState()).toEqual(grandfathered(1));           // aktiver Slot 1 (+ #574)
  expect(SaveStore.switchSlot("slot-2")).toBe(true);
  expect(SaveStore.readState()).toEqual(grandfathered(2));           // Slot-2-Daten mitmigriert (+ #574)
});

test("localStorage no-clobber: ein bereits vorhandener kubernia-Stand wird NICHT überschrieben", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const ls = makeLocalStorageStub();
  ls._map.set(OLD_SAVE_KEY, JSON.stringify({ v: 5, data: { xp: 999 } })); // Alt-Stand
  ls._map.set(SAVE_KEY, JSON.stringify({ v: 5, data: { xp: 1 } }));       // neuerer Kubernia-Stand
  vi.stubGlobal("window", { localStorage: ls });
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await SaveStore.init();

  expect(SaveStore.readState()).toEqual(grandfathered(1)); // Neu-Key gewinnt, Migration klobbert nicht (+ #574)
});

/* ===================== IndexedDB-Modus (DB-Rename) ===================== */

test("IndexedDB: ein echter Alt-Stand in DB 'kubequest' wird in die DB 'kubernia' gehoben", async () => {
  stubWindowWithoutLocalStorage(); // einziger dauerhafter Speicher = IndexedDB
  await directWrite(OLD_DB_NAME, OLD_SAVE_KEY, fixtureRaw); // Stand in der Alt-DB
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await SaveStore.init(); // migriert DB "kubequest" → DB "kubernia"

  expect(SaveStore.readState()).toEqual(migratedFixtureData);   // synchron aus dem Cache lesbar (+ #574)
  expect(await directRead(DB_NAME, SAVE_KEY)).toBe(fixtureRaw);  // liegt in der neuen DB
  expect(await directRead(OLD_DB_NAME, OLD_SAVE_KEY)).toBe(fixtureRaw); // Alt-DB unangetastet (Netz)
});

test("IndexedDB no-clobber: eine bereits befüllte 'kubernia'-DB wird NICHT aus 'kubequest' überschrieben", async () => {
  stubWindowWithoutLocalStorage();
  await directWrite(OLD_DB_NAME, OLD_SAVE_KEY, JSON.stringify({ v: 5, data: { xp: 999 } })); // Alt-DB
  await directWrite(DB_NAME, SAVE_KEY, JSON.stringify({ v: 5, data: { xp: 1 } }));           // neue DB schon befüllt
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await SaveStore.init();

  expect(SaveStore.readState()).toEqual(grandfathered(1)); // Ziel-DB behält ihren Stand (+ #574)
});

test("IndexedDB: ohne Alt-DB startet das Spiel frisch (keine Phantom-Migration, kein Crash)", async () => {
  stubWindowWithoutLocalStorage();
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await expect(SaveStore.init()).resolves.toBeUndefined();
  expect(SaveStore.readState()).toBe(null); // nichts zu migrieren
  // Nach frischem Start ist normales Speichern möglich (Backend aktiv).
  expect(SaveStore.writeState({ xp: 7 })).toBe(true);
  expect(SaveStore.readState()).toEqual({ xp: 7 });
});

test("IndexedDB: Backup-Key des Alt-Stands wandert mit (voller Bestand wird kopiert)", async () => {
  stubWindowWithoutLocalStorage();
  const legacyRaw = JSON.stringify({ v: 5, data: { xp: 3 } });
  const legacyBackup = JSON.stringify({ v: 5, data: { xp: 2 } });
  await directWrite(OLD_DB_NAME, OLD_SAVE_KEY, legacyRaw);
  await directWrite(OLD_DB_NAME, "kubequest-save-backup-v1", legacyBackup);
  vi.resetModules();

  const { SaveStore } = await import("../src/store");
  await SaveStore.init();

  expect(await directRead(DB_NAME, SAVE_KEY)).toBe(legacyRaw);
  expect(await directRead(DB_NAME, BACKUP_KEY)).toBe(legacyBackup); // Backup unter neuem Namen
});
