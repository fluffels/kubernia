/* Lebenszeichen im Ticket-Lock (#1699): Lib `ticket-lock-lib.mjs`, `sandbox` bei `claim`, `lebenszeichen`, `lebenszeichen --commit`,
 * Herzschlag als Aktivität und `claim --wiederaufnahme`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Echte Lock-Datei in einem Temp-Ordner, git und Uhr sind injiziert.
 */
import { afterEach, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLock from "../../scripts/ticket-lock.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/ticket-lock-lib.mjs";
import { FREMD, FREMD_CONFIG_PFAD } from "../support/fremd-config";

const WTP = FREMD.praefixe.worktree;
const BRP = FREMD.praefixe.branch;

type Erg = { code: number; out: string; err: string };
type Lock = Record<string, unknown>;
const M = rawLock as unknown as {
  fuehreAus: (argv: string[], deps: Record<string, unknown>) => Erg;
  echteDeps: (o?: { config?: unknown }) => Record<string, unknown>;
  letzteAktivitaet: (o: { commitMs?: number[]; lockMs?: number | null }) => number | null;
  bereinigeSchritt: (t: unknown) => string | null;
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
  echt ??= M.echteDeps({ config: FREMD });
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
      if (a.startsWith("worktree list")) return ["worktree /repo", ...(welt.worktrees ?? []).map((w) => `worktree ${w}`)].join("\n\n");
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
const WT = `/repo/.claude/worktrees/${WTP}9`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lebenszeichen-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Lib: lockVerzeichnis, parseLock, lebenszeichenMs, oeffentlicheSicht", () => {
  test("lockVerzeichnis hängt Präfix und `locks` an das gemeinsame git-Verzeichnis (ein fremdes Präfix ergibt einen anderen Ordner)", () => {
    assert.equal(L.lockVerzeichnis({ gemeinsam: "/g", praefixWorktree: WTP }).replace(/\\/g, "/"), `/g/${WTP}locks`);
    assert.equal(L.lockVerzeichnis({ gemeinsam: "/g", praefixWorktree: "zd-" }).replace(/\\/g, "/"), "/g/zd-locks");
  });

  test("lockDir der echten Deps liegt im gemeinsamen git-Verzeichnis unter <praefixe.worktree>locks", () => {
    echt ??= M.echteDeps({ config: FREMD });
    assert.ok(String(echt.lockDir).replace(/\\/g, "/").endsWith(`/${WTP}locks`));
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

describe("claim schreibt sandbox", { timeout: 30_000 }, () => {
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

describe("lebenszeichen <nr> --nonce", { timeout: 30_000 }, () => {
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
  });
});

describe("lebenszeichen --commit (post-commit-Hook)", { timeout: 30_000 }, () => {
  test("Ticket-Branch mit Lock: nur zuletzt (quelle commit) ändert sich", () => {
    eigenerLock(5, { schritt: "1/3", uebergabe: { gesetzt: "u", verbraucht: null } });
    const vorher = liesLock(5);
    const r = lauf(["lebenszeichen", "--commit"], { branch: `${BRP}5-irgendwas` }, JETZT + 5 * MIN);
    assert.deepEqual(r, { code: 0, out: "", err: "" });
    const nachher = liesLock(5);
    assert.deepEqual(nachher.zuletzt, { zeit: iso(JETZT + 5 * MIN), quelle: "commit" });
    const { zuletzt: _a, ...restNachher } = nachher;
    const { zuletzt: _b, ...restVorher } = vorher;
    assert.deepEqual(restNachher, restVorher);
  });

  test.each([["main"], ["HEAD"], ["feature/ohne-ticket"], [`${BRP}7-x`]])("Branch %s: stiller No-op (Exit 0), keine Datei", (branch) => {
    eigenerLock(5);
    const vorher = readFileSync(lockPfad(5), "utf8");
    assert.equal(lauf(["lebenszeichen", "--commit"], { branch }).code, 0);
    assert.equal(readFileSync(lockPfad(5), "utf8"), vorher);
    assert.equal(existsSync(lockPfad(7)), false);
  });

  test("unlesbarer Lock bleibt unverändert, ein werfendes git ergibt trotzdem Exit 0", () => {
    mkdirSync(join(dir, "locks"), { recursive: true });
    writeFileSync(lockPfad(5), "{kaputt");
    assert.equal(lauf(["lebenszeichen", "--commit"], { branch: `${BRP}5-x` }).code, 0);
    assert.equal(readFileSync(lockPfad(5), "utf8"), "{kaputt");
    assert.deepEqual(lauf(["lebenszeichen", "--commit"], { gitFehler: true }), { code: 0, out: "", err: "" });
  });
});

describe("Herzschlag als Aktivität in pruefe und claim", { timeout: 30_000 }, () => {
  test("letzteAktivitaet nimmt lockMs ins Maximum", () => {
    assert.equal(M.letzteAktivitaet({ commitMs: [100], lockMs: 500 }), 500);
    assert.equal(M.letzteAktivitaet({ commitMs: [100], lockMs: null }), 100);
  });

  test("Herzschlag vor 10 min bei alter git-Aktivität: aktiv; vor 31 min: uebernehmbar", () => {
    const alt = (JETZT - 5 * 60 * MIN) / 1000;
    const nonce = eigenerLock(9, {}, JETZT - 4 * 60 * MIN);
    schreibeLock(9, { ...liesLock(9), zuletzt: { zeit: iso(JETZT - 10 * MIN), quelle: "commit" } });
    const welt = { worktrees: [WT], refs: [`${BRP}9-x`], commitSek: alt };
    const aktiv = lauf(["pruefe", "9", "--nonce", nonce], welt);
    assert.equal(aktiv.code, 4);
    assert.equal(aktiv.out, "aktiv\n");
    schreibeLock(9, { ...liesLock(9), zuletzt: { zeit: iso(JETZT - 31 * MIN), quelle: "commit" } });
    assert.equal(lauf(["pruefe", "9", "--nonce", nonce], welt).out, "uebernehmbar\n");
  });

  test("erstellt zählt nicht als Herzschlag: ein junger Lock ohne zuletzt bei alter Aktivität ist übernehmbar", () => {
    const nonce = eigenerLock(9, {}, JETZT - 5 * MIN);
    assert.equal(lauf(["pruefe", "9", "--nonce", nonce], { worktrees: [WT], refs: [`${BRP}9-x`], commitSek: (JETZT - 5 * 60 * MIN) / 1000 }).out, "uebernehmbar\n");
  });

  test("claim: Lock ohne Worktree mit erstellt vor 3 h, aber zuletzt vor 10 min gilt noch (Exit 4); zuletzt vor 2 h 1 min wird ersetzt", () => {
    eigenerLock(8, {}, JETZT - 3 * 60 * MIN);
    schreibeLock(8, { ...liesLock(8), zuletzt: { zeit: iso(JETZT - 10 * MIN), quelle: "schritt" } });
    assert.equal(lauf(["claim", "8"]).code, 4);
    schreibeLock(8, { ...liesLock(8), zuletzt: { zeit: iso(JETZT - 121 * MIN), quelle: "schritt" } });
    assert.equal(lauf(["claim", "8"]).code, 0);
  });
});

describe("claim --wiederaufnahme", { timeout: 30_000 }, () => {
  const alt = (JETZT - 5 * 60 * MIN) / 1000;
  const alterLock = (nr: number, zuletzt?: number) => {
    eigenerLock(nr, {}, JETZT - 4 * 60 * MIN);
    if (zuletzt !== undefined) schreibeLock(nr, { ...liesLock(nr), zuletzt: { zeit: iso(zuletzt), quelle: "commit" } });
  };

  test("alter Lock und inaktiver Worktree: Exit 0 mit neuer Nonce, der alte Lock liegt als .verwaist-* daneben", () => {
    alterLock(9);
    const alteNonceHash = liesLock(9).nonceHash;
    const r = lauf(["claim", "9", "--wiederaufnahme"], { worktrees: [WT], refs: [`${BRP}9-x`], commitSek: alt });
    assert.equal(r.code, 0);
    const nonce = /^nonce=(\S+)\n$/.exec(r.out)?.[1];
    assert.ok(nonce);
    assert.notEqual(liesLock(9).nonceHash, alteNonceHash);
    assert.equal(lauf(["pruefe", "9", "--nonce", nonce ?? ""], { worktrees: [WT], refs: [`${BRP}9-x`], commitSek: alt }).out, "uebernehmbar\n");
    assert.equal(readdirSync(join(dir, "locks")).filter((f) => f.startsWith("9.json.verwaist-")).length, 1);
  });

  test("ohne Flag bleibt die Belegung Exit 4, mit unbekanntem Zusatz Usage (Exit 2)", () => {
    alterLock(9);
    assert.equal(lauf(["claim", "9"], { worktrees: [WT], refs: [`${BRP}9-x`], commitSek: alt }).code, 4);
    assert.equal(lauf(["claim", "9", "--anderes"]).code, 2);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme", "x"]).code, 2);
  });

  test("Aktivität unter 30 min: Exit 4, der Lock bleibt", () => {
    alterLock(9);
    const vorher = readFileSync(lockPfad(9), "utf8");
    const r = lauf(["claim", "9", "--wiederaufnahme"], { worktrees: [WT], refs: [`${BRP}9-x`], commitSek: (JETZT - 10 * MIN) / 1000 });
    assert.equal(r.code, 4);
    assert.match(r.err, /Nicht von Hand/);
    assert.equal(readFileSync(lockPfad(9), "utf8"), vorher);
  });

  test("Herzschlag unter 30 min zählt als Aktivität: Exit 4", () => {
    alterLock(9, JETZT - 10 * MIN);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"], { worktrees: [WT], refs: [`${BRP}9-x`], commitSek: alt }).code, 4);
  });

  test("Lock jünger als 2 h: Exit 4 auch bei alter Aktivität", () => {
    eigenerLock(9, {}, JETZT - 60 * MIN);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"], { worktrees: [WT], refs: [`${BRP}9-x`], commitSek: alt }).code, 4);
  });

  test("ohne Lock und mit inaktivem Branch: Exit 0 (neuer Lock)", () => {
    const r = lauf(["claim", "9", "--wiederaufnahme"], { refs: [`${BRP}9-x`], commitSek: alt });
    assert.equal(r.code, 0);
    assert.equal(liesLock(9).nonceHash !== undefined, true);
  });

  test("ohne Belegung wie ein normaler claim; zwei Bewerber: der zweite scheitert", () => {
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"]).code, 0);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"]).code, 4);
  });

  test("zwei Bewerber um eine belegte Nummer: der zweite sieht den frischen Lock des ersten (Exit 4)", () => {
    alterLock(9);
    const welt = { worktrees: [WT], refs: [`${BRP}9-x`], commitSek: alt };
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"], welt).code, 0);
    assert.equal(lauf(["claim", "9", "--wiederaufnahme"], welt).code, 4);
  });
});

// ---------- Ende-zu-Ende und echte Deps (#1762 L24) ----------

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Statisch importierte `./`-Skripte eines Einstiegs, transitiv (Dateinamen relativ zu `scripts/`). */
function skriptHuelle(einstieg: string, gesehen = new Set<string>()): string[] {
  if (gesehen.has(einstieg)) return [...gesehen];
  gesehen.add(einstieg);
  const text = readFileSync(join(WURZEL, "scripts", einstieg), "utf8");
  for (const m of text.matchAll(/from "\.\/([^"]+\.mjs)"/g)) skriptHuelle(m[1], gesehen);
  return [...gesehen];
}

/** Pfad vergleichbar machen: Backslashes zu /, Kleinschreibung (Windows). */
const klein = (p: string) => p.split(String.fromCharCode(92)).join("/").toLowerCase();
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
const node = (cwd: string, args: string[], env: Record<string, string | undefined> = {}) =>
  execFileSync(process.execPath, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, AGENT_SANDBOX: undefined, ...env } });

/** Temp-Repo mit Kopie der Skripte, der Projekt-Config und des post-commit-Hooks; `core.hooksPath` zeigt auf `.githooks`. */
function tempRepo(einstiege: string[]): string {
  const repo = realpathSync(mkdtempSync(join(dir, "repo-")));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.hooksPath", ".githooks");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, ".factory"), { recursive: true });
  mkdirSync(join(repo, ".githooks"), { recursive: true });
  const dateien = new Set(einstiege.flatMap((e) => skriptHuelle(e)));
  for (const f of dateien) {
    mkdirSync(dirname(join(repo, "scripts", f)), { recursive: true });
    copyFileSync(join(WURZEL, "scripts", f), join(repo, "scripts", f));
  }
  copyFileSync(join(WURZEL, FREMD_CONFIG_PFAD), join(repo, ".factory/projekt.json")); // die Fremd-Config: das Kind liest sie wie die Projekt-Config
  copyFileSync(join(WURZEL, ".githooks/post-commit"), join(repo, ".githooks/post-commit"));
  return repo;
}

describe("post-commit-Hook Ende zu Ende (#1762)", { timeout: 30_000 }, () => {
  test("ein Commit im Ticket-Worktree setzt zuletzt.quelle commit im Lock", () => {
    const repo = tempRepo(["ticket-lock.mjs"]);
    git(repo, "add", "-A");
    git(repo, "update-index", "--chmod=+x", ".githooks/post-commit");
    git(repo, "commit", "-q", "-m", "init");
    const claim = node(repo, ["scripts/ticket-lock.mjs", "claim", "5"]);
    assert.match(claim, /nonce=/);
    git(repo, "worktree", "add", "-q", `.claude/worktrees/${WTP}5`, "-b", `${BRP}5-x`);
    const wt = join(repo, ".claude", "worktrees", `${WTP}5`);
    const lockDatei = join(repo, ".git", `${WTP}locks`, "5.json");
    assert.equal((JSON.parse(readFileSync(lockDatei, "utf8")) as Lock).zuletzt, undefined);
    git(wt, "commit", "-q", "--allow-empty", "-m", "arbeit");
    const lock = JSON.parse(readFileSync(lockDatei, "utf8")) as { zuletzt?: { quelle?: string; zeit?: string } };
    assert.equal(lock.zuletzt?.quelle, "commit");
    assert.ok(Number.isFinite(Date.parse(lock.zuletzt?.zeit ?? "")));
  });

  test("Kontrolle: ohne Hook-Verdrahtung bleibt zuletzt leer (der Test sieht den Hook wirklich)", () => {
    const repo = tempRepo(["ticket-lock.mjs"]);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init", "--no-verify");
    node(repo, ["scripts/ticket-lock.mjs", "claim", "5"]);
    git(repo, "worktree", "add", "-q", `.claude/worktrees/${WTP}5`, "-b", `${BRP}5-x`);
    git(repo, "config", "core.hooksPath", "kein-ordner");
    git(join(repo, ".claude", "worktrees", `${WTP}5`), "commit", "-q", "--allow-empty", "-m", "arbeit");
    const lock = JSON.parse(readFileSync(join(repo, ".git", `${WTP}locks`, "5.json"), "utf8")) as Lock;
    assert.equal(lock.zuletzt, undefined);
  });
});

describe("echteDeps: Smoke im Temp-Repo (#1762)", { timeout: 30_000 }, () => {
  const lade = (repo: string, datei: string, env: Record<string, string | undefined> = {}) =>
    JSON.parse(
      node(
        repo,
        ["--input-type=module", "-e", `const m = await import("./scripts/${datei}"); const d = m.echteDeps(); console.log(JSON.stringify({ keys: Object.keys(d).sort(), lockDir: d.lockDir, sandbox: d.sandbox ?? null, label: d.festgefahrenLabel ?? null, top: d.git(["rev-parse", "--show-toplevel"]).trim() }));`],
        env,
      ),
    ) as { keys: string[]; lockDir: string; sandbox: string | null; label: string | null; top: string };

  test("ticket-lock: Schlüssel vorhanden, git läuft im Temp-Repo, lockDir unter dessen .git", () => {
    const repo = tempRepo(["ticket-lock.mjs"]);
    git(repo, "commit", "-q", "--allow-empty", "-m", "init", "--no-verify");
    const r = lade(repo, "ticket-lock.mjs");
    for (const k of ["git", "jetzt", "nonce", "lockDir", "sandbox", "liesDatei", "schreibeNeu", "ersetze", "benenneUm", "loesche", "legeVerzeichnisAn", "liste", "mtime"]) assert.ok(r.keys.includes(k), k);
    assert.equal(klein(r.top), klein(repo));
    assert.equal(klein(r.lockDir), `${klein(repo)}/.git/${WTP}locks`);
  });

  test("ticket-lock: sandbox folgt der Umgebungsvariable AGENT_SANDBOX", () => {
    const repo = tempRepo(["ticket-lock.mjs"]);
    assert.equal(lade(repo, "ticket-lock.mjs", { AGENT_SANDBOX: "docker" }).sandbox, "docker");
    assert.equal(lade(repo, "ticket-lock.mjs").sandbox, null);
  });

  test("claims-pruefen: Schlüssel vorhanden, Label aus der Projekt-Config, git im Temp-Repo", () => {
    const repo = tempRepo(["claims-pruefen.mjs"]);
    const cfg = JSON.parse(readFileSync(join(repo, ".factory/projekt.json"), "utf8")) as { labels: { festgefahren: string } };
    const r = lade(repo, "claims-pruefen.mjs");
    for (const k of ["jetzt", "git", "graphql", "zugewiesen", "festgefahrenLabel", "lockDir", "liste", "liesDatei", "loesche", "existiert"]) assert.ok(r.keys.includes(k), k);
    assert.equal(r.label, cfg.labels.festgefahren);
    assert.equal(klein(r.top), klein(repo));
  });
});
