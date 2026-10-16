/* Lebenszeichen im Ticket-Lock (#1699): Lib `ticket-lock-lib.mjs`, `sandbox` bei `claim`, `lebenszeichen`, `lebenszeichen --commit`,
 * Herzschlag als Aktivität und `claim --wiederaufnahme`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Echte Lock-Datei in einem Temp-Ordner, git und Uhr sind injiziert.
 */
import { afterEach, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLock from "../../scripts/ticket-lock.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/ticket-lock-lib.mjs";

type Erg = { code: number; out: string; err: string };
type Lock = Record<string, unknown>;
const M = rawLock as unknown as {
  fuehreAus: (argv: string[], deps: Record<string, unknown>) => Erg;
  echteDeps: () => Record<string, unknown>;
  letzteAktivitaet: (o: { commitMs?: number[]; lockMs?: number | null }) => number | null;
  bereinigeSchritt: (t: unknown) => string | null;
  schrittAus: (argv: string[]) => string | null;
  VERWAIST_MS: number;
  INAKTIV_MS: number;
  ALTLAST_MS: number;
};
const L = rawLib as unknown as {
  lockVerzeichnis: (o: { gemeinsam: string; praefixWorktree: string }) => string;
  parseLock: (t: string) => Lock | null;
  lebenszeichenMs: (l: Lock | null) => number | null;
  oeffentlicheSicht: (l: Lock) => Lock;
  VERWAIST_MS: number;
  INAKTIV_MS: number;
  ALTLAST_MS: number;
};

const MIN = 60_000;
const JETZT = Date.UTC(2026, 9, 16, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
let dir: string;
let zaehler = 0;
let echt: Record<string, unknown> | null = null;

type Welt = { refs?: string[]; worktrees?: string[]; commitSek?: number; branch?: string; gitFehler?: boolean };

function deps(welt: Welt = {}, jetzt = JETZT, sandbox?: string | null): Record<string, unknown> {
  echt ??= M.echteDeps();
  return {
    ...echt,
    lockDir: join(dir, "locks"),
    jetzt: () => jetzt,
    nonce: () => `nonce-${++zaehler}`,
    ...(sandbox === undefined ? {} : { sandbox }),
    mtime: () => Number.NaN,
    git: (args: string[]) => {
      const a = args.join(" ");
      if (welt.gitFehler) throw new Error("git kaputt");
      if (a.startsWith("fetch")) return "";
      if (a.startsWith("rev-parse --abbrev-ref")) return `${welt.branch ?? "main"}\n`;
      if (a.startsWith("for-each-ref")) return (welt.refs ?? []).join("\n");
      if (a.startsWith("worktree list")) return ["worktree /repo", ...(welt.worktrees ?? []).map((w) => `worktree ${w}`)].join("\n");
      if (a.startsWith("log -1")) return String(welt.commitSek ?? 0);
      if (a.includes("reflog")) return "0";
      if (a.includes("status --porcelain")) return "";
      throw new Error(`unerwartet: ${a}`);
    },
  };
}
const lauf = (argv: string[], welt: Welt = {}, jetzt = JETZT, sandbox?: string | null) => M.fuehreAus(argv, deps(welt, jetzt, sandbox));
const lockPfad = (nr: number) => join(dir, "locks", `${nr}.json`);
const liesLock = (nr: number) => JSON.parse(readFileSync(lockPfad(nr), "utf8")) as Lock;
function schreibeLock(nr: number, lock: Lock) {
  mkdirSync(join(dir, "locks"), { recursive: true });
  writeFileSync(lockPfad(nr), `${JSON.stringify(lock)}\n`);
}
/** Eigener Lock: `claim` liefert die Nonce, danach wird der Inhalt um `extra` ergänzt. */
function eigenerLock(nr: number, extra: Lock = {}, jetzt = JETZT): string {
  const r = lauf(["claim", String(nr)], {}, jetzt);
  const nonce = /nonce=(\S+)/.exec(r.out)?.[1] ?? "";
  schreibeLock(nr, { ...liesLock(nr), ...extra });
  return nonce;
}
const WT = "/repo/.claude/worktrees/kq-9";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kq-lebenszeichen-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Lib: lockVerzeichnis, parseLock, lebenszeichenMs, oeffentlicheSicht", () => {
  test("lockVerzeichnis hängt Präfix und `locks` an das gemeinsame git-Verzeichnis (historischer Ordner bei Präfix kq-)", () => {
    assert.equal(L.lockVerzeichnis({ gemeinsam: "/g", praefixWorktree: "kq-" }).replace(/\\/g, "/"), "/g/kq-locks");
    assert.equal(L.lockVerzeichnis({ gemeinsam: "/g", praefixWorktree: "zd-" }).replace(/\\/g, "/"), "/g/zd-locks");
  });

  test("lockDir der echten Deps liegt im gemeinsamen git-Verzeichnis unter <Präfix>locks", () => {
    echt ??= M.echteDeps();
    assert.match(String(echt.lockDir).replace(/\\/g, "/"), /\/\.git\/kq-locks$|\/kq-locks$/);
  });

  test.each([
    ["{kaputt", null],
    ["[]", null],
    ["{}", null],
    ['{"nr":1}', null],
    ['{"nonceHash":5}', null],
    ["null", null],
  ])("parseLock(%s) ist null", (text, erwartet) => {
    assert.equal(L.parseLock(text), erwartet);
  });

  test("parseLock akzeptiert nonceHash und das Altformat nonce", () => {
    assert.deepEqual(L.parseLock('{"nonceHash":"h"}'), { nonceHash: "h" });
    assert.deepEqual(L.parseLock('{"nonce":"n"}'), { nonce: "n" });
  });

  test("lebenszeichenMs: Maximum aller Zeitfelder, Ungültiges entfällt, ohne Werte null", () => {
    const a = iso(JETZT - 5 * MIN);
    assert.equal(L.lebenszeichenMs({ erstellt: iso(JETZT - 60 * MIN), zuletzt: { zeit: a } }), JETZT - 5 * MIN);
    assert.equal(L.lebenszeichenMs({ erstellt: iso(JETZT - 60 * MIN), uebergabe: { gesetzt: iso(JETZT - 50 * MIN), verbraucht: iso(JETZT - 40 * MIN) } }), JETZT - 40 * MIN);
    assert.equal(L.lebenszeichenMs({ erstellt: iso(JETZT - 60 * MIN), gestoppt: { gesetzt: iso(JETZT - 7 * MIN), verbraucht: null } }), JETZT - 7 * MIN);
    assert.equal(L.lebenszeichenMs({ erstellt: "kein Datum", zuletzt: { zeit: 5 }, uebergabe: { gesetzt: null } }), null);
    assert.equal(L.lebenszeichenMs({ erstellt: "kein Datum", zuletzt: { zeit: a } }), JETZT - 5 * MIN);
    assert.equal(L.lebenszeichenMs(null), null);
    assert.equal(L.lebenszeichenMs({}), null);
  });

  test.each([
    ["uebergabe.gesetzt", { uebergabe: { gesetzt: iso(JETZT - 1 * MIN), verbraucht: null } }],
    ["uebergabe.verbraucht", { uebergabe: { gesetzt: iso(JETZT - 9 * MIN), verbraucht: iso(JETZT - 1 * MIN) } }],
    ["gestoppt.gesetzt", { gestoppt: { gesetzt: iso(JETZT - 1 * MIN), verbraucht: null } }],
    ["gestoppt.verbraucht", { gestoppt: { gesetzt: iso(JETZT - 9 * MIN), verbraucht: iso(JETZT - 1 * MIN) } }],
    ["zuletzt.zeit", { zuletzt: { zeit: iso(JETZT - 1 * MIN) } }],
  ])("lebenszeichenMs zählt das Feld %s allein als Maximum", (_name, extra) => {
    assert.equal(L.lebenszeichenMs({ erstellt: iso(JETZT - 60 * MIN), ...extra }), JETZT - 1 * MIN);
  });

  test("herzschlagMs: nur zuletzt.zeit zählt, erstellt nie; ungültig oder fehlend ergibt null", () => {
    const h = (rawLib as unknown as { herzschlagMs: (l: Lock | null) => number | null }).herzschlagMs;
    assert.equal(h({ erstellt: iso(JETZT), zuletzt: { zeit: iso(JETZT - 5 * MIN) } }), JETZT - 5 * MIN);
    assert.equal(h({ erstellt: iso(JETZT) }), null);
    assert.equal(h({ zuletzt: { zeit: "kein Datum" } }), null);
    assert.equal(h(null), null);
  });

  test("oeffentlicheSicht nennt nie nonce oder nonceHash und fasst Übergabe und Stopp zusammen", () => {
    const sicht = L.oeffentlicheSicht({ nr: 5, nonce: "geheim", nonceHash: "auch", erstellt: "x", uebergabe: { gesetzt: "a", verbraucht: null }, gestoppt: { gesetzt: "a", verbraucht: "b" } });
    assert.doesNotMatch(JSON.stringify(sicht), /geheim|"auch"|nonce/);
    assert.equal(sicht.uebergabeStand, "offen");
    assert.equal(sicht.gestopptStand, "verbraucht");
    assert.equal(L.oeffentlicheSicht({ nonceHash: "h" }).uebergabeStand, "keine");
  });

  test("ticket-lock.mjs re-exportiert die Konstanten der Lib unverändert", () => {
    assert.equal(M.VERWAIST_MS, L.VERWAIST_MS);
    assert.equal(M.INAKTIV_MS, L.INAKTIV_MS);
    assert.equal(M.ALTLAST_MS, L.ALTLAST_MS);
    assert.equal(L.VERWAIST_MS, 2 * 60 * MIN);
    assert.equal(L.INAKTIV_MS, 30 * MIN);
  });
});

describe("claim schreibt sandbox", () => {
  test("gesetzt: der Wert steht im Lock; fehlend: null; kein zuletzt beim Anlegen", () => {
    lauf(["claim", "1"], {}, JETZT, "docker");
    assert.equal(liesLock(1).sandbox, "docker");
    assert.equal("zuletzt" in liesLock(1), false);
    lauf(["claim", "2"]);
    assert.equal(liesLock(2).sandbox, null);
    lauf(["claim", "3"], {}, JETZT, null);
    assert.equal(liesLock(3).sandbox, null);
  });

  test("auch beim Ersetzen eines verwaisten Locks", () => {
    lauf(["claim", "4"], {}, JETZT - 3 * 60 * MIN);
    assert.equal(lauf(["claim", "4"], {}, JETZT, "wsl").code, 0);
    assert.equal(liesLock(4).sandbox, "wsl");
  });
});

describe("lebenszeichen <nr> --nonce", () => {
  test("eigene Nonce setzt zuletzt und schritt; Übergabe, Stopp, sandbox und nonceHash bleiben", () => {
    const extra = { uebergabe: { gesetzt: "u", verbraucht: null }, gestoppt: { gesetzt: "g", verbraucht: "v" } };
    const nonce = eigenerLock(5, extra);
    const vorher = liesLock(5);
    const r = lauf(["lebenszeichen", "5", "--nonce", nonce, "--schritt", "2/4"], {}, JETZT + 10 * MIN);
    assert.equal(r.code, 0);
    const nachher = liesLock(5);
    assert.deepEqual(nachher.zuletzt, { zeit: iso(JETZT + 10 * MIN), quelle: "schritt" });
    assert.equal(nachher.schritt, "2/4");
    for (const k of ["nr", "nonceHash", "erstellt", "sandbox", "uebergabe", "gestoppt"]) assert.deepEqual(nachher[k], vorher[k], k);
  });

  test("ohne --schritt bleibt ein früherer schritt stehen, mit --schritt=<x> wird er ersetzt", () => {
    const nonce = eigenerLock(5);
    lauf(["lebenszeichen", "5", "--nonce", nonce, "--schritt", "1/3"]);
    lauf(["lebenszeichen", "5", "--nonce", nonce]);
    assert.equal(liesLock(5).schritt, "1/3");
    lauf(["lebenszeichen", "5", "--nonce", nonce, "--schritt=2/3"]);
    assert.equal(liesLock(5).schritt, "2/3");
  });

  test("fremde Nonce oder fehlender Lock: Exit 4, Datei unverändert bzw. nicht angelegt", () => {
    const nonce = eigenerLock(5);
    const vorher = readFileSync(lockPfad(5), "utf8");
    const r = lauf(["lebenszeichen", "5", "--nonce", `${nonce}x`]);
    assert.equal(r.code, 4);
    assert.match(r.err, /Nicht von Hand/);
    assert.equal(readFileSync(lockPfad(5), "utf8"), vorher);
    assert.equal(lauf(["lebenszeichen", "6", "--nonce", nonce]).code, 4);
    assert.equal(existsSync(lockPfad(6)), false);
  });

  test("ohne Nonce, mit leerer Nonce oder ohne Nummer: Usage (Exit 2)", () => {
    eigenerLock(5);
    assert.equal(lauf(["lebenszeichen", "5"]).code, 2);
    assert.equal(lauf(["lebenszeichen", "5", "--nonce"]).code, 2);
    assert.equal(lauf(["lebenszeichen", "--nonce", "x"]).code, 2);
    assert.equal(lauf(["lebenszeichen", "--commit", "5"]).code, 2);
  });

  test("bereinigeSchritt: Zeilenumbruch und Überlänge werden bereinigt, leer wird null", () => {
    assert.equal(M.bereinigeSchritt("  a\nb\r\nc  "), "a b c");
    assert.equal(M.bereinigeSchritt("x".repeat(200))?.length, 80);
    assert.equal(M.bereinigeSchritt("   "), null);
    assert.equal(M.bereinigeSchritt(undefined), null);
    assert.equal(M.schrittAus(["lebenszeichen", "5", "--schritt", "k"]), "k");
    assert.equal(M.schrittAus(["lebenszeichen", "5"]), null);
  });
});

describe("lebenszeichen --commit (post-commit-Hook)", () => {
  test("Ticket-Branch mit Lock: nur zuletzt (quelle commit) ändert sich", () => {
    eigenerLock(5, { schritt: "1/3", uebergabe: { gesetzt: "u", verbraucht: null } });
    const vorher = liesLock(5);
    const r = lauf(["lebenszeichen", "--commit"], { branch: "feature/kq-5-irgendwas" }, JETZT + 5 * MIN);
    assert.deepEqual(r, { code: 0, out: "", err: "" });
    const nachher = liesLock(5);
    assert.deepEqual(nachher.zuletzt, { zeit: iso(JETZT + 5 * MIN), quelle: "commit" });
    const { zuletzt: _a, ...restNachher } = nachher;
    const { zuletzt: _b, ...restVorher } = vorher;
    assert.deepEqual(restNachher, restVorher);
  });

  test.each([["main"], ["HEAD"], ["feature/ohne-ticket"], ["feature/kq-7-x"]])("Branch %s: stiller No-op (Exit 0), keine Datei", (branch) => {
    eigenerLock(5);
    const vorher = readFileSync(lockPfad(5), "utf8");
    assert.equal(lauf(["lebenszeichen", "--commit"], { branch }).code, 0);
    assert.equal(readFileSync(lockPfad(5), "utf8"), vorher);
    assert.equal(existsSync(lockPfad(7)), false);
  });

  test("unlesbarer Lock bleibt unverändert, ein werfendes git ergibt trotzdem Exit 0", () => {
    mkdirSync(join(dir, "locks"), { recursive: true });
    writeFileSync(lockPfad(5), "{kaputt");
    assert.equal(lauf(["lebenszeichen", "--commit"], { branch: "feature/kq-5-x" }).code, 0);
    assert.equal(readFileSync(lockPfad(5), "utf8"), "{kaputt");
    assert.deepEqual(lauf(["lebenszeichen", "--commit"], { gitFehler: true }), { code: 0, out: "", err: "" });
  });
});

describe("Herzschlag als Aktivität in pruefe und claim", () => {
  test("letzteAktivitaet nimmt lockMs ins Maximum", () => {
    assert.equal(M.letzteAktivitaet({ commitMs: [100], lockMs: 500 }), 500);
    assert.equal(M.letzteAktivitaet({ commitMs: [100], lockMs: null }), 100);
  });

  test("Herzschlag vor 10 min bei alter git-Aktivität: aktiv; vor 31 min: uebernehmbar", () => {
    const alt = (JETZT - 5 * 60 * MIN) / 1000;
    const nonce = eigenerLock(9, {}, JETZT - 4 * 60 * MIN);
    schreibeLock(9, { ...liesLock(9), zuletzt: { zeit: iso(JETZT - 10 * MIN), quelle: "commit" } });
    const welt = { worktrees: [WT], refs: ["feature/kq-9-x"], commitSek: alt };
    const aktiv = lauf(["pruefe", "9", "--nonce", nonce], welt);
    assert.equal(aktiv.code, 4);
    assert.equal(aktiv.out, "aktiv\n");
    schreibeLock(9, { ...liesLock(9), zuletzt: { zeit: iso(JETZT - 31 * MIN), quelle: "commit" } });
    assert.equal(lauf(["pruefe", "9", "--nonce", nonce], welt).out, "uebernehmbar\n");
  });

  test("erstellt zählt nicht als Herzschlag: ein junger Lock ohne zuletzt bei alter Aktivität ist übernehmbar", () => {
    const nonce = eigenerLock(9, {}, JETZT - 5 * MIN);
    assert.equal(lauf(["pruefe", "9", "--nonce", nonce], { worktrees: [WT], refs: ["feature/kq-9-x"], commitSek: (JETZT - 5 * 60 * MIN) / 1000 }).out, "uebernehmbar\n");
  });

  test("claim: Lock ohne Worktree mit erstellt vor 3 h, aber zuletzt vor 10 min gilt noch (Exit 4); zuletzt vor 2 h 1 min wird ersetzt", () => {
    eigenerLock(8, {}, JETZT - 3 * 60 * MIN);
    schreibeLock(8, { ...liesLock(8), zuletzt: { zeit: iso(JETZT - 10 * MIN), quelle: "schritt" } });
    assert.equal(lauf(["claim", "8"]).code, 4);
    schreibeLock(8, { ...liesLock(8), zuletzt: { zeit: iso(JETZT - 121 * MIN), quelle: "schritt" } });
    assert.equal(lauf(["claim", "8"]).code, 0);
  });
});

describe("claim --wiederaufnahme", () => {
  const alt = (JETZT - 5 * 60 * MIN) / 1000;
  const alterLock = (nr: number, zuletzt?: number) => {
    eigenerLock(nr, {}, JETZT - 4 * 60 * MIN);
    if (zuletzt !== undefined) schreibeLock(nr, { ...liesLock(nr), zuletzt: { zeit: iso(zuletzt), quelle: "commit" } });
  };

  test("alter Lock und inaktiver Worktree: Exit 0 mit neuer Nonce, der alte Lock liegt als .verwaist-* daneben", () => {
    alterLock(9);
    const alteNonceHash = liesLock(9).nonceHash;
    const r = lauf(["claim", "9", "--wiederaufnahme"], { worktrees: [WT], refs: ["feature/kq-9-x"], commitSek: alt });
    assert.equal(r.code, 0);
    const nonce = /^nonce=(\S+)\n$/.exec(r.out)?.[1];
    assert.ok(nonce);
    assert.notEqual(liesLock(9).nonceHash, alteNonceHash);
    assert.equal(lauf(["pruefe", "9", "--nonce", nonce ?? ""], { worktrees: [WT], refs: ["feature/kq-9-x"], commitSek: alt }).out, "uebernehmbar\n");
    assert.equal(readdirSync(join(dir, "locks")).filter((f) => f.startsWith("9.json.verwaist-")).length, 1);
  });

  test("ohne Flag bleibt die Belegung Exit 4, mit unbekanntem Zusatz Usage (Exit 2)", () => {
    alterLock(9);
    assert.equal(lauf(["claim", "9"], { worktrees: [WT], refs: ["feature/kq-9-x"], commitSek: alt }).code, 4);
    assert.equal(lauf(["claim", "9", "--anderes"]).code, 2);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme", "x"]).code, 2);
  });

  test("Aktivität unter 30 min: Exit 4, der Lock bleibt", () => {
    alterLock(9);
    const vorher = readFileSync(lockPfad(9), "utf8");
    const r = lauf(["claim", "9", "--wiederaufnahme"], { worktrees: [WT], refs: ["feature/kq-9-x"], commitSek: (JETZT - 10 * MIN) / 1000 });
    assert.equal(r.code, 4);
    assert.match(r.err, /Nicht von Hand/);
    assert.equal(readFileSync(lockPfad(9), "utf8"), vorher);
  });

  test("Herzschlag unter 30 min zählt als Aktivität: Exit 4", () => {
    alterLock(9, JETZT - 10 * MIN);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"], { worktrees: [WT], refs: ["feature/kq-9-x"], commitSek: alt }).code, 4);
  });

  test("Lock jünger als 2 h: Exit 4 auch bei alter Aktivität", () => {
    eigenerLock(9, {}, JETZT - 60 * MIN);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"], { worktrees: [WT], refs: ["feature/kq-9-x"], commitSek: alt }).code, 4);
  });

  test("ohne Lock und mit inaktivem Branch: Exit 0 (neuer Lock)", () => {
    const r = lauf(["claim", "9", "--wiederaufnahme"], { refs: ["feature/kq-9-x"], commitSek: alt });
    assert.equal(r.code, 0);
    assert.equal(liesLock(9).nonceHash !== undefined, true);
  });

  test("ohne Belegung wie ein normaler claim; zwei Bewerber: der zweite scheitert", () => {
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"]).code, 0);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"]).code, 4);
  });

  test("zwei Bewerber um eine belegte Nummer: der zweite sieht den frischen Lock des ersten (Exit 4)", () => {
    alterLock(9);
    const welt = { worktrees: [WT], refs: ["feature/kq-9-x"], commitSek: alt };
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"], welt).code, 0);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"], welt).code, 4);
  });
});
