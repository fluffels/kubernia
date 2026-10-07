/* Ergebnis je Ticket-Lauf (#1123): Nacharbeit, CI-Fix-Runden, Aggregate, IO-Orchestrierung.
 * Pur über synthetische PRs und Commits; die IO-Schicht läuft gegen Stub-Runner für git und gh.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/lauf-ergebnis.mjs";

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
type Zeile = { pr: number; ticket: number | null; runden: number | null; blocker: { lens: string; n: number }[] | null; ciFix: number; festgefahren: number; nacharbeit: string };
type Ergebnis = { zeilen: Zeile[]; kennzahlen: Record<string, unknown> & { brillen: Record<string, { prs: number; treffer: number; summe: number }> } };
const mod = raw as {
  NACHARBEIT_TAGE: number;
  DatenFehler: new (m: string) => Error;
  parseCommits: (log: string) => Commit[];
  ticketVon: (pr: Partial<Pr>) => number | null;
  nacharbeitVon: (e: { pr: number; ticket: number | null; mergeSha: string; mergedAt: string; commits: Commit[]; jetzt: Date }) => string;
  ciFixRunden: (l: { sha: string; createdAt: string }[], von: string, bis: string) => number;
  bewertePrs: (e: { prs: Pr[]; commits: Commit[]; ci: Record<number, { sha: string; createdAt: string }[]>; festgefahren: Record<number, number>; jetzt: Date }) => Ergebnis;
  formatiere: (e: Ergebnis) => string;
  labelAbfrage: (n: number[]) => string;
  festgefahrenAusAntwort: (a: unknown, n: number[]) => Record<number, number>;
  laufErgebnis: (e: { von: string; bis: string; runGit: (a: string[]) => string; runGh: (a: string[]) => string; jetzt?: Date }) => Ergebnis;
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
  headRefName: "feature/kq-40-x",
  closingIssuesReferences: [{ number: 40 }],
  ...o,
});
const nach = (commits: Commit[], jetzt = SPAETER, p = 50, ticket: number | null = 40) =>
  mod.nacharbeitVon({ pr: p, ticket, mergeSha: SHA, mergedAt: MERGED, commits, jetzt });
const review = (felder: string) => `feat: y (#40) (#50)\n\nKQ-Plan: kubernia-planner\nKQ-Review: head=${"a".repeat(40)} ${felder} verdikt=ok`;

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
    assert.deepEqual(k.brillen.architektur, { prs: 2, treffer: 1, summe: 2 });
    assert.deepEqual(k.brillen["test-adaequanz"], { prs: 2, treffer: 1, summe: 1 });
    assert.equal(k.runde1MitBlockerProxy, 2, "runden ≥ 2 über alle PRs mit Nachweis");
    assert.equal(k.mitNachweis, 3);
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
    assert.match(t, /Lens-Trefferquote architektur: 50 % \(1\/2\)/);
    assert.match(t, /ohne KQ-Review-Nachweis: 1/);
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
  test("festgefahrenAusAntwort zählt nur status:festgefahren, auch mehrfach", () => {
    const antwort = { data: { repository: { p1: { timelineItems: knoten("status:festgefahren", "x", "status:festgefahren") }, p2: { timelineItems: knoten("dependencies") } } } };
    assert.deepEqual(mod.festgefahrenAusAntwort(antwort, [1, 2]), { 1: 2, 2: 0 });
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
  const liste = [pr({ headRefName: "feature/kq-40-a&b#c+d" })];
  const log = `${SHA}\x1f${MERGED}\x1f${review("runden=1 lenses=doku")}\x1e`;
  type Opt = { seit?: string; liste?: unknown[]; fehler?: string; laeufe?: string; label?: (nummern: number[]) => unknown; aufrufe?: string[][] };
  /** gh-Stub: `pr list`, die EINE paginierte Läufe-Abfrage und GraphQL-Label-Events (Standard: ein festgefahren-Label je PR). */
  const gh = (o: Opt = {}) => (a: string[]): string => {
    o.aufrufe?.push(a);
    if (o.fehler && a.join(" ").includes(o.fehler)) throw new Error("gh kaputt");
    if (a[0] === "pr") {
      assert.ok(a.includes("--base") && a.includes("main"), "nur PRs nach main");
      return JSON.stringify(o.liste ?? liste);
    }
    if (a.join(" ").includes("actions/workflows")) {
      const pfad = a.find((x) => x.includes("actions/workflows")) ?? "";
      assert.ok(a.includes("--paginate") && pfad.includes("status=failure") && pfad.includes("event=pull_request"), "nur rote PR-Läufe, paginiert");
      assert.ok(pfad.includes(`created=%3E%3D${o.seit ?? "2026-10-01"}`), "Zeitfilter ab dem frühesten PR");
      assert.ok(!pfad.includes("branch="), "keine Abfrage je Branch");
      return o.laeufe ?? `feature/kq-40-a&b#c+d\tx\t2026-10-01T10:30:00Z\nfeature/kq-40-a&b#c+d\tx\t2026-10-01T10:31:00Z\nfremder/branch\ty\t2026-10-01T10:32:00Z\n`;
    }
    assert.equal(a[1], "graphql");
    assert.ok(a.includes("owner={owner}") && a.includes("name={repo}"));
    const query = a.find((x) => x.startsWith("query=")) ?? "";
    const nummern = [...query.matchAll(/p(\d+): pullRequest/g)].map((m) => Number(m[1]));
    if (o.label) return JSON.stringify(o.label(nummern));
    const repository = Object.fromEntries(
      nummern.map((n) => [`p${n}`, { timelineItems: { pageInfo: { hasNextPage: false }, nodes: [{ createdAt: "2026-10-01T10:45:00Z", label: { name: "status:festgefahren" } }] } }]),
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
  test("ohne PRs keine weiteren gh-Aufrufe (nur die Liste)", () => {
    const aufrufe: string[][] = [];
    const e = mod.laufErgebnis({ von, bis, runGit: git(""), runGh: gh({ liste: [], aufrufe }), jetzt: SPAETER });
    assert.equal(e.zeilen.length, 0);
    assert.equal(aufrufe.length, 1);
  });
  test.each([3, 50, 51, 60])("gh-Aufrufe wachsen nicht je PR: bei %i PRs höchstens 1 + 1 + ⌈N/50⌉", (n) => {
    const prs = Array.from({ length: n }, (_, i) => pr({ number: 100 + i, mergeCommit: { oid: `${(i + 1).toString(16).padStart(40, "0")}` }, headRefName: `feature/kq-${i}` }));
    const viele = prs.map((p) => `${p.mergeCommit.oid}\x1f${MERGED}\x1f${review("runden=1 lenses=doku")}\x1e`).join("");
    const aufrufe: string[][] = [];
    const e = mod.laufErgebnis({ von, bis, runGit: git(viele), runGh: gh({ liste: prs, aufrufe }), jetzt: SPAETER });
    assert.equal(e.zeilen.length, n);
    assert.ok(aufrufe.length <= 2 + Math.ceil(n / 50), `${aufrufe.length} Aufrufe bei ${n} PRs`);
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
  test("API-Kappung bei 1000 roten Läufen ist ein Datenfehler", () => {
    const laeufe = Array.from({ length: 1000 }, (_, i) => `feature/kq-40-a&b#c+d\tsha${i}\t2026-10-01T10:30:00Z`).join("\n");
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
