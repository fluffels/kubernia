/* Zeilenende-Wächter (#1026) – alles unter `.claude/` muss mit LF ausgecheckt werden.
 *
 * WARUM: Auf einem Windows-Checkout mit `core.autocrlf=true` landete
 * `.claude/workflows/kubernia-ticket.js` mit CRLF im Working Tree. Claude Code übergibt
 * den Skript-Text an den Permission-Dialog, und der lehnt Steuerzeichen ab (`\r` wäre im
 * Freigabe-Dialog unsichtbar) – der Workflow ließ sich dadurch gar nicht starten. Der
 * Checkout-Zeilenumbruch ist hier also FUNKTIONAL, nicht kosmetisch (gleiche Begründung
 * wie die `*.sh`-/`.githooks/*`-Einträge in `.gitattributes`).
 *
 * WIE: Der Wächter fragt Git selbst (`git check-attr eol`) statt die `.gitattributes`-
 * Zeile per Regex zu suchen – so zählt die echte Attribut-Auflösung (Muster, Reihenfolge,
 * spätere Überschreibungen), nicht eine bestimmte Schreibweise. Geprüft werden alle
 * versionierten `.claude/`-Dateien plus ein paar noch NICHT existierende Beispielpfade:
 * eine neue Workflow-/Skill-Datei soll automatisch mit abgedeckt sein, nicht erst, wenn
 * jemand die Regel nachzieht.
 *
 * ⚠ GRENZE (ehrlich): Der Test belegt, dass Git für diese Pfade LF erzwingt – nicht, dass
 * eine BESTEHENDE Windows-Arbeitskopie schon LF hat. Die bekommt es erst nach einem
 * Neu-Auschecken (`git checkout -- .claude` bzw. frischer Worktree). Ein direkter
 * CR-Scan des Working Trees wäre in der Linux-CI immer grün und darum kein Gate.
 *
 * Fitness-Function-Kategorie (Struktur-Regel, kein Verhaltens-Test), Präzedenz
 * test/agents-md-native.test.ts. Ausführen mit:  npm test
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const git = (args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });

/**
 * Parst die `-z`-Ausgabe von `git check-attr -z eol -- <pfade>` (NUL-getrennte Tripel
 * pfad/attribut/wert) und liefert alle Pfade, deren `eol` NICHT `lf` ist.
 */
function pfadeOhneLf(checkAttrZ: string): string[] {
  const teile = checkAttrZ.split("\0");
  const ohneLf: string[] = [];
  for (let i = 0; i + 2 < teile.length; i += 3) {
    if (teile[i + 2] !== "lf") ohneLf.push(teile[i]);
  }
  return ohneLf;
}

const eolOhneLf = (pfade: string[]) => pfadeOhneLf(git(["check-attr", "-z", "eol", "--", ...pfade]));

describe("pfadeOhneLf (Parser)", () => {
  it("meldet nur Pfade ohne eol=lf", () => {
    const ausgabe = ["a.js", "eol", "lf", "b.js", "eol", "unspecified", "c.js", "eol", "crlf", ""].join("\0");
    expect(pfadeOhneLf(ausgabe)).toEqual(["b.js", "c.js"]);
  });

  it("leere Ausgabe ergibt keine Funde", () => {
    expect(pfadeOhneLf("")).toEqual([]);
  });
});

describe(".claude/ wird mit LF ausgecheckt (#1026)", () => {
  const versioniert = git(["ls-files", "-z", "--", ".claude"]).split("\0").filter(Boolean);

  it("findet die versionierten .claude/-Dateien überhaupt (sonst prüft der Wächter nichts)", () => {
    expect(versioniert).toContain(".claude/workflows/kubernia-ticket.js");
  });

  it("jede versionierte .claude/-Datei hat eol=lf", () => {
    expect(eolOhneLf(versioniert)).toEqual([]);
  });

  it("deckt auch künftige Workflow-/Skill-/Agent-Dateien ab", () => {
    const kuenftig = [
      ".claude/workflows/neuer-workflow.js",
      ".claude/skills/neuer-skill/SKILL.md",
      ".claude/agents/neuer-agent.md",
    ];
    expect(eolOhneLf(kuenftig)).toEqual([]);
  });

  it("Gegenprobe: außerhalb von .claude/ greift die Regel nicht (Wächter ist nicht trivial grün)", () => {
    expect(eolOhneLf(["src/main.ts"])).toEqual(["src/main.ts"]);
  });
});
