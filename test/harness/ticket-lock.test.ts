/* Ticket-Lock (#1561 Z4) – zwei Sessions als `fluffels` dürfen dasselbe Ticket nicht gleichzeitig bearbeiten.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Echte Lock-Datei in einem Temp-Ordner (atomares `wx`), git und Uhr sind injiziert.
 */
import { afterEach, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/ticket-lock.mjs";

type Erg = { code: number; out: string; err: string };
type Deps = Record<string, unknown>;
const M = raw as unknown as {
  VERWAIST_MS: number;
  INAKTIV_MS: number;
  entscheideClaim: (o: { erstellt: number; jetzt: number }) => string;
  entscheidePruefung: (o: { lock: { nonce: string } | null; nonce: string | null; vorhanden: boolean; aktivitaet: number | null; jetzt: number }) => string;
  letzteAktivitaet: (o: { commitMs?: number[]; reflogMs?: number[]; dateiMs?: number[]; nodeModulesMs?: number | null }) => number | null;
  nonceAus: (argv: string[]) => string | null;
  fuehreAus: (argv: string[], deps: Deps) => Erg;
  echteDeps: () => Deps;
};

const MIN = 60_000;
const JETZT = Date.UTC(2026, 9, 9, 12, 0, 0);
let dir: string;
let zaehler = 0;

type Welt = { refs?: string[]; worktrees?: string[]; commitSek?: number; reflogSek?: number; status?: string[]; fetchFehler?: boolean };

/** Deps mit echtem Dateisystem im Temp-Ordner und einem gefälschten git. */
function deps(welt: Welt = {}, jetzt = JETZT, datei: Record<string, number> = {}): Deps {
  const echt = M.echteDeps();
  return {
    ...echt,
    lockDir: join(dir, "kq-locks"),
    jetzt: () => jetzt,
    nonce: () => `nonce-${++zaehler}`,
    mtime: (p: string) => datei[p] ?? Number.NaN,
    git: (args: string[]) => {
      const a = args.join(" ");
      if (a.startsWith("fetch")) {
        if (welt.fetchFehler) throw new Error("kein Netz");
        return "";
      }
      if (a.startsWith("for-each-ref")) return (welt.refs ?? []).join("\n");
      if (a.startsWith("worktree list")) return ["worktree C:/dev/kubernia", ...(welt.worktrees ?? []).map((w) => `worktree ${w}`)].join("\n");
      if (a.startsWith("log -1")) return String(welt.commitSek ?? 0);
      if (a.includes("reflog")) return String(welt.reflogSek ?? 0);
      if (a.includes("status --porcelain")) return (welt.status ?? []).join("\n");
      throw new Error(`unerwartet: ${a}`);
    },
  };
}
const lauf = (argv: string[], welt: Welt = {}, jetzt = JETZT, datei: Record<string, number> = {}) => M.fuehreAus(argv, deps(welt, jetzt, datei));
const nonceVon = (r: Erg) => /nonce=(\S+)/.exec(r.out)?.[1] ?? "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kq-lock-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("claim", () => {
  test("der erste gewinnt (Exit 0 + nonce), der zweite sieht den frischen fremden Lock (Exit 4)", () => {
    const a = lauf(["claim", "1561"]);
    assert.equal(a.code, 0);
    assert.match(a.out, /^nonce=nonce-\d+\n$/);
    const lockText = readFileSync(join(dir, "kq-locks", "1561.json"), "utf8");
    assert.equal(JSON.parse(lockText).nonce, nonceVon(a));
    assert.equal(JSON.parse(lockText).nr, 1561);
    const b = lauf(["claim", "1561"]);
    assert.equal(b.code, 4);
    assert.match(b.err, /anderen Session/);
    assert.equal(JSON.parse(readFileSync(join(dir, "kq-locks", "1561.json"), "utf8")).nonce, nonceVon(a), "der Lock des Gewinners bleibt");
  });

  test("ein anderes Ticket ist unabhängig", () => {
    assert.equal(lauf(["claim", "1561"]).code, 0);
    assert.equal(lauf(["claim", "1562"]).code, 0);
  });

  test("ein verwaister Lock (älter als 2 h) wird ersetzt, der alte bleibt als .verwaist-<nonce> liegen", () => {
    const a = lauf(["claim", "7"], {}, JETZT - 2 * 60 * MIN - 1);
    assert.equal(a.code, 0);
    const b = lauf(["claim", "7"]);
    assert.equal(b.code, 0);
    assert.notEqual(nonceVon(b), nonceVon(a));
    assert.equal(JSON.parse(readFileSync(join(dir, "kq-locks", "7.json"), "utf8")).nonce, nonceVon(b));
    assert.ok(readdirSync(join(dir, "kq-locks")).some((f) => f === `7.json.verwaist-${nonceVon(b)}`));
  });

  test("ein Lock knapp unter 2 h gilt noch", () => {
    lauf(["claim", "7"], {}, JETZT - 2 * 60 * MIN + 1000);
    assert.equal(lauf(["claim", "7"]).code, 4);
  });

  test("ein kaputter Lock (kein JSON) zählt als verwaist", () => {
    lauf(["claim", "7"]);
    writeFileSync(join(dir, "kq-locks", "7.json"), "{kaputt");
    assert.equal(lauf(["claim", "7"]).code, 0);
  });

  test("belegt: Worktree kq-<nr> oder lokaler/remote Branch feature/kq-<nr>-* → Exit 4, kein Lock", () => {
    for (const welt of [
      { worktrees: ["C:/dev/kubernia/.claude/worktrees/kq-9"] },
      { refs: ["feature/kq-9-irgendwas"] },
      { refs: ["origin/feature/kq-9-irgendwas"] },
    ]) {
      const r = lauf(["claim", "9"], welt);
      assert.equal(r.code, 4, JSON.stringify(welt));
      assert.match(r.err, /Worktree oder Branch/);
      assert.equal(existsSync(join(dir, "kq-locks", "9.json")), false);
    }
  });

  test("ein Branch mit ähnlicher Nummer (kq-91, kq-19) belegt #9 nicht", () => {
    assert.equal(lauf(["claim", "9"], { refs: ["feature/kq-91-x", "origin/feature/kq-19-y"], worktrees: ["C:/x/.claude/worktrees/kq-90"] }).code, 0);
  });

  test("ohne Netz (fetch scheitert) zählen die lokalen Refs: weiter fail-open", () => {
    assert.equal(lauf(["claim", "9"], { fetchFehler: true }).code, 0);
    assert.equal(lauf(["claim", "10"], { fetchFehler: true, refs: ["feature/kq-10-x"] }).code, 4);
  });
});

describe("pruefe", () => {
  test("nichts vorhanden → frei, auch mit eigener Nonce", () => {
    const a = lauf(["claim", "5"]);
    assert.deepEqual(lauf(["pruefe", "5", "--nonce", nonceVon(a)]), { code: 0, out: "frei\n", err: "" });
    assert.equal(lauf(["pruefe", "6"]).out, "frei\n");
  });

  test("Nonce passt nicht → fremd (Exit 4); fehlender Lock trotz Nonce → fremd", () => {
    const a = lauf(["claim", "5"]);
    const r = lauf(["pruefe", "5", "--nonce", `${nonceVon(a)}x`]);
    assert.equal(r.code, 4);
    assert.equal(r.out, "fremd\n");
    assert.equal(lauf(["pruefe", "6", "--nonce", "egal"]).out, "fremd\n");
    assert.equal(lauf(["pruefe", "6", "--nonce=egal"]).code, 4);
  });

  test("Worktree mit Aktivität vor 29 min → aktiv (Exit 4), vor 31 min → uebernehmbar (Exit 0)", () => {
    const wt = "C:/dev/kubernia/.claude/worktrees/kq-5";
    const welt = (minuten: number): Welt => ({ worktrees: [wt], refs: ["feature/kq-5-x"], commitSek: (JETZT - minuten * MIN) / 1000, reflogSek: (JETZT - minuten * MIN) / 1000 });
    const aktiv = lauf(["pruefe", "5"], welt(29));
    assert.equal(aktiv.code, 4);
    assert.equal(aktiv.out, "aktiv\n");
    assert.match(aktiv.err, /Aktivität in den letzten 30 min/);
    assert.deepEqual(lauf(["pruefe", "5"], welt(31)), { code: 0, out: "uebernehmbar\n", err: "" });
  });

  test("jede Quelle zählt: Commit, Reflog, geänderte Datei, node_modules", () => {
    const wt = "C:/dev/kubernia/.claude/worktrees/kq-5";
    const alt = (JETZT - 120 * MIN) / 1000;
    const basis: Welt = { worktrees: [wt], refs: ["feature/kq-5-x"], commitSek: alt, reflogSek: alt, status: [" M scripts/a.mjs", "?? neu.txt"] };
    assert.equal(lauf(["pruefe", "5"], basis).out, "uebernehmbar\n", "Kontrolle: alles alt");
    assert.equal(lauf(["pruefe", "5"], { ...basis, commitSek: (JETZT - 5 * MIN) / 1000 }).out, "aktiv\n", "Commit");
    assert.equal(lauf(["pruefe", "5"], { ...basis, reflogSek: (JETZT - 5 * MIN) / 1000 }).out, "aktiv\n", "Reflog");
    assert.equal(lauf(["pruefe", "5"], basis, JETZT, { [join(wt, "neu.txt")]: JETZT - 5 * MIN }).out, "aktiv\n", "geänderte Datei");
    assert.equal(lauf(["pruefe", "5"], basis, JETZT, { [join(wt, "node_modules")]: JETZT - 5 * MIN }).out, "aktiv\n", "node_modules");
  });

  test("Remote-Branch ohne Worktree zählt als vorhanden; keine feststellbare Aktivität ist fail-closed aktiv", () => {
    assert.equal(lauf(["pruefe", "5"], { refs: ["origin/feature/kq-5-x"], commitSek: (JETZT - 5 * MIN) / 1000 }).out, "aktiv\n");
    assert.equal(lauf(["pruefe", "5"], { refs: ["origin/feature/kq-5-x"], commitSek: (JETZT - 300 * MIN) / 1000 }).out, "uebernehmbar\n");
    assert.equal(M.entscheidePruefung({ lock: null, nonce: null, vorhanden: true, aktivitaet: null, jetzt: JETZT }), "aktiv");
  });

  test("mit eigener Nonce und einem Worktree mit frischer Aktivität bleibt es aktiv (Doppel-Spawn)", () => {
    const a = lauf(["claim", "5"]);
    const welt: Welt = { worktrees: ["C:/dev/kubernia/.claude/worktrees/kq-5"], reflogSek: (JETZT - 5 * MIN) / 1000 };
    assert.equal(lauf(["pruefe", "5", "--nonce", nonceVon(a)], welt).code, 4);
  });
});

describe("freigeben", () => {
  test("löscht nur den eigenen Lock; mit fremder Nonce bleibt er, Exit 4", () => {
    const a = lauf(["claim", "5"]);
    const f = lauf(["freigeben", "5", "--nonce", "fremd"]);
    assert.equal(f.code, 4);
    assert.ok(existsSync(join(dir, "kq-locks", "5.json")));
    assert.equal(lauf(["freigeben", "5", "--nonce", nonceVon(a)]).code, 0);
    assert.equal(existsSync(join(dir, "kq-locks", "5.json")), false);
    assert.equal(lauf(["claim", "5"]).code, 0, "danach ist das Ticket wieder claimbar");
  });

  test("ohne Lock ist freigeben ein No-op (Exit 0), ohne Nonce falscher Aufruf", () => {
    assert.equal(lauf(["freigeben", "5", "--nonce", "x"]).code, 0);
    assert.equal(lauf(["freigeben", "5"]).code, 2);
  });
});

describe("Aufruf und reine Funktionen", () => {
  test("ungültige Nummer, unbekannter Befehl, fehlende Argumente → Exit 2", () => {
    for (const argv of [[], ["claim"], ["claim", "abc"], ["claim", "-1"], ["claim", "1.5"], ["foo", "5"], ["pruefe", "5", "--nonce"], ["claim", "5", "extra"]]) {
      assert.equal(lauf(argv).code, 2, JSON.stringify(argv));
    }
    assert.equal(existsSync(join(dir, "kq-locks")), false, "kein Lock bei falschem Aufruf");
  });

  test("ein werfendes git ergibt Exit 2 statt eines Absturzes", () => {
    const d = { ...deps(), git: () => { throw new Error("git kaputt"); } };
    const r = M.fuehreAus(["pruefe", "5"], d);
    assert.equal(r.code, 2);
    assert.match(r.err, /git kaputt/);
  });

  test("entscheideClaim: Grenze bei VERWAIST_MS", () => {
    assert.equal(M.entscheideClaim({ erstellt: JETZT - M.VERWAIST_MS + 1, jetzt: JETZT }), "fremd");
    assert.equal(M.entscheideClaim({ erstellt: JETZT - M.VERWAIST_MS, jetzt: JETZT }), "ersetzen");
    assert.equal(M.entscheideClaim({ erstellt: Number.NaN, jetzt: JETZT }), "ersetzen");
  });

  test("entscheidePruefung: Grenze bei INAKTIV_MS, fremd geht vor", () => {
    const o = { lock: { nonce: "a" }, nonce: "a", vorhanden: true, jetzt: JETZT };
    assert.equal(M.entscheidePruefung({ ...o, aktivitaet: JETZT - M.INAKTIV_MS + 1 }), "aktiv");
    assert.equal(M.entscheidePruefung({ ...o, aktivitaet: JETZT - M.INAKTIV_MS }), "uebernehmbar");
    assert.equal(M.entscheidePruefung({ ...o, nonce: "b", vorhanden: false, aktivitaet: null }), "fremd");
    assert.equal(M.entscheidePruefung({ ...o, vorhanden: false, aktivitaet: null }), "frei");
  });

  test("letzteAktivitaet: Maximum, nicht endliche Werte entfallen, nichts → null", () => {
    assert.equal(M.letzteAktivitaet({ commitMs: [1, 5], reflogMs: [3], dateiMs: [Number.NaN, 4], nodeModulesMs: 2 }), 5);
    assert.equal(M.letzteAktivitaet({ dateiMs: [Number.NaN] }), null);
    assert.equal(M.letzteAktivitaet({}), null);
  });

  test("nonceAus liest `--nonce x` und `--nonce=x`", () => {
    assert.equal(M.nonceAus(["pruefe", "5"]), null);
    assert.equal(M.nonceAus(["pruefe", "5", "--nonce", "abc"]), "abc");
    assert.equal(M.nonceAus(["pruefe", "5", "--nonce=abc"]), "abc");
    assert.equal(M.nonceAus(["pruefe", "5", "--nonce"]), "");
  });

  test("die echte Lock-Datei liegt im gemeinsamen git-Verzeichnis, nicht unter .claude/worktrees", () => {
    const echt = M.echteDeps() as { lockDir: string };
    assert.match(echt.lockDir.replace(/\\/g, "/"), /\.git\/kq-locks$/);
    assert.doesNotMatch(echt.lockDir.replace(/\\/g, "/"), /\.claude\/worktrees/);
  });
});
