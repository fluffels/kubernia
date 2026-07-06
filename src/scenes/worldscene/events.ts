/* ===== KubeQuest – WorldScene-Gefahren-RENDERER (worldscene/events.ts) =====
 * Seit #540 lebt der Gefahren-*Zustand* + die *Zeitachse* szenen-neutral in der Anwendung
 * (src/game/hazards.ts, getaktet aus Game.tick), damit Piraten/Krake/Sturm in JEDER Szene
 * starten und fortschreiten. Dieses Modul ist nur noch die PRÄSENTATION: es registriert einen
 * runtime-Sink (setHazardSink) und führt die gemeldeten `HazardEvent`s aus –
 *   - global (jede Szene): der Alarm-DOM + der rote Warnrahmen + der Alert-Sound,
 *   - weltgebunden (nur wenn die WorldScene wach ist): die Welt-Sprites (Piratenboot/Krake/
 *     Sturm-Regen) + Kamera-Shake, plus Belohnung/Strafe beim Auflösen.
 *
 * Die Sprites werden beim Einschlafen der WorldScene abgebaut und beim Aufwachen aus dem
 * gemeldeten Zustand REKONSTRUIERT (reconcile) – so „spawnt beim Betreten nach, was während
 * der Abwesenheit entstand" (#540). Der Start-Kern (Opfer-Wahl, Cluster-Mutation) liegt in
 * game/hazards.ts; hier steht bewusst KEINE Domänen-Entscheidung mehr. */
import Phaser from "phaser";
import { Game } from "../../game";
import { UI } from "../../ui";
import { SFX } from "../../sfx";
import { T } from "../shared";
import { setHazardSink } from "../../runtime";
import type { HazardEvent, HazardStartInfo, HazardKind } from "../../world/hazards";
import type { WorldSceneLike } from "./types";

/* ---------- Präsentations-Zustand (Modul-Singleton: es gibt eine WorldScene) ---------- */
let activeWorld: WorldSceneLike | null = null;
let awake = false;
let boat: Phaser.GameObjects.Container | null = null;
let krakenSpr: Phaser.GameObjects.Container | null = null;
let stormFlash: Phaser.Time.TimerEvent | null = null;

/** Alarm-Meldung aus den strukturierten Start-Daten formatieren (HTML bleibt Präsentation –
 *  die Anwendung liefert nur Struktur). Gespiegelt aus den früheren tryStart*-Strings. */
function alarmHtml(info: HazardStartInfo): string {
  if (info.kind === "storm") {
    const hint = info.fix === "imagepull"
      ? "Diagnose: <code>kubectl get pods</code> → <code>describe</code>. Fix: <code>kubectl set image deployment/" + info.dep + " …</code>"
      : "Diagnose: <code>kubectl get pods</code> → <code>kubectl logs &lt;pod&gt;</code>. Dann Ursache beheben + <code>rollout restart</code>!";
    return "⛈️ <b>STURMSCHADEN!</b> Das Deployment <b>" + info.dep + "</b> ist ausgefallen – und verdient nichts mehr! " + hint;
  }
  if (info.kind === "pirate") {
    return "🏴‍☠️ <b>PIRATEN-ÜBERFALL!</b> Sie haben Kisten von <b>" + info.dep + "</b> geklaut (nur noch " + info.left + "/" + info.want + ")! " +
      "Skaliere zurück auf <b>" + info.want + "</b>: <code>kubectl scale deployment " + info.dep + " --replicas=" + info.want + "</code>";
  }
  return "🐙 <b>DIE HACKER-KRAKE!</b> Sie schnüffelt nach Klartext-Daten! Vertreibe sie, indem du irgendein neues <b>Secret</b> anlegst: " +
    "<code>kubectl create secret generic &lt;name&gt; --from-literal=passwort=&lt;wert&gt;</code>";
}

/* ---------- Welt-Sprites (nur wenn die WorldScene wach ist) ---------- */

function spawnBoat(scene: WorldSceneLike): void {
  // Pixelart-Piratenschiff (#185): 128×96-Asset (dunkler Rumpf + Totenkopf-Segel), Bug nach
  // links = in Fahrtrichtung; auf Gegner-Größe herunterskaliert.
  boat = scene.add.container(scene.W * T + 30, 31 * T).setDepth(8000);
  const hull = scene.add.image(0, -4, "pirate_ship").setOrigin(0.5, 0.5).setScale(0.34);
  boat.add(hull);
  scene.tweens.add({ targets: boat, x: 24 * T, duration: 2600, ease: "Sine.out" });
  scene.tweens.add({ targets: boat, y: 31 * T - 2, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  scene.cameras.main.shake(250, 0.004);
}

function spawnKraken(scene: WorldSceneLike): void {
  // Pixelart-Krake (#184): 64×64-Asset, auf Gegner-Größe herunterskaliert.
  const kx = 26 * T, ky = 30 * T;
  krakenSpr = scene.add.container(kx, ky + 30).setDepth(8000);
  const body = scene.add.image(0, 0, "kraken").setOrigin(0.5, 0.5).setScale(0.46);
  krakenSpr.add(body);
  scene.tweens.add({ targets: krakenSpr, y: ky, duration: 900, ease: "Back.out" });
  scene.tweens.add({ targets: krakenSpr, angle: { from: -4, to: 4 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  scene.cameras.main.shake(250, 0.004);
}

function startStormVisuals(scene: WorldSceneLike): void {
  scene.rain.start();
  scene.stormOverlay.setVisible(true);
  scene.cameras.main.flash(180, 200, 210, 255);
  scene.cameras.main.shake(280, 0.004);
  stormFlash = scene.time.addEvent({ delay: 5200, loop: true, callback: () => {
    scene.cameras.main.flash(140, 200, 210, 255);
    SFX.thunder();
  }});
}

/** Sprite für eine Gefahren-Art aufbauen (nur wenn nicht schon da – idempotent fürs reconcile). */
function spawnFor(scene: WorldSceneLike, kind: HazardKind): void {
  if (kind === "storm") { if (!stormFlash) startStormVisuals(scene); }
  else if (kind === "pirate") { if (!boat) spawnBoat(scene); }
  else if (!krakenSpr) spawnKraken(scene);
}

function despawnBoat(scene: WorldSceneLike, animate: boolean): void {
  if (!boat) return;
  const b = boat; boat = null;
  if (animate) scene.tweens.add({ targets: b, x: scene.W * T + 40, duration: 1800, ease: "Sine.in", onComplete: () => b.destroy() });
  else b.destroy();
}

function despawnKraken(scene: WorldSceneLike, animate: boolean): void {
  if (!krakenSpr) return;
  const k = krakenSpr; krakenSpr = null;
  if (animate) scene.tweens.add({ targets: k, y: "+=40", alpha: 0, duration: 700, ease: "Sine.in", onComplete: () => k.destroy() });
  else k.destroy();
}

function stopStormVisuals(scene: WorldSceneLike): void {
  if (stormFlash) { stormFlash.remove(); stormFlash = null; }
  scene.rain.stop();
  scene.stormOverlay.setVisible(false);
}

/** Welt-Sprites einer Gefahren-Art abbauen. `animate` nur beim echten Auflösen; beim
 *  Einschlafen sofort weg (die Szene ist ohnehin unsichtbar). */
function despawnFor(scene: WorldSceneLike, kind: HazardKind, animate: boolean): void {
  if (kind === "storm") stopStormVisuals(scene);
  else if (kind === "pirate") despawnBoat(scene, animate);
  else despawnKraken(scene, animate);
}

function despawnAll(scene: WorldSceneLike): void {
  stopStormVisuals(scene);
  despawnBoat(scene, false);
  despawnKraken(scene, false);
}

/* ---------- Belohnung/Strafe beim Auflösen (gespiegelt aus den früheren resolve*) ---------- */
function applyOutcome(kind: HazardKind, success: boolean, dep?: string): void {
  if (kind === "storm") {
    if (success) { Game.state.stats.stormsFixed = (Game.state.stats.stormsFixed || 0) + 1; UI.reward(35, 50, "⛈️ Sturmschaden behoben!"); SFX.fanfare(); }
    else UI.hint("⛈️ Der Sturm zieht ab – aber <b>" + (dep ?? "das Deployment") + "</b> bleibt kaputt (und verdient nichts), bis du es reparierst!");
  } else if (kind === "pirate") {
    if (success) {
      const bounty = Math.round(40 * (Game.hasUpgrade("kanone") ? 1.5 : 1));
      Game.state.stats.piratesBeaten++;
      if (Game.hasUpgrade("kanone") && awake && activeWorld) { activeWorld.cameras.main.shake(150, 0.003); SFX.tone(80, 0.3, "sawtooth", 0.06); }
      UI.reward(25, bounty, "🏴‍☠️ Piraten vertrieben!"); SFX.fanfare();
    } else UI.hint("🏴‍☠️ Die Piraten sind entkommen … Stell die Kopien trotzdem wieder her – deine Einnahmen leiden!");
  } else {
    if (success) { Game.state.stats.krakenBeaten++; UI.reward(30, 50, "🐙 Krake vertrieben!"); SFX.fanfare(); }
    else {
      const stolen = Math.min(20, Game.state.coins);
      Game.spendCoins(stolen); // gedeckt (stolen <= coins) → zieht ab + speichert, zentral über das Coins-VO (#490)
      UI.hint("🐙 Die Krake hat " + stolen + " 🪙 erbeutet! Leg beim nächsten Mal schnell ein Secret an.");
    }
  }
}

/* ---------- Der Sink: ein Gefahren-Ereignis in Effekte übersetzen ---------- */
function onHazard(ev: HazardEvent): void {
  if (ev.type === "tick") { UI.updateAlarmTimer(ev.secondsLeft); return; }
  if (ev.type === "start") {
    UI.showAlarm(alarmHtml(ev.info), ev.deadlineSec);
    UI.setHazardFrame(true);
    if (ev.info.kind === "storm") SFX.thunder(); else SFX.alarm();
    if (awake && activeWorld) spawnFor(activeWorld, ev.info.kind);
    return;
  }
  // resolve
  if (awake && activeWorld) despawnFor(activeWorld, ev.kind, true);
  UI.hideAlarm();
  UI.setHazardFrame(Game.hazardActive());
  applyOutcome(ev.kind, ev.success, ev.dep);
}

// EINMAL beim Modul-Laden registrieren (die WorldScene lädt dieses Modul beim Boot). Der Sink
// bleibt über den ganzen Lauf aktiv – Game.tick meldet auch dann, wenn keine WorldScene wach
// ist (dann nur Alarm/Rahmen, keine Sprites).
setHazardSink(onHazard);

/** Nach dem Aufwachen / beim ersten create: die Welt-Sprites aus dem gemeldeten Zustand
 *  nachziehen (#540 „spawnt beim Betreten nach"). Idempotent über spawnFor. */
function reconcile(scene: WorldSceneLike): void {
  const st = Game.hazardState();
  if (st.storm) spawnFor(scene, "storm");
  if (st.pirate) spawnFor(scene, "pirate");
  if (st.kraken) spawnFor(scene, "kraken");
  UI.setHazardFrame(Game.hazardActive());
}

/** Von WorldScene.create() gerufen: diese Szene ist der aktive Gefahren-Renderer. Verdrahtet
 *  Aufwachen/Einschlafen/Herunterfahren und rekonstruiert einen ggf. schon laufenden Zustand. */
export function registerHazardRenderer(scene: WorldSceneLike): void {
  activeWorld = scene;
  awake = true;
  scene.events.on(Phaser.Scenes.Events.WAKE, () => { if (scene === activeWorld) { awake = true; reconcile(scene); } });
  scene.events.on(Phaser.Scenes.Events.SLEEP, () => { if (scene === activeWorld) { awake = false; despawnAll(scene); } });
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => unregisterHazardRenderer(scene));
  reconcile(scene);
}

/** Beim Herunterfahren der WorldScene (scene.start("World", …) für einen Map-Wechsel): den
 *  Renderer lösen, damit keine Sprite-Refs auf eine tote Szene zeigen. */
export function unregisterHazardRenderer(scene: WorldSceneLike): void {
  if (scene !== activeWorld) return;
  despawnAll(scene);
  activeWorld = null;
  awake = false;
}
