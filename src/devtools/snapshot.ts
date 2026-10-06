/* Dev-Zustands-Snapshot (#1284): reine Funktion hinter `kqDev.state()`.
 *
 * Phaser rendert auf Canvas, der DOM zeigt davon fast nichts. Ein Agent liest darum
 * zuerst diesen JSON-Snapshot und nimmt einen Screenshot nur für die Optik. Die
 * Funktion hier ist Phaser-/DOM-frei: die Präsentation (scenes/devapi.ts) sammelt die
 * rohen Werte in eine `DevSnapshotSource`, der Aufbau samt Ableitungen (Kachel, Quest-
 * Ende, Dialog-Art, aktive Gefahren) ist Node-testbar. */
import { TILE } from "../world/world";

/** Version des Snapshot-Formats; bei inkompatibler Änderung hochzählen. */
export const DEV_SNAPSHOT_VERSION = 1;

export interface SnapshotPlayerSource { x: number; y: number; face: string; moving: boolean }

export interface SnapshotDialogueSource {
  npcId: string;
  lines: readonly string[];
  idx: number;
  /** null = Lese-Dialog, `{ menu: true }` = Menü, sonst Auswahl-Frage (`q`). */
  choice: { menu: true } | { q: string } | null;
}

export interface DevSnapshotSource {
  /** Laufende Szenen-Keys, oberste zuerst. */
  scenes: readonly string[];
  /** Oberste Szene mit Spielfigur. */
  scene: string | null;
  map: string | null;
  player: SnapshotPlayerSource | null;
  /** Einmal eingerastet, sobald ein Frame mit Spielfigur lief. */
  readyLatched: boolean;
  /** Fokussierte Quest; `""` = Endzustand. */
  currentQuestId: string;
  questIdx: number;
  questStep: number;
  questTask: number;
  /** Typ des aktuellen Schritts bzw. Text der aktuellen Aufgabe (null, wenn es keine gibt). */
  stepType: string | null;
  taskText: string | null;
  activeQuests: Readonly<Record<string, { step: number; task: number }>>;
  completedQuestCount: number;
  dialogue: SnapshotDialogueSource | null;
  /** Offene Overlay-Keys (aus dem OVERLAYS-Register). */
  overlays: readonly string[];
  blocking: boolean;
  clock: { day: number; hhmm: string; weekday: string; seasonName: string; gameDays: number };
  coins: number;
  xp: number;
  hazards: { pirate: unknown; kraken: unknown; storm: unknown };
}

export interface DevSnapshot {
  v: number;
  ready: boolean;
  scenes: string[];
  scene: string | null;
  map: string | null;
  player: { x: number; y: number; tx: number; ty: number; face: string; moving: boolean } | null;
  quest: { id: string; idx: number; step: number; task: number; stepType: string | null; taskText: string | null } | null;
  activeQuests: { id: string; step: number; task: number }[];
  completedQuests: number;
  dialog: { npcId: string; line: string; lines: number; kind: "read" | "choice" | "menu" } | null;
  overlays: string[];
  blocking: boolean;
  clock: { day: number; hhmm: string; weekday: string; season: string; gameDays: number };
  coins: number;
  xp: number;
  hazards: string[];
}

function buildPlayer(p: SnapshotPlayerSource | null): DevSnapshot["player"] {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return {
    x: Math.round(p.x), y: Math.round(p.y),
    tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE),
    face: p.face, moving: p.moving,
  };
}

function buildQuest(s: DevSnapshotSource): DevSnapshot["quest"] {
  if (!s.currentQuestId) return null;
  return {
    id: s.currentQuestId, idx: s.questIdx, step: s.questStep, task: s.questTask,
    stepType: s.stepType, taskText: s.taskText,
  };
}

function buildDialog(d: SnapshotDialogueSource | null): DevSnapshot["dialog"] {
  if (!d) return null;
  if (d.choice === null) {
    return { npcId: d.npcId, line: d.lines[d.idx] ?? "", lines: d.lines.length, kind: "read" };
  }
  if ("menu" in d.choice) return { npcId: d.npcId, line: "", lines: 0, kind: "menu" };
  return { npcId: d.npcId, line: d.choice.q, lines: 0, kind: "choice" };
}

function buildHazards(h: DevSnapshotSource["hazards"]): string[] {
  const out: string[] = [];
  if (h.pirate) out.push("pirate");
  if (h.kraken) out.push("kraken");
  if (h.storm) out.push("storm");
  return out;
}

/** Baut den JSON-tauglichen Snapshot (nur Primitive/Arrays/Objekte, keine Zyklen). */
export function buildDevSnapshot(s: DevSnapshotSource): DevSnapshot {
  const player = buildPlayer(s.player);
  return {
    v: DEV_SNAPSHOT_VERSION,
    ready: s.readyLatched || player !== null,
    scenes: [...s.scenes],
    scene: s.scene,
    map: s.map,
    player,
    quest: buildQuest(s),
    activeQuests: Object.entries(s.activeQuests)
      .map(([id, p]) => ({ id, step: p.step, task: p.task }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    completedQuests: s.completedQuestCount,
    dialog: buildDialog(s.dialogue),
    overlays: [...s.overlays],
    blocking: s.blocking,
    clock: { day: s.clock.day, hhmm: s.clock.hhmm, weekday: s.clock.weekday, season: s.clock.seasonName, gameDays: s.clock.gameDays },
    coins: s.coins,
    xp: s.xp,
    hazards: buildHazards(s.hazards),
  };
}
