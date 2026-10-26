/* MCP-Module und Sandbox-Ergänzung des Projekts (#1931, ADR 0022 F10): die projekteigenen Werte hinter den Kern-Wächtern.
 *
 * @harness-waechter – Projekt-Test (bleibt im Projekt, zieht nicht ins Factory-Repo): er prüft die echten Werte der Projekt-Config
 * (Block `berechtigungen` und `sandbox`) gegen `.claude/settings.json` und die Sandbox-Tabelle in `docs/agent-harness.md`. Die projektneutralen
 * Regeln stehen im Factory-Repo (`berechtigungen-kern.test.ts`, `settings-permissions.test.ts` und `sandbox-settings.test.ts`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { mcpSkripte } from "./hook-importe";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";

const pc = rawPc as unknown as {
  berechtigungenAus(config: unknown): { allow: string[]; ask: string[]; deny: string[] };
  sandboxAus(config: unknown): { allowedDomains: string[]; envVars: { name: string; mode: string }[] };
};

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lese = (rel: string): string => readFileSync(`${WURZEL}${rel}`, "utf8");
const config = JSON.parse(lese(".factory/projekt.json")) as unknown;
const settings = JSON.parse(lese(".claude/settings.json")) as { permissions: { deny?: string[] } };

/** Die Domains der Tabellenzeilen mit Quelle „Ergänzung“ im Abschnitt „Agenten-Sandbox (WSL2)“. */
const ergaenzungsZeilen = (doku: string): string[] => {
  const start = doku.indexOf("### Agenten-Sandbox (WSL2)");
  if (start === -1) return [];
  const rest = doku.slice(start + 3);
  const ende = rest.search(/\n### /);
  const abschnitt = ende === -1 ? rest : rest.slice(0, ende);
  const domains: string[] = [];
  for (const zeile of abschnitt.split("\n")) {
    const zellen = zeile.split("|").map((z) => z.trim());
    if (zellen.length < 4 || zellen[3] !== "Ergänzung") continue;
    const m = /^`([^`]+)`$/.exec(zellen[1]);
    if (m) domains.push(m[1]);
  }
  return domains;
};

describe("MCP-Module des Projekts in der Berechtigungs-Ergänzung (#1931)", () => {
  test("das echte .mcp.json startet mindestens ein Skript (sonst prüft der Sandbox-Import-Wächter nichts)", () => {
    assert.ok(mcpSkripte(lese(".mcp.json")).length >= 1);
  });

  const erg = pc.berechtigungenAus(config);

  test("allow trägt Browser und Diagramm, deny sperrt genau PixelLab list_projects", () => {
    assert.ok(erg.allow.includes("mcp__playwright"));
    assert.ok(erg.allow.includes("mcp__likec4"));
    assert.deepEqual(erg.deny, ["mcp__pixellab__list_projects"]);
  });

  test("jedes der vier Modul-Muster steht in der Ergänzung (Browser, Diagramm, Langfuse, Bildgenerator)", () => {
    for (const m of ["mcp__playwright", "mcp__likec4", "mcp__langfuse__", "mcp__pixellab"]) {
      assert.ok((["allow", "ask", "deny"] as const).some((l) => erg[l].some((x) => x.startsWith(m))), `Muster ${m} kommt in der Ergänzung nicht vor`);
    }
  });

  test("deny sperrt PixelLab list_projects: der Server bewirbt darüber Git-Clone-URLs und einen Push-Weg (#1476)", () => {
    const deny = settings.permissions.deny ?? [];
    assert.ok(deny.includes("mcp__pixellab__list_projects"), "deny ohne mcp__pixellab__list_projects");
    // Erzeugungs-Tools bleiben bewusst frei (das Projekt braucht sie für Assets, #1476).
    assert.deepEqual(deny.filter((d) => d.startsWith("mcp__pixellab")), ["mcp__pixellab__list_projects"], "nur list_projects ist gesperrt");
  });
});

describe("Sandbox-Ergänzung des Projekts (#1931)", () => {
  const sb = pc.sandboxAus(config);

  test("allowedDomains nennt den PixelLab-Download-Host, envVars sperrt den Token", () => {
    assert.ok(sb.allowedDomains.includes("*.pixellab.ai"));
    assert.deepEqual(sb.envVars, [{ name: "PIXELLAB_TOKEN", mode: "deny" }]);
  });

  test("die Tabellenzeilen „Ergänzung“ in docs/agent-harness.md sind mengengleich mit der Ergänzung der Config", () => {
    assert.deepEqual([...ergaenzungsZeilen(lese("docs/agent-harness.md"))].sort(), [...sb.allowedDomains].sort());
  });

  test("Negativfall: der Zeilen-Leser zählt nur „Ergänzung“, nicht „Projekt“ und nicht andere Abschnitte", () => {
    const doku = ["### Agenten-Sandbox (WSL2)", "| `a.example` | x | Projekt |", "| `b.example` | y | Ergänzung |", "### Nächster", "| `c.example` | z | Ergänzung |"].join("\n");
    assert.deepEqual(ergaenzungsZeilen(doku), ["b.example"]);
    assert.deepEqual(ergaenzungsZeilen("nichts"), []);
    // Abschnitt am Dateiende (keine Folge-Überschrift), und eine Zeile ohne Domain in Backticks wird übergangen
    assert.deepEqual(ergaenzungsZeilen(["### Agenten-Sandbox (WSL2)", "| ohne.example | z | Ergänzung |", "| `d.example` | x | Ergänzung |"].join("\n")), ["d.example"]);
  });
});
