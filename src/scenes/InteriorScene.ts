import Phaser from "phaser";
import { UI } from "../ui";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { TALK_RANGE, interiorEAction, interiorEFlank, type Door } from "../world/world";
import { keys, setInteriorOpen } from "../runtime";
import { sanitize } from "../hud/pixelfont";
import { T, STONE, WOOD, CRATE, BARREL, ANVIL, TABLE, DEVICE, BOOK, pixelText, type ScenePlayer } from "./shared";

/* ===== InteriorScene (#6) – betretbarer Hausinnenraum =====
 * Wird von WorldScene.enterInterior() als eigene Szene gestartet, während die
 * WorldScene schläft (eingefroren + ausgeblendet). Ein kleiner gekachelter
 * Raum aus vorhandenen dungeon-Tiles, themengerechte Möbel, die NPC-Figur des
 * Hauses und eine Tür-Schwelle unten zum Hinausgehen (E oder runterlaufen). */
const INTERIORS: Record<string, { frame: number; tx: number; ty: number }[]> = {
  office: [{ frame: TABLE, tx: 3, ty: 2 }, { frame: DEVICE, tx: 7, ty: 2 }, { frame: BOOK, tx: 8, ty: 2 }, { frame: CRATE, tx: 2, ty: 5 }, { frame: BARREL, tx: 8, ty: 5 }],
  forge:  [{ frame: ANVIL, tx: 3, ty: 2 }, { frame: TABLE, tx: 7, ty: 2 }, { frame: DEVICE, tx: 8, ty: 2 }, { frame: BARREL, tx: 2, ty: 5 }, { frame: CRATE, tx: 8, ty: 5 }],
  chart:  [{ frame: TABLE, tx: 3, ty: 2 }, { frame: BOOK, tx: 7, ty: 2 }, { frame: BOOK, tx: 8, ty: 2 }, { frame: CRATE, tx: 2, ty: 5 }, { frame: BARREL, tx: 8, ty: 5 }],
  // Kajüte (#42): Kartentisch + Logbuch, Navigationsgerät, Proviant
  ship:   [{ frame: TABLE, tx: 2, ty: 2 }, { frame: BOOK, tx: 3, ty: 2 }, { frame: DEVICE, tx: 8, ty: 2 }, { frame: BARREL, tx: 2, ty: 5 }, { frame: CRATE, tx: 8, ty: 5 }],
};

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
    const isShip = door.theme === "ship";   // #42: Kajüte statt Hausinnenraum
    const RW = 11, RH = 8;
    this.RW = RW; this.RH = RH;
    this.solid = new Uint8Array(RW * RH);
    this.exitTx = Math.floor(RW / 2);   // 5
    this.exitTy = RH - 1;               // 7 (Tür-Schwelle unten Mitte)

    // Boden (Holz) + Wände (Haus: Stein / Schiff: Holzrumpf); Schwelle unten Mitte frei.
    const wallTiles = isShip ? WOOD : STONE;
    const rt = this.add.renderTexture(0, 0, RW * T, RH * T).setOrigin(0).setDepth(0);
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
      const wall = y === 0 || x === 0 || x === RW - 1 || (y === RH - 1 && x !== this.exitTx);
      if (wall) { rt.drawFrame("dungeon", wallTiles[(x + y) % wallTiles.length], x * T, y * T); this.solid[y * RW + x] = 1; }
      else rt.drawFrame("dungeon", WOOD[(x * 3 + y) % WOOD.length], x * T, y * T);
    }
    // Schiff: Wände abdunkeln (Rumpf) + Bullaugen mit Blick aufs Meer
    if (isShip) {
      for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
        const wall = y === 0 || x === 0 || x === RW - 1 || (y === RH - 1 && x !== this.exitTx);
        if (wall) this.add.rectangle(x * T, y * T, T, T, 0x0a1219, 0.42).setOrigin(0).setDepth(0.4);
      }
      for (const px of [3, 7]) {
        this.add.ellipse(px * T + 8, 8, 11, 11, 0x2f6f8f).setDepth(0.5);          // Meer durchs Bullauge
        this.add.ellipse(px * T + 8, 8, 11, 11).setStrokeStyle(2.5, 0x8a6b3f).setDepth(0.51); // Messingring
        this.add.rectangle(px * T + 8, 8, 11, 2, 0xbfe0ec, 0.7).setDepth(0.52);   // Wellenglanz
      }
    }
    // Schwelle (Haus: Tür-Matte / Schiff: Decksluke) optisch markieren
    this.add.rectangle(this.exitTx * T + 8, this.exitTy * T + T, 12, 14, isShip ? 0x2a1c0d : 0x6b4a2a).setOrigin(0.5, 1).setDepth(1);
    this.add.rectangle(this.exitTx * T + 8, this.exitTy * T + T, 9, 3, isShip ? 0x6b4f35 : 0x2a1c0d).setOrigin(0.5, 1).setDepth(1.1);

    // Themengerechte Möbel (solide, damit man sie nicht durchläuft)
    for (const f of (INTERIORS[door.theme] || [])) {
      this.add.image(f.tx * T + 8, f.ty * T + 12, "dungeon", f.frame).setOrigin(0.5, 0.7).setDepth(f.ty * T + T);
      this.solid[f.ty * RW + f.tx] = 1;
    }

    // NPC-Figur des Hauses/Schiffs (#201: drinnen ansprechbar) + Namensschild
    const meta = door.npc ? KQContent.NPCS[door.npc] : undefined;
    const ntx = this.exitTx, nty = 2;
    this.solid[nty * RW + ntx] = 1;
    // #201: Standplatz des Bewohners merken, damit die E-Taste kontextabhängig
    // wird (steht der Spieler in Talk-Reichweite → reden statt hinausgehen).
    this.npcId = door.npc;
    this.npcX = ntx * T + 8;
    this.npcY = nty * T + 8;
    const nbaseY = nty * T + 15;
    this.add.ellipse(ntx * T + 8, nty * T + 15, 10, 4, 0x000000, 0.26).setDepth(1.6);
    const npc = meta && meta.tex
      ? this.add.image(ntx * T + 8, nbaseY, meta.tex).setOrigin(0.5, 0.81).setScale(0.6).setDepth(nty * T + T)
      : this.add.image(ntx * T + 8, nty * T + 8, "dungeon", meta ? meta.sprite : 0).setDepth(nty * T + T);
    this.tweens.add({ targets: npc, y: npc.y - 1, duration: 1000, yoyo: true, repeat: -1, ease: "Sine.inOut" });

    // Spieler vor der Schwelle
    this.pl = { x: this.exitTx * T + 8, y: (this.exitTy - 1) * T + 8, face: "north", moving: false };
    this.bobT = 0;
    this.pShadow = this.add.ellipse(this.pl.x, this.pl.y + 6, 10, 4, 0x000000, 0.26).setDepth(1.6);
    this.pSprite = this.add.image(this.pl.x, this.pl.y + 6, "char_player").setOrigin(0.5, 0.81).setScale(0.6).setDepth(this.pl.y + 8);

    // Kamera: Raum füllend, mit dunklem Innenraum-Hintergrund
    const cam = this.cameras.main;
    cam.setBounds(0, 0, RW * T, RH * T);
    cam.setBackgroundColor(isShip ? 0x0a1822 : 0x140f0a);
    cam.centerOn(RW * T / 2, RH * T / 2);
    const fit = Math.min(window.innerWidth / (RW * T), window.innerHeight / (RH * T)) * 0.85;
    cam.setZoom(Phaser.Math.Clamp(fit, 2.4, 6));

    // Fixierte Beschriftung (oben Titel, unten Hinweis)
    const cw = cam.width, ch = cam.height;
    const npcName = meta ? meta.name + " · " + meta.title : "";
    pixelText(this, cw / 2, 12, (isShip ? "⚓ " : "🚪 ") + door.title, { color: "#ffe9b0", size: 16, origin: [0.5, 0], depth: 20000, shadow: true }).setScrollFactor(0);
    if (npcName) pixelText(this, cw / 2, 34, npcName, { color: "#cdd9e8", size: 12, origin: [0.5, 0], depth: 20000, shadow: true }).setScrollFactor(0);
    // #201: Hinweis wird in update() kontextabhängig (beim Bewohner „reden").
    this.isShip = isShip;
    this.hintExit = isShip ? "E – an Deck   ·   ↓ durch die Luke" : "E – Hinausgehen   ·   ↓ durch die Tür";
    this.hintTalk = (meta ? "E – mit " + meta.name + " reden" : "E – reden") + (isShip ? "   ·   ↓ Luke" : "   ·   ↓ Tür");
    this.hint = pixelText(this, cw / 2, ch - 22, this.hintExit, { color: "#ffd97a", size: 12, origin: [0.5, 1], depth: 20000, shadow: true }).setScrollFactor(0);

    // E war beim Betreten evtl. noch gedrückt – erst nach Loslassen reagieren.
    this.ePrev = true;
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

  exitInterior() {
    SFX.door();
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
      this.tryMove(dx / len * 70 * dt, dy / len * 70 * dt);
      this.bobT += dt * 12;
    }
    const bob = pl.moving ? Math.abs(Math.sin(this.bobT)) * 1.6 : 0;
    const faceTex = pl.face === "south" ? "char_player" : "char_player_" + pl.face;
    this.pSprite.setTexture(faceTex).setPosition(pl.x, pl.y + 6 - bob).setDepth(pl.y + 8);
    this.pShadow.setPosition(pl.x, pl.y + 6);

    // #201: E ist kontextabhängig. Steht der Spieler beim Bewohner (in
    // Talk-Reichweite) → mit ihm reden; sonst (E-Flanke oder auf der
    // Tür-Schwelle) → hinausgehen. Die Entscheidung liegt pur in
    // interiorEAction() (world.ts), hier nur das Sammeln der Eingaben.
    // #305: Flanke + nächster ePrev kommen aus interiorEFlank() – das hält E
    // während eines offenen Dialogs als „gedrückt", damit der E-Druck, der den
    // Dialog schließt, ihn nicht sofort wieder öffnet (man hing sonst fest).
    const ePhys = !!keys["e"] || !!keys["Enter"] || !!keys[" "];
    const onExit = Math.floor(pl.x / T) === this.exitTx && Math.floor(pl.y / T) === this.exitTy;
    const nearNpc = !!this.npcId && Math.hypot(pl.x - this.npcX, pl.y - this.npcY) <= TALK_RANGE;
    // Hinweis live umschalten (nur wenn man wirklich reden kann).
    this.hint.setText(sanitize(nearNpc ? this.hintTalk : this.hintExit));
    const { eFlank, ePrev } = interiorEFlank({ ePhys, ePrev: this.ePrev, blocked });
    this.ePrev = ePrev;
    if (!blocked) {
      const action = interiorEAction({ eFlank, onExit, nearNpc });
      if (action === "talk") { UI.talkTo(this.npcId!); return; }
      if (action === "exit") { this.exitInterior(); return; }
    }
  }
}
