import { Game } from "../game";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { part, $, masteryBadge } from "./shared";
import {
  startState,
  applyDriftEvent,
  resolveChoice,
  isSynced,
  type DriftEvent,
  type DriftHealRound,
  type DriftHealState,
} from "../content/driftheal";

/** Zeigt Ist/Soll + Loop-Status als kleines Board (Vorbild #567 Kapazitätsbalken). */
function boardHtml(round: DriftHealRound, state: DriftHealState): string {
  const synced = isSynced(state, round);
  return `<div class="driftheal-board">
    <div class="driftheal-state ${synced ? "good" : "bad"}">
      <div class="driftheal-label">Ist</div><div class="driftheal-value">${state.current}</div>
    </div>
    <div class="driftheal-arrow">→</div>
    <div class="driftheal-state">
      <div class="driftheal-label">Soll</div><div class="driftheal-value">${round.desired}</div>
    </div>
    <div class="driftheal-loop ${state.enforced ? "on" : "off"}">${state.enforced ? "🔁 Reconcile-Loop AKTIV" : "⏸ Reconcile-Loop AUS"}</div>
  </div>`;
}

export const drifthealUI = part({
  /* ========== Wunschzustand-Minispiel „Self-Heal / Drift" (#570) ========== */
  openDriftHealGame() {
    this.closeOverlays();
    $("overlay-driftheal").classList.remove("hidden");
    this.driftheal = { round: 0, score: 0, state: { current: 0, enforced: false }, eventIdx: 0 };
    if (Game.state.stats.drifthealIntroSeen) this.renderDriftHealRound();
    else this.renderDriftHealIntro();
    this.focusFirstIn($("overlay-driftheal")); // #506: Fokus ins Modal
  },

  /** Kurze Einführung (Vorbild #216 beim Stapel-Spiel): erklärt Soll/Ist/Reconcile-Loop,
   *  bevor die erste Runde startet. Danach jederzeit über den „ℹ️ Erklärung"-Knopf
   *  wieder aufrufbar. */
  renderDriftHealIntro() {
    Game.state.stats.drifthealIntroSeen = 1;
    Game.save();
    $("driftheal-body").innerHTML = `<div class="stack-intro">
      <div style="font-size:2.4em;text-align:center">🔁</div>
      <h2 style="text-align:center">Soll deklarieren, nicht Pods zählen</h2>
      <p>Du stellst einen <b>Wunschzustand</b> (Soll) ein – z.B. „3 Fässer laufen". Fällt eins aus (<b>Drift</b>), zählst du NICHT nach und legst von Hand eins nach. Du lässt den <b>Reconcile-Loop</b> den Soll-Zustand durchsetzen.</p>
      <p>Reagierst du stattdessen nur imperativ von Hand, sieht es kurz gelöst aus – aber die Ursache bleibt, und der nächste Drift trifft dich genauso hart.</p>
      <p class="dim">Wähle bei jedem Drift die deklarative Reaktion – der Loop bleibt dann AN und heilt jeden weiteren Drift von selbst.</p>
      <button class="primary" id="driftheal-start">Verstanden – Soll durchsetzen!</button></div>`;
    $("driftheal-start").onclick = () => this.renderDriftHealRound();
  },

  renderDriftHealRound() {
    const st = this.driftheal;
    const rounds = KQContent.DRIFT_HEAL_ROUNDS;
    if (st.round >= rounds.length) {
      const coins = 5 * st.score;
      if (st.score > (Game.state.stats.drifthealBest || 0)) Game.state.stats.drifthealBest = st.score;
      Game.save();
      this.reward(15, coins, "🎮 Wunschzustand-Minispiel beendet!");
      $("driftheal-body").innerHTML = `<div style="text-align:center">
        <div style="font-size:3em">🔁</div>
        <h2>${st.score} Mal richtig deklariert!</h2>
        <p class="dim">Merke: ein <b>Soll-Zustand</b> ist deklarativ – der Reconcile-Loop hält ihn von selbst, auch gegen wiederholten Drift. Hand-Reparaturen sind nur ein kurzes Zucken.</p>
        <button class="primary" data-action="closeOverlays">Zurück zum Archipel</button></div>`;
      this.driftheal = null;
      const mgStep = Game.currentStep();
      if (mgStep && mgStep.type === "minigame" && mgStep.game === "driftheal") this.afterStep();
      return;
    }
    const round = rounds[st.round];
    st.state = startState(round);
    st.eventIdx = 0;
    st.roundClean = true;
    const badge = masteryBadge(Game.masteryBox("driftheal:" + round.name));
    $("driftheal-body").innerHTML = `<p><b>Runde ${st.round + 1}/${rounds.length}: ${round.name}</b> ${badge} –
      Argo hat den Soll-Zustand deklariert. Beobachte, was bei Drift passiert – und entscheide richtig.
      <button id="driftheal-info" title="Erklärung nochmal ansehen" style="float:right;font-size:.85em">ℹ️ Erklärung</button></p>
      <div id="driftheal-board"></div>
      <div class="driftheal-feedback" id="driftheal-feedback"></div>`;
    $("driftheal-info").onclick = () => this.renderDriftHealIntro();
    this.renderDriftHealEvent();
  },

  /** Wendet das aktuelle Drift-Ereignis an. Läuft der Loop schon (aus einem vorherigen
   *  Ereignis dieser Runde), heilt es sich sofort selbst – sonst muss der Spieler
   *  reagieren (`renderDriftHealChoice`). */
  renderDriftHealEvent() {
    const st = this.driftheal;
    const round: DriftHealRound = KQContent.DRIFT_HEAL_ROUNDS[st.round];
    const event = round.driftEvents[st.eventIdx];
    st.state = applyDriftEvent(st.state, event, round);
    const fb = $("driftheal-feedback");
    fb.className = "driftheal-feedback";
    fb.innerHTML = "";
    if (isSynced(st.state, round)) {
      $("driftheal-board").innerHTML = boardHtml(round, st.state) +
        `<p class="driftheal-event">🔁 <b>${event.label}</b> – der Reconcile-Loop hat den Soll-Zustand sofort selbst gehalten.</p>
         <button class="primary" id="driftheal-continue">Weiter ▶</button>`;
      $("driftheal-continue").onclick = () => this.advanceDriftHealEvent();
      return;
    }
    this.renderDriftHealChoice(event, round);
  },

  renderDriftHealChoice(event: DriftEvent, round: DriftHealRound) {
    const st = this.driftheal;
    $("driftheal-board").innerHTML = boardHtml(round, st.state) +
      `<p class="driftheal-event">😱 <b>${event.label}</b></p>
       <div class="driftheal-choices">
         <button id="driftheal-imperative">${round.imperativeLabel}</button>
         <button class="primary" id="driftheal-declarative">${round.declarativeLabel}</button>
       </div>`;
    $("driftheal-imperative").onclick = () => this.pickDriftHealChoice("imperative");
    $("driftheal-declarative").onclick = () => this.pickDriftHealChoice("declarative");
  },

  /** Löst das aktuelle Ereignis auf. Deklarativ hält dauerhaft (Loop an, Runde geht
   *  weiter); imperativ hält NICHT gegen den erneuten Drift desselben Ereignisses –
   *  Feedback + Punktabzug, danach dieselbe Entscheidung nochmal (Vorbild #567/#568:
   *  falsche Antwort ist reversibel, kein Blockieren). */
  pickDriftHealChoice(choice: "imperative" | "declarative") {
    const st = this.driftheal;
    if (!st) return;
    const round: DriftHealRound = KQContent.DRIFT_HEAL_ROUNDS[st.round];
    const event = round.driftEvents[st.eventIdx];
    st.state = resolveChoice(st.state, event, round, choice);
    const fb = $("driftheal-feedback");
    if (choice === "declarative") {
      st.score++;
      SFX.success();
      fb.className = "driftheal-feedback good";
      fb.innerHTML = "✅ Soll-Zustand deklariert – der Reconcile-Loop hält ihn ab jetzt von selbst.";
      this.advanceDriftHealEvent();
    } else {
      st.score = Math.max(0, st.score - 1);
      st.roundClean = false;
      SFX.wrong();
      fb.className = "driftheal-feedback bad";
      fb.innerHTML = "❌ Nur das Symptom behoben – ohne Reconcile-Loop trifft derselbe Drift gleich wieder zu.";
      this.renderDriftHealChoice(event, round);
    }
  },

  advanceDriftHealEvent() {
    const st = this.driftheal;
    const round: DriftHealRound = KQContent.DRIFT_HEAL_ROUNDS[st.round];
    st.eventIdx++;
    if (st.eventIdx >= round.driftEvents.length) this.checkDriftHealRoundDone();
    else this.renderDriftHealEvent();
  },

  checkDriftHealRoundDone() {
    const st = this.driftheal;
    const round: DriftHealRound = KQContent.DRIFT_HEAL_ROUNDS[st.round];
    Game.recordPractice("driftheal:" + round.name, st.roundClean !== false);
    const last = st.round + 1 >= KQContent.DRIFT_HEAL_ROUNDS.length;
    const fb = $("driftheal-feedback");
    fb.className = "driftheal-feedback good";
    fb.innerHTML = `✅ <b>Runde geschafft!</b>
      <div class="stack-cachetip">🔁 ${round.tip}</div>
      <button class="primary" id="driftheal-next">${last ? "Spiel abschließen ▶" : "Nächste Runde ▶"}</button>`;
    $("driftheal-next").onclick = () => { st.round++; this.renderDriftHealRound(); };
  },
});
