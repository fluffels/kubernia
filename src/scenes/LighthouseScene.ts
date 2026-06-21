import Phaser from "phaser";
import { UI } from "../ui";
import { SFX } from "../sfx";
import { resolveMove, circleHitbox, npcHitboxes, type Hitbox } from "../world";
import { npcSpawnsForMap, objectsForMap } from "../content/entities";
import { WATER as A_WATER, warpAt } from "../archipel";
import { PATH as L_PATH, buildLighthouse, LIGHTHOUSE_TO_WORLD, LIGHTHOUSE_ARRIVAL, LIGHTHOUSE_QUEST_TRIGGER, LIGHTHOUSE_TOWER, LIGHTHOUSE_NPC } from "../lighthouse";
import { keys, setWorldScene, setInteriorOpen, type WorldSceneRef } from "../runtime";
import { T, FOAM, WANG, pixelText, spawnIslandNpc, spawnIslandObject, buildSign, floatPixelText } from "./shared";

/* ===== LighthouseScene (#111) – Monitoring-Leuchtturm-Klippe =====
 * Eigener begehbarer Höhen-Bereich, den man von Port Kubernia über den Aufgang am
 * Turmfuß betritt (analog ArchipelScene). Eine Gras-Hochebene, von einem begehbaren
 * Stein-Klippenrand gesäumt; oben der große Leuchtturm, die Monitoring-Station
 * (Grafana-Tafel + Alarm-Glocke = Quest-Trigger, Phase 5 #22) und ein reservierter
 * NPC-Standplatz (Sprite + Quests folgen in einem Kinderticket, analog #93). Boden
 * über dieselben Wang-Tiles wie die Hauptkarte (inkl. Stein-Kai für die Klippe);
 * Geometrie/Kollision kommen pur aus lighthouse.ts, Bewegung teilt sich resolveMove. */
/** #343/#386: Radius der runden Sub-Tile-Hitboxen (Felsbrocken/Büsche/NPCs), wie in WorldScene. */
const HIT_R = 6;

export class LighthouseScene extends Phaser.Scene {
  [key: string]: any;
  constructor() { super("Lighthouse"); }

  create() {
    const m = buildLighthouse();
    this.W = m.W; this.H = m.H; this.ground = m.ground; this.solid = m.solid;
    // #343/#386: runde Sub-Tile-Hitboxen für Felsbrocken/Büsche/NPCs statt voller Kachel –
    // man gleitet weich vorbei. `solid` bleibt für eckige Strukturen (Meer/Turm/Station);
    // `softGrid` hält nur die Kachel-Belegung der runden Objekte fürs Deko-Streuen.
    this.softGrid = new Uint8Array(this.W * this.H);
    this.softObstacles = [] as Hitbox[];

    this.renderGround();

    // Felsbrocken am Klippenrand – deterministisch aus der puren Geometrie. Die pure
    // Kachel-Solidität (buildLighthouse) wird hier durch eine runde Hitbox ersetzt (#386),
    // sodass man weich an den Brocken vorbeigleitet statt eckig abzuprallen.
    for (const r of m.rocks) {
      this.add.image(r.x * T + 8, (r.y + 1) * T, "rock").setOrigin(0.5, 1).setScale(0.5).setDepth((r.y + 1) * T);
      this.solid[r.y * this.W + r.x] = 0;
      this.addSoftCircle(r.x, r.y);
    }
    // Etwas Gras-Deko auf der Hochebene (begehbar) – deterministisch gestreut.
    this.scatterDecor();

    // === Großer Leuchtturm oben auf der Klippe (PixelLab-Turm + rotierender Lichtkegel) ===
    const lx = LIGHTHOUSE_TOWER.x * T + 8, lyB = (LIGHTHOUSE_TOWER.y + 1) * T;
    const lhSc = 0.6;
    this.add.ellipse(lx, lyB - 1, 32, 10, 0x5a6470).setDepth(lyB - 2);   // Felsen-Sockel
    this.add.image(lx, lyB, "lighthouse").setOrigin(0.5, 1).setScale(lhSc).setDepth(lyB + 4);
    const lampY = lyB - Math.round(100 * lhSc) + 9;
    if (!this.textures.exists("lhbeam")) {
      const bw = 84, bh = 34, bg = this.make.graphics({ add: false } as any);
      bg.fillStyle(0xffe9a0, 1); bg.fillTriangle(0, bh / 2, bw, 0, bw, bh);
      bg.generateTexture("lhbeam", bw, bh); bg.destroy();
    }
    const beam = this.add.image(lx, lampY, "lhbeam").setOrigin(0, 0.5)
      .setAlpha(0.13).setBlendMode(Phaser.BlendModes.ADD).setDepth(lyB + 3);
    this.tweens.add({ targets: beam, angle: 360, duration: 4600, repeat: -1, ease: "Linear" });
    const lamp = this.add.image(lx, lampY, "px").setScale(4.5, 2.5).setTint(0xffe28a).setDepth(lyB + 5);
    this.tweens.add({ targets: lamp, alpha: { from: 0.5, to: 1 }, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.inOut" });

    // === Monitoring-Station: Grafana-Dashboard-Tafel + Alarm-Glocke (#111) ===
    // Seit #357 datengesteuert: eine Schleife über die prop-Objekte der Registry rendert
    // Tafel + Glocke (und jedes künftige Deko-Objekt) – Standplatz/Sprite kommen aus
    // entities.json, das Render-Tuning aus PROP_RENDER. Schild-Label ebenfalls aus den Daten.
    for (const o of objectsForMap("lighthouse")) if (o.type === "prop") spawnIslandObject(this, o);
    this.makeSign(LIGHTHOUSE_QUEST_TRIGGER.x * T + 8, (LIGHTHOUSE_QUEST_TRIGGER.y + 1) * T, LIGHTHOUSE_QUEST_TRIGGER.label!);

    // Observability-Wärterin „Lumi" (#112) & künftige Klippen-NPCs datengesteuert aus
    // der Entity-Registry (#349): eine Schleife über npcSpawnsForMap("lighthouse") statt
    // den NPC hier hart zu setzen – neuer NPC = nur JSON-Eintrag. Reden läuft über
    // E → UI.interact() → nearestNpc(); bis die Quests andocken, zeigt sie Smalltalk.
    const lighthouseNpcs = npcSpawnsForMap("lighthouse");
    // #31/#343/#386: NPCs solide als RUNDE Hitbox (Kreis um den Standplatz) statt voller
    // Kachel – man gleitet weich an ihnen vorbei; Reden (E) greift weiter von der Nachbarkachel.
    this.softObstacles.push(...npcHitboxes(lighthouseNpcs, HIT_R));
    for (const s of lighthouseNpcs) this.softGrid[s.y * this.W + s.x] = 1;
    this.npcs = lighthouseNpcs.map(s => spawnIslandNpc(this, s));

    // Rück-Warp am südlichen Klippenrand sichtbar markieren (Abstiegs-Pfeil + Schild).
    const rx = LIGHTHOUSE_TO_WORLD.tx * T + 8, ry = LIGHTHOUSE_TO_WORLD.ty * T + 8;
    const down = this.add.text(rx, ry - 4, "⬇", { fontSize: "11px", resolution: 6 }).setOrigin(0.5).setDepth(ry + 20);
    this.tweens.add({ targets: down, y: ry - 8, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    this.makeSign(rx, (LIGHTHOUSE_TO_WORLD.ty - 1) * T, "Port Kubernia");

    // Spieler am Ankunftspunkt (eine Kachel landwärts vom Abstieg).
    this.pl = { x: LIGHTHOUSE_ARRIVAL.tx * T + 8, y: LIGHTHOUSE_ARRIVAL.ty * T + 8, face: "north", moving: false };
    this.bobT = 0;
    this.pShadow = this.add.ellipse(this.pl.x, this.pl.y + 6, 10, 4, 0x000000, 0.26).setDepth(1.6);
    this.pSprite = this.add.image(this.pl.x, this.pl.y + 6, "char_player").setOrigin(0.5, 0.81).setScale(0.6).setDepth(this.pl.y + 8);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.W * T, this.H * T);
    cam.setBackgroundColor(0x356dab);   // offenes Meer als Rand
    cam.setZoom(window.innerWidth < 900 ? 2.4 : 3);
    cam.startFollow(this.pSprite, true, 0.15, 0.15);
    this.scale.on("resize", () => cam.setZoom(window.innerWidth < 900 ? 2.4 : 3));

    const cw = cam.width, ch = cam.height;
    pixelText(this, cw / 2, 12, "🔭 Monitoring-Leuchtturm", { color: "#ffe9b0", size: 16, origin: [0.5, 0], depth: 20000, shadow: true }).setScrollFactor(0);
    pixelText(this, cw / 2, ch - 22, "Pfad hinab ⬇ – zurück nach Port Kubernia", { color: "#ffd97a", size: 12, origin: [0.5, 1], depth: 20000, shadow: true }).setScrollFactor(0);

    // Möwen für die Hafen-Atmosphäre (wie auf der Insel).
    this.time.addEvent({ delay: 6500, loop: true, callback: () => { if (Math.random() < 0.6) this.spawnGull(); } });
    this.spawnGull();

    // Ab jetzt ist die Klippe die aktive „WorldScene": exitToWorld() stellt das zurück.
    setWorldScene(this);
    setInteriorOpen(false);

    this.ePrev = true;
    this.returnArmed = false;
  }

  /** Wang-Boden wie WorldScene.renderGround, hier ohne Holz-Steg, aber MIT Stein-Kai
   *  für den felsigen Klippenrand: Meer → (kai/coast) → Stein/Gras → Pfad. */
  renderGround() {
    const rt = this.add.renderTexture(0, 0, this.W * T, this.H * T).setOrigin(0).setDepth(0);
    const lv = (cx: number, cy: number) => {
      const ix = cx < 0 ? 0 : cx >= this.W ? this.W - 1 : cx;
      const iy = cy < 0 ? 0 : cy >= this.H ? this.H - 1 : cy;
      const c = this.ground[iy * this.W + ix];
      return c === A_WATER ? 0 : c === L_PATH ? 3 : 2;   // Wasser < Stein/Gras < Pfad
    };
    const rawAt = (cx: number, cy: number) => {
      const ix = cx < 0 ? 0 : cx >= this.W ? this.W - 1 : cx;
      const iy = cy < 0 ? 0 : cy >= this.H ? this.H - 1 : cy;
      return this.ground[iy * this.W + ix];
    };
    const corners = (x: number, y: number, hi: number) =>
      (((lv(x - 1, y - 1) >= hi ? 1 : 0) << 3) | ((lv(x, y - 1) >= hi ? 1 : 0) << 2) |
       ((lv(x - 1, y) >= hi ? 1 : 0) << 1) | (lv(x, y) >= hi ? 1 : 0));
    const has = (x: number, y: number, t: number) =>
      lv(x - 1, y - 1) === t || lv(x, y - 1) === t || lv(x - 1, y) === t || lv(x, y) === t;
    const isStone = (c: number) => c === 96 || c === 97 || c === 98;
    const edgeSet = (x: number, y: number) => {
      const cs = [rawAt(x - 1, y - 1), rawAt(x, y - 1), rawAt(x - 1, y), rawAt(x, y)];
      return cs.some(isStone) ? "kai" : "coast";   // Stein-Klippe trifft Meer als Kai-Kante
    };
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const v = this.ground[y * this.W + x];
        if (has(x, y, 0)) rt.drawFrame(edgeSet(x, y), WANG[corners(x, y, 1)], x * T, y * T);
        else if (isStone(v)) rt.drawFrame("kai", WANG[15], x * T, y * T);
        else if (has(x, y, 3)) rt.drawFrame("path", WANG[corners(x, y, 3)], x * T, y * T);
        else rt.drawFrame("meadow", WANG[corners(x, y, 2)], x * T, y * T);
      }
    }
    // Wellen-Glitzer auf dem Wasser
    for (let i = 0; i < 40; i++) {
      const x = Phaser.Math.Between(0, this.W - 1), y = Phaser.Math.Between(0, this.H - 1);
      if (this.ground[y * this.W + x] !== A_WATER) continue;
      const s = this.add.image(x * T + Phaser.Math.Between(2, 12), y * T + Phaser.Math.Between(3, 12), "px")
        .setScale(2.5, 0.8).setTint(FOAM).setAlpha(0).setDepth(1);
      this.tweens.add({ targets: s, alpha: { from: 0, to: 0.55 }, duration: Phaser.Math.Between(900, 1800), yoyo: true, repeat: -1, delay: Phaser.Math.Between(0, 2000) });
    }
  }

  /** Deterministische Bodendeko (Blumen/Büsche) auf dem Gras der Hochebene – nie auf
   *  Pfad/Stein/Reserviert (Turm, Station, NPC-Standplatz, Deko, Ankunft, Warp). */
  scatterDecor() {
    const reserved = new Set([
      LIGHTHOUSE_QUEST_TRIGGER.y * this.W + LIGHTHOUSE_QUEST_TRIGGER.x,
      LIGHTHOUSE_NPC.y * this.W + LIGHTHOUSE_NPC.x,
      LIGHTHOUSE_ARRIVAL.ty * this.W + LIGHTHOUSE_ARRIVAL.tx,
    ]);
    for (let y = 1; y < this.H - 1; y++) {
      for (let x = 1; x < this.W - 1; x++) {
        const i = y * this.W + x;
        const v = this.ground[i];
        if (v !== 0 && v !== 1 && v !== 2) continue;   // nur Gras
        if (this.occupied(x, y)) continue;             // kein Solid/rundes Objekt drunter
        if (reserved.has(i)) continue;
        const h = (((x * 374761393) ^ (y * 668265263)) >>> 0) % 100;
        if (h < 5) {                                   // Busch: runde Hitbox (#386) statt voller Kachel
          this.add.image(x * T + 8, (y + 1) * T, "bush").setOrigin(0.5, 1).setScale(0.5).setDepth((y + 1) * T);
          this.addSoftCircle(x, y);
        } else if (h < 14) {                           // Blume (begehbar)
          this.add.image(x * T + 8, y * T + 10, "flowers").setScale(0.5).setDepth(y * T + 6);
        }
      }
    }
  }

  /** Holz-Schild (9-Slice) wie auf der Hauptkarte – gemeinsamer Aufbau (#254). */
  makeSign(x: number, y: number, text: string, depth?: number) {
    buildSign(this, x, y, text, depth);
  }

  spawnGull() {
    const y = Phaser.Math.Between(1, this.H - 4) * T;
    const fromLeft = Math.random() < 0.5;
    const gull = this.add.image(fromLeft ? -20 : this.W * T + 20, y, "seagull")
      .setDepth(11000).setScale(0.35).setFlipX(!fromLeft);
    this.tweens.add({ targets: gull, x: fromLeft ? this.W * T + 30 : -30, duration: Phaser.Math.Between(9000, 15000), onComplete: () => gull.destroy() });
  }

  /** Kachel belegt? – fürs Deko-Streuen: eckiges Solid (Meer/Turm/Station) ODER rundes
   *  Sub-Tile-Objekt (Felsbrocken/Busch/NPC, #386). Bewusst getrennt von isSolidAt, das
   *  runde Objekte als Hitbox prüft (resolveMove), nicht als volle Kachel. */
  occupied(x: number, y: number) {
    const i = y * this.W + x;
    return !!this.solid[i] || !!this.softGrid[i];
  }

  /** Rundes Sub-Tile-Hindernis (#343/#386): Kreis um den Kachel-Mittelpunkt + Belegung. */
  addSoftCircle(tx: number, ty: number, r = HIT_R) {
    this.softObstacles.push(circleHitbox(tx * T + 8, ty * T + 8, r));
    this.softGrid[ty * this.W + tx] = 1;
  }

  isSolidAt(px: number, py: number) {
    const tx = Math.floor(px / T), ty = Math.floor(py / T);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
    return !!this.solid[ty * this.W + tx];
  }

  /** Nächster ansprechbarer NPC (E-Reichweite), gleiche Logik wie WorldScene –
   *  ui.ts ruft das über worldScene() auf, um Reden/Quests anzubieten. */
  nearestNpc() {
    const pl = this.pl;
    let best = null, bestD = 1.7 * T;
    for (const n of this.npcs) {
      const d = Math.hypot(n.x * T + 8 - pl.x, n.y * T + 8 - pl.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  burstAtPlayer(_kind: string) {
    this.floatText(this.pl.x, this.pl.y - 8, "✨", "#ffe9b0");
  }

  floatText(x: number, y: number, str: string, color?: string) {
    floatPixelText(this, x, y, str, color);
  }

  exitToWorld() {
    SFX.door();
    setWorldScene(this.scene.get("World") as unknown as WorldSceneRef);
    setInteriorOpen(false);
    this.scene.wake("World");
    this.scene.stop();
  }

  update(_time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000);
    const pl = this.pl;
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
      if (dx < 0) pl.face = "west";
      else if (dx > 0) pl.face = "east";
      else if (dy < 0) pl.face = "north";
      else if (dy > 0) pl.face = "south";
      const next = resolveMove((px, py) => this.isSolidAt(px, py), pl.x, pl.y, dx / len * 75 * dt, dy / len * 75 * dt, this.softObstacles);
      pl.x = next.x; pl.y = next.y;
      this.bobT += dt * 12;
    }
    const bob = pl.moving ? Math.abs(Math.sin(this.bobT)) * 1.6 : 0;
    const faceTex = pl.face === "south" ? "char_player" : "char_player_" + pl.face;
    this.pSprite.setTexture(faceTex).setPosition(pl.x, pl.y + 6 - bob).setDepth(pl.y + 8);
    this.pShadow.setPosition(pl.x, pl.y + 6);

    // Quest-Marker über Lumi (zeigt „!", sobald die Phase-5-Quests einen
    // Dialogschritt für sie anstehen lassen).
    for (const n of this.npcs) n.marker.setVisible(!blocked && UI.questMarkerFor(n.id));

    UI.updatePrompt();

    // Abstieg betreten? -> zurück nach Port Kubernia (gleiches Anti-Pingpong-Gate
    // wie auf der Insel: erst scharf nach Loslassen + nicht schon auf der Kachel).
    const onRet = warpAt(pl.x, pl.y, LIGHTHOUSE_TO_WORLD);
    const moveKeyDown = !!(keys["w"] || keys["s"] || keys["a"] || keys["d"] ||
      keys["ArrowUp"] || keys["ArrowDown"] || keys["ArrowLeft"] || keys["ArrowRight"]);
    if (!moveKeyDown && !onRet) this.returnArmed = true;
    if (!blocked && this.returnArmed && onRet) { this.exitToWorld(); return; }
    // Notausgang per E/Enter, falls man am Klippenrand feststeht.
    const e = !blocked && (!!keys["e"] || !!keys["Enter"]);
    if (e && !this.ePrev && onRet) { this.exitToWorld(); return; }
    this.ePrev = e;
  }
}
