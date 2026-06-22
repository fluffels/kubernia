/* ===== Wachturm-Quartier: Festungs-Bailey + Steg/Warp (Phaser-frei, pur testbar) =====
 * Eigener begehbarer Hafen-Bereich (#130, Teil von Phase 6 #23: RBAC, ServiceAccounts,
 * Pod-Security). Wie world.ts/archipel.ts/lighthouse.ts/warehouse.ts liegt hier nur die
 * reine Mathe – diesmal ein BEFESTIGTES TOR-QUARTIER: ein rechteckiger Gras-Innenhof
 * (Bailey), von einer begehbaren Stein-Wehrmauer (kai-Tiles) umschlossen, über einen
 * Holz-Steg im Süden (Planken über dem Wasser) und ein Tor (Pfad-Durchlass in der Süd-
 * mauer) von der Hauptkarte erreichbar. Im Hof steht der namensgebende Wachturm – das
 * passt thematisch zur Zugriffskontrolle (RBAC/Security): ein Tor + Turm, der bewacht,
 * wer herein darf.
 *
 * Die Optik baut die datengetriebene RegionScene (#427) aus denselben Wang-Tiles wie die
 * Hauptkarte (Stein-Mauer + Holz-Steg); Bewegung/Kollision teilt sich der Bereich über
 * resolveMove/footprintSolid mit der Hauptkarte – nichts dupliziert.
 *
 * Scope-Grenze (#130): NUR Bereich + Anleger/Warp. Der NPC kommt mit #131, die Quests mit
 * #132–135, die Drills mit #136. Darum trägt die Karte „watchtower" (noch) KEINEN Eintrag
 * in der Entity-Registry (entities.json) – npcSpawnsForMap/objectsForMap liefern leere
 * Listen, die RegionScene verträgt das. Der Wachturm selbst ist bis zu seinem PixelLab-
 * Asset ein bewusster prozeduraler Platzhalter (decorate-Hook in scenes/regions.ts); seine
 * SSOT-Geometrie (Standplatz + Fußabdruck) liegt darum noch als Konstante HIER, nicht in
 * der Registry (die ein Sprite verlangt). Wenn das Turm-Sprite kommt, wandert er wie der
 * Leuchtturm (#357) in entities.json.
 *
 * Der Warp-Primitive (Warp + warpAt) wohnt in archipel.ts und ist generisch – von dort
 * wiederverwendet statt erneut definiert (wie in lighthouse.ts/warehouse.ts).
 */
import { warpAt, type Warp } from "./archipel";
import { objectsForMap, objectFootprint } from "./content/entities";

export { warpAt, type Warp };

/** Quartier-Raster (Kacheln). Kompakter, klar umrissener Festungshof – in einer Session
 *  füllbar, mit Platz für den späteren NPC (#131) + Quest-Trigger (#132–135). */
export const WTW = 26;
export const WTH = 18;

/** Bodenraster-Codes – identisch zur Hauptkarte (renderGround), damit die RegionScene
 *  exakt dieselbe Wang-Logik nutzen kann: -2 Wasser, -10 Holz-Steg, 25 Pfad/Tor,
 *  0/1/2 Gras (Bailey), 96/97/98 Stein (die Wehrmauer zum Meer). */
export const WATER = -2, DOCK = -10, PATH = 25;
export const STONE_CODES = [96, 97, 98] as const;

/** Gepflasterter Bailey als RECHTECK (eine Festung ist gebaut und gerade): Gras-Innenfläche
 *  [QX0..QX1]×[QY0..QY1], von einer ein Kachel breiten Stein-Wehrmauer umschlossen, außen
 *  herum Meer. */
export const QX0 = 3, QX1 = 22, QY0 = 3, QY1 = 12;

const CX = 13, CY = 7;   // Mittelachse (Tor/Steg) bzw. Höfe-Mitte

/** Standplatz + Fußabdruck des Wachturms (2×2, nord-zentral im Hof). Anker (x,y) ist die
 *  rechte untere Ecke wie bei objectFootprint (Registry-Konvention #357), damit der spätere
 *  Umzug in entities.json deckungsgleich ist. Bis dahin SSOT hier (siehe Modul-Kopf). */
export const WATCHTOWER_TOWER = { x: 15, y: 4, w: 2, h: 2 } as const;

/** Die vom Wachturm belegten Kacheln (Fußabdruck) – wie objectFootprint(EntityObject),
 *  aber für die lokale Konstante (der Turm ist noch kein Registry-Objekt). */
export function watchtowerFootprint(): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let dy = 0; dy < WATCHTOWER_TOWER.h; dy++) {
    for (let dx = 0; dx < WATCHTOWER_TOWER.w; dx++) {
      tiles.push({ x: WATCHTOWER_TOWER.x - dx, y: WATCHTOWER_TOWER.y - dy });
    }
  }
  return tiles;
}

/* ===== Hauptkarte ⇄ Wachturm-Quartier ===== */

/** Steg auf der Hauptkarte (Port Kubernia): ein Holz-Anleger, der an der Südost-Ecke des
 *  Hafenkais (östlich des Archipel-Stegs x20–21, getrennt durch eine Wasserlücke x22–23)
 *  ins offene Wasser hinausragt. terrain.ts überschreibt diese Wasserkacheln in
 *  placeHarborObjects() zu begehbaren Planken (Muster: Lager-Anleger #124, nicht in
 *  harborGeometry – darum keine harbor.tmj-Neugenerierung nötig). */
export const WORLD_JETTY_WT = { x: 24, w: 2, y0: 27, y1: 31 } as const;

/** Warp-Kachel am Steg-Ende auf der Hauptkarte → Quartier. */
export const WORLD_TO_WATCHTOWER: Warp = { id: "wachturm-anleger", tx: 24, ty: 31, title: "Wachturm-Quartier" };

/** Wohin der Spieler nach der Rückkehr auf der Hauptkarte gesetzt wird: eine Kachel
 *  landwärts (nördlich) vom Anleger auf den Planken, NICHT auf die Warp-Kachel selbst
 *  (sonst sofortiger Re-Warp). Das „Scharf"-Gate verhindert zusätzlich das Pingpong. */
export const WORLD_RETURN_WT = { tx: 24, ty: 30 } as const;

/** Rück-Anleger im Quartier → Hauptkarte (Steg-Ende im Süden, eine Reihe vor dem
 *  Kartenrand, damit offenes Wasser den Hof umschließt). */
export const WATCHTOWER_TO_WORLD: Warp = { id: "heimhafen", tx: CX, ty: WTH - 2, title: "Port Kubernia" };

/** Wohin der Spieler bei Ankunft im Quartier gesetzt wird: eine Kachel landwärts
 *  (nördlich) vom Rück-Anleger, damit der Rück-Warp nicht sofort auslöst. */
export const WATCHTOWER_ARRIVAL = { tx: CX, ty: WTH - 3 } as const;

/* ===== Hof-Aufbau (pur) ===== */

/** Höhenstufe einer Zelle: 2 = Gras-Bailey, 1 = Stein-Wehrmauer (begehbar), 0 = Meer.
 *  Rechteckig, weil eine Festung gebaut und gerade ist. */
function landLevel(x: number, y: number): 0 | 1 | 2 {
  if (x >= QX0 && x <= QX1 && y >= QY0 && y <= QY1) return 2;                 // Gras-Bailey
  if (x >= QX0 - 1 && x <= QX1 + 1 && y >= QY0 - 1 && y <= QY1 + 1) return 1; // Wehrmauer (1 Kachel Ring)
  return 0;                                                                   // Meer
}

/** Deterministischer Gras-Frame-Index (0/1/2) wie auf der Hauptkarte. */
function grassFrame(x: number, y: number): number {
  const h = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
  return h < 80 ? 0 : h < 93 ? 1 : 2;
}

export interface WatchtowerMap {
  W: number;
  H: number;
  ground: number[];
  solid: Uint8Array;
}

/** Baut das komplette Quartier-Raster: Boden (Meer/Stein-Mauer/Gras), Tor-Pfad, Steg,
 *  Kollision (inkl. solidem Wachturm-Fußabdruck). Pur und deterministisch – in
 *  test/watchtower.test.ts direkt geprüft (u.a. dass der Hof vom Anleger aus erreichbar
 *  ist und der Turm solide bleibt). */
export function buildWatchtower(): WatchtowerMap {
  const W = WTW, H = WTH;
  const ground = new Array<number>(W * H).fill(WATER);
  const solid = new Uint8Array(W * H);

  // Grundterrain aus der Festungsform
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lvl = landLevel(x, y);
      const i = y * W + x;
      if (lvl === 0) { ground[i] = WATER; solid[i] = 1; }            // Meer blockt
      else if (lvl === 1) ground[i] = STONE_CODES[(x * 3 + y) % 3];  // Wehrmauer begehbar
      else ground[i] = grassFrame(x, y);                             // Bailey begehbar
    }
  }

  // Holz-Steg im Süden (Spalten CX-1, CX): von unterhalb der Südmauer als begehbare
  // Planken über dem Wasser hinunter bis eine Reihe vor den Kartenrand.
  for (let y = QY1 + 2; y <= H - 2; y++) {
    for (const x of [CX - 1, CX]) { const i = y * W + x; ground[i] = DOCK; solid[i] = 0; }
  }

  // Tor + Pfad: ein Durchlass (Pfad) durch die Südmauer (Reihe QY1+1) und hoch zur
  // Hof-Mitte (Spalte CX). Das „Tor" passt thematisch zum Zugriffskontroll-Quartier.
  for (let y = CY; y <= QY1 + 1; y++) { const i = y * W + CX; ground[i] = PATH; solid[i] = 0; }

  // Wachturm-Fußabdruck (2×2) solide markieren – steht im Hof, blockt das Durchlaufen.
  for (const t of watchtowerFootprint()) solid[t.y * W + t.x] = 1;

  // Solide Registry-Objekte (props/tower) als Kachel-Solid markieren. Die Karte hat in
  // #130 noch keine (NPC/Quest-Trigger folgen mit #131/#132ff.); der Loop ist Vorsorge,
  // damit ein künftiges Hof-Objekt nur ein JSON-Eintrag ist, kein Geometrie-Edit.
  for (const o of objectsForMap("watchtower")) {
    if (o.type === "quest_trigger") continue;
    for (const t of objectFootprint(o)) solid[t.y * W + t.x] = 1;
  }

  // Reserviert begehbar halten: Ankunft, Rück-Warp + die Hof-Mitte (damit der Aufgang vom
  // Anleger bis in den Hof garantiert frei ist).
  const reserved = new Set<number>([
    WATCHTOWER_ARRIVAL.ty * W + WATCHTOWER_ARRIVAL.tx,
    WATCHTOWER_TO_WORLD.ty * W + WATCHTOWER_TO_WORLD.tx,
    CY * W + CX,
  ]);
  for (const idx of reserved) solid[idx] = 0;

  return { W, H, ground, solid };
}
