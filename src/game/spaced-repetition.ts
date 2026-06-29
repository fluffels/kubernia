/* Spaced Repetition (Leitner-System) der Spiel-Logik (#392, game.ts-Split).
 * Verwaltet die Wiederholungs-Karten (Box 1..5 + Fälligkeit), das sanfte Review-Gate
 * (#222/#323) und das freie, planungsneutrale Üben. Anwendungsschicht, Phaser-frei. */
import { KQContent } from "../content";
import { krallePracticeMilestone, kralleClawAside } from "../kralle";
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

  /** #236/#237: Zählt eine abgeschlossene Übungsrunde mit Kralle (täglich, Gate oder frei)
   *  und gibt zwei sich ausschließende, optionale Sprüche zurück: an Meilensteinen den
   *  zählbewussten `milestone`-Spruch (#236), sonst gelegentlich den „hätte-gern-Krallen“-
   *  Running-Gag-`aside` (#237). Den Gesamtzähler persistiert es; die Anzeige übernimmt die
   *  Präsentation (ui/quiz.ts). */
  recordKrallePractice(): { milestone: string | null; aside: string | null } {
    const count = ++this.state.stats.krallePractice;
    this.save();
    return { milestone: krallePracticeMilestone(count), aside: kralleClawAside(count) };
  },

  findReviewContent(itemId: string) {
    const card = KQContent.CMD_CARDS.find(c => c.id === itemId);
    if (card) return { kind: "cmd", card };
    const q = KQContent.CRAB_QUIZ.find(q => q.id === itemId);
    if (q) return { kind: "quiz", q };
    return null;
  },

  /* ---------- Praktischer Übungs-Lernstand (#219) ----------
   * Spaced Repetition AUSGEWEITET auf das Stapel-Spiel und die Drills: pro praktischem
   * Konzept (Drill-ID, Stapel-Runde `stack:<name>`) ein Leitner-Stand in `state.mastery`.
   * Eigene Map getrennt von `review` (Quiz/Karten), damit Drills/Runden nicht in die
   * Kralle-Quiz-Auswahl bzw. das Review-Gate sickern. Rein anwendungsseitig & Phaser-frei. */

  /** Leitner-Box eines Übungs-Konzepts; 0 = noch nie geübt (= „neu", schwächster Stand). */
  masteryBox(itemId: string): number {
    return this.state.mastery[itemId]?.box ?? 0;
  },

  /** Lernstand eines geübten Konzepts fortschreiben (#219): richtig → Box hoch (max 5),
   *  falsch/gestolpert → zurück auf 1. Spiegelt `reviewResult`, aber auf `state.mastery`. */
  recordPractice(itemId: string, correct: boolean) {
    const box = this.state.mastery[itemId]?.box ?? 0;
    const next = correct ? Math.min(5, box + 1) : 1;
    this.state.mastery[itemId] = { box: next, due: today() + (BOX_INTERVALS[next] ?? 1) };
    this.save();
  },

  /** Gewicht eines Konzepts für die Übungs-Auswahl: schwach (niedrige Box / nie geübt)
   *  = hoch, sicher (Box 5) = niedrig. `6 - box` → nie geübt (0) zählt 6×, gemeistert (5)
   *  noch 1× (sicher Gekonntes kommt also „ab und zu" dran, nicht nie). */
  masteryWeight(itemId: string): number {
    return 6 - Math.min(5, this.masteryBox(itemId));
  },

  /** Gewichtete Zufallsauswahl EINER Übung aus `pool`: schwache Konzepte häufiger,
   *  sichere seltener (Gewicht = masteryWeight). `rand` ist injizierbar (deterministische
   *  Tests). Leerer Pool → "". */
  pickWeightedPractice(pool: string[], rand: () => number = Math.random): string {
    if (pool.length === 0) return "";
    const weights = pool.map(id => this.masteryWeight(id));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rand() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r < 0) return pool[i];
    }
    return pool[pool.length - 1];
  },

  /** Zieht `count` Übungen gewichtet (schwache häufiger). Sind genug verschiedene da,
   *  werden Wiederholungen vermieden (jede gezogene fällt aus dem Topf); ist der Pool
   *  kleiner als `count`, sind Wiederholungen erlaubt (sonst ginge die Runde nicht voll).
   *  `rand` injizierbar für Tests. */
  pickWeightedDrills(pool: string[], count: number, rand: () => number = Math.random): string[] {
    if (pool.length === 0) return [];
    const out: string[] = [];
    let remaining = pool.slice();
    for (let i = 0; i < count; i++) {
      if (remaining.length === 0) remaining = pool.slice(); // Pool kleiner als count → wieder auffüllen
      const pick = this.pickWeightedPractice(remaining, rand);
      out.push(pick);
      remaining = remaining.filter(id => id !== pick);
    }
    return out;
  },
});
