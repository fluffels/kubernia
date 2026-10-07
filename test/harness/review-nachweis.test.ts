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
import { execFileSync } from "node:child_process";
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

describe("(f) „Cap 2“ heißt immer Fix-Runden (#1309)", () => {
  /** Zeilen, die „Cap 2“ ohne „Fix-Runde“ nennen: ohne die Präzisierung liest man „2 Pässe“. */
  const unpraezise = (text: string) => text.split(/\r?\n/).filter((z) => z.includes("Cap 2") && !z.includes("Fix-Runde"));

  test("jede getrackte Agenten-/Harness-/Doku-Zeile mit „Cap 2“ nennt Fix-Runden", () => {
    const dateien = execFileSync("git", ["ls-files", ".claude", "AGENTS.md", "docs"], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((d) => /\.(md|js)$/.test(d) && !d.startsWith("docs/adr/"));
    assert.ok(dateien.length > 20, "Dateiliste unerwartet klein: git ls-files fehlgeschlagen?");
    const treffer = dateien.flatMap((d) => unpraezise(read(d)).map((z) => `${d}: ${z.trim().slice(0, 80)}`));
    assert.deepEqual(treffer, []);
  });

  test("Erkennung greift (Red-Green)", () => {
    assert.equal(unpraezise("Konvergenzschleife (Cap 2)").length, 1);
    assert.equal(unpraezise("Cap 2 Fix-Runden, höchstens 3 Pässe").length, 0);
  });
});

describe("Nachweis-Hilfen des Workflows (#1309)", () => {
  type Stand = { paesse: number; ersteLenses: string[] | null };
  const hilfen = workflowBlock("// ── Review-Nachweis (#1270) — Anfang", "// ── Review-Nachweis (#1270) — Ende").block;
  const nachweisStand = blockFunktion<(s: Stand, e: { modus: string; berichte: { lens: string }[] }) => Stand>(hilfen, "nachweisStand");
  const nachweisFuerPr = blockFunktion<(e: { konvergiert: boolean; head?: string; stand: Stand; plan: unknown }) => string>(hilfen, "nachweisFuerPr");
  const reviewKonvergiert = blockFunktion<(e: { verifyGruen: boolean; blockierend: unknown[]; fehlend: string[] }) => boolean>(hilfen, "reviewKonvergiert");
  const fehlendeLenses = blockFunktion<(erwartet: string[], berichte: { lens: string }[]) => string[]>(hilfen, "fehlendeLenses");
  const normal = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;
  const DREI3 = ["architektur", "requirement-treue", "test-adaequanz"].map((lens) => ({ lens }));

  test("ein voller Pass merkt die Brillen, ein Delta-Pass ersetzt sie nie, jeder zählt als Pass", () => {
    const nachVoll = nachweisStand({ paesse: 0, ersteLenses: null }, { modus: "voll", berichte: DREI3 });
    assert.deepEqual(normal(nachVoll), { paesse: 1, ersteLenses: DREI3.map((b) => b.lens) });
    const nachDelta = nachweisStand(nachVoll, { modus: "delta", berichte: [{ lens: "architektur" }] });
    assert.deepEqual(normal(nachDelta), { paesse: 2, ersteLenses: DREI3.map((b) => b.lens) });
    const nachWiederholung = nachweisStand(nachDelta, { modus: "voll", berichte: [{ lens: "doku" }] });
    assert.deepEqual(normal(nachWiederholung), { paesse: 3, ersteLenses: ["doku"] }, "ein voller Wiederholungspass ersetzt sie");
  });

  test("nachweisFuerPr: leer ohne Konvergenz, <SHA> ohne Head, sonst parsebar", () => {
    const stand = { paesse: 2, ersteLenses: ["doku"] };
    assert.equal(nachweisFuerPr({ konvergiert: false, head: SHA, stand, plan: "P" }), "");
    assert.match(nachweisFuerPr({ konvergiert: true, stand, plan: "P" }), /head=<SHA> runden=2 lenses=doku/);
    const n = parseNachweis(nachweisFuerPr({ konvergiert: true, head: SHA, stand, plan: "P" }));
    assert.equal(n.review?.head, SHA);
    assert.equal(n.review?.runden, 2);
  });

  test("Konvergenz verlangt grünes verify, keine Blocker UND keine fehlende Brille", () => {
    assert.equal(reviewKonvergiert({ verifyGruen: true, blockierend: [], fehlend: [] }), true);
    assert.equal(reviewKonvergiert({ verifyGruen: false, blockierend: [], fehlend: [] }), false);
    assert.equal(reviewKonvergiert({ verifyGruen: true, blockierend: [{}], fehlend: [] }), false);
    assert.equal(reviewKonvergiert({ verifyGruen: true, blockierend: [], fehlend: ["doku"] }), false);
  });

  type SchrittIn = { verifyGruen: boolean; blockierend: unknown[]; fehlend: string[]; paesse: number; verifyFixe: number; reviewRunden: number; maxVerifyFixe: number; maxReviewRunden: number };
  const reviewSchritt = blockFunktion<(e: SchrittIn) => string>(hilfen, "reviewSchritt");
  const MAX = { maxVerifyFixe: 3, maxReviewRunden: MAX_FIX_RUNDEN };
  const schritt = (e: Partial<SchrittIn>) => reviewSchritt({ verifyGruen: true, blockierend: [], fehlend: [], paesse: 1, verifyFixe: 0, reviewRunden: 0, ...MAX, ...e });

  test("reviewSchritt (#1331): die Schleifenentscheidung als Tabelle, Cap 2 Fix-Runden und 3 verify-Fixes", () => {
    assert.equal(schritt({}), "konvergiert");
    assert.equal(schritt({ blockierend: [{}] }), "nachbessern-review");
    assert.equal(schritt({ blockierend: [{}], reviewRunden: 1 }), "nachbessern-review", "die zweite Fix-Runde ist erlaubt");
    assert.equal(schritt({ blockierend: [{}], reviewRunden: 2 }), "review-handoff", "nach Cap 2 Hand-off, kein dritter Fix");
    assert.equal(schritt({ fehlend: ["doku"] }), "lens-ausfall", "nur ein Lens-Ausfall: keine leere Fix-Runde");
    assert.equal(schritt({ verifyGruen: false, paesse: 0 }), "nachbessern-verify", "rotes verify vor dem ersten Lens-Pass");
    assert.equal(schritt({ verifyGruen: false, paesse: 0, verifyFixe: 2 }), "nachbessern-verify");
    assert.equal(schritt({ verifyGruen: false, paesse: 0, verifyFixe: 3 }), "verify-handoff");
    assert.equal(schritt({ verifyGruen: false, paesse: 0, reviewRunden: 2 }), "nachbessern-verify", "vor dem ersten Pass zählt der Review-Cap nicht");
    assert.equal(schritt({ verifyGruen: false, paesse: 1, reviewRunden: 2 }), "review-handoff", "rotes verify nach einem Pass zählt gegen den Review-Cap");
    assert.equal(schritt({ verifyGruen: false, paesse: 1, blockierend: [{}], reviewRunden: 0 }), "nachbessern-review");
  });

  test("fehlendeLenses nennt nur die ohne Bericht (auch bei null-Einträgen)", () => {
    assert.deepEqual(normal(fehlendeLenses(["a", "b"], [{ lens: "a" }])), ["b"]);
    assert.deepEqual(normal(fehlendeLenses(["a"], [null as unknown as { lens: string }])), ["a"]);
    assert.deepEqual(normal(fehlendeLenses(["a"], [{ lens: "a" }])), []);
  });
});

describe("Tolerantes Lesen der Brillen (#1331)", () => {
  const lenses = (wert: string) => parseNachweis(`KQ-Review: head=${SHA} runden=1 lenses=${wert} verdikt=ok`).review?.lenses;
  const bewerte = (wert: string, dateien = ["src/a.ts"]) =>
    bewerteNachweis({ nachweis: parseNachweis(`KQ-Plan: kubernia-planner
KQ-Review: head=${SHA} runden=1 lenses=${wert} verdikt=ok`), dateien, headBekannt: true, headImSlice: true });

  test("Großschreibung, Leerzeichen nach Kommas und Umlaute werden normalisiert", () => {
    assert.deepEqual(lenses("Architektur, Requirement-Treue, Test-Adäquanz"), ["architektur", "requirement-treue", "test-adaequanz"]);
    assert.deepEqual(bewerte("Architektur, Requirement-Treue, Test-Adäquanz"), []);
    assert.deepEqual(lenses("Requirement Treue"), ["requirement-treue"]);
  });

  test("die Felder dahinter werden nicht in die Brillen gezogen", () => {
    const n = parseNachweis(`KQ-Review: lenses=architektur, doku verdikt=ok head=${SHA} runden=2`);
    assert.deepEqual(n.review?.lenses, ["architektur", "doku"]);
    assert.equal(n.review?.verdikt, "ok");
    assert.equal(n.review?.runden, 2);
  });

  test("rot: eine Brille fehlt trotz Normalisierung, Fehlermeldung nennt den Erwartungswert", () => {
    const f = bewerte("Architektur, Requirement-Treue").join(' ');
    assert.match(f, /lenses fehlt test-adaequanz/);
    assert.match(f, /Erwartet: lenses=architektur,requirement-treue,test-adaequanz/);
    assert.match(bewerte("architektur", ["a.md"]).join(' '), /Erwartet: lenses=doku/);
  });

  test("rot: unbekannter Brillenname, auch neben vollem Satz", () => {
    assert.match(bewerte("architektur,requirement-treue,test-adaequanz,foo").join(' '), /unbekannte Brille\(n\) foo/);
  });

  test("die letzte KQ-Review-Zeile gewinnt (Korrektur per weiterem Nachweis-Commit)", () => {
    const text = `KQ-Review: head=${SHA} runden=1 lenses=Falsch verdikt=ok

KQ-Review: head=${SHA} runden=1 lenses=doku verdikt=ok`;
    assert.deepEqual(parseNachweis(text).review?.lenses, ["doku"]);
  });
});
