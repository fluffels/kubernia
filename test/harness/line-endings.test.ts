/* Zeilenende-Wächter (#1026, #1476) – alles unter `.claude/` und jede Textdatei des Repos
 * muss mit LF ausgecheckt werden (globale Regel `* text=auto eol=lf` in `.gitattributes`).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
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
 * #1476: Die globale Regel gilt für alle Textdateien, weil Doku-Wächter Dateien zeilenweise
 * lesen und unter `core.autocrlf=true` sonst CRLF sähen, die Linux-CI aber LF. Zusätzlich
 * prüft der Wächter den Index (`git ls-files --eol`): keine Datei darf als CRLF oder gemischt
 * eingecheckt sein, Binärdateien bleiben `i/-text`.
 *
 * ⚠ GRENZE (ehrlich): Der Test belegt, dass Git für diese Pfade LF erzwingt – nicht, dass
 * eine BESTEHENDE Windows-Arbeitskopie schon LF hat. Die bekommt es erst nach einem
 * Neu-Auschecken (`git checkout -- .claude` bzw. frischer Worktree). Ein direkter
 * CR-Scan des Working Trees wäre in der Linux-CI immer grün und darum kein Gate.
 *
 * Fitness-Function-Kategorie (Struktur-Regel, kein Verhaltens-Test), Präzedenz
 * test/harness/agents-md-native.test.ts. Ausführen mit:  npm test
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const git = (args: string[], input?: string) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", input });

/** Attributwert je Pfad (`git check-attr --stdin -z`): die Pfade gehen über stdin, nicht als argv (Windows begrenzt die Kommandozeile auf 32.767 Zeichen). */
function attrWerte(attr: string, pfade: string[]): Map<string, string> {
  const teile = git(["check-attr", "--stdin", "-z", attr], pfade.join("\0")).split("\0");
  const werte = new Map<string, string>();
  for (let i = 0; i + 2 < teile.length; i += 3) werte.set(teile[i], teile[i + 2]);
  return werte;
}

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

/**
 * Parst `git ls-files --eol` (Zeilen `i/<index> w/<arbeitskopie> attr/<attr>\t<pfad>`) und
 * liefert die Pfade, deren Index-Zeilenende `crlf` oder `mixed` ist.
 */
function pfadeMitCrlfImIndex(eolAusgabe: string): string[] {
  const funde: string[] = [];
  for (const zeile of eolAusgabe.split("\n")) {
    const [kopf, pfad] = zeile.split("\t");
    if (pfad !== undefined && /^i\/(crlf|mixed)\b/.test(kopf)) funde.push(pfad);
  }
  return funde;
}

const eolOhneLf = (pfade: string[]) => pfadeOhneLf(git(["check-attr", "--stdin", "-z", "eol"], pfade.join("\0")));

describe("pfadeOhneLf (Parser)", () => {
  it("meldet nur Pfade ohne eol=lf", () => {
    const ausgabe = ["a.js", "eol", "lf", "b.js", "eol", "unspecified", "c.js", "eol", "crlf", ""].join("\0");
    expect(pfadeOhneLf(ausgabe)).toEqual(["b.js", "c.js"]);
  });

  it("leere Ausgabe ergibt keine Funde", () => {
    expect(pfadeOhneLf("")).toEqual([]);
  });
});

describe("pfadeMitCrlfImIndex (Parser)", () => {
  it("meldet crlf und mixed, nicht lf, -text oder none", () => {
    const ausgabe = [
      "i/lf    w/lf    attr/text=auto eol=lf \ta.md",
      "i/crlf  w/crlf  attr/                 \tb.md",
      "i/mixed w/lf    attr/                 \tc.md",
      "i/-text w/-text attr/                 \td.png",
      "i/none  w/none  attr/                 \te.json",
    ].join("\n");
    expect(pfadeMitCrlfImIndex(ausgabe)).toEqual(["b.md", "c.md"]);
  });

  it("leere Ausgabe ergibt keine Funde", () => {
    expect(pfadeMitCrlfImIndex("")).toEqual([]);
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

  it("globale Regel: jede versionierte Textdatei hat eol=lf (#1476)", () => {
    const alle = git(["ls-files", "-z"]).split("\0").filter(Boolean);
    // Binärdateien haben bewusst kein eol=lf (text=auto erkennt sie, Index i/-text).
    const eol = git(["ls-files", "--eol"]).split("\n").filter(Boolean);
    const binaer = new Set(eol.filter((z) => z.startsWith("i/-text")).map((z) => z.split("\t")[1]));
    const text = alle.filter((p) => !binaer.has(p));
    expect(text.length).toBeGreaterThan(500);
    expect(eolOhneLf(text)).toEqual([]);
  });

  it("deckt auch künftige Pfade außerhalb von .claude/ ab (#1476)", () => {
    expect(eolOhneLf(["docs/neu.md", "src/neu.ts", "test/neu.test.ts"])).toEqual([]);
  });

  it("Binär-Assets bleiben i/-text (text=auto fasst sie nicht an)", () => {
    const png = git(["ls-files", "--eol", "--", "assets/pixellab/*.png"]).split("\n").filter(Boolean);
    expect(png.length).toBeGreaterThan(0);
    for (const zeile of png) expect(zeile.startsWith("i/-text")).toBe(true);
    // `i/-text` ist nur die Inhaltserkennung des Blobs; dass Git die Dateien auch künftig nicht als Text
    // normalisiert, hängt an `text=auto` (ein `* text` würde sie beim nächsten `git add` anfassen).
    const pfade = png.map((z) => z.split("\t")[1]);
    for (const wert of attrWerte("text", pfade).values()) expect(wert).toBe("auto");
  });

  it("der Index enthält keine CRLF-Datei (#1476)", () => {
    expect(pfadeMitCrlfImIndex(git(["ls-files", "--eol"]))).toEqual([]);
  });
});
