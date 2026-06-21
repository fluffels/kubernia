import { Game } from "../game";
import { SFX } from "../sfx";
import { lockedAbbrevInInput, abbrevLockHint } from "../content/abbrev";
import { part, $, esc, CMD_MAX_ATTEMPTS, shuffled } from "./shared";

export const quizUI = part({
  /* ========== Krabben-Quiz ========== */
  openReview() {
    this.closeOverlays();
    $("overlay-review").classList.remove("hidden");
    const total = Object.keys(Game.state.review).length;
    const dueIds = Game.dueReviewItems(10);
    if (dueIds.length === 0) {
      // Kein Dead-End mehr: solange Karten existieren, bieten wir freies Üben an.
      $("review-body").innerHTML = total === 0
        ? `<div style="text-align:center">
            <div style="font-size:3em">🦀</div>
            <p>„Schnipp schnapp! Noch keine Karten im Stapel – schließe erst eine Quest ab, dann üben wir täglich!“</p>
            <button class="primary" data-action="closeOverlays">Alles klar, Kralle!</button></div>`
        : `<div style="text-align:center">
            <div style="font-size:3em">🦀</div>
            <p>„Heute ist nichts mehr fällig – dein Wissen ist frisch wie der Morgenfang! Aber wir können <b>frei üben</b>, so oft du willst. Schnipp!“</p>
            <div class="actions">
              <button class="primary" data-action="startFreePractice">🦀 Frei üben</button>
              <button data-action="closeOverlays">Später</button>
            </div></div>`;
      return;
    }
    this.review = { ids: dueIds, idx: 0, right: 0, assisted: 0, free: false };
    this.renderReviewItem();
  },

  /** Wiederholungs-Gate (#222): kurz vor dem Start einer neuen Quest fällige Karten
   *  auffrischen. Freundliche Ankündigung, dann die fälligen Karten; danach geht es
   *  automatisch in die Quest weiter (siehe Gate-Abschluss in renderReviewItem).
   *  Seit #323: feuert auch nach ≥ 3 Quests ohne Gate (Quest-Count-Gate) – zeigt dann
   *  einen sanften Nudge zum freien Üben statt hartem Pflicht-Review. */
  openReviewGate(npcId: string): void {
    this.closeOverlays();
    Game.state.questsSinceGate = 0; // Gate feuert: Zähler immer zurücksetzen (#323).
    Game.save();
    const dueIds = Game.dueReviewItems(10);
    if (dueIds.length === 0) {
      // Quest-Count-Gate (#323): nichts fällig, aber ≥ 3 Quests am Stück – sanfter Nudge.
      this._gateClearedIdx = Game.state.questIdx;
      $("overlay-review").classList.remove("hidden");
      $("review-body").innerHTML = `<div style="text-align:center">
        <div style="font-size:3em">🦀</div>
        <p>„Schon eine ganze Weile unterwegs! Nichts ist überfällig, aber ein bisschen freies Üben schadet nie – Karten bleiben länger sitzen. Willst du kurz mit mir üben?"</p>
        <button class="primary" id="nudge-practice">Kurz üben mit Kralle ⚓</button>
        <button id="nudge-skip">Lieber direkt weiter ⚓</button></div>`;
      $("nudge-practice").onclick = () => { this.closeOverlays(); this.startFreePractice(); };
      $("nudge-skip").onclick = () => { this.closeOverlays(); this.talkTo(npcId); };
      return;
    }
    $("overlay-review").classList.remove("hidden");
    this.review = { ids: dueIds, idx: 0, right: 0, free: false, gate: { npcId, questIdx: Game.state.questIdx } };
    const n = dueIds.length;
    const kartenWort = n === 1 ? "1 Karte" : n + " Karten";
    $("review-body").innerHTML = `<div style="text-align:center">
      <div style="font-size:3em">🦀</div>
      <p>„Halt, Lotse! Bevor die nächste Aufgabe losgeht, frischen wir kurz <b>${kartenWort}</b> auf – dann sitzt das Gelernte für immer. Schnipp, das geht fix!“</p>
      <button class="primary" id="gate-start">${kartenWort} auffrischen, dann weiter ⚓</button></div>`;
    $("gate-start").onclick = () => this.renderReviewItem();
  },

  /** Freies Üben: zieht aus ALLEN gelernten Karten, beliebig oft. Lässt den
   *  Spaced-Repetition-Plan unangetastet und gibt keine Belohnung (kein Farmen). */
  startFreePractice() {
    $("overlay-review").classList.remove("hidden");
    const ids = Game.freeReviewItems(10);
    if (ids.length === 0) { this.openReview(); return; }
    this.review = { ids, idx: 0, right: 0, assisted: 0, free: true };
    this.renderReviewItem();
  },

  renderReviewItem(): void {
    const r = this.review;
    if (r.idx >= r.ids.length) {
      const free = !!r.free;
      if (!free) {
        // nur die tägliche fällige Runde zählt für Statistik & Bonus
        Game.state.stats.reviews++;
        Game.save();
        if (r.right === r.ids.length) this.reward(10, 10, "🌟 Perfekte Quizrunde!");
      }
      // Wiederholungs-Gate (#222): erledigt -> nicht erneut blockieren, weiter zur Quest.
      if (r.gate) {
        this._gateClearedIdx = r.gate.questIdx;
        const npcId = r.gate.npcId;
        $("review-body").innerHTML = `<div style="text-align:center">
          <div style="font-size:3em">🦀</div>
          <h2>Aufgefrischt! ${r.right} von ${r.ids.length} richtig.</h2>
          <p class="dim">Schnipp – jetzt sitzt's wieder. Weiter geht dein Abenteuer!</p>
          <button class="primary" id="gate-continue">Weiter geht's! ⚓</button></div>`;
        $("gate-continue").onclick = () => { this.closeOverlays(); this.talkTo(npcId); };
        this.review = null;
        return;
      }
      $("review-body").innerHTML = `<div style="text-align:center">
        <div style="font-size:3em">🦀</div>
        <h2>${r.right} von ${r.ids.length} richtig!</h2>
        ${r.assisted ? `<p class="dim">🪄 ${r.assisted} mit Hilfe gelöst – die üben wir zur Sicherheit bald nochmal.</p>` : ""}
        <p class="dim">${free
          ? "Freies Üben – so oft du willst! (zählt nicht in den täglichen Wiederholungs-Plan)"
          : "Richtige Karten kommen seltener wieder, falsche öfter – bis alles sitzt. Schnipp!"}</p>
        <div class="actions">
          <button class="primary" data-action="startFreePractice">🦀 Nochmal frei üben</button>
          <button data-action="closeOverlays">Zurück ins Abenteuer</button>
        </div></div>`;
      this.review = null;
      return;
    }
    const itemId = r.ids[r.idx];
    const content = Game.findReviewContent(itemId);
    if (!content) { r.idx++; return this.renderReviewItem(); }
    r.current = { itemId, content, answered: false, attempts: 0 };

    let body;
    if (content.kind === "quiz") {
      const q = content.q!;
      r.current.order = shuffled(q.options.map((_: unknown, i: number) => i));
      this.reviewSel = -1;   // Tastatur-Auswahl (#258) je Karte zurücksetzen
      body = `<div class="quiz-q">${q.q}</div>
        <div class="quiz-options" id="quiz-options">
          ${r.current.order.map((oi: number, i: number) => `<button data-action="answerReviewQuiz" data-oi="${oi}"><span class="qnum">${i + 1}</span>${esc(q.options[oi])}</button>`).join("")}
        </div><div id="review-explain"></div>`;
    } else {
      const card = content.card!;
      body = `<div class="quiz-q">⌨️ ${card.q}</div>
        <div class="review-cmd-row"><span class="term-prompt">crew@hafen:~$</span>
          <input type="text" id="review-input" autocomplete="off" spellcheck="false"
            placeholder="Befehl eintippen, Enter drücken …"></div>
        <div id="review-explain"></div>`;
    }
    $("review-body").innerHTML = `<p class="dim">🦀 Karte ${r.idx + 1} von ${r.ids.length} · richtig: ${r.right}</p>` + body;
    const inp = $("review-input");
    if (inp) inp.focus();
  },

  answerReviewQuiz(optionIndex: number) {
    const r = this.review;
    if (!r || r.current.answered) return;
    r.current.answered = true;
    const q = r.current.content.q;
    const correct = optionIndex === q.correct;
    document.querySelectorAll("#quiz-options button").forEach(btn => {
      const oi = parseInt((btn as HTMLElement).dataset.oi!, 10);
      (btn as HTMLButtonElement).disabled = true;
      btn.classList.remove("sel");   // Tastatur-Markierung weg, sobald korrekt/falsch greift (#258)
      if (oi === q.correct) btn.classList.add("correct");
      else if (oi === optionIndex) btn.classList.add("wrong");
    });
    this.reviewSel = -1;
    this.finishReviewItem(correct, q.explain);
  },

  /** Tastatursteuerung der Wissensrunde (#258). Wird aus dem globalen Keydown
   *  (main.ts) aufgerufen, solange das Review-Overlay offen ist. Gibt `true`
   *  zurück, wenn die Taste verarbeitet wurde (dann kein Spieler-/Default-Effekt).
   *  - Offene Quiz-Frage: Ziffern 1–n wählen direkt, ↑/↓ markieren, Enter bestätigt.
   *  - Beantwortet / Zwischen- & Endscreens / Gate: Enter/Leertaste löst den
   *    sichtbaren Primär-Button („Weiter ➡️", „Frei üben", Gate-Weiter) aus.
   *  Die Befehls-Eingabe hat ihren eigenen Enter-Handler (answerReviewCmd) und
   *  wird von main.ts gar nicht erst hierher geleitet (Fokus liegt im INPUT). */
  reviewKey(k: string, ev: KeyboardEvent): boolean {
    const r = this.review;
    if (r && r.current && !r.current.answered && r.current.content.kind === "quiz") {
      const order: number[] = r.current.order;
      if (/^[1-9]$/.test(k)) {
        const pos = Number(k) - 1;
        if (pos < order.length) { ev.preventDefault(); this.answerReviewQuiz(order[pos]); }
        return true;
      }
      if (k === "ArrowDown" || k === "ArrowUp") {
        const n = order.length;
        const start = k === "ArrowDown" ? -1 : 0;
        const cur = this.reviewSel < 0 ? start : this.reviewSel;
        this.reviewSel = ((cur + (k === "ArrowDown" ? 1 : -1)) % n + n) % n;
        this.highlightReviewOption();
        ev.preventDefault();
        return true;
      }
      if (k === "Enter" || k === " ") {
        if (this.reviewSel >= 0 && this.reviewSel < order.length) {
          ev.preventDefault();
          this.answerReviewQuiz(order[this.reviewSel]);
        }
        return true;   // offene Frage „schluckt" Enter/Leer, damit nichts dahinter feuert
      }
      return false;
    }
    // beantwortet / Zwischen-/Endscreen / Gate: Primär-Button per Enter/Leertaste
    if (k === "Enter" || k === " ") {
      const btn = $("review-body").querySelector(
        "button.primary, #gate-start, #gate-continue, [data-action='nextReviewItem']",
      ) as HTMLButtonElement | null;
      if (btn) { ev.preventDefault(); btn.click(); return true; }
    }
    return false;
  },

  /** Hebt die per Pfeiltasten markierte Quiz-Option hervor (#258). */
  highlightReviewOption() {
    document.querySelectorAll("#quiz-options button").forEach((b, i) => {
      b.classList.toggle("sel", i === this.reviewSel);
    });
  },

  answerReviewCmd(ev: KeyboardEvent) {
    if (ev.key !== "Enter") return;
    const r = this.review;
    if (!r || r.current.answered) return;
    // Das Event kommt vom #review-input-Feld (delegiert in overlay.ts) – ein Text-Input.
    const input = ev.target as HTMLInputElement;
    const line = input.value.trim().replace(/\s+/g, " ");
    if (!line) return;
    const card = r.current.content.card;
    const correct = card.accept.some((re: RegExp) => re.test(line));
    // #299: richtige Lösung, aber per noch gesperrtem Kürzel → sanfter Hinweis,
    // erneut tippen lassen (NICHT als Fehlversuch zählen, sonst würde nach
    // CMD_MAX_ATTEMPTS die Kürzel-Lösung verraten). Langform gilt immer.
    const lockedHit = correct ? lockedAbbrevInInput(line, (id) => Game.isAbbrevUnlocked(id)) : undefined;
    if (lockedHit) {
      $("review-explain").innerHTML = `<div class="quiz-explain">${abbrevLockHint(lockedHit)}</div>`;
      input.disabled = false; input.focus(); input.select();
      return;
    }
    if (correct) {
      // Beim 1. Versuch richtig zählt voll; erst nach Retry richtig = "mit Hilfe gelöst" (#234).
      const assisted = r.current.attempts > 0;
      r.current.answered = true;
      input.disabled = true;
      this.finishReviewItem(true, card.explain || "", assisted);
      return;
    }
    // Falsch: nicht weiterspringen, sondern erneut tippen lassen (#234). Begründung
    // warum falsch zeigen (#233) – aber NICHT die Musterlösung, sonst wird sie nur
    // abgeschrieben statt gekonnt. Nach CMD_MAX_ATTEMPTS Versuchen die Lösung zeigen.
    r.current.attempts++;
    SFX.wrong();
    if (r.current.attempts >= CMD_MAX_ATTEMPTS) { this.revealReviewCmd(); return; }
    const remaining = CMD_MAX_ATTEMPTS - r.current.attempts;
    $("review-explain").innerHTML = `
      <div class="quiz-explain">❌ <b>Nicht ganz.</b> ${card.explain || ""}
        <div class="dim" style="margin-top:.4em">🦀 „Nochmal tippen, Matrose!“ – noch ${remaining} Versuch${remaining === 1 ? "" : "e"}.</div></div>
      <div class="actions"><button data-action="revealReviewCmd">Lösung zeigen ➡️</button></div>`;
    // Eingabefeld wieder freigeben und markieren, damit gleich neu getippt werden kann.
    input.disabled = false;
    input.focus();
    input.select();
  },

  /** Bricht den Tipp-Versuch bei einer Befehls-Karte ab: zeigt die Musterlösung
   *  und wertet die Karte als "nicht gekonnt" (aufgegeben / Versuche aufgebraucht, #234). */
  revealReviewCmd() {
    const r = this.review;
    if (!r || r.current.answered || r.current.content.kind !== "cmd") return;
    r.current.answered = true;
    const inp = $("review-input") as HTMLInputElement | null;
    if (inp) inp.disabled = true;
    const card = r.current.content.card;
    this.finishReviewItem(false, "Die Lösung: <code>" + esc(card.solution) + "</code>. " + (card.explain || ""));
  },

  finishReviewItem(correct: boolean, explainHtml: string, assisted = false) {
    const r = this.review;
    // "Mit Hilfe gelöst" (erst nach Retry richtig) zählt fürs Spaced Repetition NICHT
    // als sicher gekonnt – die Karte soll bald wiederkommen (#234, offene Frage).
    const secure = correct && !assisted;
    if (r.free) {
      // Freies Üben: SR-Plan unangetastet lassen, keine Belohnung (kein Farmen)
      if (correct) { if (secure) r.right++; else r.assisted++; SFX.success(); }
      else SFX.wrong();
    } else {
      Game.reviewResult(r.current.itemId, secure);
      if (correct) {
        if (secure) { r.right++; this.reward(4, 3); }
        else { r.assisted++; SFX.success(); }   // mit Hilfe: kein voller Reward
      } else SFX.wrong();
    }
    const head = correct
      ? (assisted
          ? "✅ <b>Richtig – mit Hilfe gelöst.</b> 🦀 Die Karte kommt zur Sicherheit bald nochmal."
          : "✅ <b>Richtig!</b> Schnipp-schnapp-applaus! 🦀")
      : "❌ <b>Nicht ganz.</b>";
    $("review-explain").innerHTML = `
      <div class="quiz-explain">${head} ${explainHtml}</div>
      <div class="actions"><button class="primary" data-action="nextReviewItem">Weiter ➡️</button></div>`;
  },

  nextReviewItem() {
    this.review.idx++;
    this.renderReviewItem();
  },

});
