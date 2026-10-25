// Kein Shebang (siehe docs-gen.mjs). Gemeinsame Markdown-/Frontmatter-Helfer der Generatoren und
// des Doku-Drift-Wächters (#1355, #1392): Markdown sammeln, Code-Fences erkennen, Frontmatter lesen,
// dazu kleine Quelltext-/Daten-Leser (JSON, Ganzzahl-Konstanten) und Mermaid-Escaping (#1370). Reines Node-Modul (nur Builtins).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, posix, relative, sep } from "node:path";

/**
 * Escaped Zellinhalt für eine GFM-Tabelle (`|` und Zeilenumbrüche). Richtlinie (Gegenstück: `zelle` in scripts/abnahme.mjs): `cell` maskiert generierte Zellen mit
 * Code-Spans, darum nur die Pipe: in Code-Spans sind Backslashes literal, eine Verdopplung zeigte sie doppelt (der CodeQL-Alert `js/incomplete-sanitization`
 * dazu ist als „won't fix“ geschlossen). Freitext aus fremder Quelle maskiert `zelle` mit Backslash zuerst, dann Pipe.
 */
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

/** Maskiert die Regex-Metazeichen der Kern-Funktion ohne `/` und `-`, wie bisher in docs-gen (bewusste Kopie der Kern-Funktion: der docs-gen-Kern importiert nur `node:*` und sich selbst, ein Import aus `ticket-namen.mjs` schlösse den Zyklus `projekt-config-lib` → `spezifikation-lib` → `markdown` → `ticket-namen`; der Drift-Test steht in `test/harness/ticket-namen.test.ts`). Pur. */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Liest die Konstante `const <name> = <Ganzzahl>` aus `datei` (relativ zu `rootDir`) als Ziffern-String.
 * Wirft bei fehlender Datei, fehlender oder mehrfacher Deklaration und bei einem Nicht-Literal.
 */
export function ganzzahlKonstante(rootDir, datei, name) {
  const abs = join(rootDir, datei);
  if (!existsSync(abs)) throw new Error(`Datei ${datei} nicht gefunden`);
  const text = readFileSync(abs, "utf8");
  const treffer = text.match(new RegExp(`^\\s*(?:export\\s+)?const\\s+${escapeRegex(name)}\\s*=`, "gm")) ?? [];
  if (treffer.length === 0) throw new Error(`${name} fehlt in ${datei}`);
  if (treffer.length > 1) throw new Error(`${name} steht mehrfach in ${datei}`);
  const zahl = new RegExp(`^\\s*(?:export\\s+)?const\\s+${escapeRegex(name)}\\s*=\\s*(\\d+)\\s*(?:;|//|$)`, "m").exec(text);
  if (!zahl) throw new Error(`${name} in ${datei} ist kein Ganzzahl-Literal`);
  return zahl[1];
}

/** Liest eine JSON-Datei (relativ zu `rootDir` oder absolut); wirft mit sprechender Meldung bei fehlender Datei oder kaputtem JSON. */
export function leseJson(rootDir, rel, was) {
  const abs = isAbsolute(rel) ? rel : join(rootDir, rel);
  if (!existsSync(abs)) throw new Error(`${was} ${rel} nicht gefunden (Config veraltet?)`);
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    throw new Error(`${rel} ist kein gültiges JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/**
 * Wie `leseJson`, verlangt aber ein JSON-OBJEKT (#1428 Z19): `null`, eine Liste, eine Zahl oder ein String als Wurzel einer Config
 * liefen sonst bis in die Generatoren und endeten in einem TypeError statt in einer Meldung. Wirft „<was> <rel> ist kein JSON-Objekt“.
 */
export function leseConfigObjekt(rootDir, rel, was) {
  const wert = leseJson(rootDir, rel, was);
  if (wert === null || typeof wert !== "object" || Array.isArray(wert)) {
    throw new Error(`${was} ${rel} ist kein JSON-Objekt (gefunden: ${wert === null ? "null" : Array.isArray(wert) ? "Liste" : typeof wert})`);
  }
  return wert;
}

/** Alle mermaid-Fences (``` oder ~~~, auch 4+ Zeichen) eines Markdown-Texts (Inhalt ohne die Fence-Zeilen). Pur. */
export function mermaidBloecke(markdown) {
  return fenceBloecke(String(markdown).split(/\r?\n/))
    .filter((b) => b.info === "mermaid" && b.geschlossen) // ein nie geschlossener Block wird nicht gerendert
    .map((b) => b.inhalt.join("\n"));
}

/** Mermaid-Standardgrenzen (maxTextSize, maxEdges); darüber rendert GitHub das Diagramm nicht. */
export const MERMAID_MAX_TEXT = 50_000;
export const MERMAID_MAX_KANTEN = 500;

// Link-Enden von flowchart/graph; bewusst großzügig (zu viel zählen = fail-closed; `--!>` zählt als Kante mit, das ist kein Arrow, aber auch kein HTML-Kommentar-Ende, das hier ungeprüft bliebe).
const MERMAID_KANTE = /--!?>|==>|\.->|---|===|-\.-|~~~|--[xo]/g;

/**
 * Mermaid-Größenwächter: wirft, wenn `text` (ein Diagramm ohne Fence) die Standardgrenzen reißt. Kanten werden nur in
 * `flowchart`/`graph` gezählt (nach dem Frontmatter, dessen `---` zählt nicht); andere Diagrammarten nur nach Zeichen.
 */
export function pruefeMermaid(text, was = "Diagramm") {
  const s = String(text);
  if (s.length > MERMAID_MAX_TEXT) throw new Error(`${was}: ${s.length} Zeichen, Mermaid rendert höchstens ${MERMAID_MAX_TEXT}`);
  const ohneFront = s.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  if (!/^\s*(?:flowchart|graph)\b/.test(ohneFront)) return;
  const kanten = (ohneFront.match(MERMAID_KANTE) ?? []).length;
  if (kanten > MERMAID_MAX_KANTEN) throw new Error(`${was}: ${kanten} Kanten, Mermaid rendert höchstens ${MERMAID_MAX_KANTEN}`);
}

const MARKER = /^(\s*)<!-- GEN:([a-z0-9][a-z0-9-]*) (START|END) -->\s*$/;

/** Findet `GEN:`-Abschnitte; Zeilen in Code-Fences zählen nicht. Zeilen sind 0-basiert. */
export function parseSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  const errors = [];
  let open = null;
  const imFence = fenceMaske(lines);
  lines.forEach((line, i) => {
    if (imFence[i]) return;
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

// ── Links und Überschriften-Anker (Doku-Drift-Wächter, Export-Werkzeug) ──────────

/** Ersetzt Zeilen innerhalb ``` / ~~~ -Fences durch Leerzeilen (Zeilenzahl bleibt
 *  erhalten). So werden `#`-Kommentare in bash-Blöcken NICHT als Überschrift und
 *  Beispiel-Links in Codeblöcken NICHT als echter Link gewertet. */
export function stripFencedCode(md) {
  const lines = md.split(/\r?\n/);
  const maske = fenceMaske(lines);
  return lines.map((line, i) => (maske[i] ? "" : line)).join("\n");
}

/** Maskiert Code-Fences und Inline-Code längentreu (Leerzeichen statt Inhalt, Zeilenumbrüche
 *  bleiben): Positionen im maskierten Text gelten unverändert im Original. */
function codeMaskiert(md) {
  const zeilen = md.split("\n");
  const maske = fenceMaske(zeilen.map((z) => z.replace(/\r$/, "")));
  return zeilen
    .map((z, i) => (maske[i] ? z.replace(/[^\r]/g, " ") : z.replace(/`[^`\n]*`/g, (s) => " ".repeat(s.length))))
    .join("\n");
}

/** Interne Markdown-Links (inkl. Bilder) mit Position im Original: { start, ende, text, bild,
 *  target, path, anchor }. `start`/`ende` begrenzen den ganzen Link `[text](ziel)`, `text` ist die
 *  Beschriftung, `bild` kennzeichnet `![alt](ziel)`. Externe Ziele (http/https/mailto/tel/
 *  Protokoll-relativ) fehlen; Links in Code-Fences und Inline-Code zählen nicht. */
export function linkStellen(md) {
  const clean = codeMaskiert(md);
  const out = [];
  // [text](target) oder ![alt](target), Ziel bis Leerzeichen/Klammer, optionaler "Titel"
  for (const m of clean.matchAll(/(!?)\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
    const target = m[3];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue; // http:, mailto:, //cdn …
    const hashAt = target.indexOf("#");
    const path = hashAt < 0 ? target : target.slice(0, hashAt);
    const anchor = hashAt < 0 ? "" : target.slice(hashAt + 1);
    const start = m.index;
    const textStart = start + m[1].length + 1;
    out.push({ start, ende: start + m[0].length, text: md.slice(textStart, textStart + m[2].length), bild: m[1] === "!", target, path, anchor });
  }
  return out;
}

/** Löst den Link-Pfad `pfad` einer Datei `datei` (repo-relativer POSIX-Pfad) auf einen repo-relativen
 *  POSIX-Pfad auf; `/` am Anfang meint die Repo-Wurzel, ein `:zeile`-Suffix (foo.ts:42) und
 *  Schrägstriche am Ende entfallen. */
export function linkZiel(datei, pfad) {
  const clean = pfad.replace(/:\d+$/, "");
  const roh = clean.startsWith("/") ? clean.slice(1) : posix.join(posix.dirname(datei), clean);
  const r = posix.normalize(roh).replace(/\/+$/, "");
  return r === "." ? "" : r;
}

/** GitHub-Überschriften-Slug: klein, Markup entfernt, Satzzeichen/Emoji raus,
 *  Leerzeichen → Bindestrich. Duplikate hängt der Aufrufer mit -1/-2 an. */
export function slugify(headingText) {
  return headingText
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/[`*_~]/g, "") // Inline-Markup-Zeichen entfernen
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "") // nur Buchstaben/Zahlen/Space/_/- behalten
    .replace(/\s/g, "-");
}

/** Alle Überschriften-Anker einer Markdown-Datei (GitHub-Slugs inkl. -1/-2 bei
 *  Duplikaten). Code-Fences ausgeblendet, damit `#`-Kommentare nicht zählen. */
export function collectHeadingSlugs(md) {
  const slugs = [];
  const seen = new Map();
  for (const line of stripFencedCode(md).split(/\r?\n/)) {
    const m = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (!m) continue;
    const base = slugify(m[2]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.push(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}
