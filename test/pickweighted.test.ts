/* Tests für den reinen Auswahl-Kern `pickWeighted` (src/game/shared.ts, #513).
 *
 * Herausgezogen aus `Game.pickWeightedPractice`, das vorher nur über das voll komponierte
 * Game erreichbar (und damit schwer isoliert prüfbar) war. Hier direkt & Phaser-frei getestet:
 * der Algorithmus hängt an KEINEM Spielzustand, nur an einer Gewichts-Funktion + `rand`.
 *
 * Bewusst auch Grenzfälle: leerer Pool, Gewicht-0-Elemente werden übersprungen, ein `rand`
 * am oberen Rand fällt auf das letzte Element zurück (Rundungs-Sicherheit).
 */
import { test, expect } from "vitest";
import { pickWeighted } from "../src/game/shared";

test("pickWeighted: leerer Pool → undefined", () => {
  expect(pickWeighted([], () => 0, () => 0)).toBeUndefined();
});

test("pickWeighted: rand=0 wählt das erste Element mit positivem Gewicht", () => {
  // Gleiche Gewichte, rand()*total = 0 → r wird beim ersten Element negativ.
  expect(pickWeighted(["a", "b", "c"], () => 1, () => 0)).toBe("a");
});

test("pickWeighted: rand landet gezielt im zweiten Gewichts-Segment", () => {
  // Gewichte [1,1,1], total 3. rand()=0.5 → r=1.5; a zieht 1 ab (0.5, nicht <0),
  // b zieht 1 ab (-0.5 <0) → b.
  expect(pickWeighted(["a", "b", "c"], () => 1, () => 0.5)).toBe("b");
});

test("pickWeighted: höheres Gewicht wird bei gleichem rand bevorzugt", () => {
  // Gewichte [3,1], total 4. rand()=0.5 → r=2; a zieht 3 ab (-1 <0) → a (das schwere).
  expect(pickWeighted(["schwer", "leicht"], w => (w === "schwer" ? 3 : 1), () => 0.5)).toBe("schwer");
});

test("pickWeighted: Gewicht 0 wird nie gewählt (übersprungen)", () => {
  // Gewichte [0,2], total 2. rand()=0 → r=0; a zieht 0 ab (0, nicht <0), b zieht 2 ab (-2 <0) → b.
  expect(pickWeighted(["null", "echt"], w => (w === "null" ? 0 : 2), () => 0)).toBe("echt");
});

test("pickWeighted: rand am oberen Rand fällt auf das letzte Element zurück", () => {
  // rand()=1 → r=total; keine Teilsumme wird <0 → Fallback auf pool[last].
  expect(pickWeighted(["a", "b", "c"], () => 1, () => 1)).toBe("c");
});

test("pickWeighted: Verteilung folgt den Gewichten (statistisch)", () => {
  // Deterministischer, gleichverteilter rand-Strom über [0,1); Gewichte 1:3 sollten grob
  // ein 1:3-Verhältnis ergeben. Kein PRNG (Math.random ist im Test verpönt): fester Zyklus.
  const seq = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 0.3, 0.7, 0.1, 0.9];
  let i = 0;
  const rand = () => seq[i++ % seq.length];
  const counts: Record<string, number> = { a: 0, b: 0 };
  for (let n = 0; n < 1000; n++) {
    const pick = pickWeighted(["a", "b"], w => (w === "a" ? 1 : 3), rand)!;
    counts[pick]++;
  }
  // b (Gewicht 3) muss klar häufiger als a (Gewicht 1) sein.
  expect(counts.b).toBeGreaterThan(counts.a);
});
