/* Fitness-Function (#1311): Jede Szene mit Spielfigur liefert ihre Sicht für `kqDev.state()`
 * selbst über `devView()` (devtools/snapshot). Ohne das lieferte ein neuer Szenen-Typ still
 * `player: null`, weil scenes/devapi.ts keine Szenen-Klassen mehr per instanceof kennt.
 *
 * Erkennungsmerkmal einer Spielfigur-Szene: ein Feld `…!: ScenePlayer` (Szenen-Klassen) bzw.
 * `playerPos!: ScenePlayer`. */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCENES_DIR = join(__dirname, "..", "src", "scenes");

/** Dateien (Name → fehlt devView?), die ein Spielfigur-Feld deklarieren, aber keine `devView(` tragen. */
function ohneDevView(dateien: Record<string, string>): string[] {
  return Object.entries(dateien)
    .filter(([, text]) => /!\s*:\s*ScenePlayer\b/.test(text) && !/devView\s*\(/.test(text))
    .map(([name]) => name);
}

describe("Spielfigur-Szenen tragen devView() (#1311)", () => {
  it("jede Datei unter src/scenes mit einem ScenePlayer-Feld enthält devView(", () => {
    const dateien: Record<string, string> = {};
    for (const f of readdirSync(SCENES_DIR).filter((n) => n.endsWith(".ts"))) {
      dateien[f] = readFileSync(join(SCENES_DIR, f), "utf8");
    }
    expect(Object.keys(dateien).length).toBeGreaterThan(3);
    expect(ohneDevView(dateien)).toEqual([]);
  });

  it("Red-Green: eine neue Szene mit Spielfigur ohne devView() wird gemeldet, mit devView() nicht", () => {
    const neu = "class X extends Phaser.Scene { pl!: ScenePlayer; }";
    expect(ohneDevView({ "X.ts": neu })).toEqual(["X.ts"]);
    expect(ohneDevView({ "X.ts": neu + " devView() { return { map: null, player: this.pl }; }" })).toEqual([]);
    expect(ohneDevView({ "Y.ts": "class Y extends Phaser.Scene { n!: number; }" })).toEqual([]);
  });

  it("die echten Szenen: World, Interior und die Insel-Basis tragen devView", () => {
    for (const f of ["WorldScene.ts", "InteriorScene.ts", "shared.ts", "RegionScene.ts"]) {
      expect(readFileSync(join(SCENES_DIR, f), "utf8"), f).toMatch(/devView\s*\(/);
    }
  });
});
