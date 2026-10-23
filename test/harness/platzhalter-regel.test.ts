/* Platzhalter-Wächter der Kern-Texte (#1747, ADR 0022 F3g): ein Platzhalter `<gruppe.schlüssel>` in einem Agenten- oder Skill-Text
 * braucht genau einen Projektwert-Block in derselben Datei, und sein Schlüssel löst in der Config auf; der Block selbst prüft das
 * Drift-Gate gegen die Config (K2 fährt es auf den echten Texten und auf verfälschten Kopien).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel (kein eigenes check-Skript), darum im geschützten test/harness/ (#1165).
 * Die Regel selbst ist `platzhalterBefunde` in scripts/besitz-lib.mjs; dieser Test ruft sie auf den echten Texten und auf Fixtures auf.
 *
 * Grenze: die Regel prüft nur die Prüf-Fläche von `projektwertDateien` (Manifest-Markdown, Agenten- und Skill-Markdown) und nur die
 * Schlüssel-Form mit den Gruppen `agenten`, `labels`, `praefixe`, `skills`; `<agenten.…>` mit Auslassungszeichen beschreibt nur und zählt nicht. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDrift from "../../scripts/check-factory-drift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";

type Cfg = Record<string, unknown>;
interface Lib {
  PROJEKTWERT_START: string;
  PROJEKTWERT_ENDE: string;
  projektwertStellen(t: string, pfad?: string): { bloecke: { start: number; ende: number }[] };
  projektwertWert(c: Cfg, k: string): string;
  projektwertDateien(manifest: string[], liste: string[]): string[];
  projektDateien(wurzel: string): string[];
  PROJEKTWERT_GRUPPEN: string[];
  platzhalterMuster(): RegExp;
  platzhalterBefunde(pfad: string, text: string, config: Cfg): string[];
}
interface DriftCli {
  cli(argv: string[], opt?: { wurzel?: string; out?: (s: string) => void; err?: (s: string) => void }): number;
}
const lib = rawLib as unknown as Lib;
const rolle = (rawPc as unknown as { ROLLEN_PFADE: Record<string, string> }).ROLLEN_PFADE;
const drift = rawDrift as unknown as DriftCli;
const { PROJEKTWERT_START: S, PROJEKTWERT_ENDE: E } = lib;

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG: Cfg = {
  praefixe: { commitZeile: "ZD-", branch: "feature/zd-" },
  agenten: { planer: "wk-planer", ticketSkill: "wk" },
  labels: { harness: "area:werk" },
};

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempWurzel = (): string => {
  const w = mkdtempSync(join(tmpdir(), "platzhalter-"));
  temps.push(w);
  return w;
};
const schreibe = (w: string, rel: string, text: string): void => {
  const voll = join(w, ...rel.split("/"));
  mkdirSync(dirname(voll), { recursive: true });
  writeFileSync(voll, text);
};
const echt = (rel: string): string => readFileSync(join(WURZEL, ...rel.split("/")), "utf8");

const driftLauf = (w: string): { code: number; err: string } => {
  const err: string[] = [];
  const code = drift.cli([], { wurzel: w, out: () => undefined, err: (s) => err.push(s) });
  return { code, err: err.join("\n") };
};

const platzhalterBefunde = (pfad: string, text: string, config: Cfg): string[] => lib.platzhalterBefunde(pfad, text, config);

const BLOCK_DATEIEN = [
  rolle.planer,
  rolle.umsetzer,
  rolle.lens,
  ".agents/skills/review-lenses/SKILL.md",
  ".agents/skills/factory/ablauf.md",
];

describe("Projektwert-Block der Kern-Texte (#1747)", () => {
  const echteConfig = JSON.parse(echt(".factory/projekt.json")) as Cfg;

  test("echtes Repo: Drift-Gate grün, jede Block-Datei trägt genau einen Block", () => {
    const r = driftLauf(WURZEL);
    assert.equal(r.code, 0, r.err);
    for (const p of BLOCK_DATEIEN) assert.equal(lib.projektwertStellen(echt(p), p).bloecke.length, 1, p);
  });

  test("ein abweichender Block des Umsetzer-Texts macht das Drift-Gate rot (Negativfall)", () => {
    const w = tempWurzel();
    const umsetzer = echt(".claude/agents/factory-umsetzer.md");
    schreibe(w, ".factory/projekt.json", echt(".factory/projekt.json"));
    schreibe(w, ".claude/settings.json", echt(".claude/settings.json")); // die Berechtigungs-Ergänzung der Config braucht ihren Platz (#1874)
    schreibe(w, ".claude/agents/factory-umsetzer.md", umsetzer);
    assert.equal(driftLauf(w).code, 0);
    const verfaelscht = umsetzer.replace(/^(\| `agenten\.umsetzer` \| `)[^`]+(` \|)$/m, "$1fremd-umsetzer$2");
    assert.notEqual(verfaelscht, umsetzer, "Anker `agenten.umsetzer` muss genau eine Tabellenzeile treffen");
    schreibe(w, ".claude/agents/factory-umsetzer.md", verfaelscht);
    const rot = driftLauf(w);
    assert.equal(rot.code, 1);
    assert.match(rot.err, /Projektwert-Block weicht von/);
  });

  test("eine abweichende Config macht den echten Text rot", () => {
    const w = tempWurzel();
    const cfg = JSON.parse(JSON.stringify(echteConfig)) as { agenten: Record<string, string> };
    cfg.agenten.planer = "wk-planer";
    schreibe(w, ".factory/projekt.json", JSON.stringify(cfg, null, 2));
    schreibe(w, ".claude/agents/factory-umsetzer.md", echt(".claude/agents/factory-umsetzer.md"));
    const rot = driftLauf(w);
    assert.equal(rot.code, 1);
    assert.match(rot.err, /Projektwert-Block weicht von/);
  });

  test("platzhalterMuster: trifft <agenten.lens>, nicht <foo.bar>; jeder Aufruf liefert eine frische Instanz ohne geteilten Zustand", () => {
    const m = lib.platzhalterMuster();
    assert.equal(m.flags, "g");
    assert.deepEqual([...("a <agenten.lens> b <foo.bar> <labels.x>").matchAll(m)].map((t) => t[0]), ["<agenten.lens>", "<labels.x>"]);
    const a = lib.platzhalterMuster();
    const b = lib.platzhalterMuster();
    assert.notEqual(a, b);
    a.test("<agenten.lens>");
    assert.ok(a.lastIndex > 0);
    assert.equal(b.lastIndex, 0);
  });
  test("Platzhalter-Regel: Fixtures", () => {
    const block = `${S}\n${E}\n`;
    assert.deepEqual(platzhalterBefunde("a.md", `Spawn <agenten.planer>\n${block}`, CONFIG), []);
    assert.deepEqual(platzhalterBefunde("a.md", "Spawn `<agenten.…>` und <gruppe.schluessel>\n", CONFIG), []);
    assert.deepEqual(platzhalterBefunde("a.md", "<boards.produkt> gehört nicht zu den Gruppen\n", CONFIG), []);
    assert.deepEqual(platzhalterBefunde("a.md", "kein Platzhalter\n", CONFIG), []);
    const ohneBlock = platzhalterBefunde("a.md", "Spawn <agenten.planer>\n", CONFIG);
    assert.equal(ohneBlock.length, 1);
    assert.match(ohneBlock[0] ?? "", /0 Projektwert-Blöcke/);
    const zwei = platzhalterBefunde("a.md", `<agenten.planer>\n${block}${block}`, CONFIG);
    assert.equal(zwei.length, 1);
    assert.match(zwei[0] ?? "", /2 Projektwert-Blöcke/);
    const unbekannt = platzhalterBefunde("a.md", `<agenten.planner>\n${block}`, CONFIG);
    assert.equal(unbekannt.length, 1);
    assert.match(unbekannt[0] ?? "", /<agenten\.planner> löst in der Config nicht auf/);
    const doppelt = platzhalterBefunde("a.md", `<agenten.planner> und <agenten.planner>\n${block}`, CONFIG);
    assert.equal(doppelt.length, 1, "derselbe unbekannte Schlüssel wird nur einmal gemeldet");
    const andereGruppe = platzhalterBefunde("a.md", `<labels.festgefahren>\n${block}`, CONFIG);
    assert.equal(andereGruppe.length, 1);
    assert.match(andereGruppe[0] ?? "", /<labels\.festgefahren> löst/);
    const gruppeFehlt = platzhalterBefunde("a.md", `<praefixe.worktree>\n${block}`, { agenten: {} });
    assert.equal(gruppeFehlt.length, 1);
    assert.match(gruppeFehlt[0] ?? "", /<praefixe\.worktree> löst/);
  });

  test("Platzhalter-Regel: das echte Repo hat keinen Befund", () => {
    const manifest = JSON.parse(echt(".factory/besitz.json")) as { eintraege: { pfad: string }[] };
    const dateien = lib
      .projektwertDateien(
        manifest.eintraege.map((e) => e.pfad),
        lib.projektDateien(WURZEL),
      )
      .filter((p) => existsSync(join(WURZEL, ...p.split("/"))));
    assert.ok(dateien.length > 5, "Prüf-Fläche darf nicht leer sein");
    assert.ok(dateien.includes(".agents/skills/review-lenses/SKILL.md"), "die Skill-Quelle liegt in der Prüf-Fläche (#1849)");
    assert.deepEqual(
      dateien.flatMap((p) => platzhalterBefunde(p, echt(p), echteConfig)),
      [],
    );
    const mitPlatzhalter = dateien.filter((p) => lib.platzhalterMuster().test(echt(p)));
    for (const p of BLOCK_DATEIEN) assert.ok(mitPlatzhalter.includes(p), `${p} trägt Platzhalter`);
  });
});
