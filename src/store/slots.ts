/* ===== Kubernia – Persistenz: Mehrere Spielstände / Save-Slots (#306, ausgelagert #515) =====
 * Ein Slot ist ein benannter, eigenständiger Spielstand. Die Slot-Logik liegt bewusst
 * in der Persistenz-Schicht (game.ts kennt nur „aktiver Slot"). Modell:
 *
 *  • Slot-Index (SLOTS_KEY): { activeId, slots: [{ id, name, summary? }] }. `summary` ist
 *    eine OPAKE Vorschau-Nutzlast (xp/quest/…), die die Anwendungsschicht füllt und die
 *    Persistenz nie interpretiert – so kann der Spielstand-Wähler die Slots anzeigen, ohne
 *    jeden ganzen Stand laden zu müssen (Stardew-Scope: viele Slots, aber nur ein kleiner Index).
 *  • Daten-Key je Slot: der Default-Slot ("slot-1") nutzt den HISTORISCHEN Einzel-Key
 *    (LEGACY_SAVE_KEY) → ein bestehender Stand ist ohne Kopieren automatisch Slot 1; weitere
 *    Slots bekommen "<LEGACY_SAVE_KEY>:<id>".
 *  • Solange NUR der Default-Slot existiert, wird KEIN Index geschrieben: activeSlotId()/
 *    listSlots() liefern dann einen synthetischen Default. Damit ist der Single-Slot-Fall
 *    byte-identisch zu vor diesem Feature (keine neue Datei, kein Churn beim 5-s-Auto-Save).
 *
 * Slot-WECHSEL = aktiven Zeiger setzen + die Seite neu laden (der Aufrufer): nach dem Reload
 * hydriert init() den jetzt aktiven Slot. So muss der synchrone Pfad nie einen fremden Slot
 * asynchron nachladen.
 *
 * "LEGACY" in den Key-Namen meint den historischen Einzel-Save-Key des Default-Slots (#306),
 * NICHT den alten Produktnamen (der Namensraum-Rename KubeQuest→Kubernia #557 ist davon getrennt).
 */
import { rawGet, rawSet, rawRemove } from "./backend";

// Daten-Key des Default-Slots = der historische Einzel-Save-Key (Backward-Kompatibilität #306).
const LEGACY_SAVE_KEY = "kubernia-save-v3";
// Sicherungskopie der Roh-Spielstanddatei (pro Slot). Wird befüllt, BEVOR ein Stand
// migriert/heruntergestuft/verworfen würde (siehe versioning.readState). Damit ist garantiert,
// dass selbst eine fehlerhafte Migration oder eine kaputte Datei nicht den einzigen
// vorhandenen Stand vernichtet – er bleibt hier wiederherstellbar (readActiveBackup).
const LEGACY_BACKUP_KEY = "kubernia-save-backup-v1";

export const SLOTS_KEY = "kubernia-slots-v1";
const DEFAULT_SLOT_ID = "slot-1";
const DEFAULT_SLOT_NAME = "Spielstand 1";

/** Ein Slot im Index. `summary` ist eine von der Anwendungsschicht definierte, hier opake
 *  Vorschau-Nutzlast (z.B. XP/Quest/zuletzt-gespielt) für den Spielstand-Wähler. */
export interface SlotMeta {
  id: string;
  name: string;
  summary?: unknown;
}
interface SlotIndex {
  activeId: string;
  slots: SlotMeta[];
}

/** Daten-Key eines Slots. Default-Slot → Legacy-Einzel-Key (Backward-Kompatibilität). */
export function saveKeyFor(id: string): string {
  return id === DEFAULT_SLOT_ID ? LEGACY_SAVE_KEY : LEGACY_SAVE_KEY + ":" + id;
}
/** Backup-Key eines Slots (analog zum Daten-Key). */
export function backupKeyFor(id: string): string {
  return id === DEFAULT_SLOT_ID ? LEGACY_BACKUP_KEY : LEGACY_BACKUP_KEY + ":" + id;
}

/** Synthetischer Default-Index für den Single-Slot-Fall (NICHT persistiert). */
export function defaultIndex(): SlotIndex {
  return { activeId: DEFAULT_SLOT_ID, slots: [{ id: DEFAULT_SLOT_ID, name: DEFAULT_SLOT_NAME }] };
}

/** Den Slot-Index defensiv aus dem rohen JSON lesen – oder null (fehlt/kaputt → Default). */
export function parseSlotIndex(raw: string | null): SlotIndex | null {
  if (raw == null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as { activeId?: unknown; slots?: unknown };
  if (!Array.isArray(o.slots)) return null;
  const slots: SlotMeta[] = [];
  for (const s of o.slots) {
    if (typeof s !== "object" || s === null) continue;
    const m = s as { id?: unknown; name?: unknown; summary?: unknown };
    if (typeof m.id !== "string" || typeof m.name !== "string") continue;
    const out: SlotMeta = { id: m.id, name: m.name };
    if ("summary" in m) out.summary = m.summary;
    slots.push(out);
  }
  if (slots.length === 0) return null; // kein gültiger Slot → wie „kein Index" (Default greift)
  let activeId = typeof o.activeId === "string" ? o.activeId : "";
  if (!slots.some(s => s.id === activeId)) activeId = slots[0].id; // hängender Zeiger geheilt
  return { activeId, slots };
}

/** Persistierter Slot-Index oder null, wenn (noch) keiner existiert. */
function readIndex(): SlotIndex | null {
  return parseSlotIndex(rawGet(SLOTS_KEY));
}
/** Wirksamer Index: der persistierte, sonst der synthetische Default (Single-Slot). */
function effectiveIndex(): SlotIndex {
  return readIndex() ?? defaultIndex();
}
function writeIndex(idx: SlotIndex): void {
  rawSet(SLOTS_KEY, JSON.stringify(idx));
}
/** ID des aktiven Slots (synchron, ohne den Index zu materialisieren). */
export function activeSlotId(): string {
  return effectiveIndex().activeId;
}
/** Die nächste freie "slot-N"-ID, die im Index noch nicht vergeben ist. */
function nextSlotId(idx: SlotIndex): { id: string; n: number } {
  const used = new Set(idx.slots.map(s => s.id));
  let n = 1;
  while (used.has("slot-" + n)) n++;
  return { id: "slot-" + n, n };
}

/* ===== Roh-IO auf dem AKTIVEN Slot ===== */

/** Roh-JSON des Spielstands (aktiver Slot) lesen – oder null, wenn noch nichts gespeichert ist. */
export function readActiveRaw(): string | null {
  return rawGet(saveKeyFor(activeSlotId()));
}
/** Roh-JSON-String des Spielstands (aktiver Slot) ablegen. Gibt zurück, ob das Schreiben
 *  geklappt hat (im IndexedDB-Modus immer true; im Legacy-Modus false z.B. bei vollem
 *  localStorage) – wirft NIE. */
export function writeActiveRaw(json: string): boolean {
  return rawSet(saveKeyFor(activeSlotId()), json);
}
/** Spielstand (aktiver Slot) löschen (für „Zurücksetzen"). */
export function removeActive(): void {
  rawRemove(saveKeyFor(activeSlotId()));
}
/** Roh-JSON der letzten Sicherungskopie (aktiver Slot) lesen – oder null. */
export function readActiveBackupRaw(): string | null {
  return rawGet(backupKeyFor(activeSlotId()));
}
/** Die Roh-Datei in den Backup-Slot des AKTIVEN Slots sichern. Best effort. */
export function backupActive(raw: string): void {
  rawSet(backupKeyFor(activeSlotId()), raw);
}

/* ===== Slot-Verwaltung (#306) ===== */

/** Liste aller Slots (mindestens der Default-Slot). Im Single-Slot-Fall synthetisch. */
export function listSlots(): SlotMeta[] {
  return effectiveIndex().slots;
}

/**
 * Neuen, leeren Slot anlegen (materialisiert den Index, falls es noch keinen gibt) und
 * dessen ID zurückgeben. Wechselt NICHT von selbst dorthin (der Aufrufer entscheidet,
 * ob/wann gewechselt wird).
 */
export function createSlot(name: string): string {
  const idx = readIndex() ?? defaultIndex();
  const { id, n } = nextSlotId(idx);
  const trimmed = typeof name === "string" ? name.trim() : "";
  idx.slots.push({ id, name: trimmed || ("Spielstand " + n) });
  writeIndex(idx);
  return id;
}

/**
 * Aktiven Slot wechseln. Gibt false zurück, wenn die ID unbekannt ist (dann bleibt der
 * aktive Slot unverändert). Persistiert nur den Zeiger – die DATEN des Ziel-Slots lädt
 * erst der Reload des Aufrufers (init() hydriert sie dann).
 */
export function switchSlot(id: string): boolean {
  const idx = readIndex() ?? defaultIndex();
  if (!idx.slots.some(s => s.id === id)) return false;
  if (idx.activeId === id) return true; // schon aktiv – kein unnötiger Index-Schreibvorgang
  idx.activeId = id;
  writeIndex(idx);
  return true;
}

/** Einen Slot umbenennen. false, wenn die ID unbekannt ist. */
export function renameSlot(id: string, name: string): boolean {
  const idx = readIndex() ?? defaultIndex();
  const slot = idx.slots.find(s => s.id === id);
  if (!slot) return false;
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed) slot.name = trimmed;
  writeIndex(idx);
  return true;
}

/**
 * Einen Slot löschen (samt seiner Daten + Backup). false, wenn die ID unbekannt ist.
 * Wird der AKTIVE Slot gelöscht, fällt der aktive Zeiger auf einen verbliebenen Slot;
 * war es der letzte, wird ein frischer Default-Slot wiederhergestellt.
 */
export function deleteSlot(id: string): boolean {
  const idx = readIndex() ?? defaultIndex();
  const i = idx.slots.findIndex(s => s.id === id);
  if (i < 0) return false;
  rawRemove(saveKeyFor(id));
  rawRemove(backupKeyFor(id));
  idx.slots.splice(i, 1);
  if (idx.slots.length === 0) {
    idx.slots.push({ id: DEFAULT_SLOT_ID, name: DEFAULT_SLOT_NAME });
    idx.activeId = DEFAULT_SLOT_ID;
  } else if (idx.activeId === id) {
    idx.activeId = idx.slots[0].id;
  }
  writeIndex(idx);
  return true;
}

/**
 * Die opake Vorschau-Nutzlast (summary) des AKTIVEN Slots setzen (für den Spielstand-Wähler).
 * Ohne persistierten Index ein No-op – so erzeugt der 5-s-Auto-Save im Single-Slot-Fall
 * keinen Index-Churn und der pristine Zustand bleibt erhalten.
 */
export function setActiveSlotSummary(summary: unknown): void {
  const idx = readIndex();
  if (!idx) return;
  const slot = idx.slots.find(s => s.id === idx.activeId);
  if (!slot) return;
  slot.summary = summary;
  writeIndex(idx);
}
