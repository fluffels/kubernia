import { Game } from "../game";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { part, $, shuffled, masteryBadge } from "./shared";
import { checkIngressChoice, checkPodChoice, checkNoEndpoints, type RoutingRound } from "../content/routing";

/** Label eines Pods für Anzeige/Buttons: „name (label=wert, …)". */
function podLabel(labels: Record<string, string>): string {
  return Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(", ");
}

export const routingUI = part({
  /* ========== Routing-Lotse-Minispiel (#569) ========== */
  openRoutingGame() {
    this.closeOverlays();
    $("overlay-routing").classList.remove("hidden");
    this.routing = { round: 0, score: 0, order: [], activeLabel: null, stage: null, targetService: null, roundClean: true };
    if (Game.state.stats.routingIntroSeen) this.renderRoutingRound();
    else this.renderRoutingIntro();
    this.focusFirstIn($("overlay-routing")); // #506: Fokus ins Modal
  },

  /** Kurze Einführung (Vorbild #216 beim Stapel-Spiel): erklärt Ingress/Service-
   *  Selector/Endpoints, bevor die erste Runde startet. Danach jederzeit über den
   *  „ℹ️ Erklärung"-Knopf wieder aufrufbar. */
  renderRoutingIntro() {
    Game.state.stats.routingIntroSeen = 1;
    Game.save();
    $("routing-body").innerHTML = `<div class="stack-intro">
      <div style="font-size:2.4em;text-align:center">🧭</div>
      <h2 style="text-align:center">Wie eine Anfrage zum richtigen Pod findet</h2>
      <p>Ein <b>Service</b> schickt Traffic an jeden Pod, dessen <b>Labels</b> seinen <b>Selector</b> vollständig erfüllen. Steht davor ein <b>Ingress</b>, entscheidet zuerst der <b>Pfad</b> der Anfrage, welcher Service überhaupt zum Zug kommt.</p>
      <p>Deine Aufgabe: lotse jede Anfrage über die richtige Route bis zum passenden Pod.</p>
      <p class="dim">Manchmal hat ein Service <b>keine</b> passenden Pods – dann ist „<b>keine Endpoints</b>" markieren die richtige Antwort, kein Fehler!</p>
      <button class="primary" id="routing-start">Verstanden – lotsen!</button></div>`;
    $("routing-start").onclick = () => this.renderRoutingRound();
  },

  renderRoutingRound() {
    const st = this.routing;
    const rounds = KQContent.ROUTING_ROUNDS;
    if (st.round >= rounds.length) {
      const coins = 5 * st.score;
      if (st.score > (Game.state.stats.routingBest || 0)) Game.state.stats.routingBest = st.score;
      Game.save();
      this.reward(15, coins, "🎮 Routing-Lotse beendet!");
      $("routing-body").innerHTML = `<div style="text-align:center">
        <div style="font-size:3em">🧭</div>
        <h2>${st.score} Anfragen richtig gelotst!</h2>
        <p class="dim">Merke: Ein Service findet seine Pods über <b>Label-Selektoren</b>, ein Ingress davor sortiert nach <b>Pfad</b>. Passt kein Label, bleibt es bei <b>keinen Endpoints</b> – kein Absturz, nur „niemand da".</p>
        <button class="primary" data-action="closeOverlays">Zurück zu Ada</button></div>`;
      this.routing = null;
      const mgStep = Game.currentStep();
      if (mgStep && mgStep.type === "minigame" && mgStep.game === "routing") this.afterStep();
      return;
    }
    const round = rounds[st.round];
    st.order = shuffled(round.requests.map((r) => r.label));
    st.activeLabel = null;
    st.stage = null;
    st.targetService = null;
    st.roundClean = true;
    const badge = masteryBadge(Game.masteryBox("routing:" + round.name));
    $("routing-body").innerHTML = `<p><b>Runde ${st.round + 1}/${rounds.length}: ${round.name}</b> ${badge} –
      Lotse jede Anfrage zum richtigen Pod (oder erkenne „keine Endpoints").
      <button id="routing-info" title="Erklärung nochmal ansehen" style="float:right;font-size:.85em">ℹ️ Erklärung</button></p>
      <div class="routing-map" id="routing-map"></div>
      <div class="routing-area" id="routing-area"></div>
      <div class="routing-feedback" id="routing-feedback"></div>`;
    $("routing-info").onclick = () => this.renderRoutingIntro();
    this.renderRoutingMap();
    this.renderRoutingQueue();
  },

  /** Referenz-Übersicht der Runde (Vorbild #567 Node-Karten): Ingress-Regeln (falls
   *  vorhanden), Services mit Selector, Pods mit Labels – rein informativ, keine
   *  Klick-Ziele. Der Spieler braucht diese Angaben, um in `renderRoutingQueue`
   *  zu entscheiden. */
  renderRoutingMap() {
    const st = this.routing;
    const round: RoutingRound = KQContent.ROUTING_ROUNDS[st.round];
    const map = $("routing-map");
    const ingressBlock = round.ingressRules.length
      ? `<div class="routing-col"><b>🚪 Ingress</b>${round.ingressRules.map((r) => `<div class="routing-row"><code>${r.path}</code> → ${r.service}</div>`).join("")}</div>`
      : "";
    const svcBlock = `<div class="routing-col"><b>🔌 Services</b>${round.services.map((s) => `<div class="routing-row">${s.name}: <code>${podLabel(s.selector)}</code></div>`).join("")}</div>`;
    const podBlock = `<div class="routing-col"><b>📦 Pods</b>${round.pods.map((p) => `<div class="routing-row">${p.name}: <code>${podLabel(p.labels)}</code></div>`).join("")}</div>`;
    map.innerHTML = ingressBlock + svcBlock + podBlock;
  },

  /** Zeigt alle noch offenen Anfragen dieser Runde als Buttons – Klick öffnet die
   *  passende erste Stufe (Ingress-Wahl, falls die Runde eine Ingress-Ebene hat,
   *  sonst direkt die Pod-Wahl). */
  renderRoutingQueue() {
    const st = this.routing;
    const round: RoutingRound = KQContent.ROUTING_ROUNDS[st.round];
    const area = $("routing-area");
    area.innerHTML = `<p class="dim">Offene Anfragen:</p>`;
    const list = document.createElement("div");
    list.className = "routing-requests";
    for (const label of st.order) {
      const b = document.createElement("button");
      b.textContent = "📨 " + label;
      b.onclick = () => this.pickRoutingRequest(label);
      list.appendChild(b);
    }
    area.appendChild(list);
    if (round.ingressRules.length === 0) {
      area.insertAdjacentHTML("beforeend", `<p class="dim">Diese Runde hat noch keinen Ingress davor – die Anfrage geht direkt an den genannten Service.</p>`);
    }
  },

  pickRoutingRequest(label: string) {
    const st = this.routing;
    if (!st) return;
    const round: RoutingRound = KQContent.ROUTING_ROUNDS[st.round];
    st.activeLabel = label;
    if (round.ingressRules.length > 0) {
      st.stage = "ingress";
      this.renderRoutingIngressChoices();
    } else {
      const req = round.requests.find((r) => r.label === label)!;
      st.stage = "pod";
      st.targetService = req.service!;
      this.renderRoutingPodChoices();
    }
  },

  renderRoutingIngressChoices() {
    const st = this.routing;
    const round: RoutingRound = KQContent.ROUTING_ROUNDS[st.round];
    const req = round.requests.find((r) => r.label === st.activeLabel)!;
    const area = $("routing-area");
    area.innerHTML = `<p>„<b>${req.label}</b>" kommt über Pfad <code>${req.path}</code> an – welche Ingress-Regel greift?</p>`;
    const list = document.createElement("div");
    list.className = "routing-requests";
    for (const rule of round.ingressRules) {
      const b = document.createElement("button");
      b.textContent = `${rule.path} → ${rule.service}`;
      b.onclick = () => this.chooseRoutingIngress(rule.path);
      list.appendChild(b);
    }
    area.appendChild(list);
    const back = document.createElement("button");
    back.textContent = "↩ andere Anfrage wählen";
    back.onclick = () => { st.activeLabel = null; st.stage = null; this.renderRoutingQueue(); };
    area.appendChild(back);
  },

  chooseRoutingIngress(chosenPath: string) {
    const st = this.routing;
    if (!st || !st.activeLabel) return;
    const round: RoutingRound = KQContent.ROUTING_ROUNDS[st.round];
    const req = round.requests.find((r) => r.label === st.activeLabel)!;
    const result = checkIngressChoice(req.path!, chosenPath);
    const fb = $("routing-feedback");
    if (!result.ok) {
      st.roundClean = false;
      SFX.wrong();
      fb.className = "routing-feedback bad";
      fb.innerHTML = "❌ " + result.reason;
      return;
    }
    st.targetService = round.ingressRules.find((r) => r.path === chosenPath)!.service;
    st.stage = "pod";
    fb.className = "routing-feedback";
    fb.innerHTML = "";
    this.renderRoutingPodChoices();
  },

  renderRoutingPodChoices() {
    const st = this.routing;
    const round: RoutingRound = KQContent.ROUTING_ROUNDS[st.round];
    const svc = round.services.find((s) => s.name === st.targetService)!;
    const area = $("routing-area");
    area.innerHTML = `<p>Service <b>${svc.name}</b> sucht Pods mit Selector <code>${podLabel(svc.selector)}</code> – welcher Pod bedient „<b>${st.activeLabel}</b>"?</p>`;
    const list = document.createElement("div");
    list.className = "routing-requests";
    for (const pod of round.pods) {
      const b = document.createElement("button");
      b.textContent = `📦 ${pod.name} (${podLabel(pod.labels)})`;
      b.onclick = () => this.chooseRoutingPod(pod.name);
      list.appendChild(b);
    }
    area.appendChild(list);
    const noEp = document.createElement("button");
    noEp.textContent = "🚫 keine Endpoints";
    noEp.onclick = () => this.markRoutingNoEndpoints();
    area.appendChild(noEp);
    const back = document.createElement("button");
    back.textContent = "↩ andere Anfrage wählen";
    back.onclick = () => { st.activeLabel = null; st.stage = null; this.renderRoutingQueue(); };
    area.appendChild(back);
  },

  chooseRoutingPod(podName: string) {
    const st = this.routing;
    if (!st || !st.activeLabel) return;
    const round: RoutingRound = KQContent.ROUTING_ROUNDS[st.round];
    const svc = round.services.find((s) => s.name === st.targetService)!;
    const result = checkPodChoice(round.pods, svc.selector, podName);
    this.resolveRoutingAttempt(result);
  },

  markRoutingNoEndpoints() {
    const st = this.routing;
    if (!st || !st.activeLabel) return;
    const round: RoutingRound = KQContent.ROUTING_ROUNDS[st.round];
    const svc = round.services.find((s) => s.name === st.targetService)!;
    const result = checkNoEndpoints(round.pods, svc.selector);
    this.resolveRoutingAttempt(result, "✅ Richtig erkannt: keine passenden Endpoints.");
  },

  /** Gemeinsame Auswertung für „Pod gewählt" und „keine Endpoints markiert". */
  resolveRoutingAttempt(result: { ok: boolean; reason?: string }, okMsg?: string) {
    const st = this.routing;
    const fb = $("routing-feedback");
    if (!result.ok) {
      st.roundClean = false;
      SFX.wrong();
      fb.className = "routing-feedback bad";
      fb.innerHTML = "❌ " + result.reason;
      return;
    }
    st.score++;
    SFX.success();
    fb.className = "routing-feedback good";
    fb.innerHTML = okMsg || "✅ Richtig gelotst!";
    st.order = st.order.filter((l: string) => l !== st.activeLabel);
    st.activeLabel = null;
    st.stage = null;
    st.targetService = null;
    this.checkRoutingRoundDone();
  },

  checkRoutingRoundDone() {
    const st = this.routing;
    if (st.order.length > 0) { this.renderRoutingQueue(); return; }
    const round: RoutingRound = KQContent.ROUTING_ROUNDS[st.round];
    Game.recordPractice("routing:" + round.name, st.roundClean !== false);
    const last = st.round + 1 >= KQContent.ROUTING_ROUNDS.length;
    const fb = $("routing-feedback");
    fb.className = "routing-feedback good";
    fb.innerHTML = `✅ <b>Runde geschafft!</b>
      <div class="stack-cachetip">🧭 ${round.tip}</div>
      <button class="primary" id="routing-next">${last ? "Spiel abschließen ▶" : "Nächste Runde ▶"}</button>`;
    $("routing-next").onclick = () => { st.round++; this.renderRoutingRound(); };
    $("routing-area").innerHTML = "";
  },
});
