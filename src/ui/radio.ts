import { Game, ABBREV_EARN_THRESHOLD } from "../game";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { ABBREVS, lockedAbbrevInInput, abbrevLockHint, flagNearMissHint, longFormsInInput } from "../content/abbrev";
import { pushHistory, navigateHistory } from "../cmdhistory";
import type { QuestTask } from "../types";
import { part, $, esc, NPCS } from "./shared";

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

  /** Aktive Funk-Session: practice > Quest-Schritt > frei */
  funkSession() {
    if (this.practice && this.practice.idx < this.practice.drills.length) return { kind: "practice" };
    const step = Game.currentStep();
    if (step && Game.isFunkStep(step)) return { kind: "quest", step };
    return { kind: "free" };
  },

  /** Aktuelle Aufgabe der Session (Drills werden hier lazily erzeugt). */
  currentTask() {
    const s = this.funkSession();
    if (s.kind === "practice") {
      const p = this.practice;
      if (!p.task) p.task = KQContent.DRILLS[p.drills[p.idx]](Game.sim);
      return p.task;
    }
    if (s.kind === "quest") {
      const step = s.step!;
      if (step.type === "drill") {
        if ((Game.state.taskIdx || 0) >= step.count) return null;
        if (!this._drillTask) this._drillTask = KQContent.DRILLS[step.pool[Math.floor(Math.random() * step.pool.length)]](Game.sim);
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
      box.innerHTML = `<div class="tt-head">🧪 Freies Funken</div>
        <div class="dim">Gerade kein Auftrag – probier aus, was du gelernt hast!
        Alles, was du hier anrichtest, siehst du draußen in der Welt.
        <br><br>Mit <code>help</code> siehst du alle Befehle.
        <br><br>💡 Übungs-Aufgaben mit Belohnung bekommst du bei der Crew: ansprechen → „Üben”.
        <br><br>💬 Bug gefunden oder Idee? <a href=”https://github.com/fluffels/kubequest/discussions” target=”_blank” rel=”noopener noreferrer”>GitHub Discussions</a></div>
        <div id=”tt-feedback”></div>`;
      actions.innerHTML = "";
      return;
    }

    let html = "";
    const task = this.currentTask();

    if (s.kind === "practice") {
      const p = this.practice;
      const npc = NPCS[p.npcId];
      html += `<div class="tt-head">🏋️ Üben bei ${npc.name} (${Math.min(p.idx + 1, p.drills.length)}/${p.drills.length})</div>`;
      if (task) html += `<div class="tt-item current">▶️ ${task.text}</div>`;
      html += `<div id="tt-feedback"></div>`;
    } else {
      const step = s.step!;
      const q = Game.currentQuest();
      html += `<div class="tt-head">📜 ${q.title}: ${step.brief}</div>`;
      if (step.type === "teach") {
        html += `<div class="tt-new">${KQContent.applyGlossary(step.cmd.intro)}</div>`;
        html += `<div class="tt-item current">▶️ ${KQContent.applyGlossary(step.cmd.text)}</div>`;
      } else if (step.type === "drill") {
        html += `<div class="dim" style="margin-bottom:8px">${step.intro}</div>`;
        html += `<div class="dim">Übung ${Math.min((Game.state.taskIdx || 0) + 1, step.count)} von ${step.count}</div>`;
        if (task) html += `<div class="tt-item current">▶️ ${task.text}</div>`;
      } else {
        const taskIdx = Game.state.taskIdx || 0;
        step.tasks.forEach((t: QuestTask, i: number) => {
          const cls = i < taskIdx ? "done" : i === taskIdx ? "current" : "";
          const mark = i < taskIdx ? "✅" : i === taskIdx ? "▶️" : "·";
          html += `<div class="tt-item ${cls}">${mark} ${i <= taskIdx ? t.text : "???"}</div>`;
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
    const result = Game.sim.exec(line);
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
      this.hint("🔓 Befehlshistorie freigeschaltet: Mit ↑/↓ holst du im Funkgerät vorherige Befehle zurück – wie in einer echten Shell.", "rankup");
    }

    const task = this.currentTask();
    if (!task) return;
    const norm = line.trim().replace(/\s+/g, " ");
    const cmdOk = task.accept.some((re: RegExp) => re.test(norm));
    const checkOk = !task.check || task.check(Game.sim);

    // #299: Der Befehl trifft zwar die Lösung, nutzt aber ein noch nicht
    // freigeschaltetes Profi-Kürzel → freundlicher Hinweis (Langform schreiben)
    // statt es als gelöst zu werten. Die Langform gilt immer; nach Freischaltung
    // (Game.unlockAbbrev, #300) zählen beide Formen.
    // #366: Die Abkürzung, die GENAU DIESER Schritt freischaltet, ist hier
    // ausgenommen – sonst blockt das Gating den Lehr-Auftrag, der sie einführt
    // (z.B. „tippe docker ps -a“, während -a erst nach diesem Schritt freigeschaltet wird).
    const lockedHit = cmdOk
      ? lockedAbbrevInInput(norm, (id) => Game.isAbbrevUnlocked(id), Game.currentStep()?.unlockAbbrev)
      : undefined;
    if (lockedHit) {
      const fb = $("tt-feedback");
      if (fb) fb.innerHTML = '<div class="tt-feedback">' + abbrevLockHint(lockedHit) + '</div>';
      return;
    }

    if (cmdOk && !result.error && checkOk) {
      this.failCount = 0;
      // #313: jede korrekt getippte Langform eines noch gesperrten Bausteins zählt
      // Richtung Freischaltung; bei Erreichen der Schwelle ist die Kurzform „verdient".
      for (const id of longFormsInInput(norm)) {
        if (Game.recordAbbrevLongFormUse(id)) {
          const pair = ABBREVS.find(a => a.id === id);
          if (pair) this.hint(`🔓 Profi-Abkürzung verdient: <code>${pair.short[pair.short.length - 1]}</code> = <code>${pair.long}</code> – ${ABBREV_EARN_THRESHOLD}× ausgeschrieben!`, "rankup");
        }
      }
      SFX.success();
      this.taskSolved();
    } else {
      this.failCount++;
      const fb = $("tt-feedback");
      // #367: Beinahe-Schreibweise eines Flags (z.B. „-all“ statt „-a“/„--all“) → gezielter
      // Hinweis statt der generischen Meldung. Die Kurzform schlägt der Hinweis nur vor, wenn
      // sie schon verfügbar ist (freigeschaltet ODER dieser Lehr-Schritt schaltet sie frei, #366).
      const nearMiss = flagNearMissHint(norm, (id) => Game.isAbbrevUnlocked(id), Game.currentStep()?.unlockAbbrev);
      if (fb && nearMiss) {
        fb.innerHTML = '<div class="tt-feedback">' + nearMiss + '</div>';
      } else if (fb && this.failCount >= 3) {
        // nach mehreren Versuchen: zum Hinweis-Knopf lotsen
        this.failCount = 0;
        fb.innerHTML = '<div class="tt-feedback">💪 Tippfehler sind der häufigste Stolperstein. Der 🔭 Hinweis unten hilft – das ist keine Schande!</div>';
      } else if (fb) {
        // Aufgabe nicht gelöst → immer Begründung zeigen (#307: auch wenn der Befehl einen
        // Sim-Fehler warf; „Nie nur falsch, immer begründen" #233).
        const tip = (task.diag ? task.diag(norm) : null)
          ?? task.why
          ?? (/^docker\s+run\b/.test(norm)
            ? "Bei <code>docker run</code>: hinter <code>--name</code> steht dein Wunschname, das Image kommt ganz zuletzt – Muster <code>docker run -d --name &lt;name&gt; &lt;image&gt;</code>."
            : "Vergleich ihn mit dem Muster oben – Reihenfolge und Namen genau prüfen.");
        const prefix = result.error
          ? "❌ "
          : "❌ Fast – der Befehl lief durch, erfüllt die Aufgabe aber noch nicht. ";
        fb.innerHTML = '<div class="tt-feedback">' + prefix + tip + '</div>';
      }
    }
  },

  taskSolved() {
    const s = this.funkSession();

    if (s.kind === "practice") {
      const p = this.practice;
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
        fb.innerHTML = `<div class="tt-feedback">🎉 Geschafft! <b>${npc.name}</b> will dich sprechen. (Esc schließt das Funkgerät)</div>`;
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
    this.refreshHud();
    this.renderTermTasks();
    const fb = $("tt-feedback");
    if (fb) fb.innerHTML = '<div class="tt-feedback">🔭 <b>Hinweis:</b> ' + task.hint + "</div>";
  },

  termSolution() {
    const task = this.currentTask();
    if (!task) return;
    if (!Game.useConsumable("kompass") && !Game.spendCoins(50)) {
      this.toast("Nicht genug Dublonen für die Lösung! 🪙");
      return;
    }
    this.refreshHud();
    this.renderTermTasks();
    const fb = $("tt-feedback");
    // „Warum so?" gleich mitliefern (#233), nicht nur die Musterlösung zeigen.
    const why = task.why ? ' <span class="dim">' + task.why + "</span>" : "";
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
    const drills: string[] = [];
    for (let i = 0; i < 3; i++) drills.push(available[Math.floor(Math.random() * available.length)]);
    this.practice = { npcId, drills, idx: 0, task: null };
    this.toggleTerminal();
  },

});
