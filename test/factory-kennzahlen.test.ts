/* Factory-Kennzahlen (#1616, ADR 0022 §6): pure Kernfunktionen, Lücken statt 0 (AK3), Verträge gegen die echten
 * Erzeuger `bewertePrs` (lauf-ergebnis.mjs) und `summarize` (token-baseline.mjs); die Unterprozesse sind injiziert. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/factory-kennzahlen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLauf from "../scripts/lauf-ergebnis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBase from "../scripts/token-baseline.mjs";

type Zeile = { pr: number; ticket: number | null; gemergt: string; runden: number | null; ciFix: number; festgefahren: number; nacharbeit: string };
type Daten = { zeilen: Zeile[]; kennzahlen: Record<string, number> };
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
const BASE = rawBase as unknown as { summarize: (run: { calls: unknown[]; questions: number; events?: unknown[] }, bounds?: unknown) => unknown };

const ZEILE = (o: Partial<Zeile> = {}): Zeile => ({ pr: 50, ticket: 40, gemergt: "2026-10-14T10:00:00Z", runden: 1, ciFix: 0, festgefahren: 0, nacharbeit: "nein", ...o });
const KENN = { prs: 1, ohneNacharbeit: 1, nachweisbareFenster: 1, nacharbeitOffen: 0, ciFixSumme: 0, festgefahrenSumme: 0, runde1MitBlocker: 0, mitBlockerFeld: 1 };
const daten = (zeilen: Zeile[], k: Record<string, number> = {}): Lage => ({ daten: { zeilen, kennzahlen: { ...KENN, prs: zeilen.length, ...k } } });
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
});

describe("ticketLaeufe", () => {
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
    const k: Record<string, number> = { ...KENN };
    delete k.ohneNacharbeit;
    expect(F.vertragPruefen({ zeilen: [], kennzahlen: k }).luecke).toMatch(/ohneNacharbeit/);
    expect(F.vertragPruefen({}).luecke).toMatch(/Vertrag/);
    expect(F.vertragPruefen(null).luecke).toMatch(/Vertrag/);
  });
  test("echtes bewertePrs aus lauf-ergebnis erfüllt den Vertrag", () => {
    const e = LAUF.bewertePrs({ prs: [], commits: [], ci: {}, festgefahren: {}, jetzt: new Date("2026-12-31T00:00:00Z") });
    expect(F.vertragPruefen(e).daten).toBeDefined();
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
    expect(md).toContain("**Abnahme-Quote:** – (folgt mit F13)");
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

describe("Einstiegsskript", () => {
  test("literalfrei und ohne Import anderer Einstiegsskripte", () => {
    const src = readFileSync(new URL("../scripts/factory-kennzahlen.mjs", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "\.\/(lauf-ergebnis|token-baseline|hauptchat-zerlegung)\.mjs"/);
  });
});
