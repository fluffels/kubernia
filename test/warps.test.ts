/* Tests für #426 – Region-Warps als Daten + reiner Anti-Pingpong-Kern.
 *
 * warps.ts bündelt die Hauptkarte⇄Region-Übergänge zu EINER Daten-Liste (statt drei
 * hartcodierter enterXxx() + benannter *Armed-Flags) und trägt den Phaser-freien Kern
 * des Anti-Pingpong-Gates (armWarps/triggeredWarp). Genau dieser Kern steckte früher als
 * drei kopierte if-Zweige stumm in der Präsentation – hier ist er node-testbar.
 *
 * Bewusst auch Grenz-/Negativfälle: die Liste darf nicht von den geometrie-abgeleiteten
 * SSOT-Konstanten driften, kein Warp darf sich selbst sofort re-triggern, und der
 * Gate-Kern muss das volle „erst Loslassen, dann scharf"-Verhalten erfüllen (inkl. der
 * Fälle, in denen NICHTS auslösen darf – sonst wäre der Test ein False-Positive).
 *
 * Ausführen mit:  npm test
 */
import { describe, it, expect } from "vitest";
import { TILE } from "../src/world";
import {
  REGION_WARPS, regionWarpsFromMap, armWarps, triggeredWarp, warpAt, type RegionWarp,
} from "../src/warps";
import { WORLD_TO_ARCHIPEL, WORLD_RETURN, ARCHIPEL_TO_WORLD, ARCHIPEL_ARRIVAL } from "../src/archipel";
import { WORLD_TO_LIGHTHOUSE, WORLD_RETURN_LH, LIGHTHOUSE_TO_WORLD, LIGHTHOUSE_ARRIVAL } from "../src/lighthouse";
import { WORLD_TO_WAREHOUSE, WORLD_RETURN_WH, WAREHOUSE_TO_WORLD, WAREHOUSE_ARRIVAL } from "../src/warehouse";

/** Pixel-Mittelpunkt einer Kachel (wie die Szenen den Spieler setzen + warpAt floort). */
const center = (t: { tx: number; ty: number }): [number, number] => [t.tx * TILE + 8, t.ty * TILE + 8];

describe("REGION_WARPS – die Daten-Liste der Region-Übergänge (#426)", () => {
  it("deckt genau die drei Regionen ab, alle von der Hauptkarte „harbor“", () => {
    expect(REGION_WARPS.map((w) => w.id).sort()).toEqual(["archipel", "lighthouse", "warehouse"]);
    expect(REGION_WARPS.map((w) => w.targetScene).sort()).toEqual(["Archipel", "Lighthouse", "Warehouse"]);
    for (const w of REGION_WARPS) expect(w.fromMap).toBe("harbor");
  });

  it("hat eindeutige Warp-IDs (Gate-Schlüssel) und disjunkte Trigger-Kacheln", () => {
    expect(new Set(REGION_WARPS.map((w) => w.id)).size).toBe(REGION_WARPS.length);
    // Zwei Regionen dürfen nicht auf derselben Trigger-Kachel liegen – sonst hinge die
    // Zielwahl an der Loop-Reihenfolge statt an der Position.
    const tiles = REGION_WARPS.map((w) => `${w.trigger.tx},${w.trigger.ty}`);
    expect(new Set(tiles).size).toBe(REGION_WARPS.length);
  });

  it("aggregiert die geometrie-abgeleiteten SSOT-Konstanten ohne Drift (keine Kopie)", () => {
    // Die Liste verweist auf dieselben Objekte, die je Region aus ihrer Mathe abgeleitet
    // werden – würde jemand sie als Zahlen-Kopie eintragen, fiele dieser Test bei der
    // nächsten Geometrie-Änderung (z.B. southEdgeRow()) auf.
    const byId = Object.fromEntries(REGION_WARPS.map((w) => [w.id, w]));
    expect(byId.archipel.trigger).toBe(WORLD_TO_ARCHIPEL);
    expect(byId.archipel.worldReturn).toBe(WORLD_RETURN);
    expect(byId.archipel.regionReturn).toBe(ARCHIPEL_TO_WORLD);
    expect(byId.archipel.arrival).toBe(ARCHIPEL_ARRIVAL);
    expect(byId.lighthouse.trigger).toBe(WORLD_TO_LIGHTHOUSE);
    expect(byId.lighthouse.worldReturn).toBe(WORLD_RETURN_LH);
    expect(byId.lighthouse.regionReturn).toBe(LIGHTHOUSE_TO_WORLD);
    expect(byId.lighthouse.arrival).toBe(LIGHTHOUSE_ARRIVAL);
    expect(byId.warehouse.trigger).toBe(WORLD_TO_WAREHOUSE);
    expect(byId.warehouse.worldReturn).toBe(WORLD_RETURN_WH);
    expect(byId.warehouse.regionReturn).toBe(WAREHOUSE_TO_WORLD);
    expect(byId.warehouse.arrival).toBe(WAREHOUSE_ARRIVAL);
  });

  it("kein Re-Trigger-Loop für JEDEN Warp: Rückkehr-/Ankunftskachel ≠ Warp-Kachel", () => {
    for (const w of REGION_WARPS) {
      // Hauptkarte: Rückkehr-Standplatz liegt NICHT auf der Trigger-Kachel.
      expect(warpAt(...center(w.worldReturn), w.trigger), `${w.id}: worldReturn auf Trigger`).toBe(false);
      // Region: Ankunft liegt NICHT auf der Rück-Warp-Kachel.
      expect(warpAt(...center(w.arrival), w.regionReturn), `${w.id}: arrival auf Rück-Warp`).toBe(false);
    }
  });
});

describe("regionWarpsFromMap – Übergänge je Hauptkarte", () => {
  it("liefert für „harbor“ alle drei, für eine andere Karte keine", () => {
    expect(regionWarpsFromMap("harbor")).toHaveLength(3);
    expect(regionWarpsFromMap("test-map")).toHaveLength(0);
  });
});

describe("armWarps / triggeredWarp – reiner Kern des Anti-Pingpong-Gates", () => {
  const warps = regionWarpsFromMap("harbor");
  const arch = warps.find((w) => w.id === "archipel") as RegionWarp;

  it("armiert nichts, solange eine Lauftaste gehalten wird", () => {
    const armed = new Set<string>();
    armWarps(armed, warps, 0, 0, true);   // moveKeyDown = true
    expect(armed.size).toBe(0);
  });

  it("armiert beim Loslassen jeden Warp, dessen Trigger man NICHT betritt", () => {
    const armed = new Set<string>();
    // Spieler steht auf der Archipel-Trigger-Kachel, Taste losgelassen.
    armWarps(armed, warps, ...center(arch.trigger), false);
    // Archipel bleibt disarmt (man steht ja drauf), die anderen werden scharf.
    expect(armed.has("archipel")).toBe(false);
    expect(armed.has("lighthouse")).toBe(true);
    expect(armed.has("warehouse")).toBe(true);
  });

  it("löst NICHT aus, solange der Warp nicht scharf ist (Ankommen auf der Kachel)", () => {
    const armed = new Set<string>();   // nichts scharf
    expect(triggeredWarp(armed, warps, ...center(arch.trigger))).toBeUndefined();
  });

  it("löst NICHT aus, wenn der Warp zwar scharf ist, man aber nicht auf der Kachel steht", () => {
    const armed = new Set(["archipel"]);
    expect(triggeredWarp(armed, warps, ...center(arch.worldReturn))).toBeUndefined();
  });

  it("löst aus, sobald der Warp scharf ist UND man auf der Trigger-Kachel steht", () => {
    const armed = new Set(["archipel"]);
    expect(triggeredWarp(armed, warps, ...center(arch.trigger))).toBe(arch);
  });

  it("volle Sequenz: ankommen (gehalten) → kein Trigger; loslassen+drauflaufen → Trigger; "
    + "nach Disarm zurück (gehalten) → kein erneuter Trigger", () => {
    const armed = new Set<string>();
    // 1) Man kommt mit gehaltener Taste auf der Trigger-Kachel an → nicht scharf, kein Trigger.
    armWarps(armed, warps, ...center(arch.trigger), true);
    expect(triggeredWarp(armed, warps, ...center(arch.trigger))).toBeUndefined();
    // 2) Man läuft weg + lässt los → wird scharf.
    armWarps(armed, warps, ...center(arch.worldReturn), false);
    expect(armed.has("archipel")).toBe(true);
    // 3) Man läuft (Taste gehalten) auf die Trigger-Kachel → jetzt löst es aus.
    armWarps(armed, warps, ...center(arch.trigger), true);   // gehaltene Taste armiert nicht neu, entwaffnet aber auch nicht
    expect(triggeredWarp(armed, warps, ...center(arch.trigger))).toBe(arch);
    // 4) enterRegion() disarmt + setzt auf worldReturn. Kommt man mit gehaltener Taste zurück,
    //    darf NICHTS sofort re-triggern (das war der ursprüngliche Pingpong-Bug).
    armed.delete("archipel");
    armWarps(armed, warps, ...center(arch.worldReturn), true);
    expect(triggeredWarp(armed, warps, ...center(arch.worldReturn))).toBeUndefined();
  });
});
