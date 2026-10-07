/* Kontext-Sockel-Wächter (#1198) – der Grundkontext jeder Session darf nicht still wachsen.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Gemessen (docs/model-routing.md §5): Skill-Listing, Tool-Schemas und MCP-Namen stehen
 * vor dem ersten Call jeder Session im Kontext und werden bei jedem der 100–250 Calls
 * neu gelesen. Repo-seitig steuerbar sind drei Hebel, die hier festgenagelt werden:
 *
 *   1. Subagenten bekommen eine `tools:`-Whitelist (ohne `*`, `Skill`, `Artifact`, MCP-Wildcards).
 *   2. Beschreibungen von Repo-Skills, Agenten und Workflows bleiben kurz (einzeilig, ≤ 300 Zeichen).
 *   3. Die gemessen wirksamen Schalter in `.claude/settings.json` bleiben gesetzt.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { parseFrontmatter } from "../../scripts/docs-gen/markdown.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const lies = (rel: string): string => readFileSync(root + rel, "utf8");

/** Obergrenze = der Schalter `skillListingMaxDescChars` (unten gegen settings.json geprüft). */
export const MAX_BESCHREIBUNG = 300;

/** Liest eine einzeilige Frontmatter-Zeile `key: wert` (ohne Anführungszeichen); `null`, wenn sie fehlt.
 *  Mehrzeilige YAML-Werte (`>`, `|`) würden die Längenprüfung umgehen und werfen deshalb. */
export function frontmatterZeile(text: string, key: string): string | null {
  const kopf = parseFrontmatter(text) as Record<string, string>;
  if (!Object.hasOwn(kopf, key)) return null;
  const wert = kopf[key];
  if (/^[>|]/.test(wert)) throw new Error(`${key}: mehrzeiliger YAML-Wert nicht erlaubt, einzeilig schreiben`);
  return wert;
}

/** Findet unzulässige Einträge einer `tools:`-Zeile (Wildcard, Skill, Artifact, MCP-Wildcard) bzw. eine fehlende Liste. */
export function toolsProbleme(tools: string | null): string[] {
  if (tools === null || tools === "") return ["keine tools:-Whitelist"];
  const probleme: string[] = [];
  for (const roh of tools.split(",")) {
    const t = roh.trim().replace(/^\[|\]$/g, "").replace(/^["']|["']$/g, "").trim();
    const serverOhneTool = t.startsWith("mcp__") && !t.slice(5).includes("__"); // `mcp__<server>` = Server-Wildcard
    if (t === "*" || t.startsWith("Skill") || t === "Artifact" || t.endsWith("__*") || serverOhneTool) {
      probleme.push(`unzulässiges Tool ${t}`);
    }
  }
  return probleme;
}

const agenten = readdirSync(root + ".claude/agents").filter((f) => f.endsWith(".md"));
const workflows = readdirSync(root + ".claude/workflows").filter((f) => f.endsWith(".js"));
const skills = readdirSync(root + ".claude/skills", { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe("Kontext-Sockel (#1198)", () => {
  test("jeder Agent hat eine Tool-Whitelist ohne *, Skill, Artifact und MCP-Wildcards", () => {
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
    assert.ok(workflows.length > 0);
    for (const w of workflows) {
      const m = /whenToUse:\s*'((?:[^'\\]|\\.)*)'/.exec(lies(`.claude/workflows/${w}`));
      assert.ok(m, `${w}: whenToUse nicht gefunden`);
      const laenge = m[1].replace(/\\(.)/g, "$1").length;
      assert.ok(laenge <= MAX_BESCHREIBUNG, `${w}: ${laenge} Zeichen`);
    }
  });

  test("die gemessen wirksamen Schalter in settings.json bleiben gesetzt", () => {
    const s = JSON.parse(lies(".claude/settings.json")) as Record<string, unknown>;
    assert.equal(s.disableClaudeAiConnectors, true);
    assert.equal(s.skillListingMaxDescChars, MAX_BESCHREIBUNG);
    const plugins = s.enabledPlugins as Record<string, boolean>;
    assert.equal(plugins["data@synced"], false);
    assert.equal(plugins["cowork-plugin-management@synced"], false);
  });

  describe("Hilfsfunktionen (Negativfälle)", () => {
    test("toolsProbleme meldet fehlende Liste, Wildcard, Skill, Artifact und MCP-Wildcards", () => {
      assert.deepEqual(toolsProbleme(null), ["keine tools:-Whitelist"]);
      assert.deepEqual(toolsProbleme(""), ["keine tools:-Whitelist"]);
      assert.deepEqual(toolsProbleme("*"), ["unzulässiges Tool *"]);
      assert.deepEqual(toolsProbleme("Read, Skill, Artifact"), [
        "unzulässiges Tool Skill",
        "unzulässiges Tool Artifact",
      ]);
      assert.deepEqual(toolsProbleme('"*"'), ["unzulässiges Tool *"]);
      assert.deepEqual(toolsProbleme("[Read, Skill]"), ["unzulässiges Tool Skill"]);
      assert.deepEqual(toolsProbleme("Read, Skill(forum)"), ["unzulässiges Tool Skill(forum)"]);
      assert.deepEqual(toolsProbleme("Read, mcp__pixellab__*"), ["unzulässiges Tool mcp__pixellab__*"]);
      assert.deepEqual(toolsProbleme("Read, mcp__playwright"), ["unzulässiges Tool mcp__playwright"]);
      assert.deepEqual(toolsProbleme("mcp__playwright__browser_click, mcp__claude_ai_Notion__fetch"), []);
      assert.deepEqual(toolsProbleme("Read, Grep, Agent"), []);
    });

    test("frontmatterZeile liest nur den Kopf, entfernt Quotes und meldet Fehlendes als null", () => {
      const t = "---\nname: x\ntools: Read\n---\ntools: Bash";
      assert.equal(frontmatterZeile(t, "tools"), "Read");
      assert.equal(frontmatterZeile(t, "model"), null);
      assert.equal(frontmatterZeile("kein Kopf", "name"), null);
      assert.equal(frontmatterZeile('---\ndescription: "Text"\n---', "description"), "Text");
    });

    test("frontmatterZeile verweigert mehrzeilige YAML-Werte (Längenumgehung)", () => {
      assert.throws(() => frontmatterZeile("---\ndescription: >\n  lang\n---", "description"), /mehrzeilig/);
      assert.throws(() => frontmatterZeile("---\ndescription: |-\n  lang\n---", "description"), /mehrzeilig/);
    });
  });
});
