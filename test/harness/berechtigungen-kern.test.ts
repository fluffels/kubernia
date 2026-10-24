/* Wächter: der Kern-Anteil von `permissions` trägt keine Modul- oder Projektregeln (#1874, ADR 0022 Fortschreibung 1874).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Modul- und Projektregeln (MCP-Server wie Browser, Diagramm, Langfuse, Bildgenerator) gehören in `berechtigungen` der Projekt-Config; der Sync
 * schreibt sie hinter den Kern-Anteil. Der Kern-Anteil ist der Wert in `.claude/settings.json` ohne die Einträge dieser Ergänzung.
 * Dazu die Besitz-Grenze: `enabledMcpjsonServers` bleibt Projektbesitz und steht nicht im Manifest (dort nur permissions, sandbox, hooks).
 *
 * Regel (geschlossene Kern-Liste): der Kern-Anteil trägt keine `mcp__`-Regel außer der Kern-Sperre `mcp__claude-in-chrome`. Jeder andere Servername,
 * auch ein neuer, gehört in die Ergänzung; der Test kennt keinen Modulnamen. Die Werte der Ergänzung prüft ein Projekt-Test. */
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

/** Die geschlossene Kern-Liste: MCP-Regeln, die zum Kern gehören (die Sperre der Browser-Erweiterung). */
const KERN_MCP = ["mcp__claude-in-chrome"];
const LISTEN = ["allow", "ask", "deny"] as const;

const istKern = (x: string): boolean => KERN_MCP.some((m) => x === m || x.startsWith(`${m}__`));
/** Die `mcp__`-Einträge des Kern-Anteils außerhalb der Kern-Liste (`liste.eintrag`). */
const modulEintraege = (kern: Perm): string[] => LISTEN.flatMap((l) => (kern[l] ?? []).filter((x) => x.startsWith("mcp__") && !istKern(x)).map((x) => `${l}.${x}`));

describe("Kern-Anteil von permissions ohne Modulregeln (#1874)", () => {
  const settings = lese(".claude/settings.json") as { permissions: Perm };
  const erg = pc.berechtigungenAus(lese(".factory/projekt.json"));

  test("der echte Kern-Anteil (settings.json ohne die Ergänzung der Config) trägt keine mcp__-Regel außer der Kern-Liste", () => {
    assert.deepEqual(modulEintraege(lib.kernAnteil(settings.permissions, erg)), []);
  });

  test("nicht vakuös: die Ergänzung ist nicht leer, die Kern-Liste steht im Kern-Anteil, und settings.json enthält alle Einträge der Ergänzung (die Berechtigungen wirken unverändert)", () => {
    assert.ok(LISTEN.some((l) => erg[l].length > 0), "die Ergänzung der Projekt-Config ist leer (sonst wäre die Prüfung leer)");
    const kern = lib.kernAnteil(settings.permissions, erg);
    for (const m of KERN_MCP) assert.ok(LISTEN.some((l) => (kern[l] ?? []).includes(m)), `Kern-Eintrag ${m} fehlt im Kern-Anteil`);
    for (const l of LISTEN) for (const x of erg[l]) assert.ok((settings.permissions[l] ?? []).includes(x), `${l}: ${x} fehlt in .claude/settings.json`);
  });

  test("Negativfall: ein fremder mcp__-Eintrag im Kern-Anteil (auch deny und ask) wird gemeldet, die Kern-Liste nicht", () => {
    const leer = { allow: [], ask: [], deny: [] };
    assert.deepEqual(modulEintraege(lib.kernAnteil({ allow: ["Bash(ls)"], deny: ["mcp__acme__x"] }, leer)), ["deny.mcp__acme__x"]);
    assert.deepEqual(modulEintraege(lib.kernAnteil({ ask: ["mcp__beispiel__w"], allow: ["mcp__acme__lies"] }, leer)), ["allow.mcp__acme__lies", "ask.mcp__beispiel__w"]);
    assert.deepEqual(modulEintraege(lib.kernAnteil({ deny: ["mcp__claude-in-chrome", "mcp__claude-in-chrome__x"] }, leer)), []);
    // Ein Name, der die Kern-Liste nur als Präfix trägt, ist ein fremder Server.
    assert.deepEqual(modulEintraege(lib.kernAnteil({ deny: ["mcp__claude-in-chrome2"] }, leer)), ["deny.mcp__claude-in-chrome2"]);
    // Der Eintrag der Ergänzung ist kein Befund, derselbe Eintrag ohne Ergänzung schon.
    assert.deepEqual(modulEintraege(lib.kernAnteil({ allow: ["mcp__acme"] }, { ...leer, allow: ["mcp__acme"] })), []);
    assert.deepEqual(modulEintraege(lib.kernAnteil({ allow: ["mcp__acme"] }, leer)), ["allow.mcp__acme"]);
  });

  test("enabledMcpjsonServers bleibt Projektbesitz: steht in settings.json, aber nicht im Besitz-Manifest (dort nur permissions, sandbox, hooks)", () => {
    assert.ok(Array.isArray((settings as Record<string, unknown>).enabledMcpjsonServers), "Schlüssel fehlt in settings.json (sonst wäre die Prüfung leer)");
    const manifest = lese(".factory/besitz.json") as { eintraege: { pfad: string; schluessel?: string }[] };
    const schluessel = manifest.eintraege.filter((e) => e.pfad === ".claude/settings.json").map((e) => e.schluessel);
    assert.deepEqual([...schluessel].sort(), ["hooks", "permissions", "sandbox"]);
  });
});
