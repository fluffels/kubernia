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
    for (const feld of ["gemessen", "ersterDurchgang", "entfaellt", "override", "ohne"]) {
      const nan = { ...(KENN.abnahme as AbnahmeKenn), [feld]: Number.NaN };
      expect(F.vertragPruefen({ zeilen: [], kennzahlen: { ...KENN, abnahme: nan } }).luecke).toContain("abnahme." + feld);
      const weg: Record<string, number> = { ...(KENN.abnahme as AbnahmeKenn) };
      delete weg[feld];
      expect(F.vertragPruefen({ zeilen: [], kennzahlen: { ...KENN, abnahme: weg } }).luecke).toContain("abnahme." + feld);
    }
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
    expect(a).toContain("- Nicht in der Quote: entfällt 1, Override 1 (PR #4), ohne gültige Abnahme-Zeile 1");
  });
  test("Prozent wird gerundet: 2 von 3 sind 67 %", () => {
    const lage = F.vertragPruefen(echt([body(urteil(1)), body(urteil(1)), body(urteil(2))]));
    expect(md(lage)).toContain("- 2 von 3 im ersten Durchgang (67 %)");
  });
  test("Prozent wird gerundet, nicht aufgerundet: 1 von 3 sind 33 %", () => {
    const lage = F.vertragPruefen(echt([body(urteil(1)), body(urteil(2)), body(urteil(2))]));
    expect(md(lage)).toContain("- 1 von 3 im ersten Durchgang (33 %)");
  });
  test("Negativfall: bei verletztem Vertrag nennt die Abnahme-Quote den Vertragsbruch statt ihn zu verschweigen", () => {
    const lage = F.vertragPruefen({});
    expect(lage.luecke).toBeDefined();
    const a = md(lage);
    expect(a).toContain("- Lücke: kein Lauf-Ergebnis");
    expect(a).toContain("Vertrag verletzt");
  });
  test("Negativfall: ohne Abnahme-Urteil steht eine Lücke mit Grund, nie 0 %", () => {
    const lage = F.vertragPruefen(echt([body("nichts"), body("KQ-Abnahme: entfaellt — Hand-PR")]));
    const a = md(lage);
    expect(a).toContain("- Lücke: keine PR mit Abnahme-Urteil im Zeitraum");
    expect(a).not.toMatch(/0 %/);
    expect(a).not.toContain("im ersten Durchgang");
    expect(a).toContain("- Nicht in der Quote: entfällt 1, Override 0, ohne gültige Abnahme-Zeile 1");
    expect(a).not.toContain("(PR");
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

describe("Selbst-Audit (#1787): je Mechanismus eine Messung, Abweichung und Lücke statt 0", () => {
  type A = { mechanismus: string; messung: string; soll: string; status: "ok" | "ABWEICHUNG" | "Lücke" };
  type Eingabe = { commits?: unknown[] | null; commitsLuecke?: string | null; sammelAbschluss?: string | null; sammelIssues?: Set<number>; sammelInArbeit?: number | null; harnessIssues?: Set<number> | null; harnessLuecke?: string | null; zeilen?: Partial<Zeile>[] | null };
  const S = raw as unknown as {
    selbstAudit: (e: Eingabe) => A[];
    auditAbschnitt: (a: A[]) => string[];
    ladeAuditDaten: (e: { bis: string }, d: { gh: (a: string[]) => unknown; repo?: string; config?: unknown }) => { commits: unknown[] | null; commitsLuecke?: string; harnessIssues?: Set<number> | null; harnessLuecke?: string | null; sammelAbschluss?: string | null; sammelIssues?: Set<number>; sammelInArbeit?: number | null };
    configOderFehler: (lade?: () => unknown) => { config: unknown; configFehler?: string };
    erstelle: (e: { von: string; bis: string }, d: { run: Run; claimKarte: () => Map<number, unknown[]>; auditLader?: (e: { bis: string }) => Eingabe }) => { bericht: { audit?: A[] }; exit: number };
    renderMarkdown: (b: unknown) => string;
  };
  const commit = (message: string, login = "fluffels") => ({ author: { login }, commit: { message, committer: { date: "2026-10-12T10:00:00Z" } } });
  const spiel = (n: number) => commit(`feat(sim): s${n} (#${100 + n}) (#${200 + n})`);
  const harness = (n: number) => commit(`feat(harness): h${n} (#${300 + n}) (#${400 + n})`);
  const CFG = { labels: { harness: "area:harness" } };
  const von = (e: Eingabe, name: string) => S.selbstAudit({ commits: [], sammelAbschluss: "2026-10-01T00:00:00Z", zeilen: [], ...e }).find((a) => a.mechanismus === name)!;

  test("Spielquote: 1:3 ok, 2:2 ABWEICHUNG, unter 4 Merges Lücke (keine Aussage), Bots zählen nicht", () => {
    expect(von({ commits: [harness(1), spiel(1), spiel(2), spiel(3)] }, "Spielquote").status).toBe("ok");
    expect(von({ commits: [harness(1), harness(2), spiel(1), spiel(2)] }, "Spielquote").status).toBe("ABWEICHUNG");
    const wenig = von({ commits: [harness(1), spiel(1), spiel(2)] }, "Spielquote");
    expect(wenig.status).toBe("Lücke");
    expect(wenig.messung).toMatch(/keine Aussage/);
    // vier Commits, davon zwei von Bots: nur zwei zählen, also keine Aussage statt ok
    expect(von({ commits: [spiel(1), spiel(2), commit("feat(sim): x (#1)", "dependabot[bot]"), commit("feat(sim): y (#2)", "dependabot[bot]")] }, "Spielquote").status).toBe("Lücke");
  });

  test("Spielquote: Zuordnung nach Label der referenzierten Issues, nicht nach Commit-Scope (#1798)", () => {
    const harnessIssues = new Set([900]);
    const alsProdukt = commit("feat(harness): zu Spiel-Issue (#901)");
    const alsFactory = commit("docs(adr): zu Harness-Issue (#900)");
    const r = von({ commits: [alsProdukt, alsFactory, spiel(1), spiel(2)], harnessIssues }, "Spielquote");
    expect(r.messung).toContain("1 Factory- auf 3 Produkt-Merges");
    expect(r.messung).toContain("Zuordnung nach Label der referenzierten Issues");
    expect(r.status).toBe("ok");
    // ohne Label-Menge Rückfall auf den Scope: dann zählt das feat(harness) als Factory, und der Messtext sagt es
    const rueckfall = von({ commits: [alsProdukt, alsFactory, spiel(1), spiel(2)] }, "Spielquote").messung;
    expect(rueckfall).toContain("1 Factory- auf 3 Produkt-Merges");
    expect(rueckfall).toContain("Rückfall: Zuordnung nach Commit-Scope");
  });

  test("Spielquote: Label und Scope laufen auseinander, das Label entscheidet (#1798)", () => {
    // zwei feat(harness) auf Spiel-Issues (#901, #902), ein docs auf ein Harness-Issue (#900): nach Label 1 Factory, nach Scope 2
    const cs = [commit("feat(harness): a (#901)"), commit("feat(harness): b (#902)"), commit("docs(adr): c (#900)"), spiel(1), spiel(2)];
    expect(von({ commits: cs, harnessIssues: new Set([900]) }, "Spielquote").messung).toContain("1 Factory- auf 4 Produkt-Merges");
    expect(von({ commits: cs }, "Spielquote").messung).toContain("2 Factory- auf 3 Produkt-Merges");
  });

  test("Spielquote: Lücke mit Grund bei harnessLuecke, der Takt bleibt gemessen (#1798)", () => {
    const e = { commits: [spiel(1)], harnessLuecke: "Harness-Issues nicht ladbar: x" };
    expect(von(e, "Spielquote")).toMatchObject({ status: "Lücke", messung: "Harness-Issues nicht ladbar: x" });
    expect(von(e, "Härtungs-Takt").status).toBe("ok");
  });

  test("Härtungs-Takt: 9 ok, 10 ABWEICHUNG; Sammelticket-Merges zählen nicht; Vorgänger in Arbeit pausiert; ohne Abschluss Lücke", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => spiel(i));
    expect(von({ commits: n(9) }, "Härtungs-Takt").status).toBe("ok");
    const zehn = von({ commits: n(10) }, "Härtungs-Takt");
    expect(zehn.status).toBe("ABWEICHUNG");
    expect(zehn.messung).toMatch(/10 Ticket-Merges/);
    const sammel = commit("feat(harness): Härtung (#40) (#41)");
    expect(von({ commits: [...n(9), sammel], sammelIssues: new Set([40]) }, "Härtungs-Takt").status).toBe("ok");
    expect(von({ commits: [...n(9), sammel] }, "Härtungs-Takt").status).toBe("ABWEICHUNG");
    const pause = von({ commits: n(20), sammelInArbeit: 77 }, "Härtungs-Takt");
    expect(pause.status).toBe("ok");
    expect(pause.messung).toContain("#77 in Arbeit");
    expect(von({ commits: n(20), sammelAbschluss: null }, "Härtungs-Takt").status).toBe("Lücke");
  });

  test("Ladefehler der Commits: Quote und Takt sind Lücken mit dem Grund, nie ok", () => {
    const e = { commits: null, commitsLuecke: "Commits von main nicht ladbar: gh weg" };
    for (const m of ["Spielquote", "Härtungs-Takt"]) expect(von(e, m)).toMatchObject({ status: "Lücke", messung: "Commits von main nicht ladbar: gh weg" });
    expect(von({ commits: null }, "Spielquote").messung).toMatch(/nicht geladen/);
  });

  test("Festgefahren-Protokoll: ≥ 4 CI-Fix ohne Label ABWEICHUNG, mit Label oder darunter ok, fehlende Felder Lücke", () => {
    const ohneLabel = von({ zeilen: [ZEILE({ pr: 61, ciFix: 4, festgefahren: 0 })] }, "Festgefahren-Protokoll");
    expect(ohneLabel.status).toBe("ABWEICHUNG");
    expect(ohneLabel.messung).toContain("#61");
    expect(von({ zeilen: [ZEILE({ ciFix: 3, festgefahren: 0 }), ZEILE({ ciFix: 5, festgefahren: 1 })] }, "Festgefahren-Protokoll").status).toBe("ok");
    expect(von({ zeilen: [{ pr: 7, ciFix: 9 }] }, "Festgefahren-Protokoll").status).toBe("Lücke");
    expect(von({ zeilen: null }, "Festgefahren-Protokoll").status).toBe("Lücke");
  });

  test("Lens-Zahl: 8 Runden ABWEICHUNG, 7 (3 Pässe, 3 Zusatzpässe, 1 Abnahme-Fix) ok, ohne Nachweis (runden null) Lücke und nie 0", () => {
    const zuviel = von({ zeilen: [ZEILE({ pr: 62, runden: 8 })] }, "Lens-Zahl");
    expect(zuviel.status).toBe("ABWEICHUNG");
    expect(zuviel.messung).toContain("#62 (8)");
    expect(von({ zeilen: [ZEILE({ runden: 7 }), ZEILE({ runden: null })] }, "Lens-Zahl").status).toBe("ok");
    const ohne = von({ zeilen: [ZEILE({ runden: null })] }, "Lens-Zahl");
    expect(ohne.status).toBe("Lücke");
    expect(ohne.messung).toMatch(/ohne Review-Nachweiszeile/);
    expect(von({ zeilen: null }, "Lens-Zahl")).toMatchObject({ status: "Lücke", messung: "kein Lauf-Ergebnis" });
  });

  test("auditAbschnitt: je Mechanismus eine Zeile Messung · Soll · Status; renderMarkdown hängt den Abschnitt nur mit Audit an", () => {
    const audit = S.selbstAudit({ commits: [], zeilen: [] });
    expect(audit.map((a) => a.mechanismus)).toEqual(["Spielquote", "Härtungs-Takt", "Festgefahren-Protokoll", "Lens-Zahl"]);
    const zeilen = S.auditAbschnitt(audit);
    expect(zeilen).toHaveLength(4);
    for (const z of zeilen) expect(z).toMatch(/^- .+: .+ · Soll: .+ · (ok|ABWEICHUNG|Lücke)$/);
    const lage: Lage = { luecke: "x" };
    const b = (extra: object) => F.bericht({ von: "2026-10-12T00:00:00Z", bis: "2026-10-16T00:00:00Z", quelle: "Transkript", lauf: lage, nacharbeit: lage, tickets: [], ...extra });
    expect(S.renderMarkdown(b({ audit }))).toContain("**Selbst-Audit**\n- Spielquote:");
    expect(S.renderMarkdown(b({}))).not.toContain("Selbst-Audit");
  });

  test("ladeAuditDaten: Sammeltickets und Commits über drei gh-Aufrufe; jüngster Abschluss, geclaimter Vorgänger, Commits bis `bis`", () => {
    const aufrufe: string[][] = [];
    const gh = (a: string[]) => {
      aufrufe.push(a);
      if (a[0] === "issue") {
        return [
          { number: 10, title: "Harness-Härtung (gesammelt)", state: "CLOSED", closedAt: "2026-10-01T00:00:00Z", assignees: [] },
          { number: 11, title: "Harness-Härtung (gesammelt)", state: "CLOSED", closedAt: "2026-10-05T00:00:00Z", assignees: [] },
          { number: 12, title: "Langfuse-Befunde (gesammelt)", state: "CLOSED", closedAt: "2026-10-09T00:00:00Z", assignees: [] },
          { number: 13, title: "Harness-Härtung (gesammelt)", state: "OPEN", closedAt: null, assignees: [{ login: "fluffels" }] },
          { number: 15, title: "Harness-Härtung (gesammelt)", state: "OPEN", closedAt: "2026-10-08T00:00:00Z", assignees: [] }, // wieder geöffnet: zählt nicht als Abschluss
          { number: 14, title: "Etwas anderes (gesammelt)", state: "OPEN", closedAt: null, assignees: [] },
        ];
      }
      if (a[3]?.includes("/issues?")) return [[{ number: 500 }, { number: 501, pull_request: {} }]];
      return [[spiel(1), { ...spiel(2), commit: { message: "feat: spät (#9)", committer: { date: "2026-10-20T00:00:00Z" } } }]];
    };
    const d = S.ladeAuditDaten({ bis: "2026-10-16T00:00:00Z" }, { gh, repo: "o/r", config: CFG });
    expect(d.sammelAbschluss).toBe("2026-10-05T00:00:00Z");
    expect([...d.sammelIssues!].sort()).toEqual([10, 11, 12, 13, 15]);
    expect(d.sammelInArbeit).toBe(13);
    expect(d.commits).toHaveLength(1);
    expect(aufrufe[0]).toContain("--limit");
    expect(aufrufe[2].join(" ")).toContain("labels=area%3Aharness&since=2026-10-04T00:01:00.000Z");
    expect([...d.harnessIssues!]).toEqual([500]);
    expect(aufrufe[1].join(" ")).toMatch(/--paginate --slurp repos\/o\/r\/commits\?sha=main&since=2026-10-05T00:01:00\.000Z/);
  });

  test("ladeAuditDaten: dritter Aufruf wirft oder labels.harness fehlt: nur die Quote ist Lücke, Commits und Takt-Daten bleiben (#1798)", () => {
    const gh = (a: string[]) => {
      if (a[0] === "issue") return [{ number: 11, title: "Harness-Härtung (gesammelt)", state: "CLOSED", closedAt: "2026-10-05T00:00:00Z", assignees: [] }];
      if (a[3]?.includes("/issues?")) throw new Error("issues weg");
      return [[spiel(1)]];
    };
    const d = S.ladeAuditDaten({ bis: "2026-10-16T00:00:00Z" }, { gh, repo: "o/r", config: CFG });
    expect(d.harnessIssues ?? null).toBeNull();
    expect(d.harnessLuecke).toMatch(/Harness-Issues nicht ladbar: .*issues weg/);
    expect(d.commits).toHaveLength(1);
    expect(d.sammelAbschluss).toBe("2026-10-05T00:00:00Z");
    expect(von({ ...d, zeilen: [] }, "Spielquote").status).toBe("Lücke");
    expect(von({ ...d, zeilen: [] }, "Härtungs-Takt").status).toBe("ok");
    const ohneLabel = S.ladeAuditDaten({ bis: "2026-10-16T00:00:00Z" }, { gh: (a) => (a[0] === "issue" ? [] : [[spiel(1)]]), config: { labels: {} } });
    expect(ohneLabel.harnessLuecke).toMatch(/labels.harness/);
    expect(ohneLabel.commits).toHaveLength(1);
  });

  test("ladeAuditDaten: scheiterte das Laden der Config, nennt die Lücke deren Fehlertext statt labels.harness; Commits bleiben, keine Issue-Abfrage (L17)", () => {
    const aufrufe: string[] = [];
    const gh = (a: string[]) => {
      aufrufe.push(a[3] ?? a[0] ?? "");
      return a[0] === "issue" ? [] : [[spiel(1)]];
    };
    const geladen = S.configOderFehler(() => { throw new Error("agenten.planer fehlt"); });
    expect(geladen).toEqual({ config: null, configFehler: "agenten.planer fehlt" });
    expect(S.configOderFehler(() => ({ x: 1 }))).toEqual({ config: { x: 1 } });
    const d = S.ladeAuditDaten({ bis: "2026-10-16T00:00:00Z" }, { gh, repo: "o/r", ...geladen });
    expect(d.harnessIssues ?? null).toBeNull();
    expect(d.harnessLuecke).toBe("Projekt-Config nicht ladbar: agenten.planer fehlt");
    expect(d.commits).toHaveLength(1);
    expect(aufrufe.some((a) => a.includes("/issues?"))).toBe(false);
    // Negativfall: ohne Fehlertext und ohne Config bleibt es beim bisherigen Hinweis auf das Label.
    const ohne = S.ladeAuditDaten({ bis: "2026-10-16T00:00:00Z" }, { gh, repo: "o/r", config: null });
    expect(ohne.harnessLuecke).toMatch(/labels\.harness/);
  });

  test("ladeAuditDaten: ohne abgeschlossenes Sammelticket ist das Fenster 28 Tage vor `bis`, nichts in Arbeit", () => {
    const aufrufe: string[][] = [];
    const gh = (a: string[]) => {
      aufrufe.push(a);
      if (a[0] === "issue") return [{ number: 20, title: "Harness-Härtung (gesammelt)", state: "OPEN", closedAt: null, assignees: [] }];
      return [[spiel(1)]];
    };
    const d = S.ladeAuditDaten({ bis: "2026-10-29T00:00:00Z" }, { gh, repo: "o/r", config: CFG });
    expect(d.sammelAbschluss).toBeNull();
    expect(d.sammelInArbeit).toBeNull();
    expect(aufrufe).toHaveLength(3);
    expect(aufrufe[1].join(" ")).toContain("since=2026-10-01T00:00:00.000Z");
    expect(d.commits).toHaveLength(1);
  });

  test("ladeAuditDaten: kaputtes closedAt eines geschlossenen Tickets und fehlendes assignees-Feld stören nicht; Commits ohne gültiges Datum bleiben drin", () => {
    const gh = (a: string[]) => {
      if (a[0] === "issue") {
        return [
          { number: 30, title: "Harness-Härtung (gesammelt)", state: "CLOSED", closedAt: "kein-datum", assignees: [] },
          { number: 31, title: "Harness-Härtung (gesammelt)", state: "CLOSED", closedAt: "2026-10-05T00:00:00Z", assignees: [] },
          { number: 32, title: "Harness-Härtung (gesammelt)", state: "OPEN", closedAt: null },
        ];
      }
      return [[{ author: { login: "fluffels" }, commit: { message: "feat(sim): ohne Datum (#1)" } }, spiel(1)]];
    };
    const d = S.ladeAuditDaten({ bis: "2026-10-16T00:00:00Z" }, { gh, repo: "o/r", config: CFG });
    expect(d.sammelAbschluss).toBe("2026-10-05T00:00:00Z");
    expect(d.sammelInArbeit).toBeNull();
    expect(d.commits).toHaveLength(2);
    const nurKaputt = S.ladeAuditDaten({ bis: "2026-10-16T00:00:00Z" }, { gh: (a) => (a[0] === "issue" ? [{ number: 30, title: "Harness-Härtung (gesammelt)", state: "CLOSED", closedAt: "kein-datum" }] : [[]]) });
    expect(nurKaputt.sammelAbschluss).toBeNull();
  });

  test("Festgefahren-Protokoll: eine Abweichung hat Vorrang vor einer unvollständigen Zeile", () => {
    const r = von({ zeilen: [{ pr: 7, ciFix: 9 }, ZEILE({ pr: 61, ciFix: 4, festgefahren: 0 })] }, "Festgefahren-Protokoll");
    expect(r.status).toBe("ABWEICHUNG");
    expect(r.messung).toContain("#61");
  });

  test("Härtungs-Takt: nur die Titelzeile entscheidet, ein Sammelticket im Body schließt einen Merge nicht aus", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => spiel(i));
    const imBody = commit("feat(sim): normal (#50)\n\nFolge #40, siehe #40");
    expect(von({ commits: [...n(9), imBody], sammelIssues: new Set([40]) }, "Härtungs-Takt").status).toBe("ABWEICHUNG");
  });

  test("ladeAuditDaten: gh-Fehler wird zur Lücke mit Grund, nie zu leeren Commits", () => {
    const weg = () => {
      throw new Error("gh weg");
    };
    const ohneIssues = S.ladeAuditDaten({ bis: "2026-10-16T00:00:00Z" }, { gh: weg });
    expect(ohneIssues.commits).toBeNull();
    expect(ohneIssues.commitsLuecke).toContain("Sammeltickets nicht ladbar");
    const nurCommitsKaputt = (a: string[]) => {
      if (a[0] === "issue") return [];
      throw new Error("api weg");
    };
    const d = S.ladeAuditDaten({ bis: "2026-10-16T00:00:00Z" }, { gh: nurCommitsKaputt });
    expect(d.commits).toBeNull();
    expect(d.commitsLuecke).toMatch(/Commits von main nicht ladbar/);
  });

  test("erstelle mit auditLader trägt das Audit in den Bericht; ohne Lader bleibt es weg; ohne Lauf-Ergebnis sind Lens und Festgefahren Lücken", () => {
    const run: Run = (name) => (name === "token-baseline.mjs" ? { status: 0, stdout: JSON.stringify({ total: { calls: 1, cost: 2 }, hasCost: true, unpriced: 0 }), stderr: "" } : { status: 0, stdout: JSON.stringify({ zeilen: [ZEILE({ pr: 70, runden: 8 })], kennzahlen: { ...KENN, prs: 1 } }), stderr: "" });
    const claimKarte = () => new Map([[40, [{ session: "s1", ts: "2026-10-14T07:00:00Z" }]]]);
    const mit = S.erstelle({ von: "2026-10-12T00:00:00Z", bis: "2026-10-16T00:00:00Z" }, { run, claimKarte, auditLader: () => ({ commits: [] }) });
    expect(mit.bericht.audit!.find((a) => a.mechanismus === "Lens-Zahl")).toMatchObject({ status: "ABWEICHUNG" });
    expect(S.erstelle({ von: "2026-10-12T00:00:00Z", bis: "2026-10-16T00:00:00Z" }, { run, claimKarte }).bericht.audit).toBeUndefined();
    const kaputt: Run = () => ({ status: 2, stdout: "", stderr: "gh weg" });
    const ohne = S.erstelle({ von: "2026-10-12T00:00:00Z", bis: "2026-10-16T00:00:00Z" }, { run: kaputt, claimKarte: () => new Map(), auditLader: () => ({ commits: [] }) });
    expect(ohne.bericht.audit!.filter((a) => a.status === "Lücke").map((a) => a.mechanismus)).toEqual(expect.arrayContaining(["Festgefahren-Protokoll", "Lens-Zahl"]));
  });
});

describe("Spezifikations-Mängel im Wochenbericht (#1860)", () => {
  const von = "2026-10-12T00:00:00Z";
  const bis = "2026-10-16T00:00:00Z";
  type Maengel = { anzahl?: number; maengel?: { nr: number; titel: string; fehlt: string[] }[]; luecke?: string };
  const M = raw as unknown as { holeMaengel: (run: Run) => Maengel };
  const GUT = JSON.stringify({ anzahl: 2, maengel: [{ nr: 7, titel: "Sieben", fehlt: ["kein Negativfall"] }, { nr: 9, titel: "Neun", fehlt: ["`## Ziel` fehlt"] }] });
  const ok = (stdout: string): Run => () => ({ status: 0, stdout, stderr: "" });

  test("holeMaengel ruft naechstes-ticket.mjs --maengel --json auf und liefert anzahl und Liste", () => {
    let gesehen: [string, string[]] | null = null;
    const r = M.holeMaengel((name, args) => {
      gesehen = [name, args];
      return { status: 0, stdout: GUT, stderr: "" };
    });
    expect(gesehen).toEqual(["naechstes-ticket.mjs", ["--maengel", "--json"]]);
    expect(r.anzahl).toBe(2);
    expect(r.maengel?.map((m) => m.nr)).toEqual([7, 9]);
  });
  test("Negativfall: Exit ≠ 0, kein JSON oder Vertragsbruch ergeben eine Lücke mit Grund, nie 0", () => {
    expect(M.holeMaengel(() => ({ status: 2, stdout: "", stderr: "\n✖ naechstes-ticket: gh weg\nmehr" })).luecke).toBe("naechstes-ticket Exit 2: ✖ naechstes-ticket: gh weg");
    expect(M.holeMaengel(ok("kein json")).luecke).toMatch(/kein JSON/);
    for (const bad of ["{}", JSON.stringify({ anzahl: "2", maengel: [] }), JSON.stringify({ anzahl: 1, maengel: "x" }), "null", JSON.stringify({ anzahl: 2, maengel: [] })]) {
      const r = M.holeMaengel(ok(bad));
      expect(r.luecke, bad).toMatch(/Vertrag verletzt/);
      expect(r.anzahl, bad).toBeUndefined();
    }
  });
  const md = (spezifikation?: Maengel) => F.renderMarkdown(F.bericht({ von, bis, quelle: "Transkript", lauf: daten([ZEILE()]), nacharbeit: daten([]), tickets: [], ...(spezifikation ? { spezifikation } : {}) }));
  test("Abschnitt „Spezifikation“ nennt die Zahl und je Ticket Nummer, Titel und Mängel", () => {
    const text = md(JSON.parse(GUT) as Maengel);
    expect(text).toContain("**Spezifikation**\n- 2 Tickets mit Mangel");
    expect(text).toContain("- #7 Sieben: kein Negativfall");
    expect(text).toContain("- #9 Neun: `## Ziel` fehlt");
  });
  test("null Tickets mit Mangel ist eine echte Null; eine Lücke zeigt den Grund und nie `0 Tickets`", () => {
    expect(md({ anzahl: 0, maengel: [] })).toContain("- 0 Tickets mit Mangel");
    const luecke = md({ luecke: "naechstes-ticket Exit 2: gh weg" });
    expect(luecke).toContain("**Spezifikation**\n- Lücke: naechstes-ticket Exit 2: gh weg");
    expect(luecke).not.toContain("0 Tickets");
  });
  test("ein einzelnes Ticket steht im Singular; lange Listen werden bei 10 gekürzt", () => {
    expect(md({ anzahl: 1, maengel: [{ nr: 3, titel: "Drei", fehlt: ["x"] }] })).toContain("- 1 Ticket mit Mangel");
    const viele = Array.from({ length: 12 }, (_, i) => ({ nr: i + 1, titel: `T${i + 1}`, fehlt: ["x"] }));
    const text = md({ anzahl: 12, maengel: viele });
    expect(text).toContain("- #10 T10: x");
    expect(text).not.toContain("- #11 T11: x");
    expect(text).toContain("… und 2 weitere");
  });
  test("genau 10 Einträge stehen vollständig ohne „weitere“-Zeile, bei 11 fehlt der elfte", () => {
    const liste = (n: number) => Array.from({ length: n }, (_, i) => ({ nr: i + 1, titel: `T${i + 1}`, fehlt: ["x"] }));
    const zehn = md({ anzahl: 10, maengel: liste(10) });
    expect(zehn).toContain("- #10 T10: x");
    expect(zehn).not.toContain("weitere");
    const elf = md({ anzahl: 11, maengel: liste(11) });
    expect(elf).not.toContain("- #11 T11: x");
    expect(elf).toContain("… und 1 weitere");
  });
  test("ohne Abschnitt im Bericht (kein Lader) bleibt der Block wie bisher", () => {
    expect(md()).not.toContain("**Spezifikation**");
  });
  test("erstelle ruft den Mängel-Lader, Lücke dort ändert den Exit-Code nicht", () => {
    type Fn = (e: { von: string; bis: string }, d: { run: Run; claimKarte: () => Map<number, never[]>; maengelLader?: () => Maengel }) => { bericht: { spezifikation?: Maengel }; exit: number };
    const erstelle = (raw as unknown as { erstelle: Fn }).erstelle;
    const run: Run = () => ({ status: 0, stdout: JSON.stringify({ zeilen: [], kennzahlen: { ...KENN, prs: 0 } }), stderr: "" });
    const mit = erstelle({ von, bis }, { run, claimKarte: () => new Map(), maengelLader: () => ({ luecke: "weg" }) });
    expect(mit.bericht.spezifikation).toEqual({ luecke: "weg" });
    expect(mit.exit).toBe(0);
    expect(erstelle({ von, bis }, { run, claimKarte: () => new Map() }).bericht.spezifikation).toBeUndefined();
  });
});
