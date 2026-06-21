/* ===== Lernreihenfolge-Wächter (#235, Single Source seit #412) =====
 * Reine Prüflogik für den automatischen Schutz: Bei Kralle darf NIE eine Karte im
 * Wiederhol-/Quiz-Pool auftauchen, deren Konzept im Spiel noch nicht eingeführt wurde.
 *
 * Der Review-Pool wird pro abgeschlossener Quest freigeschaltet (game.ts →
 * registerQuestCards) aus ZWEI Quellen, die seit #412 beide als DATEN in den
 * Karten/Quests liegen (kein Hand-Map mehr):
 *   1. das `chapter` der Karte (CMD_CARDS/CRAB_QUIZ) – die Quest, nach der sie in den Pool kommt
 *   2. die Choice-`reviewId` im Quest-Ablauf – die Frage steht IM Quest-Schritt
 *
 * Beide sind per Konstruktion in-context: Der Drill/die Frage erscheint genau an
 * der Stelle, an der das Konzept gelehrt wurde. Bis #412 gab es daneben zwei
 * von Hand gepflegte Maps – EXTRA_CARDS (game.ts, „Karte ↔ Quest") und CONCEPT_INTRO
 * (hier, „Karte → Einführungs-Quest"). Sie führten dieselbe Information doppelt und
 * drifteten auseinander (eine Karte konnte über EXTRA_CARDS VOR ihrer Lektion landen,
 * konkret gefunden: `q-ch2-4` Self-Healing hing an k8s-first-deployment statt k8s-self-healing).
 * Seit #412 ist die Zuordnung EINE Datenquelle:
 *   - **Freischaltung** = `chapter` der Karte.
 *   - **Einführungs-Quest** = `introducedIn` der Karte, sonst `chapter` (Default).
 *     `introducedIn` setzt man NUR, wenn das Konzept FRÜHER eingeführt wird, als die
 *     Karte freigeschaltet wird (z.B. zeitlich gestreckte Wiederholung bei Stardew-Scope).
 *
 * Der Test (test/learnorder.test.ts) fährt die ECHTE registerQuestCards-Logik in
 * Spielreihenfolge ab (Freischalt-Positionen) und vergleicht sie mit den
 * Einführungs-Positionen, die `introOrderFromContent` aus dieser Single Source ableitet.
 */

/** Karte → früheste Quest-Position, an der ihr Konzept eingeführt wird – abgeleitet
 *  aus der Single Source der Daten (#412):
 *   - CMD-/Quiz-Karten: `introducedIn ?? chapter`
 *   - Choice-`reviewId`: die Quest, in deren Ablauf die Frage gestellt wird
 *  Position = Index in `quests` (= Spielreihenfolge, NICHT die Ticket-Nummer). Pro
 *  Karte zählt die FRÜHESTE Einführung über alle Quellen. Reine Funktion (kein
 *  Spielzustand, Phaser-frei) – die Aufrufer (Test, ggf. Validierung) reichen den
 *  echten Content herein. */
export function introOrderFromContent(
  quests: { id: string; steps: { type: string; reviewId?: string }[] }[],
  cmdCards: { id: string; chapter: string; introducedIn?: string }[],
  quizCards: { id: string; chapter?: string; introducedIn?: string }[],
): Record<string, number> {
  const pos: Record<string, number> = {};
  quests.forEach((q, i) => { pos[q.id] = i; });
  const intro: Record<string, number> = {};
  const consider = (card: string, questId: string | undefined) => {
    if (questId === undefined || pos[questId] === undefined) return;
    if (intro[card] === undefined || pos[questId] < intro[card]) intro[card] = pos[questId];
  };
  for (const c of cmdCards) consider(c.id, c.introducedIn ?? c.chapter);
  for (const c of quizCards) consider(c.id, c.introducedIn ?? c.chapter);
  for (const q of quests) {
    for (const step of q.steps) {
      if (step.type === "choice" && step.reviewId) consider(step.reviewId, q.id);
    }
  }
  return intro;
}

/** Reine Prüflogik (testbar, ohne Spielzustand): Vergleicht je Karte die
 *  Freischalt-Position mit der Einführungs-Position (beides Indizes in
 *  Spielreihenfolge). Gibt eine Liste lesbarer Verstöße zurück – leer = alles gut.
 *
 *  - `unlockOrder`: Karte → früheste Quest-Position, an der sie in den Pool kommt.
 *  - `introOrder`:  Karte → Quest-Position, an der ihr Konzept eingeführt wird.
 *  Eine Karte ohne bekannte Einführungs-Position ist ebenfalls ein Verstoß
 *  (sonst könnte eine neue Karte ungeprüft durchrutschen). */
export function lernpfadVerstoesse(
  unlockOrder: Record<string, number>,
  introOrder: Record<string, number>,
): string[] {
  const out: string[] = [];
  for (const [card, unlock] of Object.entries(unlockOrder)) {
    const intro = introOrder[card];
    if (intro === undefined) {
      out.push(`${card}: keine Einführungs-Quest bekannt (chapter/introducedIn fehlt?)`);
    } else if (unlock < intro) {
      out.push(`${card}: freigeschaltet an Position ${unlock}, Konzept aber erst an Position ${intro} eingeführt`);
    }
  }
  return out;
}
