/* Tests für die Persistenz-Schicht (SaveStore).
 * store.ts greift beim Laden auf window.localStorage zu – im Node-Testlauf
 * stubben wir window selbst, statt jsdom als Dependency reinzuholen.
 * Jeder Test importiert das Modul frisch (resetModules), damit der In-Memory-
 * Fallback und der localStorage-Pfad sauber getrennt geprüft werden.
 */
import { test, expect, vi, afterEach } from "vitest";
import { stubWindowLocalStorage } from "./support/browser-env";
import { makeQuotaStub } from "./support/quota-stub";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

test("SaveStore: write/read/remove-Runde über localStorage", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  expect(SaveStore.read()).toBe(null);            // frisch: noch nichts gespeichert
  SaveStore.write('{"xp":42}');
  expect(SaveStore.read()).toBe('{"xp":42}');      // exakt das Geschriebene zurück
  expect(ls._map.size).toBe(1);                    // landet wirklich im localStorage
  SaveStore.remove();
  expect(SaveStore.read()).toBe(null);             // nach remove wieder weg
});

test("SaveStore: schreibt unter genau einem, stabilen Schlüssel", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  SaveStore.write("a");
  SaveStore.write("b"); // zweites Schreiben überschreibt, legt keinen zweiten Key an
  expect(ls._map.size).toBe(1);
  expect(SaveStore.read()).toBe("b");
});

test("SaveStore: fällt auf In-Memory zurück, wenn localStorage blockiert ist", async () => {
  // Privater Modus / blockierte Cookies: localStorage-Zugriff wirft.
  // Das Spiel darf NICHT crashen, sondern muss flüchtig weiterspeichern.
  vi.stubGlobal("window", {
    get localStorage(): Storage { throw new Error("localStorage blockiert"); },
  });
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  expect(SaveStore.read()).toBe(null);
  SaveStore.write("im-speicher");
  expect(SaveStore.read()).toBe("im-speicher"); // In-Memory-Fallback funktioniert
  SaveStore.remove();
  expect(SaveStore.read()).toBe(null);
});

/* ===== Versionierte Spielstände (readState/writeState + Migration) ===== */

const SAVE_KEY = "kubequest-save-v3"; // muss zum Key in store.ts passen

test("writeState: legt den Stand in einer Versions-Hülle { v, data } ab", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore, CURRENT_SAVE_VERSION } = await import("../src/store");

  SaveStore.writeState({ xp: 42 });
  expect(ls._map.size).toBe(1); // weiterhin genau ein Key

  const raw = JSON.parse(ls._map.get(SAVE_KEY)!);
  expect(raw.v).toBe(CURRENT_SAVE_VERSION); // Version steht in der Hülle
  expect(raw.data).toEqual({ xp: 42 });     // Nutzlast liegt unter data, nicht roh
});

test("readState: Roundtrip mit writeState gibt den Stand zurück, nicht die Hülle", async () => {
  stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  expect(SaveStore.readState()).toBe(null); // frisch: noch nichts gespeichert
  const state = { xp: 7, coins: 40, owned: ["pet"] };
  SaveStore.writeState(state);
  expect(SaveStore.readState()).toEqual(state); // genau der Stand, ohne v/data drumherum
});

test("readState: migriert einen Alt-Stand OHNE Hülle (Version 0) verlustfrei", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  // So sah ein Stand vor der Versionierung aus: blanker GameState direkt unter dem Key.
  const legacy = { xp: 999, coins: 5, questIdx: 3 };
  ls._map.set(SAVE_KEY, JSON.stringify(legacy));

  // Wird als Version 0 erkannt und unverändert auf das aktuelle Format gehoben.
  expect(SaveStore.readState()).toEqual(legacy);
});

test("readState: kaputte Datei führt zu frischem Start (null), nicht zum Crash", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  ls._map.set(SAVE_KEY, "{kaputt-kein-json"); // halbe/zerschossene Datei
  expect(SaveStore.readState()).toBe(null);
});

test("readState: unbekannt neue Version crasht nicht, liefert die Nutzlast best effort", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  // Stand aus einer FUTURE-Version (z.B. neuerer Build): wir können nicht runter-
  // migrieren, dürfen aber nicht crashen und nicht den Stand wegwerfen.
  const future = { xp: 123 };
  ls._map.set(SAVE_KEY, JSON.stringify({ v: 999, data: future }));
  expect(SaveStore.readState()).toEqual(future);
});

/* ===== Schreibsicherheit: voller/blockierter Speicher darf nicht crashen ===== */

test("write: voller localStorage (QuotaExceeded) crasht NICHT, gibt false zurück", async () => {
  stubWindowLocalStorage(makeQuotaStub());
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  let result: boolean | undefined;
  // Darf KEINE Exception werfen (sonst reißt der Aufrufer / Auto-Save).
  expect(() => { result = SaveStore.write("zu-gross"); }).not.toThrow();
  expect(result).toBe(false);             // Fehlschlag wird gemeldet, nicht verschluckt
  expect(SaveStore.read()).toBe(null);    // nichts wurde unter dem Save-Key abgelegt
  expect(warn).toHaveBeenCalledTimes(1);  // einmalige Warnung, kein Spam
});

test("writeState: voller localStorage crasht NICHT, gibt false zurück und warnt nur einmal", async () => {
  stubWindowLocalStorage(makeQuotaStub());
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  expect(() => SaveStore.writeState({ xp: 1 })).not.toThrow();
  expect(SaveStore.writeState({ xp: 2 })).toBe(false); // jeder Auto-Save-Tick scheitert sauber
  expect(SaveStore.readState()).toBe(null);            // nichts persistiert
  expect(warn).toHaveBeenCalledTimes(1);               // trotz mehrfachem Scheitern nur 1x gewarnt
});

test("write/writeState: bei erfolgreichem Speichern wird true zurückgegeben", async () => {
  stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  expect(SaveStore.write("ok")).toBe(true);
  expect(SaveStore.writeState({ xp: 5 })).toBe(true);
});

/* ===== Backup-Slot: kein Stand geht durch Migration/Verwerfen verloren ===== */

test("readState: sichert einen migrierten Alt-Stand (v0) vor dem Überschreiben ins Backup", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const legacyRaw = JSON.stringify({ xp: 999, coins: 5 });
  ls._map.set(SAVE_KEY, legacyRaw);

  expect(SaveStore.readBackup()).toBe(null); // vorher nichts gesichert
  SaveStore.readState();                     // migriert → muss Original sichern
  expect(SaveStore.readBackup()).toBe(legacyRaw); // Original-Rohdatei liegt im Backup
});

test("readState: sichert eine kaputte Datei ins Backup, statt sie verloren zu geben", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const corruptRaw = "{kaputt-kein-json";
  ls._map.set(SAVE_KEY, corruptRaw);

  expect(SaveStore.readState()).toBe(null);          // frischer Start
  expect(SaveStore.readBackup()).toBe(corruptRaw);   // aber die Rohdatei ist gerettet
});

test("readState: sichert einen Zukunfts-Stand (v>CURRENT) vor dem Herunterstufen ins Backup", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  const futureRaw = JSON.stringify({ v: 999, data: { xp: 123 } });
  ls._map.set(SAVE_KEY, futureRaw);

  SaveStore.readState(); // best effort zurückgeben, aber Original sichern (sonst Downgrade-Verlust)
  expect(SaveStore.readBackup()).toBe(futureRaw);
});

test("readState: ein v1-Stand wird auf das aktuelle Format migriert und vorher gesichert (#353)", async () => {
  const ls = stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore, CURRENT_SAVE_VERSION } = await import("../src/store");

  // #353 hat das Format auf v2 gehoben (Quest-Fortschritt zusätzlich als ID). Ein v1-Stand
  // ist also älter als CURRENT -> wird gesichert. Die ID-Ableitung selbst macht game.ts
  // (deckt auch den JSON-Import ab), darum bleibt die store-Migration strukturell ein No-op:
  // die Nutzlast kommt unverändert zurück, nur in den Backup-Slot kopiert.
  expect(CURRENT_SAVE_VERSION).toBeGreaterThanOrEqual(2);
  const v1Raw = JSON.stringify({ v: 1, data: { xp: 5, questIdx: 2 } });
  ls._map.set(SAVE_KEY, v1Raw);

  expect(SaveStore.readState()).toEqual({ xp: 5, questIdx: 2 }); // Daten unverändert
  expect(SaveStore.readBackup()).toBe(v1Raw);                    // Original gesichert
});

test("readState: ein Roundtrip in aktueller Version legt KEIN Backup an", async () => {
  stubWindowLocalStorage();
  vi.resetModules();
  const { SaveStore } = await import("../src/store");

  SaveStore.writeState({ xp: 7 }); // schreibt in aktueller Version
  SaveStore.readState();           // keine Migration nötig
  expect(SaveStore.readBackup()).toBe(null); // also auch kein unnötiges Verdoppeln
});
