/* Kern-Reinheits-Wächter (#1610, ADR 0022 F1): zählt Projektliterale je Einheit des Besitz-Manifests
 * `.factory/besitz.json` gegen die Baseline `kern-literale-baseline.json`. Die Baseline darf nur sinken.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Einheiten: ganze Datei (`pfad`), Markdown-Block zwischen Markern (`pfad#<block>`), JSON-Schlüssel
 * (`pfad#/<schluessel>`). Rot bei: neuem Literal, Baseline über Ist (neues Literal) oder unter Ist nicht
 * gesenkt, verwaistem Eintrag, ungültigem Manifest, und bei einer Baseline, die gegen die Diff-Basis angehoben wurde. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { IMPORT_FORM } from "./hook-importe";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";

interface BesitzLib {
  markerStart(id: string): string;
  markerEnde(id: string): string;
  einheitId(e: Eintrag): string;
  einheitText(e: Eintrag, text: string): string | null;
  pruefeManifest(m: Manifest, lies: (pfad: string) => string | null): string[];
}
const { markerStart, markerEnde, einheitId, einheitText, pruefeManifest } = rawBesitz as unknown as BesitzLib;

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const MANIFEST = ".factory/besitz.json";
const BASELINE = "test/harness/kern-literale-baseline.json";

export interface Eintrag {
  pfad: string;
  block?: string;
  schluessel?: string;
  ring: string;
  quelle: string;
}
interface Manifest {
  version: number;
  eintraege: Eintrag[];
}
type Zaehlung = Record<string, number>;
type Baseline = Record<string, Zaehlung>;

export interface ProjektConfig {
  repo: string;
  board: { besitzer: string };
  projektliterale?: Record<string, string>;
}

const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Die Projektliterale, die ein Kern nicht tragen soll, aus der Projekt-Config (#1611): Owner (Repo-Owner und Board-Besitzer),
 * Repo-Name, generisches Board-ID-Muster und die `projektliterale` der Config. */
export function begriffeAus(config: ProjektConfig): Record<string, RegExp> {
  const [owner = "", name = ""] = config.repo.split("/");
  const owners = [...new Set([owner, config.board.besitzer])];
  const out: Record<string, RegExp> = {
    Owner: new RegExp(owners.map(escapeRe).join("|"), "gi"),
    Repo: new RegExp(escapeRe(name), "gi"),
    "Board-ID": /\bPVT[A-Z]*_[A-Za-z0-9_-]+/g,
  };
  for (const [begriff, literal] of Object.entries(config.projektliterale ?? {})) out[begriff] = new RegExp(escapeRe(literal), "gi");
  return out;
}

/** Zählung je Begriff (nur > 0), CRLF-neutral. */
export function zaehle(text: string, begriffe: Record<string, RegExp>): Zaehlung {
  const t = text.replace(/\r\n/g, "\n");
  const out: Zaehlung = {};
  for (const [name, re] of Object.entries(begriffe)) {
    const n = (t.match(re) ?? []).length;
    if (n > 0) out[name] = n;
  }
  return out;
}

/** Meldungen (leer = grün): Ist gegen Baseline, nur sinkend. */
export function vergleiche(ist: Baseline, baseline: Baseline): string[] {
  const out: string[] = [];
  for (const [einheit, z] of Object.entries(ist)) {
    const b = baseline[einheit] ?? {};
    for (const [begriff, n] of Object.entries(z)) {
      const bn = b[begriff];
      if (bn === undefined) out.push(`${einheit}: neues Projektliteral '${begriff}' (${n}x), Kern-Einheiten bleiben literalfrei`);
      else if (n > bn) out.push(`${einheit}: '${begriff}' ${n}x über Baseline ${bn}`);
      else if (n < bn) out.push(`${einheit}: '${begriff}' nur noch ${n}x, Baseline auf ${n} senken (steht ${bn})`);
    }
    for (const begriff of Object.keys(b)) {
      if (!(begriff in z)) out.push(`${einheit}: '${begriff}' kommt nicht mehr vor, Baseline-Eintrag entfernen`);
    }
  }
  for (const einheit of Object.keys(baseline)) {
    if (!(einheit in ist)) out.push(`${einheit}: Baseline-Eintrag ohne Literale oder ohne Einheit, Eintrag entfernen`);
  }
  return out;
}

/** `git diff -M --name-status`-Ausgabe: Map neuer Pfad → alter Pfad (`null` = neu angelegt). */
export function parseNameStatus(out: string): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const zeile of out.split("\n")) {
    const f = zeile.split("\t");
    if (f.length < 2 || f[0] === undefined) continue;
    const s = f[0][0];
    if (s === "A") m.set(f[1] ?? "", null);
    else if (s === "R" || s === "C") m.set(f[2] ?? "", s === "R" ? (f[1] ?? null) : null);
    else if (s === "M" || s === "T") m.set(f[1] ?? "", f[1] ?? null);
  }
  return m;
}

/** Erlaubte Zählung je Einheit an der Diff-Basis (nur geänderte/umbenannte/neue Dateien). */
export function erlaubt(
  einheiten: Eintrag[],
  aenderungen: Map<string, string | null>,
  basisText: (altPfad: string) => string | null,
  begriffe: Record<string, RegExp>,
): Baseline {
  const out: Baseline = {};
  for (const e of einheiten) {
    if (!aenderungen.has(e.pfad)) continue;
    const alt = aenderungen.get(e.pfad) ?? null;
    const text = alt === null ? null : basisText(alt);
    const t = text === null ? null : einheitText(e, text);
    out[einheitId(e)] = t === null ? {} : zaehle(t, begriffe);
  }
  return out;
}

/** Meldungen: Baseline-Werte über dem erlaubten Basiswert. */
export function anhebungen(baseline: Baseline, erl: Baseline): string[] {
  const out: string[] = [];
  for (const [einheit, basis] of Object.entries(erl)) {
    for (const [begriff, n] of Object.entries(baseline[einheit] ?? {})) {
      const b = basis[begriff] ?? 0;
      if (n > b) out.push(`${einheit}: Baseline '${begriff}' ${n} über dem Wert an der Diff-Basis (${b}), anheben ist verboten`);
    }
  }
  return out;
}

/** Anheben-Prüfung gegen die Diff-Basis: `pruefen` (Basis da), `entfaellt` (lokal ohne Basis), `rot` (CI ohne Basis, fail-closed). */
export function diffBasisModus(basis: string | null, env: Record<string, string | undefined>): "pruefen" | "entfaellt" | "rot" {
  if (basis !== null) return "pruefen";
  return env.CI === "true" ? "rot" : "entfaellt";
}

/** Offene Ausnahmen der Schichtdaten-Regel (#1612): Einheit → Grund mit Ticket. Die Liste darf nur schrumpfen. */
export const SCHICHTDATEN_AUSNAHMEN: Record<string, string> = {
  "scripts/check-diffcoverage.mjs": "#1611: liest die Schichtdaten noch per statischem Import, Pfad wird Projekt-Config",
};

const CODE_ENDUNG = /\.(?:mjs|cjs|js|ts)$/;

/** Einheiten (Ganze-Datei-Einheiten beider Ringe), die die Schichtdaten statisch importieren. Nur direkte Importe
 *  (`IMPORT_FORM`), relativ zum Ordner der importierenden Datei aufgelöst; ein dynamisches `require(cfg.layers)` ist
 *  der erlaubte Weg (der Kern lädt die Schichtdaten über den konfigurierten Pfad). */
export function schichtdatenImporte(eintraege: Eintrag[], lies: (pfad: string) => string | null, schichtdatenPfad: string): string[] {
  const ziel = posix.normalize(schichtdatenPfad);
  const out: string[] = [];
  for (const e of eintraege) {
    if (e.block !== undefined || e.schluessel !== undefined || !CODE_ENDUNG.test(e.pfad)) continue;
    const text = lies(e.pfad);
    if (text === null) continue;
    for (const m of text.matchAll(IMPORT_FORM)) {
      if (posix.normalize(posix.join(posix.dirname(e.pfad), m[1] ?? "")) === ziel) {
        out.push(e.pfad);
        break;
      }
    }
  }
  return out;
}

/** Meldungen (leer = grün): Verstoß ohne Ausnahme, Ausnahme ohne Ticket, veraltete Ausnahme. */
export function pruefeSchichtdatenRegel(verstoesse: string[], ausnahmen: Record<string, string>): string[] {
  const out: string[] = [];
  for (const v of verstoesse) {
    if (!(v in ausnahmen)) out.push(`${v}: importiert die Schichtdaten statisch, ein Kern-Modul lädt sie über den konfigurierten Pfad (schichten.layers) und nutzt Ableitung/Prüfung aus scripts/schichten-kern.cjs`);
  }
  for (const [pfad, grund] of Object.entries(ausnahmen)) {
    if (!/#\d+/.test(grund)) out.push(`${pfad}: Ausnahme ohne Ticket (#<nr>) im Grund`);
    if (!verstoesse.includes(pfad)) out.push(`${pfad}: Ausnahme veraltet (kein statischer Import mehr), Eintrag entfernen`);
  }
  return out;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ein = (pfad: string, extra: Partial<Eintrag> = {}): Eintrag => ({ pfad, ring: "kern", quelle: "t", ...extra });

const FIXTURE: ProjektConfig = { repo: "acme/demo", board: { besitzer: "acme" }, projektliterale: { Zelda: "zelda" } };
const B = begriffeAus(FIXTURE);

describe("zaehle", () => {
  test("Owner, Repo (auch in Zusammensetzungen), Board-ID und Zelda zählen; Bezeichner PROJECT_ID allein nicht", () => {
    assert.deepEqual(zaehle("Demo DEMO demo-umsetzer", B), { Repo: 3 });
    assert.deepEqual(zaehle("x acme y", B), { Owner: 1 });
    assert.deepEqual(zaehle("PVT_kwHOabc PVTSSF_xyz_1", B), { "Board-ID": 2 });
    assert.deepEqual(zaehle("const PROJECT_ID = 1", B), {});
    assert.deepEqual(zaehle("docs/zelda-referenz.md", B), { Zelda: 1 });
    assert.deepEqual(zaehle("Größe über Äpfel", B), {});
  });
  test("CRLF und LF liefern dieselbe Zählung", () => {
    assert.deepEqual(zaehle("demo\r\ndemo\r\n", B), zaehle("demo\ndemo\n", B));
  });
});

describe("begriffeAus", () => {
  test("Regex-Zeichen im Repo-Namen sind wörtlich: my.repo zählt myxrepo nicht", () => {
    const b = begriffeAus({ repo: "zz/my.repo", board: { besitzer: "zz" } });
    assert.deepEqual(zaehle("my.repo myxrepo", b), { Repo: 1 });
  });
  test("Repo-Owner und abweichender Board-Besitzer zählen beide als Owner; gleicher Besitzer nicht doppelt", () => {
    const zwei = begriffeAus({ repo: "alice/demo", board: { besitzer: "bob" } });
    assert.deepEqual(zaehle("alice bob", zwei), { Owner: 2 });
    assert.deepEqual(zaehle("acme", B), { Owner: 1 });
  });
  test("ohne projektliterale entfällt der Zusatzbegriff", () => {
    assert.deepEqual(zaehle("zelda", begriffeAus({ repo: "acme/demo", board: { besitzer: "acme" } })), {});
  });
});

describe("einheitText", () => {
  test("Datei, Block, JSON-Schlüssel und nicht Auflösbares", () => {
    assert.equal(einheitText(ein("a"), "x"), "x");
    const blk = ein("a", { block: "b" });
    assert.equal(einheitText(blk, `v\n${markerStart("b")}\ndemo\n${markerEnde("b")}\nn`)?.includes("demo"), true);
    assert.equal(einheitText(blk, `${markerEnde("b")}\n${markerStart("b")}`), null);
    assert.equal(einheitText(blk, `x ${markerEnde("b")} demo`), null);
    const sch = ein("a", { schluessel: "k" });
    assert.equal(einheitText(sch, '{"k":{"x":"acme"},"z":"demo"}'), '{"x":"acme"}');
    assert.equal(einheitText(sch, '{"z":1}'), null);
    assert.equal(einheitText(sch, "kein json"), null);
  });
});

describe("pruefeManifest", () => {
  const lies = (t: string | null) => (): string | null => t;
  const ok = (eintraege: Eintrag[]): Manifest => ({ version: 1, eintraege });
  test("gültige Einheiten aller Arten sind grün", () => {
    const m = ok([ein("a"), ein("b", { block: "x" }), ein("c", { schluessel: "k" })]);
    const lies3 = (p: string): string | null =>
      p === "a" ? "t" : p === "b" ? `${markerStart("x")}\n${markerEnde("x")}` : '{"k":1}';
    assert.deepEqual(pruefeManifest(m, lies3), []);
  });
  test("Negativfälle", () => {
    const blk = ein("a", { block: "x" });
    const meld = (m: Manifest, t: string | null): string => pruefeManifest(m, lies(t)).join("|");
    assert.match(meld(ok([blk]), "nichts"), /genau einmal/);
    assert.match(meld(ok([blk]), `${markerStart("x")}${markerStart("x")}${markerEnde("x")}`), /genau einmal/);
    assert.match(meld(ok([blk]), `${markerEnde("x")}${markerStart("x")}`), /vor dem Start/);
    assert.match(meld(ok([blk]), `${markerStart("x")}${markerEnde("x")}${markerEnde("x")}`), /genau einmal/);
    assert.match(meld(ok([ein("a", { schluessel: "k" })]), '{"z":1}'), /JSON-Schlüssel fehlt/);
    assert.match(meld(ok([ein("a", { schluessel: "k" })]), "{kaputt"), /JSON-Schlüssel fehlt/);
    assert.match(meld(ok([ein("a"), ein("a", { schluessel: "k" })]), '{"k":1}'), /ganz und als Teil/);
    assert.match(meld(ok([ein("a"), ein("a")]), "t"), /doppelte Einheit/);
    assert.match(meld(ok([ein("a", { ring: "x" })]), "t"), /unbekannter Ring/);
    assert.match(meld(ok([ein("a")]), null), /existiert nicht/);
    assert.match(meld({ version: 2, eintraege: [] }, "t"), /version/);
    assert.match(meld(ok([ein("a", { quelle: " " })]), "t"), /quelle fehlt/);
    assert.match(meld(ok([ein("a", { block: "x", schluessel: "k" })]), "t"), /zugleich/);
    for (const unsicher of ["/etc/x", "../x", "a/../x", "a\\b", "a//b", "C:/x", "", "a/./b"]) {
      assert.match(meld(ok([ein(unsicher)]), "t"), /Pfad unsicher/, unsicher);
    }
  });
});

describe("diffBasisModus", () => {
  test("Basis da, lokal ohne Basis entfällt, in der CI ohne Basis rot", () => {
    assert.equal(diffBasisModus("abc", {}), "pruefen");
    assert.equal(diffBasisModus("abc", { CI: "true" }), "pruefen");
    assert.equal(diffBasisModus(null, {}), "entfaellt");
    assert.equal(diffBasisModus(null, { CI: "true" }), "rot");
  });
});

describe("vergleiche", () => {
  test("Gleichstand ist grün", () => {
    assert.deepEqual(vergleiche({ a: { Repo: 2 } }, { a: { Repo: 2 } }), []);
    assert.deepEqual(vergleiche({}, {}), []);
  });
  test("neues Literal nennt Einheit und Begriff", () => {
    const m = vergleiche({ "x.mjs": { Owner: 1 } }, {});
    assert.equal(m.length, 1);
    assert.match(m[0] ?? "", /^x\.mjs: neues Projektliteral 'Owner'/);
  });
  test("über Baseline, unter Baseline, verwaister Eintrag", () => {
    assert.match(vergleiche({ a: { Repo: 3 } }, { a: { Repo: 2 } }).join(), /'Repo' 3x über Baseline 2/);
    assert.match(vergleiche({ a: { Repo: 1 } }, { a: { Repo: 2 } }).join(), /Baseline auf 1 senken/);
    assert.match(vergleiche({}, { a: { Repo: 2 } }).join(), /a: Baseline-Eintrag ohne Literale/);
    assert.match(vergleiche({ a: { Repo: 1 } }, { a: { Repo: 1, Owner: 1 } }).join(), /'Owner' kommt nicht mehr vor/);
  });
});

describe("parseNameStatus / erlaubt / anhebungen", () => {
  const nameStatus = "M\ta.mjs\nA\tneu.mjs\nR090\talt.mjs\tumbenannt.mjs\nD\tweg.mjs\nC075\tq.mjs\tkopie.mjs\nT\tx.mjs\n";
  const aend = parseNameStatus(nameStatus);
  test("parseNameStatus: geändert, neu, umbenannt; gelöscht fehlt", () => {
    assert.equal(aend.get("a.mjs"), "a.mjs");
    assert.equal(aend.get("neu.mjs"), null);
    assert.equal(aend.get("umbenannt.mjs"), "alt.mjs");
    assert.equal(aend.has("weg.mjs"), false);
    assert.equal(aend.get("kopie.mjs"), null);
    assert.equal(aend.get("x.mjs"), "x.mjs");
  });
  const basis = (p: string): string | null => (p === "a.mjs" ? "demo" : p === "alt.mjs" ? "acme acme" : null);
  const einheiten = [ein("a.mjs"), ein("neu.mjs"), ein("umbenannt.mjs"), ein("unberuehrt.mjs")];
  const erl = erlaubt(einheiten, aend, basis, B);
  test("erlaubt: nur berührte Einheiten; neu = 0; Umbenennung = Zählung des alten Pfads", () => {
    assert.deepEqual(erl, { "a.mjs": { Repo: 1 }, "neu.mjs": {}, "umbenannt.mjs": { Owner: 2 } });
  });
  test("anhebungen: Baseline über Basiswert rot, gleich oder darunter grün", () => {
    assert.match(anhebungen({ "a.mjs": { Repo: 2 } }, erl).join(), /a\.mjs: Baseline 'Repo' 2 über dem Wert an der Diff-Basis \(1\)/);
    assert.match(anhebungen({ "neu.mjs": { Owner: 1 } }, erl).join(), /neu\.mjs/);
    assert.match(anhebungen({ "umbenannt.mjs": { Owner: 3 } }, erl).join(), /umbenannt\.mjs/);
    assert.deepEqual(anhebungen({ "a.mjs": { Repo: 1 }, "umbenannt.mjs": { Owner: 1 } }, erl), []);
    assert.deepEqual(anhebungen({ "unberuehrt.mjs": { Repo: 9 } }, erl), []);
  });
  test("neue Einheit einer bestehenden Datei (Manifest-Zuwachs) ist bis zur Zählung an der Basis erlaubt", () => {
    const e = ein("a.mjs", { block: "b" });
    const aen = new Map<string, string | null>([["a.mjs", "a.mjs"]]);
    const text = `${markerStart("b")} demo ${markerEnde("b")}`;
    assert.deepEqual(erlaubt([e], aen, () => text, B), { "a.mjs#b": { Repo: 1 } });
    assert.deepEqual(erlaubt([e], aen, () => "ohne Marker", B), { "a.mjs#b": {} });
  });
});

describe("schichtdatenImporte / pruefeSchichtdatenRegel (#1612)", () => {
  const LAYERS = "scripts/layers.cjs";
  const mit = (pfad: string, text: string): ((p: string) => string | null) => (p) => (p === pfad ? text : null);
  const hits = (pfad: string, text: string, e: Partial<Eintrag> = {}): string[] => schichtdatenImporte([ein(pfad, e)], mit(pfad, text), LAYERS);
  test("rot bei require, import-from und createRequire auf die Schichtdaten, relativ zur importierenden Datei", () => {
    assert.deepEqual(hits("scripts/docs-gen/x.mjs", 'const l = require("../layers.cjs");'), ["scripts/docs-gen/x.mjs"]);
    assert.deepEqual(hits("scripts/y.mjs", 'import { a } from "./layers.cjs";'), ["scripts/y.mjs"]);
    assert.deepEqual(hits("scripts/z.mjs", 'const m = createRequire(import.meta.url)("./layers.cjs");'), ["scripts/z.mjs"]);
  });
  test("kein Verstoß: dynamischer Pfad, anderer aufgelöster Pfad, Markdown, Block- und Schlüssel-Einheit", () => {
    assert.deepEqual(hits("scripts/a.mjs", "const l = require(cfg.layers);"), []);
    assert.deepEqual(hits("scripts/docs-gen/b.mjs", 'require("./layers.cjs")'), []);
    assert.deepEqual(hits("scripts/c.md", 'require("./layers.cjs")'), []);
    assert.deepEqual(hits("scripts/d.mjs", 'require("./layers.cjs")', { block: "b" }), []);
    assert.deepEqual(hits("scripts/e.mjs", 'require("./layers.cjs")', { schluessel: "k" }), []);
    assert.deepEqual(schichtdatenImporte([ein("scripts/f.mjs")], () => null, LAYERS), []);
  });
  test("Regel: Verstoß ohne Ausnahme, Ausnahme ohne Ticket und veraltete Ausnahme sind rot", () => {
    assert.match(pruefeSchichtdatenRegel(["scripts/a.mjs"], {}).join(), /^scripts\/a\.mjs: importiert die Schichtdaten statisch/);
    assert.match(pruefeSchichtdatenRegel(["scripts/a.mjs"], { "scripts/a.mjs": "später" }).join(), /Ausnahme ohne Ticket/);
    assert.match(pruefeSchichtdatenRegel([], { "scripts/a.mjs": "#9 x" }).join(), /Ausnahme veraltet/);
    assert.deepEqual(pruefeSchichtdatenRegel(["scripts/a.mjs"], { "scripts/a.mjs": "#9 x" }), []);
  });
});

// ── Reale Prüfungen ───────────────────────────────────────────────────────────

const lesenWurzel = (pfad: string): string | null => {
  const voll = WURZEL + pfad;
  return existsSync(voll) ? readFileSync(voll, "utf8") : null;
};
const manifest = JSON.parse(readFileSync(WURZEL + MANIFEST, "utf8")) as Manifest;
const baseline = JSON.parse(readFileSync(WURZEL + BASELINE, "utf8")) as Baseline;
const echteBegriffe = begriffeAus((rawPc as unknown as { ladeProjektConfig(): ProjektConfig }).ladeProjektConfig());

describe("Kern-Reinheit (#1610)", () => {
  test("das Besitz-Manifest ist gültig und nicht trivial", () => {
    assert.deepEqual(pruefeManifest(manifest, lesenWurzel), []);
    assert.ok(manifest.eintraege.length > 50, "Startbestand zu klein");
    assert.ok(manifest.eintraege.some((e) => e.block !== undefined), "kein Block-Eintrag");
    assert.ok(manifest.eintraege.some((e) => e.schluessel !== undefined), "kein Schlüssel-Eintrag");
    assert.ok(manifest.eintraege.some((e) => e.block === undefined && e.schluessel === undefined), "kein Datei-Eintrag");
  });

  test("jede Einheit hält ihre Baseline an Projektliteralen, nur sinkend", () => {
    const ist: Baseline = {};
    for (const e of manifest.eintraege) {
      const t = einheitText(e, lesenWurzel(e.pfad) ?? "");
      const z = zaehle(t ?? "", echteBegriffe);
      if (Object.keys(z).length > 0) ist[einheitId(e)] = z;
    }
    assert.deepEqual(vergleiche(ist, baseline), []);
  });

  test("kein Kern-Modul importiert die Schichtdaten statisch (Ausnahmen nur mit Ticket, nur schrumpfend, #1612)", () => {
    const cfg = JSON.parse(lesenWurzel("scripts/docs-gen/config.json") ?? "{}") as { schichten?: { layers?: string } };
    const pfad = cfg.schichten?.layers;
    assert.ok(pfad, "scripts/docs-gen/config.json: schichten.layers fehlt");
    const verstoesse = schichtdatenImporte(manifest.eintraege, lesenWurzel, pfad);
    assert.deepEqual(pruefeSchichtdatenRegel(verstoesse, SCHICHTDATEN_AUSNAHMEN), []);
  });

  const git = (args: string[]): string => execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const basis: string | null = checkBasis.resolveBase(git, process.env) ?? null;

  // In der CI (fail-closed) muss die Basis auflösbar sein; lokal ohne Basis entfällt die Prüfung.
  test.skipIf(diffBasisModus(basis, process.env) === "entfaellt")("die Baseline wurde gegen die Diff-Basis nicht angehoben", () => {
    assert.ok(basis, "keine Diff-Basis auflösbar (KQ_DIFF_BASE/origin/main fehlt)");
    const aend = parseNameStatus(git(["diff", "-M", "--name-status", basis]));
    const basisText = (alt: string): string | null => {
      try {
        return git(["show", `${basis}:${alt}`]);
      } catch {
        return null;
      }
    };
    const erl = erlaubt(manifest.eintraege, aend, basisText, echteBegriffe);
    assert.deepEqual(anhebungen(baseline, erl), []);
  });
});
