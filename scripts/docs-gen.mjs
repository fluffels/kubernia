// Kein Shebang – wie scripts/check-docmap.mjs: das Skript wird per `node scripts/docs-gen.mjs`
// gestartet UND von test/docgen.test.ts importiert; ein `#!` bricht den Vitest-Import.
/**
 * Lebende Doku (#1355, ADR 0017): ersetzt den Inhalt zwischen
 * `<!-- GEN:<name> START -->` und `<!-- GEN:<name> END -->` durch die Ausgabe eines Generators.
 *
 *   npm run docs:gen      schreibt die Abschnitte (nur wenn alles fehlerfrei ist)
 *   npm run check:docgen  erzeugt im Speicher und vergleicht (Teil von `verify`), schreibt nie
 *
 * Projektneutral: Pfade, Ketten und Beschreibungen stehen in scripts/docs-gen/config.json; der Befehl, der
 * Hinweiszeile und Fix-Text nennen, ist der optionale Config-Schlüssel `befehl` (Standard `npm run docs:gen`).
 * Reines Node-Skript (nur Builtins); alle Funktionen nehmen `rootDir` entgegen.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectMarkdown, leseConfigObjekt, mermaidBloecke, parseSections, pruefeMermaid } from "./docs-gen/markdown.mjs";
import { GENERATORS } from "./docs-gen/registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Standard-Config; per `--config <pfad>` überschreibbar (Pfad relativ zum Repo-Root oder absolut). */
export const DEFAULT_CONFIG = "scripts/docs-gen/config.json";

export const STANDARD_BEFEHL = "npm run docs:gen";
const hinweisFuer = (befehl) => `<!-- Generiert von ${befehl} – nicht von Hand ändern. -->`;
export const HINT = hinweisFuer(STANDARD_BEFEHL);

/** Der Befehl, der den Abschnitt neu erzeugt (Config-Schlüssel `befehl`); wirft bei einem unbrauchbaren Wert.
 *  Ein `--` oder Zeilenumbruch würde den HTML-Kommentar der Hinweiszeile brechen. */
export function befehlAus(config) {
  const b = config?.befehl;
  if (b === undefined) return STANDARD_BEFEHL;
  if (typeof b !== "string" || b.trim() === "" || b !== b.trim() || /--|[\r\n]/.test(b))
    throw new Error(`config.befehl ungültig: ${JSON.stringify(b)} (nicht leer, ohne Zeilenumbruch und ohne "--")`);
  return b;
}
export { parseSections };

/** Sollinhalt eines Abschnitts als Zeilen: Hinweis, Leerzeile, Ausgabe, Leerzeile (Einrückung des START-Markers). */
function bodyLines(section, output, hinweis = HINT) {
  const body = [hinweis, "", ...String(output).split(/\r?\n/), ""];
  return body.map((l) => (l === "" ? "" : section.indent + l));
}

/** Ersetzt jeden Abschnitt durch Hinweis + Generator-Ausgabe; behält Zeilenende und Einrückung. */
export function renderSections(text, outputs, hinweis = HINT) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const out = [];
  let cursor = 0;
  for (const s of parseSections(text).sections) {
    out.push(...lines.slice(cursor, s.startLine + 1), ...bodyLines(s, outputs[s.name], hinweis));
    cursor = s.endLine;
  }
  out.push(...lines.slice(cursor));
  return out.join(eol);
}

/** Führt jeden Generator höchstens einmal je Lauf aus (Fehler werden zwischengespeichert). */
function runGenerator(cache, generators, name, ctx) {
  if (!cache.has(name)) {
    try {
      const value = generators[name](ctx);
      // Größenwächter für jedes generierte Mermaid-Diagramm (fail-closed: ein Verstoß ist ein Generatorfehler, nichts wird geschrieben).
      mermaidBloecke(value).forEach((block, i) => pruefeMermaid(block, `Mermaid-Diagramm ${i + 1} von "${name}"`));
      cache.set(name, { value });
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
  let hinweis;
  try {
    hinweis = hinweisFuer(befehlAus(config));
  } catch (e) {
    return { stale, errors: [{ file: "config", section: "befehl", message: e instanceof Error ? e.message : String(e) }], written };
  }
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
      if (actual !== bodyLines(s, outputs[s.name], hinweis).join("\n")) {
        stale.push({ file, section: s.name });
        differs = true;
      }
    }
    if (differs) pending.push({ file, next: renderSections(text, outputs, hinweis) });
  }
  if (write && errors.length === 0) {
    for (const p of pending) {
      writeFileSync(join(rootDir, p.file), p.next);
      written.push(p.file);
    }
  }
  return { stale, errors, written };
}

export function loadConfig(rootDir = ROOT, pfad = DEFAULT_CONFIG) {
  const abs = isAbsolute(pfad) ? pfad : resolve(rootDir, pfad);
  return leseConfigObjekt(rootDir, abs, "Config");
}

/**
 * Kommandozeile: `[--write] [--config <pfad>]`. Gibt den Exit-Code zurück (0 ok, 1 Fehler oder veraltet);
 * `out`/`err` nehmen die Ausgabezeilen entgegen. `config`/`generators` überschreiben Datei und Registry (Tests).
 */
export function cli(argv, { rootDir = ROOT, config, generators = GENERATORS, out = console.log, err = console.error } = {}) {
  const write = argv.includes("--write");
  const ci = argv.indexOf("--config");
  let cfg = config;
  if (!cfg) {
    const pfad = ci >= 0 ? argv[ci + 1] : undefined;
    if (ci >= 0 && !pfad) {
      err("✖ --config braucht einen Pfad\n\nFix: --config <pfad> angeben oder weglassen");
      return 1;
    }
    try {
      cfg = loadConfig(rootDir, pfad);
    } catch (e) {
      err(`✖ Config nicht lesbar: ${e instanceof Error ? e.message : e}\n\nFix: --config <pfad> prüfen (Standard ${DEFAULT_CONFIG})`);
      return 1;
    }
  }
  const res = runDocsGen({ rootDir, config: cfg, generators, write });
  let befehl = STANDARD_BEFEHL;
  try {
    befehl = befehlAus(cfg);
  } catch {
    // ungültiger Befehl: runDocsGen meldet ihn; der Fix-Text bleibt beim Standard
  }
  for (const e of res.errors) err(`✖ ${e.file} [${e.section}]: ${e.message}`);
  if (res.errors.length) {
    err(`\nFix: Marker bzw. Generator-Daten korrigieren, dann ${befehl}`);
    return 1;
  }
  if (write) {
    out(res.written.length ? `✔ geschrieben: ${res.written.join(", ")}` : "✔ nichts zu tun, alle generierten Abschnitte aktuell");
    return 0;
  }
  for (const s of res.stale) err(`✖ ${s.file} [${s.section}]: generierter Abschnitt ist veraltet`);
  if (res.stale.length) {
    err(`\nFix: ${befehl}`);
    return 1;
  }
  out("✔ generierte Doku-Abschnitte aktuell");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = cli(process.argv.slice(2));
