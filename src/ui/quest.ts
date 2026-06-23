import { Game } from "../game";
import { worldScene } from "../runtime";
import { part } from "./shared";

export const questUI = part({
  /* ========== Quest-Maschine ========== */
  runQuestStep() {
    const step = Game.currentStep();
    if (!step) return;
    // Szenario eines Dialog-/Choice-Schritts beim Betreten einmischen. Funk-Schritte
    // bekommen ihr Szenario in afterStep/finishFunkStep; Dialog-/Choice-Schritte liefen
    // bisher durch keinen Merge-Pfad, sodass z.B. das Dockerfile aus docker-build-image live fehlte und
    // erst nach einem Reload (game.ts re-merged erreichte Szenarien) auftauchte (#214).
    if (step.scenario) { Game.sim.mergeScenario(step.scenario); Game.save(); }
    if (step.type === "dialog") {
      this.showDialogue(step.npc, step.lines, () => this.afterStep());
    } else if (step.type === "choice") {
      this.showChoice(step, () => this.afterStep());
    }
  },

  afterStep() {
    const result = Game.advanceStep() || {};
    this._drillTask = null;
    if (result.questDone) {
      const q = result.questDone;
      Game.registerQuestCards(q.id);
      this.reward(q.rewardXp, q.rewardCoins, "🏁 Quest „" + q.title + "“ abgeschlossen!");
      worldScene()?.burstAtPlayer("sparkle");
      return;
    }
    const next = Game.currentStep();
    if (!next) return;
    if (Game.isFunkStep(next)) {
      if (next.scenario) { Game.sim.mergeScenario(next.scenario); Game.save(); }
      this.refreshHud();
    } else {
      this.refreshHud();
      if (!this.dialogue) this.runQuestStep();
    }
  },

  /* ========== Begrüßung / Intro (#288) ========== */
  /** Einmalige Begrüßung beim allerersten Spielstart: Wer bin ich, wie steuere
   *  ich, was ist mein erstes Ziel (zu Ole). Läuft über den normalen Dialog
   *  (Ole als Sprecher) – das setzt zugleich den "!"-Quest-Marker über Ole in
   *  Szene. Gezeigt wird das genau einmal; main.ts merkt sich das per
   *  Game.state.introSeen. */
  showIntro() {
    this.showDialogue("ole", [
      "⚓ Ahoi und herzlich willkommen in <b>Port Kubernia</b>! Ich bin Ole, der Hafenmeister – schön, dass du anheuerst.",
      "Hier wird dein Hafen Stück für Stück zu einem echten Cluster: Du lernst Docker, Kubernetes &amp; Co., indem du den Betrieb am Laufen hältst. Aber der Reihe nach – kurz zur Steuerung:",
      "🕹️ <b>Laufen:</b> Pfeiltasten oder <b>WASD</b>. <b>Reden &amp; bestätigen:</b> <b>E</b> (oder Enter/Leertaste), sobald jemand in der Nähe ist.",
      "💻 <b>T</b> öffnet dein Terminal (deine Kommandozeile), 📜 <b>J</b> das Logbuch mit deiner aktuellen Aufgabe, <b>Esc</b> das Menü.",
      "Du stehst ja schon vor meiner <b>Hafenmeisterei</b> – wunderbar! Sprich mich einfach an (drück <b>E</b>), dann gebe ich dir deinen ersten Auftrag. Auf geht's! ⚓",
    ]);
  },

});
