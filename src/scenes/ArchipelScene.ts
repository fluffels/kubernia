import Phaser from "phaser";
import { UI } from "../ui";
import { resolveMove, circleHitbox, npcHitboxes, type Hitbox } from "../world";
import { npcSpawnsForMap, objectsForMap } from "../content/entities";
import { WATER as A_WATER, SAND as A_SAND, PATH as A_PATH, DOCK as A_DOCK, buildArchipel, ARCHIPEL_TO_WORLD, ARCHIPEL_ARRIVAL, ARCHIPEL_NPC, ARCHIPEL_QUEST_TRIGGER } from "../archipel";
import { keys, setWorldScene, setInteriorOpen } from "../runtime";
import { T, DEVICE, FOAM, WANG, pixelText, spawnIslandNpc, spawnIslandObject, buildSign, floatPixelText, IslandScene, type SceneNpc } from "./shared";

/* ===== ArchipelScene (#92) – die erste eigene Nachbar-Insel (GitOps-Archipel) =====
 * Wird von WorldScene.enterArchipel() als eigene Szene gestartet, während die
 * WorldScene schläft. Eine kompakte, voll begehbare Insel: Boden über dieselben
 * Wang-Tiles wie die Hauptkarte, ein Anleger-Steg im Süden zum Zurückwarpen,
 * ein Wegweiser am Quest-Trigger und ein reservierter Standplatz für den neuen
 * NPC (#93) + die GitOps-Quests (#94–97), die hier andocken. Geometrie/Kollision
 * kommen pur aus archipel.ts; Bewegung teilt sich resolveMove mit der Hauptkarte. */
/** #343/#386: Radius der runden Sub-Tile-Hitboxen (Steine/Büsche/NPCs), wie in WorldScene. */
const HIT_R = 6;

export class ArchipelScene extends IslandScene {
  constructor() { super("Archipel"); }

  create() {
    const m = buildArchipel();
    this.W = m.W; this.H = m.H; this.ground = m.ground; this.solid = m.solid;
    // #343/#386: runde Sub-Tile-Hitboxen für Steine/Büsche/NPCs statt voller Kachel –
    // man gleitet weich vorbei. `solid` bleibt für eckige Strukturen (Wasser/Bäume);
    // `softGrid` hält nur die Kachel-Belegung der runden Objekte fürs Deko-Streuen.
    this.softGrid = new Uint8Array(this.W * this.H);
    this.softObstacles = [] as Hitbox[];

    this.renderGround();

    // Bäume (grüner Saum) – gemischter Wald wie auf der Hauptkarte.
    for (const t of m.trees) {
      const kind = ((t.x * 7 + t.y * 13) % 3 === 0) ? "pine" : "tree";
      this.add.image(t.x * T + 8, (t.y + 1) * T, kind).setOrigin(0.5, 1)
        .setScale(kind === "pine" ? 0.95 : 1.1).setDepth((t.y + 1) * T);
    }
    // Etwas Bodendeko auf dem Gras (begehbar) – deterministisch gestreut.
    this.scatterDecor();

    // Rück-Anleger sichtbar markieren (Anker + Wegweiser-Schild).
    const rx = ARCHIPEL_TO_WORLD.tx * T + 8, ry = ARCHIPEL_TO_WORLD.ty * T + 8;
    const anchor = this.add.text(rx, ry - 4, "⚓", { fontSize: "11px", resolution: 6 }).setOrigin(0.5).setDepth(ry + 20);
    this.tweens.add({ targets: anchor, y: ry - 8, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    this.makeSign((ARCHIPEL_TO_WORLD.tx) * T + 8, (ARCHIPEL_TO_WORLD.ty - 1) * T, "Heimhafen");

    // Platzierte Objekte (props) aus der Entity-Registry (#357): eine Schleife über
    // objectsForMap("archipel") rendert jedes prop-Objekt – derzeit hat die Insel keins,
    // aber so ist ein künftiges Insel-Objekt nur ein JSON-Eintrag, kein Code-Edit.
    for (const o of objectsForMap("archipel")) if (o.type === "prop") spawnIslandObject(this, o);

    // Quest-Trigger: Wegweiser als sichtbarer Platzhalter, bis #94–97 hier Quests einhängen.
    // Position + Schild-Label kommen aus der Registry (#357).
    this.objStatue(ARCHIPEL_QUEST_TRIGGER.x, ARCHIPEL_QUEST_TRIGGER.y);
    this.makeSign(ARCHIPEL_QUEST_TRIGGER.x * T + 8, (ARCHIPEL_QUEST_TRIGGER.y - 1) * T, ARCHIPEL_QUEST_TRIGGER.label!);

    // Insel-NPCs datengesteuert aus der Entity-Registry (#349): u.a. die GitOps-Lotsin
    // „Argo" (#93), die ab #94 die Phase-4-Quests vergibt. Eine Schleife über
    // npcSpawnsForMap("archipel") statt den NPC hier hart zu setzen – ein neuer
    // Insel-NPC ist damit nur ein JSON-Eintrag (entities.json), kein Code-Edit. Reden
    // läuft über E → UI.interact() → nearestNpc(); bis Quests andocken, zeigt sie Smalltalk.
    const archipelNpcs = npcSpawnsForMap("archipel");
    // #31/#343/#386: NPCs solide als RUNDE Hitbox (Kreis um den Standplatz) statt voller
    // Kachel – man gleitet weich an ihnen vorbei; Reden (E) greift weiter von der Nachbarkachel.
    this.softObstacles.push(...npcHitboxes(archipelNpcs, HIT_R));
    for (const s of archipelNpcs) this.softGrid[s.y * this.W + s.x] = 1;
    this.npcs = archipelNpcs.map(s => spawnIslandNpc(this, s));

    // Spieler am Ankunfts-Steg (eine Kachel landwärts vom Rück-Warp).
    this.pl = { x: ARCHIPEL_ARRIVAL.tx * T + 8, y: ARCHIPEL_ARRIVAL.ty * T + 8, face: "north", moving: false };
    this.bobT = 0;
    this.pShadow = this.add.ellipse(this.pl.x, this.pl.y + 6, 10, 4, 0x000000, 0.26).setDepth(1.6);
    this.pSprite = this.add.image(this.pl.x, this.pl.y + 6, "char_player").setOrigin(0.5, 0.81).setScale(0.6).setDepth(this.pl.y + 8);

    // Kamera folgt dem Spieler über die Insel.
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.W * T, this.H * T);
    cam.setBackgroundColor(0x356dab);   // offenes Meer als Rand
    cam.setZoom(window.innerWidth < 900 ? 2.4 : 3);
    cam.startFollow(this.pSprite, true, 0.15, 0.15);
    this.scale.on("resize", () => cam.setZoom(window.innerWidth < 900 ? 2.4 : 3));

    // Fixierte Beschriftung: Titel oben, Hinweis unten.
    const cw = cam.width, ch = cam.height;
    pixelText(this, cw / 2, 12, "⚓ GitOps-Archipel", { color: "#ffe9b0", size: 16, origin: [0.5, 0], depth: 20000, shadow: true }).setScrollFactor(0);
    pixelText(this, cw / 2, ch - 22, "Zum Steg laufen ⚓ – zurück nach Port Kubernia", { color: "#ffd97a", size: 12, origin: [0.5, 1], depth: 20000, shadow: true }).setScrollFactor(0);

    // Ein paar Möwen für die Hafen-Atmosphäre (wie auf der Hauptkarte).
    this.time.addEvent({ delay: 6500, loop: true, callback: () => { if (Math.random() < 0.6) this.spawnGull(); } });
    this.spawnGull();

    // Ab jetzt ist die Insel die aktive „WorldScene": E/Prompt der ui.ts (reden,
    // später Quests) greifen über nearestNpc() auf Argo. enterArchipel() hatte
    // interiorOpen(true) gesetzt, um den Übergang abzuschirmen – hier wieder frei,
    // damit man auf der Insel tatsächlich reden kann. exitToWorld() stellt beides
    // auf die Hauptkarte zurück.
    setWorldScene(this);
    setInteriorOpen(false);

    this.ePrev = true;
    // #92: Rück-Warp erst scharf, wenn die (vom Hinweg evtl. noch gehaltene)
    // Lauftaste einmal losgelassen wurde – sonst sofortiges Pingpong.
    this.returnArmed = false;
  }

  /** Wang-Boden wie WorldScene.renderGround, hier ohne Stein-Kai: Wasser → Sand
   *  → Gras → Weg; Steg-Planken als volle Holzkacheln, Wasser-Ränder als „dock"
   *  oder „coast" je nach Nachbar. */
  renderGround() {
    const rt = this.add.renderTexture(0, 0, this.W * T, this.H * T).setOrigin(0).setDepth(0);
    const lv = (cx: number, cy: number) => {
      const ix = cx < 0 ? 0 : cx >= this.W ? this.W - 1 : cx;
      const iy = cy < 0 ? 0 : cy >= this.H ? this.H - 1 : cy;
      const c = this.ground[iy * this.W + ix];
      return c === A_WATER ? 0 : c === A_SAND ? 1 : c === A_PATH ? 3 : 2;
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
    const edgeSet = (x: number, y: number) => {
      const cs = [rawAt(x - 1, y - 1), rawAt(x, y - 1), rawAt(x - 1, y), rawAt(x, y)];
      return cs.some((c) => c === A_DOCK) ? "dock" : "coast";
    };
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const v = this.ground[y * this.W + x];
        if (has(x, y, 0)) rt.drawFrame(edgeSet(x, y), WANG[corners(x, y, 1)], x * T, y * T);
        else if (v === A_DOCK) rt.drawFrame("dock", WANG[15], x * T, y * T);
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

  /** Deterministische Bodendeko (Büsche/Steine/Blumen) auf dem Gras – begehbar
   *  bzw. Büsche/Steine solide, nie auf Weg/Steg/Lichtung. */
  scatterDecor() {
    const reserved = new Set([
      ARCHIPEL_NPC.y * this.W + ARCHIPEL_NPC.x,
      ARCHIPEL_QUEST_TRIGGER.y * this.W + ARCHIPEL_QUEST_TRIGGER.x,
    ]);
    for (let y = 1; y < this.H - 1; y++) {
      for (let x = 1; x < this.W - 1; x++) {
        const i = y * this.W + x;
        const v = this.ground[i];
        if (v !== 0 && v !== 1 && v !== 2) continue;   // nur Gras
        if (this.occupied(x, y)) continue;             // kein Baum/Solid/rundes Objekt drunter
        if (reserved.has(i)) continue;
        const h = (((x * 374761393) ^ (y * 668265263)) >>> 0) % 100;
        if (h < 5) {                                   // Busch: runde Hitbox (#386) statt voller Kachel
          this.add.image(x * T + 8, (y + 1) * T, "bush").setOrigin(0.5, 1).setScale(0.5).setDepth((y + 1) * T);
          this.addSoftCircle(x, y);
        } else if (h < 9) {                            // Stein: runde Hitbox (#386)
          this.add.image(x * T + 8, (y + 1) * T, "rock").setOrigin(0.5, 1).setScale(0.5).setDepth((y + 1) * T);
          this.addSoftCircle(x, y);
        } else if (h < 16) {                           // Blume (begehbar)
          this.add.image(x * T + 8, y * T + 10, "flowers").setScale(0.5).setDepth(y * T + 6);
        }
      }
    }
  }

  /** Schlichter Stein-Wegweiser (Quest-Trigger-Platzhalter) – ein „dungeon"-Tile
   *  als kleines Mahnmal, bis #94–97 echte Quests einhängen. */
  objStatue(tx: number, ty: number) {
    const cx = tx * T + 8, baseY = (ty + 1) * T;
    this.add.ellipse(cx, baseY - 1, 14, 5, 0x000000, 0.22).setDepth(baseY - 1);
    this.add.image(cx, baseY, "dungeon", DEVICE).setOrigin(0.5, 1).setScale(1.1).setDepth(baseY);
  }

  /** Holz-Wegweiser (9-Slice) wie auf der Hauptkarte – gemeinsamer Aufbau (#254). */
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

  /** Kachel belegt? – fürs Deko-Streuen: eckiges Solid (Wasser/Baum) ODER rundes
   *  Sub-Tile-Objekt (Stein/Busch/NPC, #386). Bewusst getrennt von isSolidAt, das
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
    let best: SceneNpc | null = null, bestD = 1.7 * T;
    for (const n of this.npcs) {
      const d = Math.hypot(n.x * T + 8 - pl.x, n.y * T + 8 - pl.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /** Partikel-Effekt am Spieler – die Insel hat (noch) keine eigenen Emitter,
   *  daher ein kurzer Funken-Text. ui.ts ruft das bei Quest-Belohnungen auf. */
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

    // Quest-Marker über Argo (zeigt „!", sobald ab #94 ein Quest-Dialogschritt ansteht).
    for (const n of this.npcs) n.marker.setVisible(!blocked && UI.questMarkerFor(n.id));

    // „E – reden"-Hinweis selbst pflegen: die WorldScene (die das sonst tut)
    // schläft, solange die Insel läuft – ohne diesen Aufruf bliebe Argo ohne
    // sichtbaren Reden-Hinweis.
    UI.updatePrompt();

    // Rück-Anleger betreten? -> zurück nach Port Kubernia (gemeinsames Anti-Pingpong-
    // Gate, #426). Der Notausgang per E greift hier auf dem GANZEN Steg (falls man dort
    // feststeht), nicht nur auf der Anker-Kachel – darum onDock als emergencyExtra.
    const onDock = this.ground[Math.floor(pl.y / T) * this.W + Math.floor(pl.x / T)] === A_DOCK;
    if (this.updateReturn(ARCHIPEL_TO_WORLD, blocked, onDock)) return;
  }
}
