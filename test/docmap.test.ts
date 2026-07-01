/* Doku↔Code-Drift-Wächter (#482) – hält die CLAUDE.md-Landkarte ehrlich gegenüber dem Code.
 *
 * Die Landkarte ist der Kontext-Selektor für KI-Agenten: sie sagt, welche Datei zu welcher
 * Schicht/Subdomäne gehört, damit ein Agent nur den relevanten Kontext lädt (Token-Effizienz,
 * arc42 §1). Prosa veraltet leise – bisher hielt nur die AGENTS.md-Regel „Doku aktuell halten"
 * die Karte synchron. Dieser Test macht Drift ROT: Geister-Zeilen, verwaiste Module, falsche
 * Schicht. Es ist eine Fitness-Function-Kategorie neben layering/filesize/readme (#390/#77).
 *
 * Die Parse-/Prüf-Logik wird aus scripts/check-docmap.mjs importiert (EINE Quelle der Wahrheit
 * mit der CLI `npm run check:docmap`); die Schicht-Definition aus scripts/layers.cjs (dieselbe,
 * die der dependency-cruiser erzwingt).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:docmap)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Reine Node-Tooling-Skripte ohne Declaration-File (allowJs aus, scripts/ nicht im tsconfig)
// – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocMap from "../scripts/check-docmap.mjs";

const require = createRequire(import.meta.url);
const { layerOf, LABEL_TO_LAYER, LAYERS } = require("../scripts/layers.cjs");

type Entry = { file: string; layer: string; isDir: boolean };
type Mismatch = Entry & { expected: string; actual: string };
type Audit = {
  entries: Entry[];
  modules: string[];
  ghosts: Entry[];
  orphans: string[];
  layerMismatches: Mismatch[];
  unknownLabels: Entry[];
  staleAllowlist: string[];
};

const parseDocMap: (md: string) => Entry[] = checkDocMap.parseDocMap;
const auditDocMap: () => Audit = checkDocMap.auditDocMap;

const audit = auditDocMap();

describe("Doku↔Code-Drift (#482)", () => {
  test("keine Geister-Zeilen: jede Landkarten-Datei/-Verzeichnis existiert", () => {
    assert.deepEqual(
      audit.ghosts.map((g) => g.file),
      [],
      "Diese CLAUDE.md-Landkarten-Einträge zeigen auf nicht existierende Pfade – Zeile entfernen oder Pfad korrigieren.",
    );
  });

  test("keine verwaisten Module: jede src/-*.ts hat eine Landkarten-Zeile", () => {
    assert.deepEqual(
      audit.orphans,
      [],
      "Diese src-Module fehlen in der CLAUDE.md-Landkarte – je eine Zeile (Datei · Schicht · Zweck) ergänzen " +
        "(AGENTS.md-Konvention) oder – mit Begründung – in scripts/check-docmap.mjs › ORPHAN_ALLOWLIST aufnehmen.",
    );
  });

  test("keine unbekannten Schicht-Labels in der Landkarte", () => {
    assert.deepEqual(
      audit.unknownLabels.map((u) => `${u.file}: „${u.layer}"`),
      [],
      "Unbekanntes Schicht-Label – Tippfehler in CLAUDE.md oder neuer Begriff, der in scripts/layers.cjs (LABEL_TO_LAYER) gehört.",
    );
  });

  test("Schicht-Konsistenz: deklarierte Schicht == dependency-cruiser-Zuordnung", () => {
    assert.deepEqual(
      audit.layerMismatches.map((m) => `${m.file}: „${m.layer}" (${m.expected}) ≠ ${m.actual}`),
      [],
      "Die in der Landkarte deklarierte Schicht weicht von der dependency-cruiser-Zuordnung ab – eine der beiden angleichen.",
    );
  });

  test("ORPHAN_ALLOWLIST ist ehrlich: kein stale Eintrag", () => {
    assert.deepEqual(
      audit.staleAllowlist,
      [],
      "Stale ORPHAN_ALLOWLIST-Einträge (Datei weg oder steht inzwischen doch in der Karte) – aus scripts/check-docmap.mjs entfernen.",
    );
  });

  // ── Red-Green: die Mechanik greift wirklich (ein immer-grüner Wächter wäre wertlos) ──

  test("parseDocMap liest die Datei/Schicht-Tabelle und stoppt vor der nächsten Tabelle", () => {
    const md = [
      "## Landkarte",
      "| Datei | Schicht | Zweck |",
      "|---|---|---|",
      "| [`src/sim.ts`](src/sim.ts) | pure Domäne | Kern. |",
      "| [`src/content/data/`](src/content/data/) | Daten | JSON. |",
      "",
      "## Tiefendocs",
      "| Doc | Deckt ab |",
      "|---|---|",
      "| [`docs/module/sim.md`](docs/module/sim.md) | Simulator. |",
    ].join("\n");
    const entries = parseDocMap(md);
    assert.deepEqual(
      entries,
      [
        { file: "src/sim.ts", layer: "pure Domäne", isDir: false },
        { file: "src/content/data", layer: "Daten", isDir: true },
      ],
      "parseDocMap muss genau die zwei Zeilen der ersten Tabelle liefern – nicht die Tiefendoc-Tabelle.",
    );
  });

  test("layerOf klassifiziert repräsentative Pfade wie der dependency-cruiser", () => {
    assert.equal(layerOf("src/sim/state.ts"), LAYERS.DOMAIN);
    assert.equal(layerOf("src/types.ts"), LAYERS.DOMAIN);
    assert.equal(layerOf("src/game/economy.ts"), LAYERS.APPLICATION);
    assert.equal(layerOf("src/store.ts"), LAYERS.APPLICATION);
    assert.equal(layerOf("src/scenes/WorldScene.ts"), LAYERS.PRESENTATION);
    assert.equal(layerOf("src/sfx.ts"), LAYERS.PRESENTATION);
    assert.equal(layerOf("src/main.ts"), LAYERS.ENTRY);
    assert.equal(layerOf("src/assets-data.ts"), LAYERS.ENTRY);
  });

  test("der Schicht-Abgleich würde eine echte Fehl-Deklaration fangen", () => {
    // Wäre die pure-Domäne-Datei fälschlich als „Präsentation" deklariert, MÜSSTE der
    // Vergleich (LABEL_TO_LAYER[label] vs. layerOf(file)) ungleich sein – sonst misst er nichts.
    assert.notEqual(LABEL_TO_LAYER["Präsentation"], layerOf("src/sim/state.ts"));
    assert.equal(LABEL_TO_LAYER["pure Domäne"], layerOf("src/sim/state.ts"));
  });
});
