import { Game } from "../game";
import { SFX } from "../sfx";
import { worldScene, interiorOpen } from "../runtime";
import { part, $, NPCS, SMALLTALK } from "./shared";
import { TOAST_LIFE_MS, HINT_LIFE_MS, toastFadeDelaySeconds } from "../toastlife";

export const hudUI = part({
  /* ========== HUD, Toasts, Alarm ========== */
  refreshHud() {
    const s = Game.state;
    const rank = Game.rank();
    const next = Game.nextRank();
    $("hud-rankname").textContent = rank.icon + " " + rank.name;
    $("hud-coins").textContent = String(s.coins);
    $("hud-streak").textContent = String(s.streak.count);
    const rate = Game.incomeRate();
    $("hud-income").textContent = rate > 0 ? "+" + (Math.round(rate * 10) / 10) + "/min" : "";
    if (next) {
      $("hud-xpfill").style.width = Math.min(100, ((s.xp - rank.xp) / (next.xp - rank.xp)) * 100) + "%";
      $("hud-xptext").textContent = s.xp + " / " + next.xp + " XP";
    } else {
      $("hud-xpfill").style.width = "100%";
      $("hud-xptext").textContent = s.xp + " XP – Maximalrang!";
    }
    this.refreshQuestHint();
  },

  /** Uhrzeit + Datum im HUD setzen. Wird vom Tag-Nacht-Zyklus jeden Frame
   *  aufgerufen, damit die Anzeige synchron zum Lichtschleier läuft. (#39)
   *  Die Uhr tickt jede reale Sekunde sichtbar hoch (#121); da updateDayNight
   *  aber pro Frame feuert, schreiben wir nur bei echter Änderung in den DOM –
   *  spart ~60 redundante Text-Node-Ersetzungen pro Sekunde. */
  setClock(dateLabel: string, timeLabel: string, title: string) {
    const sig = dateLabel + "|" + timeLabel + "|" + title;
    if (sig === this._lastClock) return;
    this._lastClock = sig;
    $("hud-date").textContent = dateLabel;
    $("hud-time").textContent = timeLabel;
    $("hud-clock").title = title;
  },

  refreshQuestHint() {
    const el = $("hud-quest");
    // Wiederspiel-Sandbox (#332): solange ein Replay läuft, zeigt das HUD statt der
    // Quest-Aufgabe den Wiederspiel-Hinweis + Ausstieg (ohne erst das Logbuch zu öffnen).
    if (Game.isReplaying()) {
      const rq = Game.currentQuest();
      el.innerHTML = "🔁 <b>Wiederspiel:</b> " + (rq ? rq.title : "—") +
        ' <button class="hud-replay-exit" data-action="exitReplay">↩️ Zur aktuellen Quest</button>';
      return;
    }
    if (Game.allQuestsDone()) {
      el.innerHTML = "🏅 Grundausbildung geschafft! Halte den Hafen am Laufen – und übe bei der Crew (E → Üben).";
      return;
    }
    const q = Game.currentQuest();
    const step = Game.currentStep();
    if (!q || !step) { el.textContent = ""; return; }
    if (Game.isFunkStep(step)) {
      el.innerHTML = "📜 <b>" + q.title + "</b> – 💻 Terminal öffnen (<b>T</b>)!";
    } else if (step.type === "minigame") {
      const npc = NPCS[step.npc];
      el.innerHTML = "📜 <b>" + q.title + "</b> – Sprich <b>" + npc.name + "</b> an und wähle 🎮 Stapel-Spiel";
    } else {
      const npc = NPCS[step.npc];
      el.innerHTML = "📜 <b>" + q.title + "</b> – Sprich mit <b>" + npc.name + "</b> (" + npc.title + ")";
    }
  },

  /** Kurzer Toast für Belohnungen/Bestätigungen (Standard-Standzeit, #370).
   *  `lifeMs` steuert die Lebensdauer; für lesbare Tipps/Erklärungen `hint()`
   *  nehmen, das bewusst >= 15 s setzt. */
  toast(msg: string, cls?: string, lifeMs: number = TOAST_LIFE_MS) {
    const t = document.createElement("div");
    t.className = "toast" + (cls ? " " + cls : "");
    t.innerHTML = msg;
    // JS-Auto-Remove und CSS-Fade-out aus EINER Quelle (#370): der Fade-out
    // (toast-out in style.css) startet so spät, dass er exakt beim Entfernen
    // endet – sonst fadet ein langer Hinweis schon nach der hartkodierten
    // CSS-Default-Verzögerung weg und hinge danach unsichtbar herum.
    t.style.setProperty("--toast-fade-delay", toastFadeDelaySeconds(lifeMs) + "s");
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), lifeMs);
  },

  /** Hinweis-Toast: bleibt mindestens 15 s lesbar (#370). Für Befehlstipps,
   *  Erklärungen und „bitte tu X"-Hinweise, die der Spieler wirklich lesen
   *  soll – anders als die kurzen Belohnungs-/Bestätigungs-Toasts. */
  hint(msg: string, cls?: string) {
    this.toast(msg, cls, HINT_LIFE_MS);
  },

  reward(xp: number, coins: number, label?: string) {
    const rankUp = Game.addXp(xp);
    const realCoins = coins > 0 ? Game.addCoins(coins) : 0;
    let msg = "+" + xp + " XP";
    if (realCoins > 0) msg += " · +" + realCoins + " 🪙";
    if (label) msg = label + " " + msg;
    this.toast(msg);
    SFX.coin();
    if (rankUp) {
      const r = Game.rank();
      this.toast("🎉 <b>Beförderung!</b> Du bist jetzt <b>" + r.icon + " " + r.name + "</b>!", "rankup");
      SFX.fanfare();
      worldScene()?.burstAtPlayer("sparkle");
    }
    this.refreshHud();
  },

  showAlarm(html: string, seconds: number) {
    $("alarm").classList.remove("hidden");
    $("alarm-text").innerHTML = html;
    $("alarm-timer").textContent = seconds + "s";
  },
  updateAlarmTimer(seconds: number) {
    $("alarm-timer").textContent = seconds + "s";
  },
  hideAlarm() {
    $("alarm").classList.add("hidden");
  },

  /* ========== Interaktion ========== */
  questMarkerFor(npcId: string) {
    const step = Game.currentStep();
    return !!(step && (step.type === "dialog" || step.type === "choice" || step.type === "minigame") && step.npc === npcId);
  },

  updatePrompt() {
    const p = $("prompt");
    const ws = worldScene();
    // Im Hausinnenraum (#6) zeigt die InteriorScene ihren eigenen Hinweis.
    if (this.blocking() || !ws || interiorOpen()) { p.classList.add("hidden"); return; }
    const near = ws.nearestNpc();
    if (!near) { p.classList.add("hidden"); return; }
    const meta = NPCS[near.id];
    let label = "💬 Mit " + meta.name + " reden";
    if (near.id === "pelle") label = "🛒 Bei Pelle einkaufen";
    if (near.id === "kralle") label = "🦀 Quizrunde mit Kralle";
    p.innerHTML = "<b>E</b> – " + label;
    p.classList.remove("hidden");
  },

  interact() {
    // Während ein Hausinnenraum offen ist, gehört die E-Taste der InteriorScene
    // (sonst würde man durch die Wand mit Außen-NPCs der pausierten Welt reden).
    if (interiorOpen()) return;
    const ws = worldScene();
    if (!ws) return;
    const near = ws.nearestNpc();
    if (!near) return;
    this.talkTo(near.id);
  },

  /** Talk-Routing für einen NPC: Pelle→Shop, Kralle→Quiz, laufender Quest-Step,
   *  sonst das NPC-Menü. Bewusst aus interact() herausgezogen und OHNE den
   *  interiorOpen()-Guard, damit die InteriorScene (#201) den Bewohner im
   *  Innenraum direkt ansprechen kann. Der Guard in interact() bleibt – er
   *  verhindert weiterhin, dass man durch die Wand mit Außen-NPCs der
   *  pausierten Welt redet. */
  talkTo(npcId: string): void {
    if (npcId === "pelle") return this.openShop();
    if (npcId === "kralle") return this.openReview();

    const step = Game.currentStep();
    if (step && (step.type === "dialog" || step.type === "choice") && step.npc === npcId) {
      // Sanftes Wiederholungs-Gate (#222): bevor eine NEUE Quest startet (Schritt 0)
      // und nur wenn Karten fällig sind, kurz auffrischen – einmal pro Quest.
      if (Game.shouldReviewGate() && this._gateClearedIdx !== Game.state.questIdx) {
        return this.openReviewGate(npcId);
      }
      return this.runQuestStep();
    }
    this.showNpcMenu(npcId);
  },

  /** Menü: Plaudern / Üben / Stapel-Spiel */
  showNpcMenu(npcId: string) {
    const drills = Game.practiceDrillsFor(npcId);
    const stackOk = npcId === "bo" && Game.state.completedQuests.includes("docker-list-containers");
    if (drills.length === 0 && !stackOk) {
      const lines = SMALLTALK[npcId] || ["…"];
      return this.showDialogue(npcId, [lines[Math.floor(Math.random() * lines.length)]]);
    }
    const npc = NPCS[npcId];
    this.dialogue = { npcId, lines: [], idx: 0, choice: { menu: true }, onDone: null };
    $("dlg-name").textContent = npc.name + " · " + npc.title;
    this.drawNpcPortrait($("dlg-portrait-canvas") as HTMLCanvasElement, npc);
    $("dlg-text").innerHTML = "Was kann ich für dich tun?";
    $("dlg-next").classList.add("hidden");
    const box = $("dlg-choices");
    box.innerHTML = "";
    const addBtn = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.innerHTML = label;
      b.onclick = fn;
      box.appendChild(b);
    };
    addBtn("💬 Plaudern", () => {
      const lines = SMALLTALK[npcId] || ["…"];
      this.closeDialogue();
      this.showDialogue(npcId, [lines[Math.floor(Math.random() * lines.length)]]);
    });
    if (drills.length > 0) addBtn("🏋️ Üben – 3 Aufgaben (gibt 🪙!)", () => {
      this.closeDialogue();
      this.startPractice(npcId);
    });
    if (stackOk) addBtn("🎮 Stapel-Spiel (Image-Schichten)", () => {
      this.closeDialogue();
      this.openStackGame();
    });
    addBtn("Nichts, schönen Tag! ⚓", () => this.closeDialogue());
    $("dialogue").classList.remove("hidden");
    this._initChoiceNav();
  },

  /* ---------- Tastatur-Navigation für Antwort-Buttons (↑/↓ + Enter, Ziffern) ---------- */
  _initChoiceNav() {
    this.choiceBtns = Array.from(document.querySelectorAll("#dlg-choices button"));
    this.choiceSel = 0;
    this._highlightChoice();
  },
  _highlightChoice() {
    if (!this.choiceBtns) return;
    this.choiceBtns.forEach((b: HTMLButtonElement, i: number) => b.classList.toggle("sel", i === this.choiceSel));
  },
  hasChoices() {
    return !!(this.choiceBtns && this.choiceBtns.length && !this.choiceBtns[0].disabled);
  },
  dlgMoveSel(delta: number) {
    if (!this.hasChoices()) return;
    const n = this.choiceBtns.length;
    this.choiceSel = (this.choiceSel + delta + n) % n;
    this._highlightChoice();
  },
  dlgActivateSel() {
    if (!this.hasChoices()) return false;
    const btn = this.choiceBtns[this.choiceSel];
    if (btn) { btn.click(); return true; }
    return false;
  },
  dlgPickNumber(n: number) {
    if (!this.hasChoices()) return;
    const btn = this.choiceBtns[n - 1];
    if (btn) { this.choiceSel = n - 1; this._highlightChoice(); btn.click(); }
  },

  closeDialogue() {
    this.dialogue = null;
    this.choiceBtns = null;
    $("dialogue").classList.add("hidden");
  },

});
