/* ===== Kubernia-Rename: IndexedDB-Namensraum-Migration (#557) =====
 *
 * Der Rename KubeQuest → Kubernia zieht auch die interne Storage-Identität um (Save-Keys +
 * IndexedDB-DB-Name). Die localStorage-Keys hebt store.ts selbst (dort liegt der `backend`);
 * die kniffligere Hälfte – der Umzug von einer IndexedDB-Datenbank in eine ANDERE
 * ("kubequest" → "kubernia") – lebt hier, damit store.ts unter dem Zeilen-Budget bleibt
 * (#390) und diese Sonderlogik isoliert testbar ist.
 *
 * Save-Sicherheit ist das oberste Gebot (Regel „Spielstände nie brechen"):
 *  - Es wird NUR in eine LEERE Ziel-DB migriert (hat sie schon irgendeinen Schlüssel, ist
 *    entweder bereits migriert oder frisch bespielt → wir fassen sie NICHT an, kein Clobber).
 *  - Die Alt-DB bleibt nach dem Kopieren UNANGETASTET als zusätzliches Rettungsnetz.
 *  - Alles ist best effort und feature-detected: jeder Fehler führt nur dazu, dass nicht
 *    migriert wird – nie zu einem Crash oder Datenverlust. Wirft NIE.
 *
 * Das Modul ist bewusst dependency-injected (bekommt Factory/Ziel-DB/Namen/renameKey
 * herein) statt store.ts-Interna zu importieren – so entsteht kein Import-Zyklus und die
 * Funktion ist mit fake-indexeddb ohne den ganzen SaveStore prüfbar.
 */

/** Alles, was die Migration von außen braucht (aus store.ts injiziert). */
export interface LegacyIdbMigration {
  /** Die IndexedDB-Factory (globalThis.indexedDB bzw. fake-indexeddb im Test). */
  factory: IDBFactory;
  /** Die bereits geöffnete NEUE ("kubernia") Datenbank – das Migrationsziel. */
  target: IDBDatabase;
  /** Name der ALTEN ("kubequest") Datenbank – die Migrationsquelle. */
  oldDbName: string;
  /** Name des Object-Stores (in beiden DBs identisch, z.B. "saves"). */
  store: string;
  /** DB-Version, mit der beide DBs geöffnet werden (aktuell 1). */
  version: number;
  /** Bildet einen Alt-Schlüssel auf seinen neuen Namen ab (kubequest-* → kubernia-*). */
  renameKey: (key: string) => string;
}

/** Hebt einen Alt-Bestand aus der KubeQuest-IndexedDB in die Kubernia-DB (#557).
 *  Kopiert nur in eine leere Ziel-DB und lässt die Alt-DB unangetastet. Wirft nie. */
export async function migrateLegacyIdb(o: LegacyIdbMigration): Promise<void> {
  try {
    if (await hasAnyKey(o.target, o.store)) return;          // Ziel schon befüllt → nichts anfassen
    if (!(await oldDbExists(o.factory, o.oldDbName))) return; // keine Alt-DB → nichts zu migrieren
    const old = await openDb(o.factory, o.oldDbName, o.version, o.store);
    if (!old) return;
    try {
      const entries = await getAll(old, o.store);
      // Sequentiell schreiben: die readwrite-Transaktionen serialisieren so garantiert VOR
      // der anschließenden Hydration in store.ts, die aus derselben Ziel-DB liest.
      for (const { key, value } of entries) await put(o.target, o.store, o.renameKey(key), value);
    } finally {
      old.close();
    }
  } catch {
    /* best effort – im Fehlerfall bleibt die Alt-DB als Netz, das Spiel startet frisch */
  }
}

/** true, wenn die Ziel-DB bereits mindestens einen Schlüssel hält (dann NICHT migrieren). */
function hasAnyKey(db: IDBDatabase, store: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(store)) { resolve(false); return; }
      const req = db.transaction(store, "readonly").objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(Array.isArray(req.result) && req.result.length > 0);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** true, wenn die Alt-DB laut `databases()` existiert. Ist die API nicht verfügbar
 *  (alter Browser), geben wir true zurück und versuchen es – ein Öffnen legt dann
 *  höchstens eine leere Phantom-DB an (harmlos, getAll liefert []). */
async function oldDbExists(factory: IDBFactory, name: string): Promise<boolean> {
  try {
    if (typeof factory.databases !== "function") return true;
    const dbs = await factory.databases();
    return dbs.some((d) => d.name === name);
  } catch {
    return true;
  }
}

/** Öffnet (bzw. legt an) eine DB und stellt den Object-Store sicher. Resolved mit der DB
 *  oder null. Wirft nie. */
function openDb(factory: IDBFactory, name: string, version: number, store: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, version);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** Alle String-Einträge (Schlüssel + Wert) eines Stores lesen. Resolved mit [] bei Fehler. */
function getAll(db: IDBDatabase, store: string): Promise<Array<{ key: string; value: string }>> {
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(store)) { resolve([]); return; }
      const os = db.transaction(store, "readonly").objectStore(store);
      const keysReq = os.getAllKeys();
      const valsReq = os.getAll();
      keysReq.onerror = () => resolve([]);
      valsReq.onsuccess = () => {
        const keys = keysReq.result as unknown[];
        const vals = valsReq.result as unknown[];
        const out: Array<{ key: string; value: string }> = [];
        for (let i = 0; i < keys.length; i++) {
          if (typeof keys[i] === "string" && typeof vals[i] === "string")
            out.push({ key: keys[i] as string, value: vals[i] as string });
        }
        resolve(out);
      };
      valsReq.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Einen Wert in den Ziel-Store schreiben. Resolved immer (Fehler werden verschluckt). */
function put(db: IDBDatabase, store: string, key: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
