/* ===== Kubernia – WorldScene-Konfigurationen (worldscene/worldconfig.ts) =====
 * Datengetriebene Entkopplung der WorldScene vom Hafen (#863): hafen-spezifische
 * Logik (Objekt-Aufbau, Deko-Streuung, bedingte Plattformen, Auszahlungs-Anker,
 * Sonder-NPCs) liegt als `WorldSceneConfig` HIER – analog zum `REGION_CONFIGS`-
 * Muster (scenes/regions.ts, #427). WorldScene.create() ruft nur noch den
 * generischen Schritt (`setup`) und die map-unabhängigen Funktionen auf; eine zweite
 * Tiled-Überwelt kommt durch einen neuen Eintrag in `WORLD_CONFIGS` dazu, ohne
 * WorldScene.ts anzufassen.
 *
 * Die `setup`-Funktion darf Phaser-Code enthalten – sie liegt bewusst in der
 * Präsentations-Schicht. Reine Domänen-Daten (z.B. Spawn-Position) bleiben in
 * `mapregistry.ts` / `world/`.
 */
import { SHIP_KRALLE } from "../../world/world";
import { Game } from "../../game";
import { T } from "../shared";
import { HIT_R, LAMP_HIT } from "../geometry";
import { placeHarborObjects, renderGround } from "./terrain";
import { renderStatics, scatter, spawnGull } from "./scenery";
import type { WorldSceneLike } from "./types";

/** Pro Überwelt-Karte eine Config, die den hafen-spezifischen Anteil von
 *  WorldScene.create() / isSolidAt / payoutFloat kapselt. */
export interface WorldSceneConfig {
  /** Wird in WorldScene.create() nach loadMapTerrain aufgerufen: platziert
   *  Karten-Objekte, rendert den Boden und streut karten-spezifische Deko. */
  setup(scene: WorldSceneLike): void;
  /** Zusätzliche NPCs, die nicht im Tiled-Objektlayer stehen (z.B. schiff-
   *  relative Positionen). Werden an die Spawns aus dem Objektlayer angehängt. */
  extraNpcs?: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }>;
  /** Bedingte Feststoff-Plattformen: solide, bis `passable()` true zurückgibt
   *  (z.B. Terraform-Erweiterungsplattform, erst nach `terraform apply` begehbar). */
  conditionalPlatforms?: ReadonlyArray<{
    readonly x: number; readonly y: number;
    readonly w: number; readonly h: number;
    passable(): boolean;
  }>;
  /** Pixel-Koordinaten für den Auszahlungs-Floater (Hafen-Wirtschaft). Fehlt
   *  die Methode, wird kein Floater angezeigt. */
  payoutPos?(): { x: number; y: number };
  /** Karten-spezifische Hintergrund-Animationen (z.B. Möwen), die nach dem
   *  Aufbau in WorldScene.create() als Phaser-Timer registriert werden. */
  scheduleAmbient?(scene: WorldSceneLike): void;
}

/** Hafen-Konfiguration: der gesamte bisherige hafen-hartcodierte Anteil von
 *  WorldScene.create() / isSolidAt / payoutFloat – jetzt als Datensatz. */
const harborConfig: WorldSceneConfig = {
  setup(scene) {
    placeHarborObjects(scene);
    renderGround(scene);
    renderStatics(scene);
    scatter(scene, "bush", 16, 0.5, [0, 1, 2], false, HIT_R);
    scatter(scene, "rock", 14, 0.45, [0, 1, 2, -3], false, HIT_R);
    scatter(scene, "lamppost", 4, 0.55, [0, 1, 2], false, 0, LAMP_HIT);
    scatter(scene, "mushroom", 10, 0.28, [0, 1, 2]);
    scatter(scene, "seashell", 8, 0.22, [-3]);
    scatter(scene, "driftwood", 5, 0.3, [-3]);
  },
  // Kralle steht schiff-relativ (SHIP_KRALLE in world.ts) und NICHT im Tiled-
  // Objektlayer – sie wird über extraNpcs angehängt statt per Magic-Index spliced.
  extraNpcs: [{ id: "kralle", x: SHIP_KRALLE.x, y: SHIP_KRALLE.y }],
  conditionalPlatforms: [
    // Terraform-Erweiterungsplattform: solide bis `terraform apply` ausgeführt.
    { x: 44, y: 28, w: 7, h: 5, passable() { return !!(Game.sim && Game.sim.tf.applied); } },
  ],
  payoutPos() { return { x: (11 + Math.random() * 8) * T, y: 25 * T }; },
  scheduleAmbient(scene) {
    scene.time.addEvent({
      delay: 6500, loop: true,
      callback: () => { if (Math.random() < 0.65) spawnGull(scene); },
    });
    spawnGull(scene);
  },
};

/** Karten-ID → WorldScene-Konfiguration. Karten ohne Eintrag bekommen nur den
 *  generischen Aufbau (loadMapTerrain, spawnFlowers, spawnGrassDetail, spawnNpcs). */
export const WORLD_CONFIGS: Readonly<Partial<Record<string, WorldSceneConfig>>> = {
  harbor: harborConfig,
};
