/* Prüfung verwaister Claims (#1699): Urteil je Claim (`beurteileClaim`), Datensammlung und Aufräumen (`fuehreAus`) mit injiziertem git, gh und Dateisystem.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/claims-pruefen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { ticketNamen } from "../../scripts/ticket-namen.mjs";
import { FREMD, projektConfig } from "../support/fremd-config";

const WTP = FREMD.praefixe.worktree;
const BRP = FREMD.praefixe.branch;
const ECHT = projektConfig().praefixe; // Standardpfad ohne `namen`: die Config des Projekts wird je Aufruf geladen
const NAMEN: unknown = (ticketNamen as (c: unknown) => unknown)(FREMD);

interface Claim {
  nr: number;
  viewer: string | null;
  issue: { zustand: string; assignees: string[] } | null;
  prs: { nummer: number; zustand: string; headRefOid: string | null }[];
  lock: null | "unlesbar" | Record<string, unknown>;
  worktree: null | { pfad: string; branch: string | null; sauber: boolean; head: string | null; locked: boolean };
  branch: boolean;
  branchLokal: boolean;
  festgefahren: boolean;
  lebenszeichenMs: number | null;
}
type Urteil = { urteil: string; grund: string; aktion: { worktree: boolean; lock: boolean } };
type Erg = { code: number; out: string; err: string };
const M = raw as unknown as {
  STANDARD_STUNDEN: number;
  parseArgs: (a: string[]) => { json?: boolean; stunden?: number; fehler?: string };
  beurteileClaim: (o: { claim: Claim; jetzt: number; schwelleMs: number }) => Urteil;
  aliasAbfragen: (n: number[], repo?: string) => { nummern: number[]; query: string }[];
  issueAus: (k: unknown) => unknown;
  pfadErlaubt: (o: { pfad: string; hauptcheckout: string; nr: number; namen?: unknown }) => boolean;
  fuehreAus: (argv: string[], deps: Record<string, unknown> | (() => Record<string, unknown>)) => Erg;
  echteDeps: (o?: { config?: unknown }) => { festgefahrenLabel: string; lockDir: string };
};

const H = 60 * 60_000;
const JETZT = Date.UTC(2026, 9, 16, 8, 36, 0);
const SCHWELLE = 3 * H;
const OID = "0bdcea16aaaa";
const WTPFAD = `/h/.claude/worktrees/${WTP}1628`;

const claim = (o: Partial<Claim> = {}): Claim => ({
  nr: 1,
  viewer: "ich",
  issue: { zustand: "OPEN", assignees: ["ich"] },
  prs: [],
  lock: { nonceHash: "h", erstellt: "2026-10-16T00:00:00.000Z" },
  worktree: null,
  branch: false,
  branchLokal: false,
  festgefahren: false,
  lebenszeichenMs: JETZT - 1 * H,
  ...o,
});
const geschlossen = (o: Partial<Claim> = {}): Claim =>
  claim({
    issue: { zustand: "CLOSED", assignees: ["ich"] },
    prs: [{ nummer: 9, zustand: "MERGED", headRefOid: OID }],
    worktree: { pfad: WTPFAD, branch: `${BRP}1-x`, sauber: true, head: OID, locked: false },
    branch: true,
    branchLokal: true,
    lebenszeichenMs: JETZT - 8 * H,
    ...o,
  });
const urteil = (c: Claim, schwelleMs = SCHWELLE) => M.beurteileClaim({ claim: c, jetzt: JETZT, schwelleMs });

describe("beurteileClaim: je Urteil ein Fall", () => {
  test.each<[string, Claim, string]>([
    ["unbekannt: GitHub-Daten fehlen", claim({ issue: null }), "unbekannt"],
    ["lebendig: offen, Lebenszeichen vor 1 h", claim(), "lebendig"],
    ["verwaist: offen mit Lock, Lebenszeichen vor 4 h", claim({ lebenszeichenMs: JETZT - 4 * H }), "verwaist"],
    ["verwaist: offen mit Worktree, kein Lebenszeichen feststellbar", claim({ lock: null, worktree: { pfad: "/x", branch: null, sauber: true, head: null, locked: false }, lebenszeichenMs: null }), "verwaist"],
    ["verwaist: offen, nur ein Branch, Lebenszeichen alt", claim({ lock: null, branch: true, branchLokal: true, lebenszeichenMs: JETZT - 9 * H }), "verwaist"],
    ["ohne-lokale-spur: offen, zugewiesen, nichts lokal", claim({ lock: null }), "ohne-lokale-spur"],
    ["lock-unlesbar", claim({ lock: "unlesbar" }), "lock-unlesbar"],
    ["aufraeumbar: geschlossen, PR gemergt, Worktree sauber, HEAD gleich PR-Kopf", geschlossen(), "aufraeumbar"],
    ["aufraeumbar: geschlossen, Lock ohne Worktree und Branch (auch ohne PR)", geschlossen({ worktree: null, branch: false, prs: [] }), "aufraeumbar"],
    ["aufraeumbar: geschlossen, Lock ohne Worktree, Branch mit gemergtem PR", geschlossen({ worktree: null }), "aufraeumbar"],
    ["behalten: geschlossen, nur Branch, kein Lock", geschlossen({ worktree: null, lock: null }), "behalten"],
  ])("%s", (_name, c, erwartet) => {
    assert.equal(urteil(c).urteil, erwartet);
  });

  test("Grenzfall: Lebenszeichen genau N Stunden alt ist verwaist, eine Millisekunde jünger lebendig", () => {
    assert.equal(urteil(claim({ lebenszeichenMs: JETZT - SCHWELLE })).urteil, "verwaist");
    assert.equal(urteil(claim({ lebenszeichenMs: JETZT - SCHWELLE + 1 })).urteil, "lebendig");
  });

  test("Aktion: Worktree und Lock bei vorhandenem Worktree, nur Lock sonst, ohne Lock nur der Worktree", () => {
    assert.deepEqual(urteil(geschlossen()).aktion, { worktree: true, lock: true });
    assert.deepEqual(urteil(geschlossen({ worktree: null })).aktion, { worktree: false, lock: true });
    assert.deepEqual(urteil(geschlossen({ lock: null })).aktion, { worktree: true, lock: false });
    assert.deepEqual(urteil(claim()).aktion, { worktree: false, lock: false });
  });
});

describe("beurteileClaim: Negativfälle (nie löschen)", () => {
  test("Worktree mit uncommitteten Änderungen (oder unlesbarem Status) bleibt", () => {
    const u = urteil(geschlossen({ worktree: { pfad: WTPFAD, branch: null, sauber: false, head: OID, locked: false } }));
    assert.equal(u.urteil, "behalten");
    assert.match(u.grund, /uncommittet/);
    assert.deepEqual(u.aktion, { worktree: false, lock: false });
  });

  test.each([
    ["kein PR", []],
    ["nur ein offener PR", [{ nummer: 9, zustand: "OPEN", headRefOid: OID }]],
    ["nur ein geschlossener, nicht gemergter PR", [{ nummer: 9, zustand: "CLOSED", headRefOid: OID }]],
  ])("Worktree ohne gemergten PR bleibt (%s)", (_n, prs) => {
    const u = urteil(geschlossen({ prs }));
    assert.equal(u.urteil, "behalten");
    assert.match(u.grund, /ohne gemergten PR/);
  });

  test("Worktree-HEAD ungleich dem PR-Kopf (unveröffentlichte Commits danach) bleibt, auch ohne bekannten HEAD", () => {
    for (const head of ["anderer", null]) {
      const u = urteil(geschlossen({ worktree: { pfad: WTPFAD, branch: null, sauber: true, head, locked: false } }));
      assert.equal(u.urteil, "behalten");
      assert.match(u.grund, /HEAD/);
    }
  });

  test("gesperrter Worktree bleibt", () => {
    const u = urteil(geschlossen({ worktree: { pfad: WTPFAD, branch: null, sauber: true, head: OID, locked: true } }));
    assert.equal(u.urteil, "behalten");
    assert.match(u.grund, /gesperrt/);
  });

  test("Lebenszeichen der letzten 30 min: Worktree bleibt (29 min), nach 30 min räumbar; auch der Lock allein", () => {
    assert.equal(urteil(geschlossen({ lebenszeichenMs: JETZT - 29 * 60_000 })).urteil, "behalten");
    assert.equal(urteil(geschlossen({ lebenszeichenMs: JETZT - 30 * 60_000 })).urteil, "aufraeumbar");
    assert.equal(urteil(geschlossen({ worktree: null, branch: false, prs: [], lebenszeichenMs: JETZT - 29 * 60_000 })).urteil, "behalten");
    assert.equal(urteil(geschlossen({ lebenszeichenMs: null })).urteil, "aufraeumbar");
  });

  test("ein offenes, uraltes Issue wird nie aufgeräumt", () => {
    const u = urteil(claim({ lebenszeichenMs: JETZT - 900 * H, worktree: { pfad: WTPFAD, branch: null, sauber: true, head: OID, locked: false }, prs: [{ nummer: 9, zustand: "MERGED", headRefOid: OID }] }));
    assert.equal(u.urteil, "verwaist");
    assert.deepEqual(u.aktion, { worktree: false, lock: false });
  });

  test("Lock mit Branch, aber ohne gemergten PR bleibt; ein unlesbarer Lock wird nie gelöscht, auch bei geschlossenem Issue", () => {
    assert.equal(urteil(geschlossen({ worktree: null, prs: [] })).urteil, "behalten");
    const u = urteil(geschlossen({ lock: "unlesbar" }));
    assert.equal(u.urteil, "lock-unlesbar");
    assert.deepEqual(u.aktion, { worktree: false, lock: false });
  });

  test("gh-Daten unbekannt: keine Aktion, auch bei sonst räumbarem Stand", () => {
    const u = urteil(geschlossen({ issue: null }));
    assert.equal(u.urteil, "unbekannt");
    assert.deepEqual(u.aktion, { worktree: false, lock: false });
  });

  test("fremder Assignee: keine Wiederaufnahme (behalten); eigene Zuweisung oder keine Zuweisung: verwaist; unbekannter viewer gilt als fremd", () => {
    const alt = { lebenszeichenMs: JETZT - 9 * H };
    assert.equal(urteil(claim({ ...alt, issue: { zustand: "OPEN", assignees: ["andere"] } })).urteil, "behalten");
    assert.equal(urteil(claim({ ...alt, issue: { zustand: "OPEN", assignees: ["ich", "andere"] } })).urteil, "behalten");
    assert.equal(urteil(claim({ ...alt, issue: { zustand: "OPEN", assignees: [] } })).urteil, "verwaist");
    assert.equal(urteil(claim({ ...alt })).urteil, "verwaist");
    assert.equal(urteil(claim({ ...alt, viewer: null })).urteil, "behalten");
  });
});

describe("reine Hilfen", () => {
  test("parseArgs: Standard, --json, --stunden (auch =), ungültige Werte und Unbekanntes", () => {
    assert.deepEqual(M.parseArgs([]), { json: false, stunden: 3 });
    assert.deepEqual(M.parseArgs(["--json", "--stunden", "5"]), { json: true, stunden: 5 });
    assert.deepEqual(M.parseArgs(["--stunden=1.5"]), { json: false, stunden: 1.5 });
    for (const a of [["--stunden", "0"], ["--stunden", "-1"], ["--stunden", "abc"], ["--stunden"], ["--stunden", ""], ["--stunden=Infinity"], ["--unbekannt"]]) {
      assert.ok(M.parseArgs(a).fehler, JSON.stringify(a));
    }
  });

  test("aliasAbfragen: je 40 Nummern eine Abfrage, ungültige Eingaben werfen", () => {
    const n = Array.from({ length: 85 }, (_, i) => i + 1);
    const q = M.aliasAbfragen(n, "o/r");
    assert.deepEqual(q.map((b) => b.nummern.length), [40, 40, 5]);
    assert.match(q[0].query, /viewer\{ login \}/);
    assert.match(q[0].query, /i0: issue\(number: 1\)/);
    assert.match(q[0].query, /includeClosedPrs:true/);
    assert.throws(() => M.aliasAbfragen([1.5], "o/r"));
    assert.throws(() => M.aliasAbfragen([0], "o/r"));
    assert.throws(() => M.aliasAbfragen([1], "kaputt"));
    assert.deepEqual(M.aliasAbfragen([], "o/r"), []);
  });

  test("issueAus: unbekanntes Issue ist null, sonst Zustand, Assignees und PRs", () => {
    assert.equal(M.issueAus(null), null);
    assert.equal(M.issueAus({}), null);
    assert.deepEqual(
      M.issueAus({ state: "CLOSED", labels: { nodes: [{ name: "l" }] }, assignees: { nodes: [{ login: "a" }] }, closedByPullRequestsReferences: { nodes: [{ number: 3, state: "MERGED", headRefOid: "x", labels: { nodes: [{ name: "pl" }] } }] } }),
      { zustand: "CLOSED", assignees: ["a"], labels: ["l"], prs: [{ nummer: 3, zustand: "MERGED", headRefOid: "x", labels: ["pl"] }] },
    );
  });

  test("issueAus: fehlende Felder ergeben leere Listen und headRefOid null", () => {
    assert.deepEqual(M.issueAus({ state: "OPEN" }), { zustand: "OPEN", assignees: [], labels: [], prs: [] });
    assert.deepEqual(M.issueAus({ state: "OPEN", closedByPullRequestsReferences: { nodes: [{ number: 3, state: "MERGED" }] } }), {
      zustand: "OPEN",
      assignees: [],
      labels: [],
      prs: [{ nummer: 3, zustand: "MERGED", headRefOid: null, labels: [] }],
    });
  });

  test("aliasAbfragen: das Repo muss genau owner/name sein (Anker an beiden Enden, kein Zusatz in der Abfrage)", () => {
    for (const repo of ['o/r"x', "o/r/x", "x o/r", "o/r y", "/r", "o/"]) assert.throws(() => M.aliasAbfragen([1], repo), /Ungültiges Repo/, repo);
    assert.doesNotThrow(() => M.aliasAbfragen([1], "my-o.rg/re_po.x"));
  });

  test("pfadErlaubt ohne namen: gilt das Präfix der Projekt-Config, ein fremdes Präfix nicht", () => {
    assert.equal(M.pfadErlaubt({ pfad: `/h/.claude/worktrees/${ECHT.worktree}1628`, hauptcheckout: "/h", nr: 1628 }), true);
    assert.equal(M.pfadErlaubt({ pfad: `/h/.claude/worktrees/${WTP}1628`, hauptcheckout: "/h", nr: 1628 }), false);
  });

  test("pfadErlaubt: nur direkt unter <Hauptcheckout>/.claude/worktrees und mit passender Nummer; nie ein Lens-Worktree", () => {
    const ok = (pfad: string, nr = 1628) => M.pfadErlaubt({ pfad, hauptcheckout: "/h", nr, namen: NAMEN });
    assert.equal(ok(`/h/.claude/worktrees/${WTP}1628`), true);
    assert.equal(ok(`/h/.claude/worktrees/${WTP}1628`, 1629), false);
    assert.equal(ok("/h"), false);
    assert.equal(ok("/h/.claude/worktrees"), false);
    assert.equal(ok(`/h/.claude/worktrees/${WTP}1628/tief`), false);
    assert.equal(ok(`/h/.claude/worktrees/../${WTP}1628`), false);
    assert.equal(ok(`/anders/.claude/worktrees/${WTP}1628`), false);
    assert.equal(ok(`/h/.claude/worktrees/${WTP}1628-lens-r1`), false);
  });
});

/* ---- CLI mit injizierter Welt ---- */

type Wt = { pfad: string; head: string; branch?: string; locked?: boolean };
interface IssueWelt {
  state: string;
  assignees?: string[];
  labels?: string[];
  prs?: { number: number; state: string; headRefOid: string; labels?: string[] }[];
}
interface Welt {
  worktrees?: Wt[];
  refs?: [string, number][];
  status?: Record<string, string>;
  locks?: Record<string, string>;
  issues?: Record<number, IssueWelt | null>;
  zugewiesen?: number[];
  removeFehler?: boolean;
  bleibtNachRemove?: boolean;
  ghFehler?: boolean;
  bleibtInListe?: boolean;
  bleibtAufPlatte?: boolean;
  liesFehlerBei?: string;
  ghTeilantwort?: boolean;
  statusFehler?: boolean;
  loescheFehler?: boolean;
  listeFehler?: boolean;
  jetzt?: number;
}
/** `join` hängt unter Windows Backslashes an; die Welt kennt nur `/`. */
const vorwaerts = (p: string) => p.split(String.fromCharCode(92)).join("/");
function baue(welt: Welt) {
  const aufrufe: string[] = [];
  const geloescht: string[] = [];
  let worktrees: Wt[] = [{ pfad: "/h", head: "main0", branch: "main" }, ...(welt.worktrees ?? [])];
  const ordner = new Set(worktrees.map((w) => w.pfad));
  const deps = {
    jetzt: () => welt.jetzt ?? JETZT,
    lockDir: "/locks",
    namen: NAMEN,
    festgefahrenLabel: FREMD.labels.festgefahren,
    git: (args: string[]) => {
      const a = args.join(" ");
      aufrufe.push(`git ${a}`);
      // Wie das echte git: jeder Block endet mit einer Leerzeile, auch der letzte (Ausgabe endet mit \n\n).
      if (a === "worktree list --porcelain") return worktrees.map((w) => `worktree ${w.pfad}\nHEAD ${w.head}\n${w.branch ? `branch refs/heads/${w.branch}` : "detached"}\n${w.locked ? "locked\n" : ""}\n`).join("");
      if (a.startsWith("for-each-ref")) return (welt.refs ?? []).map(([n, s]) => `${n.startsWith("origin/") ? "refs/remotes/" : "refs/heads/"}${n}\t${s}`).join("\n");
      const st = /^-C (\S+) status --porcelain$/.exec(a);
      if (st && welt.statusFehler) throw new Error("status kaputt");
      if (st) return welt.status?.[st[1]] ?? "";
      const rm = /^worktree remove (\S+)$/.exec(a);
      if (rm) {
        if (welt.removeFehler) throw new Error("Zugriff verweigert");
        if (!welt.bleibtNachRemove && !welt.bleibtInListe) worktrees = worktrees.filter((w) => w.pfad !== rm[1]);
        if (!welt.bleibtNachRemove && !welt.bleibtAufPlatte) ordner.delete(rm[1]);
        return "";
      }
      throw new Error(`unerwartet: ${a}`);
    },
    graphql: (query: string) => {
      aufrufe.push("gh graphql");
      if (welt.ghFehler) throw new Error("kein Netz");
      const repository: Record<string, unknown> = {};
      for (const m of query.matchAll(/i(\d+): issue\(number: (\d+)\)/g)) {
        const i = welt.issues?.[Number(m[2])];
        const knoten = (namen: string[] = []) => ({ nodes: namen.map((name) => ({ name })) });
        repository[`i${m[1]}`] = i
          ? {
              state: i.state,
              // Wie GitHub: ein Feld kommt nur zurück, wenn die Abfrage es verlangt.
              ...(query.includes("state labels(first:30){ nodes{ name } }") ? { labels: knoten(i.labels) } : {}),
              assignees: { nodes: (i.assignees ?? ["ich"]).map((login) => ({ login })) },
              closedByPullRequestsReferences: { nodes: (i.prs ?? []).map((p) => ({ ...p, ...(query.includes("headRefOid labels(first:30){ nodes{ name } }") ? { labels: knoten(p.labels) } : {}) })) },
            }
          : null;
      }
      const antwort = { data: { viewer: { login: "ich" }, repository } };
      if (welt.ghTeilantwort) throw Object.assign(new Error("Exit 1"), { stdout: JSON.stringify({ ...antwort, errors: [{ type: "NOT_FOUND" }] }) });
      return antwort;
    },
    zugewiesen: () => {
      aufrufe.push("gh issue list");
      return welt.zugewiesen ?? [];
    },
    liste: () => {
      if (welt.listeFehler) throw new Error("kein Verzeichnis");
      return Object.keys(welt.locks ?? {});
    },
    liesDatei: (p: string) => {
      aufrufe.push(`lies ${vorwaerts(p)}`);
      if (welt.liesFehlerBei && vorwaerts(p).endsWith(welt.liesFehlerBei)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return welt.locks?.[vorwaerts(p).replace("/locks/", "")] ?? "";
    },
    loesche: (p: string) => {
      if (welt.loescheFehler) throw new Error("gesperrt");
      geloescht.push(vorwaerts(p));
    },
    existiert: (p: string) => ordner.has(p),
  };
  return { deps, aufrufe, geloescht };
}
const lock = (extra: Record<string, unknown> = {}) => JSON.stringify({ nr: 1, nonceHash: "geheimer-hash", erstellt: "2026-10-16T02:11:00.000Z", sandbox: null, ...extra });
const sek = (iso: string) => Date.parse(iso) / 1000;

/** Stand 2026-10-16 08:36 Z (die Belege des Tickets). */
const BELEG: Welt = {
  worktrees: [
    { pfad: WTPFAD, head: OID, branch: `${BRP}1628-x` },
    { pfad: `/h/.claude/worktrees/${WTP}1530`, head: "e530", branch: `${BRP}1530-x` },
    { pfad: `/h/.claude/worktrees/${WTP}1628-lens-r1`, head: OID },
    { pfad: "/h/.claude/worktrees/scratch", head: "s0" },
  ],
  refs: [
    [`${BRP}1628-x`, sek("2026-10-16T00:21:00Z")],
    [`${BRP}1530-x`, sek("2026-10-16T02:30:00Z")],
    ["origin/HEAD", sek("2026-10-16T08:00:00Z")],
  ],
  locks: {
    "1530.json": lock({ erstellt: "2026-10-16T02:11:00.000Z", uebergabe: { gesetzt: "2026-10-16T03:10:00.000Z", verbraucht: "2026-10-16T03:20:00.000Z" } }),
    "1672.json": lock({ erstellt: "2026-10-16T03:11:00.000Z" }),
    "1628.json": lock({ erstellt: "2026-10-16T00:10:00.000Z" }),
    "notiz.json": "{}",
    "1628.json.verwaist-abc": "{}",
  },
  issues: {
    1530: { state: "OPEN" },
    1672: { state: "OPEN" },
    1628: { state: "CLOSED", prs: [{ number: 1662, state: "MERGED", headRefOid: OID }] },
  },
  zugewiesen: [1672],
};

describe("fuehreAus: Belegfall vom 2026-10-16", () => {
  test("fuehreAus ohne deps.namen räumt einen Worktree mit dem Präfix der Projekt-Config auf, einen mit dem fremden nicht", () => {
    const welt = (wt: string, branch: string): Welt => ({
      ...BELEG,
      worktrees: [{ pfad: `/h/.claude/worktrees/${wt}1628`, head: OID, branch: `${branch}1628-x` }],
      refs: [[`${branch}1628-x`, sek("2026-10-16T00:21:00Z")]],
      locks: { "1628.json": BELEG.locks?.["1628.json"] ?? "" },
    });
    const ohne = (w: Welt) => {
      const b = baue(w);
      return { ...b, deps: { ...b.deps, namen: undefined } };
    };
    const echt = ohne(welt(ECHT.worktree, ECHT.branch));
    const r = M.fuehreAus([], echt.deps);
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.startsWith(`AUFGERAEUMT #1628: Worktree /h/.claude/worktrees/${ECHT.worktree}1628, `));
    assert.ok(echt.aufrufe.includes(`git worktree remove /h/.claude/worktrees/${ECHT.worktree}1628`));
    const fremd = ohne(welt(WTP, BRP));
    const rf = M.fuehreAus([], fremd.deps);
    assert.doesNotMatch(rf.out, /AUFGERAEUMT #1628: Worktree/);
    assert.equal(fremd.aufrufe.some((a) => a.includes("worktree remove")), false);
  });

  test("Textmodus: räumt #1628 auf (Worktree dann Lock), meldet #1672 vor #1530 zur Wiederaufnahme", () => {
    const { deps, aufrufe, geloescht } = baue(BELEG);
    const r = M.fuehreAus([], deps);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(geloescht, ["/locks/1628.json"]);
    assert.ok(aufrufe.includes(`git worktree remove /h/.claude/worktrees/${WTP}1628`));
    const zeilen = r.out.trim().split("\n");
    assert.ok(zeilen[0].startsWith(`AUFGERAEUMT #1628: Worktree /h/.claude/worktrees/${WTP}1628, Lock `));
    const w = zeilen.filter((z) => z.startsWith("WIEDERAUFNAHME"));
    assert.equal(w.length, 2);
    assert.match(w[0], /^WIEDERAUFNAHME #1672: .*letztes Lebenszeichen 2026-10-16T03:11:00\.000Z \(vor 5 h\); Weg: node scripts\/ticket-lock\.mjs claim 1672 --wiederaufnahme, dann Fortsetzungsauftrag$/);
    assert.match(w[1], /^WIEDERAUFNAHME #1530: .*letztes Lebenszeichen 2026-10-16T03:20:00\.000Z \(vor 5 h\)/);
  });

  test("Textmodus ruft nur erlaubte git-Unterbefehle und nie gh issue edit oder eine Assignee-Änderung", () => {
    const { deps, aufrufe } = baue(BELEG);
    M.fuehreAus([], deps);
    for (const a of aufrufe) {
      if (a.startsWith("git ")) assert.match(a, /^git (worktree (list|remove) |-C \S+ status --porcelain|for-each-ref )/, a);
      else assert.match(a, /^(gh graphql|gh issue list|lies \/locks\/\d+\.json)$/, a);
      assert.doesNotMatch(a, /issue edit|assignee|--force|\brm\b/);
    }
  });

  test("--json liest nur: kein worktree remove, kein Löschen, keine WIEDERAUFNAHME-Zeile", () => {
    const { deps, aufrufe, geloescht } = baue(BELEG);
    const r = M.fuehreAus(["--json"], deps);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(geloescht, []);
    assert.equal(aufrufe.some((a) => a.includes("worktree remove")), false);
    assert.doesNotMatch(r.out, /WIEDERAUFNAHME|AUFGERAEUMT/);
    const d = JSON.parse(r.out) as { jetzt: string; schwelleStunden: number; viewer: string; claims: { nr: number; urteil: string; lebenszeichen: string | null; worktree: { pfad: string } | null; lock: Record<string, unknown> }[] };
    assert.equal(d.jetzt, "2026-10-16T08:36:00.000Z");
    assert.equal(d.schwelleStunden, 3);
    assert.equal(d.viewer, "ich");
    assert.deepEqual(d.claims.map((c) => [c.nr, c.urteil]), [[1530, "verwaist"], [1628, "aufraeumbar"], [1672, "verwaist"]]);
    const c1628 = d.claims.find((c) => c.nr === 1628);
    assert.equal(c1628?.worktree?.pfad, WTPFAD, "der Lens-Worktree ist nie der Ticket-Worktree");
    assert.equal(d.claims.find((c) => c.nr === 1530)?.lebenszeichen, "2026-10-16T03:20:00.000Z");
    assert.equal(d.claims.find((c) => c.nr === 1530)?.lock.uebergabeStand, "verbraucht");
  });

  test("ein Lens-Worktree ist nie der Ticket-Worktree: auch vor dem echten gelistet oder allein wird er nie entfernt", () => {
    const lens = { pfad: `/h/.claude/worktrees/${WTP}1628-lens-r1`, head: OID };
    const vorn = baue({ ...BELEG, worktrees: [lens, ...(BELEG.worktrees ?? []).filter((w) => !w.pfad.includes("lens"))] });
    M.fuehreAus([], vorn.deps);
    assert.deepEqual(vorn.aufrufe.filter((a) => a.includes("worktree remove")), [`git worktree remove /h/.claude/worktrees/${WTP}1628`]);
    const allein = baue({ ...BELEG, worktrees: [lens], refs: [] });
    const r = M.fuehreAus([], allein.deps);
    assert.equal(allein.aufrufe.some((a) => a.includes("worktree remove")), false);
    assert.match(r.out, /AUFGERAEUMT #1628: Lock /);
    assert.deepEqual(allein.geloescht, ["/locks/1628.json"]);
  });

  test("das JSON enthält weder nonce noch nonceHash, auch nicht bei einem Lock im Altformat mit Klartext-Nonce", () => {
    const welt: Welt = { ...BELEG, locks: { ...BELEG.locks, "1672.json": JSON.stringify({ nr: 1672, nonce: "KLARTEXT-NONCE", erstellt: "2026-10-16T03:11:00.000Z" }) } };
    const r = M.fuehreAus(["--json"], baue(welt).deps);
    assert.doesNotMatch(r.out, /KLARTEXT-NONCE|geheimer-hash|nonce/i);
  });

  test("--stunden: mit 6 h sind #1672 und #1530 noch lebendig (keine WIEDERAUFNAHME), mit 1 h bleiben sie verwaist", () => {
    assert.doesNotMatch(M.fuehreAus(["--stunden", "6"], baue(BELEG).deps).out, /WIEDERAUFNAHME/);
    assert.match(M.fuehreAus(["--stunden=1"], baue(BELEG).deps).out, /WIEDERAUFNAHME #1672/);
  });

  test("ein Lock eines geschlossenen Issues ohne Worktree und Branch wird gelöscht (Epic), Locks anderer Namen und .verwaist-Dateien nie", () => {
    const welt: Welt = { locks: { "1737.json": lock(), "x.json": "{}", "1737.json.verwaist-a": lock() }, issues: { 1737: { state: "CLOSED" } } };
    const { deps, geloescht } = baue(welt);
    const r = M.fuehreAus([], deps);
    assert.deepEqual(geloescht, ["/locks/1737.json"]);
    assert.match(r.out, /AUFGERAEUMT #1737: Lock/);
  });
});

describe("fuehreAus: Fehlerpfade und Schutz", () => {
  test("scheiterndes worktree remove: Exit 1, der Lock bleibt, der Rest wird gemeldet", () => {
    const { deps, geloescht } = baue({ ...BELEG, removeFehler: true });
    const r = M.fuehreAus([], deps);
    assert.equal(r.code, 1);
    assert.deepEqual(geloescht, []);
    assert.match(r.out, /FEHLER #1628: git worktree remove scheiterte/);
    assert.match(r.out, /WIEDERAUFNAHME #1672/);
  });

  test("bleibt der Worktree nach dem Entfernen in der Liste oder auf der Platte, ist es ein FEHLER und der Lock bleibt", () => {
    const { deps, geloescht } = baue({ ...BELEG, bleibtNachRemove: true });
    const r = M.fuehreAus([], deps);
    assert.equal(r.code, 1);
    assert.deepEqual(geloescht, []);
    assert.match(r.out, /FEHLER #1628: .*noch da/);
  });

  test("ein Worktree außerhalb von <Hauptcheckout>/.claude/worktrees wird nicht entfernt (Pfad-Schutz)", () => {
    const welt: Welt = { ...BELEG, worktrees: [{ pfad: `/anders/worktrees/${WTP}1628`, head: OID }] };
    const { deps, aufrufe, geloescht } = baue(welt);
    const r = M.fuehreAus([], deps);
    assert.equal(r.code, 1);
    assert.equal(aufrufe.some((a) => a.includes("worktree remove")), false);
    assert.deepEqual(geloescht, []);
    assert.match(r.out, /FEHLER #1628: .*nicht unter/);
  });

  test("uncommittete Änderungen, fehlender PR oder HEAD-Abweichung: kein Entfernen und kein Löschen", () => {
    for (const abw of [
      { status: { [WTPFAD]: " M datei.ts" } },
      { issues: { ...BELEG.issues, 1628: { state: "CLOSED", prs: [] } } },
      { issues: { ...BELEG.issues, 1628: { state: "CLOSED", prs: [{ number: 1, state: "MERGED", headRefOid: "anderer" }] } } },
      { worktrees: [{ pfad: WTPFAD, head: OID, branch: "b", locked: true }] },
    ] as Partial<Welt>[]) {
      const { deps, aufrufe, geloescht } = baue({ ...BELEG, ...abw });
      const r = M.fuehreAus([], deps);
      assert.equal(r.code, 0);
      assert.equal(aufrufe.some((a) => a.includes("worktree remove")), false, JSON.stringify(abw));
      assert.deepEqual(geloescht, [], JSON.stringify(abw));
      assert.match(r.out, /BEHALTEN #1628/);
    }
  });

  test("ein fremder Assignee wird nie angefasst: kein Aufruf außer Lesen, Urteil behalten", () => {
    const welt: Welt = { ...BELEG, issues: { ...BELEG.issues, 1672: { state: "OPEN", assignees: ["andere"] } } };
    const { deps, aufrufe } = baue(welt);
    const r = M.fuehreAus([], deps);
    assert.match(r.out, /BEHALTEN #1672: behalten, fremd zugewiesen/);
    assert.doesNotMatch(r.out, /WIEDERAUFNAHME #1672/);
    assert.equal(aufrufe.filter((a) => a.startsWith("gh")).every((a) => a === "gh graphql" || a === "gh issue list"), true);
  });

  test("ein Issue, das GitHub nicht kennt, ist unbekannt (keine Aktion), die übrigen werden beurteilt", () => {
    const welt: Welt = { ...BELEG, issues: { ...BELEG.issues, 1672: null } };
    const r = M.fuehreAus([], baue(welt).deps);
    assert.match(r.out, /BEHALTEN #1672: unbekannt/);
    assert.match(r.out, /AUFGERAEUMT #1628/);
  });

  test("gh-Fehler: Exit 2, nichts aufgeräumt", () => {
    const { deps, aufrufe, geloescht } = baue({ ...BELEG, ghFehler: true });
    const r = M.fuehreAus([], deps);
    assert.equal(r.code, 2);
    assert.match(r.err, /nichts aufgeräumt/);
    assert.deepEqual(geloescht, []);
    assert.equal(aufrufe.some((a) => a.includes("worktree remove")), false);
  });

  test("ein werfendes git ergibt Exit 2; sind alle Kandidaten unbekannt, ebenfalls", () => {
    const { deps } = baue(BELEG);
    const kaputt = { ...deps, git: () => { throw new Error("git kaputt"); } };
    assert.equal(M.fuehreAus([], kaputt).code, 2);
    const alleNull: Welt = { ...BELEG, issues: { 1530: null, 1628: null, 1672: null } };
    const { deps: d2, geloescht } = baue(alleNull);
    assert.equal(M.fuehreAus([], d2).code, 2);
    assert.deepEqual(geloescht, []);
  });

  test("eine GraphQL-Teilantwort mit NOT_FOUND (unbekanntes Issue) gilt, jeder andere Fehler bleibt Exit 2", () => {
    const r = M.fuehreAus([], baue({ ...BELEG, issues: { ...BELEG.issues, 1672: null }, ghTeilantwort: true }).deps);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BEHALTEN #1672: unbekannt/);
    assert.match(r.out, /AUFGERAEUMT #1628/);
  });

  test("ein unlesbarer Lock (kein JSON) wird gemeldet und nie gelöscht, auch bei geschlossenem Issue", () => {
    const welt: Welt = { locks: { "1737.json": "{kaputt" }, issues: { 1737: { state: "CLOSED" } } };
    const { deps, geloescht } = baue(welt);
    const r = M.fuehreAus([], deps);
    assert.match(r.out, /BEHALTEN #1737: lock-unlesbar/);
    assert.deepEqual(geloescht, []);
  });

  test("ohne Lock-Verzeichnis arbeitet die Prüfung mit Worktrees und Branches weiter", () => {
    const r = M.fuehreAus([], baue({ ...BELEG, locks: {}, listeFehler: true }).deps);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /AUFGERAEUMT #1628: Worktree /);
  });

  test("unlesbarer git status gilt als nicht sauber: der Worktree bleibt", () => {
    const { deps, aufrufe, geloescht } = baue({ ...BELEG, statusFehler: true });
    const r = M.fuehreAus([], deps);
    assert.match(r.out, /BEHALTEN #1628: behalten, Worktree mit uncommitteten Änderungen/);
    assert.equal(aufrufe.some((a) => a.includes("worktree remove")), false);
    assert.deepEqual(geloescht, []);
  });

  test("scheitert das Löschen des Locks: FEHLER und Exit 1, der Rest läuft weiter", () => {
    const welt: Welt = { ...BELEG, loescheFehler: true };
    const r = M.fuehreAus([], baue(welt).deps);
    assert.equal(r.code, 1);
    assert.match(r.out, /FEHLER #1628: Lock nicht gelöscht/);
    assert.match(r.out, /WIEDERAUFNAHME #1672/);
  });

  const alterLock = lock({ erstellt: "2026-10-16T01:00:00.000Z" });

  test("festgefahren (Label am Issue oder am PR): keine Wiederaufnahme, behalten; ohne Label dieselbe Lage verwaist", () => {
    const ohne = M.fuehreAus([], baue({ locks: { "20.json": alterLock }, issues: { 20: { state: "OPEN" } } }).deps);
    assert.match(ohne.out, /WIEDERAUFNAHME #20/);
    for (const issue of [{ state: "OPEN", labels: [FREMD.labels.festgefahren] }, { state: "OPEN", prs: [{ number: 5, state: "OPEN", headRefOid: "x", labels: [FREMD.labels.festgefahren] }] }]) {
      const r = M.fuehreAus([], baue({ locks: { "20.json": alterLock }, issues: { 20: issue } }).deps);
      assert.match(r.out, /BEHALTEN #20: behalten, festgefahren/);
      assert.doesNotMatch(r.out, /WIEDERAUFNAHME/);
    }
    const anderes = M.fuehreAus([], baue({ locks: { "20.json": alterLock }, issues: { 20: { state: "OPEN", labels: ["anderes"] } } }).deps);
    assert.match(anderes.out, /WIEDERAUFNAHME #20/);
  });

  test("fuehreAus ohne deps.namen: der Branch mit dem Präfix der Projekt-Config zählt als Ticket, der mit dem fremden nicht", () => {
    const ohne = (branch: string) => ({ ...baue({ refs: [[branch, sek("2026-10-16T03:36:00Z")]], issues: { 21: { state: "OPEN" } } }).deps, namen: undefined });
    const echt = M.fuehreAus([], ohne(`${ECHT.branch}21-x`));
    assert.equal(echt.code, 0, echt.err);
    assert.match(echt.out, /#21/);
    const fremd = M.fuehreAus([], ohne(`${BRP}21-x`));
    assert.equal(fremd.code, 0, fremd.err);
    assert.doesNotMatch(fremd.out, /#21/);
  });

  test("ein reiner Remote-Branch ist keine lokale Spur: keine Wiederaufnahme", () => {
    const r = M.fuehreAus([], baue({ refs: [[`origin/${BRP}21-x`, sek("2026-10-16T01:00:00Z")]], issues: { 21: { state: "OPEN" } } }).deps);
    assert.match(r.out, /BEHALTEN #21: ohne-lokale-spur, zugewiesen, aber ohne Lock, Worktree und lokalen Branch/);
    assert.doesNotMatch(r.out, /WIEDERAUFNAHME/);
  });

  test("ohne Lock entscheidet allein die Commit-Zeit des lokalen Branch-Kopfes: vor 1 h lebendig, vor 5 h verwaist", () => {
    const welt = (iso: string): Welt => ({ refs: [[`${BRP}22-x`, sek(iso)]], issues: { 22: { state: "OPEN" } } });
    assert.match(M.fuehreAus([], baue(welt("2026-10-16T07:36:00Z")).deps).out, /BEHALTEN #22: lebendig/);
    assert.match(M.fuehreAus([], baue(welt("2026-10-16T03:36:00Z")).deps).out, /WIEDERAUFNAHME #22: .*letztes Lebenszeichen 2026-10-16T03:36:00\.000Z \(vor 5 h\)/);
  });

  test("eine nur zugewiesene Nummer ohne jede Spur ist ohne-lokale-spur (Quelle: Zuweisung)", () => {
    const r = M.fuehreAus([], baue({ zugewiesen: [23], issues: { 23: { state: "OPEN" } } }).deps);
    assert.match(r.out, /BEHALTEN #23: ohne-lokale-spur, zugewiesen, aber ohne Lock, Worktree und lokalen Branch/);
  });

  test("das Festgefahren-Label am Issue oder gemergten PR verhindert das Aufräumen eines geschlossenen Issues nicht", () => {
    const welt: Welt = { ...BELEG, issues: { ...BELEG.issues, 1628: { state: "CLOSED", labels: [FREMD.labels.festgefahren], prs: [{ number: 1662, state: "MERGED", headRefOid: OID, labels: [FREMD.labels.festgefahren] }] } } };
    const { deps, geloescht } = baue(welt);
    const r = M.fuehreAus([], deps);
    assert.match(r.out, /AUFGERAEUMT #1628: Worktree /);
    assert.deepEqual(geloescht, ["/locks/1628.json"]);
  });

  test("--json: branchLokal ist true bei lokalem Branch und false bei reinem Remote-Branch", () => {
    const welt: Welt = { refs: [[`${BRP}40-x`, sek("2026-10-16T07:00:00Z")], [`origin/${BRP}41-x`, sek("2026-10-16T07:00:00Z")]], issues: { 40: { state: "OPEN" }, 41: { state: "OPEN" } } };
    const d = JSON.parse(M.fuehreAus(["--json"], baue(welt).deps).out) as { claims: { nr: number; branch: boolean; branchLokal: boolean }[] };
    assert.deepEqual(d.claims.map((c) => [c.nr, c.branch, c.branchLokal]), [[40, true, true], [41, true, false]]);
  });

  test("--json: lock ist null ohne Lock und \"unlesbar\" bei kaputtem Lock, dazu branchLokal und festgefahren", () => {
    const welt: Welt = { zugewiesen: [23], locks: { "24.json": "{kaputt" }, issues: { 23: { state: "OPEN" }, 24: { state: "OPEN", labels: [FREMD.labels.festgefahren] } } };
    const d = JSON.parse(M.fuehreAus(["--json"], baue(welt).deps).out) as { claims: { nr: number; lock: unknown; branchLokal: boolean; festgefahren: boolean; urteil: string }[] };
    assert.deepEqual(d.claims.map((c) => [c.nr, c.lock, c.branchLokal, c.festgefahren, c.urteil]), [
      [23, null, false, false, "ohne-lokale-spur"],
      [24, "unlesbar", false, true, "lock-unlesbar"],
    ]);
  });

  test("Verifikation nach dem Entfernen: schon ein Eintrag nur in der Liste oder nur auf der Platte ist ein FEHLER, der Lock bleibt", () => {
    for (const abw of [{ bleibtInListe: true }, { bleibtAufPlatte: true }] as Partial<Welt>[]) {
      const { deps, geloescht } = baue({ ...BELEG, ...abw });
      const r = M.fuehreAus([], deps);
      assert.equal(r.code, 1, JSON.stringify(abw));
      assert.match(r.out, /FEHLER #1628: .*noch da/);
      assert.deepEqual(geloescht, []);
    }
  });

  test("ein räumbarer Worktree ohne Lock wird entfernt, ohne einen Lock zu löschen (kein Fehler)", () => {
    const welt: Welt = { ...BELEG, locks: { "1530.json": BELEG.locks?.["1530.json"] ?? "", "1672.json": BELEG.locks?.["1672.json"] ?? "" } };
    const b = baue(welt);
    const r = M.fuehreAus([], b.deps);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /AUFGERAEUMT #1628: Worktree \S+ \(/);
    assert.doesNotMatch(r.out, /Lock/);
    assert.deepEqual(b.geloescht, []);
  });

  test("die Lock-Datei muss <Ziffern>.json heißen (Anker am Anfang): x1.json wird ignoriert statt zu scheitern", () => {
    const r = M.fuehreAus([], baue({ locks: { "x1.json": lock(), "1672.json": alterLock }, issues: { 1672: { state: "OPEN" } } }).deps);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /WIEDERAUFNAHME #1672/);
  });

  test("ein Lock ohne jedes Lebenszeichen steht zuerst und ohne Stundenangabe; die Sortierung ist numerisch", () => {
    const welt: Welt = { locks: { "30.json": JSON.stringify({ nonceHash: "h" }), "1672.json": alterLock }, issues: { 30: { state: "OPEN" }, 1672: { state: "OPEN" } } };
    const zeilen = M.fuehreAus([], baue(welt).deps).out.trim().split("\n");
    assert.match(zeilen[0], /^WIEDERAUFNAHME #30: kein Lebenszeichen feststellbar, letztes Lebenszeichen unbekannt; Weg: /);
    assert.doesNotMatch(zeilen[0], /\(vor/);
    assert.match(zeilen[1], /^WIEDERAUFNAHME #1672: .*\(vor 7 h\)/);
    const jung = lock({ erstellt: "2026-10-16T07:36:00.000Z" });
    const d = JSON.parse(M.fuehreAus(["--json"], baue({ locks: { "1000.json": jung, "999.json": jung }, issues: { 999: { state: "OPEN" }, 1000: { state: "OPEN" } } }).deps).out) as { claims: { nr: number }[] };
    assert.deepEqual(d.claims.map((c) => c.nr), [999, 1000]);
  });

  test("verschwindet eine Lock-Datei zwischen Auflisten und Lesen (ENOENT), gilt sie als unlesbar statt als Fehler", () => {
    const r = M.fuehreAus([], baue({ locks: { "31.json": lock() }, liesFehlerBei: "31.json", issues: { 31: { state: "CLOSED" } } }).deps);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /BEHALTEN #31: lock-unlesbar/);
  });

  test("ohne Kandidaten: Exit 0 und leere Ausgabe", () => {
    assert.deepEqual(M.fuehreAus([], baue({}).deps), { code: 0, out: "", err: "" });
  });

  test.each([[["--stunden", "0"]], [["--stunden", "-1"]], [["--stunden", "abc"]], [["--bogus"]]])("ungültiger Aufruf %j: Exit 2 vor jedem Zugriff", (argv) => {
    const { deps, aufrufe } = baue(BELEG);
    const r = M.fuehreAus(argv, deps);
    assert.equal(r.code, 2);
    assert.deepEqual(aufrufe, []);
  });

  test.each([[["--bogus"]], [["--stunden"]], [["--json", "--json"]]])("Deps-Fabrik: Aufruf-Fehler %j meldet Exit 2 mit Aufrufzeile, die Fabrik wird nie gerufen", (argv) => {
    let gerufen = 0;
    const r = M.fuehreAus(argv, () => {
      gerufen += 1;
      return baue(BELEG).deps;
    });
    assert.equal(r.code, 2);
    assert.equal(gerufen, 0);
    assert.match(r.err, /^✖ claims-pruefen: .+\nAufruf: claims-pruefen \[--json\] \[--stunden <n>\]\n$/);
    assert.equal(r.out, "");
  });

  test("Deps-Fabrik: gültiger Aufruf ruft die Fabrik genau einmal", () => {
    let gerufen = 0;
    const r = M.fuehreAus(["--json"], () => {
      gerufen += 1;
      return baue(BELEG).deps;
    });
    assert.equal(r.code, 0, r.err);
    assert.equal(gerufen, 1);
  });

  test("Deps-Fabrik: wirft die Fabrik (kaputte Config), kommt Exit 2 statt Absturz", () => {
    const r = M.fuehreAus([], () => {
      throw new Error("Config kaputt");
    });
    assert.equal(r.code, 2);
    assert.match(r.err, /Config kaputt/);
  });
});

describe("echteDeps: Config", () => {
  const AB = {
    praefixe: { commitZeile: "AB-", branch: "feature/ab-", worktree: "ab-" },
    agenten: { planer: "ab-planer", umsetzer: "ab-umsetzer", lens: "ab-lens", gruppe: "ab-gruppe", ticketSkill: "ab" },
    labels: { harness: "h", festgefahren: "zustand:fest", forum: "f", dependabotInbox: "h" },
  };
  test("Label und Lock-Verzeichnis kommen aus der Config", () => {
    const d = M.echteDeps({ config: AB });
    assert.equal(d.festgefahrenLabel, "zustand:fest");
    assert.match(d.lockDir, /ab-locks$/);
  });
  test("Negativfall: ohne labels.festgefahren bricht echteDeps ab und nennt den Schlüssel", () => {
    const { festgefahren: _weg, ...rest } = AB.labels;
    assert.throws(() => M.echteDeps({ config: { ...AB, labels: rest } }), /labels\.festgefahren/);
  });
});
