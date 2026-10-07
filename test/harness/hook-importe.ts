/**
 * Gemeinsamer Helfer der Wächter (#1331, #1432): welche Skripte startet `.claude/settings.json` als Hook,
 * welche `.mcp.json` als MCP-Server, und welche lokalen Module ziehen sie transitiv nach.
 * Reiner Helfer ohne eigenen Test-Marker (wie `workflow-block.ts`); liegt in test/harness/, damit eine
 * Änderung an der Ketten-Logik eine Audit-Spur hinterlässt.
 */
import { posix } from "node:path";

/** Skripte, die `.claude/settings.json` als Hook startet (Argumente auf `scripts/*.mjs`). */
export function hookSkripte(settingsText: string): string[] {
  const settings = JSON.parse(settingsText) as { hooks?: Record<string, { hooks: { args?: string[] }[] }[]> };
  const skripte = new Set<string>();
  for (const eintraege of Object.values(settings.hooks ?? {}))
    for (const e of eintraege) for (const h of e.hooks) for (const a of h.args ?? []) if (/scripts\/[\w.-]+\.mjs$/.test(a)) skripte.add(a.replace(/^.*?(scripts\/)/, "$1"));
  return [...skripte];
}

/** Skripte, die `.mcp.json` als stdio-MCP-Server startet (Argumente auf `scripts/*.mjs`). */
export function mcpSkripte(mcpJsonText: string): string[] {
  const mcp = JSON.parse(mcpJsonText) as { mcpServers?: Record<string, { args?: string[] }> };
  const skripte = new Set<string>();
  for (const s of Object.values(mcp.mcpServers ?? {}))
    for (const a of s.args ?? []) if (/scripts\/[\w.-]+\.mjs$/.test(a)) skripte.add(a.replace(/^.*?(scripts\/)/, "$1"));
  return [...skripte];
}

// Die Importformen: `from "./x"`, Side-Effect-`import "./x"`, dynamisches `import("./x")`, `require("./x")` und
// `createRequire(…)("./x")` (Aufruf-Klammer direkt vor dem Literal; bewusst großzügig, fail-closed).
export const IMPORT_FORM = /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\(\s*|\)\s*\(\s*)["'](\.{1,2}\/[\w./-]+\.(?:mjs|cjs))["']/g;

/**
 * Alle lokalen relativen Importe (`IMPORT_FORM`; transitiv) der Wurzel-Skripte,
 * die Wurzeln eingeschlossen. Ein Import wird relativ zur IMPORTIERENDEN Datei aufgelöst, damit Module in
 * Unterordnern (`scripts/docs-gen/*.mjs`) und `../`-Importe nicht aus der Kette fallen (E1).
 */
export function lokaleImporteTransitiv(wurzeln: string[], lies: (rel: string) => string): string[] {
  const gesehen = new Set<string>();
  const offen = [...wurzeln];
  while (offen.length > 0) {
    const rel = offen.pop() as string;
    if (gesehen.has(rel)) continue;
    gesehen.add(rel);
    const importe = lies(rel).matchAll(IMPORT_FORM);
    for (const m of importe) offen.push(posix.normalize(posix.join(posix.dirname(rel), m[1])));
  }
  return [...gesehen].sort();
}
