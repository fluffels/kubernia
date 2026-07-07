import { Game } from "../game";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { part, $, shuffled, masteryBadge } from "./shared";
import { yamlStructLines, checkYamlOrder, checkYamlDepth, TAB_INDENT, type YamlLine } from "../content/yamlstruct";

export const yamlstructUI = part({
  /* ========== YAML-Bausteine-Minispiel (#568) ========== */
  openYamlStructGame() {
    this.closeOverlays();
    $("overlay-yamlstruct").classList.remove("hidden");
    this.yamlstruct = { round: 0, score: 0 };
    if (Game.state.stats.yamlstructIntroSeen) this.renderYamlStructRound();
    else this.renderYamlStructIntro();
    this.focusFirstIn($("overlay-yamlstruct")); // #506: Fokus ins Modal
  },

  /** Kurze Einführung (Vorbild #216 beim Stapel-Spiel): erklärt Einrückung/Ebene,
   *  bevor die erste Runde startet. Danach jederzeit über den „ℹ️ Erklärung"-Knopf
   *  wieder aufrufbar. */
  renderYamlStructIntro() {
    Game.state.stats.yamlstructIntroSeen = 1;
    Game.save();
    $("yamlstruct-body").innerHTML = `<div class="stack-intro">
      <div style="font-size:2.4em;text-align:center">🗺️</div>
      <h2 style="text-align:center">YAML lebt von der Einrückung</h2>
      <p>Ein Manifest ist eine <b>Baumstruktur</b> aus Feldern, als Text geschrieben. Was <b>unter</b> was gehört, entscheidet allein die <b>Einrückung</b> – zwei Leerzeichen pro Ebene, <b>niemals</b> ein Tab.</p>
      <p>Die Zeilen eines echten Manifests liegen durcheinander. Setze sie <b>in der richtigen Reihenfolge</b> UND auf der <b>richtigen Ebene</b> wieder zusammen – erst dann „rastet" eine Zeile ein.</p>
      <p class="dim">Falsche Ebene? Wird sofort markiert – mit Begründung, wohin die Zeile gehört.</p>
      <button class="primary" id="yamlstruct-start">Verstanden – bauen!</button></div>`;
    $("yamlstruct-start").onclick = () => this.renderYamlStructRound();
  },

  renderYamlStructRound() {
    const st = this.yamlstruct;
    const rounds = KQContent.YAML_STRUCT_ROUNDS;
    if (st.round >= rounds.length) {
      const coins = 5 * st.score;
      if (st.score > (Game.state.stats.yamlstructBest || 0)) Game.state.stats.yamlstructBest = st.score;
      Game.save();
      this.reward(15, coins, "🎮 YAML-Bausteine beendet!");
      $("yamlstruct-body").innerHTML = `<div style="text-align:center">
        <div style="font-size:3em">🗺️</div>
        <h2>${st.score} Zeilen ohne Fehler eingerückt!</h2>
        <p class="dim">Merke: YAML ist eine <b>Baumstruktur</b> aus Einrückung – zwei Leerzeichen pro Ebene, nie ein Tab. Was tiefer eingerückt ist, gehört zur Zeile darüber.</p>
        <button class="primary" data-action="closeOverlays">Zurück zu Ada</button></div>`;
      this.yamlstruct = null;
      const mgStep = Game.currentStep();
      if (mgStep && mgStep.type === "minigame" && mgStep.game === "yamlstruct") this.afterStep();
      return;
    }
    const round = rounds[st.round];
    st.target = yamlStructLines(round.manifestId);
    st.placed = 0;
    st.pendingText = null;
    // #219: Lernstand dieser Runde merken, exakt wie beim Stapel-/Packspiel.
    st.roundClean = true;
    const badge = masteryBadge(Game.masteryBox("yamlstruct:" + round.name));
    $("yamlstruct-body").innerHTML = `<p><b>Runde ${st.round + 1}/${rounds.length}: ${round.name}</b> ${badge} –
      Die Zeilen liegen durcheinander. Baue das Manifest <b>Zeile für Zeile</b> wieder auf.
      <button id="yamlstruct-info" title="Erklärung nochmal ansehen" style="float:right;font-size:.85em">ℹ️ Erklärung</button></p>
      <div class="yamlstruct-area">
        <pre class="yamlstruct-built" id="yamlstruct-built"></pre>
        <div class="yamlstruct-choices" id="yamlstruct-choices"></div>
      </div>
      <div class="yamlstruct-feedback" id="yamlstruct-feedback"></div>`;
    $("yamlstruct-info").onclick = () => this.renderYamlStructIntro();
    this.renderYamlStructChoices();
  },

  /** Zeigt alle noch nicht platzierten Zeilen gemischt als Buttons (Vorbild
   *  Stapel-Spiel: die ganze Restmenge, nicht nur die nächste fällige Zeile). */
  renderYamlStructChoices() {
    const st = this.yamlstruct;
    const target = st.target!;
    const remaining: string[] = target.slice(st.placed).map((l: YamlLine) => l.text);
    const choices = $("yamlstruct-choices");
    choices.innerHTML = "";
    for (const text of shuffled(remaining)) {
      const b = document.createElement("button");
      b.textContent = text;
      b.onclick = () => this.pickYamlLine(text, b);
      choices.appendChild(b);
    }
  },

  /** Schritt 1: Reihenfolge prüfen. Passt die Zeile, geht's weiter zur Tiefe-Wahl;
   *  sonst sofort Begründung zeigen (kein Tiefe-Schritt nötig). */
  pickYamlLine(text: string, btn: HTMLButtonElement) {
    const st = this.yamlstruct;
    if (!st) return;
    const order = checkYamlOrder(st.target!, st.placed!, text);
    const fb = $("yamlstruct-feedback");
    if (!order.ok) {
      st.roundClean = false;
      btn.classList.add("wrong");
      setTimeout(() => btn.classList.remove("wrong"), 400);
      SFX.wrong();
      fb.className = "yamlstruct-feedback bad";
      fb.innerHTML = "❌ " + order.reason;
      return;
    }
    st.pendingText = text;
    this.renderYamlStructDepthPicker(text);
  },

  /** Schritt 2: Für die (schon ordnungsrichtige) Zeile die Einrücktiefe wählen –
   *  Ebenen 0..maxDepth der Runde plus ein bewusst falscher „⇥ Tab"-Knopf (lehrt
   *  „YAML nutzt Leerzeichen, nie Tabs" durch Ausprobieren). */
  renderYamlStructDepthPicker(text: string) {
    const st = this.yamlstruct;
    const maxDepth = Math.max(...st.target!.map((l: YamlLine) => l.depth));
    const choices = $("yamlstruct-choices");
    choices.innerHTML = `<p class="dim">„<code>${text}</code>" – auf welcher <b>Ebene</b> eingerückt?</p>`;
    const row = document.createElement("div");
    row.className = "yamlstruct-depths";
    for (let d = 0; d <= maxDepth; d++) {
      const b = document.createElement("button");
      b.textContent = "Ebene " + d;
      b.onclick = () => this.placeYamlDepth(d);
      row.appendChild(b);
    }
    const tabBtn = document.createElement("button");
    tabBtn.className = "yamlstruct-tab";
    tabBtn.textContent = "⇥ Tab";
    tabBtn.onclick = () => this.placeYamlDepth(TAB_INDENT);
    row.appendChild(tabBtn);
    choices.appendChild(row);
    const back = document.createElement("button");
    back.textContent = "↩ andere Zeile wählen";
    back.onclick = () => { st.pendingText = null; this.renderYamlStructChoices(); };
    choices.appendChild(back);
  },

  placeYamlDepth(depth: number) {
    const st = this.yamlstruct;
    if (!st || st.pendingText == null) return;
    const expected = st.target![st.placed!];
    const result = checkYamlDepth(expected.depth, depth);
    const fb = $("yamlstruct-feedback");
    if (!result.ok) {
      st.roundClean = false;
      SFX.wrong();
      fb.className = "yamlstruct-feedback bad";
      fb.innerHTML = "❌ " + result.reason;
      st.pendingText = null;
      this.renderYamlStructChoices();
      return;
    }
    st.placed!++;
    st.score++;
    SFX.success();
    fb.className = "yamlstruct-feedback";
    fb.innerHTML = "";
    $("yamlstruct-built").textContent += "  ".repeat(expected.depth) + expected.text + "\n";
    st.pendingText = null;
    if (st.placed! >= st.target!.length) {
      const round = KQContent.YAML_STRUCT_ROUNDS[st.round];
      const last = st.round + 1 >= KQContent.YAML_STRUCT_ROUNDS.length;
      Game.recordPractice("yamlstruct:" + round.name, st.roundClean !== false);
      fb.className = "yamlstruct-feedback good";
      fb.innerHTML = `✅ <b>Runde geschafft!</b>
        <div class="stack-cachetip">🗺️ ${round.tip}</div>
        <button class="primary" id="yamlstruct-next">${last ? "Spiel abschließen ▶" : "Nächste Runde ▶"}</button>`;
      $("yamlstruct-next").onclick = () => { st.round++; this.renderYamlStructRound(); };
      return;
    }
    this.renderYamlStructChoices();
  },
});
