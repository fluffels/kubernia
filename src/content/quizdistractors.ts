/* ===== Distraktor-Wächter für Quiz-Karten (#598) =====
 * Reine Prüflogik gegen eine Quiz-Karte mit MEHR als einer plausiblen Lösung.
 * Schwester des Korrektheits-Wächters quizcheck.ts (#597): der prüft, dass der
 * als `correct` markierte Index auf die fachlich richtige Option zeigt – dieser
 * hier prüft, dass die ÜBRIGEN Optionen wirklich davon verschieden sind, damit
 * „genau eine plausible Lösung je Karte" strukturell gilt.
 *
 * Hintergrund (iSAQB-Runde 3): content.test.ts prüft „genau eine richtige Antwort"
 * nur für Quest-`choice`-Schritte, NICHT fürs Krabben-Quiz. Eine Karte, bei der ein
 * Distraktor die richtige Antwort dupliziert (dann sind zwei Optionen richtig) oder
 * bei der zwei Optionen nur in Markup/Groß-Klein/Interpunktion abweichen (mehrdeutig),
 * rutschte bisher grün durch.
 *
 * Zwei komplementäre, rein STRUKTURELLE Netze (beide vom Test-Wächter
 * test/quizdistractors.test.ts gefahren – kein src-Laufzeit-Import, analog
 * learnorder.ts / quizcheck.ts):
 *
 *  1. PAARWEISE VERSCHIEDEN (`duplicateOptionViolations`). Innerhalb einer Karte
 *     muss jede Option von jeder anderen verschieden sein – verglichen in einer
 *     kanonischen Form (Markup/Entities/Whitespace via quizcheck.normalizeAnswer,
 *     dann klein + nur Buchstaben/Ziffern). Fängt: einen Distraktor, der die richtige
 *     Antwort dupliziert („keine Dubletten der correct-Option" → dann gäbe es zwei
 *     richtige), zwei kopierte Distraktoren, und Optionen, die sich nur in Groß-/
 *     Kleinschreibung, Interpunktion oder Markup unterscheiden (spielerseitig nicht
 *     unterscheidbar → mehrdeutig).
 *
 *  2. MINDESTSTRUKTUR (`tooFewOptionsViolations`). Eine Karte braucht genug echte
 *     Distraktoren, sonst wird sie zum Münzwurf. Der Loader erzwingt nur ≥2 Optionen
 *     (= 1 Distraktor); dieser Wächter hebt den Boden auf `MIN_QUIZ_OPTIONS` (eine
 *     richtige + mind. zwei Distraktoren, Rate-Basis ≤ 1/3). Der gesamte Bestand
 *     nutzt ohnehin vier Optionen.
 *
 * BEWUSST NICHT umgesetzt: eine semantische „ist dieser Distraktor plausibel/nicht
 * trivial?"-Heuristik. Das ist derselbe Fuzzy-Sumpf, den quizcheck.ts wegen ~13–20 %
 * Falsch-Positiv-Rate verworfen hat (ein Gate mit dieser Quote wird bei Stardew-Scope
 * abgeschaltet, Anti-Pattern #395). Auch ein „die richtige Antwort ist die längste
 * Option"-Check ist bewusst NICHT drin: empirisch trifft das auf 96 % des Bestands zu
 * – es ist ein pervasives Autoren-Muster, kein Defekt, und würde flächendeckend
 * fehlalarmieren. Die fachliche Distraktor-Qualität sichert der Krabbe-Kralle-Content
 * beim Autor + der Golden-Review von #597 ab; dieser Wächter deckt robust die
 * STRUKTURELLE Eindeutigkeit ab.
 */
import { normalizeAnswer } from "./quizcheck";

/** Struktureller Mindest-Vertrag einer Quiz-Karte (entkoppelt von der vollen QuizCard,
 *  damit die Prüflogik mit Literalen testbar bleibt – wie in quizcheck.ts). */
export interface QuizOptionsLike {
  id: string;
  options: string[];
  correct: number;
}

/** Boden für die Anzahl Optionen: eine richtige + mindestens zwei Distraktoren. */
export const MIN_QUIZ_OPTIONS = 3;

/** Kanonische Vergleichsform für „sind zwei Optionen praktisch dieselbe?":
 *  erst die gemeinsame Normalisierung (Tags/Entities/Whitespace, via quizcheck –
 *  EINE Quelle der Normalisierung), dann klein + nur Buchstaben/Ziffern. So gelten
 *  zwei Optionen, die sich nur in Groß-/Kleinschreibung, Interpunktion oder Markup
 *  unterscheiden, als Dublette. Rein, deterministisch. */
function canonicalOption(html: string): string {
  return normalizeAnswer(html)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Verstöße gegen „alle Optionen paarweise verschieden". Meldet jede Option, die
 *  eine kanonische Dublette einer früheren Option derselben Karte ist – mit Hinweis,
 *  falls eine der beiden die als richtig markierte Antwort ist (dann wären zwei
 *  Optionen richtig). Leer = alles gut. */
export function duplicateOptionViolations(cards: readonly QuizOptionsLike[]): string[] {
  const out: string[] = [];
  for (const c of cards) {
    const seen = new Map<string, number>();
    for (let i = 0; i < c.options.length; i++) {
      const key = canonicalOption(c.options[i]);
      const prev = seen.get(key);
      if (prev !== undefined) {
        const touchesCorrect = i === c.correct || prev === c.correct;
        const hint = touchesCorrect
          ? " – eine davon ist die als richtig markierte Antwort (zwei richtige Optionen!)"
          : "";
        out.push(
          `${c.id}: Option ${i} („${normalizeAnswer(c.options[i])}") dupliziert Option ${prev}${hint}`,
        );
      } else {
        seen.set(key, i);
      }
    }
  }
  return out;
}

/** Verstöße gegen die Mindeststruktur: eine Karte braucht ≥ `MIN_QUIZ_OPTIONS`
 *  Optionen (eine richtige + mind. zwei Distraktoren). Leer = alles gut. */
export function tooFewOptionsViolations(cards: readonly QuizOptionsLike[]): string[] {
  const out: string[] = [];
  for (const c of cards) {
    if (c.options.length < MIN_QUIZ_OPTIONS) {
      out.push(
        `${c.id}: nur ${c.options.length} Optionen – mindestens ${MIN_QUIZ_OPTIONS} nötig (eine richtige + ≥2 Distraktoren)`,
      );
    }
  }
  return out;
}
