/* Regressionstests für #31: NPCs sollen solide sein (man läuft nicht mehr durch
 * sie hindurch), müssen aber weiterhin ansprechbar bleiben.
 *
 * scenes.ts ist Phaser-gekoppelt und nicht im Node-Lauf importierbar; getestet
 * wird daher die pure Geometrie aus src/world.ts, die scenes.ts beim Spawn nutzt.
 * Bewusst auch Grenz-/Negativfälle: out-of-bounds, doppelte Kacheln, Erreichbarkeit.
 */
import { test, expect } from "vitest";
import { NPC_SPAWNS, TILE, TALK_RANGE, npcTile, npcSolidIndices, footprintSolid, resolveMove, DOORS, doorAt, findDoorAt, doorsFromObjectGroup, npcsFromObjectGroup, ENTRANCES, SHIP, SHIP_DOOR, SHIP_PIER, SHIP_DECK, SHIP_KRALLE, onShipDeck, shipTile, interiorEAction, interiorEFlank, type Door, type Spawn } from "../src/world/world";
import type { TiledObjectGroup } from "../src/world/maps/tilemap";

const W = 52, H = 40; // wie WorldScene.create()

/** Baut ein `solidAt(px,py)` aus den NPC-Solid-Kacheln – wie isSolidAt() in
 *  scenes.ts: Pixel → Kachel flooren, im Grid nachsehen. */
function npcSolidAt() {
  const grid = new Uint8Array(W * H);
  for (const i of npcSolidIndices(NPC_SPAWNS, W, H)) grid[i] = 1;
  return (px: number, py: number) => {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
    return grid[ty * W + tx] === 1;
  };
}

test("npcTile floored wie isSolidAt: Mittelpunkt x*T+8 / y*T+8", () => {
  // 26 -> floor(26.5)=26 ; 14.6 -> floor(15.1)=15
  expect(npcTile(26, 14.6)).toEqual({ tx: 26, ty: 15 });
  // 45.8 -> floor(46.3)=46 ; 24.2 -> floor(24.7)=24
  expect(npcTile(45.8, 24.2)).toEqual({ tx: 46, ty: 24 });
  // ganze Zahl: 8 -> floor(8.5)=8
  expect(npcTile(8, 25)).toEqual({ tx: 8, ty: 25 });
});

test("jeder NPC bekommt genau eine Solid-Kachel (Bug: gar keine)", () => {
  const idx = npcSolidIndices(NPC_SPAWNS, W, H);
  expect(idx).toHaveLength(NPC_SPAWNS.length);
  expect(idx.every(i => i >= 0 && i < W * H)).toBe(true);
});

test("Solid-Kacheln machen den Spieler im Grid wirklich blockiert", () => {
  const grid = new Uint8Array(W * H);
  for (const i of npcSolidIndices(NPC_SPAWNS, W, H)) grid[i] = 1;
  for (const s of NPC_SPAWNS) {
    const { tx, ty } = npcTile(s.x, s.y);
    expect(grid[ty * W + tx]).toBe(1); // genau hier läuft man jetzt nicht mehr durch
  }
});

test("keine zwei NPCs teilen sich dieselbe Solid-Kachel", () => {
  const idx = npcSolidIndices(NPC_SPAWNS, W, H);
  expect(new Set(idx).size).toBe(idx.length);
});

test("trotz Blockade bleibt jeder NPC ansprechbar (freie Nachbarkachel in Reichweite)", () => {
  const blocked = new Set(npcSolidIndices(NPC_SPAWNS, W, H));
  for (const s of NPC_SPAWNS) {
    const { tx, ty } = npcTile(s.x, s.y);
    const cx = s.x * TILE + 8, cy = s.y * TILE + 8; // NPC-Mittelpunkt (wie nearestNpc)
    const neighbours = [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]];
    const reachable = neighbours.some(([nx, ny]) => {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
      if (blocked.has(ny * W + nx)) return false; // selbst kein NPC
      const dist = Math.hypot(nx * TILE + 8 - cx, ny * TILE + 8 - cy);
      return dist < TALK_RANGE; // nah genug zum Reden
    });
    expect(reachable, `NPC ${s.id} muss von einer freien Nachbarkachel ansprechbar bleiben`).toBe(true);
  }
});

test("out-of-bounds-NPC erzeugt keine Solid-Kachel", () => {
  expect(npcSolidIndices([{ id: "x", x: -5, y: 3 }], W, H)).toEqual([]);
  expect(npcSolidIndices([{ id: "x", x: 3, y: 999 }], W, H)).toEqual([]);
});

/* ===== #36: Anti-Wedge – Figur darf nicht dauerhaft festklemmen ===== */

test("footprintSolid erkennt eine solide Kachel direkt unter der Figur", () => {
  const solidAt = npcSolidAt();
  // Ole: Solid-Kachel (26,15) → Mittelpunkt 26*16+8 / 15*16+8 = 424 / 248
  expect(footprintSolid(solidAt, 424, 248)).toBe(true);
  // Freie Fläche weit weg von jedem NPC
  expect(footprintSolid(solidAt, 8, 8)).toBe(false);
});

test("#36-Repro: steckt der Footprint in einer Solid-Kachel, muss man herauskommen", () => {
  const solidAt = npcSolidAt();
  // Spielstand mitten auf Oles jetzt-solider Kachel (alter Save vor #31)
  const x0 = 424, y0 = 248;
  expect(footprintSolid(solidAt, x0, y0)).toBe(true); // Vorbedingung: festgesteckt
  // Nach links drücken: ohne Anti-Wedge bliebe x unverändert (eingemauert)
  const moved = resolveMove(solidAt, x0, y0, -1.25, 0);
  expect(moved.x).toBeLessThan(x0); // bewegt sich tatsächlich vom Fleck
  // Wer wiederholt nach links läuft, erreicht freie Kacheln und steckt dann nicht mehr
  let p = { x: x0, y: y0 };
  for (let i = 0; i < 40; i++) p = resolveMove(solidAt, p.x, p.y, -1.25, 0);
  expect(footprintSolid(solidAt, p.x, p.y)).toBe(false);
});

test("normale Kollision bleibt: aus dem Freien NICHT in eine Solid-Kachel laufen", () => {
  const solidAt = npcSolidAt();
  // Direkt rechts neben Oles Solid-Kachel (26,15), Footprint frei
  const x0 = (27 * TILE) + 8, y0 = (15 * TILE) + 8; // 440 / 248
  expect(footprintSolid(solidAt, x0, y0)).toBe(false); // Vorbedingung: frei
  // Schritt nach links Richtung Ole muss geblockt werden (man läuft nicht durch NPCs, #31)
  const blocked = resolveMove(solidAt, x0, y0, -8, 0);
  expect(blocked.x).toBe(x0); // keine Bewegung in die solide Kachel
});

test("Achsen-Trennung: an einer Wand blockierte Achse lässt die andere frei gleiten", () => {
  const solidAt = npcSolidAt();
  const x0 = (27 * TILE) + 8, y0 = (15 * TILE) + 8; // frei, links liegt Ole
  // Diagonal nach links-unten: X blockiert (Ole), Y muss trotzdem durchgehen
  const moved = resolveMove(solidAt, x0, y0, -8, 6);
  expect(moved.x).toBe(x0);          // X bleibt (Wand)
  expect(moved.y).toBe(y0 + 6);      // Y gleitet
});

/* ===== Türen / betretbare Häuser (#6) ===== */

test("doorAt trifft die Tür-Kachel ab dem Mittelpunkt der Kachel", () => {
  for (const d of DOORS) {
    // Mittelpunkt der Tür-Kachel -> genau diese Tür
    expect(doorAt(d.tx * TILE + 8, d.ty * TILE + 8)).toEqual(d);
    // beliebiger Punkt innerhalb derselben Kachel zählt ebenfalls
    expect(doorAt(d.tx * TILE + 1, d.ty * TILE + 15)?.id).toBe(d.id);
  }
});

test("doorAt liefert null neben der Tür (Negativfall, kein versehentliches Betreten)", () => {
  for (const d of DOORS) {
    expect(doorAt((d.tx - 1) * TILE + 8, d.ty * TILE + 8)).toBeNull(); // eine Kachel links
    expect(doorAt(d.tx * TILE + 8, (d.ty + 1) * TILE + 8)).toBeNull(); // eine Kachel darunter (Anlaufpunkt)
  }
  expect(doorAt(0, 0)).toBeNull();
});

test("jede Tür-Kachel liegt im Grid und Türen sind eindeutig", () => {
  expect(DOORS).toHaveLength(3);
  for (const d of DOORS) {
    expect(d.tx >= 0 && d.tx < W && d.ty >= 0 && d.ty < H).toBe(true);
  }
  const keysOf = DOORS.map((d) => d.ty * W + d.tx);
  expect(new Set(keysOf).size).toBe(DOORS.length); // keine zwei Türen auf derselben Kachel
});

test("keine Tür-Kachel kollidiert mit einer NPC-Solid-Kachel (Tür muss begehbar bleiben)", () => {
  const blocked = new Set(npcSolidIndices(NPC_SPAWNS, W, H));
  for (const d of DOORS) {
    expect(blocked.has(d.ty * W + d.tx), `Tür ${d.id} darf nicht auf einer NPC-Kachel liegen`).toBe(false);
  }
});

test("jede Tür verweist auf einen existierenden NPC-Standort", () => {
  const ids = new Set(NPC_SPAWNS.map((s) => s.id));
  for (const d of DOORS) expect(d.npc !== undefined && ids.has(d.npc), `Tür ${d.id} -> NPC ${d.npc}`).toBe(true);
});

/* ===== Eigenes Schiff betretbar (#42) ===== */

test("doorAt trifft die Schiffs-Luke und liefert SHIP_DOOR", () => {
  expect(doorAt(SHIP_DOOR.tx * TILE + 8, SHIP_DOOR.ty * TILE + 8)).toEqual(SHIP_DOOR);
  // beliebiger Punkt in derselben Kachel zählt auch
  expect(doorAt(SHIP_DOOR.tx * TILE + 1, SHIP_DOOR.ty * TILE + 15)?.id).toBe("schiff");
  expect(SHIP_DOOR.theme).toBe("ship");
});

test("Schiffs-Luke liegt begehbar mitten auf dem Deck (innerhalb der Grundfläche)", () => {
  expect(SHIP_DOOR.tx >= SHIP.x && SHIP_DOOR.tx < SHIP.x + SHIP.w).toBe(true);
  expect(SHIP_DOOR.ty >= SHIP.y && SHIP_DOOR.ty < SHIP.y + SHIP.h).toBe(true);
});

test("kein Re-Trigger-Loop: die Wieder-Einstiegskachel (eine unter der Luke) ist selbst keine Tür", () => {
  // enterInterior() setzt den Spieler auf (tx, ty+1) zurück – diese Kachel darf nicht selbst triggern.
  expect(doorAt(SHIP_DOOR.tx * TILE + 8, (SHIP_DOOR.ty + 1) * TILE + 8)).toBeNull();
});

test("doorAt liefert null neben der Schiffs-Luke (kein versehentliches Betreten beim Deck-Laufen)", () => {
  expect(doorAt((SHIP_DOOR.tx - 1) * TILE + 8, SHIP_DOOR.ty * TILE + 8)).toBeNull();
  expect(doorAt((SHIP_DOOR.tx + 1) * TILE + 8, SHIP_DOOR.ty * TILE + 8)).toBeNull();
});

test("Schiffs-Luke kollidiert mit keiner Haustür-Kachel (eindeutiger Eingang)", () => {
  const houseKeys = new Set(DOORS.map((d) => d.ty * W + d.tx));
  expect(houseKeys.has(SHIP_DOOR.ty * W + SHIP_DOOR.tx)).toBe(false);
});

/* ===== Schiff schwimmt im Wasser + Steg (#108) =====
 * Regression gegen den Bug, dass das Schiff auf einem rechteckigen Holz-Deck mitten
 * im Wasser lag. shipTile() darf unterm Rumpf NUR Wasser (oder den Holz-Steg)
 * liefern – nie ein Holz-Deck – und der Steg muss vom Wasser bis aufs Deck reichen. */

test("#108: über die Deck-Silhouette liegt Wasser (Schiff schwimmt), kein Holz-Deck", () => {
  let waterTiles = 0, pierTiles = 0;
  for (const row of SHIP_DECK)
    for (let x = row.x0; x <= row.x1; x++) {
      const t = shipTile(x, row.y);
      // Jede Deck-Kachel ist begehbar und liegt über Wasser oder Steg, nie über einem
      // Holz-Deck-Rechteck (ShipTile hat bewusst keinen Holz-Deck-Typ).
      expect(t === "water" || t === "pier", `Deck-Kachel (${x},${row.y}) ist ${t}`).toBe(true);
      if (t === "water") waterTiles++; else if (t === "pier") pierTiles++;
    }
  // Der Großteil des Decks ist Wasser (das Schiff schwimmt) – nicht nur Steg
  expect(waterTiles).toBeGreaterThan(pierTiles);
});

test("#108: die Deck-Mitte (abseits des Stegs) ist Wasser", () => {
  expect(shipTile(SHIP_DOOR.tx, SHIP_DOOR.ty)).toBe("water");      // Kajüten-Luke mittig im Deck
  expect(shipTile(SHIP_KRALLE.x, SHIP_KRALLE.y)).toBe("water");    // Kralles Deck-Standplatz
});

test("#108: der Steg ist Holz und reicht vom Wasser VOR dem Rumpf bis aufs Deck", () => {
  expect(SHIP_PIER.y0).toBeLessThan(SHIP.y);                         // ragt vor den Rumpf ins Wasser
  expect(SHIP_PIER.y1).toBeGreaterThanOrEqual(SHIP.y);              // erreicht das Deck
  expect(shipTile(SHIP_PIER.x, SHIP_PIER.y0)).toBe("pier");          // Steg-Anfang (außerhalb Rumpf)
  expect(shipTile(SHIP_PIER.x, SHIP.y)).toBe("pier");               // Übergang Steg → Deck
  // Steg ist schmal (kein Holz-Rechteck): genau SHIP_PIER.w Kacheln breit
  for (let y = SHIP.y; y < SHIP.y + SHIP.h; y++) {
    let pierInRow = 0;
    for (let x = SHIP.x; x < SHIP.x + SHIP.w; x++) if (shipTile(x, y) === "pier") pierInRow++;
    expect(pierInRow).toBeLessThanOrEqual(SHIP_PIER.w);
  }
});

test("#108: die Kajüten-Luke ist über den Steg erreichbar (begehbar + an Steg angrenzend)", () => {
  expect(shipTile(SHIP_DOOR.tx, SHIP_DOOR.ty)).not.toBeNull();       // im Schiffsbereich (begehbar)
  const adjacentPier = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(
    ([dx, dy]) => shipTile(SHIP_DOOR.tx + dx, SHIP_DOOR.ty + dy) === "pier",
  );
  expect(adjacentPier, "Luke muss an eine Steg-Kachel grenzen").toBe(true);
});

test("#108: außerhalb von Schiff und Steg greift die normale Welt-Logik (null)", () => {
  expect(shipTile(SHIP.x - 5, SHIP.y)).toBeNull();                   // weit links vom Schiff
  expect(shipTile(SHIP.x + SHIP.w + 2, SHIP.y)).toBeNull();          // rechts vom Schiff
  expect(shipTile(SHIP_PIER.x, SHIP_PIER.y1 + 5)).toBeNull();        // unterhalb von Schiff/Steg
  expect(shipTile(0, 0)).toBeNull();
});

/* ===== Krabbe an Deck + Kollision rund ums Schiff (#205) =====
 * Regression gegen den Bug, dass die GANZE rechteckige SHIP-Grundfläche begehbar war:
 * dadurch lief man auf den Wasserkacheln in den Ecken rund ums Boot, und die Quiz-
 * Krabbe Kralle stand sichtbar IM Wasser rechts neben dem Schiff. Das begehbare Deck
 * muss boot-förmig sein (Ecken solide), und Kralle muss auf einer Deck-Kachel stehen. */

test("#205: die Ecken der SHIP-Grundfläche sind NICHT begehbar (Wasser rund ums Boot)", () => {
  // Das Boot ist kein Rechteck – die vier Ecken der Grundfläche liegen im offenen Wasser.
  expect(shipTile(SHIP.x, SHIP.y)).toBeNull();                       // hinten links
  expect(shipTile(SHIP.x + SHIP.w - 1, SHIP.y)).toBeNull();          // hinten rechts
  expect(shipTile(SHIP.x, SHIP.y + SHIP.h - 1)).toBeNull();          // vorne links
  expect(shipTile(SHIP.x + SHIP.w - 1, SHIP.y + SHIP.h - 1)).toBeNull(); // vorne rechts
});

test("#205: das begehbare Deck ist echte Teilmenge der Grundfläche und liegt darin", () => {
  const deckTiles = SHIP_DECK.flatMap((r) => {
    const xs: { x: number; y: number }[] = [];
    for (let x = r.x0; x <= r.x1; x++) xs.push({ x, y: r.y });
    return xs;
  });
  // Jede Deck-Kachel liegt innerhalb der SHIP-Grundfläche …
  for (const { x, y } of deckTiles) {
    expect(x >= SHIP.x && x < SHIP.x + SHIP.w, `Deck-x ${x} außerhalb`).toBe(true);
    expect(y >= SHIP.y && y < SHIP.y + SHIP.h, `Deck-y ${y} außerhalb`).toBe(true);
  }
  // … aber das Deck ist kleiner als das volle Rechteck (boot-förmig, nicht alles begehbar).
  expect(deckTiles.length).toBeLessThan(SHIP.w * SHIP.h);
  // onShipDeck stimmt mit der shipTile-„water"-Fläche überein (eine Quelle).
  for (const { x, y } of deckTiles) expect(onShipDeck(x, y)).toBe(true);
});

test("#205: Kralle steht an Deck (nicht im Wasser daneben)", () => {
  expect(onShipDeck(SHIP_KRALLE.x, SHIP_KRALLE.y)).toBe(true);
  expect(shipTile(SHIP_KRALLE.x, SHIP_KRALLE.y)).toBe("water");   // begehbares Deck
  expect(SHIP_KRALLE).not.toEqual({ x: SHIP_DOOR.tx, y: SHIP_DOOR.ty }); // nicht auf der Luke
});

test("#205: das Deck ist vom Steg aus erreichbar (eine Deck-Kachel grenzt an den Steg)", () => {
  const deckTiles = SHIP_DECK.flatMap((r) => {
    const xs: { x: number; y: number }[] = [];
    for (let x = r.x0; x <= r.x1; x++) xs.push({ x, y: r.y });
    return xs;
  });
  const touchesPier = deckTiles.some(({ x, y }) =>
    [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => shipTile(x + dx, y + dy) === "pier"),
  );
  expect(touchesPier, "kein Deck-Feld grenzt an den Steg – Deck unerreichbar").toBe(true);
});

/* ===== Datengetriebenes Warp-/Tür-System (#194) ===== */

/** Baut einen Tiled-Objektlayer aus Türen (wie ihn harborWarpLayer() erzeugt):
 *  16×16-Rechteck pro Tür, Kachel als Pixel-Ecke, Warp-Daten als Properties. */
function groupFrom(doors: Door[]): TiledObjectGroup {
  return {
    id: 1, name: "Türen", type: "objectgroup", visible: true, opacity: 1,
    objects: doors.map((d, i) => {
      const properties = [
        { name: "theme", type: "string", value: d.theme },
        { name: "title", type: "string", value: d.title },
        ...(d.npc !== undefined ? [{ name: "npc", type: "string", value: d.npc }] : []),
        ...(d.target !== undefined ? [{ name: "target", type: "string", value: d.target }] : []),
        ...(d.targetX !== undefined ? [{ name: "targetX", type: "int", value: d.targetX }] : []),
        ...(d.targetY !== undefined ? [{ name: "targetY", type: "int", value: d.targetY }] : []),
      ];
      return { id: i + 1, name: d.id, type: "warp", x: d.tx * TILE, y: d.ty * TILE, width: TILE, height: TILE, properties };
    }),
  };
}

test("doorsFromObjectGroup round-trippt die Code-Eingänge verlustfrei", () => {
  expect(doorsFromObjectGroup(groupFrom([...ENTRANCES]))).toEqual([...ENTRANCES]);
});

test("doorsFromObjectGroup rechnet Pixel-Ecke korrekt in Kachel zurück", () => {
  // Red-Green: ohne floor(x/TILE) läge tx bei einem Pixelwert (z.B. 416 statt 26).
  const [d] = doorsFromObjectGroup(groupFrom([{ id: "x", tx: 26, ty: 12, title: "T", theme: "office" }]));
  expect(d.tx).toBe(26);
  expect(d.ty).toBe(12);
});

test("doorsFromObjectGroup liest einen Map-Warp (Zielkarte + Zielkoordinate)", () => {
  const [d] = doorsFromObjectGroup(groupFrom([
    { id: "anleger", tx: 21, ty: 31, title: "Insel", theme: "", target: "archipel", targetX: 14, targetY: 19 },
  ]));
  expect(d.target).toBe("archipel");
  expect(d.targetX).toBe(14);
  expect(d.targetY).toBe(19);
});

test("doorsFromObjectGroup lässt npc/target weg, wenn keine Property gesetzt ist", () => {
  const [d] = doorsFromObjectGroup(groupFrom([{ id: "x", tx: 1, ty: 1, title: "T", theme: "office" }]));
  expect(d.npc).toBeUndefined();
  expect(d.target).toBeUndefined();
});

test("findDoorAt trifft eine Tür aus einer übergebenen Liste und liefert sonst null", () => {
  const doors = doorsFromObjectGroup(groupFrom([...ENTRANCES]));
  for (const d of doors) {
    expect(findDoorAt(doors, d.tx * TILE + 8, d.ty * TILE + 8)?.id).toBe(d.id);
    expect(findDoorAt(doors, (d.tx - 1) * TILE + 8, d.ty * TILE + 8)).toBeNull();
  }
  expect(findDoorAt([], 0, 0)).toBeNull();
});

test("doorAt (Default-Eingänge) bleibt deckungsgleich zu findDoorAt(ENTRANCES)", () => {
  for (const d of [...DOORS, SHIP_DOOR]) {
    expect(doorAt(d.tx * TILE + 8, d.ty * TILE + 8)).toEqual(findDoorAt(ENTRANCES, d.tx * TILE + 8, d.ty * TILE + 8));
  }
});

/* ===== Datengetriebene NPC-Standplätze (#195) ===== */

/** Baut einen Tiled-Objektlayer aus Spawns (wie ihn harborNpcLayer() erzeugt):
 *  16×16-Rechteck pro NPC, (Bruch-)Kachel als Pixel-Ecke, NPC-ID im name. */
function npcGroupFrom(spawns: Spawn[]): TiledObjectGroup {
  return {
    id: 4, name: "NPCs", type: "objectgroup", visible: true, opacity: 1,
    objects: spawns.map((s, i) => ({
      id: i + 1, name: s.id, type: "npc", x: s.x * TILE, y: s.y * TILE, width: TILE, height: TILE,
    })),
  };
}

test("npcsFromObjectGroup round-trippt NPC_SPAWNS verlustfrei (auch Bruch-Koordinaten)", () => {
  expect(npcsFromObjectGroup(npcGroupFrom([...NPC_SPAWNS]))).toEqual([...NPC_SPAWNS]);
});

test("npcsFromObjectGroup rechnet Pixel-Ecke korrekt in (Bruch-)Kachel zurück – NICHT gefloort", () => {
  // Red-Green: würde npcsFromObjectGroup floor(x/TILE) nutzen (wie die Türen), ginge
  // die Bruch-Position y 14.6 verloren (würde zu 14) und der Round-Trip oben kippte.
  const [n] = npcsFromObjectGroup(npcGroupFrom([{ id: "ole", x: 26, y: 14.6 }]));
  expect(n.x).toBe(26);
  expect(n.y).toBe(14.6);
});

test("npcsFromObjectGroup behält Reihenfolge + IDs bei (Kralle-Splice in scenes.ts hängt daran)", () => {
  const npcs = npcsFromObjectGroup(npcGroupFrom([...NPC_SPAWNS]));
  expect(npcs.map((n) => n.id)).toEqual(NPC_SPAWNS.map((s) => s.id));
});

test("npcsFromObjectGroup auf leerem Layer liefert keine Spawns", () => {
  expect(npcsFromObjectGroup(npcGroupFrom([]))).toEqual([]);
});

/* ===== #201: E im Hausinnenraum ist kontextabhängig (reden vs. hinausgehen) =====
 * Die Entscheidung steckt pur in interiorEAction(), damit sie ohne Phaser im
 * Node-Test prüfbar ist. InteriorScene.update() sammelt nur eFlank/onExit/nearNpc.
 * Bewusst inkl. Negativfällen (fern vom NPC, Schwelle, kein Tastendruck). */

test("#201 beim Bewohner + E-Flanke → reden (nicht hinausgehen)", () => {
  // Das ist der eigentliche Bugfix: vorher führte E hier IMMER zum Hinausgehen.
  expect(interiorEAction({ eFlank: true, onExit: false, nearNpc: true })).toBe("talk");
});

test("#201 fern vom Bewohner + E-Flanke → hinausgehen (Negativfall)", () => {
  expect(interiorEAction({ eFlank: true, onExit: false, nearNpc: false })).toBe("exit");
});

test("#201 auf der Tür-Schwelle ohne Tastendruck → hinausgehen (wie bisher)", () => {
  expect(interiorEAction({ eFlank: false, onExit: true, nearNpc: false })).toBe("exit");
});

test("#201 Schwelle zählt fürs Hinausgehen, auch wenn man (theoretisch) nah am NPC wäre", () => {
  // onExit ohne E-Flanke darf nie 'talk' werden – reden braucht die E-Flanke.
  expect(interiorEAction({ eFlank: false, onExit: true, nearNpc: true })).toBe("exit");
});

test("#201 nah am NPC, aber E nur gehalten (keine Flanke) → nichts tun", () => {
  // Ohne frische E-Flanke wird weder geredet noch (außerhalb der Schwelle) gegangen.
  expect(interiorEAction({ eFlank: false, onExit: false, nearNpc: true })).toBe("none");
});

test("#201 weder Tastendruck noch Schwelle noch NPC-Nähe → nichts tun", () => {
  expect(interiorEAction({ eFlank: false, onExit: false, nearNpc: false })).toBe("none");
});

test("#201 reden hat Vorrang vor hinausgehen, wenn beides zuträfe", () => {
  // Falls eFlank+nearNpc+onExit zusammenkämen, gewinnt 'talk' (man will reden).
  expect(interiorEAction({ eFlank: true, onExit: true, nearNpc: true })).toBe("talk");
});

/* ===== #305: E-Flanken-Buchführung im Innenraum (interiorEFlank) =====
 * Regression: Im Haus kam man aus dem NPC-Dialog nicht mehr raus, weil der
 * E-Druck, der den Dialog schloss, im nächsten Frame als frische Flanke ein
 * neues Reden auslöste. interiorEFlank muss E während eines offenen Dialogs als
 * „gedrückt" halten und erst nach echtem Loslassen wieder eine Flanke liefern. */

test("#305 frischer E-Druck (steigende Flanke) → eFlank, ePrev gemerkt", () => {
  expect(interiorEFlank({ ePhys: true, ePrev: false, blocked: false })).toEqual({ eFlank: true, ePrev: true });
});

test("#305 E gehalten (keine steigende Flanke) → keine Flanke (Negativfall)", () => {
  expect(interiorEFlank({ ePhys: true, ePrev: true, blocked: false })).toEqual({ eFlank: false, ePrev: true });
});

test("#305 während offenem Dialog gehört E dem Dialog → keine Flanke, ePrev=true (gilt als gedrückt)", () => {
  // Egal ob E physisch gedrückt ist oder nicht: solange blocked, nie eine Flanke,
  // und ePrev bleibt true, damit der schließende Druck danach nicht zündet.
  expect(interiorEFlank({ ePhys: true, ePrev: false, blocked: true })).toEqual({ eFlank: false, ePrev: true });
  expect(interiorEFlank({ ePhys: false, ePrev: false, blocked: true })).toEqual({ eFlank: false, ePrev: true });
});

test("#305 Regression: der E-Druck, der den Dialog schließt, öffnet ihn NICHT sofort wieder", () => {
  // Frame 1: am NPC, frischer E-Druck → Flanke → reden (Dialog öffnet).
  let s = interiorEFlank({ ePhys: true, ePrev: false, blocked: false });
  expect(s.eFlank).toBe(true);
  // Frame 2..n: Dialog offen, E noch gehalten → blocked, ePrev bleibt true.
  s = interiorEFlank({ ePhys: true, ePrev: s.ePrev, blocked: true });
  expect(s.ePrev).toBe(true);
  // Frame X: Spieler drückt E → main.ts schließt den Dialog. Direkt danach läuft
  // update() wieder unblockiert, E ist (noch) gedrückt. Dank ePrev=true KEINE
  // Flanke → interiorEAction bekommt eFlank=false → kein erneutes Reden.
  s = interiorEFlank({ ePhys: true, ePrev: s.ePrev, blocked: false });
  expect(s.eFlank).toBe(false);
  expect(interiorEAction({ eFlank: s.eFlank, onExit: false, nearNpc: true })).toBe("none");
  // Erst Loslassen + Neudrücken ergibt wieder eine echte Flanke (gewolltes Reden).
  s = interiorEFlank({ ePhys: false, ePrev: s.ePrev, blocked: false }); // loslassen
  expect(s.ePrev).toBe(false);
  s = interiorEFlank({ ePhys: true, ePrev: s.ePrev, blocked: false });  // neu drücken
  expect(s.eFlank).toBe(true);
});
