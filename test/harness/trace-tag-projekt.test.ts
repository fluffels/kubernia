/* Trace-Tag des Projekts (#1906): die projekteigenen Werte der Langfuse-Erfassung.
 *
 * @harness-waechter – Projekt-Test (bleibt im Projekt, zieht nicht ins Factory-Repo): er liest echte Projektdateien
 * (`.claude/settings.json`, `docs/model-routing.md`, `docs/harness-glossar.md`) und den Trace-Tag aus der echten Projekt-Config
 * (Repo-Name). Die projektneutralen Prüfungen derselben Regeln stehen in `langfuse-erfassung.test.ts`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { projektConfig, repoName } from "../support/fremd-config";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");
/** Der Trace-Tag der echten Projektdateien: der Repo-Name der Config (die Probe mit Fremd-Config ändert ihn nicht, siehe `projektConfig()`). */
const TAG = repoName(projektConfig());

/** Der Abschnitt ab der Überschrift `kopf` bis zur nächsten Überschrift gleicher oder höherer Ebene. */
const abschnitt = (md: string, kopf: RegExp): string => {
  const zeilen = md.split("\n");
  const start = zeilen.findIndex((z) => kopf.test(z));
  if (start < 0) return "";
  const ebene = /^#+/.exec(zeilen[start])?.[0].length ?? 1;
  const rest = zeilen.slice(start + 1).findIndex((z) => {
    const m = /^(#+)\s/.exec(z);
    return m !== null && m[1].length <= ebene;
  });
  return zeilen.slice(start, rest < 0 ? zeilen.length : start + 1 + rest).join("\n");
};

/** Der Beleg-Ablauf in model-routing.md nennt den Trace-Tag. */
const belegAblaufNenntTag = (modelRouting: string): boolean => abschnitt(modelRouting, /^### Langfuse-Erfassung belegen \(#1293\)/).includes(TAG);

/** `.claude/settings.json` trägt den Trace-Tag in `CC_LANGFUSE_TRACE_TAGS` (kommagetrennt). */
const settingsTraegtTag = (settingsJson: string): boolean => {
  const s = JSON.parse(settingsJson) as { env?: Record<string, string> };
  return (s.env?.CC_LANGFUSE_TRACE_TAGS ?? "").split(",").map((t) => t.trim()).includes(TAG);
};

/** Die Glossar-Zeile des Trace-Tags verlinkt auf die Zuordnungs-Tabelle und trägt weder Schnitt-Datum noch „Brain-Arbeit“. */
const glossarZeileVerlinkt = (glossar: string): boolean => {
  const zeile = glossar.split("\n").find((z) => z.startsWith("| Trace-Tag `" + TAG + "`")) ?? "";
  return zeile.includes("(model-routing.md#zuordnung-in-langfuse-1266)") && !/2026-10-05|Brain-Arbeit/.test(zeile);
};

describe("Trace-Tag des Projekts (#1906)", () => {
  test("model-routing.md: der Beleg-Ablauf nennt den Trace-Tag", () => {
    const mr = read("docs/model-routing.md");
    assert.ok(belegAblaufNenntTag(mr));
    assert.ok(!belegAblaufNenntTag(mr.replaceAll(TAG, "anderes-projekt")));
    assert.ok(!belegAblaufNenntTag("### Langfuse-Erfassung belegen (#1293)\n\nnur Text"));
    assert.ok(!belegAblaufNenntTag(""));
  });

  test("settings.json: CC_LANGFUSE_TRACE_TAGS enthält den Trace-Tag", () => {
    assert.ok(settingsTraegtTag(read(".claude/settings.json")));
    assert.ok(settingsTraegtTag(JSON.stringify({ env: { CC_LANGFUSE_TRACE_TAGS: `x, ${TAG}` } })));
    assert.ok(!settingsTraegtTag(JSON.stringify({ env: { CC_LANGFUSE_TRACE_TAGS: "x" } })));
    assert.ok(!settingsTraegtTag(JSON.stringify({ env: { CC_LANGFUSE_TRACE_TAGS: `${TAG}-zusatz` } })));
    assert.ok(!settingsTraegtTag(JSON.stringify({})));
  });

  test("Glossar: die Trace-Tag-Zeile verlinkt statt Text zu doppeln", () => {
    const gl = read("docs/harness-glossar.md");
    assert.ok(glossarZeileVerlinkt(gl));
    assert.equal(glossarZeileVerlinkt(gl.replace("(model-routing.md#zuordnung-in-langfuse-1266)", "(model-routing.md)")), false);
    assert.equal(glossarZeileVerlinkt(gl.replace("Projektfilter der Langfuse-Auswertung.", "Projektfilter, ab 2026-10-05.")), false);
    assert.equal(glossarZeileVerlinkt(gl.replace(`| Trace-Tag \`${TAG}\``, "| Trace-Tag `anderes-projekt`")), false);
  });
});
