/* ===== KubeQuest – Hafen-Schadensoptik-Mapping (worldscene/harbordamage.ts) =====
 * Phaser-freie, testbare Hilfsfunktionen für die Sturm-Schadensoptik:
 * - harborTexture: welcher Textur-Key gehört zu welchem CP-Zustand (#692)
 * - pierHealed:   ist ein Steg nach kubeadm init/join bereits repariert (#693)
 * Hier extrahiert, damit Unit-Tests die pure Logik ohne Phaser-Import prüfen können.
 */

import { CONTROL_PLANE_NODE, workerNodeName } from "../../sim/util";
/** Heile Textur-Key → Trümmer-Variante bei CP-Ausfall. */
export const HARBOR_DAMAGE: Record<string, string> = {
  lighthouse:   "lighthouse_ruined",
  house_office: "house_office_damaged",
  ship:         "ship_wrecked",
  crane:        "crane_wrecked",
};

/** Gibt den Textur-Key zurück, der zum Control-Plane-Zustand passt:
 *  beschädigte Variante wenn `!controlPlaneUp`, heile wenn `controlPlaneUp`. */
export function harborTexture(base: string, controlPlaneUp: boolean): string {
  return controlPlaneUp ? base : (HARBOR_DAMAGE[base] ?? base);
}

/** Steg-Namen in derselben Reihenfolge wie scene.piers (#693). */
export const PIER_NAMES = [CONTROL_PLANE_NODE, workerNodeName(1), workerNodeName(2)] as const;

/** Ist ein einzelner Steg bereits repariert?
 *  Control-Plane-Steg: heil sobald controlPlane.up === true (kubeadm init).
 *  Worker-Stege:       heil sobald der gleichnamige Node im Cluster ist (kubeadm join). */
export function pierHealed(
  name: string,
  controlPlaneUp: boolean,
  nodeNames: ReadonlyArray<string>,
): boolean {
  return name === CONTROL_PLANE_NODE ? controlPlaneUp : nodeNames.includes(name);
}
