/* Generator `save-versionen` (#1370): Save-Versionskette aus Migrations-Beschreibungen + CURRENT_SAVE_VERSION.
 * Läuft gegen ein Fixture-Root; jeder Rot-Fall ist ein eigener Test, dazu der Bindungstest gegen die echte
 * Migrations-Registry (`migrationsSchritte`) und der Echt-Repo-Lauf. */
import { beforeAll, describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture } from "./support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sv from "../scripts/docs-gen/save-versionen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gen from "../scripts/docs-gen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as reg from "../scripts/docs-gen/registry.mjs";

type Cfg = Record<string, unknown>;
type Ctx = { rootDir: string; config: Cfg };
const generator = (sv as unknown as { saveVersionenGenerator: (c: Ctx) => string }).saveVersionenGenerator;
const loadConfig = (gen as unknown as { loadConfig: (root: string) => Cfg }).loadConfig;
const GENERATORS = (reg as unknown as { GENERATORS: Record<string, unknown> }).GENERATORS;

const config: Cfg = {
  saveVersionen: { beschreibungen: "s/save-versionen.json", version: { datei: "s/versioning.ts", name: "CURRENT_SAVE_VERSION" } },
};
type Schritt = { von: number; ticket: number | null; art: string; beschreibung: string };
const schritt = (von: number, extra: Partial<Schritt> = {}): Schritt => ({ von, ticket: 100 + von, art: "additiv", beschreibung: `Schritt ${von}`, ...extra });
const basis = (schritte: unknown, current = 3): Record<string, string> => ({
  "s/versioning.ts": `export const CURRENT_SAVE_VERSION = ${current};\n`,
  "s/save-versionen.json": JSON.stringify(schritte),
});
const lauf = (files: Record<string, string>) => generator({ rootDir: fixture(files), config });
const rot = (files: Record<string, string>, muster: RegExp) => assert.throws(() => lauf(files), muster);

describe("save-versionen: Ausgabe", () => {
  test("Kette v0 … vN mit Knoten, Kanten (additiv dünn, strukturell dick) und Tabelle", () => {
    const out = lauf(basis([schritt(0, { ticket: null }), schritt(1), schritt(2, { art: "strukturell" })]));
    assert.match(out, /flowchart TB/);
    assert.match(out, /v3\[\["v3 · aktuell"\]\]/);
    assert.match(out, /v0 --> v1\n/, "ohne Ticket kein Label");
    assert.match(out, /v1 -->\|"#35;101"\| v2/);
    assert.match(out, /v2 ==>\|"#35;102"\| v3/);
    assert.match(out, /\| 0 → 1 \| – \| additiv \| Schritt 0 \|/);
    assert.match(out, /\| 2 → 3 \| #102 \| strukturell \| Schritt 2 \|/);
  });
  test("deterministisch: zwei Läufe und umsortiertes Array liefern dasselbe", () => {
    const a = [schritt(0), schritt(1), schritt(2)];
    const o1 = lauf(basis(a));
    assert.equal(lauf(basis(a)), o1);
    assert.equal(lauf(basis([a[2], a[0], a[1]])), o1);
  });
  test("neuer Schritt erscheint, wenn CURRENT steigt", () => {
    const a = [schritt(0), schritt(1), schritt(2)];
    const o = lauf(basis([...a, schritt(3, { beschreibung: "Neu hier" })], 4));
    assert.match(o, /Neu hier/);
    assert.match(o, /v4\[\["v4 · aktuell"\]\]/);
  });
});

describe("save-versionen: rot", () => {
  const drei = [schritt(0), schritt(1), schritt(2)];
  test("Migration ohne Beschreibung nennt Schritt, Datei und Fix", () => {
    rot(basis([drei[0], drei[2]]), /Migration 1 → 2 hat keine Beschreibung in s\/save-versionen\.json.*docs:gen/);
  });
  test("Beschreibung zu einem Schritt, den es nicht gibt (stale)", () => {
    rot(basis([...drei, schritt(3)]), /Schritt 3 → 4 gehört nicht zur Kette/);
  });
  test("doppelter Schritt", () => {
    rot(basis([...drei, schritt(1)]), /Schritt 1 → 2 steht doppelt/);
  });
  test("von nicht ganzzahlig oder negativ", () => {
    rot(basis([...drei, schritt(1.5)]), /von muss eine Ganzzahl/);
    rot(basis([schritt(-1), ...drei]), /von muss eine Ganzzahl/);
  });
  test("unbekannte art", () => {
    rot(basis([drei[0], drei[1], schritt(2, { art: "wild" })]), /art muss additiv oder strukturell sein/);
  });
  test("leere oder zu lange Beschreibung", () => {
    rot(basis([drei[0], drei[1], schritt(2, { beschreibung: "  " })]), /beschreibung fehlt/);
    rot(basis([drei[0], drei[1], schritt(2, { beschreibung: "x".repeat(101) })]), /mehr als 100 Zeichen/);
  });
  test("ticket kein positiver Ganzzahlwert (null ist erlaubt)", () => {
    rot(basis([drei[0], drei[1], schritt(2, { ticket: 0 })]), /ticket muss eine positive Ganzzahl/);
    rot(basis([drei[0], drei[1], schritt(2, { ticket: "1" as unknown as number })]), /ticket muss eine positive Ganzzahl/);
    assert.doesNotThrow(() => lauf(basis([schritt(0, { ticket: null }), drei[1], drei[2]])));
  });
  test("kaputtes JSON, kein Array, fehlende Dateien und Config", () => {
    rot({ ...basis([]), "s/save-versionen.json": "{" }, /kein gültiges JSON/);
    rot({ ...basis([]), "s/save-versionen.json": "{}" }, /muss ein Array sein/);
    rot({ "s/versioning.ts": "export const CURRENT_SAVE_VERSION = 1;\n" }, /nicht gefunden/);
    rot({ "s/save-versionen.json": "[]" }, /nicht gefunden/);
    assert.throws(() => generator({ rootDir: fixture({}), config: {} }), /config\.saveVersionen\.beschreibungen fehlt/);
  });
  test("CURRENT ist kein Ganzzahl-Literal", () => {
    rot({ ...basis(drei), "s/versioning.ts": "export const CURRENT_SAVE_VERSION = 1 + 2;\n" }, /kein Ganzzahl-Literal/);
  });
});

describe("save-versionen: Bindung an die echte Migrations-Registry", () => {
  let migrationsSchritte: () => { von: number; additiv: boolean }[];
  let current: number;
  beforeAll(async () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
    const v = await import("../src/store/versioning");
    migrationsSchritte = v.migrationsSchritte;
    current = v.CURRENT_SAVE_VERSION;
  });
  const echt = (): Schritt[] => JSON.parse(readFileSync("src/store/save-versionen.json", "utf8")) as Schritt[];

  test("JSON-Schritte gleichen den Migrationen bei Nummer und Art", () => {
    const m = migrationsSchritte();
    const j = [...echt()].sort((a, b) => a.von - b.von);
    assert.equal(m.length, current, "je Version genau eine Migration");
    assert.deepEqual(
      j.map((s) => ({ von: s.von, additiv: s.art === "additiv" })),
      m,
    );
  });
  test("Red-Green: eine falsch gelabelte Art würde die Bindung brechen", () => {
    const j = echt().map((s) => (s.von === 6 ? { ...s, art: "additiv" } : s));
    const m = migrationsSchritte();
    assert.notDeepEqual(
      j.map((s) => ({ von: s.von, additiv: s.art === "additiv" })),
      m,
    );
  });
  test("der echte Generator läuft auf dem Repo und nennt die aktuelle Version", () => {
    const config = loadConfig(process.cwd());
    const out = (GENERATORS["save-versionen"] as (c: Ctx) => string)({ rootDir: process.cwd(), config });
    assert.match(out, new RegExp(`v${current}\\[\\["v${current} · aktuell"\\]\\]`));
  });
});
