/* ===== Kubernia – Laufzeit-Singletons =====
 * Diese paar Werte hingen früher als Migrations-Shim am globalen `window`
 * (siehe alte vite-env.d.ts). Jetzt sind es echte Modul-Exporte – kein
 * globaler Zustand mehr, dafür sauber typisiert und importierbar.
 *
 * Bewusst OHNE Phaser-/UI-Importe (nur ein struktureller Typ), damit zwischen
 * scenes.ts, ui.ts, main.ts und game.ts kein zyklischer Import entsteht.
 */
import type { AudioConfig } from "./types";
import type { HazardEvent } from "./world/hazards";

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
  /** Nächste Pod-Kiste im Interaktions-Radius (#650). */
  nearestPod(): string | null;
  burstAtPlayer(kind: string): void;
  /** Spielfigur sofort an eine Weltposition setzen (Wiederspiel-Sandbox #332:
   *  ohne Reload an den Quest-Giver bzw. zurück an die gemerkte Live-Position). */
  teleport?(x: number, y: number): void;
  /** Optionaler „+N 🪙"-Floater für eine fällige Hafen-Auszahlung (#501). Nur die echte
   *  Hafen-WorldScene setzt ihn (Floater an einer Hafen-Kachel); Regionen implementieren ihn
   *  nicht (die Koordinate wäre dort sinnlos), der HUD-Refresh läuft trotzdem überall. */
  payoutFloat?(amount: number): void;
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

/* ---------- Dublonen-Auszahlungs-Sink (#501) ----------
 * Der passive Hafen-Verdienst wird seit #501 vom szenen-neutralen Taktgeber (Game.tick,
 * getrieben aus Phasers globalem Pre-Step in main.ts) getickt, nicht mehr aus
 * WorldScene.update() – damit er in JEDER Szene läuft (auch in den Regionen). Die
 * Präsentation (HUD-Refresh + „+N 🪙"-Floater) darf die Anwendung aber nicht importieren;
 * darum meldet Game.tick eine fällige Auszahlung entkoppelt hierüber (wie Audio-#344/
 * Save-#497), und die Präsentation (ui.ts) registriert ihren Handler. Ohne Sink (Node-Test)
 * ist das Melden ein No-op. */
let _payoutSink: ((amount: number) => void) | null = null;

/** Von der Präsentation (ui.ts) beim Modul-Laden gesetzt. */
export function setPayoutSink(fn: ((amount: number) => void) | null): void {
  _payoutSink = fn;
}

/** Der Präsentation eine fällige Hafen-Auszahlung melden (No-op ohne Sink). */
export function notifyPayout(amount: number): void {
  _payoutSink?.(amount);
}

/* ---------- HUD-Uhr-Sink (#588) ----------
 * Die HUD-Uhr-*Anzeige* (Datum/Uhrzeit) wurde früher nur in WorldScene.update
 * (updateDayNight → UI.setClock) gesetzt – in Region-/Interior-Szenen mit eigenem update()
 * fror sie darum ein (gleiche Bug-Klasse wie der economyTick-#501, nur fürs Uhr-Rendering).
 * Jetzt meldet der szenen-neutrale Taktgeber (Game.tick, aus Phasers globalem Pre-Step in
 * main.ts) die abgeleiteten Uhr-Labels entkoppelt hierüber (wie Payout-#501/Audio-#344), und
 * die Präsentation (ui.ts) registriert ihren Handler → die Uhr läuft in JEDER Szene. Der
 * Tag-Nacht-Schleier bleibt weltgebunden (nur die WorldScene malt ihn). Ohne Sink (Node-Test)
 * ist das Melden ein No-op. */
let _clockSink: ((dateLabel: string, timeLabel: string, title: string, seasonIndex: number) => void) | null = null;

/** Von der Präsentation (ui.ts) beim Modul-Laden gesetzt. */
export function setClockSink(fn: ((dateLabel: string, timeLabel: string, title: string, seasonIndex: number) => void) | null): void {
  _clockSink = fn;
}

/** Der Präsentation die aktuelle HUD-Uhr melden (No-op ohne Sink). `seasonIndex`
 *  (0..3) wählt in der Präsentation das gerahmte Saison-Pixel-Icon (#645). */
export function notifyClock(dateLabel: string, timeLabel: string, title: string, seasonIndex: number): void {
  _clockSink?.(dateLabel, timeLabel, title, seasonIndex);
}

/* ---------- Gefahren-Sink (#540) ----------
 * Die Zufalls-Gefahren (Piraten/Krake/Sturm) schreiten seit #540 szenen-neutral in Game.tick
 * fort (Zeitachse + Cluster-Mutation in der Anwendungsschicht, analog Wirtschaft/Uhr #501).
 * Die Effekt-Ausführung (Welt-Sprites nur in der WorldScene, globaler Alarm-DOM + roter
 * Warnrahmen in JEDER Szene, Belohnung/Strafe) bleibt Präsentation – die die Anwendung nicht
 * importieren darf. Darum meldet game/hazards.ts jedes `HazardEvent` entkoppelt hierüber (wie
 * Payout-#501/Uhr-#588), und die Präsentation (worldscene/events.ts) registriert ihren Handler.
 * Ohne Sink (Node-Test) ist das Melden ein No-op. */
let _hazardSink: ((ev: HazardEvent) => void) | null = null;

/** Von der Präsentation (worldscene/events.ts) beim Modul-Laden gesetzt. */
export function setHazardSink(fn: ((ev: HazardEvent) => void) | null): void {
  _hazardSink = fn;
}

/** Der Präsentation ein Gefahren-Ereignis melden (No-op ohne Sink). */
export function notifyHazard(ev: HazardEvent): void {
  _hazardSink?.(ev);
}

/* ---------- UI-Beschäftigt-Sonde (#540) ----------
 * Der frühere Szenen-Start-Code verschob eine fällige Gefahr, solange ein Overlay/Dialog/Quiz
 * offen war (`UI.blocking()`), damit der Alarm nicht mitten in ein Modal platzt. Die
 * szenen-neutrale Anwendungsschicht darf `ui.ts` nicht importieren – statt eines Sinks
 * registriert die Präsentation hier eine SONDE, die die Anwendung (game/hazards.ts) vor dem
 * Start abfragt. Ohne Sonde (Node-Test) gilt „nicht beschäftigt" (false). */
let _uiBusyProbe: (() => boolean) | null = null;

/** Von der Präsentation (ui.ts) beim Modul-Laden gesetzt. */
export function setUiBusyProbe(fn: (() => boolean) | null): void {
  _uiBusyProbe = fn;
}

/** Ist die UI gerade durch ein blockierendes Overlay/Dialog/Quiz beschäftigt? (false ohne Sonde). */
export function uiBusy(): boolean {
  return _uiBusyProbe?.() ?? false;
}
