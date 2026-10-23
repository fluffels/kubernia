/* Berechtigungs-Ergänzung im Sync und im Drift-Gate (#1874, ADR 0022 Fortschreibung 1874): der Kern-Anteil von `permissions` wird verteilt,
 * die Ergänzung des Ziels (`berechtigungen` in dessen Config) steht als Ende der Listen, Hash und Gate prüfen beides getrennt.
 * Fixture: synthetische Quelle und Ziele im Temp-Ordner, nichts davon liegt im Repo. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSync from "../scripts/factory-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDrift from "../scripts/check-factory-drift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

type Perm = { allow?: string[]; ask?: string[]; deny?: string[] };
interface Erg {
  allow: string[];
  ask: string[];
  deny: string[];
}
interface Opt {
  cwd?: string;
  out?: (s: string) => void;
  err?: (s: string) => void;
}
const lib = rawLib as unknown as {
  kernAnteil(perm: Perm, erg: Partial<Erg>): Perm;
  mitErgaenzung(kern: Perm, erg: Partial<Erg>): Perm;
  ergaenzungsBefunde(perm: Perm, erg: Partial<Erg>): string[];
  einheitHash(e: { pfad: string; schluessel?: string }, text: string, erg?: Partial<Erg>): string | null;
};
const sync = rawSync as unknown as {
  cli(argv: string[], opt?: Opt): number;
  pruefeErgebnis(p: string, e: unknown[], src: string, ziel: string | null, ergebnis: string, erg: { quelle: Erg; ziel: Erg }): string[];
};
const drift = rawDrift as unknown as {
  cli(argv: string[], opt?: Opt): number;
  pruefeDrift(lies: (p: string) => string | null): { fehler: string[] };
  pruefeErgaenzung(lies: (p: string) => string | null): { fehler: string[]; eintraege: number };
};
const pc = rawPc as unknown as { ROLLEN_PFADE: Record<string, string>; PROJEKT_ROLLEN: string[] };

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "kq-fsyncb-"));
  temps.push(d);
  return d;
};
const schreibe = (wurzel: string, rel: string, text: string): void => {
  const voll = join(wurzel, ...rel.split("/"));
  mkdirSync(dirname(voll), { recursive: true });
  writeFileSync(voll, text);
};
const lies = (wurzel: string, rel: string): string => readFileSync(join(wurzel, ...rel.split("/")), "utf8");
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

const ROLLEN = Object.entries(pc.ROLLEN_PFADE)
  .filter(([rolle]) => !pc.PROJEKT_ROLLEN.includes(rolle))
  .map(([, pfad]) => ({ pfad, ring: "kern", quelle: "t" }));
const MANIFEST = { version: 1, eintraege: [...ROLLEN, { pfad: ".claude/settings.json", schluessel: "permissions", ring: "kern", quelle: "t" }] };
const SETTINGS = ".claude/settings.json";
const CONFIG = ".factory/projekt.json";

// Kern der Quelle: das deny „mcp__claude-in-chrome“ und das ask „Bash(curl:*)“ gehören zum Kern, „mcp__dup“ nicht (Fixture für den Doppel-Fall).
const KERN: Required<Perm> = { allow: ["Bash(ls)"], ask: ["Bash(curl:*)"], deny: ["Read(/.env)", "mcp__claude-in-chrome"] };
const QUELL_ERG: Erg = { allow: ["mcp__a"], ask: ["mcp__a__w"], deny: ["mcp__b"] };
const mit = (kern: Required<Perm>, erg: Partial<Erg>): Required<Perm> => lib.mitErgaenzung(kern, erg) as Required<Perm>;

function baueQuelle(opt: { settings?: Perm; erg?: Partial<Erg> | null } = {}): string {
  const q = tmp();
  schreibe(q, ".factory/besitz.json", json(MANIFEST));
  for (const e of ROLLEN) schreibe(q, e.pfad, "rolle\n");
  schreibe(q, SETTINGS, json({ model: "quelle", permissions: opt.settings ?? mit(KERN, QUELL_ERG) }));
  if (opt.erg !== null) schreibe(q, CONFIG, json({ berechtigungen: opt.erg ?? QUELL_ERG }));
  return q;
}
function baueZiel(erg?: Partial<Erg>): string {
  const z = tmp();
  schreibe(z, SETTINGS, '{\n    "model": "opus",\n    "permissions": {"allow": []}\n}\n');
  if (erg !== undefined) schreibe(z, CONFIG, json({ berechtigungen: erg }));
  return z;
}

const GIT_KONFIG = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.autocrlf=false"];
const git = (q: string, args: string[]): string => execFileSync("git", ["-C", q, ...GIT_KONFIG, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function vomTag(q: string, z: string): { code: number; out: string; err: string } {
  if (!existsSync(join(q, ".git"))) git(q, ["init", "-q"]);
  git(q, ["add", "-A"]);
  if (git(q, ["status", "--porcelain"]) !== "") git(q, ["commit", "-q", "-m", "t"]);
  git(q, ["tag", "-f", "v1"]);
  const out: string[] = [];
  const err: string[] = [];
  const code = sync.cli(["--quelle", q, "--ziel", z, "--tag", "v1"], { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
function gate(z: string): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = drift.cli(["--wurzel", z], { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const perm = (z: string): Required<Perm> => (JSON.parse(lies(z, SETTINGS)) as { permissions: Required<Perm> }).permissions;
const leser = (z: string) => (p: string): string | null => (existsSync(join(z, ...p.split("/"))) ? lies(z, p) : null);

describe("Berechtigungs-Ergänzung: pure Primitive", () => {
  const perm0: Perm = { allow: ["a", "x", "y"], deny: ["d"] };
  test("kernAnteil filtert mengenbasiert je Liste, andere Schlüssel bleiben, eine leer gewordene Liste entfällt", () => {
    assert.deepEqual(lib.kernAnteil(perm0, { allow: ["x", "y"] }), { allow: ["a"], deny: ["d"] });
    assert.deepEqual(lib.kernAnteil({ ...perm0, defaultMode: "plan" } as Perm, { allow: ["a", "x", "y"] }), { deny: ["d"], defaultMode: "plan" });
    assert.deepEqual(lib.kernAnteil(perm0, {}), perm0);
  });
  test("mitErgaenzung hängt hinten an und legt eine fehlende Liste an", () => {
    assert.deepEqual(lib.mitErgaenzung({ allow: ["a"] }, { allow: ["x"], ask: ["q"] }), { allow: ["a", "x"], ask: ["q"] });
    assert.deepEqual(lib.mitErgaenzung({ allow: ["a"] }, {}), { allow: ["a"] });
  });
  test("ergaenzungsBefunde: fehlend, nicht am Ende, doppelt", () => {
    assert.match(lib.ergaenzungsBefunde({ allow: ["a"] }, { allow: ["mcp__x"] }).join("|"), /allow: Ergänzung „mcp__x“ fehlt/);
    assert.doesNotMatch(lib.ergaenzungsBefunde({ allow: ["a"] }, { allow: ["mcp__x"] }).join("|"), /Ende der Liste/, "ein fehlender Eintrag ist kein Reihenfolge-Befund");
    assert.match(lib.ergaenzungsBefunde({ allow: ["mcp__x", "a"] }, { allow: ["mcp__x"] }).join("|"), /Ende der Liste/);
    assert.match(lib.ergaenzungsBefunde({ allow: ["mcp__x", "mcp__x"] }, { allow: ["mcp__x"] }).join("|"), /steht doppelt/);
    assert.deepEqual(lib.ergaenzungsBefunde({ allow: ["a", "mcp__x", "mcp__y"] }, { allow: ["mcp__x", "mcp__y"] }), []);
  });
  test("ergaenzungsBefunde: ein allow hebt ein deny oder ask auf (gleich, Server-Regel, Platzhalter am Ende), das kubernia-Muster bleibt erlaubt", () => {
    const heb = (allow: string, r: Perm): string => lib.ergaenzungsBefunde({ allow: [allow], ...r }, { allow: [allow] }).join("|");
    assert.match(heb("mcp__x", { deny: ["mcp__x"] }), /hebt die Regel „mcp__x“/);
    assert.match(heb("mcp__x__t", { deny: ["mcp__x"] }), /hebt die Regel/);
    assert.match(heb("mcp__x__t", { ask: ["mcp__x__*"] }), /hebt die Regel/);
    assert.match(heb("mcp__x", { ask: ["mcp__x"] }), /hebt die Regel/);
    assert.equal(heb("mcp__x", { ask: ["mcp__x__w"], deny: ["mcp__xy"] }), "", "allow Server-Regel, ask einzelnes Tool: legitim");
    assert.equal(heb("mcp__x__t", { deny: ["mcp__x__u"] }), "");
    assert.equal(heb("mcp__x", { deny: ["mcp"] }), "", "eine Regel, die kein Server-Muster ist, wird nicht als Präfix gelesen");
  });
  test("einheitHash: dieselbe Quelle mit verschiedenen Ergänzungen hat denselben Kern-Hash, eine Handänderung am Kern einen anderen", () => {
    const e = { pfad: SETTINGS, schluessel: "permissions" };
    const text = (p: Perm): string => json({ permissions: p });
    const kern = lib.einheitHash(e, text(KERN), {});
    assert.equal(lib.einheitHash(e, text(mit(KERN, { allow: ["mcp__p"] })), { allow: ["mcp__p"] }), kern);
    assert.equal(lib.einheitHash(e, text(mit(KERN, { deny: ["mcp__q"] })), { deny: ["mcp__q"] }), kern);
    assert.notEqual(lib.einheitHash(e, text({ ...KERN, deny: ["Read(/.env)"] }), {}), kern);
    assert.notEqual(lib.einheitHash(e, text(mit({ ...KERN, allow: [...KERN.allow, "mcp__hand"] }, { allow: ["mcp__p"] })), { allow: ["mcp__p"] }), kern);
  });
});

describe("Berechtigungs-Ergänzung: Sync", () => {
  const ZIEL_ERG: Erg = { allow: ["mcp__z"], ask: [], deny: ["mcp__zz"] };

  test("das Ziel bekommt den Kern-Anteil plus die eigene Ergänzung am Ende; Projektschlüssel bleiben, der zweite Lauf schreibt nichts, das Gate ist grün", () => {
    const q = baueQuelle();
    const z = baueZiel(ZIEL_ERG);
    const r = vomTag(q, z);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(perm(z), { allow: ["Bash(ls)", "mcp__z"], ask: ["Bash(curl:*)"], deny: ["Read(/.env)", "mcp__claude-in-chrome", "mcp__zz"] });
    assert.equal((JSON.parse(lies(z, SETTINGS)) as { model: string }).model, "opus");
    assert.ok(!JSON.stringify(perm(z)).includes("mcp__a"), "die Ergänzung der Quelle verteilt sich nicht");
    assert.ok(lies(z, SETTINGS).includes('"permissions": {\n    "allow": [\n      "Bash(ls)"'), "neu serialisiert mit der Einrückung der Schlüsselzeile der Quelle (2 Leerzeichen) plus 2 je Ebene");
    const vorher = [lies(z, SETTINGS), lies(z, ".factory/sync-stand.json")];
    assert.match(vomTag(q, z).out, /0 geändert/);
    assert.deepEqual([lies(z, SETTINGS), lies(z, ".factory/sync-stand.json")], vorher);
    const g = gate(z);
    assert.equal(g.code, 0, g.err);
    assert.match(g.out, /2 Einträge der Berechtigungs-Ergänzung ohne Befund/);
  });

  test("ein Ziel ohne Config bekommt nur den Kern-Anteil", () => {
    const z = baueZiel();
    assert.equal(vomTag(baueQuelle(), z).code, 0);
    assert.deepEqual(perm(z), KERN);
    assert.equal(gate(z).code, 0);
  });

  test("ein Ziel ohne Ergänzung und eine Quelle ohne Ergänzung: der Wert kommt wörtlich aus der Quelle", () => {
    const q = baueQuelle({ erg: null });
    const kompakt = '{"allow": ["Bash(ls)"], "ask": [], "deny": ["Read(/.env)"]}';
    schreibe(q, SETTINGS, `{\n    "permissions": ${kompakt}\n}\n`);
    const z = baueZiel();
    assert.equal(vomTag(q, z).code, 0);
    assert.ok(lies(z, SETTINGS).includes(`"permissions": ${kompakt}`), "wörtlich übernommen (kompaktes Format der Quelle bleibt)");
  });

  test("zwei Ziele mit verschiedenen Ergänzungen teilen den Hash der Einheit im Sync-Stand", () => {
    const q = baueQuelle();
    const a = baueZiel(ZIEL_ERG);
    const b = baueZiel({ allow: ["mcp__anders"], ask: ["mcp__anders__w"], deny: [] });
    assert.equal(vomTag(q, a).code, 0);
    assert.equal(vomTag(q, b).code, 0);
    const stand = (z: string): unknown => (JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: unknown }).einheiten;
    assert.deepEqual(stand(a), stand(b));
    assert.equal(gate(a).code, 0);
    assert.equal(gate(b).code, 0);
  });

  test("getrennte Prüfung: eine nur in der Config ergänzte Regel ohne neuen Sync lässt den Kern-Hash grün und macht die Ergänzungs-Prüfung rot", () => {
    const z = baueZiel(ZIEL_ERG);
    assert.equal(vomTag(baueQuelle(), z).code, 0);
    schreibe(z, CONFIG, json({ berechtigungen: { ...ZIEL_ERG, allow: [...ZIEL_ERG.allow, "mcp__neu"] } }));
    assert.deepEqual(drift.pruefeDrift(leser(z)).fehler, []);
    const e = drift.pruefeErgaenzung(leser(z));
    assert.match(e.fehler.join("|"), /Ergänzung „mcp__neu“ fehlt[\s\S]*Weg:/);
    const g = gate(z);
    assert.equal(g.code, 1);
    assert.match(g.err, /Berechtigungs-Ergänzung/);
  });

  test("ohne Sync-Stand (Quell-Modus) ist die Ergänzungs-Prüfung aktiv: grün bei Gleichstand, rot bei falscher Reihenfolge", () => {
    const q = baueQuelle();
    const ok = gate(q);
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /dieses Projekt ist Quelle/);
    assert.match(ok.out, /3 Einträge der Berechtigungs-Ergänzung/);
    schreibe(q, SETTINGS, json({ permissions: { ...mit(KERN, QUELL_ERG), allow: ["mcp__a", "Bash(ls)"] } }));
    const rot = gate(q);
    assert.equal(rot.code, 1);
    assert.match(rot.err, /Ende der Liste/);
  });

  test("ohne settings.json oder ohne permissions ist eine nicht-leere Ergänzung rot, eine leere grün", () => {
    const z = tmp();
    schreibe(z, CONFIG, json({ berechtigungen: { allow: ["mcp__x"] } }));
    assert.match(drift.pruefeErgaenzung(leser(z)).fehler.join("|"), /Datei oder Schlüssel fehlt/);
    schreibe(z, SETTINGS, "{}\n");
    assert.match(drift.pruefeErgaenzung(leser(z)).fehler.join("|"), /Datei oder Schlüssel fehlt/);
    schreibe(z, CONFIG, json({ berechtigungen: {} }));
    assert.deepEqual(drift.pruefeErgaenzung(leser(z)), { fehler: [], eintraege: 0 });
  });

  test("eine kaputte Config meldet das Gate mit Weg, ohne zu werfen", () => {
    const z = tmp();
    schreibe(z, CONFIG, json({ berechtigungen: { defaultMode: "x" } }));
    assert.match(drift.pruefeErgaenzung(leser(z)).fehler.join("|"), /defaultMode ist kein bekannter Schlüssel[\s\S]*Weg:/);
    schreibe(z, CONFIG, "{kaputt");
    assert.match(drift.pruefeErgaenzung(leser(z)).fehler.join("|"), /kein gültiges JSON/);
  });
});

describe("Berechtigungs-Ergänzung: Negativfälle (nichts wird geschrieben, Exit 1)", () => {
  const rot = (erg: unknown, muster: RegExp, quelle: string = baueQuelle()): void => {
    const z = tmp();
    schreibe(z, SETTINGS, '{\n  "model": "opus"\n}\n');
    schreibe(z, CONFIG, json({ berechtigungen: erg }));
    const r = vomTag(quelle, z);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, muster);
    assert.match(r.err, /nichts geschrieben/);
    assert.equal(lies(z, SETTINGS), '{\n  "model": "opus"\n}\n', "settings.json blieb unberührt");
    assert.ok(!existsSync(join(z, ".factory/sync-stand.json")), "kein Sync-Stand");
  };

  test("ein fremder Unterschlüssel (defaultMode, additionalDirectories) ist rot", () => {
    rot({ defaultMode: "bypassPermissions" }, /berechtigungen\.defaultMode ist kein bekannter Schlüssel/);
    rot({ additionalDirectories: ["/"] }, /additionalDirectories ist kein bekannter Schlüssel/);
  });
  test("ein Eintrag ohne mcp__-Präfix ist rot", () => {
    rot({ allow: ["Bash(rm:*)"] }, /muss mit „mcp__“ beginnen/);
  });
  test("ein allow, das ein Kern-deny aufhebt (mcp__claude-in-chrome), ist rot", () => {
    rot({ allow: ["mcp__claude-in-chrome"] }, /Ziel: permissions\.allow: Ergänzung „mcp__claude-in-chrome“ hebt die Regel „mcp__claude-in-chrome“ aus deny oder ask auf/);
  });
  test("ein allow auf ein Tool, dessen Server in deny steht, ist rot", () => {
    rot({ allow: ["mcp__x__tool"], deny: ["mcp__x"] }, /hebt die Regel „mcp__x“/);
  });
  test("ein allow gleich einem ask-Eintrag der Ergänzung ist rot", () => {
    rot({ allow: ["mcp__y__w"], ask: ["mcp__y__w"] }, /hebt die Regel „mcp__y__w“/);
  });
  test("eine Ergänzung, die schon im Kern-Anteil steht, ist doppelt und rot", () => {
    const q = baueQuelle({ settings: { ...KERN, allow: [...KERN.allow, "mcp__dup"] }, erg: null });
    rot({ allow: ["mcp__dup"] }, /„mcp__dup“ steht doppelt/, q);
  });
  test("eine Quelle, deren Ergänzung nicht am Ende der Liste steht, blockiert den Sync mit „Quelle:“", () => {
    const q = baueQuelle({ settings: { ...mit(KERN, QUELL_ERG), allow: ["mcp__a", "Bash(ls)"] } });
    rot({}, /Quelle: permissions\.allow: die Ergänzung muss als Ende der Liste stehen/, q);
  });

  test("Handänderung am Kern-Anteil im Ziel macht das Gate rot und nennt die Config (entferntes deny, von Hand ergänztes allow)", () => {
    const z = baueZiel({ allow: ["mcp__z"], ask: [], deny: [] });
    assert.equal(vomTag(baueQuelle(), z).code, 0);
    assert.equal(gate(z).code, 0);
    const ist = perm(z);
    schreibe(z, SETTINGS, json({ permissions: { ...ist, deny: ist.deny.filter((x) => x !== "mcp__claude-in-chrome") } }));
    const a = gate(z);
    assert.equal(a.code, 1);
    assert.match(a.err, /\.claude\/settings\.json#\/permissions: Besitz wurde im Projekt verändert \(Projekt-Ergänzungen gehören nach \.factory\/projekt\.json › berechtigungen\)/);
    schreibe(z, SETTINGS, json({ permissions: { ...ist, allow: [...ist.allow, "mcp__foo"] } }));
    assert.match(gate(z).err, /Besitz wurde im Projekt verändert/);
    schreibe(z, SETTINGS, json({ permissions: ist }));
    assert.equal(gate(z).code, 0);
  });
});

describe("Berechtigungs-Ergänzung: Grenzen und kaputter Zustand (Runde 1)", () => {
  const EINHEIT = { pfad: SETTINGS, schluessel: "permissions" };
  const pe = (ergebnis: string, src: string, erg: { quelle: Erg; ziel: Erg }): string[] => sync.pruefeErgebnis(SETTINGS, [EINHEIT], src, null, ergebnis, erg);
  const befunde = (perm: Perm, erg: Partial<Erg>): string => lib.ergaenzungsBefunde(perm, erg).join("|");

  test("kernAnteil: eine leere Liste entfällt immer, eine fehlende bleibt fehlend, ein Nicht-Objekt bleibt unverändert", () => {
    assert.deepEqual(lib.kernAnteil({ allow: [], deny: ["d"] }, {}), { deny: ["d"] });
    assert.deepEqual(lib.kernAnteil({ allow: ["a"] }, { deny: ["mcp__x"] }), { allow: ["a"] });
    assert.equal(lib.kernAnteil(null as unknown as Perm, { allow: ["mcp__x"] }), null);
    assert.deepEqual(lib.kernAnteil(["a"] as unknown as Perm, { allow: ["a"] }), ["a"]);
    assert.equal(lib.kernAnteil("x" as unknown as Perm, { allow: ["x"] }), "x");
    assert.doesNotThrow(() => lib.einheitHash(EINHEIT, '{"permissions": null}', { allow: ["mcp__x"] }));
  });

  test("Quelle mit leerer Kern-Liste, Ziel ergänzt genau diese Liste: Sync und Gate grün, derselbe Hash", () => {
    const q = baueQuelle({ settings: { allow: ["Bash(ls)"], ask: [], deny: ["Read(/.env)"] }, erg: null });
    const z = baueZiel({ allow: [], ask: ["mcp__z__w"], deny: [] });
    const r = vomTag(q, z);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(perm(z), { allow: ["Bash(ls)"], ask: ["mcp__z__w"], deny: ["Read(/.env)"] });
    const g = gate(z);
    assert.equal(g.code, 0, g.err);
  });

  test("hebtAuf: die Wortgrenze der Server-Regel, der Tool-Teil und der Platzhalter sind genau begrenzt", () => {
    assert.equal(befunde({ allow: ["mcp__xy"], deny: ["mcp__x"] }, { allow: ["mcp__xy"] }), "", "anderer Server mit gleichem Präfix");
    assert.equal(befunde({ allow: ["mcp__x__t__u"], deny: ["mcp__x__t"] }, { allow: ["mcp__x__t__u"] }), "", "eine Tool-Regel ist kein Server-Muster");
    assert.equal(befunde({ allow: ["mcp__y__t"], ask: ["mcp__x__*"] }, { allow: ["mcp__y__t"] }), "", "Platzhalter gilt nur für sein Präfix");
    assert.match(befunde({ allow: ["mcp__x__t"], ask: ["mcp__x__*"] }, { allow: ["mcp__x__t"] }), /hebt die Regel/);
    for (const a of ["mcp__*", "mcp__claude*", "mcp__claude-in-chrome*"]) {
      assert.match(befunde({ allow: [a], deny: ["mcp__claude-in-chrome"] }, { allow: [a] }), /hebt die Regel „mcp__claude-in-chrome“/, `allow-Platzhalter ${a} deckt das deny`);
    }
    assert.equal(befunde({ allow: ["mcp__y*"], deny: ["mcp__x"] }, { allow: ["mcp__y*"] }), "", "ein allow-Platzhalter anderen Präfixes hebt nichts auf");
  });

  test("Sync und Gate: ein allow-Platzhalter, der das Kern-deny abdeckt, ist rot (Exit 1)", () => {
    const z = tmp();
    schreibe(z, SETTINGS, '{\n  "model": "opus"\n}\n');
    schreibe(z, CONFIG, json({ berechtigungen: { allow: ["mcp__*"] } }));
    const r = vomTag(baueQuelle(), z);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /Ergänzung „mcp__\*“ hebt die Regel „mcp__claude-in-chrome“/);
    schreibe(z, SETTINGS, json({ permissions: mit(KERN, { allow: ["mcp__*"] }) }));
    assert.match(drift.pruefeErgaenzung(leser(z)).fehler.join("|"), /hebt die Regel „mcp__claude-in-chrome“/);
  });

  test("eine fehlende Liste in permissions bei nicht-leerer Ergänzung ist ein Befund, kein Absturz", () => {
    assert.match(befunde({ allow: [] }, { deny: ["mcp__x"] }), /deny: Ergänzung „mcp__x“ fehlt/);
    const z = tmp();
    schreibe(z, SETTINGS, json({ permissions: { allow: [] } }));
    schreibe(z, CONFIG, json({ berechtigungen: { deny: ["mcp__x"] } }));
    assert.match(drift.pruefeErgaenzung(leser(z)).fehler.join("|"), /deny: Ergänzung „mcp__x“ fehlt/);
  });

  test("pruefeErgebnis der ergänzbaren Einheit: korrekt grün, abweichender Kern-Anteil rot, fehlende Ziel-Ergänzung rot", () => {
    const src = json({ permissions: mit(KERN, QUELL_ERG) });
    const zielErg: Erg = { allow: ["mcp__z"], ask: [], deny: [] };
    const erg = { quelle: QUELL_ERG, ziel: zielErg };
    const gut = json({ permissions: mit(KERN, zielErg) });
    assert.deepEqual(pe(gut, src, erg), []);
    const ohneDeny = json({ permissions: mit({ ...KERN, deny: ["Read(/.env)"] }, zielErg) });
    assert.match(pe(ohneDeny, src, erg).join("|"), /Schlüssel 'permissions' weicht nach dem Sync von der Quelle ab/);
    const ohneErg = json({ permissions: KERN });
    assert.match(pe(ohneErg, src, erg).join("|"), /Ergänzung „mcp__z“ fehlt/);
  });

  test("kaputte Quell-Config (Form und JSON) bricht den Sync mit „Quelle:“ ab, nichts wird geschrieben", () => {
    for (const config of [json({ berechtigungen: { defaultMode: "x" } }), "{kaputt"]) {
      const q = baueQuelle();
      schreibe(q, CONFIG, config);
      const z = baueZiel();
      const vorher = lies(z, SETTINGS);
      const r = vomTag(q, z);
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, /Quelle: /);
      assert.match(r.err, /nichts geschrieben/);
      assert.equal(lies(z, SETTINGS), vorher);
      assert.ok(!existsSync(join(z, ".factory/sync-stand.json")));
    }
  });

  test("kaputtes JSON in der Ziel-Config bricht den Sync mit „Ziel:“ ab", () => {
    const z = baueZiel();
    schreibe(z, CONFIG, "{kaputt");
    const r = vomTag(baueQuelle(), z);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /Ziel: .*kein gültiges JSON/);
  });

  test("gesynctes Ziel, danach kaputte Config: das Gate meldet genau die Config mit Weg, ohne Folgebefund am Kern", () => {
    const z = baueZiel({ allow: ["mcp__z"], ask: [], deny: [] });
    assert.equal(vomTag(baueQuelle(), z).code, 0);
    schreibe(z, CONFIG, "{kaputt");
    const g = gate(z);
    assert.equal(g.code, 1);
    assert.match(g.err, /kein gültiges JSON/);
    assert.doesNotMatch(g.err, /Besitz wurde im Projekt verändert/);
    assert.deepEqual(drift.pruefeDrift(leser(z)).fehler, []);
    schreibe(z, ROLLEN[0].pfad, "von Hand geändert\n");
    assert.match(drift.pruefeDrift(leser(z)).fehler.join("|"), new RegExp(ROLLEN[0].pfad.replaceAll(".", "[.]")), "eine andere Einheit bleibt trotz kaputter Config geprüft");
  });

  test("das Gate wirft nicht, wenn permissions in settings.json kein Objekt ist", () => {
    const z = baueZiel({ allow: ["mcp__z"], ask: [], deny: [] });
    assert.equal(vomTag(baueQuelle(), z).code, 0);
    schreibe(z, SETTINGS, json({ permissions: null }));
    assert.doesNotThrow(() => gate(z));
    assert.equal(gate(z).code, 1);
  });
});

