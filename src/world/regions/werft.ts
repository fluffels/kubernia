/* ===== Heimat-Werft: Werft-Hof + Helling/Anleger/Warp (Phaser-frei, pur testbar) =====
 * Die ABSCHLUSS-Insel der Phase 10 (#26): die „Heimat-Werft" – der Heimathafen, in dem der
 * Spieler im Capstone seinen EIGENEN Service baut (docker build), deployt und erreichbar macht
 * (curl). Wie world.ts/archipel.ts/lighthouse.ts/warehouse.ts/watchtower.ts/flotte.ts liegt hier
 * nur die reine Mathe – diesmal ein WERFT-HOF: eine rechteckige, gepflasterte Hof-Fläche (Gras),
 * von einer begehbaren Stein-Kai-Wand zum Meer gesäumt, mit einer hölzernen HELLING (Slipway) im
 * Süden, die als breite Planken-Rampe über dem Wasser zum Rück-Anleger hinunterführt. Auf der
 * Helling liegt das im Bau befindliche Schiff (der „eigene Service", den man hier zusammenbaut),
 * ringsum Werft-Gerüste und -Krane. Vom Hafen (Port Kubernia) ist die Werft über einen Holz-
 * Anleger an der freien Kai-Lücke (x22) erreichbar.
 *
 * Scope (Stand #166): Bereich + Anleger/Warp + Standplätze für NPC + Quest-Trigger.
 * Die Werftmeisterin Greta steht seit #166 (Sprite + Smalltalk) auf dem reservierten Hof-Platz
 * (Registry-Eintrag in entities.json); die Capstone-Quest folgt mit #167, Drills #169,
 * Progression #171, Tests #172. Der Quest-Trigger-Platz (objectsForMap) ist noch frei – bis #167
 * liefert objectsForMap für „werft" leer, was die RegionScene verträgt; der Hof-Platz wird
 * begehbar freigehalten, damit NPC + Quest-Trigger garantiert vom Anleger aus erreichbar sind.
 *
 * Die Optik baut die datengetriebene RegionScene (#427) aus denselben Wang-Tiles wie die
 * Hauptkarte (Stein-Kai + Gras-Hof + Holz-Helling); Bewegung/Kollision teilt sich der Bereich
 * über resolveMove/footprintSolid mit der Hauptkarte – nichts dupliziert. Das im Bau befindliche
 * Schiff (echtes ship-Sprite) + die Gerüste rendert der `decorate`-Hook in scenes/regions.ts auf
 * den hier berechneten Standplätzen.
 *
 * Der Warp-Primitive (Warp + warpAt) wohnt in archipel.ts und ist generisch – von dort
 * wiederverwendet statt erneut definiert (wie in lighthouse.ts/warehouse.ts/watchtower.ts/flotte.ts).
 */
import { warpAt, type Warp } from "./archipel";
import { objectsForMap, objectFootprint } from "../../content/entities";

export { warpAt, type Warp };

/** Werft-Raster (Kacheln). Kompakter, klar umrissener Werft-Hof – in einer Session füllbar,
 *  mit Platz für den späteren NPC (#166) + Quest-Trigger (#167). */
export const WERFT_W = 26;
export const WERFT_H = 20;

/** Bodenraster-Codes – identisch zur Hauptkarte (renderGround), damit die RegionScene exakt
 *  dieselbe Wang-Logik nutzen kann: -2 Wasser, -10 Holz-Helling/-Steg, 25 Pfad, 0/1/2 Gras
 *  (Hof-Fläche), 96/97/98 Stein-Kai (die Hof-Wand zum Meer). */
export const WATER = -2, DOCK = -10, PATH = 25;
export const STONE_CODES = [96, 97, 98] as const;

/** Gepflasterte Hof-Fläche als RECHTECK (eine gebaute Werft ist gerade, keine organische
 *  Insel): Gras-Innenfläche [QX0..QX1]×[QY0..QY1], von einer ein Kachel breiten Stein-Kai-Wand
 *  umschlossen, außen herum Meer. */
export const QX0 = 3, QX1 = 22, QY0 = 3, QY1 = 12;

const CX = 12, CY = 7;   // Mitte des Hofs (Werft-Platz mit NPC/Quest-Trigger)

/** Helling (Slipway): eine 4 Kacheln breite hölzerne Bau-Rampe, mittig im Süden. Sie führt von
 *  der Kaikante als begehbare Planken über dem Wasser hinunter bis eine Reihe vor den Kartenrand
 *  – breiter als ein normaler Steg, denn auf ihr wird das Schiff gebaut. */
export const SLIP_X0 = CX - 2, SLIP_X1 = CX + 1;

/** Standplatz der Werftmeisterin Greta (#166): am Hof-Platz, gut vom Anleger aus erreichbar.
 *  Greta ist als `greta` auf Karte „werft" in entities.json verdrahtet – diese Kachel MUSS dem
 *  Spawn entsprechen (test/content.test.ts prüft das) und bleibt begehbar/deko-frei. */
export const WERFT_NPC = { x: CX - 3, y: CY } as const;

/** Reservierter Standplatz des späteren Quest-Triggers (#167, „eigenen Service bauen &
 *  deployen"): am Kopf der Helling auf der Hof-Fläche. Wie WERFT_NPC noch kein Registry-Eintrag. */
export const WERFT_BUILD_TRIGGER = { x: CX, y: CY } as const;

/* ===== Hauptkarte ⇄ Heimat-Werft ===== */

/** Steg auf der Hauptkarte (Port Kubernia): ein Holz-Anleger an der freien Kai-Lücke (x22–23,
 *  zwischen dem Archipel-Anleger x20–21 und dem Wachturm-Anleger x24–25), der ins offene Wasser
 *  hinausragt. terrain.ts überschreibt diese Wasserkacheln in placeHarborObjects() zu begehbaren
 *  Planken (Muster: Lager-/Wachturm-/Flotte-Anleger, nicht in harborGeometry – darum keine
 *  harbor.tmj-Neugenerierung nötig). */
export const WORLD_JETTY_WF = { x: 22, w: 2, y0: 27, y1: 31 } as const;

/** Warp-Kachel am Steg-Ende auf der Hauptkarte → Werft. */
export const WORLD_TO_WERFT: Warp = { id: "werft-anleger", tx: 22, ty: 31, title: "Heimat-Werft" };

/** Wohin der Spieler nach der Rückkehr auf der Hauptkarte gesetzt wird: eine Kachel landwärts
 *  (nördlich) vom Anleger auf den Planken, NICHT auf die Warp-Kachel selbst (sonst sofortiger
 *  Re-Warp). Das „Scharf"-Gate verhindert zusätzlich das Pingpong. */
export const WORLD_RETURN_WF = { tx: 22, ty: 30 } as const;

/** Rück-Anleger in der Werft → Hauptkarte (Fuß der Helling im Süden, eine Reihe vor dem
 *  Kartenrand, damit offenes Wasser den Hof umschließt). */
export const WERFT_TO_WORLD: Warp = { id: "heimhafen", tx: CX, ty: WERFT_H - 2, title: "Port Kubernia" };

/** Wohin der Spieler bei Ankunft in der Werft gesetzt wird: eine Kachel landwärts (nördlich)
 *  vom Rück-Anleger, damit der Rück-Warp nicht sofort auslöst. */
export const WERFT_ARRIVAL = { tx: CX, ty: WERFT_H - 3 } as const;

/* ===== Werft-Aufbau (pur) ===== */

/** Höhenstufe einer Zelle: 2 = Gras-Hof-Fläche, 1 = Stein-Kai-Wand (begehbar), 0 = Meer.
 *  Rechteckig, weil ein Werft-Kai gebaut und gerade ist. */
function landLevel(x: number, y: number): 0 | 1 | 2 {
  if (x >= QX0 && x <= QX1 && y >= QY0 && y <= QY1) return 2;                  // gepflasterte Hof-Fläche
  if (x >= QX0 - 1 && x <= QX1 + 1 && y >= QY0 - 1 && y <= QY1 + 1) return 1;  // Stein-Kai-Wand (1 Kachel Ring)
  return 0;                                                                    // Meer
}

/** Deterministischer Gras-Frame-Index (0/1/2) wie auf der Hauptkarte. */
function grassFrame(x: number, y: number): number {
  const h = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
  return h < 80 ? 0 : h < 93 ? 1 : 2;
}

export interface WerftMap {
  W: number;
  H: number;
  ground: number[];
  solid: Uint8Array;
  /** Standplatz des im Bau befindlichen Schiffs (der „eigene Service") auf der Helling – auf
   *  Holz-Planken, fußlinien-depth-sortiert vom decorate-Hook gerendert. */
  hull: { x: number; y: number };
  /** Standplätze der Werft-Gerüste (Bau-Gerüst-Primitive) am Helling-Rand – Deko, nicht
   *  begehbar (auf der Kai-Wand), vom decorate-Hook gezeichnet. */
  scaffolds: { x: number; y: number }[];
}

/** Baut das komplette Werft-Raster: Boden (Meer/Stein-Kai/Gras-Hof), Helling (breite Holz-Rampe),
 *  Pfad, Kollision und die Bau-Standplätze (Schiffsrumpf + Gerüste). Pur und deterministisch –
 *  in test/werft.test.ts direkt geprüft (u.a. dass der Hof-Platz vom Anleger aus erreichbar ist
 *  und der Hof ringsum von Meer umschlossen liegt). */
export function buildWerft(): WerftMap {
  const W = WERFT_W, H = WERFT_H;
  const ground = new Array<number>(W * H).fill(WATER);
  const solid = new Uint8Array(W * H);

  // Grundterrain aus der Hof-Form.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lvl = landLevel(x, y);
      const i = y * W + x;
      if (lvl === 0) { ground[i] = WATER; solid[i] = 1; }            // Meer blockt
      else if (lvl === 1) ground[i] = STONE_CODES[(x * 3 + y) % 3];  // Stein-Kai-Wand begehbar
      else ground[i] = grassFrame(x, y);                             // Hof-Fläche begehbar
    }
  }

  // Helling (Slipway): breite Holz-Rampe (Spalten SLIP_X0..SLIP_X1) von der Kaikante
  // (Reihe QY1+1 = Stein) als begehbare Planken über dem Wasser hinunter bis eine Reihe vor
  // den Kartenrand. Breiter als ein normaler Steg, weil hier das Schiff gebaut wird.
  for (let y = QY1 + 2; y <= H - 2; y++) {
    for (let x = SLIP_X0; x <= SLIP_X1; x++) { const i = y * W + x; ground[i] = DOCK; solid[i] = 0; }
  }

  // Pfad: vom Helling-Kopf/der Kaikante hoch zum Hof-Platz (Spalte CX).
  for (let y = CY; y <= QY1 + 1; y++) { const i = y * W + CX; ground[i] = PATH; solid[i] = 0; }

  // Reserviert begehbar halten: Ankunft, Rück-Warp, der NPC-/Quest-Trigger-Standplatz und die
  // durchgehende Hof-Reihe (y = CY zwischen NPC und Quest-Trigger). So sind NPC + Trigger
  // garantiert vom Pfad/Anleger aus erreichbar – kein Gerüst/keine Deko darf den Weg zumauern.
  const reserved = new Set<number>([
    WERFT_ARRIVAL.ty * W + WERFT_ARRIVAL.tx,
    WERFT_TO_WORLD.ty * W + WERFT_TO_WORLD.tx,
    WERFT_NPC.y * W + WERFT_NPC.x,
    WERFT_BUILD_TRIGGER.y * W + WERFT_BUILD_TRIGGER.x,
  ]);
  for (let x = WERFT_NPC.x; x <= WERFT_BUILD_TRIGGER.x; x++) reserved.add(CY * W + x);
  for (const idx of reserved) solid[idx] = 0;

  // Solide Registry-Objekte (props/tower) als Kachel-Solid markieren. Die Karte hat in #165 noch
  // keine (NPC/Quest-Trigger folgen mit #166/#167); der Loop ist Vorsorge, damit ein künftiges
  // Hof-Objekt nur ein JSON-Eintrag ist, kein Geometrie-Edit (wie bei der Flotte #148).
  for (const o of objectsForMap("werft")) {
    if (o.type === "quest_trigger") continue;
    for (const t of objectFootprint(o)) solid[t.y * W + t.x] = 1;
  }
  // Reservierte Kacheln nach dem Objekt-Loop erneut sichern (ein Objekt darf den Weg nicht
  // versperren) – wirkt nur, wenn künftige Objekte ungünstig liegen; heute ein No-Op.
  for (const idx of reserved) solid[idx] = 0;

  // Das im Bau befindliche Schiff: oben auf der Helling (auf Holz-Planken), unter dem Hof.
  // Auf Planken stehend (begehbar bleibt es nicht – der decorate-Hook macht die Rumpf-Kachel
  // solide), klar als Mittelpunkt der Werft erkennbar.
  const hull = { x: CX, y: QY1 + 3 };
  solid[hull.y * W + hull.x] = 1;

  // Werft-Gerüste: zwei Bau-Gerüste links und rechts der Helling auf der Stein-Kai-Wand
  // (Reihe QY1+1), flankieren das Schiff. Deko (auf solider Kai-Wand, nicht zusätzlich nötig).
  const scaffolds = [
    { x: SLIP_X0 - 1, y: QY1 + 1 },
    { x: SLIP_X1 + 1, y: QY1 + 1 },
  ];

  return { W, H, ground, solid, hull, scaffolds };
}
