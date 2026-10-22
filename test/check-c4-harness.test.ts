/* Harness-Bindungen des Architekturmodells (#1421, ADR 0020): je Art beide Richtungen, Gate unter seiner Kette, Loader gegen
 * echte Fixture-Ordner. Die Abgleichsfunktion ist rein; der Loader liest nur Dateien.
 */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/check-c4-harness.mjs";

type El = { id: string; kind: string; title: string; parentId: string | null; datei: string; zeile: number };
type C4 = { elemente: El[]; beziehungen: never[]; views: never[] };
type Quelle = { herkunft: string; eintraege: { titel: string; kette?: string }[] };
type Meldung = { datei: string; zeile: number; art: string; element: string; text: string; fix: string };
const api = raw as unknown as {
  HARNESS_BINDER: string[];
  pruefeHarness: (a: { c4: C4; cfg: { workspace: string; bindungen: Record<string, string> }; harness: Record<string, Quelle> | null; binderVon: (k: string) => string | null }) => Meldung[];
  harnessQuellen: (rootDir: string, config: unknown, binders?: string[]) => Record<string, Quelle>;
  ortFuer: (c4: C4, binderVon: (k: string) => string | null, binders: string[], fallback: string) => string;
};

const DATEI = "docs/architektur/harness.c4";
const BINDUNGEN: Record<string, string> = Object.fromEntries(api.HARNESS_BINDER.map((b) => [b, b]));
const binderVon = (k: string) => BINDUNGEN[k] ?? null;
const cfg = { workspace: "docs/architektur", bindungen: BINDUNGEN };
const el = (id: string, kind: string, title: string, parentId: string | null = null, zeile = 3): El => ({ id, kind, title, parentId, datei: DATEI, zeile });

/** Je Binder: ein Eintrag in der Quelle und das passende Element (das Gate unter seiner Kette). */
const QUELLEN: Record<string, Quelle> = {
  agent: { herkunft: ".claude/agents", eintraege: [{ titel: "umsetzer" }] },
  skill: { herkunft: ".claude/skills", eintraege: [{ titel: "kubernia" }] },
  workflow: { herkunft: ".claude/workflows", eintraege: [{ titel: "ticket" }] },
  hook: { herkunft: ".claude/settings.json (hooks)", eintraege: [{ titel: "Stop" }] },
  githook: { herkunft: ".githooks", eintraege: [{ titel: "pre-push" }] },
  gate: { herkunft: "package.json (verify, verify:full)", eintraege: [{ titel: "lint", kette: "verify" }, { titel: "build", kette: "verify:full" }] },
  ciworkflow: { herkunft: ".github/workflows", eintraege: [{ titel: "ci.yml" }] },
  mcp: { herkunft: ".mcp.json", eintraege: [{ titel: "playwright" }] },
};
const modell = (): C4 => ({
  elemente: [
    el("verify", "container", "verify"),
    el("verifyFull", "container", "verify:full"),
    el("sub", "container", "Subagenten"),
    el("a", "agent", "umsetzer", "sub"),
    el("s", "skill", "kubernia"),
    el("w", "workflow", "ticket"),
    el("h", "hook", "Stop"),
    el("g", "githook", "pre-push"),
    el("verify.lint", "gate", "lint", "verify"),
    el("verifyFull.build", "gate", "build", "verifyFull"),
    el("c", "ciworkflow", "ci.yml"),
    el("m", "mcp", "playwright"),
  ],
  beziehungen: [],
  views: [],
});
const lauf = (c4: C4 = modell(), harness: Record<string, Quelle> | null = QUELLEN) => api.pruefeHarness({ c4, cfg, harness, binderVon });

describe("pruefeHarness: Bindung je Art in beide Richtungen", () => {
  test("alles abgeglichen: keine Meldung", () => {
    assert.deepEqual(lauf(), []);
  });

  test.each(api.HARNESS_BINDER)("%s: ein Element ohne Quelle ist rot und nennt Herkunft und Bekannte", (binder) => {
    const c4 = modell();
    c4.elemente.push(el("x", binder, "unbekannt", binder === "gate" ? "verify" : null, 42));
    const ms = lauf(c4);
    assert.equal(ms.length, 1);
    assert.equal(ms[0].zeile, 42);
    assert.equal(ms[0].element, "unbekannt");
    assert.ok(ms[0].text.includes(`keine Quelle in ${QUELLEN[binder].herkunft}`), ms[0].text);
  });

  test.each(api.HARNESS_BINDER)("%s: eine Quelle ohne Element ist rot und nennt Art, Titel, Herkunft und Fundort", (binder) => {
    const c4 = modell();
    c4.elemente = c4.elemente.filter((e) => e.kind !== binder);
    const ms = lauf(c4);
    assert.equal(ms.length, QUELLEN[binder].eintraege.length);
    assert.ok(ms.every((m) => m.art === binder && m.text.includes(`steht aber in ${QUELLEN[binder].herkunft}`)));
    assert.ok(ms.every((m) => m.datei === "docs/architektur" || m.datei === DATEI));
    assert.ok(ms.some((m) => m.fix.includes(QUELLEN[binder].eintraege[0].titel)));
  });

  test("Fundort der fehlenden Quelle: erstes Element derselben Familie, sonst der Workspace", () => {
    const c4 = modell();
    c4.elemente = c4.elemente.filter((e) => e.kind !== "mcp");
    assert.equal(lauf(c4)[0].datei, "docs/architektur", "keine Art mcp im Modell: Workspace");
    const anderswo = modell();
    anderswo.elemente = [{ ...el("m2", "mcp", "pixellab"), datei: "docs/architektur/extra.c4" }, ...anderswo.elemente.filter((e) => e.kind !== "mcp")];
    assert.deepEqual(
      lauf(anderswo, { ...QUELLEN, mcp: { herkunft: ".mcp.json", eintraege: [{ titel: "pixellab" }, { titel: "neu" }] } }).map((m) => [m.datei, m.element]),
      [["docs/architektur/extra.c4", "neu"]],
      "Fundort ist die Datei des ersten mcp-Elements",
    );
  });

  test("Gate unter der falschen Kette ist rot (verify:full statt verify) und nennt den Soll-Container", () => {
    const c4 = modell();
    const g = c4.elemente.find((e) => e.id === "verify.lint");
    assert.ok(g);
    g.parentId = "verifyFull";
    const ms = lauf(c4);
    assert.equal(ms.length, 1);
    assert.match(ms[0].text, /liegt unter „verify:full“, gehört laut package\.json \(verify, verify:full\) aber unter „verify“/);
    assert.match(ms[0].fix, /unter das Element 'verify'/);
  });

  test("Gate ohne Eltern ist rot; fehlendes Gate nennt die Kette im Fix", () => {
    const c4 = modell();
    const g = c4.elemente.find((e) => e.id === "verify.lint");
    assert.ok(g);
    g.parentId = null;
    assert.match(lauf(c4)[0].text, /liegt unter keinem Element/);
    const ohne = modell();
    ohne.elemente = ohne.elemente.filter((e) => e.id !== "verifyFull.build");
    assert.match(lauf(ohne)[0].fix, /Element gate 'build' unter dem Element 'verify:full' in /);
  });

  test("gebundene Art ohne Quelle (Schlüssel fehlt oder nicht geladen) ist rot, fail-closed", () => {
    for (const harness of [null, { ...QUELLEN, mcp: undefined as unknown as Quelle }]) {
      const ms = lauf(modell(), harness);
      assert.ok(ms.length >= 1);
      assert.ok(ms.every((m) => /keine Quelle für die Bindung/.test(m.text)));
    }
    const ohneListe = lauf(modell(), { ...QUELLEN, mcp: { herkunft: "x" } as unknown as Quelle });
    assert.match(ohneListe[0].text, /keine Quelle für die Bindung/);
  });

  test("ohne gebundene Harness-Art wird nichts geprüft", () => {
    const c4 = modell();
    const ms = api.pruefeHarness({ c4, cfg: { workspace: "w", bindungen: { schicht: "schicht" } }, harness: null, binderVon: () => null });
    assert.deepEqual(ms, []);
  });
});

describe("ortFuer", () => {
  test("erstes Element der Familie, sonst Fallback", () => {
    const c4 = modell();
    assert.equal(api.ortFuer(c4, binderVon, ["gate"], "fb"), DATEI);
    assert.equal(api.ortFuer(c4, binderVon, ["schicht"], "fb"), "fb");
  });
});

const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "kq-c4h-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CONFIG = {
  harness: { agents: ".claude/agents", skills: ".claude/skills", workflows: ".claude/workflows", settings: ".claude/settings.json", gitHooks: ".githooks", mcp: ".mcp.json" },
  gates: { package: "package.json", chains: ["verify", "verify:full"] },
  kennzahlen: { workflows: ".github/workflows" },
};
const FILES = (extra: Record<string, string | null> = {}): Record<string, string> => {
  const alle: Record<string, string | null> = {
    ".claude/agents/umsetzer.md": "---\nname: kubernia-umsetzer\nmodel: sonnet\n---\nText\n",
    ".claude/skills/demo/SKILL.md": "---\nname: kubernia\n---\nText\n",
    ".claude/workflows/ticket.js": "export const meta = { name: 'wf-beispiel' };\n",
    ".claude/settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [] }], PreToolUse: [] } }),
    ".githooks/pre-push": "#!/bin/sh\n",
    ".github/workflows/a.yml": "name: a\n",
    ".github/workflows/b.yaml": "name: b\n",
    ".github/workflows/README.md": "kein Workflow\n",
    ".mcp.json": JSON.stringify({ mcpServers: { playwright: {}, pixellab: {} } }),
    "package.json": JSON.stringify({ scripts: { verify: "npm run lint && npm run inner && npm test", inner: "npm run check:x && npm run lint", "verify:full": "npm run verify && npm run build && npm run build -- --x && npm run lint" } }),
    ...extra,
  };
  return Object.fromEntries(Object.entries(alle).filter((e): e is [string, string] => e[1] !== null));
};

describe("harnessQuellen: der Loader", () => {
  test("liest alle acht Quellen; .yml und .yaml zählen, README.md nicht; verschachtelte Kette aufgelöst, je Gate einmal unter der ersten Kette", () => {
    const q = api.harnessQuellen(fixture(FILES()), CONFIG);
    const titel = (b: string) => q[b].eintraege.map((x) => x.titel);
    assert.deepEqual(titel("agent"), ["kubernia-umsetzer"], "Titel ist der Frontmatter-Name, nicht der Dateiname");
    assert.deepEqual(titel("skill"), ["kubernia"]);
    assert.deepEqual(titel("workflow"), ["wf-beispiel"]);
    assert.deepEqual(titel("hook"), ["Stop", "PreToolUse"]);
    assert.deepEqual(titel("githook"), ["pre-push"]);
    assert.deepEqual(titel("ciworkflow"), ["a.yml", "b.yaml"]);
    assert.deepEqual(titel("mcp"), ["playwright", "pixellab"]);
    assert.deepEqual(q.gate.eintraege, [
      { titel: "lint", kette: "verify" },
      { titel: "check:x", kette: "verify" },
      { titel: "test", kette: "verify" },
      { titel: "build", kette: "verify:full" },
    ]);
    assert.equal(q.hook.herkunft, ".claude/settings.json (hooks)");
  });

  test("fehlt settings.json, .mcp.json, ein Ordner oder package.json: der Loader wirft mit dem Dateinamen", () => {
    assert.throws(() => api.harnessQuellen(fixture(FILES({ ".claude/settings.json": null })), CONFIG), /\.claude\/settings\.json fehlt/);
    assert.throws(() => api.harnessQuellen(fixture(FILES({ ".mcp.json": null })), CONFIG), /\.mcp\.json fehlt/);
    assert.throws(() => api.harnessQuellen(fixture(FILES({ ".githooks/pre-push": null })), CONFIG), /\.githooks fehlt/);
    assert.throws(() => api.harnessQuellen(fixture(FILES({ "package.json": null })), CONFIG), /package\.json fehlt/);
  });

  test("ein konfigurierter, aber fehlender Ordner für Agenten oder Skills wirft mit dem Pfad (kein stilles leeres Verzeichnis)", () => {
    for (const [schluessel, ordner] of [["agents", ".claude/agents"], ["skills", ".claude/skills"]] as const) {
      const files = Object.fromEntries(Object.entries(FILES()).filter(([k]) => !k.startsWith(ordner + "/")));
      assert.throws(() => api.harnessQuellen(fixture(files), CONFIG, [{ agents: "agent", skills: "skill" }[schluessel]]), new RegExp(`${ordner.replace(".", "\\.")} fehlt`));
    }
  });

  test("ein fehlender Workflow-Ordner ist keine Fehlerquelle, sondern eine leere Liste", () => {
    const files = Object.fromEntries(Object.entries(FILES()).filter(([k]) => !k.startsWith(".claude/workflows/")));
    assert.deepEqual(api.harnessQuellen(fixture(files), CONFIG, ["workflow"]).workflow.eintraege, []);
  });

  test("Punktdateien unter .githooks und Unterordner unter .githooks oder .github/workflows zählen nicht", () => {
    const q = api.harnessQuellen(
      fixture(FILES({ ".githooks/.gitkeep": "", ".githooks/_/h.sh": "x", ".github/workflows/lib.yml/a.txt": "x" })),
      CONFIG,
      ["githook", "ciworkflow"],
    );
    assert.deepEqual(q.githook.eintraege.map((x) => x.titel), ["pre-push"]);
    assert.deepEqual(q.ciworkflow.eintraege.map((x) => x.titel), ["a.yml", "b.yaml"]);
  });

  test("settings.json ohne hooks und .mcp.json ohne mcpServers ergeben leere Listen statt eines Wurfs", () => {
    const q = api.harnessQuellen(fixture(FILES({ ".claude/settings.json": "{}", ".mcp.json": "{}" })), CONFIG, ["hook", "mcp"]);
    assert.deepEqual(q.hook.eintraege, []);
    assert.deepEqual(q.mcp.eintraege, []);
  });

  const OHNE: [string, unknown][] = [
    ["agent", { ...CONFIG, harness: { ...CONFIG.harness, agents: undefined } }],
    ["skill", { ...CONFIG, harness: { ...CONFIG.harness, skills: undefined } }],
    ["workflow", { ...CONFIG, harness: { ...CONFIG.harness, workflows: undefined } }],
    ["hook", { ...CONFIG, harness: { ...CONFIG.harness, settings: undefined } }],
    ["githook", { ...CONFIG, harness: { ...CONFIG.harness, gitHooks: undefined } }],
    ["mcp", { ...CONFIG, harness: { ...CONFIG.harness, mcp: undefined } }],
    ["ciworkflow", { ...CONFIG, kennzahlen: {} }],
    ["ciworkflow", { ...CONFIG, kennzahlen: undefined }],
    ["gate", { ...CONFIG, gates: { ...CONFIG.gates, chains: "verify" } }],
    ["gate", { ...CONFIG, gates: { chains: CONFIG.gates.chains } }],
    ["gate", { ...CONFIG, gates: undefined }],
  ];
  test.each(OHNE)("nicht konfigurierter Schlüssel (%s): der Binder fehlt in der Antwort, die übrigen bleiben (pruefeHarness meldet ihn rot)", (binder, config) => {
    const q = api.harnessQuellen(fixture(FILES()), config);
    assert.equal(q[binder], undefined);
    assert.deepEqual(Object.keys(q).sort(), api.HARNESS_BINDER.filter((b) => b !== binder).sort());
  });

  test("package.json ohne scripts oder ohne eine konfigurierte Kette wirft mit Ketten- und Dateinamen statt eines TypeError", () => {
    assert.throws(() => api.harnessQuellen(fixture(FILES({ "package.json": "{}" })), CONFIG, ["gate"]), /Gate-Kette verify fehlt in package\.json/);
    const ohneFull = JSON.stringify({ scripts: { verify: "npm run lint" } });
    assert.throws(() => api.harnessQuellen(fixture(FILES({ "package.json": ohneFull })), CONFIG, ["gate"]), /Gate-Kette verify:full fehlt in package\.json/);
  });

  test("eine Config ganz ohne harness-Block: die sechs Harness-Binder fehlen, CI und Gates bleiben (kein TypeError)", () => {
    const q = api.harnessQuellen(fixture(FILES()), { gates: CONFIG.gates, kennzahlen: CONFIG.kennzahlen });
    assert.deepEqual(Object.keys(q).sort(), ["ciworkflow", "gate"]);
  });

  test("nur die angeforderten Binder werden gelesen (fehlende settings.json stört dann nicht)", () => {
    const q = api.harnessQuellen(fixture(FILES({ ".claude/settings.json": null })), CONFIG, ["mcp"]);
    assert.deepEqual(Object.keys(q), ["mcp"]);
  });

  test("leere Ordner ergeben leere Listen, kein Absturz", () => {
    const q = api.harnessQuellen(fixture(FILES({ ".claude/agents/umsetzer.md": null, ".claude/agents/notiz.txt": "kein Agent" })), CONFIG, ["agent"]);
    assert.deepEqual(q.agent.eintraege, []);
  });
});
