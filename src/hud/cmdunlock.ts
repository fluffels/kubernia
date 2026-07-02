/* ===== KubeQuest – Freigeschaltete Befehlsfamilien fürs gefilterte help (#358) =====
 * Pure, Phaser-/DOM-freie Logik: Welche Befehls*familien* (docker, kubectl, git …)
 * hat der Spieler bei seinem aktuellen Fortschritt schon kennengelernt? Das gefilterte
 * help (im Simulator) listet nur diese – zu Spielbeginn praktisch nur `help` selbst,
 * damit die progressive Aufdeckungsmechanik nicht durch eine Komplettliste vorweg-
 * genommen wird (Wow-Effekt des Freischaltens, Akzeptanz #358).
 *
 * Abgeleitet OHNE neues Save-Feld (Stardew-Scope, keine Migration für ein reines
 * Anzeige-Feature) – analog zum Sammelalbum (#278): der vorhandene Quest-Fortschritt
 * (`questIdx`/`questStep`) genügt. Eine Familie gilt als freigeschaltet, sobald der
 * Spieler einen Schritt ERREICHT hat, dessen Musterlösung sie nutzt – also jeder
 * Schritt einer früheren Quest plus die Schritte der aktuellen Quest bis einschließlich
 * des laufenden. So taucht ein Befehl genau dann in help auf, wenn er gerade gelehrt
 * wird (sein Teach-Intro steht ohnehin auf dem Schirm), nie früher.
 */
import type { Quest, QuestStep } from "../types";

/** Die Meta-Befehle, die von Anfang an offenstehen (kein Lernpfad nötig). */
export const ALWAYS_AVAILABLE_COMMANDS: readonly string[] = ["help", "clear"];

/** Erstes Token einer Musterlösung = ihre Befehlsfamilie, z.B.
 *  „kubectl apply --filename x" → „kubectl", „aws s3 mb …" → „aws". */
function familyOf(solution: string): string | null {
  const t = solution.trim().split(/\s+/)[0];
  return t || null;
}

/** Befehlsfamilien, die ein Schritt über seine Musterlösung(en) einführt/nutzt.
 *  Nur teach (genau ein Befehl) und terminal (mehrere Aufgaben) tragen Lösungen;
 *  drill übt bereits Gelehrtes (führt nichts Neues ein), dialog/choice/minigame
 *  haben keine Lösung. */
function stepFamilies(step: QuestStep): string[] {
  if (step.type === "teach") {
    const f = familyOf(step.cmd.solution);
    return f ? [f] : [];
  }
  if (step.type === "terminal") {
    return step.tasks.map(t => familyOf(t.solution)).filter((f): f is string => f !== null);
  }
  return [];
}

/** Fortschritts-Eckdaten, aus denen sich die Freischaltung ableitet (Teilmenge des
 *  GameState – bewusst nur das Nötige, damit die Funktion pur & leicht testbar bleibt). */
export interface CommandProgress {
  /** Index der aktuellen Quest in der quest-order (`GameState.questIdx`). */
  questIdx: number;
  /** Index des aktuellen Schritts in der aktuellen Quest (`GameState.questStep`). */
  questStep: number;
}

/**
 * Welche Befehlsfamilien hat der Spieler bei `p` schon kennengelernt? Immer dabei:
 * die Meta-Befehle `help`/`clear`. Dazu alle Familien aus erreichten Schritten:
 * jeder Schritt einer Quest VOR der aktuellen, plus die Schritte der aktuellen Quest
 * bis einschließlich `questStep`.
 */
export function unlockedCommandFamilies(quests: Quest[], p: CommandProgress): Set<string> {
  const out = new Set<string>(ALWAYS_AVAILABLE_COMMANDS);
  quests.forEach((q, qi) => {
    if (qi > p.questIdx) return;            // künftige Quest: noch nicht erreicht
    q.steps.forEach((step, si) => {
      if (qi === p.questIdx && si > p.questStep) return;  // aktuelle Quest: nur bis zum laufenden Schritt
      for (const f of stepFamilies(step)) out.add(f);
    });
  });
  return out;
}
