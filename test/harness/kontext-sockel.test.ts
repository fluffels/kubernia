/* Kontext-Sockel-Wächter (#1198) – der Grundkontext jeder Session darf nicht still wachsen.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Gemessen (docs/model-routing.md §5): Skill-Listing, Tool-Schemas und MCP-Namen stehen
 * vor dem ersten Call jeder Session im Kontext und werden bei jedem der 100–250 Calls
 * neu gelesen. Repo-seitig steuerbar sind drei Hebel, die hier festgenagelt werden:
 *
 *   1. Subagenten bekommen eine `tools:`-Whitelist (ohne `*`, `Skill`, `Artifact`).
 *   2. Beschreibungen von Repo-Skills, Agenten und Workflow bleiben kurz.
 *   3. Die gemessen wirksamen Schalter in `.claude/settings.json` bleiben gesetzt.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const lies = (rel: string): string => readFileSync(root + rel, "utf8");

export const MAX_BESCHREIBUNG = 300;

/** Liest eine einzeilige Frontmatter-Zeile `key: wert`; `null`, wenn sie fehlt. */
export function frontmatterZeile(text: string, key: string): string | null {
  const kopf = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const treffer = new RegExp("^" + key + ": *(.*)$", "m").exec(kopf);
  return treffer ? treffer[1].trim() : null;
}

/** Findet unzulässige Einträge einer `tools:`-Zeile (Wildcard, Skill, Artifact) bzw. eine fehlende Liste. */
export function toolsProbleme(tools: string | null): string[] {
  if (tools === null || tools === "") return ["keine tools:-Whitelist"];
  const probleme: string[] = [];
  for (const t of tools.split(",").map((s) => s.trim())) {
    if (t === "*" || t === "Skill" || t === "Artifact") probleme.push(`unzulässiges Tool ${t}`);
  }
  return probleme;
}

const agenten = readdirSync(root + ".claude/agents").filter((f) => f.endsWith(".md"));
const skills = readdirSync(root + ".claude/skills");

describe("Kontext-Sockel (#1198)", () => {
  test("jeder Agent hat eine Tool-Whitelist ohne *, Skill und Artifact", () => {
    assert.ok(agenten.length > 0);
    for (const f of agenten) {
      const text = lies(`.claude/agents/${f}`);
      assert.deepEqual(toolsProbleme(frontmatterZeile(text, "tools")), [], f);
    }
  });

  test("Agent-Beschreibungen sind höchstens 300 Zeichen lang", () => {
    for (const f of agenten) {
      const d = frontmatterZeile(lies(`.claude/agents/${f}`), "description") ?? "";
      assert.ok(d.length > 0 && d.length <= MAX_BESCHREIBUNG, `${f}: ${d.length} Zeichen`);
    }
  });

  test("Skill-Beschreibungen sind höchstens 300 Zeichen lang", () => {
    for (const s of skills) {
      const d = frontmatterZeile(lies(`.claude/skills/${s}/SKILL.md`), "description") ?? "";
      assert.ok(d.length > 0 && d.length <= MAX_BESCHREIBUNG, `${s}: ${d.length} Zeichen`);
    }
  });

  test("Workflow-whenToUse ist höchstens 300 Zeichen lang", () => {
    const m = /whenToUse:\s*'([^']*)'/.exec(lies(".claude/workflows/kubernia-ticket.js"));
    assert.ok(m, "whenToUse nicht gefunden");
    assert.ok(m[1].length <= MAX_BESCHREIBUNG, `${m[1].length} Zeichen`);
  });

  test("die gemessen wirksamen Schalter in settings.json bleiben gesetzt", () => {
    const s = JSON.parse(lies(".claude/settings.json")) as Record<string, unknown>;
    assert.equal(s.disableClaudeAiConnectors, true);
    assert.equal(s.skillListingMaxDescChars, 300);
    const plugins = s.enabledPlugins as Record<string, boolean>;
    assert.equal(plugins["data@synced"], false);
    assert.equal(plugins["cowork-plugin-management@synced"], false);
  });

  describe("Hilfsfunktionen (Negativfälle)", () => {
    test("toolsProbleme meldet fehlende Liste, Wildcard, Skill und Artifact", () => {
      assert.deepEqual(toolsProbleme(null), ["keine tools:-Whitelist"]);
      assert.deepEqual(toolsProbleme(""), ["keine tools:-Whitelist"]);
      assert.deepEqual(toolsProbleme("*"), ["unzulässiges Tool *"]);
      assert.deepEqual(toolsProbleme("Read, Skill, Artifact"), [
        "unzulässiges Tool Skill",
        "unzulässiges Tool Artifact",
      ]);
      assert.deepEqual(toolsProbleme("Read, Grep, Agent"), []);
    });

    test("frontmatterZeile liest nur den Kopf und meldet Fehlendes als null", () => {
      const t = "---\nname: x\ntools: Read\n---\ntools: Bash";
      assert.equal(frontmatterZeile(t, "tools"), "Read");
      assert.equal(frontmatterZeile(t, "model"), null);
      assert.equal(frontmatterZeile("kein Kopf", "name"), null);
    });
  });
});
