// Geteilte Bausteine aller Phaser-Szenen (#345, scenes.ts-Split): Karten-/Tile-Konstanten,
// die In-Welt-Pixel-Bitmap-Font (#188), Orts-Schilder (#254), schwebende Belohnungstexte und
// das datengesteuerte Insel-NPC-Rendering (#349). Phaser-Präsentation – darf Phaser anfassen.
import Phaser from "phaser";
import { KQContent } from "../content";
import { type Spawn, type EntityObject } from "../content/entities";
import { ATLAS_CHARS, CELL_W, CELL_H, GLYPH_W, GLYPH_H, glyphMatrix, sanitize } from "../pixelfont";

const T = 16;

/* SFX (Mini-Synthesizer) liegt jetzt in sfx.ts und wird oben importiert. */

/* ---------- Kartendaten (wie v2, bewährt) ---------- */
// Gras-Tiles tragen im Boden-Raster die Frame-Indizes 0/1/2 (siehe accept() in
// spawnFlowers/spawnGrassDetail). Die alte GRASS-Verteilung [0,0,0,0,1,2] aus der
// Vor-Wang-Ära wird seit dem PixelLab-Terrain nicht mehr gebraucht und ist entfernt.
const DIRT = 25;
const STONE = [96, 97, 98];
const WOOD = [48, 49, 50, 51, 52, 53];
const CRATE = 63, BARREL = 82, ANVIL = 74, TABLE = 72, DEVICE = 65, BOOK = 66;
const WELL = 104, SIGN = 83, CART = 57;
const WATER = 0x3f7fc4, FOAM = 0xbfe3f5;
// PixelLab Wang-Tileset (Wasser->Sand): Eck-Code (NW,NE,SW,SE; Bit=1 => Land/oben) -> Frame im 4x4-Sheet "coast"
const WANG = [6, 7, 10, 9, 2, 11, 4, 15, 5, 14, 1, 8, 3, 0, 13, 12];

function hashHue(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function hueColor(h: number) { return Phaser.Display.Color.HSLToColor(h / 360, 0.7, 0.55).color; }
function hueColorLight(h: number) { return Phaser.Display.Color.HSLToColor(h / 360, 0.8, 0.75).color; }

/* ---------- Pixel-Bitmap-Font für alle In-Welt-Texte (#188) ----------
 * Eine gemeinsame, im 5×7-Pixelraster gezeichnete Schrift ersetzt die System-Fonts
 * (Verdana/Consolas/monospace) bei Schildern, Cluster-Tags, „!"-Markern, schwebenden
 * Belohnungen und Interior-/Archipel-Titeln → echter Pixelart-Look (Stardew-Messlatte #44).
 * Die Glyphen-Daten liegen Phaser-frei + unit-getestet in pixelfont.ts; hier wird daraus
 * EINMALIG (global im Cache) eine Canvas-Textur gebacken und als Phaser-RetroFont registriert. */
const FONT_KEY = "pixelfont", FONT_TEX = "pixelfontTex", COIN_TEX = "coinIcon";

function buildPixelFont(scene: Phaser.Scene) {
  if (scene.cache.bitmapFont.exists(FONT_KEY)) return;   // global, nur einmal nötig
  const cols = ATLAS_CHARS.length;
  const texW = cols * CELL_W, texH = CELL_H;
  const canvas = scene.textures.createCanvas(FONT_TEX, texW, texH);
  if (!canvas) return;
  const ctx = canvas.getContext();
  ctx.clearRect(0, 0, texW, texH);
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < cols; i++) {
    const m = glyphMatrix(ATLAS_CHARS[i]);
    const ox = i * CELL_W;
    for (let gy = 0; gy < GLYPH_H; gy++)
      for (let gx = 0; gx < GLYPH_W; gx++)
        if (m[gy][gx]) ctx.fillRect(ox + gx, gy, 1, 1);
  }
  canvas.refresh();
  const data = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: FONT_TEX, width: CELL_W, height: CELL_H,
    chars: ATLAS_CHARS, charsPerRow: cols,
    "spacing.x": 0, "spacing.y": 0, "offset.x": 0, "offset.y": 0, lineSpacing: 0,
  });
  scene.cache.bitmapFont.add(FONT_KEY, data);
}

/** Pixel-Münz-Icon für schwebende Belohnungs-Texte (ersetzt das 🪙-Emoji, #188). */
function buildCoinIcon(scene: Phaser.Scene) {
  if (scene.textures.exists(COIN_TEX)) return;
  const g = scene.make.graphics({ add: false } as any);
  g.fillStyle(0x8a5a12, 1); g.fillCircle(5, 5, 5);         // dunkler Rand
  g.fillStyle(0xf2b937, 1); g.fillCircle(5, 5, 4);         // Gold-Körper
  g.fillStyle(0xffe08a, 1); g.fillCircle(3.6, 3.6, 1.3);   // Glanzpunkt
  g.fillStyle(0xc8881f, 1); g.fillRect(3, 4, 4, 2);        // eingeprägter Steg
  g.generateTexture(COIN_TEX, 10, 10); g.destroy();
}

function fontColor(hex?: string) {
  return hex ? parseInt(hex.replace("#", ""), 16) : 0xffffff;
}

/** Erzeugt einen In-Welt-Pixeltext (Phaser-BitmapText). `str` wird vorher entschärft
 *  (Emoji raus, fehlende Zeichen → sichtbarer Fallback), damit nie eine Glyphe fehlt. */
function pixelText(
  scene: Phaser.Scene, x: number, y: number, str: string,
  opts: { color?: string; size?: number; origin?: number | [number, number]; depth?: number; shadow?: boolean } = {},
) {
  const t = scene.add.bitmapText(x, y, FONT_KEY, sanitize(str));
  if (opts.size) t.setFontSize(opts.size);
  t.setTint(fontColor(opts.color));
  if (Array.isArray(opts.origin)) t.setOrigin(opts.origin[0], opts.origin[1]);
  else if (opts.origin !== undefined) t.setOrigin(opts.origin);
  if (opts.depth !== undefined) t.setDepth(opts.depth);
  if (opts.shadow) t.setDropShadow(0, 1, 0x000000, 0.6);
  return t;
}

/** Rendert einen Insel-NPC (Argo/Lumi/Knut) an seinem Registry-Standplatz und gibt
 *  die Laufzeit-Referenz {id,x,y,sprite,marker} zurück: Schatten-Ellipse, tex-Figur
 *  (Origin 0.81 = Fußlinie), sanfter Schwebe-Tween und ein „!"-Marker, der erst
 *  sichtbar wird, wenn eine Quest ansteht (revealNearbyLabels/questMarkerFor schalten
 *  ihn). Identisches Render-Schema für alle drei Insel-Szenen – seit #349 datengesteuert
 *  über `npcSpawnsForMap` (eine Schleife statt drei kopierter Blöcke), damit ein neuer
 *  Insel-NPC nur ein JSON-Eintrag in entities.json ist, kein Code-Edit. */
function spawnIslandNpc(scene: Phaser.Scene, s: Spawn) {
  const meta = KQContent.NPCS[s.id as keyof typeof KQContent.NPCS];
  const px = s.x * T + 8, baseY = s.y * T + 15;
  scene.add.ellipse(px, baseY, 12, 5, 0x000000, 0.26).setDepth(baseY - 1);
  const sprite = scene.add.image(px, baseY, meta.tex).setOrigin(0.5, 0.81).setScale(0.6).setDepth(s.y * T + T);
  scene.tweens.add({ targets: sprite, y: baseY - 1, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  const marker = pixelText(scene, px, s.y * T - 6, "!", { color: "#ffc857", origin: [0.5, 1], depth: 10000, shadow: true });
  marker.setVisible(false);
  scene.tweens.add({ targets: marker, y: s.y * T - 9, duration: 500, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  return { id: s.id, x: s.x, y: s.y, sprite, marker };
}

/** Render-Tuning je prop-Sprite (#357): Skalierung + Schatten-Maße. Bewusst hier in der
 *  Präsentation, NICHT in entities.json – das ist Optik-Feinschliff (hängt am erzeugten
 *  Sprite), kein Karten-Datum. Ein neuer Sprite-Typ = eine Zeile hier; eine weitere
 *  Platzierung eines bekannten Sprites = nur ein JSON-Eintrag (kein Code). Unbekanntes
 *  Sprite fällt weich auf einen neutralen Default zurück. */
const PROP_RENDER: Record<string, { scale: number; shw: number; shh: number }> = {
  crane:         { scale: 0.34, shw: 30, shh: 10 },
  container:     { scale: 0.3,  shw: 26, shh: 8 },
  grafana_board: { scale: 0.32, shw: 26, shh: 9 },
  alert_bell:    { scale: 0.32, shw: 18, shh: 7 },
};

/** Rendert ein registry-gesteuertes Map-Objekt (#357: Kran/Container/Monitoring-Tafel/
 *  Glocke …) an seiner Kachel: Schatten-Ellipse + Sprite mit Fußlinien-Origin, y-tiefen-
 *  sortiert. Spiegelbild zu `spawnIslandNpc` – seit #357 loopen die Insel-Szenen über
 *  `objectsForMap(map)` statt jedes Objekt einzeln zu setzen, sodass ein neues platziertes
 *  Objekt nur ein JSON-Eintrag in entities.json ist, kein Code-Edit. */
function spawnIslandObject(scene: Phaser.Scene, o: EntityObject) {
  const r = PROP_RENDER[o.sprite ?? ""] ?? { scale: 0.5, shw: 16, shh: 6 };
  const cx = o.x * T + 8, baseY = (o.y + 1) * T;
  scene.add.ellipse(cx, baseY - 1, r.shw, r.shh, 0x000000, 0.24).setDepth(baseY - 1);
  scene.add.image(cx, baseY, o.sprite!).setOrigin(0.5, 1).setScale(r.scale).setDepth(baseY + 4);
}

// --- Orts-Schild (#254) -------------------------------------------------
// Die 9-Slice-Ränder des Holzbretts (sign.png, 75×30): links/rechts/oben/unten.
// Vertikal fressen Rahmen oben+unten 8+6=14px, horizontal 8+8=16px – das helle
// Innenfeld ist nur der gestreckte Rest. Das Padding MUSS diese Ränder einrechnen
// (früherer Bug: +7/+10 < Rahmenbreite → Schrift lief auf den dunklen Rahmen).
const SIGN_BORDER = { l: 8, r: 8, t: 8, b: 6 };
const SIGN_PAD = 2;       // Luft zwischen Schrift und Innenfeld-Rand
const SIGN_FONT = 6;      // kleiner als der HUD-Standard (8) → Schrift bleibt im Feld
const SIGN_SCALE = 0.45;  // ganzes Schild verkleinert (#254); Schrift skaliert mit

/** Baut ein Orts-Schild (Welt + Archipel identisch, #254): kleine eingravierte
 *  Pixelschrift, sicher im hellen Innenfeld des 9-Slice-Bretts. Gibt Container +
 *  Maße zurück, damit WorldScene daraus die Tag-Ausweich-Box ableiten kann. */
function buildSign(scene: Phaser.Scene, x: number, y: number, text: string, depth?: number) {
  // Eingravierte Pixelschrift (#188): heller Drop-Shadow nach unten = Gravur-Effekt.
  const txt = pixelText(scene, 0, 0, text, { color: "#3a2410", origin: 0.5, size: SIGN_FONT });
  txt.setDropShadow(0, 1, 0xfff3d6, 0.5);
  const w = Math.max(30, Math.ceil(txt.width) + SIGN_BORDER.l + SIGN_BORDER.r + SIGN_PAD * 2);
  const h = Math.max(22, Math.ceil(txt.height) + SIGN_BORDER.t + SIGN_BORDER.b + SIGN_PAD * 2);
  const board = scene.add.nineslice(0, 0, "sign", undefined, w, h, SIGN_BORDER.l, SIGN_BORDER.r, SIGN_BORDER.t, SIGN_BORDER.b).setOrigin(0.5);
  board.y = -h / 2;
  // Schrift ins Innenfeld zentrieren: Rahmen oben (8) ≠ unten (6) → 1px tiefer als Brettmitte.
  txt.y = -h / 2 + (SIGN_BORDER.t - SIGN_BORDER.b) / 2;
  // Tiefe normal y-sortiert (wie Bäume/Fässer), außer der Aufrufer gibt eine eigene
  // vor: Hausschilder sitzen ÜBER ihrem Gebäude, dessen Tiefe aber an der Fußlinie
  // hängt – ohne Override würde das hohe Dach (höhere Tiefe) das Schild verdecken (#290).
  const cont = scene.add.container(x, y, [board, txt]).setScale(SIGN_SCALE).setDepth(depth ?? y);
  return { cont, w, h };
}

/** Schwebender Belohnungs-/Effekt-Text (#188): Pixelschrift + Pixel-Münz-Icon statt
 *  🪙-Emoji. Reine Emoji-Floats (z.B. ✨) bleiben System-Text – die Bitmap-Font hat
 *  dafür keine Glyphe. Beides steigt auf und blendet aus. */
function floatPixelText(scene: Phaser.Scene, x: number, y: number, str: string, color?: string) {
  const coin = str.includes("🪙");
  const clean = sanitize(str);
  const cont = scene.add.container(x, y).setDepth(10001);
  const parts: Phaser.GameObjects.GameObject[] = [];
  let cursor = 0;
  if (clean) {
    const t = pixelText(scene, 0, 0, clean, { color: color || "#ffd97a", origin: [0, 0.5], shadow: true });
    parts.push(t); cursor = t.width;
  } else if (!coin) {
    // Übrig bleibt nur ein Emoji (z.B. ✨) – als System-Text behalten.
    const t = scene.add.text(0, 0, str, { fontSize: "6px", color: color || "#ffd97a", resolution: 8 }).setOrigin(0, 0.5);
    parts.push(t); cursor = t.width;
  }
  if (coin) {
    const gap = clean ? 3 : 0;
    const icon = scene.add.image(cursor + gap, 0, COIN_TEX).setOrigin(0, 0.5);
    parts.push(icon); cursor += gap + 10;
  }
  cont.add(parts);
  cont.x = x - cursor / 2;   // ganzes Float zentrieren (wie früher origin 0.5)
  scene.tweens.add({ targets: cont, y: y - 14, alpha: 0, duration: 1400, ease: "Sine.out", onComplete: () => cont.destroy() });
}

export {
  T, DIRT, STONE, WOOD, CRATE, BARREL, ANVIL, TABLE, DEVICE, BOOK, WELL, SIGN, CART, WATER, FOAM, WANG, hashHue, hueColor, hueColorLight, FONT_KEY, FONT_TEX, COIN_TEX, buildPixelFont, buildCoinIcon, fontColor, pixelText, spawnIslandNpc, spawnIslandObject, SIGN_BORDER, SIGN_PAD, SIGN_FONT, SIGN_SCALE, buildSign, floatPixelText,
};
