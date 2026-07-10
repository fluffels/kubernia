/* ===== KubeQuest – Hafen-Schadensoptik-Mapping (worldscene/harbordamage.ts) =====
 * Phaser-freie, testbare Hilfsfunktion: welcher Textur-Key gehört zu welchem
 * Control-Plane-Zustand (#692). Hier extrahiert, damit Unit-Tests die pure Logik
 * ohne Phaser-Import prüfen können.
 */

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
