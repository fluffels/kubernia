/* ===== Region-Warps: Übergänge Hauptkarte ⇄ Region-Szenen als Daten (#426) =====
 * Bisher war jeder Region-Übergang HARTCODIERT: je ein enterArchipel()/enterLighthouse()/
 * enterWarehouse() in worldscene/warps.ts, je ein benanntes `*Armed`-Flag auf der WorldScene
 * und ein fest verdrahteter updateWarps-Block mit drei if-Zweigen – dazu byte-gleicher
 * Rück-Warp-Code in jeder der drei Insel-Szenen. Eine neue Region-Verknüpfung hieß: mehrere
 * Edits an verstreuten Stellen, mit stillen Fehlern (vergessenes Armed-Flag).
 *
 * Hier liegt stattdessen die EINE Daten-Liste: Hin- UND Rückweg jeder Region als ein
 * Datensatz. Eine neue Region ist damit nur ein Eintrag in REGION_WARPS, kein neuer
 * enterXxx() und kein neues benanntes Flag mehr (#415-Kriterium „Warps datengesteuert").
 *
 * Phaser-frei und pur testbar (wie world.ts/archipel.ts): die je Region aus ihrer Geometrie
 * ABGELEITETEN Warp-Konstanten (WORLD_TO_…, WORLD_RETURN…, …_TO_WORLD, …_ARRIVAL) bleiben SSOT
 * in archipel.ts/lighthouse.ts/warehouse.ts – sie hängen an der jeweiligen Insel-Mathe
 * (z.B. WORLD_RETURN an WORLD_JETTY, LIGHTHOUSE_TO_WORLD an southEdgeRow()). Hier werden sie
 * nur zur Liste GEBÜNDELT, nicht dupliziert. Darum ein TS-Datenmodul und keine JSON-Datei:
 * eine statische JSON würde diese berechneten Konstanten von ihrer Geometrie entkoppeln.
 */
import { warpAt, type Warp } from "./archipel";
import { WORLD_TO_ARCHIPEL, WORLD_RETURN, ARCHIPEL_TO_WORLD, ARCHIPEL_ARRIVAL } from "./archipel";
import { WORLD_TO_LIGHTHOUSE, WORLD_RETURN_LH, LIGHTHOUSE_TO_WORLD, LIGHTHOUSE_ARRIVAL } from "./lighthouse";
import { WORLD_TO_WAREHOUSE, WORLD_RETURN_WH, WAREHOUSE_TO_WORLD, WAREHOUSE_ARRIVAL } from "./warehouse";
import { WORLD_TO_WATCHTOWER, WORLD_RETURN_WT, WATCHTOWER_TO_WORLD, WATCHTOWER_ARRIVAL } from "./watchtower";
import type { MapId } from "./mapregistry";

export { warpAt, type Warp };

/** Eine Kachel-Position in Kachel-Koordinaten (kein Pixel). */
export interface WarpTile { tx: number; ty: number; }

/** Eine Region-Verknüpfung als EIN Datensatz – Hin- und Rückweg zwischen der Hauptkarte
 *  und einer Region-Szene. Ersetzt die früheren enterXxx()/`*Armed`-Trios. */
export interface RegionWarp {
  /** Eindeutige Warp-ID – zugleich der Schlüssel des Anti-Pingpong-Gates (statt je ein
   *  benanntes Boolean). */
  readonly id: string;
  /** Quellkarte auf der Hauptseite (Map-Registry-ID); derzeit immer „harbor". */
  readonly fromMap: MapId;
  /** Phaser-Szenen-Key der Zielregion. */
  readonly targetScene: string;
  /** Kachel auf der Hauptkarte, die in die Region warpt. */
  readonly trigger: Warp;
  /** Standplatz auf der Hauptkarte bei Rückkehr (= Stelle, an die enterRegion den Spieler
   *  vorm Schlafenlegen setzt, damit man symmetrisch ankommt + ein Speichern draußen landet). */
  readonly worldReturn: WarpTile;
  /** Kachel in der Region, die zurück auf die Hauptkarte warpt. */
  readonly regionReturn: Warp;
  /** Ankunfts-Standplatz in der Region (eine Kachel landwärts vom Rück-Warp). */
  readonly arrival: WarpTile;
}

/** Die EINE Liste aller Region-Übergänge. Reihenfolge nur fürs deterministische Durchlaufen
 *  in updateWarps (die Trigger-Kacheln sind disjunkt, also nicht load-bearing). */
export const REGION_WARPS: readonly RegionWarp[] = [
  { id: "archipel",   fromMap: "harbor", targetScene: "Archipel",   trigger: WORLD_TO_ARCHIPEL,   worldReturn: WORLD_RETURN,    regionReturn: ARCHIPEL_TO_WORLD,   arrival: ARCHIPEL_ARRIVAL },
  { id: "lighthouse", fromMap: "harbor", targetScene: "Lighthouse", trigger: WORLD_TO_LIGHTHOUSE, worldReturn: WORLD_RETURN_LH, regionReturn: LIGHTHOUSE_TO_WORLD, arrival: LIGHTHOUSE_ARRIVAL },
  { id: "warehouse",  fromMap: "harbor", targetScene: "Warehouse",  trigger: WORLD_TO_WAREHOUSE,  worldReturn: WORLD_RETURN_WH, regionReturn: WAREHOUSE_TO_WORLD,  arrival: WAREHOUSE_ARRIVAL },
  { id: "watchtower", fromMap: "harbor", targetScene: "Watchtower", trigger: WORLD_TO_WATCHTOWER, worldReturn: WORLD_RETURN_WT, regionReturn: WATCHTOWER_TO_WORLD, arrival: WATCHTOWER_ARRIVAL },
];

/** Alle Region-Warps, die von der gegebenen Hauptkarte ausgehen (Stardew-Scope: künftig
 *  mehrere Überwelt-Karten mit je eigenen Übergängen). */
export function regionWarpsFromMap(mapId: MapId): readonly RegionWarp[] {
  return REGION_WARPS.filter((w) => w.fromMap === mapId);
}

/* ===== Reiner Kern des Anti-Pingpong-Gates (Phaser-frei, node-testbar) =====
 * Die Entscheidung „welcher Warp ist scharf / wird ausgelöst" ist Spiellogik und liegt
 * darum hier in der puren Domäne; die WorldScene-Seite (worldscene/warps.ts) macht nur
 * das Phaser-Drumherum (Szene starten/schlafen, SFX). So ist genau der Teil getestet,
 * der früher als drei kopierte if-Zweige stumm in der Präsentation steckte. */

/** Armiert jeden Warp, dessen Trigger-Kachel der Spieler gerade NICHT betritt, sobald
 *  keine Lauftaste mehr gehalten wird (mutiert das übergebene Set). Genau so verhindert
 *  das Gate das Pingpong: nach der Rückkehr steht man eine Kachel vor dem Trigger und mit
 *  evtl. noch gehaltener Taste – erst Loslassen schaltet den Warp wieder scharf. */
export function armWarps(
  armed: Set<string>, warps: readonly RegionWarp[], px: number, py: number, moveKeyDown: boolean,
): void {
  if (moveKeyDown) return;
  for (const w of warps) if (!warpAt(px, py, w.trigger)) armed.add(w.id);
}

/** Der ausgelöste Region-Warp: der erste scharfe Warp, auf dessen Trigger-Kachel der
 *  Spieler steht – oder undefined, wenn keiner greift. */
export function triggeredWarp(
  armed: ReadonlySet<string>, warps: readonly RegionWarp[], px: number, py: number,
): RegionWarp | undefined {
  return warps.find((w) => armed.has(w.id) && warpAt(px, py, w.trigger));
}
