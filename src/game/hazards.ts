/* Szenen-neutrale Zufalls-Gefahren (#540, Anwendungsschicht, Phaser-frei).
 * Bis #540 lebten Zeitachse UND Zustand der Gefahren (Piraten/Krake/Sturm) in `scene.hazards`
 * der WorldScene und tickten über `scene.time.now`; in einer Region/im Innenraum standen sie
 * darum still (kein Start, keine Deadline) – dieselbe Bug-Klasse wie economyTick-#501/Uhr-#588.
 * Jetzt bündelt `Game.tick` (Phasers globaler Pre-Step, main.ts) auch den Gefahren-Takt: die
 * Zeitachse + die Cluster-Mutation entstehen hier szenen-neutral, die Präsentation rendert nur
 * noch (Welt-Sprites in der WorldScene, globaler Alarm + roter Warnrahmen überall).
 *
 * Die spielentscheidenden Entscheidungen (Start-Gate, Opfer-Eignung, Auflösen/Deadline) liegen
 * weiter im reinen Kern `src/world/hazards.ts` (#512) – hier wird er nur getaktet, die Sim
 * mutiert und das Ergebnis entkoppelt über den runtime-Sink (`notifyHazard`) gemeldet
 * (Schichtung wie Payout-#501/Audio-#344). Zufall über die RNG-SSOT (`core/rng`); die
 * Start-Logik als freie Funktionen, damit die privaten Helfer `GameApi` nicht aufblähen.
 *
 * Der Hazard-Zustand ist bewusst FLÜCHTIG (Modul-Singleton, NICHT im Save): eine laufende
 * Gefahr überlebt keinen Reload – wie schon vor #540 (scene.hazards war ephemer). */
import { part, type GameApi } from "./shared";
import { nextRandom } from "../core/rng";
import { KQContent } from "../content";
import { notifyHazard, uiBusy } from "../runtime";
import {
  hazardStartable, stormVictims, pirateVictims, resolveHazardTick, pirateSteal, stormFixKind,
  type HazardKind, type ActiveHazards,
} from "../world/hazards";

/** Reparatur-Deadlines je Gefahr (Sekunden, vor `deadlineScale`) – gespiegelt aus dem früheren
 *  Szenen-Start (#393). */
const DEADLINE: Record<HazardKind, number> = { storm: 240, pirate: 180, kraken: 120 };

/** Obergrenze für den Zeitachsen-Fortschritt EINES Frames (Sekunden): ohne Deckel würde ein
 *  Riesen-`delta` (Hintergrund-Tab/Lade-Hänger) alle Timer auf einmal fällig machen (gleiche
 *  Catch-up-Idee wie MAX_ECONOMY_DT in tick.ts). */
const MAX_HAZARD_DT = 0.25;

/** Flüchtiger Hazard-Laufzeitzustand (Modul-Singleton, kein Save). Die aktiven Records
 *  erfüllen `ActiveHazards` des reinen Kerns strukturell. */
interface HazardRuntime extends ActiveHazards {
  now: number;
  nextPirate: number;
  nextKraken: number;
  nextStorm: number;
  scheduled: boolean;
}

const HZ: HazardRuntime = {
  now: 0, nextPirate: 0, nextKraken: 0, nextStorm: 0,
  pirate: null, kraken: null, storm: null, scheduled: false,
};

/** Ganzzahl in [a, b] aus der RNG-SSOT (Ersatz für Phaser.Math.Between). */
function between(a: number, b: number): number { return a + Math.floor(nextRandom() * (b - a + 1)); }

/** Ein zufälliges Element (Ersatz für Phaser.Utils.Array.GetRandom); nie mit leerem Pool gerufen. */
function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(nextRandom() * arr.length)];
}

function hazardActive(): boolean {
  return !!(HZ.pirate || HZ.kraken || HZ.storm);
}

/** Darf `kind` gerade starten? (Freischaltung + System an + keine andere Gefahr aktiv, #512). */
function startGate(game: GameApi, kind: HazardKind): boolean {
  const ep = game.eventProfile();
  return hazardStartable(kind, { enabled: ep.enabled, anyActive: hazardActive(), completedQuests: game.state.completedQuests });
}

function deadlineFor(game: GameApi, kind: HazardKind): number {
  return Math.round(DEADLINE[kind] * game.eventProfile().deadlineScale);
}

/* ---------- Start-Logik je Gefahr (Cluster-Mutation + Alarm-Meldung) ----------
 * Gespiegelt aus dem früheren tryStart* (worldscene/events.ts); der Sprite-Spawn liegt jetzt
 * in der Präsentation (reagiert auf das "start"-Event), hier bleibt nur die Domänen-Mutation. */

function startStorm(game: GameApi): void {
  if (!startGate(game, "storm")) return;
  const victims = stormVictims(game.sim.deployments);
  if (victims.length === 0 || uiBusy()) { HZ.nextStorm += 25; return; }
  const dep = pickRandom(victims);
  const fix = stormFixKind(nextRandom());
  if (fix === "imagepull") {
    // Der Sturm "verdreht" den Image-Namen (Buchstabendreher) → ImagePullBackOff.
    const bad = KQContent.corruptImage(dep.image.split(":")[0]);
    dep.broken = { type: "imagepull", badImage: bad };
    dep.image = bad;
  } else {
    dep.broken = { type: "crashloop", needsSecret: "sturm-schluessel-" + between(10, 99) };
  }
  game.sim.touch();   // #523: direkte Cluster-Mutation → Cluster-Sync anstoßen (Kisten rot)
  game.save();
  const deadline = deadlineFor(game, "storm");
  HZ.storm = { dep: dep.name, until: HZ.now + deadline };
  notifyHazard({ type: "start", info: { kind: "storm", dep: dep.name, fix }, deadlineSec: deadline });
}

function startPirate(game: GameApi): void {
  if (!startGate(game, "pirate")) return;
  const victims = pirateVictims(game.sim.deployments);
  if (victims.length === 0 || uiBusy()) { HZ.nextPirate += 20; return; }
  const dep = pickRandom(victims);
  const want = dep.replicas;
  const steal = pirateSteal(dep.replicas);
  dep.replicas -= steal;
  dep.pods.splice(0, steal);
  game.sim.touch();   // #523: geklaute Pods → Cluster-Sync anstoßen (Kisten entfernen)
  game.save();
  const deadline = deadlineFor(game, "pirate");
  HZ.pirate = { dep: dep.name, want, until: HZ.now + deadline };
  notifyHazard({ type: "start", info: { kind: "pirate", dep: dep.name, want, left: dep.replicas }, deadlineSec: deadline });
}

function startKraken(game: GameApi): void {
  if (!startGate(game, "kraken")) return;
  if (uiBusy()) { HZ.nextKraken += 20; return; }
  const baseline = game.sim.secrets.length;
  const deadline = deadlineFor(game, "kraken");
  HZ.kraken = { baseline, until: HZ.now + deadline };
  notifyHazard({ type: "start", info: { kind: "kraken" }, deadlineSec: deadline });
}

export const hazardsBundle = part({
  /** Ein Frame des szenen-neutralen Gefahren-Takts: Zeitachse vorrücken, fällige Gefahren
   *  starten (Cluster mutieren + Alarm melden) und laufende auf Erfolg/Deadline prüfen. Wird
   *  aus Game.tick(dtMs) getrieben (main.ts Pre-Step) → läuft in JEDER Szene. Unsinnige Deltas
   *  (NaN/≤0) rücken nichts vor. */
  hazardTick(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    if (!HZ.scheduled) { this.scheduleHazards(60); HZ.scheduled = true; }
    HZ.now += Math.min(MAX_HAZARD_DT, deltaMs / 1000);

    if (HZ.now > HZ.nextPirate) startPirate(this);
    if (HZ.now > HZ.nextKraken) startKraken(this);
    if (HZ.now > HZ.nextStorm) startStorm(this);

    const view = { deployments: this.sim.deployments, secretCount: this.sim.secrets.length };
    for (const action of resolveHazardTick(HZ, view, HZ.now)) {
      if (action.type === "tick") { notifyHazard({ type: "tick", kind: action.kind, secondsLeft: action.secondsLeft }); continue; }
      // Auflösen: Record leeren, Präsentation melden (Belohnung/Strafe/Sprite-Abbau dort),
      // dann alle Timer neu würfeln (wie der frühere scheduleEvents-Aufruf im resolve*).
      const dep = action.kind === "storm" ? HZ.storm?.dep : action.kind === "pirate" ? HZ.pirate?.dep : undefined;
      HZ[action.kind] = null;
      notifyHazard({ type: "resolve", kind: action.kind, success: action.success, dep });
      this.scheduleHazards();
    }
  },

  /** Alle drei Timer neu würfeln. `delaySec` gesetzt = deterministischer Erst-Abstand (Boot:
   *  frühestens nach 1 Minute), sonst der Zufallsbereich. `spawnScale` (Spiel-Feel #71) streckt
   *  die Wartezeit; "Aus" schiebt sie auf Infinity (kein Event mehr). Gespiegelt aus dem
   *  früheren scheduleEvents (worldscene/events.ts). */
  scheduleHazards(delaySec?: number): void {
    const scale = this.eventProfile().spawnScale;
    HZ.nextPirate = HZ.now + (delaySec ?? between(200, 360)) * scale;
    HZ.nextKraken = HZ.now + (delaySec ? delaySec + 90 : between(300, 500)) * scale;
    HZ.nextStorm = HZ.now + (delaySec ? delaySec + 150 : between(260, 430)) * scale;
  },

  /** Aktueller Hazard-Zustand (schreibgeschützter Blick) – die WorldScene rekonstruiert daraus
   *  beim Betreten die Welt-Sprites für eine während der Abwesenheit gestartete Gefahr. */
  hazardState(): ActiveHazards {
    return { pirate: HZ.pirate, kraken: HZ.kraken, storm: HZ.storm };
  },

  /** Ist gerade irgendeine Gefahr aktiv? (für den globalen Warnrahmen). */
  hazardActive(): boolean {
    return hazardActive();
  },

  /** Hazard-Zustand + Zeitachse zurücksetzen (Tests / expliziter Neustart). */
  resetHazards(): void {
    HZ.now = 0; HZ.nextPirate = 0; HZ.nextKraken = 0; HZ.nextStorm = 0;
    HZ.pirate = null; HZ.kraken = null; HZ.storm = null; HZ.scheduled = false;
  },
});
