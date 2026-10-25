/* Ticket-Lock (#1561 Z4) – zwei Sessions unter demselben Account dürfen dasselbe Ticket nicht gleichzeitig bearbeiten.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Echte Lock-Datei in einem Temp-Ordner (atomares `wx`), git und Uhr sind injiziert.
 */
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Durchleitende Spione auf node:fs (Aufrufreihenfolge von ersetze belegen); alle anderen Tests laufen unverändert gegen das echte fs.
vi.mock("node:fs", async (original) => {
  const echt = await original<typeof import("node:fs")>();
  return { ...echt, writeFileSync: vi.fn(echt.writeFileSync), renameSync: vi.fn(echt.renameSync), unlinkSync: vi.fn(echt.unlinkSync) };
});
import * as fsSpion from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/ticket-lock.mjs";
import { FREMD } from "../support/fremd-config";

type Erg = { code: number; out: string; err: string };
type Deps = Record<string, unknown>;
const M = raw as unknown as {
  VERWAIST_MS: number;
  INAKTIV_MS: number;
  entscheideClaim: (o: { erstellt: number; jetzt: number }) => string;
  entscheidePruefung: (o: { lock: { nonce: string } | null; nonce: string | null; vorhanden: boolean; aktivitaet: number | null; jetzt: number }) => string;
  letzteAktivitaet: (o: { commitMs?: number[]; reflogMs?: number[]; dateiMs?: number[]; nodeModulesMs?: number | null }) => number | null;
  aufrufLesen: (argv: string[]) => { commit?: boolean; befehl?: string; nr?: number; nonce?: string | null; wiederaufnahme?: boolean; schritt?: string | null; fehler?: string };
  fuehreAus: (argv: string[], deps: Deps) => Erg;
  echteDeps: (o?: { config?: unknown }) => Deps;
  ALTLAST_MS: number;
  gehoertZu: (lock: Record<string, unknown> | null, nonce: string) => boolean;
  aufzuraeumen: (o: { eintraege: { name: string; mtime: number }[]; jetzt: number }) => string[];
};

const WTP = FREMD.praefixe.worktree;
const BRP = FREMD.praefixe.branch;
const MIN = 60_000;
const JETZT = Date.UTC(2026, 9, 9, 12, 0, 0);
let dir: string;
let zaehler = 0;
let fetchAufrufe: string[] = [];

type Welt = { refs?: string[]; worktrees?: string[]; commitSek?: number; reflogSek?: number; status?: string[]; fetchFehler?: boolean };

/** `echteDeps()` startet `git rev-parse`; einmal je Datei genügt (die Deps sind zustandslos). */
let echteDepsCache: ReturnType<typeof M.echteDeps> | null = null;
const echteDepsEinmal = (): ReturnType<typeof M.echteDeps> => (echteDepsCache ??= M.echteDeps({ config: FREMD }));

/** Deps mit echtem Dateisystem im Temp-Ordner und einem gefälschten git. */
function deps(welt: Welt = {}, jetzt = JETZT, datei: Record<string, number> = {}): Deps {
  const echt = echteDepsEinmal();
  return {
    ...echt,
    lockDir: join(dir, `${WTP}locks`),
    jetzt: () => jetzt,
    nonce: () => `nonce-${++zaehler}`,
    mtime: (p: string) => datei[p] ?? Number.NaN,
    git: (args: string[]) => {
      const a = args.join(" ");
      if (a.startsWith("fetch")) {
        fetchAufrufe.push(a);
        if (welt.fetchFehler) throw new Error("kein Netz");
        return "";
      }
      if (a.startsWith("for-each-ref")) return (welt.refs ?? []).join("\n");
      if (a.startsWith("worktree list")) return ["worktree /repo", ...(welt.worktrees ?? []).map((w) => `worktree ${w}`)].join("\n\n"); // wie git: Blöcke durch Leerzeile
      if (a.startsWith("log -1")) return String(welt.commitSek ?? 0);
      if (a.includes("reflog")) return String(welt.reflogSek ?? 0);
      if (a.includes("status --porcelain")) return (welt.status ?? []).join("\n");
      throw new Error(`unerwartet: ${a}`);
    },
  };
}
const lauf = (argv: string[], welt: Welt = {}, jetzt = JETZT, datei: Record<string, number> = {}) => M.fuehreAus(argv, deps(welt, jetzt, datei));
const lockInhalt = (text: string) => JSON.parse(text) as { nonceHash: string; nr: number };
const sha = (n: string) => createHash("sha256").update(n).digest("hex");
const NICHT_VON_HAND = /nie von Hand|Nicht von Hand/;
const nonceVon = (r: Erg) => /nonce=(\S+)/.exec(r.out)?.[1] ?? "";

beforeEach(() => {
  fetchAufrufe = [];
  dir = mkdtempSync(join(tmpdir(), "lock-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("claim", () => {
  test("der erste gewinnt (Exit 0 + nonce), der zweite sieht den frischen fremden Lock (Exit 4)", () => {
    const a = lauf(["claim", "1561"]);
    assert.equal(a.code, 0);
    assert.match(a.out, /^nonce=nonce-\d+\n$/);
    const lockText = readFileSync(join(dir, `${WTP}locks`, "1561.json"), "utf8");
    assert.equal(lockInhalt(lockText).nonceHash, sha(nonceVon(a)));
    assert.doesNotMatch(lockText, new RegExp(nonceVon(a)), "die Nonce selbst steht nicht in der Datei");
    assert.equal(lockInhalt(lockText).nr, 1561);
    const b = lauf(["claim", "1561"]);
    assert.equal(b.code, 4);
    assert.match(b.err, /anderen Session/);
    assert.equal(lockInhalt(readFileSync(join(dir, `${WTP}locks`, "1561.json"), "utf8")).nonceHash, sha(nonceVon(a)), "der Lock des Gewinners bleibt");
  });

  test("claim holt mit --prune: ein gelöschter Remote-Branch darf das Ticket nicht sperren", () => {
    lauf(["claim", "3"]);
    assert.deepEqual(fetchAufrufe, ["fetch -q --prune origin"]);
  });

  test("ein anderes Ticket ist unabhängig", () => {
    assert.equal(lauf(["claim", "1561"]).code, 0);
    assert.equal(lauf(["claim", "1562"]).code, 0);
  });

  test("ein verwaister Lock (älter als 2 h) wird ersetzt, der alte bleibt als .verwaist-<Hash> liegen", () => {
    const a = lauf(["claim", "7"], {}, JETZT - 2 * 60 * MIN - 1);
    assert.equal(a.code, 0);
    const b = lauf(["claim", "7"]);
    assert.equal(b.code, 0);
    assert.notEqual(nonceVon(b), nonceVon(a));
    assert.equal(lockInhalt(readFileSync(join(dir, `${WTP}locks`, "7.json"), "utf8")).nonceHash, sha(nonceVon(b)));
    assert.ok(readdirSync(join(dir, `${WTP}locks`)).some((f) => f === `7.json.verwaist-${sha(nonceVon(b)).slice(0, 16)}`));
    assert.ok(readdirSync(join(dir, `${WTP}locks`)).every((f) => !f.includes(nonceVon(b))), "kein Dateiname verrät die Nonce");
  });

  test("ein Lock knapp unter 2 h gilt noch", () => {
    lauf(["claim", "7"], {}, JETZT - 2 * 60 * MIN + 1000);
    assert.equal(lauf(["claim", "7"]).code, 4);
  });

  test("ein kaputter Lock (kein JSON) zählt als verwaist", () => {
    lauf(["claim", "7"]);
    writeFileSync(join(dir, `${WTP}locks`, "7.json"), "{kaputt");
    assert.equal(lauf(["claim", "7"]).code, 0);
  });

  test(`belegt: Worktree ${WTP}<nr> oder lokaler/remote Branch ${BRP}<nr>-* → Exit 4, kein Lock`, () => {
    for (const welt of [
      { worktrees: [`/repo/.claude/worktrees/${WTP}9`] },
      { refs: [`${BRP}9-irgendwas`] },
      { refs: [`origin/${BRP}9-irgendwas`] },
    ]) {
      const r = lauf(["claim", "9"], welt);
      assert.equal(r.code, 4, JSON.stringify(welt));
      assert.match(r.err, /Worktree oder Branch/);
      assert.equal(existsSync(join(dir, `${WTP}locks`, "9.json")), false);
    }
  });

  test(`ein Branch mit ähnlicher Nummer (${WTP}91, ${WTP}19) belegt #9 nicht`, () => {
    assert.equal(lauf(["claim", "9"], { refs: [`${BRP}91-x`, `origin/${BRP}19-y`], worktrees: [`C:/x/.claude/worktrees/${WTP}90`] }).code, 0);
  });

  test("ohne Netz (fetch scheitert) zählen die lokalen Refs: weiter fail-open", () => {
    assert.equal(lauf(["claim", "9"], { fetchFehler: true }).code, 0);
    assert.equal(lauf(["claim", "10"], { fetchFehler: true, refs: [`${BRP}10-x`] }).code, 4);
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
    const wt = `/repo/.claude/worktrees/${WTP}5`;
    const welt = (minuten: number): Welt => ({ worktrees: [wt], refs: [`${BRP}5-x`], commitSek: (JETZT - minuten * MIN) / 1000, reflogSek: (JETZT - minuten * MIN) / 1000 });
    const aktiv = lauf(["pruefe", "5"], welt(29));
    assert.equal(aktiv.code, 4);
    assert.equal(aktiv.out, "aktiv\n");
    assert.match(aktiv.err, /Aktivität in den letzten 30 min/);
    assert.deepEqual(lauf(["pruefe", "5"], welt(31)), { code: 0, out: "uebernehmbar\n", err: "" });
  });

  test("jede Quelle zählt: Commit, Reflog, geänderte Datei, node_modules", () => {
    const wt = `/repo/.claude/worktrees/${WTP}5`;
    const alt = (JETZT - 120 * MIN) / 1000;
    const basis: Welt = { worktrees: [wt], refs: [`${BRP}5-x`], commitSek: alt, reflogSek: alt, status: [" M scripts/a.mjs", "?? neu.txt"] };
    assert.equal(lauf(["pruefe", "5"], basis).out, "uebernehmbar\n", "Kontrolle: alles alt");
    assert.equal(lauf(["pruefe", "5"], { ...basis, commitSek: (JETZT - 5 * MIN) / 1000 }).out, "aktiv\n", "Commit");
    assert.equal(lauf(["pruefe", "5"], { ...basis, reflogSek: (JETZT - 5 * MIN) / 1000 }).out, "aktiv\n", "Reflog");
    assert.equal(lauf(["pruefe", "5"], basis, JETZT, { [join(wt, "neu.txt")]: JETZT - 5 * MIN }).out, "aktiv\n", "geänderte Datei");
    assert.equal(lauf(["pruefe", "5"], basis, JETZT, { [join(wt, "node_modules")]: JETZT - 5 * MIN }).out, "aktiv\n", "node_modules");
  });

  test("Remote-Branch ohne Worktree zählt als vorhanden; keine feststellbare Aktivität ist fail-closed aktiv", () => {
    assert.equal(lauf(["pruefe", "5"], { refs: [`origin/${BRP}5-x`], commitSek: (JETZT - 5 * MIN) / 1000 }).out, "aktiv\n");
    assert.equal(lauf(["pruefe", "5"], { refs: [`origin/${BRP}5-x`], commitSek: (JETZT - 300 * MIN) / 1000 }).out, "uebernehmbar\n");
    assert.equal(M.entscheidePruefung({ lock: null, nonce: null, vorhanden: true, aktivitaet: null, jetzt: JETZT }), "aktiv");
  });

  test("mit eigener Nonce und einem Worktree mit frischer Aktivität bleibt es aktiv (Doppel-Spawn)", () => {
    const a = lauf(["claim", "5"]);
    const welt: Welt = { worktrees: [`/repo/.claude/worktrees/${WTP}5`], reflogSek: (JETZT - 5 * MIN) / 1000 };
    assert.equal(lauf(["pruefe", "5", "--nonce", nonceVon(a)], welt).code, 4);
  });
});

describe("freigeben", () => {
  test("löscht nur den eigenen Lock; mit fremder Nonce bleibt er, Exit 4", () => {
    const a = lauf(["claim", "5"]);
    const f = lauf(["freigeben", "5", "--nonce", "fremd"]);
    assert.equal(f.code, 4);
    assert.ok(existsSync(join(dir, `${WTP}locks`, "5.json")));
    assert.equal(lauf(["freigeben", "5", "--nonce", nonceVon(a)]).code, 0);
    assert.equal(existsSync(join(dir, `${WTP}locks`, "5.json")), false);
    assert.equal(lauf(["claim", "5"]).code, 0, "danach ist das Ticket wieder claimbar");
  });

  test("ohne Lock ist freigeben ein No-op (Exit 0), ohne Nonce falscher Aufruf", () => {
    assert.equal(lauf(["freigeben", "5", "--nonce", "x"]).code, 0);
    assert.equal(lauf(["freigeben", "5"]).code, 2);
  });
});

describe("Z4/Z5: Lock nie von Hand, pruefe ohne Nonce", () => {
  test("pruefe ohne Nonce: frischer Lock → fremd (Exit 4), genau VERWAIST_MS alt → frei", () => {
    lauf(["claim", "5"]);
    const r = lauf(["pruefe", "5"]);
    assert.equal(r.code, 4);
    assert.equal(r.out, "fremd\n");
    assert.match(r.err, /noch keine 2 h/);
    assert.match(lauf(["claim", "5"]).err, new RegExp(new Date(JETZT + M.VERWAIST_MS).toISOString()), "claim nennt den Zeitpunkt, ab dem der Lock verwaist ist");
    assert.equal(lauf(["pruefe", "5"], {}, JETZT + M.VERWAIST_MS).out, "frei\n");
    assert.equal(lauf(["pruefe", "5"], {}, JETZT + M.VERWAIST_MS - 1).code, 4);
  });

  test("entscheidePruefung ohne Nonce: jung → fremd, genau 2 h → frei, unlesbares erstellt → frei, alter Lock + Worktree → Aktivität", () => {
    const o = { nonce: null, vorhanden: false, aktivitaet: null, jetzt: JETZT };
    const lock = (erstellt: string) => ({ nonce: "a", erstellt });
    assert.equal(M.entscheidePruefung({ ...o, lock: lock(new Date(JETZT - M.VERWAIST_MS + 1).toISOString()) }), "fremd");
    assert.equal(M.entscheidePruefung({ ...o, lock: lock(new Date(JETZT - M.VERWAIST_MS).toISOString()) }), "frei");
    assert.equal(M.entscheidePruefung({ ...o, lock: lock("kaputt") }), "frei");
    const alt = lock(new Date(JETZT - 3 * 60 * MIN).toISOString());
    assert.equal(M.entscheidePruefung({ ...o, lock: alt, vorhanden: true, aktivitaet: JETZT - 5 * MIN }), "aktiv");
  });

  test("die Hash-Datei lässt sich nicht mit dem Hash als Nonce freigeben oder prüfen", () => {
    lauf(["claim", "5"]);
    const hash = lockInhalt(readFileSync(join(dir, `${WTP}locks`, "5.json"), "utf8")).nonceHash;
    const f = lauf(["freigeben", "5", "--nonce", hash]);
    assert.equal(f.code, 4);
    assert.ok(existsSync(join(dir, `${WTP}locks`, "5.json")), "Lock bleibt");
    assert.equal(lauf(["pruefe", "5", "--nonce", hash]).out, "fremd\n");
  });

  test("Altformat mit Klartext-Nonce bleibt gültig (freigeben, pruefe)", () => {
    mkdirSync(join(dir, `${WTP}locks`), { recursive: true });
    writeFileSync(join(dir, `${WTP}locks`, "5.json"), JSON.stringify({ nr: 5, nonce: "alt", erstellt: new Date(JETZT).toISOString() }));
    assert.equal(lauf(["pruefe", "5", "--nonce", "alt"]).out, "frei\n");
    assert.equal(lauf(["freigeben", "5", "--nonce", "alt"]).code, 0);
    assert.equal(existsSync(join(dir, `${WTP}locks`, "5.json")), false);
  });

  test("jede Exit-4-Ausgabe nennt, dass man den Lock nie von Hand löst", () => {
    const a = lauf(["claim", "5"]);
    const fehler = Object.assign(new Error("x"), { code: "ENOENT" });
    const meldungen = [
      lauf(["claim", "5"]).err,
      lauf(["claim", "9"], { refs: [`${BRP}9-x`] }).err,
      lauf(["pruefe", "5", "--nonce", "falsch"]).err,
      lauf(["pruefe", "5"]).err,
      lauf(["pruefe", "6"], { worktrees: [`/repo/.claude/worktrees/${WTP}6`], reflogSek: JETZT / 1000 }).err,
      lauf(["freigeben", "5", "--nonce", "falsch"]).err,
      M.fuehreAus(["claim", "5"], { ...deps({}, JETZT + M.VERWAIST_MS + 1), benenneUm: () => { throw fehler; } }).err,
      M.fuehreAus(["claim", "5"], { ...deps({}, JETZT + M.VERWAIST_MS + 1), schreibeNeu: () => { throw Object.assign(new Error("x"), { code: "EEXIST" }); } }).err,
    ];
    for (const m of meldungen) assert.match(m, NICHT_VON_HAND, m);
    assert.equal(a.code, 0);
  });
});

describe("Aufruf und reine Funktionen", () => {
  test("gehoertZu: eine leere Nonce gehört nie zu einem Lock (Hash- und Altformat)", () => {
    assert.equal(M.gehoertZu({ nonceHash: sha("") }, ""), false, "Lock mit Hash der leeren Nonce");
    assert.equal(M.gehoertZu({ nonce: "" }, ""), false, "Alt-Lock mit Klartext-Nonce leer");
    assert.equal(M.gehoertZu({ nonceHash: sha("x") }, "x"), true, "Gegenprobe: echte Nonce passt");
  });

  test("ungültige Nummer, unbekannter Befehl, fehlende Argumente → Exit 2", () => {
    for (const argv of [[], ["claim"], ["claim", "abc"], ["claim", "-1"], ["claim", "1.5"], ["foo", "5"], ["pruefe", "5", "--nonce"], ["claim", "5", "extra"]]) {
      assert.equal(lauf(argv).code, 2, JSON.stringify(argv));
    }
    assert.equal(existsSync(join(dir, `${WTP}locks`)), false, "kein Lock bei falschem Aufruf");
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

  test("aufrufLesen: Befehl, Nummer, Nonce in beiden Schreibweisen, Flags je Befehl", () => {
    assert.deepEqual(M.aufrufLesen(["pruefe", "5"]), { befehl: "pruefe", nr: 5, nonce: null, wiederaufnahme: false, schritt: null });
    assert.equal(M.aufrufLesen(["pruefe", "5", "--nonce", "abc"]).nonce, "abc");
    assert.equal(M.aufrufLesen(["pruefe", "5", "--nonce=abc"]).nonce, "abc");
    assert.equal(M.aufrufLesen(["claim", "5", "--wiederaufnahme"]).wiederaufnahme, true);
    assert.equal(M.aufrufLesen(["lebenszeichen", "5", "--nonce", "x", "--schritt", "2/9"]).schritt, "2/9");
    assert.deepEqual(M.aufrufLesen(["lebenszeichen", "--commit"]), { commit: true });
  });

  test("aufrufLesen: jeder falsche Aufruf nennt seinen Grund", () => {
    const grund = (argv: string[]): string | undefined => M.aufrufLesen(argv).fehler;
    assert.equal(grund([]), "kein Befehl angegeben");
    assert.equal(grund(["foo", "5"]), "unbekannter Befehl foo");
    assert.equal(grund(["claim"]), "Ticketnummer fehlt");
    assert.equal(grund(["claim", "abc"]), "ungültige Ticketnummer abc");
    assert.equal(grund(["claim", "5", "--bogus"]), "Unbekanntes Argument: --bogus");
    assert.equal(grund(["claim", "5", "extra"]), "Unbekanntes Argument: extra");
    assert.equal(grund(["claim", "5", "--nonce", "x"]), "Unbekanntes Argument: --nonce");
    assert.equal(grund(["pruefe", "5", "--nonce"]), "--nonce braucht einen Wert");
    assert.equal(grund(["pruefe", "5", "--nonce", ""]), "--nonce braucht einen Wert");
    assert.equal(grund(["pruefe", "5", "--nonce", "a", "--nonce", "b"]), "--nonce ist doppelt angegeben");
    assert.equal(grund(["freigeben", "5"]), "--nonce fehlt");
    assert.equal(grund(["lebenszeichen", "5", "--commit"]), "Unbekanntes Argument: --commit");
    for (const befehl of ["pruefe", "freigeben", "uebergeben", "gestoppt", "uebernehmen", "lebenszeichen"]) {
      assert.equal(grund([befehl, "5", "--nonce", "x", "--wiederaufnahme"]), "Unbekanntes Argument: --wiederaufnahme", befehl);
    }
    for (const befehl of ["pruefe", "freigeben", "uebergeben", "gestoppt", "uebernehmen"]) {
      assert.equal(grund([befehl, "5", "--nonce", "x", "--schritt", "k"]), "Unbekanntes Argument: --schritt", befehl);
    }
    assert.equal(grund(["lebenszeichen", "--commit", "5"]), "ungültige Ticketnummer --commit");
  });

  test("die echte Lock-Datei liegt im gemeinsamen git-Verzeichnis, nicht unter .claude/worktrees", () => {
    const echt = echteDepsEinmal() as { lockDir: string };
    assert.ok(echt.lockDir.replace(/\\/g, "/").endsWith(`.git/${WTP}locks`));
    assert.doesNotMatch(echt.lockDir.replace(/\\/g, "/"), /\.claude\/worktrees/);
  });
});

describe("verlorener Wettlauf und Randfälle in claim und pruefe", () => {
  const fehler = (code: string) => Object.assign(new Error(code), { code });

  test("das Umbenennen des verwaisten Locks scheitert (ein anderer war schneller) → Exit 4, der fremde Lock bleibt", () => {
    const alt = lauf(["claim", "7"], {}, JETZT - 3 * 60 * MIN);
    const r = M.fuehreAus(["claim", "7"], {
      ...deps(),
      benenneUm: () => {
        throw fehler("ENOENT");
      },
    });
    assert.equal(r.code, 4);
    assert.match(r.err, /übernommen/);
    assert.equal(lockInhalt(readFileSync(join(dir, `${WTP}locks`, "7.json"), "utf8")).nonceHash, sha(nonceVon(alt)));
  });

  test("nach dem Umbenennen gewinnt ein anderer das Neuanlegen → Exit 4, keine Nonce ausgegeben", () => {
    lauf(["claim", "7"], {}, JETZT - 3 * 60 * MIN);
    const r = M.fuehreAus(["claim", "7"], {
      ...deps(),
      schreibeNeu: () => {
        throw fehler("EEXIST");
      },
    });
    assert.equal(r.code, 4);
    assert.doesNotMatch(r.out, /nonce=/);
    assert.match(r.err, /belegt/);
  });

  test("ein anderer Fehler beim Anlegen (kein EEXIST) ist Exit 2, nicht still „gewonnen“", () => {
    const r = M.fuehreAus(["claim", "7"], {
      ...deps(),
      schreibeNeu: () => {
        throw fehler("EACCES");
      },
    });
    assert.equal(r.code, 2);
    assert.doesNotMatch(r.out, /nonce=/);
  });

  test("git status: Umbenennung (`R  alt -> neu`) und zitierter Pfad mit Leerzeichen zählen als geänderte Datei", () => {
    const wt = `/repo/.claude/worktrees/${WTP}5`;
    const alt = (JETZT - 120 * MIN) / 1000;
    const welt: Welt = { worktrees: [wt], reflogSek: alt, status: ["R  alt.txt -> neu.txt", '?? "mit leer.txt"'] };
    assert.equal(lauf(["pruefe", "5"], welt).out, "uebernehmbar\n", "Kontrolle: nichts frisch");
    assert.equal(lauf(["pruefe", "5"], welt, JETZT, { [join(wt, "neu.txt")]: JETZT - 5 * MIN }).out, "aktiv\n", "Ziel der Umbenennung");
    assert.equal(lauf(["pruefe", "5"], welt, JETZT, { [join(wt, "mit leer.txt")]: JETZT - 5 * MIN }).out, "aktiv\n", "zitierter Pfad");
  });
});

describe("Aufräumen alter Lock-Dateien (#1572 Z9)", () => {
  const H = 60 * MIN;
  const lockDatei = (name: string, text = "{}") => {
    mkdirSync(join(dir, `${WTP}locks`), { recursive: true });
    writeFileSync(join(dir, `${WTP}locks`, name), text);
    return join(dir, `${WTP}locks`, name);
  };

  test("aufzuraeumen: jede .verwaist-Datei und jede <nr>.json über ALTLAST_MS, sonst nichts", () => {
    const eintraege = [
      { name: "5.json.verwaist-abc", mtime: JETZT },
      { name: "6.json", mtime: JETZT - 25 * H },
      { name: "7.json", mtime: JETZT - 23 * H },
      { name: "8.json", mtime: Number.NaN },
      { name: "notiz.txt", mtime: JETZT - 99 * H },
      { name: "x5.json", mtime: JETZT - 99 * H },
      { name: "9.json", mtime: JETZT - 24 * H },
    ];
    assert.deepEqual(M.aufzuraeumen({ eintraege, jetzt: JETZT }).sort(), ["5.json.verwaist-abc", "6.json"], "genau 24 h bleibt, x5.json ist keine Lock-Datei");
    assert.equal(M.ALTLAST_MS, 24 * H);
  });

  test("aufzuraeumen: verwaiste *.tmp-* über ALTLAST_MS gehen mit, junge nicht", () => {
    const eintraege = [
      { name: "5.json.tmp-12-abc", mtime: JETZT - 25 * H },
      { name: "6.json.tmp-12-abc", mtime: JETZT - 23 * H },
      { name: "7.json.tmp-1-x", mtime: Number.NaN },
    ];
    assert.deepEqual(M.aufzuraeumen({ eintraege, jetzt: JETZT }), ["5.json.tmp-12-abc"]);
  });

  test("ersetze schreibt atomar: voller Inhalt, danach keine .tmp-Datei; bei Fehlschlag auch keine", () => {
    const echt = echteDepsEinmal() as { ersetze: (p: string, t: string) => void };
    const ziel = lockDatei("4.json", "alt");
    echt.ersetze(ziel, `${"x".repeat(5000)}\n`);
    assert.equal(readFileSync(ziel, "utf8"), `${"x".repeat(5000)}\n`);
    assert.deepEqual(readdirSync(join(dir, `${WTP}locks`)).filter((n) => n.includes(".tmp-")), []);
    mkdirSync(join(dir, `${WTP}locks`, "3.json"));
    assert.throws(() => echt.ersetze(join(dir, `${WTP}locks`, "3.json"), "neu"));
    assert.deepEqual(readdirSync(join(dir, `${WTP}locks`)).filter((n) => n.includes(".tmp-")), [], "Rest nach Fehlschlag aufgeräumt");
  });

  test("ersetze: erst Temp-Datei schreiben, dann auf das Ziel umbenennen, nie das Ziel direkt beschreiben (#1663 L44c)", () => {
    const echt = echteDepsEinmal() as { ersetze: (p: string, t: string) => void };
    const ziel = lockDatei("6.json", "alt");
    const schreibe = vi.mocked(fsSpion.writeFileSync);
    const benenne = vi.mocked(fsSpion.renameSync);
    schreibe.mockClear();
    benenne.mockClear();
    echt.ersetze(ziel, "neu");
    assert.equal(schreibe.mock.calls.length, 1);
    const tmp = String(schreibe.mock.calls[0][0]);
    assert.notEqual(tmp, ziel, "das Ziel wird nie direkt beschrieben");
    assert.ok(tmp.startsWith(`${ziel}.tmp-`), "geschrieben wird in eine Temp-Datei neben dem Ziel");
    assert.deepEqual(benenne.mock.calls.map((c) => [c[0], c[1]]), [[tmp, ziel]]);
    assert.ok(schreibe.mock.invocationCallOrder[0] < benenne.mock.invocationCallOrder[0], "erst schreiben, dann umbenennen");
  });

  test("ersetze: scheitert das Umbenennen, bleibt das Ziel unverändert und die Temp-Datei wird gelöscht (#1663 L44c)", () => {
    const echt = echteDepsEinmal() as { ersetze: (p: string, t: string) => void };
    const ziel = lockDatei("7.json", "alt");
    const benenne = vi.mocked(fsSpion.renameSync);
    benenne.mockImplementationOnce(() => {
      throw new Error("rename kaputt");
    });
    assert.throws(() => echt.ersetze(ziel, "neu"), /rename kaputt/);
    assert.equal(readFileSync(ziel, "utf8"), "alt", "ein halber Schreibvorgang erreicht nie das Ziel");
    assert.deepEqual(readdirSync(join(dir, `${WTP}locks`)).filter((n) => n.includes(".tmp-")), []);
  });

  test("eine .tmp-Datei zählt nicht als Lock: weder claim noch pruefe lesen sie", () => {
    const frisch = JSON.stringify({ nr: 5, nonceHash: "x", erstellt: new Date(JETZT).toISOString() });
    lockDatei("5.json.tmp-1-abc", frisch);
    lockDatei("8.json.tmp-1-abc", frisch);
    assert.equal(lauf(["claim", "5"]).code, 0, "kein fremder Lock");
    assert.equal(lauf(["pruefe", "8"]).out, "frei\n", "pruefe liest die Temp-Datei nicht als Lock");
  });

  test("claim räumt eine verwaiste Datei ab", () => {
    const verwaist = lockDatei("9.json.verwaist-x");
    assert.equal(lauf(["claim", "5"]).code, 0);
    assert.equal(existsSync(verwaist), false);
  });

  test("claim: fremder Lock mit 23 h bleibt, mit 25 h wird er gelöscht, ein frischer eigener bleibt", () => {
    const jung = lockDatei("11.json");
    const alt = lockDatei("12.json");
    const a = lauf(["claim", "5"], {}, JETZT, { [jung]: JETZT - 23 * H, [alt]: JETZT - 25 * H });
    assert.equal(a.code, 0);
    assert.equal(existsSync(jung), true, "23 h alt bleibt");
    assert.equal(existsSync(alt), false, "25 h alt wird gelöscht");
    const b = lauf(["claim", "6"]);
    assert.equal(b.code, 0);
    assert.equal(existsSync(join(dir, `${WTP}locks`, "5.json")), true, "der eigene frische Lock bleibt");
    assert.equal(lauf(["pruefe", "5", "--nonce", nonceVon(a)]).out, "frei\n");
  });

  test("fail-open: scheitert das Auflisten oder Löschen, gewinnt der Claim trotzdem", () => {
    const wirft = () => {
      throw new Error("kaputt");
    };
    assert.equal(M.fuehreAus(["claim", "5"], { ...deps(), liste: wirft }).code, 0);
    const alt = lockDatei("12.json");
    assert.equal(M.fuehreAus(["claim", "6"], { ...deps({}, JETZT, { [alt]: JETZT - 99 * H }), loesche: wirft }).code, 0);
  });
});

describe("uebergeben (#1592, Phasen-Schnitt)", () => {
  const wt = `/repo/.claude/worktrees/${WTP}5`;
  const aktiv: Welt = { worktrees: [wt], refs: [`${BRP}5-x`], commitSek: (JETZT - 1 * MIN) / 1000, reflogSek: (JETZT - 1 * MIN) / 1000 };
  const lockDatei5 = () => join(dir, `${WTP}locks`, "5.json");
  const lockJson = () => JSON.parse(readFileSync(lockDatei5(), "utf8")) as { nonceHash: string; uebergabe?: { gesetzt: string; verbraucht: string | null } };

  test("eigene Nonce: Exit 0, Feld in der Datei; pruefe meldet trotz Aktivität uebernehmbar und verbraucht nichts, uebernehmen verbraucht die Übergabe (#1593)", () => {
    const a = lauf(["claim", "5"]);
    const n = nonceVon(a);
    assert.equal(a.code, 0, `claim: ${JSON.stringify(a)}`);
    assert.equal(lauf(["pruefe", "5", "--nonce", n], aktiv).out, "aktiv\n", "Kontrolle: ohne Übergabe aktiv");
    assert.deepEqual(lauf(["uebergeben", "5", "--nonce", n]), { code: 0, out: "uebergeben\n", err: "" });
    assert.deepEqual(lockJson().uebergabe, { gesetzt: new Date(JETZT).toISOString(), verbraucht: null });
    assert.equal(lockJson().nonceHash, sha(n), "der Lock selbst bleibt unverändert gültig");
    assert.deepEqual(lauf(["pruefe", "5", "--nonce", n], aktiv), { code: 0, out: "uebernehmbar\n", err: "" });
    assert.deepEqual(lauf(["pruefe", "5", "--nonce", n], aktiv), { code: 0, out: "uebernehmbar\n", err: "" }, "pruefe ist lesend: auch das zweite Mal uebernehmbar");
    assert.equal(lockJson().uebergabe?.verbraucht, null, "pruefe verbraucht nichts");
    assert.deepEqual(lauf(["uebernehmen", "5", "--nonce", n, "--nachfolger"], aktiv), { code: 0, out: "uebernehmbar\n", err: "" });
    assert.equal(lockJson().uebergabe?.verbraucht, new Date(JETZT).toISOString());
    for (const befehl of ["uebernehmen", "pruefe"]) {
      const zweites = lauf([befehl, "5", "--nonce", n, ...(befehl === "uebernehmen" ? ["--nachfolger"] : [])], aktiv);
      assert.equal(zweites.code, 4, `${befehl}: die Übergabe ist verbraucht: ${JSON.stringify(zweites)}`);
      assert.equal(zweites.out, "aktiv\n");
    }
  });

  test("uebernehmen: fremde Nonce Exit 4 ohne Verbrauch, ohne oder mit leerer Nonce Usage (Exit 2), ohne Worktree frei und ohne Verbrauch der Übergabe (#1593)", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["uebergeben", "5", "--nonce", n]);
    const fremd = lauf(["uebernehmen", "5", "--nonce", "x-fremd", "--nachfolger"], aktiv);
    assert.equal(fremd.code, 4);
    assert.equal(fremd.out, "fremd\n");
    assert.equal(lockJson().uebergabe?.verbraucht, null, "fremde Nonce verbraucht nichts");
    assert.equal(lauf(["uebernehmen", "5", "--nachfolger"]).code, 2);
    assert.equal(lauf(["uebernehmen", "5", "--nonce", "", "--nachfolger"]).code, 2);
    assert.equal(lauf(["uebernehmen", "5", "--nonce", n, "--nachfolger"]).out, "frei\n");
    assert.equal(lockJson().uebergabe?.verbraucht, null, "ohne Worktree gibt es nichts zu übernehmen");
  });

  test("falsche Nonce: uebergeben Exit 4 ohne Änderung, pruefe fremd ohne Verbrauch, die richtige Nonce bleibt uebernehmbar", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    const vorher = readFileSync(lockDatei5(), "utf8");
    assert.equal(lauf(["uebergeben", "5", "--nonce", `${n}x`]).code, 4);
    assert.equal(readFileSync(lockDatei5(), "utf8"), vorher, "Datei unverändert");
    lauf(["uebergeben", "5", "--nonce", n]);
    const fremd = lauf(["pruefe", "5", "--nonce", `${n}x`], aktiv);
    assert.equal(fremd.out, "fremd\n");
    assert.equal(lockJson().uebergabe?.verbraucht, null, "fremde Nonce verbraucht nichts");
    assert.equal(lauf(["pruefe", "5", "--nonce", n], aktiv).out, "uebernehmbar\n");
  });

  test("uebernehmen ohne --nachfolger: Exit 2 mit Hinweis, Übergabe bleibt unverbraucht, pruefe bleibt wiederholbar uebernehmbar (#1814)", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["uebergeben", "5", "--nonce", n], aktiv);
    const ohne = lauf(["uebernehmen", "5", "--nonce", n], aktiv);
    assert.equal(ohne.code, 2);
    assert.equal(ohne.out, "");
    assert.match(ohne.err, /uebernehmen ruft nur der Nachfolger \(--nachfolger\); der Hauptchat prüft mit pruefe <nr> --nonce <x>/);
    assert.equal(lockJson().uebergabe?.verbraucht, null, "Exit 2 verbraucht nichts");
    for (let i = 0; i < 2; i++) assert.deepEqual(lauf(["pruefe", "5", "--nonce", n], aktiv), { code: 0, out: "uebernehmbar\n", err: "" });
    assert.equal(lockJson().uebergabe?.verbraucht, null);
  });

  test("uebernehmen mit unbekanntem Zusatzargument: Exit 2, nichts verbraucht (#1814)", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["uebergeben", "5", "--nonce", n], aktiv);
    for (const extra of [["--nachfolger", "--quatsch"], ["--quatsch"], ["--nachfolger", "x"]]) {
      assert.equal(lauf(["uebernehmen", "5", "--nonce", n, ...extra], aktiv).code, 2, extra.join(" "));
    }
    assert.equal(lockJson().uebergabe?.verbraucht, null);
  });

  test("zweites uebernehmen --nachfolger: aktiv (Exit 4) mit Verbrauchszeit und Ausweg gestoppt (#1814)", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["uebergeben", "5", "--nonce", n], aktiv);
    assert.equal(lauf(["uebernehmen", "5", "--nonce", n, "--nachfolger"], aktiv).code, 0);
    const zweites = lauf(["uebernehmen", "5", "--nonce", n, "--nachfolger"], aktiv);
    assert.equal(zweites.code, 4);
    assert.equal(zweites.out, "aktiv\n");
    assert.ok(zweites.err.includes(new Date(JETZT).toISOString()), "Verbrauchszeit steht im Text");
    assert.ok(zweites.err.includes("gestoppt"), "Ausweg gestoppt steht im Text");
    assert.ok(zweites.err.includes("nach TaskStop oder Absturz des eigenen Umsetzers"), "Anlass nennt auch den Absturz: " + zweites.err);
  });

  test("eine Übergabe je Lock: ein zweites uebergeben scheitert (offen wie verbraucht)", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["uebergeben", "5", "--nonce", n]);
    const offen = lauf(["uebergeben", "5", "--nonce", n]);
    assert.equal(offen.code, 4);
    assert.match(offen.err, /eine je Lock/);
    lauf(["pruefe", "5", "--nonce", n], aktiv);
    assert.equal(lauf(["uebergeben", "5", "--nonce", n]).code, 4, "auch nach dem Verbrauch");
  });

  test("Aufruf: ohne Lock Exit 4, ohne oder mit leerer Nonce Exit 2", () => {
    assert.equal(lauf(["uebergeben", "5", "--nonce", "x"]).code, 4);
    assert.equal(lauf(["uebergeben", "5"]).code, 2);
    assert.equal(lauf(["uebergeben", "5", "--nonce="]).code, 2);
  });

  test("pruefe ohne Nonce bei übergebenem Lock unter 2 h bleibt fremd und verbraucht nichts; ohne Worktree/Branch frei ohne Verbrauch", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["uebergeben", "5", "--nonce", n]);
    assert.equal(lauf(["pruefe", "5"], aktiv).out, "fremd\n");
    assert.equal(lauf(["pruefe", "5", "--nonce", n]).out, "frei\n");
    assert.equal(lockJson().uebergabe?.verbraucht, null);
  });

  test("ohne Nonce zählt die Übergabe nie: ein über 2 h alter Lock mit frischer Aktivität bleibt aktiv, bei Inaktivität ist er übernehmbar, aber nichts wird verbraucht", () => {
    const n = nonceVon(lauf(["claim", "5"], {}, JETZT - 3 * 60 * MIN));
    lauf(["uebergeben", "5", "--nonce", n], {}, JETZT - 3 * 60 * MIN);
    const frisch = lauf(["pruefe", "5"], aktiv);
    assert.deepEqual({ code: frisch.code, out: frisch.out }, { code: 4, out: "aktiv\n" });
    const alt: Welt = { worktrees: [wt], refs: [`${BRP}5-x`], commitSek: (JETZT - 120 * MIN) / 1000, reflogSek: (JETZT - 120 * MIN) / 1000 };
    assert.equal(lauf(["pruefe", "5"], alt).out, "uebernehmbar\n");
    assert.equal(lockJson().uebergabe?.verbraucht, null, "ohne Nonce kein Verbrauch");
    assert.equal(M.entscheidePruefung({ lock: { nonce: "a", erstellt: new Date(JETZT - 3 * 60 * MIN).toISOString() } as never, nonce: null, vorhanden: true, aktivitaet: JETZT - MIN, jetzt: JETZT, uebergabeOffen: true } as never), "aktiv");
  });

  test("ein Lock im Altformat (Klartext-nonce) ist übergebbar, freigeben geht danach", () => {
    mkdirSync(join(dir, `${WTP}locks`), { recursive: true });
    writeFileSync(lockDatei5(), `${JSON.stringify({ nr: 5, nonce: "alt", erstellt: new Date(JETZT).toISOString() })}\n`);
    assert.equal(lauf(["uebergeben", "5", "--nonce", "alt"]).code, 0);
    assert.equal(lauf(["pruefe", "5", "--nonce", "alt"], aktiv).out, "uebernehmbar\n");
    assert.equal(lauf(["freigeben", "5", "--nonce", "alt"]).code, 0);
    assert.equal(existsSync(lockDatei5()), false);
  });

  test("scheitert das Schreiben (ersetze wirft), ist der Exit 2 (fail-closed), uebergeben wie Verbrauch", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    const wirft = () => {
      throw new Error("schreibgeschützt");
    };
    const r = M.fuehreAus(["uebergeben", "5", "--nonce", n], { ...deps(), ersetze: wirft });
    assert.equal(r.code, 2);
    assert.equal(lockJson().uebergabe, undefined);
    lauf(["uebergeben", "5", "--nonce", n]);
    assert.equal(M.fuehreAus(["uebernehmen", "5", "--nonce", n, "--nachfolger"], { ...deps(aktiv), ersetze: wirft }).code, 2);
    assert.equal(M.fuehreAus(["pruefe", "5", "--nonce", n], { ...deps(aktiv), ersetze: wirft }).code, 0, "pruefe schreibt nie");
  });

  test("entscheidePruefung pur: uebergabeOffen zählt nur mit eigener Nonce und vorhandenem Worktree", () => {
    const lock = { nonce: "a" };
    const o = { lock, nonce: "a", vorhanden: true, aktivitaet: JETZT - MIN, jetzt: JETZT };
    assert.equal(M.entscheidePruefung(o), "aktiv");
    assert.equal(M.entscheidePruefung({ ...o, uebergabeOffen: true } as typeof o), "uebernehmbar");
    assert.equal(M.entscheidePruefung({ ...o, nonce: "b", uebergabeOffen: true } as typeof o), "fremd");
    assert.equal(M.entscheidePruefung({ ...o, vorhanden: false, uebergabeOffen: true } as typeof o), "frei");
  });
});

describe("gestoppt (#1693 L65, TaskStop des eigenen Umsetzers)", () => {
  const wt = `/repo/.claude/worktrees/${WTP}5`;
  const aktiv: Welt = { worktrees: [wt], refs: [`${BRP}5-x`], commitSek: (JETZT - 1 * MIN) / 1000, reflogSek: (JETZT - 1 * MIN) / 1000 };
  const lockDatei5 = () => join(dir, `${WTP}locks`, "5.json");
  const lockJson = () =>
    JSON.parse(readFileSync(lockDatei5(), "utf8")) as { uebergabe?: unknown; gestoppt?: { gesetzt: string; verbraucht: string | null } };

  test("eigene Nonce: Exit 0, pruefe meldet trotz Aktivität uebernehmbar ohne Verbrauch, das nächste uebernehmen verbraucht den Vermerk, das zweite wieder aktiv (#1593)", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    assert.equal(lauf(["pruefe", "5", "--nonce", n], aktiv).out, "aktiv\n", "Kontrolle: ohne Vermerk aktiv");
    assert.deepEqual(lauf(["gestoppt", "5", "--nonce", n]), { code: 0, out: "gestoppt\n", err: "" });
    assert.deepEqual(lockJson().gestoppt, { gesetzt: new Date(JETZT).toISOString(), verbraucht: null });
    assert.deepEqual(lauf(["pruefe", "5", "--nonce", n], aktiv), { code: 0, out: "uebernehmbar\n", err: "" });
    assert.equal(lockJson().gestoppt?.verbraucht, null, "pruefe verbraucht den Vermerk nicht");
    assert.deepEqual(lauf(["uebernehmen", "5", "--nonce", n, "--nachfolger"], aktiv), { code: 0, out: "uebernehmbar\n", err: "" });
    assert.equal(lockJson().gestoppt?.verbraucht, new Date(JETZT).toISOString());
    const zweites = lauf(["pruefe", "5", "--nonce", n], aktiv);
    assert.equal(zweites.code, 4);
    assert.equal(zweites.out, "aktiv\n");
  });

  test("nach verbrauchtem Stopp-Vermerk: aktiv mit Verbrauchszeit und Ausweg im Text; ohne Verbrauch kein solcher Hinweis (#1814)", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    const vorher = lauf(["pruefe", "5", "--nonce", n], aktiv);
    assert.equal(vorher.code, 4);
    assert.ok(!vorher.err.includes("verbraucht"), "ohne Verbrauch kein Hinweis: " + vorher.err);
    lauf(["gestoppt", "5", "--nonce", n]);
    assert.equal(lauf(["uebernehmen", "5", "--nonce", n, "--nachfolger"], aktiv).code, 0);
    const danach = lauf(["uebernehmen", "5", "--nonce", n, "--nachfolger"], aktiv);
    assert.equal(danach.code, 4);
    assert.ok(danach.err.includes(new Date(JETZT).toISOString()), "Verbrauchszeit des Stopp-Vermerks steht im Text");
    assert.ok(danach.err.includes("gestoppt"), "Ausweg steht im Text");
    assert.ok(danach.err.includes("nach TaskStop oder Absturz des eigenen Umsetzers"), "Anlass nennt auch den Absturz: " + danach.err);
  });

  test("uebernehmen akzeptiert --nonce=<x> samt --nachfolger (#1814)", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["gestoppt", "5", "--nonce", n]);
    assert.deepEqual(lauf(["uebernehmen", "5", "--nonce=" + n, "--nachfolger"], aktiv), { code: 0, out: "uebernehmbar\n", err: "" });
  });

  test("zählt nicht als Phasen-Schnitt: uebergeben bleibt danach möglich (eine Übergabe je Lock gilt weiter), gestoppt legt kein uebergabe-Feld an", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["gestoppt", "5", "--nonce", n]);
    assert.equal(lockJson().uebergabe, undefined);
    assert.equal(lauf(["uebergeben", "5", "--nonce", n]).code, 0);
    assert.equal(lauf(["uebergeben", "5", "--nonce", n]).code, 4, "eine Übergabe je Lock");
  });

  test("fremde Nonce: Exit 4 ohne Änderung; pruefe mit der richtigen Nonce bleibt aktiv", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    const r = lauf(["gestoppt", "5", "--nonce", `${n}x`]);
    assert.equal(r.code, 4);
    assert.equal(lockJson().gestoppt, undefined);
    assert.equal(lauf(["pruefe", "5", "--nonce", n], aktiv).out, "aktiv\n");
  });

  test("ohne Lock: Exit 4; ohne Nonce oder mit leerer Nonce: Usage (Exit 2)", () => {
    assert.equal(lauf(["gestoppt", "5", "--nonce", "x"]).code, 4);
    assert.equal(existsSync(lockDatei5()), false);
    assert.equal(lauf(["gestoppt", "5"]).code, 2);
    assert.equal(lauf(["gestoppt", "5", "--nonce="]).code, 2);
  });

  test("der Vermerk trägt ohne Nonce nicht: pruefe ohne --nonce bleibt aktiv, ohne den Vermerk zu verbrauchen", () => {
    const n = nonceVon(lauf(["claim", "5"], {}, JETZT - 3 * 60 * MIN));
    lauf(["gestoppt", "5", "--nonce", n], {}, JETZT - 3 * 60 * MIN);
    assert.equal(lauf(["pruefe", "5"], aktiv).out, "aktiv\n");
    assert.equal(lockJson().gestoppt?.verbraucht, null);
  });

  test("ohne Worktree (frei) verbraucht uebernehmen den Vermerk ebenfalls, damit er nicht später eine Aktivität überstimmt; pruefe nicht (#1593)", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["gestoppt", "5", "--nonce", n]);
    assert.equal(lauf(["pruefe", "5", "--nonce", n]).out, "frei\n");
    assert.equal(lockJson().gestoppt?.verbraucht, null);
    assert.equal(lauf(["uebernehmen", "5", "--nonce", n, "--nachfolger"]).out, "frei\n");
    assert.notEqual(lockJson().gestoppt?.verbraucht, null);
    assert.equal(lauf(["pruefe", "5", "--nonce", n], aktiv).out, "aktiv\n");
  });

  test("ein erneutes gestoppt nach dem Verbrauch ist erlaubt (jeder TaskStop), und scheitert das Schreiben, ist es Exit 2", () => {
    const n = nonceVon(lauf(["claim", "5"]));
    lauf(["gestoppt", "5", "--nonce", n]);
    lauf(["pruefe", "5", "--nonce", n], aktiv);
    assert.equal(lauf(["gestoppt", "5", "--nonce", n]).code, 0);
    assert.equal(lockJson().gestoppt?.verbraucht, null, "neuer, offener Vermerk");
    const wirft = () => {
      throw new Error("schreibgeschützt");
    };
    assert.equal(M.fuehreAus(["gestoppt", "5", "--nonce", n], { ...deps(), ersetze: wirft }).code, 2);
  });

  test("entscheidePruefung pur: gestopptOffen zählt nur mit eigener Nonce und vorhandenem Worktree", () => {
    const o = { lock: { nonce: "a" }, nonce: "a", vorhanden: true, aktivitaet: JETZT - MIN, jetzt: JETZT };
    assert.equal(M.entscheidePruefung({ ...o, gestopptOffen: true } as typeof o), "uebernehmbar");
    assert.equal(M.entscheidePruefung({ ...o, nonce: "b", gestopptOffen: true } as typeof o), "fremd");
    assert.equal(M.entscheidePruefung({ ...o, nonce: null, gestopptOffen: true } as unknown as typeof o), "aktiv");
    assert.equal(M.entscheidePruefung({ ...o, vorhanden: false, gestopptOffen: true } as typeof o), "frei");
  });
});
