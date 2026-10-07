// Kein Shebang (siehe docs-gen.mjs). Kleine Markdown-/Frontmatter-Helfer der Generatoren (#1355).

/** Escaped Zellinhalt für eine GFM-Tabelle (`|` und Zeilenumbrüche). */
export function cell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Rendert eine GFM-Tabelle (Kopfzeile + Zeilen; Zeilen sind Arrays aus Strings). */
export function renderTable(header, rows) {
  const line = (cols) => `| ${cols.map(cell).join(" | ")} |`;
  return [line(header), `|${header.map(() => "---").join("|")}|`, ...rows.map(line)].join("\n");
}

/** Liest die einfache `key: value`-Teilmenge des YAML-Frontmatters (nur Skalare, eine Zeile je Schlüssel). */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const out = {};
  if (!m) return out;
  for (const l of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(l);
    if (kv) out[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Locale-unabhängiger Vergleich (Code-Units), damit lokal und CI gleich sortieren. */
export function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Gemeinsames Mermaid-Frontmatter aller generierten Diagramme (gedämpft-warme Palette). */
export const MERMAID_FRONTMATTER = `---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---`;
