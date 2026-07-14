/* ===== Kubernia – Mini-Synthesizer (SFX) + Hintergrundmusik =====
 * Erzeugt alle Sounds UND die Hintergrundmusik zur Laufzeit per WebAudio –
 * keine Audio-Dateien nötig (passt zum Single-File-Offline-Build, keine Lizenz-
 * Frage). Bewusst OHNE Abhängigkeiten (auch kein Phaser/Game), damit zwischen
 * scenes.ts und ui.ts kein zyklischer Import entsteht: beide beziehen SFX nur
 * von hier. Der Audio-Schalter wird zentral hier geprüft – nicht an jeder
 * SFX-Aufrufstelle einzeln.
 */

import type { AudioConfig } from "./types";
import { setAudioSink } from "./runtime";

/** Audio-Einstellungen (Spielstand `GameState.audio`). Definiert in der
 *  Typ-Schicht (`types.ts`), hier nur re-exportiert für bestehende Importeure. */
export type { AudioConfig };

/** Ein auswählbares Musikstück. Alles prozedural (kein Audio-Asset, keine Lizenz):
 *  je Theme eine eigene Tonart/Akkordfolge, BPM und Klangfarbe, damit sich die
 *  Stücke spürbar unterscheiden (Tag/Insel/Nacht-Stimmung). */
export interface MusicTheme {
  /** Stabile ID (im Spielstand persistiert). ASCII. */
  id: string;
  /** Anzeigename im Menü (mit Emoji, deutsche Umlaute erlaubt). */
  label: string;
  /** Tempo in Schlägen pro Minute. */
  bpm: number;
  /** Akkordfolge: je Takt [Bass-Note, ...Akkordtöne] als MIDI-Nummern. */
  prog: number[][];
  /** Wellenform für Bass + Akkord-Pad (Default sine). */
  pad?: OscillatorType;
  /** Wellenform fürs Arpeggio (Default triangle). */
  arp?: OscillatorType;
}

const STEPS_PER_BAR = 8;                 // Achtelschritte pro Takt

/** Die auswählbaren Stücke. Index 0 ("hafen") ist der Default und entspricht
 *  dem ursprünglichen, einzelnen C-Dur-Loop (I–vi–IV–V). Die weiteren Themes
 *  bringen eigene Tonarten, Tempi und Klangfarben für mehr Atmosphäre. */
export const MUSIC_THEMES: MusicTheme[] = [
  {
    id: "hafen",
    label: "🏝️ Hafenbrise",
    bpm: 68,
    prog: [
      [48, 60, 64, 67], // C-Dur   (C  E  G)
      [45, 57, 60, 64], // a-Moll  (A  C  E)
      [41, 53, 57, 60], // F-Dur   (F  A  C)
      [43, 55, 59, 62], // G-Dur   (G  B  D)
    ],
  },
  {
    id: "insel",
    label: "🌅 Inselmorgen",
    bpm: 82,
    pad: "triangle",
    arp: "triangle",
    prog: [
      [50, 62, 66, 69], // D-Dur   (D  Fis A)
      [43, 55, 59, 62], // G-Dur   (G  B  D)
      [45, 57, 61, 64], // A-Dur   (A  Cis E)
      [47, 59, 62, 66], // h-Moll  (H  D  Fis)
    ],
  },
  {
    id: "nacht",
    label: "🌙 Sternennacht",
    bpm: 54,
    pad: "sine",
    arp: "sine",
    prog: [
      [45, 57, 60, 64], // a-Moll  (A  C  E)
      [41, 53, 57, 60], // F-Dur   (F  A  C)
      [40, 52, 55, 59], // e-Moll  (E  G  H)
      [43, 55, 59, 62], // G-Dur   (G  B  D)
    ],
  },
];

/** MIDI-Note -> Frequenz (Hz). */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export const SFX = {
  ctx: null as AudioContext | null,

  // Audio-Einstellungen. Spiegeln GameState.audio; werden über applyConfig()
  // bzw. die set*-Methoden vom Menü/Spielstand gesetzt. Defaults = an.
  cfg: { music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, track: "hafen" } as AudioConfig,

  // Laufende Musik. masterGain bündelt alle Musik-Stimmen, damit ein
  // Lautstärke-Regler reicht und "aus" wirklich Ruhe bedeutet (Gain auf 0
  // + Knoten getrennt -> keine Resttöne).
  music: {
    playing: false,
    timer: 0 as ReturnType<typeof setInterval> | 0,
    master: null as GainNode | null,
    nextTime: 0,
    step: 0,
  },

  ensure() {
    if (!this.ctx) {
      // webkitAudioContext ist die alte Safari-Variante – lokal typisiert,
      // statt über einen globalen window-Shim.
      const Ctor = window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      try { if (Ctor) this.ctx = new Ctor(); } catch { /* kein Ton */ }
    }
    // Browser starten den Context wegen der Autoplay-Policy oft "suspended";
    // erst eine User-Geste (Tastendruck/Klick) darf ihn fortsetzen.
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => { /* egal */ });
    }
    // Musik startet erst nach der ersten User-Interaktion (= sobald es einen
    // laufenden Context gibt). ensure() wird bei jedem Tastendruck/Klick
    // aufgerufen, darum genügt der Schutz über music.playing.
    if (this.ctx && this.cfg.music && !this.music.playing) this.startMusic();
    return this.ctx;
  },

  tone(freq: number, dur: number, type?: OscillatorType, vol?: number, delay?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.cfg.sfx) return; // Sound-Schalter zentral hier
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime((vol || 0.035) * this.cfg.sfxVol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur);
  },

  coin() { this.tone(880, 0.07); this.tone(1318, 0.1, "square", 0.035, 0.07); },
  success() { this.tone(523, 0.09); this.tone(659, 0.09, "square", 0.035, 0.09); this.tone(784, 0.14, "square", 0.035, 0.18); },
  splash() { this.tone(180, 0.2, "sine", 0.05); this.tone(90, 0.25, "sine", 0.04, 0.05); },
  alarm() { this.tone(440, 0.18, "sawtooth", 0.04); this.tone(330, 0.18, "sawtooth", 0.04, 0.2); this.tone(440, 0.18, "sawtooth", 0.04, 0.4); },
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, "square", 0.04, i * 0.12)); },
  // Schiffsglocke ("Glasen") für den Rang-Aufstieg (#223): zwei helle Schläge im
  // Doppelschlag-Rhythmus, jeder Grundton + Oktav-Oberton als metallischer Klang,
  // sine mit langem Ausklang – hebt den Aufstieg akustisch von der Quest-Fanfare ab.
  shipBell() { [0, 0.26].forEach(d => { this.tone(1568, 0.6, "sine", 0.05, d); this.tone(3136, 0.5, "sine", 0.022, d); }); },
  wrong() { this.tone(196, 0.18, "sawtooth", 0.03); },
  thunder() { this.tone(58, 0.7, "sawtooth", 0.06); this.tone(46, 0.9, "sawtooth", 0.05, 0.12); },
  door() { this.tone(160, 0.12, "sine", 0.05); this.tone(110, 0.16, "sine", 0.04, 0.05); },

  /* ========== Hintergrundmusik (synthetisiert) ========== */

  /** Basis-Pegel der Musik, bewusst leise; der User-Regler skaliert darauf. */
  _musicBase: 0.16,

  /** Eine einzelne, sanft ein- und ausgeblendete Musik-Stimme planen. */
  _musicNote(midi: number, time: number, dur: number, type: OscillatorType, vol: number) {
    const ctx = this.ctx;
    const master = this.music.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = midiToFreq(midi);
    const attack = Math.min(0.08, dur * 0.3);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(vol, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain).connect(master);
    osc.start(time); osc.stop(time + dur + 0.05);
  },

  /** Das aktuell gewählte Theme; fällt bei unbekannter ID auf den Default (Index 0). */
  _theme(): MusicTheme {
    return MUSIC_THEMES.find(t => t.id === this.cfg.track) || MUSIC_THEMES[0];
  },

  /** Plant den i-ten Achtelschritt (global) auf die Context-Zeit `time`. */
  _scheduleStep(globalStep: number, time: number) {
    const theme = this._theme();
    const prog = theme.prog;
    const bar = prog[Math.floor(globalStep / STEPS_PER_BAR) % prog.length];
    const local = globalStep % STEPS_PER_BAR;
    const secPerStep = 60 / theme.bpm / 2;
    const pad = theme.pad || "sine";
    const arp = theme.arp || "triangle";
    const [bass, ...chord] = bar;
    if (local === 0) {
      // Bass-Grundton + weicher Akkord-Pad über den ganzen Takt.
      this._musicNote(bass, time, secPerStep * STEPS_PER_BAR, pad, 0.5);
      for (const n of chord) this._musicNote(n, time, secPerStep * STEPS_PER_BAR, pad, 0.22);
    }
    // Leichtes Arpeggio-Plucken auf den geraden Schritten – steigt durch den Akkord.
    if (local % 2 === 0) {
      const note = chord[(local / 2) % chord.length] + 12; // eine Oktave höher
      this._musicNote(note, time, secPerStep * 1.6, arp, 0.3);
    }
    // Sanfter Melodie-Anker auf den beiden Takthälften: gibt jedem Theme eine
    // erkennbare Oberstimme, damit es voller klingt als das alte reine Loop.
    if (local === 0 || local === 4) {
      const top = chord[chord.length - 1] + (local === 0 ? 12 : 19); // Grundton- bzw. Quint-Oktave
      this._musicNote(top, time, secPerStep * 3, "triangle", 0.14);
    }
  },

  /** Look-ahead-Scheduler: plant Schritte knapp im Voraus für sauberes Loopen. */
  _tickMusic() {
    const ctx = this.ctx;
    if (!ctx) return;
    const secPerStep = 60 / this._theme().bpm / 2;
    while (this.music.nextTime < ctx.currentTime + 0.2) {
      this._scheduleStep(this.music.step, this.music.nextTime);
      this.music.nextTime += secPerStep;
      this.music.step++;
    }
  },

  startMusic() {
    const ctx = this.ensure_ctxOnly();
    if (!ctx || this.music.playing) return;
    const master = ctx.createGain();
    master.gain.value = this._musicBase * this.cfg.musicVol;
    master.connect(ctx.destination);
    this.music.master = master;
    this.music.nextTime = ctx.currentTime + 0.1;
    this.music.step = 0;
    this.music.playing = true;
    this._tickMusic();
    this.music.timer = setInterval(() => this._tickMusic(), 60);
  },

  stopMusic() {
    if (this.music.timer) { clearInterval(this.music.timer); this.music.timer = 0; }
    // Master-Gain hart auf 0 und trennen -> alle geplanten Stimmen verstummen
    // sofort, keine Resttöne.
    if (this.music.master) {
      try { this.music.master.gain.value = 0; this.music.master.disconnect(); } catch { /* egal */ }
      this.music.master = null;
    }
    this.music.playing = false;
  },

  // Wie ensure(), aber OHNE den Musik-Autostart – für startMusic() selbst,
  // damit kein Rekursions-Pingpong zwischen ensure() und startMusic() entsteht.
  ensure_ctxOnly() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      try { if (Ctor) this.ctx = new Ctor(); } catch { /* kein Ton */ }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => { /* egal */ });
    }
    return this.ctx;
  },

  /* ========== Schalter (zentral, vom Menü/Spielstand gesetzt) ========== */

  /** Alle Audio-Einstellungen aus dem Spielstand übernehmen (beim Laden). */
  applyConfig(audio?: Partial<AudioConfig>) {
    if (audio) {
      if (typeof audio.music === "boolean") this.cfg.music = audio.music;
      if (typeof audio.sfx === "boolean") this.cfg.sfx = audio.sfx;
      if (typeof audio.musicVol === "number") this.cfg.musicVol = audio.musicVol;
      if (typeof audio.sfxVol === "number") this.cfg.sfxVol = audio.sfxVol;
      // Nur bekannte Track-IDs übernehmen; ein kaputter/alter Wert bleibt beim
      // bisherigen Track (Default "hafen") – _theme() hätte sonst nur den Fallback.
      if (typeof audio.track === "string" && MUSIC_THEMES.some(t => t.id === audio.track)) {
        this.cfg.track = audio.track;
      }
    }
    // Musik nur stoppen, wenn ausgeschaltet. Das Anwerfen passiert erst bei der
    // ersten User-Geste über ensure() (Autoplay-Policy).
    if (!this.cfg.music) this.stopMusic();
  },

  setMusicEnabled(on: boolean) {
    this.cfg.music = on;
    if (on) this.startMusic(); else this.stopMusic();
  },

  setSfxEnabled(on: boolean) {
    this.cfg.sfx = on;
  },

  setMusicVol(v: number) {
    this.cfg.musicVol = v;
    if (this.music.master) this.music.master.gain.value = this._musicBase * v;
  },

  /** Musikstück wechseln. Unbekannte IDs werden ignoriert. Läuft die Musik,
   *  beginnt der neue Track sauber bei Takt 0; die schon ~0,2 s im Voraus
   *  geplanten Stimmen klingen über den durchlaufenden Master weich aus –
   *  kein harter Schnitt/Knacken. */
  setTrack(id: string) {
    if (!MUSIC_THEMES.some(t => t.id === id)) return;
    this.cfg.track = id;
    if (this.music.playing) this.music.step = 0;
  },

  setSfxVol(v: number) {
    this.cfg.sfxVol = v;
  },
};

// #344: Anwendung (game.ts) schob Audio-Settings früher direkt via Import in SFX
// (Schichtverletzung Anwendung→Präsentation). Jetzt registriert die Präsentation
// ihren Handler beim Laufzeit-Sink; game.ts ruft nur noch `applyAudioConfig` aus
// runtime.ts. Die Abhängigkeit zeigt damit Präsentation→runtime (erlaubt), nicht
// mehr Anwendung→Präsentation. Läuft beim Modul-Laden (main.ts importiert sfx vor
// Game.load()).
setAudioSink((cfg) => SFX.applyConfig(cfg));
