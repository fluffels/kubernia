/* ===== KubeQuest – WorldScene-Deko & Props (worldscene/scenery.ts) =====
 * Schritt des WorldScene.ts-Splits (#393). Hier liegt die rein optische Ausstattung
 * der Hafenwelt: gestreute Deko (Blumen, Gras, Büsche/Steine/Laternen via scatter),
 * die statischen Props/Effekte (renderStatics: Schiff, Leuchtturm, Rauch,
 * Schmetterlinge, Schilder, Terraform-Plateau, Warp-Marker), Möwen (spawnGull) und
 * der Tag-Nacht-Lichtschleier (updateDayNight).
 *
 * Freie Funktionen mit der Szene als Parameter; die Render-Primitive
 * (scene.registerCullable/makeSign/addShadow) bleiben auf der Szene. Die
 * deterministische Platzierungs-Mathematik ist Phaser-frei in src/decor.ts.
 */
import Phaser from "phaser";
import { pickPlacements, strSeed, hash01, grassTuftStyle } from "../../world/decor";
import { circleHitbox, rectHitbox, SHIP_DOOR } from "../../world/world";
import { gameClock, DAY_CYCLE_MS, withStartOffset } from "../../core/clock";
import { UI } from "../../ui";
import { WORLD_TO_ARCHIPEL } from "../../world/regions/archipel";
import { WORLD_TO_LIGHTHOUSE } from "../../world/regions/lighthouse";
import { WORLD_TO_WAREHOUSE } from "../../world/regions/warehouse";
import { WORLD_TO_FLOTTE } from "../../world/regions/flotte";
import { T, FOAM, WOOD } from "../shared";
import type { WorldSceneLike } from "./types";

export function spawnGull(scene: WorldSceneLike) {
  const y = Phaser.Math.Between(2, 22) * T;
  const fromLeft = Math.random() < 0.5;
  const gull = scene.add.image(fromLeft ? -20 : scene.W * T + 20, y, "seagull")
    .setDepth(11000).setScale(0.35).setFlipX(!fromLeft);
  scene.tweens.add({ targets: gull, y: y + Phaser.Math.Between(-30, 30), duration: 4000, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  scene.tweens.add({
    targets: gull, x: fromLeft ? scene.W * T + 30 : -30,
    duration: Phaser.Math.Between(10000, 16000),
    onComplete: () => gull.destroy(),
  });
}

export function spawnFlowers(scene: WorldSceneLike) {
  // Wildblumen (PixelLab) fest auf freie Gras-Zellen gestreut – bricht das
  // wiederholte Gras-Tile gleichmäßig auf. Jetzt deterministisch statt bei
  // jedem Neuladen neu gewürfelt (#3): gleiche Welt → gleiche Blumen.
  const accept = (x: number, y: number) => {
    const v = scene.ground[y * scene.W + x];
    return (v === 0 || v === 1 || v === 2) && !scene.occupied(x, y);
  };
  for (const p of pickPlacements({
    W: scene.W, H: scene.H, count: 30 * scene.stress, seed: strSeed("flowers"), accept,
    jitter: { x: [2, 14], y: [8, 15] },
  })) {
    // Origin am Boden; leichte feste Neigung (-3..+3°) bricht den Gleichtakt – ohne Bewegung (#30)
    const angle = Math.round(hash01(strSeed("flower-angle"), p.x, p.y) * 6) - 3;
    const img = scene.add.image(p.x * T + p.jx, p.y * T + p.jy, "flowers")
      .setOrigin(0.5, 1).setScale(0.35).setDepth(p.y * T + 6).setAngle(angle);
    scene.registerCullable(img, p.x * T + p.jx, p.y * T + p.jy);
  }
}

/** Dichte Gras-Büschel über die Wiese streuen (#107, Stardew-Look). Macht aus
 *  dem wiederholten Wang-Gras-Tile eine abwechslungsreiche Wiese: viele kleine
 *  Büschel aus echten PixelLab-Pixelart-Sprites (grasstuft0..2), jedes per
 *  grassTuftStyle deterministisch in Form-Variante, Helligkeit, Neigung, Größe
 *  und Spiegelung variiert. Ersetzt die früheren prozedural gezeichneten
 *  Dreieck-Halme aus #40. Platzierung wie bei den Blumen rein deterministisch
 *  (#3) – gleiche Welt → gleiche Wiese, kein Flackern beim Laden. */
export function spawnGrassDetail(scene: WorldSceneLike) {
  const VARIANTS = 3;
  // Die Sprites sind 64×64; auf ~Kachelhöhe herunterskaliert (zusätzlich × s.scale).
  const BASE = 0.26;
  const accept = (x: number, y: number) => {
    const v = scene.ground[y * scene.W + x];
    return (v === 0 || v === 1 || v === 2) && !scene.occupied(x, y);
  };
  // Deutlich mehr Büschel als Blumen → die Wiese wirkt flächig bewachsen statt kahl.
  for (const p of pickPlacements({
    W: scene.W, H: scene.H, count: 140 * scene.stress, seed: strSeed("grass-detail"), accept,
    jitter: { x: [1, 15], y: [6, 15] },
  })) {
    const s = grassTuftStyle(strSeed("grass-style"), p.x, p.y, VARIANTS);
    // Die Farbe trägt jetzt das Pixelart-Sprite selbst (#107). Pro Büschel nur noch
    // eine dezente Helligkeitsvariation (multiplikativer Grau-Tint ~0.82..1.0),
    // damit nicht jedes Büschel exakt gleich wirkt – ohne den Pixelart-Farbton zu
    // überfärben (das wäre der alte Stilbruch aus #40).
    const b = Math.round((0.82 + (s.shade * 0.5 + 0.5) * 0.18) * 255);
    const img = scene.add.image(p.x * T + p.jx, p.y * T + p.jy, "grasstuft" + s.variant)
      .setOrigin(0.5, 1)
      .setScale((s.flip ? -1 : 1) * s.scale * BASE, s.scale * BASE)
      .setAngle(s.angle)
      .setTint(Phaser.Display.Color.GetColor(b, b, b))
      .setDepth(p.y * T + 4);             // y-sortiert, knapp unter Blumen/Objekten
    scene.registerCullable(img, p.x * T + p.jx, p.y * T + p.jy);
  }
}

export function scatter(scene: WorldSceneLike, tex: string, count: number, scale: number, kinds: number[], solid = false, hitR = 0, hitRect?: readonly [number, number]) {
  // PixelLab-Objekte streuen: nur passende Felder, nie auf/neben Wege, nicht auf Solids, Spieler-Start frei.
  // Platzierung ist deterministisch (#3) – Büsche/Steine/Laternen sitzen bei jedem Laden an festen Stellen.
  const isDirt = (x: number, y: number) => scene.ground[y * scene.W + x] === 25;
  const pcx = Math.round(scene.playerPos.x / T), pcy = Math.round(scene.playerPos.y / T);
  const accept = (x: number, y: number) => {
    const v = scene.ground[y * scene.W + x];
    if (kinds.indexOf(v) < 0 || scene.occupied(x, y)) return false;
    if (isDirt(x, y - 1) || isDirt(x, y + 1) || isDirt(x - 1, y) || isDirt(x + 1, y)) return false; // nicht an Wege grenzen
    if (Math.abs(x - pcx) <= 1 && Math.abs(y - pcy) <= 1) return false;                             // Spieler-Start freihalten
    return true;
  };
  // Seed je Sorte (aus dem Textur-Namen) → jede Deko-Art bekommt ihr eigenes festes Muster.
  for (const p of pickPlacements({
    W: scene.W, H: scene.H, count, seed: strSeed(tex), accept,
    jitter: { x: [2, 14], y: [6, 13] },
  })) {
    const ox = p.x * T + p.jx, oy = p.y * T + p.jy;
    const img = scene.add.image(ox, oy, tex).setOrigin(0.5, 0.7).setScale(scale).setDepth(p.y * T + 7);
    scene.registerCullable(img, ox, oy);   // #82: gestreute Deko cullen
    if (tex === "lamppost") {
      // Warmes Glühen am Laternenkopf – leuchtet bei Dämmerung/Nacht auf (#4)
      const glow = scene.add.image(ox, img.getTopCenter().y + 7, "glowSoft").setDisplaySize(26, 26)
        .setTint(0xffd591).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(p.y * T + 6);
      scene.lampGlows.push(glow);
      scene.registerCullable(glow, ox, oy);   // Glühen mit der Laterne mit-cullen (kein Floating-Glow)
    }
    if (hitR > 0) {
      // #343: runde Hitbox unter dem Objekt (Stein/Busch) statt voller Kachel – man
      // gleitet weich vorbei. Die Kachel bleibt für die Deko-Platzierung belegt
      // (softGrid), zählt aber NICHT als eckiges Solid in der Kollision.
      scene.softObstacles.push(circleHitbox(ox, oy, hitR));
      scene.softGrid[p.y * scene.W + p.x] = 1;
    } else if (hitRect) {
      // #386: kleineres Rechteck statt voller Kachel (schmaler Pfosten, z.B. Laterne) –
      // mittig um den Objekt-Ankerpunkt, sodass man dicht daran vorbeigeht. Ebenfalls
      // softGrid-belegt (Deko-Platzierung), aber kein eckiges Vollquadrat in der Kollision.
      const [hw, hh] = hitRect;
      scene.softObstacles.push(rectHitbox(ox - hw / 2, oy - hh / 2, hw, hh));
      scene.softGrid[p.y * scene.W + p.x] = 1;
    } else if (solid) {
      scene.solidGrid[p.y * scene.W + p.x] = 1;
    }
  }
}

/** Tag-Nacht-Zyklus: sanft animierter Lichtschleier über der Welt + Laternen-Glühen,
 *  das bei Dämmerung/Nacht aufleuchtet. Ein voller Tag dauert DAY_CYCLE_MS. (#4)
 *  `time` ist seit #413 die PERSISTENTE Spiel-Zeit (aus `GameState.gameDays`, in ms),
 *  nicht mehr die flüchtige Frame-Zeit – Schleier + Uhr setzen also nach einem Reload
 *  am gespeicherten Zeitpunkt fort (die WorldScene reicht sie so herein). */
export function updateDayNight(scene: WorldSceneLike, time: number) {
  const CYCLE = DAY_CYCLE_MS;                    // Tempo zentral in clock.ts justieren (SSOT)
  // Spielstart-Offset (#336): time=0 → früher Morgen (06:00, phase 0.75) statt Mittag.
  // Identischer Offset wie in gameClock (withStartOffset) → Schleier & Uhr bleiben synchron.
  const phase = (withStartOffset(time, CYCLE) % CYCLE) / CYCLE; // 0 = Mittag … 0.5 = Mitternacht … 0.75 = 06:00
  // Keyframes [phase, r, g, b, alpha] – dazwischen wird linear interpoliert
  const keys: number[][] = [
    [0.0,  10,  18, 48, 0.0],
    [0.2,  10,  18, 48, 0.0],
    [0.3,  255, 138, 60, 0.2],   // Abendrot
    [0.42, 40,  36, 80, 0.42],
    [0.5,  12,  20, 60, 0.55],   // tiefe Nacht
    [0.62, 12,  20, 60, 0.55],
    [0.72, 255, 150, 96, 0.26],  // Morgenrot
    [0.84, 10,  18, 48, 0.0],
    [1.0,  10,  18, 48, 0.0],
  ];
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (phase >= keys[i][0] && phase <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const t = (phase - a[0]) / ((b[0] - a[0]) || 1);
  const lerp = (i: number) => a[i] + (b[i] - a[i]) * t;
  const color = Phaser.Display.Color.GetColor(Math.round(lerp(1)), Math.round(lerp(2)), Math.round(lerp(3)));
  const alpha = lerp(4);
  scene.dayNight.setFillStyle(color).setAlpha(alpha);
  // Laternen an die Schleier-Dichte koppeln: glühen, sobald es dämmert
  const lampLvl = Phaser.Math.Clamp(alpha / 0.42, 0, 1) * 0.7;
  for (const lg of scene.lampGlows) lg.setAlpha(lampLvl);
  // Uhrzeit + Datum aus derselben time/CYCLE-Quelle → garantiert synchron zum Schleier (#39)
  const clock = gameClock(time, CYCLE);
  UI.setClock(clock.dateLabel, clock.timeLabel, clock.title);
}

export function renderStatics(scene: WorldSceneLike) {
  // Deko (Bäume, Häuser, Möbel) – Tiefe nach y. Jedes Bild fürs Culling
  // registrieren (#82): außerhalb des Sichtfelds wird es ausgeblendet.
  for (const d of scene.decoList) {
    const img = d.obj
      ? scene.add.image(d.x * T + 8, d.y * T + 10, d.sheet).setOrigin(0.5, 0.7).setScale(d.scale || 1).setDepth(d.y * T + T)
      : scene.add.image(d.x * T + 8, d.y * T + 8, d.sheet, d.idx).setDepth(d.y * T + T);
    scene.registerCullable(img, d.x * T + 8, d.y * T + 8);
  }
  // === Dein Schiff: hübsches PixelLab-Holzschiff (#41) statt prozeduraler Primitive ===
  // Bug zeigt nach Osten, Heck rund nach Westen – passt zur alten Ausrichtung.
  // Das begehbare Deck bleibt unverändert (Kollisionsraster wird in buildMap gesetzt);
  // hier wird nur die Optik gerendert, Tiefe 2 wie zuvor, damit die Figur aufs Deck läuft.
  const s = scene.ship, px = s.x * T, py = s.y * T, pw = s.w * T, ph = s.h * T;
  const midY = py + ph / 2;
  const shipImg = scene.add.image(px + pw / 2, midY - 6, "ship").setDepth(2);
  const shipScale = (pw + 46) / shipImg.width;   // Rumpf etwas breiter als das Deck – Bug/Heck ragen über
  shipImg.setScale(shipScale);
  // Dynamische Fortschritts-Flagge am Masttop (Tint wird beim Sync gesetzt, s. shipFlag.setTint).
  // Mast sitzt im Asset knapp links der Bildmitte; Offsets relativ zur Bildmitte, mitskaliert.
  const mastTopX = shipImg.x + (-14) * shipScale + 7;
  const mastTopY = shipImg.y + (-76) * shipScale;
  scene.shipFlag = scene.add.image(mastTopX, mastTopY, "px").setScale(6, 4).setDepth(3);
  scene.tweens.add({ targets: scene.shipFlag, y: mastTopY - 2, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });

  // Companionway-Luke (#42): begehbarer Eingang zur Kajüte. Liegt auf SHIP_DOOR,
  // damit der Trigger (doorAt) optisch sichtbar ist. Tiefe knapp unter der Figur,
  // damit man sichtbar darüber steht, bevor der Szenenwechsel auslöst.
  const hx = SHIP_DOOR.tx * T + 8, hy = SHIP_DOOR.ty * T + 8, hatch = scene.add.graphics().setDepth(SHIP_DOOR.ty * T);
  hatch.fillStyle(0x3a2e22); hatch.fillRoundedRect(hx - 8, hy - 7, 16, 14, 3);   // Holzrahmen
  hatch.fillStyle(0x140d08); hatch.fillRoundedRect(hx - 6, hy - 5, 12, 10, 2);   // dunkle Öffnung
  hatch.fillStyle(0x6b4f35); for (let i = 0; i < 3; i++) hatch.fillRect(hx - 5, hy - 3 + i * 3, 10, 1.4); // Leitersprossen
  scene.labels.push({ x: SHIP_DOOR.tx + 0.5, y: SHIP_DOOR.ty - 0.7, text: "↓ Kajüte", color: "#ffe9b0" });

  // === Leuchtturm (Sturmwache) – PixelLab-Turm + rotierender Lichtkegel ===
  const lh = scene.lighthouse, lx = lh.x * T + 8, lyB = (lh.y + 1) * T;
  const lhSc = 0.5;                                   // 45x100-Bild ~ auf alte Turmhöhe (~50px)
  scene.add.ellipse(lx, lyB - 1, 28, 9, 0x5a6470).setDepth(lyB - 2);   // Felsen-Sockel
  scene.add.image(lx, lyB, "lighthouse").setOrigin(0.5, 1).setScale(lhSc).setDepth(lyB + 4);
  const lampY = lyB - Math.round(100 * lhSc) + 9;    // Laternenraum nahe der Bildoberkante
  // Lichtkegel: weiches Dreieck (Spitze = Lampe), per ADD-Blend, dreht sich 360° übers Wasser
  if (!scene.textures.exists("lhbeam")) {
    const bw = 84, bh = 34, bg = scene.make.graphics({}, false);
    bg.fillStyle(0xffe9a0, 1); bg.fillTriangle(0, bh / 2, bw, 0, bw, bh);
    bg.generateTexture("lhbeam", bw, bh); bg.destroy();
  }
  scene.lhBeam = scene.add.image(lx, lampY, "lhbeam").setOrigin(0, 0.5)
    .setAlpha(0.13).setBlendMode(Phaser.BlendModes.ADD).setDepth(lyB + 3);
  scene.tweens.add({ targets: scene.lhBeam, angle: 360, duration: 4600, repeat: -1, ease: "Linear" });
  // pulsierendes Lämpchen im Laternenraum
  scene.lhLight = scene.add.image(lx, lampY, "px").setScale(4.5, 2.5).setTint(0xffe28a).setDepth(lyB + 5);
  scene.tweens.add({ targets: scene.lhLight, alpha: { from: 0.5, to: 1 }, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.inOut" });

  // === Schornstein-Rauch (Hafenmeisterei & Kartenhaus) ===
  for (const [sx, sy] of [[24.6, 10], [38.6, 9]]) {
    scene.add.particles(sx * T, sy * T, "px", {
      speedY: { min: -14, max: -8 }, speedX: { min: -4, max: 4 },
      scale: { start: 1.1, end: 2.6 }, alpha: { start: 0.32, end: 0 },
      tint: 0xcdd4dd, lifespan: 2600, frequency: 650,
    }).setDepth(9400);
  }

  // === Schmetterlinge über den Wiesen ===
  scene.butterflies = [[10, 8, 0xffd1e8], [30, 7, 0xfff3a8], [40, 16, 0xc9e8ff], [17, 18, 0xd8ffc4]].map(([bx, by, tint], i) => ({
    spr: scene.add.image(bx * T, by * T, "px").setScale(1.3, 1).setTint(tint).setDepth(9300),
    ax: bx * T, ay: by * T, ph: i * 1.7, sp: 0.5 + i * 0.13,
  }));

  // Beschriftungen: feste Orts-Schilder (Holzbrett, 9-Slice)
  for (const l of scene.labels) {
    scene.makeSign(l.x * T, l.y * T, l.text, l.depth);
  }

  // Terraform-Plateau (Container, an/aus je nach State)
  const p = scene.tfPlatform;
  scene.tfGroup = scene.add.container(0, 0).setDepth(2);
  const tfRt = scene.add.renderTexture(p.x * T, p.y * T, p.w * T, p.h * T).setOrigin(0);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) tfRt.drawFrame("dungeon", WOOD[(x + y) % 3], x * T, y * T);
  tfRt.fill(FOAM, 0.7, 0, 0, p.w * T, 2);
  scene.tfGroup.add(tfRt);
  const mkSign = (tx: number, ty: number, txt: string) => scene.makeSign(tx, ty, txt);
  scene.tfGroup.add(scene.add.image((p.x + 1) * T + 8, (p.y + 1) * T + 8, "crate").setScale(0.6));
  scene.tfGroup.add(scene.add.image((p.x + 4) * T + 8, (p.y + 2) * T + 8, "crate").setScale(0.6));
  scene.tfGroup.add(mkSign((p.x + 1.5) * T, (p.y + 0.9) * T, "worker-3"));
  scene.tfGroup.add(mkSign((p.x + 4.5) * T, (p.y + 1.9) * T, "worker-4"));
  scene.tfGroup.add(mkSign((p.x + 3.5) * T, (p.y - 0.2) * T, "ost-erweiterung"));
  scene.tfGroup.setVisible(false);
  // Vermessungs-Bojen
  scene.tfBuoys = [];
  for (const [bx, by] of [[p.x, p.y], [p.x + p.w - 1, p.y], [p.x, p.y + p.h - 1], [p.x + p.w - 1, p.y + p.h - 1]]) {
    const b = scene.add.image(bx * T + 8, by * T + 8, "px").setScale(2.5, 3.5).setTint(0xff8c5a).setDepth(2).setVisible(false);
    scene.tweens.add({ targets: b, y: by * T + 5, duration: 800, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    scene.tfBuoys.push(b);
  }

  // Hafen-Kanone (Shop-Upgrade, #183): Pixelart-Sprite statt Emoji 💣.
  scene.cannon = scene.add.image(21 * T, 24 * T + 8, "cannon").setOrigin(0.5).setScale(0.3).setDepth(24 * T + 16).setVisible(false);

  // Anker-Marker am Archipel-Steg (#92): pulsierend, damit der Warp sichtbar ist.
  const ax = WORLD_TO_ARCHIPEL.tx * T + 8, ay = WORLD_TO_ARCHIPEL.ty * T + 8;
  const anchor = scene.add.text(ax, ay - 4, "⚓", { fontSize: "11px", resolution: 6 }).setOrigin(0.5).setDepth(ay + 20);
  scene.tweens.add({ targets: anchor, y: ay - 8, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });

  // #111: Aufstiegs-Marker am Leuchtturm-Fuß, pulsierend, damit der Klippen-Warp sichtbar ist.
  const ux = WORLD_TO_LIGHTHOUSE.tx * T + 8, uy = WORLD_TO_LIGHTHOUSE.ty * T + 8;
  const upArrow = scene.add.text(ux, uy - 4, "⬆", { fontSize: "11px", resolution: 6 }).setOrigin(0.5).setDepth(uy + 20);
  scene.tweens.add({ targets: upArrow, y: uy - 8, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });

  // #124: Anker-Marker am Lager-Anleger (Westkai), pulsierend wie der Archipel-Anker.
  const wx = WORLD_TO_WAREHOUSE.tx * T + 8, wy = WORLD_TO_WAREHOUSE.ty * T + 8;
  const whAnchor = scene.add.text(wx, wy - 4, "⚓", { fontSize: "11px", resolution: 6 }).setOrigin(0.5).setDepth(wy + 20);
  scene.tweens.add({ targets: whAnchor, y: wy - 8, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });

  // #148: Anker-Marker am Flotte-Anleger (Südost-Ecke), pulsierend wie der Lager-Anker.
  const fx = WORLD_TO_FLOTTE.tx * T + 8, fy = WORLD_TO_FLOTTE.ty * T + 8;
  const flAnchor = scene.add.text(fx, fy - 4, "⚓", { fontSize: "11px", resolution: 6 }).setOrigin(0.5).setDepth(fy + 20);
  scene.tweens.add({ targets: flAnchor, y: fy - 8, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });

  scene.dynGroup = scene.add.group(); // Fässer, Flaggen, Laternen, Labels (werden neu gebaut)
}
