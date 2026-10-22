/* Review-Staffel-Wächter (#1265) – welche Lenses eine Review-Runde startet.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Der Review war nach #1065 der größte Kostenblock je Ticket (38–40 %), und zwar unabhängig von der
 * Diffgröße: jede Lens zahlt einen festen Sockel. Gespart wird darum an der ZAHL der Lenses, nicht am
 * Lesen. Die Regel (Entscheidung zu #1265, docs/model-routing.md § Review-Staffel):
 *
 *   1. Runde 1: ein reiner Markdown-Diff bekommt EINE Doku-Lens, jeder andere Diff alle drei Brillen.
 *   2. Ab Runde 2: nur die Brillen, die in der Vorrunde blockiert haben, auf dem Delta-Patch des Fixes;
 *      enthält das Delta Nicht-Markdown, läuft Test-Adäquanz immer mit.
 *   3. Fail-closed: fehlt eine Angabe (Dateiliste, Delta, ein Vorrunden-Bericht), läuft der volle Satz
 *      auf dem vollen Patch. Ein fehlendes Datum darf nie WENIGER Review bedeuten.
 *
 * Der Skill `review-lenses` ist der einzige Träger der Regel (kein Code); geprüft wird, dass er sie vollständig
 * nennt, mit rotem Gegenbeispiel je Prädikat.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Der Skill trägt die Staffel (#1265) ────────────────────────────────────────
// Der Skill hat keinen Code, nur die Regel. Fällt sie dort weg, spawnt er wieder immer drei Lenses.

const lies = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const SKILL = ".agents/skills/review-lenses/SKILL.md";

/** Nennt ein Regeltext die Staffel vollständig? EIN Prädikat für Artefakt und Gegenbeispiel. */
const nenntStaffel = (s: string) =>
  /`\*\.md`/.test(s) && /Doku/.test(s) && /Delta/.test(s) && /Test-Adäquanz immer mit/.test(s) && /[Ff]ail-closed/.test(s);
/** Verlangt ein Text, den Patch nur einmal vollständig zu lesen? */
const liestPatchEinmal = (s: string) => /einmal\s+vollständig/i.test(s) && /kein(?:en)?\s+zweites\s+Volllesen/i.test(s);
/** Nennt der Text den Abschnitts-Helfer (#1379), statt nur „sehr große Patches abschnittsweise“ zu verlangen? */
const nenntAbschnittsHelfer = (s: string) => /patch-abschnitte\.mjs/.test(s);

describe("Der Skill regelt die Staffel (#1265)", () => {
  test("review-lenses nennt Doku-Kriterium, Delta ab Runde 2, Test-Adäquanz-Pflicht und fail-closed", () => {
    assert.ok(nenntStaffel(lies(SKILL)), "review-lenses/SKILL.md beschreibt die Review-Staffel nicht (mehr) vollständig");
  });

  test("der Skill-Spawn trägt den Runden-Marker R<runde>, den die Messung zählt", () => {
    assert.match(lies(SKILL), /description: "Lens <[^>]*Doku> R<runde>"/);
  });

  test("Patch einmal lesen: im Skill und im Lens-Agenten", () => {
    assert.ok(liestPatchEinmal(lies(SKILL)), "review-lenses/SKILL.md");
    assert.ok(liestPatchEinmal(lies(".claude/agents/factory-lens.md")), "factory-lens.md");
    assert.ok(nenntAbschnittsHelfer(lies(SKILL)), "review-lenses/SKILL.md nennt patch-abschnitte.mjs nicht");
    assert.ok(nenntAbschnittsHelfer(lies(".claude/agents/factory-lens.md")), "factory-lens.md nennt patch-abschnitte.mjs nicht");
  });
  test("Prädikate greifen (Red-Green)", () => {
    assert.ok(nenntStaffel("nur `*.md` → Doku; ab Runde 2 Delta; Test-Adäquanz immer mit; fail-closed"));
    assert.ok(!nenntStaffel("nur `*.md` → Doku; ab Runde 2 Delta; fail-closed"), "ohne Test-Adäquanz-Pflicht unvollständig");
    assert.ok(!nenntStaffel("immer drei Lenses"));
    assert.ok(liestPatchEinmal("genau einmal vollständig lesen, danach gezielt, kein zweites Volllesen"));
    assert.ok(!liestPatchEinmal("Der Patch ist die Primärquelle."));
    assert.ok(nenntAbschnittsHelfer("node x/scripts/patch-abschnitte.mjs <patch>"));
    assert.ok(!nenntAbschnittsHelfer("sehr große Patches abschnittsweise, jede Zeile einmal"));
  });
});

// ── Merge von main in den Branch (#1311) ───────────────────────────────────────

describe("Merge von main ist kein Fix-Pass (#1311)", () => {
  const SKILL_MD = lies(".agents/skills/review-lenses/SKILL.md");
  const HARNESS_MD = lies("docs/agent-harness.md");
  const nenntMergeRegel = (s: string) => /Merge von `main`[^\n]*kein Fix-Pass/.test(s) && /git show --remerge-diff/.test(s);

  test("Skill und agent-harness §3a tragen dieselbe Regel; die alte Fail-closed-Klausel ist weg", () => {
    assert.ok(nenntMergeRegel(SKILL_MD), "review-lenses/SKILL.md");
    assert.ok(nenntMergeRegel(HARNESS_MD), "docs/agent-harness.md");
    assert.doesNotMatch(SKILL_MD, /wurde `main` in den Branch gemergt bzw\. rebased/);
  });

  test("Prädikat greift (Red-Green)", () => {
    assert.ok(!nenntMergeRegel("Ein Merge von `main` ist ein voller Pass."));
    assert.ok(!nenntMergeRegel("Merge von `main` ist kein Fix-Pass."), "ohne die Konfliktauflösung unvollständig");
    assert.ok(nenntMergeRegel("Merge von `main` ist kein Fix-Pass; Auflösung per git show --remerge-diff M"));
  });
});

describe("Rotes verify vor dem ersten Lens-Pass zählt nicht als Fix-Runde (#1322 Z7)", () => {
  const SKILL_MD = lies(".agents/skills/review-lenses/SKILL.md");
  const HARNESS_MD = lies("docs/agent-harness.md");
  const nenntRundeEins = (s: string) =>
    /Runde 1 ist der erste Lens-Pass/.test(s) && /einmal auf demselben Stand nachgeholt/.test(s) && /Rote `verify`-Fixe davor zählen nicht als Fix-Runde/.test(s);

  test("der Skill trägt die Regel, agent-harness §3a den Kernsatz", () => {
    assert.ok(nenntRundeEins(SKILL_MD), "review-lenses/SKILL.md");
    assert.match(HARNESS_MD, /Fixe für ein rotes `verify` vor dem ersten Lens-Pass zählen nicht als Fix-Runde/);
  });

  test("Prädikat greift (Red-Green)", () => {
    assert.ok(!nenntRundeEins("Runde 1 hat alle Brillen."));
    assert.ok(!nenntRundeEins("Runde 1 ist der erste Lens-Pass. Eine fehlende Brille wird einmal auf demselben Stand nachgeholt."), "ohne die verify-Fix-Klausel unvollständig");
    assert.ok(nenntRundeEins("Runde 1 ist der erste Lens-Pass; eine Brille wird einmal auf demselben Stand nachgeholt. Rote `verify`-Fixe davor zählen nicht als Fix-Runde."));
  });
});
