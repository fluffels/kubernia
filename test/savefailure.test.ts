/* Tests für die Save-Fehler-Behandlung der Persistenz-Methoden (#585, Forts. #497).
 * Kernfrage: Ein fehlgeschlagener Schreibvorgang (voller localStorage-Fallback,
 * QuotaExceeded) darf NICHT still verpuffen – jeder Schreibpfad (save/reset/
 * importData/jumpToQuest→save) muss den Fehlschlag über den Save-Fehler-Sink an den
 * Spieler heben UND seinen bool-Rückgabewert auswerten (vorher werteten reset()/
 * importData() ihn gar nicht aus, importData gab `void` zurück).
 *
 * Jeder Test lädt den Spiel-Stack FRISCH (resetModules), damit das modul-lokale
 * saveFailedNotified-Flag (Einmal-pro-Episode-Meldung) sauber getrennt ist –
 * dieselbe Isolations-Disziplin wie store.test.ts. */
import { test, expect, vi, afterEach } from "vitest";
import { stubWindowLocalStorage, type LocalStorageStub } from "./support/browser-env";
import { makeQuotaStub } from "./support/quota-stub";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Lädt den Spiel-Stack frisch (window muss vorher gestubbt sein) und registriert einen
 *  zählenden Save-Fehler-Sink an DERSELBEN runtime-Instanz, die die Anwendung nutzt.
 *  Gibt Game + einen Zähler der Meldungen zurück. */
async function loadWithSink() {
  vi.resetModules();
  const { Game } = await import("../src/game");
  const runtime = await import("../src/runtime");
  let notified = 0;
  runtime.setSaveFailedSink(() => { notified++; });
  return { Game, sink: () => notified };
}

test("importData: voller Speicher → false UND Spieler wird gemeldet (#585)", async () => {
  stubWindowLocalStorage(makeQuotaStub());
  const { Game, sink } = await loadWithSink();

  const ok = Game.importData(JSON.stringify({ v: 1, data: { xp: 5 } }));

  expect(ok).toBe(false);   // vorher: void (undefined) – der Rückgabewert fehlte ganz
  expect(sink()).toBe(1);   // Fehlschlag an die Präsentation gehoben statt verschluckt
});

test("importData: erfolgreicher Import liefert true (#585)", async () => {
  stubWindowLocalStorage();                 // normaler, funktionierender Stub
  const { Game, sink } = await loadWithSink();

  expect(Game.importData(JSON.stringify({ v: 1, data: { xp: 5 } }))).toBe(true);
  expect(sink()).toBe(0);                   // kein Fehlschlag → keine Meldung
});

test("save: voller Speicher → false, aber nur EINE Meldung pro Fehler-Episode (#585/#497)", async () => {
  stubWindowLocalStorage(makeQuotaStub());
  const { Game, sink } = await loadWithSink();

  expect(Game.save()).toBe(false);
  expect(Game.save()).toBe(false);          // jeder Autosave-Tick scheitert sauber
  expect(sink()).toBe(1);                    // aber der Spieler wird nicht im Sekundentakt zugespammt
});

test("save: nach einem geglückten Save re-armt die Meldung für einen neuen Fehlschlag (#497)", async () => {
  // Stub, dessen Schreib-Fehlschlag zur Laufzeit umschaltbar ist (Init-Probe läuft immer durch).
  let fail = true;
  const map = new Map<string, string>();
  const toggle: LocalStorageStub = {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      if (k === "__kubernia_probe__") { map.set(k, String(v)); return; }
      if (fail) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
  stubWindowLocalStorage(toggle);
  const { Game, sink } = await loadWithSink();

  expect(Game.save()).toBe(false);
  expect(sink()).toBe(1);                    // erster Fehlschlag: gemeldet
  fail = false;
  expect(Game.save()).toBe(true);            // wieder erfolgreich → re-armt
  fail = true;
  expect(Game.save()).toBe(false);
  expect(sink()).toBe(2);                     // neuer Fehlschlag wird ERNEUT gemeldet
});

test("reset: ein scheiternder Save wird dem Spieler gemeldet, statt still zu verpuffen (#585)", async () => {
  stubWindowLocalStorage(makeQuotaStub());
  const { Game, sink } = await loadWithSink();

  Game.reset();

  expect(sink()).toBeGreaterThanOrEqual(1);  // reset() lief über persistState → Meldung
});

test("jumpToQuest: scheiternder Save → false (nicht blind true) + Meldung (#585)", async () => {
  stubWindowLocalStorage(makeQuotaStub());
  const { Game, sink } = await loadWithSink();

  expect(Game.jumpToQuest(3)).toBe(false);   // vorher: immer true, egal ob persistiert
  expect(sink()).toBe(1);                     // Spieler gemeldet (save(false) hob den Fehlschlag)
});

test("jumpToQuest: gültiger Sprung liefert bei funktionierendem Speicher weiterhin true (#585 kein Regress)", async () => {
  stubWindowLocalStorage();
  const { Game } = await loadWithSink();

  expect(Game.jumpToQuest(3)).toBe(true);
});
