/* Tests für den DOM-freien Rang-Aufstieg-Kern (#223): mergeRankUp faltet
 * mehrere aufgelaufene Aufstiege zu EINEM „von → nach" zusammen. Bewusst auch
 * der Mehrfach-Fall (mehr als zwei Aufstiege) und der Erst-Fall (kein pending).
 */
import { test, expect } from "vitest";
import { mergeRankUp, type RankUpView } from "../src/hud/rankup";

const v = (fromIcon: string, fromName: string, toIcon: string, toName: string): RankUpView =>
  ({ fromIcon, fromName, toIcon, toName });

test("mergeRankUp: ohne pending unverändert der frische Aufstieg", () => {
  const next = v("🦔", "Landratte", "🧽", "Moses");
  expect(mergeRankUp(null, next)).toEqual(next);
});

test("mergeRankUp: behält das ursprüngliche 'von' und übernimmt das neueste 'nach'", () => {
  const first = v("🦔", "Landratte", "🧽", "Moses");
  const second = v("🧽", "Moses", "🧹", "Deckshand");
  expect(mergeRankUp(first, second)).toEqual(v("🦔", "Landratte", "🧹", "Deckshand"));
});

test("mergeRankUp: kettet über mehrere Aufstiege zum Start→Endrang", () => {
  const start = v("🦔", "Landratte", "🧽", "Moses");
  const chained = [
    v("🧽", "Moses", "🧹", "Deckshand"),
    v("🧹", "Deckshand", "⚓", "Matrose"),
    v("⚓", "Matrose", "🪢", "Maat"),
  ].reduce(mergeRankUp, start);
  expect(chained).toEqual(v("🦔", "Landratte", "🪢", "Maat"));
});
