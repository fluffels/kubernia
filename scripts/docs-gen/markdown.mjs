// Kein Shebang (siehe docs-gen.mjs). Gemeinsame Markdown-/Frontmatter-Helfer der Generatoren und
// des Doku-Drift-Wächters (#1355, #1392): Markdown sammeln, Code-Fences erkennen, Frontmatter lesen,
// npm-Ketten zerlegen; dazu kleine Quelltext-/Daten-Leser (JSON, Ganzzahl-Konstanten) und Mermaid-Escaping (#1370). Reines Node-Modul (nur Builtins).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
 * Alle Code-Fences (CommonMark): Start, Ende (Index der letzten Zeile des Blocks, die Fence-Zeilen eingeschlossen),
 * Info-String und Inhalt. Geöffnet mit ``` oder ~~~ (≥ 3); geschlossen nur vom gleichen Zeichen, mindestens so lang
 * wie der Anfang und ohne Info-String dahinter (so schließt ein innerer ```-Block einen 4-Backtick-Fence nicht).
 * Ein nie geschlossener Fence reicht bis zum Textende (`geschlossen: false`).
 */
export function fenceBloecke(lines) {
  const bloecke = [];
  let offen = null;
  lines.forEach((line, i) => {
    if (offen === null) {
      const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
      // Backtick-Fences dürfen im Info-String keinen Backtick tragen (sonst ist es Inline-Code).
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) offen = { zeichen: m[1][0], laenge: m[1].length, start: i, info: m[2].trim(), inhalt: [] };
      return;
    }
    const z = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
    if (z && z[1][0] === offen.zeichen && z[1].length >= offen.laenge) {
      bloecke.push({ start: offen.start, ende: i, geschlossen: true, info: offen.info, inhalt: offen.inhalt });
      offen = null;
    } else offen.inhalt.push(line);
  });
  if (offen) bloecke.push({ start: offen.start, ende: lines.length - 1, geschlossen: false, info: offen.info, inhalt: offen.inhalt });
  return bloecke;
}

/** Markiert je Zeile, ob sie zu einem Code-Fence gehört (die Fence-Zeilen selbst eingeschlossen), abgeleitet aus `fenceBloecke`. */
export function fenceMaske(lines) {
  const maske = lines.map(() => false);
  for (const b of fenceBloecke(lines)) for (let i = b.start; i <= b.ende; i++) maske[i] = true;
  return maske;
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

/** Escaped Text für ein Mermaid-Label in Anführungszeichen (Entity-Codes; `#` zuerst, sonst doppelt escaped). */
export function mermaidText(s) {
  return String(s)
    .replace(/#/g, "#35;")
    .replace(/&/g, "#amp;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\r?\n/g, " ");
}

const escRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Liest die Konstante `const <name> = <Ganzzahl>` aus `datei` (relativ zu `rootDir`) als Ziffern-String.
 * Wirft bei fehlender Datei, fehlender oder mehrfacher Deklaration und bei einem Nicht-Literal.
 */
export function ganzzahlKonstante(rootDir, datei, name) {
  const abs = join(rootDir, datei);
  if (!existsSync(abs)) throw new Error(`Datei ${datei} nicht gefunden`);
  const text = readFileSync(abs, "utf8");
  const treffer = text.match(new RegExp(`^\\s*(?:export\\s+)?const\\s+${escRegex(name)}\\s*=`, "gm")) ?? [];
  if (treffer.length === 0) throw new Error(`${name} fehlt in ${datei}`);
  if (treffer.length > 1) throw new Error(`${name} steht mehrfach in ${datei}`);
  const zahl = new RegExp(`^\\s*(?:export\\s+)?const\\s+${escRegex(name)}\\s*=\\s*(\\d+)\\s*(?:;|//|$)`, "m").exec(text);
  if (!zahl) throw new Error(`${name} in ${datei} ist kein Ganzzahl-Literal`);
  return zahl[1];
}

/** Liest eine JSON-Datei (relativ zu `rootDir`); wirft mit sprechender Meldung bei fehlender Datei oder kaputtem JSON. */
export function leseJson(rootDir, rel, was) {
  const abs = join(rootDir, rel);
  if (!existsSync(abs)) throw new Error(`${was} ${rel} nicht gefunden (Config veraltet?)`);
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    throw new Error(`${rel} ist kein gültiges JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}
