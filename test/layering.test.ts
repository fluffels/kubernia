/* Architektur-/Schichtungs-Tests (#344).
 * Die Anwendungs-Schicht (game.ts) darf die Präsentations-Schicht (sfx.ts) NICHT
 * importieren. Audio-Settings laufen entkoppelt über den Laufzeit-Sink in runtime.ts.
 *
 * Dieser Guard wäre VOR dem Fix rot gewesen (game.ts hatte `import { SFX } from "./sfx"`)
 * und ist jetzt grün – ein dependency-cruiser-CI-Wächter kommt separat (#347).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AudioConfig } from "../src/types";
import { setAudioSink, applyAudioConfig } from "../src/runtime";

const gameSrc = readFileSync(fileURLToPath(new URL("../src/game.ts", import.meta.url)), "utf8");

test("game.ts (Anwendung) importiert sfx.ts (Präsentation) NICHT", () => {
  assert.ok(!/from\s+["']\.\/sfx["']/.test(gameSrc), "game.ts darf sfx nicht importieren (Schichtverletzung #344)");
  assert.ok(!/\bSFX\./.test(gameSrc), "game.ts darf das SFX-Objekt nicht direkt benutzen");
});

const cfg: AudioConfig = { music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, track: "hafen" };

test("applyAudioConfig leitet an den registrierten Sink (Präsentation registriert, Anwendung ruft)", () => {
  const seen: AudioConfig[] = [];
  setAudioSink((c) => seen.push(c));
  applyAudioConfig(cfg);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], cfg);
});

test("applyAudioConfig ist ohne registrierten Sink ein No-op (kein Wurf)", () => {
  setAudioSink(null);
  assert.doesNotThrow(() => applyAudioConfig(cfg));
});

// ── Verbotsregeln aus dem Schicht-Modell (#1368) ─────────────────────────────────────────────
// `.dependency-cruiser.cjs` leitet die Schichtregeln aus SCHICHT_MODELL ab. Hier wird die Ableitung
// gegen eine von Hand geschriebene Soll-Matrix gehalten (verletzt ⇔ Richtung nicht erlaubt).
import { createRequire } from "node:module";

type Cond = { path?: string; pathNot?: string };
type Regel = { name: string; from: Cond; to: Cond };
type Modell = { schichten: { id: string; label: string; muster: string | null; wurzeln: string[]; darf: string[] }[]; extern: { id: string; label: string; muster: string }[] };
const req = createRequire(import.meta.url);
const layers = req("../scripts/layers.cjs") as { SCHICHT_MODELL: Modell; verbotsRegeln: (m: Modell) => Regel[] };
const cruiserConfig = req("../.dependency-cruiser.cjs") as { forbidden: { name: string }[] };

const trifft = (c: Cond, pfad: string) => (!c.path || new RegExp(c.path).test(pfad)) && !(c.pathNot && new RegExp(c.pathNot).test(pfad));
const verletzt = (regeln: Regel[], von: string, nach: string) => regeln.some((r) => trifft(r.from, von) && trifft(r.to, nach));

const BEISPIEL: Record<string, string> = {
  einstieg: "src/main.ts",
  praesentation: "src/scenes/worldscene/x.ts",
  anwendung: "src/game/economy.ts",
  domaene: "src/sim/docker.ts",
  phaser: "node_modules/phaser/dist/phaser.js",
};
// Erlaubt (Soll von Hand): alles andere ist verboten. Imports innerhalb einer Schicht sind immer erlaubt.
const ERLAUBT: Record<string, string[]> = {
  einstieg: ["praesentation", "anwendung", "domaene", "phaser"],
  praesentation: ["einstieg", "anwendung", "domaene", "phaser"],
  anwendung: ["domaene"],
  domaene: [],
};

test("Regel-Matrix des echten Modells: verletzt genau dann, wenn die Richtung nicht erlaubt ist", () => {
  const regeln = layers.verbotsRegeln(layers.SCHICHT_MODELL);
  assert.equal(regeln.length, 7);
  for (const von of Object.keys(ERLAUBT)) {
    for (const nach of Object.keys(BEISPIEL)) {
      const soll = von !== nach && !ERLAUBT[von].includes(nach);
      assert.equal(verletzt(regeln, BEISPIEL[von], BEISPIEL[nach]), soll, `${von} → ${nach}`);
    }
  }
});

test("Fixture-Modell: eine neue Schicht bekommt ihre Regeln, eine gestrichene Richtung erzeugt eine Regel", () => {
  const m: Modell = {
    schichten: [
      { id: "oben", label: "Oben", muster: "^src/oben/", wurzeln: ["oben"], darf: ["mitte", "unten"] },
      { id: "mitte", label: "Mitte", muster: "^src/mitte/", wurzeln: ["mitte"], darf: ["unten"] },
      { id: "unten", label: "Unten", muster: null, wurzeln: [], darf: [] },
    ],
    extern: [],
  };
  assert.deepEqual(layers.verbotsRegeln(m).map((r) => r.name).sort(), ["schicht-mitte-nicht-oben", "schicht-unten-nicht-mitte", "schicht-unten-nicht-oben"]);
  m.schichten[0].darf = ["mitte"];
  const regeln = layers.verbotsRegeln(m);
  assert.ok(verletzt(regeln, "src/oben/a.ts", "src/x/b.ts"), "gestrichene Richtung oben → unten ist jetzt verboten");
  assert.ok(!verletzt(regeln, "src/oben/a.ts", "src/mitte/b.ts"));
});

test("Eine .d.ts-Quelle löst nie eine Schichtregel aus", () => {
  const regeln = layers.verbotsRegeln(layers.SCHICHT_MODELL);
  assert.ok(!verletzt(regeln, "src/vite-env.d.ts", BEISPIEL.anwendung));
  assert.ok(!verletzt(regeln, "src/game/typen.d.ts", BEISPIEL.praesentation));
});

test(".dependency-cruiser.cjs enthält genau die abgeleiteten Schichtregeln plus Zyklen und Waisen", () => {
  const namen = cruiserConfig.forbidden.map((r) => r.name);
  const abgeleitet = layers.verbotsRegeln(layers.SCHICHT_MODELL).map((r) => r.name);
  assert.deepEqual(namen, [...abgeleitet, "keine-zyklen", "keine-verwaisten-module"]);
  assert.deepEqual(cruiserConfig.forbidden.slice(0, abgeleitet.length), layers.verbotsRegeln(layers.SCHICHT_MODELL));
});
