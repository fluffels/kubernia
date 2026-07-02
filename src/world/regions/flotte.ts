/* ===== Expeditions-Flotte: Flaggschiff-Deck + Anleger/Warp (Phaser-frei, pur testbar) =====
 * Eigener begehbarer Hafen-Bereich (#148, Teil von Phase 9 #25: Terraform-Module,
 * Remote State, Cloud-Provider). Wie world.ts/archipel.ts/lighthouse.ts/warehouse.ts/
 * watchtower.ts liegt hier nur die reine Mathe – diesmal ein FLAGGSCHIFF-DECK: ein
 * rechteckiges, vertäutes Holz-Deck (DOCK-Planken) mitten im offenen Meer, um das herum
 * die Expeditions-Flotte ankert. Über einen kurzen Holz-Steg im Süden ist es vom Hafen
 * (Port Kubernia, Südost-Ecke nahe der Vermessung/Terraform-Plattform) erreichbar.
 *
 * Thematisch passt das Deck-im-Meer zur Terraform-Phase: man legt von der Vermessungs-
 * Ecke ab und fährt zur Flotte hinaus, die später die Module/Remote-State/Provider-Quests
 * (#150–153) trägt. Die vertäuten Schiffe rundherum sind die Flotte; betreten kann man
 * (bis #149/#150ff. andocken) nur das zentrale Deck.
 *
 * Die Optik baut die datengetriebene RegionScene (#427) aus denselben Wang-Tiles wie die
 * Hauptkarte (Holz-Steg-Planken über Wasser); Bewegung/Kollision teilt sich der Bereich
 * über resolveMove/footprintSolid mit der Hauptkarte – nichts dupliziert. Die vertäuten
 * Flotten-Schiffe rendert der `decorate`-Hook in scenes/regions.ts (echtes ship-Sprite,
 * ein COMMON_ASSET) auf den hier berechneten, bewusst NICHT begehbaren Wasser-Standplätzen.
 *
 * Scope (Stand #148): Bereich + Anleger/Warp. Der NPC folgt mit #149, die Quests mit
 * #150–153, Drills #154, Quiz #155, Progression #156, Tests #157. Die Karte „flotte" hat
 * darum noch keinen Eintrag in der Entity-Registry (entities.json); npcSpawnsForMap/
 * objectsForMap liefern für sie leer, was die RegionScene verträgt.
 *
 * Der Warp-Primitive (Warp + warpAt) wohnt in archipel.ts und ist generisch – von dort
 * wiederverwendet statt erneut definiert (wie in lighthouse.ts/warehouse.ts/watchtower.ts).
 */
import { warpAt, type Warp } from "./archipel";
import { objectsForMap, objectFootprint } from "../../content/entities";

export { warpAt, type Warp };

/** Deck-Raster (Kacheln). Kompaktes, klar umrissenes Flaggschiff-Deck – in einer Session
 *  füllbar, mit Platz für den späteren NPC (#149) + Quest-Trigger (#150–153). */
export const FW = 24;
export const FH = 16;

/** Bodenraster-Codes – identisch zur Hauptkarte (renderGround), damit die RegionScene
 *  exakt dieselbe Wang-Logik nutzen kann: -2 Wasser, -10 Holz-Deck/-Steg. Das Deck ist
 *  durchgehend Holz (kein Gras/Stein) – ein Schiffsdeck, kein Land. */
export const WATER = -2, DOCK = -10;

/** Rechteckiges Holz-Deck (ein gebautes Deck ist gerade): Planken-Innenfläche
 *  [DX0..DX1]×[DY0..DY1], ringsum offenes Meer. */
export const DX0 = 4, DX1 = 19, DY0 = 3, DY1 = 10;

const CX = 11, CY = 6;   // Mittelachse (Steg) bzw. Deck-Mitte

/* ===== Hauptkarte ⇄ Expeditions-Flotte ===== */

/** Steg auf der Hauptkarte (Port Kubernia): ein Holz-Anleger, der in der SÜDOST-Ecke des
 *  Hafens – im offenen Wasser zwischen dem eigenen Schiff (x30–38) und der Vermessungs-/
 *  Terraform-Plattform (x44–50) – ins Meer hinausragt. terrain.ts überschreibt diese
 *  Wasserkacheln in placeHarborObjects() zu begehbaren Planken (Muster: Lager-/Wachturm-
 *  Anleger, nicht in harborGeometry – darum keine harbor.tmj-Neugenerierung nötig). */
export const WORLD_JETTY_FL = { x: 40, w: 2, y0: 27, y1: 31 } as const;

/** Warp-Kachel am Steg-Ende auf der Hauptkarte → Flotte. */
export const WORLD_TO_FLOTTE: Warp = { id: "flotte-anleger", tx: 40, ty: 31, title: "Expeditions-Flotte" };

/** Wohin der Spieler nach der Rückkehr auf der Hauptkarte gesetzt wird: eine Kachel
 *  landwärts (nördlich) vom Anleger auf den Planken, NICHT auf die Warp-Kachel selbst
 *  (sonst sofortiger Re-Warp). Das „Scharf"-Gate verhindert zusätzlich das Pingpong. */
export const WORLD_RETURN_FL = { tx: 40, ty: 30 } as const;

/** Rück-Anleger auf der Flotte → Hauptkarte (Steg-Ende im Süden, eine Reihe vor dem
 *  Kartenrand, damit offenes Wasser das Deck umschließt). */
export const FLOTTE_TO_WORLD: Warp = { id: "heimhafen", tx: CX, ty: FH - 2, title: "Port Kubernia" };

/** Wohin der Spieler bei Ankunft auf der Flotte gesetzt wird: eine Kachel landwärts
 *  (nördlich) vom Rück-Anleger, damit der Rück-Warp nicht sofort auslöst. */
export const FLOTTE_ARRIVAL = { tx: CX, ty: FH - 3 } as const;

/* ===== Deck-Aufbau (pur) ===== */

export interface FlotteMap {
  W: number;
  H: number;
  ground: number[];
  solid: Uint8Array;
  /** Standplätze der vertäuten Flotten-Schiffe (auf Wasser, NICHT begehbar) – der
   *  decorate-Hook rendert dort je ein ship-Sprite. `flip` spiegelt das Sprite, damit
   *  die Flotte nicht in eine Richtung „starrt". */
  ships: { x: number; y: number; flip: boolean }[];
}

/** Baut das komplette Deck-Raster: Boden (Meer/Holz-Deck), Steg, Kollision und die
 *  Standplätze der vertäuten Schiffe. Pur und deterministisch – in test/flotte.test.ts
 *  direkt geprüft (u.a. dass das Deck vom Anleger aus erreichbar ist und ringsum Meer liegt). */
export function buildFlotte(): FlotteMap {
  const W = FW, H = FH;
  const ground = new Array<number>(W * H).fill(WATER);
  const solid = new Uint8Array(W * H);

  // Grundterrain: alles Meer (blockt), darüber das Deck.
  for (let i = 0; i < W * H; i++) solid[i] = 1;

  // Rechteckiges Holz-Deck (begehbare Planken).
  for (let y = DY0; y <= DY1; y++) {
    for (let x = DX0; x <= DX1; x++) { const i = y * W + x; ground[i] = DOCK; solid[i] = 0; }
  }

  // Holz-Steg im Süden (Spalten CX-1, CX): von der Deck-Unterkante als begehbare Planken
  // über dem Wasser hinunter bis eine Reihe vor den Kartenrand.
  for (let y = DY1 + 1; y <= H - 2; y++) {
    for (const x of [CX - 1, CX]) { const i = y * W + x; ground[i] = DOCK; solid[i] = 0; }
  }

  // Solide Registry-Objekte (props/tower) als Kachel-Solid markieren. Die Karte hat in
  // #148 noch keine (NPC/Quest-Trigger folgen mit #149/#150ff.); der Loop ist Vorsorge,
  // damit ein künftiges Deck-Objekt nur ein JSON-Eintrag ist, kein Geometrie-Edit.
  for (const o of objectsForMap("flotte")) {
    if (o.type === "quest_trigger") continue;
    for (const t of objectFootprint(o)) solid[t.y * W + t.x] = 1;
  }

  // Reserviert begehbar halten: Ankunft, Rück-Warp + die Deck-Mitte (damit der Aufgang vom
  // Anleger bis aufs Deck garantiert frei ist).
  const reserved = new Set<number>([
    FLOTTE_ARRIVAL.ty * W + FLOTTE_ARRIVAL.tx,
    FLOTTE_TO_WORLD.ty * W + FLOTTE_TO_WORLD.tx,
    CY * W + CX,
  ]);
  for (const idx of reserved) solid[idx] = 0;

  // Vertäute Flotten-Schiffe rings um das Deck (im Meer): zwei im Norden, je eines an
  // West- und Ostflanke. Bewusst auf Wasser (solid bleibt 1) – reine Deko, man läuft
  // nicht auf sie. Spiegelung wechselnd, damit die Flotte lebendig wirkt.
  const ships = [
    { x: DX0 + 2, y: DY0 - 2, flip: false },
    { x: DX1 - 2, y: DY0 - 2, flip: true },
    { x: DX0 - 3, y: CY, flip: false },
    { x: DX1 + 3, y: CY, flip: true },
  ];

  return { W, H, ground, solid, ships };
}
