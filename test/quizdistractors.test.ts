/* Distraktor-Wächter für Quiz-Karten (#598).
 *
 * Fährt die reine Prüflogik aus src/content/quizdistractors.ts gegen den echten
 * Content (KQContent.CRAB_QUIZ): keine Karte darf zwei praktisch gleiche Optionen
 * haben (dann wären zwei „richtig" bzw. sie ist mehrdeutig), und jede Karte braucht
 * genug echte Distraktoren. Schwester zu quizcheck.test.ts (#597, welche Antwort ist
 * richtig?) – hier: sind die übrigen Optionen wirklich verschieden davon?
 */
import { test, expect } from "vitest";
import { KQContent } from "../src/content";
import {
  MIN_QUIZ_OPTIONS,
  duplicateOptionViolations,
  tooFewOptionsViolations,
} from "../src/content/quizdistractors";

test("Quiz-Distraktoren: alle Optionen je Karte sind paarweise verschieden (#598)", () => {
  const v = duplicateOptionViolations(KQContent.CRAB_QUIZ);
  expect(
    v,
    "Dublette-Optionen (mehrdeutige Karte / ein Distraktor dupliziert die richtige Antwort):\n" +
      v.join("\n"),
  ).toEqual([]);
});

test("Quiz-Distraktoren: jede Karte hat genug Distraktoren (#598)", () => {
  const v = tooFewOptionsViolations(KQContent.CRAB_QUIZ);
  expect(v, "Karten unter der Mindest-Optionszahl:\n" + v.join("\n")).toEqual([]);
});

/* ---- Red-Green: die reine Prüflogik muss Verstöße WIRKLICH fangen ---- */

test("Red-Green: zwei identische Optionen werden gefangen", () => {
  const card = { id: "a", options: ["gleich", "anders", "gleich"], correct: 1 };
  const v = duplicateOptionViolations([card]);
  expect(v).toHaveLength(1);
  expect(v[0]).toContain("dupliziert");
});

test("Red-Green: ein Distraktor, der die richtige Antwort dupliziert, wird als solcher markiert", () => {
  // Option 0 ist richtig; Option 2 ist ihre Dublette -> zwei richtige Optionen.
  const card = { id: "b", options: ["die Wahrheit", "falsch", "die Wahrheit"], correct: 0 };
  const v = duplicateOptionViolations([card]);
  expect(v).toHaveLength(1);
  expect(v[0]).toContain("als richtig markierte Antwort");
});

test("Red-Green: nur in Groß-/Kleinschreibung, Interpunktion oder Markup abweichende Optionen sind Dubletten", () => {
  const card = {
    id: "c",
    options: ["Ein <b>Pod</b>.", "ein pod", "etwas ganz anderes"],
    correct: 0,
  };
  const v = duplicateOptionViolations([card]);
  expect(v).toHaveLength(1);
  expect(v[0]).toContain("dupliziert");
});

test("Red-Green: eine Karte mit zu wenigen Optionen wird gemeldet", () => {
  const card = { id: "d", options: ["richtig", "falsch"], correct: 0 }; // nur 2 < MIN
  expect(MIN_QUIZ_OPTIONS).toBeGreaterThan(2);
  const v = tooFewOptionsViolations([card]);
  expect(v).toHaveLength(1);
  expect(v[0]).toContain("Optionen");
});

test("Red-Green: eine saubere Karte ist KEIN Verstoß", () => {
  const card = {
    id: "e",
    options: ["die richtige Antwort", "ein Distraktor", "noch ein Distraktor"],
    correct: 0,
  };
  expect(duplicateOptionViolations([card])).toEqual([]);
  expect(tooFewOptionsViolations([card])).toEqual([]);
});
