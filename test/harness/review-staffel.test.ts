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
 * Geprüft wird die pure Funktion `lensPlan` (ausgeschnitten per Marker) UND ihre Verdrahtung im echten
 * Workflow-Lauf (node:vm gegen Stub-Globals, Präzedenz: model-routing.test.ts › workflowLauf).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { blockFunktion, workflowBlock } from "./workflow-block";

type Bericht = { lens: string; verdikt: string; findings: { schwere: string; befund?: string; ort?: string; begruendung?: string }[]; ausserhalbScope?: string[] };
type Vorrunde = { erwartet?: string[]; berichte?: Bericht[]; deltaPfad?: string; deltaDateien?: string[] };
type LensPlan = (e: { dateien?: unknown; vorrunde?: Vorrunde | null }) => { keys: string[]; modus: "voll" | "delta" };

const { block } = workflowBlock("// ── Review-Staffel (#1265) — Anfang", "// ── Review-Staffel (#1265) — Ende");
const lensPlan = blockFunktion<LensPlan>(block, "lensPlan");
const DREI = ["architektur", "requirement-treue", "test-adaequanz"];

const ok = (lens: string): Bericht => ({ lens, verdikt: "ok", findings: [] });
const blockiert = (lens: string): Bericht => ({ lens, verdikt: "blockierend", findings: [{ schwere: "blockierend" }] });
// In der Runtime ist das Ergebnis ein Objekt aus einem fremden vm-Realm: deepEqual über JSON normalisieren.
const plan = (e: Parameters<LensPlan>[0]) => JSON.parse(JSON.stringify(lensPlan(e))) as ReturnType<LensPlan>;

describe("Runde 1: Lens-Satz nach Diff-Art (#1265)", () => {
  test("reiner Markdown-Diff (auch Harness-Markdown) → eine Doku-Lens", () => {
    assert.deepEqual(plan({ dateien: ["AGENTS.md", "docs/model-routing.md", ".claude/skills/review-lenses/SKILL.md"] }), {
      keys: ["doku"],
      modus: "voll",
    });
  });

  test("Groß-/Kleinschreibung der Endung zählt nicht", () => {
    assert.deepEqual(plan({ dateien: ["README.MD"] }).keys, ["doku"]);
  });

  test("Markdown + ein einziges Nicht-Markdown → alle drei Brillen (keine Größenschwelle für Code)", () => {
    assert.deepEqual(plan({ dateien: ["docs/a.md", "src/save/store.ts"] }).keys, DREI);
    assert.deepEqual(plan({ dateien: ["docs/a.md", "src/content/data/npc.json"] }).keys, DREI, "Content-JSON ist kein Doku-Diff");
    assert.deepEqual(plan({ dateien: ["docs/a.mdx"] }).keys, DREI, ".mdx ist kein .md");
  });

  test("fail-closed: fehlende, leere oder kaputte Dateiliste → alle drei", () => {
    assert.deepEqual(plan({}).keys, DREI);
    assert.deepEqual(plan({ dateien: [] }).keys, DREI);
    assert.deepEqual(plan({ dateien: "AGENTS.md" }).keys, DREI, "ein String statt Liste ist kaputt, nicht Doku");
    assert.deepEqual(plan({ dateien: ["AGENTS.md", 42] }).keys, DREI, "ein Nicht-String-Eintrag ist kaputt");
    assert.deepEqual(plan({ dateien: ["   "] }).keys, DREI, "nur Leerraum ist keine Datei");
  });
});

describe("Ab Runde 2: nur die blockierten Brillen auf dem Delta (#1265)", () => {
  const vorrunde = (o: Partial<Vorrunde> = {}): Vorrunde => ({
    erwartet: DREI,
    berichte: [ok("architektur"), ok("requirement-treue"), blockiert("test-adaequanz")],
    deltaPfad: "/tmp/kq-1-r2-delta.patch",
    deltaDateien: ["docs/a.md"],
    ...o,
  });
  const code = ["src/a.ts", "test/a.test.ts"];

  test("nur die blockierte Brille, Modus delta", () => {
    assert.deepEqual(plan({ dateien: code, vorrunde: vorrunde() }), { keys: ["test-adaequanz"], modus: "delta" });
  });

  test("ein Befund mit schwere=blockierend zählt auch, wenn das Verdikt nur 'hinweise' sagt", () => {
    const b: Bericht = { lens: "architektur", verdikt: "hinweise", findings: [{ schwere: "blockierend" }] };
    const r = plan({ dateien: code, vorrunde: vorrunde({ berichte: [b, ok("requirement-treue"), ok("test-adaequanz")] }) });
    assert.deepEqual(r.keys, ["architektur"]);
  });

  test("Delta mit Nicht-Markdown → Test-Adäquanz läuft immer mit", () => {
    const r = plan({
      dateien: code,
      vorrunde: vorrunde({ berichte: [blockiert("architektur"), ok("requirement-treue"), ok("test-adaequanz")], deltaDateien: ["src/a.ts"] }),
    });
    assert.deepEqual(r, { keys: ["architektur", "test-adaequanz"], modus: "delta" });
  });

  test("Delta nur Markdown → Test-Adäquanz läuft NICHT zusätzlich", () => {
    const r = plan({ dateien: code, vorrunde: vorrunde({ berichte: [blockiert("architektur"), ok("requirement-treue"), ok("test-adaequanz")] }) });
    assert.deepEqual(r.keys, ["architektur"]);
  });

  test("Doku-Diff: die blockierte Doku-Lens läuft auf dem Delta", () => {
    const r = plan({ dateien: ["AGENTS.md"], vorrunde: vorrunde({ erwartet: ["doku"], berichte: [blockiert("doku")] }) });
    assert.deepEqual(r, { keys: ["doku"], modus: "delta" });
  });

  test("fail-closed: kein Delta-Pfad → voller Satz auf dem vollen Patch", () => {
    assert.deepEqual(plan({ dateien: code, vorrunde: vorrunde({ deltaPfad: undefined }) }), { keys: DREI, modus: "voll" });
  });

  test("fail-closed: unbekannte Delta-Dateiliste zählt als Code → Test-Adäquanz läuft mit", () => {
    const r = plan({ dateien: code, vorrunde: vorrunde({ berichte: [blockiert("architektur"), ok("requirement-treue"), ok("test-adaequanz")], deltaDateien: undefined }) });
    assert.deepEqual(r.keys, ["architektur", "test-adaequanz"]);
  });

  test("fail-closed: eine Lens der Vorrunde hat keinen Bericht geliefert → voller Satz", () => {
    const r = plan({ dateien: code, vorrunde: vorrunde({ berichte: [ok("architektur"), blockiert("test-adaequanz")] }) });
    assert.deepEqual(r, { keys: DREI, modus: "voll" });
  });

  test("fail-closed: keine Vorrunde (verify war rot, kein Lens-Pass) → voller Satz", () => {
    assert.deepEqual(plan({ dateien: code, vorrunde: null }), { keys: DREI, modus: "voll" });
  });

  test("fail-closed: Vorrunde ohne Blocker (Runde 2 nur wegen rotem verify) → voller Satz", () => {
    const r = plan({ dateien: code, vorrunde: vorrunde({ berichte: DREI.map(ok) }) });
    assert.deepEqual(r, { keys: DREI, modus: "voll" });
  });

  test("fail-closed: Diff-Art hat gewechselt (Doku-Runde, Fix brachte Code) → voller neuer Satz", () => {
    const r = plan({ dateien: ["AGENTS.md", "src/a.ts"], vorrunde: vorrunde({ erwartet: ["doku"], berichte: [blockiert("doku")] }) });
    assert.deepEqual(r, { keys: DREI, modus: "voll" });
  });
});

// ── Verdrahtung im echten Workflow-Lauf ────────────────────────────────────────

type Aufruf = { label: string; agentType?: string; effort?: string; prompt: string };
type Szenario = {
  dateien: string[];
  /** Lens-Berichte je Runde, Schlüssel = Lens-Key. Fehlt eine Lens, liefert der Stub null. */
  runden: Record<string, Bericht | null>[];
  nachbessern?: { deltaPfad?: string; deltaDateien?: string[] };
};

const WORKFLOW = fileURLToPath(new URL("../../.claude/workflows/kubernia-ticket.js", import.meta.url));

async function lauf(s: Szenario) {
  const quelle = readFileSync(WORKFLOW, "utf8").replace("export const meta", "const meta");
  const aufrufe: Aufruf[] = [];
  let runde = 0;
  let head = 1;
  const diff = () => ({ diffPfad: `/tmp/kq-42-r${runde + 1}.patch`, diffStat: "stat", diffHead: `h${head}`, diffDateien: s.dateien });
  const agent = (prompt: string, o: { label: string; agentType?: string; effort?: string }) => {
    aufrufe.push({ prompt, label: o.label, agentType: o.agentType, effort: o.effort });
    const l = o.label;
    if (l === "auswahl+claim") return Promise.resolve({ ergebnis: "ticket-geclaimt", claimVerifiziert: true, nummer: 42, titel: "T", body: "B", art: "normal" });
    if (l.startsWith("plan:")) return Promise.resolve("PLAN");
    if (l.startsWith("preflight:")) return Promise.resolve({ brauchtKlaerung: false });
    if (l.startsWith("umsetzen:")) return Promise.resolve({ ergebnis: "committet", verifyGruen: true, worktree: "/w", branch: "b", zusammenfassung: "z", ...diff() });
    if (l.startsWith("lens:")) {
      const key = l.slice("lens:".length).split(":")[0];
      const b = s.runden[runde]?.[key];
      return Promise.resolve(b === undefined ? ok(key) : b);
    }
    if (l.startsWith("nachbessern")) {
      runde += 1;
      head += 1;
      return Promise.resolve({ verifyGruen: true, zusammenfassung: "fix", ...diff(), ...s.nachbessern });
    }
    if (l.startsWith("review-festgefahren")) return Promise.resolve("ok");
    if (l.startsWith("pr+merge")) return Promise.resolve({ ergebnis: "gemergt", prNummer: 7 });
    if (l.startsWith("cleanup")) return Promise.resolve("ok");
    return Promise.reject(new Error(`Stub kennt das Label "${l}" nicht`));
  };
  const parallel = (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map((t) => t()));
  const kontext = { agent, parallel, phase: () => undefined, log: () => undefined, args: undefined };
  const endstand = (await runInNewContext(`(async () => {\n${quelle}\nreturn endstand\n})()`, kontext)) as {
    ergebnis: string;
    review?: { lens: string; verdikt: string }[];
  };
  return { aufrufe, lenses: aufrufe.filter((a) => a.label.startsWith("lens:")), endstand: JSON.parse(JSON.stringify(endstand)) as typeof endstand };
}

describe("Workflow verdrahtet die Staffel (#1265)", () => {
  test("reiner Doku-Diff: genau eine Doku-Lens über kubernia-lens mit effort high", async () => {
    const { lenses, endstand } = await lauf({ dateien: ["AGENTS.md", "docs/x.md"], runden: [{}] });
    assert.deepEqual(lenses.map((a) => a.label), ["lens:doku:r1"]);
    assert.equal(lenses[0].agentType, "kubernia-lens");
    assert.equal(lenses[0].effort, "high");
    assert.match(lenses[0].prompt, /Lens „Doku"/, "Die Doku-Lens bekommt ihren eigenen Auftrag");
    assert.equal(endstand.ergebnis, "fertig");
  });

  test("Code-Diff: alle drei Brillen", async () => {
    const { lenses } = await lauf({ dateien: ["src/a.ts"], runden: [{}] });
    assert.deepEqual(lenses.map((a) => a.label), ["lens:architektur:r1", "lens:requirement-treue:r1", "lens:test-adaequanz:r1"]);
  });

  test("Runde 2: nur die blockierte Brille, mit Delta-Patch und Blocker-Prüfliste; Endbericht zeigt jede Brille", async () => {
    const { lenses, aufrufe, endstand } = await lauf({
      dateien: ["src/a.ts"],
      runden: [{ "requirement-treue": { lens: "x", verdikt: "blockierend", findings: [{ schwere: "blockierend", befund: "AK3 fehlt", ort: "a.ts:1", begruendung: "b" }] } }, {}],
      nachbessern: { deltaPfad: "/tmp/kq-42-r2-delta.patch", deltaDateien: ["docs/a.md"] },
    });
    assert.deepEqual(lenses.map((a) => a.label), ["lens:architektur:r1", "lens:requirement-treue:r1", "lens:test-adaequanz:r1", "lens:requirement-treue:r2"]);
    const r2 = lenses[3].prompt;
    assert.match(r2, /\/tmp\/kq-42-r2-delta\.patch/, "Runde 2 nennt den Delta-Patch");
    assert.match(r2, /AK3 fehlt/, "Runde 2 bekommt die Blocker der Vorrunde als Prüfliste");
    assert.match(r2, /\/tmp\/kq-42-r2\.patch/, "Der volle Patch bleibt als Referenz");
    const nach = aufrufe.find((a) => a.label.startsWith("nachbessern"));
    assert.ok(nach && /delta\.patch/.test(nach.prompt), "Das Nachbessern muss den Delta-Patch schreiben");
    assert.deepEqual(
      endstand.review,
      [
        { lens: "architektur", verdikt: "ok" },
        { lens: "requirement-treue", verdikt: "ok" },
        { lens: "test-adaequanz", verdikt: "ok" },
      ],
      "Der Endbericht zeigt den letzten Stand JEDER Brille, auch der nicht erneut gelaufenen",
    );
  });

  test("Runde 2 fail-closed: ohne Delta-Pfad laufen wieder alle drei", async () => {
    const { lenses } = await lauf({
      dateien: ["src/a.ts"],
      runden: [{ architektur: blockiert("architektur") }, {}],
      nachbessern: { deltaPfad: undefined },
    });
    assert.deepEqual(lenses.slice(3).map((a) => a.label), ["lens:architektur:r2", "lens:requirement-treue:r2", "lens:test-adaequanz:r2"]);
    assert.doesNotMatch(lenses[3].prompt, /Delta-Patch/, "Ohne Delta kein Delta-Auftrag");
  });

  test("Runde 2 fail-closed: eine Lens der Vorrunde fiel aus → voller Satz", async () => {
    const { lenses } = await lauf({
      dateien: ["src/a.ts"],
      runden: [{ architektur: blockiert("architektur"), "test-adaequanz": null }, {}],
      nachbessern: { deltaPfad: "/tmp/d.patch", deltaDateien: ["docs/a.md"] },
    });
    assert.deepEqual(lenses.slice(3).map((a) => a.label), ["lens:architektur:r2", "lens:requirement-treue:r2", "lens:test-adaequanz:r2"]);
  });
});

// ── Skill-Pfad und Workflow regeln dasselbe (#1265) ────────────────────────────
// Der Skill-Pfad ist der maßgebliche, tool-neutrale Weg; er hat keinen Code, nur die Regel. Fällt sie
// dort weg, spawnt er wieder immer drei Lenses, während der Workflow staffelt.

const lies = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const SKILL = ".claude/skills/review-lenses/SKILL.md";

/** Nennt ein Regeltext die Staffel vollständig? EIN Prädikat für Artefakt und Gegenbeispiel. */
const nenntStaffel = (s: string) =>
  /`\*\.md`/.test(s) && /Doku/.test(s) && /Delta/.test(s) && /Test-Adäquanz immer mit/.test(s) && /[Ff]ail-closed/.test(s);
/** Verlangt ein Text, den Patch nur einmal vollständig zu lesen? */
const liestPatchEinmal = (s: string) => /einmal\s+vollständig/i.test(s) && /kein(?:en)?\s+zweites\s+Volllesen/i.test(s);

describe("Skill-Pfad und Workflow regeln die Staffel gleich (#1265)", () => {
  test("review-lenses nennt Doku-Kriterium, Delta ab Runde 2, Test-Adäquanz-Pflicht und fail-closed", () => {
    assert.ok(nenntStaffel(lies(SKILL)), "review-lenses/SKILL.md beschreibt die Review-Staffel nicht (mehr) vollständig");
  });

  test("der Skill-Spawn trägt den Runden-Marker R<runde>, den die Messung zählt", () => {
    assert.match(lies(SKILL), /description: "Lens <[^>]*Doku> R<runde>"/);
  });

  test("Patch einmal lesen: in der Workflow-Diät, im Skill und im Lens-Agenten", () => {
    const wf = readFileSync(WORKFLOW, "utf8");
    const diaet = wf.slice(wf.indexOf("const KONTEXT_DIAET"), wf.indexOf("// ── Review-Staffel (#1265) — Anfang"));
    assert.ok(liestPatchEinmal(diaet), "KONTEXT_DIAET");
    assert.ok(liestPatchEinmal(lies(SKILL)), "review-lenses/SKILL.md");
    assert.ok(liestPatchEinmal(lies(".claude/agents/kubernia-lens.md")), "kubernia-lens.md");
  });

  test("Prädikate greifen (Red-Green)", () => {
    assert.ok(nenntStaffel("nur `*.md` → Doku; ab Runde 2 Delta; Test-Adäquanz immer mit; fail-closed"));
    assert.ok(!nenntStaffel("nur `*.md` → Doku; ab Runde 2 Delta; fail-closed"), "ohne Test-Adäquanz-Pflicht unvollständig");
    assert.ok(!nenntStaffel("immer drei Lenses"));
    assert.ok(liestPatchEinmal("genau einmal vollständig lesen, danach gezielt, kein zweites Volllesen"));
    assert.ok(!liestPatchEinmal("Der Patch ist die Primärquelle."));
  });
});
