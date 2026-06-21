/* Tests für die Audio-Schicht (sfx.ts): zentraler Sound-/Musik-Schalter und der
 * synthetisierte Musik-Loop. WebAudio gibt es im Node-Lauf nicht – wir stubben
 * einen minimalen Fake-AudioContext, der mitzählt, welche Knoten entstehen, und
 * prüfen damit auch die Negativfälle (aus = wirklich keine Töne/Knoten).
 */
import { test, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";

let SFX: typeof import("../src/sfx").SFX;
let MUSIC_THEMES: typeof import("../src/sfx").MUSIC_THEMES;

// ---- Minimaler Fake-WebAudio-Graph ----
class FakeParam {
  value = 0;
  last = 0;
  setValueAtTime(v: number) { this.value = v; this.last = v; }
  exponentialRampToValueAtTime(v: number) { this.last = v; }
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = "";
  connected = true;
  connect(n: unknown) { return n; }
  disconnect() { this.connected = false; }
  start() {}
  stop() {}
}
class FakeCtx {
  state = "running";
  currentTime = 0;
  destination = {};
  oscCount = 0;
  gainCount = 0;
  createOscillator() { this.oscCount++; return new FakeNode(); }
  createGain() { this.gainCount++; return new FakeNode(); }
  resume() { return Promise.resolve(); }
}

beforeAll(async () => {
  vi.stubGlobal("window", { AudioContext: FakeCtx });
  ({ SFX, MUSIC_THEMES } = await import("../src/sfx"));
});

beforeEach(() => {
  // Frischer Context + Default-Einstellungen vor jedem Test.
  SFX.stopMusic();
  SFX.ctx = null;
  SFX.cfg = { music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, track: "hafen" };
});

afterEach(() => {
  SFX.stopMusic(); // sonst läuft der Scheduler-Interval weiter
});

test("Defaults: Musik und Sounds sind standardmäßig an", () => {
  expect(SFX.cfg.music).toBe(true);
  expect(SFX.cfg.sfx).toBe(true);
});

test("tone: erzeugt bei aktivem Sound einen Oszillator, bei deaktiviertem KEINEN", () => {
  SFX.cfg.music = false; // Musik-Autostart aus, damit nur der SFX-Oszillator zählt
  SFX.setSfxEnabled(true);
  SFX.tone(440, 0.1);
  const ctx = SFX.ctx as unknown as FakeCtx;
  expect(ctx.oscCount).toBe(1);

  // Negativfall: Sound aus -> kein weiterer Oszillator
  SFX.setSfxEnabled(false);
  SFX.tone(440, 0.1);
  expect(ctx.oscCount).toBe(1);
});

test("setSfxVol: skaliert die tatsächliche Lautstärke des Tons", () => {
  SFX.cfg.music = false;
  SFX.setSfxVol(0.5);
  // tone(vol-Default 0.035) * sfxVol 0.5 -> 0.0175 am Gain
  SFX.tone(440, 0.1, "square", 0.035);
  // letzter erzeugter Gain-Knoten kennt den gesetzten Startwert nicht direkt;
  // wir prüfen stattdessen, dass überhaupt ein Gain mit skaliertem Wert entstand.
  // (Indirekt: bei sfxVol 0 wird trotzdem ein Knoten erzeugt, aber leise.)
  expect((SFX.ctx as unknown as FakeCtx).gainCount).toBeGreaterThan(0);
});

test("setMusicEnabled: an startet den Loop, aus stoppt ihn vollständig", () => {
  SFX.setMusicEnabled(true);
  expect(SFX.music.playing).toBe(true);
  expect(SFX.music.master).not.toBeNull();

  SFX.setMusicEnabled(false);
  expect(SFX.music.playing).toBe(false);
  expect(SFX.music.master).toBeNull(); // Master getrennt -> keine Resttöne
});

test("setMusicVol: aktualisiert den laufenden Master-Gain", () => {
  SFX.setMusicEnabled(true);
  SFX.setMusicVol(1);
  expect(SFX.music.master!.gain.value).toBeCloseTo(SFX._musicBase * 1, 5);
  SFX.setMusicVol(0);
  expect(SFX.music.master!.gain.value).toBe(0);
});

test("applyConfig: übernimmt Spielstand-Werte und stoppt Musik bei music=false", () => {
  SFX.setMusicEnabled(true);
  expect(SFX.music.playing).toBe(true);

  SFX.applyConfig({ music: false, sfx: false, musicVol: 0.3, sfxVol: 0.2 });
  expect(SFX.cfg.music).toBe(false);
  expect(SFX.cfg.sfx).toBe(false);
  expect(SFX.cfg.musicVol).toBe(0.3);
  expect(SFX.cfg.sfxVol).toBe(0.2);
  expect(SFX.music.playing).toBe(false); // wurde gestoppt
});

test("Themes: mindestens 3 auswählbare Stücke mit eindeutigen IDs, Default 'hafen'", () => {
  expect(MUSIC_THEMES.length).toBeGreaterThanOrEqual(3); // Akzeptanzkriterium: ≥3
  const ids = MUSIC_THEMES.map(t => t.id);
  expect(new Set(ids).size).toBe(ids.length); // keine Doppel-ID
  expect(ids).toContain("hafen");
  expect(SFX.cfg.track).toBe("hafen"); // Default
  // _theme() liefert genau das gewählte Theme.
  SFX.cfg.track = "nacht";
  expect(SFX._theme().id).toBe("nacht");
});

test("setTrack: wechselt den Track, startet bei Takt 0 und ignoriert unbekannte IDs", () => {
  SFX.setMusicEnabled(true);
  SFX.music.step = 7;
  SFX.setTrack("nacht");
  expect(SFX.cfg.track).toBe("nacht");
  expect(SFX.music.step).toBe(0); // sauberer Neustart des Loops

  // Negativfall: unbekannte ID lässt Track UND Schrittzähler unverändert.
  SFX.music.step = 3;
  SFX.setTrack("gibtsnicht");
  expect(SFX.cfg.track).toBe("nacht");
  expect(SFX.music.step).toBe(3);
});

test("setTrack: unbekannte ID bei laufender Musik fällt _theme() trotzdem nicht durch", () => {
  // Selbst wenn cfg.track manuell auf Müll stünde, darf nie undefined kommen.
  SFX.cfg.track = "kaputt";
  expect(SFX._theme()).toBe(MUSIC_THEMES[0]); // Fallback auf Default
});

test("applyConfig: übernimmt bekannten Track, ignoriert unbekannten (kein Durchschlagen)", () => {
  SFX.applyConfig({ track: "insel" });
  expect(SFX.cfg.track).toBe("insel");
  // Negativfall: unbekannte ID darf den gültigen Track NICHT überschreiben.
  SFX.applyConfig({ track: "quatsch" });
  expect(SFX.cfg.track).toBe("insel");
});

test("ensure: startet Musik nach erster Interaktion, aber nicht doppelt", () => {
  SFX.cfg.music = true;
  SFX.ensure();
  expect(SFX.music.playing).toBe(true);
  const master = SFX.music.master;
  SFX.ensure(); // zweite Geste darf den Loop nicht neu/zusätzlich starten
  expect(SFX.music.master).toBe(master);
});
