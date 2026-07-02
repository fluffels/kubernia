/* ===== KubeQuest – WorldScene-System-Typ (worldscene/types.ts) =====
 * Schritt des WorldScene.ts-Splits (#393, analog scenes.ts-Split #345): die großen
 * Spiel-Systeme der World-Szene (Gefahren-Events, Cluster-Sync, Warps, Terrain,
 * Deko) liegen als eigene, fokussierte Module unter src/scenes/worldscene/ und
 * bekommen die laufende Szene als Parameter (`scene`) – dasselbe „freie Funktion
 * + Host"-Muster wie der sim.ts-Split (#346).
 *
 * `WorldSceneLike` ist die Sicht dieser Szene für die Module. Sie war früher eine
 * lose `[key: string]: any`-Index-Signatur (#393/#423) – jeder Feldzugriff der
 * Module war damit UNGETYPT, obwohl die WorldScene-Klasse ihre ~50 Felder korrekt
 * typisiert. Seit #496 ist das ein echtes Interface `WorldSceneFields` (nur Typen):
 * `WorldScene implements WorldSceneFields` (der Compiler prüft, dass die Klasse
 * wirklich jedes Feld + jede Render-Primitive hat), und die Module sehen die Szene
 * als `WorldSceneLike = Phaser.Scene & WorldSceneFields` – voll typgeprüft, aber
 * OHNE WorldScene.ts zu importieren. Ein Wert- oder Typ-Import von WorldScene.ts wäre
 * ein Import-Zyklus (WorldScene → Modul → WorldScene), den der Arch-Wächter #390
 * verbietet (Typ-Importe zählen dort mit, tsPreCompilationDeps). Die Feld-Typen
 * (DecoItem/… bis Hazards) liegen darum hier statt in WorldScene.ts – die Klasse
 * importiert sie von hier zurück, kein Modul pflegt mehr eine zweite Feldliste von
 * Hand (das war die frühere DynTagLike-Doppelpflege in clustersync.ts).
 */
import type Phaser from "phaser";
import type { Hitbox, Door } from "../../world/world";
import type { Spawn } from "../../content/entities";
import type { LayoutBox } from "../../hud/labellayout";
import type { Cullable, FrameSampler } from "../../hud/cull";
import type { MapId } from "../../world/maps/mapregistry";
import type { SceneNpc } from "../shared";

/* ── Laufzeit-Typen der WorldScene-Felder (#423, hierher gezogen mit #496). ── */
/** Gesetztes/gestreutes Deko-Element (Bäume/Möbel/Objekte) – renderStatics liest es. */
export interface DecoItem { x: number; y: number; sheet: string; idx?: number; obj?: boolean; scale?: number; }
/** Festes Orts-Schild als Daten (gesammelt, bevor renderStatics es als 9-Slice baut). */
export interface LabelSpec { x: number; y: number; text: string; color?: string; depth?: number; }
/** Dynamisches Cluster-Tag als DATEN (#416): kein Dauer-Container mehr je Tag,
 *  sondern Position/Text/Status. Nur die JETZT sichtbaren bekommen pro Frame einen
 *  Container aus `tagPool` (updateDynamicTags). `tx,ty` = Tag-Position (ty = Basis
 *  fürs Entzerren), `ax,ay` = Bezugs-Objekt (Distanz zur Figur + Tiefe). */
export interface DynTagData { tx: number; ty: number; ax: number; ay: number; text: string; status: number; compact: boolean; }
/** Pod-Kiste an einem Steg-Slot (Cluster→Welt-Sync). */
export interface PodSlot { slot: number; crate: Phaser.GameObjects.Image; band: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; dep: string; }
/** Über die Wiese flatternder Schmetterling. */
export interface Butterfly { spr: Phaser.GameObjects.Image; ax: number; ay: number; ph: number; sp: number; }
/** Spieler-Laufzeitzustand der Hauptkarte (wie `ScenePlayer`, plus `dir` für den Wurf). */
export interface PlayerPos { x: number; y: number; dir: number; moving: boolean; face: string; }
/** Zufalls-Gefahren-Beutel der Hauptkarte (worldscene/events.ts schreibt/liest ihn).
 *  Hieß früher `events` und überschrieb damit Phasers geerbten EventEmitter mit `any`
 *  (genau das war die Warnung) – jetzt ein eigenes, getipptes Feld `hazards`. */
export interface Hazards {
  nextPirate: number;
  nextKraken: number;
  nextStorm: number;
  pirate: { dep: string; want: number; boat: Phaser.GameObjects.Container; until: number } | null;
  kraken: { kraken: Phaser.GameObjects.Container; baseline: number; until: number } | null;
  storm: { dep: string; until: number } | null;
  stormFlash: Phaser.Time.TimerEvent | null;
}

/** Die konkreten WorldScene-Felder + die Render-Primitive, die die Systemmodule auf
 *  der Szene aufrufen – als reines Typ-Interface (#496). WorldScene implementiert es,
 *  die Module sehen die Szene als `WorldSceneLike`. */
export interface WorldSceneFields {
  // Welt-Raster + Kollision
  W: number;
  H: number;
  ground: number[];
  solidGrid: Uint8Array;
  softGrid: Uint8Array;
  softObstacles: Hitbox[];
  // Deko/Beschriftungen (von worldscene/terrain + scenery gefüllt)
  decoList: DecoItem[];
  labels: LabelSpec[];
  signBoxes: LayoutBox[];
  // Cluster-Tags als Daten + wiederverwendbarer Render-Pool (#416)
  dynTags: DynTagData[];
  tagPool: Phaser.GameObjects.Container[];
  tagFontDefault?: number;
  visibleTags: number;
  lampGlows: Phaser.GameObjects.Image[];
  // Hafen-Objekt-Felder aus terrain.ts
  piers: { x: number; name: string }[];
  ship: { x: number; y: number; w: number; h: number };
  flagPoles: { x: number; y: number }[];
  lighthouse: { x: number; y: number };
  tfPlatform: { x: number; y: number; w: number; h: number };
  doors: Door[];
  npcSpawns: Spawn[];
  // Cluster→Welt-Sync
  podSlots: Record<string, PodSlot>;
  slotUsed: boolean[];
  lastClusterRev: number;   // #523: zuletzt synchronisierte Sim.rev (Frame-Sparbremse)
  dynamic: { barrelsSig: string; flagsSig: string; svcSig: string; depSig: string };
  dynGroup: Phaser.GameObjects.Group;
  // statische Props/Effekte aus scenery.ts
  shipFlag: Phaser.GameObjects.Image;
  lhBeam: Phaser.GameObjects.Image;
  lhLight: Phaser.GameObjects.Image;
  cannon: Phaser.GameObjects.Text;
  tfGroup: Phaser.GameObjects.Container;
  tfBuoys: Phaser.GameObjects.Image[];
  butterflies: Butterfly[];
  // Partikel + Wetter/Tag-Nacht
  splash: Phaser.GameObjects.Particles.ParticleEmitter;
  dust: Phaser.GameObjects.Particles.ParticleEmitter;
  sparkle: Phaser.GameObjects.Particles.ParticleEmitter;
  rain: Phaser.GameObjects.Particles.ParticleEmitter;
  stormOverlay: Phaser.GameObjects.Rectangle;
  dayNight: Phaser.GameObjects.Rectangle;
  // Spieler + Haustier
  playerPos: PlayerPos;
  playerShadow: Phaser.GameObjects.Image;
  playerSprite: Phaser.GameObjects.Image;
  petShadow: Phaser.GameObjects.Image;
  petSprite: Phaser.GameObjects.Image;
  petTrail: { x: number; y: number }[];
  bobT: number;
  stepAcc: number;
  npcs: SceneNpc[];
  // Performance/Culling (#82)
  cullables: Cullable[];
  visibleCullables: number;
  lastCullX: number;
  lastCullY: number;
  fpsSampler: FrameSampler;
  debugPerf: boolean;
  stress: number;
  perfHud?: Phaser.GameObjects.Text;
  // Warp-Gates (Anti-Pingpong) + Zufalls-Gefahren + geladene Karte (#425/#426)
  warpArmed: Set<string>;
  hazards: Hazards;
  mapId: MapId;

  // ── Render-Primitive, die die Systemmodule auf der Szene aufrufen ──
  set(x: number, y: number, v: number): void;
  get(x: number, y: number): number;
  deco(x: number, y: number, sheet: string, idx: number, solid?: boolean): void;
  tree(x: number, y: number): void;
  objDeco(x: number, y: number, tex: string, scale: number, solid?: boolean): void;
  building(x: number, y: number, w: number, tex: string, scale: number): void;
  occupied(x: number, y: number): boolean;
  burstAt(x: number, y: number, kind: string): void;
  registerCullable<T extends Phaser.GameObjects.Components.Visible>(obj: T, px: number, py: number): T;
  makeSign(x: number, y: number, text: string, depth?: number): Phaser.GameObjects.Container;
  makeTechTag(x: number, y: number, text: string, statusColor: number, compact?: boolean): Phaser.GameObjects.Container;
  addShadow(x: number, y: number, w?: number): Phaser.GameObjects.Image;
}

/** Struktur-Sicht der WorldScene für die Systemmodule: die volle Phaser-Szene plus
 *  die getippten WorldScene-Felder/Primitive – ohne Wert-/Typ-Import von WorldScene.ts. */
export type WorldSceneLike = Phaser.Scene & WorldSceneFields;
