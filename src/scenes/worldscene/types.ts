/* ===== KubeQuest – WorldScene-System-Typ (worldscene/types.ts) =====
 * Schritt des WorldScene.ts-Splits (#393, analog scenes.ts-Split #345): die großen
 * Spiel-Systeme der World-Szene (Gefahren-Events, Cluster-Sync, Warps, Terrain,
 * Deko) liegen als eigene, fokussierte Module unter src/scenes/worldscene/ und
 * bekommen die laufende Szene als Parameter (`scene`) – dasselbe „freie Funktion
 * + Host"-Muster wie der sim.ts-Split (#346).
 *
 * `WorldSceneLike` ist die lose Struktur-Sicht dieser Szene für die Module. Die
 * KONKRETE WorldScene-Klasse ist seit #423 voll getippt (echte Felder statt
 * `[key: string]: any`); diese Sicht hier bleibt bewusst lose, damit die Module
 * Phaser über die Szene anfassen, OHNE WorldScene.ts zu importieren. Ein Import von
 * WorldScene.ts wäre ein Import-Zyklus (WorldScene → Modul → WorldScene), den der
 * Arch-Wächter #390 verbietet (Typ-Importe zählen dort mit, tsPreCompilationDeps).
 * Die ~50 Szenenfelder hier zu spiegeln wäre Doppelpflege + Drift – daher der eine,
 * bewusst begründete Escape-Hatch (eslint-disable) statt einer zweiten Feldliste.
 */
import type Phaser from "phaser";

export interface WorldSceneLike extends Phaser.Scene {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
