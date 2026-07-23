/* ===== Kubernia – geteiltes Wang-Autotile-Rendering (worldscene/renderground.ts) =====
 * #958 (Kind von #870): der dünne Phaser-`stamp`-Teil der vorher fast-duplizierten
 * renderGround()-Implementierungen (Hafen in terrain.ts, Regionen in RegionScene.ts).
 * Die reine Kachel-Wahl (welches Sheet/Frame je Kachel) liegt Phaser-frei + unit-
 * getestet in worldscene/groundtiles.ts; hier nur noch der RenderTexture-Loop +
 * die optionale Hafen-Atmosphäre (Wasser-Hintergrund/Wellen-Glitzer/Küstenwellen),
 * über Optionen gesteuert statt als zweite Kopie.
 */
import Phaser from "phaser";
import { T, FOAM, WATER as SEA_FILL_COLOR } from "../shared";
import { groundTile, isWaterCell, type GroundReader } from "./groundtiles";

/** Kachel-Bereich, aus dem Sparkle-Positionen gewürfelt werden (Rejection-Sampling
 *  gegen `isWaterCell` – nur der Bereich, in dem überhaupt Wasser liegt, macht den
 *  Treffer wahrscheinlich; der Hafen begrenzt ihn auf den sichtbaren Meeresstreifen). */
export interface SparkleBounds { xFrom: number; xTo: number; yFrom: number; yTo: number; }

export interface RenderGroundOptions {
  /** Solider Wasser-Hintergrund unterm Wang-Rand (Fallback vor dem Kachel-Stamp,
   *  #108: nur der Hafen hat im Süden offenes Meer). */
  waterFill?: boolean;
  /** Anzahl Wellen-Glitzer-Sprites auf Wasserkacheln (0/undefined = keine). */
  sparkleCount?: number;
  /** Bereich fürs Sparkle-Würfeln (Default: ganze Karte). */
  sparkleBounds?: SparkleBounds;
  /** Anzahl Richtung-Küste rollender Wellen-Sprites (reine Hafen-Atmosphäre, 0/undefined = keine). */
  rollingWaveCount?: number;
}

/** Minimale Sicht, die das Rendering zusätzlich zum Boden-Raster (GroundReader)
 *  braucht – von WorldSceneLike UND RegionScene (via Phaser.Scene) erfüllt. */
export type RenderGroundHost = Phaser.Scene & GroundReader;

/** Die geteilte Wang-Boden-Zeichnung: Kachel-Raster stempeln + optionale Hafen-
 *  Atmosphäre. `terrain.ts` (Hafen) und `RegionScene.ts` (Regionen) rufen dies mit
 *  ihren jeweiligen Optionen statt je eine eigene Kopie zu pflegen (#958). */
export function renderGround(host: RenderGroundHost, opts: RenderGroundOptions = {}): void {
  const rt = host.add.renderTexture(0, 0, host.W * T, host.H * T).setOrigin(0).setDepth(0);
  if (opts.waterFill) {
    // Meer als Hintergrund-Fallback (wird von den Wang-Wasserkacheln überdeckt).
    rt.fill(SEA_FILL_COLOR, 1, 0, 24 * T, host.W * T, (host.H - 24) * T);
  }

  // Phaser 4: drawFrame ist weg -> stamp() mit Ursprung oben-links (default zentriert); render() flusht den Puffer.
  const topLeft = { originX: 0, originY: 0 };
  for (let y = 0; y < host.H; y++) {
    for (let x = 0; x < host.W; x++) {
      const tile = groundTile(host, x, y);
      rt.stamp(tile.sheet, tile.frame, x * T, y * T, topLeft);
    }
  }
  rt.render();

  stampSparkles(host, opts.sparkleCount ?? 0, opts.sparkleBounds);
  stampRollingWaves(host, opts.rollingWaveCount ?? 0);
}

function stampSparkles(host: RenderGroundHost, count: number, bounds?: SparkleBounds): void {
  if (count <= 0) return;
  const b = bounds ?? { xFrom: 0, xTo: host.W - 1, yFrom: 0, yTo: host.H - 1 };
  for (let i = 0; i < count; i++) {
    const x = Phaser.Math.Between(b.xFrom, b.xTo), y = Phaser.Math.Between(b.yFrom, b.yTo);
    if (!isWaterCell(host, x, y)) continue;
    const s = host.add.image(x * T + Phaser.Math.Between(2, 12), y * T + Phaser.Math.Between(3, 12), "px")
      .setScale(2.5, 0.8).setTint(FOAM).setAlpha(0).setDepth(1);
    host.tweens.add({ targets: s, alpha: { from: 0, to: 0.55 }, duration: Phaser.Math.Between(900, 1800), yoyo: true, repeat: -1, delay: Phaser.Math.Between(0, 2000) });
  }
}

/** Wellen, die Richtung Küste rollen (reine Hafen-Atmosphäre) – der Bereich sitzt
 *  fest im südlichen Meeresstreifen, darum kein Options-Parameter dafür nötig. */
function stampRollingWaves(host: RenderGroundHost, count: number): void {
  for (let i = 0; i < count; i++) {
    const wv = host.add.image(0, 0, "px").setScale(Phaser.Math.Between(6, 11), 0.8).setTint(0xdfeefb).setAlpha(0).setDepth(1);
    const reset = () => {
      wv.x = Phaser.Math.Between(2, host.W - 2) * T;
      wv.y = Phaser.Math.Between(30, host.H - 2) * T;
    };
    reset();
    host.tweens.add({
      targets: wv, y: "-=10", alpha: { from: 0, to: 0.45 },
      duration: Phaser.Math.Between(1700, 2700), yoyo: true, repeat: -1,
      delay: Phaser.Math.Between(0, 2600), onRepeat: reset,
    });
  }
}
