import { describe, it, expect } from "vitest";
import {
  GLYPHS, GLYPH_W, GLYPH_H, CELL_W, CELL_H, ATLAS_CHARS,
  hasGlyph, glyphMatrix, sanitize, FALLBACK_CHAR,
} from "../src/hud/pixelfont";

describe("pixelfont – Glyphen-Daten", () => {
  it("jede Glyphe ist exakt 7 Zeilen × 5 Spalten (kein vertippter Eintrag)", () => {
    for (const [ch, rows] of Object.entries(GLYPHS)) {
      expect(rows.length, `Höhe von '${ch}'`).toBe(GLYPH_H);
      for (const row of rows) {
        expect(row.length, `Breite einer Zeile von '${ch}'`).toBe(GLYPH_W);
        // nur '#' (an) und '.' (aus) erlaubt – fängt Schmuzeichen/Tippfehler
        expect(/^[#.]+$/.test(row), `Zeichensatz der Zeile von '${ch}': "${row}"`).toBe(true);
      }
    }
  });

  it("deckt alle für In-Welt-Texte nötigen Zeichen ab", () => {
    const needed =
      "abcdefghijklmnopqrstuvwxyz" +
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
      "0123456789" +
      " -/().,:!#&+'·–↓⚠⏸" +
      "ÄÖÜäöüß";
    for (const ch of needed) {
      expect(hasGlyph(ch), `Glyph fehlt für '${ch}'`).toBe(true);
    }
  });

  it("ATLAS_CHARS enthält jedes Zeichen genau einmal (kollidiert sonst im RetroFont-Raster)", () => {
    const seen = new Set<string>();
    for (const ch of ATLAS_CHARS) {
      expect(seen.has(ch), `Doppeltes Zeichen '${ch}' im Atlas`).toBe(false);
      seen.add(ch);
    }
    expect(seen.size).toBe(Object.keys(GLYPHS).length);
  });

  it("Zellmaße = Glyph + 1px Gap (monospaced)", () => {
    expect(CELL_W).toBe(GLYPH_W + 1);
    expect(CELL_H).toBe(GLYPH_H + 1);
  });
});

describe("pixelfont – glyphMatrix", () => {
  it("liefert ein 7×5-bool-Raster passend zur ASCII-Art", () => {
    const m = glyphMatrix("A");
    expect(m.length).toBe(GLYPH_H);
    expect(m[0].length).toBe(GLYPH_W);
    // 'A': Zeile 0 = ".###." → false,true,true,true,false
    expect(m[0]).toEqual([false, true, true, true, false]);
    // Mindestens ein gesetztes Pixel (Red-Green-Absicherung: leeres 'A' wäre ein Bug)
    expect(m.some((row) => row.some(Boolean))).toBe(true);
  });

  it("nutzt für unbekannte Zeichen den Fallback (nicht leer)", () => {
    const unknown = glyphMatrix("☃"); // ☃ – nicht in der Font
    expect(unknown).toEqual(glyphMatrix(FALLBACK_CHAR));
    expect(unknown.some((row) => row.some(Boolean))).toBe(true);
  });

  it("Leerzeichen ist komplett leer", () => {
    expect(glyphMatrix(" ").every((row) => row.every((c) => c === false))).toBe(true);
  });
});

describe("pixelfont – sanitize", () => {
  it("lässt normalen Text unverändert", () => {
    expect(sanitize("Hafenmeisterei")).toBe("Hafenmeisterei");
    expect(sanitize("worker-3")).toBe("worker-3");
    expect(sanitize("api 2/2")).toBe("api 2/2");
  });

  it("entfernt In-Welt-Emojis und dampft entstandene Doppel-Leerzeichen ein", () => {
    expect(sanitize("⚓ GitOps-Archipel")).toBe("GitOps-Archipel");
    expect(sanitize("🚪 Werft")).toBe("Werft");
    expect(sanitize("Zum Steg laufen ⚓ – zurück")).toBe("Zum Steg laufen – zurück");
    expect(sanitize("+12 🪙")).toBe("+12");
  });

  it("behält ⚠ und ↓ (echte Glyphen, kein Emoji-Drop)", () => {
    expect(sanitize("api ⚠ CrashLoopBackOff")).toBe("api ⚠ CrashLoopBackOff");
    expect(sanitize("E – an Deck · ↓ durch die Luke")).toBe("E – an Deck · ↓ durch die Luke");
  });

  it("behält das ⏸ des gestoppten Docker-Fasses (echte Glyphe, kein ?-Fallback, #491)", () => {
    // Ohne eigene Glyphe würde ⏸ zum sichtbaren Fallback → „? web" statt „⏸ web".
    expect(sanitize("⏸ web")).toBe("⏸ web");
    expect(sanitize("⏸ web")).not.toContain(FALLBACK_CHAR);
  });

  it("ersetzt sonstige unbekannte Zeichen durch den sichtbaren Fallback", () => {
    expect(sanitize("a☃b")).toBe("a" + FALLBACK_CHAR + "b");
  });
});
