/* ===== Kubernia – minimaler YAML-Parser (sim/yaml.ts, #1139) =====
 * Pure Teilmenge von YAML für die Manifeste, die der Spieler per `kubectl apply -f` anwendet.
 * KEIN volles YAML: unterstützt wird nur, was der Bestand nutzt. Alles andere wirft einen
 * `YamlError` mit Zeilennummer (harter Fehler statt stilles Falschlesen):
 *   - Block-Mappings und -Sequenzen (auch `- key: v` und Strich auf Key-Höhe),
 *   - Skalare: ganze Zahl, Dezimalzahl, true/false, null/~, "…" und '…', sonst Text,
 *   - Kommentare (ganze Zeile oder ` #…` am Zeilenende, nicht in Anführungszeichen),
 *   - Flow-Stil nur als `{}`, `[]` und flache Listen wie `["a", "b"]`,
 *   - Block-Literale `|`, `|-`, `|+`,
 *   - mehrere Dokumente mit `---`.
 * Nicht unterstützt (harter Fehler): Tabs in der Einrückung, Anker/Alias/Tags, `>`, Flow-Mapping
 * mit Inhalt, verschachtelter Flow, mehrzeilige Plain-Skalare, doppelte Keys, `key:wert`.
 * Alle Muster sind linear (die Eingabe wird später vom Spieler selbst geschrieben).
 * Bewusst ohne Phaser/DOM und ohne Sim-Imports (Leaf-Modul der Domäne). */

export type YamlValue = null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

/** Ein Parse-Fehler mit der (1-basierten) Zeile in der Datei. */
export class YamlError extends Error {
  constructor(readonly line: number, readonly reason: string) {
    super("yaml: line " + line + ": " + reason);
    this.name = "YamlError";
  }
}

interface Line { no: number; indent: number; text: string }
interface State { raw: string[]; base: number; pos: number; over: Line | null; depth: number }
type Obj = { [key: string]: YamlValue };

const MAX_LINES = 5000;
const MAX_DEPTH = 32;

function fail(no: number, reason: string): never {
  throw new YamlError(no, reason);
}

/* ---------- Zeilen lesen ---------- */

function opensQuote(s: string, i: number): boolean {
  return i === 0 || " \t[{,".includes(s[i - 1]);
}

/** Innerhalb eines Quoted-Strings: Position des letzten verbrauchten Zeichens, `closed` beim schließenden Quote. */
function stepInQuote(s: string, i: number, quote: string): { i: number; closed: boolean } {
  const c = s[i];
  if (quote === '"' && c === "\\") return { i: i + 1, closed: false };
  if (quote === "'" && c === "'" && s[i + 1] === "'") return { i: i + 1, closed: false };
  return { i, closed: c === quote };
}

/** Entfernt einen Kommentar (`#` am Anfang oder nach Leerraum) außerhalb von Anführungszeichen. */
function stripComment(s: string): string {
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      const step = stepInQuote(s, i, quote);
      i = step.i;
      if (step.closed) quote = "";
    } else if ((c === '"' || c === "'") && opensQuote(s, i)) {
      quote = c;
    } else if (c === "#" && (i === 0 || s[i - 1] === " " || s[i - 1] === "\t")) {
      return s.slice(0, i);
    }
  }
  return s;
}

function leadingWs(s: string): number {
  let i = 0;
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  return i;
}

/** Die nächste inhaltstragende Zeile (leere/Kommentarzeilen werden übersprungen), ohne sie zu verbrauchen. */
function peek(st: State): Line | null {
  if (st.over) return st.over;
  while (st.pos < st.raw.length) {
    const raw = st.raw[st.pos];
    const no = st.base + st.pos + 1;
    const ws = leadingWs(raw);
    const text = stripComment(raw.slice(ws)).trimEnd();
    if (text === "") { st.pos++; continue; }
    if (raw.slice(0, ws).includes("\t")) fail(no, "Tab in der Einrückung (YAML erlaubt nur Leerzeichen)");
    return { no, indent: ws, text };
  }
  return null;
}

function consume(st: State): void {
  st.over = null;
  st.pos++;
}

function isSeqItem(text: string): boolean {
  return text === "-" || text.startsWith("- ");
}

/* ---------- Skalare ---------- */

const UNSUPPORTED: Record<string, string> = {
  "&": "Anker (&) werden nicht unterstützt",
  "*": "Aliase (*) werden nicht unterstützt",
  "!": "Tags (!) werden nicht unterstützt",
  "%": "Direktiven (%) werden nicht unterstützt",
  "@": "ein Wert darf nicht mit @ beginnen (in Anführungszeichen setzen)",
  "`": "ein Wert darf nicht mit ` beginnen (in Anführungszeichen setzen)",
};

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", "0": "\0", " ": " " };

/** Liest einen Quoted-String ab `start`; liefert Wert und Index hinter dem schließenden Zeichen. */
function scanQuoted(s: string, start: number, no: number): { value: string; end: number } {
  const q = s[start];
  let value = "";
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (q === '"' && c === "\\") {
      const e = ESCAPES[s[i + 1]];
      if (e === undefined) fail(no, "unbekannte Escape-Sequenz \\" + (s[i + 1] ?? ""));
      value += e;
      i++;
    } else if (q === "'" && c === "'" && s[i + 1] === "'") {
      value += "'";
      i++;
    } else if (c === q) {
      return { value, end: i + 1 };
    } else {
      value += c;
    }
  }
  return fail(no, "Anführungszeichen nicht geschlossen (mehrzeilige Strings werden nicht unterstützt)");
}

function parseQuoted(s: string, no: number): string {
  const { value, end } = scanQuoted(s, 0, no);
  if (end !== s.length) fail(no, "Text hinter dem schließenden Anführungszeichen");
  return value;
}

const NULLS = new Set(["", "~", "null", "Null", "NULL"]);
const TRUES = new Set(["true", "True", "TRUE"]);
const FALSES = new Set(["false", "False", "FALSE"]);

function resolvePlain(s: string): YamlValue {
  if (NULLS.has(s)) return null;
  if (TRUES.has(s)) return true;
  if (FALSES.has(s)) return false;
  if (/^[-+]?\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && (s.includes(".") || Number.isSafeInteger(n))) return n;
  }
  return s;
}

function parsePlain(s: string, no: number): YamlValue {
  if (s.includes(": ") || s.endsWith(":")) fail(no, "Doppelpunkt im Wert (Wert in Anführungszeichen setzen oder Key-Ebene prüfen)");
  return resolvePlain(s);
}

/** `[a, "b", 3]` – nur flache Listen von Skalaren. */
function parseFlowSeq(s: string, no: number): YamlValue[] {
  if (!s.endsWith("]")) fail(no, "Flow-Liste nicht geschlossen");
  const inner = s.slice(1, -1);
  const out: YamlValue[] = [];
  let i = 0;
  const skip = (): void => { while (i < inner.length && inner[i] === " ") i++; };
  skip();
  if (i >= inner.length) return out;
  for (;;) {
    skip();
    const c = inner[i];
    if (c === "[" || c === "{") fail(no, "verschachtelter Flow-Stil wird nicht unterstützt");
    if (c === '"' || c === "'") {
      const r = scanQuoted(inner, i, no);
      out.push(r.value);
      i = r.end;
    } else {
      const comma = inner.indexOf(",", i);
      const text = inner.slice(i, comma < 0 ? inner.length : comma).trim();
      if (text === "") fail(no, "leeres Element in der Flow-Liste");
      if (/["']/.test(text)) fail(no, "in der Flow-Liste fehlt ein Komma (oder Anführungszeichen mitten im Element)");
      out.push(parsePlain(text, no));
      i = comma < 0 ? inner.length : comma;
    }
    skip();
    if (i >= inner.length) return out;
    if (inner[i] !== ",") fail(no, "in der Flow-Liste fehlt ein Komma");
    i++;
    skip();
    if (i >= inner.length) fail(no, "überflüssiges Komma am Ende der Flow-Liste");
  }
}

/** Ein Wert, der komplett in einer Zeile steht (rechts von `key:` bzw. `- `). */
function parseInline(rest: string, no: number): YamlValue {
  const c = rest[0];
  if (UNSUPPORTED[c]) fail(no, UNSUPPORTED[c]);
  if (rest === "?" || rest.startsWith("? ")) fail(no, "komplexe Keys (?) werden nicht unterstützt");
  if (c === ">") fail(no, "gefaltete Blöcke (>) werden nicht unterstützt (nimm eine Zeile oder |)");
  if (rest.startsWith("- ")) fail(no, "eine Liste darf hier nicht in derselben Zeile beginnen");
  if (c === "{") {
    if (rest === "{}") return {};
    return fail(no, "Flow-Mapping mit Inhalt wird nicht unterstützt (nur {}), schreibe es als Block");
  }
  if (c === "[") return parseFlowSeq(rest, no);
  if (c === '"' || c === "'") return parseQuoted(rest, no);
  return parsePlain(rest, no);
}

/* ---------- Block-Literal ---------- */

function chomp(collected: string[], mode: string): string {
  let end = collected.length;
  while (end > 0 && collected[end - 1] === "") end--;
  const body = collected.slice(0, end).join("\n");
  const trailing = collected.length - end;
  if (mode === "-") return body;
  if (mode === "+") return (body ? body + "\n" : "") + "\n".repeat(trailing);
  return body ? body + "\n" : "";
}

/** Liest die Zeilen eines `|`-Blocks ab dem aktuellen Zeiger (Kopfzeile ist schon verbraucht). */
function readBlock(st: State, header: string, parentIndent: number, no: number): string {
  const m = /^\|([+-]?)$/.exec(header);
  if (!m) return fail(no, "Block-Kopf nicht unterstützt (erlaubt: |, |- und |+)");
  const collected: string[] = [];
  let blockIndent = -1;
  while (st.pos < st.raw.length) {
    const raw = st.raw[st.pos];
    if (raw.trim() === "") { collected.push(""); st.pos++; continue; }
    const ind = raw.length - raw.trimStart().length;
    if (ind <= parentIndent) break;
    if (blockIndent < 0) blockIndent = ind;
    if (ind < blockIndent) fail(st.base + st.pos + 1, "Einrückung im Block unterschreitet die erste Blockzeile");
    collected.push(raw.slice(blockIndent));
    st.pos++;
  }
  return chomp(collected, m[1]);
}

/* ---------- Mappings und Sequenzen ---------- */

interface KeyValue { key: string; rest: string }

/** Teilt `key: rest` auf; `null`, wenn die Zeile kein Mapping-Eintrag ist. */
function findKey(text: string, no: number): KeyValue | null {
  const c = text[0];
  if (c === "{" || c === "[") return null;
  if (c === '"' || c === "'") {
    const q = scanQuoted(text, 0, no);
    const after = text.slice(q.end).trimStart();
    if (after === ":" || after.startsWith(": ")) return { key: q.value, rest: after.slice(1).trim() };
    return null;
  }
  for (let i = text.indexOf(":"); i >= 0; i = text.indexOf(":", i + 1)) {
    if (i === text.length - 1 || text[i + 1] === " ") {
      const key = text.slice(0, i).trimEnd();
      return key === "" ? null : { key, rest: text.slice(i + 1).trim() };
    }
  }
  return null;
}

function enter(st: State, no: number): void {
  if (++st.depth > MAX_DEPTH) fail(no, "zu tief verschachtelt (mehr als " + MAX_DEPTH + " Ebenen)");
}

function badIndent(line: Line, prevScalar: boolean): never {
  if (prevScalar && !isSeqItem(line.text) && !findKey(line.text, line.no)) {
    return fail(line.no, "mehrzeilige Plain-Skalare werden nicht unterstützt (Wert in eine Zeile schreiben oder | nutzen)");
  }
  return fail(line.no, "falsche Einrückung (passt nicht zur Zeile darüber)");
}

function failNotKey(line: Line): never {
  if (UNSUPPORTED[line.text[0]]) return fail(line.no, UNSUPPORTED[line.text[0]]);
  if (line.text.includes(":")) return fail(line.no, "nach dem Doppelpunkt fehlt ein Leerzeichen");
  return fail(line.no, "erwartet 'key: wert', hier steht Text ohne Doppelpunkt");
}

function parseEntryValue(st: State, rest: string, indent: number, no: number): YamlValue {
  if (rest === "") {
    const next = peek(st);
    if (!next) return null;
    if (next.indent > indent) return parseNode(st);
    if (next.indent === indent && isSeqItem(next.text)) return parseSeq(st, indent);
    return null;
  }
  if (rest[0] === "|") return readBlock(st, rest, indent, no);
  return parseInline(rest, no);
}

function parseMap(st: State, indent: number): Obj {
  enter(st, st.base + st.pos + 1);
  const out: Obj = {};
  const seen = new Map<string, number>();
  let prevScalar = false;
  for (;;) {
    const line = peek(st);
    if (!line || line.indent < indent) break;
    if (line.indent > indent) badIndent(line, prevScalar);
    if (isSeqItem(line.text)) fail(line.no, "unerwarteter Listeneintrag '-' (Einrückung passt nicht zum Key darüber)");
    const kv = findKey(line.text, line.no);
    if (!kv) failNotKey(line);
    if (kv.key === "__proto__") fail(line.no, "der Key __proto__ ist nicht erlaubt");
    const first = seen.get(kv.key);
    if (first !== undefined) fail(line.no, 'doppelter Key "' + kv.key + '" (zuerst in Zeile ' + first + ")");
    seen.set(kv.key, line.no);
    consume(st);
    out[kv.key] = parseEntryValue(st, kv.rest, indent, line.no);
    prevScalar = kv.rest !== "";
  }
  st.depth--;
  return out;
}

function parseSeqItem(st: State, line: Line, indent: number): YamlValue {
  const body = line.text.slice(1);
  const rest = body.trimStart();
  const itemIndent = indent + 1 + (body.length - rest.length);
  if (rest === "") {
    consume(st);
    const next = peek(st);
    return next && next.indent > indent ? parseNode(st) : null;
  }
  if (isSeqItem(rest)) {
    st.over = { no: line.no, indent: itemIndent, text: rest };
    return parseSeq(st, itemIndent);
  }
  if (findKey(rest, line.no)) {
    st.over = { no: line.no, indent: itemIndent, text: rest };
    return parseMap(st, itemIndent);
  }
  consume(st);
  return rest[0] === "|" ? readBlock(st, rest, indent, line.no) : parseInline(rest, line.no);
}

function parseSeq(st: State, indent: number): YamlValue[] {
  enter(st, st.base + st.pos + 1);
  const out: YamlValue[] = [];
  for (;;) {
    const line = peek(st);
    if (!line || line.indent < indent) break;
    if (line.indent > indent) badIndent(line, false);
    if (!isSeqItem(line.text)) break;
    out.push(parseSeqItem(st, line, indent));
  }
  st.depth--;
  return out;
}

function parseNode(st: State): YamlValue {
  const line = peek(st);
  if (!line) return null;
  if (isSeqItem(line.text)) return parseSeq(st, line.indent);
  if (findKey(line.text, line.no)) return parseMap(st, line.indent);
  consume(st);
  return parseInline(line.text, line.no);
}

/* ---------- Dokumente ---------- */

function parseChunk(raw: string[], base: number): YamlValue | undefined {
  const st: State = { raw, base, pos: 0, over: null, depth: 0 };
  if (!peek(st)) return undefined;
  const value = parseNode(st);
  const rest = peek(st);
  if (rest) fail(rest.no, "unerwartete Zeile (falsche Einrückung oder Inhalt nach einem einzelnen Wert)");
  return value;
}

/** `---`-Trennzeile? Inhalt hinter `---` (außer Kommentar) ist ein Fehler. */
function isSeparator(line: string, no: number): boolean {
  if (!line.startsWith("---")) return false;
  const rest = line.slice(3);
  if (rest === "" || rest[0] === " " || rest[0] === "\t") {
    const t = rest.trim();
    if (t === "" || t.startsWith("#")) return true;
    return fail(no, "Inhalt hinter '---' wird nicht unterstützt (in die nächste Zeile schreiben)");
  }
  return false;
}

/** Parst eine Datei mit einem oder mehreren `---`-getrennten Dokumenten. Leere Dokumente fallen weg. */
export function parseYamlDocuments(text: string): YamlValue[] {
  const bomFree = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = bomFree.split(/\r?\n/);
  if (lines.length > MAX_LINES) throw new YamlError(MAX_LINES + 1, "Datei zu lang (mehr als " + MAX_LINES + " Zeilen)");
  const docs: YamlValue[] = [];
  let start = 0;
  const flush = (end: number): void => {
    const v = parseChunk(lines.slice(start, end), start);
    if (v !== undefined) docs.push(v);
  };
  for (let i = 0; i < lines.length; i++) {
    if (isSeparator(lines[i], i + 1)) {
      flush(i);
      start = i + 1;
    }
  }
  flush(lines.length);
  return docs;
}
