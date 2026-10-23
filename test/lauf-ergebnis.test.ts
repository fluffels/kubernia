/* Ergebnis je Ticket-Lauf (#1123): Nacharbeit, CI-Fix-Runden, Aggregate, IO-Orchestrierung.
 * Pur über synthetische PRs und Commits; die IO-Schicht läuft gegen Stub-Runner für git und gh.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/lauf-ergebnis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as nachweisLib from "../scripts/nachweis-lib.mjs";
const { abnahmeMarker } = nachweisLib as unknown as { abnahmeMarker: (z: Zeilen) => string };
import { FREMD, FREMD_OWNER, projektConfig } from "./support/fremd-config";

type Commit = { sha: string; datum: string; body: string };
type Pr = {
  number: number;
  title: string;
  createdAt: string;
  mergedAt: string;
  mergeCommit: { oid: string };
  headRefName: string;
  closingIssuesReferences: { number: number }[];
};
type Abnahme = { durchgaenge: number } | "entfaellt" | "override" | null;
type Zeile = { pr: number; abnahme: Abnahme; ticket: number | null; runden: number | null; blocker: { lens: string; n: number }[] | null; ciFix: number; festgefahren: number; nacharbeit: string };
type Ergebnis = { zeilen: Zeile[]; kennzahlen: Record<string, unknown> & { brillen: Record<string, { prs: number; treffer: number; summe: number; jePr: number | null }> } };
type Zeilen = Record<string, string>;
const { commitZeilen } = sliceRaw as unknown as { commitZeilen: (praefix: string, planer: string) => Zeilen };
/** Zeilen der Fremd-Config; die Wrapper in `mod` reichen sie durch. */
const PLANER = FREMD.agenten.planer;
const Z = commitZeilen(FREMD.praefixe.commitZeile, PLANER);
const LABEL = FREMD.labels.festgefahren;
const BRANCH = FREMD.praefixe.branch;
const roh = raw as {
  NACHARBEIT_TAGE: number;
  DatenFehler: new (m: string) => Error;
  parseCommits: (log: string) => Commit[];
  ticketVon: (pr: Partial<Pr>) => number | null;
  nacharbeitVon: (e: { pr: number; ticket: number | null; mergeSha: string; mergedAt: string; commits: Commit[]; jetzt: Date }) => string;
  ciFixRunden: (l: { sha: string; createdAt: string }[], von: string, bis: string) => number;
  bewertePrs: (e: { prs: Pr[]; commits: Commit[]; ci: Record<number, { sha: string; createdAt: string }[]>; festgefahren: Record<number, number>; jetzt: Date; konfigZeilen: Zeilen }) => Ergebnis;
  formatiere: (e: Ergebnis) => string;
  labelAbfrage: (n: number[]) => string;
  festgefahrenAusAntwort: (a: unknown, n: number[], label?: string) => Record<number, number>;
  laufErgebnis: (e: { von: string; bis: string; runGit: (a: string[]) => string; runGh: (a: string[]) => string; jetzt?: Date; tickets?: number[]; ohne?: number[]; ladeConfig?: () => unknown; owner?: string }) => Ergebnis;
  parseArgs: (a: string[]) => { von?: string; bis?: string; tickets: number[]; ohne: number[]; json: boolean; fehler: string | null; startAgent?: string };
  laufErgebnisStartAgent: (e: { laeufe: unknown[]; von: string; bis: string; runGit: (a: string[]) => string; runGh: (a: string[]) => string; jetzt?: Date; ohne?: number[]; ladeConfig?: () => unknown; owner?: string }) => Ergebnis;
  ladeStartLaeufe: (dir: string, agent: string, von: string) => unknown[];
};
const mod = {
  ...roh,
  // Die Fremd-Config ist der Standard (sonst läse der Aufruf die echte Config); ein eigenes `ladeConfig` gewinnt über den Spread.
  laufErgebnis: (e: Parameters<typeof roh.laufErgebnis>[0]) => roh.laufErgebnis({ ladeConfig: () => FREMD, ...e }),
  laufErgebnisStartAgent: (e: Parameters<typeof roh.laufErgebnisStartAgent>[0]) => roh.laufErgebnisStartAgent({ ladeConfig: () => FREMD, ...e }),
  bewertePrs: (e: Omit<Parameters<typeof roh.bewertePrs>[0], "konfigZeilen">) => roh.bewertePrs({ konfigZeilen: Z, ...e }),
  festgefahrenAusAntwort: (a: unknown, n: number[]) => roh.festgefahrenAusAntwort(a, n, LABEL),
};

const SHA = "abcdef1234567890abcdef1234567890abcdef12";
const MERGED = "2026-10-01T12:00:00Z";
const tage = (n: number) => new Date(new Date(MERGED).getTime() + n * 86400000).toISOString();
const SPAETER = new Date("2026-12-31T00:00:00Z");
const commit = (body: string, datum: string, sha = "c".repeat(40)): Commit => ({ sha, datum, body });
const pr = (o: Partial<Pr> = {}): Pr => ({
  number: 50,
  title: "feat(x): y (#40)",
  createdAt: "2026-10-01T10:00:00Z",
  mergedAt: MERGED,
  mergeCommit: { oid: SHA },
  headRefName: `${BRANCH}40-x`,
  closingIssuesReferences: [{ number: 40 }],
  ...o,
});
const nach = (commits: Commit[], jetzt = SPAETER, p = 50, ticket: number | null = 40) =>
  mod.nacharbeitVon({ pr: p, ticket, mergeSha: SHA, mergedAt: MERGED, commits, jetzt });
const review = (felder: string) => `feat: y (#40) (#50)\n\n${Z.plan}: ${PLANER}\n${Z.review}: head=${"a".repeat(40)} ${felder} verdikt=ok`;

describe("Nacharbeit (14 Tage)", () => {
  test("Revert per SHA-Präfix (≥ 7 Zeichen) und per Betreff mit (#pr)", () => {
    assert.equal(nach([commit(`Revert x\n\nThis reverts commit ${SHA.slice(0, 7)}.`, tage(2))]), "revert");
    assert.equal(nach([commit('Revert "feat(x): y (#40) (#50)"\n\nbody', tage(2))]), "revert");
    assert.equal(nach([commit('Revert "feat(z): anderes (#41) (#51)"', tage(2))]), "nein", "fremder Revert zählt nicht");
    assert.equal(nach([commit(`This reverts commit ${SHA.slice(0, 6)}`, tage(2))]), "nein", "zu kurzes Präfix passt nicht");
  });
  test("Folge # mit Ticket- oder PR-Nummer, nur am Zeilenanfang", () => {
    assert.equal(nach([commit("fix: z (#60)\n\nFolge #40", tage(1))]), "folge");
    assert.equal(nach([commit("fix: z (#60)\n\nFolge #50\nrest", tage(1))]), "folge");
    assert.equal(nach([commit("fix: z (#60)\n\nFolge #41", tage(1))]), "nein", "andere Nummer");
    assert.equal(nach([commit("fix: z\n\n siehe Folge #40", tage(1))]), "nein", "nicht am Zeilenanfang");
    assert.equal(nach([commit("fix: z\n\nFolge #400", tage(1))]), "nein", "#400 ist nicht #40");
  });
  test("Grenzen: vor dem Merge, nach 14 Tagen und der eigene Squash zählen nicht", () => {
    assert.equal(nach([commit("Folge #40", tage(-1))]), "nein");
    assert.equal(nach([commit("Folge #40", tage(mod.NACHARBEIT_TAGE + 0.01))]), "nein");
    assert.equal(nach([commit("Folge #40", tage(mod.NACHARBEIT_TAGE))]), "folge", "genau 14 Tage zählt");
    assert.equal(nach([commit("Folge #40", tage(1), SHA)]), "nein", "eigener Commit");
  });
  test("offenes Fenster ohne Treffer ist offen, mit Treffer bleibt der Treffer", () => {
    const innen = new Date(tage(3));
    assert.equal(nach([], innen), "offen");
    assert.equal(nach([commit("Folge #40", tage(1))], innen), "folge");
    assert.equal(nach([], new Date(tage(15))), "nein");
  });
});

describe("Hilfen", () => {
  test("parseCommits trennt Felder und Commits, CRLF wird entfernt", () => {
    const c = mod.parseCommits(`${SHA}\x1f${MERGED}\x1fBetreff\r\n\r\nKörper\x1e\n${"b".repeat(40)}\x1f${tage(1)}\x1fzwei\x1e`);
    assert.equal(c.length, 2);
    assert.equal(c[0].sha, SHA);
    assert.equal(c[0].body, "Betreff\n\nKörper");
  });
  test("ticketVon: verknüpftes Issue vor Titel, sonst die letzte (#N) im Titel, sonst null", () => {
    assert.equal(mod.ticketVon({ closingIssuesReferences: [{ number: 7 }], title: "a (#8)" }), 7);
    assert.equal(mod.ticketVon({ closingIssuesReferences: [], title: "a (#8) b (#9)" }), 9);
    assert.equal(mod.ticketVon({ closingIssuesReferences: [], title: "ohne" }), null);
  });
  test("ciFixRunden: nur Läufe zwischen Erstellung und Merge, distinct je Head-SHA", () => {
    const l = [
      { sha: "a", createdAt: "2026-10-01T10:30:00Z" },
      { sha: "a", createdAt: "2026-10-01T10:40:00Z" },
      { sha: "b", createdAt: "2026-10-01T11:00:00Z" },
      { sha: "c", createdAt: "2026-10-01T09:00:00Z" },
      { sha: "d", createdAt: "2026-10-01T13:00:00Z" },
    ];
    assert.equal(mod.ciFixRunden(l, "2026-10-01T10:00:00Z", MERGED), 2);
    assert.equal(mod.ciFixRunden([], "2026-10-01T10:00:00Z", MERGED), 0);
  });
});

describe("bewertePrs und Aggregate", () => {
  const prs = [
    pr({ number: 50, mergeCommit: { oid: "1".repeat(40) } }),
    pr({ number: 51, closingIssuesReferences: [{ number: 41 }], mergeCommit: { oid: "2".repeat(40) } }),
    pr({ number: 52, closingIssuesReferences: [{ number: 42 }], mergeCommit: { oid: "3".repeat(40) } }),
    pr({ number: 53, closingIssuesReferences: [{ number: 43 }], mergeCommit: { oid: "4".repeat(40) } }),
  ];
  const commits = [
    commit(review("runden=2 lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:2,requirement-treue:0,test-adaequanz:1"), MERGED, "1".repeat(40)),
    commit(review("runden=1 lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:0,requirement-treue:0,test-adaequanz:0"), MERGED, "2".repeat(40)),
    commit(review("runden=3 lenses=architektur,requirement-treue,test-adaequanz"), MERGED, "3".repeat(40)),
    commit("feat: ohne Nachweis (#43) (#53)", MERGED, "4".repeat(40)),
    commit("fix: kaputt (#70)\n\nFolge #40", tage(2)),
  ];
  const e = mod.bewertePrs({
    prs,
    commits,
    ci: { 50: [{ sha: "x", createdAt: "2026-10-01T10:30:00Z" }], 51: [{ sha: "y", createdAt: "2026-09-01T00:00:00Z" }] },
    festgefahren: { 52: 1 },
    jetzt: SPAETER,
  });
  const z = (n: number) => e.zeilen.find((r) => r.pr === n)!;

  test("Zeilen: Runden, Blocker, CI-Fix, festgefahren, Nacharbeit", () => {
    assert.equal(z(50).runden, 2);
    assert.deepEqual(z(50).blocker?.map((b) => `${b.lens}:${b.n}`), ["architektur:2", "requirement-treue:0", "test-adaequanz:1"]);
    assert.equal(z(50).ciFix, 1);
    assert.equal(z(51).ciFix, 0, "Lauf außerhalb des Fensters");
    assert.equal(z(52).festgefahren, 1);
    assert.equal(z(50).nacharbeit, "folge", "Folge #40 nach dem Merge");
    assert.equal(z(51).nacharbeit, "nein");
    assert.equal(z(50).ticket, 40);
  });
  test("Blocker je PR: Σ Blocker / PRs der Brille; ohne PRs gibt es keine Brillen-Einträge", () => {
    const k = mod.bewertePrs({
      prs: [pr({ mergeCommit: { oid: "9".repeat(40) } })],
      commits: [commit(review("runden=1 lenses=architektur blocker=architektur:3"), MERGED, "9".repeat(40))],
      ci: {},
      festgefahren: {},
      jetzt: SPAETER,
    });
    assert.equal(k.kennzahlen.brillen.architektur.jePr, 3);
    assert.match(mod.formatiere(k), /Σ Blocker 3 \(3,00 je PR\)/);
    const leer = mod.bewertePrs({ prs: [], commits: [], ci: {}, festgefahren: {}, jetzt: SPAETER });
    assert.deepEqual(leer.kennzahlen.brillen, {});
  });
  test("Runde 1 mit Blocker: echte Zählung aus blocker=, nicht der Proxy Runden ≥ 2 (#1609)", () => {
    const rechne = (zeilen: string[]) =>
      mod.bewertePrs({
        prs: zeilen.map((_, i) => pr({ number: 60 + i, mergeCommit: { oid: String(i + 1).repeat(40) } })),
        commits: zeilen.map((r, i) => commit(review(r), MERGED, String(i + 1).repeat(40))),
        ci: {},
        festgefahren: {},
        jetzt: SPAETER,
      });
    const proxyOhneBlocker = rechne(["runden=2 lenses=doku blocker=doku:0"]);
    assert.equal(proxyOhneBlocker.kennzahlen.runde1MitBlockerProxy, 1);
    assert.equal(proxyOhneBlocker.kennzahlen.runde1MitBlocker, 0, "Runden 2, aber alle Blocker 0");
    assert.equal(rechne(["runden=1 lenses=doku blocker=doku:1"]).kennzahlen.runde1MitBlocker, 1, "Runde 1 mit Blocker > 0");
    const ohneFeld = rechne(["runden=3 lenses=doku"]);
    assert.equal(ohneFeld.kennzahlen.mitBlockerFeld, 0);
    assert.ok(mod.formatiere(ohneFeld).includes("Runde 1 mit Blocker (aus blocker=): –; Proxy Runden ≥ 2: 100 %"), "Nenner 0 steht als Strich");
    assert.ok(mod.formatiere(proxyOhneBlocker).includes("(aus blocker=): 0 % (0/1)"));
  });
  test("kaputtes runden in der Squash-Message zählt als ohne Nachweis, kein NaN in den Aggregaten", () => {
    const k = mod.bewertePrs({
      prs: [pr({ mergeCommit: { oid: "9".repeat(40) } })],
      commits: [commit(review("runden=x lenses=architektur blocker=architektur:x"), MERGED, "9".repeat(40))],
      ci: {},
      festgefahren: {},
      jetzt: SPAETER,
    });
    assert.equal(k.zeilen[0].runden, null);
    assert.equal(k.kennzahlen.ohneNachweis, 1);
    assert.equal(k.kennzahlen.brillen.architektur, undefined, "ohne Nachweis keine Brillen-Zählung");
  });
  test("ohne Nachweis und ohne blocker-Feld bleiben aus der Trefferquote", () => {
    assert.equal(z(53).runden, null);
    assert.equal(z(52).blocker, null);
    const k = e.kennzahlen;
    assert.equal(k.ohneNachweis, 1);
    assert.equal(k.ohneBlockerFeld, 1);
    assert.deepEqual(k.brillen.architektur, { prs: 2, treffer: 1, summe: 2, jePr: 1 });
    assert.deepEqual(k.brillen["test-adaequanz"], { prs: 2, treffer: 1, summe: 1, jePr: 0.5 });
    assert.equal(k.runde1MitBlockerProxy, 2, "runden ≥ 2 über alle PRs mit Nachweis");
    assert.equal(k.runde1MitBlocker, 1, "nur #50 hat einen Blocker > 0");
    assert.equal(k.mitBlockerFeld, 2, "#52 hat kein blocker-Feld und fällt aus dem Nenner");
    assert.equal(k.mitNachweis, 3);
  });
  test("AK3 (#1741): die wörtliche Squash-Message eines gemergten PRs ergibt Runden aus dem Nachweis; mit dem Präfix AB- fehlt der Nachweis", () => {
    const squash = [
      "feat(harness): x (#1723) (#1733)",
      "",
      "* chore(harness): Review-Nachweis (#1723)",
      "",
      `${Z.plan}: ${PLANER}`,
      `${Z.review}: head=${"a".repeat(40)} runden=3 lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:2,requirement-treue:0,test-adaequanz:2 verdikt=ok`,
      "",
      "---------",
    ].join("\n");
    const eins = [pr({ number: 50, mergeCommit: { oid: "1".repeat(40) } })];
    const cs = [commit(squash, MERGED, "1".repeat(40))];
    const basis = { prs: eins, commits: cs, ci: {}, festgefahren: {}, jetzt: SPAETER };
    assert.equal(mod.bewertePrs(basis).zeilen[0].runden, 3);
    const ab = roh.bewertePrs({ ...basis, konfigZeilen: commitZeilen("AB-", PLANER) });
    assert.equal(ab.zeilen[0].runden, null);
    assert.equal(ab.kennzahlen.ohneNachweis, 1);
  });
  test("Folge-Commit macht Nacharbeit je PR mit passender Ticketnummer, offene Fenster zählen nicht in die Quote", () => {
    const f = mod.bewertePrs({ prs, commits, ci: {}, festgefahren: {}, jetzt: new Date(tage(3)) });
    assert.equal(f.zeilen.find((r) => r.pr === 50)?.nacharbeit, "folge");
    assert.equal(f.zeilen.find((r) => r.pr === 51)?.nacharbeit, "offen");
    assert.equal(f.kennzahlen.nacharbeitOffen, 3);
    assert.equal(f.kennzahlen.nachweisbareFenster, 1);
    assert.equal(f.kennzahlen.ohneNacharbeit, 0);
  });
  test("formatiere nennt Tabelle und Aggregate", () => {
    const t = mod.formatiere(e);
    assert.match(t, /\| #50 \| #40 \| 2026-10-01 \| 2 \| architektur:2,requirement-treue:0,test-adaequanz:1 \| 1 \| 0 \| folge \|/);
    assert.match(t, /Lens-Trefferquote architektur: 50 % \(1\/2\), Σ Blocker 2 \(1,00 je PR\)/);
    assert.match(t, /ohne Review-Nachweis: 1/);
  });
});

describe("Abnahme je PR (#1756)", () => {
  const NL = String.fromCharCode(10);
  const H = "b".repeat(40);
  const urteil = (d: number) => `${Z.abnahme}: head=${H} durchgaenge=${d} urteil=K1:erfuellt`;
  const nachricht = (...zeilen: string[]) => ["feat: y (#40) (#50)", "", `${Z.plan}: ${PLANER}`, ...zeilen].join(NL);
  const bewerte = (bodies: string[], konfig: Zeilen = Z) => {
    const prs = bodies.map((_, i) => pr({ number: 50 + i, mergeCommit: { oid: String(i + 1).repeat(40) } }));
    const commits = bodies.map((b, i) => commit(b, MERGED, String(i + 1).repeat(40)));
    return roh.bewertePrs({ prs, commits, ci: {}, festgefahren: {}, jetzt: SPAETER, konfigZeilen: konfig });
  };
  const ab = (...zeilen: string[]) => bewerte([nachricht(...zeilen)]).zeilen[0].abnahme;

  test("gültiges Urteil: durchgaenge übernommen", () => {
    assert.deepEqual(ab(urteil(1)), { durchgaenge: 1 });
    assert.deepEqual(ab(urteil(2)), { durchgaenge: 2 });
  });
  test("entfaellt und Override", () => {
    assert.equal(ab(`${Z.abnahme}: entfaellt — Hand-PR`), "entfaellt");
    assert.equal(ab(`${Z.abnahmeOverride}: #1755 Sitzung vor den Agenten`), "override");
  });
  test("Vorrang: Override schlägt eine gültige Abnahme-Zeile", () => {
    assert.equal(ab(`${Z.abnahmeOverride}: #1755 Sitzung vor den Agenten`, urteil(1)), "override");
  });
  test("Vorrang gilt auch gegenüber entfaellt", () => {
    assert.equal(ab(`${Z.abnahmeOverride}: #1755 grund`, `${Z.abnahme}: entfaellt — Hand-PR`), "override");
  });
  test("Prozent wird gerundet: 2 von 3 sind 67 %", () => {
    const e = bewerte([nachricht(urteil(1)), nachricht(urteil(1)), nachricht(urteil(2))]);
    assert.match(mod.formatiere(e), /Abnahme im ersten Durchgang: 67 %/);
  });
  test("Widerruf hebt den Override auf, die Abnahme-Zeile zählt wieder", () => {
    assert.deepEqual(ab(`${Z.abnahmeOverride}: #1755 grund`, `${Z.abnahmeOverride}: #1755 entfällt`, urteil(1)), { durchgaenge: 1 });
  });
  test("ungültig (durchgaenge=0, ohne head) und ohne Zeile: null", () => {
    assert.equal(ab(`${Z.abnahme}: head=${H} durchgaenge=0 urteil=K1:erfuellt`), null);
    assert.equal(ab(`${Z.abnahme}: durchgaenge=1 urteil=K1:erfuellt`), null);
    assert.equal(ab(), null);
  });
  test("Squash-Betreff mit Stern-Präfix wird erkannt", () => {
    assert.deepEqual(ab(`* ${urteil(1)}`), { durchgaenge: 1 });
  });
  test("nur der Merge-Commit zählt: eine Abnahme-Zeile in einem späteren Commit nicht", () => {
    const e = roh.bewertePrs({
      prs: [pr({ mergeCommit: { oid: "1".repeat(40) } })],
      commits: [commit(nachricht(), MERGED, "1".repeat(40)), commit(urteil(1), tage(1), "2".repeat(40))],
      ci: {},
      festgefahren: {},
      jetzt: SPAETER,
      konfigZeilen: Z,
    });
    assert.equal(e.zeilen[0].abnahme, null);
  });
  test("Aggregat: exakte Zahlen, die Klassen summieren sich zu prs", () => {
    const e = bewerte([
      nachricht(urteil(1)),
      nachricht(urteil(2)),
      nachricht(`${Z.abnahme}: entfaellt — Hand-PR`),
      nachricht(`${Z.abnahmeOverride}: #1755 grund`),
      nachricht(),
    ]);
    const a = e.kennzahlen.abnahme as Record<string, number>;
    assert.deepEqual(a, { gemessen: 2, ersterDurchgang: 1, entfaellt: 1, override: 1, ohne: 1 });
    assert.equal(a.gemessen + a.entfaellt + a.override + a.ohne, e.kennzahlen.prs);
    assert.match(mod.formatiere(e), /Abnahme im ersten Durchgang: 50 % \(1\/2\); entfällt 1, Override 1, ohne gültige Abnahme-Zeile 1/);
  });
  test("Abnahme-Fix und Hand-off (#1808): PRs mit durchgaenge ≥ 2, davon mit festgefahren-Label; ohne Fix/override/entfällt zählen nicht", () => {
    const bodies = [nachricht(urteil(1)), nachricht(urteil(2)), nachricht(urteil(2)), nachricht(urteil(3)), nachricht(`${Z.abnahme}: entfaellt — Hand-PR`)];
    const prs = bodies.map((_, i) => pr({ number: 50 + i, mergeCommit: { oid: String(i + 1).repeat(40) } }));
    const commits = bodies.map((b, i) => commit(b, MERGED, String(i + 1).repeat(40)));
    const e = roh.bewertePrs({ prs, commits, ci: {}, festgefahren: { 50: 1, 51: 1, 53: 0 }, jetzt: SPAETER, konfigZeilen: Z });
    // PR 50: kein Fix (festgefahren zählt nicht); 51: Fix + festgefahren; 52: Fix ohne Eintrag; 53: Fix, 0 festgefahren; 54: entfällt
    assert.deepEqual(e.kennzahlen.abnahmeFix, { mitFix: 3, mitFixUndFestgefahren: 1, offenMitFix: 0 });
    assert.match(mod.formatiere(e), /Abnahme-Fix: 3 PRs, davon mit Hand-off: 33 % \(1\/3\)/);
  });
  test("Abnahme-Fix leer: 0 PRs, Darstellung ohne Prozent", () => {
    const e = bewerte([]);
    assert.deepEqual(e.kennzahlen.abnahmeFix, { mitFix: 0, mitFixUndFestgefahren: 0, offenMitFix: 0 });
    assert.match(mod.formatiere(e), /Abnahme-Fix: 0 PRs, davon mit Hand-off: –/);
  });
  test("leer: alle Werte 0, Darstellung ohne Prozent", () => {
    const e = bewerte([]);
    assert.deepEqual(e.kennzahlen.abnahme, { gemessen: 0, ersterDurchgang: 0, entfaellt: 0, override: 0, ohne: 0 });
    assert.match(mod.formatiere(e), /Abnahme im ersten Durchgang: –;/);
  });
  test("Präfix aus der Config: bei AB- wird die Abnahme-Zeile des Config-Präfixes nicht gelesen", () => {
    const e = bewerte([nachricht(urteil(1), `${Z.abnahmeOverride}: #1755 grund`)], commitZeilen("AB-", PLANER));
    assert.equal(e.zeilen[0].abnahme, null);
  });
  test("laufErgebnis liefert das Feld je Zeile und das Aggregat", () => {
    const body = nachricht(urteil(1));
    const log = `${SHA}\x1f${MERGED}\x1f${body}\x1e`;
    const gh = (a: string[]): string => {
      if (a[0] === "pr") return a.includes("open") ? "[]" : JSON.stringify([pr()]);
      if (a.join(" ").includes("actions/workflows")) return "";
      const nummern = [...(a.find((x) => x.startsWith("query=")) ?? "").matchAll(/p(\d+): pullRequest/g)].map((m) => Number(m[1]));
      const repository = Object.fromEntries(nummern.map((n) => [`p${n}`, { timelineItems: { pageInfo: { hasNextPage: false }, nodes: [] } }]));
      return JSON.stringify({ data: { repository } });
    };
    const e = mod.laufErgebnis({ von: "2026-10-01T00:00:00Z", bis: "2026-10-02T00:00:00Z", runGit: () => log, runGh: gh, jetzt: SPAETER });
    assert.deepEqual(e.zeilen[0].abnahme, { durchgaenge: 1 });
    assert.deepEqual(e.kennzahlen.abnahme, { gemessen: 1, ersterDurchgang: 1, entfaellt: 0, override: 0, ohne: 0 });
  });
});

describe("Label-Events per GraphQL (Z3c)", () => {
  test("labelAbfrage: ein Alias je PR, nur LABELED_EVENT, pageInfo statt totalCount", () => {
    const q = mod.labelAbfrage([7, 9]);
    assert.match(q, /p7: pullRequest\(number: 7\)/);
    assert.match(q, /p9: pullRequest\(number: 9\)/);
    assert.match(q, /itemTypes: \[LABELED_EVENT\]/);
    assert.match(q, /pageInfo \{ hasNextPage \}/);
    assert.ok(!q.includes("totalCount"), "totalCount zählt alle Timeline-Einträge, nicht nur Label-Events");
  });
  const knoten = (...namen: string[]) => ({ pageInfo: { hasNextPage: false }, nodes: namen.map((name) => ({ createdAt: "2026-10-01T10:45:00Z", label: { name } })) });
  test("festgefahrenAusAntwort zählt nur das Festgefahren-Label, auch mehrfach", () => {
    const antwort = { data: { repository: { p1: { timelineItems: knoten(LABEL, "x", LABEL) }, p2: { timelineItems: knoten("dependencies") } } } };
    assert.deepEqual(mod.festgefahrenAusAntwort(antwort, [1, 2]), { 1: 2, 2: 0 });
  });
  test("festgefahrenAusAntwort: das Label kommt als Parameter, ohne Label wirft die Funktion", () => {
    const antwort = { data: { repository: { p1: { timelineItems: knoten(LABEL, "anderes:label", "anderes:label") } } } };
    assert.deepEqual(roh.festgefahrenAusAntwort(antwort, [1], "anderes:label"), { 1: 2 });
    assert.deepEqual(roh.festgefahrenAusAntwort(antwort, [1], LABEL), { 1: 1 });
    for (const schlecht of [undefined, ""]) assert.throws(() => roh.festgefahrenAusAntwort(antwort, [1], schlecht), /Label-Namen/);
  });
  test("abgeschnittene Seite, fehlender PR, fehlende pageInfo und fehlendes repository sind Datenfehler", () => {
    const seite = { data: { repository: { p1: { timelineItems: { pageInfo: { hasNextPage: true }, nodes: [] } } } } };
    assert.throws(() => mod.festgefahrenAusAntwort(seite, [1]), (e: Error) => e instanceof mod.DatenFehler && /abgeschnitten/.test(e.message));
    assert.throws(() => mod.festgefahrenAusAntwort({ data: { repository: { p1: null } } }, [1]), mod.DatenFehler);
    assert.throws(() => mod.festgefahrenAusAntwort({ data: { repository: { p1: { timelineItems: { nodes: [] } } } } }, [1]), mod.DatenFehler);
    assert.throws(() => mod.festgefahrenAusAntwort({ errors: [{ message: "x" }] }, [1]), mod.DatenFehler);
  });
});

describe("laufErgebnis (git und gh injiziert)", () => {
  const liste = [pr({ headRefName: `${BRANCH}40-a&b#c+d` })];
  const log = `${SHA}\x1f${MERGED}\x1f${review("runden=1 lenses=doku")}\x1e`;
  type Opt = { seit?: string; liste?: unknown[]; fehler?: string; laeufe?: string; label?: (nummern: number[]) => unknown; aufrufe?: string[][]; offen?: unknown[]; kommentare?: Record<number, unknown[]> };
  /** gh-Stub: `pr list`, die EINE paginierte Läufe-Abfrage und GraphQL-Label-Events (Standard: ein festgefahren-Label je PR). */
  const gh = (o: Opt = {}) => (a: string[]): string => {
    o.aufrufe?.push(a);
    if (o.fehler && a.join(" ").includes(o.fehler)) throw new Error("gh kaputt");
    if (a[0] === "pr" && a.includes("open")) return JSON.stringify(o.offen ?? []);
    if (a.includes("--slurp")) {
      const nr = Number(/issues\/(\d+)\/comments/.exec(a.join(" "))?.[1]);
      return JSON.stringify([o.kommentare?.[nr] ?? []]);
    }
    if (a[0] === "pr") {
      assert.ok(a.includes("--base") && a.includes("main"), "nur PRs nach main");
      return JSON.stringify(o.liste ?? liste);
    }
    if (a.join(" ").includes("actions/workflows")) {
      const pfad = a.find((x) => x.includes("actions/workflows")) ?? "";
      assert.ok(a.includes("--paginate") && pfad.includes("status=failure") && pfad.includes("event=pull_request"), "nur rote PR-Läufe, paginiert");
      assert.ok(pfad.includes(`created=%3E%3D${o.seit ?? "2026-10-01"}`), "Zeitfilter ab dem frühesten PR");
      assert.ok(!pfad.includes("branch="), "keine Abfrage je Branch");
      return o.laeufe ?? `${BRANCH}40-a&b#c+d\tx\t2026-10-01T10:30:00Z\n${BRANCH}40-a&b#c+d\tx\t2026-10-01T10:31:00Z\nfremder/branch\ty\t2026-10-01T10:32:00Z\n`;
    }
    assert.equal(a[1], "graphql");
    assert.ok(a.includes("owner={owner}") && a.includes("name={repo}"));
    const query = a.find((x) => x.startsWith("query=")) ?? "";
    const nummern = [...query.matchAll(/p(\d+): pullRequest/g)].map((m) => Number(m[1]));
    if (o.label) return JSON.stringify(o.label(nummern));
    const repository = Object.fromEntries(
      nummern.map((n) => [`p${n}`, { timelineItems: { pageInfo: { hasNextPage: false }, nodes: [{ createdAt: "2026-10-01T10:45:00Z", label: { name: LABEL } }] } }]),
    );
    return JSON.stringify({ data: { repository } });
  };
  const git = (l: string) => (a: string[]): string => {
    assert.equal(a[0], "log");
    assert.ok(a.includes("origin/main"));
    return l;
  };
  const von = "2026-10-01T00:00:00Z";
  const bis = "2026-10-02T00:00:00Z";

  test("Orchestrierung: ein PR, CI-Läufe dedupliziert und nur der eigene Branch, festgefahren gezählt", () => {
    const e = mod.laufErgebnis({ von, bis, runGit: git(log), runGh: gh(), jetzt: SPAETER });
    assert.equal(e.zeilen.length, 1);
    assert.equal(e.zeilen[0].ciFix, 1);
    assert.equal(e.zeilen[0].festgefahren, 1);
    assert.equal(e.zeilen[0].runden, 1);
  });
  test("Config injiziert (#1741): ein anderes Präfix lässt die Zeile des Config-Präfixes im Squash-Commit nicht zählen, das Label kommt aus der Config", () => {
    const config = (praefix: string, label: string) => () => ({ praefixe: { commitZeile: praefix }, agenten: { planer: PLANER }, labels: { festgefahren: label } });
    const kq = mod.laufErgebnis({ von, bis, runGit: git(log), runGh: gh(), jetzt: SPAETER, ladeConfig: config(FREMD.praefixe.commitZeile, LABEL) });
    assert.equal(kq.zeilen[0].runden, 1);
    assert.equal(kq.zeilen[0].festgefahren, 1);
    const ab = mod.laufErgebnis({ von, bis, runGit: git(log), runGh: gh(), jetzt: SPAETER, ladeConfig: config("AB-", "anderes:label") });
    assert.equal(ab.zeilen[0].runden, null, "Zeilen des Config-Präfixes zählen bei AB- nicht");
    assert.equal(ab.zeilen[0].festgefahren, 0, "ein anderes Label zählt das festgefahren-Label nicht");
    assert.equal(ab.kennzahlen.ohneNachweis, 1);
  });
  test("ohne injizierte Config gilt die echte Projekt-Config (Standard von ladeConfig), in beiden Einstiegen", () => {
    const echt = projektConfig();
    const ZE = commitZeilen(echt.praefixe.commitZeile, echt.agenten.planer);
    const body = `feat: y (#40) (#50)\n\n${ZE.plan}: ${echt.agenten.planer}\n${ZE.review}: head=${"a".repeat(40)} runden=1 lenses=doku verdikt=ok`;
    const echtLog = `${SHA}\x1f${MERGED}\x1f${body}\x1e`;
    assert.equal(roh.laufErgebnis({ von, bis, runGit: git(echtLog), runGh: gh(), jetzt: SPAETER }).zeilen[0].runden, 1);
    const lauf40 = { meta: { agentType: "x-agent" }, zeilen: [{ type: "user", timestamp: "2026-10-01T00:00:01Z", message: { role: "user", content: "Ticket #40: x" } }] };
    assert.equal(roh.laufErgebnisStartAgent({ laeufe: [lauf40], von, bis, runGit: git(echtLog), runGh: gh(), jetzt: SPAETER }).zeilen[0].runden, 1);
    assert.equal(roh.laufErgebnis({ von, bis, runGit: git(echtLog), runGh: gh(), jetzt: SPAETER, ladeConfig: () => FREMD }).zeilen[0].runden, null, "mit der Fremd-Config zählt die Zeile der echten nicht");
  });
  test("ein Ladefehler der Config bricht ab, ohne git oder gh zu fragen", () => {
    const nie = () => {
      throw new Error("darf nicht aufgerufen werden");
    };
    assert.throws(
      () =>
        mod.laufErgebnis({
          von,
          bis,
          runGit: nie,
          runGh: nie,
          ladeConfig: () => {
            throw new Error("Projekt-Config ungültig: praefixe.commitZeile");
          },
        }),
      /praefixe\.commitZeile/,
    );
  });
  test("Negativfall: eine Config ohne labels.festgefahren bricht ab (auch bei leerer Menge), ohne git oder gh zu fragen", () => {
    const nie = () => {
      throw new Error("darf nicht aufgerufen werden");
    };
    const ohneLabel = () => ({ praefixe: { commitZeile: FREMD.praefixe.commitZeile }, agenten: { planer: PLANER }, labels: {} });
    assert.throws(() => mod.laufErgebnis({ von, bis, runGit: nie, runGh: nie, ladeConfig: ohneLabel }), /labels\.festgefahren/);
    assert.throws(() => mod.laufErgebnisStartAgent({ laeufe: [], von, bis, runGit: nie, runGh: nie, ladeConfig: ohneLabel }), /labels\.festgefahren/);
  });
  test("Negativfall: laufErgebnisStartAgent ohne vollständige Ticket-Namen bricht ab, ohne git oder gh zu fragen (#1821 L12)", () => {
    const nie = () => {
      throw new Error("darf nicht aufgerufen werden");
    };
    const ohneWorktree = () => ({ praefixe: { commitZeile: FREMD.praefixe.commitZeile }, agenten: { planer: PLANER }, labels: { festgefahren: LABEL } });
    assert.throws(() => mod.laufErgebnisStartAgent({ laeufe: [], von, bis, runGit: nie, runGh: nie, ladeConfig: ohneWorktree }), /praefixe\.worktree/);
  });
  test("Besitzer aus repo der Config (#1821 L20): ohne repo undefined (Abnahme-Marker nicht prüfbar), kaputtes repo wirft mit Fix-Zeile", () => {
    const nie = () => {
      throw new Error("darf nicht aufgerufen werden");
    };
    const mitRepo = (repo: unknown) => () => ({ repo, praefixe: { commitZeile: FREMD.praefixe.commitZeile }, agenten: { planer: PLANER }, labels: { festgefahren: LABEL } });
    for (const kaputt of ["x", "a/b/c", "", "/b"]) {
      assert.throws(() => mod.laufErgebnis({ von, bis, runGit: nie, runGh: nie, ladeConfig: mitRepo(kaputt) }), /owner\/name[\s\S]*Fix:/, kaputt);
    }
    assert.doesNotThrow(() => mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh({ liste: [] }), ladeConfig: mitRepo("o/n") }));
  });
  test("ohne PRs keine weiteren gh-Aufrufe (nur die Liste)", () => {
    const aufrufe: string[][] = [];
    const e = mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh({ liste: [], aufrufe }), jetzt: SPAETER });
    assert.equal(e.zeilen.length, 0);
    assert.equal(aufrufe.length, 2, "die Liste gemergter PRs und die der offenen Hand-off-PRs");
  });
  describe("offene Hand-off-PRs (#1814 L9)", () => {
    const H = "a".repeat(40);
    const marker = (d: number) => `<!-- ${abnahmeMarker(Z)} durchgang=${d} head=${H} urteil=K1:erfuellt -->`;
    const offenPr = (o: Record<string, unknown> = {}) => ({ number: 70, title: "feat(x): y (#41)", createdAt: "2026-10-01T10:00:00Z", closingIssuesReferences: [{ number: 41 }], ...o });
    const vertraut = { login: FREMD_OWNER, type: "User" };
    const kommentar = (body: string, user: unknown = vertraut) => ({ body, user });
    const offen = (o: Opt, extra: Record<string, unknown> = {}) =>
      mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh(o), jetzt: SPAETER, ...extra }).kennzahlen.abnahmeFix as { mitFix: number; offenMitFix: number };
    const zeile = (o: Opt, extra: Record<string, unknown> = {}) => mod.formatiere(mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh(o), jetzt: SPAETER, ...extra }));
    test("offener Festgefahren-PR mit Durchgang 2 zählt in offenMitFix, nicht in mitFix; die Abfrage filtert nach dem Label der Config", () => {
      const aufrufe: string[][] = [];
      const a = offen({ liste: [], aufrufe, offen: [offenPr()], kommentare: { 70: [kommentar(marker(1)), kommentar(marker(2))] } }, { owner: FREMD_OWNER });
      assert.deepEqual(a, { mitFix: 0, mitFixUndFestgefahren: 0, offenMitFix: 1 });
      const liste = aufrufe.find((x) => x[0] === "pr" && x.includes("open")) ?? [];
      assert.equal(liste[liste.indexOf("--label") + 1], LABEL);
      assert.match(zeile({ liste: [], offen: [offenPr()], kommentare: { 70: [kommentar(marker(2))] } }, { owner: FREMD_OWNER }), /offen \(Hand-off, nicht gemergt\): 1/);
    });
    test("Negativfälle: nur Durchgang 1, Hand-off-Marker, fremder Autor, außerhalb des Fensters, Ticketfilter und kein Treffer zählen 0", () => {
      const k = (...c: unknown[]) => ({ 70: c });
      assert.equal(offen({ liste: [], offen: [offenPr()], kommentare: k(kommentar(marker(1))) }, { owner: FREMD_OWNER }).offenMitFix, 0);
      assert.equal(offen({ liste: [], offen: [offenPr()], kommentare: k(kommentar(`<!-- ${abnahmeMarker(Z)}-handoff -->`), kommentar(marker(1))) }, { owner: FREMD_OWNER }).offenMitFix, 0);
      assert.equal(offen({ liste: [], offen: [offenPr()], kommentare: k(kommentar(marker(2), { login: "fremd", type: "User" })) }, { owner: FREMD_OWNER }).offenMitFix, 0);
      assert.equal(offen({ liste: [], offen: [offenPr({ createdAt: "2026-09-01T00:00:00Z" })], kommentare: k(kommentar(marker(2))) }, { owner: FREMD_OWNER }).offenMitFix, 0);
      assert.equal(offen({ liste: [], offen: [offenPr()], kommentare: k(kommentar(marker(2))) }, { owner: FREMD_OWNER, ohne: [41] }).offenMitFix, 0);
      assert.equal(offen({ liste: [], offen: [offenPr()], kommentare: k(kommentar(marker(2))) }, { owner: FREMD_OWNER, tickets: [99] }).offenMitFix, 0);
      assert.equal(offen({ liste: [], offen: [] }, { owner: FREMD_OWNER }).offenMitFix, 0);
      assert.match(zeile({ liste: [], offen: [] }), /offen \(Hand-off, nicht gemergt\): 0/);
    });
    test("gh-Fehler bei Liste oder Kommentaren ist ein Datenfehler, keine stille 0", () => {
      const lauf = (o: Opt) => () => mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh(o), owner: FREMD_OWNER });
      assert.throws(lauf({ liste: [], fehler: "--state open" }), mod.DatenFehler);
      assert.throws(lauf({ liste: [], offen: [offenPr()], fehler: "/comments" }), mod.DatenFehler);
      assert.throws(() => mod.laufErgebnis({ von, bis, runGit: git(""), runGh: (a) => (a.includes("open") ? "kein json" : gh({ liste: [] })(a)), owner: FREMD_OWNER }), mod.DatenFehler);
    });
    test("Guards der Zählung: Nicht-Liste, abgeschnittene Liste und beide Fenstergrenzen", () => {
      const lauf = (o: Opt) => () => mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh(o), owner: FREMD_OWNER });
      assert.throws(lauf({ liste: [], offen: {} as unknown as unknown[] }), /keine Liste/);
      const voll = Array.from({ length: 1000 }, (_, i) => offenPr({ number: 1000 + i }));
      assert.throws(lauf({ liste: [], offen: voll }), /abgeschnitten/);
      assert.doesNotThrow(lauf({ liste: [], offen: voll.slice(1) }), "999 Einträge liegen unter dem Limit (#1821 L23a)");
      const k = { 70: [kommentar(marker(2))] };
      const zaehle = (createdAt: string) => offen({ liste: [], offen: [offenPr({ createdAt })], kommentare: k }, { owner: FREMD_OWNER }).offenMitFix;
      assert.equal(zaehle(von), 1, "untere Grenze gehört zum Fenster");
      assert.equal(zaehle(bis), 1, "obere Grenze gehört zum Fenster");
      assert.equal(zaehle("2026-10-02T00:00:01Z"), 0, "nach dem Fenster zählt nicht");
      assert.equal(zaehle("2026-09-30T23:59:59Z"), 0, "vor dem Fenster zählt nicht");
    });
    test("Besitzer kommt aus repo der Config; fehlt er bei einem Treffer im Fenster, ist das ein Datenfehler (fail-closed)", () => {
      const o: Opt = { liste: [], offen: [offenPr()], kommentare: { 70: [kommentar(marker(2))] } };
      const conf = (repo?: unknown) => () => ({ praefixe: { commitZeile: FREMD.praefixe.commitZeile }, agenten: { planer: PLANER }, labels: { festgefahren: LABEL }, ...(repo === undefined ? {} : { repo }) });
      const lauf = (c: () => unknown) => mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh(o), jetzt: SPAETER, ladeConfig: c });
      assert.equal((lauf(conf(`${FREMD_OWNER}/x`)).kennzahlen.abnahmeFix as { offenMitFix: number }).offenMitFix, 1);
      assert.equal((lauf(conf("anderer/x")).kennzahlen.abnahmeFix as { offenMitFix: number }).offenMitFix, 0, `Autor ${FREMD_OWNER} ist dann nicht vertraut`);
      const mitArg = mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh(o), jetzt: SPAETER, ladeConfig: conf("anderer/x"), owner: FREMD_OWNER });
      assert.equal((mitArg.kennzahlen.abnahmeFix as { offenMitFix: number }).offenMitFix, 1, "das owner-Argument hat Vorrang vor der Config (#1821 L23a)");
      assert.throws(() => lauf(conf()), /Besitzer/);
      assert.throws(() => lauf(conf(42)), /owner\/name/); // kaputtes repo: wirft schon beim Zerlegen
      const leer = { liste: [], offen: [] };
      assert.doesNotThrow(() => mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh(leer), jetzt: SPAETER, ladeConfig: conf() }));
    });
  });
  test.each([3, 50, 51, 60])("gh-Aufrufe wachsen nicht je PR: bei %i PRs höchstens 2 + 1 + ⌈N/50⌉", (n) => {
    const prs = Array.from({ length: n }, (_, i) => pr({ number: 100 + i, mergeCommit: { oid: `${(i + 1).toString(16).padStart(40, "0")}` }, headRefName: `${BRANCH}${i}` }));
    const viele = prs.map((p) => `${p.mergeCommit.oid}\x1f${MERGED}\x1f${review("runden=1 lenses=doku")}\x1e`).join("");
    const aufrufe: string[][] = [];
    const e = mod.laufErgebnis({ von, bis, runGit: git(viele), runGh: gh({ liste: prs, aufrufe }), jetzt: SPAETER });
    assert.equal(e.zeilen.length, n);
    assert.ok(aufrufe.length <= 3 + Math.ceil(n / 50), `${aufrufe.length} Aufrufe bei ${n} PRs`);
    assert.ok(e.zeilen.every((z) => z.festgefahren === 1), "jeder PR bekommt sein eigenes Label-Ergebnis");
  });
  test("rote Läufe zweier PRs werden dem richtigen Branch zugeordnet", () => {
    const prs = [pr({ number: 50, headRefName: "feature/a" }), pr({ number: 51, headRefName: "feature/b", mergeCommit: { oid: "1".repeat(40) } })];
    const zwei = `${SHA}\x1f${MERGED}\x1f${review("runden=1 lenses=doku")}\x1e${"1".repeat(40)}\x1f${MERGED}\x1f${review("runden=1 lenses=doku")}\x1e`;
    const laeufe = "feature/a\tx\t2026-10-01T10:30:00Z\nfeature/b\ty\t2026-10-01T10:31:00Z\nfeature/b\tz\t2026-10-01T10:32:00Z\n";
    const e = mod.laufErgebnis({ von, bis, runGit: git(zwei), runGh: gh({ liste: prs, laeufe }), jetzt: SPAETER });
    assert.deepEqual(e.zeilen.map((z) => [z.pr, z.ciFix]), [[50, 1], [51, 2]]);
  });
  test("Zeitfilter ab dem FRÜHESTEN PR-Datum: ein roter Lauf des älteren PRs bleibt in der Abfrage und in seinem ciFix (Z3c)", () => {
    const prs = [
      pr({ number: 51, headRefName: "feature/neu", createdAt: "2026-10-01T10:00:00Z", mergeCommit: { oid: "1".repeat(40) } }),
      pr({ number: 50, headRefName: "feature/alt", createdAt: "2026-09-30T08:00:00Z" }), // bewusst nicht aufsteigend
    ];
    const zwei = `${SHA}\x1f${MERGED}\x1f${review("runden=1 lenses=doku")}\x1e${"1".repeat(40)}\x1f${MERGED}\x1f${review("runden=1 lenses=doku")}\x1e`;
    const laeufe = "feature/alt\told\t2026-09-30T10:30:00Z\nfeature/neu\tneu\t2026-10-01T10:30:00Z\n";
    const e = mod.laufErgebnis({ von: "2026-09-30T00:00:00Z", bis, runGit: git(zwei), runGh: gh({ liste: prs, laeufe, seit: "2026-09-30" }), jetzt: SPAETER });
    assert.deepEqual(e.zeilen.map((z) => [z.pr, z.ciFix]), [[50, 1], [51, 1]]);
  });
  describe("Ticketfilter --ticket/--ohne", () => {
    const drei = [
      pr({ number: 50, headRefName: "feature/a", closingIssuesReferences: [{ number: 40 }] }),
      pr({ number: 51, headRefName: "feature/b", closingIssuesReferences: [{ number: 41 }], mergeCommit: { oid: "1".repeat(40) } }),
      pr({ number: 52, headRefName: "feature/c", title: "chore: ohne Ticket", closingIssuesReferences: [], mergeCommit: { oid: "2".repeat(40) } }),
    ];
    const sep = String.fromCharCode(31);
    const ende = String.fromCharCode(30);
    const dreiLog = [SHA, "1".repeat(40), "2".repeat(40)].map((s) => [s, MERGED, review("runden=1 lenses=doku") + ende].join(sep)).join("");
    const lauf = (extra: { tickets?: number[]; ohne?: number[] }, aufrufe: string[][] = []) =>
      mod.laufErgebnis({ von, bis, runGit: git(dreiLog), runGh: gh({ liste: drei, aufrufe }), jetzt: SPAETER, ...extra });
    test("ohne Filter alle, --ticket nur die genannten, --ohne alle außer den genannten (auch PRs ohne Ticket)", () => {
      assert.deepEqual(lauf({}).zeilen.map((z) => z.pr), [50, 51, 52]);
      assert.deepEqual(lauf({ tickets: [41, 40] }).zeilen.map((z) => z.pr), [50, 51]);
      assert.deepEqual(lauf({ ohne: [40] }).zeilen.map((z) => z.pr), [51, 52]);
      assert.deepEqual(lauf({ tickets: [40, 41], ohne: [41] }).zeilen.map((z) => z.pr), [50]);
      assert.deepEqual(lauf({ tickets: [999] }).zeilen, []);
    });
    test("der Filter greift vor den gh-Aufrufen: die Label-Abfrage nennt nur die Teilmenge, ohne Treffer bleibt es bei der Liste", () => {
      const aufrufe: string[][] = [];
      lauf({ tickets: [41] }, aufrufe);
      const query = aufrufe.map((a) => a.find((x) => x.startsWith("query=")) ?? "").join("");
      assert.ok(query.includes("p51:") && !query.includes("p50:") && !query.includes("p52:"), query);
      const leer: string[][] = [];
      lauf({ tickets: [999] }, leer);
      assert.equal(leer.length, 2, "Liste gemergter plus Liste offener PRs, sonst nichts");
    });
    test("parseArgs: wiederholbare --ticket/--ohne, Nicht-Ganzzahl ist ein Aufruf-Fehler", () => {
      assert.deepEqual(mod.parseArgs(["--von", "a", "--bis", "b", "--ticket", "1", "--ticket", "2", "--ohne", "3", "--json"]), { von: "a", bis: "b", tickets: [1, 2], ohne: [3], json: true, fehler: null });
      for (const kaputt of [["--ticket", "abc"], ["--ohne", "1.5"], ["--ticket"], ["--ohne", "-2"], ["--ticket", ""]]) {
        assert.match(mod.parseArgs(kaputt).fehler ?? "", /erwartet eine Ticketnummer/, kaputt.join(" "));
      }
    });
  });
  describe("--start-agent: PR-Menge aus dem ersten Lauf je Ticket (#1646)", () => {
    const drei = [
      pr({ number: 50, headRefName: "feature/a", closingIssuesReferences: [{ number: 40 }] }),
      pr({ number: 51, headRefName: "feature/b", closingIssuesReferences: [{ number: 41 }], mergeCommit: { oid: "1".repeat(40) } }),
      pr({ number: 52, headRefName: "feature/c", title: "chore: ohne Ticket", closingIssuesReferences: [], mergeCommit: { oid: "2".repeat(40) } }),
    ];
    const sep = String.fromCharCode(31);
    const ende = String.fromCharCode(30);
    const dreiLog = [SHA, "1".repeat(40), "2".repeat(40)].map((s) => [s, MERGED, review("runden=1 lenses=doku") + ende].join(sep)).join("");
    const t0 = Date.parse(von);
    const lauf1 = (ticket: number | null, start: number) => ({
      meta: { agentType: "x-agent" },
      zeilen: [{ type: "user", timestamp: new Date(start).toISOString(), message: { role: "user", content: ticket === null ? "ohne Nummer" : `Ticket #${ticket}: x` } }],
    });
    const start = (laeufe: unknown[], extra: { ohne?: number[]; ladeConfig?: () => unknown } = {}, aufrufe: string[][] = []) =>
      mod.laufErgebnisStartAgent({ laeufe, von, bis, runGit: git(dreiLog), runGh: gh({ liste: drei, aufrufe }), jetzt: SPAETER, ...extra });
    test("nur PRs von Tickets mit erstem Start im Fenster; PRs ohne Ticket fallen heraus", () => {
      assert.deepEqual(start([lauf1(41, t0 + 1000)]).zeilen.map((z) => z.pr), [51]);
      assert.deepEqual(start([lauf1(40, t0 + 1), lauf1(41, t0 + 2)]).zeilen.map((z) => z.pr), [50, 51]);
    });
    test("Start vor von fällt heraus, Start genau auf bis zählt, auch bei späterem zweitem Lauf", () => {
      assert.deepEqual(start([lauf1(40, t0 - 1), lauf1(40, t0 + 5), lauf1(41, Date.parse(bis))]).zeilen.map((z) => z.pr), [51]);
    });
    test("leere Menge ergibt 0 PRs statt aller (leere tickets hießen sonst alle) und ruft gh nicht auf", () => {
      const aufrufe: string[][] = [];
      for (const laeufe of [[lauf1(40, t0 - 10)], [lauf1(null, t0 + 1)]]) {
        const e = start(laeufe, {}, aufrufe);
        assert.deepEqual(e.zeilen, []);
        assert.equal(e.kennzahlen.prs, 0);
      }
      assert.equal(aufrufe.length, 0);
    });
    test("ladeConfig (#1741): ein Ladefehler bricht auch bei leerer Menge ab, und das Präfix der Config gilt für die Tickets", () => {
      const wirft = () => {
        throw new Error("Projekt-Config ungültig: praefixe.commitZeile");
      };
      assert.throws(() => start([lauf1(40, t0 - 10)], { ladeConfig: wirft }), /praefixe\.commitZeile/);
      assert.throws(() => start([lauf1(40, t0 + 1)], { ladeConfig: wirft }), /praefixe\.commitZeile/);
      // Die Läufe werden mit den Ticket-Namen der Config zugeordnet (ticketNamen): die Config ist vollständig, nur die Commit-Zeile weicht ab.
      const ab = () => ({ ...FREMD, praefixe: { ...FREMD.praefixe, commitZeile: "AB-" }, labels: { festgefahren: LABEL } });
      const e = start([lauf1(40, t0 + 1)], { ladeConfig: ab });
      assert.equal(e.zeilen[0].runden, null, "Zeilen des Config-Präfixes zählen bei AB- nicht");
      assert.equal(e.kennzahlen.ohneNachweis, 1);
    });
    test("Ticket-Namen aus der Config (#1745): der Worktree-Pfad mit dem Präfix der Config ordnet den Lauf zu, mit einer anderen Config nicht", () => {
      const imWorktree = { meta: { agentType: "x-agent" }, zeilen: [{ type: "user", timestamp: new Date(t0 + 1).toISOString(), message: { role: "user", content: "Arbeit in C:/r/.claude/worktrees/ab-40/src" } }] };
      const namen = (worktree: string) => () => ({ ...FREMD, praefixe: { ...FREMD.praefixe, worktree }, labels: { festgefahren: LABEL } });
      assert.deepEqual(start([imWorktree], { ladeConfig: namen("ab-") }).zeilen.map((z) => z.pr), [50]);
      assert.deepEqual(start([imWorktree], { ladeConfig: namen(FREMD.praefixe.worktree) }).zeilen, []);
    });
    test("--ohne bleibt kombinierbar", () => {
      assert.deepEqual(start([lauf1(40, t0 + 1), lauf1(41, t0 + 2)], { ohne: [41] }).zeilen.map((z) => z.pr), [50]);
    });
    test("ladeStartLaeufe: fehlender Ordner und kein Lauf des Typs sind ein Datenfehler (fail-closed)", () => {
      assert.throws(() => mod.ladeStartLaeufe(join(tmpdir(), "gibt-es-nicht-1646"), "x-agent", von), (e: Error) => e instanceof mod.DatenFehler && /Transkript/.test(e.message));
      const dir = mkdtempSync(join(tmpdir(), "lauf-ergebnis-1646-"));
      try {
        assert.throws(() => mod.ladeStartLaeufe(dir, "x-agent", von), mod.DatenFehler);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    test("ladeStartLaeufe: lädt einen Vorgänger 30 h vor `von` (Vorlauf 48 h), nicht aber 60 h davor", () => {
      const dir = mkdtempSync(join(tmpdir(), "lauf-ergebnis-1646-vorlauf-"));
      try {
        const sub = join(dir, "s1", "subagents");
        mkdirSync(sub, { recursive: true });
        for (const [name, stunden] of [["a-alt", 60], ["a-neu", 30]] as const) {
          writeFileSync(join(sub, `${name}.meta.json`), JSON.stringify({ agentType: "x-agent" }));
          writeFileSync(join(sub, `${name}.jsonl`), "");
          const t = new Date(Date.parse(von) - stunden * 3600_000);
          utimesSync(join(sub, `${name}.jsonl`), t, t);
        }
        const geladen = mod.ladeStartLaeufe(dir, "x-agent", von) as { datei: string; session: string }[];
        assert.deepEqual(geladen.map((l) => l.datei), ["s1/subagents/a-neu.jsonl"]);
        assert.deepEqual(geladen.map((l) => l.session), ["s1"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    test("ladeStartLaeufe: Grenze des Vorlaufs: 47:59 h vor `von` wird geladen, 48:01 h nicht", () => {
      const dir = mkdtempSync(join(tmpdir(), "lauf-ergebnis-1663-grenze-"));
      try {
        const sub = join(dir, "s1", "subagents");
        mkdirSync(sub, { recursive: true });
        for (const [name, sekunden] of [["a-knapp-drin", 48 * 3600 - 60], ["a-knapp-draussen", 48 * 3600 + 60]] as const) {
          writeFileSync(join(sub, `${name}.meta.json`), JSON.stringify({ agentType: "x-agent" }));
          writeFileSync(join(sub, `${name}.jsonl`), "");
          const t = new Date(Date.parse(von) - sekunden * 1000);
          utimesSync(join(sub, `${name}.jsonl`), t, t);
        }
        const geladen = mod.ladeStartLaeufe(dir, "x-agent", von) as { datei: string }[];
        assert.deepEqual(geladen.map((l) => l.datei), ["s1/subagents/a-knapp-drin.jsonl"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    test("ladeStartLaeufe: ein nicht lesbarer Projektordner (Datei statt Ordner) ist ein Datenfehler", () => {
      const dir = mkdtempSync(join(tmpdir(), "lauf-ergebnis-1646-datei-"));
      try {
        const datei = join(dir, "keinordner");
        writeFileSync(datei, "x");
        assert.throws(() => mod.ladeStartLaeufe(datei, "x-agent", von), (e: Error) => e instanceof mod.DatenFehler && /nicht lesbar/.test(e.message));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    test("parseArgs: --start-agent ohne Default, mit --ticket ein Aufruf-Fehler, mit --ohne ok, ohne Wert ein Fehler", () => {
      assert.equal(mod.parseArgs(["--von", "a", "--bis", "b"]).startAgent, undefined);
      assert.equal(mod.parseArgs(["--von", "a", "--bis", "b", "--start-agent", "x-agent", "--ohne", "3"]).startAgent, "x-agent");
      assert.deepEqual(mod.parseArgs(["--start-agent", "x-agent", "--ohne", "3"]).ohne, [3]);
      assert.equal(mod.parseArgs(["--start-agent", "x-agent", "--ohne", "3"]).fehler, null);
      assert.match(mod.parseArgs(["--start-agent", "x-agent", "--ticket", "3"]).fehler ?? "", /--start-agent.*--ticket/);
      for (const kaputt of [["--start-agent"], ["--start-agent", "--json"], ["--start-agent", ""]]) {
        assert.match(mod.parseArgs(kaputt).fehler ?? "", /--start-agent erwartet/, kaputt.join(" "));
      }
    });
  });
  test("API-Kappung bei 1000 roten Läufen ist ein Datenfehler", () => {
    const laeufe = Array.from({ length: 1000 }, (_, i) => `${BRANCH}40-a&b#c+d\tsha${i}\t2026-10-01T10:30:00Z`).join("\n");
    assert.throws(() => mod.laufErgebnis({ von, bis, runGit: git(log), runGh: gh({ laeufe }) }), (e: Error) => e instanceof mod.DatenFehler && /abgeschnitten/.test(e.message));
  });
  test("kaputte GraphQL-Antwort (kein JSON, abgeschnitten) ist ein Datenfehler", () => {
    const kaputt = () => mod.laufErgebnis({ von, bis, runGit: git(log), runGh: (a) => (a[1] === "graphql" ? "kein json" : gh()(a)) });
    assert.throws(kaputt, mod.DatenFehler);
    const mehr = (n: number[]) => ({ data: { repository: Object.fromEntries(n.map((x) => [`p${x}`, { timelineItems: { pageInfo: { hasNextPage: true }, nodes: [] } }])) } });
    assert.throws(() => mod.laufErgebnis({ von, bis, runGit: git(log), runGh: gh({ label: mehr }) }), mod.DatenFehler);
  });
  test("PR mit mergedAt nach dem Fensterende wird ausgefiltert", () => {
    const e = mod.laufErgebnis({ von, bis: "2026-10-01T11:00:00Z", runGit: git(log), runGh: gh(), jetzt: SPAETER });
    assert.equal(e.zeilen.length, 0);
  });
  test("PR außerhalb des Zeitfensters (nach Tag-Suche) wird ausgefiltert", () => {
    const e = mod.laufErgebnis({ von: "2026-10-01T12:30:00Z", bis, runGit: git(log), runGh: gh(), jetzt: SPAETER });
    assert.equal(e.zeilen.length, 0);
  });
  test("lokal fehlender Merge-Commit ist ein Datenfehler (kein stilles 0)", () => {
    assert.throws(() => mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh() }), (err: Error) => err instanceof mod.DatenFehler && /git fetch origin/.test(err.message));
  });
  test("von genau auf der Merge-Zeit: Commit-Datum eine Sekunde früher wird gefunden (--since filtert nach Commit-Datum)", () => {
    // Beobachtet bei #1558: mergedAt 22:23:11, Commit-Datum 22:23:10.
    const merged = new Date(MERGED).getTime();
    const commitDatum = new Date(merged - 1000).toISOString();
    const commitLog = `${SHA}\x1f${commitDatum}\x1f${review("runden=1 lenses=doku")}\x1e`;
    const seitGit = (a: string[]): string => {
      const since = a.find((x) => x.startsWith("--since="))?.slice("--since=".length) ?? "";
      return new Date(commitDatum).getTime() >= new Date(since).getTime() ? commitLog : "";
    };
    const e = mod.laufErgebnis({ von: MERGED, bis, runGit: seitGit, runGh: gh(), jetzt: SPAETER });
    assert.equal(e.zeilen.length, 1);
  });
  test("ein wirklich fehlender Merge-Commit bleibt trotz Puffer ein Datenfehler", () => {
    assert.throws(() => mod.laufErgebnis({ von: MERGED, bis, runGit: () => "", runGh: gh() }), mod.DatenFehler);
  });
  test("abgeschnittene 1000er-Liste ist ein Datenfehler", () => {
    const voll = Array.from({ length: 1000 }, (_, i) => pr({ number: i + 1 }));
    assert.throws(() => mod.laufErgebnis({ von, bis, runGit: git(log), runGh: gh({ liste: voll }) }), (err: Error) => err instanceof mod.DatenFehler && /abgeschnitten/.test(err.message));
  });
  test("gh- und git-Fehler werden zum Datenfehler", () => {
    assert.throws(() => mod.laufErgebnis({ von, bis, runGit: git(log), runGh: gh({ fehler: "graphql" }) }), mod.DatenFehler);
    assert.throws(() => mod.laufErgebnis({ von, bis, runGit: git(log), runGh: gh({ fehler: "actions/workflows" }) }), mod.DatenFehler);
    const kaputtGit = () => {
      throw new Error("kein origin");
    };
    assert.throws(() => mod.laufErgebnis({ von, bis, runGit: kaputtGit, runGh: gh() }), mod.DatenFehler);
  });
});

describe("parseArgs strikt (#1790)", () => {
  test("unbekanntes Flag und doppeltes Einzel-Flag setzen fehler; Rückgabeform bleibt exakt", () => {
    assert.match(mod.parseArgs(["--von", "a", "--bis", "b", "--bogus"]).fehler ?? "", /Unbekanntes Argument: --bogus/);
    assert.match(mod.parseArgs(["--von", "a", "--von", "b"]).fehler ?? "", /--von ist doppelt/);
    assert.match(mod.parseArgs(["--json", "--json"]).fehler ?? "", /--json ist doppelt/);
    assert.match(mod.parseArgs(["--von"]).fehler ?? "", /--von braucht einen Wert/);
    assert.deepEqual(mod.parseArgs([]), { von: undefined, bis: undefined, tickets: [], ohne: [], json: false, fehler: null });
  });
  test("--start-agent mit Wert, doppelt oder mit Inline-Wert", () => {
    assert.match(mod.parseArgs(["--start-agent", "a", "--start-agent", "b"]).fehler ?? "", /--start-agent ist doppelt/);
    assert.equal(mod.parseArgs(["--start-agent=x-agent"]).startAgent, "x-agent");
  });
});
