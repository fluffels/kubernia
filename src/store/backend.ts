/* ===== Kubernia – Persistenz: Backend + synchrones IO (#515) =====
 * Die unterste Persistenz-Schicht: WOHIN geschrieben wird und WIE synchron gelesen/
 * geschrieben wird – ohne jedes Wissen über Save-Slots, Versionierung oder Quota.
 *
 * Backend (#350): primär IndexedDB (praktisch kein Speicher-Limit, hebt die
 * ~5–10 MB-Decke von localStorage für Stardew-Scale-Stände). Fallback: localStorage
 * bzw. flüchtiger In-Memory-Speicher.
 *
 * Knackpunkt: IndexedDB ist ASYNCHRON, die SaveStore-API ist synchron und wird an
 * vielen Stellen synchron aufgerufen (u.a. Game.load() beim Boot, der 5-s-Auto-Save,
 * exportData()). Statt die halbe Codebasis auf async umzustellen (großer Ripple,
 * Risiko für bestehende Stände), liegt vor IndexedDB ein synchroner In-Memory-Cache:
 *   • hydrate() zieht einen Key beim Boot EINMAL aus IndexedDB (async) in den Cache,
 *   • danach lesen rawGet() synchron aus dem Cache,
 *   • rawSet() aktualisiert den Cache synchron UND spiegelt den Wert asynchron
 *     (fire-and-forget) nach IndexedDB.
 * IndexedDB ist damit die maßgebliche, unbegrenzte Quelle, der Cache nur ihr
 * synchrones Spiegelbild für diese Sitzung.
 *
 * Ist IndexedDB nicht verfügbar (privater Modus, alter Browser, file://-Offline-Build,
 * Node-Tests ohne Polyfill) ODER schlägt das Öffnen fehl, bleibt der Store im
 * bisherigen, voll synchronen localStorage-Modus – der IndexedDB-Modus wird dann nie
 * aktiviert (activateIdb bleibt ungenutzt). So bricht nichts und der bestehende
 * Code-/Testpfad ist unverändert.
 */

// localStorage ist nicht überall verfügbar (privater Modus, blockierte Cookies,
// Node-Tests). Dann fallen wir auf einen flüchtigen In-Memory-Speicher zurück,
// damit das Spiel weiterläuft – nur eben ohne Speichern über die Sitzung hinaus.
const backend = (function () {
  try {
    const probe = "__kubernia_probe__";
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const mem: Record<string, string> = Object.create(null);
    return {
      getItem: (k: string) => (k in mem ? mem[k] : null),
      setItem: (k: string, v: string) => { mem[k] = String(v); },
      removeItem: (k: string) => { delete mem[k]; },
    };
  }
})();

/** Direkter (uncachender) Lesezugriff auf das rohe localStorage/In-Memory-Backend.
 *  Nur für die Boot-Migrationen (Namensraum-Rename #557), die VOR der IndexedDB-
 *  Hydration am rohen localStorage arbeiten. */
export function lsGet(key: string): string | null {
  return backend.getItem(key);
}
/** Direkter (uncachender) Schreibzugriff auf das rohe Backend. Nur für die Boot-Migrationen. */
export function lsSet(key: string, value: string): void {
  backend.setItem(key, value);
}

// Schreiben kann auch ZUR LAUFZEIT fehlschlagen, obwohl die Init-Probe oben durchlief:
// localStorage hat ein Kontingent (meist ~5 MB) – ist es voll, wirft setItem einen
// QuotaExceededError. Ein echter Nutzer mit wachsendem Stand läuft da irgendwann rein,
// und der Fehler würde sonst durch den 5-Sekunden-Auto-Save propagieren und das Spiel
// reißen. Deshalb fängt safeSet jeden Schreibfehler ab, meldet ihn EINMALIG (nicht im
// 5-s-Takt) und gibt zurück, ob das Schreiben geklappt hat.
// (Im IndexedDB-Modus ist genau dieses Kontingent kein Thema mehr – siehe unten.)
let warnedWriteFailed = false;
function safeSet(key: string, value: string): boolean {
  try {
    backend.setItem(key, value);
    return true;
  } catch (e) {
    if (!warnedWriteFailed) {
      warnedWriteFailed = true;

      console.warn("SaveStore: Speichern fehlgeschlagen (localStorage voll/blockiert?) – Spiel läuft weiter, dieser Stand wurde nicht persistiert.", e);
    }
    return false;
  }
}

/* ===== IndexedDB-Backend (#350) ===== */

export const DB_NAME = "kubernia";
export const DB_VERSION = 1;
export const OBJECT_STORE = "saves"; // ein simpler Key→Wert-Store; Keys = Save-/Backup-/Slot-Index-Keys

// idb != null ⇔ „IndexedDB-Modus aktiv" (init() lief erfolgreich durch). cache ist
// dann die synchrone Lese-/Schreibspiegelung; im Legacy-Modus wird er nie benutzt.
const cache = new Map<string, string>();
let idb: IDBDatabase | null = null;
let warnedIdbWriteFailed = false;

// Ausstehende (fire-and-forget) IndexedDB-Schreibvorgänge. flushIdb() wartet darauf,
// damit ein Reload (Reset/Slot-Wechsel/Import) den async Commit NICHT überholt und
// hinterher einen Alt-Stand zurückliest (#473). Jede readwrite-Transaktion registriert
// hier eine Zusage, die entfernt wird, sobald sie committet/scheitert.
const pendingWrites = new Set<Promise<void>>();

/** true, sobald der IndexedDB-Modus aktiv ist (für die Idempotenz von init()). */
export function idbActive(): boolean {
  return idb != null;
}

/** Den IndexedDB-Modus aktivieren – erst NACH erfolgreicher Hydration aufrufen, damit
 *  kein synchroner Leser je einen leeren Cache sieht. Ab jetzt routen rawGet/rawSet/
 *  rawRemove über Cache + IndexedDB statt über localStorage. */
export function activateIdb(db: IDBDatabase): void {
  idb = db;
}

/** Die IndexedDB-Factory holen – globalThis deckt Browser (window.indexedDB) UND
 *  Tests (fake-indexeddb) ab. null, wenn IndexedDB nicht existiert/zugreifbar ist. */
export function getIndexedDB(): IDBFactory | null {
  try {
    const g = globalThis as unknown as { indexedDB?: IDBFactory };
    return g.indexedDB ?? null;
  } catch {
    return null;
  }
}

/** Öffnet (bzw. legt an) die Datenbank. Resolved IMMER – mit der DB oder null
 *  (nicht verfügbar / Fehler / blockiert). Wirft nie. */
export function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const factory = getIndexedDB();
    if (!factory) { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** Einen Wert async aus IndexedDB lesen. Resolved mit dem String oder null. Wirft nie. */
function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(OBJECT_STORE, "readonly").objectStore(OBJECT_STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Registriert eine readwrite-Transaktion als „ausstehend", bis sie committet oder
 *  scheitert. Die Zusage resolved IMMER (auch bei Fehler/Abbruch, dann zusätzlich
 *  gemeldet) – ein fehlschlagender Persist darf flushIdb() nicht hängen lassen. */
function trackWrite(tx: IDBTransaction): void {
  const done = new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => { warnIdbWrite(tx.error); resolve(); };
    tx.onabort = () => { warnIdbWrite(tx.error); resolve(); };
  });
  pendingWrites.add(done);
  void done.then(() => pendingWrites.delete(done));
}

/** Wert async nach IndexedDB schreiben (fire-and-forget). Fehler werden EINMALIG
 *  gemeldet und nie geworfen – ein fehlschlagender Persist darf den synchronen
 *  Aufrufer (Auto-Save) nicht reißen; der Cache hält den Wert für die Sitzung. */
function idbPut(db: IDBDatabase, key: string, value: string): void {
  try {
    const tx = db.transaction(OBJECT_STORE, "readwrite");
    tx.objectStore(OBJECT_STORE).put(value, key);
    trackWrite(tx);
  } catch (e) {
    warnIdbWrite(e);
  }
}

/** Wert async aus IndexedDB löschen (fire-and-forget, fehlertolerant). */
function idbDelete(db: IDBDatabase, key: string): void {
  try {
    const tx = db.transaction(OBJECT_STORE, "readwrite");
    tx.objectStore(OBJECT_STORE).delete(key);
    trackWrite(tx);
  } catch (e) {
    warnIdbWrite(e);
  }
}

/** Wartet, bis alle AKTUELL ausstehenden IndexedDB-Schreibvorgänge committet (bzw.
 *  fehlgeschlagen) sind. Damit kann ein Aufrufer VOR einem `location.reload()`
 *  (Reset/Slot-Wechsel/Import) sicherstellen, dass der fire-and-forget-Commit durch ist,
 *  statt ein Timing zu raten (#473). Im Legacy-/In-Memory-Modus (kein IndexedDB) sind
 *  Schreibvorgänge synchron → die Menge ist leer → resolved sofort. Wirft NIE.
 *  Snapshot-Semantik: der Aufrufer setzt seine Writes synchron VOR flushIdb() ab, sie
 *  sind also bereits erfasst; danach dazukommende Writes gehören nicht zu diesem Flush. */
export async function flushIdb(): Promise<void> {
  await Promise.all([...pendingWrites]);
}

function warnIdbWrite(e: unknown): void {
  if (warnedIdbWriteFailed) return;
  warnedIdbWriteFailed = true;

  console.warn("SaveStore: IndexedDB-Schreiben fehlgeschlagen – Spiel läuft weiter (Cache hält den Stand).", e);
}

/** Hydriert genau einen Key in den Cache: erst aus IndexedDB, sonst (einmalige
 *  Storage-Migration) aus localStorage nach IndexedDB. Gibt den hydrierten Wert
 *  zurück (oder null) – der Aufrufer (init) braucht ihn, um den aktiven Slot zu
 *  bestimmen, BEVOR der IndexedDB-Modus aktiv ist (rawGet läse dann noch localStorage).
 *  Wirft nie. */
export async function hydrate(db: IDBDatabase, key: string): Promise<string | null> {
  const fromIdb = await idbGet(db, key);
  if (fromIdb != null) { cache.set(key, fromIdb); return fromIdb; }
  const fromLs = backend.getItem(key);
  if (fromLs != null) { cache.set(key, fromLs); idbPut(db, key, fromLs); return fromLs; }
  return null;
}

/* ----- Synchrones Routing: IndexedDB-Modus (Cache) vs. Legacy (localStorage) ----- */

/** Synchron lesen: im IndexedDB-Modus aus dem Cache, sonst direkt aus localStorage/In-Memory. */
export function rawGet(key: string): string | null {
  if (idb) return cache.has(key) ? cache.get(key)! : null;
  return backend.getItem(key);
}

/** Synchron schreiben.
 *  IndexedDB-Modus: Cache sofort setzen (gelingt immer) + async nach IndexedDB spiegeln → true.
 *  Legacy-Modus: best-effort localStorage (false bei vollem Kontingent, wie bisher). */
export function rawSet(key: string, value: string): boolean {
  if (idb) {
    cache.set(key, value);
    idbPut(idb, key, value);
    return true;
  }
  return safeSet(key, value);
}

/** Synchron löschen. Im IndexedDB-Modus zusätzlich localStorage leeren, damit ein
 *  Reset keinen Alt-Stand zurücklässt, der bei künftig leerem IndexedDB erneut
 *  migriert würde. */
export function rawRemove(key: string): void {
  if (idb) {
    cache.delete(key);
    idbDelete(idb, key);
    try { backend.removeItem(key); } catch { /* egal – best effort */ }
    return;
  }
  backend.removeItem(key);
}
