import { Game } from "../game";
import { SFX } from "../sfx";
import { dialogueNav } from "../overlaykbd";
import { fmtCmd } from "../markup";
import type { ChoiceStep, ChoiceOption } from "../types";
import { part, $, NPCS, shuffled } from "./shared";

export const dialogUI = part({
  /* ========== Dialog ========== */
  showDialogue(npcId: string, lines: string[], onDone?: () => void) {
    const npc = NPCS[npcId];
    this.dialogue = { npcId, lines, idx: 0, onDone, choice: null };
    $("dlg-name").textContent = npc.name + " · " + npc.title;
    this.drawNpcPortrait($("dlg-portrait-canvas") as HTMLCanvasElement, npc);
    $("dlg-choices").innerHTML = "";
    $("dialogue").classList.remove("hidden");
    this.renderDialogueLine();
  },

  renderDialogueLine() {
    const d = this.dialogue;
    $("dlg-text").innerHTML = fmtCmd(d.lines[d.idx]);
    const fwd = d.idx < d.lines.length - 1 ? "▼ weiter (E)" : "✔ fertig (E)";
    // #310: Lese-Rückblick – ab der zweiten Zeile sichtbar machen, dass man eine
    // Zeile zurückblättern kann (analog zum „weiter"-Hinweis, rein per Tastatur).
    const back = d.idx > 0 ? '<span class="dlg-back">◀ zurück (←)</span>' : "";
    $("dlg-next").innerHTML = back + fwd;
    $("dlg-next").classList.remove("hidden");
  },

  advanceDialogue() {
    const d = this.dialogue;
    if (!d || d.choice) return;
    const act = dialogueNav(d.idx, d.lines.length, 1);
    if (act.kind === "show") {
      d.idx = act.idx;
      this.renderDialogueLine();
    } else {
      this.closeDialogue();
      if (d.onDone) d.onDone();
    }
  },

  /** #310: In einem mehrzeiligen Lese-Dialog eine Zeile zurück, um Vorheriges
   *  nochmal zu lesen. Reiner Lese-Rückblick: ändert keinen Spielzustand und
   *  dreht keine Auswahl zurück (während einer Frage/eines Menüs ist `d.choice`
   *  gesetzt → No-op); auf der ersten Zeile geclampt (`dialogueNav` → „stay"). */
  dialogueBack() {
    const d = this.dialogue;
    if (!d || d.choice) return;
    const act = dialogueNav(d.idx, d.lines.length, -1);
    if (act.kind === "show") {
      d.idx = act.idx;
      this.renderDialogueLine();
    }
  },

  showChoice(step: ChoiceStep, onDone: () => void) {
    const npc = NPCS[step.npc];
    this.dialogue = { npcId: step.npc, lines: [], idx: 0, onDone, choice: step };
    $("dlg-name").textContent = npc.name + " · " + npc.title;
    this.drawNpcPortrait($("dlg-portrait-canvas") as HTMLCanvasElement, npc);
    $("dlg-text").innerHTML = "🤔 " + fmtCmd(step.q);
    $("dlg-next").textContent = "↑/↓ wählen · Enter bestätigen";
    $("dlg-next").classList.remove("hidden");
    const box = $("dlg-choices");
    box.innerHTML = "";
    for (const opt of shuffled<ChoiceOption>(step.options)) {
      const btn = document.createElement("button");
      btn.innerHTML = fmtCmd(opt.t);
      btn.onclick = () => this.answerChoice(step, opt, btn);
      box.appendChild(btn);
    }
    $("dialogue").classList.remove("hidden");
    this._initChoiceNav();
  },

  answerChoice(step: ChoiceStep, opt: ChoiceOption, btn: HTMLButtonElement) {
    const d = this.dialogue;
    if (!d || d.answered) return;
    d.answered = true;
    this.choiceBtns = null;
    document.querySelectorAll("#dlg-choices button").forEach(b => {
      (b as HTMLButtonElement).disabled = true;
      b.classList.remove("sel");
      if (b === btn) b.classList.add(opt.ok ? "correct" : "wrong");
    });
    // reviewId ist optional am Choice-Schritt; choiceResult behandelt einen leeren
    // String identisch zu „keine Karte" (if (itemId)), daher ist "" hier verhaltensgleich.
    Game.choiceResult(step.reviewId ?? "", opt.ok);
    if (opt.ok) this.reward(12, 6);
    else SFX.wrong();
    $("dlg-text").innerHTML = (opt.ok ? "✅ " : "❌ ") + fmtCmd(opt.reply);
    $("dlg-next").textContent = "✔ weiter (E)";
    $("dlg-next").classList.remove("hidden");
    d.choice = null;
    d.lines = [""];
    d.idx = 0;
  },

});
