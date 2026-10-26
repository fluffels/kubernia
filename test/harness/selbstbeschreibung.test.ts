/* Selbstbeschreibungs-Wächter (#1714, ADR 0022): der Harness nennt sich „source-available“, nie „Open Source“.
 * Ein Treffer von „Open Source“ (auch „open-source“, „OpenSource“, „quelloffen“) in den Flächen der Selbstbeschreibung
 * ist rot, außer er ist verneint („nicht Open Source“, „keine Open-Source-Lizenz“).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Scope: eine Positivliste (`istSelbstbeschreibung`); die Wurzel-LICENSE gehört nicht dazu, sie ist keine Harness-Fläche.
 *
 * Grenzen: nicht erkannt werden Kürzel und Umschreibungen (OSS, FOSS, freie Software), doppelte Verneinung und eine
 * Verneinung weiter als drei Wörter vor dem Treffer; Fragesätze („Ist der Harness Open Source?“) zählen als Treffer. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { lies, repoDateien } from "./repo-texte";

export interface Behauptung {
  zeile: number;
  auszug: string;
}

const BEHAUPTUNG = /open[\s-]?source|quelloffen/gi;
const NEGATION = /^(nicht|kein(e|en|er|es|em)?|not|no|non)$/i;
const SATZ_ENDE = /[.!?;]\s/g;

/** Alle Stellen, die den Text als Open Source beschreiben, ohne dass eine Verneinung (≤ 3 Wörter davor, gleicher Satz) davorsteht. */
export function offeneQuelleBehauptungen(text: string): Behauptung[] {
  const sauber = text.replace(/[*_„“"`]/g, "");
  const out: Behauptung[] = [];
  for (const m of sauber.matchAll(BEHAUPTUNG)) {
    const davor = sauber.slice(0, m.index);
    let satzStart = 0;
    for (const s of davor.matchAll(SATZ_ENDE)) satzStart = s.index + s[0].length;
    const woerter = davor.slice(satzStart).split(/[\s-]+/).filter(Boolean).slice(-3);
    if (woerter.some((w) => NEGATION.test(w))) continue;
    const zeile = davor.split("\n").length;
    out.push({ zeile, auszug: m[0] });
  }
  return out;
}

/** Flächen, die den Harness selbst beschreiben (nicht: ADRs, Tests, Spielcode, Spiel-Glossar). */
export function istSelbstbeschreibung(pfad: string): boolean {
  return [
    /^README\.md$/,
    /^package\.json$/,
    /^docs\/(agent-harness|harness-)[^/]*\.md$/,
    /^\.claude\/agents\/[^/]+\.md$/,
    /^\.(claude|agents)\/skills\/[^/]+\/SKILL\.md$/,
    /(^|\/)\.claude-plugin\/[^/]+\.json$/,
  ].some((re) => re.test(pfad));
}

describe("offeneQuelleBehauptungen", () => {
  test.each([
    ["Der Harness ist Open Source.", 1],
    ["Der Harness ist open-source.", 1],
    ["Der Harness ist OpenSource.", 1],
    ["Der Harness ist quelloffen.", 1],
    ["Der Harness ist Open\nSource.", 1],
    ["Das ist nicht alles. Der Harness ist Open Source.", 1],
    ["Nicht nur schnell, sondern auch Open Source", 1],
    ["Ist der Harness Open Source?", 1],
    ["Das ist nicht so. Open Source.", 1],
    ["Ist das nicht so? Open Source.", 1],
    ["Das ist nicht so; Open Source.", 1],
    ["Das ist nicht so! Open Source.", 1],
    ["Nicht dass es schnell Open Source wäre", 1],
  ])("Treffer: %j", (text, anzahl) => {
    assert.equal(offeneQuelleBehauptungen(text).length, anzahl);
  });

  test("meldet die Zeile des Treffers", () => {
    assert.equal(offeneQuelleBehauptungen("eins\nzwei\nDer Harness ist Open Source.")[0]?.zeile, 3);
  });

  test.each([
    "Er ist nicht Open Source.",
    "Er ist **nicht** Open Source.",
    "Es wird KEINE Open-Source-\nLizenz gewährt.",
    "Das ist kein Open-Source-Projekt.",
    "It is not open source.",
    "Das ist eine nicht-quelloffene Lösung.",
    "Nicht-Open-Source-Software.",
    "It is no open source.",
    "It is non-open-source.",
    "Wir gewähren keinen Open-Source-Code.",
    "Er ist _nicht_ Open Source.",
    "Er ist nicht ganz Open Source.",
    "Das ist keine wirklich echte Open-Source-Lizenz.",
    "Er hat keinem Open-Source-Code zugestimmt.",
    "Es gibt keiner Open-Source-Lizenz Raum.",
    "Das Projekt kennt keines Open-Source-Modells.",
    "",
  ])("erlaubt: %j", (text) => {
    assert.deepEqual(offeneQuelleBehauptungen(text), []);
  });
});

describe("istSelbstbeschreibung", () => {
  test.each([
    "README.md",
    "package.json",
    "docs/agent-harness.md",
    "docs/agent-harness-faq.md",
    "docs/harness-glossar.md",
    ".claude/agents/x.md",
    ".claude/skills/y/SKILL.md",
    ".agents/skills/y/SKILL.md",
    ".claude-plugin/plugin.json",
  ])("im Scope: %s", (pfad) => {
    assert.equal(istSelbstbeschreibung(pfad), true);
  });

  test.each([
    "docs/adr/0022-dark-factory-kern-und-verteilung.md",
    "test/harness/selbstbeschreibung.test.ts",
    "src/main.ts",
    "docs/glossar.md",
    "docs/module/app.md",
    "LICENSE",
    "docs/sub/agent-harness.md",
    "docs/harness/x.md",
    "docs/agent-harness.md.bak",
    "sub/README.md",
    "README.md.orig",
    ".claude/agents/sub/x.md",
    ".claude/skills/y/z/SKILL.md",
    ".agents/skills/y/z/SKILL.md",
    ".claude/skills/y/other.md",
    "package.json.bak",
  ])("außerhalb: %s", (pfad) => {
    assert.equal(istSelbstbeschreibung(pfad), false);
  });
});

describe("Selbstbeschreibung des Harness", () => {
  const scope = repoDateien().filter(istSelbstbeschreibung);

  test("der Scope enthält die Skill-Quelle forum unter .agents/skills/ (#1848)", () => {
    assert.ok(scope.includes(".agents/skills/forum/SKILL.md"), "Skill-Quelle fehlt im Scope (nicht versioniert?)");
  });

  test("keine Fläche nennt den Harness Open Source", () => {
    const verstoesse = scope.flatMap((p) => offeneQuelleBehauptungen(lies(p)).map((b) => `${p}:${b.zeile}: „${b.auszug}“`));
    assert.deepEqual(verstoesse, [], "Selbstbeschreibung ist „source-available“, nicht Open Source");
  });
});
