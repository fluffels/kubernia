/* Skill-Zeiger-Wächter (#1848, ADR 0022 Fortschreibung): `.claude/skills/<name>/SKILL.md` ist ein generierter Zeiger auf die
 * Skill-Quelle `.agents/skills/<name>/SKILL.md`. Rot (mit Dateiname und Fix-Zeile `npm run skills:sync`), wenn ein Zeiger von
 * seiner Quelle abweicht, eine Quelle keinen Zeiger hat, ein Zeiger keine Quelle hat, unter `.claude/skills/` ein Volltext-Skill
 * liegt (immer, es gibt keine Übergangsliste mehr, #1850), eine lose Datei direkt unter `.claude/skills/` liegt oder einer Quelle
 * `name`/`description` fehlt.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Grenzen: geprüft wird die Gleichheit von Zeiger und Quelle, nicht dass ein Werkzeug dem Zeiger tatsächlich folgt (Probe-Lauf
 * im PR); der Stand wird per Dateisystem gelesen, auch Ungetracktes (lokale Skills) zählt. */
import { afterEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WURZEL, lies, repoDateien } from "./repo-texte";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as besitzLibModul from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as skillsSyncModul from "../../scripts/skills-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { escapeRegex } from "../../scripts/ticket-namen.mjs";
const maskiere = escapeRegex as (s: string) => string;
const projektwertLauf = (besitzLibModul as unknown as { projektwertLauf: (w: string, c: () => unknown, o?: { schreiben?: boolean }) => { fehler: string[]; geaendert: string[] } }).projektwertLauf;

interface Befund { datei: string; meldung: string; fix: string }
interface Quelle { ordner: string; text: string | null }
interface Zeiger { ordner: string; text: string | null; dateien: string[] }
interface LaufErgebnis { befunde: Befund[]; unbrauchbar: string[]; geschrieben: string[]; geloescht: string[]; gemeldet: string[] }
// Typisierung des .mjs-Imports per Assertion (Muster test/docdrift.test.ts), keine neuen eslint-Suppressions.
const sync = skillsSyncModul as unknown as {
  ZEIGER_MARKE: string;
  zeigerText: (name: string, quelltext: string) => string;
  pruefeSkills: (a: { quellen: Quelle[]; zeiger: Zeiger[]; lose?: string[] }) => Befund[];
  liesStand: (wurzel: string) => { quellen: Quelle[]; zeiger: Zeiger[]; lose: string[] };
  lauf: (a: { wurzel: string; tool?: string; check?: boolean; prune?: boolean }) => LaufErgebnis;
};

const QUELLE = [
  "---",
  "name: demo",
  "description: Ein Demo-Skill: tut etwas.",
  "# factory:projektwert agenten.ticketSkill",
  "model: sonnet",
  "effort: medium",
  "---",
  "",
  "# Rumpf",
  "Text mit [Link](../../../AGENTS.md).",
  "",
].join("\n");

const zeigerVon = (name: string, text: string): Zeiger => ({ ordner: name, text: sync.zeigerText(name, text), dateien: ["SKILL.md"] });
const stand = (quellen: Quelle[], zeiger: Zeiger[], lose: string[] = []) => sync.pruefeSkills({ quellen, zeiger, lose });

describe("Zeiger-Text", () => {
  const zeiger = sync.zeigerText("demo", QUELLE);

  test("trägt das Frontmatter wörtlich, auch model, effort und Projektwert-Zeile", () => {
    const fm = QUELLE.split("\n").slice(0, 7).join("\n");
    expect(zeiger.startsWith(fm + "\n")).toBe(true);
    for (const zeile of ["# factory:projektwert agenten.ticketSkill", "model: sonnet", "effort: medium"]) {
      expect(zeiger.split("\n")).toContain(zeile);
    }
  });

  test("Rumpf höchstens drei Zeilen: Leerzeile, Marke, Verweis auf die Quelle", () => {
    const rumpf = zeiger.trimEnd().split("\n").slice(7);
    expect(rumpf).toEqual(["", sync.ZEIGER_MARKE, "Lies `.agents/skills/demo/SKILL.md` und folge ihm."]);
    expect(zeiger.endsWith("\n")).toBe(true);
  });

  test("CRLF-Quelle ergibt denselben Zeiger wie LF", () => {
    expect(sync.zeigerText("demo", QUELLE.replace(/\n/g, "\r\n"))).toBe(zeiger);
    expect(zeiger).not.toContain("\r");
  });
});

describe("pruefeSkills: Negativfälle mit Dateiname und Fix-Zeile", () => {
  const q: Quelle = { ordner: "demo", text: QUELLE };
  const z = zeigerVon("demo", QUELLE);

  test("konsistenter Stand ist grün", () => {
    expect(stand([q], [z])).toEqual([]);
  });

  test("von Hand geänderte description im Zeiger", () => {
    const geaendert = { ...z, text: z.text!.replace("Ein Demo-Skill", "Ein anderer Skill") };
    const b = stand([q], [geaendert]);
    expect(b).toHaveLength(1);
    expect(b[0].datei).toBe(".claude/skills/demo/SKILL.md");
    expect(b[0].fix).toContain("npm run skills:sync");
  });

  test("Quelle ohne Zeiger", () => {
    const b = stand([q], []);
    expect(b.map((x) => x.datei)).toEqual([".claude/skills/demo/SKILL.md"]);
    expect(b[0].fix).toContain("npm run skills:sync");
  });

  test("Zeiger ohne Quelle (Fix: --prune)", () => {
    const b = stand([], [z]);
    expect(b.map((x) => x.datei)).toEqual([".claude/skills/demo/SKILL.md"]);
    expect(b[0].fix).toBe("npm run skills:sync -- --prune");
  });

  test("Volltext-Skill unter .claude/skills/ ist immer rot, es gibt keine Ausnahmeliste", () => {
    const voll: Zeiger = { ordner: "voll", text: "---\nname: voll\ndescription: x\n---\nText\n", dateien: ["SKILL.md", "ablauf.md"] };
    const b = stand([], [voll]);
    expect(b).toHaveLength(1);
    expect(b[0].datei).toBe(".claude/skills/voll/SKILL.md");
    expect(b[0].meldung).toContain("Volltext-Skill");
    expect(b[0].fix).toContain("npm run skills:sync");
    // ein Skill mit dem Namen eines früheren Übergangs-Eintrags ist nicht besser gestellt
    for (const name of ["factory", "factory-ticket"]) expect(stand([], [{ ...voll, ordner: name }]), name).toHaveLength(1);
  });

  test("lose Datei direkt unter .claude/skills/ ist rot, mit Dateiname", () => {
    const b = stand([q], [z], ["notizen.md"]);
    expect(b).toHaveLength(1);
    expect(b[0].datei).toBe(".claude/skills/notizen.md");
    expect(b[0].meldung).toContain("lose Datei");
    expect(stand([q], [z], [])).toEqual([]);
  });

  test("Volltext und Quelle gleichzeitig", () => {
    const b = stand([q], [{ ordner: "demo", text: QUELLE, dateien: ["SKILL.md"] }]);
    expect(b).toHaveLength(1);
    expect(b[0].meldung).toContain("Volltext");
  });

  test.each([
    ["name", "---\ndescription: d\n---\n", "name"],
    ["description", "---\nname: n\n---\n", "description"],
    ["Frontmatter", "# nur Text\n", "Frontmatter"],
  ])("Quelle ohne %s", (_wer, text, wort) => {
    const b = stand([{ ordner: "kaputt", text }], []);
    expect(b).toHaveLength(1);
    expect(b[0].datei).toBe(".agents/skills/kaputt/SKILL.md");
    expect(b[0].meldung).toContain(wort);
  });

  test("Quellordner ohne SKILL.md", () => {
    const b = stand([{ ordner: "leer", text: null }], []);
    expect(b.map((x) => x.datei)).toEqual([".agents/skills/leer/SKILL.md"]);
  });

  test("name darf vom Ordnernamen abweichen", () => {
    const text = QUELLE.replace("name: demo", "name: anders");
    expect(stand([{ ordner: "demo", text }], [zeigerVon("demo", text)])).toEqual([]);
  });

  test("fremde Datei im Zeiger-Ordner", () => {
    const b = stand([q], [{ ...z, dateien: ["SKILL.md", "notizen.md"] }]);
    expect(b.map((x) => x.datei)).toEqual([".claude/skills/demo/notizen.md"]);
  });
});

describe("pruefeSkills: leere und kaputte Ordner", () => {
  test("Zeiger-Ordner ohne SKILL.md: bei vorhandener Quelle fehlt der Zeiger", () => {
    const q: Quelle = { ordner: "demo", text: QUELLE };
    const b = stand([q], [{ ordner: "demo", text: null, dateien: [] }]);
    expect(b.map((x) => x.datei)).toEqual([".claude/skills/demo/SKILL.md"]);
    expect(b[0].meldung).toContain("Zeiger fehlt");
  });

  test("Zeiger-Ordner ohne SKILL.md und ohne Quelle ist rot", () => {
    const leer: Zeiger = { ordner: "leer", text: null, dateien: [] };
    expect(stand([], [leer]).map((x) => x.datei)).toEqual([".claude/skills/leer/SKILL.md"]);
  });

  test("Frontmatter ohne schließendes `---` zählt als fehlend", () => {
    const b = stand([{ ordner: "offen", text: "---\nname: x\ndescription: y\n" }], []);
    expect(b.map((x) => x.meldung)).toEqual(["Quelle ohne Frontmatter"]);
  });

  test("das Modul kennt keine Übergangsliste mehr", () => {
    expect(Object.keys(sync)).not.toContain("UEBERGANG");
  });
});

describe("echter Stand des Repos", () => {
  const echt = sync.liesStand(WURZEL);

  test("Zeiger und Quellen stimmen überein, unter .claude/skills/ liegt nur noch Zeiger", () => {
    expect(sync.pruefeSkills(echt)).toEqual([]);
    expect(echt.lose).toEqual([]);
  });

  test("Leerlauf-Schutz: die Quellen von forum, factory und factory-ticket liegen im Scan, der Ablauf liegt in der Quelle (#1850)", () => {
    for (const name of ["forum", "factory", "factory-ticket"]) {
      expect(echt.quellen.map((q) => q.ordner), name).toContain(name);
      expect(echt.zeiger.map((z) => z.ordner), name).toContain(name);
    }
    expect(echt.zeiger.find((z) => z.ordner === "factory")?.dateien).toEqual(["SKILL.md"]);
    expect(lies(".agents/skills/factory/ablauf.md").length).toBeGreaterThan(1000);
  });

  test("die Zeiger der Ticket-Skills tragen model, effort und die Projektwert-Zeile samt name (#1850)", () => {
    const zeiger = echt.zeiger.find((z) => z.ordner === "factory-ticket")?.text ?? "";
    for (const zeile of ["# factory:projektwert agenten.ticketSkill", "model: sonnet", "effort: medium"]) expect(zeiger.split("\n"), zeile).toContain(zeile);
    expect(zeiger).toMatch(/^name: \S+$/m);
    expect(zeiger.split("\n")).toContain("Lies `.agents/skills/factory-ticket/SKILL.md` und folge ihm.");
  });

  test("setup ruft den Sync mit --prune auf, package.json kennt skills:sync", () => {
    expect(lies("scripts/setup.mjs")).toContain("npm run skills:sync -- --prune");
    expect((JSON.parse(lies("package.json")) as { scripts: Record<string, string> }).scripts["skills:sync"]).toBe("node scripts/skills-sync.mjs");
  });

  test(".gitattributes setzt für .agents LF, Quelle und Zeiger sind nicht ignoriert", () => {
    expect(lies(".gitattributes").split("\n")).toContain(".agents/** text eol=lf");
    const attr = spawnSync("git", ["check-attr", "eol", "--", ".agents/skills/neu/SKILL.md"], { cwd: WURZEL, encoding: "utf8" });
    expect(attr.stdout).toContain("eol: lf");
    const ignoriert = (pfad: string) => spawnSync("git", ["check-ignore", "--no-index", "-q", pfad], { cwd: WURZEL }).status === 0;
    expect(ignoriert(".claude/settings.local.json")).toBe(true); // Negativkontrolle: das Prüfen greift überhaupt
    for (const pfad of [".claude/skills/forum/SKILL.md", ".claude/agents/factory-planer.md", ".agents/skills/forum/SKILL.md"]) {
      expect(ignoriert(pfad), pfad).toBe(false);
    }
  });
});

describe("lauf auf einem Temp-Verzeichnis", () => {
  const ordner: string[] = [];
  afterEach(() => {
    for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
  });
  const neu = (): string => {
    const o = mkdtempSync(join(tmpdir(), "skills-sync-"));
    ordner.push(o);
    return o;
  };
  const schreibe = (w: string, pfad: string, text: string) => {
    mkdirSync(join(w, pfad, ".."), { recursive: true });
    writeFileSync(join(w, pfad), text);
  };
  const zeigerPfad = (w: string, n = "demo") => join(w, ".claude/skills", n, "SKILL.md");

  test("erzeugt den Zeiger, der zweite Lauf ändert nichts (auch bei CRLF-Quelle)", () => {
    const w = neu();
    schreibe(w, ".agents/skills/demo/SKILL.md", QUELLE.replace(/\n/g, "\r\n"));
    const erster = sync.lauf({ wurzel: w });
    expect(erster.geschrieben).toEqual([".claude/skills/demo/SKILL.md"]);
    const bytes = readFileSync(zeigerPfad(w));
    const zweiter = sync.lauf({ wurzel: w });
    expect(zweiter.geschrieben).toEqual([]);
    expect(readFileSync(zeigerPfad(w)).equals(bytes)).toBe(true);
    expect(bytes.toString()).toBe(sync.zeigerText("demo", QUELLE));
    expect(sync.lauf({ wurzel: w, check: true }).befunde).toEqual([]);
  });

  test("aktualisiert einen Zeiger mit Marke, der abweicht", () => {
    const w = neu();
    schreibe(w, ".agents/skills/demo/SKILL.md", QUELLE);
    sync.lauf({ wurzel: w });
    schreibe(w, ".agents/skills/demo/SKILL.md", QUELLE.replace("Ein Demo-Skill", "Neu"));
    expect(sync.lauf({ wurzel: w }).geschrieben).toHaveLength(1);
    expect(readFileSync(zeigerPfad(w), "utf8")).toContain("description: Neu: tut etwas.");
  });

  test("überschreibt nie einen Volltext-Ordner ohne Marke, meldet ihn", () => {
    const w = neu();
    schreibe(w, ".agents/skills/demo/SKILL.md", QUELLE);
    schreibe(w, ".claude/skills/demo/SKILL.md", "---\nname: demo\n---\nvoll\n");
    const e = sync.lauf({ wurzel: w });
    expect(e.geschrieben).toEqual([]);
    expect(e.gemeldet).toEqual([".claude/skills/demo"]);
    expect(readFileSync(zeigerPfad(w), "utf8")).toContain("voll");
  });

  test("--check schreibt nie, auch nicht mit --prune", () => {
    const w = neu();
    schreibe(w, ".agents/skills/demo/SKILL.md", QUELLE);
    schreibe(w, ".claude/skills/weg/SKILL.md", sync.zeigerText("weg", QUELLE));
    const e = sync.lauf({ wurzel: w, check: true, prune: true });
    expect(e.befunde.length).toBeGreaterThanOrEqual(2);
    expect(e.geschrieben).toEqual([]);
    expect(e.geloescht).toEqual([]);
    expect(existsSync(zeigerPfad(w))).toBe(false);
    expect(existsSync(zeigerPfad(w, "weg"))).toBe(true);
  });

  test("--prune entfernt den Zeiger-Ordner eines gelöschten Quell-Skills; ohne --prune bleibt er und wird gemeldet", () => {
    const w = neu();
    schreibe(w, ".claude/skills/weg/SKILL.md", sync.zeigerText("weg", QUELLE));
    const ohne = sync.lauf({ wurzel: w });
    expect(ohne.gemeldet).toEqual([".claude/skills/weg"]);
    expect(existsSync(zeigerPfad(w, "weg"))).toBe(true);
    const mit = sync.lauf({ wurzel: w, prune: true });
    expect(mit.geloescht).toEqual([".claude/skills/weg"]);
    expect(existsSync(join(w, ".claude/skills/weg"))).toBe(false);
  });

  test("--prune löscht nie Volltext-Skills oder Ordner mit fremden Dateien, es meldet sie nur", () => {
    const w = neu();
    schreibe(w, ".claude/skills/voll/SKILL.md", "---\nname: voll\n---\nText\n");
    schreibe(w, ".claude/skills/fremd/SKILL.md", sync.zeigerText("fremd", QUELLE));
    schreibe(w, ".claude/skills/fremd/notizen.md", "meine Notizen");
    const e = sync.lauf({ wurzel: w, prune: true });
    expect(e.geloescht).toEqual([]);
    expect([...e.gemeldet].sort()).toEqual([".claude/skills/fremd", ".claude/skills/voll"]);
    expect(readdirSync(join(w, ".claude/skills")).sort()).toEqual(["fremd", "voll"]);
  });

  test("--prune meldet einen Volltext ohne Quelle, ohne ihn anzufassen; ohne --prune ist der Lauf still, --check meldet ihn", () => {
    const w = neu();
    const text = "---\nname: voll\ndescription: d\n---\nText\n";
    schreibe(w, ".claude/skills/voll/SKILL.md", text);
    const e = sync.lauf({ wurzel: w, prune: true });
    expect(e.gemeldet).toEqual([".claude/skills/voll"]);
    expect(e.geloescht).toEqual([]);
    expect(readFileSync(zeigerPfad(w, "voll"), "utf8")).toBe(text);
    expect(sync.lauf({ wurzel: w }).gemeldet).toEqual([]);
    expect(sync.lauf({ wurzel: w, check: true }).befunde.map((b) => b.datei)).toEqual([".claude/skills/voll/SKILL.md"]);
  });

  test("eine lose Datei unter .claude/skills/ macht --check rot und wird nie angefasst", () => {
    const w = neu();
    schreibe(w, ".agents/skills/demo/SKILL.md", QUELLE);
    sync.lauf({ wurzel: w });
    schreibe(w, ".claude/skills/notizen.md", "lose");
    expect(sync.lauf({ wurzel: w, check: true }).befunde.map((b) => b.datei)).toEqual([".claude/skills/notizen.md"]);
    const e = sync.lauf({ wurzel: w, prune: true });
    expect(e.geloescht).toEqual([]);
    expect(readFileSync(join(w, ".claude/skills/notizen.md"), "utf8")).toBe("lose");
  });

  test("projektwerte --write bei geändertem agenten.ticketSkill ändert Quelle und Zeiger, danach ist der Stand grün (#1850)", () => {
    const w = neu();
    schreibe(w, ".agents/skills/factory-ticket/SKILL.md", ["---", "# factory:projektwert agenten.ticketSkill", "name: alt", "description: d", "model: sonnet", "---", "", "Rumpf", ""].join("\n"));
    sync.lauf({ wurzel: w });
    expect(sync.pruefeSkills(sync.liesStand(w))).toEqual([]);
    const config = { agenten: { ticketSkill: "neuername" } };
    const r = projektwertLauf(w, () => config, { schreiben: true });
    expect(r.fehler).toEqual([]);
    expect([...r.geaendert].sort()).toEqual([".agents/skills/factory-ticket/SKILL.md", ".claude/skills/factory-ticket/SKILL.md"]);
    expect(readFileSync(join(w, ".agents/skills/factory-ticket/SKILL.md"), "utf8")).toContain("name: neuername");
    expect(readFileSync(zeigerPfad(w, "factory-ticket"), "utf8")).toContain("name: neuername");
    expect(sync.pruefeSkills(sync.liesStand(w))).toEqual([]);
  });

  test("unbrauchbare Quelle wird gemeldet und kein Zeiger geschrieben", () => {
    const w = neu();
    schreibe(w, ".agents/skills/kaputt/SKILL.md", "---\nname: kaputt\n---\n");
    const e = sync.lauf({ wurzel: w });
    expect(e.unbrauchbar).toEqual(["kaputt"]);
    expect(existsSync(zeigerPfad(w, "kaputt"))).toBe(false);
  });

  test("Quelle ohne name, Quellordner ohne SKILL.md: unbrauchbar, kein Zeiger", () => {
    const w = neu();
    schreibe(w, ".agents/skills/ohnename/SKILL.md", "---\ndescription: d\n---\n");
    mkdirSync(join(w, ".agents/skills/leer"), { recursive: true });
    schreibe(w, ".agents/skills/offen/SKILL.md", "---\nname: offen\ndescription: d\n");
    const e = sync.lauf({ wurzel: w });
    expect([...e.unbrauchbar].sort()).toEqual(["leer", "offen", "ohnename"]);
    expect(e.geschrieben).toEqual([]);
    expect(existsSync(join(w, ".claude/skills"))).toBe(false);
  });

  test("leerer Zeiger-Ordner wird gefüllt", () => {
    const w = neu();
    schreibe(w, ".agents/skills/demo/SKILL.md", QUELLE);
    mkdirSync(join(w, ".claude/skills/demo"), { recursive: true });
    expect(sync.lauf({ wurzel: w }).geschrieben).toEqual([".claude/skills/demo/SKILL.md"]);
    expect(readFileSync(zeigerPfad(w), "utf8")).toBe(sync.zeigerText("demo", QUELLE));
  });

  test("leerer Zeiger-Ordner ohne Quelle wird mit --prune nie gelöscht, nur gemeldet", () => {
    const w = neu();
    mkdirSync(join(w, ".claude/skills/leer"), { recursive: true });
    const e = sync.lauf({ wurzel: w, prune: true });
    expect(e.geloescht).toEqual([]);
    expect(e.gemeldet).toEqual([".claude/skills/leer"]);
    expect(existsSync(join(w, ".claude/skills/leer"))).toBe(true);
  });

  test("ein Zeiger mit CRLF und Marke gilt als Zeiger und wird auf LF umgeschrieben", () => {
    const w = neu();
    schreibe(w, ".agents/skills/demo/SKILL.md", QUELLE);
    schreibe(w, ".claude/skills/demo/SKILL.md", sync.zeigerText("demo", QUELLE).replace(/\n/g, "\r\n"));
    const e = sync.lauf({ wurzel: w });
    expect(e.gemeldet).toEqual([]);
    expect(e.geschrieben).toEqual([".claude/skills/demo/SKILL.md"]);
    expect(readFileSync(zeigerPfad(w), "utf8")).toBe(sync.zeigerText("demo", QUELLE));
  });

  test("unbekanntes Tool wirft", () => {
    expect(() => sync.lauf({ wurzel: neu(), tool: "cursor" })).toThrow(/cursor/);
    expect(() => sync.lauf({ wurzel: neu(), tool: "toString" })).toThrow("unbekanntes Tool: toString");
  });
});

describe("Kommandozeile", () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, ["scripts/skills-sync.mjs", ...args], { cwd: WURZEL, encoding: "utf8" });

  test("unbekanntes Tool, unbekanntes Flag und --tool ohne Wert enden mit Exit 2", () => {
    expect(cli("--tool", "cursor").status).toBe(2);
    expect(cli("--unbekannt").status).toBe(2);
    expect(cli("--tool").status).toBe(2);
  });

  test("die Fehlermeldung nennt das Tool bzw. das Flag, dazu die Aufruf-Zeile", () => {
    // Die erste Zeile ist der Fehlertext (die Aufruf-Zeile nennt `--tool` selbst und beweist darum nichts).
    for (const [args, text] of [
      [["--tool", "cursor"], "Unbekanntes Tool: cursor"],
      [["--tool=cursor"], "Unbekanntes Tool: cursor"],
      [["--tool", "toString"], "Unbekanntes Tool: toString"],
      [["--bogus"], "Unbekanntes Argument: --bogus"],
      [["--tool"], "--tool braucht einen Wert"],
    ] as const) {
      const r = cli(...args);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stderr.split("\n")[0], args.join(" ")).toBe(text);
      expect(r.stderr).toContain("Aufruf: node scripts/skills-sync.mjs");
    }
  });

  describe("Exit 1 in einem kopierten Skript-Baum (die Wurzel ergibt sich aus dem Skriptpfad)", () => {
    const temp: string[] = [];
    afterEach(() => {
      for (const o of temp.splice(0)) rmSync(o, { recursive: true, force: true });
    });
    const baum = (quelle: string): string => {
      const w = mkdtempSync(join(tmpdir(), "skills-sync-cli-"));
      temp.push(w);
      mkdirSync(join(w, "scripts"), { recursive: true });
      mkdirSync(join(w, "scripts/docs-gen"), { recursive: true });
      for (const f of ["skills-sync.mjs", "flag-lib.mjs", "docs-gen/markdown.mjs"]) writeFileSync(join(w, "scripts", f), readFileSync(join(WURZEL, "scripts", f)));
      mkdirSync(join(w, ".agents/skills/demo"), { recursive: true });
      writeFileSync(join(w, ".agents/skills/demo/SKILL.md"), quelle);
      return w;
    };
    const lauf = (w: string, ...args: string[]) => spawnSync(process.execPath, [join(w, "scripts/skills-sync.mjs"), ...args], { cwd: w, encoding: "utf8" });

    test("--check bei Drift: Exit 1, nennt die Datei und die Fix-Zeile, schreibt nichts", () => {
      const w = baum(QUELLE);
      const r = lauf(w, "--check");
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(".claude/skills/demo/SKILL.md");
      expect(r.stderr).toContain("npm run skills:sync");
      expect(existsSync(join(w, ".claude"))).toBe(false);
    });

    test("ohne Flag: Exit 0 und schreibt den Zeiger", () => {
      const w = baum(QUELLE);
      expect(lauf(w).status).toBe(0);
      expect(existsSync(join(w, ".claude/skills/demo/SKILL.md"))).toBe(true);
    });

    test("nach dem Lauf ohne Flag endet --check mit Exit 0; eine lose Datei macht es wieder rot", () => {
      const w = baum(QUELLE);
      expect(lauf(w).status).toBe(0);
      expect(lauf(w, "--check").status).toBe(0);
      writeFileSync(join(w, ".claude/skills/notizen.md"), "lose");
      const r = lauf(w, "--check");
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(".claude/skills/notizen.md");
    });

    test("unbrauchbare Quelle: Exit 1 auch ohne Flag", () => {
      const w = baum("---\nname: demo\n---\n");
      const r = lauf(w);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(".agents/skills/demo/SKILL.md");
    });
  });

  test("--check auf dem echten Repo endet mit Exit 0 und `--tool claude` ist erlaubt", () => {
    expect(cli("--check").status).toBe(0);
    expect(cli("--tool", "claude", "--check").status).toBe(0);
  });
});

// Scan-Wächter (#1849): Verweise auf die Zeiger-Datei einer Skill-Quelle (Verweis mit Anker landet im Zeiger, der keine
// Überschriften trägt; ein Test, der den Zeiger liest, prüft nichts) sind rot. Gilt für jede Quelle unter `.agents/skills/`.
// Grenzen: geprüft werden die Pfadformen `.claude/skills/<name>/SKILL.md` und `](../<name>/SKILL.md` (nur in Dateien unter
// `.claude/skills/`; unter `.agents/skills/` führt `../<name>/` zur Quelle) in versionierten Textdateien; Ordnerform ohne SKILL.md, der Skill-Name ohne Pfad und
// Skills ohne Quelle (ein Volltext ist ohnehin rot) zählen nicht.
describe("Verweise zeigen auf die Skill-Quelle, nicht auf den Zeiger (#1849)", () => {
  /** Geschlossene Ausnahmen (Pfadpräfix → Grund). */
  const AUSNAHMEN: Record<string, string> = {
    "docs/adr/": "ADRs sind historisch, nie umgeschrieben",
    "README.md": "vom docs-gen erzeugte Generatorstelle",
    ".factory/besitz.json": "führt den Zeiger als eigene Einheit",
    "test/harness/skills-sync.test.ts": "Fixtures dieses Wächters",
    "test/harness/haupt-sync.test.ts": "Fixture eines Pfades in der Änderungsliste",
  };
  const namen = sync.liesStand(WURZEL).quellen.map((q) => q.ordner);
  const gescannt = (f: string): boolean => /\.(md|ts|mjs|js|json|yml)$/.test(f) && !Object.keys(AUSNAHMEN).some((p) => f.startsWith(p));
  const dateien = repoDateien().filter(gescannt);
  /** Verweist `text` der Datei `pfad` auf den Zeiger von `name`? Die relative Form führt nur unter `.claude/skills/` zum Zeiger (unter `.agents/skills/` auf die Quelle). */
  const verweistAufZeiger = (name: string, pfad: string, text: string): boolean => {
    const voll = new RegExp(String.raw`\.claude/skills/${maskiere(name)}/SKILL\.md`);
    const relativ = new RegExp(String.raw`\]\(\.\./${maskiere(name)}/SKILL\.md`);
    return voll.test(text) || (pfad.startsWith(".claude/skills/") && relativ.test(text));
  };
  const funde = (): string[] =>
    namen.flatMap((name) => dateien.filter((f) => verweistAufZeiger(name, f, lies(f))).map((f) => `${f} -> ${name}`));

  test("Prädikat: volle Form überall ein Fund, relative Form nur unter .claude/skills", () => {
    expect(verweistAufZeiger("forum", "docs/x.md", "siehe .claude/skills/forum/SKILL.md#a")).toBe(true);
    expect(verweistAufZeiger("forum", ".claude/skills/x/ablauf.md", "[f](../forum/SKILL.md#a)")).toBe(true);
    expect(verweistAufZeiger("forum", "docs/x.md", "[f](../forum/SKILL.md#a)")).toBe(false);
    expect(verweistAufZeiger("forum", ".agents/skills/x/SKILL.md", "[f](../forum/SKILL.md#a)")).toBe(false);
  });

  test("Prädikat: Ordnerform, anderer Skill und Quellpfad sind kein Fund", () => {
    expect(verweistAufZeiger("forum", "docs/x.md", "`.claude/skills/forum/` ist der Zeiger")).toBe(false);
    expect(verweistAufZeiger("forum", "docs/x.md", ".claude/skills/forum-leser/SKILL.md")).toBe(false);
    expect(verweistAufZeiger("forum", "docs/x.md", ".agents/skills/forum/SKILL.md")).toBe(false);
  });

  test("Ausnahmen: ADR bleibt ungescannt, ein Nachbar ohne Ausnahme und ein Skill ohne Quelle nicht", () => {
    expect(gescannt("docs/adr/0022-x.md")).toBe(false);
    expect(gescannt("docs/x.md")).toBe(true);
    expect(gescannt("docs/bild.png")).toBe(false);
    expect(namen).not.toContain("kein-skill");
  });

  test("der Scan ist nicht leer und kennt forum und review-lenses als Quellen", () => {
    expect(namen).toEqual(expect.arrayContaining(["forum", "review-lenses"]));
    expect(dateien.length).toBeGreaterThan(100);
  });

  test("keine versionierte Datei verweist auf den Zeiger einer Quelle", () => {
    expect(funde()).toEqual([]);
  });
});
