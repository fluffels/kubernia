import Phaser from "phaser";
import { UI } from "../ui";
import { resolveMove, circleHitbox, rectHitbox, npcHitboxes, type Hitbox } from "../world";
import { npcSpawnsForMap, objectsForMap } from "../content/entities";
import { WATER as A_WATER } from "../archipel";
import { DOCK as WH_DOCK, buildWarehouse, WAREHOUSE_TO_WORLD, WAREHOUSE_ARRIVAL, WAREHOUSE_QUEST_TRIGGER } from "../warehouse";
import { keys, setWorldScene, setInteriorOpen } from "../runtime";
import { T, FOAM, WANG, pixelText, spawnIslandNpc, spawnIslandObject, buildSign, floatPixelText, IslandScene, type SceneNpc } from "./shared";

/* ===== WarehouseScene (#124) – Lagerhallen-Viertel (Hafenkai) =====
 * Eigener begehbarer Hafenkai, den man von Port Kubernia über den Holz-Anleger am
 * Westende des Kais betritt (analog ArchipelScene/LighthouseScene, Phase 7 #24). Eine
 * gepflasterte Quay-Fläche, von einer begehbaren Stein-Kai-Wand zum Meer gesäumt; oben
 * am Wasser die Verladekräne, auf der Fläche stapeln sich Frachtcontainer (Daten-/Volume-
 * Metapher der Phase) und Kisten/Fässer, dazu ein reservierter NPC-Standplatz (Sprite +
 * Quests folgen in #125/#127/#129). Boden über dieselben Wang-Tiles wie die Hauptkarte
 * (Stein-Kai + Holz-Steg); Geometrie/Kollision kommen pur aus warehouse.ts, Bewegung
 * teilt sich resolveMove. */
/** #343/#386: Radius/Maße der Sub-Tile-Hitboxen. Fässer (rund) als Kreis, Kisten (eckig)
 *  als leicht eingerücktes Rechteck, NPCs rund – wie in WorldScene. */
const HIT_R = 6;
const CRATE_HIT = 12;   // Kantenlänge der (mittig eingerückten) Kisten-Rechteck-Hitbox

export class WarehouseScene extends IslandScene {
  constructor() { super("Warehouse"); }

  create() {
    const m = buildWarehouse();
    this.W = m.W; this.H = m.H; this.ground = m.ground; this.solid = m.solid;
    // #343/#386: runde/kleinere Sub-Tile-Hitboxen für die Lager-Güter + NPCs statt voller
    // Kachel – man gleitet weich vorbei. `solid` bleibt für eckige Strukturen (Meer/Kai-
    // Wand/Kräne/Container); `softGrid` hält nur die Kachel-Belegung der Sub-Tile-Objekte.
    this.softGrid = new Uint8Array(this.W * this.H);
    this.softObstacles = [] as Hitbox[];

    this.renderGround();

    // Verladekräne + Frachtcontainer-Stapel (PixelLab, #124) – seit #357 datengesteuert:
    // eine Schleife über die prop-Objekte der Registry rendert beide (und jedes künftige
    // Kai-Objekt). Große, eckige Strukturen → volles Kachel-Solid kommt aus der puren
    // Geometrie (buildWarehouse), Sprite/Schatten aus PROP_RENDER. Neues Objekt = JSON-Eintrag.
    for (const o of objectsForMap("warehouse")) if (o.type === "prop") spawnIslandObject(this, o);
    // Lager-Güter (Kisten/Fässer) aus der puren Geometrie. Die pure Kachel-Solidität
    // (buildWarehouse) wird hier durch eine Sub-Tile-Hitbox ersetzt (#386): Fässer rund,
    // Kisten als leicht eingerücktes Rechteck – so gleitet man weich an ihnen vorbei.
    for (const g of m.goods) {
      this.add.image(g.x * T + 8, (g.y + 1) * T, g.kind).setOrigin(0.5, 1).setScale(0.5).setDepth((g.y + 1) * T);
      this.solid[g.y * this.W + g.x] = 0;
      this.softGrid[g.y * this.W + g.x] = 1;
      if (g.kind === "barrel") {
        this.softObstacles.push(circleHitbox(g.x * T + 8, g.y * T + 8, HIT_R));
      } else {
        const off = (T - CRATE_HIT) / 2;   // mittig in der Kachel
        this.softObstacles.push(rectHitbox(g.x * T + off, g.y * T + off, CRATE_HIT, CRATE_HIT));
      }
    }

    // Quest-Trigger = das Lager-Kontor (Schild; die Phase-7-Quests #127/#129 docken hier an).
    // Position + Schild-Label kommen aus der Registry (#357).
    this.makeSign(WAREHOUSE_QUEST_TRIGGER.x * T + 8, (WAREHOUSE_QUEST_TRIGGER.y + 1) * T, WAREHOUSE_QUEST_TRIGGER.label!);

    // Speicher-Verwalter „Knut" (#125) & künftige Quay-NPCs datengesteuert aus der
    // Entity-Registry (#349): eine Schleife über npcSpawnsForMap("warehouse") statt den
    // NPC hier hart zu setzen – neuer NPC = nur JSON-Eintrag. Reden läuft über
    // E → UI.interact() → nearestNpc(); bis die Quests andocken, zeigt er Smalltalk.
    const warehouseNpcs = npcSpawnsForMap("warehouse");
    // #31/#343/#386: NPCs solide als RUNDE Hitbox (Kreis um den Standplatz) statt voller
    // Kachel – man gleitet weich an ihnen vorbei; Reden (E) greift weiter von der Nachbarkachel.
    this.softObstacles.push(...npcHitboxes(warehouseNpcs, HIT_R));
    for (const s of warehouseNpcs) this.softGrid[s.y * this.W + s.x] = 1;
    this.npcs = warehouseNpcs.map(s => spawnIslandNpc(this, s));

    // Rück-Anleger im Süden sichtbar markieren (Abstiegs-Pfeil + Schild).
    const rx = WAREHOUSE_TO_WORLD.tx * T + 8, ry = WAREHOUSE_TO_WORLD.ty * T + 8;
    const down = this.add.text(rx, ry - 4, "⬇", { fontSize: "11px", resolution: 6 }).setOrigin(0.5).setDepth(ry + 20);
    this.tweens.add({ targets: down, y: ry - 8, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    this.makeSign(rx, (WAREHOUSE_TO_WORLD.ty - 1) * T, "Port Kubernia");

    // Spieler am Ankunftspunkt (eine Kachel landwärts vom Anleger).
    this.pl = { x: WAREHOUSE_ARRIVAL.tx * T + 8, y: WAREHOUSE_ARRIVAL.ty * T + 8, face: "north", moving: false };
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
    pixelText(this, cw / 2, 12, "📦 Lagerhallen-Viertel", { color: "#ffe9b0", size: 16, origin: [0.5, 0], depth: 20000, shadow: true }).setScrollFactor(0);
    pixelText(this, cw / 2, ch - 22, "Steg hinab ⬇ – zurück nach Port Kubernia", { color: "#ffd97a", size: 12, origin: [0.5, 1], depth: 20000, shadow: true }).setScrollFactor(0);

    // Möwen für die Hafen-Atmosphäre (wie auf Insel/Klippe).
    this.time.addEvent({ delay: 6500, loop: true, callback: () => { if (Math.random() < 0.6) this.spawnGull(); } });
    this.spawnGull();

    setWorldScene(this);
    setInteriorOpen(false);

    this.ePrev = true;
    this.returnArmed = false;
  }

  /** Wang-Boden wie WorldScene.renderGround, MIT Stein-Kai (Quay-Wand) UND Holz-Steg:
   *  Meer → (dock/kai/coast) → Stein/Gras → Pfad. */
  renderGround() {
    const rt = this.add.renderTexture(0, 0, this.W * T, this.H * T).setOrigin(0).setDepth(0);
    const lv = (cx: number, cy: number) => {
      const ix = cx < 0 ? 0 : cx >= this.W ? this.W - 1 : cx;
      const iy = cy < 0 ? 0 : cy >= this.H ? this.H - 1 : cy;
      const c = this.ground[iy * this.W + ix];
      return c === A_WATER ? 0 : c === 25 ? 3 : 2;   // Wasser < Stein/Gras/Steg < Pfad
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
      if (cs.some((c) => c === WH_DOCK)) return "dock";   // Holz-Steg trifft Meer
      if (cs.some(isStone)) return "kai";                 // Stein-Kai-Wand trifft Meer
      return "coast";
    };
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const v = this.ground[y * this.W + x];
        if (has(x, y, 0)) rt.drawFrame(edgeSet(x, y), WANG[corners(x, y, 1)], x * T, y * T);
        else if (v === WH_DOCK) rt.drawFrame("dock", WANG[15], x * T, y * T);
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

  isSolidAt(px: number, py: number) {
    const tx = Math.floor(px / T), ty = Math.floor(py / T);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
    return !!this.solid[ty * this.W + tx];
  }

  nearestNpc() {
    const pl = this.pl;
    let best: SceneNpc | null = null, bestD = 1.7 * T;
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

    for (const n of this.npcs) n.marker.setVisible(!blocked && UI.questMarkerFor(n.id));

    UI.updatePrompt();

    // Rück-Anleger betreten? -> zurück nach Port Kubernia (gemeinsames Anti-Pingpong-Gate
    // mit Notausgang per E/Enter, #426).
    if (this.updateReturn(WAREHOUSE_TO_WORLD, blocked)) return;
  }
}
