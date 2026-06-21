/* ===== Monitoring-Leuchtturm: Klippen-Bereich + Pfad/Warp (Phaser-frei, pur testbar) =====
 * Eigener begehbarer Höhen-Bereich (#111, Teil von Phase 5 #22). Wie world.ts und
 * archipel.ts liegt hier nur die reine Mathe – diesmal eine erhöhte FELS-KLIPPE
 * statt einer Insel: eine Gras-Hochebene, von einem begehbaren Stein-Klippenrand
 * (kai-Tiles, trifft das Meer) gesäumt, über die man von der Hauptkarte einen Pfad
 * „hochläuft" (Stardew-Manier). Oben stehen der große Leuchtturm, die Monitoring-
 * Station (Quest-Trigger) und ein reservierter Standplatz für den Observability-NPC.
 * Die Optik baut LighthouseScene in scenes.ts aus denselben Wang-Tiles wie die
 * Hauptkarte (inkl. Stein-Kai für den Klippenrand); Bewegung/Kollision teilt sich
 * der Bereich über resolveMove/footprintSolid mit der Hauptkarte – nichts dupliziert.
 *
 * Der Warp-Primitive (Warp + warpAt) wohnt schon in archipel.ts und ist generisch –
 * von dort wiederverwendet statt ein zweites Mal definiert.
 */
import { warpAt, type Warp } from "./archipel";
import { npcSpawnForMap, objectForId, objectsForMap, objectFootprint, type Spawn } from "./content/entities";

export { warpAt, type Warp };

/** Klippenraster (Kacheln). Kompakt und voll begehbar, in einer Session füllbar. */
export const LW = 26;
export const LH = 22;

/** Bodenraster-Codes – identisch zur Hauptkarte (renderGround), damit LighthouseScene
 *  exakt dieselbe Wang-Logik nutzen kann: -2 Wasser, 25 Pfad, 0/1/2 Gras,
 *  96/97/98 Stein-Kai (der felsige Klippenrand/-kamm). KEIN Sandstrand – eine Klippe
 *  fällt steinig zum Meer ab. */
export const WATER = -2, PATH = 25;
export const STONE_CODES = [96, 97, 98] as const;

const CX = 13, CY = 9;   // Mittelpunkt der Gras-Hochebene

/** Standplatz des großen Leuchtturms (oben/Norden der Ebene). 2×2-Fußabdruck solide.
 *  Seit #357 aus der Entity-Registry (Karte "lighthouse", Typ "tower", w/h=2) gelesen. */
export const LIGHTHOUSE_TOWER = objectForId("lighthouse", "leuchtturm");

/** Standplatz des Observability-NPC „Lumi" (#112): die Leuchtturmwärterin, die ab
 *  den Phase-5-Quests (#113–116) das Monitoring vergibt. Seit #349 aus der Entity-
 *  Registry (`content/data/entities.json`, Karte "lighthouse") gelesen statt hier
 *  hartcodiert; der Eintrag dort liegt auf (CX-2, CY) der Klippen-Hochebene. */
export const LIGHTHOUSE_NPC: Spawn = npcSpawnForMap("lighthouse");

/** Quest-Trigger = die Monitoring-Station (Dashboard + Alarmglocke). Hier docken die
 *  Phase-5-Observability-Quests an; bis dahin steht ein Schild als Platzhalter. Seit #357
 *  aus der Entity-Registry gelesen (Position + Schild-Label sind Daten). */
export const LIGHTHOUSE_QUEST_TRIGGER = objectForId("lighthouse", "monitoring-station");

/** Standplätze der Monitoring-Deko (PixelLab, #111) – seit #357 aus der Entity-Registry
 *  (Karte "lighthouse", Typ "prop"), damit Sprite und Kollisions-Solid deckungsgleich aus
 *  denselben Daten kommen. */
export const LIGHTHOUSE_GRAFANA = objectForId("lighthouse", "grafana-tafel");   // Grafana-Dashboard-Tafel
export const LIGHTHOUSE_BELL = objectForId("lighthouse", "alarm-glocke");       // Alarm-Glocke

/* ===== Hauptkarte ⇄ Klippe ===== */

/** Warp-Kachel auf der Hauptkarte am Fuß des bestehenden Leuchtturms (Port Kubernia,
 *  Osten): man läuft den kurzen Stufen-Pfad hoch und betritt die Klippe. Geometrie als
 *  SSOT, damit scenes.ts den Pfad/Marker deckungsgleich zum Trigger baut. Die Kachel
 *  liegt direkt südlich des Turm-Fußabdrucks (Solids 47/48 × 23/24). */
export const WORLD_TO_LIGHTHOUSE: Warp = { id: "leuchtturm-aufgang", tx: 48, ty: 25, title: "Monitoring-Leuchtturm" };

/** Wohin der Spieler nach der Rückkehr auf der Hauptkarte gesetzt wird: eine Kachel
 *  landwärts (südlich) vom Aufgang, NICHT auf die Warp-Kachel selbst (sonst sofortiger
 *  Re-Warp). Das „Scharf"-Gate in scenes.ts verhindert zusätzlich das Pingpong. */
export const WORLD_RETURN_LH = { tx: 48, ty: 26 } as const;

/** Rück-Warp auf der Klippe → Hauptkarte: am südlichen Klippenrand (oberes Ende der
 *  Treppe nach unten), eine Reihe vor dem letzten Land. */
export const LIGHTHOUSE_TO_WORLD: Warp = { id: "abstieg", tx: CX, ty: southEdgeRow(), title: "Port Kubernia" };

/** Wohin der Spieler bei Ankunft auf der Klippe gesetzt wird: eine Kachel landwärts
 *  (nördlich) vom Rück-Warp, damit der Abstieg nicht sofort auslöst. */
export const LIGHTHOUSE_ARRIVAL = { tx: CX, ty: southEdgeRow() - 1 } as const;

/* ===== Klippenaufbau (pur) ===== */

/** Organische Klippenform: elliptischer Abstand zur Mitte + sanfte Sinus-Welle, damit
 *  der Fels nicht perfekt rund wirkt. Liefert die Stufe: 2 = Gras-Hochebene,
 *  1 = Stein-Klippenrand (begehbarer Felskamm), 0 = Meer. */
function landLevel(x: number, y: number): 0 | 1 | 2 {
  const dx = (x - CX) / 1.12, dy = (y - CY) / 0.96;
  const wobble = Math.sin(x * 0.7) * 0.45 + Math.sin(y * 0.6 + 0.8) * 0.45;
  const r = Math.hypot(dx, dy) + wobble;
  if (r < 6.4) return 2;
  if (r < 8.0) return 1;
  return 0;
}

/** Südlichste Land-Reihe in der Mittelspalte (das Ende des Aufgangs/Pfads). Aus
 *  landLevel abgeleitet, damit Warp/Ankunft und die tatsächliche Geometrie nie
 *  auseinanderdriften. */
function southEdgeRow(): number {
  for (let y = CY; y < LH; y++) if (landLevel(CX, y) === 0) return y - 1;
  return LH - 2;
}

/** Deterministischer Gras-Frame-Index (0/1/2) wie auf der Hauptkarte. */
function grassFrame(x: number, y: number): number {
  const h = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
  return h < 80 ? 0 : h < 93 ? 1 : 2;
}

export interface LighthouseMap {
  W: number;
  H: number;
  ground: number[];
  solid: Uint8Array;
  rocks: { x: number; y: number }[];
}

/** Baut das komplette Klippenraster: Boden (Meer/Stein-Rand/Gras), Kollision,
 *  Felsbrocken am Rand. Pur und deterministisch – in test/lighthouse.test.ts direkt
 *  geprüft (u.a. dass die Station/der NPC-Standplatz vom Aufgang aus erreichbar ist). */
export function buildLighthouse(): LighthouseMap {
  const W = LW, H = LH;
  const ground = new Array<number>(W * H).fill(WATER);
  const solid = new Uint8Array(W * H);

  // Grundterrain aus der Klippenform
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lvl = landLevel(x, y);
      const i = y * W + x;
      if (lvl === 0) { ground[i] = WATER; solid[i] = 1; }            // Meer blockt
      else if (lvl === 1) ground[i] = STONE_CODES[(x * 3 + y) % 3];  // Stein-Klippenrand begehbar
      else ground[i] = grassFrame(x, y);                             // Gras-Hochebene begehbar
    }
  }

  // Aufgangs-Pfad: von der Hochebene (Mitte) hinunter zum südlichen Klippenrand.
  const edge = southEdgeRow();
  for (let y = CY; y <= edge; y++) { const i = y * W + CX; ground[i] = PATH; solid[i] = 0; }

  // Solide Objekte (Leuchtturm-Fuß 2×2 + Monitoring-Deko) aus der Registry (#357) als
  // Kachel-Solid markieren – der Turm über seinen w/h-Fußabdruck, props 1×1. Sprite und
  // Solid kommen so aus denselben Daten; ein neues Objekt ist nur ein JSON-Eintrag.
  for (const o of objectsForMap("lighthouse")) {
    if (o.type === "quest_trigger") continue;
    for (const t of objectFootprint(o)) solid[t.y * W + t.x] = 1;
  }

  // Reserviert begehbar halten (NPC-Standplatz, Quest-Trigger, Ankunft, Warp, Pfad).
  const reserved = new Set([
    LIGHTHOUSE_NPC.y * W + LIGHTHOUSE_NPC.x,
    LIGHTHOUSE_QUEST_TRIGGER.y * W + LIGHTHOUSE_QUEST_TRIGGER.x,
    LIGHTHOUSE_ARRIVAL.ty * W + LIGHTHOUSE_ARRIVAL.tx,
    LIGHTHOUSE_TO_WORLD.ty * W + LIGHTHOUSE_TO_WORLD.tx,
  ]);
  for (const idx of reserved) solid[idx] = 0;

  // Felsbrocken als Saum auf dem Stein-Rand – deterministisch, nie auf Pfad/Reserviert.
  const rocks: { x: number; y: number }[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const v = ground[i];
      if (v !== 96 && v !== 97 && v !== 98) continue;   // nur Stein-Rand
      if (solid[i]) continue;
      if (reserved.has(i)) continue;
      const h = (((x * 2654435761) ^ (y * 40503)) >>> 0) % 6;
      if (h === 0) { rocks.push({ x, y }); solid[i] = 1; }
    }
  }

  return { W, H, ground, solid, rocks };
}
