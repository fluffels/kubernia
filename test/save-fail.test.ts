/* #497: Ein fehlgeschlagener save() (voller localStorage im Fallback-Modus,
 * QuotaExceeded) war für den Spieler unsichtbar – writeState meldete ihn nur einmalig
 * in die Konsole. Jetzt hebt die Anwendung den Fehlschlag entkoppelt über den
 * Laufzeit-Sink (runtime.ts) an die Präsentation. Hier prüfen wir die Anwendungs-Seite:
 * save() ruft den Sink bei Fehlschlag genau EINMAL pro Fehler-Episode (der 5-s-Auto-Save
 * darf nicht im Sekundentakt warnen) und re-armt nach einem wieder geglückten Save.
 *
 * Bewusst gegen echtes Verhalten getestet, nicht gegen Interna: ein umschaltbarer
 * localStorage-Stub lässt Schreibvorgänge je nach `fail`-Flag scheitern oder gelingen. */
import { test, expect, afterEach, vi } from "vitest";
import { stubWindowLocalStorage, loadGameStack, type LocalStorageStub } from "./support/browser-env";
import { makeQuotaStub } from "./support/quota-stub";

/** Wie makeQuotaStub, aber zur Laufzeit umschaltbar: solange `ctl.fail` true ist,
 *  scheitert jeder echte Schreibvorgang (QuotaExceeded); auf false gelingt er. Die
 *  Init-Probe läuft immer durch (localStorage gilt als grundsätzlich verfügbar). */
function makeToggleStub(): { stub: LocalStorageStub; ctl: { fail: boolean } } {
  const map = new Map<string, string>();
  const ctl = { fail: true };
  const stub: LocalStorageStub = {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      if (k === "__kq_probe__") { map.set(k, String(v)); return; }
      if (ctl.fail) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
  return { stub, ctl };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

test("save(): voller localStorage-Fallback meldet den Fehlschlag EINMAL an den Sink", async () => {
  stubWindowLocalStorage(makeQuotaStub()); // jeder echte Schreibvorgang scheitert (QuotaExceeded)
  vi.resetModules();
  const { Game } = await loadGameStack();
  const { setSaveFailedSink } = await import("../src/runtime");

  const sink = vi.fn();
  setSaveFailedSink(sink);

  Game.save();
  Game.save();
  Game.save();

  // Dreimal gescheitert, aber nur EINE Spieler-Meldung (kein Sekundentakt-Spam).
  expect(sink).toHaveBeenCalledTimes(1);

  setSaveFailedSink(null);
});

test("save(): kein Sink-Aufruf, solange das Schreiben klappt", async () => {
  stubWindowLocalStorage(); // frischer Stub – Schreiben gelingt
  vi.resetModules();
  const { Game } = await loadGameStack();
  const { setSaveFailedSink } = await import("../src/runtime");

  const sink = vi.fn();
  setSaveFailedSink(sink);

  Game.save();
  Game.save();

  expect(sink).not.toHaveBeenCalled();

  setSaveFailedSink(null);
});

test("save(): nach einem wieder geglückten Save wird ein NEUER Fehlschlag erneut gemeldet", async () => {
  const { stub, ctl } = makeToggleStub();
  stubWindowLocalStorage(stub);
  vi.resetModules();
  const { Game } = await loadGameStack();
  const { setSaveFailedSink } = await import("../src/runtime");

  const sink = vi.fn();
  setSaveFailedSink(sink);

  ctl.fail = true;
  Game.save();
  Game.save();
  expect(sink).toHaveBeenCalledTimes(1); // erste Fehler-Episode: eine Meldung

  ctl.fail = false;
  Game.save();                            // Schreiben gelingt → Meldung wird re-armt
  expect(sink).toHaveBeenCalledTimes(1);  // Erfolg selbst meldet nichts

  ctl.fail = true;
  Game.save();
  expect(sink).toHaveBeenCalledTimes(2);  // NEUE Fehler-Episode → erneut gemeldet

  setSaveFailedSink(null);
});
