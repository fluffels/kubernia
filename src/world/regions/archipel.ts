/* ===== GitOps-Archipel: Insel-Geometrie + Warp (Phaser-frei, pur testbar) =====
 * Erste eigene Nachbar-Insel (#92, Teil von Phase 4 #103). Wie world.ts liegt
 * hier nur die reine Mathe – Inselraster, begehbare Kacheln, Steg/Anleger,
 * reservierte Standplätze für den späteren NPC (#93) und die Quests (#94–97).
 * Die Optik baut ArchipelScene in scenes.ts aus denselben Wang-Tiles/Decken wie
 * die Hauptkarte. Das Bewegungs- & Kollisionsmodell teilt sich die Insel mit der
 * Hauptkarte (resolveMove/footprintSolid aus world.ts) – nichts dupliziert.
 */
import { TILE } from "../world";
import { npcSpawnForMap, objectForId, objectsForMap, objectFootprint, type Spawn } from "../../content/entities";

/** Inselraster (Kacheln). Kleiner als die Hauptkarte – eine kompakte, voll
 *  umrundbare Insel, die in einer Session sauber gefüllt werden kann. */
export const AW = 28;
export const AH = 22;

/** Bodenraster-Codes – identisch zur Hauptkarte, damit ArchipelScene exakt
 *  dieselbe renderGround-/Wang-Logik nutzen kann (-2 Wasser, -3 Sand, 0/1/2
 *  Gras, 25 Weg, -10 Steg/Planken). */
export const WATER = -2, SAND = -3, PATH = 25, DOCK = -10;

const CX = 14, CY = 9;   // Inselmittelpunkt (Lichtung mit NPC/Quest-Trigger)

/** Reservierter Standplatz des Insel-NPC „Argo" – seit #349 aus der datengesteuerten
 *  Entity-Registry (`content/data/entities.json`, Karte "archipel") gelesen statt hier
 *  hartcodiert. ArchipelScene loopt über `npcSpawnsForMap("archipel")`; diese Konstante
 *  ist der primäre Standplatz (Pfad-/Erreichbarkeits-Geometrie + scatterDecor). */
export const ARCHIPEL_NPC: Spawn = npcSpawnForMap("archipel");

/** Quest-Trigger der Insel (#94–97 hängen hier ihre GitOps-Quests ein). Bis dahin steht
 *  hier ein Wegweiser als sichtbarer, bewusster Platzhalter. Seit #357 aus der Entity-
 *  Registry (`content/data/entities.json`, Karte "archipel") gelesen statt hartcodiert –
 *  Position + Schild-Label sind Daten, kein Geometrie-Konstanten-Edit. */
export const ARCHIPEL_QUEST_TRIGGER = objectForId("archipel", "gitops-altar");

/** Ein Übergang zwischen zwei Karten: betritt man die Kachel (tx,ty), wechselt
 *  die Szene. Analog zu world.ts › Door, aber für ganze Karten. */
export interface Warp { id: string; tx: number; ty: number; title: string }

/* ===== Hauptkarte ⇄ Insel ===== */

/** Steg auf der Hauptkarte (Port Kubernia), der zum Archipel ablegt. Liegt im
 *  freien Wasser östlich der Stege, vom Kai aus erreichbar. Geometrie als SSOT,
 *  damit scenes.ts den Steg deckungsgleich zum Warp-Trigger baut. */
export const WORLD_JETTY = { x: 20, w: 2, y0: 27, y1: 31 } as const;

/** Warp-Kachel am Steg-Ende auf der Hauptkarte → Insel. */
export const WORLD_TO_ARCHIPEL: Warp = { id: "archipel-anleger", tx: 21, ty: 31, title: "GitOps-Archipel" };

/** Wohin der Spieler nach der Rückkehr auf der Hauptkarte gesetzt wird: auf den
 *  Steg direkt vor dem Anker (eine Kachel landwärts vom Warp-Ende), damit man
 *  symmetrisch dort ankommt, wo man abgelegt hat – und nicht auf der Warp-Kachel
 *  selbst (sonst sofortiger Re-Warp). Das „Scharf"-Gate in scenes.ts verhindert
 *  zusätzlich das Pingpong bei gehaltener Lauftaste. */
export const WORLD_RETURN = { tx: 21, ty: WORLD_JETTY.y1 - 1 } as const;

/** Rück-Anleger auf der Insel → Hauptkarte (Steg-Ende im Süden, eine Reihe vor
 *  dem Kartenrand, damit offenes Wasser die Insel umschließt). */
export const ARCHIPEL_TO_WORLD: Warp = { id: "heimhafen", tx: CX, ty: AH - 2, title: "Port Kubernia" };

/** Wohin der Spieler bei Ankunft auf der Insel gesetzt wird: eine Kachel
 *  landwärts vom Rück-Anleger, damit der Rück-Warp nicht sofort auslöst. */
export const ARCHIPEL_ARRIVAL = { tx: CX, ty: AH - 3 } as const;

/** Warp-Treffer: steht (px,py) auf der Warp-Kachel? (gefloort wie isSolidAt). */
export function warpAt(px: number, py: number, warp: Warp): boolean {
  return Math.floor(px / TILE) === warp.tx && Math.floor(py / TILE) === warp.ty;
}

/* ===== Inselaufbau (pur) ===== */

/** Organische Inselform: elliptischer Abstand zur Mitte + sanfte Sinus-Welle,
 *  damit die Küste nicht perfekt rund wirkt. Liefert die „Höhenstufe":
 *  2 = Land/Gras, 1 = Sandstrand, 0 = Wasser. */
function landLevel(x: number, y: number): 0 | 1 | 2 {
  const dx = (x - CX) / 1.08, dy = (y - CY) / 0.92;
  const wobble = Math.sin(x * 0.8) * 0.5 + Math.sin(y * 0.7 + 1.3) * 0.5;
  const r = Math.hypot(dx, dy) + wobble;
  if (r < 7.2) return 2;
  if (r < 8.7) return 1;
  return 0;
}

/** Deterministischer Gras-Frame-Index (0/1/2) wie auf der Hauptkarte. */
function grassFrame(x: number, y: number): number {
  const h = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
  return h < 80 ? 0 : h < 93 ? 1 : 2;
}

export interface ArchipelMap {
  W: number;
  H: number;
  ground: number[];
  solid: Uint8Array;
  trees: { x: number; y: number }[];
}

/** Baut das komplette Inselraster: Boden, Kollision, Bäume. Pur und
 *  deterministisch – in test/archipel.test.ts direkt geprüft (u.a. dass die
 *  Lichtung vom Anleger aus erreichbar ist). */
export function buildArchipel(): ArchipelMap {
  const W = AW, H = AH;
  const ground = new Array(W * H).fill(WATER);
  const solid = new Uint8Array(W * H);

  // Grundterrain aus der Inselform
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lvl = landLevel(x, y);
      const i = y * W + x;
      if (lvl === 0) { ground[i] = WATER; solid[i] = 1; }       // Wasser blockt
      else if (lvl === 1) ground[i] = SAND;                      // Strand begehbar
      else ground[i] = grassFrame(x, y);                         // Gras begehbar
    }
  }

  // Anleger-Steg im Süden: von der Sand-Unterkante (Spalte CX) bis zur
  // untersten Reihe als begehbare Planken über dem Wasser.
  let dockTop = CY;
  for (let y = CY; y < H; y++) { if (landLevel(CX, y) === 0) { dockTop = y; break; } }
  for (let y = dockTop; y <= H - 2; y++) {   // endet eine Reihe vor dem Rand → Insel bleibt von Wasser umschlossen
    for (const x of [CX - 1, CX]) { const i = y * W + x; ground[i] = DOCK; solid[i] = 0; }
  }

  // Weg von der Steg-Anbindung hoch zur Lichtung (Mitte)
  for (let y = CY; y <= dockTop; y++) { const i = y * W + CX; ground[i] = PATH; solid[i] = 0; }

  // Lichtung um die Mitte garantiert begehbar halten (kein Baum/Solid auf
  // NPC-Standplatz, Quest-Trigger und Ankunftsweg).
  const clear = new Set([
    ARCHIPEL_NPC.y * W + ARCHIPEL_NPC.x,
    ARCHIPEL_QUEST_TRIGGER.y * W + ARCHIPEL_QUEST_TRIGGER.x,
    CY * W + CX,
  ]);

  // Solide Objekte (props/tower) aus der Registry (#357) als Kachel-Solid markieren.
  // Der Archipel hat derzeit nur den begehbaren Quest-Trigger (übersprungen), aber so ist
  // ein künftiges Insel-Objekt nur ein JSON-Eintrag (entities.json), kein Geometrie-Edit.
  for (const o of objectsForMap("archipel")) {
    if (o.type === "quest_trigger") continue;
    for (const t of objectFootprint(o)) solid[t.y * W + t.x] = 1;
  }

  // Bäume als grüner Saum nahe der Küste – deterministisch, nie auf Weg/Lichtung/Steg.
  const trees: { x: number; y: number }[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (ground[i] !== 0 && ground[i] !== 1 && ground[i] !== 2) continue;  // nur Gras
      if (ground[i] === PATH || ground[i] === DOCK) continue;
      if (clear.has(i)) continue;
      const dx = (x - CX) / 1.08, dy = (y - CY) / 0.92;
      const r = Math.hypot(dx, dy);
      const h = (((x * 2654435761) ^ (y * 40503)) >>> 0) % 7;
      if (r > 5.4 && r < 7.0 && h === 0) {                                   // grüner Saum
        trees.push({ x, y });
        solid[i] = 1;
      }
    }
  }

  return { W, H, ground, solid, trees };
}
