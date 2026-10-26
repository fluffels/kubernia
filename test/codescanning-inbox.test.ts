import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/codescanning-inbox.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { NOTFAELLE, SAMMELTICKET_TITEL_LISTE } from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sammelRaw from "../scripts/sammelticket-anlegen.mjs";

const zaehleBefundZeilen = (
  sammelRaw as unknown as {
    zaehleBefundZeilen: (k: { user: unknown; body: string }[], o: { vertraut: () => boolean }) => number;
  }
).zaehleBefundZeilen;

type Alert = { nummer: number; tool: string; regel: string; stufe: string | null; schwere: string; state: string; pfad?: string; ghsa?: string[]; meldung?: string; ort?: { von: number; bis: number } | null; commit?: string; geschlossenVon?: unknown; grund?: string };
type Bekannt = { nummern: Set<number>; regeln: Set<string>; alerts?: Set<number>; ghsa?: Set<string> };
type Gruppe = { tool: string; regel: string; stufe: string | null; schwere: string; nummern: number[]; vorgaenger?: number[]; grund?: string };
type Plan = { issue: { art: string; nummer?: number; body?: string; neue?: number[]; nachfolger?: number[] }; zeilen: Gruppe[]; nachfolger: { nummer: number; vorgaenger: number[] }[] };
type Folger = Map<number, { vorgaenger: number[]; grund: string }>;
type Io = Record<string, (...a: never[]) => unknown>;
const C = raw as unknown as {
  ZIEL_TITEL: string;
  alertsAus: (l: unknown) => Alert[];
  vorgaengerAus: (l: unknown, owner: string) => Alert[];
  codeAusschnitt: (t: unknown, ort: unknown) => string;
  nachfolgerJeAlert: (a: { alerts: Alert[]; vorgaenger: Alert[]; lies: (p: string, c: string) => string | null }) => Folger;
  klasse: (a: Partial<Alert>) => string;
  slug: (r: string) => string;
  nummernIn: (t: string) => number[];
  bekannteAlerts: (a: {
    kommentare: { user: unknown; body: string }[];
    owner: string;
    wiedervorlagen: { id: string; alerts?: number[] }[];
    offeneTitel?: string[];
    sammelTitel: string[];
    offeneIssues?: { number: number; title: string; body: string; user: unknown }[];
  }) => Required<Bekannt> & { issues: { number: number; titel: string; body: string }[] };
  kontextAus: (a: Record<string, unknown>) => { sammelTitel: string[]; offeneIssues: unknown; offeneTitel: unknown; owner: string };
  deckendesIssue: (a: Partial<Alert>, issues: { number: number; titel: string; body: string }[]) => { number: number; grund: string } | null;
  zeilenText: (g: Gruppe) => string;
  issueBody: (g: Gruppe[], repo?: string) => string;
  plane: (a: { alerts: Alert[]; bekannt: Bekannt; offenesIssue: { number: number; body: string } | null; repo?: string; nachfolger?: Folger }) => Plan;
  fuehreAus: (a: Record<string, unknown>) => number;
  lauf: (a: Record<string, unknown>) => number;
};

const roh = (o: Record<string, unknown> = {}) => ({
  number: 1,
  state: "open",
  rule: { id: "js/path-injection", severity: "error", security_severity_level: "high" },
  tool: { name: "CodeQL" },
  ...o,
});
const alert = (o: Partial<Alert> = {}): Alert => ({ nummer: 1, tool: "CodeQL", regel: "js/path-injection", stufe: "high", schwere: "error", state: "open", ...o });
const keine = { nummern: new Set<number>(), regeln: new Set<string>() };
const OWNER = "fluffels";
const bot = { login: "github-actions[bot]", type: "Bot" };

describe("klasse", () => {
  test.each([
    ["CodeQL high", { stufe: "high" }, "spitze"],
    ["CodeQL critical", { stufe: "critical" }, "spitze"],
    ["CodeQL error ohne Stufe", { stufe: null, schwere: "error" }, "spitze"],
    ["CodeQL warning ohne Stufe", { stufe: null, schwere: "warning" }, "zeile"],
    ["CodeQL error + medium: Stufe hat Vorrang", { stufe: "medium", schwere: "error" }, "zeile"],
    ["Scorecard error + high", { tool: "Scorecard", stufe: "high", schwere: "error" }, "zeile"],
    ["unbekanntes Tool + critical", { tool: "Foo", stufe: "critical" }, "zeile"],
    ["CodeQL high im Test-Code: nicht ausgeliefert, nur Zeile", { pfad: "test/check-c4-harness.test.ts" }, "zeile"],
    ["CodeQL high in test-ähnlichem Quellpfad bleibt Spitze", { pfad: "src/test/x.ts" }, "spitze"],
    ["CodeQL high in `testbar/`: kein Präfix-Fehltreffer", { pfad: "testbar/x.ts" }, "spitze"],
    ["CodeQL high unter scripts/: Spitze", { pfad: "scripts/mermaid-vorschau.mjs" }, "spitze"],
    ["CodeQL high im Test-Code mit Backslash-Pfad: nur Zeile", { pfad: "test\\x.test.ts" }, "zeile"],
  ])("%s -> %s", (_n, o, erwartet) => {
    expect(C.klasse(alert(o as Partial<Alert>))).toBe(erwartet);
  });
});

describe("alertsAus", () => {
  test("normalisiert und behält nur offene", () => {
    const l = C.alertsAus([roh({ number: 3 }), roh({ number: 4, state: "fixed" }), roh({ number: 5, state: "dismissed" })]);
    expect(l).toEqual([
      { nummer: 3, tool: "CodeQL", regel: "js/path-injection", stufe: "high", schwere: "error", state: "open", pfad: "", ghsa: [], meldung: "", ort: null, commit: "", geschlossenVon: null, grund: "" },
    ]);
  });
  test("Meldung, Ort und Commit aus der jüngsten Instanz; ein Ort ohne Ende gilt als eine Zeile", () => {
    const inst = (loc: Record<string, unknown>) => ({ most_recent_instance: { commit_sha: "abc", message: { text: "m" }, location: { path: "a.mjs", ...loc } } });
    const [a, b, c, d] = C.alertsAus([
      roh({ number: 1, ...inst({ start_line: 13, end_line: 15 }) }),
      roh({ number: 2, ...inst({ start_line: 13 }) }),
      roh({ number: 3, ...inst({ start_line: 0, end_line: 2 }) }),
      roh({ number: 4, ...inst({ start_line: 5, end_line: 4 }) }),
    ]);
    expect([a.meldung, a.commit, a.ort]).toEqual(["m", "abc", { von: 13, bis: 15 }]);
    expect(b.ort).toEqual({ von: 13, bis: 13 });
    expect(c.ort).toBeNull();
    expect(d.ort).toBeNull();
  });
  test("kein Array oder fehlende Nummer wirft", () => {
    expect(() => C.alertsAus({})).toThrow();
    expect(() => C.alertsAus([roh({ number: "x" })])).toThrow();
    expect(() => C.alertsAus([roh({ number: undefined })])).toThrow();
  });
  test("Regel-ID wird bereinigt", () => {
    const [a] = C.alertsAus([roh({ rule: { id: "a\nb]*c", severity: "error" } })]);
    expect(a.regel).toBe("unbekannt");
  });
  test("Pfad und GHSA-IDs aus der jüngsten Instanz", () => {
    const [a] = C.alertsAus([
      roh({ most_recent_instance: { location: { path: "test/x.test.ts" }, message: { text: "osv.dev/GHSA-vfj7-8cjw-p6xm und GHSA-aaaa-bbbb-cccc" } } }),
    ]);
    expect(a.pfad).toBe("test/x.test.ts");
    expect(a.ghsa).toEqual(["ghsa-vfj7-8cjw-p6xm", "ghsa-aaaa-bbbb-cccc"]);
  });
  test("fehlende Stufe wird null", () => {
    const [a] = C.alertsAus([roh({ rule: { id: "x/y", severity: "warning" } })]);
    expect(a.stufe).toBeNull();
  });
});

describe("slug", () => {
  test.each([
    ["js/path-injection", "js-path-injection"],
    ["PinnedDependenciesID", "pinneddependenciesid"],
    ["/js//foo/", "js-foo"],
    ["a  b__c", "a-b-c"],
  ])("%s -> %s", (regel, erwartet) => {
    expect(C.slug(regel)).toBe(erwartet);
  });
  test("nicht lesbare Regel wird leer", () => {
    expect(C.slug(undefined as unknown as string)).toBe("");
    expect(C.slug("///")).toBe("");
  });
});

describe("nummernIn", () => {
  test("liest Alerts-Listen", () => {
    expect(C.nummernIn("Code-Scanning: CodeQL x (high), Alerts 5, 6, 7. Vorschlag: …")).toEqual([5, 6, 7]);
    expect(C.nummernIn("Alert 12.")).toEqual([12]);
    expect(C.nummernIn("nichts")).toEqual([]);
  });
});

describe("deckendesIssue", () => {
  const A = { nummer: 74, regel: "js/incomplete-sanitization", pfad: "src/content/drills/docker.ts" };
  const iss = (body: string) => ({ number: 1703, titel: "Sanitization", body });
  test("Alert-Nummer im Body deckt ab, auch in einer Liste", () => {
    expect(C.deckendesIssue(A, [iss("Code-Scanning-Alert 74")])).toEqual({ number: 1703, grund: "nummer" });
    expect(C.deckendesIssue(A, [iss("Code-Scanning-Alerts 70, 74, 75")])).toEqual({ number: 1703, grund: "nummer" });
  });
  test("nur #74 (Issue-Link) deckt nicht ab", () => {
    expect(C.deckendesIssue(A, [iss("siehe #74")])).toBeNull();
  });
  test("Regel plus Verzeichnis deckt ab, auch für Geschwisterdateien und Backslash-Pfade", () => {
    const body = "js/incomplete-sanitization in src/content/drills/{docker,git}.ts";
    expect(C.deckendesIssue({ ...A, nummer: 99 }, [iss(body)])).toEqual({ number: 1703, grund: "regel+verzeichnis" });
    expect(C.deckendesIssue({ ...A, nummer: 99, pfad: "src\\content\\drills\\k8s.ts" }, [iss(body)])).toEqual({ number: 1703, grund: "regel+verzeichnis" });
  });
  test("gleiche Regel, anderes Verzeichnis deckt nicht ab", () => {
    expect(C.deckendesIssue({ ...A, pfad: "src/game/x.ts" }, [iss("js/incomplete-sanitization in src/content/drills/")])).toBeNull();
  });
  test("Regel-ID nur an Wortgrenze", () => {
    expect(C.deckendesIssue(A, [iss("js/incomplete-sanitization-x in src/content/drills/")])).toBeNull();
  });
  test("bloße Regelnennung ohne Verzeichnis im Alert deckt nicht ab", () => {
    expect(C.deckendesIssue({ ...A, pfad: "" }, [iss("js/incomplete-sanitization in src/content/drills/")])).toBeNull();
    expect(C.deckendesIssue({ ...A, pfad: "datei.ts" }, [iss("js/incomplete-sanitization überall")])).toBeNull();
  });
  test("kein Issue: null", () => {
    expect(C.deckendesIssue(A, [])).toBeNull();
  });
  test("beide Grenzen der Regel-ID und des Verzeichnisses (links wie rechts)", () => {
    const D = "src/content/drills/";
    expect(C.deckendesIssue(A, [iss(`xjs/incomplete-sanitization in ${D}`)])).toBeNull();
    expect(C.deckendesIssue(A, [iss(`foo/js/incomplete-sanitization in ${D}`)])).toBeNull();
    expect(C.deckendesIssue(A, [iss("js/incomplete-sanitization in src/content/drills-alt/b.ts")])).toBeNull();
    expect(C.deckendesIssue(A, [iss(`js/incomplete-sanitization in x${D}`)])).toBeNull();
    expect(C.deckendesIssue(A, [iss(`js/incomplete-sanitizationx in ${D}`)])).toBeNull();
    expect(C.deckendesIssue(A, [iss(`js/incomplete-sanitization/sub in ${D}`)])).toBeNull();
    expect(C.deckendesIssue(A, [iss(`.js/incomplete-sanitization in ${D}`)])).toBeNull();
    expect(C.deckendesIssue(A, [iss(`-js/incomplete-sanitization in ${D}`)])).toBeNull();
    expect(C.deckendesIssue(A, [iss(`js/incomplete-sanitization in .${D}`)])).toBeNull();
    expect(C.deckendesIssue(A, [iss(`js/incomplete-sanitization in -${D}`)])).toBeNull();
    expect(C.deckendesIssue(A, [iss(`js/incomplete-sanitization in ${D}`)])).toEqual({ number: 1703, grund: "regel+verzeichnis" });
  });
  test("rechte Grenze der Regel-ID: Satzzeichen und Backticks danach decken weiter ab", () => {
    const D = "src/content/drills/";
    for (const nach of [".", ",", ")", "`", ":", ";"]) {
      expect(C.deckendesIssue(A, [iss(`js/incomplete-sanitization${nach} in ${D}`)]), nach).toEqual({ number: 1703, grund: "regel+verzeichnis" });
    }
    expect(C.deckendesIssue(A, [iss(`Regel \`js/incomplete-sanitization\` in \`${D}\``)])).toEqual({ number: 1703, grund: "regel+verzeichnis" });
    expect(C.deckendesIssue(A, [iss(`js/incomplete-sanitization_ in ${D}`)])).toBeNull();
  });
  test("Nummern nur mit der Konvention `Code-Scanning-Alert N`: fremde Alert-Nummern decken nicht ab", () => {
    expect(C.deckendesIssue(A, [iss("Alert 74")])).toBeNull();
    expect(C.deckendesIssue(A, [iss("Dependabot-Alert 74")])).toBeNull();
    expect(C.deckendesIssue(A, [iss("Alerts 70, 74")])).toBeNull();
    expect(C.deckendesIssue(A, [iss("Code-Scanning-Alert 75")])).toBeNull();
    expect(C.deckendesIssue(A, [iss("Code-Scanning-Alerts 70, 75")])).toBeNull();
    expect(C.deckendesIssue(A, [iss("xCode-Scanning-Alert 74")])).toBeNull();
    expect(C.deckendesIssue(A, [iss("Code-Scanning-Alert 740")])).toBeNull();
    expect(C.deckendesIssue(A, [iss("Code-Scanning-Alert 74.")])).toEqual({ number: 1703, grund: "nummer" });
  });
  test("leere Regel deckt über das Verzeichnis allein nie ab", () => {
    expect(C.deckendesIssue({ ...A, regel: "" }, [iss("src/content/drills/ überall")])).toBeNull();
  });
  test("Ersatzwert unbekannt (unlesbare Regel-ID) deckt nie über das bloße Wort ab", () => {
    expect(C.deckendesIssue({ ...A, regel: "unbekannt" }, [iss("Ursache unbekannt, betrifft src/content/drills/x.ts")])).toBeNull();
  });
});

describe("bekannteAlerts offene Issues", () => {
  const offen = (o: Record<string, unknown> = {}) => ({ number: 1703, title: "Sanitization", body: "Code-Scanning-Alert 74", user: { login: OWNER, type: "User" }, ...o });
  const mit = (i: unknown[]) => C.bekannteAlerts({ kommentare: [], owner: OWNER, wiedervorlagen: [], sammelTitel: SAMMELTICKET_TITEL_LISTE as string[], offeneIssues: i as never }).issues.map((x) => x.number);
  test("offene Issues vertrauter Autoren werden übernommen", () => {
    expect(mit([offen()])).toEqual([1703]);
  });
  test("unvertrauter Autor zählt nicht", () => {
    expect(mit([offen({ user: { login: "fremd", type: "User" } })])).toEqual([]);
  });
  test("das eigene Ticket ZIEL_TITEL deckt sich nie selbst ab", () => {
    expect(mit([offen({ title: C.ZIEL_TITEL })])).toEqual([]);
  });
  test("Sammeltickets zählen nicht", () => {
    expect(mit([offen({ title: "Harness-Härtung (gesammelt)" }), offen({ title: "Langfuse-Befunde (gesammelt)" })])).toEqual([]);
  });
  test("ein null-Element in offeneIssues wird übersprungen", () => {
    expect(mit([null, offen()])).toEqual([1703]);
  });
  test("ohne offeneIssues: leere Liste", () => {
    expect(C.bekannteAlerts({ kommentare: [], owner: OWNER, wiedervorlagen: [], sammelTitel: [] }).issues).toEqual([]);
  });
});

describe("sammelTitel ist Pflicht", () => {
  const ohne = (v: unknown) => () => C.bekannteAlerts({ kommentare: [], owner: OWNER, wiedervorlagen: [], sammelTitel: v as never });
  test("fehlende oder keine Liste wirft statt still [] anzunehmen", () => {
    expect(ohne(undefined)).toThrow(/sammelTitel/);
    expect(ohne("Harness-Härtung (gesammelt)")).toThrow(/sammelTitel/);
    expect(ohne(null)).toThrow(/sammelTitel/);
  });
  test("eine leere Liste ist erlaubt (kein Sammelticket ausgenommen)", () => {
    expect(ohne([])()).toBeDefined();
  });
  test("kontextAus (Verdrahtung in main) reicht die Sammeltitel der Libs durch", () => {
    const libs = { SAMMELTICKET_TITEL_LISTE: ["Sammel A"], vertrauteIssues: () => [{ number: 1 }], offeneTitel: () => ["t"] };
    const k = C.kontextAus({ libs, rohe: [], kommentare: [], owner: OWNER, offenesIssue: null, wiedervorlagen: [] });
    expect(k.sammelTitel).toEqual(["Sammel A"]);
    expect(k.offeneIssues).toEqual([{ number: 1 }]);
    expect(k.offeneTitel).toEqual(["t"]);
  });
  test("kontextAus ohne Sammeltitel-Liste der Libs gibt einen Kontext, den bekannteAlerts ablehnt", () => {
    const libs = { vertrauteIssues: () => [], offeneTitel: () => [] };
    const k = C.kontextAus({ libs, rohe: [], kommentare: [], owner: OWNER, offenesIssue: null, wiedervorlagen: [] });
    expect(() => C.bekannteAlerts(k as never)).toThrow(/sammelTitel/);
  });
});

describe("plane mit deckenden Issues", () => {
  const issues = [{ number: 1703, titel: "S", body: "Code-Scanning-Alerts 5" }];
  const bekannt = { ...keine, issues };
  test("abgedeckter Spitzen-Alert fällt aus Spitze, wird gemeldet; offenes Ticket wird geschlossen mit abgedecktDurch", () => {
    const p = C.plane({ alerts: [alert({ nummer: 5 })], bekannt, offenesIssue: { number: 9, body: "x" } }) as unknown as { issue: Record<string, unknown>; abgedeckt: unknown[] };
    expect(p.issue).toEqual({ art: "schliessen", nummer: 9, abgedecktDurch: [1703] });
    expect(p.abgedeckt).toEqual([{ nummer: 5, issue: 1703, grund: "nummer" }]);
  });
  test("abgedeckter Zeilen-Alert erzeugt keine Zeile; nicht abgedeckter bleibt", () => {
    const z = (n: number) => alert({ nummer: n, tool: "Scorecard", regel: "X" });
    const p = C.plane({ alerts: [z(5), z(6)], bekannt, offenesIssue: null });
    expect(p.zeilen.flatMap((g) => g.nummern)).toEqual([6]);
  });
  test("abgedecktDurch ist ohne Doppel und aufsteigend (mehrere Alerts, mehrere Issues, beide Gründe)", () => {
    const D = { nummern: new Set<number>(), regeln: new Set<string>(), issues: [{ number: 1704, titel: "A", body: "Code-Scanning-Alerts 5, 6" }, { number: 1703, titel: "B", body: "js/path-injection in src/game/" }] };
    const p = C.plane({ alerts: [alert({ nummer: 5 }), alert({ nummer: 6 }), alert({ nummer: 7, pfad: "src/game/x.ts" })], bekannt: D, offenesIssue: { number: 9, body: "x" } }) as unknown as { issue: Record<string, unknown> };
    expect(p.issue).toEqual({ art: "schliessen", nummer: 9, abgedecktDurch: [1703, 1704] });
  });
  test("ohne Abdeckung: kein abgedecktDurch", () => {
    const p = C.plane({ alerts: [], bekannt: keine, offenesIssue: { number: 9, body: "x" } });
    expect(p.issue).toEqual({ art: "schliessen", nummer: 9 });
  });
});

describe("bekannteAlerts", () => {
  const zeile = "- [ ] Code-Scanning: Scorecard Foo (high), Alerts 8, 9. Vorschlag: x";
  test("offene Zeile vertrauter Autoren liefert Nummern", () => {
    const b = C.bekannteAlerts({ kommentare: [{ user: bot, body: zeile }], owner: OWNER, wiedervorlagen: [], sammelTitel: [] });
    expect([...b.nummern].sort()).toEqual([8, 9]);
  });
  test("erledigte Zeile [x] zählt nicht", () => {
    const b = C.bekannteAlerts({ kommentare: [{ user: bot, body: zeile.replace("[ ]", "[x]") }], owner: OWNER, wiedervorlagen: [], sammelTitel: [] });
    expect(b.nummern.size).toBe(0);
  });
  test("Zeile eines fremden Autors zählt nicht", () => {
    const b = C.bekannteAlerts({ kommentare: [{ user: { login: "fremd", type: "User" }, body: zeile }], owner: OWNER, wiedervorlagen: [], sammelTitel: [] });
    expect(b.nummern.size).toBe(0);
  });
  test("Wiedervorlage codescanning-<slug> liefert die Regel, audit- nichts", () => {
    const b = C.bekannteAlerts({
      kommentare: [],
      owner: OWNER,
      sammelTitel: [],
      wiedervorlagen: [{ id: "codescanning-js-path-injection" }, { id: "audit-ghsa-aaaa-bbbb-cccc" }],
    });
    expect([...b.regeln]).toEqual(["js-path-injection"]);
  });
  test("Feld alerts einer codescanning-Wiedervorlage liefert Nummern, bei audit- nichts", () => {
    const b = C.bekannteAlerts({
      kommentare: [],
      owner: OWNER,
      sammelTitel: [],
      wiedervorlagen: [{ id: "codescanning-x", alerts: [7, 8] }, { id: "audit-ghsa-aaaa-bbbb-cccc", alerts: [9] }, { id: "codescanning-y" }],
    });
    expect([...b.alerts].sort()).toEqual([7, 8]);
  });
  test("Feld alerts: nur ganze Zahlen zählen, Strings, Kommazahlen und null fallen weg", () => {
    const b = C.bekannteAlerts({
      kommentare: [],
      owner: OWNER,
      sammelTitel: [],
      wiedervorlagen: [{ id: "codescanning-x", alerts: [7, "8", 1.5, null, NaN] as unknown as number[] }],
    });
    expect([...b.alerts]).toEqual([7]);
  });
  test("Audit-Zeile eines vertrauten Kommentars macht die GHSA bekannt, die eines Fremden nicht (#1433)", () => {
    const audit = "- [ ] Audit: GHSA-aaaa-bbbb-cccc in x";
    const vertraut = C.bekannteAlerts({ kommentare: [{ user: bot, body: audit }], owner: OWNER, wiedervorlagen: [], sammelTitel: [] });
    expect([...vertraut.ghsa]).toEqual(["ghsa-aaaa-bbbb-cccc"]);
    const fremd = C.bekannteAlerts({ kommentare: [{ user: { login: "fremd", type: "User" }, body: audit }], owner: OWNER, wiedervorlagen: [], sammelTitel: [] });
    expect(fremd.ghsa.size).toBe(0);
  });
  test("GHSA aus audit-Wiedervorlage und aus Titel ist bekannt", () => {
    const b = C.bekannteAlerts({
      kommentare: [],
      owner: OWNER,
      sammelTitel: [],
      wiedervorlagen: [{ id: "audit-ghsa-vfj7-8cjw-p6xm" }],
      offeneTitel: ["🔒 Security: GHSA-aaaa-bbbb-cccc in x"],
    });
    expect([...b.ghsa].sort()).toEqual(["ghsa-aaaa-bbbb-cccc", "ghsa-vfj7-8cjw-p6xm"]);
  });
});

describe("plane", () => {
  const spitze = (n: number, regel = "js/path-injection") => alert({ nummer: n, regel });
  const rest = (n: number, o: Partial<Alert> = {}) => alert({ nummer: n, tool: "Scorecard", regel: "PinnedDependenciesID", stufe: "high", ...o });

  test("keine Funde ohne Issue: nichts", () => {
    expect(C.plane({ alerts: [], bekannt: keine, offenesIssue: null })).toEqual({ issue: { art: "nichts" }, zeilen: [], abgedeckt: [], nachfolger: [] });
  });
  test("keine Funde mit offenem Issue: schliessen", () => {
    expect(C.plane({ alerts: [], bekannt: keine, offenesIssue: { number: 9, body: "x" } }).issue.art).toBe("schliessen");
  });
  test("nur medium/low: kein Issue, aber Zeile", () => {
    const p = C.plane({ alerts: [spitze(1), spitze(2)].map((a) => ({ ...a, stufe: "medium" })), bekannt: keine, offenesIssue: null });
    expect(p.issue.art).toBe("nichts");
    expect(p.zeilen).toHaveLength(1);
    expect(p.zeilen[0].nummern).toEqual([1, 2]);
  });
  test("das Repo des Plans landet im Body des neuen Spitzen-Tickets", () => {
    const p = C.plane({ alerts: [spitze(1)], bekannt: keine, offenesIssue: null, repo: "eigner/projekt" });
    expect(p.issue.body).toContain("repos/eigner/projekt/code-scanning/alerts/");
  });
  test("Spitze ohne Issue: anlegen mit allen Nummern im Body", () => {
    const p = C.plane({ alerts: [spitze(1), spitze(2)], bekannt: keine, offenesIssue: null });
    expect(p.issue.art).toBe("anlegen");
    expect(p.issue.body).toContain("Alerts 1, 2");
    expect(p.zeilen).toEqual([]);
  });
  test("bereits gemeldeter Alert: keine Zeile", () => {
    const p = C.plane({ alerts: [rest(5)], bekannt: { nummern: new Set([5]), regeln: new Set() }, offenesIssue: null });
    expect(p.zeilen).toEqual([]);
  });
  test("Gruppe mit teils bekannten Nummern: Zeile nur mit neuen", () => {
    const p = C.plane({ alerts: [rest(5), rest(6)], bekannt: { nummern: new Set([5]), regeln: new Set() }, offenesIssue: null });
    expect(p.zeilen[0].nummern).toEqual([6]);
  });
  test("Spitze mit gleichem Body: nichts; mit neuer Nummer: aktualisieren mit neue", () => {
    const erst = C.plane({ alerts: [spitze(1)], bekannt: keine, offenesIssue: null });
    const gleich = C.plane({ alerts: [spitze(1)], bekannt: keine, offenesIssue: { number: 9, body: erst.issue.body as string } });
    expect(gleich.issue.art).toBe("nichts");
    const neu = C.plane({ alerts: [spitze(1), spitze(2)], bekannt: keine, offenesIssue: { number: 9, body: erst.issue.body as string } });
    expect(neu.issue.art).toBe("aktualisieren");
    expect(neu.issue.neue).toEqual([2]);
  });
  test("Body mit CRLF (Handbearbeitung) aber gleichem Inhalt: nichts", () => {
    const erst = C.plane({ alerts: [spitze(1)], bekannt: keine, offenesIssue: null });
    const crlf = (erst.issue.body as string).replace(/\n/g, "\r\n");
    expect(C.plane({ alerts: [spitze(1)], bekannt: keine, offenesIssue: { number: 9, body: crlf } }).issue.art).toBe("nichts");
  });
  test("Spitzen-Alert mit Nummer aus einer Sammelzeile (hochgestuft): trotzdem Spitze", () => {
    const p = C.plane({ alerts: [spitze(5)], bekannt: { nummern: new Set([5]), regeln: new Set() }, offenesIssue: null });
    expect(p.issue.art).toBe("anlegen");
  });
  test("Regel per Wiedervorlage unterdrückt nur die Zeilen-Klasse", () => {
    const b = { nummern: new Set<number>(), regeln: new Set([C.slug("js/path-injection"), C.slug("PinnedDependenciesID")]) };
    const p = C.plane({ alerts: [spitze(1), rest(2)], bekannt: b, offenesIssue: null });
    expect(p.issue.art).toBe("anlegen");
    expect(p.issue.body).toContain("Alerts 1");
    expect(p.zeilen).toEqual([]);
  });
  test("Spitzen-Alert mit Nummer in alerts der Wiedervorlage: unterdrückt, ein anderer derselben Regel nicht", () => {
    const b = { nummern: new Set<number>(), regeln: new Set([C.slug("js/path-injection")]), alerts: new Set([1]) };
    const p = C.plane({ alerts: [spitze(1), spitze(2)], bekannt: b, offenesIssue: null });
    expect(p.issue.art).toBe("anlegen");
    expect(p.issue.body).toContain("Alerts 2");
    expect(p.issue.body).not.toMatch(/Alerts 1\b/);
  });
  test("alerts-Nummer genügt auch ohne Regel in der Wiedervorlage", () => {
    const p = C.plane({ alerts: [spitze(1)], bekannt: { ...keine, alerts: new Set([1]) }, offenesIssue: null });
    expect(p.issue.art).toBe("nichts");
  });
  test("Test-Pfad-Alert wird nie Spitze, aber als Zeile gemeldet", () => {
    const p = C.plane({ alerts: [{ ...spitze(94), pfad: "test/a.test.ts" }], bekannt: keine, offenesIssue: null });
    expect(p.issue.art).toBe("nichts");
    expect(p.zeilen[0].nummern).toEqual([94]);
  });
  test("Zeilen-Alert, dessen Nummer in bekannt.alerts steht, ergibt keine Zeile; andere Nummern bleiben", () => {
    const b = { ...keine, alerts: new Set([5]) };
    expect(C.plane({ alerts: [rest(5)], bekannt: b, offenesIssue: null }).zeilen).toEqual([]);
    expect(C.plane({ alerts: [rest(6)], bekannt: b, offenesIssue: null }).zeilen).toHaveLength(1);
  });
  test("VulnerabilitiesID: alle GHSA bekannt unterdrückt, eine unbekannte oder keine lässt den Alert offen", () => {
    const v = (ghsa: string[]) => rest(5, { regel: "VulnerabilitiesID", ghsa });
    const b = { ...keine, ghsa: new Set(["ghsa-a", "ghsa-b"]) };
    expect(C.plane({ alerts: [v(["ghsa-a", "ghsa-b"])], bekannt: b, offenesIssue: null }).zeilen).toEqual([]);
    expect(C.plane({ alerts: [v(["ghsa-a", "ghsa-x"])], bekannt: b, offenesIssue: null }).zeilen).toHaveLength(1);
    expect(C.plane({ alerts: [v([])], bekannt: b, offenesIssue: null }).zeilen).toHaveLength(1);
  });
  test("Ausgabe ist sortiert und deterministisch", () => {
    const a = [rest(9, { regel: "Z" }), rest(3, { regel: "A" }), rest(1, { regel: "A" })];
    const p1 = C.plane({ alerts: a, bekannt: keine, offenesIssue: null });
    const p2 = C.plane({ alerts: [...a].reverse(), bekannt: keine, offenesIssue: null });
    expect(p1).toEqual(p2);
    expect(p1.zeilen.map((g) => g.regel)).toEqual(["A", "Z"]);
    expect(p1.zeilen[0].nummern).toEqual([1, 3]);
  });
});

describe("Texte", () => {
  const g: Gruppe = { tool: "Scorecard", regel: "Pinned/Deps", stufe: "high", schwere: "error", nummern: [5, 6] };
  test("ZIEL_TITEL beginnt mit dem Marker der Art security", () => {
    const marker = (NOTFAELLE as { art: string; marker: string }[]).find((n) => n.art === "security")?.marker;
    expect(marker).toBeTruthy();
    expect(C.ZIEL_TITEL.startsWith(marker as string)).toBe(true);
  });
  test("Zeile erfüllt das Befundzeilen-Muster und die Nummern sind rücklesbar", () => {
    const z = C.zeilenText(g);
    expect(zaehleBefundZeilen([{ user: bot, body: z }], { vertraut: () => true })).toBe(1);
    expect(C.nummernIn(z)).toEqual([5, 6]);
    expect(z).toContain("codescanning-pinned-deps");
  });
  test("kein #<zahl> in Zeile und Body (GitHub verlinkt es als Issue)", () => {
    expect(C.zeilenText(g)).not.toMatch(/#\d/);
    expect(C.issueBody([g])).not.toMatch(/#\d/);
  });
  test("der Body nennt das übergebene Repo in beiden gh-Befehlen", () => {
    const body = C.issueBody([g], "eigner/projekt");
    expect(body).toContain("gh api repos/eigner/projekt/code-scanning/alerts/<nummer>");
    expect(body).toContain("gh api -X PATCH repos/eigner/projekt/code-scanning/alerts/<nummer>");
  });
});

describe("fuehreAus", () => {
  const plan =(o: Partial<Plan> = {}): Plan => ({ issue: { art: "nichts" }, zeilen: [], nachfolger: [], ...o });
  const GRUPPE: Gruppe = { tool: "Scorecard", regel: "X", stufe: "high", schwere: "error", nummern: [1] };
  function io(o: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const rec = (n: string, r: unknown = true) => (() => (calls.push(n), r));
    const werte = {
      legeIssueAn: rec("legeIssueAn", "7"),
      sortiereEin: rec("sortiereEin", true),
      aktualisiere: rec("aktualisiere"),
      kommentiere: rec("kommentiere"),
      schliesse: rec("schliesse"),
      zielSammelticket: rec("zielSammelticket", 3),
      postZeilen: rec("postZeilen"),
      log: () => undefined,
      projectToken: "t",
      ...o,
    };
    return { calls, io: werte as unknown as Io };
  }
  const fahre = (p: Plan, i: Io, trocken = false) => C.fuehreAus({ plan: p, io: i, trocken });
  const anlegen = plan({ issue: { art: "anlegen", body: "b" } });

  test("trocken: kein Schreib-Aufruf", () => {
    const { calls, io: i } = io();
    expect(fahre(plan({ issue: { art: "anlegen", body: "b" }, zeilen: [GRUPPE] }), i, true)).toBe(0);
    expect(calls).toEqual([]);
  });
  test("PROJECT_TOKEN fehlt: Exit 0, Warnung, Issue trotzdem angelegt", () => {
    const logs: string[] = [];
    const { calls, io: i } = io({ projectToken: "", log: (m: string) => logs.push(m) });
    expect(fahre(anlegen, i)).toBe(0);
    expect(calls).toContain("legeIssueAn");
    expect(calls).not.toContain("sortiereEin");
    expect(logs.some((l) => l.startsWith("::warning::"))).toBe(true);
  });
  test("board-place scheitert: Exit 1", () => {
    const { io: i } = io({ sortiereEin: () => false });
    expect(fahre(anlegen, i)).toBe(1);
  });
  test("aktualisieren: Body setzen, Kommentar nur bei neuen Nummern", () => {
    const a = io();
    expect(fahre(plan({ issue: { art: "aktualisieren", body: "b", neue: [] } }), a.io)).toBe(0);
    expect(a.calls).toEqual(["aktualisiere"]);
    const b = io();
    fahre(plan({ issue: { art: "aktualisieren", body: "b", neue: [4] } }), b.io);
    expect(b.calls).toEqual(["aktualisiere", "kommentiere"]);
  });
  test("schliessen ruft schliesse", () => {
    const { calls, io: i } = io();
    expect(fahre(plan({ issue: { art: "schliessen" } }), i)).toBe(0);
    expect(calls).toEqual(["schliesse"]);
  });
  test("Zeilen ohne Sammelticket: Exit 1", () => {
    const { calls, io: i } = io({ zielSammelticket: () => null });
    expect(fahre(plan({ zeilen: [GRUPPE] }), i)).toBe(1);
    expect(calls).not.toContain("postZeilen");
  });
  test("legeIssueAn wirft: Exit 1, Zeilen werden trotzdem gepostet", () => {
    const { calls, io: i } = io({
      legeIssueAn: () => {
        throw new Error("422");
      },
    });
    expect(fahre(plan({ issue: { art: "anlegen", body: "b" }, zeilen: [GRUPPE] }), i)).toBe(1);
    expect(calls).toContain("postZeilen");
  });
  test("postZeilen wirft: Exit 1", () => {
    const { io: i } = io({
      postZeilen: () => {
        throw new Error("403");
      },
    });
    expect(fahre(plan({ zeilen: [GRUPPE] }), i)).toBe(1);
  });
  test("zielSammelticket wirft: Exit 1", () => {
    const { io: i } = io({
      zielSammelticket: () => {
        throw new Error("403");
      },
    });
    expect(fahre(plan({ zeilen: [GRUPPE] }), i)).toBe(1);
  });
  test("mehrere Zeilen: genau ein postZeilen", () => {
    const { calls, io: i } = io();
    expect(fahre(plan({ zeilen: [GRUPPE, { ...GRUPPE, regel: "Y" }] }), i)).toBe(0);
    expect(calls.filter((c) => c === "postZeilen")).toHaveLength(1);
  });
});

describe("lauf", () => {
  const kontext = { offenesIssue: null, kommentare: [], owner: OWNER, wiedervorlagen: [], sammelTitel: [] };
  test("Alerts nicht lesbar: Exit 1 und kein Schreib-Aufruf (fail-closed, nie schliessen)", () => {
    const calls: string[] = [];
    const logs: string[] = [];
    const i = {
      ladeAlerts: () => {
        throw new Error("403");
      },
      ladeKontext: () => kontext,
      schliesse: () => calls.push("schliesse"),
      log: (m: string) => logs.push(m),
    };
    expect(C.lauf({ io: i, trocken: false })).toBe(1);
    expect(calls).toEqual([]);
    expect(logs.some((l) => l.startsWith("::error::"))).toBe(true);
  });
  test("Alerts nicht lesbar bei offenem Spitzen-Ticket: kein Schreib-Aufruf (fail-closed)", () => {
    const calls: string[] = [];
    const i = {
      ladeAlerts: () => {
        throw new Error("403");
      },
      ladeKontext: () => ({ ...kontext, offenesIssue: { number: 9, body: "x" } }),
      schliesse: () => calls.push("schliesse"),
      log: () => undefined,
    };
    expect(C.lauf({ io: i, trocken: false })).toBe(1);
    expect(calls).toEqual([]);
  });
  test("Kontext nicht lesbar: Exit 1, kein Schreib-Aufruf", () => {
    const calls: string[] = [];
    const i = {
      ladeAlerts: () => [],
      ladeKontext: () => {
        throw new Error("500");
      },
      schliesse: () => calls.push("schliesse"),
      log: () => undefined,
    };
    expect(C.lauf({ io: i, trocken: false })).toBe(1);
    expect(calls).toEqual([]);
  });
  test("abgedeckter Alert: Log nennt Issue und Grund, Schließ-Kommentar nennt das deckende Issue", () => {
    const logs: string[] = [];
    const kommentare: string[] = [];
    const i = {
      ladeAlerts: () => [roh({ number: 5 })],
      ladeKontext: () => ({ ...kontext, offenesIssue: { number: 9, body: "x" }, offeneIssues: [{ number: 1703, title: "S", body: "Code-Scanning-Alert 5", user: { login: OWNER, type: "User" } }] }),
      schliesse: (_n: number, k: string) => kommentare.push(k),
      log: (m: string) => logs.push(m),
      projectToken: "t",
    };
    expect(C.lauf({ io: i, trocken: false })).toBe(0);
    expect(logs).toContain("Code-Scanning-Inbox: Alerts 5 abgedeckt durch #1703 (nummer)");
    expect(kommentare[0]).toContain("#1703");
    expect(kommentare[0]).not.toContain("Keine offenen");
  });
  test("Log gruppiert je deckendem Issue, Nummern aufsteigend, Gründe ohne Doppel", () => {
    const logs: string[] = [];
    const i = {
      ladeAlerts: () => [roh({ number: 6 }), roh({ number: 5 }), roh({ number: 7, most_recent_instance: { location: { path: "src/game/x.ts" } } })],
      ladeKontext: () => ({ ...kontext, offenesIssue: { number: 9, body: "x" }, offeneIssues: [{ number: 1704, title: "A", body: "Code-Scanning-Alerts 5, 6", user: { login: OWNER, type: "User" } }, { number: 1703, title: "B", body: "js/path-injection in src/game/", user: { login: OWNER, type: "User" } }] }),
      schliesse: () => undefined,
      log: (m: string) => logs.push(m),
      projectToken: "t",
    };
    expect(C.lauf({ io: i, trocken: false })).toBe(0);
    expect(logs).toEqual(["Code-Scanning-Inbox: Alerts 7 abgedeckt durch #1703 (regel+verzeichnis)", "Code-Scanning-Inbox: Alerts 5, 6 abgedeckt durch #1704 (nummer)", "Ticket #9 geschlossen."]);
  });
  test("nur abgedeckte Zeilen-Alerts, kein offenes Ticket: Abdeckung im Log, aber nicht nichts Neues", () => {
    const logs: string[] = [];
    const i = {
      ladeAlerts: () => [roh({ number: 5, tool: { name: "Scorecard" }, rule: { id: "X", severity: "warning" } })],
      ladeKontext: () => ({ ...kontext, offeneIssues: [{ number: 1703, title: "S", body: "Code-Scanning-Alert 5", user: { login: OWNER, type: "User" } }] }),
      log: (m: string) => logs.push(m),
      projectToken: "t",
    };
    expect(C.lauf({ io: i, trocken: false })).toBe(0);
    expect(logs).toContain("Code-Scanning-Inbox: Alerts 5 abgedeckt durch #1703 (nummer)");
    expect(logs.join("|")).not.toContain("nichts Neues");
  });
  test("lesbare Alerts ohne Funde und offenes Issue: schliesst", () => {
    const calls: string[] = [];
    const i = {
      ladeAlerts: () => [],
      ladeKontext: () => ({ ...kontext, offenesIssue: { number: 9, body: "x" } }),
      schliesse: () => calls.push("schliesse"),
      log: () => undefined,
      projectToken: "t",
    };
    expect(C.lauf({ io: i, trocken: false })).toBe(0);
    expect(calls).toEqual(["schliesse"]);
  });
});

describe("main: --dry-run über Deps (#1837)", () => {
  const main = (raw as unknown as { main: (argv: string[], deps: Record<string, unknown>) => Promise<number> }).main;
  const aufbau = () => {
    const gepostet: [number, string][] = [];
    const log: string[] = [];
    const libs = {
      OWNER: OWNER,
      REPO: "o/r",
      SAMMELTICKET_TITEL_LISTE: SAMMELTICKET_TITEL_LISTE as string[],
      ladeSammelKontext: () => ({ rohe: [], offene: [{ number: 5, titel: "Sammel" }], kommentare: [] }),
      vertrauteIssues: () => [],
      offeneTitel: () => [],
      platziereOben: () => undefined,
      postZeilen: (nr: number, text: string) => gepostet.push([nr, text]),
      waehleSammelticket: (offene: { number: number }[]) => offene[0],
    };
    const deps = {
      ladeConfig: () => ({ labels: { harness: "area:harness" } }),
      ladeLibs: () => Promise.resolve(libs),
      ladeSeiten: () => [roh({ tool: { name: "Semgrep" } })],
      log: (m: string) => log.push(m),
      err: () => undefined,
    };
    return { gepostet, log, deps };
  };
  test("mit Flag: [dry-run]-Zeile im Log, nichts gepostet", async () => {
    const { gepostet, log, deps } = aufbau();
    expect(await main(["--dry-run"], deps)).toBe(0);
    expect(log.join("\n")).toContain("[dry-run]");
    expect(gepostet).toEqual([]);
  });
  test("ladeConfig wird an den Start durchgereicht: eine nicht lesbare Config ist Exit 2 mit Meldung", async () => {
    const { gepostet, log, deps } = aufbau();
    const kaputt = { ...deps, ladeConfig: () => { throw new Error("kaputt"); } };
    expect(await main([], kaputt)).toBe(2);
    expect(log.join("\n")).toContain("Code-Scanning-Inbox: Projekt-Config nicht lesbar");
    expect(gepostet).toEqual([]);
  });
  test("Nachfolger über die Deps (#1952): Vorgänger-Liste per Pfad, Dateien je (Commit, Pfad) nur einmal geladen", async () => {
    const { gepostet, deps } = aufbau();
    const inst = (commit: string, start: number) => ({
      commit_sha: commit,
      message: { text: "m" },
      location: { path: "scripts/a mjs.mjs", start_line: start, end_line: start },
    });
    const regel = { id: "js/incomplete-sanitization", severity: "error", security_severity_level: "high" };
    const pfade: string[] = [];
    const geladen: string[] = [];
    const seiten = (pfad: string) => {
      pfade.push(pfad);
      return pfad.includes("state=dismissed")
        ? [{ number: 75, state: "dismissed", rule: regel, tool: { name: "CodeQL" }, dismissed_by: { login: OWNER, type: "User" }, dismissed_reason: "won't fix", most_recent_instance: inst("c0", 1) }]
        : [109, 110].map((number) => ({ number, state: "open", rule: regel, tool: { name: "CodeQL" }, most_recent_instance: inst("c1", 2) }));
    };
    const ladeDatei = (pfad: string, commit: string) => {
      geladen.push(`${commit}:${pfad}`);
      return commit === "c0" ? "gleich\nrest" : "neu\ngleich";
    };
    expect(await main([], { ...deps, ladeSeiten: seiten, ladeDatei })).toBe(0);
    expect(pfade.some((p) => p === "repos/o/r/code-scanning/alerts?state=dismissed&per_page=100")).toBe(true);
    expect(geladen.sort()).toEqual(["c0:scripts/a mjs.mjs", "c1:scripts/a mjs.mjs"]);
    expect(gepostet[0][1]).toContain("Vorgänger Nr. 75");
  });
  test("ohne Flag: Zeile ins Sammelticket gepostet, kein [dry-run]", async () => {
    const { gepostet, log, deps } = aufbau();
    expect(await main([], deps)).toBe(0);
    expect(gepostet).toHaveLength(1);
    expect(gepostet[0][0]).toBe(5);
    expect(log.join("\n")).not.toContain("[dry-run]");
  });
});

describe("Nachfolger vertraut geschlossener Alerts (#1952)", () => {
  const owner = { login: OWNER, type: "User" };
  const fremd = { login: "fremder", type: "User" };
  const instanz = (o: Record<string, unknown> = {}) => ({
    commit_sha: "c1",
    message: { text: "This does not escape backslash characters in the input." },
    location: { path: "scripts/a.mjs", start_line: 13, end_line: 13 },
    ...o,
  });
  const rohAlert = (nummer: number, o: Record<string, unknown> = {}) =>
    roh({ number: nummer, rule: { id: "js/incomplete-sanitization", severity: "error", security_severity_level: "high" }, most_recent_instance: instanz(), ...o });
  const dismissed = (nummer: number, o: Record<string, unknown> = {}) =>
    rohAlert(nummer, { state: "dismissed", dismissed_by: owner, dismissed_reason: "won't fix", most_recent_instance: instanz({ commit_sha: "c0" }), ...o });
  const datei = (zeile13: string, davor = "", danach = "") => `${davor}l1\n${"x\n".repeat(11)}${zeile13}\n${danach}`;

  describe("vorgaengerAus", () => {
    test("nur dismissed von vertrauten Accounts (Owner, github-actions[bot])", () => {
      const l = C.vorgaengerAus(
        [
          dismissed(1),
          dismissed(2, { dismissed_by: { login: "github-actions[bot]", type: "Bot" } }),
          dismissed(3, { dismissed_by: fremd }),
          dismissed(4, { dismissed_by: null }),
          rohAlert(5),
          rohAlert(6, { state: "fixed" }),
        ],
        OWNER,
      );
      expect(l.map((a) => a.nummer)).toEqual([1, 2]);
      expect(l[0].grund).toBe("won't fix");
    });
    test("keine Liste wirft", () => {
      expect(() => C.vorgaengerAus({}, OWNER)).toThrow();
    });
  });

  describe("codeAusschnitt", () => {
    test("CRLF, 1-basiert, getrimmt, mehrzeilig", () => {
      expect(C.codeAusschnitt("a\r\n  b  \r\nc\r\nd", { von: 2, bis: 3 })).toBe("b\nc");
    });
    test("außerhalb des Bereichs, ohne Ort oder ohne Text: leer", () => {
      expect(C.codeAusschnitt("a\nb", { von: 3, bis: 3 })).toBe("");
      expect(C.codeAusschnitt("a\nb", null)).toBe("");
      expect(C.codeAusschnitt(null, { von: 1, bis: 1 })).toBe("");
    });
    test("nur Leerraum in der markierten Zeile: leer", () => {
      expect(C.codeAusschnitt("a\n   \nb", { von: 2, bis: 2 })).toBe("");
    });
  });

  describe("nachfolgerJeAlert", () => {
    const ort14 = { most_recent_instance: instanz({ location: { path: "scripts/a.mjs", start_line: 14, end_line: 14 } }) };
    const eins = (o: Record<string, unknown> = {}) => C.alertsAus([rohAlert(109, { ...ort14, ...o })]);
    const vor = (o: Record<string, unknown> = {}) => C.vorgaengerAus([dismissed(75, o)], OWNER);
    const alt = datei("  const x = a.replace(/\\|/g, '\\\\|');");
    const neu = datei("const x = a.replace(/\\|/g, '\\\\|');", "NEU\n", "mehr\n");
    const liesNach = (alle: Record<string, string | null>) => (p: string, c: string) => alle[`${c}:${p}`] ?? null;
    const dateien = { "c0:scripts/a.mjs": alt, "c1:scripts/a.mjs": neu };

    test("Fall 75→109: gleiche Codezeile bei verschobener Zeilennummer ist ein Nachfolger", () => {
      const a = eins({ most_recent_instance: instanz({ location: { path: "scripts/a.mjs", start_line: 14, end_line: 14 } }) });
      const karte = C.nachfolgerJeAlert({ alerts: a, vorgaenger: vor(), lies: liesNach(dateien) });
      expect(karte.get(109)).toEqual({ vorgaenger: [75], grund: "won't fix" });
    });
    test.each([
      ["andere Regel", { rule: { id: "js/andere", severity: "error", security_severity_level: "high" } }, {}],
      ["anderer Pfad", { most_recent_instance: instanz({ location: { path: "scripts/b.mjs", start_line: 14, end_line: 14 } }) }, {}],
      ["andere Meldung", { most_recent_instance: instanz({ message: { text: "anders" }, location: { path: "scripts/a.mjs", start_line: 14, end_line: 14 } }) }, {}],
      ["anderes Tool", { tool: { name: "Semgrep" } }, {}],
    ])("%s: kein Nachfolger", (_n, spitzeRoh, _v) => {
      const a = eins(spitzeRoh);
      const lies = liesNach({ ...dateien, "c1:scripts/b.mjs": neu });
      expect(C.nachfolgerJeAlert({ alerts: a, vorgaenger: vor(), lies }).size).toBe(0);
    });
    test("geänderte Codezeile bleibt Spitze", () => {
      const lies = liesNach({ ...dateien, "c1:scripts/a.mjs": datei("const y = a.replace(/\\|/g, 'x');", "NEU\n") });
      const a = eins();
      expect(C.nachfolgerJeAlert({ alerts: a, vorgaenger: vor(), lies }).size).toBe(0);
    });
    test("Datei nicht lesbar (null): kein Nachfolger, auch nicht für den Vorgänger", () => {
      expect(C.nachfolgerJeAlert({ alerts: eins(), vorgaenger: vor(), lies: liesNach({ "c0:scripts/a.mjs": alt }) }).size).toBe(0);
      expect(C.nachfolgerJeAlert({ alerts: eins(), vorgaenger: vor(), lies: liesNach({ "c1:scripts/a.mjs": neu }) }).size).toBe(0);
    });
    test("leerer Ausschnitt in beiden Dateien ist kein Treffer", () => {
      const leer = datei("   ", "NEU\n");
      expect(C.nachfolgerJeAlert({ alerts: eins(), vorgaenger: vor(), lies: liesNach({ "c0:scripts/a.mjs": leer, "c1:scripts/a.mjs": leer }) }).size).toBe(0);
    });
    test("ohne Ort, ohne Commit oder ohne Meldung am Alert: kein Nachfolger", () => {
      for (const inst of [{ location: { path: "scripts/a.mjs" } }, { commit_sha: "" }, { message: { text: "" } }]) {
        const a = eins({ most_recent_instance: instanz(inst) });
        const v = C.vorgaengerAus([dismissed(75, { most_recent_instance: instanz({ commit_sha: "c0", ...inst }) })], OWNER);
        expect(C.nachfolgerJeAlert({ alerts: a, vorgaenger: v, lies: liesNach(dateien) }).size).toBe(0);
      }
    });
    test("Zeilen-Klasse und test/-Pfade werden nicht befragt (kein lies-Aufruf)", () => {
      let aufrufe = 0;
      const lies = () => {
        aufrufe += 1;
        return neu;
      };
      const imTest = eins({ most_recent_instance: instanz({ location: { path: "test/a.test.ts", start_line: 13, end_line: 13 } }) });
      const mittel = eins({ rule: { id: "js/incomplete-sanitization", severity: "warning", security_severity_level: "medium" } });
      const v = C.vorgaengerAus([dismissed(75, { most_recent_instance: instanz({ location: { path: "test/a.test.ts", start_line: 13, end_line: 13 } }) })], OWNER);
      C.nachfolgerJeAlert({ alerts: [...imTest, ...mittel], vorgaenger: [...v, ...vor()], lies });
      expect(aufrufe).toBe(0);
    });
    test("der Alert ist nie sein eigener Vorgänger", () => {
      const a = eins();
      const selbst = C.vorgaengerAus([dismissed(109)], OWNER);
      expect(C.nachfolgerJeAlert({ alerts: a, vorgaenger: selbst, lies: liesNach(dateien) }).size).toBe(0);
    });
  });

  describe("plane und Texte", () => {
    const a109 = alert({ nummer: 109, regel: "js/incomplete-sanitization" });
    const folger: Folger = new Map([[109, { vorgaenger: [75], grund: "won't fix" }]]);
    test("Nachfolger wird eine Zeile mit Vorgänger, keine Spitze", () => {
      const p = C.plane({ alerts: [a109], bekannt: keine, offenesIssue: null, nachfolger: folger });
      expect(p.issue.art).toBe("nichts");
      expect(p.zeilen).toHaveLength(1);
      const text = C.zeilenText(p.zeilen[0]);
      expect(text).toContain("Alerts 109");
      expect(text).toContain("Vorgänger Nr. 75");
      expect(text).toContain("won't fix");
      expect(C.nummernIn(text)).toEqual([109]);
      expect(p.nachfolger).toEqual([{ nummer: 109, vorgaenger: [75] }]);
    });
    test("offenes Spitzen-Ticket wird mit Nachfolger-Kommentar geschlossen", () => {
      const p = C.plane({ alerts: [a109], bekannt: keine, offenesIssue: { number: 1952, body: "x" }, nachfolger: folger });
      expect(p.issue).toEqual({ art: "schliessen", nummer: 1952, nachfolger: [109] });
      const kommentare: string[] = [];
      C.fuehreAus({ plan: p, io: { schliesse: (_n: number, k: string) => kommentare.push(k), zielSammelticket: () => 5, postZeilen: () => undefined, log: () => undefined } });
      expect(kommentare[0]).toContain("Alert 109");
      expect(kommentare[0]).toContain("Nachfolger");
    });
    test("gemischt: ein echter Spitzen-Alert bleibt Ticket, der Nachfolger wird Zeile", () => {
      const p = C.plane({ alerts: [a109, alert({ nummer: 110 })], bekannt: keine, offenesIssue: null, nachfolger: folger });
      expect(p.issue.art).toBe("anlegen");
      expect(p.issue.body).toContain("Alerts 110");
      expect(p.issue.body).not.toContain("109");
      expect(p.zeilen.map((g) => g.nummern)).toEqual([[109]]);
    });
    test("Nummer schon in offener Zeile: keine neue Zeile (kein wöchentliches Neu-Posten)", () => {
      const bekannt = { ...keine, nummern: new Set([109]) };
      const p = C.plane({ alerts: [a109], bekannt, offenesIssue: null, nachfolger: folger });
      expect(p.zeilen).toEqual([]);
      expect(p.issue.art).toBe("nichts");
    });
    test("ohne Nachfolger-Map verhält sich der Plan wie bisher (Spitze)", () => {
      expect(C.plane({ alerts: [a109], bekannt: keine, offenesIssue: null }).issue.art).toBe("anlegen");
    });
    test("mehrere Vorgänger und Gründe stehen in der Zeile", () => {
      const f: Folger = new Map([
        [109, { vorgaenger: [75, 80], grund: "won't fix" }],
        [111, { vorgaenger: [90], grund: "false positive" }],
      ]);
      const p = C.plane({ alerts: [a109, alert({ nummer: 111, regel: "js/incomplete-sanitization" })], bekannt: keine, offenesIssue: null, nachfolger: f });
      const text = C.zeilenText(p.zeilen[0]);
      expect(text).toContain("Nr. 75, 80, 90");
      expect(text).toContain("won't fix / false positive");
    });
  });

  describe("lauf", () => {
    const kontext = { offenesIssue: null, kommentare: [], owner: OWNER, wiedervorlagen: [], sammelTitel: [] };
    const lauf = (io: Record<string, unknown>, logs: string[] = []) => {
      const gepostet: string[] = [];
      const code = C.lauf({
        io: { ladeKontext: () => kontext, zielSammelticket: () => 5, postZeilen: (_n: number, t: string) => gepostet.push(t), log: (m: string) => logs.push(m), ...io },
        trocken: false,
      });
      return { code, gepostet, logs };
    };
    const alerts = () => [rohAlert(109, { most_recent_instance: instanz({ location: { path: "scripts/a.mjs", start_line: 14, end_line: 14 } }) })];
    const dateien: Record<string, string> = { "c0:scripts/a.mjs": datei("zeile"), "c1:scripts/a.mjs": datei("zeile", "NEU\n") };
    const lies = (p: string, c: string) => dateien[`${c}:${p}`] ?? null;
    test("Nachfolger: Zeile gepostet, Exit 0, Log nennt den Vorgänger", () => {
      const r = lauf({ ladeAlerts: alerts, ladeVorgaenger: () => [dismissed(75)], ladeDatei: lies });
      expect(r.code).toBe(0);
      expect(r.gepostet).toHaveLength(1);
      expect(r.gepostet[0]).toContain("Vorgänger Nr. 75");
      expect(r.logs.join("\n")).toContain("Alert 109 ist Nachfolger von Nr. 75");
    });
    test("Vorgänger nicht ladbar: Warnung, Alert bleibt Spitze, Exit 0", () => {
      const angelegt: string[] = [];
      const r = lauf({
        ladeAlerts: alerts,
        ladeVorgaenger: () => {
          throw new Error("403");
        },
        ladeDatei: lies,
        legeIssueAn: (_t: string, b: string) => angelegt.push(b) && 7,
        projectToken: undefined,
      });
      expect(r.code).toBe(0);
      expect(r.logs.some((l) => l.startsWith("::warning::Vorgänger-Alerts nicht lesbar"))).toBe(true);
      expect(angelegt).toHaveLength(1);
      expect(r.gepostet).toEqual([]);
    });
    test("ohne ladeVorgaenger in io (Alt-Fakes): unverändert Spitze", () => {
      const angelegt: string[] = [];
      const r = lauf({ ladeAlerts: alerts, legeIssueAn: (_t: string, b: string) => angelegt.push(b) && 7, projectToken: undefined });
      expect(r.code).toBe(0);
      expect(angelegt).toHaveLength(1);
    });
    test("ohne Spitzen-Alert wird die Vorgänger-Liste nicht geladen", () => {
      let geladen = 0;
      lauf({
        ladeAlerts: () => [roh({ tool: { name: "Semgrep" } })],
        ladeVorgaenger: () => {
          geladen += 1;
          return [];
        },
      });
      expect(geladen).toBe(0);
    });
    test("ohne ladeDatei in io: kein Nachfolger (Alert bleibt Spitze)", () => {
      const angelegt: string[] = [];
      lauf({ ladeAlerts: alerts, ladeVorgaenger: () => [dismissed(75)], legeIssueAn: (_t: string, b: string) => angelegt.push(b) && 7, projectToken: undefined });
      expect(angelegt).toHaveLength(1);
    });
  });
});
