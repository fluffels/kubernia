/* Generatoren `agenten-ablauf`, `agenten-sequenz`, `leitplanken-schichten` (#1369): Mermaid-Vorlagen mit
 * geprüften Platzhaltern. Läuft gegen ein Fixture-Root; jeder Rot-Fall ist ein eigener Test, dazu die
 * Vollständigkeit (AK4) und ein Echt-Repo-Test. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as dia from "../scripts/docs-gen/diagramme.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gen from "../scripts/docs-gen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as reg from "../scripts/docs-gen/registry.mjs";

type Cfg = Record<string, unknown>;
type Ctx = { rootDir: string; config: Cfg };
const api = dia as unknown as {
  diagrammGenerator: (name: string) => (ctx: Ctx) => string;
  ersetzePlatzhalter: (text: string, ctx: Ctx) => string;
};
const docgen = {
  loadConfig: (gen as unknown as { loadConfig: () => Cfg }).loadConfig,
  GENERATORS: (reg as unknown as { GENERATORS: Record<string, (ctx: Ctx) => string> }).GENERATORS,
};

const agent = (name: string, model?: string, effort?: string) =>
  `---\nname: ${name}\n${model ? `model: ${model}\n` : ""}${effort ? `effort: ${effort}\n` : ""}---\nText`;
const skill = (name: string, model?: string) => `---\nname: ${name}\n${model ? `model: ${model}\n` : ""}---\nText`;

const config: Cfg = {
  harness: { agents: ".claude/agents", skills: ".claude/skills", workflows: ".claude/workflows" },
  gates: { package: "package.json", chains: ["verify", "verify:full"] },
  diagramme: {
    vorlagen: { voll: "docs/diagramme/voll.mmd", frei: "docs/diagramme/frei.mmd" },
    vollstaendig: ["voll"],
    konstanten: {
      cap: { datei: "wf.js", name: "MAX_X" },
      doppelt: { datei: "dop.js", name: "MAX_X" },
      summe: { datei: "sum.js", name: "MAX_X" },
      weg: { datei: "nix.js", name: "MAX_X" },
      keine: { datei: "leer.js", name: "MAX_X" },
    },
    ciWorkflows: ".github/workflows",
  },
};

const VOLL = "A ${agent:plan}\nB ${agent:Explore}\nC ${skill:flow}\nD ${workflow:wf}";
const basis = (extra: Record<string, string> = {}): Record<string, string> => ({
  ".claude/agents/plan.md": agent("plan", "opus", "xhigh"),
  ".claude/agents/explore.md": agent("Explore", "haiku"),
  ".claude/skills/flow/SKILL.md": skill("flow"),
  ".claude/workflows/wf.js": "export const meta = {\n  name: 'wf',\n}\n",
  "package.json": JSON.stringify({ scripts: { verify: "npm run a && npm run b && npm test", "verify:full": "npm run verify && npm run c", a: "x", b: "x", c: "x" } }),
  ".github/workflows/x.yml": 'name: CI\njobs:\n  t:\n    name: "Tests, Typecheck & Builds"\n  s:\n    name: Security-Audit (npm audit)\n',
  "wf.js": "export const MAX_X = 2;\n",
  "dop.js": "const MAX_X = 1;\nconst MAX_X = 2;\n",
  "sum.js": "const MAX_X = 1 + 2;\n",
  "leer.js": "const ANDERE = 2;\n",
  "docs/diagramme/voll.mmd": VOLL,
  "docs/diagramme/frei.mmd": "nur ${agent:plan}",
  ...extra,
});
const ersetze = (text: string, files = basis(), c: Cfg = config) => api.ersetzePlatzhalter(text, { rootDir: fixture(files), config: c });
const erzeuge = (name: string, files = basis(), c: Cfg = config) => api.diagrammGenerator(name)({ rootDir: fixture(files), config: c });

describe("Platzhalter: Gutfälle", () => {
  test("alle Arten werden aus ihrer Quelle aufgelöst", () => {
    assert.equal(ersetze("${agent:plan}"), "plan");
    assert.equal(ersetze("${agent-modell:plan}"), "opus · xhigh");
    assert.equal(ersetze("${agent-modell:Explore}"), "haiku");
    assert.equal(ersetze("${skill:flow}"), "flow");
    assert.equal(ersetze("${skill-modell:flow}"), "Session-Modell");
    assert.equal(ersetze("${workflow:wf}"), "wf");
    assert.equal(ersetze("${konstante:cap}"), "2");
    assert.equal(ersetze("${gates:verify}"), "3");
    assert.equal(ersetze("${gates:verify:full}"), "1");
    assert.equal(ersetze("${ci-check:Tests, Typecheck & Builds}"), "Tests, Typecheck & Builds");
    assert.equal(ersetze("${ci-check:Security-Audit (npm audit)}"), "Security-Audit (npm audit)");
  });
  test("gates: ein zusammengesetzter Schritt zählt mit seinen Teilen (wie Gate-Tabelle und Drift-Wächter, #1392)", () => {
    const pkg = (scripts: Record<string, string>) => ({ "package.json": JSON.stringify({ scripts }) });
    const nested = basis(pkg({ verify: "npm run a && npm run inner && npm test", inner: "npm run b && npm run c", a: "x", b: "x", c: "x" }));
    assert.equal(ersetze("${gates:verify}", nested), "4"); // flach gezählt wären es 3
    const alias = basis(pkg({ verify: "npm run a && npm run b", a: "npm run c", b: "x", c: "x" }));
    assert.equal(ersetze("${gates:verify}", alias), "2"); // ein Alias ohne && bleibt ein Schritt
  });
  test("gates: ein doppelter Schritt zählt einmal, wie in der Gate-Tabelle (Z2a)", () => {
    const f = basis({ "package.json": JSON.stringify({ scripts: { verify: "npm run a && npm run b && npm run a -- --x && npm test", a: "x", b: "x" } }) });
    assert.equal(ersetze("${gates:verify}", f), "3"); // a, b, test (nicht 4)
  });
  test("gates: ein Zyklus in den Ketten ist rot", () => {
    const f = basis({ "package.json": JSON.stringify({ scripts: { verify: "npm run x", x: "npm run y && npm run a", y: "npm run x && npm run a", a: "x" } }) });
    assert.throws(() => ersetze("${gates:verify}", f), /Zyklus/);
  });
  test("ein Agent ohne Modell zeigt „Session-Modell“, ohne Effort entfällt der Teil", () => {
    const f = basis({ ".claude/agents/o.md": agent("ohne") });
    assert.equal(ersetze("${agent-modell:ohne}", f), "Session-Modell");
  });
  test("Agentenname fällt auf den Dateinamen zurück", () => {
    const f = basis({ ".claude/agents/roh.md": "kein Frontmatter" });
    assert.equal(ersetze("${agent:roh}", f), "roh");
  });
});

describe("Platzhalter: Rot-Fälle", () => {
  const rot = (text: string, re: RegExp, files = basis()) => assert.throws(() => ersetze(text, files), re);
  test("unbekannter Subagent, Skill, Workflow", () => {
    rot("${agent:gibtsnicht}", /Subagent "gibtsnicht" hat keine passende Datei/);
    rot("${agent-modell:gibtsnicht}", /Subagent "gibtsnicht"/);
    rot("${skill:gibtsnicht}", /Skill "gibtsnicht"/);
    rot("${skill-modell:gibtsnicht}", /Skill "gibtsnicht"/);
    rot("${workflow:gibtsnicht}", /Workflow "gibtsnicht"/);
  });
  test("unbekannte Art, leerer Wert, Rest-${", () => {
    rot("${blubb:x}", /unbekannte Platzhalter-Art "blubb"/);
    rot("${agent: }", /ohne Wert/);
    rot("${agent:}", /ohne Wert/);
    rot("kaputt ${agent plan}", /übrig gebliebener Platzhalter/);
    rot("kaputt ${", /übrig gebliebener Platzhalter/);
  });
  test("Konstante: unbekannter Schlüssel, fehlende Datei, fehlend, doppelt, kein Ganzzahl-Literal", () => {
    rot("${konstante:unbekannt}", /steht nicht in config\.diagramme\.konstanten/);
    rot("${konstante:weg}", /nix\.js nicht gefunden/);
    rot("${konstante:keine}", /MAX_X fehlt in leer\.js/);
    rot("${konstante:doppelt}", /steht mehrfach/);
    rot("${konstante:summe}", /kein Ganzzahl-Literal/);
    // eine auskommentierte Zeile zählt nicht als zweite Deklaration
    assert.equal(ersetze("${konstante:cap}", basis({ "wf.js": "// const MAX_X = 1\nexport const MAX_X = 2;\n" })), "2");
  });
  test("gates: unbekannte Kette, Kette fehlt im package.json", () => {
    rot("${gates:nix}", /steht nicht in config\.gates\.chains/);
    const f = basis({ "package.json": JSON.stringify({ scripts: { verify: "npm test" } }) });
    rot("${gates:verify:full}", /fehlt in package\.json/, f);
  });
  test("geschweifte Klammer im Modell (Frontmatter) bricht ab", () => {
    const f = basis({ ".claude/agents/k.md": "---\nname: k\nmodel: a{b\n---\n" });
    rot("${agent-modell:k}", /Zeichen, das Mermaid bricht/, f);
  });
  test("ci-check: Workflow- und Step-Namen gelten nicht als Required Check", () => {
    const f = basis({ ".github/workflows/y.yml": "name: Nur Workflow\njobs:\n  t:\n    steps:\n      - name: Nur Step\n" });
    rot("${ci-check:Nur Workflow}", /Job-name/, f);
    rot("${ci-check:Nur Step}", /Job-name/, f);
  });
  test("ci-check: Name ohne passende Job-name:-Zeile, fehlender Ordner", () => {
    rot("${ci-check:Gibt es nicht}", /CI-Check "Gibt es nicht" hat keine passende Job-name:-Zeile/);
    const f = basis();
    delete f[".github/workflows/x.yml"];
    rot("${ci-check:CI}", /CI-Workflow-Ordner|nicht gefunden/, f);
  });
  test("unsicherer Ersatzwert (Anführungszeichen, spitze Klammern, Semikolon, Raute) bricht ab", () => {
    for (const bad of ['a"b', "a<b", "a>b", "a;b", "a#b"]) {
      const f = basis({ ".claude/agents/bad.md": `---\nname: ${bad}\n---\n` });
      rot("${agent:" + bad + "}", /Zeichen, das Mermaid bricht/, f);
    }
  });
});

describe("Vollständigkeit (AK4)", () => {
  test("alle Namen genannt: grün", () => {
    assert.ok(erzeuge("voll").includes("D wf"));
  });
  test("fehlender Subagent, Skill, Workflow je eigener Rotfall mit Name und Fix", () => {
    for (const [weg, re] of [
      ["B ${agent:Explore}\n", /Subagent "Explore" \(\.claude\/agents\/explore\.md\)/],
      ["C ${skill:flow}\n", /Skill "flow"/],
      ["\nD ${workflow:wf}", /Workflow "wf"/],
    ] as const) {
      const f = basis({ "docs/diagramme/voll.mmd": VOLL.replace(weg, "") });
      assert.throws(() => erzeuge("voll", f), re);
      assert.throws(() => erzeuge("voll", f), /docs:gen/);
    }
  });
  test("ein neuer Subagent ohne Diagramm-Eintrag macht rot", () => {
    const f = basis({ ".claude/agents/neu.md": agent("neu", "sonnet") });
    assert.throws(() => erzeuge("voll", f), /Subagent "neu"/);
  });
  test("ein Subagent nur über agent-modell zählt als genannt", () => {
    const f = basis({ "docs/diagramme/voll.mmd": VOLL.replace("A ${agent:plan}", "A ${agent-modell:plan}") });
    assert.ok(erzeuge("voll", f).includes("A opus · xhigh"));
  });
  test("ein Skill nur über skill-modell zählt als genannt", () => {
    const f = basis({ "docs/diagramme/voll.mmd": VOLL.replace("C ${skill:flow}", "C ${skill-modell:flow}") });
    assert.ok(erzeuge("voll", f).includes("C Session-Modell"));
  });
  test("Vorlage außerhalb von vollstaendig braucht nicht alles", () => {
    assert.ok(erzeuge("frei").includes("nur plan"));
  });
});

describe("Factory", () => {
  test("Ausgabe: Mermaid-Fence mit Frontmatter und aufgelöster Vorlage, CRLF ≡ LF", () => {
    const lf = erzeuge("frei");
    const lines = lf.split("\n");
    assert.equal(lines[0], "```mermaid");
    assert.equal(lines[1], "---");
    assert.equal(lines.at(-1), "```");
    assert.equal(lines.at(-2), "nur plan");
    const crlf = erzeuge("frei", basis({ "docs/diagramme/frei.mmd": "nur ${agent:plan}\r\nzweite Zeile\r\n\r\n" }));
    assert.equal(crlf, erzeuge("frei", basis({ "docs/diagramme/frei.mmd": "nur ${agent:plan}\nzweite Zeile\n" })));
    assert.ok(!crlf.includes("\r"));
  });
  test("fehlende Vorlagen-Datei und fehlender Config-Eintrag sind rot", () => {
    const f = basis();
    delete f["docs/diagramme/frei.mmd"];
    assert.throws(() => erzeuge("frei", f), /Vorlage docs\/diagramme\/frei\.mmd nicht gefunden/);
    assert.throws(() => erzeuge("unbekannt"), /config\.diagramme\.vorlagen\.unbekannt fehlt/);
  });
  test("fehlt .claude/agents ganz, ist die Katalog-Liste leer und der Platzhalter rot (bekannt: keine)", () => {
    const f = basis();
    for (const k of Object.keys(f)) if (k.startsWith(".claude/agents/")) delete f[k];
    assert.throws(() => erzeuge("frei", f), /bekannt: keine/);
  });
  test("Vorlagenpfad steht in der Vollständigkeitsmeldung genau einmal", () => {
    const f = basis({ "docs/diagramme/voll.mmd": VOLL.replace("C ${skill:flow}\n", "") });
    assert.throws(() => erzeuge("voll", f), (e: Error) => e.message.split("docs/diagramme/voll.mmd").length === 2);
  });
  test("Fehlermeldung nennt die Vorlage", () => {
    const f = basis({ "docs/diagramme/frei.mmd": "${agent:nix}" });
    assert.throws(() => erzeuge("frei", f), /Vorlage docs\/diagramme\/frei\.mmd: Subagent "nix"/);
  });
});

describe("Echt-Repo", () => {
  const root = process.cwd();
  const config = docgen.loadConfig();
  test("die Registry kennt alle drei Diagramme, und alle erzeugen Mermaid ohne Platzhalter-Reste", () => {
    for (const name of ["agenten-ablauf", "agenten-sequenz", "leitplanken-schichten"]) {
      const out = docgen.GENERATORS[name]({ rootDir: root, config });
      assert.ok(out.startsWith("```mermaid\n"), name);
      assert.ok(!out.includes("${"), name);
    }
  });
  test("AK4 wörtlich: die Sequenz nennt jeden Subagenten und jeden Skill aus .claude/", () => {
    const out = docgen.GENERATORS["agenten-sequenz"]({ rootDir: root, config });
    const namen: string[] = [];
    for (const f of readdirSync(join(root, ".claude/agents")).filter((n) => n.endsWith(".md"))) {
      namen.push(/^name:\s*(.+?)\s*$/m.exec(readFileSync(join(root, ".claude/agents", f), "utf8"))![1]);
    }
    for (const d of readdirSync(join(root, ".claude/skills"))) {
      namen.push(/^name:\s*(.+?)\s*$/m.exec(readFileSync(join(root, ".claude/skills", d, "SKILL.md"), "utf8"))![1]);
    }
    assert.ok(namen.length >= 8);
    for (const n of namen) assert.ok(out.includes(n), `„${n}“ fehlt im Sequenzdiagramm`);
  });
  test("die Leitplanken-Vorlage nennt die Required Checks aus ci.yml wörtlich", () => {
    const out = docgen.GENERATORS["leitplanken-schichten"]({ rootDir: root, config });
    assert.ok(out.includes("Tests, Typecheck & Builds"));
  });
});
