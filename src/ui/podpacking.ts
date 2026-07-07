import { Game } from "../game";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { part, $, shuffled, masteryBadge } from "./shared";
import { nodeUsage, canPlacePod, podFitsAnyNode, type PackingPlacement, type PackingRound } from "../content/podpacking";

/** Label eines Pods für Anzeige/Buttons: „name (cpu m / mem Mi)". */
function podLabel(p: { name: string; cpu: number; memory: number }): string {
  return `${p.name} (${p.cpu}m / ${p.memory}Mi)`;
}

export const podpackingUI = part({
  /* ========== Pod-Packspiel (#567) ========== */
  openPackingGame() {
    this.closeOverlays();
    $("overlay-packing").classList.remove("hidden");
    this.packing = { round: 0, score: 0, placements: [], pending: [], order: [] };
    if (Game.state.stats.packingIntroSeen) this.renderPackingRound();
    else this.renderPackingIntro();
    this.focusFirstIn($("overlay-packing")); // #506: Fokus ins Modal
  },

  /** Kurze Einführung (Vorbild #216 beim Stapel-Spiel): erklärt Node/Kapazität/
   *  requests/Pending, bevor die erste Runde startet. Danach jederzeit über den
   *  „ℹ️ Erklärung"-Knopf wieder aufrufbar. */
  renderPackingIntro() {
    Game.state.stats.packingIntroSeen = 1;
    Game.save();
    $("packing-body").innerHTML = `<div class="stack-intro">
      <div style="font-size:2.4em;text-align:center">🧩</div>
      <h2 style="text-align:center">Wie der Scheduler Pods verteilt</h2>
      <p>Jeder <b>Node</b> hat eine feste <b>Kapazität</b> an CPU und Speicher. Jeder <b>Pod</b> bringt <b>requests</b> mit – so viel reserviert er sich fest, bevor er überhaupt startet.</p>
      <p>Deine Aufgabe: verteile jeden Pod auf einen Node, auf dem <b>beides</b> noch passt – CPU UND Speicher. Ist ein Node schon voll, probier einen anderen.</p>
      <p class="dim">Manchmal passt ein Pod auf <b>keinen</b> Node der Runde – dann ist „<b>Pending</b>" markieren die richtige Antwort, kein Fehler!</p>
      <button class="primary" id="packing-start">Verstanden – verteilen!</button></div>`;
    $("packing-start").onclick = () => this.renderPackingRound();
  },

  renderPackingRound() {
    const st = this.packing;
    const rounds = KQContent.POD_PACKING_ROUNDS;
    if (st.round >= rounds.length) {
      const coins = 5 * st.score;
      if (st.score > (Game.state.stats.packingBest || 0)) Game.state.stats.packingBest = st.score;
      Game.save();
      this.reward(15, coins, "🎮 Pod-Packspiel beendet!");
      $("packing-body").innerHTML = `<div style="text-align:center">
        <div style="font-size:3em">🧩</div>
        <h2>${st.score} Pods ohne Fehler verteilt!</h2>
        <p class="dim">Merke: <b>requests</b> reservieren Node-Platz. Passt kein Node mehr, bleibt der Pod <b>Pending</b> – kein Absturz, nur „noch kein Platz frei".</p>
        <button class="primary" data-action="closeOverlays">Zurück zum Hafen</button></div>`;
      this.packing = null;
      const mgStep = Game.currentStep();
      if (mgStep && mgStep.type === "minigame" && mgStep.game === "packing") this.afterStep();
      return;
    }
    const round = rounds[st.round];
    st.placements = [];
    st.pending = [];
    st.order = shuffled(round.pods.map((p) => p.name));
    st.roundClean = true;
    const badge = masteryBadge(Game.masteryBox("packing:" + round.name));
    $("packing-body").innerHTML = `<p><b>Runde ${st.round + 1}/${rounds.length}: ${round.name}</b> ${badge} –
      Verteile jeden Pod auf einen Node, auf dem CPU UND Speicher noch reichen.
      <button id="packing-info" title="Erklärung nochmal ansehen" style="float:right;font-size:.85em">ℹ️ Erklärung</button></p>
      <div class="packing-area">
        <div class="packing-nodes" id="packing-nodes"></div>
        <div class="packing-pods" id="packing-pods"></div>
      </div>
      <div class="packing-feedback" id="packing-feedback"></div>`;
    $("packing-info").onclick = () => this.renderPackingIntro();
    this.renderPackingBoard();
  },

  /** Baut Node-Karten (Kapazitätsbalken + platzierte Pods) und den Pod-Pool
   *  (unplatzierte Pods mit Zielknöpfen je Node + „Pending") komplett neu –
   *  einfacher als Teil-Updates, bei der kleinen Elementzahl unproblematisch. */
  renderPackingBoard() {
    const st = this.packing;
    const round: PackingRound = KQContent.POD_PACKING_ROUNDS[st.round];
    const nodesEl = $("packing-nodes");
    nodesEl.innerHTML = "";
    for (const node of round.nodes) {
      const used = nodeUsage(node.name, st.placements, round.pods);
      const placedHere = st.placements.filter((pl: PackingPlacement) => pl.node === node.name);
      const div = document.createElement("div");
      div.className = "packing-node";
      div.innerHTML = `<b>${node.name}</b>
        <div class="packing-bar-label">CPU ${used.cpu}/${node.cpu}m</div>
        <div class="packing-bar"><div class="packing-bar-fill" style="width:${Math.min(100, (used.cpu / node.cpu) * 100)}%"></div></div>
        <div class="packing-bar-label">Mem ${used.memory}/${node.memory}Mi</div>
        <div class="packing-bar"><div class="packing-bar-fill" style="width:${Math.min(100, (used.memory / node.memory) * 100)}%"></div></div>
        <div class="packing-node-pods">${placedHere.map((pl: PackingPlacement) => `📦 ${pl.pod}`).join(", ") || "<span class=\"dim\">leer</span>"}</div>`;
      nodesEl.appendChild(div);
    }
    const podsEl = $("packing-pods");
    podsEl.innerHTML = "";
    const unplaced = st.order.filter((name: string) => !st.placements.some((pl: PackingPlacement) => pl.pod === name) && !st.pending.includes(name));
    for (const name of unplaced) {
      const pod = round.pods.find((p) => p.name === name)!;
      const row = document.createElement("div");
      row.className = "packing-pod";
      row.innerHTML = `<span>📦 ${podLabel(pod)}</span>`;
      for (const node of round.nodes) {
        const b = document.createElement("button");
        b.textContent = "▶ " + node.name;
        b.onclick = () => this.tryPlacePod(name, node.name);
        row.appendChild(b);
      }
      const pendingBtn = document.createElement("button");
      pendingBtn.textContent = "🚫 Pending";
      pendingBtn.onclick = () => this.tryMarkPending(name);
      row.appendChild(pendingBtn);
      podsEl.appendChild(row);
    }
  },

  /** Versucht, `podName` auf `nodeName` zu platzieren. Passt (CPU UND Speicher
   *  reichen noch), wird platziert; sonst bleibt der Pod im Pool mit Begründung. */
  tryPlacePod(podName: string, nodeName: string) {
    const st = this.packing;
    if (!st) return;
    const round: PackingRound = KQContent.POD_PACKING_ROUNDS[st.round];
    const pod = round.pods.find((p) => p.name === podName)!;
    const node = round.nodes.find((n) => n.name === nodeName)!;
    const fb = $("packing-feedback");
    if (canPlacePod(pod, node, st.placements, round.pods)) {
      st.placements.push({ pod: podName, node: nodeName });
      st.score++;
      SFX.success();
      fb.className = "packing-feedback";
      fb.innerHTML = "";
      this.renderPackingBoard();
      this.checkPackingRoundDone();
    } else {
      st.score = Math.max(0, st.score - 1);
      st.roundClean = false;
      SFX.wrong();
      const used = nodeUsage(nodeName, st.placements, round.pods);
      const missingCpu = Math.max(0, used.cpu + pod.cpu - node.cpu);
      const missingMem = Math.max(0, used.memory + pod.memory - node.memory);
      const reason = missingCpu > 0
        ? `<b>${nodeName}</b> hat nicht genug <b>CPU</b> frei (${missingCpu}m fehlen).`
        : `<b>${nodeName}</b> hat nicht genug <b>Speicher</b> frei (${missingMem}Mi fehlen).`;
      fb.className = "packing-feedback bad";
      fb.innerHTML = "❌ " + reason + " Versuch's mit einem anderen Node.";
    }
  },

  /** Versucht, `podName` als „passt auf keinen Node" zu markieren. Nur korrekt,
   *  wenn er wirklich auf KEINEM Node der Runde Platz hätte (Gesamt-Kapazität) –
   *  unabhängig von der aktuellen Belegung. */
  tryMarkPending(podName: string) {
    const st = this.packing;
    if (!st) return;
    const round: PackingRound = KQContent.POD_PACKING_ROUNDS[st.round];
    const pod = round.pods.find((p) => p.name === podName)!;
    const fb = $("packing-feedback");
    if (!podFitsAnyNode(pod, round.nodes)) {
      st.pending.push(podName);
      st.score++;
      SFX.success();
      fb.className = "packing-feedback good";
      fb.innerHTML = `✅ Richtig erkannt: <b>${podName}</b> passt auf keinen Node – bleibt <b>Pending</b>.`;
      this.renderPackingBoard();
      this.checkPackingRoundDone();
    } else {
      st.score = Math.max(0, st.score - 1);
      st.roundClean = false;
      SFX.wrong();
      fb.className = "packing-feedback bad";
      fb.innerHTML = `❌ Nicht ganz – <b>${podName}</b> passt (mit genug freiem Platz) durchaus auf einen Node. Nicht vorschnell aufgeben!`;
    }
  },

  checkPackingRoundDone() {
    const st = this.packing;
    const round: PackingRound = KQContent.POD_PACKING_ROUNDS[st.round];
    if (st.placements.length + st.pending.length < round.pods.length) return;
    // Runde geschafft (Vorbild #218): Lektion zeigen, dann per Knopf weiter.
    Game.recordPractice("packing:" + round.name, st.roundClean !== false);
    const last = st.round + 1 >= KQContent.POD_PACKING_ROUNDS.length;
    const fb = $("packing-feedback");
    fb.className = "packing-feedback good";
    fb.innerHTML = `✅ <b>Runde geschafft!</b>
      <div class="stack-cachetip">🧩 ${round.tip}</div>
      <button class="primary" id="packing-next">${last ? "Spiel abschließen ▶" : "Nächste Runde ▶"}</button>`;
    $("packing-next").onclick = () => { st.round++; this.renderPackingRound(); };
  },
});
