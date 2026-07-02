/* ===== KubeQuest – WorldScene-Warps (worldscene/warps.ts) =====
 * Schritt des WorldScene.ts-Splits (#393). Hier liegt das Übergangs-System der
 * Hauptkarte: Häuser/Schiff betreten (#6) und das Übersetzen auf die Region-Szenen
 * – GitOps-Archipel (#92), Monitoring-Leuchtturm (#111) und Lagerhallen-Viertel
 * (#124) – plus das pro-Frame „Scharfmachen" der Warp-Gates gegen Pingpong.
 *
 * Seit #426 datengetrieben: statt je ein enterArchipel()/enterLighthouse()/
 * enterWarehouse() + je ein benanntes `*Armed`-Flag + drei feste if-Zweige gibt es
 * EIN generisches enterRegion() und einen Loop über die Daten-Liste REGION_WARPS
 * (warps.ts). Eine neue Region-Verknüpfung ist damit ein Daten-Eintrag, kein neuer
 * enterXxx(); das Anti-Pingpong-Gate hält seinen Zustand pro Warp-ID in einem Set.
 *
 * Freie Funktionen mit der Szene als Parameter; das Phaser-Anfassen (scene.scene.
 * launch/sleep, SFX) bleibt damit in EINER Hand, die Übergangs-Logik aber in einem
 * eigenen, fokussierten Modul.
 */
import { keys, setInteriorOpen } from "../../runtime";
import { findDoorAt, type Door } from "../../world/world";
import { SFX } from "../../sfx";
import { T } from "../shared";
import { regionWarpsFromMap, armWarps, triggeredWarp, type RegionWarp } from "../../world/warps";
import type { WorldSceneLike } from "./types";

/** #6: Haus betreten – WorldScene schlafen legen (friert + blendet sie aus)
 *  und die InteriorScene als eigene Szene starten. Der Spieler wird vorher
 *  vor die Tür gesetzt, damit ein Speichern/Neuladen draußen landet (sonst
 *  würde man beim Laden direkt wieder in der Tür stehen). */
export function enterInterior(scene: WorldSceneLike, door: Door) {
  const pl = scene.playerPos;
  pl.x = door.tx * T + 8;
  pl.y = (door.ty + 1) * T + 4;   // eine Kachel unter der Tür, draußen
  pl.face = "south"; pl.moving = false;
  SFX.door();
  setInteriorOpen(true);
  scene.scene.launch("Interior", { door });
  scene.scene.sleep();
}

/** Generischer Region-Übergang (#426): ersetzt die früheren enterArchipel/
 *  enterLighthouse/enterWarehouse. Der Spieler wird vorher auf den Rückkehr-
 *  Standplatz der Region (warp.worldReturn) zurückgesetzt, damit man symmetrisch
 *  dort ankommt, wo man abgelegt hat, ein Speichern/Neuladen draußen landet – und
 *  der Warp NICHT sofort erneut triggert: das Gate dieses Warps wird disarmt, bis
 *  die Lauftaste nach der Rückkehr einmal losgelassen wurde. Dann die Zielszene
 *  starten und die WorldScene schlafen legen (analog enterInterior). */
export function enterRegion(scene: WorldSceneLike, warp: RegionWarp) {
  const pl = scene.playerPos;
  pl.x = warp.worldReturn.tx * T + 8;
  pl.y = warp.worldReturn.ty * T + 8;
  pl.face = "north"; pl.moving = false;
  scene.warpArmed.delete(warp.id);
  SFX.door();
  setInteriorOpen(true);
  scene.scene.launch(warp.targetScene);
  scene.scene.sleep();
}

/** Pro Frame aus update(): die Warp-Gates „scharf machen" und bei Betreten einer
 *  Tür-/Warp-Kachel die Zielszene starten. Gibt true zurück, wenn ein
 *  Szenenwechsel ausgelöst wurde – dann überspringt update() den Rest des Frames
 *  (wie früher das inline `return`).
 *
 *  #92/#111/#124: Region-Anleger/-Aufgänge „scharf machen". Ein Warp darf erst
 *  auslösen, wenn der Spieler die Lauftaste seit der Ankunft losgelassen hat UND
 *  nicht schon auf der Trigger-Kachel steht – sonst pingpongt man mit gehaltener
 *  Taste sofort wieder zurück (Review-Feedback). Bei der Rückkehr landet man eine
 *  Kachel vor dem Trigger, also disarmt enterRegion() das Gate bewusst. Seit #426
 *  loopt das über REGION_WARPS der aktuellen Karte (scene.mapId) statt drei feste
 *  Zweige; der Armed-Zustand liegt pro Warp-ID im Set scene.warpArmed. */
export function updateWarps(scene: WorldSceneLike, blocked: boolean): boolean {
  const pl = scene.playerPos;
  const warps = regionWarpsFromMap(scene.mapId);
  const moveKeyDown = !!(keys["w"] || keys["s"] || keys["a"] || keys["d"] ||
    keys["ArrowUp"] || keys["ArrowDown"] || keys["ArrowLeft"] || keys["ArrowRight"]);

  // Jeden Warp „scharf machen", sobald der Spieler ihn verlassen hat und die
  // Lauftaste los ist (reiner Kern in warps.ts, pro Warp-ID im Set statt je ein Flag).
  armWarps(scene.warpArmed, warps, pl.x, pl.y, moveKeyDown);

  if (blocked) return false;

  // #6/#194: Auf einer Tür-Kachel? -> Haus/Schiff betreten (Rest dieses Frames
  // überspringen). scene.doors kommt aus dem Tiled-Objektlayer (Datenpfad) bzw.
  // den Code-Eingängen (Default) – findDoorAt prüft generisch dagegen.
  const door = findDoorAt(scene.doors as Door[], pl.x, pl.y);
  if (door) { enterInterior(scene, door); return true; }

  // Region-Warp betreten (scharf + auf der Trigger-Kachel)? -> Zielszene starten.
  const warp = triggeredWarp(scene.warpArmed, warps, pl.x, pl.y);
  if (warp) { enterRegion(scene, warp); return true; }
  return false;
}
