/* ===== Welt-Geometrie (Phaser-frei, pur testbar) =====
 * Liegt bewusst NICHT in scenes.ts: scenes.ts zieht beim Import Phaser (greift
 * auf window/document zu) und läuft daher nicht im Node-Test. Diese reine Mathe
 * – Kachelraster, NPC-Standplätze, Solid-Kacheln – wird von scenes.ts genutzt
 * und in test/world.test.ts direkt abgetestet.
 */

import { type TiledObjectGroup, tiledProps } from "./world/maps/tilemap";
import { npcSpawnsForMap, type Spawn } from "./content/entities";

/** Kachelgröße in Pixeln (muss zu T in scenes.ts passen). */
export const TILE = 16;

/** Re-Export, damit Altaufrufer `import { type Spawn } from "./world"` weiter
 *  funktionieren; die Typ-Quelle ist jetzt die Entity-Registry (content/entities.ts). */
export type { Spawn };

/** Feste NPC-Standplätze des Hafens (Kachel-Koordinaten) – seit #349 aus der
 *  datengesteuerten Entity-Registry (`content/data/entities.json`, Karte "harbor")
 *  abgeleitet statt hier hartcodiert. Die Reihenfolge ist load-bearing: harbormap.ts
 *  serialisiert sie verlustfrei in den Tiled-Objektlayer (harbor.tmj). Kralle fehlt
 *  bewusst – die Quiz-Krabbe wird relativ zum Schiff platziert und erst zur Laufzeit
 *  ergänzt (SHIP_KRALLE), darum kein Registry-Eintrag. */
export const NPC_SPAWNS: Spawn[] = npcSpawnsForMap("harbor");

/** Reichweite, ab der mit einem NPC geredet werden kann (nearestNpc in scenes.ts). */
export const TALK_RANGE = 1.7 * TILE;

/** #201: Was tut die E-Taste im Hausinnenraum gerade?
 *  Steht der Spieler beim Bewohner (in Talk-Reichweite) und drückt E, soll er
 *  mit ihm reden – nicht hinausgehen. Sonst gilt wie bisher: E-Flanke oder auf
 *  der Tür-Schwelle stehen → hinaus. Pur, damit die Entscheidung (statt nur in
 *  der Phaser-Szene zu stecken) im Node-Test abgesichert ist; die InteriorScene
 *  in scenes.ts berechnet `eFlank`/`onExit`/`nearNpc` und ruft das hier auf. */
export function interiorEAction(opts: { eFlank: boolean; onExit: boolean; nearNpc: boolean }): "talk" | "exit" | "none" {
  if (opts.eFlank && opts.nearNpc) return "talk";
  if (opts.eFlank || opts.onExit) return "exit";
  return "none";
}

/** #305: Flanken-Buchführung der E-Taste im Innenraum.
 *  `eFlank` (frischer E-Druck) braucht eine steigende Flanke gegenüber dem
 *  letzten Frame (`ePrev`). Der Knackpunkt: solange ein Dialog/Overlay offen ist
 *  (`blocked`), gehört E dem Dialog – und derselbe Tastendruck, der den Dialog
 *  schließt, darf im nächsten Frame NICHT als neue Flanke ein Reden/Hinausgehen
 *  auslösen (sonst öffnet sich der Dialog sofort wieder → man kam aus dem
 *  Haus-Dialog nicht mehr raus). Lösung: während `blocked` gilt E als „weiter
 *  gedrückt" (`ePrev = true`), sodass erst ein echtes Loslassen + Neudrücken
 *  nach dem Schließen wieder eine Flanke ergibt. Liefert die Flanke fürs
 *  `interiorEAction` UND den nächsten `ePrev`-Zustand. Pur → im Node-Test
 *  prüfbar; die InteriorScene in scenes.ts hält nur `ePrev` und ruft das auf. */
export function interiorEFlank(opts: { ePhys: boolean; ePrev: boolean; blocked: boolean }): { eFlank: boolean; ePrev: boolean } {
  if (opts.blocked) return { eFlank: false, ePrev: true };
  return { eFlank: opts.ePhys && !opts.ePrev, ePrev: opts.ePhys };
}

/* ===== Türen / betretbare Häuser (#6) =====
 * Jede Tür ist eine begehbare Kachel im vorderen Mittelbau eines Gebäudes
 * (die zugehörige Solid-Kachel wird in scenes.ts wieder freigeräumt). Läuft
 * der Spieler auf diese Kachel, startet die InteriorScene mit dem passenden
 * Innenraum. Koordinaten = unterste Reihe der jeweiligen Gebäude-Grundfläche,
 * mittig: house_office(23,10,w7)→(26,12), house_forge(8,8,w5)→(10,10),
 * house_chart(38,9,w5)→(40,11). */
export interface Door {
  id: string;
  tx: number;
  ty: number;
  title: string;
  /** Innenraum-Thema (office/forge/chart/ship …). Bewusst `string`, nicht mehr ein
   *  fest verdrahtetes Enum (#194): die Türen kommen jetzt aus dem Tiled-Objektlayer,
   *  das Thema ist eine Daten-Property. `INTERIORS` in scenes.ts ist über `string`
   *  geschlüsselt; unbekannte Themen fallen dort auf einen leeren Raum zurück. */
  theme: string;
  /** Bewohner-NPC (Deko-Figur im Innenraum). Beim Schiff die Quiz-Krabbe Kralle,
   *  die nicht in NPC_SPAWNS steht – darum optional. */
  npc?: string;
  /** Optionaler Karten-Warp (#194): Ziel-Map-ID aus der Registry. Ist `target`
   *  gesetzt, ist die Tür kein Innenraum, sondern ein Übergang zu einer anderen
   *  Karte – der Warp-Handler löst die Karte über die Registry auf und setzt den
   *  Spieler auf (targetX,targetY). Ohne `target` = Innenraum (theme). Die
   *  bestehenden Hafentüren sind alle Innenräume; das Feld trägt das künftige
   *  Map-zu-Map-Warpen (z.B. Archipel) über dieselbe Objektlayer-Datenform. */
  target?: string;
  targetX?: number;
  targetY?: number;
}

export const DOORS: Door[] = [
  { id: "hafenmeisterei", tx: 26, ty: 12, title: "Hafenmeisterei", theme: "office", npc: "ole" },
  { id: "werft",          tx: 10, ty: 10, title: "Werft",          theme: "forge",  npc: "runa" },
  { id: "kartenhaus",     tx: 40, ty: 11, title: "Kartenhaus",     theme: "chart",  npc: "ada" },
];

/* ===== Eigenes Schiff (#42) – betretbar mit Innenansicht =====
 * Single Source of Truth der Schiffs-Grundfläche (Kachel-Koordinaten); scenes.ts
 * baut sein this.ship daraus, damit Trigger-Luke und Rumpf nicht auseinanderdriften. */
export const SHIP = { x: 30, y: 29, w: 9, h: 6 } as const;

/** Companionway-Luke auf dem Deck: Trigger zum Betreten der Kajüte. Liegt mittig
 *  im Deck (begehbar), nicht am Steg-Rand – so triggert man bewusst beim Drüberlaufen.
 *  Bewusst NICHT in DOORS: das Schiff hängt nicht an einem NPC_SPAWN. */
export const SHIP_DOOR: Door = { id: "schiff", tx: 34, ty: 32, title: "Deine Kajüte", theme: "ship", npc: "kralle" };

/* ===== Begehbares Deck als Boots-Silhouette (#205) =====
 * Früher war die GANZE rechteckige SHIP-Grundfläche begehbar – dadurch lief man auf
 * den Wasserkacheln in den Ecken rund ums Boot, und die Quiz-Krabbe Kralle stand
 * sichtbar IM Wasser rechts neben dem Schiff. Das Boot ist aber kein Rechteck: hier
 * liegt die boot-förmige Deckfläche als Daten – pro Kachelreihe die Spanne [x0,x1]
 * der Kacheln, die wirklich auf dem Rumpf liegen (an der Deckung der Schiffs-Sprite-
 * Pixel abgemessen: nur Kacheln mit ≥60% Boot zählen als Deck). Außerhalb dieser
 * Spannen bleibt im Schiffsbereich das solide Wasser stehen → Kollision rund ums
 * Schiff. Phaser-frei und in test/world.test.ts gepinnt. */
export const SHIP_DECK: ReadonlyArray<{ y: number; x0: number; x1: number }> = [
  { y: 31, x0: 33, x1: 37 },
  { y: 32, x0: 31, x1: 38 },
  { y: 33, x0: 32, x1: 37 },
];

/** Liegt Kachel (x,y) auf dem begehbaren Schiffsdeck (Boots-Silhouette, #205)? */
export function onShipDeck(x: number, y: number): boolean {
  const row = SHIP_DECK.find((r) => r.y === y);
  return !!row && x >= row.x0 && x <= row.x1;
}

/** Standplatz der Quiz-Krabbe Kralle an Deck (#205). Liegt bewusst auf einer Deck-
 *  Kachel (onShipDeck), damit die Krabbe sichtbar AN DECK steht statt im Wasser
 *  daneben (alter Bug: relativ zum Schiff auf eine Wasserkachel rechts vom Rumpf).
 *  scenes.ts platziert Kralle aus dieser Quelle, damit Standplatz und Deck nicht
 *  auseinanderdriften. */
export const SHIP_KRALLE = { x: SHIP.x + 6, y: SHIP.y + 3 } as const;   // (36,32)

/* ===== Schiff schwimmt im Wasser + Holz-Steg (#108) =====
 * Früher lag das ganze Schiff auf einem rechteckigen Holz-Deck mitten im Wasser –
 * ein Boot gehört aufs Wasser. Diese reine Geometrie sagt scenes.ts pro Kachel im
 * Schiffsbereich, was dort liegt: Wasser unterm Rumpf (Schiff schwimmt) bzw. eine
 * schmale Holzplanke als Steg/Anleger (Zugang aufs Deck). Phaser-frei und in
 * test/world.test.ts geprüft, damit Rumpf-Wasser und Steg nicht wieder zu einem
 * Holz-Rechteck verschmelzen. */

/** Steg/Anleger zum eigenen Schiff: schmale Holzplanke (2 Kacheln breit), die vom
 *  Land/Wasser bis aufs Deck reicht. y0 liegt VOR dem Rumpf (sichtbarer Steg im
 *  Wasser), y1 reicht bis aufs Deck (an die Kajüten-Luke heran). */
export const SHIP_PIER = { x: 33, w: 2, y0: 27, y1: 31 } as const;

export type ShipTile = "water" | "pier" | null;

/** Was liegt auf Kachel (x,y) im Schiffsbereich?
 *  - `"pier"`: begehbare Holzplanke (Steg/Anleger, Zugang aufs Deck).
 *  - `"water"`: begehbares Deck – Wasser unterm Rumpf, das das Schiff-Sprite abdeckt;
 *    so läuft man übers Deck zur Kajüten-Luke (SHIP_DOOR). NUR auf der boot-förmigen
 *    Deckfläche (onShipDeck), nicht auf der ganzen Grundfläche (#205).
 *  - `null`: außerhalb von Steg und Deck – inkl. der Wasser-Ecken rund ums Boot
 *    innerhalb der SHIP-Grundfläche; dort greift die normale Welt-Logik (solides
 *    Wasser → Kollision rund ums Schiff, #205).
 *  Liefert NIE ein Holz-Deck-Rechteck unterm Rumpf zurück (das war Bug #108). */
export function shipTile(x: number, y: number): ShipTile {
  const onPier = x >= SHIP_PIER.x && x < SHIP_PIER.x + SHIP_PIER.w &&
                 y >= SHIP_PIER.y0 && y <= SHIP_PIER.y1;
  if (onPier) return "pier";
  return onShipDeck(x, y) ? "water" : null;
}

/** Alle betretbaren Eingänge (Häuser + Schiff) als Code-Default. Dient zugleich
 *  als Quelle, aus der die Hafenkarte ihren Tiled-Objektlayer „Türen" serialisiert
 *  (harbormap.ts) – der Datenpfad liest sie von dort zurück (#194). */
export const ENTRANCES: Door[] = [...DOORS, SHIP_DOOR];

/** Tür/Luke auf der Kachel unter (px,py) in einer GEGEBENEN Tür-Liste (Pixel-
 *  Koordinaten, gefloort wie isSolidAt), oder null. Generisch (#194): der
 *  Datenpfad reicht die aus dem Objektlayer geparsten Türen herein, statt die
 *  Hardcode-Liste zu nutzen. */
export function findDoorAt(doors: readonly Door[], px: number, py: number): Door | null {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  return doors.find((d) => d.tx === tx && d.ty === ty) || null;
}

/** Wie findDoorAt, aber gegen die Code-Default-Eingänge (ENTRANCES). Behält die
 *  bisherige Aufrufform für den Nicht-Tiled-Pfad und die Tests bei. */
export function doorAt(px: number, py: number): Door | null {
  return findDoorAt(ENTRANCES, px, py);
}

/** Türen/Warps aus einem Tiled-Objektlayer lesen (#194). Jedes Objekt ist ein
 *  16×16-Rechteck auf einer Kachel; (x,y) sind Pixel der linken oberen Ecke, also
 *  Kachel = floor(px/TILE). Properties: `theme` (Innenraum), `title`, `npc` und –
 *  für künftige Map-Warps – `target`/`targetX`/`targetY`. So ersetzt der Objektlayer
 *  die Hardcode-Liste DOORS, ohne dass scenes.ts Türen kennt. */
export function doorsFromObjectGroup(group: TiledObjectGroup): Door[] {
  return group.objects.map((o) => {
    const p = tiledProps(o);
    const door: Door = {
      id: o.name,
      tx: Math.floor(o.x / TILE),
      ty: Math.floor(o.y / TILE),
      title: typeof p.title === "string" ? p.title : o.name,
      theme: typeof p.theme === "string" ? p.theme : "",
    };
    if (typeof p.npc === "string" && p.npc) door.npc = p.npc;
    if (typeof p.target === "string" && p.target) {
      door.target = p.target;
      if (typeof p.targetX === "number") door.targetX = p.targetX;
      if (typeof p.targetY === "number") door.targetY = p.targetY;
    }
    return door;
  });
}

/** NPC-Standplätze aus einem Tiled-Objektlayer lesen (#195). Jedes Objekt trägt die
 *  NPC-ID als `name`; (x,y) sind Pixel der linken oberen Ecke der Standplatz-Kachel.
 *  Anders als bei den Türen (doorsFromObjectGroup) werden die Koordinaten NICHT
 *  gefloort: NPCs stehen bewusst auf Bruch-Kachelpositionen (z.B. y 14.6), also ist
 *  die Kachelkoordinate px/TILE EXAKT (Multiplikation/Division mit der Zweierpotenz
 *  16 ist verlustfrei, der Round-Trip trifft NPC_SPAWNS punktgenau). So ersetzt der
 *  Objektlayer die Hardcode-Liste NPC_SPAWNS, ohne dass scenes.ts die Standplätze
 *  kennt. */
export function npcsFromObjectGroup(group: TiledObjectGroup): Spawn[] {
  return group.objects.map((o) => ({ id: o.name, x: o.x / TILE, y: o.y / TILE }));
}

/** Die Kachel, auf der ein NPC „steht" – passend zur Flooring-Logik von
 *  isSolidAt(). Der NPC-Mittelpunkt liegt bei (x*TILE+8 / y*TILE+8). */
export function npcTile(x: number, y: number): { tx: number; ty: number } {
  return { tx: Math.floor((x * TILE + 8) / TILE), ty: Math.floor((y * TILE + 8) / TILE) };
}

/** Grid-Indizes (ty*W+tx), die für die NPCs solide gesetzt werden – damit man
 *  nicht mehr durch sie hindurchläuft. Out-of-bounds wird herausgefiltert. */
export function npcSolidIndices(spawns: Spawn[], W: number, H: number): number[] {
  const out: number[] = [];
  for (const s of spawns) {
    const { tx, ty } = npcTile(s.x, s.y);
    if (tx >= 0 && ty >= 0 && tx < W && ty < H) out.push(ty * W + tx);
  }
  return out;
}

/* ===== Autotile-Auswahl (Blob-/Wang-47er-Set, #340) =====
 * Erster Schritt aus dem Vision-Ticket #256 (Übergangskacheln + weichere Wege/
 * Wasserkanten): die PURE Auswahl-Mathematik, die beim Aufbau der Welt aus der
 * 8er-Nachbarschaft einer Kachel die passende Übergangskachel wählt – gerade,
 * Außen-/Innenkurve, Endstück, Kreuzung, Uferkante. Noch OHNE neue Assets: die
 * Tilesets (Wege, Wasser) kommen in den Folge-Tickets aus #256 und müssen ihre
 * Frames in der Reihenfolge von `BLOB_MASKS` anlegen (Frame-Index = Rückgabewert).
 *
 * Bewusst eigenständig neben dem bestehenden 16er-Corner-Wang (`corners()`/`WANG`
 * in den Szenen): das ist Kanten-/8-Nachbar-Autotiling mit dem klassischen
 * „47er-Blob"-Schema – das, was z.B. Stardew seine geschwungenen Wege gibt.
 *
 * Schema (Standard-Blob): von den 256 möglichen 8-Bit-Masken sind nur 47 wirklich
 * verschiedene Kacheln, weil eine DIAGONALE nur zählt, wenn ihre BEIDEN
 * angrenzenden Kanten auch gesetzt sind (eine Außenecke ohne ihre Kanten ist
 * dieselbe Kachel wie ohne die Ecke). `reduceBlobMask` setzt genau diese Regel um;
 * die 47 reduzierten Masken bilden – aufsteigend sortiert – die kanonische
 * Varianten-Liste, und der Index einer Kachel ist die Position ihrer reduzierten
 * Maske in dieser Liste. Deterministisch und damit voll im Node-Test prüfbar. */

/** Bit-Flag je Nachbarrichtung. Kanten in den unteren vier Bits (N/E/S/W),
 *  Diagonalen darüber (NE/SE/SW/NW) – passend zur Reduktions-Regel unten. */
export const NB = { N: 1, E: 2, S: 4, W: 8, NE: 16, SE: 32, SW: 64, NW: 128 } as const;

/** Die acht Nachbarn einer Kachel: true = derselbe Kacheltyp (Pfad/Wasser/…). */
export interface Neighbors8 {
  n: boolean; ne: boolean; e: boolean; se: boolean;
  s: boolean; sw: boolean; w: boolean; nw: boolean;
}

/** Packt die 8er-Nachbarschaft in die 8-Bit-Maske (siehe `NB`). */
export function maskFromNeighbors(nb: Neighbors8): number {
  return (nb.n ? NB.N : 0) | (nb.e ? NB.E : 0) | (nb.s ? NB.S : 0) | (nb.w ? NB.W : 0) |
         (nb.ne ? NB.NE : 0) | (nb.se ? NB.SE : 0) | (nb.sw ? NB.SW : 0) | (nb.nw ? NB.NW : 0);
}

/** Kernregel des 47er-Blob-Sets: eine Diagonale zählt nur, wenn ihre BEIDEN
 *  angrenzenden Kanten gesetzt sind. So kollabieren die 256 rohen Masken auf die
 *  47 optisch unterscheidbaren (eine Außenecke ohne Kanten ⇒ wie ohne die Ecke). */
export function reduceBlobMask(mask: number): number {
  let m = mask & (NB.N | NB.E | NB.S | NB.W);   // Kanten unverändert übernehmen
  if ((mask & NB.NE) && (m & NB.N) && (m & NB.E)) m |= NB.NE;
  if ((mask & NB.SE) && (m & NB.S) && (m & NB.E)) m |= NB.SE;
  if ((mask & NB.SW) && (m & NB.S) && (m & NB.W)) m |= NB.SW;
  if ((mask & NB.NW) && (m & NB.N) && (m & NB.W)) m |= NB.NW;
  return m;
}

/** Die 47 kanonischen Blob-Varianten als reduzierte Masken, aufsteigend sortiert.
 *  Aus allen 256 Masken abgeleitet statt handgetippt (kein 47-Zeilen-Tippfehler);
 *  der Index einer Kachel ist die Position ihrer reduzierten Maske hier. */
export const BLOB_MASKS: readonly number[] = (() => {
  const set = new Set<number>();
  for (let m = 0; m < 256; m++) set.add(reduceBlobMask(m));
  return Array.from(set).sort((a, b) => a - b);
})();

/** Anzahl der Blob-Varianten (== 47; das Tileset braucht so viele Frames). */
export const AUTOTILE_BLOB_COUNT = BLOB_MASKS.length;

/** Vorberechnete Tabelle rohe Maske (0..255) → Varianten-Index (0..46). */
const BLOB_INDEX: Uint8Array = (() => {
  const pos = new Map<number, number>();
  BLOB_MASKS.forEach((m, i) => pos.set(m, i));
  const tbl = new Uint8Array(256);
  for (let m = 0; m < 256; m++) tbl[m] = pos.get(reduceBlobMask(m)) ?? 0;
  return tbl;
})();

/** Wählt aus einer rohen 8-Bit-Nachbarschaftsmaske den Blob-Varianten-Index
 *  (0..46). Wirft bei ungültiger Maske (keine Ganzzahl 0..255) – ein kaputter
 *  Aufruf soll laut werden, nicht stillschweigend Kachel 0 malen. */
export function autotileIndexFromMask(mask: number): number {
  if (!Number.isInteger(mask) || mask < 0 || mask > 255) {
    throw new RangeError(`Autotile-Maske muss eine Ganzzahl 0..255 sein, war: ${mask}`);
  }
  return BLOB_INDEX[mask]!;
}

/** Bequeme Variante: wählt den Blob-Index direkt aus der 8er-Nachbarschaft. */
export function autotileIndex(nb: Neighbors8): number {
  return autotileIndexFromMask(maskFromNeighbors(nb));
}

/** Baut die 8er-Nachbarschaft einer Kachel (x,y) über ein „gleicher Typ?"-Prädikat
 *  – so ruft scenes.ts es beim Bauen der Welt auf (z.B. `(x,y) => istPfad(x,y)`).
 *  Außerhalb der Karte liefert das Prädikat schlicht false → der Kartenrand wird
 *  zur Kante. Pur, damit die Auswahl im Node-Test prüfbar bleibt. */
export function neighbors8(same: (x: number, y: number) => boolean, x: number, y: number): Neighbors8 {
  return {
    n:  same(x, y - 1), ne: same(x + 1, y - 1), e: same(x + 1, y), se: same(x + 1, y + 1),
    s:  same(x, y + 1), sw: same(x - 1, y + 1), w: same(x - 1, y), nw: same(x - 1, y - 1),
  };
}

/** Solid-Abfrage in Pixel-Koordinaten (in scenes.ts ist das `isSolidAt`). */
export type SolidAt = (px: number, py: number) => boolean;

/* ===== Sub-Tile-Kollision: runde/kleinere Hitboxen (#343) =====
 * Vierter Schritt aus dem Vision-Ticket #256. Bisher ist jede solide Kachel ein
 * volles 16×16-Quadrat (`solidGrid` in scenes.ts, gesetzt über `npcSolidIndices`
 * und die Deko-Streuung). Runde Objekte (Steine, NPCs) bekommen dadurch eckige
 * Hitboxen – man prallt an der Kachel-Ecke ab, statt an der runden Silhouette weich
 * vorbeizugleiten. Hier liegt die pure, testbare Lösung: Kollisionsformen als DATEN
 * (Kreis ODER kleineres Rechteck) in Pixel-Koordinaten, gegen die der Figuren-
 * Footprint (ein Achsen-Rechteck) robust geprüft wird. Wände/Wasser/Gebäude bleiben
 * bewusst das volle Kachel-Quadrat über `solidAt` (sie SIND eckig) – nur Steine/NPCs
 * werden rund. `footprintSolid`/`resolveMove` nehmen die Hitboxen als optionales,
 * rückwärtskompatibles Zusatzargument. Phaser-frei, in test/hitbox.test.ts geprüft. */

/** Kollisionsform eines soliden Objekts in Pixel-Koordinaten. */
export type Hitbox =
  | { readonly kind: "circle"; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** Runde Hitbox (z.B. Stein oder NPC): Mittelpunkt (cx,cy) + Radius r in Pixeln. */
export function circleHitbox(cx: number, cy: number, r: number): Hitbox {
  return { kind: "circle", cx, cy, r };
}
/** Rechteckige Hitbox (z.B. eine kleinere Teil-Kachel): linke obere Ecke (x,y) + Maße. */
export function rectHitbox(x: number, y: number, w: number, h: number): Hitbox {
  return { kind: "rect", x, y, w, h };
}

/** Der Figuren-Footprint als Achsen-Rechteck: ±5 px breit, von 2 px über bis 5 px
 *  unter dem Mittelpunkt – exakt das umschließende Rechteck der vier Probe-Ecken
 *  in footprintSolid, nur als Box, damit man robust gegen runde/kleinere Hitboxen
 *  testen kann (unabhängig von deren Größe, statt nur vier Punkte zu sampeln). */
export function playerFootprint(x: number, y: number): { x: number; y: number; w: number; h: number } {
  return { x: x - 5, y: y - 2, w: 10, h: 7 };
}

/** Überlappt das Achsen-Rechteck (rx,ry,rw,rh) den Kreis (cx,cy,r)? Robust über den
 *  nächstgelegenen Punkt des Rechtecks zum Kreismittelpunkt – auch wenn der Kreis
 *  kleiner als das Rechteck ist (reines Eck-Sampling würde ihn dann verfehlen).
 *  Strikt `<`: bloßes Berühren der Kante blockiert nicht. r<=0 blockiert nie. */
function rectCircleOverlap(rx: number, ry: number, rw: number, rh: number, cx: number, cy: number, r: number): boolean {
  if (r <= 0) return false;
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** Überlappen sich zwei Achsen-Rechtecke? Leere Fläche (w/h<=0) blockiert nie. */
function rectRectOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Blockiert die Hitbox den Figuren-Footprint an Position (x,y)? */
export function hitboxBlocks(box: Hitbox, x: number, y: number): boolean {
  const f = playerFootprint(x, y);
  return box.kind === "circle"
    ? rectCircleOverlap(f.x, f.y, f.w, f.h, box.cx, box.cy, box.r)
    : rectRectOverlap(f.x, f.y, f.w, f.h, box.x, box.y, box.w, box.h);
}

/** Blockiert IRGENDEINE der Hitboxen den Footprint an (x,y)? */
export function blockedByHitboxes(boxes: readonly Hitbox[], x: number, y: number): boolean {
  for (const b of boxes) if (hitboxBlocks(b, x, y)) return true;
  return false;
}

/** Runde Hitboxen für eine NPC-Standplatzliste – je NPC ein Kreis um seinen
 *  Kachel-Mittelpunkt (x*TILE+8 / y*TILE+8, passend zur Flooring-Logik von npcTile).
 *  So gleitet man an NPCs weich vorbei, statt an der vollen Kachel eckig abzuprallen. */
export function npcHitboxes(spawns: readonly Spawn[], r: number): Hitbox[] {
  return spawns.map((s) => circleHitbox(s.x * TILE + 8, s.y * TILE + 8, r));
}

/** Kollisions-Footprint der Figur: vier Ecken um den Mittelpunkt – ±5 px breit,
 *  von 2 px über dem Mittelpunkt bis 5 px darunter (passend zum Sprite-Fuß).
 *  Identisch zur `probe`-Geometrie, die scenes.ts beim Laufen nutzt. Zusätzlich
 *  optional gegen Sub-Tile-Hitboxen (#343: runde Steine/NPCs) – ohne das Argument
 *  exakt das alte Verhalten (nur Kachelgitter). */
export function footprintSolid(solidAt: SolidAt, x: number, y: number, obstacles?: readonly Hitbox[]): boolean {
  if (solidAt(x - 5, y - 2) || solidAt(x + 5, y - 2) ||
      solidAt(x - 5, y + 5) || solidAt(x + 5, y + 5)) return true;
  return obstacles ? blockedByHitboxes(obstacles, x, y) : false;
}

/** Achsen-getrennte Bewegungsauflösung mit Anti-Wedge.
 *
 *  Normalfall: pro Achse nur verschieben, wenn der Ziel-Footprint frei ist – so
 *  läuft man nicht durch solide Kacheln oder NPCs hindurch (#31).
 *
 *  Sonderfall (#36): Steckt der *aktuelle* Footprint schon in einer soliden
 *  Kachel – etwa weil ein alter Spielstand auf einer erst nachträglich solide
 *  gewordenen NPC-Kachel gespeichert wurde – darf die Bewegung NICHT blockiert
 *  werden. Sonst wäre die Figur für immer eingemauert (dreht sich nur, läuft
 *  aber in keine Richtung). Dann jede Richtung erlauben, damit man sich wieder
 *  herausbewegen kann; sobald der Footprint frei ist, greift die normale
 *  Kollision von selbst wieder. */
export function resolveMove(
  solidAt: SolidAt, x: number, y: number, dx: number, dy: number, obstacles?: readonly Hitbox[],
): { x: number; y: number } {
  const stuck = footprintSolid(solidAt, x, y, obstacles);
  if (stuck || !footprintSolid(solidAt, x + dx, y, obstacles)) x += dx;
  if (stuck || !footprintSolid(solidAt, x, y + dy, obstacles)) y += dy;
  return { x, y };
}
