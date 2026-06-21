/* Spaced Repetition (Leitner-System) der Spiel-Logik (#392, game.ts-Split).
 * Verwaltet die Wiederholungs-Karten (Box 1..5 + Fälligkeit), das sanfte Review-Gate
 * (#222/#323) und das freie, planungsneutrale Üben. Anwendungsschicht, Phaser-frei. */
import { KQContent } from "../content";
import { part, today } from "./shared";

const BOX_INTERVALS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

/** Spaced-Repetition-Methoden der Game-Fassade (Leitner-Plan, Review-Gate, freies Üben). */
export const spacedRepetitionBundle = part({
  /* ---------- Spaced Repetition (Leitner) ---------- */
  ensureReviewItem(itemId: string) {
    if (!this.state.review[itemId]) {
      this.state.review[itemId] = { box: 1, due: today() + 1 };
    }
  },

  // Schaltet beim Abschluss einer Quest ihre Wiederhol-Karten frei. Zwei Quellen –
  // beide als DATEN in den Karten/Quests (Single Source seit #412, die frühere
  // EXTRA_CARDS-Hand-Map ist entfallen): das `chapter` der Karte (CMD/Quiz) und die
  // Choice-`reviewId` im Quest-Ablauf. Beide sind per Konstruktion in-context –
  // der Lernreihenfolge-Wächter (content/learnorder.ts + test/learnorder.test.ts)
  // prüft das gegen die Daten.
  registerQuestCards(questId: string) {
    for (const c of KQContent.CMD_CARDS.filter(c => c.chapter === questId)) this.ensureReviewItem(c.id);
    for (const c of KQContent.CRAB_QUIZ.filter(c => c.chapter === questId)) this.ensureReviewItem(c.id);
    const quest = KQContent.QUESTS.find(q => q.id === questId);
    if (quest) {
      for (const step of quest.steps) {
        if (step.type === "choice" && step.reviewId) this.ensureReviewItem(step.reviewId);
      }
    }
    this.save();
  },

  reviewResult(itemId: string, correct: boolean) {
    this.ensureReviewItem(itemId);
    const item = this.state.review[itemId];
    if (correct) {
      item.box = Math.min(5, item.box + 1);
      item.due = today() + BOX_INTERVALS[item.box];
    } else {
      item.box = 1;
      item.due = today();
    }
    this.save();
  },

  choiceResult(itemId: string, correct: boolean) {
    if (itemId) {
      this.ensureReviewItem(itemId);
      if (!correct) {
        this.state.review[itemId].box = 1;
        this.state.review[itemId].due = today() + 1;
      }
    }
    if (correct) this.state.stats.quizRight++; else this.state.stats.quizWrong++;
    this.save();
  },

  dueReviewItems(limit?: number) {
    const t = today();
    const due: { id: string; box: number }[] = [];
    for (const [id, info] of Object.entries(this.state.review)) {
      if (info.due <= t) due.push({ id, box: info.box });
    }
    due.sort((a, b) => a.box - b.box);
    return due.slice(0, limit || 10).map(d => d.id);
  },

  /** Sanftes Wiederholungs-Gate (#222/#323): true, wenn der Spieler am ANFANG einer
   *  Quest steht UND (a) mindestens eine Karte fällig ist ODER (b) seit dem letzten
   *  Gate-Feuern ≥ 3 Quests abgeschlossen wurden und es überhaupt Review-Items gibt.
   *  Variante (b) ist ein Quest-Count-Nudge (#323): bei verketteten Quests (z.B. docker-run-options→docker-build-image)
   *  kommt auch ohne Fälligkeiten ein Kralle-Beat. */
  shouldReviewGate(): boolean {
    if (this.state.questStep !== 0) return false;
    if (!this.currentQuest()) return false;
    if (this.dueReviewItems().length > 0) return true;
    return this.state.questsSinceGate >= 3 && Object.keys(this.state.review).length > 0;
  },

  /** Fürs FREIE Üben: alle gelernten Karten, unabhängig von der Fälligkeit, in
   *  zufälliger Reihenfolge. Rein lesend – verändert den Spaced-Repetition-Plan
   *  NICHT (anders als reviewResult). So kann man so oft üben, wie man will. */
  freeReviewItems(limit?: number) {
    const ids = Object.keys(this.state.review);
    for (let i = ids.length - 1; i > 0; i--) {       // Fisher-Yates-Shuffle
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, limit || 10);
  },

  findReviewContent(itemId: string) {
    const card = KQContent.CMD_CARDS.find(c => c.id === itemId);
    if (card) return { kind: "cmd", card };
    const q = KQContent.CRAB_QUIZ.find(q => q.id === itemId);
    if (q) return { kind: "quiz", q };
    return null;
  },
});
