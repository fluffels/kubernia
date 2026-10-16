import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/codescanning-inbox.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { NOTFAELLE } from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { zaehleBefundZeilen } from "../scripts/sammelticket-anlegen.mjs";

type Alert = { nummer: number; tool: string; regel: string; stufe: string | null; schwere: string; state: string };
type Gruppe = { tool: string; regel: string; stufe: string | null; schwere: string; nummern: number[] };
type Plan = { issue: { art: string; body?: string; neue?: number[] }; zeilen: Gruppe[] };
type Io = Record<string, (...a: never[]) => unknown>;
const C = raw as unknown as {
  ZIEL_TITEL: string;
  alertsAus: (l: unknown) => Alert[];
  klasse: (a: Partial<Alert>) => string;
  slug: (r: string) => string;
  nummernIn: (t: string) => number[];
  bekannteAlerts: (a: {
    kommentare: { user: unknown; body: string }[];
    owner: string;
    wiedervorlagen: { id: string }[];
  }) => { nummern: Set<number>; regeln: Set<string> };
  zeilenText: (g: Gruppe) => string;
  issueBody: (g: Gruppe[]) => string;
  plane: (a: { alerts: Alert[]; bekannt: { nummern: Set<number>; regeln: Set<string> }; offenesIssue: { number: number; body: string } | null }) => Plan;
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
  ])("%s -> %s", (_n, o, erwartet) => {
    expect(C.klasse(alert(o as Partial<Alert>))).toBe(erwartet);
  });
});

describe("alertsAus", () => {
  test("normalisiert und behält nur offene", () => {
    const l = C.alertsAus([roh({ number: 3 }), roh({ number: 4, state: "fixed" }), roh({ number: 5, state: "dismissed" })]);
    expect(l).toEqual([{ nummer: 3, tool: "CodeQL", regel: "js/path-injection", stufe: "high", schwere: "error", state: "open" }]);
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
  test("fehlende Stufe wird null", () => {
    const [a] = C.alertsAus([roh({ rule: { id: "x/y", severity: "warning" } })]);
    expect(a.stufe).toBeNull();
  });
});

describe("nummernIn", () => {
  test("liest Alerts-Listen", () => {
    expect(C.nummernIn("Code-Scanning: CodeQL x (high), Alerts 5, 6, 7. Vorschlag: …")).toEqual([5, 6, 7]);
    expect(C.nummernIn("Alert 12.")).toEqual([12]);
    expect(C.nummernIn("nichts")).toEqual([]);
  });
});

describe("bekannteAlerts", () => {
  const zeile = "- [ ] Code-Scanning: Scorecard Foo (high), Alerts 8, 9. Vorschlag: x";
  test("offene Zeile vertrauter Autoren liefert Nummern", () => {
    const b = C.bekannteAlerts({ kommentare: [{ user: bot, body: zeile }], owner: OWNER, wiedervorlagen: [] });
    expect([...b.nummern].sort()).toEqual([8, 9]);
  });
  test("erledigte Zeile [x] zählt nicht", () => {
    const b = C.bekannteAlerts({ kommentare: [{ user: bot, body: zeile.replace("[ ]", "[x]") }], owner: OWNER, wiedervorlagen: [] });
    expect(b.nummern.size).toBe(0);
  });
  test("Zeile eines fremden Autors zählt nicht", () => {
    const b = C.bekannteAlerts({ kommentare: [{ user: { login: "fremd", type: "User" }, body: zeile }], owner: OWNER, wiedervorlagen: [] });
    expect(b.nummern.size).toBe(0);
  });
  test("Wiedervorlage codescanning-<slug> liefert die Regel, audit- nichts", () => {
    const b = C.bekannteAlerts({
      kommentare: [],
      owner: OWNER,
      wiedervorlagen: [{ id: "codescanning-js-path-injection" }, { id: "audit-ghsa-aaaa-bbbb-cccc" }],
    });
    expect([...b.regeln]).toEqual(["js-path-injection"]);
  });
});

describe("plane", () => {
  const spitze = (n: number, regel = "js/path-injection") => alert({ nummer: n, regel });
  const rest = (n: number, o: Partial<Alert> = {}) => alert({ nummer: n, tool: "Scorecard", regel: "PinnedDependenciesID", stufe: "high", ...o });

  test("keine Funde ohne Issue: nichts", () => {
    expect(C.plane({ alerts: [], bekannt: keine, offenesIssue: null })).toEqual({ issue: { art: "nichts" }, zeilen: [] });
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
  test("Regel per Wiedervorlage: weder Issue noch Zeile", () => {
    const b = { nummern: new Set<number>(), regeln: new Set([C.slug("js/path-injection"), C.slug("PinnedDependenciesID")]) };
    const p = C.plane({ alerts: [spitze(1), rest(2)], bekannt: b, offenesIssue: null });
    expect(p.issue.art).toBe("nichts");
    expect(p.zeilen).toEqual([]);
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
});

describe("fuehreAus", () => {
  const plan =(o: Partial<Plan> = {}): Plan => ({ issue: { art: "nichts" }, zeilen: [], ...o });
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
  test("mehrere Zeilen: genau ein postZeilen", () => {
    const { calls, io: i } = io();
    expect(fahre(plan({ zeilen: [GRUPPE, { ...GRUPPE, regel: "Y" }] }), i)).toBe(0);
    expect(calls.filter((c) => c === "postZeilen")).toHaveLength(1);
  });
});

describe("lauf", () => {
  const kontext = { offenesIssue: null, kommentare: [], owner: OWNER, wiedervorlagen: [] };
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
