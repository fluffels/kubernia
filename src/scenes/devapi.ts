/* Dev-Test-Zugang (#1284): hängt `window.kqGame` und `window.kqDev` ein.
 *
 * Nur main.ts ruft `installDevApi` und nur hinter `import.meta.env.DEV` – im Prod-/Offline-
 * Build fällt der ganze Import weg. Das Modul hat bewusst KEINE Top-Level-Seiteneffekte
 * (Tree-Shaking). Die Logik liegt in der puren Domäne (`devtools/snapshot`, `devtools/
 * timestep`); hier wird nur gesammelt (Phaser/DOM/Game lesen) und eingehängt.
 *
 *  - `kqDev.state()`            JSON-Snapshot des Spielzustands (Agenten: erster Prüfschritt
 *                               vor dem Screenshot)
 *  - `kqDev.advanceTime(ms)`    Spielzeit frame-weise vorspulen, ohne Echtzeit zu warten
 *  - `kqDev.ready`              wahr ab dem ersten Frame mit Spielfigur
 *  - `roadmap`/`jump`/`freshStart`/`reset`  Quest-Sprung-Werkzeuge (#329) */
import Phaser from "phaser";
import { Game } from "../game";
import { UI } from "../ui";
import { SaveStore } from "../store";
import { OVERLAYS } from "../ui/overlays";
import { buildDevSnapshot, type DevSnapshot, type DevSnapshotSource } from "../devtools/snapshot";
import { planAdvance } from "../devtools/timestep";
import { WorldScene } from "./WorldScene";
import { RegionScene } from "./RegionScene";
import { InteriorScene } from "./InteriorScene";

interface SceneView { key: string; map: string | null; player: DevSnapshotSource["player"] }

/** Spielfigur-Sicht einer laufenden Szene (null für Boot/Test-Szenen ohne Figur). */
function viewScene(scene: Phaser.Scene): SceneView | null {
  if (scene instanceof WorldScene) return { key: scene.scene.key, map: scene.mapId, player: scene.playerPos };
  if (scene instanceof RegionScene) return { key: scene.scene.key, map: scene.cfg.map, player: scene.pl };
  if (scene instanceof InteriorScene) return { key: scene.scene.key, map: `interior:${scene.door.id}`, player: scene.pl };
  return null;
}

function openOverlays(): string[] {
  return OVERLAYS.filter((o) => document.getElementById(o.id)?.classList.contains("hidden") === false).map((o) => o.key);
}

function dialogueSource(): DevSnapshotSource["dialogue"] {
  const d = UI.dialogue;
  if (!d) return null;
  const c = d.choice;
  const choice = c === null ? null : "menu" in c ? { menu: true as const } : { q: c.q };
  return { npcId: d.npcId, lines: d.lines, idx: d.idx, choice };
}

function collect(game: Phaser.Game, readyLatched: boolean): DevSnapshotSource {
  const running = game.scene.getScenes(true, true);
  const views = running.map(viewScene);
  const top = views.find((v): v is SceneView => v !== null) ?? null;
  const step = Game.currentStep();
  const cal = Game.calendar();
  const task = step ? Game.stepTasks(step)?.[Game.taskIdx()] : undefined;
  return {
    scenes: running.map((s) => s.scene.key),
    scene: top?.key ?? null,
    map: top?.map ?? null,
    player: top?.player ?? null,
    readyLatched,
    currentQuestId: Game.state.currentQuestId,
    questIdx: Game.questIdx(),
    questStep: Game.questStep(),
    questTask: Game.taskIdx(),
    stepType: step?.type ?? null,
    taskText: task?.text ?? null,
    activeQuests: Game.state.activeQuests,
    completedQuestCount: Game.state.completedQuests.length,
    dialogue: dialogueSource(),
    overlays: openOverlays(),
    blocking: UI.blocking(),
    clock: { day: cal.day, hhmm: cal.hhmm, weekday: cal.weekday, seasonName: cal.seasonName, gameDays: Game.state.gameDays },
    coins: Game.state.coins,
    xp: Game.state.xp,
    hazards: Game.hazardState(),
  };
}

/** Steppt Phaser `ms` Spielzeit synchron vor (headless, nur der letzte Frame rendert). */
function advance(game: Phaser.Game, ms: number, frameMs?: number): void {
  if (!game.isBooted) throw new Error("kqDev.advanceTime: Spiel ist noch nicht gebootet (auf kqDev.ready warten)");
  if (game.isPaused) throw new Error("kqDev.advanceTime: Spiel ist pausiert");
  const plan = planAdvance(ms, frameMs);
  let t = game.loop.now;
  for (let i = 0; i < plan.frames; i++) {
    t += plan.frameMs;
    if (i === plan.frames - 1 && plan.remainderMs === 0) game.step(t, plan.frameMs);
    else game.headlessStep(t, plan.frameMs);
  }
  if (plan.remainderMs > 0) {
    t += plan.remainderMs;
    game.step(t, plan.remainderMs);
  }
  game.loop.resetDelta();
}

/** Hängt kqGame + kqDev an `window` (nur Dev). */
export function installDevApi(game: Phaser.Game): void {
  const w = window as unknown as { kqGame: Phaser.Game; kqDev: Record<string, unknown> };
  let readyLatched = false;
  game.events.on(Phaser.Core.Events.POST_STEP, () => {
    if (readyLatched) return;
    readyLatched = collect(game, false).player !== null;
  });

  w.kqGame = game;
  w.kqDev = {
    /** JSON-Snapshot des Spielzustands (Szene, Spieler/Kachel, Quest, Dialog, Uhr, …). */
    state: (): DevSnapshot => buildDevSnapshot(collect(game, readyLatched)),
    /** Spielzeit `ms` vorspulen (Frame-Stepping, synchron) und den neuen Snapshot liefern. */
    advanceTime: (ms: number, opts?: { frameMs?: number }): DevSnapshot => {
      advance(game, ms, opts?.frameMs);
      return buildDevSnapshot(collect(game, readyLatched));
    },
    get ready(): boolean { return readyLatched; },
    /** Roadmap aller Quests als Tabelle in die Konsole (idx → Quest). */
    roadmap: () => { console.table(Game.getQuestRoadmap()); return Game.getQuestRoadmap(); },
    /** An den Anfang von Quest `idx` springen (Stand + Cluster + Spawn) und neu laden. */
    jump: (idx: number) => {
      if (Game.jumpToQuest(idx)) location.reload();
      else console.warn(`kqDev.jump: ungültiger Quest-Index ${idx} (0…${Game.getQuestRoadmap().length})`);
    },
    /** Echter Erststart: Save löschen + neu laden → frischer Stand inkl. Intro. */
    freshStart: () => { SaveStore.remove(); location.reload(); },
    /** Bestehender Reset-Pfad (wie Menü → Zurücksetzen) + neu laden. */
    reset: () => { Game.reset(); location.reload(); },
  };
  console.info("🛠️ kqDev bereit: state() · advanceTime(ms) · ready · roadmap() · jump(idx) · freshStart() · reset()");
}
