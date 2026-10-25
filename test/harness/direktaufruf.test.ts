/* Direktaufruf-Erkennung (#1906 L11): `istDirektaufruf(import.meta.url)` muss auch dann „ja“ sagen, wenn das Skript über einen
 * Symlink/eine Junction gestartet wird. Node löst den Einstieg zu einem echten Pfad auf (`import.meta.url`), `process.argv[1]`
 * bleibt der Pfad des Aufrufers (macOS: Temp-Ordner unter /var, ein Symlink nach /private/var). Der alte Vergleich der
 * URL-Strings lief dann ins Leere, das Skript tat nichts und endete mit Exit 0.
 *
 * Zweiter Teil: ein Scan-Wächter. Außer `scripts/direktaufruf.mjs` darf keine Skriptdatei den Vergleich selbst ausschreiben
 * (geschlossene Musterliste unten); sonst käme die Plattform-Lücke mit der nächsten Kopie zurück.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const DIREKT_LIB = pathToFileURL(join(WURZEL, "scripts", "direktaufruf.mjs")).href;

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** Legt ein Probeskript in einen echten Ordner und einen Link darauf (Junction auf Windows, Symlink sonst). */
function probe(): { echt: string; link: string } {
  const basis = mkdtempSync(join(tmpdir(), "direkt-"));
  temps.push(basis);
  const echt = join(basis, "echt");
  mkdirSync(echt);
  writeFileSync(
    join(echt, "probe.mjs"),
    `import { istDirektaufruf } from ${JSON.stringify(DIREKT_LIB)};\nconsole.log(istDirektaufruf(import.meta.url) ? "DIREKT" : "IMPORT");\n`,
  );
  const link = join(basis, "link");
  symlinkSync(echt, link, "junction");
  return { echt, link };
}

const starte = (datei: string): string => {
  const r = spawnSync(process.execPath, [datei], { encoding: "utf8" });
  return `${r.stdout}${r.stderr}`.trim();
};

describe("istDirektaufruf", () => {
  test("echter Pfad: DIREKT", () => {
    const { echt } = probe();
    expect(starte(join(echt, "probe.mjs"))).toBe("DIREKT");
  });

  test("Aufruf über Symlink/Junction (argv[1] ≠ realpath): DIREKT", () => {
    const { link } = probe();
    expect(starte(join(link, "probe.mjs"))).toBe("DIREKT");
  });

  test("Einstieg über den Link, von Node nicht aufgelöst (--preserve-symlinks-main): import.meta.url ist der Linkpfad, DIREKT über die realpath-Seite der URL", () => {
    const { link } = probe();
    const r = spawnSync(process.execPath, ["--preserve-symlinks-main", join(link, "probe.mjs")], { encoding: "utf8" });
    expect(`${r.stdout}${r.stderr}`.trim()).toBe("DIREKT");
  });

  test("Skript, das sich vor der Prüfung selbst löscht (realpath wirft): Rückfall auf den URL-Vergleich ist DIREKT", () => {
    const { echt } = probe();
    const datei = join(echt, "weg.mjs");
    writeFileSync(
      datei,
      `import { unlinkSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\nimport { istDirektaufruf } from ${JSON.stringify(DIREKT_LIB)};\nunlinkSync(fileURLToPath(import.meta.url));\nconsole.log(istDirektaufruf(import.meta.url) ? "DIREKT" : "IMPORT");\n`,
    );
    // Über den echten Pfad starten: sonst unterscheidet sich argv[1] von import.meta.url (macOS: /var → /private/var) und der Rückfall hätte nichts zu vergleichen.
    expect(starte(realpathSync(datei))).toBe("DIREKT");
  });

  test("als Modul importiert: IMPORT, nicht DIREKT", () => {
    const { echt } = probe();
    const haupt = join(echt, "haupt.mjs");
    writeFileSync(haupt, `import ${JSON.stringify(pathToFileURL(join(echt, "probe.mjs")).href)};\n`);
    // Das importierte Skript ist nicht der Einstieg.
    expect(starte(haupt)).toBe("IMPORT");
  });

  test("nicht auflösbare URL oder fremder Pfad: Rückfall auf den URL-Vergleich, kein Wurf, kein Direktaufruf", async () => {
    const { istDirektaufruf } = (await import(/* @vite-ignore */ DIREKT_LIB)) as { istDirektaufruf: (u: string) => boolean };
    expect(istDirektaufruf("file:///gibt/es/nicht.mjs")).toBe(false);
    expect(istDirektaufruf("https://example.org/x.mjs")).toBe(false);
  });

  test("ohne argv[1] (z. B. `node -e`): kein Direktaufruf", () => {
    const code = `import(${JSON.stringify(DIREKT_LIB)}).then((m) => console.log(m.istDirektaufruf("file:///x.mjs") ? "DIREKT" : "IMPORT"))`;
    const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8" });
    expect(r.stdout.trim()).toBe("IMPORT");
  });
});

/** Geschlossene Liste der ausgeschriebenen Schreibweisen, die nur `direktaufruf.mjs` enthalten darf. */
const VERBOTEN: [string, RegExp][] = [
  ["pathToFileURL(process.argv[1]…)", /pathToFileURL\(\s*process\.argv\[1\]/],
  ["import.meta.url === …", /import\.meta\.url\s*===/],
  ["fileURLToPath(import.meta.url) === resolve(process.argv[1])", /fileURLToPath\(import\.meta\.url\)\s*===\s*resolve\(/],
];

/** Alle Skriptdateien unter Verzeichnissen, in denen ein Direktaufruf-Guard stehen kann. */
function skriptDateien(): string[] {
  const aus: string[] = [];
  const gehe = (ordner: string): void => {
    if (!existsSync(ordner)) return;
    for (const e of readdirSync(ordner, { withFileTypes: true })) {
      const pfad = join(ordner, e.name);
      if (e.isDirectory()) gehe(pfad);
      else if (/\.(mjs|cjs|js)$/.test(e.name) || ordner.endsWith(".githooks")) aus.push(pfad);
    }
  };
  for (const d of ["scripts", ".githooks", ".claude/hooks"]) gehe(join(WURZEL, d));
  return aus;
}

/** Treffer je Datei (Pfad relativ zur Wurzel, mit Musternamen). Pur bis auf das Lesen. */
export function ausgeschriebeneGuards(dateien: string[], lies: (p: string) => string = (p) => readFileSync(p, "utf8")): string[] {
  const treffer: string[] = [];
  for (const d of dateien) {
    const text = lies(d);
    for (const [name, re] of VERBOTEN) if (re.test(text)) treffer.push(`${d.slice(WURZEL.length).replaceAll("\\", "/")}: ${name}`);
  }
  return treffer.sort();
}

describe("Scan-Wächter: keine ausgeschriebene Kopie des Direktaufruf-Vergleichs", () => {
  const dateien = skriptDateien().filter((d) => !d.replaceAll("\\", "/").endsWith("scripts/direktaufruf.mjs"));

  test("Plausibilität: der Scan sieht die Skripte", () => {
    expect(dateien.length).toBeGreaterThanOrEqual(80);
  });

  test("außer direktaufruf.mjs schreibt keine Skriptdatei den Vergleich aus", () => {
    expect(ausgeschriebeneGuards(dateien)).toEqual([]);
  });

  test("die Musterliste erkennt jede Schreibweise (Gegenprobe)", () => {
    const text: Record<string, string> = {
      a: "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();",
      b: 'if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();',
      c: "if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();",
      d: "if (istDirektaufruf(import.meta.url)) main();",
    };
    const treffer = ausgeschriebeneGuards(Object.keys(text).map((k) => join(WURZEL, k)), (p) => text[p.slice(WURZEL.length)] ?? "");
    expect(treffer.map((t) => t.split(":")[0])).toEqual(["a", "a", "b", "b", "c"]);
  });
});

/** Geschlossene Musterliste für den Importweg: `import { …istDirektaufruf… } from "<Pfad>"` und `export { …istDirektaufruf… } from`. */
const IMPORTWEG = /import\s*\{[^}]*\bistDirektaufruf\b[^}]*\}\s*from\s*["']([^"']+)["']/g;
const REEXPORT = /export\s*\{[^}]*\bistDirektaufruf\b[^}]*\}\s*from/;

/**
 * Dateien, die `istDirektaufruf` aus einem anderen Modul als `direktaufruf.mjs` importieren oder weiterreichen (ein Importweg, kein Re-Export).
 * Bekannte Grenze: nur die genannten Schreibweisen; die umgekehrte Schreibweise des Vergleichs (`process.argv[1] === fileURLToPath(…)`)
 * erkennt der Scan oben nicht, ebenso keinen Import mit Alias (`istDirektaufruf as x`) oder `import()`.
 */
export function fremdeImportwege(dateien: string[], lies: (p: string) => string = (p) => readFileSync(p, "utf8")): string[] {
  const treffer: string[] = [];
  for (const d of dateien) {
    const text = lies(d);
    const name = d.slice(WURZEL.length).replaceAll("\\", "/");
    for (const m of text.matchAll(IMPORTWEG)) if (!/(?:^|\/)direktaufruf\.mjs$/.test(m[1])) treffer.push(`${name}: importiert aus ${m[1]}`);
    if (REEXPORT.test(text)) treffer.push(`${name}: reicht istDirektaufruf weiter`);
  }
  return treffer.sort();
}

describe("Scan-Wächter: ein Importweg für istDirektaufruf", () => {
  const dateien = skriptDateien().filter((d) => !d.replaceAll("\\", "/").endsWith("scripts/direktaufruf.mjs"));

  test("kein Skript importiert istDirektaufruf aus einem anderen Modul als direktaufruf.mjs, keines reicht es weiter", () => {
    expect(fremdeImportwege(dateien)).toEqual([]);
  });

  test("Gegenprobe: fremder Importweg, Re-Export und mehrzeiliger Import werden erkannt, der richtige Weg nicht", () => {
    const text: Record<string, string> = {
      a: 'import { emit, istDirektaufruf } from "./hook-io.mjs";',
      b: 'export { istDirektaufruf } from "./direktaufruf.mjs";',
      c: 'import {\n  istDirektaufruf,\n  readStdin,\n} from "../hook-io.mjs";',
      d: 'import { istDirektaufruf } from "./direktaufruf.mjs";',
      e: 'import { istDirektaufruf } from "../direktaufruf.mjs";',
      f: 'import { emit } from "./hook-io.mjs";',
    };
    const treffer = fremdeImportwege(Object.keys(text).map((k) => join(WURZEL, k)), (p) => text[p.slice(WURZEL.length)] ?? "");
    expect(treffer).toEqual(["a: importiert aus ./hook-io.mjs", "b: reicht istDirektaufruf weiter", "c: importiert aus ../hook-io.mjs"]);
  });
});
