// Kein Shebang – wie scripts/check-docmap.mjs: das Skript wird per `node scripts/docs-gen.mjs`
// gestartet UND von test/docgen.test.ts importiert; ein `#!` bricht den Vitest-Import.
/**
 * Lebende Doku (#1355, ADR 0017): ersetzt den Inhalt zwischen
 * `<!-- GEN:<name> START -->` und `<!-- GEN:<name> END -->` durch die Ausgabe eines Generators.
 *
 *   npm run docs:gen      schreibt die Abschnitte (nur wenn alles fehlerfrei ist)
 *   npm run check:docgen  erzeugt im Speicher und vergleicht (Teil von `verify`), schreibt nie
 *
 * Projektneutral: Pfade, Ketten und Beschreibungen stehen in scripts/docs-gen/config.json.
 * Reines Node-Skript (nur Builtins); alle Funktionen nehmen `rootDir` entgegen.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gatesGenerator } from "./docs-gen/gates.mjs";
import { harnessInventarGenerator } from "./docs-gen/harness-inventar.mjs";
import { schichtenIstGenerator, schichtenSollGenerator } from "./docs-gen/schichten.mjs";
import { zeitleisteGenerator } from "./docs-gen/zeitleiste.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = "scripts/docs-gen/config.json";

/** Registry: Marker-Name → Generator `({rootDir, config}) => string` (wirft bei Datenfehlern). */
export const GENERATORS = {
  gates: gatesGenerator,
  "harness-inventar": harnessInventarGenerator,
  "schichten-soll": schichtenSollGenerator,
  "schichten-ist": schichtenIstGenerator,
  zeitleiste: zeitleisteGenerator,
};

export const HINT = "<!-- Generiert von npm run docs:gen – nicht von Hand ändern. -->";
const MARKER = /^(\s*)<!-- GEN:([a-z0-9][a-z0-9-]*) (START|END) -->\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Findet Abschnitte; Zeilen in Code-Fences zählen nicht. Zeilen sind 0-basiert. */
export function parseSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  const errors = [];
  let open = null;
  let fence = null;
  lines.forEach((line, i) => {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (fence === f[1]) fence = null;
      return;
    }
    if (fence) return;
    const m = MARKER.exec(line);
    if (!m) {
      if (line.trimStart().startsWith("<!-- GEN:"))
        errors.push({ section: "?", message: `Zeile ${i + 1}: unlesbarer GEN-Marker "${line.trim()}"` });
      return;
    }
    const [, indent, name, kind] = m;
    if (kind === "START") {
      if (open)
        errors.push({ section: name, message: `Zeile ${i + 1}: START "${name}" innerhalb des offenen Abschnitts "${open.name}"` });
      else if (sections.some((s) => s.name === name))
        errors.push({ section: name, message: `Zeile ${i + 1}: Abschnitt "${name}" kommt in dieser Datei doppelt vor` });
      else open = { name, startLine: i, indent };
      return;
    }
    if (!open) {
      errors.push({ section: name, message: `Zeile ${i + 1}: END "${name}" ohne START` });
    } else if (open.name !== name) {
      errors.push({ section: name, message: `Zeile ${i + 1}: END "${name}" passt nicht zum offenen START "${open.name}"` });
    } else {
      sections.push({ ...open, endLine: i });
      open = null;
    }
  });
  if (open) errors.push({ section: open.name, message: `END-Marker für "${open.name}" fehlt (START in Zeile ${open.startLine + 1})` });
  return { sections, errors };
}

/** Sollinhalt eines Abschnitts als Zeilen: Hinweis, Leerzeile, Ausgabe, Leerzeile (Einrückung des START-Markers). */
function bodyLines(section, output) {
  const body = [HINT, "", ...String(output).split(/\r?\n/), ""];
  return body.map((l) => (l === "" ? "" : section.indent + l));
}

/** Ersetzt jeden Abschnitt durch Hinweis + Generator-Ausgabe; behält Zeilenende und Einrückung. */
export function renderSections(text, outputs) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const out = [];
  let cursor = 0;
  for (const s of parseSections(text).sections) {
    out.push(...lines.slice(cursor, s.startLine + 1), ...bodyLines(s, outputs[s.name]));
    cursor = s.endLine;
  }
  out.push(...lines.slice(cursor));
  return out.join(eol);
}

/** Alle .md-Dateien unter den konfigurierten Wurzeln (Dateien oder Ordner), POSIX, sortiert. */
export function collectMarkdown(rootDir, roots) {
  const found = [];
  const walk = (abs) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
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
  return [...new Set(found)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Führt jeden Generator höchstens einmal je Lauf aus (Fehler werden zwischengespeichert). */
function runGenerator(cache, generators, name, ctx) {
  if (!cache.has(name)) {
    try {
      cache.set(name, { value: generators[name](ctx) });
    } catch (err) {
      cache.set(name, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return cache.get(name);
}

/**
 * Prüft (write=false) bzw. schreibt (write=true) alle Abschnitte.
 * Fail-closed: bei irgendeinem Fehler wird nichts geschrieben.
 */
export function runDocsGen({ rootDir = ROOT, config, generators = GENERATORS, write = false }) {
  const stale = [];
  const errors = [];
  const written = [];
  const cache = new Map();
  const pending = [];
  for (const file of collectMarkdown(rootDir, config.markdown ?? [])) {
    const text = readFileSync(join(rootDir, file), "utf8");
    const parsed = parseSections(text);
    for (const e of parsed.errors) errors.push({ file, ...e });
    if (parsed.errors.length) continue;
    const outputs = {};
    let complete = true;
    for (const s of parsed.sections) {
      if (!Object.hasOwn(generators, s.name)) {
        errors.push({ file, section: s.name, message: `unbekannter Generator "${s.name}" (bekannt: ${Object.keys(generators).join(", ")})` });
        complete = false;
        continue;
      }
      const c = runGenerator(cache, generators, s.name, { rootDir, config });
      if (c.error !== undefined) {
        errors.push({ file, section: s.name, message: `Generator fehlgeschlagen: ${c.error}` });
        complete = false;
      } else outputs[s.name] = c.value;
    }
    if (!complete) continue;
    const lines = text.split(/\r?\n/);
    let differs = false;
    for (const s of parsed.sections) {
      const actual = lines.slice(s.startLine + 1, s.endLine).join("\n");
      if (actual !== bodyLines(s, outputs[s.name]).join("\n")) {
        stale.push({ file, section: s.name });
        differs = true;
      }
    }
    if (differs) pending.push({ file, next: renderSections(text, outputs) });
  }
  if (write && errors.length === 0) {
    for (const p of pending) {
      writeFileSync(join(rootDir, p.file), p.next);
      written.push(p.file);
    }
  }
  return { stale, errors, written };
}

export function loadConfig(rootDir = ROOT) {
  return JSON.parse(readFileSync(join(rootDir, CONFIG_PATH), "utf8"));
}

function main() {
  const write = process.argv.includes("--write");
  const res = runDocsGen({ rootDir: ROOT, config: loadConfig(), write });
  for (const e of res.errors) console.error(`✖ ${e.file} [${e.section}]: ${e.message}`);
  if (res.errors.length) {
    console.error("\nFix: Marker bzw. Generator-Daten korrigieren, dann npm run docs:gen");
    process.exit(1);
  }
  if (write) {
    console.log(res.written.length ? `✔ geschrieben: ${res.written.join(", ")}` : "✔ nichts zu tun, alle generierten Abschnitte aktuell");
    return;
  }
  for (const s of res.stale) console.error(`✖ ${s.file} [${s.section}]: generierter Abschnitt ist veraltet`);
  if (res.stale.length) {
    console.error("\nFix: npm run docs:gen");
    process.exit(1);
  }
  console.log("✔ generierte Doku-Abschnitte aktuell");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
