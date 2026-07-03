/* ===== Lerninhalt-Korrektheits-Wächter für Quiz-Karten (#597) =====
 * Reine Prüflogik für den Schutz gegen eine STILL vertauschte/verschobene korrekte
 * Quiz-Antwort. Hintergrund (iSAQB-Runde 3): alle bisherigen Quiz-Tests prüfen nur
 * Index-Bereich, nicht-leere `explain` und Keyword-Vorkommen – NIE, dass der als
 * `correct` markierte Index auf die fachlich richtige Option zeigt. Ein vertauschtes
 * `correct` (0→1) oder ein Options-Umsortieren ohne `correct`-Nachzug lehrt still
 * falsches K8s und bliebe grün.
 *
 * Zwei komplementäre Netze (beide vom Test-Wächter test/quizcheck.test.ts gefahren –
 * kein src-Laufzeit-Import, analog learnorder.ts):
 *
 *  1. KONVENTION `correct === 0` (`indexConventionViolations`). Die richtige Antwort
 *     wird per Konvention an **Index 0 verfasst**; die Anzeige mischt die Optionen erst
 *     beim Rendern (`shuffled(...)` in ui/quiz.ts), die Autoren-Reihenfolge ist also
 *     spielerseitig irrelevant. Das erzwingt „die Wahrheit steht zuerst" maschinell und
 *     fängt ein versehentliches `correct: 1` sofort – wartungsfrei (keine Datei pflegen).
 *
 *  2. GOLDEN-SNAPSHOT der korrekten Antwort (`correctAnswers` + `snapshotViolations`).
 *     Ein committetes `id → normalisierter Text von options[correct]`-Abbild, das nur mit
 *     **bewusstem Review** geändert werden darf (Ratchet, gleiche Idee wie
 *     eslint-suppressions.json / der Coverage-Floor). JEDE Drift der korrekten Antwort
 *     wird rot: Index-Tausch, Options-Umsortierung (die die richtige Antwort von Index 0
 *     wegschiebt, obwohl `correct` 0 bleibt), Umformulierung ODER eine neue, noch nicht
 *     reviewte Karte. Zum Aktualisieren: `npm run quiz:golden` (schreibt das Golden-File
 *     aus dem Live-Content neu) – der Diff zeigt exakt, welche korrekte Antwort sich
 *     geändert hat, und zwingt so zum erneuten „lehrt das fachlich das Richtige?"-Blick.
 *
 * BEWUSST NICHT umgesetzt: eine fuzzy „explain begründet die correct-Option"-Heuristik
 * (Token-Overlap explain↔Optionen). Empirisch gegen alle Karten getestet lag die
 * Falsch-Positiv-Rate bei ~13–20 % – Erklärungen paraphrasieren die richtige Antwort und
 * widerlegen bewusst die Distraktoren („Tempo ist NICHT der Punkt"), sodass Overlap-Maße
 * die correct-Option nicht zuverlässig heraushebt. Ein Gate mit dieser Fehlalarmquote
 * würde bei Stardew-Scope abgeschaltet (Anti-Pattern #395). Der Golden-Review (2) deckt
 * denselben Fehler robust ab: wer die korrekte Antwort ändert, liest beim Golden-Update
 * ohnehin `correct` + `explain` gemeinsam neu.
 */

/** Struktureller Mindest-Vertrag einer Quiz-Karte (entkoppelt von der vollen QuizCard,
 *  damit die Prüflogik mit Literalen testbar bleibt – wie in learnorder.ts). */
export interface QuizLike {
  id: string;
  options: string[];
  correct: number;
}

/** Normalisiert einen Antwort-/Options-Text zu einer stabilen Vergleichsform:
 *  HTML-Tags entfernt, `&lt;`/`&gt;`/`&amp;` entschärft, Whitespace kollabiert, getrimmt.
 *  Die Groß-/Kleinschreibung bleibt erhalten (das Golden-File soll für den Review lesbar
 *  sein). Rein, deterministisch. */
export function normalizeAnswer(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Baut das Abbild `id → normalisierter Text der als correct markierten Option`.
 *  Das ist die „was wird als richtig gelehrt?"-Momentaufnahme, die das Golden-File hält. */
export function correctAnswers(cards: readonly QuizLike[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of cards) {
    const opt = c.options[c.correct];
    if (opt === undefined) continue; // Index-Bereich prüft bereits der Loader/content.test
    out[c.id] = normalizeAnswer(opt);
  }
  return out;
}

/** Konventions-Verstöße: jede Karte MUSS ihre richtige Antwort an Index 0 verfassen
 *  (die Anzeige mischt beim Rendern). Gibt lesbare Verstöße zurück – leer = alles gut. */
export function indexConventionViolations(cards: readonly QuizLike[]): string[] {
  const out: string[] = [];
  for (const c of cards) {
    if (c.correct !== 0) {
      out.push(`${c.id}: correct=${c.correct}, erwartet 0 (richtige Antwort wird an Index 0 verfasst, das Rendern mischt)`);
    }
  }
  return out;
}

/** Vergleicht das aktuelle Abbild der korrekten Antworten mit dem committeten Golden-File
 *  und meldet jede Drift als lesbaren Verstoß – leer = alles gut. Erfasst drei Fälle:
 *   - NEUE Karte (im Content, nicht im Golden): korrekte Antwort noch nicht reviewt.
 *   - GEÄNDERTE korrekte Antwort (Text differiert): Index-Tausch/Umsortierung/Umformulierung.
 *   - ENTFERNTE Karte (im Golden, nicht mehr im Content): veralteter Golden-Eintrag.
 *  Behebung immer: bewusst reviewen, dann `npm run quiz:golden`. */
export function snapshotViolations(
  current: Record<string, string>,
  golden: Record<string, string>,
): string[] {
  const out: string[] = [];
  for (const id of Object.keys(current).sort()) {
    if (!(id in golden)) {
      out.push(`${id}: neue Karte – korrekte Antwort noch nicht im Golden-File reviewt: "${current[id]}"`);
    } else if (current[id] !== golden[id]) {
      out.push(
        `${id}: korrekte Antwort hat sich geändert\n` +
        `      Golden: "${golden[id]}"\n` +
        `      Jetzt:  "${current[id]}"`,
      );
    }
  }
  for (const id of Object.keys(golden).sort()) {
    if (!(id in current)) {
      out.push(`${id}: Karte entfernt/umbenannt – veralteter Golden-Eintrag`);
    }
  }
  return out;
}
