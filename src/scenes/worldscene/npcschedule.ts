/* ===== NPC-Tagesplan-Sync (#420) =====
 * Verschiebt NPCs mit einem `schedule` in entities.json einmal pro Frame
 * an ihre laufzeit-aktuelle Kachel-Position. Ändert sich die Position
 * (Tageszeit-Grenze überschritten), tötet updateNpcSchedules den alten
 * Bob-Tween und startet ihn an der neuen Basis-Y neu – so bleibt die
 * Bob-Animation korrekt, ohne dass der Tween auf die alte Basis-Y zieht.
 */
import { ENTITY_NPCS, npcPositionAt } from "../../content/entities";
import type { WorldSceneLike } from "./types";
import { TILE as T } from "../../world/world";

/** Synchronisiert die Sprite-Positionen aller NPCs mit Tagesplan.
 *  NPCs ohne `schedule` werden übersprungen. Ändert sich nichts (selbe
 *  Ziel-Kachel wie bisher), ist der Aufruf ein reines No-Op. */
export function updateNpcSchedules(scene: WorldSceneLike, hhmm: string): void {
  for (const npc of scene.npcs) {
    const def = ENTITY_NPCS.find((e) => e.id === npc.id);
    if (!def?.schedule?.length) continue;
    const target = npcPositionAt(def, hhmm);
    if (Math.abs(npc.x - target.x) < 0.01 && Math.abs(npc.y - target.y) < 0.01) continue;
    npc.x = target.x;
    npc.y = target.y;
    const px = target.x * T + 8;
    const baseY = target.y * T + 15;
    scene.tweens.killTweensOf(npc.sprite);
    npc.sprite.setPosition(px, baseY).setDepth(target.y * T + T);
    scene.tweens.add({ targets: npc.sprite, y: baseY - 1, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    scene.tweens.killTweensOf(npc.marker);
    npc.marker.setPosition(px, target.y * T - 6);
    scene.tweens.add({ targets: npc.marker, y: target.y * T - 9, duration: 500, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  }
}
