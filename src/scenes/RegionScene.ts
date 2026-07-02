/* ===== KubeQuest – generische Region-Szene (scenes/RegionScene.ts) =====
 * #427 (Kind von #415, Block „Skalierungs-Enabler"). EINE datengetriebene Phaser-Szene
 * für alle Nachbar-Regionen (GitOps-Archipel #92, Monitoring-Leuchtturm #111,
 * Lagerhallen-Viertel #124) – vorher drei zu ~90% identische Klassen (ArchipelScene/
 * LighthouseScene/WarehouseScene, je ~230–280 LOC mit byte-gleichem update()/renderGround()/
 * Helfern). Bei Stardew-Scope hieß das: die 4., 8., 15. Region ist Copy-Paste einer ganzen
 * Klasse – genau die Boilerplate-Quelle, die #415 abschafft.
 *
 * Jetzt: die GEMEINSAMEN Methoden (create/update/renderGround/scatterDecor/nearestNpc/
 * isSolidAt/…) leben EINMAL hier; die echten Unterschiede einer Region sind DATEN
 * (RegionConfig in scenes/regions.ts: Geometrie-Builder, Boden-Deko-Bänder, Titel/Hinweis,
 * Rück-Warp/-Marker). Eine neue Standard-Region ist damit ein Config-Eintrag, KEINE neue
 * Szenen-Klasse (Kern-AK von #415). ECHTE Sondermechanik (Leuchtturm-Lichtkegel, Lager-
 * Güter-Hitboxen, Archipel-Bäume + Quest-Trigger-Statue) bleibt ein optionaler `decorate`-
 * Hook in der Config – „eigene Logik nur noch für echte Sondermechanik" (#415).
 *
 * Erbt von IslandScene (#423/#426): die getippten Laufzeit-Felder + der byte-gleiche
 * Insel→Welt-Rück-Warp (updateReturn/exitToWorld) liegen schon dort.
 */
import Phaser from "phaser";
import { UI } from "../ui";
import { resolveMove, circleHitbox, npcHitboxes, type Hitbox } from "../world/world";
import { npcSpawnsForMap, objectsForMap } from "../content/entities";
import { WATER, SAND, PATH, DOCK } from "../world/regions/archipel";
import { keys, setWorldScene, setInteriorOpen } from "../runtime";
import { T, FOAM, WANG, STONE, pixelText, spawnIslandNpc, spawnIslandObject, buildSign, floatPixelText, queueAssetLoad, sliceSheets, IslandScene, type SceneNpc } from "./shared";
import type { Warp } from "../world/warps";
import { assetsForScene } from "../assets-data";

/** #343/#386: Radius der runden Sub-Tile-Hitboxen (Steine/Büsche/NPCs) – in allen
 *  Regionen gleich (wie in WorldScene). */
const HIT_R = 6;

/** Stein-Kai/-Klippe (Boden-Codes 96–98) – als volle Kachel gerendert + edge-„kai". */
const isStone = (c: number) => c === STONE[0] || c === STONE[1] || c === STONE[2];

/** Mindest-Bauplan einer Region: das, was renderGround/Kollision/Kamera brauchen. Die
 *  Geometrie-Builder (buildArchipel/-Lighthouse/-Warehouse) liefern zusätzlich ihre
 *  region-spezifischen Extras (trees/rocks/goods) – der decorate-Hook castet darauf. */
export interface RegionBuild {
  W: number;
  H: number;
  ground: number[];
  solid: Uint8Array;
}

/** Ein Boden-Deko-Band (scatterDecor): bis zum Hash-Schwellwert `max` (0..100) wird `kind`
 *  gestreut. `bush`/`rock` sind solide (runde Sub-Tile-Hitbox), `flowers` begehbar. Bänder
 *  werden in Reihenfolge geprüft (erstes Band mit h<max gewinnt) – exakt die alte if-Kaskade
 *  je Insel. `kind` ist zugleich der Textur-Key (außer flowers). */
export interface RegionDecorBand {
  max: number;
  kind: "bush" | "rock" | "flowers";
}

/** Datengesteuerte Boden-Deko einer Region (optional – das Lager hat keine). */
export interface RegionDecor {
  /** Kacheln, die garantiert frei bleiben (NPC-Standplatz, Quest-Trigger, Ankunft …). */
  reserved: { x: number; y: number }[];
  bands: RegionDecorBand[];
}

/** Die DATEN einer Region – alles, was die generische Szene zum Aufbau braucht. Eine neue
 *  Standard-Region = ein weiterer dieser Einträge (scenes/regions.ts). */
export interface RegionConfig {
  /** Phaser-Szenen-Key (zugleich targetScene in REGION_WARPS). */
  key: string;
  /** Karten-Name in der Entity-Registry (entities.json `map`) – für NPCs/Objekte. */
  map: string;
  /** Reiner Geometrie-Builder (Phaser-frei, pur testbar). */
  build: () => RegionBuild;
  /** Rück-Warp zur Hauptkarte (Region→Welt). */
  regionReturn: Warp;
  /** Ankunfts-Standplatz in der Region (eine Kachel landwärts vom Rück-Warp). */
  arrival: { tx: number; ty: number };
  /** Fixierter HUD-Titel (oben) + Hinweis (unten). */
  title: string;
  hint: string;
  /** Glyph + Schild-Text am Rück-Warp (Anker „⚓"+„Heimhafen" / Pfeil „⬇"+„Port Kubernia"). */
  returnGlyph: string;
  returnSign: string;
  /** y-Versatz (Kacheln) des Quest-Trigger-Schilds relativ zum Trigger: +1 = unter dem
   *  Trigger (Standard), -1 = darüber (Archipel, wo eine Statue auf der Kachel steht). */
  questSignDy: number;
  /** Notausgang per E/Enter auf der GANZEN Steg-/Dock-Fläche zulassen (Archipel), nicht nur
   *  auf der Rück-Kachel. */
  dockEmergencyExit?: boolean;
  /** Boden-Deko-Bänder (optional). */
  decor?: RegionDecor;
  /** Echte Sondermechanik (optional): Bäume/Statue, Leuchtturm-Strahl, Lager-Güter …
   *  Läuft als LETZTER create-Schritt; `build` ist das Ergebnis von `build()` (auf den
   *  region-spezifischen Map-Typ castbar – derselbe Builder hat es erzeugt). */
  decorate?: (scene: RegionScene, build: RegionBuild) => void;
}

export class RegionScene extends IslandScene {
  constructor(readonly cfg: RegionConfig) { super(cfg.key); }

  /** #198 (Lazy-Asset-Loading): die region-exklusiven Assets erst beim Betreten nachladen,
   *  nicht beim Spielstart. Läuft VOR create() – Phaser wartet auf den Loader, darum ist die
   *  Region beim ersten Frame vollständig texturiert (kein Asset-Pop-in). Beim zweiten Besuch
   *  liegt alles schon im Cache → queueAssetLoad reiht nichts ein, der Indikator bleibt aus. */
  preload() {
    const own = assetsForScene(this.cfg.key);
    queueAssetLoad(this, own);
    if (this.load.list.size > 0) this.showRegionLoading();
  }

  /** Kurzer Lade-Schleier beim Region-Warp (#198): nur sichtbar, wenn wirklich etwas
   *  nachgeladen wird (sonst im selben Tick wieder weg). Wird auf „complete" – also noch
   *  vor create() – entfernt, damit der frische Region-Aufbau ihn nicht überlagert. */
  private showRegionLoading() {
    const cam = this.cameras.main;
    const cw = cam.width, ch = cam.height;
    const veil = this.add.rectangle(0, 0, cw, ch, 0x0b1f33, 0.9).setOrigin(0).setScrollFactor(0).setDepth(60000);
    const label = pixelText(this, cw / 2, ch / 2, "Lade Region …", { color: "#ffe9b0", size: 14, origin: 0.5, depth: 60001, shadow: true }).setScrollFactor(0);
    this.load.once("complete", () => { veil.destroy(); label.destroy(); });
  }

  create() {
    const cfg = this.cfg;
    // #198: eigene Sheets in Frames schneiden (falls eine Region je ein Sheet bekommt) – die
    // gemeinsamen Sheets hat die BootScene schon geschnitten, plains brauchen es nicht.
    sliceSheets(this, assetsForScene(cfg.key));
    const m = cfg.build();
    this.W = m.W; this.H = m.H; this.ground = m.ground; this.solid = m.solid;
    // #343/#386: runde Sub-Tile-Hitboxen für Steine/Büsche/NPCs; `solid` bleibt für eckige
    // Strukturen (Wasser/Turm/Container), `softGrid` hält nur die Kachel-Belegung der runden
    // Objekte fürs Deko-Streuen.
    this.softGrid = new Uint8Array(this.W * this.H);
    this.softObstacles = [] as Hitbox[];

    this.renderGround();

    // Boden-Deko (begehbare Blumen / solide Büsche+Steine) – datengetrieben, optional.
    if (cfg.decor) this.scatterDecor(cfg.decor);

    // Platzierte Objekte (props) aus der Entity-Registry (#357): Kran/Container/Tafel/Glocke.
    for (const o of objectsForMap(cfg.map)) if (o.type === "prop") spawnIslandObject(this, o);
    // Quest-Trigger: Schild aus der Registry (Position + Label sind Daten, #357). Der
    // y-Versatz erlaubt das Schild über einer Trigger-Statue (Archipel) statt darunter.
    for (const o of objectsForMap(cfg.map)) if (o.type === "quest_trigger") this.makeSign(o.x * T + 8, (o.y + cfg.questSignDy) * T, o.label!);

    // Insel-NPCs datengesteuert (#349): runde Hitbox + Schwebe-Tween + „!"-Marker. Reden
    // läuft über E → UI.interact() → nearestNpc(); bis Quests andocken, zeigt sie Smalltalk.
    const npcs = npcSpawnsForMap(cfg.map);
    this.softObstacles.push(...npcHitboxes(npcs, HIT_R));
    for (const s of npcs) this.softGrid[s.y * this.W + s.x] = 1;
    this.npcs = npcs.map((s) => spawnIslandNpc(this, s));

    // Rück-Warp sichtbar markieren (Anker/Pfeil + Schild Richtung Hauptkarte).
    const rx = cfg.regionReturn.tx * T + 8, ry = cfg.regionReturn.ty * T + 8;
    const marker = this.add.text(rx, ry - 4, cfg.returnGlyph, { fontSize: "11px", resolution: 6 }).setOrigin(0.5).setDepth(ry + 20);
    this.tweens.add({ targets: marker, y: ry - 8, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    this.makeSign(rx, (cfg.regionReturn.ty - 1) * T, cfg.returnSign);

    // Spieler am Ankunfts-Standplatz (eine Kachel landwärts vom Rück-Warp).
    this.pl = { x: cfg.arrival.tx * T + 8, y: cfg.arrival.ty * T + 8, face: "north", moving: false };
    this.bobT = 0;
    this.pShadow = this.add.ellipse(this.pl.x, this.pl.y + 6, 10, 4, 0x000000, 0.26).setDepth(1.6);
    this.pSprite = this.add.image(this.pl.x, this.pl.y + 6, "char_player").setOrigin(0.5, 0.81).setScale(0.6).setDepth(this.pl.y + 8);

    // Kamera folgt dem Spieler über die Region.
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.W * T, this.H * T);
    cam.setBackgroundColor(0x356dab);   // offenes Meer als Rand
    cam.setZoom(window.innerWidth < 900 ? 2.4 : 3);
    cam.startFollow(this.pSprite, true, 0.15, 0.15);
    this.scale.on("resize", () => cam.setZoom(window.innerWidth < 900 ? 2.4 : 3));

    // Fixierte Beschriftung: Titel oben, Hinweis unten.
    const cw = cam.width, ch = cam.height;
    pixelText(this, cw / 2, 12, cfg.title, { color: "#ffe9b0", size: 16, origin: [0.5, 0], depth: 20000, shadow: true }).setScrollFactor(0);
    pixelText(this, cw / 2, ch - 22, cfg.hint, { color: "#ffd97a", size: 12, origin: [0.5, 1], depth: 20000, shadow: true }).setScrollFactor(0);

    // Ein paar Möwen für die Hafen-Atmosphäre (wie auf der Hauptkarte).
    this.time.addEvent({ delay: 6500, loop: true, callback: () => { if (Math.random() < 0.6) this.spawnGull(); } });
    this.spawnGull();

    // Ab jetzt ist die Region die aktive „WorldScene": E/Prompt der ui.ts greifen über
    // nearestNpc(); exitToWorld() (IslandScene) stellt beides auf die Hauptkarte zurück.
    // enterRegion() hatte interiorOpen(true) gesetzt, um den Übergang abzuschirmen – hier
    // wieder frei, damit man in der Region tatsächlich reden kann.
    setWorldScene(this);
    setInteriorOpen(false);

    this.ePrev = true;
    // Rück-Warp erst scharf, wenn die (vom Hinweg evtl. noch gehaltene) Lauftaste einmal
    // losgelassen wurde – sonst sofortiges Pingpong (#426, IslandScene.updateReturn).
    this.returnArmed = false;

    // Echte Sondermechanik zuletzt (Bäume/Statue/Strahl/Güter): nach dem generischen Aufbau,
    // damit sie auf das fertige Grid/die Deko aufsetzt. Die Builder haben Solid-Kacheln schon
    // markiert, darum bleibt die scatterDecor-Ausgrenzung oben davon unberührt.
    cfg.decorate?.(this, m);
  }

  /** Wang-Boden wie WorldScene.renderGround – in allen Regionen identisch (#427): Wasser →
   *  (dock/kai/coast je nach Nachbar) → Sand → Gras → Pfad; Steg-Planken (DOCK) und Stein-Kai
   *  (96–98) als volle Kacheln. Die Region-Unterschiede (Sand nur am Archipel, Steg nur bei
   *  Archipel/Lager, Stein-Kai bei Leuchtturm/Lager) ergeben sich automatisch aus den Boden-
   *  Codes – kein Sonderzweig je Region nötig. */
  renderGround() {
    const rt = this.add.renderTexture(0, 0, this.W * T, this.H * T).setOrigin(0).setDepth(0);
    const lv = (cx: number, cy: number) => {
      const ix = cx < 0 ? 0 : cx >= this.W ? this.W - 1 : cx;
      const iy = cy < 0 ? 0 : cy >= this.H ? this.H - 1 : cy;
      const c = this.ground[iy * this.W + ix];
      return c === WATER ? 0 : c === SAND ? 1 : c === PATH ? 3 : 2;
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
      if (cs.some((c) => c === DOCK)) return "dock";   // Holz-Steg trifft Wasser
      if (cs.some(isStone)) return "kai";              // Stein-Kai/-Klippe trifft Wasser
      return "coast";
    };
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const v = this.ground[y * this.W + x];
        if (has(x, y, 0)) rt.drawFrame(edgeSet(x, y), WANG[corners(x, y, 1)], x * T, y * T);
        else if (v === DOCK) rt.drawFrame("dock", WANG[15], x * T, y * T);
        else if (isStone(v)) rt.drawFrame("kai", WANG[15], x * T, y * T);
        else if (has(x, y, 3)) rt.drawFrame("path", WANG[corners(x, y, 3)], x * T, y * T);
        else rt.drawFrame("meadow", WANG[corners(x, y, 2)], x * T, y * T);
      }
    }
    // Wellen-Glitzer auf dem Wasser
    for (let i = 0; i < 40; i++) {
      const x = Phaser.Math.Between(0, this.W - 1), y = Phaser.Math.Between(0, this.H - 1);
      if (this.ground[y * this.W + x] !== WATER) continue;
      const s = this.add.image(x * T + Phaser.Math.Between(2, 12), y * T + Phaser.Math.Between(3, 12), "px")
        .setScale(2.5, 0.8).setTint(FOAM).setAlpha(0).setDepth(1);
      this.tweens.add({ targets: s, alpha: { from: 0, to: 0.55 }, duration: Phaser.Math.Between(900, 1800), yoyo: true, repeat: -1, delay: Phaser.Math.Between(0, 2000) });
    }
  }

  /** Deterministische Boden-Deko (Blumen begehbar, Büsche/Steine solide) auf dem Gras –
   *  datengetrieben über die Region-Config (Bänder + reservierte Kacheln). Nie auf
   *  Wasser/Sand/Weg/Steg, nie auf belegten Kacheln (Solid/rundes Objekt), nie auf
   *  reservierten (NPC/Quest-Trigger/Ankunft). */
  scatterDecor(decor: RegionDecor) {
    const reserved = new Set(decor.reserved.map((t) => t.y * this.W + t.x));
    for (let y = 1; y < this.H - 1; y++) {
      for (let x = 1; x < this.W - 1; x++) {
        const i = y * this.W + x;
        const v = this.ground[i];
        if (v !== 0 && v !== 1 && v !== 2) continue;   // nur Gras (Frames 0/1/2)
        if (this.occupied(x, y)) continue;             // kein Solid/rundes Objekt drunter
        if (reserved.has(i)) continue;
        const h = (((x * 374761393) ^ (y * 668265263)) >>> 0) % 100;
        for (const band of decor.bands) {
          if (h >= band.max) continue;
          if (band.kind === "flowers") {
            this.add.image(x * T + 8, y * T + 10, "flowers").setScale(0.5).setDepth(y * T + 6);   // begehbar
          } else {
            // Busch/Stein: runde Hitbox (#386) statt voller Kachel – man gleitet weich vorbei.
            this.add.image(x * T + 8, (y + 1) * T, band.kind).setOrigin(0.5, 1).setScale(0.5).setDepth((y + 1) * T);
            this.addSoftCircle(x, y);
          }
          break;
        }
      }
    }
  }

  spawnGull() {
    const y = Phaser.Math.Between(1, this.H - 4) * T;
    const fromLeft = Math.random() < 0.5;
    const gull = this.add.image(fromLeft ? -20 : this.W * T + 20, y, "seagull")
      .setDepth(11000).setScale(0.35).setFlipX(!fromLeft);
    this.tweens.add({ targets: gull, x: fromLeft ? this.W * T + 30 : -30, duration: Phaser.Math.Between(9000, 15000), onComplete: () => gull.destroy() });
  }

  /** Kachel belegt? – fürs Deko-Streuen: eckiges Solid (Wasser/Turm/Container) ODER rundes
   *  Sub-Tile-Objekt (Stein/Busch/NPC, #386). Bewusst getrennt von isSolidAt, das runde
   *  Objekte als Hitbox prüft (resolveMove), nicht als volle Kachel. */
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

  /** Nächster ansprechbarer NPC (E-Reichweite), gleiche Logik wie WorldScene – ui.ts ruft
   *  das über worldScene() auf, um Reden/Quests anzubieten. */
  nearestNpc() {
    const pl = this.pl;
    let best: SceneNpc | null = null, bestD = 1.7 * T;
    for (const n of this.npcs) {
      const d = Math.hypot(n.x * T + 8 - pl.x, n.y * T + 8 - pl.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /** Partikel-Effekt am Spieler – die Region hat (noch) keine eigenen Emitter, daher ein
   *  kurzer Funken-Text. ui.ts ruft das bei Quest-Belohnungen auf. */
  burstAtPlayer(_kind: string) {
    this.floatText(this.pl.x, this.pl.y - 8, "✨", "#ffe9b0");
  }

  floatText(x: number, y: number, str: string, color?: string) {
    floatPixelText(this, x, y, str, color);
  }

  /** Holz-Wegweiser (9-Slice) wie auf der Hauptkarte – gemeinsamer Aufbau (#254). */
  makeSign(x: number, y: number, text: string, depth?: number) {
    buildSign(this, x, y, text, depth);
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

    // Quest-Marker über den NPCs (zeigt „!", sobald ein Quest-Dialogschritt ansteht).
    for (const n of this.npcs) n.marker.setVisible(!blocked && UI.questMarkerFor(n.id));

    // „E – reden"-Hinweis selbst pflegen: die WorldScene (die das sonst tut) schläft,
    // solange die Region läuft.
    UI.updatePrompt();

    // Rück-Warp betreten? -> zurück nach Port Kubernia (gemeinsames Anti-Pingpong-Gate +
    // Notausgang per E/Enter, #426). dockEmergencyExit weitet den Notausgang über die ganze
    // Steg-Fläche (Archipel), sonst greift er nur auf der Rück-Kachel.
    const emergencyExtra = this.cfg.dockEmergencyExit
      ? this.ground[Math.floor(pl.y / T) * this.W + Math.floor(pl.x / T)] === DOCK
      : false;
    if (this.updateReturn(this.cfg.regionReturn, blocked, emergencyExtra)) return;
  }
}
