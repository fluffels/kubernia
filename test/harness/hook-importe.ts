/**
 * Gemeinsamer Helfer der Wächter (#1331, #1432): welche Skripte startet `.claude/settings.json` als Hook,
 * welche `.mcp.json` als MCP-Server, und welche lokalen Module ziehen sie transitiv nach.
 * Reiner Helfer ohne eigenen Test-Marker; liegt in test/harness/, damit eine
 * Änderung an der Ketten-Logik eine Audit-Spur hinterlässt.
 */
import { posix } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/besitz-lib.mjs";

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

/** Alle Importspezifizierer und die relativen darunter: die Auslegung steht einmal in `scripts/besitz-lib.mjs` (Bezug und Test-Hülle der Extraktion teilen sie). */
const lib = rawLib as unknown as { importeAus(text: string): string[]; relativeImporte(text: string): string[] };
export const importeAus = (text: string): string[] => lib.importeAus(text);
export const relativeImporte = (text: string): string[] => lib.relativeImporte(text);

const ENDUNGEN = [".mjs", ".cjs", ".js"];

/** Kandidaten-Dateipfade eines aufgelösten relativen Imports: mit Endung nur er selbst, endungslos je Code-Endung (.mjs/.cjs/.js). */
export function kandidatenPfade(roh: string): string[] {
  return /\.\w+$/.test(posix.basename(roh)) ? [roh] : ENDUNGEN.map((e) => roh + e);
}

/** Löst einen relativen Pfad auf eine lesbare Datei auf: mit Endung direkt, endungslos über .mjs/.cjs/.js; wirft, wenn nichts existiert. */
function loese(pfad: string, lies: (rel: string) => string): string {
  const kandidaten = kandidatenPfade(pfad);
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
