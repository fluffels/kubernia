/* ===== KubeQuest – Laufzeit-Singletons =====
 * Diese paar Werte hingen früher als Migrations-Shim am globalen `window`
 * (siehe alte vite-env.d.ts). Jetzt sind es echte Modul-Exporte – kein
 * globaler Zustand mehr, dafür sauber typisiert und importierbar.
 *
 * Bewusst OHNE Phaser-/UI-Importe (nur ein struktureller Typ), damit zwischen
 * scenes.ts, ui.ts, main.ts und game.ts kein zyklischer Import entsteht.
 */
import type { AudioConfig } from "./types";

/* ---------- Tastenzustand ----------
 * main.ts schreibt (keydown/keyup/blur), scenes.ts liest in der Update-Schleife.
 * Eigenes window-Listener-Modell statt Phaser-Keyboard, damit Eingabefelder in
 * Overlays normal funktionieren. */
export const keys: Record<string, boolean> = {};

/** Alle gedrückten Tasten vergessen (z.B. wenn das Fenster den Fokus verliert). */
export function clearKeys(): void {
  for (const k of Object.keys(keys)) delete keys[k];
}

/* ---------- Aktive WorldScene ----------
 * scenes.ts meldet beim Erstellen die laufende Szene an, ui.ts/main.ts/game.ts
 * greifen darauf zu (NPC-Nähe, Effekte, Spieler-Position fürs Speichern). Nur
 * die tatsächlich genutzte Oberfläche ist typisiert – die echte WorldScene hat
 * viel mehr, ist hier aber strukturell kompatibel. */
export interface WorldSceneRef {
  player?: { x: number; y: number };
  playerSprite?: { setTexture(texture: string, frame: number): void } | null;
  nearestNpc(): { id: string } | null;
  burstAtPlayer(kind: string): void;
  /** Spielfigur sofort an eine Weltposition setzen (Wiederspiel-Sandbox #332:
   *  ohne Reload an den Quest-Giver bzw. zurück an die gemerkte Live-Position). */
  teleport?(x: number, y: number): void;
}

let _scene: WorldSceneRef | null = null;

/** Von scenes.ts beim create() der WorldScene gesetzt. */
export function setWorldScene(scene: WorldSceneRef | null): void {
  _scene = scene;
}

/** Liefert die aktuell laufende WorldScene oder null (vor dem Szenenstart). */
export function worldScene(): WorldSceneRef | null {
  return _scene;
}

/* ---------- Innenraum aktiv (#6) ----------
 * Solange ein Hausinnenraum offen ist, läuft die WorldScene pausiert. Die E-/
 * Prompt-Logik in ui.ts greift aber weiterhin auf worldScene() zu – dieses Flag
 * lässt sie aussetzen, damit man nicht durch die Wand mit Außen-NPCs redet. Die
 * InteriorScene verarbeitet ihre Tasten selbst. */
let _interiorOpen = false;

export function setInteriorOpen(v: boolean): void {
  _interiorOpen = v;
}

export function interiorOpen(): boolean {
  return _interiorOpen;
}

/* ---------- Audio-Sink (#344) ----------
 * Bricht die Schichtverletzung „Anwendung→Präsentation": game.ts (Anwendung) darf
 * `sfx.ts` (Präsentation) nicht importieren. Stattdessen registriert die
 * Präsentation hier ihren Handler (`setAudioSink`), und die Anwendung schiebt die
 * Audio-Settings entkoppelt über `applyAudioConfig`. Ist (noch) kein Sink gesetzt
 * – z.B. im Node-Test ohne geladenes sfx-Modul –, ist das Anwenden ein No-op. */
let _audioSink: ((cfg: AudioConfig) => void) | null = null;

/** Von der Präsentation (sfx.ts) beim Modul-Laden gesetzt. */
export function setAudioSink(fn: ((cfg: AudioConfig) => void) | null): void {
  _audioSink = fn;
}

/** Audio-Settings an die Präsentation geben (No-op, solange kein Sink registriert ist). */
export function applyAudioConfig(cfg: AudioConfig): void {
  _audioSink?.(cfg);
}

/* ---------- Save-Fehler-Sink (#497) ----------
 * Analog zum Audio-Sink oben: ein fehlgeschlagener Save (voller localStorage im
 * Fallback-Modus, QuotaExceeded) war bisher für den Spieler unsichtbar – die
 * Persistenz meldet ihn nur einmalig in die Konsole (store.ts), die niemand sieht.
 * game.ts (Anwendung) darf ui.ts (Präsentation) nicht importieren; stattdessen
 * registriert die Präsentation hier ihren Handler (`setSaveFailedSink`) und die
 * Anwendung meldet den Fehlschlag entkoppelt über `notifySaveFailed`. Ohne Sink
 * (z.B. Node-Test) ist das Melden ein No-op. */
let _saveFailedSink: (() => void) | null = null;

/** Von der Präsentation (ui.ts) beim Modul-Laden gesetzt. */
export function setSaveFailedSink(fn: (() => void) | null): void {
  _saveFailedSink = fn;
}

/** Der Präsentation melden, dass ein Speichern fehlgeschlagen ist (No-op, solange
 *  kein Sink registriert ist). */
export function notifySaveFailed(): void {
  _saveFailedSink?.();
}
