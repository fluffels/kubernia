/**
 * Gemeinsamer Helfer der Wächter (#1331, #1432): welche Skripte startet `.claude/settings.json` als Hook,
 * welche `.mcp.json` als MCP-Server, und welche lokalen Module ziehen sie transitiv nach.
 * Reiner Helfer ohne eigenen Test-Marker; liegt in test/harness/, damit eine
 * Änderung an der Ketten-Logik eine Audit-Spur hinterlässt.
 */
import { posix } from "node:path";

/** Skripte, die `.claude/settings.json` als Hook startet (Argumente auf `scripts/*.mjs`). */
export function hookSkripte(settingsText: string): string[] {
  const settings = JSON.parse(settingsText) as {
    hooks?: Record<string, { hooks: { args?: string[] }[] }[]>;
    statusLine?: { command?: string };
    subagentStatusLine?: { command?: string };
  };
  const skripte = new Set<string>();
  // statusLine/subagentStatusLine laufen als Kommando-String (#1358): das Skript steht im Kommando, nicht in args.
  for (const k of [settings.statusLine?.command, settings.subagentStatusLine?.command]) {
    const treffer = k?.match(/scripts\/[\w.-]+\.mjs/);
    if (treffer) skripte.add(treffer[0]);
  }
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

/**
 * Alle Importspezifizierer eines Quelltexts (ohne Auflösung, mit `node:*` und Paketnamen): statische
 * `import`/`export … from` (auch Side-Effect), `import("…")`, `require("…")`, `createRequire(…)("…")` und die
 * großzügige Aufruf-Form `)("…")` (fail-closed). Nicht erkannt: ein dynamischer Pfad (`require(pfad)`).
 */
export function importeAus(text: string): string[] {
  return [
    ...new Set([
      ...[...text.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]),
      ...[...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bimport\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bcreateRequire\([^)]*\)\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\)\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ]),
  ];
}

/** Relative Spezifizierer (`./`, `../`) eines Quelltexts. */
export const relativeImporte = (text: string): string[] => [...new Set(importeAus(text).filter((s) => /^\.{1,2}\//.test(s)))];

const ENDUNGEN = [".mjs", ".cjs", ".js"];

/** Löst einen relativen Pfad auf eine lesbare Datei auf: mit Endung direkt, endungslos über .mjs/.cjs/.js; wirft, wenn nichts existiert. */
function loese(pfad: string, lies: (rel: string) => string): string {
  const kandidaten = /\.\w+$/.test(posix.basename(pfad)) ? [pfad] : ENDUNGEN.map((e) => pfad + e);
  for (const k of kandidaten) {
    try {
      lies(k);
      return k;
    } catch {
      /* nächste Variante */
    }
  }
  throw new Error(`Import ${pfad} nicht auflösbar (kein ${kandidaten.join(" / ")}), Kette unvollständig`);
}

/**
 * Alle lokalen relativen Importe (transitiv) der Wurzel-Skripte,
 * die Wurzeln eingeschlossen. Ein Import wird relativ zur IMPORTIERENDEN Datei aufgelöst, damit Module in
 * Unterordnern (`scripts/docs-gen/*.mjs`) und `../`-Importe nicht aus der Kette fallen (E1). Endungslose
 * Spezifizierer (`require("../layers")`) werden über `lies` aufgelöst; unauflösbar wirft (fail-closed).
 */
export function lokaleImporteTransitiv(wurzeln: string[], lies: (rel: string) => string): string[] {
  const gesehen = new Set<string>();
  const offen = [...wurzeln];
  while (offen.length > 0) {
    const rel = offen.pop() as string;
    if (gesehen.has(rel)) continue;
    gesehen.add(rel);
    for (const spec of relativeImporte(lies(rel))) offen.push(loese(posix.normalize(posix.join(posix.dirname(rel), spec)), lies));
  }
  return [...gesehen].sort();
}
