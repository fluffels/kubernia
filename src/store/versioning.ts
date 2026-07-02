/* ===== Kubernia – Persistenz: Save-Format-Versionierung + Migration + Backup (#515) =====
 * Persistierte Stände tragen eine Hülle: { v: <Format-Version>, data: <Spielstand> }.
 * So überleben alte Stände spätere Formatänderungen: beim Lesen wird die Hülle erkannt
 * und der Inhalt über eine Migrationskette auf die aktuelle Version gehoben.
 *
 * WICHTIG: Diese Versionierung betrifft das SAVE-FORMAT (Struktur der Nutzlast), NICHT
 * das Speicher-Backend. Der Umzug localStorage → IndexedDB (#350) ändert das Format
 * NICHT (dieselbe { v, data }-Hülle, nur woanders abgelegt) – darum kein Versions-Bump,
 * sondern eine einmalige Storage-Migration in init(). Auch die Save-Slots (#306) ändern
 * das FORMAT nicht: der Slot-Index liegt separat, jeder Slot trägt dieselbe { v, data }-Hülle.
 *
 * ===== Zwei Mechanismen, klare Zuständigkeit (SSOT, #510) =====
 * Es gibt ZWEI Stellen, die einen Alt-Stand aufs aktuelle Format heben – bewusst mit
 * getrennter Verantwortung, damit sie keine „zwei Wahrheiten" über das Format sind:
 *
 *   • migrations[n] hier (versionsgetrieben): der SSOT für STRUKTURELLE Format-Sprünge,
 *     die eine feldbasierte Ableitung NICHT tragen kann – ein Feld umbenennen/umdeuten
 *     (gleicher Name, andere Bedeutung), eine Menge in eine andere Form gießen, einen
 *     Wert wegwerfen. Nur so ein Sprung braucht echten Code in migrations[n]. Läuft
 *     GENAU EINMAL beim Anheben von Version n→n+1, mit der Versionsnummer als Auslöser.
 *
 *   • sanitizeState in game/save.ts (feldbasiert): NUR Defaulting + Härten. Fehlt ein
 *     additiv neu hinzugekommenes Feld, wird es mit seinem Default ergänzt; ein
 *     unplausibler Wert (NaN/negativ/falscher Typ/Array statt Objekt) fällt auf den
 *     Default zurück. Das läuft bei JEDEM Ladeweg (auch Import #493) und ist idempotent.
 *
 * Faustregel für die Wahl: rein ADDITIV (neues Feld, das bei Fehlen sinnvoll defaultet)
 * → gehört in sanitizeState, die Migration bleibt No-op (dokumentiert warum). ECHTE
 * Umbenennung/Umstrukturierung (Bedeutung ändert sich, Alt-Wert muss aktiv transformiert
 * werden) → gehört in migrations[n]. Die heute No-op-Migrationen 0→5 sind allesamt der
 * additive Fall (siehe Kommentare unten); ihr Versions-Bump hat trotzdem einen Zweck:
 * er löst die Backup-vor-Überschreiben-Sicherung aus (readState) – kein Spieler verliert
 * beim Update seinen Fortschritt, selbst wenn die eigentliche Anhebung feldbasiert ist.
 *
 * Erweitern bei einer Formatänderung:
 *   1. CURRENT_SAVE_VERSION um 1 erhöhen.
 *   2. Eine Migration migrations[n] ergänzen, die `data` von Version n auf n+1 bringt
 *      (additiver Fall: No-op mit Begründung; struktureller Fall: echte Transformation).
 *   3. Eine VOLLE Alt-Stand-Fixture test/fixtures/savegame-v<n>-*.json anlegen und in
 *      test/savemigration.test.ts einen Lade-Block dafür schreiben. Das ist Pflicht und
 *      wird maschinell erzwungen (#510): der Fitness-Test dort geht rot, sobald es zu
 *      einer Version keine geladene Fixture gibt – der frühere „bitte dran denken"-
 *      Kommentar allein hatte keine Zähne.
 * Die Kette läuft dann automatisch jede Zwischenstufe der Reihe nach durch.
 */
import { readActiveRaw, writeActiveRaw, backupActive } from "./slots";

export const CURRENT_SAVE_VERSION = 5;

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
  //         (localStorage UND der rohe JSON-Import via Game.importData, der seit #493
  //         ebenfalls durch migrateParsed + sanitizeState läuft). Der Versions-Bump sorgt hier dafür, dass jeder bestehende
  //         v1-Stand vor dem ersten Überschreiben in den Backup-Slot gesichert wird
  //         (readState) – kein Spieler verliert beim Update seinen Fortschritt.
  1: (data) => data,
  // 2 -> 3 (#354): Quest-IDs von numerisch (q5, q2b) auf sprechende Slugs umbenannt
  //         (harbor-/k8s-/git-… ). Quest-IDs sind persistiert (completedQuests +
  //         currentQuestId), also remappt die Migration alt -> neu. Wie bei 1->2 strukturell
  //         ein No-op auf store-Ebene: das eigentliche Remapping liegt in game.ts ›
  //         sanitizeState (LEGACY_QUEST_ID_MAP), damit es ALLE Ladewege trifft (auch der
  //         rohe JSON-Import, der seit #493 durch migrateParsed + sanitizeState läuft).
  //         Der Bump sichert jeden v2-Stand vor dem Überschreiben.
  2: (data) => data,
  // 3 -> 4 (#410): Quest-Fortschritt von EINER fokussierten Quest (currentQuestId) auf eine
  //         MENGE offener Quests (activeQuests: Quest-ID -> {step,task}) erweitert, damit das
  //         Save-Format mehrere parallel/optional offene Quests trägt. Wie 1->2/2->3 strukturell
  //         ein No-op auf store-Ebene: das Bauen von activeQuests aus der fokussierten Einzel-
  //         Quest liegt ZENTRAL in game.ts › sanitizeState, weil es ALLE Ladewege treffen muss
  //         (auch den rohen JSON-Import, der seit #493 durch migrateParsed + sanitizeState läuft).
  //         Der Bump sichert jeden v3-Stand vor dem ersten Überschreiben in den Backup-Slot.
  3: (data) => data,
  // 4 -> 5 (#413): persistente Spiel-Zeit-Achse `gameDays` (fraktionale Tageszahl) neu im
  //         GameState, damit Tag/Saison/Uhrzeit einen Reload überleben. Wie 1->2/2->3/3->4
  //         strukturell ein No-op auf store-Ebene: das Ergänzen des Default-Werts (0 = Tag 1,
  //         Mittag) liegt ZENTRAL in game.ts › sanitizeState (safeNonNegNum), damit es ALLE
  //         Ladewege trifft (auch den rohen JSON-Import, der seit #493 durch migrateParsed +
  //         sanitizeState läuft). Verlustfrei – vorher war die Zeit nie gespeichert. Der Bump
  //         sichert jeden v4-Stand vor dem ersten Überschreiben ins Backup.
  4: (data) => data,
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
 * Spielstand (aktiver Slot) lesen und auf das aktuelle Format migrieren.
 * Liefert das Spielstand-Objekt (NICHT die Versions-Hülle) oder null,
 * wenn nichts gespeichert ist bzw. die Datei kaputt ist (→ frischer Start).
 *
 * Schutz vor Datenverlust: Sobald die gelesene Datei NICHT schon exakt in der
 * aktuellen Version vorliegt – also migriert (Alt-Stand), heruntergestuft
 * (Zukunfts-Version) oder gar nicht parsebar (kaputt) wäre – wird die Original-
 * Rohdatei zuerst in den Backup-Slot kopiert. So überschreibt das anschließende
 * Zurückschreiben in game.ts (load → save) niemals den einzigen Stand unrettbar.
 */
export function readState(): unknown | null {
  const raw = readActiveRaw();
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backupActive(raw); // kaputte/halbe Datei sichern, dann frisch starten statt crashen
    return null;
  }
  if (isEnvelope(parsed)) {
    // Schon exakt aktuelle Version? Dann nichts zu sichern (kein unnötiges Verdoppeln).
    // Sonst (älter ODER neuer als wir) zuerst das Original sichern.
    if (parsed.v !== CURRENT_SAVE_VERSION) backupActive(raw);
    return migrate(parsed.v, parsed.data);
  }
  // Keine Hülle = Alt-Stand der Format-Version 0 → wird migriert, also vorher sichern.
  backupActive(raw);
  return migrate(0, parsed);
}

/**
 * Einen bereits GEPARSTEN Roh-Stand auf das aktuelle FORMAT heben und die reine Nutzlast
 * (ohne Versions-Hülle) zurückgeben – dieselbe Format-Logik wie {@link readState}, aber auf
 * einem ÜBERGEBENEN Wert statt aus dem Storage gelesen. Für den JSON-Import (#493): ein
 * importierter Stand muss durch dieselbe Migrationskette wie ein geladener laufen, sonst
 * wird ein hüllenloser oder aus einer anderen Version stammender Stand später als
 * Format-Version 0 fehlinterpretiert.
 *   - Versions-Hülle { v, data } → `data` von `v` hochmigrieren.
 *   - blanker Alt-Stand (keine Hülle) → als Format-Version 0 migrieren.
 * Der INHALT der Felder wird hier NICHT geprüft – das härtet der Aufrufer via sanitizeState.
 * Kein Backup: das ist eine reine Format-Umrechnung, kein Überschreiben eines Stands.
 */
export function migrateParsed(parsed: unknown): unknown {
  return isEnvelope(parsed) ? migrate(parsed.v, parsed.data) : migrate(0, parsed);
}

/**
 * Spielstand (aktiver Slot) in der aktuellen Versions-Hülle ablegen.
 * Gibt zurück, ob das Schreiben geklappt hat (im IndexedDB-Modus immer true; im
 * Legacy-Modus false z.B. bei vollem localStorage) – wirft NIE, damit der
 * Auto-Save den Aufrufer nicht reißt.
 */
export function writeState(state: unknown): boolean {
  return writeActiveRaw(JSON.stringify({ v: CURRENT_SAVE_VERSION, data: state }));
}
