import { Game } from "../game";
import { KQContent } from "../content";
import { worldScene } from "../runtime";
import { buildQuestLogRows, questLogUnlocked, buildQuestDetail } from "../questlog";
import { part, $, esc, NPCS } from "./shared";

export const questlogUI = part({
  /* ========== Logbuch (Quest-Log: Übersicht & Navigation, #326) ==========
   * Stufe 1: zukünftige Quests sind sichtbar, aber gesperrt; abgeschlossene und
   * die aktuelle sind ansehbar (Dialoge/Hinweise nachlesen) – kein Voraus-
   * springen. „Resume" führt aus einer alten Quest zurück zur aktuellen; das
   * Schließen des Logbuchs lässt die Live-Position unangetastet (in Stufe 1 wird
   * nichts in der Welt verändert). Freigeschaltet nach Quest 1 (vorher gibt es
   * nichts zum Wechseln); beim ersten Öffnen danach erklärt Bo es einmalig.
   * Die reine Logik (Zustände, Freischaltung, Detail-Zeilen) liegt in
   * questlog.ts; hier nur die DOM-Anbindung. (Echtes Wiederspielen = Stufe 2.) */
  openQuestLog() {
    this.closeOverlays();
    $("overlay-quest").classList.remove("hidden");
    this.questLogViewIdx = null; // immer auf der Übersicht starten
    this.renderQuestLog();
  },

  /** In die Detailansicht einer ansehbaren (abgeschlossenen/aktuellen) Quest
   *  wechseln. Gesperrte/unbekannte Quests werden abgewiesen (kein Vorausspringen). */
  viewQuest(idxStr: string) {
    const idx = Number(idxStr);
    const row = buildQuestLogRows(Game.getQuestRoadmap(), Game.state.questIdx).find(r => r.idx === idx);
    if (!row || !row.viewable) return;
    this.questLogViewIdx = idx;
    this.renderQuestLog();
  },

  /** Zurück von der Detailansicht auf die Übersicht. */
  questLogBack() {
    this.questLogViewIdx = null;
    this.renderQuestLog();
  },

  renderQuestLog() {
    const s = Game.state;
    const npcName = (id: string): string => NPCS[id]?.name ?? id;

    // ----- Detailansicht: Dialoge/Hinweise einer Quest nachlesen -----
    if (this.questLogViewIdx !== null) {
      const quest = KQContent.QUESTS[this.questLogViewIdx];
      if (quest) {
        const isActive = this.questLogViewIdx === s.questIdx;
        const lines = buildQuestDetail(quest, npcName);
        const icon: Record<string, string> = { dialog: "💬", choice: "❓", teach: "📻", drill: "🎯", terminal: "🖥️", minigame: "🎮" };
        let detail = lines
          .map(l => `<div class="ql-line">${icon[l.kind] ?? "•"} ${l.speaker ? `<b>${esc(l.speaker)}:</b> ` : ""}${l.text}</div>`)
          .join("");
        if (!lines.length) detail = `<div class="ql-line dim">Diese Quest hat keine nachlesbaren Dialoge.</div>`;
        if (isActive) {
          const hint = this.hintForStep();
          if (hint) detail += `<div class="ql-line ql-hint">📍 <b>Jetzt dran:</b> ${hint}</div>`;
        }
        const replaying = Game.isReplaying();
        // Eine abgeschlossene Quest lässt sich in der Sandbox erneut spielen (#332) –
        // außer es läuft schon ein Wiederspiel (dann zeigt das Banner den Ausstieg).
        const replayBtn = !replaying && s.completedQuests.includes(quest.id)
          ? `<button data-action="replayQuest" data-arg="${this.questLogViewIdx}">🔁 Quest erneut spielen</button>` : "";
        const resumeBtn = !replaying && !isActive && !Game.allQuestsDone()
          ? `<button data-action="viewQuest" data-arg="${s.questIdx}">▶️ Zur aktuellen Quest</button>` : "";
        $("quest-body").innerHTML = `${this.replayBanner()}<div class="ql-detail">
          <div class="actions" style="margin-bottom:10px">
            <button class="primary" data-action="questLogBack">← Übersicht</button>${replayBtn}${resumeBtn}
          </div>
          <div class="ql-title">${isActive ? "▶️" : "✅"} ${esc(quest.title)}</div>
          ${detail}
        </div>`;
        return;
      }
      this.questLogViewIdx = null; // unbekannte Quest → zurück auf die Übersicht
    }

    // ----- Übersicht -----
    const unlocked = questLogUnlocked(s.completedQuests.length);
    let html = this.replayBanner();

    // Einmaliges Bo-Onboarding beim ersten Öffnen nach der Freischaltung (#326).
    if (unlocked && !s.questLogIntroShown) {
      html += `<div class="ql-bo">🗿 <b>${esc(npcName("bo"))}:</b> LOGBUCH. FREIGESCHALTET. <i>*knirsch*</i>
        Hier liegen alle Quests: erledigte zum <b>Nachlesen</b>, deine aktuelle, und gesperrte (kommen noch).
        Klick eine an – „← Übersicht“ bringt dich zurück, „Zur aktuellen Quest“ zu deiner laufenden Aufgabe.</div>`;
      s.questLogIntroShown = true;
      Game.save();
    }

    if (unlocked) {
      const rows = buildQuestLogRows(Game.getQuestRoadmap(), s.questIdx);
      html += `<div class="ql-list">`;
      for (const row of rows) {
        if (row.state === "locked") {
          html += `<button class="ql-row locked" disabled>🔒 ${esc(row.title)}</button>`;
        } else {
          const mark = row.state === "done" ? "✅" : "▶️";
          html += `<button class="ql-row ${row.state}" data-action="viewQuest" data-arg="${row.idx}">${mark} ${esc(row.title)}</button>`;
        }
      }
      html += `</div>`;
    } else {
      // Vor Quest 1: nur die aktuelle Quest, noch keine Navigation („nichts zum Wechseln").
      const q = Game.currentQuest();
      html += `<div class="ql-quest"><div class="ql-title">▶️ ${q ? esc(q.title) : "—"}</div>
        <div>${this.hintForStep()}</div></div>
        <div class="dim" style="margin-bottom:10px">📖 Sobald du deine erste Quest abgeschlossen hast, wird hier das Logbuch zum Blättern & Nachlesen freigeschaltet.</div>`;
    }

    if (Game.allQuestsDone()) {
      html += `<div class="ql-quest"><div class="ql-title">🏅 Grundausbildung abgeschlossen!</div>
        <div>Der Hafen verdient jetzt für dich – aber Piraten 🏴‍☠️ und die Krake 🐙 lauern.
        Übe bei der Crew, spiele Bos Stapel-Spiel und halte den Streak! Neue Inseln (Ingress, GitOps …) in Arbeit.</div></div>`;
    }

    const r = Game.rank();
    const rate = Math.round(Game.incomeRate() * 10) / 10;
    html += `<div class="ql-stats">Rang: ${r.icon} ${r.name} · ${s.xp} XP · 🪙 ${s.coins} (+${rate}/min) · 🔥 Streak: ${s.streak.count}<br>
      Befehle getippt: ${s.stats.commands} · Quiz richtig: ${s.stats.quizRight} · Piraten vertrieben: ${s.stats.piratesBeaten} · Kraken vertrieben: ${s.stats.krakenBeaten}<br>
      <div class="actions" style="margin-top:10px">
        <button data-action="exportSave">💾 Spielstand sichern (Datei)</button>
        <button data-action="importPick">📂 Spielstand laden</button>
        <button class="linklike" data-action="resetGame">Zurücksetzen</button>
      </div>
      <div class="dim" style="margin-top:6px">Gespeichert wird automatisch alle 5 Sekunden im Browser. Die Datei brauchst du nur als Backup oder für einen anderen Rechner/Browser.</div></div>`;
    $("quest-body").innerHTML = html;
  },

  hintForStep() {
    const step = Game.currentStep();
    if (!step) return "";
    if (Game.isFunkStep(step)) return "💻 Öffne dein Terminal (T) und erledige die Aufgaben.";
    const npc = NPCS[step.npc];
    return "💬 Sprich mit <b>" + npc.name + "</b> (" + npc.title + ").";
  },

  /* ========== Stufe 2 (#332): abgeschlossene Quest wiederspielen (Sandbox) ==========
   * Springt in einer Sandbox an den Anfang einer abgeschlossenen Quest, ohne den
   * Live-Stand zu zerstören (Logik in game/sandbox.ts: Lesezeichen im RAM, save()
   * währenddessen No-Op). Die Welt wird LIVE umgestellt (kein Reload, sonst ginge das
   * RAM-Lesezeichen verloren): die Figur springt zum Quest-Giver, Cluster/NPC-Marker
   * ziehen pro Frame ohnehin aus Game.sim/Game.state nach. „Zur aktuellen Quest"
   * (exitReplay) stellt die gemerkte Live-Position + den echten Fortschritt wieder her. */

  /** Banner oben im Logbuch, solange ein Wiederspiel läuft – mit Ausstieg. */
  replayBanner(): string {
    if (!Game.isReplaying()) return "";
    return `<div class="ql-replay">🔁 <b>Wiederspiel-Modus</b> – dein echter Fortschritt ist sicher gespeichert.
      <button class="primary" data-action="exitReplay">↩️ Zur aktuellen Quest</button></div>`;
  },

  /** Eine abgeschlossene Quest erneut spielen: Sandbox starten, Logbuch schließen,
   *  Figur live zum Giver setzen, Hinweis zeigen. */
  replayQuest(idxStr: string) {
    const idx = Number(idxStr);
    if (!Game.startReplay(idx)) return; // nur abgeschlossene Quests, kein doppeltes Wiederspiel
    this.closeOverlays();
    worldScene()?.teleport?.(Game.state.player.x, Game.state.player.y);
    this.refreshHud();
    const q = KQContent.QUESTS[idx];
    this.hint(`🔁 Wiederspiel: „${esc(q.title)}". Dein echter Fortschritt ist sicher – über „Zur aktuellen Quest" (📜 Logbuch oder oben links) kommst du jederzeit zurück.`);
  },

  /** Wiederspiel beenden: zurück an die gemerkte Live-Position + echter Fortschritt. */
  exitReplay() {
    if (!Game.endReplay()) return;
    this.closeOverlays();
    worldScene()?.teleport?.(Game.state.player.x, Game.state.player.y);
    this.refreshHud();
    this.toast("↩️ Zurück zur aktuellen Quest.");
  },

});
