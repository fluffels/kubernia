/* ===== KubeQuest – Persistenz-Schicht (SaveStore) =====
 * Eine dünne Schicht zwischen Spiellogik und Speicher.
 *
 * Die Spiellogik (game.ts) kennt NUR dieses Interface – read() / write() / remove()
 * bzw. readState() / writeState(). Welches Backend dahinter liegt, ist ihr egal.
 *
 * Backend (#350): primär IndexedDB (praktisch kein Speicher-Limit, hebt die
 * ~5–10 MB-Decke von localStorage für Stardew-Scale-Stände). Fallback: localStorage
 * bzw. flüchtiger In-Memory-Speicher. Siehe den IndexedDB-Block weiter unten – dort
 * steht auch, warum die nach außen sichtbare API trotz async IndexedDB synchron bleibt.
 */
  const SAVE_KEY = "kubequest-save-v3";
  // Ein-Slot-Sicherungskopie der Roh-Spielstanddatei. Wird befüllt, BEVOR ein Stand
  // migriert/heruntergestuft/verworfen würde (siehe readState). Damit ist garantiert,
  // dass selbst eine fehlerhafte Migration oder eine kaputte Datei nicht den einzigen
  // vorhandenen Stand vernichtet – er bleibt hier wiederherstellbar (readBackup).
  const BACKUP_KEY = "kubequest-save-backup-v1";

  // localStorage ist nicht überall verfügbar (privater Modus, blockierte Cookies,
  // Node-Tests). Dann fallen wir auf einen flüchtigen In-Memory-Speicher zurück,
  // damit das Spiel weiterläuft – nur eben ohne Speichern über die Sitzung hinaus.
  const backend = (function () {
    try {
      const probe = "__kq_probe__";
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

  /* ===== IndexedDB-Backend (#350) =====
   * localStorage hat ein hartes Kontingent (~5–10 MB). Für Stardew-Scale-Stände
   * (großes Spaced-Repetition-Deck, Welt-/NPC-Zustand, Quest-History) reicht das
   * perspektivisch nicht; IndexedDB hat praktisch kein Limit.
   *
   * Knackpunkt: IndexedDB ist ASYNCHRON, die SaveStore-API ist synchron und wird an
   * vielen Stellen synchron aufgerufen (u.a. Game.load() beim Boot, der 5-s-Auto-Save,
   * exportData()). Statt die halbe Codebasis auf async umzustellen (großer Ripple,
   * Risiko für bestehende Stände), liegt vor IndexedDB ein synchroner In-Memory-Cache:
   *   • init() hydriert den Cache beim Boot EINMAL aus IndexedDB (async),
   *   • danach lesen read()/readState() synchron aus dem Cache,
   *   • write()/writeState() aktualisieren den Cache synchron UND spiegeln den Wert
   *     asynchron (fire-and-forget) nach IndexedDB.
   * IndexedDB ist damit die maßgebliche, unbegrenzte Quelle, der Cache nur ihr
   * synchrones Spiegelbild für diese Sitzung.
   *
   * Ist IndexedDB nicht verfügbar (privater Modus, alter Browser, file://-Offline-Build,
   * Node-Tests ohne Polyfill) ODER schlägt das Öffnen fehl, bleibt SaveStore im
   * bisherigen, voll synchronen localStorage-Modus – init() ist dann ein No-op. So
   * bricht nichts und der bestehende Code-/Testpfad ist unverändert.
   */
  const DB_NAME = "kubequest";
  const DB_VERSION = 1;
  const OBJECT_STORE = "saves"; // ein simpler Key→Wert-Store; Keys = SAVE_KEY / BACKUP_KEY

  // idb != null ⇔ „IndexedDB-Modus aktiv" (init() lief erfolgreich durch). cache ist
  // dann die synchrone Lese-/Schreibspiegelung; im Legacy-Modus wird er nie benutzt.
  const cache = new Map<string, string>();
  let idb: IDBDatabase | null = null;
  let warnedIdbWriteFailed = false;

  /** Die IndexedDB-Factory holen – globalThis deckt Browser (window.indexedDB) UND
   *  Tests (fake-indexeddb) ab. null, wenn IndexedDB nicht existiert/zugreifbar ist. */
  function getIndexedDB(): IDBFactory | null {
    try {
      const g = globalThis as unknown as { indexedDB?: IDBFactory };
      return g.indexedDB ?? null;
    } catch {
      return null;
    }
  }

  /** Öffnet (bzw. legt an) die Datenbank. Resolved IMMER – mit der DB oder null
   *  (nicht verfügbar / Fehler / blockiert). Wirft nie. */
  function openIdb(): Promise<IDBDatabase | null> {
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

  /** Wert async nach IndexedDB schreiben (fire-and-forget). Fehler werden EINMALIG
   *  gemeldet und nie geworfen – ein fehlschlagender Persist darf den synchronen
   *  Aufrufer (Auto-Save) nicht reißen; der Cache hält den Wert für die Sitzung. */
  function idbPut(db: IDBDatabase, key: string, value: string): void {
    try {
      const tx = db.transaction(OBJECT_STORE, "readwrite");
      tx.objectStore(OBJECT_STORE).put(value, key);
      tx.onerror = () => warnIdbWrite(tx.error);
      tx.onabort = () => warnIdbWrite(tx.error);
    } catch (e) {
      warnIdbWrite(e);
    }
  }

  /** Wert async aus IndexedDB löschen (fire-and-forget, fehlertolerant). */
  function idbDelete(db: IDBDatabase, key: string): void {
    try {
      const tx = db.transaction(OBJECT_STORE, "readwrite");
      tx.objectStore(OBJECT_STORE).delete(key);
      tx.onerror = () => warnIdbWrite(tx.error);
      tx.onabort = () => warnIdbWrite(tx.error);
    } catch (e) {
      warnIdbWrite(e);
    }
  }

  function warnIdbWrite(e: unknown): void {
    if (warnedIdbWriteFailed) return;
    warnedIdbWriteFailed = true;
     
    console.warn("SaveStore: IndexedDB-Schreiben fehlgeschlagen – Spiel läuft weiter (Cache hält den Stand).", e);
  }

  /* ----- Synchrones Routing: IndexedDB-Modus (Cache) vs. Legacy (localStorage) ----- */

  /** Synchron lesen: im IndexedDB-Modus aus dem Cache, sonst direkt aus localStorage/In-Memory. */
  function rawGet(key: string): string | null {
    if (idb) return cache.has(key) ? cache.get(key)! : null;
    return backend.getItem(key);
  }

  /** Synchron schreiben.
   *  IndexedDB-Modus: Cache sofort setzen (gelingt immer) + async nach IndexedDB spiegeln → true.
   *  Legacy-Modus: best-effort localStorage (false bei vollem Kontingent, wie bisher). */
  function rawSet(key: string, value: string): boolean {
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
  function rawRemove(key: string): void {
    if (idb) {
      cache.delete(key);
      idbDelete(idb, key);
      try { backend.removeItem(key); } catch { /* egal – best effort */ }
      return;
    }
    backend.removeItem(key);
  }

  /* ===== Versionierung der Spielstände =====
   * Persistierte Stände tragen eine Hülle: { v: <Format-Version>, data: <Spielstand> }.
   * So überleben alte Stände spätere Formatänderungen: beim Lesen wird die Hülle erkannt
   * und der Inhalt über eine Migrationskette auf die aktuelle Version gehoben.
   *
   * WICHTIG: Diese Versionierung betrifft das SAVE-FORMAT (Struktur der Nutzlast), NICHT
   * das Speicher-Backend. Der Umzug localStorage → IndexedDB (#350) ändert das Format
   * NICHT (dieselbe { v, data }-Hülle, nur woanders abgelegt) – darum kein Versions-Bump,
   * sondern eine einmalige Storage-Migration in init().
   *
   * Erweitern bei einer Formatänderung:
   *   1. CURRENT_SAVE_VERSION um 1 erhöhen.
   *   2. Eine Migration migrations[n] ergänzen, die `data` von Version n auf n+1 bringt.
   * Die Kette läuft dann automatisch jede Zwischenstufe der Reihe nach durch.
   */
  export const CURRENT_SAVE_VERSION = 3;

  /** Migration von Format-Version n auf n+1 (reine Funktion auf dem `data`-Objekt). */
  type Migration = (data: unknown) => unknown;

  const migrations: Record<number, Migration> = {
    // 0 -> 1: Alt-Stände lagen ohne Hülle als blanker GameState unter dem Key.
    //         Inhaltlich identisch zum heutigen Format – wir übernehmen ihn unverändert
    //         und packen ihn nur in die neue Versions-Hülle.
    0: (data) => data,
    // 1 -> 2 (#353): Quest-Fortschritt wird zusätzlich als Quest-ID (currentQuestId) statt
    //         nur als Zahl-Index geführt, damit Einfügen/Umsortieren von Quests keinen
    //         Spielstand mehr bricht. Strukturell ein No-op: die Ableitung der ID aus dem
    //         alten questIdx (und das Auflösen ID -> Index) passiert ZENTRAL in
    //         game.ts › sanitizeState, weil sie ALLE Ladewege gleich treffen muss
    //         (localStorage UND der rohe JSON-Import via Game.importData umgeht diese
    //         Migrationskette). Der Versions-Bump sorgt hier dafür, dass jeder bestehende
    //         v1-Stand vor dem ersten Überschreiben in den Backup-Slot gesichert wird
    //         (readState) – kein Spieler verliert beim Update seinen Fortschritt.
    1: (data) => data,
    // 2 -> 3 (#354): Quest-IDs von numerisch (q5, q2b) auf sprechende Slugs umbenannt
    //         (harbor-/k8s-/git-… ). Quest-IDs sind persistiert (completedQuests +
    //         currentQuestId), also remappt die Migration alt -> neu. Wie bei 1->2 strukturell
    //         ein No-op auf store-Ebene: das eigentliche Remapping liegt in game.ts ›
    //         sanitizeState (LEGACY_QUEST_ID_MAP), damit es ALLE Ladewege trifft (auch der
    //         rohe JSON-Import). Der Bump sichert jeden v2-Stand vor dem Überschreiben.
    2: (data) => data,
  };

  /** Hebt `data` von `version` schrittweise auf CURRENT_SAVE_VERSION. */
  function migrate(version: number, data: unknown): unknown {
    let v = version;
    let d = data;
    // Nur hochmigrieren, solange eine passende Migration existiert. Fehlt eine Stufe
    // (Lücke) oder ist der Stand bereits neuer als wir verstehen, brechen wir ab und
    // liefern den besten verfügbaren Stand zurück, statt zu crashen.
    while (v < CURRENT_SAVE_VERSION) {
      const step = migrations[v];
      if (!step) break;
      d = step(d);
      v++;
    }
    return d;
  }

  /** Erkennt die Versions-Hülle { v: number, data: ... }. */
  function isEnvelope(x: unknown): x is { v: number; data: unknown } {
    return (
      typeof x === "object" && x !== null &&
      typeof (x as { v?: unknown }).v === "number" &&
      "data" in (x as object)
    );
  }

  /**
   * Sichert die Roh-Datei in den Backup-Slot, BEVOR der Hauptschlüssel durch einen
   * migrierten/heruntergestuften/frischen Stand überschrieben wird. Best effort:
   * schlägt das Backup-Schreiben fehl (Kontingent voll), läuft das Laden trotzdem
   * weiter – wir wollten nur eine zusätzliche Rettungskopie, kein Muss.
   */
  function backup(raw: string): void {
    rawSet(BACKUP_KEY, raw);
  }

  /* ===== Eviction-Schutz: dauerhafter Speicher + Quota-Monitoring (#401) =====
   * Browser-Speicher ist "geliehen, nicht besessen": unter Speicherdruck löscht der
   * Browser best-effort-Origins per LRU KOMPLETT (IndexedDB + Cache API + OPFS einer
   * Origin zusammen). Ein Lernspiel, das man über Wochen nur sporadisch im Tab öffnet,
   * ist genau ein LRU-Kandidat – der Stand kann stillschweigend verschwinden (ADR 0006,
   * Befund 3). IndexedDB allein schützt NICHT davor; nur `navigator.storage.persist()`
   * markiert den Origin als dauerhaft.
   *
   * Zusätzlich überwacht `navigator.storage.estimate()` die Belegung: läuft das
   * Kontingent voll, soll früh gewarnt werden, BEVOR ein QuotaExceededError den
   * 5-Sekunden-Auto-Save reißt. Der JSON-Export bleibt das verlässliche letzte Netz.
   *
   * Diese Schicht ist reine Persistenz: sie FORDERT an und MISST, gibt das Ergebnis
   * aber nur als Datenobjekt (StorageHealth) zurück. Den eigentlichen Warn-Toast feuert
   * der Aufrufer in der Präsentation/Einstieg (main.ts) – store.ts darf die UI nicht
   * kennen (Schichtung). Alles ist feature-detected und wirft NIE.
   */

  /** Schwelle, ab der das Kontingent als "knapp" gilt (usage/quota) und früh gewarnt wird. */
  export const QUOTA_WARN_RATIO = 0.8;

  /** Ergebnis von {@link SaveStore.requestPersistentStorage}: Zustand des Speicher-Schutzes. */
  export interface StorageHealth {
    /** Unterstützt der Browser `navigator.storage.persist()` überhaupt? */
    persistSupported: boolean;
    /** Ist der Origin als dauerhaft markiert (kein LRU-Evict)? */
    persisted: boolean;
    /** Belegte Bytes laut `estimate()`, oder null wenn die API fehlt/scheitert. */
    usage: number | null;
    /** Verfügbares Kontingent in Bytes, oder null. */
    quota: number | null;
    /** usage/quota in [0,1], oder null wenn nicht ermittelbar (auch bei quota=0). */
    usageRatio: number | null;
    /** true, wenn das Kontingent knapp wird (>= QUOTA_WARN_RATIO) → früh warnen. */
    nearQuota: boolean;
  }

  /** Den StorageManager holen – feature-detected. null, wenn die API nicht existiert
   *  (alter Browser, `file://`-Offline-Build, Node-Test ohne Stub). Wirft nie. */
  function getStorageManager(): StorageManager | null {
    try {
      const nav = (globalThis as unknown as { navigator?: { storage?: StorageManager } }).navigator;
      return nav?.storage ?? null;
    } catch {
      return null;
    }
  }

  export const SaveStore = {
    /**
     * Schaltet SaveStore – falls möglich – auf IndexedDB als unbegrenztes Backend um.
     * EINMAL beim Boot VOR Game.load() aufrufen UND awaiten. Hydriert den synchronen
     * Cache aus IndexedDB und migriert einen bestehenden localStorage-Stand einmalig
     * hinein. Ist IndexedDB nicht verfügbar oder schlägt etwas fehl, bleibt der
     * bisherige localStorage-Modus aktiv (No-op). Wirft NIE und ist idempotent.
     */
    async init(): Promise<void> {
      if (idb) return; // schon im IndexedDB-Modus
      let db: IDBDatabase | null = null;
      try {
        db = await openIdb();
      } catch {
        db = null;
      }
      if (!db) return; // kein IndexedDB → synchroner localStorage-Modus bleibt
      try {
        const idbSave = await idbGet(db, SAVE_KEY);
        if (idbSave != null) {
          // IndexedDB ist die maßgebliche Quelle: Cache daraus hydrieren.
          cache.set(SAVE_KEY, idbSave);
          const idbBackup = await idbGet(db, BACKUP_KEY);
          if (idbBackup != null) cache.set(BACKUP_KEY, idbBackup);
        } else {
          // Einmalige Storage-Migration: bestehenden localStorage-Stand nach IndexedDB
          // heben. localStorage wird dabei NICHT gelöscht (bleibt als Zusatz-Backup des
          // Vor-Migrations-Stands liegen) – ein Reset (rawRemove) räumt beides ab.
          const lsSave = backend.getItem(SAVE_KEY);
          if (lsSave != null) {
            cache.set(SAVE_KEY, lsSave);
            idbPut(db, SAVE_KEY, lsSave);
          }
          const lsBackup = backend.getItem(BACKUP_KEY);
          if (lsBackup != null) {
            cache.set(BACKUP_KEY, lsBackup);
            idbPut(db, BACKUP_KEY, lsBackup);
          }
        }
      } catch {
        // Hydration/Migration fehlgeschlagen → lieber im sicheren localStorage-Modus bleiben.
        return;
      }
      // Modus erst NACH erfolgreicher Hydration aktivieren, damit kein synchroner
      // Leser je einen leeren Cache sieht.
      idb = db;
    },

    /**
     * Eviction-Schutz anfordern (#401): den Origin als dauerhaften Speicher markieren
     * (`navigator.storage.persist()`) und die Belegung messen (`estimate()`). EINMAL
     * beim Boot aufrufen (nach init()). Muss NICHT awaitet werden, um den Boot zu
     * blockieren – das Ergebnis dient nur dem Aufrufer für eine optionale Frühwarnung
     * (Toast in main.ts) bei knappem Kontingent.
     *
     * Wirft NIE und ist gefahrlos mehrfach aufrufbar: jede Teil-API wird feature-detected,
     * jeder Fehler/jede Ablehnung wird abgefangen und führt nur zu einem neutralen Feld
     * im zurückgegebenen {@link StorageHealth}. Fehlt die API ganz, läuft das Spiel
     * (ungeschützt, wie bisher) einfach weiter.
     */
    async requestPersistentStorage(): Promise<StorageHealth> {
      const sm = getStorageManager();
      const persistSupported = !!sm && typeof sm.persist === "function";
      let persisted = false;
      let usage: number | null = null;
      let quota: number | null = null;

      if (sm) {
        // Schon dauerhaft? Dann NICHT erneut anfragen – ein zweiter persist()-Aufruf
        // löst in Firefox sonst einen weiteren Berechtigungs-Prompt aus.
        try {
          if (typeof sm.persisted === "function") persisted = await sm.persisted();
        } catch { /* best effort – als nicht-dauerhaft behandeln */ }
        if (!persisted && persistSupported) {
          try {
            persisted = await sm.persist();
          } catch { /* abgelehnt/Fehler → ungeschützt weiter, kein Crash */ }
        }
        if (typeof sm.estimate === "function") {
          try {
            const est = await sm.estimate();
            usage = typeof est.usage === "number" ? est.usage : null;
            quota = typeof est.quota === "number" ? est.quota : null;
          } catch { /* best effort – ohne Schätzung keine Warnschwelle */ }
        }
      }

      // quota=0 schützt vor Division durch null (manche Umgebungen melden 0).
      const usageRatio = usage != null && quota != null && quota > 0 ? usage / quota : null;
      const nearQuota = usageRatio != null && usageRatio >= QUOTA_WARN_RATIO;
      return { persistSupported, persisted, usage, quota, usageRatio, nearQuota };
    },

    /** Roh-JSON des Spielstands lesen – oder null, wenn noch nichts gespeichert ist. */
    read() {
      return rawGet(SAVE_KEY);
    },

    /**
     * Roh-JSON-String des Spielstands ablegen.
     * Gibt zurück, ob das Schreiben geklappt hat (im IndexedDB-Modus immer true; im
     * Legacy-Modus false z.B. bei vollem localStorage) – wirft NIE, damit ein
     * fehlschlagendes Speichern den Aufrufer nicht reißt.
     */
    write(json: string): boolean {
      return rawSet(SAVE_KEY, json);
    },

    /** Spielstand löschen (für „Zurücksetzen"). */
    remove() {
      rawRemove(SAVE_KEY);
    },

    /** Roh-JSON der letzten Sicherungskopie lesen – oder null, wenn es keine gibt.
     *  Quelle für eine Wiederherstellung, falls eine Migration einen Stand zerschossen hat. */
    readBackup(): string | null {
      return rawGet(BACKUP_KEY);
    },

    /**
     * Spielstand lesen und auf das aktuelle Format migrieren.
     * Liefert das Spielstand-Objekt (NICHT die Versions-Hülle) oder null,
     * wenn nichts gespeichert ist bzw. die Datei kaputt ist (→ frischer Start).
     *
     * Schutz vor Datenverlust: Sobald die gelesene Datei NICHT schon exakt in der
     * aktuellen Version vorliegt – also migriert (Alt-Stand), heruntergestuft
     * (Zukunfts-Version) oder gar nicht parsebar (kaputt) wäre – wird die Original-
     * Rohdatei zuerst in den Backup-Slot kopiert. So überschreibt das anschließende
     * Zurückschreiben in game.ts (load → save) niemals den einzigen Stand unrettbar.
     */
    readState(): unknown | null {
      const raw = rawGet(SAVE_KEY);
      if (raw == null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        backup(raw); // kaputte/halbe Datei sichern, dann frisch starten statt crashen
        return null;
      }
      if (isEnvelope(parsed)) {
        // Schon exakt aktuelle Version? Dann nichts zu sichern (kein unnötiges Verdoppeln).
        // Sonst (älter ODER neuer als wir) zuerst das Original sichern.
        if (parsed.v !== CURRENT_SAVE_VERSION) backup(raw);
        return migrate(parsed.v, parsed.data);
      }
      // Keine Hülle = Alt-Stand der Format-Version 0 → wird migriert, also vorher sichern.
      backup(raw);
      return migrate(0, parsed);
    },

    /**
     * Spielstand in der aktuellen Versions-Hülle ablegen.
     * Gibt zurück, ob das Schreiben geklappt hat (im IndexedDB-Modus immer true; im
     * Legacy-Modus false z.B. bei vollem localStorage) – wirft NIE, damit der
     * Auto-Save den Aufrufer nicht reißt.
     */
    writeState(state: unknown): boolean {
      return rawSet(SAVE_KEY, JSON.stringify({ v: CURRENT_SAVE_VERSION, data: state }));
    },
  };
