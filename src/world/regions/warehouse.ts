/* ===== Lagerhallen-Viertel: Kai-Plattform + Steg/Warp (Phaser-frei, pur testbar) =====
 * Eigener begehbarer Hafen-Bereich (#124, Teil von Phase 7 #24: stateful Workloads &
 * Datendauerhaftigkeit). Wie world.ts/archipel.ts/lighthouse.ts liegt hier nur die reine
 * Mathe – diesmal ein BEBAUTER HAFENKAI: eine rechteckige, gepflasterte Quay-Fläche
 * (Gras-Boden), von einer begehbaren Stein-Kai-Wand zum Meer gesäumt, über einen
 * Holz-Steg im Süden (Planken über dem Wasser) von der Hauptkarte erreichbar.
 * Oben am Wasser stehen die Verladekräne, auf der Fläche stapeln sich Frachtcontainer
 * (Daten-/Volume-Metapher zu Phase 7) sowie Kisten/Fässer; dazu ein reservierter
 * Standplatz für den Viertel-NPC (#125) und der Quest-Trigger (#127/#129 hängen hier an).
 * Die Optik baut WarehouseScene in scenes.ts aus denselben Wang-Tiles wie die Hauptkarte
 * (Stein-Kai + Holz-Steg); Bewegung/Kollision teilt sich der Bereich über
 * resolveMove/footprintSolid mit der Hauptkarte – nichts dupliziert.
 *
 * Der Warp-Primitive (Warp + warpAt) wohnt in archipel.ts und ist generisch –
 * von dort wiederverwendet statt ein drittes Mal definiert (wie in lighthouse.ts).
 */
import { warpAt, type Warp } from "./archipel";
import { npcSpawnForMap, objectForId, objectsForMap, objectFootprint, type EntityObject, type Spawn } from "../../content/entities";
import { fillTerrain, markRegistrySolids } from "./geometry";

export { warpAt, type Warp };

/** Viertel-Raster (Kacheln). Kompakter, klar umrissener Hafenkai – in einer Session füllbar. */
export const WW = 28;
export const WH = 20;

/** Bodenraster-Codes – identisch zur Hauptkarte (renderGround), damit WarehouseScene
 *  exakt dieselbe Wang-Logik nutzen kann: -2 Wasser, -10 Holz-Steg, 25 Pfad,
 *  0/1/2 Gras (Quay-Fläche), 96/97/98 Stein-Kai (die Quay-Wand zum Meer). */
export const WATER = -2, DOCK = -10, PATH = 25;
export const STONE_CODES = [96, 97, 98] as const;

/** Gepflasterte Quay-Fläche als RECHTECK (ein gebauter Hafen ist gerade, keine
 *  organische Insel): Gras-Innenfläche [QX0..QX1]×[QY0..QY1], von einer ein Kachel
 *  breiten Stein-Kai-Wand umschlossen, außen herum Meer. */
export const QX0 = 3, QX1 = 24, QY0 = 3, QY1 = 14;

const CX = 14, CY = 8;   // Mitte der Quay-Fläche (Kontor-Platz mit NPC/Quest-Trigger)

/** Standplatz des Viertel-NPC „Knut", Speicher-Verwalter (#125): Hüter der Daten/Volumes,
 *  gibt ab den stateful-Quests (#127/#129) die Hands-on-Aufgaben aus. Seit #349 aus der
 *  Entity-Registry (`content/data/entities.json`, Karte "warehouse") gelesen statt hier
 *  hartcodiert; der Eintrag dort liegt auf (CX-2, CY) der Quay-Fläche. */
export const WAREHOUSE_NPC: Spawn = npcSpawnForMap("warehouse");

/** Quest-Trigger = das Lager-Kontor. Hier docken die Phase-7-Quests an (#127/#129). Seit
 *  #357 aus der Entity-Registry gelesen (Position + Schild-Label sind Daten). */
export const WAREHOUSE_QUEST_TRIGGER = objectForId("warehouse", "lager-kontor");

/** Standplätze der Verladekräne (oben am Wasser, „über" der Kaikante) und der Frachtcontainer-
 *  Stapel (Daten/Volumes-Metapher der Phase). Seit #357 aus der Entity-Registry abgeleitet
 *  (Karte "warehouse", Typ "prop") – Sprite und Kollisions-Solid kommen aus denselben Daten,
 *  ein zusätzlicher Kran/Container ist nur ein JSON-Eintrag. */
export const WAREHOUSE_CRANES = objectsForMap("warehouse").filter((o) => o.sprite === "crane");
export const WAREHOUSE_CONTAINERS = objectsForMap("warehouse").filter((o) => o.sprite === "container");

/* ===== Hauptkarte ⇄ Lagerhallen-Viertel ===== */

/** Steg auf der Hauptkarte (Port Kubernia): ein Holz-Anleger, der am WESTENDE des
 *  Hafenkais (Stein-Kante x3–24) ins offene Wasser hinausragt – klar getrennt von den
 *  drei Cluster-Stegen (x5–7/11–13/17–19). scenes.ts überschreibt diese Wasserkacheln in
 *  placeHarborObjects() zu begehbaren Planken (Muster: Leuchtturm-Aufgang, nicht in
 *  harborGeometry – darum keine harbor.tmj-Neugenerierung nötig). */
export const WORLD_JETTY_WH = { x: 3, w: 2, y0: 27, y1: 31 } as const;

/** Warp-Kachel am Steg-Ende auf der Hauptkarte → Viertel. */
export const WORLD_TO_WAREHOUSE: Warp = { id: "lager-anleger", tx: 3, ty: 31, title: "Lagerhallen-Viertel" };

/** Wohin der Spieler nach der Rückkehr auf der Hauptkarte gesetzt wird: eine Kachel
 *  landwärts (nördlich) vom Anleger auf den Planken, NICHT auf die Warp-Kachel selbst
 *  (sonst sofortiger Re-Warp). Das „Scharf"-Gate in scenes.ts verhindert das Pingpong. */
export const WORLD_RETURN_WH = { tx: 3, ty: 30 } as const;

/** Rück-Anleger im Viertel → Hauptkarte (Steg-Ende im Süden, eine Reihe vor dem
 *  Kartenrand, damit offenes Wasser den Kai umschließt). */
export const WAREHOUSE_TO_WORLD: Warp = { id: "heimhafen", tx: CX, ty: WH - 2, title: "Port Kubernia" };

/** Wohin der Spieler bei Ankunft im Viertel gesetzt wird: eine Kachel landwärts
 *  (nördlich) vom Rück-Anleger, damit der Rück-Warp nicht sofort auslöst. */
export const WAREHOUSE_ARRIVAL = { tx: CX, ty: WH - 3 } as const;

/* ===== Kai-Aufbau (pur) ===== */

/** Höhenstufe einer Zelle: 2 = Gras-Quay-Fläche, 1 = Stein-Kai-Wand (begehbar),
 *  0 = Meer. Rechteckig, weil ein Hafenkai gebaut und gerade ist. */
function landLevel(x: number, y: number): 0 | 1 | 2 {
  if (x >= QX0 && x <= QX1 && y >= QY0 && y <= QY1) return 2;             // gepflasterte Quay-Fläche
  if (x >= QX0 - 1 && x <= QX1 + 1 && y >= QY0 - 1 && y <= QY1 + 1) return 1; // Stein-Kai-Wand (1 Kachel Ring)
  return 0;                                                               // Meer
}

export interface WarehouseMap {
  W: number;
  H: number;
  ground: number[];
  solid: Uint8Array;
  /** Deterministisch gestreute Lager-Güter (Kisten/Fässer) auf der Quay-Fläche. */
  goods: { x: number; y: number; kind: "crate" | "barrel" }[];
}

/** Holz-Steg im Süden (Spalten CX-1/CX): von der Kaikante (Reihe QY1+1 = Stein) als
 *  begehbare Planken über dem Wasser hinunter bis eine Reihe vor den Kartenrand, plus
 *  den Pfad vom Steg/der Kaikante hoch zur Kontor-Mitte (Spalte CX). */
function carveJettyAndPath(W: number, H: number, ground: number[], solid: Uint8Array): void {
  for (let y = QY1 + 2; y <= H - 2; y++) {
    for (const x of [CX - 1, CX]) { const i = y * W + x; ground[i] = DOCK; solid[i] = 0; }
  }
  for (let y = CY; y <= QY1 + 1; y++) { const i = y * W + CX; ground[i] = PATH; solid[i] = 0; }
}

/** Reserviert begehbar halten: Ankunft, Rück-Warp + die durchgehende Kontor-Plaza-Reihe
 *  (y = CY von NPC-Standplatz bis Quest-Trigger). So ist der NPC garantiert vom Pfad/
 *  Anleger aus erreichbar – kein Gut/Container darf den Weg zumauern. */
function reservedWalkable(W: number): Set<number> {
  const reserved = new Set<number>([
    WAREHOUSE_ARRIVAL.ty * W + WAREHOUSE_ARRIVAL.tx,
    WAREHOUSE_TO_WORLD.ty * W + WAREHOUSE_TO_WORLD.tx,
  ]);
  for (let x = WAREHOUSE_NPC.x; x <= WAREHOUSE_QUEST_TRIGGER.x; x++) reserved.add(CY * W + x);
  return reserved;
}

/** Lager-Güter (Kisten/Fässer) deterministisch auf der Quay-Fläche streuen – nie auf
 *  Pfad/Steg/Reserviert und nie auf eine solide Objekt-Kachel (Kran/Container). Setzt
 *  die getroffenen Kacheln solide und liefert die Positionen. */
function scatterGoods(
  W: number,
  ground: number[],
  solid: Uint8Array,
  reserved: Set<number>,
  solidObjects: EntityObject[],
): { x: number; y: number; kind: "crate" | "barrel" }[] {
  const blocked = new Set<number>(reserved);
  for (const o of solidObjects) for (const t of objectFootprint(o)) blocked.add(t.y * W + t.x);
  const goods: { x: number; y: number; kind: "crate" | "barrel" }[] = [];
  for (let y = QY0; y <= QY1; y++) {
    for (let x = QX0; x <= QX1; x++) {
      const i = y * W + x;
      const v = ground[i];
      if (v !== 0 && v !== 1 && v !== 2) continue;   // nur Gras-Quay
      if (solid[i] || blocked.has(i)) continue;
      const h = (((x * 2654435761) ^ (y * 40503)) >>> 0) % 11;
      if (h === 0) { goods.push({ x, y, kind: "crate" }); solid[i] = 1; }
      else if (h === 1) { goods.push({ x, y, kind: "barrel" }); solid[i] = 1; }
    }
  }
  return goods;
}

/** Baut das komplette Kai-Raster: Boden (Meer/Stein-Kai/Gras), Steg, Pfad, Kollision
 *  und die gestreuten Lager-Güter. Pur und deterministisch – in test/warehouse.test.ts
 *  direkt geprüft (u.a. dass NPC-Standplatz & Quest-Trigger vom Anleger aus erreichbar sind). */
export function buildWarehouse(): WarehouseMap {
  const W = WW, H = WH;
  const ground = new Array<number>(W * H).fill(WATER);
  const solid = new Uint8Array(W * H);

  fillTerrain(W, H, ground, solid, landLevel, (x, y) => STONE_CODES[(x * 3 + y) % 3]);
  carveJettyAndPath(W, H, ground, solid);

  const reserved = reservedWalkable(W);
  for (const idx of reserved) solid[idx] = 0;

  // Solide Objekte (Kräne + Container) aus der Registry (#357) als Kachel-Solid markieren –
  // deckungsgleich zu den Sprite-Standplätzen. Ein zusätzlicher Kran/Container ist nur ein
  // JSON-Eintrag (entities.json), kein Geometrie-Edit.
  const solidObjects = markRegistrySolids("warehouse", W, solid);

  const goods = scatterGoods(W, ground, solid, reserved, solidObjects);
  return { W, H, ground, solid, goods };
}
