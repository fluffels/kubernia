import Phaser from "phaser";
import { Game } from "../game";
import { UI } from "../ui";
import { KQContent } from "../content";
import { npcSolidIndices, npcHitboxes, resolveMove, SHIP_KRALLE, type Hitbox, type Door } from "../world/world";
import { type Spawn } from "../content/entities";
import { type LayoutBox } from "../hud/labellayout";
import { keys, setWorldScene } from "../runtime";
import { expandRect, cull, FrameSampler, type Cullable } from "../hud/cull";
import { getMapEntry, type MapId } from "../world/maps/mapregistry";
import { DAY_CYCLE_MS } from "../core/clock";
import { T, FOAM, pixelText, SIGN_FONT, SIGN_SCALE, buildSign, floatPixelText, type SceneNpc } from "./shared";
// Spiel-Systeme als eigene, fokussierte Module (WorldScene.ts-Split #393, analog
// scenes.ts-Split #345): freie Funktionen mit der Szene als Parameter (`scene`).
// WorldScene ist seither nur noch der schlanke Orchestrator (Aufbau in create(),
// Per-Frame-Takt in update()) plus die geteilten Render-Primitive (set/get/deco/
// tree/objDeco/building/registerCullable/makeSign/makeTechTag/addShadow), Spieler-/
// NPC-Setup, Kollision/Bewegung, Effekte und das Off-screen-Culling.
import { loadMapTerrain } from "./worldscene/mapterrain";
import { placeHarborObjects, renderGround } from "./worldscene/terrain";
import { spawnGull, spawnFlowers, spawnGrassDetail, scatter, renderStatics, updateDayNight } from "./worldscene/scenery";
import { syncCluster, updateDynamicTags } from "./worldscene/clustersync";
import { scheduleEvents, tickEvents } from "./worldscene/events";
import { updateWarps } from "./worldscene/warps";
// #496: die Feld-Typen + das WorldSceneFields-Interface liegen in worldscene/types.ts
// (dieselbe Datei wie WorldSceneLike). Die Klasse implementiert WorldSceneFields, damit
// der Compiler garantiert, dass jedes Feld/jede Render-Primitive, die die Systemmodule
// über WorldSceneLike sehen, hier wirklich existiert – ohne dass ein Modul eine zweite
// Feldliste von Hand pflegt (frühere DynTagLike-Doppelpflege).
import type {
  WorldSceneFields, DecoItem, LabelSpec, DynTagData, PodSlot, Butterfly, PlayerPos, Hazards,
} from "./worldscene/types";

/* #343/#386: Sub-Tile-Kollisionsradien (Pixel). Steine, Büsche und NPCs prallen nicht
 * mehr als volles 16×16-Quadrat ab, sondern als runde Hitbox um ihren Mittelpunkt – so
 * gleitet man an der runden Silhouette weich vorbei statt eckig abzuprallen. Laternen
 * sind schmale Pfosten und bekommen darum ein kleineres, dünnes Rechteck (#386). */
const NPC_HIT_R = 6;
const ROCK_HIT_R = 6;
const BUSH_HIT_R = 6;
const LAMP_HIT: readonly [number, number] = [6, 10];   // Pfosten: schmale Rechteck-Hitbox (B×H)

export class WorldScene extends Phaser.Scene implements WorldSceneFields {
  // Welt-Raster + Kollision
  W!: number;
  H!: number;
  ground!: number[];
  solidGrid!: Uint8Array;
  softGrid!: Uint8Array;
  softObstacles!: Hitbox[];
  // Deko/Beschriftungen (von worldscene/terrain + scenery gefüllt)
  decoList!: DecoItem[];
  labels!: LabelSpec[];
  signBoxes!: LayoutBox[];
  // Cluster-Tags als Daten + wiederverwendbarer Render-Pool (#416, statt je Tag ein Container).
  dynTags!: DynTagData[];
  tagPool!: Phaser.GameObjects.Container[];
  tagFontDefault?: number;   // native (nicht-compacte) Tag-Schriftgröße, einmal gemerkt
  visibleTags!: number;      // gerade dargestellte Tag-Zahl (Perf-HUD-Beleg)
  lampGlows!: Phaser.GameObjects.Image[];
  // Hafen-Objekt-Felder aus terrain.ts (Stege/Schiff/Flaggenmasten/Leuchtturm/Plateau)
  piers!: { x: number; name: string }[];
  ship!: { x: number; y: number; w: number; h: number };
  flagPoles!: { x: number; y: number }[];
  lighthouse!: { x: number; y: number };
  tfPlatform!: { x: number; y: number; w: number; h: number };
  doors!: Door[];
  npcSpawns!: Spawn[];
  // Cluster→Welt-Sync
  podSlots!: Record<string, PodSlot>;
  slotUsed!: boolean[];
  dynamic!: { barrelsSig: string; flagsSig: string; svcSig: string; depSig: string };
  dynGroup!: Phaser.GameObjects.Group;
  // statische Props/Effekte aus scenery.ts
  shipFlag!: Phaser.GameObjects.Image;
  lhBeam!: Phaser.GameObjects.Image;
  lhLight!: Phaser.GameObjects.Image;
  cannon!: Phaser.GameObjects.Text;
  tfGroup!: Phaser.GameObjects.Container;
  tfBuoys!: Phaser.GameObjects.Image[];
  butterflies!: Butterfly[];
  // Partikel + Wetter/Tag-Nacht
  splash!: Phaser.GameObjects.Particles.ParticleEmitter;
  dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  sparkle!: Phaser.GameObjects.Particles.ParticleEmitter;
  rain!: Phaser.GameObjects.Particles.ParticleEmitter;
  stormOverlay!: Phaser.GameObjects.Rectangle;
  dayNight!: Phaser.GameObjects.Rectangle;
  // Spieler + Haustier
  playerPos!: PlayerPos;
  playerShadow!: Phaser.GameObjects.Image;
  playerSprite!: Phaser.GameObjects.Image;
  petShadow!: Phaser.GameObjects.Image;
  petSprite!: Phaser.GameObjects.Image;
  petTrail!: { x: number; y: number }[];
  bobT!: number;
  stepAcc!: number;
  npcs!: SceneNpc[];
  // Performance/Culling (#82)
  cullables!: Cullable[];
  visibleCullables!: number;
  lastCullX!: number;
  lastCullY!: number;
  fpsSampler!: FrameSampler;
  debugPerf!: boolean;
  stress!: number;
  perfHud?: Phaser.GameObjects.Text;
  // Warp-Gates (Anti-Pingpong) + Zufalls-Gefahren
  // #426: ein Set armierter Warp-IDs statt je ein benanntes Boolean pro Region –
  // datengetrieben über REGION_WARPS, sodass eine neue Region kein neues Flag braucht.
  warpArmed!: Set<string>;
  hazards!: Hazards;
  // #425: welche Registry-Karte diese Szene lädt. Default „harbor", damit Boot/
  // Erststart unverändert bleibt; eine zweite Tiled-Region kommt über die Init-Daten
  // (`scene.start("World", { mapId })`) dazu, nicht über eine neue Szenen-Klasse.
  mapId!: MapId;
  constructor() { super("World"); }

  /** Phaser ruft init() vor create() mit den Start-Daten. Default-Karte „harbor"
   *  (BootScene startet ohne Daten). Re-Entry aus den Insel-Szenen läuft über
   *  scene.wake() – init() läuft dann NICHT, mapId bleibt also erhalten. */
  init(data?: { mapId?: MapId }) {
    this.mapId = data?.mapId ?? "harbor";
  }

  /* ============ Aufbau ============ */
  create() {
    setWorldScene(this);
    // #425: Maße datengetrieben aus dem Registry-Eintrag der Karte statt fest 52×40.
    const entry = getMapEntry(this.mapId);
    this.W = entry.width; this.H = entry.height;
    this.ground = new Array(this.W * this.H).fill(0);
    this.solidGrid = new Uint8Array(this.W * this.H);
    // #343: runde Sub-Tile-Hindernisse (Steine/NPCs) + ihre Kachel-Belegung. Das
    // solidGrid bleibt für eckige Solids (Wände/Wasser/Gebäude/Büsche); softGrid
    // hält nur die Belegung der runden Objekte für die Deko-Platzierung fest.
    this.softGrid = new Uint8Array(this.W * this.H);
    this.softObstacles = [] as Hitbox[];
    this.decoList = [];
    this.labels = [];
    this.signBoxes = [];   // feste Holz-Schilder als Hindernisse fürs Tag-Entzerren (#207)
    this.dynTags = [];     // dynamische Cluster-Tags als Daten (#416)
    this.tagPool = [];     // wiederverwendete Tag-Container (nur für die sichtbaren)
    this.visibleTags = 0;
    this.podSlots = {};
    this.slotUsed = new Array(36).fill(false);
    this.dynamic = { barrelsSig: "", flagsSig: "", svcSig: "", depSig: "" };
    this.hazards = { nextPirate: 0, pirate: null, nextKraken: 0, kraken: null, nextStorm: 0, storm: null, stormFlash: null };
    // #426: Anti-Pingpong-Gate aller Region-Warps – leer = alle disarmt; updateWarps
    // armiert jeden Warp, sobald man ihn verlassen und die Lauftaste losgelassen hat.
    this.warpArmed = new Set();

    // Performance-Budget (#82): Off-screen-Culling + Messung.
    // cullables = statische Deko (Blumen, Gras, Büsche, Steine, Bäume …), die
    // außerhalb des Sichtfelds ausgeblendet wird. Nur Optik – Kollision (solidGrid)
    // bleibt unberührt. Debug-Schalter über die URL:
    //   ?perf        → FPS/Sprite-HUD einblenden (Messbeleg vor/nach)
    //   ?stress=N    → Deko-Dichte ×N (künstlich „vergrößerte" Karte zum Messen)
    this.cullables = [];               // { obj, x, y }
    this.visibleCullables = 0;
    this.lastCullX = NaN; this.lastCullY = NaN;
    this.fpsSampler = new FrameSampler();
    const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    this.debugPerf = params.has("perf");
    this.stress = Math.max(1, Math.min(20, Math.floor(Number(params.get("stress")) || 1)));

    // Pixel-Textur für Partikel
    const g = this.make.graphics({}, false);
    g.fillStyle(0xffffff); g.fillRect(0, 0, 2, 2);
    g.generateTexture("px", 2, 2); g.destroy();
    this.makeFxTextures();   // weiche Schatten- & Glüh-Textur (#4)
    this.lampGlows = [];     // Laternen-Glühen, das nachts aufleuchtet (#4)

    // #425: gemeinsamer Terrain-Schritt datengetrieben aus getMapEntry(this.mapId)
    // (Boden/Kollision/Türen/NPC-Standplätze), dann die HAFEN-spezifische Szenerie.
    // Letztere wird mit #427 (RegionScene) selbst datengetrieben; bis dahin ist
    // „harbor" die einzige WorldScene-Karte.
    loadMapTerrain(this);
    placeHarborObjects(this);
    renderGround(this);
    renderStatics(this);
    spawnFlowers(this);
    spawnGrassDetail(this);   // #40: dichtes, variiertes Gras (Stardew-Look)
    this.spawnNpcs();
    this.spawnPlayer();
    scatter(this, "bush", 16, 0.5, [0, 1, 2], false, BUSH_HIT_R); // Büsche: runde Hitbox (#386) statt voller Kachel, nicht an Wegen
    scatter(this, "rock", 14, 0.45, [0, 1, 2, -3], false, ROCK_HIT_R); // Steine: runde Hitbox (#343), auch am Strand
    scatter(this, "lamppost", 4, 0.55, [0, 1, 2], false, 0, LAMP_HIT); // Hafenlaternen: schmales Pfosten-Rechteck (#386)
    scatter(this, "mushroom", 10, 0.28, [0, 1, 2]);       // Pilze: kleine Wald-/Wiesendeko, begehbar (#7)
    scatter(this, "seashell", 8, 0.22, [-3]);             // Muscheln: nur am Sandstrand (#7)
    scatter(this, "driftwood", 5, 0.3, [-3]);             // Treibholz: nur am Sandstrand (#7)

    this.splash = this.add.particles(0, 0, "px", {
      speed: { min: 25, max: 80 }, angle: { min: 200, max: 340 }, gravityY: 140,
      lifespan: 550, scale: { start: 1.6, end: 0.4 }, tint: FOAM, emitting: false,
    }).setDepth(9000);
    this.dust = this.add.particles(0, 0, "px", {
      speed: { min: 10, max: 40 }, angle: { min: 220, max: 320 }, gravityY: 60,
      lifespan: 450, scale: { start: 1.4, end: 0.3 }, tint: 0xd9b380, emitting: false,
    }).setDepth(9000);
    this.sparkle = this.add.particles(0, 0, "px", {
      speed: { min: 30, max: 90 }, gravityY: -20, lifespan: 700,
      scale: { start: 1.6, end: 0 }, tint: 0xffc857, emitting: false,
    }).setDepth(9000);

    // Sturm: Regen + dunkler Schleier (anfangs aus)
    this.rain = this.add.particles(0, 0, "px", {
      x: { min: 0, max: this.W * T }, y: -8,
      speedY: { min: 190, max: 250 }, speedX: { min: -35, max: -20 },
      scaleX: 0.5, scaleY: 2.4, alpha: 0.38, tint: 0xa8c8f0,
      lifespan: 3800, frequency: 7, quantity: 2,
    }).setDepth(10400);
    this.rain.stop();
    this.stormOverlay = this.add.rectangle(0, 0, this.W * T, this.H * T, 0x0e1830, 0.32).setOrigin(0).setDepth(10300).setVisible(false);

    // Tag-Nacht-Lichtschleier (sanft animiert) – über der Welt, aber unter Sturm/Regen (#4)
    this.dayNight = this.add.rectangle(0, 0, this.W * T, this.H * T, 0x0a1230, 0).setOrigin(0).setDepth(10200);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.W * T, this.H * T);
    cam.setZoom(3);
    cam.startFollow(this.playerSprite, true, 0.15, 0.15);

    this.scale.on("resize", () => cam.setZoom(window.innerWidth < 900 ? 2.4 : 3));

    // Performance-HUD (#82, nur mit ?perf in der URL): FPS + Sprite-Zahl als
    // Messbeleg, dass das Culling wirkt (sichtbar/gesamt fällt beim Scrollen).
    if (this.debugPerf) {
      this.perfHud = this.add.text(4, 4, "", {
        fontFamily: "Consolas, monospace", fontSize: "9px", color: "#9effa0",
        backgroundColor: "rgba(0,0,0,0.6)", padding: { left: 5, right: 5, top: 3, bottom: 3 }, resolution: 3,
      }).setScrollFactor(0).setDepth(30000);
    }

    scheduleEvents(this, 60); // erste Events frühestens nach 1 Minute

    // Möwen für die Hafen-Atmosphäre
    this.time.addEvent({ delay: 6500, loop: true, callback: () => { if (Math.random() < 0.65) spawnGull(this); } });
    spawnGull(this);
  }

  set(x: number, y: number, v: number) { this.ground[y * this.W + x] = v; }
  get(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return -2;
    return this.ground[y * this.W + x];
  }
  deco(x: number, y: number, sheet: string, idx: number, solid?: boolean) {
    this.decoList.push({ x, y, sheet, idx });
    if (solid) this.solidGrid[Math.round(y) * this.W + Math.round(x)] = 1;
  }
  tree(x: number, y: number) {
    const kind = ((x * 7 + y * 13) % 3 === 0) ? "pine" : "tree";   // gemischter Wald: meist Laubbaum, dazwischen Tanne
    this.decoList.push({ x, y, sheet: kind, obj: true, scale: kind === "pine" ? 0.95 : 1.1 }); // ~3 Kacheln (Mensch = 1)
    this.solidGrid[Math.round(y) * this.W + Math.round(x)] = 1;
  }
  objDeco(x: number, y: number, tex: string, scale: number, solid?: boolean) {
    // ein PixelLab-Objekt als Deko (unten verankert, Tiefe nach y), optional solide
    this.decoList.push({ x, y, sheet: tex, obj: true, scale });
    if (solid) this.solidGrid[Math.round(y) * this.W + Math.round(x)] = 1;
  }

  /** Statisches Render-Objekt fürs Off-screen-Culling registrieren (#82).
   *  (px,py) = Welt-Pixel-Anker (für die Sichtfeld-Prüfung). Gibt das Objekt
   *  durch, damit Aufrufer es weiter verketten können. */
  registerCullable<T extends Phaser.GameObjects.Components.Visible>(obj: T, px: number, py: number): T {
    this.cullables.push({ obj, x: px, y: py } as Cullable);
    return obj;
  }
  /** PixelLab-Gebäude: ein ganzes Haus als Bild über der w×3-Kachel-Grundfläche.
   *  Kollision = die Grundfläche solide (wie früher); das hohe Dach ragt sichtbar
   *  nach oben (begehbar dahinter, Tiefe nach Fußlinie → korrektes Vorne/Hinten). */
  building(x: number, y: number, w: number, tex: string, scale: number) {
    for (let i = 0; i < w; i++) for (let r = 0; r < 3; r++) this.solidGrid[(y + r) * this.W + (x + i)] = 1;
    const cx = (x + w / 2) * T, baseY = (y + 3) * T;
    this.add.image(cx, baseY, tex).setOrigin(0.5, 1).setScale(scale).setDepth(baseY);
  }

  /** Festes Orts-Schild: eingravierte Schrift auf einem PixelLab-Holzbrett,
   *  per 9-Slice auf jede Textlänge gedehnt (Rahmen bleibt fix, Mitte streckt).
   *  Am 16px-Maßstab orientiert (knappes Padding + leicht runterskaliert) und per
   *  y-Tiefe in die Welt einsortiert, damit es Fässer/Pod-Kisten/Tech-Tags nicht verdeckt. */
  makeSign(x: number, y: number, text: string, depth?: number) {
    const { cont, w, h } = buildSign(this, x, y, text, depth);
    // Schild-Rechteck als festes Hindernis fürs Tag-Entzerren merken (#207): Container
    // ist um SIGN_SCALE skaliert, das Brett sitzt oberhalb des Bezugspunkts (board.y=-h/2,
    // Höhe h) → Welt-Box [y-SIGN_SCALE·h, y]. Cluster-Tags weichen diesen Boxen aus.
    if (this.signBoxes) this.signBoxes.push({ x, y: y - SIGN_SCALE / 2 * h, w: SIGN_SCALE * w, h: SIGN_SCALE * h, movable: false });
    // Tiefe = Welt-y (wie Bäume/Fässer/Krabben): Objekte derselben/näheren Reihe liegen davor
    // statt darunter; Tech-Tags sind y-sortiert (#207) und überlagern die Figuren nicht mehr.
    return cont;
  }

  /** „Digitales" Cluster-Tag: Monospace + farbiger Status-Punkt (grün ok / rot kaputt
   *  / gelb Warnung). Startet unsichtbar – wird per Nähe-Aufdeckung eingeblendet.
   *  `compact` (#255): Schrift + Panel genau so groß wie die Orts-Schilder (#254) –
   *  dieselbe `SIGN_FONT`/`SIGN_SCALE`-Behandlung, damit die vielen Fass-Tags ruhiger
   *  und lesbarer sind statt die Szene zu überladen. */
  makeTechTag(x: number, y: number, text: string, statusColor: number, compact = false) {
    // Pixelschrift (#188) auf dunklem Panel + farbiger Status-Punkt. BitmapText kann
    // keinen Hintergrund/Padding wie add.text – darum eigenes Rechteck dahinter.
    const txt = pixelText(this, 0, 0, text, { color: "#e3edf8", origin: [0, 0.5], size: compact ? SIGN_FONT : undefined });
    const padL = 9, padR = 4, padY = 2;
    const w = txt.width + padL + padR, h = txt.height + padY * 2;
    const bg = this.add.rectangle(0, 0, w, h, 0x0a101c, 0.82).setOrigin(0.5);
    txt.setPosition(-w / 2 + padL, 0);
    const dot = this.add.circle(-w / 2 + 4.5, 0, 1.5, statusColor);
    // Tiefe setzt der Aufrufer (mkTag) y-sortiert am Bezugs-Objekt aus (#207),
    // damit davorstehende Figuren das Tag verdecken statt umgekehrt. compact:
    // ganzes Tag wie das Holz-Schild runterskalieren → gleiche Endgröße.
    const cont = this.add.container(x, y, [bg, txt, dot]).setAlpha(0);
    if (compact) cont.setScale(SIGN_SCALE);
    return cont;
  }

  /** Weicher Schatten unter einer Figur – radial ausgefranste Textur statt harter Ellipse (#4). */
  addShadow(x: number, y: number, w?: number) {
    const width = w || 10;
    return this.add.image(x, y, "shadowSoft").setDisplaySize(width * 1.5, width * 0.6).setAlpha(0.32).setDepth(1.6);
  }

  /** Einmalig erzeugte FX-Texturen: weicher Schatten (Ellipse mit Verlauf) und
   *  weiches Glühen (Kreis mit Verlauf, wird beim Einsatz eingefärbt). (#4) */
  makeFxTextures() {
    const steps = 10;
    // Schatten: konzentrische Ellipsen, außen fast transparent → innen dunkel
    const sw = 48, sh = 24, sg = this.make.graphics({}, false);
    for (let i = steps; i >= 1; i--) {
      const t = i / steps;
      sg.fillStyle(0x000000, 0.1);
      sg.fillEllipse(sw / 2, sh / 2, sw * t, sh * t);
    }
    sg.generateTexture("shadowSoft", sw, sh); sg.destroy();
    // Glühen: konzentrische weiße Kreise mit weichem Rand
    const gs = 40, gg = this.make.graphics({}, false);
    for (let i = steps; i >= 1; i--) {
      const t = i / steps;
      gg.fillStyle(0xffffff, 0.09);
      gg.fillCircle(gs / 2, gs / 2, (gs / 2) * t);
    }
    gg.generateTexture("glowSoft", gs, gs); gg.destroy();
  }

  spawnNpcs() {
    // Feste Standplätze aus this.npcSpawns (Code-Default oder – im Datenpfad –
    // aus dem Tiled-Objektlayer, #195); Kralle wird auf ihren Deck-Standplatz
    // (SHIP_KRALLE, #205) eingefügt und steht bewusst NICHT im Objektlayer.
    const defs = [...this.npcSpawns];
    defs.splice(6, 0, { id: "kralle", x: SHIP_KRALLE.x, y: SHIP_KRALLE.y });
    // #31/#343: NPCs sind solide – man läuft nicht durch sie hindurch –, aber als
    // RUNDE Hitbox (Kreis um den Standplatz) statt volles Kachel-Quadrat, sodass man
    // weich an ihnen vorbeigleitet. Reden (E) bleibt möglich (nearestNpc greift von
    // der Nachbarkachel). Die Kachel bleibt für die Deko-Platzierung belegt (softGrid).
    for (const idx of npcSolidIndices(defs, this.W, this.H)) this.softGrid[idx] = 1;
    this.softObstacles.push(...npcHitboxes(defs, NPC_HIT_R));
    this.npcs = defs.map(d => {
      const meta = KQContent.NPCS[d.id as keyof typeof KQContent.NPCS];
      this.addShadow(d.x * T + 8, d.y * T + 15);
      const baseY = meta.tex ? d.y * T + 15 : d.y * T + 8;   // tex-Figur an den Schatten (d.y*T+15) verankern, Füße = Schatten
      const spr = meta.tex
        ? this.add.image(d.x * T + 8, baseY, meta.tex).setOrigin(0.5, 0.81).setScale(0.6).setDepth(d.y * T + T)
        : this.add.image(d.x * T + 8, baseY, "dungeon", meta.sprite).setDepth(d.y * T + T);
      this.tweens.add({ targets: spr, y: baseY - 1, duration: 900 + Math.random() * 400, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      const marker = pixelText(this, d.x * T + 8, d.y * T - 6, "!", { color: "#ffc857", origin: [0.5, 1], depth: 10000, shadow: true });
      this.tweens.add({ targets: marker, y: d.y * T - 9, duration: 500, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      return { id: d.id, x: d.x, y: d.y, sprite: spr, marker };
    });
  }

  spawnPlayer() {
    const sp = Game.state.player;
    const spawn = getMapEntry(this.mapId).spawn;   // #193/#425: Default-Spawn aus dem Registry-Eintrag der geladenen Karte
    this.playerPos = {
      x: sp && sp.x ? sp.x : spawn.x * T,
      y: sp && sp.y ? sp.y : spawn.y * T,
      dir: 1, moving: false, face: "south",   // face: Blickrichtung für die 4-Richtungs-Sprites
    };
    this.playerShadow = this.addShadow(this.playerPos.x, this.playerPos.y + 6);
    this.playerSprite = this.add.image(this.playerPos.x, this.playerPos.y + 6, "char_player").setOrigin(0.5, 0.81).setScale(0.6).setDepth(this.playerPos.y + 8);
    this.petShadow = this.addShadow(0, 0, 7).setVisible(false);
    this.petSprite = this.add.image(0, 0, "dungeon", 124).setVisible(false).setDepth(1);
    this.petTrail = [];
    this.bobT = 0;
    this.stepAcc = 0;
  }
  get player() { return this.playerPos; }

  /** Spielfigur sofort an eine Weltposition setzen (Wiederspiel-Sandbox #332).
   *  Bewegung stoppen, damit sie nicht weiterrutscht; Sprite/Schatten/Kamera ziehen
   *  im nächsten update() automatisch nach (sie folgen playerPos). */
  teleport(x: number, y: number) {
    this.playerPos.x = x;
    this.playerPos.y = y;
    this.playerPos.moving = false;
  }

  /* ============ Kollision & Bewegung ============ */
  /** Kachel (x,y) belegt? – fürs Deko-Streuen (#3): eckige Solids (solidGrid:
   *  Wände/Wasser/Gebäude/Büsche) ODER runde Objekte (softGrid: Steine/NPCs, #343).
   *  Bewusst getrennt von der Kollision (isSolidAt), die runde Objekte als Hitbox
   *  prüft, nicht als volle Kachel. */
  occupied(x: number, y: number) {
    const i = y * this.W + x;
    return !!this.solidGrid[i] || !!this.softGrid[i];
  }

  isSolidAt(px: number, py: number) {
    const tx = Math.floor(px / T), ty = Math.floor(py / T);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
    const p = this.tfPlatform;
    if (tx >= p.x && tx < p.x + p.w && ty >= p.y && ty < p.y + p.h) {
      return !(Game.sim && Game.sim.tf.applied);
    }
    return !!this.solidGrid[ty * this.W + tx];
  }

  tryMove(dx: number, dy: number) {
    const pl = this.playerPos;
    // Kollision + Anti-Wedge liegen pur in world.ts (resolveMove) und sind dort
    // getestet; #36: steckt die Figur in einer soliden Kachel, kommt sie raus.
    const next = resolveMove((px, py) => this.isSolidAt(px, py), pl.x, pl.y, dx, dy, this.softObstacles);
    pl.x = next.x;
    pl.y = next.y;
  }

  nearestNpc() {
    const pl = this.playerPos;
    let best: SceneNpc | null = null, bestD = 1.7 * T;
    for (const n of this.npcs) {
      const d = Math.hypot(n.x * T + 8 - pl.x, n.y * T + 8 - pl.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /* ============ Effekte (von der UI aufrufbar) ============ */
  burstAt(x: number, y: number, kind: string) {
    const e = kind === "splash" ? this.splash : kind === "dust" ? this.dust : this.sparkle;
    e.explode(kind === "splash" ? 14 : 10, x, y);
  }
  burstAtPlayer(kind: string) { this.burstAt(this.playerPos.x, this.playerPos.y - 8, kind); }

  floatText(x: number, y: number, str: string, color?: string) {
    floatPixelText(this, x, y, str, color);
  }

  /** „+N 🪙"-Floater für eine fällige Hafen-Auszahlung (#501). Der szenen-neutrale Game.tick
   *  meldet die Auszahlung über den runtime-Sink (ui.ts), die den Floater an der aktiven
   *  WorldScene anfordert. Nur zeigen, wenn diese Szene tatsächlich läuft – bei offenem
   *  Innenraum schläft sie (scene.sleep), dann würde der Floater unsichtbar auflaufen; der
   *  HUD-Dublonenstand wird trotzdem aktualisiert (ui.ts). Hafen-Kachel als Anker. */
  payoutFloat(amount: number) {
    if (!this.scene.isActive()) return;
    this.floatText((11 + Math.random() * 8) * T, 25 * T, "+" + amount + " 🪙", "#ffd97a");
  }

  /* ============ Off-screen-Culling (#82) ============ */
  /** Off-screen-Culling der statischen Deko (#82). Gedrosselt: die (potentiell
   *  tausende) Sprites werden nur neu geprüft, wenn die Kamera nennenswert
   *  gescrollt ist – in ruhigen Frames kostet das Culling so gut wie nichts.
   *  Der großzügige Rand (MARGIN) verhindert Pop-in: hohe Objekte (Bäume) ragen
   *  weit über ihren Fuß-Anker, müssen also schon „aktiv" werden, bevor der
   *  Anker ins Bild scrollt. Reine Optik – das solidGrid bleibt unangetastet. */
  cullDecor(delta: number) {
    this.fpsSampler.push(delta);
    const cam = this.cameras.main, wv = cam.worldView;
    // worldView ist erst nach dem ersten Render gefüllt; vorher (Breite 0) warten.
    if (wv.width > 0 &&
        (isNaN(this.lastCullX) || Math.abs(cam.scrollX - this.lastCullX) > 8 || Math.abs(cam.scrollY - this.lastCullY) > 8)) {
      this.lastCullX = cam.scrollX; this.lastCullY = cam.scrollY;
      const MARGIN = 4 * T;
      const bounds = expandRect({ x: wv.x, y: wv.y, width: wv.width, height: wv.height }, MARGIN);
      this.visibleCullables = cull(this.cullables, bounds);
    }
    if (this.debugPerf) {
      const fps = this.fpsSampler.fps;
      // FPS zusätzlich als DOM-Attribut spiegeln, damit der headless-Smoke (#524) das
      // Frame-Budget ohne Test-Hintertür assertieren kann: window.kqGame ist im
      // Offline-Build gestrippt, das ?perf-gate-Attribut ist es nicht. Nur wenn der
      // Sampler schon Frames gesammelt hat (fps > 0), sonst bliebe die Zahl bei 0 hängen.
      if (typeof document !== "undefined" && fps > 0) document.body.dataset.kqFps = String(fps);
      if (this.perfHud) {
        const total = this.cullables.length, vis = this.visibleCullables;
        this.perfHud.setText(
          "FPS " + fps + "\n" +
          "Sprites sichtbar " + vis + "/" + total + "\n" +
          "gecullt " + (total - vis) + "  ·  stress ×" + this.stress + "\n" +
          "Cluster-Tags " + this.visibleTags + "/" + this.dynTags.length + " (Pool " + this.tagPool.length + ")",
        );
      }
    }
  }

  /* ============ Update-Schleife ============ */
  update(time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000);
    const pl = this.playerPos;
    const blocked = UI.blocking();

    let dx = 0, dy = 0;
    if (!blocked) {
      if (keys["w"] || keys["ArrowUp"]) dy -= 1;
      if (keys["s"] || keys["ArrowDown"]) dy += 1;
      if (keys["a"] || keys["ArrowLeft"]) dx -= 1;
      if (keys["d"] || keys["ArrowRight"]) dx += 1;
    }
    pl.moving = dx !== 0 || dy !== 0;
    if (pl.moving) {
      const len = Math.hypot(dx, dy);
      if (dx) pl.dir = Math.sign(dx);
      // Blickrichtung für die 4 PixelLab-Richtungen (horizontal hat Vorrang bei Diagonale)
      if (dx < 0) pl.face = "west";
      else if (dx > 0) pl.face = "east";
      else if (dy < 0) pl.face = "north";
      else if (dy > 0) pl.face = "south";
      this.tryMove(dx / len * 75 * dt, dy / len * 75 * dt);
      this.petTrail.push({ x: pl.x, y: pl.y });
      if (this.petTrail.length > 26) this.petTrail.shift();
      this.bobT += dt * 12;
      // Staubwölkchen beim Laufen
      this.stepAcc += dt;
      if (this.stepAcc > 0.3) { this.stepAcc = 0; this.dust.explode(2, pl.x, pl.y + 6); }
    }

    // #92/#111/#124: Warp-Gates scharf machen + Türen/Übergänge auslösen. Löst ein
    // Übergang aus, ist der Rest des Frames vorbei (Szene wechselt) → return.
    if (updateWarps(this, blocked)) return;

    const bob = pl.moving ? Math.abs(Math.sin(this.bobT)) * 1.6 : 0;
    // Echte 4-Richtungs-Sprites aus PixelLab (south = Basis-Textur char_player)
    const faceTex = pl.face === "south" ? "char_player" : "char_player_" + pl.face;
    this.playerSprite.setTexture(faceTex).setPosition(pl.x, pl.y + 6 - bob).setFlipX(false).setDepth(pl.y + 8);
    this.playerShadow.setPosition(pl.x, pl.y + 6);

    // Haustier
    const item = Game.state.activePet ? KQContent.SHOP.find(s => s.id === Game.state.activePet) : undefined;
    if (item) {
      const pos = this.petTrail[Math.max(0, this.petTrail.length - 16)] || pl;
      this.petSprite.setVisible(true).setTexture(item.tex!).setScale(0.4)
        .setPosition(pos.x, pos.y - 2 + Math.sin(time / 180) * 1.5)
        .setFlipX(pl.x < pos.x).setDepth(pos.y + 7);
      this.petShadow.setVisible(true).setPosition(pos.x, pos.y + 6);
    } else {
      this.petSprite.setVisible(false);
      this.petShadow.setVisible(false);
    }

    // Schiffsflagge einfärben
    const flagItem = KQContent.SHOP.find(f => f.id === Game.state.activeFlag);
    this.shipFlag.setTint(flagItem ? flagItem.color : 0x4dd0e1);

    // Quest-Marker
    for (const n of this.npcs) {
      let show = UI.questMarkerFor(n.id);
      if (n.id === "kralle" && Game.shouldReviewGate()) show = true;
      n.marker.setVisible(!blocked && show);
    }

    syncCluster(this);
    updateDynamicTags(this);
    // Persistente Spiel-Zeit (#413) um die reale Frame-Zeit vorrücken und den Tag-Nacht-
    // Schleier/die HUD-Uhr daraus speisen – NICHT mehr aus der flüchtigen Phaser-`time`,
    // die bei jedem Reload bei 0 begänne. So überlebt der Kalender den Reload (Auto-Save
    // persistiert gameDays). Die übrigen Frame-Animationen unten nutzen weiter Phaser-`time`.
    // #501: Spiel-Zeit-Achse UND Hafen-Wirtschaft tickt jetzt der szenen-neutrale Game.tick
    // (main.ts, Phaser-Pre-Step), damit beide auch in den Regionen laufen – hier nur noch die
    // bereits vorgerückte Achse in den Tag-Nacht-Schleier lesen. Eine fällige Auszahlung malt
    // payoutFloat() über den runtime-Sink (ui.ts).
    updateDayNight(this, Game.state.gameDays * DAY_CYCLE_MS);
    this.cullDecor(delta);

    // Schmetterlinge flattern über die Wiesen
    const t = time / 1000;
    for (const b of this.butterflies) {
      b.spr.setPosition(
        b.ax + Math.sin(t * b.sp + b.ph) * 22,
        b.ay + Math.sin(t * b.sp * 1.7 + b.ph) * 10 + Math.cos(t * 0.9 + b.ph) * 4
      ).setScale(1.3, 0.6 + Math.abs(Math.sin(t * 14 + b.ph)) * 0.7);
    }

    // Events: fällige Gefahren starten + laufende auf Erfolg/Deadline prüfen (#393: worldscene/events.ts)
    tickEvents(this, time);

    UI.updatePrompt();
  }
}
