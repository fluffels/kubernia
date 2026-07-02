/* ===== KubeQuest – WorldScene-Gefahren (worldscene/events.ts) =====
 * Schritt des WorldScene.ts-Splits (#393). Hier liegt das Zufalls-Gefahren-System
 * der Hauptkarte: Piraten-Überfall, Hacker-Krake und Sturmschaden – jeweils
 * mit tryStart…/resolve… – plus die gemeinsame Terminierung (scheduleEvents,
 * anyEventActive) und der pro-Frame-Tick (tickEvents), den update() aufruft.
 *
 * Bewusst EIN kohäsives Modul: die drei Gefahren teilen sich die Terminierung,
 * die „nur eine Gefahr gleichzeitig"-Regel (anyEventActive) und das Alarm-/
 * Deadline-Muster. Wächst das System bei Stardew-Scope um weitere Gefahrentypen
 * über das Datei-Budget (#390), ist der Schnitt offensichtlich: je Gefahr ein
 * eigenes pirates.ts/kraken.ts/storm.ts mit diesem Kern als gemeinsamer Basis.
 *
 * Freie Funktionen mit der Szene als Parameter; Phaser/SFX/UI/Game bleiben hier
 * gebündelt, der Cluster-Zustand aber in Game.sim (eine Hand).
 */
import Phaser from "phaser";
import { Game } from "../../game";
import { UI } from "../../ui";
import { KQContent } from "../../content";
import { SFX } from "../../sfx";
import { T } from "../shared";
import { hazardStartable, stormVictims, pirateVictims, resolveHazardTick } from "../../world/hazards";
import type { WorldSceneLike } from "./types";

export function scheduleEvents(scene: WorldSceneLike, delaySec?: number) {
  const now = scene.time.now / 1000;
  // Spiel-Feel (#71): Cozy streckt die Wartezeit, "Aus" schiebt sie auf
  // Infinity (next* wird nie erreicht → keine Zufalls-Events).
  const scale = Game.eventProfile().spawnScale;
  scene.hazards.nextPirate = now + (delaySec || Phaser.Math.Between(200, 360)) * scale;
  scene.hazards.nextKraken = now + (delaySec ? delaySec + 90 : Phaser.Math.Between(300, 500)) * scale;
  scene.hazards.nextStorm = now + (delaySec ? delaySec + 150 : Phaser.Math.Between(260, 430)) * scale;
}

export function anyEventActive(scene: WorldSceneLike) {
  return !!(scene.hazards.pirate || scene.hazards.kraken || scene.hazards.storm);
}

/* ---------- Sturm: ein Deployment geht kaputt, du reparierst es ---------- */
export function tryStartStorm(scene: WorldSceneLike) {
  if (!hazardStartable("storm", { enabled: Game.eventProfile().enabled, anyActive: anyEventActive(scene), completedQuests: Game.state.completedQuests })) return;
  const victims = stormVictims(Game.sim.deployments);
  if (victims.length === 0 || UI.blocking()) { scene.hazards.nextStorm += 25; return; }
  const dep = Phaser.Utils.Array.GetRandom(victims);
  const kind = Math.random() < 0.5 ? "imagepull" : "crashloop";
  let hintCmd;
  if (kind === "imagepull") {
    // Der Sturm "verdreht" den Image-Namen (Buchstabendreher)
    const bad = KQContent.corruptImage(dep.image.split(":")[0]);
    dep.broken = { type: "imagepull", badImage: bad };
    dep.image = bad;
    hintCmd = "Diagnose: <code>kubectl get pods</code> → <code>describe</code>. Fix: <code>kubectl set image deployment/" + dep.name + " …</code>";
  } else {
    dep.broken = { type: "crashloop", needsSecret: "sturm-schluessel-" + Phaser.Math.Between(10, 99) };
    hintCmd = "Diagnose: <code>kubectl get pods</code> → <code>kubectl logs &lt;pod&gt;</code>. Dann Ursache beheben + <code>rollout restart</code>!";
  }
  Game.sim.touch();   // #523: direkte Cluster-Mutation (broken/image) → Cluster-Sync anstoßen (Kisten rot färben)
  Game.save();

  scene.rain.start();
  scene.stormOverlay.setVisible(true);
  SFX.thunder();
  scene.cameras.main.flash(180, 200, 210, 255);
  scene.cameras.main.shake(280, 0.004);
  scene.hazards.stormFlash = scene.time.addEvent({ delay: 5200, loop: true, callback: () => {
    scene.cameras.main.flash(140, 200, 210, 255);
    SFX.thunder();
  }});

  const deadline = Math.round(240 * Game.eventProfile().deadlineScale);
  scene.hazards.storm = { dep: dep.name, until: scene.time.now / 1000 + deadline };
  UI.showAlarm("⛈️ <b>STURMSCHADEN!</b> Das Deployment <b>" + dep.name + "</b> ist ausgefallen – und verdient nichts mehr! " + hintCmd, deadline);
}

export function resolveStorm(scene: WorldSceneLike, success: boolean) {
  const ev = scene.hazards.storm;
  if (!ev) return;
  scene.hazards.storm = null;
  if (scene.hazards.stormFlash) { scene.hazards.stormFlash.remove(); scene.hazards.stormFlash = null; }
  scene.rain.stop();
  scene.stormOverlay.setVisible(false);
  UI.hideAlarm();
  if (success) {
    Game.state.stats.stormsFixed = (Game.state.stats.stormsFixed || 0) + 1;
    UI.reward(35, 50, "⛈️ Sturmschaden behoben!");
    SFX.fanfare();
  } else {
    UI.hint("⛈️ Der Sturm zieht ab – aber <b>" + ev.dep + "</b> bleibt kaputt (und verdient nichts), bis du es reparierst!");
  }
  scheduleEvents(scene);
}

export function tryStartPirate(scene: WorldSceneLike) {
  if (!hazardStartable("pirate", { enabled: Game.eventProfile().enabled, anyActive: anyEventActive(scene), completedQuests: Game.state.completedQuests })) return;
  const victims = pirateVictims(Game.sim.deployments);
  if (victims.length === 0 || UI.blocking()) { scene.hazards.nextPirate += 20; return; }
  const dep = Phaser.Utils.Array.GetRandom(victims);
  const want = dep.replicas;
  const steal = Math.max(1, Math.floor(dep.replicas / 2));
  dep.replicas -= steal;
  dep.pods.splice(0, steal);
  Game.sim.touch();   // #523: direkte Cluster-Mutation (geklaute Pods) → Cluster-Sync anstoßen (Kisten entfernen)
  Game.save();

  // Piratenboot segelt heran
  const boat = scene.add.container(scene.W * T + 30, 31 * T).setDepth(8000);
  // Pixelart-Piratenschiff (#185) statt der früheren code-gezeichneten fillRect-Rümpfe.
  // 128×96-Asset (dunkler Rumpf + schwarzes Totenkopf-Segel), Bug nach links = in
  // Fahrtrichtung; auf Gegner-Größe herunterskaliert. Überfall-/Tween-Logik unverändert.
  const hull = scene.add.image(0, -4, "pirate_ship").setOrigin(0.5, 0.5).setScale(0.34);
  boat.add(hull);
  scene.tweens.add({ targets: boat, x: 24 * T, duration: 2600, ease: "Sine.out" });
  scene.tweens.add({ targets: boat, y: 31 * T - 2, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });

  SFX.alarm();
  scene.cameras.main.shake(250, 0.004);
  const deadline = Math.round(180 * Game.eventProfile().deadlineScale);
  scene.hazards.pirate = { dep: dep.name, want, boat, until: scene.time.now / 1000 + deadline };
  UI.showAlarm("🏴‍☠️ <b>PIRATEN-ÜBERFALL!</b> Sie haben Kisten von <b>" + dep.name + "</b> geklaut (nur noch " + dep.replicas + "/" + want + ")! " +
    "Skaliere zurück auf <b>" + want + "</b>: <code>kubectl scale deployment " + dep.name + " --replicas=" + want + "</code>", deadline);
}

export function resolvePirate(scene: WorldSceneLike, success: boolean) {
  const ev = scene.hazards.pirate;
  if (!ev) return;
  scene.tweens.add({ targets: ev.boat, x: scene.W * T + 40, duration: 1800, ease: "Sine.in", onComplete: () => ev.boat.destroy() });
  scene.hazards.pirate = null;
  UI.hideAlarm();
  if (success) {
    const bounty = Math.round(40 * (Game.hasUpgrade("kanone") ? 1.5 : 1));
    Game.state.stats.piratesBeaten++;
    if (Game.hasUpgrade("kanone")) { scene.cameras.main.shake(150, 0.003); SFX.tone(80, 0.3, "sawtooth", 0.06); }
    UI.reward(25, bounty, "🏴‍☠️ Piraten vertrieben!");
    SFX.fanfare();
  } else {
    UI.hint("🏴‍☠️ Die Piraten sind entkommen … Stell die Kopien trotzdem wieder her – deine Einnahmen leiden!");
  }
  scheduleEvents(scene);
}

export function tryStartKraken(scene: WorldSceneLike) {
  if (!hazardStartable("kraken", { enabled: Game.eventProfile().enabled, anyActive: anyEventActive(scene), completedQuests: Game.state.completedQuests })) return;
  if (UI.blocking()) { scene.hazards.nextKraken += 20; return; }
  const baseline = Game.sim.secrets.length;

  const kx = 26 * T, ky = 30 * T;
  const kraken = scene.add.container(kx, ky + 30).setDepth(8000);
  // Pixelart-Sprite (#184) statt der früheren code-gezeichneten fillCircle/fillRect-Krake.
  // 64×64-Asset, auf Gegner-Größe herunterskaliert; Wackel-/Auftauch-Tweens unten unverändert.
  const body = scene.add.image(0, 0, "kraken").setOrigin(0.5, 0.5).setScale(0.46);
  kraken.add(body);
  scene.tweens.add({ targets: kraken, y: ky, duration: 900, ease: "Back.out" });
  scene.tweens.add({ targets: kraken, angle: { from: -4, to: 4 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });

  SFX.alarm();
  scene.cameras.main.shake(250, 0.004);
  const deadline = Math.round(120 * Game.eventProfile().deadlineScale);
  scene.hazards.kraken = { kraken, baseline, until: scene.time.now / 1000 + deadline };
  UI.showAlarm("🐙 <b>DIE HACKER-KRAKE!</b> Sie schnüffelt nach Klartext-Daten! Vertreibe sie, indem du irgendein neues <b>Secret</b> anlegst: " +
    "<code>kubectl create secret generic &lt;name&gt; --from-literal=passwort=&lt;wert&gt;</code>", deadline);
}

export function resolveKraken(scene: WorldSceneLike, success: boolean) {
  const ev = scene.hazards.kraken;
  if (!ev) return;
  scene.tweens.add({ targets: ev.kraken, y: "+=40", alpha: 0, duration: 700, ease: "Sine.in", onComplete: () => ev.kraken.destroy() });
  scene.hazards.kraken = null;
  UI.hideAlarm();
  if (success) {
    Game.state.stats.krakenBeaten++;
    UI.reward(30, 50, "🐙 Krake vertrieben!");
    SFX.fanfare();
  } else {
    const stolen = Math.min(20, Game.state.coins);
    Game.spendCoins(stolen); // gedeckt (stolen <= coins) -> zieht ab + speichert, zentral über das Coins-VO (#490)
    UI.hint("🐙 Die Krake hat " + stolen + " 🪙 erbeutet! Leg beim nächsten Mal schnell ein Secret an.");
  }
  scheduleEvents(scene);
}

/** Pro Frame aus update(): fällige Gefahren starten und laufende auf Erfolg/
 *  Deadline prüfen + den Alarm-Countdown aktualisieren. Kapselt den früheren
 *  inline-Event-Block der update()-Schleife. */
export function tickEvents(scene: WorldSceneLike, time: number) {
  const now = time / 1000;
  if (now > scene.hazards.nextPirate) tryStartPirate(scene);
  if (now > scene.hazards.nextKraken) tryStartKraken(scene);
  if (now > scene.hazards.nextStorm) tryStartStorm(scene);
  // Die spielentscheidenden Auflöse-/Deadline-Entscheidungen liegen jetzt im
  // reinen Kern (#512); hier bleibt nur die Effekt-Ausführung. Die Szenen-
  // `hazards` erfüllen `ActiveHazards` strukturell (nur mit Phaser-Extras).
  const view = { deployments: Game.sim.deployments, secretCount: Game.sim.secrets.length };
  for (const action of resolveHazardTick(scene.hazards, view, now)) {
    if (action.type === "tick") { UI.updateAlarmTimer(action.secondsLeft); continue; }
    if (action.kind === "storm") resolveStorm(scene, action.success);
    else if (action.kind === "pirate") resolvePirate(scene, action.success);
    else resolveKraken(scene, action.success);
  }
}
