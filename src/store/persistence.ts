/* ===== Kubernia – Persistenz: Eviction-Schutz + Quota-Monitoring (#401, ausgelagert #515) =====
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
 * der Aufrufer in der Präsentation/Einstieg (main.ts) – die Persistenz darf die UI nicht
 * kennen (Schichtung). Alles ist feature-detected und wirft NIE.
 */

/** Schwelle, ab der das Kontingent als "knapp" gilt (usage/quota) und früh gewarnt wird. */
export const QUOTA_WARN_RATIO = 0.8;

/** Ergebnis von {@link requestPersistentStorage}: Zustand des Speicher-Schutzes. */
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

/** Ist der Origin bereits als dauerhaft markiert? Best effort – false bei Fehler/fehlender API. */
async function queryPersisted(sm: StorageManager): Promise<boolean> {
  try {
    return typeof sm.persisted === "function" ? await sm.persisted() : false;
  } catch {
    return false; // best effort – als nicht-dauerhaft behandeln
  }
}

/** Dauerhaften Speicher anfordern. Best effort – false bei Ablehnung/Fehler (kein Crash). */
async function requestPersist(sm: StorageManager): Promise<boolean> {
  try {
    return await sm.persist();
  } catch {
    return false; // abgelehnt/Fehler → ungeschützt weiter
  }
}

/** Belegung/Kontingent messen. Best effort – {null,null} ohne API/bei Fehler. */
async function readEstimate(sm: StorageManager): Promise<{ usage: number | null; quota: number | null }> {
  if (typeof sm.estimate !== "function") return { usage: null, quota: null };
  try {
    const est = await sm.estimate();
    return {
      usage: typeof est.usage === "number" ? est.usage : null,
      quota: typeof est.quota === "number" ? est.quota : null,
    };
  } catch {
    return { usage: null, quota: null }; // ohne Schätzung keine Warnschwelle
  }
}

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
export async function requestPersistentStorage(): Promise<StorageHealth> {
  const sm = getStorageManager();
  const persistSupported = !!sm && typeof sm.persist === "function";
  let persisted = false;
  let usage: number | null = null;
  let quota: number | null = null;

  if (sm) {
    // Schon dauerhaft? Dann NICHT erneut anfragen – ein zweiter persist()-Aufruf
    // löst in Firefox sonst einen weiteren Berechtigungs-Prompt aus.
    persisted = await queryPersisted(sm);
    if (!persisted && persistSupported) persisted = await requestPersist(sm);
    ({ usage, quota } = await readEstimate(sm));
  }

  // quota=0 schützt vor Division durch null (manche Umgebungen melden 0).
  const usageRatio = usage != null && quota != null && quota > 0 ? usage / quota : null;
  const nearQuota = usageRatio != null && usageRatio >= QUOTA_WARN_RATIO;
  return { persistSupported, persisted, usage, quota, usageRatio, nearQuota };
}
