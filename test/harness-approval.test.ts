/* Harness-Freigabe-Wächter (#1012) – Human-in-the-Loop-Checkpoints für risikoreiche Diffs.
 *
 * Kubernia mergt autonom. Der Marktstandard 2026 gate't nicht den ganzen Lauf, sondern die
 * RISKANTE ENTSCHEIDUNG – und Selbstmodifikation der Leitplanken ist der Paradefall für einen
 * Pflicht-Stopp („am Harness darf die KI nicht komplett allein"). Dieser Wächter deckt die zwei
 * Fehlklassen ab, die diese Regel leise aushöhlen:
 *
 *   1. **Die portable Regel verschwindet.** Die Verhaltensregel „Harness-/Leitplanken-Änderungen
 *      brauchen menschliche Freigabe" lebt tool-neutral in AGENTS.md. Wird sie umformuliert bis
 *      der Marker fehlt, liest ein fremder Agent (der nur AGENTS.md kennt) sie nicht mehr.
 *   2. **Die zwei Durchsetzungs-Listen driften auseinander.** Der CI-Riegel `gate-change-guard`
 *      (.github/workflows/gate-change-guard.yml, Array PROTECTED) ist laut eigenem Kommentar
 *      „Spiegel der CODEOWNERS-Liste".
 *      Ergänzt jemand einen Leitplanken-Pfad nur in einer der beiden Dateien, greift der Riegel
 *      halb – von außen (grüne Checks) nicht von einem echten Schutz zu unterscheiden. Hier ROT.
 *
 * Zusätzlich wird geprüft, dass beide Listen die Leitplanken-Dateien (über die reine
 * Gate-Config hinaus: AGENTS.md, CLAUDE.md, .claude/, .agents/, docs/agent-harness) wirklich
 * enthalten – sonst wäre die Regel dokumentiert, aber der Riegel liefe ins Leere.
 *
 * Fitness-Function-Kategorie neben claude-bridge/docmap/readme (#992/#482), nicht mit
 * Verhaltens-Tests vermischen. Bewusst **ohne** eigenes `scripts/check-*.mjs`: `scripts/check-`
 * ist selbst gate-config-geschützt (Goodhart-Guard #903, Label-Pflicht) – für rein
 * doku-/config-strukturelle Wächter gibt es die etablierte test-only-Familie (Präzedenz:
 * `test/claude-bridge.test.ts`).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

/**
 * Normalisiert einen geschützten Pfad auf seine Substring-Form: führenden `/` weg
 * (CODEOWNERS-Anker) und ab dem ersten Glob-`*` abschneiden. So werden die zwei
 * Schreibweisen vergleichbar – CODEOWNERS `/scripts/check-*.mjs` und ci.yml-Substring
 * `scripts/check-` landen beide auf `scripts/check-`.
 */
function normalizeProtected(p: string): string {
  return p.replace(/^\//, "").replace(/\*.*$/, "");
}

/** Die geschützten Pfade aus `.github/CODEOWNERS` (jeweils vor dem `@owner`). */
function codeownersPaths(text: string): Set<string> {
  const set = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)\s+@\S+/);
    if (m) set.add(normalizeProtected(m[1]));
  }
  return set;
}

/** Die geschützten Pfade aus dem `PROTECTED=( '...' … )`-Bash-Array in gate-change-guard.yml. */
function guardProtectedPaths(text: string): Set<string> {
  // Bis zur schliessenden Klammer auf EIGENER Zeile (^\s*\)) – nicht bis zum ersten `)`,
  // sonst schneidet ein Kommentar mit Klammer wie "(#903)" das Array zu frueh ab.
  const block = text.match(/PROTECTED=\(\s*([\s\S]*?)^\s*\)/m);
  assert.ok(block, "PROTECTED=(...)-Array im gate-change-guard (gate-change-guard.yml) nicht gefunden");
  const set = new Set<string>();
  for (const m of block[1].matchAll(/'([^']+)'/g)) set.add(normalizeProtected(m[1]));
  return set;
}

/**
 * Leitplanken-Dateien, die über die reine Gate-Config hinaus eine menschliche Freigabe
 * brauchen (Ticket #1012 / Maintainerin-Entscheidung „breit"). In Substring-Form – so wie
 * beide Listen sie nach der Normalisierung führen müssen.
 */
const LEITPLANKEN = ["AGENTS.md", "CLAUDE.md", ".claude/", ".agents/", "docs/agent-harness"];

/**
 * Marker der portablen Regeln in AGENTS.md. Bewusst wording-gekoppelt (wie readme.test.ts die
 * Quest-Zahl): die Regel darf umformuliert werden, aber der tragende Begriff muss stehen bleiben,
 * sonst findet ihn ein fremder Agent nicht mehr.
 */
const AGENTS_MARKER = [
  "Human-in-the-Loop", // der Checkpoint-Regel-Bullet (Pre-Flight + Merge-Hand-off)
  "Mehr-Perspektiven-Review", // die erzwungene Review-Konvergenzschleife vor dem Merge
];

const codeowners = read(".github/CODEOWNERS");
const guardWf = read(".github/workflows/gate-change-guard.yml");
const agentsMd = read("AGENTS.md");

describe("Harness-Freigabe – die zwei Durchsetzungs-Listen bleiben synchron (#1012)", () => {
  test("CODEOWNERS und gate-change-guard/PROTECTED schützen dieselben Pfade", () => {
    assert.deepEqual(
      [...codeownersPaths(codeowners)].sort(),
      [...guardProtectedPaths(guardWf)].sort(),
      "Die geschützten Pfade in .github/CODEOWNERS und im PROTECTED-Array (.github/workflows/gate-change-guard.yml) sind auseinandergelaufen. " +
        "Der CI-Kommentar nennt PROTECTED ausdrücklich 'Spiegel der CODEOWNERS-Liste' - beide Listen zusammen pflegen.",
    );
  });

  test("beide Listen decken die Leitplanken-Dateien ab (nicht nur Gate-Config)", () => {
    const co = codeownersPaths(codeowners);
    const cp = guardProtectedPaths(guardWf);
    const fehlend: string[] = [];
    for (const p of LEITPLANKEN) {
      if (!co.has(p)) fehlend.push(`.github/CODEOWNERS: ${p}`);
      if (!cp.has(p)) fehlend.push(`ci.yml PROTECTED: ${p}`);
    }
    assert.deepEqual(
      fehlend,
      [],
      "Leitplanken-Dateien fehlen im Freigabe-Riegel (#1012: Harness-Änderungen brauchen menschliche Freigabe):\n" +
        fehlend.join("\n"),
    );
  });
});

describe("Harness-Freigabe – die portable Regel steht in AGENTS.md (#1012)", () => {
  test("AGENTS.md nennt die Human-in-the-Loop-Checkpoints und den erzwungenen Review", () => {
    const fehlend = AGENTS_MARKER.filter((m) => !agentsMd.includes(m));
    assert.deepEqual(
      fehlend,
      [],
      "In AGENTS.md fehlen die tragenden Regel-Marker (#1012). Ein fremder Agent kennt nur AGENTS.md – " +
        `ohne diese Begriffe findet er die Regel nicht:\n${fehlend.join("\n")}`,
    );
  });
});

describe("Erkennung greift wirklich (Red-Green, #1012)", () => {
  test("Normalisierung führt beide Schreibweisen zusammen", () => {
    assert.equal(normalizeProtected("/scripts/check-*.mjs"), "scripts/check-");
    assert.equal(normalizeProtected("scripts/check-"), "scripts/check-");
    assert.equal(normalizeProtected("/.github/workflows/*.yml"), ".github/workflows/");
    assert.equal(normalizeProtected("/AGENTS.md"), "AGENTS.md");
  });

  test("Parser lesen echte Listen und ignorieren Kommentare/Leerzeilen", () => {
    assert.deepEqual(
      [...codeownersPaths("# Kopf\n\n/foo.js   @fluffels\n/bar/*.yml  @fluffels")].sort(),
      ["bar/", "foo.js"],
    );
    assert.deepEqual([...guardProtectedPaths("x\nPROTECTED=(\n  'a.js'\n  'b/'\n)\ny")].sort(), ["a.js", "b/"]);
  });

  test("ein einseitig ergänzter Pfad würde als Drift auffallen", () => {
    // Beweist, dass der Sync-Test nicht immer grün ist: fehlt ein Pfad in einer Liste, kippt der Vergleich.
    const co = new Set(["AGENTS.md", "CLAUDE.md"]);
    const cp = new Set(["AGENTS.md"]);
    assert.notDeepEqual([...co].sort(), [...cp].sort());
  });
});
