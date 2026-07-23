/* Pin-Test für #959 – geteilte Terrain-Bodencodes (SSOT) gegen Drift.
 *
 * Zwei Dinge werden gepinnt, inkl. Negativfall (Test wird beim Verfälschen der
 * SSOT-Werte rot, siehe Red-Green-Beweis im PR):
 *  1. jede Region re-exportiert exakt den SSOT-Wert aus terraincodes.ts, statt
 *     ihn erneut/abweichend zu definieren (die eigentliche Fragilität aus #959),
 *  2. die Regions-Codes sind (heute) identisch zu den Hafenkarte-Codes aus
 *     harbormap.ts – trotz unterschiedlicher Namen (PATH↔DIRT, DOCK↔PIER). Die
 *     Namens-Vereinheitlichung ist die separate ADR-Entscheidung #957; dieser
 *     Test sichert nur die Werte-Gleichheit gegen künftiges stilles Auseinanderlaufen.
 */
import { test, expect } from "vitest";
import { WATER, SAND, PATH, DOCK } from "../src/world/regions/terraincodes";
import * as archipel from "../src/world/regions/archipel";
import * as lighthouse from "../src/world/regions/lighthouse";
import * as warehouse from "../src/world/regions/warehouse";
import * as watchtower from "../src/world/regions/watchtower";
import * as flotte from "../src/world/regions/flotte";
import * as werft from "../src/world/regions/werft";
import { WATER as H_WATER, SAND as H_SAND, DIRT, PIER } from "../src/world/maps/harbormap";

test("jede Region re-exportiert exakt die SSOT-Werte (kein eigenes Redefinieren)", () => {
  expect(archipel.WATER).toBe(WATER);
  expect(archipel.SAND).toBe(SAND);
  expect(archipel.PATH).toBe(PATH);
  expect(archipel.DOCK).toBe(DOCK);

  expect(lighthouse.WATER).toBe(WATER);
  expect(lighthouse.PATH).toBe(PATH);

  expect(warehouse.WATER).toBe(WATER);
  expect(warehouse.DOCK).toBe(DOCK);
  expect(warehouse.PATH).toBe(PATH);

  expect(watchtower.WATER).toBe(WATER);
  expect(watchtower.DOCK).toBe(DOCK);
  expect(watchtower.PATH).toBe(PATH);

  expect(flotte.WATER).toBe(WATER);
  expect(flotte.DOCK).toBe(DOCK);

  expect(werft.WATER).toBe(WATER);
  expect(werft.DOCK).toBe(DOCK);
  expect(werft.PATH).toBe(PATH);
});

test("Region-Bodencodes == Hafenkarte-Bodencodes (Drift-Schutz Region ⇄ Hafen)", () => {
  expect(WATER).toBe(H_WATER);
  expect(SAND).toBe(H_SAND);
  expect(PATH).toBe(DIRT);
  expect(DOCK).toBe(PIER);
});
