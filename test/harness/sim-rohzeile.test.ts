/* Wächter: kein Rohzeilen-Parsing in der Sim (#1487).
 *
 * @harness-waechter – einziger Durchsetzer dieser Regel, darum im geschützten test/harness/.
 * Die Befehlsfamilien der Sim lesen Ziel, Name und Flag-Werte über den `Call` (`sim/cliargs.ts`), nie per Regex aus der
 * Rohzeile: `raw.match(…)`, `raw.matchAll(…)`, `.test(raw)`, `.exec(raw)` und Flag-Regex der Form `--name[=\s]` sind in
 * `src/sim/**` verboten (Kommentare ausgenommen). Ein Treffer ist rot; die Handler bekommen die Rohzeile gar nicht erst.
 * Bewusste Grenzen: Die Prüfung ist textuell. Ein umbenanntes Rohzeilen-Argument (`line.match(…)`) oder ein Regex, den
 * jemand aus Teilen baut, fängt sie nicht; dagegen steht das Review (der Handler bekommt `Call`, nicht die Zeile).
 * Die Regel `[=\s]` schlägt auf jede solche Zeichenklasse an, auch ohne Flag-Präfix. Ein `/*` oder `//` in einem
 * Regex-Literal öffnet einen Kommentar (heute gibt es keinen solchen Fall in `src/sim`). Das Zeichen-Modell kennt `"`, `'` und Backtick-Strings, aber keine Regex-Literale (ein Anführungszeichen darin
 * verdeckt höchstens den Rest dieser Zeile; Strings enden am Zeilenende). */
import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

interface Treffer { datei: string; zeile: number; regel: string; text: string }

/** Die verbotenen Muster (je Regel ein Name für die Meldung). */
const REGELN: readonly { name: string; muster: RegExp }[] = [
  { name: "raw.match", muster: /\braw\.match\s*\(/ },
  { name: "raw.matchAll", muster: /\braw\.matchAll\s*\(/ },
  { name: ".test(raw)", muster: /\.test\(\s*raw\s*\)/ },
  { name: ".exec(raw)", muster: /\.exec\(\s*raw\s*\)/ },
  // `--name[=\s]` als Regex-Literal und `"…[=\\s]"` als Regex-String (`new RegExp("--" + flag + "[=\\s]")`).
  { name: "Flag-Regex --name[=\\s]", muster: /\[=\\{1,2}s\]/ },
];

/** Der Quelltext ohne Kommentare (an ihrer Stelle Leerzeichen, Zeilenumbrüche bleiben: die Zeilennummern stimmen). Pur. */
export function ohneKommentare(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      if (c === "\\" && n !== undefined) { out += c + n; i += 2; continue; }
      if (c === quote || (c === "\n" && quote !== "`")) quote = null;
      out += c; i++; continue;
    }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop; continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c; i++;
  }
  return out;
}

/** Die Verstöße eines Quelltexts: je Zeile jede Regel, die dort anschlägt. Pur. */
export function rohzeilenTreffer(datei: string, src: string): Treffer[] {
  const treffer: Treffer[] = [];
  ohneKommentare(src).split("\n").forEach((text, k) => {
    for (const r of REGELN) if (r.muster.test(text)) treffer.push({ datei, zeile: k + 1, regel: r.name, text: text.trim() });
  });
  return treffer;
}

/** Alle `.ts`-Dateien unter `dir` (rekursiv, sortiert). */
function tsDateien(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? tsDateien(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []))
    .sort();
}

/** Scannt `<wurzel>/src/sim/**` (Pfade relativ zur Wurzel, mit `/`). */
export function scanneSim(wurzel: string): { dateien: number; treffer: Treffer[] } {
  const dateien = tsDateien(join(wurzel, "src", "sim"));
  const treffer = dateien.flatMap((d) => rohzeilenTreffer(relative(wurzel, d).replaceAll("\\", "/"), readFileSync(d, "utf8")));
  return { dateien: dateien.length, treffer };
}

describe("ohneKommentare / rohzeilenTreffer: die pure Prüffunktion", () => {
  test.each([
    ["raw.match", "const m = raw.match(/--port[=\\s]+(\\d+)/);", ["raw.match", "Flag-Regex --name[=\\s]"]],
    ["raw.matchAll", "const all = [...raw.matchAll(/x/g)];", ["raw.matchAll"]],
    [".test(raw)", "const ok = /--cert/.test(raw);", [".test(raw)"]],
    [".test( raw )", "const ok = re.test( raw );", [".test(raw)"]],
    [".exec(raw)", "while ((m = re.exec(raw)) !== null) {}", [".exec(raw)"]],
    ["Regex-String", 'const re = new RegExp("--" + flag + "[=\\\\s]([^\\\\s]+)", "g");', ["Flag-Regex --name[=\\s]"]],
    ["raw.match mit Leerzeichen", "raw.match (x)", ["raw.match"]],
  ])("schlägt an: %s", (_n, code, regeln) => {
    expect(rohzeilenTreffer("x.ts", code).map((t) => t.regel)).toEqual(regeln);
  });

  test.each([
    ["Kommentar //", "// früher: raw.match(/--port[=\\s]/) – jetzt der Call"],
    ["Zeilenende-Kommentar", "const a = 1; // raw.matchAll(x), .test(raw)"],
    ["Block-Kommentar", "/* raw.match(x)\n * re.exec(raw)\n */\nconst a = 1;"],
    ["anderer Name", "const m = line.match(/x/); const t = re.test(name); const e = re.exec(input);"],
    ["Teilwort", "const m = rawData.match(/x/); const n = withraw.match(1);"],
    ["Flag ohne Regex-Klasse", 'const a = "--port=80"; const b = c.value("--port");'],
    ["andere Zeichenklasse", "const a = /[=:]/; const b = /[\\s]+/;"],
  ])("schlägt nicht an: %s", (_n, code) => {
    expect(rohzeilenTreffer("x.ts", code)).toEqual([]);
  });

  test("ein // im String beginnt keinen Kommentar; der Treffer dahinter bleibt sichtbar", () => {
    expect(rohzeilenTreffer("x.ts", 'const u = "https://x"; raw.match(y);').map((t) => t.regel)).toEqual(["raw.match"]);
  });

  test("ein Anführungszeichen in einem Regex-Literal verdeckt nur den Rest der Zeile, nicht die nächste", () => {
    const code = "const q = /[\"]/; const s = 'x';\nraw.match(y);";
    expect(rohzeilenTreffer("x.ts", code).map((t) => `${t.zeile}:${t.regel}`)).toEqual(["2:raw.match"]);
  });

  test("Zeilennummern bleiben über Kommentare hinweg stimmig", () => {
    const code = "/* a\n b\n c */\n\nraw.matchAll(x);";
    expect(rohzeilenTreffer("x.ts", code)).toEqual([{ datei: "x.ts", zeile: 5, regel: "raw.matchAll", text: "raw.matchAll(x);" }]);
  });

  test("ein nie geschlossener Block-Kommentar frisst den Rest, ohne zu werfen", () => {
    expect(rohzeilenTreffer("x.ts", "/* offen\nraw.match(x)")).toEqual([]);
  });
});

describe("scanneSim: der echte Scan über src/sim/**", () => {
  test("die Sim liest keine Rohzeile per Regex", () => {
    const { dateien, treffer } = scanneSim(process.cwd());
    expect(dateien).toBeGreaterThan(20); // der Scan sieht die Sim wirklich (kein stilles Leer-Grün)
    expect(treffer).toEqual([]);
  });

  test("Negativprobe gegen den echten Scan: eine Datei mit Verstoß in einem Temp-Baum schlägt an", () => {
    const wurzel = mkdtempSync(join(tmpdir(), "kq-rohzeile-"));
    try {
      mkdirSync(join(wurzel, "src", "sim", "kubectl"), { recursive: true });
      writeFileSync(join(wurzel, "src", "sim", "kubectl", "ok.ts"), "// raw.match(x) ist nur ein Kommentar\nexport const a = 1;\n");
      writeFileSync(join(wurzel, "src", "sim", "kubectl", "boese.ts"), "export const b = (raw: string) => raw.match(/--port[=\\s]+(\\d+)/);\n");
      const { dateien, treffer } = scanneSim(wurzel);
      expect(dateien).toBe(2);
      expect(treffer.map((t) => `${t.datei}:${t.zeile}:${t.regel}`)).toEqual([
        "src/sim/kubectl/boese.ts:1:raw.match",
        "src/sim/kubectl/boese.ts:1:Flag-Regex --name[=\\s]",
      ]);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });
});
