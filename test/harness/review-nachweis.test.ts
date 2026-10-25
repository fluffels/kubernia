/* Review-Nachweis-Wächter (#1270) – Kopplung Prüfskript ↔ CI ↔ Texte.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Das Prüfskript `scripts/check-review-nachweis.mjs` verlangt im PR-Slice die Commit-Zeilen `<praefixe.commitZeile>Plan:` /
 * `<praefixe.commitZeile>Review:`. Alles, was das Skript an Wissen aus Skill und Format-SSOT dupliziert (Cap, Lens-Satz je
 * Diff-Art, Brillen-Keys), darf nicht still auseinanderlaufen. Geprüft werden:
 *   (a) die Zeilen im Format der SSOT (`nachweisZeilen`) werden vom Parser angenommen (Roundtrip),
 *   (b) MAX_FIX_RUNDEN im Skript == das Cap im Skill,
 *   (c) `pflichtLenses` je Diff-Art == die Staffel im Skill,
 *   (d) der Required-Job build-test ruft das Skript als Schritt nach „Diff-Basis bestimmen“ auf, mit
 *       pull_request-Bedingung und Dependabot-Ausnahme,
 *   (e) review-lenses-Skill und der Umsetzer-Agent verweisen auf das Skript.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Nachweis = { plan: { art: string } | null; review: { head: string | null; runden: number; lenses: string[]; verdikt: string | null } | null };
type Mod = {
  MAX_FIX_RUNDEN: number;
  parseNachweis: (t: string, z: unknown) => Nachweis;
  pflichtLenses: (d: unknown) => string[];
  bewerteNachweis: (o: { nachweis: Nachweis; dateien: string[]; headBekannt: boolean; headImSlice: boolean; konfliktMerges?: string[]; zeilen: unknown }) => string[];
};
import { besitzAnker } from "../support/besitz-anker";
import { ohneKernEnv } from "../support/env-alt";
import { FREMD, FREMD_CONFIG_PFAD, projektConfig } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/check-review-nachweis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as nachweisLib from "../../scripts/nachweis-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as kennzahlen from "../../scripts/factory-kennzahlen.mjs";
const { MAX_FIX_RUNDEN, pflichtLenses } = raw as Mod;
const { MAX_REVIEW_PAESSE, MAX_ZUSATZPAESSE } = nachweisLib as unknown as { MAX_REVIEW_PAESSE: number; MAX_ZUSATZPAESSE: number };
const { MAX_RUNDEN } = kennzahlen as unknown as { MAX_RUNDEN: number };
/** Zeilen der Fremd-Config; die Wrapper reichen sie durch. */
const { commitZeilen } = sliceRaw as unknown as { commitZeilen: (p: string, pl: string) => { plan: string; review: string } };
const PL = FREMD.agenten.planer;
const Z = commitZeilen(FREMD.praefixe.commitZeile, PL);
const parseNachweis = (t: string) => (raw as Mod).parseNachweis(t, Z);
const bewerteNachweis = (o: Omit<Parameters<Mod["bewerteNachweis"]>[0], "zeilen">) => (raw as Mod).bewerteNachweis({ zeilen: Z, ...o });
const zusatzpassZeile = (raw as unknown as { zusatzpassZeile: (r: { zusatzpass: { grund: string } | null }) => string | null }).zusatzpassZeile;
const checkReviewNachweis = (o: { runGit: (a: string[]) => string; env?: Record<string, string> }) =>
  (raw as unknown as { checkReviewNachweis: (o: { runGit: (a: string[]) => string; env?: Record<string, string>; ladeZeilen: () => unknown }) => { ok: boolean; zusatzpass: { grund: string } | null } }).checkReviewNachweis({ ladeZeilen: () => Z, ...o });

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const SHA = "c".repeat(40);

const CODE = ["architektur", "requirement-treue", "test-adaequanz"];
/** Die zwei Commit-Zeilen im Format der SSOT (docs/agent-harness.md §3a), wie sie der Umsetzer nach der Konvergenz setzt. */
function nachweisZeilen({ head, runden, lenses, plan }: { head: string; runden: number; lenses: string[]; plan: unknown }): string {
  const planZeile = plan ? `${Z.plan}: ${PL}` : `${Z.plan}: ohne — Planer lieferte keinen Plan`;
  return `${planZeile}\n${Z.review}: head=${head} runden=${runden} lenses=${lenses.join(",")} verdikt=ok`;
}

describe("(a) Das Format der SSOT ist das, was das Skript liest", () => {
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
  test("MAX_FIX_RUNDEN im Skript == 2 und der Skill nennt dasselbe Cap", () => {
    assert.equal(MAX_FIX_RUNDEN, 2);
    assert.match(read(".agents/skills/review-lenses/SKILL.md"), /\*\*Cap 2\*\* Fix-Runden, also höchstens 3 Pässe/);
  });
});

describe("(c) Pflicht-Lenses je Diff-Art", () => {
  const faelle: [string, unknown, string[]][] = [
    ["nur Markdown", ["AGENTS.md", "docs/a.md"], ["doku"]],
    ["gemischt", ["docs/a.md", "src/x.ts"], CODE],
    ["nur Code", ["src/x.ts"], CODE],
    ["leer", [], CODE],
    ["fehlend", undefined, CODE],
    ["kaputt", ["a.md", ""], CODE],
  ];
  for (const [name, dateien, erwartet] of faelle) {
    test(name, () => {
      assert.deepEqual([...pflichtLenses(dateien)], erwartet);
    });
  }
  test("der Skill nennt dieselbe Staffel (reiner Markdown-Diff: eine Lens Doku, sonst drei)", () => {
    assert.match(read(".agents/skills/review-lenses/SKILL.md"), /nur `\*\.md`-Dateien\*\* [^\n]*Lens 4 — Doku\*\*\. Sonst laufen \*\*Lens 1–3\*\*/);
  });
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
  test("der Review-Schritt ist vorletzt: danach folgt genau der Abnahme-Schritt", () => {
    const rest = job.slice(schritt);
    assert.equal(rest.split("\n      - name:").length - 1, 1, "nach dem Review-Schritt darf nur der Abnahme-Schritt folgen");
    assert.ok(rest.indexOf("check-abnahme-nachweis.mjs") > 0, "der folgende Schritt ist der Abnahme-Nachweis");
  });
  describe("Abnahme-Schritt (#1755, K7)", () => {
    const abn = job.indexOf("check-abnahme-nachweis.mjs");
    const kopf = job.lastIndexOf("      - name:", abn);
    const text = job.slice(kopf, abn + "check-abnahme-nachweis.mjs".length);
    test("im Required-Job build-test, nach dem Review-Schritt, als letzter Schritt, ohne eigenen Job", () => {
      assert.ok(abn > schritt, "muss nach dem Review-Schritt stehen");
      assert.ok(!job.slice(abn).includes("\n      - name:"), "nach dem Abnahme-Schritt darf kein weiterer Schritt folgen");
      assert.ok(!/\n {2}[a-z-]*abnahme[a-z-]*:/.test(ci), "kein eigener Job für die Abnahme");
    });
    test("Bedingung: !cancelled(), nur pull_request, Dependabot ausgenommen", () => {
      assert.match(text, /!cancelled\(\)/);
      assert.match(text, /github\.event_name == 'pull_request'/);
      assert.match(text, /dependabot\[bot\]/);
    });
    test("env: liefert Token, PR-Nummer, Entwurfs-Status und Body; im run: kein Ausdruck", () => {
      for (const k of ["GH_TOKEN", "FACTORY_PR_NUMBER", "FACTORY_PR_DRAFT", "FACTORY_PR_BODY"]) assert.match(text, new RegExp(`\n {10}${k}: \\$\\{\\{ `));
      const run = /\n\s+run: ([^\n]*)/.exec(text)?.[1] ?? "";
      assert.ok(run.includes("check-abnahme-nachweis.mjs") && !run.includes("${{"), "run: ohne Ausdruck");
    });
    test("Job-Rechte: pull-requests und issues lesend", () => {
      assert.match(job, /permissions:\n {6}contents: read\n {6}pull-requests: read\n {6}issues: read\n/);
    });
    test("pull_request löst auch bei ready_for_review aus", () => {
      assert.match(ci, /pull_request:\n {4}types: \[[^\]]*\bopened\b[^\]]*\bsynchronize\b[^\]]*\breopened\b[^\]]*\bready_for_review\b[^\]]*\]/);
    });
  });
});

describe("(e) Texte verweisen auf das Skript", () => {
  for (const datei of [".agents/skills/review-lenses/SKILL.md", ".claude/agents/factory-umsetzer.md", "docs/agent-harness.md"]) {
    test(datei, () => assert.match(read(datei), /check-review-nachweis/));
  }
});

describe("(e2) Das Feld blocker= ist an allen Stellen benannt (#1123)", () => {
  test("Format-SSOT und Skill nennen das Feld, die Vorlage des Prüfskripts auch", () => {
    assert.match(read("docs/agent-harness.md"), /blocker=architektur:<n>/);
    assert.match(read(".agents/skills/review-lenses/SKILL.md"), /`blocker`/);
    assert.match(read("scripts/check-review-nachweis.mjs"), /blocker=architektur:<n>,requirement-treue:<n>,test-adaequanz:<n>/);
  });
});

describe("(g) Der Konflikt-Merge nach dem Nachweis wird genau einmal erklärt (#1398)", () => {
  test("das Skript macht ihn rot (die Aussage „wird der Check rot“ ist verhaltensgedeckt)", () => {
    const n = parseNachweis(nachweisZeilen({ head: SHA, runden: 2, lenses: ["architektur", "requirement-treue", "test-adaequanz"], plan: "PLAN #1" }));
    const basis = { nachweis: n, dateien: ["src/a.ts"], headBekannt: true, headImSlice: true };
    assert.deepEqual(bewerteNachweis({ ...basis, konfliktMerges: [] }), []);
    assert.ok(bewerteNachweis({ ...basis, konfliktMerges: ["m".repeat(40)] }).length > 0, "ein Konflikt-Merge nach dem Review muss rot sein");
  });
  test("die Langfassung (§3a) trägt Erklärung und Folge, der Skill den Weg", () => {
    const harness = read("docs/agent-harness.md");
    assert.match(harness, /remerge-diff/);
    assert.match(harness, /wird der Check rot/);
    assert.match(harness, /Nach jedem Merge von `main`/, "§3a verweist auf die Schritte im Skill");
    const skill = read(".agents/skills/review-lenses/SKILL.md");
    assert.doesNotMatch(skill, /wird der Check rot/, "keine zweite Kopie der Erklärung im Skill");
    assert.doesNotMatch(skill, /git ≥ 2\.36/, "keine zweite Kopie der Erklärung im Skill");
    assert.match(skill, /git show --remerge-diff --format= <M>/, "der Skill trägt das Rezept");
    assert.match(read(".claude/agents/factory-umsetzer.md"), /`review-lenses` › Nach jedem Merge von `main`/, "der Umsetzer verweist auf den Skill-Abschnitt");
    assert.match(skill, /git diff <basis> <M>\^2 -- <alte datei>/, "der Skill trägt den Prüfschritt für verschobenen Code");
  });
  test("das Rezept im Skill ist an die Erkennung im Skript gekoppelt", () => {
    assert.match(read("scripts/slice-override.mjs"), /\["show", "--remerge-diff", "--format=", sha\]/);
  });
});

describe("(f) „Cap 2“ heißt immer Fix-Runden (#1309)", () => {
  /** Zeilen, die „Cap 2“ ohne „Fix-Runde“ nennen: ohne die Präzisierung liest man „2 Pässe“. */
  const unpraezise = (text: string) => text.split(/\r?\n/).filter((z) => z.includes("Cap 2") && !z.includes("Fix-Runde"));

  test("jede getrackte Agenten-/Harness-/Doku-Zeile mit „Cap 2“ nennt Fix-Runden", () => {
    const dateien = execFileSync("git", ["ls-files", ".claude", "AGENTS.md", "docs"], { encoding: "utf8", cwd: fileURLToPath(new URL("../../", import.meta.url)) })
      .split(/\r?\n/)
      .filter((d) => /\.(md|js)$/.test(d) && !d.startsWith("docs/adr/"));
    // Leerlauf-Schutz: jede verteilte Besitz-Datei des Scans liegt in der Liste (statt einer Größenschwelle des Projekts).
    const anker = besitzAnker((p) => /^(\.claude\/|AGENTS\.md$|docs\/)/.test(p) && /\.(md|js)$/.test(p) && !p.startsWith("docs/adr/"));
    for (const a of anker) assert.ok(dateien.includes(a), `Leerlauf-Schutz: ${a} liegt im Scan`);
    const treffer = dateien.flatMap((d) => unpraezise(read(d)).map((z) => `${d}: ${z.trim().slice(0, 80)}`));
    assert.deepEqual(treffer, []);
  });

  test("Erkennung greift (Red-Green)", () => {
    assert.equal(unpraezise("Konvergenzschleife (Cap 2)").length, 1);
    assert.equal(unpraezise("Cap 2 Fix-Runden, höchstens 3 Pässe").length, 0);
  });
});

describe("Das Feld blocker= im Nachweis (#1123)", () => {
  const DREI = "lenses=architektur,requirement-treue,test-adaequanz";
  const bewerteB = (review: string, dateien: string[]) =>
    bewerteNachweis({ nachweis: parseNachweis(`${Z.plan}: ${PL}\n${Z.review}: head=${SHA} ${review}`), dateien, headBekannt: true, headImSlice: true });

  test("blocker= je Brille wird angenommen, auch mit null, und stört die Brillen-Erkennung nicht", () => {
    const text = `${Z.review}: head=${SHA} runden=2 ${DREI} blocker=architektur:2,requirement-treue:0,test-adaequanz:0 verdikt=ok`;
    assert.deepEqual(parseNachweis(text).review?.lenses, ["architektur", "requirement-treue", "test-adaequanz"]);
    assert.deepEqual(bewerteB(`runden=2 ${DREI} blocker=architektur:2,requirement-treue:0,test-adaequanz:0 verdikt=ok`, ["src/x.ts"]), []);
    assert.deepEqual(bewerteB("runden=2 lenses=doku blocker=doku:1 verdikt=ok", ["docs/a.md"]), []);
  });

  test("darf NICHT passieren: blocker= nennt eine unbekannte Brille", () => {
    assert.match(bewerteB(`runden=2 ${DREI} blocker=foo:1 verdikt=ok`, ["src/x.ts"]).join(" "), /unbekannte Brille/);
  });

  test("ohne Feld bleibt der Nachweis gültig (optional)", () => {
    assert.deepEqual(bewerteB(`runden=1 ${DREI} verdikt=ok`, ["src/x.ts"]), []);
  });
});

describe("Tolerantes Lesen der Brillen (#1331)", () => {
  const lenses = (wert: string) => parseNachweis(`${Z.review}: head=${SHA} runden=1 lenses=${wert} verdikt=ok`).review?.lenses;
  const bewerte = (wert: string, dateien = ["src/a.ts"]) =>
    bewerteNachweis({ nachweis: parseNachweis(`${Z.plan}: ${PL}
${Z.review}: head=${SHA} runden=1 lenses=${wert} verdikt=ok`), dateien, headBekannt: true, headImSlice: true });

  test("Großschreibung, Leerzeichen nach Kommas und Umlaute werden normalisiert", () => {
    assert.deepEqual(lenses("Architektur, Requirement-Treue, Test-Adäquanz"), ["architektur", "requirement-treue", "test-adaequanz"]);
    assert.deepEqual(bewerte("Architektur, Requirement-Treue, Test-Adäquanz"), []);
    assert.deepEqual(lenses("Requirement Treue"), ["requirement-treue"]);
  });

  test("die Felder dahinter werden nicht in die Brillen gezogen", () => {
    const n = parseNachweis(`${Z.review}: lenses=architektur, doku verdikt=ok head=${SHA} runden=2`);
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

  test("die letzte Review-Zeile gewinnt (Korrektur per weiterem Nachweis-Commit)", () => {
    const text = `${Z.review}: head=${SHA} runden=1 lenses=Falsch verdikt=ok

${Z.review}: head=${SHA} runden=1 lenses=doku verdikt=ok`;
    assert.deepEqual(parseNachweis(text).review?.lenses, ["doku"]);
  });
});

describe("(f) BEKANNTE_LENSES == die Brillen-Keys der Format-SSOT (#1349)", () => {
  /** Alle Brillen-Keys, die die Format-SSOT hinter `lenses=` nennt. */
  const keysDerSsot = (md: string) => [...new Set([...md.matchAll(/lenses=([a-z-]+(?:,[a-z-]+)*)/g)].flatMap((m) => m[1].split(",")))].sort();
  const ssot = read("docs/agent-harness.md");

  test("die Menge im Skript gleicht den Brillen-Keys im Nachweis-Format von agent-harness.md §3a", () => {
    const { BEKANNTE_LENSES } = raw as { BEKANNTE_LENSES: string[] };
    assert.deepEqual([...BEKANNTE_LENSES].sort(), keysDerSsot(ssot));
    assert.ok(keysDerSsot(ssot).length >= 4, "Key-Extraktion greift (nicht still leer)");
  });

  test("darf NICHT passieren: eine umbenannte oder zusätzliche Brille in der SSOT macht den Abgleich rot", () => {
    const { BEKANNTE_LENSES } = raw as { BEKANNTE_LENSES: string[] };
    const umbenannt = ssot.replace("lenses=doku ", "lenses=dokumentation ");
    assert.notDeepEqual([...BEKANNTE_LENSES].sort(), keysDerSsot(umbenannt));
    const zusaetzlich = `${ssot}\nlenses=security`;
    assert.notDeepEqual([...BEKANNTE_LENSES].sort(), keysDerSsot(zusaetzlich));
  });
});

describe("Zusatzpässe über das Cap, ohne Rückfrage (#1561 Z2, #1693)", () => {
  const bewerteZ = (review: string, dateien = ["src/a.ts"]) =>
    bewerteNachweis({
      nachweis: parseNachweis(`${Z.plan}: ${PL}\n${Z.review}: head=${SHA} ${review}`),
      dateien,
      headBekannt: true,
      headImSlice: true,
    });
  const LENSES = "lenses=architektur,requirement-treue,test-adaequanz";

  test("runden=4 ohne Feld ist rot, die Meldung nennt zusatzpass= samt Ursache, ohne Freigabe der Maintainerin zu verlangen", () => {
    const m = bewerteZ(`runden=4 ${LENSES} verdikt=ok`).join(" ");
    assert.match(m, /zusatzpass=<anzahl>:<Ursache>/);
    assert.doesNotMatch(m, /Maintainerin/);
  });
  test("runden=4 mit zusatzpass=1:<Grund> ist ok, der Grund darf Leerzeichen tragen", () => {
    assert.deepEqual(bewerteZ(`runden=4 zusatzpass=1:Maintainerin gab Pass frei ${LENSES} verdikt=ok`), []);
    assert.deepEqual(bewerteZ(`runden=4 ${LENSES} zusatzpass=1:Maintainerin gab Pass frei verdikt=ok`), []);
  });
  test("runden=5 mit zusatzpass=1 ist rot, mit zusatzpass=2 ok", () => {
    assert.match(bewerteZ(`runden=5 zusatzpass=1:x ${LENSES} verdikt=ok`).join(" "), /überschreitet/);
    assert.deepEqual(bewerteZ(`runden=5 zusatzpass=2:x ${LENSES} verdikt=ok`), []);
  });
  test("die Gate-Meldung nennt die Zahl der Zusatzpässe aus MAX_ZUSATZPAESSE", () => {
    const m = bewerteZ(`runden=4 ${LENSES} verdikt=ok`).join(" ");
    assert.ok(m.includes(`Bis zu ${MAX_ZUSATZPAESSE} Zusatzpässe`), m);
  });
  test("rot: Anzahl 0, leerer Grund, keine Zahl", () => {
    for (const w of ["0:x", "1:", "1:   ", "abc", "x:y", ""]) {
      assert.match(bewerteZ(`runden=4 zusatzpass=${w} ${LENSES} verdikt=ok`).join(" "), /zusatzpass/, w);
    }
  });
  test("rot: Zusatzpass ohne Überschreitung (runden ≤ 3)", () => {
    assert.match(bewerteZ(`runden=3 zusatzpass=1:x ${LENSES} verdikt=ok`).join(" "), /zusatzpass ist nur/);
  });
  test("das Feld vor lenses= verschiebt die Brillen-Erkennung nicht", () => {
    const n = parseNachweis(`${Z.review}: head=${SHA} runden=4 zusatzpass=1:Grund mit Wörtern ${LENSES} verdikt=ok`);
    assert.deepEqual(n.review?.lenses, ["architektur", "requirement-treue", "test-adaequanz"]);
  });
  test("die Vorlage des Skripts führt kein Feld zusatzpass (kein Standardweg)", () => {
    assert.doesNotMatch(read("scripts/check-review-nachweis.mjs").split("export const vorlage")[1].split(";")[0], /zusatzpass/);
  });
});

describe("Abnahme-Fix: eigenes Budget von einer Delta-Runde neben dem Review-Cap (#1808)", () => {
  const bewerteA = (review: string) =>
    bewerteNachweis({
      nachweis: parseNachweis(`${Z.plan}: ${PL}\n${Z.review}: head=${SHA} ${review}`),
      dateien: ["src/a.ts"],
      headBekannt: true,
      headImSlice: true,
    });
  const LENSES = "lenses=architektur,requirement-treue,test-adaequanz";

  test("runden=4 mit abnahmefix=1 ist ok (Review-Cap voll, Abnahme-Fix als eigene Runde)", () => {
    assert.deepEqual(bewerteA(`runden=4 abnahmefix=1 ${LENSES} verdikt=ok`), []);
  });
  test("runden=5 mit abnahmefix=1 bleibt rot: ein zweiter Abnahme-Fix-Pass gehört nicht zum Budget", () => {
    assert.match(bewerteA(`runden=5 abnahmefix=1 ${LENSES} verdikt=ok`).join(" "), /überschreitet/);
  });
  test("Review-Zusatzpass und Abnahme-Fix addieren sich: runden=5 mit zusatzpass=1 und abnahmefix=1 ist ok, runden=6 rot", () => {
    assert.deepEqual(bewerteA(`runden=5 zusatzpass=1:x abnahmefix=1 ${LENSES} verdikt=ok`), []);
    assert.match(bewerteA(`runden=6 zusatzpass=1:x abnahmefix=1 ${LENSES} verdikt=ok`).join(" "), /überschreitet/);
  });
  test("rot: Wert ungleich 1 (0, 2, keine Zahl, leer)", () => {
    for (const w of ["0", "2", "abc", ""]) {
      assert.match(bewerteA(`runden=4 abnahmefix=${w} ${LENSES} verdikt=ok`).join(" "), /abnahmefix/, w);
    }
  });
  test("rot: abnahmefix ohne Überschreitung des Review-Caps (runden ≤ 3, oder ≤ 3 + zusatzpass)", () => {
    assert.match(bewerteA(`runden=3 abnahmefix=1 ${LENSES} verdikt=ok`).join(" "), /abnahmefix ist nur/);
    assert.match(bewerteA(`runden=4 zusatzpass=1:x abnahmefix=1 ${LENSES} verdikt=ok`).join(" "), /abnahmefix ist nur/);
  });
  test("ohne das Feld bleibt runden=4 rot (Abnahme-Fix ist kein Freibrief für Review-Pässe)", () => {
    assert.match(bewerteA(`runden=4 ${LENSES} verdikt=ok`).join(" "), /überschreitet/);
  });
  test("der Parser liefert das Feld, die Vorlage führt es nicht", () => {
    assert.equal((parseNachweis(`${Z.review}: head=${SHA} runden=4 abnahmefix=1 ${LENSES} verdikt=ok`).review as { abnahmefix?: unknown } | null)?.abnahmefix, 1);
    assert.doesNotMatch(read("scripts/check-review-nachweis.mjs").split("export const vorlage")[1].split(";")[0], /abnahmefix/);
  });
  test("Skill, Format-SSOT und Umsetzer nennen das Feld", () => {
    assert.match(read("docs/agent-harness.md"), /abnahmefix=/);
    assert.match(read(".agents/skills/review-lenses/SKILL.md"), /abnahmefix=/);
    assert.match(read(".claude/agents/factory-umsetzer.md"), /abnahmefix=/);
  });
});

describe("(e3) Das Feld zusatzpass= ist dokumentiert (#1561 Z2)", () => {
  test("Format-SSOT und Skill nennen das Feld", () => {
    assert.match(read("docs/agent-harness.md"), /zusatzpass=/);
    assert.match(read(".agents/skills/review-lenses/SKILL.md"), /zusatzpass=/);
  });
});

describe("Zusatzpass: Rückgabefeld und CLI-Zeile (#1572 Z11)", () => {
  const BASE = "b".repeat(40);
  const LENSES = "lenses=architektur,requirement-treue,test-adaequanz";
  /** Gefälschtes git für `checkReviewNachweis`: ein Code-Slice (src/a.ts) und ein Nachweis-Commit mit der gegebenen Review-Zeile. */
  const fakeGit = (review: string) => (a: string[]): string => {
    const j = a.join(" ");
    if (j.startsWith("merge-base")) return BASE;
    if (j === "rev-parse HEAD") return "d".repeat(40);
    if (j.startsWith("log --reverse")) return `${Z.plan}: ${PL}\n${Z.review}: head=${SHA} ${review}\n`;
    if (j.startsWith("diff --name-only")) return "src/a.ts\n";
    if (j.startsWith("rev-parse --verify")) return SHA;
    if (j.startsWith("rev-list --count")) return "1";
    if (j.startsWith("rev-list --merges")) return "";
    if (j.startsWith("rev-list --reverse --no-merges")) return ""; // keine Commits nach dem Nachweis-head (#1740 L17)
    if (j.startsWith("rev-list")) return `${SHA}\n`;
    throw new Error(`unerwartet: ${j}`);
  };

  test("gültiger Zusatzpass: das Feld trägt den Grund (Rückgabe von checkReviewNachweis)", () => {
    const r = checkReviewNachweis({ runGit: fakeGit(`runden=4 zusatzpass=1:Maintainerin gab Pass frei ${LENSES} verdikt=ok`), env: {} });
    assert.equal(r.ok, true);
    assert.equal(r.zusatzpass?.grund, "Maintainerin gab Pass frei");
  });
  test("ohne Zusatzpass oder mit ungültigem: das Feld ist null", () => {
    assert.equal(checkReviewNachweis({ runGit: fakeGit(`runden=2 ${LENSES} verdikt=ok`), env: {} }).zusatzpass, null);
    const ungueltig = checkReviewNachweis({ runGit: fakeGit(`runden=4 zusatzpass=0 ${LENSES} verdikt=ok`), env: {} });
    assert.equal(ungueltig.ok, false);
    assert.equal(ungueltig.zusatzpass, null);
  });

  /** Echtes Temp-Repo: main mit einem Commit, Feature-Branch mit Code-Commit und leerem Nachweis-Commit. */
  function cliAusgabe(review: string, echt = false): string {
    const e = echt ? projektConfig() : FREMD;
    const zeilen = commitZeilen(e.praefixe.commitZeile, e.agenten.planer);
    const dir = mkdtempSync(join(tmpdir(), "nachweis-"));
    try {
      const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" });
      git("init", "-q", "-b", "main");
      git("commit", "-q", "--allow-empty", "-m", "basis");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("checkout", "-q", "-b", "feature/x");
      git("commit", "-q", "--allow-empty", "-m", "umsetzung");
      const head = git("rev-parse", "HEAD").trim();
      git("commit", "-q", "--allow-empty", "-m", `nachweis\n\n${zeilen.plan}: ${e.agenten.planer}\n${zeilen.review}: head=${head} ${review}`);
      const env = { ...process.env };
      ohneKernEnv(env, "FACTORY_DIFF_BASE");
      return execFileSync("node", [fileURLToPath(new URL("../../scripts/check-review-nachweis.mjs", import.meta.url)), ...(echt ? [] : ["--config", FREMD_CONFIG_PFAD])], { cwd: dir, env, encoding: "utf8" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("die CLI-Zeile nennt den Zusatzpass samt Grund, ohne Zusatzpass keine solche Zeile (im Prozess)", () => {
    const zeile = (review: string) => zusatzpassZeile(checkReviewNachweis({ runGit: fakeGit(review), env: {} }));
    assert.match(zeile(`runden=4 zusatzpass=1:Maintainerin gab Pass frei ${LENSES} verdikt=ok`) ?? "", /^• Zusatzpass: Maintainerin gab Pass frei$/);
    assert.equal(zeile(`runden=1 ${LENSES} verdikt=ok`), null);
  });

  // Ein einziger echter Prozess-Smoke (Kaltstart von git und node unter Last braucht Luft).
  test("CLI-Smoke: der Prozess gibt die Zusatzpass-Zeile aus", { timeout: 30_000 }, () => {
    assert.match(cliAusgabe(`runden=4 zusatzpass=1:Maintainerin gab Pass frei ${LENSES} verdikt=ok`), /• Zusatzpass: Maintainerin gab Pass frei/);
  });
  test("CLI-Standardpfad ohne --config: der Prozess liest die echte Config", { timeout: 30_000 }, () => {
    assert.match(cliAusgabe(`runden=4 zusatzpass=1:Maintainerin gab Pass frei ${LENSES} verdikt=ok`, true), /• Zusatzpass: Maintainerin gab Pass frei/);
  });
});

describe("Drift: die Zahlen im Satz der Lens-Zahl in docs/model-routing.md == die Konstanten (#1814)", () => {
  const SATZ = /mehr als (\d+) Review-Runden \((\d+) Pässe, höchstens (\d+) Zusatzpässe, 1 Abnahme-Fix-Pass; `MAX_RUNDEN`\)/;
  /** Liefert die Konstanten, deren Zahl im Satz abweicht; bei fehlendem Satz eine eigene Meldung. Pur. */
  const abweichungen = (text: string): string[] => {
    const m = SATZ.exec(text);
    if (!m) return ["Satz zur Lens-Zahl fehlt"];
    const soll = [MAX_RUNDEN, MAX_REVIEW_PAESSE, MAX_ZUSATZPAESSE];
    return ["MAX_RUNDEN", "MAX_REVIEW_PAESSE", "MAX_ZUSATZPAESSE"].filter((_, i) => Number(m[i + 1]) !== soll[i]);
  };
  const satz = (a: number, b: number, c: number) => `mehr als ${a} Review-Runden (${b} Pässe, höchstens ${c} Zusatzpässe, 1 Abnahme-Fix-Pass; \`MAX_RUNDEN\`)`;
  test("der echte Satz stimmt mit den Konstanten überein", () => {
    assert.deepEqual(abweichungen(read("docs/model-routing.md")), []);
  });
  test("fehlender Satz und abweichende Zahlen sind rot", () => {
    assert.deepEqual(abweichungen("kein Satz"), ["Satz zur Lens-Zahl fehlt"]);
    assert.deepEqual(abweichungen(satz(MAX_RUNDEN, MAX_REVIEW_PAESSE, MAX_ZUSATZPAESSE)), []);
    assert.deepEqual(abweichungen(satz(MAX_RUNDEN + 1, MAX_REVIEW_PAESSE, MAX_ZUSATZPAESSE)), ["MAX_RUNDEN"]);
    assert.deepEqual(abweichungen(satz(MAX_RUNDEN, MAX_REVIEW_PAESSE + 1, MAX_ZUSATZPAESSE + 1)), ["MAX_REVIEW_PAESSE", "MAX_ZUSATZPAESSE"]);
  });
});
