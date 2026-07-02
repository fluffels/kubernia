/* Deterministischer Mechanismus-Test für flushIdb() – der Reset/Reload-Race-Fix (#473).
 *
 * `fake-indexeddb` committet Transaktionen quasi sofort (auf Mikro-Task-Ebene) und
 * serialisiert obendrein jeden Lesezugriff hinter ausstehende Schreibvorgänge. Damit lässt
 * sich der EIGENTLICHE Race (ein `location.reload()`, das den async Commit überholt, weil
 * die Seite abgebaut wird, bevor IndexedDB committet) verhaltensbasiert NICHT nachstellen –
 * jeder Test-Read „settlet" die Transaktion und maskiert den Bug.
 *
 * Darum prüfen wir die Zusage hier white-box am Backend selbst: flushIdb() darf erst
 * resolven, wenn die ausstehende readwrite-Transaktion committet. Über eine KONTROLLIERTE
 * Fake-DB (deren `tx.oncomplete` wir von Hand feuern) ist der Zeitpunkt exakt steuerbar –
 * das ist der einzige deterministische Weg, „flush wartet" von „flush ist ein No-op" zu
 * unterscheiden (Red-Green: ein No-op-flushIdb resolved sofort und macht diesen Test rot).
 */
import { test, expect } from "vitest";
import { activateIdb, rawSet, flushIdb } from "../src/store/backend";

/** Minimale, von Hand steuerbare IDB-Fake: put() ist ein No-op, den Commit lösen WIR über
 *  `commit()` aus (feuert das von trackWrite() gesetzte `tx.oncomplete`). */
function makeControllableDb(): { db: IDBDatabase; commit: () => void } {
  const tx = {
    oncomplete: null as (() => void) | null,
    onerror: null,
    onabort: null,
    objectStore: () => ({ put() { /* No-op */ } }),
  };
  const db = { transaction: () => tx } as unknown as IDBDatabase;
  return { db, commit: () => tx.oncomplete?.() };
}

test("flushIdb(): resolved erst, wenn die ausstehende Transaktion committet (#473)", async () => {
  const { db, commit } = makeControllableDb();
  activateIdb(db); // Backend in den IndexedDB-Modus zwingen

  rawSet("kubernia-save-v3", "irgendein-stand"); // → idbPut → trackWrite registriert tx

  let resolved = false;
  const flushed = flushIdb().then(() => { resolved = true; });

  await Promise.resolve(); // Mikro-Tasks abarbeiten lassen
  await Promise.resolve();
  expect(resolved).toBe(false); // Transaktion NOCH nicht committet → flush wartet

  commit();          // jetzt den Commit signalisieren
  await flushed;
  expect(resolved).toBe(true); // flush hat NACH dem Commit resolved
});
