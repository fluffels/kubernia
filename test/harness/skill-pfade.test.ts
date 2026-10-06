/* Pfad-Wächter für Skills und Agenten (#1211): kein absoluter Laufwerkspfad in `.claude/`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Vorgeschichte: der Spawn-Prompt eines Skills nannte einen festen Laufwerkspfad. Das Repo
 * liegt woanders, der Subagent startete im falschen Verzeichnis – und kein Gate meckerte. Skills
 * gehören zum Repo und werden auf jeder Maschine geklont; sie dürfen darum nur das Arbeitsverzeichnis
 * des Aufrufers verwenden (bzw. `git rev-parse --show-toplevel`).
 *
 * Grenze: erkannt werden Windows-Laufwerkspfade (`C:\…`, `C:/…`), Git-Bash-/WSL-Laufwerkspfade
 * (`/c/…`, `/mnt/c/…`) und Home-Pfade (`/Users/…`, `/home/…`) in Markdown/JS/JSON unter
 * `.claude/skills`, `agents` und `workflows`. Relative Pfade und URLs (`https://…`) bleiben erlaubt.
 * Nicht erkannt: UNC-Pfade, `~/…`, Umgebungsvariablen, Dateien außerhalb dieser drei Ordner
 * (`settings.json`, `scripts/`). Ein Laufwerks-Buchstabe, gefolgt von `\n`/`\r`/`\t` als eigenes Wort
 * (JS-Escape wie `"A:\n"`), zählt bewusst nicht als Pfad.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN = [".claude/skills", ".claude/agents", ".claude/workflows"];
const ABSOLUT =
  /\b[A-Za-z]:(?:\\{1,2}(?![nrt]\b)|\/(?!\/))\w|(?<![\w.:/-])\/(?:Users|home|mnt\/[a-z]|[a-z])\/\w/;

function findeAbsolutePfade(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((zeile, i) => ({ zeile, nr: i + 1 }))
    .filter(({ zeile }) => ABSOLUT.test(zeile))
    .map(({ nr }) => `Zeile ${nr}`);
}

function dateien(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...dateien(p));
    else if (/\.(md|js|json)$/.test(name)) out.push(p);
  }
  return out;
}

describe("Skill-Pfade (#1211)", () => {
  it("erkennt Windows- und Home-Pfade, lässt URLs und relative Pfade durch", () => {
    expect(findeAbsolutePfade("Arbeite in `D:\\work\\beispiel`.")).toEqual(["Zeile 1"]);
    expect(findeAbsolutePfade("ok\ncd D:/work/beispiel")).toEqual(["Zeile 2"]);
    expect(findeAbsolutePfade("siehe /home/nutzer/projekt")).toEqual(["Zeile 1"]);
    expect(findeAbsolutePfade("siehe /Users/nutzer/projekt")).toEqual(["Zeile 1"]);
    expect(findeAbsolutePfade("cd /c/work/beispiel")).toEqual(["Zeile 1"]);
    expect(findeAbsolutePfade("cd /mnt/d/work/beispiel")).toEqual(["Zeile 1"]);
    // im JS-Quelltext stehen Backslashes verdoppelt
    expect(findeAbsolutePfade("const R = 'D:\\\\work\\\\beispiel'")).toEqual(["Zeile 1"]);
  });

  it("lässt URLs, relative Pfade und Escape-Sequenzen durch", () => {
    expect(findeAbsolutePfade("https://example.org/a und docs/referenz/x.md")).toEqual([]);
    expect(findeAbsolutePfade("`.claude/worktrees/kq-<nr>`")).toEqual([]);
    expect(findeAbsolutePfade("siehe docs/a/b und und/oder/so")).toEqual([]);
    expect(findeAbsolutePfade("log('Phase A:\\n')")).toEqual([]);
    expect(findeAbsolutePfade("Termin 12:30 und foo:bar")).toEqual([]);
  });

  it("kein absoluter Laufwerks- oder Home-Pfad unter .claude/skills, agents, workflows", () => {
    const treffer: string[] = [];
    for (const d of SCAN) {
      const liste = dateien(join(ROOT, d));
      expect(liste.length, `${d} ist leer – der Wächter prüfte nichts`).toBeGreaterThan(0);
      for (const f of liste) {
        for (const z of findeAbsolutePfade(readFileSync(f, "utf8"))) {
          treffer.push(`${relative(ROOT, f).replace(/\\/g, "/")}: ${z}`);
        }
      }
    }
    expect(treffer).toEqual([]);
  });
});
