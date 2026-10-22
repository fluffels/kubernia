/* Projektwert-Stellen (#1746, ADR 0022 F3f): Erkennung, Rendern, normalisierter Hash der Besitz-Lib und das CLI `projektwerte.mjs`.
 * Dateien entstehen nur in Temp-Ordnern. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawCli from "../scripts/projektwerte.mjs";

type Cfg = Record<string, unknown>;
interface Lib {
  PROJEKTWERT_START: string;
  PROJEKTWERT_ENDE: string;
  projektwertStellen(t: string, pfad?: string): { bloecke: { start: number; ende: number }[]; zeilen: { folge: number; schluessel: string }[] };
  leereProjektwerte(t: string): string;
  rendereProjektwerte(t: string, c: Cfg | (() => Cfg), pfad?: string): string;
  projektwertWert(c: Cfg, k: string): string;
  projektwertAbweichungen(pfad: string, t: string, c: Cfg): string[];
  projektwertDateien(manifest: string[], liste: string[]): string[];
  projektwertLauf(w: string, c: () => Cfg, o?: { schreiben?: boolean }): { dateien: number; fehler: string[]; geaendert: string[]; abweichungen: string[] };
  einheitHash(e: { pfad: string; schluessel?: string }, t: string): string | null;
  normalisierterEinheitText(e: { pfad: string; schluessel?: string }, t: string): string | null;
}
interface Cli {
  cli(argv: string[], opt?: { wurzel?: string; out?: (s: string) => void; err?: (s: string) => void }): number;
}
const lib = rawLib as unknown as Lib;
const cli = rawCli as unknown as Cli;
const { PROJEKTWERT_START: S, PROJEKTWERT_ENDE: E } = lib;

const CONFIG: Cfg = {
  praefixe: { commitZeile: "ZD-", branch: "feature/zd-" },
  agenten: { planer: "wk-planer", ticketSkill: "wk" },
  labels: { harness: "area:werk" },
};
const FM = "---\n# factory:projektwert agenten.planer\nname: kubernia-planer\nmodel: opus\n---\n# Text\n";

describe("projektwertStellen", () => {
  test("findet Block und Frontmatter-Zeile mit Zeilenindex", () => {
    const st = lib.projektwertStellen(`${FM}\n${S}\n${E}\n`);
    assert.deepEqual(st.zeilen.map((z) => [z.folge, z.schluessel]), [[2, "agenten.planer"]]);
    assert.deepEqual(st.bloecke, [{ start: 7, ende: 8 }]);
  });
  test("ein Marker inline in Backticks zählt nicht", () => {
    const st = lib.projektwertStellen(`Beispiel: \`${S}\` und \`${E}\`\n`);
    assert.deepEqual(st, { bloecke: [], zeilen: [] });
  });
  test("Start ohne Ende, Ende ohne Start und verschachtelter Start brechen mit Ort ab", () => {
    assert.throws(() => lib.projektwertStellen(`a\n${S}\nb\n`, "x.md"), /x\.md:2: .*kein Ende/);
    assert.throws(() => lib.projektwertStellen(`a\n${E}\n`, "x.md"), /x\.md:2: .*ohne Start/);
    assert.throws(() => lib.projektwertStellen(`${S}\n${S}\n${E}\n`, "x.md"), /x\.md:2: .*noch offen/);
  });
  test("Zeilen-Marker außerhalb des Frontmatters oder ohne `schlüssel:`-Folgezeile bricht ab", () => {
    assert.throws(() => lib.projektwertStellen("# factory:projektwert agenten.planer\nname: x\n", "x.md"), /außerhalb des führenden Frontmatters/);
    assert.throws(() => lib.projektwertStellen("---\nname: x\n---\n# factory:projektwert agenten.planer\nname: y\n", "x.md"), /außerhalb/);
    assert.throws(() => lib.projektwertStellen("---\n# factory:projektwert agenten.planer\n- liste\n---\n", "x.md"), /x\.md:2: .*Zeile `schlüssel:`/);
    assert.throws(() => lib.projektwertStellen("---\nname: x\n# factory:projektwert agenten.planer\n---\n", "x.md"), /x\.md:3/);
  });
});

describe("leereProjektwerte / rendereProjektwerte", () => {
  test("leeren entfernt Wert und Block-Rumpf, rendern setzt sie aus der Config ein", () => {
    const gerendert = lib.rendereProjektwerte(`${FM}\n${S}\n${E}\nEnde\n`, CONFIG);
    assert.match(gerendert, /\nname: wk-planer\n/);
    assert.match(gerendert, /\| `agenten\.planer` \| `wk-planer` \|/);
    assert.match(gerendert, /\| `praefixe\.branch` \| `feature\/zd-` \|/);
    assert.match(gerendert, /\| `labels\.harness` \| `area:werk` \|/);
    assert.equal(lib.leereProjektwerte(gerendert), `---\n# factory:projektwert agenten.planer\nname:\nmodel: opus\n---\n# Text\n\n${S}\n${E}\nEnde\n`);
  });
  test("rendern ist idempotent und lässt Text ohne Stellen gleich", () => {
    const einmal = lib.rendereProjektwerte(`${FM}${S}\n${E}\n`, CONFIG);
    assert.equal(lib.rendereProjektwerte(einmal, CONFIG), einmal);
    assert.equal(lib.rendereProjektwerte("nichts\n", () => { throw new Error("nicht rufen"); }), "nichts\n");
  });
  test("YAML-Wert mit Sonderzeichen wird zitiert, einfacher bleibt blank; Einrückung bleibt", () => {
    const t = "---\n  # factory:projektwert agenten.planer\n  name: x\n---\n";
    assert.equal(lib.rendereProjektwerte(t.replace("  # ", "# "), { agenten: { planer: "a b" } }).split("\n")[2], '  name: "a b"');
    assert.equal(lib.rendereProjektwerte(t.replace("  # ", "# "), CONFIG).split("\n")[2], "  name: wk-planer");
  });
  test("fehlender Schlüssel, fehlende Gruppe und Backtick oder | im Wert brechen ab", () => {
    assert.throws(() => lib.rendereProjektwerte("---\n# factory:projektwert agenten.fehlt\nname: x\n---\n", CONFIG, "a.md"), /a\.md:3: .*agenten\.fehlt.*Fix:/s);
    assert.throws(() => lib.rendereProjektwerte(`${S}\n${E}\n`, { praefixe: {}, agenten: {} }, "a.md"), /Gruppe 'labels'/);
    assert.throws(() => lib.projektwertWert({ agenten: { planer: "a`b" } }, "agenten.planer"), /Backtick/);
    assert.throws(() => lib.projektwertWert({ agenten: { planer: "a|b" } }, "agenten.planer"), /'\|'/);
    assert.throws(() => lib.projektwertWert({ agenten: { planer: 5 } }, "agenten.planer"), /kein nichtleerer Text/);
  });
  test("die Config wird erst bei einer Stelle gerufen", () => {
    let n = 0;
    lib.rendereProjektwerte(`${FM}`, () => ((n++), CONFIG));
    assert.equal(n, 1);
  });
});

describe("projektwertAbweichungen", () => {
  test("grün nach dem Rendern; veränderter Wert und veränderter Block sind rot mit Zeile", () => {
    const ok = lib.rendereProjektwerte(`${FM}${S}\n${E}\n`, CONFIG);
    assert.deepEqual(lib.projektwertAbweichungen("a.md", ok, CONFIG), []);
    const name = lib.projektwertAbweichungen("a.md", ok.replace("name: wk-planer", "name: anders"), CONFIG);
    assert.match(name.join(), /a\.md:3: Projektwert 'agenten\.planer' weicht/);
    const block = lib.projektwertAbweichungen("a.md", ok.replace("`wk-planer` |", "`anders` |"), CONFIG);
    assert.match(block.join(), /Projektwert-Block weicht/);
  });
  test("ein Block ohne Rumpf ist ebenfalls eine Abweichung", () => {
    assert.match(lib.projektwertAbweichungen("a.md", `${S}\n${E}\n`, CONFIG).join(), /Block weicht/);
  });
});

describe("normalisierter Hash", () => {
  const e = { pfad: "a.md" };
  test("gleich bei anderem Projektwert und Block-Inhalt, anders bei Änderung außerhalb, CRLF-neutral", () => {
    const a = lib.rendereProjektwerte(`${FM}${S}\n${E}\n`, CONFIG);
    const b = lib.rendereProjektwerte(`${FM}${S}\n${E}\n`, { ...CONFIG, agenten: { planer: "andere", ticketSkill: "x" } });
    assert.notEqual(a, b);
    assert.equal(lib.einheitHash(e, a), lib.einheitHash(e, b));
    assert.equal(lib.einheitHash(e, a), lib.einheitHash(e, a.replace(/\n/g, "\r\n")));
    assert.notEqual(lib.einheitHash(e, a), lib.einheitHash(e, a.replace("# Text", "# Anderer Text")));
  });
  test("kaputter Marker ergibt null, JSON-Schlüssel-Einheiten werden nie gerendert", () => {
    assert.equal(lib.einheitHash(e, `${S}\nohne Ende\n`), null);
    assert.equal(lib.normalisierterEinheitText({ pfad: "j.json", schluessel: "k" }, `{"k":"${S}"}`), JSON.stringify(S));
  });
});

describe("projektwertDateien", () => {
  test("geschlossene Liste: Manifest-Markdown plus Agenten und Skills, sortiert, ohne Doppelte und Unsicheres", () => {
    const r = lib.projektwertDateien(
      ["docs/x.md", "scripts/a.mjs", "../out.md", ".claude/agents/a.md"],
      [".claude/agents/a.md", ".claude/agents/b.md", ".claude/agents/c.txt", ".claude/skills/s/SKILL.md", ".claude/skills/s/t/u.md", ".agents/skills/s/SKILL.md", ".agents/skills/s/t/u.md", ".agents/x.md", "README.md"],
    );
    assert.deepEqual(r, [".agents/skills/s/SKILL.md", ".claude/agents/a.md", ".claude/agents/b.md", ".claude/skills/s/SKILL.md", "docs/x.md"]);
  });
});

// ── CLI ───────────────────────────────────────────────────────────────────────

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});
const WURZEL = fileURLToPath(new URL("../", import.meta.url));
const schreibe = (w: string, rel: string, text: string): void => {
  const voll = join(w, ...rel.split("/"));
  mkdirSync(dirname(voll), { recursive: true });
  writeFileSync(voll, text);
};
const lies = (w: string, rel: string): string => readFileSync(join(w, ...rel.split("/")), "utf8");
function projekt(): string {
  const w = mkdtempSync(join(tmpdir(), "kq-pw-"));
  temps.push(w);
  const echt = JSON.parse(readFileSync(join(WURZEL, ".factory/projekt.json"), "utf8")) as { agenten: Record<string, string> };
  echt.agenten.planer = "wk-planer";
  schreibe(w, ".factory/projekt.json", JSON.stringify(echt, null, 2));
  schreibe(w, ".claude/agents/planer.md", FM);
  schreibe(w, ".claude/skills/s/SKILL.md", `---\n# factory:projektwert agenten.ticketSkill\nname: x\n---\n${S}\n${E}\n`);
  return w;
}
const lauf = (argv: string[], w: string): { code: number; out: string; err: string } => {
  const out: string[] = [];
  const err: string[] = [];
  const code = cli.cli(argv, { wurzel: w, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

describe("projektwerte CLI", () => {
  test("--check ist rot und nennt --write, --write rendert, danach grün und idempotent", () => {
    const w = projekt();
    const rot = lauf(["--check"], w);
    assert.equal(rot.code, 1);
    assert.match(rot.err, /agenten\.planer/);
    assert.match(rot.err, /projektwerte\.mjs --write/);
    assert.equal(lauf(["--check"], w).code, 1);
    const schreib = lauf(["--write"], w);
    assert.equal(schreib.code, 0, schreib.err);
    assert.match(lies(w, ".claude/agents/planer.md"), /\nname: wk-planer\n/);
    assert.equal(lauf(["--check"], w).code, 0);
    const zweit = lauf(["--write"], w);
    assert.equal(zweit.code, 0);
    assert.doesNotMatch(zweit.out, /geändert: /);
  });
  test("--write behält CRLF", () => {
    const w = projekt();
    schreibe(w, ".claude/agents/planer.md", FM.replace(/\n/g, "\r\n"));
    assert.equal(lauf(["--write"], w).code, 0);
    const t = lies(w, ".claude/agents/planer.md");
    assert.ok(t.includes("name: wk-planer\r\n") && !/[^\r]\n/.test(t), JSON.stringify(t));
  });
  test("ein Fehler in einer Datei: nichts wird geschrieben, auch nicht in die gesunde", () => {
    const w = projekt();
    schreibe(w, ".claude/skills/s/SKILL.md", `${S}\nohne Ende\n`);
    const vorher = lies(w, ".claude/agents/planer.md");
    const r = lauf(["--write"], w);
    assert.equal(r.code, 1);
    assert.match(r.err, /SKILL\.md:1: .*kein Ende/);
    assert.match(r.err, /nichts geschrieben/);
    assert.equal(lies(w, ".claude/agents/planer.md"), vorher);
  });
  test("ein verfälschter Projektwert-Block in einer Skill-Quelle unter .agents/skills ist rot (#1849)", () => {
    const w = projekt();
    assert.equal(lauf(["--write"], w).code, 0);
    schreibe(w, ".agents/skills/a/SKILL.md", `---\nname: a\n---\n${S}\nverfälscht\n${E}\n`);
    const r = lauf(["--check"], w);
    assert.equal(r.code, 1);
    assert.match(r.err, /\.agents\/skills\/a\/SKILL\.md:\d+: Projektwert-Block weicht/);
  });
  test("--check schlägt bei einem Marker ohne Ende keinen --write-Fix vor", () => {
    const w = projekt();
    assert.equal(lauf(["--write"], w).code, 0);
    schreibe(w, ".claude/skills/s/SKILL.md", `${S}\nohne Ende\n`);
    const r = lauf(["--check"], w);
    assert.equal(r.code, 1);
    assert.match(r.err, /kein Ende/);
    assert.doesNotMatch(r.err, /--write/);
  });
  test("der Hinweis hängt am Feld abweichungen, nicht am Text: ein Pfad mit 'weicht von' löst ihn nicht aus (#1821)", () => {
    const w = projekt();
    assert.equal(lauf(["--write"], w).code, 0);
    schreibe(w, ".claude/agents/weicht von.md", `${S}\nohne Ende\n`);
    const r = lauf(["--check"], w);
    assert.equal(r.code, 1);
    assert.match(r.err, /kein Ende/);
    assert.doesNotMatch(r.err, /projektwerte\.mjs --write/);
    assert.deepEqual(lib.projektwertLauf(w, () => JSON.parse(lies(w, ".factory/projekt.json")) as Cfg).abweichungen, []);
  });
  test("projektwertLauf führt Abweichungen im Feld abweichungen, Marker-Fehler nicht", () => {
    const w = projekt();
    const cfg = (): Cfg => JSON.parse(lies(w, ".factory/projekt.json")) as Cfg;
    const roh = lib.projektwertLauf(w, cfg);
    assert.ok(roh.abweichungen.length > 0);
    assert.ok(roh.abweichungen.every((a) => roh.fehler.includes(a)));
  });
  test("fehlender Schlüssel in der Config bricht ab (ohne Config-Datei ebenso)", () => {
    const w = projekt();
    schreibe(w, ".claude/agents/planer.md", FM.replace("agenten.planer", "agenten.fehlt"));
    const r = lauf(["--check"], w);
    assert.equal(r.code, 1);
    assert.match(r.err, /agenten\.fehlt/);
    rmSync(join(w, ".factory/projekt.json"));
    const ohne = lauf(["--check"], w);
    assert.equal(ohne.code, 1);
    assert.match(ohne.err, /Projekt-Config/);
  });
  test("ohne Stellen wird keine Config gebraucht", () => {
    const w = mkdtempSync(join(tmpdir(), "kq-pw-"));
    temps.push(w);
    schreibe(w, ".claude/agents/a.md", "---\nname: x\n---\n");
    assert.equal(lauf(["--check"], w).code, 0);
  });
  test("Aufruf ohne Modus, mit beiden Modi oder unbekannter Option: Exit 2", () => {
    const w = projekt();
    assert.equal(lauf([], w).code, 2);
    assert.equal(lauf(["--check", "--write"], w).code, 2);
    assert.equal(lauf(["--wat"], w).code, 2);
  });
  test("ein kaputtes Manifest und eine Datei direkt unter .claude/skills/ stürzen das Gate nicht ab", () => {
    const w = projekt();
    schreibe(w, ".factory/besitz.json", "{kaputt");
    schreibe(w, ".claude/skills/README.md", "# nur Text\n");
    assert.equal(lauf(["--write"], w).code, 0);
    assert.equal(lauf(["--check"], w).code, 0);
    schreibe(w, ".factory/besitz.json", "{}");
    assert.equal(lauf(["--check"], w).code, 0);
    schreibe(w, ".claude/agents/planer.md", FM.replace("wk-planer", "anders"));
    assert.equal(lauf(["--check"], w).code, 1);
  });
  test("eine fehlende Config wird bei mehreren Dateien mit Stellen genau einmal gemeldet", () => {
    const w = projekt();
    rmSync(join(w, ".factory/projekt.json"));
    const r = lauf(["--check"], w);
    assert.equal(r.code, 1);
    assert.equal(r.err.split("\n").filter((z) => z.includes("Projekt-Config")).length, 1, r.err);
    assert.match(r.err, /: 1 Befund\(e\)/);
    assert.doesNotMatch(r.err, /fehlt oder ist kein/);
  });
  test("--wurzel als Flag wählt das Projekt", () => {
    const w = projekt();
    assert.equal(cli.cli(["--write", "--wurzel", w], { wurzel: join(w, "gibt-es-nicht"), out: () => undefined, err: () => undefined }), 0);
    assert.match(lies(w, ".claude/agents/planer.md"), /\nname: wk-planer\n/);
  });
});

describe("Grenzfälle der Lib", () => {
  test("leerer Wert und Zeilenumbruch im Wert brechen ab", () => {
    assert.throws(() => lib.projektwertWert({ agenten: { planer: "" } }, "agenten.planer"), /kein nichtleerer Text/);
    assert.throws(() => lib.projektwertWert({ agenten: { planer: "a\nb" } }, "agenten.planer"), /Zeilenumbruch/);
    assert.throws(() => lib.projektwertWert({ agenten: { planer: "a\rb" } }, "agenten.planer"), /Zeilenumbruch/);
  });
  test("mehrere Blöcke in einer Datei werden je einzeln geleert, gerendert und geprüft", () => {
    const roh = `A\n${S}\nalt1\nalt2\n${E}\nB\n${S}\nalt3\n${E}\nC\n`;
    assert.equal(lib.leereProjektwerte(roh), `A\n${S}\n${E}\nB\n${S}\n${E}\nC\n`);
    const ok = lib.rendereProjektwerte(roh, CONFIG);
    assert.ok(ok.startsWith("A\n") && ok.endsWith(`${E}\nC\n`) && ok.includes(`${E}\nB\n${S}`), ok);
    assert.equal(ok.split(S).length, 3);
    assert.deepEqual(lib.projektwertAbweichungen("a.md", ok, CONFIG), []);
    assert.equal(lib.projektwertAbweichungen("a.md", roh, CONFIG).length, 2);
  });
  test("Text mit der Kennung in Backticks, aber ohne Stelle, braucht keine Config", () => {
    const t = "Beispiel `# factory:projektwert agenten.planer` hier\n";
    const nie = (): Cfg => { throw new Error("nicht rufen"); };
    assert.equal(lib.rendereProjektwerte(t, nie), t);
    assert.deepEqual(lib.projektwertAbweichungen("a.md", t, nie as unknown as Cfg), []);
    assert.equal(lib.leereProjektwerte(t), t);
  });
  test("ein kaputter Zeilen-Marker bricht mit Ort ab (ohne Schlüssel, Zusatz, eingerückt)", () => {
    for (const marker of ["# factory:projektwert", "# factory:projektwert agenten.planer # x", "  # factory:projektwert agenten.planer"]) {
      assert.throws(() => lib.projektwertStellen(`---\n${marker}\nname: x\n---\n`, "x.md"), /x\.md:2: kaputter Projektwert-Zeilen-Marker/, marker);
    }
  });
  test("YAML-Schlüsselwörter und Zahlen als Wert werden zitiert", () => {
    const t = "---\n# factory:projektwert agenten.planer\nname: x\n---\n";
    for (const wert of ["nobody", "agent2", "yes-agent"]) {
      assert.equal(lib.rendereProjektwerte(t, { agenten: { planer: wert } }).split("\n")[2], `name: ${wert}`, wert);
    }
    for (const wert of ["true", "null", "123", "No"]) {
      assert.equal(lib.rendereProjektwerte(t, { agenten: { planer: wert } }).split("\n")[2], `name: "${wert}"`, wert);
    }
  });
  test("fehlende oder leere Gruppe nennt den Ort des Blocks; Gruppe null bricht mit Meldung ab", () => {
    assert.throws(() => lib.rendereProjektwerte(`a\n${S}\n${E}\n`, { praefixe: {}, agenten: {} }, "a.md"), /a\.md:2: .*Gruppe 'labels'/s);
    assert.throws(() => lib.rendereProjektwerte(`${S}\n${E}\n`, { praefixe: {}, agenten: null, labels: {} }, "a.md"), /Gruppe 'agenten'/);
  });
});
