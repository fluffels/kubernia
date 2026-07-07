import { Game } from "../game";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { part, $, shuffled, masteryBadge } from "./shared";
import { checkKeyringChoice, type RbacKeyringRound, type RbacKeyringOption } from "../content/rbacKeyring";
import { roleKind } from "../sim/rbac";

/** Label eines Schlüssels für Anzeige/Buttons: „Role pod-leser (get/list/watch → pods)". */
function optionLabel(o: RbacKeyringOption): string {
  const rules = o.rules.map((r) => `${r.verbs.join("/")} → ${r.resources.join("/")}`).join("; ");
  return `${roleKind(o.cluster)} ${o.name} (${rules})`;
}

export const rbaskeyringUI = part({
  /* ========== RBAC-Schlüsselbund-Minispiel (#571) ========== */
  openRbacKeyringGame() {
    this.closeOverlays();
    $("overlay-rbaskeyring").classList.remove("hidden");
    this.rbaskeyring = { round: 0, score: 0, order: [], activeTaskIdx: null, roundClean: true };
    if (Game.state.stats.rbackeyringIntroSeen) this.renderRbacKeyringRound();
    else this.renderRbacKeyringIntro();
    this.focusFirstIn($("overlay-rbaskeyring")); // #506: Fokus ins Modal
  },

  /** Kurze Einführung (Vorbild #216 beim Stapel-Spiel): erklärt Subjekt/Role/ClusterRole/
   *  Least Privilege, bevor die erste Runde startet. Danach jederzeit über den
   *  „ℹ️ Erklärung"-Knopf wieder aufrufbar. */
  renderRbacKeyringIntro() {
    Game.state.stats.rbackeyringIntroSeen = 1;
    Game.save();
    $("rbaskeyring-body").innerHTML = `<div class="stack-intro">
      <div style="font-size:2.4em;text-align:center">🔑</div>
      <h2 style="text-align:center">Least Privilege am Schlüsselbund</h2>
      <p>Jedes <b>Subjekt</b> (ServiceAccount) braucht für seine Aufgabe eine <b>Role</b> oder <b>ClusterRole</b> – eine Liste erlaubter <b>Verben</b> auf <b>Ressourcen</b>. Manche Ressourcen (z.B. Nodes) gehören KEINEM Namespace – die kann nur eine ClusterRole abdecken.</p>
      <p>Deine Aufgabe: binde jedes Subjekt an den <b>kleinsten</b> Schlüssel aus dem Bund, der die Aufgabe noch erfüllt.</p>
      <p class="dim">Zu wenig lässt die Aufgabe scheitern (<code>can-i</code> = no) – zu viel ist ein Least-Privilege-Fehler, auch wenn's technisch funktioniert!</p>
      <button class="primary" id="rbaskeyring-start">Verstanden – Schlüssel wählen!</button></div>`;
    $("rbaskeyring-start").onclick = () => this.renderRbacKeyringRound();
  },

  renderRbacKeyringRound() {
    const st = this.rbaskeyring;
    const rounds = KQContent.RBAC_KEYRING_ROUNDS;
    if (st.round >= rounds.length) {
      const coins = 5 * st.score;
      if (st.score > (Game.state.stats.rbackeyringBest || 0)) Game.state.stats.rbackeyringBest = st.score;
      Game.save();
      this.reward(15, coins, "🎮 RBAC-Schlüsselbund beendet!");
      $("rbaskeyring-body").innerHTML = `<div style="text-align:center">
        <div style="font-size:3em">🔑</div>
        <h2>${st.score} Subjekte korrekt gebunden!</h2>
        <p class="dim">Merke: die KLEINSTE Role/ClusterRole, die eine Aufgabe noch erfüllt, ist immer die richtige Wahl – nicht die erste, die passt.</p>
        <button class="primary" data-action="closeOverlays">Zurück zum Wachturm</button></div>`;
      this.rbaskeyring = null;
      const mgStep = Game.currentStep();
      if (mgStep && mgStep.type === "minigame" && mgStep.game === "rbaskeyring") this.afterStep();
      return;
    }
    const round = rounds[st.round];
    st.order = shuffled(round.tasks.map((_, i) => i));
    st.activeTaskIdx = null;
    st.roundClean = true;
    const badge = masteryBadge(Game.masteryBox("rbaskeyring:" + round.name));
    $("rbaskeyring-body").innerHTML = `<p><b>Runde ${st.round + 1}/${rounds.length}: ${round.name}</b> ${badge} –
      Binde jedes Subjekt an den kleinsten passenden Schlüssel.
      <button id="rbaskeyring-info" title="Erklärung nochmal ansehen" style="float:right;font-size:.85em">ℹ️ Erklärung</button></p>
      <div class="rbaskeyring-map" id="rbaskeyring-options"></div>
      <div class="rbaskeyring-area" id="rbaskeyring-area"></div>
      <div class="rbaskeyring-feedback" id="rbaskeyring-feedback"></div>`;
    $("rbaskeyring-info").onclick = () => this.renderRbacKeyringIntro();
    this.renderRbacKeyringOptions();
    this.renderRbacKeyringQueue();
  },

  /** Referenz-Übersicht des Schlüsselbunds dieser Runde (Vorbild #569 renderRoutingMap) –
   *  rein informativ, keine Klick-Ziele. */
  renderRbacKeyringOptions() {
    const st = this.rbaskeyring;
    const round: RbacKeyringRound = KQContent.RBAC_KEYRING_ROUNDS[st.round];
    $("rbaskeyring-options").innerHTML = `<div class="rbaskeyring-col"><b>🔑 Schlüsselbund</b>${round.options.map((o) => `<div class="rbaskeyring-row">${optionLabel(o)}</div>`).join("")}</div>`;
  },

  /** Zeigt alle noch offenen Subjekte dieser Runde als Buttons – Klick öffnet die
   *  Schlüssel-Wahl für dieses eine Subjekt. */
  renderRbacKeyringQueue() {
    const st = this.rbaskeyring;
    const round: RbacKeyringRound = KQContent.RBAC_KEYRING_ROUNDS[st.round];
    const area = $("rbaskeyring-area");
    area.innerHTML = `<p class="dim">Offene Subjekte:</p>`;
    const list = document.createElement("div");
    list.className = "rbaskeyring-requests";
    for (const i of st.order) {
      const task = round.tasks[i];
      const b = document.createElement("button");
      b.textContent = `🧾 ${task.subject}: ${task.verb} ${task.resource}${task.clusterOnly ? " (cluster-weit)" : ""}`;
      b.onclick = () => this.pickRbacKeyringTask(i);
      list.appendChild(b);
    }
    area.appendChild(list);
  },

  pickRbacKeyringTask(taskIdx: number) {
    const st = this.rbaskeyring;
    if (!st) return;
    st.activeTaskIdx = taskIdx;
    this.renderRbacKeyringOptionChoices();
  },

  renderRbacKeyringOptionChoices() {
    const st = this.rbaskeyring;
    const round: RbacKeyringRound = KQContent.RBAC_KEYRING_ROUNDS[st.round];
    const task = round.tasks[st.activeTaskIdx!];
    const area = $("rbaskeyring-area");
    area.innerHTML = `<p><b>${task.subject}</b> braucht <code>${task.verb} ${task.resource}</code>${task.clusterOnly ? " – eine cluster-weite Ressource (kein Namespace)" : ""} – welcher Schlüssel?</p>`;
    const list = document.createElement("div");
    list.className = "rbaskeyring-requests";
    round.options.forEach((o, idx) => {
      const b = document.createElement("button");
      b.textContent = optionLabel(o);
      b.onclick = () => this.chooseRbacKeyringOption(idx);
      list.appendChild(b);
    });
    area.appendChild(list);
    const back = document.createElement("button");
    back.textContent = "↩ anderes Subjekt wählen";
    back.onclick = () => { st.activeTaskIdx = null; this.renderRbacKeyringQueue(); };
    area.appendChild(back);
  },

  chooseRbacKeyringOption(idx: number) {
    const st = this.rbaskeyring;
    if (!st || st.activeTaskIdx === null) return;
    const round: RbacKeyringRound = KQContent.RBAC_KEYRING_ROUNDS[st.round];
    const task = round.tasks[st.activeTaskIdx];
    const result = checkKeyringChoice(round.options, task, idx);
    const fb = $("rbaskeyring-feedback");
    if (!result.ok) {
      st.roundClean = false;
      SFX.wrong();
      fb.className = "rbaskeyring-feedback bad";
      fb.innerHTML = "❌ " + result.reason;
      return;
    }
    st.score++;
    SFX.success();
    fb.className = "rbaskeyring-feedback good";
    fb.innerHTML = "✅ Richtig gebunden!";
    st.order = st.order.filter((i: number) => i !== st.activeTaskIdx);
    st.activeTaskIdx = null;
    this.checkRbacKeyringRoundDone();
  },

  checkRbacKeyringRoundDone() {
    const st = this.rbaskeyring;
    if (st.order.length > 0) { this.renderRbacKeyringQueue(); return; }
    const round: RbacKeyringRound = KQContent.RBAC_KEYRING_ROUNDS[st.round];
    Game.recordPractice("rbaskeyring:" + round.name, st.roundClean !== false);
    const last = st.round + 1 >= KQContent.RBAC_KEYRING_ROUNDS.length;
    const fb = $("rbaskeyring-feedback");
    fb.className = "rbaskeyring-feedback good";
    fb.innerHTML = `✅ <b>Runde geschafft!</b>
      <div class="stack-cachetip">🔑 ${round.tip}</div>
      <button class="primary" id="rbaskeyring-next">${last ? "Spiel abschließen ▶" : "Nächste Runde ▶"}</button>`;
    $("rbaskeyring-next").onclick = () => { st.round++; this.renderRbacKeyringRound(); };
    $("rbaskeyring-area").innerHTML = "";
  },
});
