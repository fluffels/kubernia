// Kein Shebang (Konvention der Skripte, die ein Test importiert).
/**
 * Guard-Liste (#112): je geänderter Funktion die Anker (Verzweigungs- und Guard-Stellen) der Diff-Zeilen, damit der Selbstcheck des
 * Umsetzers und Lens 3 von derselben, nicht selbst gewählten Liste ausgehen. Kein Gate, Exit 0 (außer Aufruf-Fehler und fehlende Basis).
 *
 * Bewusste Grenzen (Regex-Heuristik, kein AST): mehrzeilige Ausdrücke und Funktionsköpfe über mehrere Zeilen, verschachtelte oder zeilenübergreifende
 * Strings, Ausdrücke in `${…}` eines Template-Literals, Regex-Literale mit Anführungszeichen und Guards außerhalb der Musterliste (`MUSTER`) fehlen; die Lens ergänzt sie.
 * Zuordnung: nächster vorangehender Funktionskopf, auch wenn die Funktion davor schon endete; sonst `(Modulebene)`.
 * Ungetrackte Dateien mit Nicht-ASCII-Namen (git quotet sie) fehlen.
 * Quelle: Projekt-Config `struktur.quelle` über `isMeasured` (keine festen Endungen); Testdateien liegen außerhalb und fehlen.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMeasured, normalizePath, parseDiffLines, resolveBase } from "./check-basis.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { ladeProjektConfig, strukturAus } from "./projekt-config-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUFRUF = "Aufruf: node scripts/anker-liste.mjs [--basis <ref>] [--json]";
const FLAGS = { basis: { type: "string" }, json: { type: "boolean" } };
const MODULEBENE = "(Modulebene)";

/** Geschlossene Musterliste. `auf: "text"` prüft die Zeile ohne String-Inhalte und Kommentar, sonst zusätzlich ohne Regex-Literale. */
export const MUSTER = [
  { name: "if", re: /\bif\s*\(/ },
  { name: "switch", re: /\bswitch\s*\(/ },
  { name: "case", re: /^\s*case\b/ },
  { name: "ternär", re: /\s\?\s/ },
  { name: "??", re: /\?\?(?!=)/ },
  { name: "??=", re: /\?\?=/ },
  { name: "?.", re: /\?\.(?!\d)/ },
  { name: "||", re: /\|\|(?!=)/ },
  { name: "&&", re: /&&(?!=)/ },
  { name: "||=", re: /\|\|=/ },
  { name: "&&=", re: /&&=/ },
  { name: "catch", re: /\bcatch\b/ },
  { name: "throw", re: /\bthrow\b/ },
  { name: "Regex-Literal", re: /(?:^|[=(,:;!&|?{}[])\s*\/(?![/*])/, auf: "text" },
  { name: "new RegExp", re: /\bnew\s+RegExp\b/ },
  { name: "<", re: /\s<\s/ },
  { name: "<=", re: /\s<=\s/ },
  { name: ">", re: /\s>\s/ },
  { name: ">=", re: /\s>=\s/ },
  { name: ".filter(", re: /\.filter\(/ },
  { name: ".find(", re: /\.find\(/ },
  { name: ".findIndex(", re: /\.findIndex\(/ },
  { name: ".some(", re: /\.some\(/ },
  { name: ".every(", re: /\.every\(/ },
];

const STRINGS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const REGEX_LITERAL = /(^\s*|[=(,:;!&|?{}[]\s*)\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[dgimsuvy]*/g;
const KOPF = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?(?:function\b|\(.*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)/,
  /^\s+(?:static\s+)?(?:async\s+)?(?!(?:if|for|while|switch|catch|return|function)\b)([\w$]+)\s*\([^)]*\)\s*(?::[^{]+)?\{\s*$/,
];
const DEFAULT_PARAMETER = /[^=!<>]=(?![=>])/;

/** Der Name der Funktion, deren Kopf die Zeile ist, sonst `undefined`. */
const kopfName = (text) => KOPF.map((re) => re.exec(text)?.[1]).find((n) => n !== undefined);

/** Die Parameterliste eines Funktionskopfs: von der ersten `(` bis zur passenden `)`; ohne Klammer vor dem `=>` (`x => …`) leer; ohne schließende Klammer (Kopf über mehrere Zeilen) der Rest der Zeile. */
function parameterListe(text) {
  const start = text.indexOf("(");
  const pfeil = text.indexOf("=>");
  if (start < 0 || (pfeil >= 0 && pfeil < start)) return "";
  let tiefe = 0;
  for (let i = start; i < text.length; i++) {
    tiefe += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    if (tiefe === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** Die Anker-Namen einer Zeile (ohne Kommentar- und String-Inhalte) in Tabellenreihenfolge; Kopfzeilen mit Default-Parameter zusätzlich. */
function ankerNamen(zeile) {
  const text = zeile.replace(STRINGS, '""').replace(/\/\/.*$/, "");
  const ohneRegex = text.replace(REGEX_LITERAL, "$1 R");
  const namen = MUSTER.filter((m) => m.re.test(m.auf === "text" ? text : ohneRegex)).map((m) => m.name);
  const parameter = kopfName(text) === undefined ? "" : parameterListe(ohneRegex);
  return DEFAULT_PARAMETER.test(parameter) ? [...namen, "Default-Parameter"] : namen;
}

/** Anker einer Datei: nur die Zeilen in `zeilen` (`null` = alle), je Funktion gruppiert. */
function dateiAnker(datei, inhalt, zeilen) {
  const gruppen = new Map();
  let funktion = { name: MODULEBENE, zeile: null };
  let imBlock = false;
  inhalt.split(/\r?\n/).forEach((roh, i) => {
    const n = i + 1;
    const t = roh.trim();
    const kommentar = imBlock || t.startsWith("/*") || t.startsWith("*");
    if (t.startsWith("/*") || imBlock) imBlock = !t.includes("*/");
    if (kommentar) return;
    const name = kopfName(roh.replace(STRINGS, '""'));
    if (name !== undefined) funktion = { name, zeile: n };
    if (zeilen !== null && !zeilen.has(n)) return;
    const namen = ankerNamen(roh);
    if (namen.length === 0) return;
    const eintrag = gruppen.get(funktion.name + funktion.zeile) ?? { datei, funktion: funktion.name, zeile: funktion.zeile ?? n, anker: [] };
    eintrag.anker.push(...namen.map((muster) => ({ zeile: n, muster })));
    gruppen.set(funktion.name + funktion.zeile, eintrag);
  });
  return [...gruppen.values()];
}

/** Pur: `git diff -U0`-Text, neue Dateien `{ pfad, inhalt }`, `lies(pfad)` für den Stand einer geänderten Datei und `istQuelle(pfad)`. */
export function guardListe({ diffText, neueDateien = [], lies, istQuelle }) {
  const quellen = new Map();
  for (const [pfad, zeilen] of parseDiffLines(diffText)) {
    const inhalt = istQuelle(pfad) ? lies(pfad) : undefined;
    if (typeof inhalt === "string") quellen.set(pfad, { inhalt, zeilen });
  }
  for (const { pfad, inhalt } of neueDateien) {
    if (typeof inhalt === "string" && istQuelle(normalizePath(pfad))) quellen.set(normalizePath(pfad), { inhalt, zeilen: null });
  }
  return [...quellen].flatMap(([datei, { inhalt, zeilen }]) => dateiAnker(datei, inhalt, zeilen));
}

/** Eine Zeile je Funktion `datei:zeile funktion: <n> Anker (if×2 :41,:47; ?? :52)` plus Summe. */
export function formatiere(ergebnis) {
  if (ergebnis.length === 0) return "Guard-Liste: keine Anker im Diff.\n";
  const zeilen = ergebnis.map((e) => {
    const gruppen = new Map();
    for (const a of e.anker) gruppen.set(a.muster, [...(gruppen.get(a.muster) ?? []), `:${a.zeile}`]);
    const text = [...gruppen].map(([muster, orte]) => `${muster}${orte.length > 1 ? `×${orte.length}` : ""} ${orte.join(",")}`).join("; ");
    return `${e.datei}:${e.zeile} ${e.funktion}: ${e.anker.length} Anker (${text})`;
  });
  const summe = ergebnis.reduce((s, e) => s + e.anker.length, 0);
  return `${zeilen.join("\n")}\nSumme: ${summe} Anker in ${ergebnis.length} ${ergebnis.length === 1 ? "Funktion" : "Funktionen"}\n`;
}

/** Die CLI mit injiziertem `git(args)`, `lesen(pfad)` und `istQuelle`; Ergebnis `{ code, out, err }`. */
export function lauf(argv, { git, lesen, istQuelle }) {
  const r = flagsLesen(argv, FLAGS);
  if (r.fehler) return { code: 2, out: "", err: `✖ anker-liste: ${r.fehler.text}\n${AUFRUF}\n` };
  const basis = resolveBase(git, r.werte.basis === undefined ? process.env : { FACTORY_DIFF_BASE: r.werte.basis });
  if (basis === null) {
    return { code: 1, out: "", err: "✖ anker-liste: keine Vergleichs-Basis auflösbar\nFix: --basis <ref> angeben oder `git fetch origin` ausführen\n" };
  }
  const neueDateien = git(["ls-files", "--others", "--exclude-standard"])
    .split(/\r?\n/)
    .filter((pfad) => istQuelle(normalizePath(pfad)))
    .map((pfad) => ({ pfad, inhalt: lesen(pfad) }));
  const ergebnis = guardListe({ diffText: git(["diff", "-U0", basis]), neueDateien, lies: lesen, istQuelle });
  return { code: 0, out: r.werte.json ? `${JSON.stringify(ergebnis)}\n` : formatiere(ergebnis), err: "" };
}

/** Die echte Umgebung: git im Repo-Root, Dateien relativ dazu (nicht lesbar: `undefined`), Quelle aus der Projekt-Config. */
export function echteUmgebung() {
  const quelle = strukturAus(ladeProjektConfig()).quelle;
  return {
    git: (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
    lesen: (pfad) => {
      try {
        return readFileSync(join(ROOT, pfad), "utf8");
      } catch {
        return undefined;
      }
    },
    istQuelle: (pfad) => isMeasured(pfad, quelle),
  };
}

if (istDirektaufruf(import.meta.url)) {
  direktaufruf(process.argv.slice(2), {
    pruefe: (argv) => ({ fehler: flagsLesen(argv, FLAGS).fehler?.text }),
    fehlerErgebnis: (argv) => lauf(argv, {}),
    io: echteUmgebung,
    fuehreAus: (argv, io) => lauf(argv, io),
  });
}
