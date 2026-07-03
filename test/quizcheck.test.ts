/* Lerninhalt-Korrektheits-Wächter für Quiz-Karten (#597).
 *
 * Fährt die reine Prüflogik aus src/content/quizcheck.ts gegen den echten Content
 * (KQContent.CRAB_QUIZ) und gegen das committete Golden-File der korrekten Antworten.
 * Zweck: eine STILL vertauschte/verschobene korrekte Antwort (die falsches K8s lehrt)
 * darf nicht mehr grün durchrutschen – siehe Modul-Kopf.
 *
 * Golden-File aktualisieren (nach bewusstem Review der geänderten Antwort):
 *   npm run quiz:golden
 * (setzt KQ_UPDATE_QUIZ_GOLDEN=1 und lässt genau diesen Test das File neu schreiben –
 *  aus demselben Content + derselben Normalisierung, gegen die er sonst prüft.)
 */
import { test, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { KQContent } from "../src/content";
import {
  correctAnswers,
  indexConventionViolations,
  normalizeAnswer,
  snapshotViolations,
} from "../src/content/quizcheck";

const GOLDEN_URL = new URL("./quiz-correct.golden.json", import.meta.url);

/** Golden-File lesen; fehlt es (allererster Lauf vor dem ersten `quiz:golden`), als
 *  leeres Abbild behandeln – dann meldet der Snapshot-Check jede Karte als „neu". */
function readGolden(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Stabil (Schlüssel sortiert) serialisieren – ruhiger Diff beim Review. */
function writeGolden(map: Record<string, string>): void {
  const sorted = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]));
  writeFileSync(GOLDEN_URL, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

beforeAll(() => {
  // Update-Modus: Golden-File aus dem Live-Content neu schreiben (bewusste Aktion via npm run quiz:golden).
  if (process.env.KQ_UPDATE_QUIZ_GOLDEN === "1") {
    writeGolden(correctAnswers(KQContent.CRAB_QUIZ));
  }
});

test("Quiz-Konvention: jede Karte verfasst die richtige Antwort an Index 0 (#597)", () => {
  const v = indexConventionViolations(KQContent.CRAB_QUIZ);
  expect(v, "correct-Index-Verstöße (Rendern mischt, darum ist Index 0 die Konvention):\n" + v.join("\n")).toEqual([]);
});

test("Quiz-Korrektheit: keine korrekte Antwort ist gegenüber dem Golden-File gedriftet (#597)", () => {
  const v = snapshotViolations(correctAnswers(KQContent.CRAB_QUIZ), readGolden());
  expect(
    v,
    "Die als korrekt markierte Quiz-Antwort hat sich geändert (Index-Tausch, Options-Umsortierung, " +
    "Umformulierung oder neue Karte). BEWUSST reviewen (lehrt sie das fachlich Richtige?), dann " +
    "`npm run quiz:golden`:\n" + v.join("\n"),
  ).toEqual([]);
});

/* ---- Red-Green: die reine Prüflogik muss Verstöße WIRKLICH fangen ---- */

test("Red-Green: vertauschter correct-Index wird als Konvention- UND Snapshot-Verstoß gefangen", () => {
  const card = { id: "x", options: ["richtig", "falsch"], correct: 0 };
  const swapped = { ...card, correct: 1 };
  // Konvention: correct !== 0 fällt auf.
  expect(indexConventionViolations([swapped]).length).toBe(1);
  // Snapshot: die als correct markierte Antwort ist jetzt eine andere → Drift gegen das Golden.
  const golden = correctAnswers([card]); // {x: "richtig"}
  const drift = snapshotViolations(correctAnswers([swapped]), golden); // jetzt "falsch"
  expect(drift.length).toBe(1);
  expect(drift[0]).toContain("geändert");
});

test("Red-Green: Options-Umsortierung ohne correct-Nachzug driftet gegen das Golden", () => {
  const orig = { id: "y", options: ["A wahr", "B falsch"], correct: 0 };
  const golden = correctAnswers([orig]); // {y: "A wahr"}
  // Optionen umsortiert, correct BLEIBT 0 – zeigt jetzt auf "B falsch" (Konvention grün, Inhalt falsch!):
  const reordered = { id: "y", options: ["B falsch", "A wahr"], correct: 0 };
  expect(indexConventionViolations([reordered])).toEqual([]); // Konvention allein merkt es NICHT
  const drift = snapshotViolations(correctAnswers([reordered]), golden);
  expect(drift.length).toBe(1); // ... der Golden-Snapshot schon
});

test("Red-Green: neue und entfernte Karten werden gemeldet", () => {
  expect(snapshotViolations({ neu: "text" }, {})).toHaveLength(1);
  expect(snapshotViolations({ neu: "text" }, {})[0]).toContain("neue Karte");
  expect(snapshotViolations({}, { weg: "alt" })).toHaveLength(1);
  expect(snapshotViolations({}, { weg: "alt" })[0]).toContain("entfernt");
});

test("Platzhalter-kodierungs-agnostisch: bare <token> und entity &lt;token&gt; normalisieren gleich (#476)", () => {
  // Der Kern der #476-Umstellung: ein Platzhalter von `&lt;ns&gt;` auf bare `<ns>`
  // umzustellen darf die korrekte Antwort NICHT driften lassen (sonst bräuchte jede
  // Häppchen-Konvertierung eine Golden-Regeneration und das Golden würde den Platzhalter
  // beim Tag-Strippen verlieren).
  const bare = "kubectl auth can-i delete pods --as=system:serviceaccount:<ns>:lager";
  const entity = "kubectl auth can-i delete pods --as=system:serviceaccount:&lt;ns&gt;:lager";
  expect(normalizeAnswer(bare)).toBe(normalizeAnswer(entity));
  // ... und der Platzhalter bleibt im Golden lesbar erhalten (nicht ersatzlos gestrippt).
  expect(normalizeAnswer(bare)).toContain("<ns>");
  // Gegenprobe (Red-Green): der wörtliche Terraform-Marker bleibt im Content entity-kodiert
  // (`&lt;sensitive&gt;`, kein Platzhalter) und normalisiert weiter zu <sensitive>; ein echtes
  // HTML-Tag wird nach wie vor gestrippt.
  expect(normalizeAnswer("Rohwert; sonst &lt;sensitive&gt;")).toBe("Rohwert; sonst <sensitive>");
  expect(normalizeAnswer("<code>terraform output</code> reicht")).toBe("terraform output reicht");
});

test("Red-Green: unveränderte Karte ist KEIN Verstoß", () => {
  const cards = [{ id: "z", options: ["die Wahrheit", "nicht"], correct: 0 }];
  expect(indexConventionViolations(cards)).toEqual([]);
  expect(snapshotViolations(correctAnswers(cards), correctAnswers(cards))).toEqual([]);
});
