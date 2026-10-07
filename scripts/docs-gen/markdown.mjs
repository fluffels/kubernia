// Kein Shebang (siehe docs-gen.mjs). Gemeinsame Markdown-/Frontmatter-Helfer der Generatoren und
// des Doku-Drift-Wächters (#1355, #1392): Markdown sammeln, Code-Fences erkennen, Frontmatter lesen,
// npm-Ketten zerlegen. Reines Node-Modul (nur Builtins).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Escaped Zellinhalt für eine GFM-Tabelle (`|` und Zeilenumbrüche). */
export function cell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Rendert eine GFM-Tabelle (Kopfzeile + Zeilen; Zeilen sind Arrays aus Strings). */
export function renderTable(header, rows) {
  const line = (cols) => `| ${cols.map(cell).join(" | ")} |`;
  return [line(header), `|${header.map(() => "---").join("|")}|`, ...rows.map(line)].join("\n");
}

/**
 * Liest die einfache `key: value`-Teilmenge des YAML-Frontmatters (nur Skalare, eine Zeile je Schlüssel;
 * CRLF-fest, ein Paar Anführungszeichen um den Wert entfällt). Kein Frontmatter ⇒ leeres Objekt.
 */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const out = {};
  if (!m) return out;
  for (const l of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(l);
    if (kv) out[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Locale-unabhängiger Vergleich (Code-Units), damit lokal und CI gleich sortieren. */
export function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Markiert je Zeile, ob sie zu einem Code-Fence gehört (``` oder ~~~, die Fence-Zeilen selbst
 * eingeschlossen). Ein mit einem Zeichen geöffneter Fence wird nur vom selben Zeichen geschlossen.
 */
export function fenceMaske(lines) {
  let fence = null;
  return lines.map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (fence === null) {
        fence = m[1][0];
        return true;
      }
      if (fence === m[1][0]) {
        fence = null;
        return true;
      }
    }
    return fence !== null;
  });
}

/**
 * Alle .md-Dateien unter den Wurzeln (Dateien oder Ordner, Default das ganze `rootDir`) als repo-relative
 * POSIX-Pfade, sortiert. `ueberspringe(ent, relDir)` darf Einträge ausschließen (Verzeichnisse und Dateien).
 */
export function collectMarkdown(rootDir, roots = ["."], { ueberspringe = () => false } = {}) {
  const found = [];
  const walk = (abs) => {
    const relDir = relative(rootDir, abs).split(sep).join("/");
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      if (ueberspringe(ent, relDir)) continue;
      const p = join(abs, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith(".md")) found.push(relative(rootDir, p).split(sep).join("/"));
    }
  };
  for (const r of roots) {
    const abs = join(rootDir, r);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) walk(abs);
    else found.push(r);
  }
  return [...new Set(found)].sort(byCodeUnit);
}

/** Zerlegt eine `a && b`-Kette: `npm run X` → X, `npm test` → test, sonst der Rohbefehl. */
export function parseChain(script) {
  return script
    .split("&&")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((step) => {
      // Argumente hinter `--` (`npm run X -- --flag`) gehören nicht zum Schrittnamen (Z5g).
      const run = /^npm run ([^\s]+)(?:\s+--(?:\s.*)?)?$/.exec(step);
      if (run) return run[1];
      return /^npm test(?:\s+--(?:\s.*)?)?$/.test(step) ? "test" : step;
    });
}

/**
 * Schritte einer Kette in Ausführungsreihenfolge. Ein Schritt, dessen Skript selbst eine `&&`-Kette ist und
 * nicht in `chains` steht, wird rekursiv aufgelöst (seine Schritte gehören zur äußeren Kette); ein Zyklus
 * wirft. Einzelbefehl-Aliase (ohne `&&`) bleiben ein Schritt. EINE Auflösung für Gate-Tabelle, Diagramm-Zahlen und
 * den Doku-Drift-Wächter, damit sie nie auseinanderlaufen (#1392).
 */
export function expandSteps(script, scripts, chains, stack) {
  const out = [];
  for (const step of parseChain(script)) {
    const inner = scripts[step];
    if (!chains.includes(step) && typeof inner === "string" && inner.includes("&&")) {
      if (stack.includes(step)) throw new Error(`Zyklus in den Ketten: ${[...stack, step].join(" → ")}`);
      out.push(...expandSteps(inner, scripts, chains, [...stack, step]));
    } else out.push(step);
  }
  return out;
}

/** Prüft, ob `rel` unter `rootDir` existiert; sonst Fehlermeldung in `errors` (Config veraltet?). */
export function brauche(rootDir, rel, was, errors) {
  if (existsSync(join(rootDir, rel))) return true;
  errors.push(`${was} "${rel}" nicht gefunden (Config veraltet?)`);
  return false;
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
