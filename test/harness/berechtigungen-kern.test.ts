/* Wächter: der Kern-Anteil von `permissions` trägt keine Modul- oder Projektregeln (#1874, ADR 0022 Fortschreibung 1874).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Modul- und Projektregeln (MCP-Server wie Browser, Diagramm, Langfuse, Bildgenerator) gehören in `berechtigungen` der Projekt-Config; der Sync
 * schreibt sie hinter den Kern-Anteil. Der Kern-Anteil ist der Wert in `.claude/settings.json` ohne die Einträge dieser Ergänzung.
 * Dazu die Besitz-Grenze: `enabledMcpjsonServers` bleibt Projektbesitz und steht nicht im Manifest (dort nur permissions, sandbox, hooks).
 *
 * Bekannte Muster (geschlossene Liste): `mcp__playwright`, `mcp__likec4`, `mcp__langfuse__`, `mcp__pixellab`. Ein neues Modul ergänzt die Liste.
 * Grenze: ein Modul mit anderem Namen fängt dieser Test nicht; die Inventar-Checkliste „Neuer lokaler MCP-Server“ schickt den Eintrag in die Ergänzung. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";

type Perm = Record<string, unknown> & { allow?: string[]; ask?: string[]; deny?: string[] };
const lib = rawLib as unknown as { kernAnteil(perm: Perm, erg: { allow: string[]; ask: string[]; deny: string[] }): Perm };
const pc = rawPc as unknown as { berechtigungenAus(config: unknown): { allow: string[]; ask: string[]; deny: string[] } };

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lese = (rel: string): unknown => JSON.parse(readFileSync(`${WURZEL}${rel}`, "utf8"));

const MODUL_MUSTER = ["mcp__playwright", "mcp__likec4", "mcp__langfuse__", "mcp__pixellab"];
const LISTEN = ["allow", "ask", "deny"] as const;

/** Die Einträge des Kern-Anteils, die mit einem Modul-Muster beginnen (`liste.eintrag`). */
const modulEintraege = (kern: Perm): string[] => LISTEN.flatMap((l) => (kern[l] ?? []).filter((x) => MODUL_MUSTER.some((m) => x.startsWith(m))).map((x) => `${l}.${x}`));

describe("Kern-Anteil von permissions ohne Modulregeln (#1874)", () => {
  const settings = lese(".claude/settings.json") as { permissions: Perm };
  const erg = pc.berechtigungenAus(lese(".factory/projekt.json"));

  test("der echte Kern-Anteil (settings.json ohne die Ergänzung der Config) trägt kein Muster der geschlossenen Liste", () => {
    assert.deepEqual(modulEintraege(lib.kernAnteil(settings.permissions, erg)), []);
  });

  test("nicht vakuös: jedes Muster steht in der Ergänzung, und settings.json enthält alle Einträge der Ergänzung (die Berechtigungen wirken unverändert)", () => {
    for (const m of MODUL_MUSTER) {
      assert.ok(LISTEN.some((l) => erg[l].some((x) => x.startsWith(m))), `Muster ${m} kommt in der Ergänzung nicht vor`);
    }
    for (const l of LISTEN) for (const x of erg[l]) assert.ok((settings.permissions[l] ?? []).includes(x), `${l}: ${x} fehlt in .claude/settings.json`);
  });

  test("Negativfall: ein Modul-Eintrag im Kern-Anteil (auch deny und ask) wird gemeldet", () => {
    const leer = { allow: [], ask: [], deny: [] };
    assert.deepEqual(modulEintraege(lib.kernAnteil({ allow: ["Bash(ls)"], deny: ["mcp__pixellab__x"] }, leer)), ["deny.mcp__pixellab__x"]);
    assert.deepEqual(modulEintraege(lib.kernAnteil({ ask: ["mcp__likec4__w"], allow: ["mcp__langfuse__getObservation"] }, leer)), ["allow.mcp__langfuse__getObservation", "ask.mcp__likec4__w"]);
    // Der Eintrag der Ergänzung ist kein Befund, derselbe Eintrag ohne Ergänzung schon.
    assert.deepEqual(modulEintraege(lib.kernAnteil({ allow: ["mcp__playwright"] }, { ...leer, allow: ["mcp__playwright"] })), []);
    assert.deepEqual(modulEintraege(lib.kernAnteil({ allow: ["mcp__playwright"] }, leer)), ["allow.mcp__playwright"]);
  });

  test("enabledMcpjsonServers bleibt Projektbesitz: steht in settings.json, aber nicht im Besitz-Manifest (dort nur permissions, sandbox, hooks)", () => {
    assert.ok(Array.isArray((settings as Record<string, unknown>).enabledMcpjsonServers), "Schlüssel fehlt in settings.json (sonst wäre die Prüfung leer)");
    const manifest = lese(".factory/besitz.json") as { eintraege: { pfad: string; schluessel?: string }[] };
    const schluessel = manifest.eintraege.filter((e) => e.pfad === ".claude/settings.json").map((e) => e.schluessel);
    assert.deepEqual([...schluessel].sort(), ["hooks", "permissions", "sandbox"]);
  });
});
