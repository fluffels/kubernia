import { describe, it, expect } from "vitest";
import { ASSET_MANIFEST, KQAssets, COMMON_ASSETS, assetsForScene } from "../src/assets-data";

/* Sichert das Asset-Manifest (#59) ab: Es ist die EINE Datenquelle, aus der
 * BootScene laden + Frame-Slicing ableitet und KQAssets erzeugt wird. Diese Tests
 * decken nicht nur den Happy Path, sondern auch Grenz-/Fehlerfälle ab (doppelte
 * Schlüssel, kaputte Sheet-Parameter, KQAssets läuft aus dem Manifest weg). */

describe("ASSET_MANIFEST", () => {
  it("hat eindeutige Schlüssel (kein Asset doppelt verdrahtet)", () => {
    const keys = ASSET_MANIFEST.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("jeder Eintrag hat einen nicht-leeren Pfad/Quelle", () => {
    for (const a of ASSET_MANIFEST) {
      expect(typeof a.src, a.key).toBe("string");
      expect(a.src.length, a.key).toBeGreaterThan(0);
    }
  });

  it("Sheets haben eine sinnvolle Spalten- und Frame-Größe (>=1)", () => {
    for (const a of ASSET_MANIFEST) {
      if (a.kind !== "sheet") continue;
      expect(a.cols, a.key).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(a.cols), a.key).toBe(true);
      if (a.frame !== undefined) {
        expect(a.frame, a.key).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(a.frame), a.key).toBe(true);
      }
    }
  });

  it("plains tragen keine Slicing-Parameter (cols nur bei sheets)", () => {
    for (const a of ASSET_MANIFEST) {
      if (a.kind === "plain") {
        expect("cols" in a, a.key).toBe(false);
      }
    }
  });

  it("kennt die geschnittenen Tilesets als sheet mit erwarteter Spaltenzahl", () => {
    // Diese Keys MÜSSEN Sheets bleiben, sonst bricht das Frame-Slicing in scenes.ts
    // (Tiles würden als ganzes Bild geladen → kaputte Karte).
    const expectedCols: Record<string, number> = {
      town: 12, dungeon: 12,
      coast: 4, meadow: 4, path: 4, kai: 4, dock: 4,
    };
    for (const [key, cols] of Object.entries(expectedCols)) {
      const entry = ASSET_MANIFEST.find((a) => a.key === key);
      expect(entry, key).toBeDefined();
      expect(entry!.kind, key).toBe("sheet");
      expect((entry as { cols: number }).cols, key).toBe(cols);
    }
  });

  it("hält bekannte Einzelobjekte als plain (kein versehentliches Slicing)", () => {
    for (const key of ["ship", "tree", "char_player", "house_office"]) {
      const entry = ASSET_MANIFEST.find((a) => a.key === key);
      expect(entry?.kind, key).toBe("plain");
    }
  });
});

describe("KQAssets", () => {
  it("ist deckungsgleich aus dem Manifest abgeleitet (eine Quelle, kein Drift)", () => {
    expect(Object.keys(KQAssets).sort()).toEqual(
      ASSET_MANIFEST.map((a) => a.key).sort(),
    );
    for (const a of ASSET_MANIFEST) {
      expect(KQAssets[a.key], a.key).toBe(a.src);
    }
  });
});

describe("ASSET_MANIFEST – Szenen-Zuordnung (#198 Lazy-Loading)", () => {
  // Die EINZIGEN region-exklusiv nachgeladenen Assets. Bewusst hartkodiert als Wächter aus
  // dem Nutzungs-Audit (#198): wer ein Asset lazy taggt, das auch die WorldScene/eine andere
  // Szene nutzt, würde im Spiel eine fehlende Textur erzeugen – genau das fängt dieser Block.
  const EXPECTED_LAZY: Record<string, string[]> = {
    Archipel: ["char_argos"],
    Lighthouse: ["grafana_board", "alert_bell", "char_lumi"],
    Warehouse: ["container", "crane", "char_knut"],
    Watchtower: ["char_vidar"],
    Flotte: ["char_saga"],
  };
  const REGIONS = Object.keys(EXPECTED_LAZY);

  it("Common + alle Region-Sets partitionieren das Manifest lückenlos & überschneidungsfrei", () => {
    const common = COMMON_ASSETS.map((a) => a.key);
    const regional = REGIONS.flatMap((s) => assetsForScene(s).map((a) => a.key));
    // keine Überschneidung (kein Asset ist common UND regional)
    expect(common.filter((k) => regional.includes(k))).toEqual([]);
    // zusammen = das GANZE Manifest (nichts geht beim Splitten verloren)
    expect([...common, ...regional].sort()).toEqual(ASSET_MANIFEST.map((a) => a.key).sort());
  });

  it("genau die erwarteten Assets sind region-lazy getaggt (Wächter gegen Über-/Unter-Tagging)", () => {
    for (const [scene, keys] of Object.entries(EXPECTED_LAZY)) {
      expect(assetsForScene(scene).map((a) => a.key).sort(), scene).toEqual([...keys].sort());
    }
    // Summe der getaggten Assets = Summe der erwarteten (kein zusätzliches scene-Tag woanders)
    const tagged = ASSET_MANIFEST.filter((a) => a.scene).length;
    expect(tagged).toBe(Object.values(EXPECTED_LAZY).flat().length);
  });

  it("bekannte GETEILTE Assets bleiben common (Regression gegen Fehl-Tagging)", () => {
    // Diese Keys nutzt die WorldScene ODER mehrere Szenen → dürfen NIE einen scene-Tag tragen,
    // sonst fehlt im Hafen/anderswo die Textur. (tree/pine: Hafen-Wald; lighthouse: Hafen-Turm;
    // barrel/crate: Cluster-Pods; coast…: Terrain überall; char_player/seagull/flowers: überall.)
    const mustBeCommon = [
      "tree", "pine", "lighthouse", "barrel", "crate", "coast", "meadow", "path", "kai", "dock",
      "flowers", "seagull", "char_player", "dungeon", "sign", "rock", "bush",
    ];
    const commonSet = new Set(COMMON_ASSETS.map((a) => a.key));
    for (const k of mustBeCommon) expect(commonSet.has(k), k).toBe(true);
  });

  it("KQAssets bleibt VOLLSTÄNDIG (Lazy-Tag ändert nichts an den DOM-Porträt-URLs)", () => {
    // Porträts/UI laden über KQAssets[tex] (DOM-<img>-URL), nicht über den Phaser-Cache –
    // darum müssen auch die lazy getaggten Region-Chars hier weiter auflösen.
    for (const k of ["char_argos", "char_lumi", "char_knut"]) {
      expect(KQAssets[k], k).toBeTruthy();
    }
  });
});
