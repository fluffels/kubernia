import { Game } from "../game";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { part, $, shuffled, masteryBadge } from "./shared";

export const minigameUI = part({
  /* ========== Stapel-Minispiel ========== */
  openStackGame() {
    this.closeOverlays();
    $("overlay-stack").classList.remove("hidden");
    this.stack = { round: 0, score: 0 };
    // Beim ALLERERSTEN Mal wird die Einführung erzwungen; danach geht's direkt
    // los, und die Erklärung bleibt über den „ℹ️ Erklärung“-Knopf jederzeit
    // wieder aufrufbar (#216).
    if (Game.state.stats.stackIntroSeen) this.renderStackRound();
    else this.renderStackIntro();
    this.focusFirstIn($("overlay-stack")); // #506: Fokus ins Modal
  },

  /** Kurze Einführung – kein Vorwissen annehmen (#216): erklärt
   *  Image/Schicht/Basis-Image/ubuntu/Cache in wenigen Sätzen. Wird beim ersten
   *  Spielen automatisch gezeigt und ist danach jederzeit wieder aufrufbar. */
  renderStackIntro() {
    Game.state.stats.stackIntroSeen = 1; // gesehen – ab jetzt nur noch auf Wunsch
    Game.save();
    $("stack-body").innerHTML = `<div class="stack-intro">
      <div style="font-size:2.4em;text-align:center">📦</div>
      <h2 style="text-align:center">Wie ein Image aufgebaut ist</h2>
      <p>Ein <b>Docker-Image</b> ist der Bauplan für einen Container – und es entsteht in <b>Schichten</b> (engl. „Layer“), eine auf der anderen, wie ein Stapel Kisten.</p>
      <p>Ganz unten liegt die <b>Basis-Schicht</b>: ein fertiges Image, auf dem du aufbaust – z.B. <code>ubuntu</code> (ein schlankes Linux-System) oder <code>nginx</code> (ein fertiger Webserver). Darüber kommt Schicht für Schicht dein eigenes Zeug: Software installieren, Dateien kopieren, Startbefehl.</p>
      <p><b>Warum die Reihenfolge zählt:</b> Was sich selten ändert (die Basis), gehört nach unten; dein Code (ändert sich oft) nach oben. So kann Docker die unteren Schichten wiederverwenden (den <b>Cache</b>) und nur neu bauen, was sich wirklich geändert hat – das macht das Bauen (<b>Build</b>) schnell.</p>
      <p class="dim">Gleich rührt Bo die Schichten durcheinander – stapel sie richtig: <b>Basis zuerst (unten), Startbefehl zuletzt (oben)</b>.</p>
      <button class="primary" id="stack-start">Verstanden – stapeln!</button></div>`;
    $("stack-start").onclick = () => this.renderStackRound();
  },

  renderStackRound() {
    const st = this.stack;
    const rounds = KQContent.STACK_ROUNDS;
    if (st.round >= rounds.length) {
      const coins = 5 * st.score;
      if (st.score > (Game.state.stats.stackBest || 0)) Game.state.stats.stackBest = st.score;
      Game.save();
      this.reward(15, coins, "🎮 Stapel-Spiel beendet!");
      $("stack-body").innerHTML = `<div style="text-align:center">
        <div style="font-size:3em">📦</div>
        <h2>${st.score} von ${rounds.reduce((s, r) => s + r.layers.length, 0)} Schichten ohne Fehler!</h2>
        <p class="dim">Merke: Ein Image ist ein <b>Schichtstapel</b>. Unten die Basis (ändert sich selten = bleibt im Cache),
        oben dein Code (ändert sich oft). Gute Reihenfolge = schnelle Builds!</p>
        <button class="primary" data-action="closeOverlays">Zurück zu Bo</button></div>`;
      this.stack = null;
      // Geführter Minispiel-Quest-Schritt (#276): einmal komplett gespielt = Schritt
      // erfüllt. Ist der aktuelle Quest-Schritt das Stapel-Spiel, schließen wir ihn ab.
      const mgStep = Game.currentStep();
      if (mgStep && mgStep.type === "minigame" && mgStep.game === "stack") this.afterStep();
      return;
    }
    const round = rounds[st.round];
    st.target = round.layers;
    st.placed = 0;
    // #219: Lernstand dieser Runde merken – startet „sauber", jede falsche Schicht macht sie
    // unsauber (= nicht gekonnt). Vorheriger Stand wird als Abzeichen sichtbar gemacht.
    st.roundClean = true;
    const badge = masteryBadge(Game.masteryBox("stack:" + round.name));
    const html = `<p><b>Runde ${st.round + 1}/${rounds.length}: ${round.name}</b> ${badge} –
      Bo ruft die Schichten durcheinander. Stapel sie in der <b>richtigen Reihenfolge</b>: unten anfangen (Basis zuerst)!
      <button id="stack-info" title="Erklärung nochmal ansehen" style="float:right;font-size:.85em">ℹ️ Erklärung</button></p>
      <div class="stack-area"><div class="stack-pile" id="stack-pile"></div>
      <div class="stack-choices" id="stack-choices"></div></div>
      <div class="stack-feedback" id="stack-feedback"></div>`;
    $("stack-body").innerHTML = html;
    $("stack-info").onclick = () => this.renderStackIntro();
    const choices = $("stack-choices");
    for (const layer of shuffled(round.layers)) {
      const b = document.createElement("button");
      b.textContent = "📦 " + layer;
      b.onclick = () => this.placeLayer(layer, b);
      choices.appendChild(b);
    }
  },

  placeLayer(layer: string, btn: HTMLButtonElement) {
    const st = this.stack;
    if (!st) return;
    if (layer === st.target[st.placed]) {
      st.placed++; st.score++;
      btn.remove();
      const div = document.createElement("div");
      div.className = "stack-layer";
      div.textContent = "📦 " + layer;
      $("stack-pile").prepend(div);
      SFX.success();
      const fb = $("stack-feedback");
      fb.className = "stack-feedback";
      fb.innerHTML = "";
      if (st.placed >= st.target.length) {
        // Runde geschafft (#218): nicht automatisch wegspringen, sondern die
        // konkrete Cache-/Build-Lektion zu diesem Image zeigen und per Knopf
        // weiter – sonst wäre der Tipp nicht lesbar.
        const round = KQContent.STACK_ROUNDS[st.round];
        const last = st.round + 1 >= KQContent.STACK_ROUNDS.length;
        // #219: Runde fehlerfrei gestapelt? Dann sitzt das Konzept (Box hoch); mit Patzern
        // bleibt es schwach (Box zurück) und kommt beim nächsten Mal früher dran.
        Game.recordPractice("stack:" + round.name, st.roundClean !== false);
        fb.className = "stack-feedback good";
        fb.innerHTML = `✅ <b>Runde geschafft!</b>
          <div class="stack-cachetip">🗄️ ${round.cacheTip}</div>
          <button class="primary" id="stack-next">${last ? "Spiel abschließen ▶" : "Nächste Runde ▶"}</button>`;
        $("stack-next").onclick = () => { st.round++; this.renderStackRound(); };
      }
    } else {
      st.score = Math.max(0, st.score - 1);
      st.roundClean = false; // #219: Patzer -> Runde gilt als „noch nicht gekonnt"
      btn.classList.add("wrong");
      setTimeout(() => btn.classList.remove("wrong"), 400);
      SFX.wrong();
      // Konkrete Begründung, warum diese Schicht (noch) nicht passt – und sie bleibt
      // stehen, bis der nächste Zug kommt, statt nach Sekunden zu verschwinden (#217).
      const clickedName = layer.split(" (")[0];
      const nextName = st.target[st.placed].split(" (")[0];
      let reason: string;
      if (st.placed === 0) {
        reason = `Ganz <b>unten</b> muss die <b>Basis</b> liegen: <code>${nextName}</code> (die <code>FROM …</code>-Schicht). Darauf baut alles andere auf.`;
      } else {
        const belowName = st.target[st.placed - 1].split(" (")[0];
        reason = `<b>${clickedName}</b> kommt erst weiter oben. Als Nächstes fehlt <code>${nextName}</code> direkt über „${belowName}“. Merke: Schichten stapeln von unten nach oben – Basis zuerst (bleibt im Cache), Startbefehl zuletzt.`;
      }
      const fb = $("stack-feedback");
      fb.className = "stack-feedback bad";
      fb.innerHTML = "❌ " + reason;
    }
  },

});
