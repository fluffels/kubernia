/* ===== Kubernia – WorldScene-Terrain (worldscene/terrain.ts) =====
 * Schritt des WorldScene.ts-Splits (#393). Hier wird die HAFEN-spezifische Welt
 * aufgebaut: die sichtbaren Hafen-Objekte/Gebäude/Warpschilder setzen
 * (placeHarborObjects), die Gebäudetüren begehbar schneiden (carveDoors/makeDoor)
 * und der Wang-Autotile-Boden zeichnen (renderGround). Der gemeinsame, karten-
 * unabhängige Terrain-Schritt (Boden/Kollision/Türen/NPCs aus der Registry) liegt
 * seit #425 datengetrieben in worldscene/mapterrain.ts (loadMapTerrain) – die
 * datengetriebene Region-Szenerie folgt mit #427 (RegionScene).
 *
 * Freie Funktionen mit der Szene als Parameter; die Zellen-/Deko-Primitive
 * (scene.tree/objDeco/deco/building/get) bleiben auf der Szene.
 */
import { SHIP, type Door } from "../../world/world";
import { WORLD_TO_ARCHIPEL } from "../../world/regions/archipel";
import { WORLD_TO_LIGHTHOUSE, WORLD_RETURN_LH } from "../../world/regions/lighthouse";
import { WORLD_JETTY_WH, WORLD_TO_WAREHOUSE } from "../../world/regions/warehouse";
import { WORLD_JETTY_WT, WORLD_TO_WATCHTOWER } from "../../world/regions/watchtower";
import { WORLD_JETTY_FL, WORLD_TO_FLOTTE } from "../../world/regions/flotte";
import { WORLD_JETTY_WF, WORLD_TO_WERFT } from "../../world/regions/werft";
import { DOCK } from "../../world/regions/terraincodes";
import { PIER_XS } from "../../world/maps/harbormap";
import { T, DIRT } from "../shared";
import { renderGround as renderGroundShared } from "./renderground";
import type { WorldSceneLike } from "./types";

/** Sichtbare Hafen-Objekte (Bäume, Stege-Schilder, Schiff, Markt, Gebäude,
 *  Deko, Leuchtturm, Türen) + die davon abhängigen Szenen-Felder (piers, ship,
 *  flagPoles, lighthouse, tfPlatform, labels). Solids von Gebäuden/Bäumen/Deko
 *  und das Freiräumen der Türen passieren hier – idempotent über dem geladenen
 *  Kollisionsraster, also identisch in beidem Pfaden. Die harbor.tmj trägt
 *  Terrain-Kollision (Boden/Wege/Wasser), seit #194 die Türen/Warps und seit
 *  #195 die NPC-Standplätze als Objektlayer (scene.doors / scene.npcSpawns); nur
 *  die Gebäude-Spawns sind noch Code. */
export function placeHarborObjects(scene: WorldSceneLike) {
  const W = scene.W;
  // Waldsaum: oben durchgehend, an den Seitenrändern bis zur Küste
  for (let x = 0; x < W; x++) scene.tree(x, 0);
  for (let y = 0; y < 24; y++) { scene.tree(0, y); scene.tree(W - 1, y); }

  // Stege = Cluster-Knoten (Steg-Geometrie liegt in harborGeometry; hier nur
  // die Knoten-Daten + Schilder, an denselben Spalten PIER_XS).
  scene.piers = PIER_XS.map((x, i) => ({ x, name: ["ahoi-control", "ahoi-worker-1", "ahoi-worker-2"][i] }));
  for (const p of scene.piers) scene.labels.push({ x: p.x + 1.5, y: 27.4, text: p.name, color: "#ffd97a" });
  scene.labels.push({ x: 6.5, y: 23.4, text: "Bos Dock", color: "#ffffff" });
  // #303: Lagerschuppen für gestoppte Container (docker ps -a) östlich des Docks.
  scene.labels.push({ x: 17.5, y: 21.4, text: "Lager", color: "#ffffff" });

  // Dein Schiff (Grundfläche aus world.ts SHIP – Single Source of Truth, #42).
  // Die Schiffs-Terrain-Geometrie (#108: Schiff SCHWIMMT – Wasser unterm Rumpf +
  // schmaler Holz-Steg SHIP_PIER, kein rechteckiges Deck) liegt in harborGeometry;
  // hier nur das Daten-Feld + Schild.
  scene.ship = { x: SHIP.x, y: SHIP.y, w: SHIP.w, h: SHIP.h };
  scene.labels.push({ x: scene.ship.x + 4.5, y: scene.ship.y - 0.6, text: "Dein Schiff", color: "#ffffff" });

  // Anleger zum GitOps-Archipel (#92): Schild am Steg ins offene Wasser.
  // Schild direkt über den Anker-Übergang am Steg-Ende, nicht oben am Steg-Anfang (#254).
  scene.labels.push({ x: WORLD_TO_ARCHIPEL.tx, y: WORLD_TO_ARCHIPEL.ty - 0.7, text: "Zum Archipel", color: "#ffe9b0" });

  // #124: Holz-Anleger am Westende des Hafenkais → Lagerhallen-Viertel. Wie beim
  // Leuchtturm-Aufgang hier (nicht in harborGeometry) gesetzt: die Wasserkacheln des
  // Stegs zu begehbaren Planken (PIER -10) machen, damit renderGround sie als „dock"
  // malt und man hinauslaufen kann. So bleibt harbor.tmj unberührt.
  for (let y = WORLD_JETTY_WH.y0; y <= WORLD_JETTY_WH.y1; y++) {
    for (let x = WORLD_JETTY_WH.x; x < WORLD_JETTY_WH.x + WORLD_JETTY_WH.w; x++) {
      scene.ground[y * W + x] = DOCK;
      scene.solidGrid[y * W + x] = 0;
    }
  }
  scene.labels.push({ x: WORLD_TO_WAREHOUSE.tx + 0.9, y: WORLD_TO_WAREHOUSE.ty - 0.7, text: "Zum Lager", color: "#ffe9b0" });

  // #130: Holz-Anleger an der Südost-Ecke des Hafenkais → Wachturm-Quartier. Gleiches
  // Muster wie der Lager-Anleger: die Wasserkacheln des Stegs zu begehbaren Planken (PIER
  // -10) machen, damit renderGround sie als „dock" malt und man hinauslaufen kann. So
  // bleibt harbor.tmj unberührt.
  for (let y = WORLD_JETTY_WT.y0; y <= WORLD_JETTY_WT.y1; y++) {
    for (let x = WORLD_JETTY_WT.x; x < WORLD_JETTY_WT.x + WORLD_JETTY_WT.w; x++) {
      scene.ground[y * W + x] = DOCK;
      scene.solidGrid[y * W + x] = 0;
    }
  }
  scene.labels.push({ x: WORLD_TO_WATCHTOWER.tx + 0.9, y: WORLD_TO_WATCHTOWER.ty - 0.7, text: "Zum Wachturm", color: "#ffe9b0" });

  // #148: Holz-Anleger in der Südost-Ecke (offenes Wasser zwischen Schiff und Vermessung/
  // Terraform-Plattform) → Expeditions-Flotte. Gleiches Muster wie Lager-/Wachturm-Anleger:
  // die Wasserkacheln des Stegs zu begehbaren Planken (PIER -10) machen, damit renderGround
  // sie als „dock" malt und man hinauslaufen kann. So bleibt harbor.tmj unberührt.
  for (let y = WORLD_JETTY_FL.y0; y <= WORLD_JETTY_FL.y1; y++) {
    for (let x = WORLD_JETTY_FL.x; x < WORLD_JETTY_FL.x + WORLD_JETTY_FL.w; x++) {
      scene.ground[y * W + x] = DOCK;
      scene.solidGrid[y * W + x] = 0;
    }
  }
  scene.labels.push({ x: WORLD_TO_FLOTTE.tx + 0.9, y: WORLD_TO_FLOTTE.ty - 0.7, text: "Zur Flotte", color: "#ffe9b0" });

  // #165: Holz-Anleger an der freien Kai-Lücke (x22–23, zwischen Archipel- und Wachturm-Anleger)
  // → Heimat-Werft (Phase-10-Capstone). Gleiches Muster wie Lager-/Wachturm-/Flotte-Anleger: die
  // Wasserkacheln des Stegs zu begehbaren Planken (PIER -10) machen, damit renderGround sie als
  // „dock" malt und man hinauslaufen kann. So bleibt harbor.tmj unberührt. Das Schild sitzt am
  // KAI-Kopf des Stegs (y26.3) statt am Steg-Ende, damit es nicht mit den eng benachbarten
  // Archipel-/Wachturm-Schildern (beide am Steg-Ende y30.3) kollidiert.
  for (let y = WORLD_JETTY_WF.y0; y <= WORLD_JETTY_WF.y1; y++) {
    for (let x = WORLD_JETTY_WF.x; x < WORLD_JETTY_WF.x + WORLD_JETTY_WF.w; x++) {
      scene.ground[y * W + x] = DOCK;
      scene.solidGrid[y * W + x] = 0;
    }
  }
  scene.labels.push({ x: WORLD_TO_WERFT.tx + 0.9, y: 26.3, text: "Zur Werft", color: "#ffe9b0" });

  // Marktplatz
  scene.objDeco(28, 18, "well", 0.55, true);
  scene.objDeco(31, 16, "stall", 0.6, true);
  scene.labels.push({ x: 31.5, y: 15.4, text: "Markt", color: "#ffffff" });
  scene.objDeco(24, 22, "signpost", 0.6, false);

  // Gebäude & Zonen
  scene.houseOfficeImg = scene.building(23, 10, 7, "house_office", 1.05);
  // depth = Gebäude-Fußlinie (baseY) + 1 → Schild vor dem hohen Dach statt dahinter (#290)
  scene.labels.push({ x: 26.5, y: 9.4, text: "Hafenmeisterei", color: "#ffffff", depth: (10 + 3) * T + 1 });
  scene.building(8, 8, 5, "house_forge", 0.82);
  scene.objDeco(12, 12, "interior_anvil", 0.5, true);
  scene.objDeco(14, 12, "interior_table", 0.5, true);
  scene.objDeco(14, 11.6, "interior_console", 0.5, false);
  scene.labels.push({ x: 12.5, y: 7.4, text: "Werft", color: "#ffffff", depth: (8 + 3) * T + 1 });
  scene.flagPoles = [{ x: 9, y: 10 }, { x: 10.5, y: 10 }, { x: 16, y: 10 }];

  scene.building(38, 9, 5, "house_chart", 0.9);
  scene.labels.push({ x: 40.5, y: 8.4, text: "Kartenhaus", color: "#ffffff", depth: (9 + 3) * T + 1 });

  scene.objDeco(43, 19, "interior_table", 0.5, true);
  scene.objDeco(43, 18.6, "interior_book", 0.5, false);
  scene.labels.push({ x: 43.5, y: 17.4, text: "Vermessung", color: "#ffffff" });

  scene.tfPlatform = { x: 44, y: 28, w: 7, h: 5 };

  // Leuchtturm (Sturmwache Juno)
  scene.lighthouse = { x: 48, y: 24 };
  for (const [lx, ly] of [[47, 23], [48, 23], [47, 24], [48, 24]]) scene.solidGrid[ly * W + lx] = 1;
  scene.labels.push({ x: 48, y: 21.2, text: "Leuchtturm", color: "#ffffff" });

  // #111: Stufen-Aufgang am Turmfuß → Monitoring-Leuchtturm-Klippe. Ein kurzer
  // Erd-Pfad südlich des Turms zur Warp-Kachel (WORLD_TO_LIGHTHOUSE). Als Erde
  // (DIRT) gesetzt + begehbar geräumt: bleibt so auch von der späteren Deko-
  // Streuung verschont (scatter platziert nur auf Gras/Sand, nicht auf Erde).
  for (const [px, py] of [[WORLD_TO_LIGHTHOUSE.tx, WORLD_TO_LIGHTHOUSE.ty], [WORLD_RETURN_LH.tx, WORLD_RETURN_LH.ty], [48, 27]]) {
    scene.ground[py * W + px] = DIRT;
    scene.solidGrid[py * W + px] = 0;
  }
  scene.labels.push({ x: WORLD_TO_LIGHTHOUSE.tx + 1.4, y: WORLD_TO_LIGHTHOUSE.ty, text: "↑ Klippe", color: "#ffe9b0" });

  const spots = [[5, 5], [7, 3], [15, 4], [20, 6], [33, 5], [36, 4], [44, 5], [47, 8], [47, 13], [36, 15], [20, 12], [5, 17], [3, 21], [8, 20], [18, 16], [34, 9], [30, 7], [45, 15], [37, 22], [6, 22], [21, 21]];
  spots.forEach(([x, y]) => scene.tree(x, y));
  scene.objDeco(16, 21, "mushroom", 0.28, false);

  carveDoors(scene);   // #6: Häuser betretbar machen
}

/** #6/#194: In jede Gebäude-Front eine begehbare Tür schneiden (Solid-Kachel
 *  der unteren Mittel-Kachel wieder freigeben) und sichtbar markieren. Quelle
 *  ist scene.doors (Code-Default oder Tiled-Objektlayer). Die Schiffs-Luke
 *  (theme "ship") wird hier NICHT gemalt – sie ist eine Decksluke, die
 *  placeHarborObjects() separat als Companionway zeichnet. Das Betreten erkennt
 *  update() über findDoorAt() gegen dieselbe scene.doors-Liste. */
export function carveDoors(scene: WorldSceneLike) {
  for (const d of scene.doors as Door[]) {
    if (d.theme === "ship") continue;
    scene.solidGrid[d.ty * scene.W + d.tx] = 0;
    makeDoor(scene, d.tx, d.ty, d.theme);
  }
}

/** Gebäudespezifisches Tür-Asset (#186): welche PixelLab-Tür zu welchem Gebäude-Thema
 *  gehört. Ersetzt die früher prozedural gemalte Rechteck-Tür. */
const DOOR_TEX: Record<string, string> = {
  office: "door_office",
  forge: "door_forge",
  chart: "door_chart",
};
/** Ziel-Höhe der Tür in Welt-Pixeln (~1,4 Kacheln) – die Assets haben leicht
 *  unterschiedliche Quellhöhen, darum wird pro Tür auf diese Höhe skaliert. */
const DOOR_WORLD_HEIGHT = 22;

/** Eine sichtbare Tür auf der vorderen Gebäudekante (Fußlinie der Kachel), Tiefe knapp
 *  vor der Hauswand, damit sie auf der Front sitzt. Seit #186 ein PixelLab-Asset je
 *  Gebäude-Thema; fehlt das Asset/Thema, fällt sie auf eine schlichte prozedurale Tür
 *  zurück (defensiv – die Hafentüren office/forge/chart haben alle ein Asset). */
export function makeDoor(scene: WorldSceneLike, tx: number, ty: number, theme?: string) {
  const cx = tx * T + 8, baseY = (ty + 1) * T;
  const tex = theme ? DOOR_TEX[theme] : undefined;
  if (tex && scene.textures.exists(tex)) {
    const img = scene.add.image(cx, baseY, tex).setOrigin(0.5, 1);
    const src = scene.textures.get(tex).getSourceImage() as { height: number };
    img.setScale(DOOR_WORLD_HEIGHT / src.height);   // Fußlinie bündig, Höhe vereinheitlicht
    img.setDepth(baseY + 0.5);
    scene.doorSprites.set(`${tx},${ty}`, img);
    return;
  }
  // Fallback: schlichte prozedurale Tür (unbekanntes Thema / Asset fehlt)
  const frame = scene.add.rectangle(0, 0, 12, 15, 0x33210f).setOrigin(0.5, 1);   // dunkler Rahmen
  const leaf = scene.add.rectangle(0, -1, 9, 12, 0x6b4a2a).setOrigin(0.5, 1);     // Türblatt
  const seam = scene.add.rectangle(0, -1, 1, 12, 0x4a3219).setOrigin(0.5, 1);     // Mittelfuge
  const knob = scene.add.circle(2.5, -6, 1, 0xffd97a);                            // Türknauf
  scene.add.container(cx, baseY, [frame, leaf, seam, knob]).setDepth(baseY + 0.5);
}

/** Wang-Autotile-Boden des Hafens: Wasser-Hintergrund + Schaum-Sparkles auf dem
 *  sichtbaren Meeresstreifen (y>=28) + Küstenwellen sind reine Hafen-Atmosphäre,
 *  die Kachel-Wahl selbst ist mit den Regionen geteilt (worldscene/groundtiles.ts,
 *  worldscene/renderground.ts, #958). */
export function renderGround(scene: WorldSceneLike) {
  renderGroundShared(scene, {
    waterFill: true,
    sparkleCount: 60,
    sparkleBounds: { xFrom: 1, xTo: scene.W - 2, yFrom: 28, yTo: scene.H - 1 },
    rollingWaveCount: 14,
  });
}
