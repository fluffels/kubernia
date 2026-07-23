/* Tests für die geteilte Wang-Autotile-Klassifikation (#958).
 *
 * Bisher gab es zwei fast-identische renderGround()-Implementierungen (Hafen in
 * worldscene/terrain.ts, Regionen in RegionScene.ts) mit einer echten Divergenz:
 * der Weg-Zweig invertierte den Eck-Code beim Hafen (`^ 15`), bei den Regionen
 * nicht. Diese Datei testet die daraus gezogene, geteilte Phaser-freie Klassifikation
 * (worldscene/groundtiles.ts) – inkl. eines Pins auf den EINEN reconcilten Transform.
 *
 * Ausführen mit:  npm test
 */
import { describe, it, expect } from "vitest";
import {
  groundLevel,
  cornerCode,
  touchesLevel,
  edgeMaterial,
  isWaterCell,
  groundTile,
  WANG,
  type GroundReader,
} from "../src/scenes/worldscene/groundtiles";
import { WATER, SAND, PATH, DOCK } from "../src/world/regions/terraincodes";

const GRASS = 0;   // jeder Code außerhalb WATER/SAND/PATH/Dock/Stein zählt als Land (Stufe 2)
const STONE_A = 96, STONE_B = 97, STONE_C = 98;

function uniformGrid(w: number, h: number, fill: number): GroundReader {
  return { W: w, H: h, ground: new Array<number>(w * h).fill(fill) };
}

describe("worldscene/groundtiles (#958) – geteilte Wang-Klassifikation Hafen+Region", () => {
  describe("groundLevel", () => {
    it("ordnet Wasser < Sand < Land < Weg in die Wang-Stufen-Hierarchie ein", () => {
      expect(groundLevel(WATER)).toBe(0);
      expect(groundLevel(SAND)).toBe(1);
      expect(groundLevel(GRASS)).toBe(2);
      expect(groundLevel(PATH)).toBe(3);
    });
    it("zählt Dock- und Stein-Kai-Codes als Land (Stufe 2), nicht als eigene Stufe", () => {
      expect(groundLevel(DOCK)).toBe(2);
      expect(groundLevel(STONE_A)).toBe(2);
      expect(groundLevel(STONE_B)).toBe(2);
      expect(groundLevel(STONE_C)).toBe(2);
    });
  });

  describe("cornerCode", () => {
    it("klemmt Zugriffe außerhalb des Rasters auf die Randkachel, statt undefined zu lesen", () => {
      const host = uniformGrid(3, 3, WATER);
      expect(cornerCode(host, 0, 0, 1)).toBe(0);
      expect(cornerCode(host, 3, 3, 1)).toBe(0);   // außerhalb -> klemmt auf letzte Zeile/Spalte
    });
    it("setzt je Ecke genau ein Bit (NW=8, NE=4, SW=2, SE=1)", () => {
      const nw: GroundReader = { W: 2, H: 2, ground: [GRASS, WATER, WATER, WATER] };
      expect(cornerCode(nw, 1, 1, 2)).toBe(8);
      const ne: GroundReader = { W: 2, H: 2, ground: [WATER, GRASS, WATER, WATER] };
      expect(cornerCode(ne, 1, 1, 2)).toBe(4);
      const sw: GroundReader = { W: 2, H: 2, ground: [WATER, WATER, GRASS, WATER] };
      expect(cornerCode(sw, 1, 1, 2)).toBe(2);
      const se: GroundReader = { W: 2, H: 2, ground: [WATER, WATER, WATER, GRASS] };
      expect(cornerCode(se, 1, 1, 2)).toBe(1);
    });
  });

  describe("touchesLevel", () => {
    it("erkennt eine Stufe in einer der vier Eck-Nachbarn", () => {
      const host: GroundReader = { W: 2, H: 1, ground: [GRASS, WATER] };
      expect(touchesLevel(host, 1, 0, 0)).toBe(true);
      expect(touchesLevel(host, 0, 0, 3)).toBe(false);
    });
  });

  describe("edgeMaterial", () => {
    it("priorisiert Dock vor Stein-Kai vor Küste (wie beide Alt-Implementierungen)", () => {
      const dockHost: GroundReader = { W: 2, H: 1, ground: [DOCK, WATER] };
      expect(edgeMaterial(dockHost, 1, 0)).toBe("dock");
      const stoneHost: GroundReader = { W: 2, H: 1, ground: [STONE_A, WATER] };
      expect(edgeMaterial(stoneHost, 1, 0)).toBe("kai");
      const coastHost: GroundReader = { W: 2, H: 1, ground: [SAND, WATER] };
      expect(edgeMaterial(coastHost, 1, 0)).toBe("coast");
    });
    it("Dock UND Stein an verschiedenen Ecken derselben Kachel -> Dock gewinnt", () => {
      const both: GroundReader = { W: 2, H: 2, ground: [DOCK, STONE_A, WATER, WATER] };
      expect(edgeMaterial(both, 1, 1)).toBe("dock");
    });
  });

  describe("isWaterCell", () => {
    it("prüft die rohe Kachel direkt (Aufrufer bleibt immer im Raster, kein Clamping nötig)", () => {
      const host: GroundReader = { W: 2, H: 1, ground: [WATER, GRASS] };
      expect(isWaterCell(host, 0, 0)).toBe(true);
      expect(isWaterCell(host, 1, 0)).toBe(false);
    });
  });

  describe("groundTile – Kaskade + der reconcilte Weg-Transform (#958)", () => {
    it("Kachel berührt Wasser -> Rand-Set nach Nachbarmaterial, WANG bei hi=1", () => {
      const host: GroundReader = { W: 1, H: 1, ground: [WATER] };
      expect(groundTile(host, 0, 0)).toEqual({ sheet: "coast", frame: WANG[cornerCode(host, 0, 0, 1)] });
    });
    it("volle Dock-Kachel ohne Wasser-Nachbar -> volle Planke (WANG[15])", () => {
      const host: GroundReader = { W: 1, H: 1, ground: [DOCK] };
      expect(groundTile(host, 0, 0)).toEqual({ sheet: "dock", frame: WANG[15] });
    });
    it("volle Stein-Kachel ohne Wasser-Nachbar -> voller Stein (WANG[15])", () => {
      const host: GroundReader = { W: 1, H: 1, ground: [STONE_A] };
      expect(groundTile(host, 0, 0)).toEqual({ sheet: "kai", frame: WANG[15] });
    });
    it("volle Gras-Kachel -> meadow-Sheet, WANG bei hi=2", () => {
      const host: GroundReader = { W: 1, H: 1, ground: [GRASS] };
      expect(groundTile(host, 0, 0)).toEqual({ sheet: "meadow", frame: WANG[cornerCode(host, 0, 0, 2)] });
    });
    it("Reconcile-Pin (Regression #958): volle Weg-Kachel nutzt den invertierten Eck-Code (^15)", () => {
      // #866/#914: das grass-dirt-Tileset wurde getauscht (lower=Weg, upper=Gras) – seit PR #914
      // ist der ^15-Transform im Hafen die dokumentiert korrekte Abbildung auf die Wang-Frames.
      // Die Region hatte den Fix nie erhalten (genau die Divergenz aus diesem Ticket) – dieser
      // Test pinnt den EINEN reconcilten Wert für BEIDE Aufrufer fest, nicht mehr zwei.
      const full: GroundReader = { W: 1, H: 1, ground: [PATH] };
      expect(groundTile(full, 0, 0)).toEqual({ sheet: "path", frame: WANG[cornerCode(full, 0, 0, 3) ^ 15] });
      // Explizit NICHT der unveränderte (nicht invertierte) Wert – sonst rendert der Weg
      // wieder die vor #914 falsche, ungetauschte Ecken-Zuordnung.
      expect(groundTile(full, 0, 0).frame).not.toBe(WANG[cornerCode(full, 0, 0, 3)]);
      // Auch im gemischten Fall (nur eine Ecke erreicht die Weg-Stufe, Rest Gras): derselbe Transform.
      const mixed: GroundReader = { W: 2, H: 2, ground: [PATH, GRASS, GRASS, GRASS] };
      expect(groundTile(mixed, 1, 1)).toEqual({ sheet: "path", frame: WANG[cornerCode(mixed, 1, 1, 3) ^ 15] });
    });
  });
});
