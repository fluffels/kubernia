/* Emoji-Ratchet (#1311, Kind von #1222): Emojis als Icon brechen die Pixelart-Optik
 * (docs/art-direction.md). Die Zahl je Datei darf nur sinken.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Gezählt wird `\p{Extended_Pictographic}` je versionierter Datei unter src/ui, src/scenes,
 * src/main.ts und src/content/data (ohne quests/** und smalltalk.json: Dialog-Prosa ist Sprache,
 * kein Icon). Die Baseline `emoji-baseline.json` hält den Stand je Datei. Rot bei:
 *   - Datei über ihrer Baseline oder neue Datei mit Emojis,
 *   - veraltetem Eintrag (Ist unter Baseline: Baseline senken, damit sie nie wieder wächst),
 *   - Eintrag für eine Datei, die es nicht (mehr) gibt.
 * Die Baseline senkt der PR, der die Emojis entfernt; anheben ist verboten (AGENTS.md „Kein Grün-durch-Aufweichen“). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const listTrackedFiles: (rootDir?: string) => string[] = checkBasis.listTrackedFiles;

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = "test/harness/emoji-baseline.json";

/**
 * Im Scope: Präsentationscode (src/ui, src/scenes, src/main.ts) und die Icon-Daten unter src/content/data. Ausgenommen sind
 * benannte Prosa-Daten: Quests, Quiz (`crabquiz/`), Funk-Erklärungen (`funk-explain/`) und die Dialogdateien (`smalltalk*`,
 * `npcs*`, auch pro Region/NPC aufgeteilt als Ordner oder `smalltalk-<x>.json`): Sprache, kein Icon (docs/art-direction.md).
 * Alles andere unter data (Shop, Ränge, Karten, Manifeste, Terraform-Beispiele, Minispiel-Daten) ist im Scope, damit
 * Icon-Emojis dort nicht unbemerkt neu entstehen; ein neuer Prosa-Ordner wird hier bewusst benannt.
 */
const PROSA_DATEN = /^src\/content\/data\/(quests|crabquiz|funk-explain)\/|^src\/content\/data\/(smalltalk|npcs)[^/]*(\/|\.json$)/;
const IM_SCOPE = (f: string): boolean => {
  if (f === "src/main.ts") return true;
  if (/^src\/(ui|scenes)\/.+\.ts$/.test(f)) return true;
  return /^src\/content\/data\/.+\.json$/.test(f) && !PROSA_DATEN.test(f);
};

function zaehle(text: string): number {
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

/** Pure Vergleichsfunktion: Meldungen (leer = grün). */
function vergleiche(ist: Record<string, number>, baseline: Record<string, number>): string[] {
  const out: string[] = [];
  for (const [f, n] of Object.entries(ist)) {
    const b = baseline[f];
    if (b === undefined) out.push(`${f}: ${n} Emoji(s), nicht in der Baseline (neue Emojis als Icon sind verboten)`);
    else if (n > b) out.push(`${f}: ${n} Emoji(s) über Baseline ${b}`);
    else if (n < b) out.push(`${f}: nur noch ${n}, Baseline auf ${n} senken (steht ${b})`);
  }
  for (const f of Object.keys(baseline)) if (!(f in ist)) out.push(`${f}: Baseline-Eintrag ohne Emojis oder ohne Datei, Eintrag entfernen`);
  return out;
}

describe("Emoji-Ratchet (#1311)", () => {
  test("jede Datei im Scope hält ihre Baseline, nur sinkend", () => {
    const ist: Record<string, number> = {};
    for (const f of listTrackedFiles(WURZEL).filter(IM_SCOPE)) {
      if (!existsSync(WURZEL + f)) continue; // gelöscht, aber noch im Index
      const n = zaehle(readFileSync(WURZEL + f, "utf8"));
      if (n > 0) ist[f] = n;
    }
    const baseline = JSON.parse(readFileSync(WURZEL + BASELINE, "utf8")) as Record<string, number>;
    assert.ok(Object.keys(baseline).length > 10, "Baseline ist leer – Datei kaputt?");
    assert.deepEqual(vergleiche(ist, baseline), []);
  });

  test("Red-Green: Wachstum, neue Datei, veralteter und verwaister Eintrag werden gemeldet", () => {
    assert.deepEqual(vergleiche({ "a.ts": 2 }, { "a.ts": 2 }), []);
    assert.match(vergleiche({ "a.ts": 3 }, { "a.ts": 2 })[0], /über Baseline 2/);
    assert.match(vergleiche({ "b.ts": 1 }, {})[0], /nicht in der Baseline/);
    assert.match(vergleiche({ "a.ts": 1 }, { "a.ts": 2 })[0], /Baseline auf 1 senken/);
    assert.match(vergleiche({}, { "a.ts": 2 })[0], /Eintrag entfernen/);
  });

  test("Zählung: Piktogramme ja, Umlaute und Ziffern nein; Scope-Ausnahmen", () => {
    assert.equal(zaehle("⚓ Hafen 🚢 äöü 123"), 2);
    assert.equal(zaehle("kein Icon, nur Prosa äöüß 42"), 0);
    assert.equal(IM_SCOPE("src/content/data/quests/x.json"), false);
    assert.equal(IM_SCOPE("src/content/data/smalltalk.json"), false);
    assert.equal(IM_SCOPE("src/content/data/smalltalk/hafen.json"), false, "pro Region aufgeteilte Dialoge bleiben draußen");
    assert.equal(IM_SCOPE("src/content/data/smalltalk-hafen.json"), false);
    assert.equal(IM_SCOPE("src/content/data/npcs/ole.json"), false);
    assert.equal(IM_SCOPE("src/content/data/crabquiz/kubernetes.json"), false, "Quiz-Prosa im Unterordner");
    assert.equal(IM_SCOPE("src/content/data/funk-explain/x.json"), false);
    assert.equal(IM_SCOPE("src/content/data/shop.json"), true, "Icon-Daten direkt unter data");
    assert.equal(IM_SCOPE("src/content/data/cmdcards/docker.json"), true, "Minispiel-Daten im Unterordner sind im Scope");
    assert.equal(IM_SCOPE("src/content/data/manifests/x.json"), true);
    assert.equal(IM_SCOPE("src/content/data/terraform/x.json"), true);
    assert.equal(IM_SCOPE("src/content/data/readme.md"), false, "nur .json");
    assert.equal(IM_SCOPE("src/ui/shop.ts"), true);
    assert.equal(IM_SCOPE("src/main.ts"), true);
    assert.equal(IM_SCOPE("src/core/x.ts"), false);
  });
});
