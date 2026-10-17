/* Factory-Kennzahlen (#1616, ADR 0022 §6): pure Kernfunktionen, Lücken statt 0 (AK3), Verträge gegen die echten
 * Erzeuger `bewertePrs` (lauf-ergebnis.mjs) und `summarize` (token-baseline.mjs); die Unterprozesse sind injiziert. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/factory-kennzahlen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLauf from "../scripts/lauf-ergebnis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSlice from "../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBase from "../scripts/token-baseline.mjs";

type Abnahme = { durchgaenge: number } | "entfaellt" | "override" | null;
type Zeile = { pr: number; ticket: number | null; gemergt: string; runden: number | null; ciFix: number; festgefahren: number; nacharbeit: string; abnahme: Abnahme };
type AbnahmeKenn = { gemessen: number; ersterDurchgang: number; entfaellt: number; override: number; ohne: number };
type Kennzahlen = Record<string, number | AbnahmeKenn>;
type Daten = { zeilen: Zeile[]; kennzahlen: Kennzahlen };
type Erg = { kosten?: number; luecke?: string };
type Lage = { daten?: Daten; luecke?: string };
type Run = (name: string, args: string[]) => { status: number; stdout: string; stderr: string };
const F = raw as unknown as {
  NACHARBEIT_TAGE: number;
  parseArgs: (a: string[]) => { von?: string; bis?: string; langfuse: boolean; json: boolean; fehler: string | null };
  nacharbeitFenster: (von: string, bis: string) => { von: string; bis: string };
  claimSessions: (s: unknown[]) => Map<number, { session: string; ts: string }[]>;
  ticketLaeufe: (z: Zeile[]) => { tickets: Zeile[]; ohneTicket: number };
  kostenAus: (e: { json?: unknown; fehler?: string }) => Erg;
  vertragPruefen: (j: unknown) => Lage;
  bericht: (e: { von: string; bis: string; lauf: Lage; nacharbeit: Lage; tickets: { ticket: number; pr: number; ergebnis: Erg }[]; quelle: string }) => unknown;
  renderMarkdown: (b: unknown) => string;
  holeLauf: (von: string, bis: string, run: Run) => Lage;
  holeKosten: (e: { ticket: number; pr: number; claims?: { session: string; ts: string }[]; langfuse?: boolean }, run: Run) => Erg;
};
const LAUF = rawLauf as unknown as {
  NACHARBEIT_TAGE: number;
  bewertePrs: (e: unknown) => Daten;
};
const ZEILEN = (rawSlice as unknown as { commitZeilen: (praefix: string, planer: string) => unknown }).commitZeilen("KQ-", "kubernia-planner");
const BASE = rawBase as unknown as { summarize: (run: { calls: unknown[]; questions: number; events?: unknown[] }, bounds?: unknown) => unknown };

const ZEILE = (o: Partial<Zeile> = {}): Zeile => ({ pr: 50, ticket: 40, gemergt: "2026-10-14T10:00:00Z", runden: 1, ciFix: 0, festgefahren: 0, nacharbeit: "nein", abnahme: null, ...o });
const KENN: Kennzahlen = { prs: 1, ohneNacharbeit: 1, nachweisbareFenster: 1, nacharbeitOffen: 0, ciFixSumme: 0, festgefahrenSumme: 0, runde1MitBlocker: 0, mitBlockerFeld: 1, abnahme: { gemessen: 0, ersterDurchgang: 0, entfaellt: 0, override: 0, ohne: 1 } };
const daten = (zeilen: Zeile[], k: Kennzahlen = {}): Lage => ({ daten: { zeilen, kennzahlen: { ...KENN, prs: zeilen.length, ...k } } });
const claimZeile = (cmd: string, ts: string) => ({ type: "assistant", timestamp: ts, message: { id: ts, content: [{ type: "tool_use", id: `t${ts}`, name: "Bash", input: { command: cmd } }] } });

describe("parseArgs", () => {
  test("Pflicht: --von und --bis als ISO; ohne oder ungültig ist ein Aufruffehler", () => {
    expect(F.parseArgs(["--von", "2026-10-12T00:00:00Z", "--bis", "2026-10-16T00:00:00Z"]).fehler).toBeNull();
    expect(F.parseArgs(["--bis", "2026-10-16T00:00:00Z"]).fehler).toMatch(/--von/);
    expect(F.parseArgs(["--von", "kaputt", "--bis", "2026-10-16T00:00:00Z"]).fehler).toMatch(/ISO/);
    expect(F.parseArgs(["--von", "2026-10-12T00:00:00Z", "--bis", "2026-10-16T00:00:00Z", "--x"]).fehler).toMatch(/Unbekannt/);
  });
  test("Schalter --langfuse und --json", () => {
    const a = F.parseArgs(["--von", "2026-10-12T00:00:00Z", "--bis", "2026-10-16T00:00:00Z", "--langfuse", "--json"]);
    expect([a.langfuse, a.json]).toEqual([true, true]);
  });
});

describe("nacharbeitFenster", () => {
  test("exakt [von − 14 T, bis − 14 T] als ISO", () => {
    expect(F.nacharbeitFenster("2026-10-12T00:00:00Z", "2026-10-16T00:00:00Z")).toEqual({ von: "2026-09-28T00:00:00.000Z", bis: "2026-10-02T00:00:00.000Z" });
  });
  test("die 14 Tage stimmen mit lauf-ergebnis überein (Vertrag)", () => {
    expect(F.NACHARBEIT_TAGE).toBe(LAUF.NACHARBEIT_TAGE);
  });
});

describe("claimSessions", () => {
  const sitzung = (id: string, main: unknown[], sub: unknown[] = []) => ({ id, main, subagents: [{ datei: "a.jsonl", meta: {}, zeilen: sub }] });
  test("Claim in Haupt- und Subagenten-Zeilen, je Session der früheste, nach Zeit sortiert", () => {
    const karte = F.claimSessions(
      [...(function* () {
        yield sitzung("s2", [claimZeile("gh issue edit 40 --add-assignee @me", "2026-10-14T09:00:00Z")]);
        yield sitzung(
          "s1",
          [claimZeile("gh issue edit 40 --add-assignee @me", "2026-10-14T08:00:00Z"), claimZeile("gh issue edit 40 --add-assignee @me", "2026-10-14T07:00:00Z")],
          [claimZeile("gh issue edit 41 --add-assignee @me", "2026-10-14T06:00:00Z")],
        );
      })()],
    );
    expect(karte.get(40)).toEqual([
      { session: "s1", ts: "2026-10-14T07:00:00Z" },
      { session: "s2", ts: "2026-10-14T09:00:00Z" },
    ]);
    expect(karte.get(41)).toEqual([{ session: "s1", ts: "2026-10-14T06:00:00Z" }]);
  });
  test("kein Claim: Entfernen, Ansehen und andere Tools", () => {
    const karte = F.claimSessions([
      sitzung("s", [
        claimZeile("gh issue edit 40 --remove-assignee @me", "2026-10-14T07:00:00Z"),
        claimZeile("gh issue view 40", "2026-10-14T07:01:00Z"),
        { type: "assistant", timestamp: "2026-10-14T07:02:00Z", message: { id: "x", content: [{ type: "tool_use", id: "u", name: "Read", input: { command: "gh issue edit 40 --add-assignee" } }] } },
      ]),
    ]);
    expect(karte.size).toBe(0);
  });
  test("PowerShell-Tool zählt wie Bash", () => {
    const z = claimZeile("gh issue edit 40 --add-assignee @me", "2026-10-14T07:00:00Z") as { message: { content: { name: string }[] } };
    z.message.content[0].name = "PowerShell";
    expect(F.claimSessions([sitzung("s", [z])]).get(40)).toEqual([{ session: "s", ts: "2026-10-14T07:00:00Z" }]);
  });
  test("Claim ohne gültigen Zeitstempel erzeugt keinen Eintrag", () => {
    const ohne = claimZeile("gh issue edit 40 --add-assignee @me", "2026-10-14T07:00:00Z") as { timestamp?: string };
    delete ohne.timestamp;
    expect(F.claimSessions([sitzung("s", [ohne, claimZeile("gh issue edit 41 --add-assignee @me", "kein-datum")])]).size).toBe(0);
  });
});

describe("ticketLaeufe", () => {
  test("der neuere PR gewinnt unabhängig von der Reihenfolge im Array", () => {
    const r = F.ticketLaeufe([ZEILE({ pr: 9, ticket: 5, gemergt: "2026-10-15T10:00:00Z" }), ZEILE({ pr: 10, ticket: 5, gemergt: "2026-10-14T10:00:00Z" })]);
    expect(r.tickets.map((z) => z.pr)).toEqual([9]);
  });
  test("gleiche Merge-Zeit: die größere PR-Nummer gewinnt, auch wenn sie zuerst steht", () => {
    const r = F.ticketLaeufe([ZEILE({ pr: 12, ticket: 5 }), ZEILE({ pr: 11, ticket: 5 })]);
    expect(r.tickets.map((z) => z.pr)).toEqual([12]);
  });
  test("Tickets aufsteigend nach Nummer", () => {
    expect(F.ticketLaeufe([ZEILE({ pr: 1, ticket: 30 }), ZEILE({ pr: 2, ticket: 7 })]).tickets.map((z) => z.ticket)).toEqual([7, 30]);
  });
  test("PR ohne Ticket wird nur gezählt, kein Ticket-Eintrag", () => {
    const r = F.ticketLaeufe([ZEILE({ pr: 1, ticket: null }), ZEILE({ pr: 2, ticket: 5 })]);
    expect(r.ohneTicket).toBe(1);
    expect(r.tickets.map((z) => z.pr)).toEqual([2]);
  });
  test("zwei PRs für dasselbe Ticket: der zuletzt gemergte zählt, eine Zeile", () => {
    const r = F.ticketLaeufe([ZEILE({ pr: 10, ticket: 5, gemergt: "2026-10-14T10:00:00Z" }), ZEILE({ pr: 9, ticket: 5, gemergt: "2026-10-15T10:00:00Z" })]);
    expect(r.tickets.map((z) => z.pr)).toEqual([9]);
  });
});

describe("kostenAus (AK3: Lücke statt 0)", () => {
  const ok = { total: { calls: 3, cost: 1.5 }, hasCost: true, unpriced: 0 };
  test("vollständige Daten ergeben Kosten", () => {
    expect(F.kostenAus({ json: ok })).toEqual({ kosten: 1.5 });
  });
  test("total.calls 0 ist Lücke, nicht 0 $", () => {
    const e = F.kostenAus({ json: { total: { calls: 0, cost: 0 }, hasCost: false, unpriced: 0 } });
    expect(e.kosten).toBeUndefined();
    expect(e.luecke).toMatch(/keine Calls/);
  });
  test("Calls ohne Preis (hasCost false) ist Lücke", () => {
    expect(F.kostenAus({ json: { total: { calls: 2, cost: 0 }, hasCost: false, unpriced: 2 } }).luecke).toMatch(/ohne Preis/);
  });
  test("unpriced > 0 ist Lücke mit Modellen, keine Teilsumme", () => {
    const e = F.kostenAus({ json: { ...ok, unpriced: 2, unpricedModels: { "claude-x": 2 } } });
    expect(e.kosten).toBeUndefined();
    expect(e.luecke).toBe("2 Calls ohne Preis: claude-x (2)");
  });
  test("hasCost false ohne unpriced ist trotzdem Lücke", () => {
    expect(F.kostenAus({ json: { total: { calls: 2, cost: 0 }, hasCost: false, unpriced: 0 } }).luecke).toBe("Calls ohne Preis");
  });
  test("unpriced ohne Modellliste: Lücke ohne Doppelpunkt", () => {
    expect(F.kostenAus({ json: { ...ok, unpriced: 1 } }).luecke).toBe("1 Calls ohne Preis");
  });
  test("Meldung --langfuse braucht … wird zu „kein Langfuse-Zugang“", () => {
    expect(F.kostenAus({ fehler: "--langfuse braucht LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY; mehr Text\nzweite Zeile" }).luecke).toBe("kein Langfuse-Zugang");
  });
  test("andere Fehlermeldung: erste nichtleere Zeile als Lücke", () => {
    expect(F.kostenAus({ fehler: "\nLangfuse 503\nStack" }).luecke).toBe("Langfuse 503");
    expect(F.kostenAus({ fehler: "" }).luecke).toBe("token-baseline ohne Meldung");
  });
  test("JSON ohne total.cost: Lücke", () => {
    expect(F.kostenAus({ json: {} }).luecke).toMatch(/total\.cost/);
  });
});

describe("vertragPruefen", () => {
  test("fehlendes Kennzahl-Feld nennt das Feld", () => {
    const k: Kennzahlen = { ...KENN };
    delete k.ohneNacharbeit;
    expect(F.vertragPruefen({ zeilen: [], kennzahlen: k }).luecke).toMatch(/ohneNacharbeit/);
    expect(F.vertragPruefen({}).luecke).toMatch(/Vertrag/);
    expect(F.vertragPruefen(null).luecke).toMatch(/Vertrag/);
  });
  test("echtes bewertePrs aus lauf-ergebnis erfüllt den Vertrag", () => {
    const e = LAUF.bewertePrs({ prs: [], commits: [], ci: {}, festgefahren: {}, jetzt: new Date("2026-12-31T00:00:00Z"), konfigZeilen: ZEILEN });
    expect(F.vertragPruefen(e).daten).toBeDefined();
  });
  test("echtes bewertePrs mit PR und Folge-Commit: Zeilenfelder tragen bis in den Bericht", () => {
    const e = LAUF.bewertePrs({
      prs: [{ number: 7, title: "feat: x (#40)", createdAt: "2026-09-30T00:00:00Z", mergedAt: "2026-10-01T00:00:00Z", mergeCommit: { oid: "abc1234" } }],
      commits: [
        { sha: "abc1234", datum: "2026-10-01T00:00:00Z", body: "feat: x (#40)" },
        { sha: "def5678", datum: "2026-10-03T00:00:00Z", body: "fix: y\n\nFolge #40" },
      ],
      ci: {},
      festgefahren: {},
      jetzt: new Date("2026-12-31T00:00:00Z"),
      konfigZeilen: ZEILEN,
    });
    const lage = F.vertragPruefen(e);
    expect(lage.daten).toBeDefined();
    const md = F.renderMarkdown(F.bericht({ von: "2026-09-28T00:00:00Z", bis: "2026-10-02T00:00:00Z", quelle: "Transkript", lauf: lage, nacharbeit: lage, tickets: [] }));
    expect(md).toContain("Ohne CI-Fix: 100 % (1/1)");
    expect(md).toContain("- Nacharbeit (folge): PR #7, Ticket #40");
  });
  test("Abnahme-Vertrag (#1756): fehlendes Aggregat, fehlendes Unterfeld und ungültiges Zeilenfeld sind Lücken", () => {
    const ohne: Kennzahlen = { ...KENN };
    delete ohne.abnahme;
    expect(F.vertragPruefen({ zeilen: [], kennzahlen: ohne }).luecke).toMatch(/abnahme/);
    const teil = { ...(KENN.abnahme as AbnahmeKenn), ersterDurchgang: Number.NaN };
    expect(F.vertragPruefen({ zeilen: [], kennzahlen: { ...KENN, abnahme: teil } }).luecke).toMatch(/abnahme.ersterDurchgang/);
    const ohneFeld = { ...ZEILE(), abnahme: undefined };
    for (const z of [ohneFeld, ZEILE({ abnahme: { durchgaenge: 0 } }), { ...ZEILE(), abnahme: "x" }, ZEILE({ abnahme: { durchgaenge: 1.5 } })]) {
      expect(F.vertragPruefen({ zeilen: [z], kennzahlen: KENN }).luecke).toMatch(/Zeile/);
    }
    for (const a of [null, "entfaellt", "override", { durchgaenge: 2 }] as Abnahme[]) {
      expect(F.vertragPruefen({ zeilen: [ZEILE({ abnahme: a })], kennzahlen: KENN }).daten).toBeDefined();
    }
  });
  test("NaN-Kennzahl und Zeile ohne ciFix verletzen den Vertrag", () => {
    expect(F.vertragPruefen({ zeilen: [], kennzahlen: { ...KENN, ciFixSumme: Number.NaN } }).luecke).toMatch(/ciFixSumme/);
    const ohneCiFix = { ...ZEILE(), ciFix: undefined } as unknown as Zeile;
    expect(F.vertragPruefen({ zeilen: [ohneCiFix], kennzahlen: KENN }).luecke).toMatch(/Zeile/);
    expect(F.vertragPruefen({ zeilen: [ZEILE({ gemergt: "kaputt" })], kennzahlen: KENN }).luecke).toMatch(/Zeile/);
    for (const z of [null, { ...ZEILE(), pr: undefined }, { ...ZEILE(), pr: "7" }, { ...ZEILE(), nacharbeit: undefined }]) {
      expect(F.vertragPruefen({ zeilen: [z], kennzahlen: KENN }).luecke).toMatch(/Zeile/);
    }
  });
});

describe("Abnahme-Quote (#1756)", () => {
  const prNr = (n: number) => ({ number: n, title: "feat: x (#40)", createdAt: "2026-09-30T00:00:00Z", mergedAt: "2026-10-01T00:00:00Z", mergeCommit: { oid: String(n) + "abc1234" } });
  const body = (...zeilen: string[]) => ["feat: x (#40)", "", ...zeilen].join(String.fromCharCode(10));
  const h = "c".repeat(40);
  const urteil = (d: number) => "KQ-Abnahme: head=" + h + " durchgaenge=" + d + " urteil=K1:erfuellt";
  const echt = (bodies: string[]) =>
    LAUF.bewertePrs({
      prs: bodies.map((_, i) => prNr(i + 1)),
      commits: bodies.map((b, i) => ({ sha: String(i + 1) + "abc1234", datum: "2026-10-01T00:00:00Z", body: b })),
      ci: {},
      festgefahren: {},
      jetzt: new Date("2026-12-31T00:00:00Z"),
      konfigZeilen: ZEILEN,
    });
  const md = (lauf: Lage) => F.renderMarkdown(F.bericht({ von: "2026-09-28T00:00:00Z", bis: "2026-10-02T00:00:00Z", quelle: "Transkript", lauf, nacharbeit: lauf, tickets: [] })).split("**Abnahme-Quote**")[1];

  test("echtes bewertePrs: k von n im ersten Durchgang, entfällt, Override mit PR-Nummer und ohne getrennt genannt", () => {
    const e = echt([
      body(urteil(1)),
      body(urteil(2)),
      body("KQ-Abnahme: entfaellt — Hand-PR"),
      body("KQ-Abnahme-Override: #1755 grund"),
      body("nichts"),
    ]);
    const lage = F.vertragPruefen(e);
    expect(lage.daten).toBeDefined();
    const a = md(lage);
    expect(a).toContain("- 1 von 2 im ersten Durchgang (50 %)");
    expect(a).toContain("- Nicht in der Quote: entfällt 1, Override 1 (PR #4), ohne Abnahme-Zeile 1");
  });
  test("Negativfall: ohne Abnahme-Urteil steht eine Lücke mit Grund, nie 0 %", () => {
    const lage = F.vertragPruefen(echt([body("nichts"), body("KQ-Abnahme: entfaellt — Hand-PR")]));
    const a = md(lage);
    expect(a).toContain("- Lücke: keine PR mit Abnahme-Urteil im Zeitraum");
    expect(a).not.toMatch(/0 %/);
    expect(a).not.toContain("im ersten Durchgang");
  });
  test("K3: fehlt das Aggregat oder das Zeilenfeld im echten bewertePrs-Ergebnis, endet erstelle mit Exit 2", () => {
    const erstelle = (raw as unknown as { erstelle: (e: { von: string; bis: string }, d: { run: Run; claimKarte: () => Map<number, unknown[]> }) => { bericht: { lauf: Lage }; exit: number } }).erstelle;
    const fahre = (verderbe: (j: { zeilen: Record<string, unknown>[]; kennzahlen: Record<string, unknown> }) => void) => {
      const j = JSON.parse(JSON.stringify(echt([body(urteil(1))]))) as { zeilen: Record<string, unknown>[]; kennzahlen: Record<string, unknown> };
      verderbe(j);
      const run: Run = () => ({ status: 0, stdout: JSON.stringify(j), stderr: "" });
      return erstelle({ von: "2026-10-12T00:00:00Z", bis: "2026-10-16T00:00:00Z" }, { run, claimKarte: () => new Map() });
    };
    expect(fahre(() => undefined).exit).toBe(0);
    const a = fahre((j) => delete j.kennzahlen.abnahme);
    expect(a.exit).toBe(2);
    expect(a.bericht.lauf.luecke).toMatch(/abnahme/);
    const b = fahre((j) => delete j.zeilen[0].abnahme);
    expect(b.exit).toBe(2);
    expect(b.bericht.lauf.luecke).toMatch(/Zeile/);
  });
});

describe("Vertrag mit token-baseline summarize", () => {
  const call = (cost: number | null) => ({ ts: "2026-10-14T10:00:00Z", model: "claude-opus-5-5", input: 10, cacheWrite: 0, cacheRead: 0, output: 5, cost });
  test("gepriesene Calls ergeben Kosten, ohne Calls Lücke", () => {
    expect(F.kostenAus({ json: BASE.summarize({ calls: [call(1.25), call(0.25)], questions: 0 }) })).toEqual({ kosten: 1.5 });
    expect(F.kostenAus({ json: BASE.summarize({ calls: [], questions: 0 }) }).luecke).toMatch(/keine Calls/);
  });
  test("ein Call ohne Preis macht das Ticket zur Lücke", () => {
    expect(F.kostenAus({ json: BASE.summarize({ calls: [call(1), call(null)], questions: 0 }) }).luecke).toMatch(/1 Calls ohne Preis/);
  });
});

describe("Unterprozesse (injiziert)", () => {
  test("holeLauf: Exit ≠ 0 ist Lücke mit erster stderr-Zeile; kaputtes JSON ebenso", () => {
    expect(F.holeLauf("a", "b", () => ({ status: 2, stdout: "", stderr: "\n✖ lauf-ergebnis: gh weg\nmehr" })).luecke).toBe("lauf-ergebnis Exit 2: ✖ lauf-ergebnis: gh weg");
    expect(F.holeLauf("a", "b", () => ({ status: 0, stdout: "kein json", stderr: "" })).luecke).toMatch(/kein JSON/);
  });
  test("holeLauf reicht das Zeitfenster und --json an lauf-ergebnis", () => {
    let gesehen: string[] = [];
    F.holeLauf("A", "B", (n, a) => {
      gesehen = [n, ...a];
      return { status: 0, stdout: JSON.stringify({ zeilen: [], kennzahlen: KENN }), stderr: "" };
    });
    expect(gesehen).toEqual(["lauf-ergebnis.mjs", "--von", "A", "--bis", "B", "--json"]);
  });
  test("holeKosten: Ticket ohne Claim-Session ist Lücke, ohne Prozessaufruf", () => {
    const nie: Run = () => {
      throw new Error("darf nicht laufen");
    };
    expect(F.holeKosten({ ticket: 40, pr: 50, claims: undefined }, nie).luecke).toBe("keine Session mit Claim-Zeile");
    expect(F.holeKosten({ ticket: 40, pr: 50, claims: [] }, nie).luecke).toBe("keine Session mit Claim-Zeile");
  });
  test("holeKosten: alle Sessions, früheste Claim-Zeit als --from, --langfuse nur auf Wunsch", () => {
    const aufrufe: string[][] = [];
    const run: Run = (_n, a) => {
      aufrufe.push(a);
      return { status: 0, stdout: JSON.stringify({ total: { calls: 1, cost: 2 }, hasCost: true, unpriced: 0 }), stderr: "" };
    };
    const claims = [
      { session: "s1", ts: "2026-10-14T07:00:00Z" },
      { session: "s2", ts: "2026-10-14T09:00:00Z" },
    ];
    expect(F.holeKosten({ ticket: 40, pr: 50, claims }, run)).toEqual({ kosten: 2 });
    expect(aufrufe[0]).toEqual(["--session", "s1", "--session", "s2", "--issue", "40", "--pr", "50", "--from", "2026-10-14T07:00:00Z", "--json"]);
    F.holeKosten({ ticket: 40, pr: 50, claims, langfuse: true }, run);
    expect(aufrufe[1]).toContain("--langfuse");
  });
  test("holeKosten: kaputte Ausgabe und Exit ≠ 0 ohne stderr sind Lücke, nie 0", () => {
    const claims = [{ session: "s", ts: "2026-10-14T07:00:00Z" }];
    expect(F.holeKosten({ ticket: 40, pr: 50, claims }, () => ({ status: 0, stdout: "kaputt", stderr: "" }))).toEqual({ luecke: "token-baseline: Ausgabe ist kein JSON" });
    expect(F.holeKosten({ ticket: 40, pr: 50, claims }, () => ({ status: 3, stdout: "", stderr: "" }))).toEqual({ luecke: "token-baseline Exit 3" });
  });
  test("holeKosten Langfuse: je Session ein Lauf, eine Session ohne Daten macht das Ticket zur Lücke (keine Teilsumme)", () => {
    const claims = [
      { session: "s1", ts: "2026-10-14T07:00:00Z" },
      { session: "s2", ts: "2026-10-14T09:00:00Z" },
    ];
    const aufrufe: string[][] = [];
    const run: Run = (_n, a) => {
      aufrufe.push(a);
      const leer = a.includes("s2");
      return { status: 0, stdout: JSON.stringify({ total: { calls: leer ? 0 : 2, cost: leer ? 0 : 3 }, hasCost: !leer, unpriced: 0 }), stderr: "" };
    };
    const e = F.holeKosten({ ticket: 40, pr: 50, claims, langfuse: true }, run);
    expect(e.kosten).toBeUndefined();
    expect(e.luecke).toBe("Session s2: keine Calls im Ticket-Fenster");
    expect(aufrufe).toHaveLength(2);
    expect(aufrufe[1]).toEqual(["--session", "s2", "--issue", "40", "--pr", "50", "--from", "2026-10-14T07:00:00Z", "--langfuse", "--json"]);
    expect(aufrufe[0]).toEqual(["--session", "s1", "--issue", "40", "--pr", "50", "--from", "2026-10-14T07:00:00Z", "--langfuse", "--json"]);
  });
  test("holeKosten Langfuse: alle Sessions mit Daten ergeben die Summe", () => {
    const claims = [
      { session: "s1", ts: "2026-10-14T07:00:00Z" },
      { session: "s2", ts: "2026-10-14T09:00:00Z" },
    ];
    const run: Run = () => ({ status: 0, stdout: JSON.stringify({ total: { calls: 1, cost: 1.5 }, hasCost: true, unpriced: 0 }), stderr: "" });
    expect(F.holeKosten({ ticket: 40, pr: 50, claims, langfuse: true }, run)).toEqual({ kosten: 3 });
  });
  test("holeKosten: ohne Langfuse-Key sind alle Kosten Lücke „kein Langfuse-Zugang“", () => {
    const run: Run = () => ({ status: 1, stdout: "", stderr: "--langfuse braucht LANGFUSE_PUBLIC_KEY + …" });
    expect(F.holeKosten({ ticket: 40, pr: 50, claims: [{ session: "s", ts: "2026-10-14T07:00:00Z" }], langfuse: true }, run).luecke).toBe("kein Langfuse-Zugang");
  });
});

describe("Markdown-Block", () => {
  const von = "2026-10-12T00:00:00Z";
  const bis = "2026-10-16T00:00:00Z";
  const render = (e: { lauf: Lage; nacharbeit: Lage; tickets: { ticket: number; pr: number; ergebnis: Erg }[] }) => F.renderMarkdown(F.bericht({ von, bis, quelle: "Transkript", ...e }));

  test("Kosten: Median ignoriert Lücken, „n von N gemessen“, nie 0 $ für fehlende Daten", () => {
    const md = render({
      lauf: daten([ZEILE({ pr: 1, ticket: 1 }), ZEILE({ pr: 2, ticket: 2 }), ZEILE({ pr: 3, ticket: 3 }), ZEILE({ pr: 4, ticket: null })]),
      nacharbeit: daten([]),
      tickets: [
        { ticket: 1, pr: 1, ergebnis: { kosten: 2 } },
        { ticket: 2, pr: 2, ergebnis: { kosten: 4 } },
        { ticket: 3, pr: 3, ergebnis: { luecke: "keine Calls im Ticket-Fenster" } },
      ],
    });
    expect(md).toContain("Median Kosten/Ticket: 3,00 $");
    expect(md).toContain("gemessen: 2 von 3");
    expect(md).toContain("| #3 | #3 | Lücke: keine Calls im Ticket-Fenster |");
    expect(md).toContain("ohne Ticket: 1");
    expect(md).not.toContain("0,00 $");
  });
  test("alle Kosten Lücke: Median „–“, 0 von N gemessen", () => {
    const md = render({ lauf: daten([ZEILE()]), nacharbeit: daten([]), tickets: [{ ticket: 40, pr: 50, ergebnis: { luecke: "kein Langfuse-Zugang" } }] });
    expect(md).toContain("gemessen: 0 von 1");
    expect(md).toContain("Median Kosten/Ticket: –");
    expect(md).not.toContain("0,00 $");
  });
  test("null fällige Nacharbeitsfenster: Lücke-Text statt 0 %", () => {
    const md = render({ lauf: daten([ZEILE()]), nacharbeit: daten([], { ohneNacharbeit: 0, nachweisbareFenster: 0 }), tickets: [] });
    expect(md).toContain("Ohne Nacharbeit: – (kein Fenster fällig)");
    expect(md).not.toMatch(/Ohne Nacharbeit: 0 %/);
  });
  test("Nacharbeit-Treffer nennt PR, Ticket und Art; Fenster steht im Kopf", () => {
    const md = render({
      lauf: daten([ZEILE()]),
      nacharbeit: daten([ZEILE({ pr: 7, ticket: 9, nacharbeit: "folge" }), ZEILE({ pr: 8, ticket: 10, nacharbeit: "revert" }), ZEILE({ pr: 11, ticket: 12 })], { ohneNacharbeit: 1, nachweisbareFenster: 3, nacharbeitOffen: 1 }),
      tickets: [],
    });
    expect(md).toContain("Ohne Nacharbeit: 33 % (1/3)");
    expect(md).toContain("- Nacharbeit (folge): PR #7, Ticket #9");
    expect(md).toContain("- Nacharbeit (revert): PR #8, Ticket #10");
    expect(md).toContain("Fenster noch offen: 1");
    expect(md).toContain("PRs gemergt 2026-09-28 bis 2026-10-02");
  });
  test("Lauf-Ergebnis fehlt: Lücke in Lauf und Kosten, Block erscheint, Abnahme-Quote bleibt Lücke", () => {
    const md = render({ lauf: { luecke: "lauf-ergebnis Exit 2: gh weg" }, nacharbeit: { luecke: "lauf-ergebnis Exit 2: gh weg" }, tickets: [] });
    expect(md).toContain("- Lücke: lauf-ergebnis Exit 2: gh weg");
    expect(md).toContain("kein Lauf-Ergebnis");
    expect(md).toContain("**Abnahme-Quote**");
    expect(md.split("**Abnahme-Quote**")[1]).toContain("- Lücke: kein Lauf-Ergebnis");
    expect(md).not.toContain("folgt mit F13");
  });
  test("Lauf-Ergebnis: Ohne CI-Fix, Runde 1 mit Blocker, Summen", () => {
    const md = render({
      lauf: daten([ZEILE({ pr: 1, ciFix: 0 }), ZEILE({ pr: 2, ticket: 41, ciFix: 2 })], { runde1MitBlocker: 1, mitBlockerFeld: 2, ciFixSumme: 2, festgefahrenSumme: 1 }),
      nacharbeit: daten([]),
      tickets: [],
    });
    expect(md).toContain("Ohne CI-Fix: 50 % (1/2)");
    expect(md).toContain("Runde 1 mit Blocker: 50 % (1/2)");
    expect(md).toContain("Σ CI-Fix-Runden: 2, Σ festgefahren: 1");
  });
});

describe("Markdown-Block: Nenner 0 und leere Listen sind Lücke, nie 0 %", () => {
  const von = "2026-10-12T00:00:00Z";
  const bis = "2026-10-16T00:00:00Z";
  const render = (e: { lauf: Lage; nacharbeit: Lage; tickets: { ticket: number; pr: number; ergebnis: Erg }[] }) => F.renderMarkdown(F.bericht({ von, bis, quelle: "Transkript", ...e }));
  test("keine PRs und kein Blocker-Feld: „–“ statt 0 %", () => {
    const md = render({ lauf: daten([], { mitBlockerFeld: 0, runde1MitBlocker: 0 }), nacharbeit: daten([]), tickets: [] });
    expect(md).toContain("- Ohne CI-Fix: –");
    expect(md).toContain("- Runde 1 mit Blocker: –");
    expect(md).not.toMatch(/0 % \(0\/0\)/);
  });
  test("Lauf vorhanden, aber keine Tickets: Lücke, kein Median 0,00 $", () => {
    const md = render({ lauf: daten([ZEILE({ ticket: null })]), nacharbeit: daten([]), tickets: [] });
    expect(md).toContain("- Lücke: keine Tickets im Zeitraum");
    expect(md).not.toContain("Median");
    expect(md).not.toContain("0,00 $");
  });
  test("ohne offene Fenster steht keine „Fenster noch offen“-Zeile", () => {
    expect(render({ lauf: daten([ZEILE()]), nacharbeit: daten([ZEILE()], { nacharbeitOffen: 0 }), tickets: [] })).not.toContain("Fenster noch offen");
  });
  test("Nacharbeit-Treffer ohne Ticket nennt nur den PR", () => {
    const md = render({ lauf: daten([ZEILE()]), nacharbeit: daten([ZEILE({ pr: 7, ticket: null, nacharbeit: "revert" })]), tickets: [] });
    expect(md).toContain("- Nacharbeit (revert): PR #7\n");
    expect(md).not.toContain("PR #7, Ticket");
  });
  test("Tickets stehen aufsteigend in der Tabelle, so wie sie übergeben werden", () => {
    const md = render({ lauf: daten([ZEILE()]), nacharbeit: daten([]), tickets: [{ ticket: 40, pr: 50, ergebnis: { kosten: 1 } }] });
    expect(md).toContain("| #40 | #50 | 1,00 $ |");
  });
});

describe("erstelle (Verdrahtung, Exit-Codes)", () => {
  const von = "2026-10-12T00:00:00Z";
  const bis = "2026-10-16T00:00:00Z";
  const lauf = (zeilen: Zeile[]) => JSON.stringify({ zeilen, kennzahlen: { ...KENN, prs: zeilen.length } });
  const claimKarte = () => new Map([[40, [{ session: "s1", ts: "2026-10-14T07:00:00Z" }]]]);
  type Fn = (e: { von: string; bis: string; langfuse?: boolean }, d: { run: Run; claimKarte: () => Map<number, { session: string; ts: string }[]> }) => { bericht: { lauf: Lage; nacharbeit: Lage; tickets: { ticket: number; ergebnis: Erg }[] }; exit: number };
  const erstelle = (raw as unknown as { erstelle: Fn }).erstelle;

  test("Nacharbeit-Lauf scheitert allein: Exit 2, Block mit Lücke erscheint, Kosten laufen weiter; das zweite Fenster ist von − 14 T", () => {
    const fenster: string[][] = [];
    const run: Run = (name, a) => {
      if (name === "token-baseline.mjs") return { status: 0, stdout: JSON.stringify({ total: { calls: 1, cost: 2 }, hasCost: true, unpriced: 0 }), stderr: "" };
      fenster.push([a[1], a[3]]);
      return fenster.length === 1 ? { status: 0, stdout: lauf([ZEILE()]), stderr: "" } : { status: 2, stdout: "", stderr: "gh weg" };
    };
    const r = erstelle({ von, bis }, { run, claimKarte });
    expect(r.exit).toBe(2);
    expect(r.bericht.nacharbeit.luecke).toMatch(/Exit 2/);
    expect(r.bericht.lauf.daten).toBeDefined();
    expect(r.bericht.tickets).toEqual([{ ticket: 40, pr: 50, ergebnis: { kosten: 2 } }]);
    expect(fenster).toEqual([
      [von, bis],
      ["2026-09-28T00:00:00.000Z", "2026-10-02T00:00:00.000Z"],
    ]);
  });
  test("alles da: Exit 0; Lauf-Ergebnis fehlt: Exit 2 ohne Claim-Karte und ohne Kosten-Prozess", () => {
    const ok: Run = (name) => (name === "token-baseline.mjs" ? { status: 0, stdout: JSON.stringify({ total: { calls: 1, cost: 2 }, hasCost: true, unpriced: 0 }), stderr: "" } : { status: 0, stdout: lauf([ZEILE()]), stderr: "" });
    expect(erstelle({ von, bis }, { run: ok, claimKarte }).exit).toBe(0);
    const nie = () => {
      throw new Error("darf nicht laufen");
    };
    const weg: Run = (name) => {
      if (name === "token-baseline.mjs") return nie();
      return { status: 1, stdout: "", stderr: "x" };
    };
    const r = erstelle({ von, bis }, { run: weg, claimKarte: nie });
    expect(r.exit).toBe(2);
    expect(r.bericht.tickets).toEqual([]);
  });
  test("Ticket ohne Claim in der Karte: Lücke, nicht 0", () => {
    const run: Run = () => ({ status: 0, stdout: lauf([ZEILE({ ticket: 99 })]), stderr: "" });
    expect(erstelle({ von, bis }, { run, claimKarte }).bericht.tickets[0].ergebnis).toEqual({ luecke: "keine Session mit Claim-Zeile" });
  });
  test("langfuse wird an die Kosten-Läufe weitergereicht und steht als Quelle im Bericht; ohne bleibt es Transkript", () => {
    const aufrufe: string[][] = [];
    const run: Run = (name, a) => {
      if (name === "token-baseline.mjs") {
        aufrufe.push(a);
        return { status: 0, stdout: JSON.stringify({ total: { calls: 1, cost: 2 }, hasCost: true, unpriced: 0 }), stderr: "" };
      }
      return { status: 0, stdout: lauf([ZEILE()]), stderr: "" };
    };
    const mit = erstelle({ von, bis, langfuse: true }, { run, claimKarte }) as unknown as { bericht: { quelle: string } };
    expect(mit.bericht.quelle).toBe("Langfuse");
    expect(aufrufe[0]).toContain("--langfuse");
    const ohne = erstelle({ von, bis }, { run, claimKarte }) as unknown as { bericht: { quelle: string } };
    expect(ohne.bericht.quelle).toBe("Transkript");
    expect(aufrufe[1]).not.toContain("--langfuse");
  });
  test("CLI: fehlendes --von ist Aufruffehler mit Exit 1", () => {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/factory-kennzahlen.mjs", import.meta.url)), "--bis", bis], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Aufruf: node scripts\/factory-kennzahlen\.mjs/);
  }, 20_000);
});

describe("Einstiegsskript", () => {
  test("ohne Import anderer Einstiegsskripte", () => {
    const src = readFileSync(new URL("../scripts/factory-kennzahlen.mjs", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "\.\/(lauf-ergebnis|token-baseline|hauptchat-zerlegung)\.mjs"/);
    expect(src).not.toContain("ABNAHME_ZEILE");
    expect(src).not.toContain("folgt mit F13");
  });
});
