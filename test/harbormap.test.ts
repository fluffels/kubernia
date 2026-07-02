/* Tests für die Hafenkarte als Daten (#192, Epic #57).
 *
 * Deckt drei Dinge ab, inkl. Negativ-/Grenzfälle:
 *  1. die pure Geometrie harborGeometry() (bekannte Kacheln + Solid-Raster),
 *  2. die verlustfreie Tiled-Kodierung (encode/decode, Round-Trip Boden+Kollision),
 *  3. das ECHTE ausgelieferte Artefakt assets/maps/harbor.tmj – es muss exakt der
 *     generierten harborTiledMap() entsprechen (Drift-Schutz: Datei kann nicht
 *     hinter der Geometrie zurückfallen) und der Loader-Validierung standhalten.
 *
 * Die Datei wird aus harborTiledMap() generiert. Neu erzeugen/aktualisieren mit:
 *   GEN_HARBOR=1 npx vitest run test/harbormap.test.ts
 *
 * Ausführen mit:  npm test
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HARBOR_W,
  HARBOR_H,
  WATER,
  SAND,
  DIRT,
  STONE,
  PIER,
  PIER_XS,
  coastY,
  harborGeometry,
  encodeGround,
  decodeGround,
  GROUND_GID_OFFSET,
  harborTiledMap,
  parseHarborMap,
  decodeHarborGround,
  harborWarpLayer,
  WARP_LAYER,
  harborNpcLayer,
  NPC_LAYER,
} from "../src/world/maps/harbormap";
import { collisionGrid, objectGroup } from "../src/world/maps/tilemap";
import { ENTRANCES, doorsFromObjectGroup, npcsFromObjectGroup, NPC_SPAWNS } from "../src/world/world";

const harborPath = fileURLToPath(new URL("../assets/maps/harbor.tmj", import.meta.url));

// Generator: schreibt das Artefakt nur, wenn GEN_HARBOR gesetzt ist (kein
// Seiteneffekt im normalen Lauf). Die Assertions unten prüfen es danach immer.
// Die langen `data`-Arrays werden dabei zeilenweise (HARBOR_W Werte pro Zeile)
// formatiert – so liest sich die Datei als Kachelraster (wie test-map.tmj) und
// erzeugt verständliche Diffs. Auf den Inhalt (geparstes Objekt) hat das keinen
// Einfluss: die Drift-Tests vergleichen geparste Objekte, nicht den Text.
function harborTmjText(): string {
  const pretty = JSON.stringify(harborTiledMap(), null, 2);
  return pretty.replace(/("data": )\[\n([\s\S]*?)\n(\s*)\]/g, (_m, pre, body, indent) => {
    const nums = body.split(/,/).map((t: string) => t.trim()).filter(Boolean);
    const rows: string[] = [];
    for (let y = 0; y < HARBOR_H; y++) {
      rows.push(indent + "  " + nums.slice(y * HARBOR_W, (y + 1) * HARBOR_W).join(", "));
    }
    return pre + "[\n" + rows.join(",\n") + "\n" + indent + "]";
  }) + "\n";
}
if (process.env.GEN_HARBOR) {
  writeFileSync(harborPath, harborTmjText(), "utf8");
}

const at = (grid: { ground: number[]; solid: number[] }) => ({
  g: (x: number, y: number) => grid.ground[y * HARBOR_W + x],
  s: (x: number, y: number) => grid.solid[y * HARBOR_W + x],
});

describe("harborGeometry – Maße & bekannte Kacheln", () => {
  const geo = harborGeometry();
  const { g, s } = at(geo);

  it("füllt das ganze 52×40-Raster (keine leere Kachel im Boden)", () => {
    expect(geo.ground.length).toBe(HARBOR_W * HARBOR_H);
    expect(geo.solid.length).toBe(HARBOR_W * HARBOR_H);
    // Jede Kachel trägt ein Terrain – nie der „leere" Tiled-Wert 0-vor-Offset.
    expect(geo.ground.every((c) => typeof c === "number")).toBe(true);
  });

  it("Gras oben links, Sand & Wasser an der Südküste", () => {
    expect(g(0, 0)).toBe(0);          // Gras-Variante 0 (Hash r=0)
    expect(g(0, coastY(0))).toBe(SAND);
    expect(g(0, coastY(0) + 2)).toBe(WATER);
  });

  it("Wasser ist solide, Land nicht", () => {
    expect(s(0, coastY(0) + 2)).toBe(1);   // Wasser
    expect(s(0, 0)).toBe(0);               // Gras
  });

  it("Hafenkai ist Stein und begehbar", () => {
    expect(STONE).toContain(g(10, 24));
    expect(s(10, 24)).toBe(0);
  });

  it("Stege sind Holz, begehbar (Wasser darunter freigeräumt)", () => {
    for (const px of PIER_XS) {
      expect(g(px, 27)).toBe(PIER);
      expect(s(px, 27)).toBe(0);
    }
  });

  it("Schiff schwimmt (#108): Wasser unterm Deck (begehbar) + Holz-Steg", () => {
    expect(g(34, 32)).toBe(WATER);   // Deck-Kachel (Kajüten-Luke): Wasser unterm Schiff …
    expect(s(34, 32)).toBe(0);       // … aber begehbar (Schiff-Sprite deckt es ab)
    expect(g(33, 27)).toBe(PIER);    // SHIP_PIER: schmaler Holz-Anleger
    expect(s(33, 27)).toBe(0);
  });

  it("Kollision rund ums Schiff (#205): Rechteck-Ecken sind solides Wasser, nicht begehbar", () => {
    // Das Boot ist kein Rechteck – die Ecken der SHIP-Grundfläche liegen im Wasser.
    expect(g(30, 29)).toBe(WATER);   // hintere Ecke: Wasser …
    expect(s(30, 29)).toBe(1);       // … und solide (man läuft nicht mehr daneben ins Wasser)
    expect(g(38, 29)).toBe(WATER);
    expect(s(38, 29)).toBe(1);
  });

  it("Archipel-Anleger ist begehbares Holz", () => {
    expect(g(20, 27)).toBe(PIER);
    expect(s(20, 27)).toBe(0);
  });

  it("Marktplatz und Wege sind Erde", () => {
    expect(g(28, 18)).toBe(DIRT);   // Marktplatz
    expect(g(28, 23)).toBe(DIRT);   // Weg vom Markt nach Süden (path 28,22→28,24)
  });
});

describe("Tiled-Kodierung (encode/decode)", () => {
  it("verschiebt Bodencodes verlustfrei um den Offset", () => {
    for (const code of [WATER, SAND, 0, 1, 2, DIRT, ...STONE, PIER]) {
      expect(decodeGround(encodeGround(code))).toBe(code);
    }
  });

  it("hält jede kodierte gid im gültigen Tiled-Bereich (>=1)", () => {
    const { ground } = harborGeometry();
    const gids = ground.map(encodeGround);
    expect(Math.min(...gids)).toBeGreaterThanOrEqual(1);
    expect(encodeGround(-10)).toBe(-10 + GROUND_GID_OFFSET);  // Holz: kleinster vorkommender Code
    expect(encodeGround(98)).toBe(98 + GROUND_GID_OFFSET);    // größter Code
  });
});

describe("harborTiledMap – Round-Trip Geometrie ⇄ Tiled", () => {
  const map = parseHarborMap(harborTiledMap());
  const geo = harborGeometry();

  it("ist eine gültige 52×40-Map mit Boden + Kollision + Türen- + NPC-Objektlayer", () => {
    expect(map.width).toBe(HARBOR_W);
    expect(map.height).toBe(HARBOR_H);
    expect(map.layers.map((l) => l.name)).toEqual(["Boden", "Kollision", "Türen", "NPCs"]);
  });

  it("Boden decodiert exakt zur Geometrie zurück", () => {
    expect(decodeHarborGround(map)).toEqual(geo.ground);
  });

  it("Kollisions-Layer trifft das Solid-Raster exakt", () => {
    const grid = collisionGrid(map, "Kollision");
    expect(grid).toEqual(geo.solid.map((s) => s === 1));
  });
});

describe("ausgeliefertes Artefakt assets/maps/harbor.tmj", () => {
  const raw = JSON.parse(readFileSync(harborPath, "utf8"));

  it("entspricht exakt der generierten harborTiledMap() (Drift-Schutz)", () => {
    expect(raw).toEqual(harborTiledMap());
  });

  it("besteht die Loader-Validierung und ist 52×40", () => {
    const map = parseHarborMap(raw);
    expect(map.width).toBe(HARBOR_W);
    expect(map.height).toBe(HARBOR_H);
  });

  it("decodiert zur selben Geometrie wie der Code", () => {
    const map = parseHarborMap(raw);
    expect(decodeHarborGround(map)).toEqual(harborGeometry().ground);
  });
});

describe("Türen-/Warp-Objektlayer (#194)", () => {
  const map = parseHarborMap(harborTiledMap());

  it("trägt einen Objektlayer 'Türen' mit je einem Objekt pro Eingang", () => {
    const group = objectGroup(map, WARP_LAYER);
    expect(group.type).toBe("objectgroup");
    expect(group.objects).toHaveLength(ENTRANCES.length);
    // Objektkoordinaten sind Pixel der linken oberen Ecke der Tür-Kachel.
    const first = group.objects[0];
    expect(first.x).toBe(ENTRANCES[0].tx * 16);
    expect(first.y).toBe(ENTRANCES[0].ty * 16);
    expect(first.width).toBe(16);
  });

  it("round-trippt verlustfrei zurück zu den Code-Eingängen ENTRANCES", () => {
    const doors = doorsFromObjectGroup(objectGroup(map, WARP_LAYER));
    expect(doors).toEqual([...ENTRANCES]);
  });

  it("trägt die Schiffs-Luke (theme 'ship') als Warp-Objekt mit", () => {
    const doors = doorsFromObjectGroup(objectGroup(map, WARP_LAYER));
    expect(doors.some((d) => d.theme === "ship" && d.id === "schiff")).toBe(true);
  });

  it("harborWarpLayer ist ein eigenständiger gültiger Objektlayer", () => {
    // Red-Green-Absicherung: würde warpObject die Pixel-Umrechnung (tx*16) auf tx
    // verkürzen, kippt der Round-Trip-Test oben sofort (tx läge dann bei 26/16≈1).
    expect((harborWarpLayer() as { name: unknown }).name).toBe(WARP_LAYER);
    expect((harborWarpLayer() as { objects: unknown[] }).objects).toHaveLength(ENTRANCES.length);
  });
});

describe("NPC-Spawn-Objektlayer (#195)", () => {
  const map = parseHarborMap(harborTiledMap());

  it("trägt einen Objektlayer 'NPCs' mit je einem Objekt pro fester Standplatz", () => {
    const group = objectGroup(map, NPC_LAYER);
    expect(group.type).toBe("objectgroup");
    expect(group.objects).toHaveLength(NPC_SPAWNS.length);
    // Objektkoordinaten sind Pixel der linken oberen Ecke der Standplatz-Kachel.
    const first = group.objects[0];
    expect(first.name).toBe(NPC_SPAWNS[0].id);
    expect(first.x).toBe(NPC_SPAWNS[0].x * 16);
    expect(first.y).toBe(NPC_SPAWNS[0].y * 16);
  });

  it("round-trippt verlustfrei zurück zu den Code-Standplätzen NPC_SPAWNS", () => {
    const npcs = npcsFromObjectGroup(objectGroup(map, NPC_LAYER));
    expect(npcs).toEqual([...NPC_SPAWNS]);
  });

  it("enthält Kralle NICHT (sie wird relativ zum Schiff zur Laufzeit ergänzt)", () => {
    const npcs = npcsFromObjectGroup(objectGroup(map, NPC_LAYER));
    expect(npcs.some((n) => n.id === "kralle")).toBe(false);
  });

  it("vergibt NPC-Objekt-ids hinter den Tür-Objekten (map-weit eindeutig)", () => {
    // Red-Green: kollidierten die ids mit den Tür-Objekten (1..ENTRANCES.length),
    // wäre die Map in Tiled ungültig. Die NPC-ids starten bei ENTRANCES.length+1.
    const ids = objectGroup(map, NPC_LAYER).objects.map((o) => o.id);
    expect(Math.min(...ids)).toBe(ENTRANCES.length + 1);
    expect(new Set(ids).size).toBe(ids.length);   // keine Dubletten
  });

  it("harborNpcLayer ist ein eigenständiger gültiger Objektlayer", () => {
    expect((harborNpcLayer() as { name: unknown }).name).toBe(NPC_LAYER);
    expect((harborNpcLayer() as { objects: unknown[] }).objects).toHaveLength(NPC_SPAWNS.length);
  });
});

describe("parseHarborMap – Negativfälle", () => {
  it("lehnt eine Map mit falschen Maßen ab", () => {
    const wrong = harborTiledMap();
    wrong.width = 8;
    // Nur die Tile-Layer haben ein data-Raster; der Objektlayer (Türen) wird übersprungen.
    (wrong.layers as { data?: unknown; width?: number }[]).forEach((l) => {
      if (Array.isArray(l.data)) { l.width = 8; l.data = l.data.slice(0, 8 * HARBOR_H); }
    });
    expect(() => parseHarborMap(wrong)).toThrow(/52×40|passt nicht/);
  });
});
