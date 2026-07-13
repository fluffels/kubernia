import Phaser from "phaser";
import { UI } from "../ui";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { TALK_RANGE, interiorEAction, interiorEFlank, UNDERDECK_DOOR, type Door } from "../world/world";
import { keys, setInteriorOpen } from "../runtime";
import { sanitize } from "../hud/pixelfont";
import { T, pixelText, renderPlayer, stepSimplePlayer, type ScenePlayer } from "./shared";

/* ===== InteriorScene (#6) – betretbarer Hausinnenraum =====
 * Wird von WorldScene.enterInterior() als eigene Szene gestartet, während die
 * WorldScene schläft (eingefroren + ausgeblendet). Ein kleiner gekachelter
 * Raum aus vorhandenen Tiles, themengerechte Möbel, die NPC-Figur des Hauses
 * und eine Tür-Schwelle unten zum Hinausgehen (E oder runterlaufen).
 * Schiff-Deck (#758): statt eines kleinen Kajüten-Raums öffnet das „ship"-Thema
 * jetzt ein begehbares, bootsförmig zugeschnittenes Deck (15×11).
 * Unterdeck (#759): „ship_underdeck" startet einen zweiten Innenraum (Laderaum)
 * mit returnDoor=SHIP_DOOR – Verlassen führt zurück aufs Deck statt zur Weltkarte. */
type NpcMeta = (typeof KQContent.NPCS)[keyof typeof KQContent.NPCS];

const INTERIORS: Record<string, { tex: string; tx: number; ty: number }[]> = {
  office: [{ tex: "interior_table", tx: 3, ty: 2 }, { tex: "interior_console", tx: 7, ty: 2 }, { tex: "interior_book", tx: 8, ty: 2 }, { tex: "crate", tx: 2, ty: 5 }, { tex: "barrel", tx: 8, ty: 5 }],
  forge:  [{ tex: "interior_anvil", tx: 3, ty: 2 }, { tex: "interior_table", tx: 7, ty: 2 }, { tex: "interior_console", tx: 8, ty: 2 }, { tex: "barrel", tx: 2, ty: 5 }, { tex: "crate", tx: 8, ty: 5 }],
  chart:  [{ tex: "interior_table", tx: 3, ty: 2 }, { tex: "interior_book", tx: 7, ty: 2 }, { tex: "interior_book", tx: 8, ty: 2 }, { tex: "crate", tx: 2, ty: 5 }, { tex: "barrel", tx: 8, ty: 5 }],
  ship_underdeck: [{ tex: "barrel", tx: 2, ty: 2 }, { tex: "crate", tx: 8, ty: 2 }, { tex: "barrel", tx: 2, ty: 5 }, { tex: "crate", tx: 8, ty: 5 }],
};

// Deck-Silhouette (bootsförmig): pro Zeile der offene Tile-Bereich [x0..x1].
// RW = 15, Zeilen 0–9 sind geöffnet (variabel breit), Zeile 10 = Gangway-Ausgang.
const DECK_SHAPE: ReadonlyArray<{ x0: number; x1: number }> = [
  { x0: 6, x1: 8 },   // 0 – Bug (3 breit)
  { x0: 4, x1: 10 },  // 1
  { x0: 2, x1: 12 },  // 2
  { x0: 1, x1: 13 },  // 3
  { x0: 0, x1: 14 },  // 4 – breiteste Stelle
  { x0: 0, x1: 14 },  // 5
  { x0: 0, x1: 14 },  // 6
  { x0: 1, x1: 13 },  // 7
  { x0: 2, x1: 12 },  // 8 – Heck (Unterdeck-Luke liegt hier)
  { x0: 4, x1: 10 },  // 9
];

// Unterdeck-Luke auf dem Deck (#759): interaktiv (Betreten führt ins Unterdeck).
const DECK_HATCH_TX = 7;
const DECK_HATCH_TY = 8;

export class InteriorScene extends Phaser.Scene {
  door!: Door;
  RW!: number;
  RH!: number;
  solid!: Uint8Array;
  exitTx!: number;
  exitTy!: number;
  npcId: string | undefined;
  npcX!: number;
  npcY!: number;
  pl!: ScenePlayer;
  bobT!: number;
  pShadow!: Phaser.GameObjects.Ellipse;
  pSprite!: Phaser.GameObjects.Image;
  isShip!: boolean;
  hintExit!: string;
  hintTalk!: string;
  hint!: Phaser.GameObjects.BitmapText;
  ePrev!: boolean;
  constructor() { super("Interior"); }

  create(data: { door: Door }) {
    const door = data.door;
    this.door = door;
    const isShip = door.theme === "ship";
    const isUnderdeck = door.theme === "ship_underdeck";
    this.isShip = isShip;

    if (isShip) {
      this.RW = 15; this.RH = 11;
      this.exitTx = 7;   // Gangway-Mitte
      this.exitTy = 10;  // Gangway-Reihe (zurück ans Land)
    } else {
      this.RW = 11; this.RH = 8;
      this.exitTx = 5;
      this.exitTy = this.RH - 1;
    }
    this.solid = new Uint8Array(this.RW * this.RH);

    this.renderRoom(isShip, isUnderdeck);
    if (!isShip && !isUnderdeck) this.renderPortholes();
    this.renderThreshold(isShip, isUnderdeck);
    if (isShip) {
      this.renderMast();
      this.renderDeckHatch();
    } else {
      this.placeFurniture(door.theme);
    }
    const meta = this.spawnResident(door, isShip);

    this.pl = { x: this.exitTx * T + 8, y: (this.exitTy - 1) * T + 8, face: "north", moving: false };
    this.bobT = 0;
    this.pShadow = this.add.ellipse(this.pl.x, this.pl.y + 6, 10, 4, 0x000000, 0.26).setDepth(1.6);
    this.pSprite = this.add.image(this.pl.x, this.pl.y + 6, "char_player").setOrigin(0.5, 0.81).setScale(0.6).setDepth(this.pl.y + 8);

    const cam = this.setupCamera(isShip, isUnderdeck);
    this.buildLabels(cam, door, meta, isShip, isUnderdeck);

    this.ePrev = true;
  }

  /** Wand-Kachel im rechteckigen Haus-Innenraum (Rand + Tür-Freistellung)? */
  private isWallTile(x: number, y: number): boolean {
    return y === 0 || x === 0 || x === this.RW - 1 || (y === this.RH - 1 && x !== this.exitTx);
  }

  /** Wand-Kachel auf dem bootsförmigen Deck (außerhalb der Silhouette oder Gangway-Reihe)? */
  private isDeckWall(x: number, y: number): boolean {
    if (y === this.RH - 1) return x !== this.exitTx; // Gangway-Reihe
    const shape = DECK_SHAPE[y];
    if (!shape) return true;
    return x < shape.x0 || x > shape.x1;
  }

  private renderRoom(isShip: boolean, isUnderdeck: boolean): void {
    const { RW, RH } = this;
    const wallKey = (isShip || isUnderdeck) ? "interior_wall_ship" : "interior_wall_house";
    // Unterdeck (#761): dunklerer, feuchter Laderaum-Boden; Deck/Haus behalten den hellen Holzdielen-Boden.
    const floorKey = isUnderdeck ? "underdeck_floor" : "interior_floor";
    const rt = this.add.renderTexture(0, 0, RW * T, RH * T).setOrigin(0).setDepth(0);
    const topLeft = { originX: 0, originY: 0 };
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
      const isWall = isShip ? this.isDeckWall(x, y) : this.isWallTile(x, y);
      if (isWall) { rt.stamp(wallKey, undefined, x * T, y * T, topLeft); this.solid[y * RW + x] = 1; }
      else rt.stamp(floorKey, undefined, x * T, y * T, topLeft);
    }
    rt.render();
  }

  /** Zwei Messing-Bullaugen (nur im Haus-Kajüten-Modus, nicht an Deck oder Unterdeck). */
  private renderPortholes(): void {
    for (const px of [3, 7]) {
      this.add.image(px * T + 8, T - 6, "porthole").setScale(0.42).setDepth(0.5);
    }
  }

  /** Schwelle/Austritt: Deck-Luke (Deck), Niedergang-Treppe (Unterdeck, #761) oder Holztür (Haus). */
  private renderThreshold(isShip: boolean, isUnderdeck: boolean): void {
    const cx = this.exitTx * T + 8;
    if (isUnderdeck) {
      // Niedergang-Treppe zurück aufs Deck (#761): ersetzt die flache Luke durch echte Stufen.
      this.add.image(cx, this.exitTy * T + 8, "hold_stairs").setScale(0.42).setDepth(1);
    } else if (isShip) {
      this.add.image(cx, this.exitTy * T + 8, "ship_hatch").setScale(0.42).setDepth(1);
    } else {
      this.add.image(cx, this.exitTy * T + T + 2, "interior_door").setOrigin(0.5, 1).setScale(0.42).setDepth(1);
    }
  }

  /** Mast-Platzhalter (Bug-Bereich, Spalte 7, Zeile 1). */
  private renderMast(): void {
    const mx = 7 * T + 8, my = 1 * T + 4;
    this.add.rectangle(mx, my + 10, 5, 22, 0x5a3e28).setDepth(my + T);
    this.add.rectangle(mx, my + 4, 22, 3, 0x5a3e28).setDepth(my + T + 1); // Querbaum
  }

  /** Unterdeck-Luke auf dem Deck (Heck, Spalte 7, Zeile 8) – ab #759 interaktiv. */
  private renderDeckHatch(): void {
    const hx = DECK_HATCH_TX * T + 8, hy = DECK_HATCH_TY * T + 8;
    this.add.image(hx, hy, "ship_hatch").setScale(0.42).setDepth(hy);
  }

  private placeFurniture(theme: string): void {
    for (const f of (INTERIORS[theme] || [])) {
      this.add.image(f.tx * T + 8, f.ty * T + 12, f.tex).setScale(0.5).setOrigin(0.5, 0.7).setDepth(f.ty * T + T);
      this.solid[f.ty * this.RW + f.tx] = 1;
    }
  }

  /** NPC-Figur: auf dem Deck im Mittelteil (Zeile 5), in Häusern/Unterdeck fixer Platz (Zeile 2). */
  private spawnResident(door: Door, isShip: boolean): NpcMeta | undefined {
    const meta = door.npc ? KQContent.NPCS[door.npc] : undefined;
    const ntx = this.exitTx;
    const nty = isShip ? 5 : 2;
    this.solid[nty * this.RW + ntx] = 1;
    this.npcId = door.npc;
    this.npcX = ntx * T + 8;
    this.npcY = nty * T + 8;
    const nbaseY = nty * T + 15;
    this.add.ellipse(ntx * T + 8, nty * T + 15, 10, 4, 0x000000, 0.26).setDepth(1.6);
    const npc = meta
      ? this.add.image(ntx * T + 8, nbaseY, meta.tex).setOrigin(0.5, 0.81).setScale(0.6).setDepth(nty * T + T)
      : undefined;
    if (npc) this.tweens.add({ targets: npc, y: npc.y - 1, duration: 1000, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    return meta;
  }

  private setupCamera(isShip: boolean, isUnderdeck: boolean): Phaser.Cameras.Scene2D.Camera {
    const { RW, RH } = this;
    const cam = this.cameras.main;
    cam.setBounds(0, 0, RW * T, RH * T);
    // Deck: leichter Blauton (Tageshimmel-Reflex), Unterdeck: tiefes Dunkelblau (Laderaum), Haus: dunkler Holzraum
    cam.setBackgroundColor(isShip ? 0x0a1e2e : isUnderdeck ? 0x060e18 : 0x140f0a);
    cam.centerOn(RW * T / 2, RH * T / 2);
    const fit = Math.min(window.innerWidth / (RW * T), window.innerHeight / (RH * T)) * 0.85;
    cam.setZoom(Phaser.Math.Clamp(fit, 2.4, 6));
    return cam;
  }

  private buildLabels(cam: Phaser.Cameras.Scene2D.Camera, door: Door, meta: NpcMeta | undefined, isShip: boolean, isUnderdeck: boolean): void {
    const cw = cam.width, ch = cam.height;
    const npcName = meta ? meta.name + " · " + meta.title : "";
    pixelText(this, cw / 2, 12, ((isShip || isUnderdeck) ? "⛵ " : "🚪 ") + door.title, { color: "#ffe9b0", size: 16, origin: [0.5, 0], depth: 20000, shadow: true }).setScrollFactor(0);
    if (npcName) pixelText(this, cw / 2, 34, npcName, { color: "#cdd9e8", size: 12, origin: [0.5, 0], depth: 20000, shadow: true }).setScrollFactor(0);
    this.hintExit = isShip
      ? "E – an Land   ·   ↓ Gangway"
      : isUnderdeck
      ? "E – ans Deck"
      : "E – Hinausgehen   ·   ↓ durch die Tür";
    this.hintTalk = (meta ? "E – mit " + meta.name + " reden" : "E – reden")
      + (isShip ? "   ·   ↓ Gangway" : isUnderdeck ? "" : "   ·   ↓ Tür");
    this.hint = pixelText(this, cw / 2, ch - 22, this.hintExit, { color: "#ffd97a", size: 12, origin: [0.5, 1], depth: 20000, shadow: true }).setScrollFactor(0);
  }

  isSolid(px: number, py: number) {
    const tx = Math.floor(px / T), ty = Math.floor(py / T);
    if (tx < 0 || ty < 0 || tx >= this.RW || ty >= this.RH) return true;
    return !!this.solid[ty * this.RW + tx];
  }

  tryMove(dx: number, dy: number) {
    const pl = this.pl;
    const probe = (nx: number, ny: number) =>
      this.isSolid(nx - 4, ny - 2) || this.isSolid(nx + 4, ny - 2) ||
      this.isSolid(nx - 4, ny + 5) || this.isSolid(nx + 4, ny + 5);
    if (!probe(pl.x + dx, pl.y)) pl.x += dx;
    if (!probe(pl.x, pl.y + dy)) pl.y += dy;
  }

  /** Verlässt den Innenraum: geht zur Weltkarte zurück (oder zur returnDoor, wenn gesetzt). */
  exitInterior() {
    SFX.door();
    if (this.door.returnDoor) {
      this.scene.restart({ door: this.door.returnDoor });
    } else {
      setInteriorOpen(false);
      this.scene.wake("World");
      this.scene.stop();
    }
  }

  /** Wechselt vom Deck ins Unterdeck (Schiff-Luken-Kachel betreten). */
  enterUnderdeck() {
    SFX.door();
    this.scene.restart({ door: UNDERDECK_DOOR });
  }

  update(_time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000);
    const pl = this.pl;
    const blocked = UI.blocking();

    this.bobT = stepSimplePlayer(pl, dt, blocked, 70, this.bobT, (mx, my) => this.tryMove(mx, my));
    renderPlayer(this.pSprite, this.pShadow, pl, this.bobT);

    const ePhys = !!keys["e"] || !!keys["Enter"] || !!keys[" "];
    const onExit = Math.floor(pl.x / T) === this.exitTx && Math.floor(pl.y / T) === this.exitTy;
    const nearNpc = !!this.npcId && Math.hypot(pl.x - this.npcX, pl.y - this.npcY) <= TALK_RANGE;
    this.hint.setText(sanitize(nearNpc ? this.hintTalk : this.hintExit));
    const { eFlank, ePrev } = interiorEFlank({ ePhys, ePrev: this.ePrev, blocked });
    this.ePrev = ePrev;
    if (!blocked) {
      // Hatch-Kachel hat Vorrang vor dem normalen Exit (E-Taste am Exit-Tile wäre sonst "exit")
      const onHatch = this.isShip && Math.floor(pl.x / T) === DECK_HATCH_TX && Math.floor(pl.y / T) === DECK_HATCH_TY;
      const action = interiorEAction({ eFlank, onExit, nearNpc });
      if (action === "talk") { UI.talkTo(this.npcId!); return; }
      if (onHatch) { this.enterUnderdeck(); return; }
      if (action === "exit") { this.exitInterior(); return; }
    }
  }
}
