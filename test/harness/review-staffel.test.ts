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
import { blockFunktion, workflowBlock } from "./workflow-block";
import { workflowLauf, type Bericht } from "./workflow-lauf";

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

  test("ein Verdikt 'blockierend' OHNE blockierendes Finding zählt nicht (dieselbe Definition wie die Schleife)", () => {
    const b: Bericht = { lens: "architektur", verdikt: "blockierend", findings: [] };
    const r = plan({ dateien: code, vorrunde: vorrunde({ berichte: [b, ok("requirement-treue"), ok("test-adaequanz")] }) });
    assert.deepEqual(r, { keys: DREI, modus: "voll" }, "ohne echten Blocker: fail-closed auf den vollen Satz");
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

const WORKFLOW = fileURLToPath(new URL("../../.claude/workflows/kubernia-ticket.js", import.meta.url));

type Szenario = {
  dateien: string[];
  /** Lens-Berichte je Runde, Schlüssel = Lens-Key. Fehlt eine Lens, liefert der Stub null. */
  runden: Record<string, Bericht | null>[];
  nachbessern?: { deltaPfad?: string; deltaDateien?: string[] };
  /** Ergebnisse je Lens-Key nach Aufruf-Reihenfolge (Ausfall, dann Erfolg); ersetzt `runden` für diese Lens. */
  versuche?: Record<string, (Bericht | null)[]>;
};

/** Der gemeinsame Vollauf-Stub (workflow-lauf.ts) mit den Szenario-Feldern dieser Datei. */
const lauf = (s: Szenario) => workflowLauf({ umsetzen: { dateien: s.dateien }, runden: s.runden, nachbessern: s.nachbessern, versuche: s.versuche });

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
      runden: [
        {
          architektur: { lens: "architektur", verdikt: "hinweise", findings: [{ schwere: "hinweis", befund: "H" }], ausserhalbScope: ["X aus Runde 1"] },
          "requirement-treue": { lens: "x", verdikt: "blockierend", findings: [{ schwere: "blockierend", befund: "AK3 fehlt", ort: "a.ts:1", begruendung: "b" }] },
        },
        {},
      ],
      nachbessern: { deltaPfad: "/tmp/kq-42-r2-delta.patch", deltaDateien: ["docs/a.md"] },
    });
    assert.deepEqual(lenses.map((a) => a.label), ["lens:architektur:r1", "lens:requirement-treue:r1", "lens:test-adaequanz:r1", "lens:requirement-treue:r2"]);
    const r2 = lenses[3].prompt;
    assert.match(r2, /\/tmp\/kq-42-r2-delta\.patch/, "Runde 2 nennt den Delta-Patch");
    assert.match(r2, /AK3 fehlt/, "Runde 2 bekommt die Blocker der Vorrunde als Prüfliste");
    assert.match(r2, /\/tmp\/kq-42-r2\.patch/, "Der volle Patch bleibt als Referenz");
    const nach = aufrufe.find((a) => a.label.startsWith("nachbessern"));
    assert.ok(nach && /delta\.patch/.test(nach.prompt), "Das Nachbessern muss den Delta-Patch schreiben");
    assert.match(nach.prompt, /git diff h1\.\.HEAD/, "Basis des Deltas ist der HEAD, den Runde 1 reviewt hat");
    assert.deepEqual(endstand.ausserhalbScope, ["X aus Runde 1"], "ausserhalbScope einer nicht erneut gelaufenen Brille geht nicht verloren");
    assert.equal(endstand.hinweiseOffen, 1, "Hinweise einer nicht erneut gelaufenen Brille bleiben offen");
    assert.deepEqual(
      endstand.review,
      [
        { lens: "architektur", verdikt: "hinweise" },
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
    // Der Ausfall wird in Runde 1 einmal nachgeholt (#1309): Index 3 ist der zweite Versuch.
    assert.deepEqual(lenses.slice(4).map((a) => a.label), ["lens:architektur:r2", "lens:requirement-treue:r2", "lens:test-adaequanz:r2"]);
  });
});

describe("Lens-Ausfall gilt als nicht konvergiert (#1309)", () => {
  const ausfallDann = (...folge: (Bericht | null)[]) => ({ "test-adaequanz": folge });

  test("einmal ausgefallen, beim Nachholen ok: genau ein zweiter Versuch, PR läuft, Nachweis nennt drei Brillen", async () => {
    const { lenses, aufrufe, endstand } = await lauf({ dateien: ["src/a.ts"], runden: [{}], versuche: ausfallDann(null, ok("test-adaequanz")) });
    assert.deepEqual(lenses.map((a) => a.label), ["lens:architektur:r1", "lens:requirement-treue:r1", "lens:test-adaequanz:r1", "lens:test-adaequanz:r1"]);
    assert.equal(endstand.ergebnis, "fertig");
    const pr = aufrufe.find((a) => a.label.startsWith("pr+merge"));
    assert.ok(pr, "pr+merge muss laufen");
    assert.match(pr.prompt, /KQ-Review: head=h1 runden=1 lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:0,requirement-treue:0,test-adaequanz:0 verdikt=ok/);
  });

  test("Runde-1-Blocker (#1123): Runde 1 blockiert bei architektur, Runde 2 ok → der Nachweis nennt die Runde-1-Zahlen", async () => {
    const { aufrufe, endstand } = await lauf({ dateien: ["src/a.ts"], runden: [{ architektur: blockiert("architektur") }, {}] });
    assert.equal(endstand.ergebnis, "fertig");
    const pr = aufrufe.find((a) => a.label.startsWith("pr+merge"));
    assert.match(pr?.prompt ?? "", /runden=2 lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:1,requirement-treue:0,test-adaequanz:0 verdikt=ok/);
  });

  test("zweimal ausgefallen, keine Blocker: Hand-off statt PR", async () => {
    const { aufrufe, endstand } = await lauf({ dateien: ["src/a.ts"], runden: [{}], versuche: ausfallDann(null, null) });
    assert.equal(endstand.ergebnis, "review-festgefahren");
    assert.ok(!aufrufe.some((a) => a.label.startsWith("pr+merge")), "kein PR mit ungeprüfter Brille");
    assert.ok(!aufrufe.some((a) => a.label.startsWith("nachbessern")), "keine leere Fix-Runde");
    const hand = aufrufe.find((a) => a.label.startsWith("review-festgefahren"));
    assert.match(hand?.prompt ?? "", /Lens test-adaequanz lieferte zweimal kein Ergebnis \(ungeprüft\)/);
  });

  test("Ausfall plus Blocker einer anderen Brille: normal nachbessern, nächste Runde voll", async () => {
    const { lenses, endstand } = await lauf({
      dateien: ["src/a.ts"],
      runden: [{ architektur: blockiert("architektur") }, {}],
      versuche: ausfallDann(null, null, ok("test-adaequanz")),
      nachbessern: { deltaPfad: "/tmp/d.patch", deltaDateien: ["docs/a.md"] },
    });
    assert.deepEqual(lenses.slice(4).map((a) => a.label), ["lens:architektur:r2", "lens:requirement-treue:r2", "lens:test-adaequanz:r2"]);
    assert.equal(endstand.ergebnis, "fertig");
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
/** Nennt der Text den Abschnitts-Helfer (#1379), statt nur „sehr große Patches abschnittsweise“ zu verlangen? */
const nenntAbschnittsHelfer = (s: string) => /patch-abschnitte\.mjs/.test(s);

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
    assert.ok(nenntAbschnittsHelfer(diaet), "KONTEXT_DIAET nennt patch-abschnitte.mjs nicht");
    assert.ok(nenntAbschnittsHelfer(lies(SKILL)), "review-lenses/SKILL.md nennt patch-abschnitte.mjs nicht");
    assert.ok(nenntAbschnittsHelfer(lies(".claude/agents/kubernia-lens.md")), "kubernia-lens.md nennt patch-abschnitte.mjs nicht");
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
  test("der Nachbessern-Prompt beschreibt Delta aus Fixes vor/nach dem Merge-Commit und die Konfliktauflösung", async () => {
    const { aufrufe } = await lauf({
      dateien: ["src/a.ts"],
      runden: [{ architektur: blockiert("architektur") }, {}],
      nachbessern: { deltaPfad: "/tmp/d.patch", deltaDateien: ["src/a.ts"] },
    });
    const nach = aufrufe.find((a) => a.label.startsWith("nachbessern"))?.prompt ?? "";
    assert.match(nach, /git diff h1\.\.M\^1 plus git diff M\.\.HEAD/);
    assert.match(nach, /git show --remerge-diff M/);
    assert.doesNotMatch(nach, /gemergt oder rebased, lass deltaPfad leer/, "der alte Satz erzwang nach jedem Merge den vollen Pass");
    assert.match(nach, /REBASED, lass deltaPfad\s+leer/, "nur ein Rebase erzwingt weiter den vollen Satz");
  });

  const SKILL_MD = lies(".claude/skills/review-lenses/SKILL.md");
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
  const lensLabels = (a: { label: string }[]) => a.map((x) => x.label);
  const blocker = (lens: string): Bericht => ({ lens, verdikt: "blockierend", findings: [{ schwere: "blockierend", befund: "B", ort: "a.ts:1", begruendung: "b" }] });

  test("rotes verify, Fix grün, dann zwei Blocker-Pässe: konvergiert im dritten Pass, erstes Lens-Label ist r1, ein PR", async () => {
    const r = await workflowLauf({
      umsetzen: { dateien: ["src/a.ts"] },
      verifyGruen: { umsetzen: false },
      // Lens-Berichte nach Zahl der Fixes: 0 = verify-Fix (kein Pass), 1 = Pass 1, 2 = Pass 2, 3 = Pass 3
      runden: [{}, { architektur: blocker("architektur") }, { architektur: blocker("architektur") }, {}],
    });
    const lenses = lensLabels(r.lenses);
    assert.equal(lenses[0], "lens:architektur:r1", "der erste Lens-Pass ist Runde 1, nicht 2");
    assert.deepEqual(lenses.filter((l) => l.startsWith("lens:architektur")), ["lens:architektur:r1", "lens:architektur:r2", "lens:architektur:r3"]);
    assert.deepEqual(lenses.slice(0, 3), ["lens:architektur:r1", "lens:requirement-treue:r1", "lens:test-adaequanz:r1"], "Runde 1 hat den vollen Satz");
    assert.equal(r.ergebnis, "fertig", "konvergiert statt Hand-off");
    assert.equal(r.aufrufe.filter((a) => a.label.startsWith("pr+merge")).length, 1);
    const fixe = r.aufrufe.filter((a) => a.label.startsWith("nachbessern")).map((a) => a.label);
    assert.deepEqual(fixe, ["nachbessern verify 1/3:#42", "nachbessern 1/2:#42", "nachbessern 2/2:#42"]);
    const erster = r.aufrufe.find((a) => a.label.startsWith("nachbessern"))?.prompt ?? "";
    assert.match(erster, /Fix-Versuch 1 von 3 für das rote verify/);
    assert.doesNotMatch(erster, /Fix-Runde \d von 2/, "kein Review-Cap im verify-Fix");
  });

  test("dreimal rotes verify vor jedem Lens-Pass: Hand-off nach drei Fix-Versuchen, keine Endlosschleife, kein Lens", async () => {
    const r = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"] }, verifyGruen: { umsetzen: false, nachbessern: [false] } });
    assert.equal(r.ergebnis, "review-festgefahren");
    assert.equal(r.lenses.length, 0, "Short-Circuit: kein Lens-Pass");
    assert.equal(r.aufrufe.filter((a) => a.label.startsWith("nachbessern")).length, 3);
    assert.equal(r.aufrufe.filter((a) => a.label.startsWith("pr+merge")).length, 0, "kein PR mit rotem verify");
    const festgefahren = r.aufrufe.find((a) => a.label.startsWith("review-festgefahren"))?.prompt ?? "";
    assert.match(festgefahren, /3 Fix-Versuchen für das rote verify \(noch kein Lens-Pass\)/);
    assert.doesNotMatch(festgefahren, /nach 2 Fix-Runden/);
  });

  test("rotes verify NACH einem Lens-Pass zählt weiter als Fix-Runde (Review-Cap 2 bleibt)", async () => {
    const r = await workflowLauf({
      umsetzen: { dateien: ["src/a.ts"] },
      verifyGruen: { nachbessern: [false, true, true] }, // 1. Fix lässt verify rot, 2. und 3. grün
      runden: [{ architektur: blocker("architektur") }, {}, { architektur: blocker("architektur") }, { architektur: blocker("architektur") }],
    });
    // Pass 1 blockiert → Fix 1 (verify rot, zählt als Fix-Runde 1, weil schon ein Pass lief) → Fix 2 (grün) = Runde 2 → Pass 2 blockiert → Hand-off
    assert.equal(r.ergebnis, "review-festgefahren");
    assert.deepEqual(r.aufrufe.filter((a) => a.label.startsWith("nachbessern")).map((a) => a.label), ["nachbessern 1/2:#42", "nachbessern 2/2:#42"]);
  });

  const SKILL_MD = lies(".claude/skills/review-lenses/SKILL.md");
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

describe("Lens-Auftrag mit eingesetzten Werten (#1322 Z16b)", () => {
  test("der Test-Lens-Prompt trägt Lens-Worktree-Pfad, HEAD, Nummer und Runde statt Platzhalter", async () => {
    const r = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"], extra: { worktree: "C:/dev/kubernia/.claude/worktrees/kq-42" } } });
    const testLens = r.lenses.find((a) => a.label === "lens:test-adaequanz:r1")?.prompt ?? "";
    assert.match(testLens, /git -C C:\/dev\/kubernia\/\.claude\/worktrees\/kq-42 worktree add --detach C:\/dev\/kubernia\/\.claude\/worktrees\/kq-42-lens-r1 h1\b/);
    assert.match(testLens, /npm --prefix C:\/dev\/kubernia\/\.claude\/worktrees\/kq-42-lens-r1 test/);
    for (const p of ["<nr>", "<runde>", "<erwarteter HEAD>", "<lens-worktree>", "<worktree>", "<hauptrepo>"]) assert.ok(!testLens.includes(p), `Platzhalter ${p} bleibt nicht stehen`);
    const req = r.lenses.find((a) => a.label === "lens:requirement-treue:r1")?.prompt ?? "";
    assert.match(req, /gh issue view 42/, "<nr> auch in den übrigen Lens-Aufträgen eingesetzt");
  });

  test("Runde 2 trägt ihre Rundennummer im Lens-Worktree-Pfad", async () => {
    const r = await workflowLauf({
      umsetzen: { dateien: ["src/a.ts"], extra: { worktree: "/w/kq-42" } },
      runden: [{ "test-adaequanz": { lens: "test-adaequanz", verdikt: "blockierend", findings: [{ schwere: "blockierend", befund: "B", ort: "x", begruendung: "y" }] } }, {}],
      nachbessern: { deltaPfad: "/tmp/d.patch", deltaDateien: ["src/a.ts"] },
    });
    const r2 = r.lenses.find((a) => a.label === "lens:test-adaequanz:r2")?.prompt ?? "";
    assert.match(r2, /\/w\/kq-42-lens-r2 h2\b/);
  });

  test("relativer Worktree-Pfad: Nummer und Runde sind eingesetzt, <hauptrepo> bleibt als Platzhalter", async () => {
    const r = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"], extra: { worktree: ".claude/worktrees/kq-42" } } });
    const t = r.lenses.find((a) => a.label === "lens:test-adaequanz:r1")?.prompt ?? "";
    assert.match(t, /<hauptrepo>\/\.claude\/worktrees\/kq-42-lens-r1/);
    assert.ok(!t.includes("<nr>") && !t.includes("<runde>"));
  });

  test("absoluter Worktree-Pfad, der nicht auf kq-<nr> endet: <hauptrepo>-Platzhalter bleibt, Nummer und Runde sind eingesetzt (Grenze)", async () => {
    const r = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"], extra: { worktree: "/w/anderer-name" } } });
    const t = r.lenses.find((a) => a.label === "lens:test-adaequanz:r1")?.prompt ?? "";
    assert.match(t, /<hauptrepo>\/\.claude\/worktrees\/kq-42-lens-r1/);
    assert.ok(!t.includes("/w/anderer-name-lens"), "kein erfundener Pfad neben einem fremd benannten Worktree");
  });

  test("die Quelle (LENS_QUELLE) behält die Platzhalter: nur der Spawn setzt ein", () => {
    const text = lies(".claude/workflows/kubernia-ticket.js");
    assert.match(text, /kq-<nr>-lens-r<runde>/);
    assert.match(text, /\$\{lensAuftragFuer\(lens\.auftrag, \{ nr, runde, worktree, head: diff\.head \}\)\}/);
  });
});
