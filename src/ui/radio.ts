import { Game, ABBREV_EARN_THRESHOLD } from "../game";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { ABBREVS } from "../content/abbrev";
import { pushHistory, navigateHistory } from "../cmdhistory";
import { pickFunkExplanation } from "../funkexplain";
import { evaluateSubmission, funkSessionKind } from "../viewdecide";
import { fmtCmd } from "../markup";
import type { QuestTask } from "../types";
import { part, $, esc, NPCS, masteryBadge } from "./shared";

export const radioUI = part({
  /* ========== Funkgerät ========== */
  toggleTerminal() {
    const ov = $("overlay-terminal");
    if (!ov.classList.contains("hidden")) { this.closeOverlays(); return; }
    this.closeOverlays();
    ov.classList.remove("hidden");
    this.renderTermTasks();
    this.termRedraw();
    $("term-input").focus();
  },

  /** Aktive Funk-Session: practice > Quest-Schritt > frei (Priorität in uieval). */
  funkSession() {
    const step = Game.currentStep();
    const kind = funkSessionKind(
      !!(this.practice && this.practice.idx < this.practice.drills.length),
      !!(step && Game.isFunkStep(step)),
    );
    if (kind === "practice") return { kind: "practice" };
    if (kind === "quest") return { kind: "quest", step: step! };
    return { kind: "free" };
  },

  /** Aktuelle Aufgabe der Session (Drills werden hier lazily erzeugt). */
  currentTask() {
    const s = this.funkSession();
    if (s.kind === "practice") {
      const p = this.practice;
      // Neue Übung erzeugt → Lernstand-Tracking dieser Übung frisch starten (#219).
      if (!p.task) { p.task = KQContent.DRILLS[p.drills[p.idx]](Game.sim); this._practiceDirty = false; }
      return p.task;
    }
    if (s.kind === "quest") {
      const step = s.step!;
      if (step.type === "drill") {
        if ((Game.state.taskIdx || 0) >= step.count) return null;
        // #219: Drill aus dem Pool nach Lernstand GEWICHTET ziehen (schwache häufiger),
        // statt rein zufällig – und die gezogene ID merken, um das Ergebnis zu buchen.
        if (!this._drillTask) {
          this._drillId = Game.pickWeightedPractice(step.pool);
          this._drillTask = KQContent.DRILLS[this._drillId](Game.sim);
          this._practiceDirty = false;
        }
        return this._drillTask;
      }
      const tasks = Game.stepTasks(step);
      return (tasks && tasks[Game.state.taskIdx || 0]) || null;
    }
    return null;
  },

  renderTermTasks() {
    const box = $("term-tasks");
    const actions = $("term-actions");
    const s = this.funkSession();

    if (s.kind === "free") {
      box.innerHTML = `<div class="tt-head">🧪 Freies Ausprobieren</div>
        <div class="dim">Gerade kein Auftrag – probier aus, was du gelernt hast!
        Keine Sorge: Alles, was du hier eingibst, wirkt nur im Hafen-Cluster dieser Spielwelt – nichts auf deinem echten Rechner.
        <br><br>Mit <code>help</code> siehst du die Befehle, die du schon freigeschaltet hast – die Liste wächst, je weiter du kommst.
        <br><br>💡 Übungs-Aufgaben mit Belohnung bekommst du bei der Crew: ansprechen → „Üben”.
        <br><br>💬 Bug gefunden oder Idee? <a href="https://github.com/fluffels/kubequest/discussions" target="_blank" rel="noopener noreferrer">GitHub Discussions</a></div>
        <div id="tt-feedback"></div>`;
      actions.innerHTML = "";
      return;
    }

    let html = "";
    const task = this.currentTask();

    if (s.kind === "practice") {
      const p = this.practice;
      const npc = NPCS[p.npcId];
      // #219: Lernstand der aktuellen Übung sichtbar machen („das kannst du schon / üben wir nochmal").
      const badge = task ? " " + masteryBadge(Game.masteryBox(p.drills[p.idx])) : "";
      html += `<div class="tt-head">🏋️ Üben bei ${npc.name} (${Math.min(p.idx + 1, p.drills.length)}/${p.drills.length})${badge}</div>`;
      if (task) html += `<div class="tt-item current">▶️ ${fmtCmd(task.text)}</div>`;
      html += `<div id="tt-feedback"></div>`;
    } else {
      const step = s.step!;
      const q = Game.currentQuest();
      html += `<div class="tt-head">📜 ${q.title}: ${step.brief}</div>`;
      if (step.type === "teach") {
        html += `<div class="tt-new">${fmtCmd(step.cmd.intro)}</div>`;
        html += `<div class="tt-item current">▶️ ${fmtCmd(step.cmd.text)}</div>`;
      } else if (step.type === "drill") {
        html += `<div class="dim" style="margin-bottom:8px">${fmtCmd(step.intro)}</div>`;
        html += `<div class="dim">Übung ${Math.min((Game.state.taskIdx || 0) + 1, step.count)} von ${step.count}</div>`;
        if (task) html += `<div class="tt-item current">▶️ ${fmtCmd(task.text)}</div>`;
      } else {
        const taskIdx = Game.state.taskIdx || 0;
        step.tasks.forEach((t: QuestTask, i: number) => {
          const cls = i < taskIdx ? "done" : i === taskIdx ? "current" : "";
          const mark = i < taskIdx ? "✅" : i === taskIdx ? "▶️" : "·";
          html += `<div class="tt-item ${cls}">${mark} ${i <= taskIdx ? fmtCmd(t.text) : "???"}</div>`;
        });
      }
      html += `<div id="tt-feedback"></div>`;
    }
    box.innerHTML = html;

    const fernrohr = Game.state.inventory["fernrohr"] || 0;
    const kompass = Game.state.inventory["kompass"] || 0;
    actions.innerHTML = `
      <button data-action="termHint">🔭 Hinweis ${fernrohr > 0 ? "(Fernrohr: " + fernrohr + ")" : "(25 🪙)"}</button>
      <button data-action="termSolution">🧭 Lösung ${kompass > 0 ? "(Kompass: " + kompass + ")" : "(50 🪙)"}</button>
      <span class="dim" style="align-self:center">Selbst tippen statt kopieren – das Tippen ist das Training!</span>`;
  },

  termRedraw() {
    const out = $("term-out");
    out.innerHTML = this.termLog.join("\n");
    out.scrollTop = out.scrollHeight;
  },

  termSubmit(line: string) {
    if (!line.trim()) return;
    // #316: jede abgesendete Zeile in die Sitzungs-Historie aufnehmen (↑/↓), danach steht
    // der Cursor wieder am Entwurf – so holt ↑ als Erstes den gerade getippten Befehl.
    this.termHistory = pushHistory(this.termHistory, line);
    this.termHistIdx = this.termHistory.length;
    // #358: dem help-Befehl die freigeschalteten Befehlsfamilien mitgeben, damit es
    // nur Gelerntes listet (progressive Aufdeckung statt Komplettliste vorweg).
    const result = Game.sim.exec(line, Game.unlockedCommandFamilies());
    if (result.clear) { this.termLog = []; this.termRedraw(); return; }
    this.termLog.push('<span class="t-cmd">crew@hafen:~$ ' + esc(line) + "</span>");
    if (result.output) {
      const text = esc(result.output).replace(/💡[^\n]*/g, s => '</span><span class="t-tip">' + s + '</span><span>');
      this.termLog.push(result.error ? '<span class="t-err">' + text + "</span>" : "<span>" + text + "</span>");
    }
    if (this.termLog.length > 160) this.termLog = this.termLog.slice(-120);
    this.termRedraw();
    Game.state.stats.commands++;
    Game.save();
    // #316: Befehlshistorie „durch Nutzung" freischalten – einmalige Feier beim Erreichen
    // der Schwelle. Vorher tun ↑/↓ nichts (kleine Komfort-Funktion als Upgrade, nicht von
    // Anfang an da). Echte Shells können das auch – kurz erwähnt im Toast.
    if (Game.maybeUnlockCmdHistory()) {
      this.hint("🔓 Befehlshistorie freigeschaltet: Mit ↑/↓ holst du im Terminal vorherige Befehle zurück – wie in einer echten Shell.", "rankup");
    }

    // #362: Im freien Funken nach einem fehlerfreien Befehl eine kurze, in der Spielwelt
    // verankerte Einordnung „Was ist gerade passiert?" einblenden – dosiert: nur bei einem
    // echten Lernmoment (Befehl im Erklär-Katalog) und nie zweimal dieselbe pro Sitzung.
    // Bei einem Sim-Fehler bewusst nicht (die Einordnung würde nicht zur Ausgabe passen).
    if (this.funkSession().kind === "free" && !result.error) {
      const exp = pickFunkExplanation(line, KQContent.FUNK_EXPLAINS, this._funkExplained);
      if (exp) {
        this._funkExplained.add(exp.id);
        const fb = $("tt-feedback");
        if (fb) fb.innerHTML = '<div class="tt-feedback funk-explain">💡 <b>Bo:</b> Was ist da gerade passiert? ' + fmtCmd(exp.text) + "</div>";
      }
    }

    const task = this.currentTask();
    if (!task) return;
    // #500: die verschränkte Bewertung (accept-Match / Abkürzungs-Gating #299/#366 /
    // Near-Miss #367 / Begründung #233/#307) liegt jetzt DOM-frei in uieval.
    // Hier nur noch: Zustand hereinreichen, Verdikt umsetzen (innerHTML/SFX/Fortschritt).
    const verdict = evaluateSubmission(line, task, {
      simError: !!result.error,
      checkOk: !task.check || !!task.check(Game.sim),
      isAbbrevUnlocked: (id) => Game.isAbbrevUnlocked(id),
      unlockAbbrev: Game.currentStep()?.unlockAbbrev,
      failCount: this.failCount,
    });

    if (verdict.outcome === "locked") {
      const fb = $("tt-feedback");
      if (fb) fb.innerHTML = '<div class="tt-feedback">' + verdict.feedback + '</div>';
      return;
    }

    if (verdict.outcome === "solved") {
      this.failCount = 0;
      // #313: jede korrekt getippte Langform eines noch gesperrten Bausteins zählt
      // Richtung Freischaltung; bei Erreichen der Schwelle ist die Kurzform „verdient".
      for (const id of verdict.longForms) {
        if (Game.recordAbbrevLongFormUse(id)) {
          const pair = ABBREVS.find(a => a.id === id);
          if (pair) this.hint(`🔓 Profi-Abkürzung verdient: <code>${pair.short[pair.short.length - 1]}</code> = <code>${pair.long}</code> – ${ABBREV_EARN_THRESHOLD}× ausgeschrieben!`, "rankup");
        }
      }
      SFX.success();
      this.taskSolved();
      return;
    }

    // outcome === "failed"
    this.failCount = verdict.failCount;
    this._practiceDirty = true; // #219: gestolpert -> diese Übung gilt als „noch nicht gekonnt"
    const fb = $("tt-feedback");
    if (fb) fb.innerHTML = '<div class="tt-feedback">' + verdict.feedback + '</div>';
  },

  taskSolved() {
    const s = this.funkSession();

    if (s.kind === "practice") {
      const p = this.practice;
      // #219: Lernstand dieser Übung buchen – sauber gelöst (ohne Patzer/Hinweis) = Box hoch,
      // sonst zurück, damit sie beim nächsten Mal gewichtet früher wiederkommt.
      Game.recordPractice(p.drills[p.idx], !this._practiceDirty);
      this.reward(8, 6);
      p.idx++; p.task = null;
      if (p.idx >= p.drills.length) {
        this.reward(10, 10, "🏋️ Übungsrunde geschafft!");
        this.practice = null;
      }
      this.renderTermTasks();
      const fb = $("tt-feedback");
      if (fb && this.practice) fb.innerHTML = '<div class="tt-feedback">✅ Stark! Nächste Übung ⤴</div>';
      else if (fb) fb.innerHTML = '<div class="tt-feedback">🎉 Runde komplett! Komm jederzeit wieder – Übung füllt den Beutel.</div>';
      return;
    }

    // Quest-Schritt
    const step = s.step!;
    this.reward(12, 7);
    if (step.type === "drill") {
      // #219: auch Quest-Drills schreiben den Lernstand fort (gewichtete Pool-Auswahl oben).
      if (this._drillId) Game.recordPractice(this._drillId, !this._practiceDirty);
      this._drillTask = null;
      Game.state.taskIdx = (Game.state.taskIdx || 0) + 1;
      Game.save();
      if (Game.state.taskIdx >= step.count) return this.finishFunkStep();
    } else if (step.type === "teach") {
      return this.finishFunkStep();
    } else {
      Game.state.taskIdx = (Game.state.taskIdx || 0) + 1;
      Game.save();
      if (Game.state.taskIdx >= step.tasks.length) return this.finishFunkStep();
    }
    this.renderTermTasks();
    const fb = $("tt-feedback");
    if (fb) fb.innerHTML = '<div class="tt-feedback">✅ Stark! Weiter ⤴</div>';
  },

  finishFunkStep() {
    // Abkürzungs-Freischaltung vor dem Voranschreiten (#300): unlockAbbrev am fertigen
    // Schritt → Game.unlockAbbrev + Toast, damit der Toast sichtbar bleibt während die
    // Belohnungs-Anzeige erscheint.
    const completedStep = Game.currentStep();
    if (completedStep?.unlockAbbrev && !Game.isAbbrevUnlocked(completedStep.unlockAbbrev)) {
      const id = completedStep.unlockAbbrev;
      Game.unlockAbbrev(id);
      const pair = ABBREVS.find(a => a.id === id);
      if (pair) {
        const shortForm = pair.short[pair.short.length - 1];
        this.hint(`🔓 Profi-Abkürzung freigeschaltet: <code>${shortForm}</code> = <code>${pair.long}</code>`, "rankup");
      }
    }
    const result = Game.advanceStep() || {};
    this._drillTask = null;
    if (result.questDone) {
      const q = result.questDone;
      Game.registerQuestCards(q.id);
      this.reward(q.rewardXp, q.rewardCoins, "🏁 Quest „" + q.title + "“ abgeschlossen!");
    } else {
      this.reward(10, 6, "📻 Auftrag erledigt!");
    }
    const next = Game.currentStep();
    if (next && Game.isFunkStep(next)) {
      if (next.scenario) { Game.sim.mergeScenario(next.scenario); Game.save(); }
    }
    this.renderTermTasks();
    this.refreshHud();
    const fb = $("tt-feedback");
    if (fb) {
      if (next && !Game.isFunkStep(next) && next.npc) {
        const npc = NPCS[next.npc];
        fb.innerHTML = `<div class="tt-feedback">🎉 Geschafft! <b>${npc.name}</b> will dich sprechen. (Esc schließt das Terminal)</div>`;
      } else if (next && Game.isFunkStep(next)) {
        fb.innerHTML = `<div class="tt-feedback">🎉 Weiter geht's direkt hier ⤴</div>`;
      }
    }
  },

  termHint() {
    const task = this.currentTask();
    if (!task) return;
    if (!Game.useConsumable("fernrohr") && !Game.spendCoins(25)) {
      this.toast("Nicht genug Dublonen für einen Hinweis! 🪙");
      return;
    }
    this._practiceDirty = true; // #219: mit Hinweis gelöst zählt als „noch nicht sicher"
    this.refreshHud();
    this.renderTermTasks();
    const fb = $("tt-feedback");
    if (fb) fb.innerHTML = '<div class="tt-feedback">🔭 <b>Hinweis:</b> ' + fmtCmd(task.hint) + "</div>";
  },

  termSolution() {
    const task = this.currentTask();
    if (!task) return;
    if (!Game.useConsumable("kompass") && !Game.spendCoins(50)) {
      this.toast("Nicht genug Dublonen für die Lösung! 🪙");
      return;
    }
    this._practiceDirty = true; // #219: Lösung gezeigt -> diese Übung noch nicht gekonnt
    this.refreshHud();
    this.renderTermTasks();
    const fb = $("tt-feedback");
    // „Warum so?" gleich mitliefern (#233), nicht nur die Musterlösung zeigen.
    const why = task.why ? ' <span class="dim">' + fmtCmd(task.why) + "</span>" : "";
    if (fb) fb.innerHTML = '<div class="tt-feedback">🧭 <b>Lösung:</b> <code>' + esc(task.solution) + "</code> – selbst eintippen!" + why + "</div>";
  },

  /** #316: ↑/↓ im Terminal-Eingabefeld blättert durch die Sitzungs-Befehlshistorie –
   *  aber nur, wenn die Komfort-Funktion freigeschaltet ist (sonst No-op, default-Verhalten
   *  des Browsers bleibt). Die pure Navigations-Mathematik liegt in cmdhistory.ts; hier nur
   *  die DOM-Anbindung (Eingabefeld setzen, Cursor ans Ende). Gibt `true` zurück, wenn der
   *  Tastendruck verarbeitet wurde – dann unterdrückt main.ts das Default-Verhalten. */
  termHistoryNav(dir: -1 | 1): boolean {
    if (!Game.isCmdHistoryUnlocked() || this.termHistory.length === 0) return false;
    const nav = navigateHistory(this.termHistory, this.termHistIdx, dir);
    this.termHistIdx = nav.index;
    const inp = $("term-input") as HTMLInputElement;
    inp.value = nav.text;
    inp.setSelectionRange(nav.text.length, nav.text.length);   // Cursor ans Ende
    return true;
  },

  /* ========== Üben ========== */
  startPractice(npcId: string) {
    const available = Game.practiceDrillsFor(npcId);
    // #219: die 3 Übungen nach Lernstand GEWICHTET ziehen – schwache Konzepte häufiger,
    // sichere nur ab und zu (statt rein zufällig). Genug verschiedene da → ohne Dublette.
    const drills = Game.pickWeightedDrills(available, 3);
    this.practice = { npcId, drills, idx: 0, task: null };
    this.toggleTerminal();
  },

});
