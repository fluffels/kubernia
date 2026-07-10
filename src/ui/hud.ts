import { Game } from "../game";
import { SFX } from "../sfx";
import { worldScene, interiorOpen } from "../runtime";
import { part, $, esc, NPCS, SMALLTALK } from "./shared";
import { HUD_ICONS, HUD_SEASON_ICONS, MENU_ICONS } from "../assets-data";
import { resolveTalkTarget } from "../hud/viewdecide";
import { TOAST_LIFE_MS, HINT_LIFE_MS, toastFadeDelaySeconds } from "../hud/toastlife";
import { enqueueAchievement, bundleCelebration, type Achievement } from "../hud/celebrate";

/** Signalflaggen-Farben fürs Erfolgs-Feier-Overlay (#223/#314): kräftige, maritime
 *  Palette für die Wimpelkette (dress ship) und den Flaggen-Konfetti-Regen. */
const SIGNAL_COLORS = ["#e03131", "#ffd43b", "#1971c2", "#f1f3f5", "#4dd0e1", "#2f9e44"];

export const hudUI = part({
  /* ========== HUD, Toasts, Alarm ========== */

  /** HUD-Statuszeilen-Pixel-Icons einmalig verdrahten (#645, Fundament-Slice #204):
   *  setzt die `src` der dauerhaft gleichen DOM-Icons (Münzen/Streak/Uhr). Das
   *  Saison-Icon ist dynamisch und wird in `setClock` je `seasonIndex` gesetzt. Läuft
   *  einmal beim UI-Modul-Laden (ui.ts) – die #hud-Elemente stehen statisch in index.html.
   *  Seit #648 verdrahtet dieselbe Routine auch die vier statischen Menü-Button-Icons
   *  (Weiterspielen/Sichern/Laden/Zurücksetzen) – ebenfalls dauerhaft gleich, ebenfalls
   *  statisch in index.html (#overlay-menu .menu-actions). */
  initHudIcons() {
    (<HTMLImageElement>$("hud-icon-coins")).src = HUD_ICONS.coins;
    (<HTMLImageElement>$("hud-icon-streak")).src = HUD_ICONS.streak;
    (<HTMLImageElement>$("hud-icon-time")).src = HUD_ICONS.time;
    (<HTMLImageElement>$("menu-icon-play")).src = MENU_ICONS.play;
    (<HTMLImageElement>$("menu-icon-save")).src = MENU_ICONS.save;
    (<HTMLImageElement>$("menu-icon-load")).src = MENU_ICONS.load;
    (<HTMLImageElement>$("menu-icon-reset")).src = MENU_ICONS.reset;
  },

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
  setClock(dateLabel: string, timeLabel: string, title: string, seasonIndex: number) {
    const sig = dateLabel + "|" + timeLabel + "|" + title;
    if (sig === this._lastClock) return;
    this._lastClock = sig;
    $("hud-date").textContent = dateLabel;
    $("hud-time").textContent = timeLabel;
    $("hud-clock").title = title;
    // Saison-Icon (#645): Index 0..3 → gerahmtes Pixel-Icon. Ein erneutes Setzen auf
    // dieselbe URL ist im Browser ein No-op (kein Neu-Laden), darum ohne Extra-Guard.
    const seasonSrc = HUD_SEASON_ICONS[seasonIndex];
    if (seasonSrc) (<HTMLImageElement>$("hud-icon-season")).src = seasonSrc;
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
      const GAME_LABELS: Record<typeof step.game, string> = { stack: "🎮 Stapel-Spiel", packing: "🎮 Pod-Packspiel", yamlstruct: "🎮 YAML-Bausteine", routing: "🎮 Routing-Lotse", driftheal: "🎮 Wunschzustand einstellen", rbaskeyring: "🎮 RBAC-Schlüsselbund" };
      const gameLabel = GAME_LABELS[step.game];
      el.innerHTML = "📜 <b>" + q.title + "</b> – Sprich <b>" + npc.name + "</b> an und wähle " + gameLabel;
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
    const beforeRank = Game.rank(); // vor addXp merken, damit das Popup „von → nach" zeigen kann
    const rankUp = Game.addXp(xp);
    const realCoins = coins > 0 ? Game.addCoins(coins) : 0;
    let msg = "+" + xp + " XP";
    if (realCoins > 0) msg += " · +" + realCoins + " 🪙";
    if (label) msg = label + " " + msg;
    this.toast(msg);
    SFX.coin();
    if (rankUp) {
      const to = Game.rank();
      this.celebrate({
        kind: "rank", icon: to.icon, title: to.name,
        detail: "zuvor: " + beforeRank.icon + " " + beforeRank.name,
      });
    }
    this.refreshHud();
  },

  /** Einen Erfolg feiern (#314): in die Warteschlange legen und – wenn der Spieler
   *  gerade frei ist – sofort als gebündeltes Feier-Popup zeigen. Verallgemeinert das
   *  Rang-Aufstieg-Feier (#223) auf ALLE Erfolgs-Arten (Level-Up/Album/Abkürzung/
   *  Historie): prominentes, mittiges Overlay, maritim mit Signalflaggen-Konfetti +
   *  Wimpelkette + Schiffsglocke, mit Enter/Leer/E schließbar. Läuft gerade ein
   *  Dialog/Terminal/Quiz/Minispiel, wird der Erfolg gemerkt und erst gezeigt, wenn
   *  der Spieler wieder frei ist (Flush in updatePrompt). */
  celebrate(a: Achievement) {
    this.enqueueCelebration(a);
    this.flushCelebrations();
  },

  /** Erfolg nur in die Warteschlange legen, OHNE sofort zu zeigen – damit mehrere im
   *  selben Tick erreichte Erfolge (z.B. Album-Einträge + Rang-Aufstieg beim Quest-
   *  Abschluss) zu EINEM Popup gebündelt und dann gemeinsam geflusht werden (#314). */
  enqueueCelebration(a: Achievement) {
    this.pendingCelebrations = enqueueAchievement(this.pendingCelebrations, a);
  },

  /** Die aufgelaufenen Erfolge als EIN gebündeltes Popup zeigen, sobald der Spieler
   *  frei ist (sonst No-op – updatePrompt holt es beim Freiwerden nach). Leert danach
   *  die Warteschlange. (#314) */
  flushCelebrations() {
    if (this.blocking() || this.dialogue) return;
    const view = bundleCelebration(this.pendingCelebrations);
    if (!view) return;
    this.pendingCelebrations = [];
    // Alle Texte stammen aus unserem eigenen Content – zur Sicherheit trotzdem escapen.
    $("celebrate-title").textContent = view.title;
    $("celebrate-quip").textContent = view.quip;
    const itemsEl = $("celebrate-items");
    itemsEl.className = "celebrate-items" + (view.items.length === 1 ? " single" : "");
    itemsEl.innerHTML = view.items.map(it =>
      '<div class="celebrate-item">' +
        '<span class="celebrate-item-icon" aria-hidden="true">' + esc(it.icon) + '</span>' +
        '<span class="celebrate-item-text">' +
          '<span class="celebrate-item-title">' + esc(it.title) + '</span>' +
          (it.detail ? '<span class="celebrate-item-detail">' + esc(it.detail) + '</span>' : '') +
        '</span>' +
      '</div>'
    ).join("");
    this._buildBunting();
    this._spawnFlagConfetti();
    $("overlay-celebrate").classList.remove("hidden");
    this.focusFirstIn($("overlay-celebrate"));
    SFX.shipBell();
  },

  /** Wimpelkette (dress ship) einmalig aufbauen: eine Reihe dreieckiger Signal-Wimpel. */
  _buildBunting() {
    const el = $("celebrate-bunting");
    if (el.childElementCount) return; // statischer Schmuck – nur einmal bauen
    let html = "";
    for (let i = 0; i < 13; i++) html += '<span class="pennant" style="--c:' + SIGNAL_COLORS[i % SIGNAL_COLORS.length] + '"></span>';
    el.innerHTML = html;
  },

  /** Signalflaggen-Konfetti-Regen: kleine bunte Wimpel trudeln von oben herab
   *  (die seemännische Version von Konfetti). Positionen/Timing zufällig gestreut. */
  _spawnFlagConfetti() {
    let html = "";
    for (let i = 0; i < 30; i++) {
      const left = Math.round(Math.random() * 100);
      const delay = (Math.random() * 0.9).toFixed(2);
      const dur = (1.9 + Math.random() * 1.5).toFixed(2);
      const rot = Math.round(Math.random() * 360);
      html += '<span class="flag-confetti" style="left:' + left + '%;--c:' +
        SIGNAL_COLORS[i % SIGNAL_COLORS.length] + ';--rot:' + rot + 'deg;animation-delay:' +
        delay + 's;animation-duration:' + dur + 's"></span>';
    }
    $("celebrate-confetti").innerHTML = html;
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

  /** Globaler roter Warnrahmen (#540): pulsiert am Bildschirmrand, solange eine Gefahr aktiv
   *  ist – bewusst DOM/HUD (nicht Phaser), damit man die Gefahr in JEDER Szene sieht (auch in
   *  Region/Innenraum, wo der Szenen-Alarm-Sprite fehlt). Der Alarm-Banner zeigt die Details. */
  setHazardFrame(active: boolean) {
    $("hazard-frame").classList.toggle("hidden", !active);
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
    // Frei zurück in der Welt: aufgelaufene Erfolgs-Feiern (#314, u.a. Rang #223)
    // nachholen, die während eines offenen Dialogs/Overlays zurückgehalten wurden.
    // Sobald das Popup aufpoppt, ist blocking() true → der Zweig greift nächste Frame
    // nicht erneut.
    if (this.pendingCelebrations.length) { this.flushCelebrations(); return; }
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
    // #500: Routing-Priorität (Shop → Review → Quest-Schritt[+Gate #222] → Menü)
    // liegt DOM-frei in uieval; hier nur Zustand hereinreichen + Verzweigung ausführen.
    const step = Game.currentStep();
    const questStepNpc =
      step && (step.type === "dialog" || step.type === "choice") ? step.npc : null;
    // Sanftes Wiederholungs-Gate (#222): bevor eine NEUE Quest startet und nur wenn
    // Karten fällig sind, kurz auffrischen – einmal pro Quest.
    const reviewGatePending =
      Game.shouldReviewGate() && this._gateClearedIdx !== Game.questIdx();
    switch (resolveTalkTarget(npcId, { shopNpcId: "pelle", reviewNpcId: "kralle", questStepNpc, reviewGatePending })) {
      case "shop": return this.openShop();
      case "review": return this.openReview();
      case "reviewGate": return this.openReviewGate(npcId);
      case "questStep": return this.runQuestStep();
      case "menu": return this.showNpcMenu(npcId);
    }
  },

  /** Menü: Plaudern / Üben / Minispiel. Welches Minispiel bei welchem NPC freischaltet
   *  (Vorbild #505 OVERLAYS): EINE Liste statt je einer eigenen `xyzOk`-Variable + eigenem
   *  `if` – neues Minispiel = ein Eintrag hier, statt die Methoden-Komplexität weiter zu
   *  treiben (#502-Gate). */
  npcMinigames(npcId: string) {
    return [
      { npc: "bo", quest: "docker-list-containers", label: "🎮 Stapel-Spiel (Image-Schichten)", open: () => this.openStackGame() },
      { npc: "juno", quest: "k8s-resource-limits", label: "🎮 Pod-Packspiel (auf Nodes verteilen)", open: () => this.openPackingGame() },
      { npc: "ada", quest: "k8s-apply-manifests", label: "🎮 YAML-Bausteine (Einrückung üben)", open: () => this.openYamlStructGame() },
      { npc: "ada", quest: "dns-service-discovery", label: "🎮 Routing-Lotse (Anfragen lotsen)", open: () => this.openRoutingGame() },
      { npc: "argo", quest: "gitops-drift-detection", label: "🎮 Wunschzustand einstellen (Self-Heal/Drift)", open: () => this.openDriftHealGame() },
      { npc: "vidar", quest: "k8s-rbac-clusterrole", label: "🎮 RBAC-Schlüsselbund (Least Privilege)", open: () => this.openRbacKeyringGame() },
    ].filter((m) => m.npc === npcId && Game.state.completedQuests.includes(m.quest));
  },

  showNpcMenu(npcId: string) {
    const drills = Game.practiceDrillsFor(npcId);
    const minigames = this.npcMinigames(npcId);
    if (drills.length === 0 && minigames.length === 0) {
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
    for (const m of minigames) addBtn(m.label, () => { this.closeDialogue(); m.open(); });
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
    this.blurToGame(); // #506: Fokus zurück ins Spiel
  },

});
