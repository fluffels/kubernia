/* ===== Kubernia – Persistenz-Schicht (SaveStore) =====
 * Eine dünne Fassade zwischen Spiellogik und Speicher: sie orchestriert den Boot
 * (init + einmalige Namensraum-Migrationen) und delegiert alles Weitere an die
 * vier fokussierten Persistenz-Module (Aufteilung #515, Muster wie game/*):
 *
 *   • store/backend.ts     – Backend-Auswahl (IndexedDB / localStorage / In-Memory)
 *                            + synchrones Roh-IO (rawGet/rawSet/rawRemove) via Cache.
 *   • store/slots.ts       – mehrere Save-Slots (#306): Index, Slot-Keys, Slot-CRUD
 *                            + Roh-IO auf dem AKTIVEN Slot.
 *   • store/versioning.ts  – Save-Format-Versionierung (#350/#510): { v, data }-Hülle,
 *                            Migrationskette, Backup-vor-Überschreiben.
 *   • store/persistence.ts – Eviction-Schutz + Quota-Monitoring (#401).
 *
 * Die Spiellogik (game.ts) kennt NUR diese Fassade – read() / write() / remove()
 * bzw. readState() / writeState(). Welches Backend/Format dahinter liegt, ist ihr egal.
 *
 * Namensraum-Rename KubeQuest → Kubernia (#557): die persistente Storage-Identität
 * (Save-Keys + IndexedDB-DB-Name) trägt jetzt das `kubernia`-Präfix; Alt-Stände
 * (`kubequest`-Präfix / DB "kubequest") werden beim Boot EINMALIG gehoben
 * (migrateLegacyLocalStorage + ./store/legacy-idb), ohne den Alt-Bestand zu vernichten.
 */
import {
  lsGet, lsSet, // Roh-localStorage für die einmalige Namensraum-Rename-Migration (#557)
  DB_VERSION, OBJECT_STORE, getIndexedDB, openIdb, hydrate, idbActive, activateIdb,
} from "./store/backend";
import {
  SLOTS_KEY, parseSlotIndex, defaultIndex, saveKeyFor, backupKeyFor,
  readActiveRaw, writeActiveRaw, removeActive, readActiveBackupRaw,
  listSlots, activeSlotId, createSlot, switchSlot, renameSlot, deleteSlot, setActiveSlotSummary,
  type SlotMeta,
} from "./store/slots";
import { CURRENT_SAVE_VERSION, readState, migrateParsed, writeState } from "./store/versioning";
import { QUOTA_WARN_RATIO, requestPersistentStorage, type StorageHealth } from "./store/persistence";
import { migrateLegacyIdb } from "./store/legacy-idb";

// Öffentliche API-Oberfläche unverändert lassen: die früher hier definierten Konstanten
// und Typen werden aus ihren neuen Modulen re-exportiert (Aufrufer importieren weiter aus "./store").
export { CURRENT_SAVE_VERSION, QUOTA_WARN_RATIO };
export type { SlotMeta, StorageHealth };

/* ----- Alt-Namensraum (KubeQuest) – NUR Quelle der einmaligen Rename-Migration (#557).
 * Es wird nur DARAUS gelesen, nie hinein; der Alt-Bestand bleibt als Sicherheitsnetz. Alt- und
 * Neu-Keys unterscheiden sich nur im Präfix, darum genügt EIN Mapper je Richtung. ----- */
const KUBEQUEST_DB_NAME = "kubequest";
function toKubequestKey(kuberniaKey: string): string {
  return "kubequest" + kuberniaKey.slice(8); // "kubernia".length === 8
}
function toKuberniaKey(kubequestKey: string): string {
  return kubequestKey.startsWith("kubequest") ? "kubernia" + kubequestKey.slice(9) : kubequestKey;
}

/* Rename-Migration KubeQuest → Kubernia in localStorage (#557): hebt einen Alt-Stand einmalig
 * von `kubequest-*` nach `kubernia-*` (Alt-Key bleibt als Netz, Neu-Key wird nie überschrieben).
 * Deterministisch über die bekannten Slot-Key-Former statt Enumeration (die der In-Memory-
 * Fallback + Test-Stubs nicht bieten). Best effort – wirft nie. */
function migrateLegacyLocalStorage(): void {
  try {
    copyLegacyLs(SLOTS_KEY); // zuerst der Index – er nennt alle Slots
    // Der (ggf. gerade gehobene) Index nennt alle Slots; Single-Slot → synthetischer Default.
    const idx = parseSlotIndex(lsGet(SLOTS_KEY)) ?? defaultIndex();
    for (const s of idx.slots) {
      copyLegacyLs(saveKeyFor(s.id));
      copyLegacyLs(backupKeyFor(s.id));
    }
  } catch {
    /* best effort – ein Alt-Stand darf den Boot nie reißen */
  }
}

/** Kopiert den Alt-Key-Wert (kubequest-*) unter den neuen Key (kubernia-*), falls dieser
 *  noch leer ist. Kein Löschen des Alt-Keys (bewusstes Sicherheitsnetz). */
function copyLegacyLs(newKey: string): void {
  if (lsGet(newKey) != null) return; // Neu-Key existiert → nichts überschreiben
  const legacy = lsGet(toKubequestKey(newKey));
  if (legacy != null) lsSet(newKey, legacy);
}

export const SaveStore = {
  /**
   * Schaltet SaveStore – falls möglich – auf IndexedDB als unbegrenztes Backend um.
   * EINMAL beim Boot VOR Game.load() aufrufen UND awaiten. Hydriert den synchronen
   * Cache aus IndexedDB (Slot-Index + AKTIVER Slot) und migriert bestehende
   * localStorage-Stände einmalig hinein. Ist IndexedDB nicht verfügbar oder schlägt
   * etwas fehl, bleibt der bisherige localStorage-Modus aktiv (No-op). Wirft NIE und
   * ist idempotent.
   */
  async init(): Promise<void> {
    if (idbActive()) return; // schon im IndexedDB-Modus
    // (#557) Alt-Namensraum in localStorage heben – läuft in JEDEM Modus (auch ohne IndexedDB),
    // damit der localStorage-Fallback unten (und der reine localStorage-Modus) den Neu-Key sieht.
    migrateLegacyLocalStorage();
    // Kein `= null`-Initializer: db wird in BEIDEN Zweigen (try/catch) gesetzt, bevor
    // es unten gelesen wird – ein Startwert wäre toter Code (no-useless-assignment, ESLint 10).
    let db: IDBDatabase | null;
    try {
      db = await openIdb();
    } catch {
      db = null;
    }
    if (!db) return; // kein IndexedDB → synchroner localStorage-Modus bleibt
    try {
      // (#557) Liegt der Stand noch in der Alt-DB "kubequest", einmalig in die neue DB
      // "kubernia" heben – VOR der Hydration, damit sie den gehobenen Bestand vorfindet.
      // Nur in eine leere Ziel-DB, Alt-DB bleibt unangetastet (siehe ./store/legacy-idb).
      const factory = getIndexedDB();
      if (factory) await migrateLegacyIdb({
        factory, target: db, oldDbName: KUBEQUEST_DB_NAME,
        store: OBJECT_STORE, version: DB_VERSION, renameKey: toKuberniaKey,
      });
      // Zuerst den Slot-Index, dann gezielt den aktiven Slot (Daten + Backup) hydrieren.
      // So liegt nur EIN Stand im Cache – nicht alle Slots (Stardew-Scope). hydrate()
      // deckt zugleich die einmalige localStorage→IndexedDB-Migration je Key ab.
      const slotsRaw = await hydrate(db, SLOTS_KEY);
      const id = parseSlotIndex(slotsRaw)?.activeId ?? defaultIndex().activeId;
      await hydrate(db, saveKeyFor(id));
      await hydrate(db, backupKeyFor(id));
    } catch {
      // Hydration/Migration fehlgeschlagen → lieber im sicheren localStorage-Modus bleiben.
      return;
    }
    // Modus erst NACH erfolgreicher Hydration aktivieren, damit kein synchroner
    // Leser je einen leeren Cache sieht.
    activateIdb(db);
  },

  /** Eviction-Schutz anfordern (#401) – siehe store/persistence.ts. */
  requestPersistentStorage(): Promise<StorageHealth> {
    return requestPersistentStorage();
  },

  /** Roh-JSON des Spielstands (aktiver Slot) lesen – oder null, wenn noch nichts gespeichert ist. */
  read() {
    return readActiveRaw();
  },

  /**
   * Roh-JSON-String des Spielstands (aktiver Slot) ablegen.
   * Gibt zurück, ob das Schreiben geklappt hat (im IndexedDB-Modus immer true; im
   * Legacy-Modus false z.B. bei vollem localStorage) – wirft NIE, damit ein
   * fehlschlagendes Speichern den Aufrufer nicht reißt.
   */
  write(json: string): boolean {
    return writeActiveRaw(json);
  },

  /** Spielstand (aktiver Slot) löschen (für „Zurücksetzen"). */
  remove() {
    removeActive();
  },

  /** Roh-JSON der letzten Sicherungskopie (aktiver Slot) lesen – oder null, wenn es keine gibt.
   *  Quelle für eine Wiederherstellung, falls eine Migration einen Stand zerschossen hat. */
  readBackup(): string | null {
    return readActiveBackupRaw();
  },

  /** Spielstand (aktiver Slot) lesen und auf das aktuelle Format migrieren – siehe store/versioning.ts. */
  readState(): unknown | null {
    return readState();
  },

  /** Einen bereits GEPARSTEN Roh-Stand auf das aktuelle Format heben (JSON-Import #493) – siehe store/versioning.ts. */
  migrateParsed(parsed: unknown): unknown {
    return migrateParsed(parsed);
  },

  /** Spielstand (aktiver Slot) in der aktuellen Versions-Hülle ablegen – siehe store/versioning.ts. */
  writeState(state: unknown): boolean {
    return writeState(state);
  },

  /* ===== Slot-Verwaltung (#306) – delegiert an store/slots.ts ===== */

  /** Liste aller Slots (mindestens der Default-Slot). Im Single-Slot-Fall synthetisch. */
  listSlots(): SlotMeta[] {
    return listSlots();
  },

  /** ID des aktiven Slots. */
  activeSlotId(): string {
    return activeSlotId();
  },

  /** Neuen, leeren Slot anlegen und dessen ID zurückgeben (wechselt NICHT von selbst dorthin). */
  createSlot(name: string): string {
    return createSlot(name);
  },

  /** Aktiven Slot wechseln. false bei unbekannter ID. */
  switchSlot(id: string): boolean {
    return switchSlot(id);
  },

  /** Einen Slot umbenennen. false bei unbekannter ID. */
  renameSlot(id: string, name: string): boolean {
    return renameSlot(id, name);
  },

  /** Einen Slot löschen (samt Daten + Backup). false bei unbekannter ID. */
  deleteSlot(id: string): boolean {
    return deleteSlot(id);
  },

  /** Die opake Vorschau-Nutzlast (summary) des AKTIVEN Slots setzen (für den Spielstand-Wähler). */
  setActiveSlotSummary(summary: unknown): void {
    setActiveSlotSummary(summary);
  },
};
