import { Game } from "../game";
import { SFX, MUSIC_THEMES } from "../sfx";
import { resolveOverlayKey, nextFocusIndex } from "../hud/overlaykbd";
import { BLOCKING_OVERLAY_IDS, KEYNAV_OVERLAY_IDS } from "./overlays";
import { part, $, esc, sheetImgs, type UINpc } from "./shared";

/** „Zuletzt gespielt" grob als Text fürs Slot-Listing (#306). */
function slotRelTime(ms: number): string {
  if (!ms) return "noch nie gespielt";
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return "heute gespielt";
  if (days === 1) return "gestern gespielt";
  if (days < 30) return `vor ${days} Tagen`;
  const months = Math.floor(days / 30);
  return months <= 1 ? "vor 1 Monat" : `vor ${months} Monaten`;
}

export const overlayUI = part({
  /* ========== Event-Delegation ==========
   * Ein einziger delegierter Listener am document übersetzt data-action-
   * Attribute in UI-Methoden – ersetzt die früheren onclick="UI.x()"-Inline-
   * Handler (die den globalen window.UI-Shim brauchten). Auch dynamisch
   * erzeugte Buttons in den Overlays sind damit ohne Neu-Verdrahtung
   * abgedeckt. Wird einmalig beim Start aus main.ts aufgerufen. */
  bindEvents() {
    // data-action → Handler statt langem switch (#565): jeder Handler bekommt das
    // Trigger-Element (für data-arg/data-on/data-oi). Die Arrows binden `this` über
    // den Closure – so bleibt der delegierte Listener selbst verzweigungsarm.
    const actions: Record<string, (el: HTMLElement) => void> = {
      openMenu: () => this.openMenu(),
      closeOverlays: () => this.closeOverlays(),
      exportSave: () => this.exportSave(),
      resetGame: () => this.resetGame(),
      importPick: () => ($("save-import") as HTMLInputElement).click(),
      newSlot: () => this.newSlot(),
      loadSlot: el => { if (el.dataset.arg) this.loadSlot(el.dataset.arg); },
      renameSlot: el => { if (el.dataset.arg) this.renameSlot(el.dataset.arg); },
      deleteSlot: el => { if (el.dataset.arg) this.deleteSlot(el.dataset.arg); },
      termHint: () => this.termHint(),
      termSolution: () => this.termSolution(),
      viewQuest: el => { if (el.dataset.arg) this.viewQuest(el.dataset.arg); },
      questLogBack: () => this.questLogBack(),
      openAlbum: () => this.openAlbum(),
      viewAlbumPage: el => { if (el.dataset.arg) this.viewAlbumPage(el.dataset.arg); },
      albumBack: () => this.albumBack(),
      replayQuest: el => { if (el.dataset.arg) this.replayQuest(el.dataset.arg); },
      exitReplay: () => this.exitReplay(),
      buyItem: el => { if (el.dataset.arg) this.buyItem(el.dataset.arg); },
      toggleItem: el => { if (el.dataset.arg) this.toggleItem(el.dataset.arg, el.dataset.on === "1"); },
      startFreePractice: () => this.startFreePractice(),
      nextReviewItem: () => this.nextReviewItem(),
      answerReviewQuiz: el => this.answerReviewQuiz(Number(el.dataset.oi)),
      revealReviewCmd: () => this.revealReviewCmd(),
    };
    document.addEventListener("click", ev => {
      const el = (ev.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
      if (!el) return;
      const action = el.dataset.action;
      if (action) actions[action]?.(el);
    });
    // Audio-Regler/-Schalter im Menü: Checkboxen feuern "change", Slider "input".
    // Beide delegiert am document abgefangen (Block wird dynamisch erzeugt).
    const onAudio = (ev: Event) => {
      const el = (ev.target as HTMLElement).closest("[data-audio]") as HTMLInputElement | null;
      if (el) this.onAudioControl(el);
      const setting = (ev.target as HTMLElement).closest("[data-setting]") as HTMLInputElement | null;
      if (setting) this.onSettingControl(setting);
    };
    document.addEventListener("change", onAudio);
    document.addEventListener("input", onAudio);
    // Spielstand-Datei laden (früher inline onchange am <input>)
    ($("save-import") as HTMLInputElement).addEventListener("change", ev => this.importSave(ev));
    // Quiz-Befehlseingabe: Enter wertet aus. Das Eingabefeld wird dynamisch in
    // #review-body erzeugt, darum delegiert am stabilen Container lauschen.
    $("review-body").addEventListener("keydown", ev => {
      if ((ev.target as HTMLElement).id === "review-input") this.answerReviewCmd(ev);
    });
  },

  drawPortrait(canvas: HTMLCanvasElement, idx: number) {
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const img = sheetImgs.dungeon;
    const sx = (idx % 12) * 16, sy = Math.floor(idx / 12) * 16;
    if (img.complete) ctx.drawImage(img, sx, sy, 16, 16, 0, 0, canvas.width, canvas.height);
    else img.addEventListener("load", () => ctx.drawImage(img, sx, sy, 16, 16, 0, 0, canvas.width, canvas.height), { once: true });
  },

  // Ganzes PixelLab-Bild (z.B. Haustier) zentriert in ein Icon-Canvas zeichnen (contain).
  drawTexIcon(canvas: HTMLCanvasElement, texKey: string) {
    const img = sheetImgs[texKey];
    if (!img) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const s = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    if (img.complete && img.naturalWidth) draw();
    else img.addEventListener("load", draw, { once: true });
  },

  // NPC-Porträt aus der PixelLab-Figur (Kopf/Schulter-Ausschnitt der 48x48-Textur),
  // mit Fallback aufs alte Kenney-Icon, falls die Figur (noch) keine tex hat.
  drawNpcPortrait(canvas: HTMLCanvasElement, npc: UINpc) {
    const img = npc && npc.tex ? sheetImgs[npc.tex] : null;
    if (!img) { this.drawPortrait(canvas, npc.sprite); return; }
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 11, 4, 26, 26, 0, 0, canvas.width, canvas.height);
    };
    if (img.complete && img.naturalWidth) draw();
    else img.addEventListener("load", draw, { once: true });
  },

  /* ========== Blockierung ========== */
  blocking() {
    return !!this.dialogue || BLOCKING_OVERLAY_IDS.some(id => !$(id).classList.contains("hidden"));
  },

  closeOverlays() {
    BLOCKING_OVERLAY_IDS.forEach(id => $(id).classList.add("hidden"));
    if (this.practice && this.practice.idx >= this.practice.drills.length) this.practice = null;
    this.blurToGame();
  },

  /* ---------- Fokus-Management & Fokusfalle für Modals (#506) ----------
   * Barrierefreiheit: ohne diese Schicht wanderte der Tab-Fokus aus einem offenen
   * Modal in die Hintergrund-Elemente (das Spiel dahinter), und Screenreader-Nutzer
   * verloren die Orientierung. Zentral fürs ganze Overlay-Register (#505) statt je
   * Modal: beim Öffnen den Fokus ins Modal ziehen, Tab zyklisch darin halten
   * (Fokusfalle), beim Schließen den Fokus zurück ins Spiel geben. Die reine
   * Index-Mathematik der Falle liegt in `overlaykbd.ts` (nextFocusIndex). */

  /** Fokussierbare, sichtbare, aktive Knoten eines Modals in DOM-Reihenfolge. */
  _focusables(root: HTMLElement): HTMLElement[] {
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return (Array.from(root.querySelectorAll(sel)) as HTMLElement[])
      // offsetParent === null blendet display:none-Knoten aus (auch in versteckten
      // Panels); disabled-Buttons sollen den Fokus nicht bekommen.
      .filter(el => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
  },

  /** Das gerade offene, fokusfähige Modal (Dialog hat Vorrang vor den Panels) – oder null. */
  _openModalEl(): HTMLElement | null {
    if (this.dialogue) return $("dialogue");
    const id = BLOCKING_OVERLAY_IDS.find(x => !$(x).classList.contains("hidden"));
    return id ? $(id) : null;
  },

  /** Beim Öffnen den Fokus ins Modal ziehen: bevorzugt den Primär-Button
   *  (z.B. „Weiterspielen"), sonst den ersten fokussierbaren Knoten. So ist ein
   *  Modal sofort per Tastatur bedienbar und Screenreader lesen den Dialog vor. */
  focusFirstIn(root: HTMLElement) {
    const f = this._focusables(root);
    if (!f.length) return;
    (f.find((el: HTMLElement) => el.classList.contains("primary")) ?? f[0]).focus();
  },

  /** Tab/Shift+Tab in einer Fokusfalle halten. Liefert true, wenn ein Modal offen
   *  war (dann ist die Taste verarbeitet); sonst false (Aufrufer macht weiter).
   *  Wird aus main.ts VOR dem INPUT-Sonderfall aufgerufen, damit die Falle auch
   *  greift, während das Terminal-/Quiz-Eingabefeld den Fokus hat. */
  trapFocus(ev: KeyboardEvent): boolean {
    const modal = this._openModalEl();
    if (!modal) return false;
    ev.preventDefault(); // in einem Modal verlässt Tab es nie
    const f = this._focusables(modal);
    const target = nextFocusIndex(f.length, f.indexOf(document.activeElement as HTMLElement), ev.shiftKey);
    if (target !== null) f[target].focus();
    return true;
  },

  /** Beim Schließen den Fokus zurück ins Spiel geben (aufs fokussierbare
   *  #game-container-Canvas, tabindex=-1 in index.html) – sonst bliebe er auf dem
   *  gerade versteckten Modal-Button hängen. */
  blurToGame() {
    $("game-container").focus();
  },

  /* ---------- Generische Tastatur-Bedienung einfacher Modals (#283) ----------
   * Blockierende Overlays ohne eigene Navigation (Stapel-Spiel, Shop, Logbuch,
   * Menü) ganz ohne Maus bedienbar machen: ↑/↓ (w/s) wandert über die Buttons,
   * Enter/Leer/E löst den markierten – sonst den Primär-Button – aus. Dialog,
   * Wissensrunde (reviewKey) und Terminal (Eingabefeld) haben eigene Handler und
   * sind hier bewusst NICHT gelistet. Die Entscheidung selbst liegt im puren,
   * unit-getesteten `overlaykbd.ts`; hier nur die DOM-Anbindung. */
  overlayKey(k: string, ev: KeyboardEvent): boolean {
    const ov = KEYNAV_OVERLAY_IDS.map($).find(el => !el.classList.contains("hidden"));
    if (!ov) return false;
    const btns = Array.from(ov.querySelectorAll("button")) as HTMLButtonElement[];
    if (!btns.length) return false;
    const current = btns.findIndex(b => b.classList.contains("sel"));
    const res = resolveOverlayKey(btns.map(b => ({ disabled: b.disabled, primary: b.classList.contains("primary") })), current, k);
    if (!res) return false;
    ev.preventDefault();
    if (res.kind === "nav") {
      btns.forEach((b, i) => b.classList.toggle("sel", i === res.sel));
      btns[res.sel].focus();
    } else {
      btns[res.index].click();
    }
    return true;
  },

  /* ========== Menü / Pause ========== */
  openMenu() {
    this.closeOverlays();
    this.renderSlots();
    this.renderAudioSettings();
    this.renderEventSettings();
    $("overlay-menu").classList.remove("hidden");
    this.focusFirstIn($("overlay-menu"));
  },

  /** Spielstände-Block im Menü (#306): Liste aller Slots + Wechseln/Umbenennen/Löschen/Neu.
   *  Der aktive Slot wird hervorgehoben und nicht „geladen"; den letzten Slot kann man nicht
   *  löschen (es soll immer mindestens einer bleiben). */
  renderSlots() {
    const slots = Game.slots();
    const canDelete = slots.length > 1;
    const rows = slots.map(s => {
      const meta = s.isNew
        ? '<span class="slot-meta dim">🆕 noch nicht gespielt</span>'
        : '<span class="slot-meta">' + s.rankIcon + " " + esc(s.rankName) +
          " · Quest " + Math.min(s.questIdx + 1, s.questTotal) + "/" + s.questTotal +
          " · " + slotRelTime(s.lastSeen) + "</span>";
      const title = '<span class="slot-name">' + esc(s.name) + "</span>" +
        (s.active ? ' <span class="slot-badge">▶ aktiv</span>' : "");
      const btns: string[] = [];
      if (!s.active) btns.push('<button data-action="loadSlot" data-arg="' + s.id + '">📂 Laden</button>');
      btns.push('<button data-action="renameSlot" data-arg="' + s.id + '" title="Umbenennen">✏️</button>');
      if (canDelete) btns.push('<button class="danger" data-action="deleteSlot" data-arg="' + s.id + '" title="Löschen">🗑️</button>');
      return '<div class="slot-row' + (s.active ? " slot-active" : "") + '">' +
        '<div class="slot-info">' + title + "<br>" + meta + "</div>" +
        '<div class="slot-buttons">' + btns.join("") + "</div></div>";
    }).join("");
    $("menu-slots").innerHTML =
      '<h3 class="menu-audio-title">💾 Spielstände</h3>' +
      '<div class="slot-list">' + rows + "</div>" +
      '<button data-action="newSlot" class="slot-new">➕ Neuer Spielstand</button>';
  },

  /** Spiel-Feel-Block im Menü (#71): Frequenz/Härte der Zufalls-Events regelbar
   *  bis hin zu "Cozy"/"Aus". Spiegelt Game.state.settings.events. */
  renderEventSettings() {
    const cur = Game.state.settings.events;
    const opts: { mode: import("../types").EventMode; label: string }[] = [
      { mode: "normal", label: "🌊 Normal" },
      { mode: "cozy", label: "🍵 Cozy" },
      { mode: "off", label: "🌴 Aus" },
    ];
    const radios = opts.map(o =>
      '<label><input type="radio" name="kq-events" data-setting="events" value="' + o.mode + '"' +
      (cur === o.mode ? " checked" : "") + "> " + o.label + "</label>"
    ).join("");
    $("menu-events").innerHTML =
      '<h3 class="menu-audio-title">⛈️ Stürme &amp; Piraten</h3>' +
      '<div class="audio-row">' + radios + "</div>" +
      '<div class="dim">Cozy macht Zufalls-Events seltener &amp; sanfter und mildert den Verdienst-Ausfall kaputter Dienste. „Aus" schaltet sie ganz ab – entspanntes Lernen ohne Zeitdruck.</div>';
  },

  /** Audio-Block im Menü neu aufbauen (spiegelt Game.state.audio). */
  renderAudioSettings() {
    const a = Game.state.audio;
    const pct = (v: number) => Math.round(v * 100);
    const trackOpts = MUSIC_THEMES.map(t =>
      '<option value="' + t.id + '"' + (a.track === t.id ? " selected" : "") + ">" + t.label + "</option>"
    ).join("");
    $("menu-audio").innerHTML =
      '<h3 class="menu-audio-title">🔊 Audio</h3>' +
      '<div class="audio-row">' +
      '<label><input type="checkbox" data-audio="music"' + (a.music ? " checked" : "") + '> 🎵 Musik</label>' +
      '<input type="range" min="0" max="100" value="' + pct(a.musicVol) + '" data-audio="musicVol" aria-label="Musik-Lautstärke">' +
      '</div>' +
      '<div class="audio-row">' +
      '<label>🎼 Musikstück</label>' +
      '<select data-audio="track" aria-label="Musikstück">' + trackOpts + '</select>' +
      '</div>' +
      '<div class="audio-row">' +
      '<label><input type="checkbox" data-audio="sfx"' + (a.sfx ? " checked" : "") + '> 🔔 Soundeffekte</label>' +
      '<input type="range" min="0" max="100" value="' + pct(a.sfxVol) + '" data-audio="sfxVol" aria-label="Sound-Lautstärke">' +
      '</div>';
  },

  /** Reaktion auf einen Audio-Regler/-Schalter im Menü. */
  onAudioControl(el: HTMLInputElement) {
    const a = Game.state.audio;
    switch (el.dataset.audio) {
      case "music": a.music = el.checked; SFX.setMusicEnabled(a.music); break;
      case "sfx": a.sfx = el.checked; SFX.setSfxEnabled(a.sfx); if (a.sfx) SFX.coin(); break;
      case "musicVol": a.musicVol = Number(el.value) / 100; SFX.setMusicVol(a.musicVol); break;
      case "track": a.track = el.value; SFX.setTrack(a.track); if (a.sfx) SFX.coin(); break;
      case "sfxVol": a.sfxVol = Number(el.value) / 100; SFX.setSfxVol(a.sfxVol); if (a.sfx) SFX.coin(); break;
      default: return;
    }
    Game.save();
  },

  /** Reaktion auf einen Spiel-Feel-Schalter im Menü (#71). */
  onSettingControl(el: HTMLInputElement) {
    if (el.dataset.setting !== "events" || !el.checked) return;
    const mode = el.value;
    if (mode === "normal" || mode === "cozy" || mode === "off") {
      Game.setEventMode(mode);
      if (Game.state.audio.sfx) SFX.coin();
    }
  },

});
