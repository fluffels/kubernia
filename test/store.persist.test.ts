/* Tests für den Eviction-Schutz der Persistenz-Schicht (#401).
 *
 * Browser-Speicher ist "geliehen, nicht besessen": unter Speicherdruck löscht der Browser
 * best-effort-Origins per LRU komplett (IndexedDB-Spielstand inklusive). `SaveStore`
 * fordert deshalb beim Boot über `navigator.storage.persist()` dauerhaften Speicher an und
 * meldet über `navigator.storage.estimate()` ein knapp werdendes Kontingent zurück, bevor
 * ein QuotaExceededError den Auto-Save reißt. Diese Datei deckt genau diesen Pfad ab.
 *
 * Die Storage-Manager-API existiert im Node-Test nicht – wir stubben `navigator.storage`
 * pro Test mit kontrollierten Funktionen (und Spies, um Doppel-Anfragen auszuschließen).
 * Wie die anderen store-Tests importieren wir das Modul je Test frisch (resetModules).
 */
import { test, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

test("persist gewährt: markiert den Speicher als dauerhaft (kein LRU-Evict)", async () => {
  const persist = vi.fn().mockResolvedValue(true);
  const persisted = vi.fn().mockResolvedValue(false);
  const estimate = vi.fn().mockResolvedValue({ usage: 1000, quota: 1_000_000 });
  vi.stubGlobal("navigator", { storage: { persist, persisted, estimate } });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const h = await SaveStore.requestPersistentStorage();
  expect(h.persistSupported).toBe(true);
  expect(h.persisted).toBe(true);
  expect(persist).toHaveBeenCalledTimes(1); // einmal angefragt
  expect(h.nearQuota).toBe(false);          // viel Platz frei
});

test("schon dauerhaft: persist() wird NICHT erneut angefragt (kein unnötiger Prompt)", async () => {
  const persist = vi.fn().mockResolvedValue(true);
  const persisted = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("navigator", { storage: { persist, persisted } });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const h = await SaveStore.requestPersistentStorage();
  expect(h.persisted).toBe(true);
  expect(persist).not.toHaveBeenCalled(); // Firefox würde sonst erneut prompten
});

test("persist abgelehnt: kein Crash, Spiel läuft (ungeschützt) weiter", async () => {
  const persist = vi.fn().mockResolvedValue(false);
  const persisted = vi.fn().mockResolvedValue(false);
  vi.stubGlobal("navigator", { storage: { persist, persisted } });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const h = await SaveStore.requestPersistentStorage();
  expect(h.persistSupported).toBe(true);
  expect(h.persisted).toBe(false);
});

test("persist wirft: wird abgefangen (persisted=false), kein throw", async () => {
  const persist = vi.fn().mockRejectedValue(new Error("nope"));
  const persisted = vi.fn().mockResolvedValue(false);
  vi.stubGlobal("navigator", { storage: { persist, persisted } });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  await expect(SaveStore.requestPersistentStorage()).resolves.toMatchObject({ persisted: false });
});

test("API fehlt komplett (kein navigator.storage): sauberer No-op, alles neutral", async () => {
  vi.stubGlobal("navigator", {}); // kein .storage (alter Browser / file://)
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const h = await SaveStore.requestPersistentStorage();
  expect(h).toEqual({
    persistSupported: false,
    persisted: false,
    usage: null,
    quota: null,
    usageRatio: null,
    nearQuota: false,
  });
});

test("estimate: knappes Kontingent (>=80%) → nearQuota=true (früh warnen)", async () => {
  const estimate = vi.fn().mockResolvedValue({ usage: 90, quota: 100 });
  vi.stubGlobal("navigator", { storage: { persisted: vi.fn().mockResolvedValue(true), estimate } });
  vi.resetModules();
  const { SaveStore, QUOTA_WARN_RATIO } = await import("../src/store");

  expect(QUOTA_WARN_RATIO).toBe(0.8);
  const h = await SaveStore.requestPersistentStorage();
  expect(h.usage).toBe(90);
  expect(h.quota).toBe(100);
  expect(h.usageRatio).toBeCloseTo(0.9);
  expect(h.nearQuota).toBe(true);
});

test("estimate: viel Platz (<80%) → nearQuota=false", async () => {
  const estimate = vi.fn().mockResolvedValue({ usage: 10, quota: 100 });
  vi.stubGlobal("navigator", { storage: { persisted: vi.fn().mockResolvedValue(true), estimate } });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const h = await SaveStore.requestPersistentStorage();
  expect(h.usageRatio).toBeCloseTo(0.1);
  expect(h.nearQuota).toBe(false);
});

test("estimate wirft/fehlt: usageRatio null, nearQuota false, kein throw", async () => {
  const estimate = vi.fn().mockRejectedValue(new Error("nope"));
  vi.stubGlobal("navigator", { storage: { persisted: vi.fn().mockResolvedValue(true), estimate } });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const h = await SaveStore.requestPersistentStorage();
  expect(h.usage).toBe(null);
  expect(h.usageRatio).toBe(null);
  expect(h.nearQuota).toBe(false);
});

test("estimate mit quota=0: keine Division durch null, usageRatio null", async () => {
  const estimate = vi.fn().mockResolvedValue({ usage: 5, quota: 0 });
  vi.stubGlobal("navigator", { storage: { persisted: vi.fn().mockResolvedValue(true), estimate } });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const h = await SaveStore.requestPersistentStorage();
  expect(h.usageRatio).toBe(null);
  expect(h.nearQuota).toBe(false);
});
