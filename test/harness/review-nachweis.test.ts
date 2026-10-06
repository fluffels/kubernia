/* Review-Nachweis-Wächter (#1270) – Kopplung Workflow ↔ Prüfskript ↔ CI ↔ Texte.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Das Prüfskript `scripts/check-review-nachweis.mjs` verlangt im PR-Slice die Commit-Zeilen `KQ-Plan:` /
 * `KQ-Review:`. Damit der Nachweis pfadunabhängig bleibt, muss der Workflow-Pfad dieselben Zeilen aus
 * Code-Werten schreiben, und alles, was das Skript an Workflow-Wissen dupliziert (Cap, Lens-Satz je
 * Diff-Art), darf nicht still auseinanderlaufen. Geprüft werden:
 *   (a) die Ausgabe von `nachweisZeilen` (Workflow-Block) wird vom Parser angenommen (Roundtrip),
 *   (b) MAX_REVIEW_RUNDEN im Workflow == MAX_FIX_RUNDEN im Skript,
 *   (c) `pflichtLenses` == `lensPlan` für Runde 1 (Block „Review-Staffel (#1265)“),
 *   (d) der Required-Job build-test ruft das Skript als Schritt nach „Diff-Basis bestimmen“ auf, mit
 *       pull_request-Bedingung und Dependabot-Ausnahme,
 *   (e) review-lenses-Skill und kubernia-umsetzer verweisen auf das Skript.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockFunktion, workflowBlock } from "./workflow-block";

type Nachweis = { plan: { art: string } | null; review: { head: string | null; runden: number; lenses: string[]; verdikt: string | null } | null };
type Mod = {
  MAX_FIX_RUNDEN: number;
  parseNachweis: (t: string) => Nachweis;
  pflichtLenses: (d: unknown) => string[];
  bewerteNachweis: (o: { nachweis: Nachweis; dateien: string[]; headBekannt: boolean; headImSlice: boolean }) => string[];
};
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/check-review-nachweis.mjs";
const { MAX_FIX_RUNDEN, parseNachweis, pflichtLenses, bewerteNachweis } = raw as Mod;

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const SHA = "c".repeat(40);

type Zeilen = (e: { head: string; runden: number; lenses: string[]; plan: unknown }) => string;
const nachweisBlock = workflowBlock("// ── Review-Nachweis (#1270) — Anfang", "// ── Review-Nachweis (#1270) — Ende").block;
const nachweisZeilen = blockFunktion<Zeilen>(nachweisBlock, "nachweisZeilen");

describe("(a) Workflow schreibt, was das Skript liest", () => {
  test("Roundtrip: Planer vorhanden, drei Brillen, zwei Pässe", () => {
    const text = nachweisZeilen({ head: SHA, runden: 2, lenses: ["architektur", "requirement-treue", "test-adaequanz"], plan: "PLAN #1" });
    const n = parseNachweis(text);
    assert.equal(n.plan?.art, "planer");
    assert.equal(n.review?.head, SHA);
    assert.equal(n.review?.runden, 2);
    assert.deepEqual(n.review?.lenses, ["architektur", "requirement-treue", "test-adaequanz"]);
    assert.equal(n.review?.verdikt, "ok");
    assert.deepEqual(bewerteNachweis({ nachweis: n, dateien: ["src/a.ts"], headBekannt: true, headImSlice: true }), []);
  });
  test("Roundtrip: ohne Planer wird mit Begründung geschrieben und akzeptiert", () => {
    const n = parseNachweis(nachweisZeilen({ head: SHA, runden: 1, lenses: ["doku"], plan: null }));
    assert.equal(n.plan?.art, "ohne");
    assert.deepEqual(bewerteNachweis({ nachweis: n, dateien: ["a.md"], headBekannt: true, headImSlice: true }), []);
  });
});

describe("(b) Cap", () => {
  test("MAX_REVIEW_RUNDEN im Workflow == MAX_FIX_RUNDEN im Skript", () => {
    const m = /const MAX_REVIEW_RUNDEN = (\d+)/.exec(read(".claude/workflows/kubernia-ticket.js"));
    assert.ok(m, "MAX_REVIEW_RUNDEN nicht mehr im Workflow gefunden");
    assert.equal(Number(m[1]), MAX_FIX_RUNDEN);
  });
});

describe("(c) Pflicht-Lenses == Runde-1-Plan des Workflows", () => {
  const { block } = workflowBlock("// ── Review-Staffel (#1265) — Anfang", "// ── Review-Staffel (#1265) — Ende");
  const lensPlan = blockFunktion<(e: { dateien?: unknown }) => { keys: string[] }>(block, "lensPlan");
  const faelle: [string, unknown][] = [
    ["nur Markdown", ["AGENTS.md", "docs/a.md"]],
    ["gemischt", ["docs/a.md", "src/x.ts"]],
    ["nur Code", ["src/x.ts"]],
    ["leer", []],
    ["fehlend", undefined],
    ["kaputt", ["a.md", ""]],
  ];
  for (const [name, dateien] of faelle) {
    test(name, () => {
      assert.deepEqual([...pflichtLenses(dateien)], [...lensPlan({ dateien }).keys]);
    });
  }
});

describe("(d) CI-Schritt im Required-Job", () => {
  const ci = read(".github/workflows/ci.yml");
  const start = ci.indexOf("\n  build-test:");
  const jobEnde = ci.indexOf("\n  security-audit:", start);
  const job = ci.slice(start, jobEnde);
  const schritt = job.indexOf("check-review-nachweis.mjs");

  test("build-test ruft das Skript auf, nach der Diff-Basis", () => {
    assert.ok(start !== -1 && jobEnde !== -1, "Job build-test nicht gefunden");
    assert.ok(schritt !== -1, "build-test ruft check-review-nachweis.mjs nicht auf");
    assert.ok(job.indexOf("name: Diff-Basis bestimmen") < schritt, "Schritt muss hinter „Diff-Basis bestimmen“ stehen");
  });
  test("Bedingung: !cancelled(), nur pull_request, Dependabot ausgenommen", () => {
    const vorher = job.lastIndexOf("- name:", schritt);
    const text = job.slice(vorher, schritt);
    assert.match(text, /!cancelled\(\)/);
    assert.match(text, /github\.event_name == 'pull_request'/);
    assert.match(text, /dependabot\[bot\]/);
  });
  test("der Schritt ist der letzte des Jobs", () => {
    const vorher = job.lastIndexOf("- name:", schritt);
    assert.ok(!job.slice(schritt).includes("\n      - name:"), "nach dem Nachweis-Schritt darf kein weiterer Schritt folgen");
    assert.ok(vorher !== -1);
  });
});

describe("(e) Texte verweisen auf das Skript", () => {
  for (const datei of [".claude/skills/review-lenses/SKILL.md", ".claude/agents/kubernia-umsetzer.md", "docs/agent-harness.md"]) {
    test(datei, () => assert.match(read(datei), /check-review-nachweis/));
  }
});
