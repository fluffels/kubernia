/* ===== Kubernia – minimaler YAML-Emitter (sim/yaml-emit.ts, #1467) =====
 * Das Gegenstück zu ./yaml.ts: druckt einen `YamlValue` im Layout von kubectl (go-yaml), und zwar nur in
 * der Teilmenge, die der Parser wieder einliest (`parseYamlDocuments(emitYaml(v))` ergibt `[v]`).
 *   - Einrückung 2, der Sequenz-Strich steht auf Schlüssel-Höhe (`ports:` / `- port: 80`), eine
 *     Mapping-Zeile in einer Sequenz hat die Form `- k: v`; Sequenz in Sequenz: `- - x`.
 *   - Leere Strukturen als `{}` und `[]`, null als `null`.
 *   - Schlüssel in der natürlichen Ordnung von go-yaml (`keyList.Less`): Buchstaben nach Codepoint,
 *     Nicht-Buchstaben vor Buchstaben, Ziffernfolgen numerisch (`a9` vor `a10`).
 *   - Strings: doppelt gequotet, wenn sie sonst kein String bliebe (Zahl, bool, null, yes/no, Zeitstempel …)
 *     oder Steuerzeichen enthalten; einfach gequotet bei Indikatoren, `: `, ` #`, Leerraum am Rand.
 *   - KEINE Zeilenfaltung: go-yaml bricht lange Strings bei 80 Spalten, der Parser liest aber keine
 *     mehrzeiligen Plain-Skalare. Lange Strings bleiben also in einer Zeile.
 * Ein Wert außerhalb der Teilmenge (NaN, Infinity, 1e21, undefined, unlesbares Steuerzeichen) ist ein
 * Programmierfehler und wirft. Bewusst ohne Phaser/DOM und ohne Sim-Imports (Leaf-Modul der Domäne). */
import type { YamlValue } from "./yaml";

/** Ein YAML-Mapping (die Bausteine in kubectl/objects/ bauen daraus ihre Objekte). */
export type YamlMap = { [key: string]: YamlValue };
type Obj = YamlMap;

/* ---------- Schlüsselordnung (go-yaml v2 keyList.Less) ---------- */

const isLetter = (c: string): boolean => c.toLowerCase() !== c.toUpperCase();
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

/** Der Zahlenwert der Ziffernfolge ab `from` und der Index dahinter. */
function digitsFrom(r: string[], from: number): { n: number; end: number } {
  let n = 0;
  let end = from;
  while (end < r.length && isDigit(r[end])) n = n * 10 + Number(r[end++]);
  return { n, end };
}

/** Hängt vor `i` eine von 0 verschiedene Ziffer (dann zählt die führende Null nicht als Ziffernbeginn). */
function nonZeroDigitBefore(r: string[], i: number): boolean {
  for (let j = i - 1; j >= 0 && isDigit(r[j]); j--) if (r[j] !== "0") return true;
  return false;
}

function keyLess(a: string, b: string): boolean {
  const ar = [...a];
  const br = [...b];
  for (let i = 0; i < ar.length && i < br.length; i++) {
    if (ar[i] === br[i]) continue;
    const al = isLetter(ar[i]);
    const bl = isLetter(br[i]);
    if (al && bl) return ar[i] < br[i];
    if (al || bl) return bl;
    const x = digitsFrom(ar, i);
    const y = digitsFrom(br, i);
    let an = x.n;
    let bn = y.n;
    if ((ar[i] === "0" || br[i] === "0") && nonZeroDigitBefore(ar, i)) { an = 1; bn = 1; }
    if (an !== bn) return an < bn;
    if (x.end !== y.end) return x.end < y.end;
    return ar[i] < br[i];
  }
  return ar.length < br.length;
}

/** Die Schlüssel eines Mappings in der Ausgabereihenfolge. */
export function sortedKeys(o: Obj): string[] {
  return Object.keys(o).sort((a, b) => (keyLess(a, b) ? -1 : keyLess(b, a) ? 1 : 0));
}

/* ---------- Strings ---------- */

const NULL_BOOL = /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF)$/;
const NUMBERISH = [
  /^[-+]?(?:\d[\d_,]*)?(?:\.\d*)?(?:[eE][-+]?\d+)?$/, // Dezimal, Float, Exponent (mind. eine Ziffer, siehe unten)
  /^[-+]?0[xX][0-9a-fA-F_]+$/,
  /^[-+]?0[oO]?[0-7_]+$/,
  /^[-+]?\d[\d_]*(?::[0-5]?\d(?:\.\d*)?)+$/, // Base 60
  /^[-+]?\.(?:inf|Inf|INF)$|^\.(?:nan|NaN|NAN)$/,
  /^\d{4}-\d\d?-\d\d?/, // Zeitstempel
];

/** Würde ein Plain-Skalar dieses Texts als etwas anderes als ein String gelesen? */
function readsAsOther(s: string): boolean {
  if (NULL_BOOL.test(s)) return true;
  if (/\d/.test(s) && NUMBERISH.some(re => re.test(s))) return true;
  return NUMBERISH.slice(1).some(re => re.test(s));
}

const INDICATORS = "#&*!|>'\"%@`[]{},";

/** Muss der String (als Wert oder Schlüssel) in einfachen Anführungszeichen stehen? */
function needsSingle(s: string): boolean {
  const c = s[0];
  if (INDICATORS.includes(c)) return true;
  if ("-?:".includes(c) && (s.length === 1 || s[1] === " ")) return true;
  if (s.startsWith("---")) return true;
  return s.includes(": ") || s.includes(" #") || s.endsWith(":") || s !== s.trim();
}

// eslint-disable-next-line no-control-regex -- genau diese Zeichen sollen erkannt werden
const CONTROL = /[\u0000-\u001f\u007f]/;
const ESC_OUT: Record<string, string> = { "\n": "\\n", "\t": "\\t", "\r": "\\r", "\0": "\\0", '"': '\\"', "\\": "\\\\" };

function doubleQuoted(s: string): string {
  let out = '"';
  for (const ch of s) {
    const e = ESC_OUT[ch];
    if (e !== undefined) out += e;
    else if (CONTROL.test(ch)) throw new Error("yaml-emit: Steuerzeichen U+" + ch.charCodeAt(0).toString(16) + " ist nicht darstellbar");
    else out += ch;
  }
  return out + '"';
}

function stringText(s: string): string {
  if (s === "") return '""';
  if (CONTROL.test(s) || readsAsOther(s)) return doubleQuoted(s);
  if (needsSingle(s)) return "'" + s.replace(/'/g, "''") + "'";
  return s;
}

function numberText(n: number): string {
  const s = Object.is(n, -0) ? "0" : String(n);
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) throw new Error("yaml-emit: Zahl " + s + " liegt außerhalb der Parser-Teilmenge");
  return s;
}

/* ---------- Struktur ---------- */

/** Der einzeilige Text für Skalare und leere Strukturen, sonst `null`. */
function inlineText(v: YamlValue): string | null {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return numberText(v);
  if (typeof v === "string") return stringText(v);
  if (Array.isArray(v)) return v.length === 0 ? "[]" : null;
  if (typeof v === "object") return Object.keys(v).length === 0 ? "{}" : null;
  throw new Error("yaml-emit: " + typeof v + " ist kein YamlValue");
}

const pad = (n: number): string => " ".repeat(n);

function mapLines(o: Obj, indent: number): string[] {
  const out: string[] = [];
  for (const k of sortedKeys(o)) {
    const head = pad(indent) + stringText(k) + ":";
    const v = o[k];
    const inl = inlineText(v);
    if (inl !== null) out.push(head + " " + inl);
    else out.push(head, ...blockLines(v, Array.isArray(v) ? indent : indent + 2));
  }
  return out;
}

function seqLines(a: YamlValue[], indent: number): string[] {
  const out: string[] = [];
  for (const item of a) {
    const inl = inlineText(item);
    if (inl !== null) { out.push(pad(indent) + "- " + inl); continue; }
    const child = blockLines(item, indent + 2);
    out.push(pad(indent) + "- " + child[0].slice(indent + 2), ...child.slice(1));
  }
  return out;
}

/** Die Zeilen einer nicht leeren Map oder Liste, jede mit mindestens `indent` Leerzeichen eingerückt. */
function blockLines(v: YamlValue, indent: number): string[] {
  return Array.isArray(v) ? seqLines(v, indent) : mapLines(v as Obj, indent);
}

/** Der Wert als YAML-Text (ohne abschließenden Zeilenumbruch). */
export function emitYaml(v: YamlValue): string {
  return inlineText(v) ?? blockLines(v, 0).join("\n");
}
