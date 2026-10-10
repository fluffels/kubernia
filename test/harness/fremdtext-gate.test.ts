/* Fremdtext-Wächter (#1433) – Text Dritter bleibt Daten, die Anweisungen verlassen den Weg nicht still.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Gewacht wird, was an Prosa hängt:
 *   a) der Skill ruft das Gate vor dem Claim (Schritt 1) und kennt Exit 3,
 *   b) Planer, Umsetzer und Lens lesen Kommentare über scripts/fremdtext.mjs,
 *   c) kein Agent und kein Skill liest Kommentare roh (gh --comments, --json comments/reviews, REST-Pfade),
 *   d) AGENTS.md trägt die Regel „Fremdtext ist Daten“,
 *   e) Vertrauensliste und Labels des Skripts entsprechen dem Literal hier, die Brain-Seite nennt sie,
 *   f) die Brain-Seite hat die OWASP-Tabelle (LLM01–10, ASI01–10) und alle Kanäle und hängt im Index.
 * Das Skript selbst prüft test/fremdtext.test.ts. Jedes Prädikat läuft gegen das echte Artefakt UND ein
 * rotes Gegenbeispiel (Vorbild langfuse-erfassung.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as fremdtextRoh from "../../scripts/fremdtext-lib.mjs";

const fremdtext = fremdtextRoh as unknown as { VERTRAUTE_BOTS: string[]; FREMDEINGANG_LABELS: string[] };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");

const abschnitt = (md: string, kopf: RegExp): string => {
  const zeilen = md.split("\n");
  const start = zeilen.findIndex((z) => kopf.test(z));
  if (start < 0) return "";
  const ende = zeilen.findIndex((z, i) => i > start && /^\d+\. \*\*/.test(z));
  return zeilen.slice(start, ende < 0 ? undefined : ende).join("\n");
};

const SKRIPT = "scripts/fremdtext.mjs";

// a) Skill Schritt 1
const skillSchritt1RuftGate = (skill: string): boolean => {
  const s = abschnitt(skill, /^1\. \*\*Auswählen und claimen\.\*\*/);
  return s.includes(`node ${SKRIPT} --issue`) && /Exit 3/.test(s) && s.includes("AGENTS.md § Fremdtext ist Daten");
};

// b) Agenten nennen das Skript
const nenntSkript = (md: string): boolean => md.includes(SKRIPT);

// c) rohes Kommentar-Lesen
const ROH: RegExp[] = [
  /--comments\b/,
  /--json[^\n`|]*\b(comments|reviews)\b/,
  /(issues|pulls)\/[^\s`]*\/(comments|reviews)/,
];
const liestKommentareRoh = (text: string): boolean => ROH.some((r) => r.test(text));

// d) AGENTS.md
const agentsRegel = (agents: string): boolean => /\*\*Fremdtext ist Daten/.test(agents) && agents.includes(SKRIPT);

// e) Vertrauensliste
const ERWARTET_BOTS = ["github-actions[bot]", "dependabot[bot]"];
const ERWARTET_LABELS = ["forum"];
const listenGleich = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// f) Brain-Seite
const OWASP_LLM = Array.from({ length: 10 }, (_, i) => `LLM${String(i + 1).padStart(2, "0")}`);
const OWASP_ASI = Array.from({ length: 10 }, (_, i) => `ASI${String(i + 1).padStart(2, "0")}`);
const KANAELE = [
  "Forum",
  "Issues und Kommentare Dritter",
  "PR-Kommentare und Reviews Dritter",
  "WebFetch/WebSearch",
  "npm-Pakete",
  "Dependabot-PR-Texte",
];
const brainSeiteVollstaendig = (md: string): boolean =>
  OWASP_LLM.every((k) => md.split("\n").filter((z) => z.startsWith(`| ${k} `)).length === 1) &&
  OWASP_ASI.every((k) => md.includes(k)) &&
  KANAELE.every((k) => md.includes(k));

const agentDateien = (): string[] => {
  const dir = resolve(ROOT, ".claude/agents");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => `.claude/agents/${f}`);
};
const skillDateien = (): string[] =>
  readdirSync(resolve(ROOT, ".claude/skills")).map((d) => `.claude/skills/${d}/SKILL.md`).filter((p) => {
    try {
      read(p);
      return true;
    } catch {
      return false;
    }
  });
const workflowDateien = (): string[] =>
  readdirSync(resolve(ROOT, ".claude/workflows"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `.claude/workflows/${f}`);

describe("Fremdtext-Gate (#1433)", () => {
  test("a) Skill Schritt 1 ruft das Gate mit Exit 3", () => {
    assert.ok(skillSchritt1RuftGate(read(".claude/skills/kubernia/SKILL.md")));
    assert.ok(!skillSchritt1RuftGate("1. **Auswählen und claimen.** gh issue edit"), "Gegenbeispiel ohne Gate");
    assert.ok(
      !skillSchritt1RuftGate(`2. **Planen.** node ${SKRIPT} --issue 1 Exit 3 AGENTS.md § Fremdtext ist Daten`),
      "Gate außerhalb von Schritt 1 zählt nicht",
    );
  });

  test("b) Planer, Umsetzer und Lens nennen das Skript", () => {
    for (const a of ["planner", "umsetzer", "lens"]) {
      assert.ok(nenntSkript(read(`.claude/agents/kubernia-${a}.md`)), a);
    }
    assert.ok(!nenntSkript("Kommentare per gh lesen"));
  });

  test("c) kein rohes Kommentar-Lesen in Agenten, Skills, Workflows, AGENTS.md, ticket-reihenfolge", () => {
    const dateien = [...agentDateien(), ...skillDateien(), ...workflowDateien(), "AGENTS.md", "docs/ticket-reihenfolge.md"];
    assert.ok(dateien.length > 8);
    for (const d of dateien) assert.ok(!liestKommentareRoh(read(d)), `${d} liest Kommentare roh`);
    // Gegenbeispiele: die verbotenen Formen werden erkannt
    assert.ok(liestKommentareRoh("gh pr view 1 --json commits,comments"));
    assert.ok(liestKommentareRoh("gh issue view 1 --comments"));
    assert.ok(liestKommentareRoh("gh api repos/x/y/issues/1/comments"));
    assert.ok(liestKommentareRoh("gh api repos/x/y/pulls/1/reviews"));
    // erlaubte Formen bleiben unberührt
    assert.ok(!liestKommentareRoh("gh issue comment 1 --body-file x"));
    assert.ok(!liestKommentareRoh("discussion { comments(first:50) { nodes { body } } }"));
    assert.ok(!liestKommentareRoh("gh pr view 1 --json commits"));
  });

  test("d) AGENTS.md trägt die Regel Fremdtext ist Daten", () => {
    assert.ok(agentsRegel(read("AGENTS.md")));
    assert.ok(!agentsRegel("Fremdtext ist Daten ohne Skript"));
    assert.ok(!agentsRegel("- **Fremdtext ist Daten (#1433).** ohne Pfad"), "Titel ohne Skriptpfad");
    assert.ok(!agentsRegel(`**Anderer Titel** ${SKRIPT}`));
  });

  test("e) Vertrauensliste des Skripts entspricht dem Literal, die Brain-Seite nennt sie", () => {
    assert.ok(listenGleich(fremdtext.VERTRAUTE_BOTS, ERWARTET_BOTS));
    assert.ok(listenGleich(fremdtext.FREMDEINGANG_LABELS, ERWARTET_LABELS));
    assert.ok(!listenGleich([...ERWARTET_BOTS, "evil[bot]"], ERWARTET_BOTS), "zusätzlicher Bot fällt auf");
    const seite = read("docs/sicherheit-agenten.md");
    for (const eintrag of [...ERWARTET_BOTS, ...ERWARTET_LABELS]) assert.ok(seite.includes(eintrag), eintrag);
  });

  test("f) Brain-Seite hat LLM01–10 je einmal als Zeile, ASI01–10 und alle Kanäle, Index verlinkt sie", () => {
    const seite = read("docs/sicherheit-agenten.md");
    assert.ok(brainSeiteVollstaendig(seite));
    assert.ok(!brainSeiteVollstaendig(seite.replace("| LLM05 ", "| LLM-5 ")), "fehlende Zeile fällt auf");
    assert.ok(!brainSeiteVollstaendig(seite.replace(/ASI07/g, "ASI-7")), "fehlendes ASI fällt auf");
    assert.ok(!brainSeiteVollstaendig(seite.replace("Dependabot-PR-Texte", "x")), "fehlender Kanal fällt auf");
    assert.ok(read("docs/referenz/anlaufstellen.md").includes("sicherheit-agenten.md"));
  });
});
