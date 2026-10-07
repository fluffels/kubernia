/* Langfuse-Takt (#1351, ADR 0016): die Entscheidung des Wochenlaufs ist pur und idempotent.
 *
 * Reines Node-Tooling-Skript ohne Declaration-File: Import über `unknown` auf ein lokales Interface
 * (gleiche Technik wie test/board.test.ts). */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/langfuse-takt.mjs";

type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Entscheidung = { aktion: "anlegen" | "nach-oben" | "nichts"; nr?: number; grund: string; warnungen: string[] };
type Takt = {
  STATUS_TITEL: string;
  MIN_MERGES: number;
  normalizeOffene: (pages: unknown) => Offen[];
  mergeFensterAb: (letzter: string | null, jetzt: string | Date) => Date;
  entscheideTakt: (a: { offene: Offen[]; mergesSeit: number }) => Entscheidung;
  wochenFenster: (jetzt: string | Date) => { letzte: { von: string; bis: string }; davor: { von: string; bis: string } };
  statusBody: (a: { vorgaenger: { number: number; closedAt: string } | null; jetzt: string | Date }) => string;
};
const T = raw as unknown as Takt;

const offen = (number: number, over: Partial<Offen> = {}): Offen => ({
  number,
  titel: T.STATUS_TITEL,
  assignees: [],
  createdAt: `2026-10-0${number % 9 || 1}T05:00:00Z`,
  ...over,
});

describe("entscheideTakt", () => {
  test("legt an: kein offenes Status-Ticket und genug Merges", () => {
    const e = T.entscheideTakt({ offene: [], mergesSeit: T.MIN_MERGES });
    expect(e.aktion).toBe("anlegen");
  });

  test("nichts: zu wenig Merges (Grenze MIN_MERGES - 1) und gar keine", () => {
    expect(T.entscheideTakt({ offene: [], mergesSeit: T.MIN_MERGES - 1 }).aktion).toBe("nichts");
    expect(T.entscheideTakt({ offene: [], mergesSeit: 0 }).aktion).toBe("nichts");
  });

  test("nach-oben: ein ungeclaimtes offenes Ticket, auch ohne Merges", () => {
    const e = T.entscheideTakt({ offene: [offen(1304)], mergesSeit: 0 });
    expect(e).toMatchObject({ aktion: "nach-oben", nr: 1304 });
    expect(e.warnungen).toEqual([]);
  });

  test("nichts: ein geclaimtes offenes Ticket läuft schon", () => {
    expect(T.entscheideTakt({ offene: [offen(1304, { assignees: ["fluffels"] })], mergesSeit: 99 }).aktion).toBe("nichts");
  });

  test("zwei offene, keins geclaimt: das älteste nach oben, Warnung 'Mehrere'", () => {
    const e = T.entscheideTakt({
      offene: [offen(1400, { createdAt: "2026-10-05T05:00:00Z" }), offen(1304, { createdAt: "2026-10-01T05:00:00Z" })],
      mergesSeit: 0,
    });
    expect(e).toMatchObject({ aktion: "nach-oben", nr: 1304 });
    expect(e.warnungen.join(" ")).toMatch(/Mehrere/);
  });

  test("zwei offene, das jüngere geclaimt: nichts, Warnung", () => {
    const e = T.entscheideTakt({
      offene: [offen(1304, { createdAt: "2026-10-01T05:00:00Z" }), offen(1400, { createdAt: "2026-10-05T05:00:00Z", assignees: ["fluffels"] })],
      mergesSeit: 0,
    });
    expect(e.aktion).toBe("nichts");
    expect(e.warnungen).toHaveLength(1);
  });

  test("Titel muss exakt passen: Zusatz, Kleinschreibung und Sammelticket treffen nicht", () => {
    const fremd = [
      offen(1, { titel: `${T.STATUS_TITEL} (alt)` }),
      offen(2, { titel: T.STATUS_TITEL.toLowerCase() }),
      offen(3, { titel: "Langfuse-Befunde (gesammelt)" }),
    ];
    expect(T.entscheideTakt({ offene: fremd, mergesSeit: T.MIN_MERGES }).aktion).toBe("anlegen");
  });

  test("zwei Auslösungen nacheinander: nie ein zweites Anlegen, dieselbe Nummer bleibt Ziel", () => {
    const s0: Offen[] = [];
    const e0 = T.entscheideTakt({ offene: s0, mergesSeit: T.MIN_MERGES });
    expect(e0.aktion).toBe("anlegen");
    const s1 = [...s0, offen(1500)]; // der erste Lauf hat das Ticket angelegt
    const e1 = T.entscheideTakt({ offene: s1, mergesSeit: T.MIN_MERGES });
    expect(e1).toMatchObject({ aktion: "nach-oben", nr: 1500 });
    const e2 = T.entscheideTakt({ offene: s1, mergesSeit: T.MIN_MERGES });
    expect(e2).toEqual(e1);
  });

  test("ungültige Eingaben werfen", () => {
    for (const bad of [-1, 1.5, Number.NaN, "5" as unknown as number]) {
      expect(() => T.entscheideTakt({ offene: [], mergesSeit: bad })).toThrow();
    }
    expect(() => T.entscheideTakt({ offene: null as unknown as Offen[], mergesSeit: 5 })).toThrow();
    expect(() => T.entscheideTakt({ offene: [offen(1, { createdAt: "kaputt" }), offen(2)], mergesSeit: 5 })).toThrow();
  });
});

describe("mergeFensterAb", () => {
  test("60 Sekunden nach dem Abschluss des Vorgängers", () => {
    expect(T.mergeFensterAb("2026-10-01T10:00:00Z", "2026-10-07T00:00:00Z").toISOString()).toBe("2026-10-01T10:01:00.000Z");
  });
  test("ohne Vorgänger 7 Tage vor jetzt", () => {
    expect(T.mergeFensterAb(null, "2026-10-07T00:00:00Z").toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
  test("kaputtes Datum wirft", () => {
    expect(() => T.mergeFensterAb("morgen", "2026-10-07T00:00:00Z")).toThrow();
    expect(() => T.mergeFensterAb(null, "x")).toThrow();
  });
});

describe("wochenFenster", () => {
  test("letzte volle Woche Mo–So UTC und die davor (Mittwoch als Anker)", () => {
    expect(T.wochenFenster("2026-10-07T12:00:00Z")).toEqual({
      letzte: { von: "2026-09-28", bis: "2026-10-04" },
      davor: { von: "2026-09-21", bis: "2026-09-27" },
    });
  });
  test("Montag früh und Sonntag spät gehören zur selben laufenden Woche", () => {
    expect(T.wochenFenster("2026-10-05T00:00:01Z").letzte.von).toBe("2026-09-28");
    expect(T.wochenFenster("2026-10-11T23:59:59Z").letzte.von).toBe("2026-09-28");
  });
});

describe("statusBody", () => {
  const body = T.statusBody({ vorgaenger: { number: 1276, closedAt: "2026-10-06T10:00:00Z" }, jetzt: "2026-10-07T00:00:00Z" });
  test("enthält Zeitraum, Wochenbudget, beide Links und das Sammelticket", () => {
    expect(body).toContain("#1276");
    expect(body).toContain("2026-09-28");
    expect(body).toContain("#langfuse-status-überprüfen-1293");
    expect(body).toContain("Langfuse-Befunde (gesammelt)");
  });
  test("keine Positions-Regel und kein Folgeticket mehr", () => {
    expect(body).not.toMatch(/Position\s*:?\s*\d+/);
    expect(body).not.toContain("Langfuse-Folgen");
    expect(body).not.toMatch(/Nachfolger/);
  });
  test("ohne Vorgänger: Bezug auf #1293", () => {
    expect(T.statusBody({ vorgaenger: null, jetzt: "2026-10-07T00:00:00Z" })).toContain("#1293");
  });
});

describe("normalizeOffene", () => {
  const issue = (number: number, extra: Record<string, unknown> = {}) => ({
    number,
    title: "x",
    created_at: "2026-10-01T00:00:00Z",
    assignees: [{ login: "fluffels" }],
    ...extra,
  });
  test("filtert Pull Requests und liest Assignees", () => {
    const r = T.normalizeOffene([[issue(1), issue(2, { pull_request: {} })], [issue(3, { assignees: [] })]]);
    expect(r.map((i) => i.number)).toEqual([1, 3]);
    expect(r[0].assignees).toEqual(["fluffels"]);
    expect(r[1].assignees).toEqual([]);
  });
  test("falsche Form wirft", () => {
    expect(() => T.normalizeOffene({})).toThrow();
    expect(() => T.normalizeOffene([issue(1)])).toThrow();
    expect(() => T.normalizeOffene([[{ number: 1 }]])).toThrow();
  });
});

describe("Bindungen und Sortierung (#1342)", () => {
  const lies = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

  test("MIN_MERGES stimmt mit der Zahl in ADR 0016 und im Workflow-Kommentar überein", () => {
    const adr = /Untergrenze von (\d+) Commits/.exec(lies("docs/adr/0016-langfuse-takt-woechentlich.md"))?.[1];
    const yml = /mindestens (\d+) Commits/.exec(lies(".github/workflows/langfuse-takt.yml"))?.[1];
    expect(Number(adr)).toBe(T.MIN_MERGES);
    expect(Number(yml)).toBe(T.MIN_MERGES);
  });

  test("Sortierung: älteres createdAt gewinnt vor der Nummer, bei gleichem createdAt die kleinere Nummer", () => {
    const aeltererMitHoehererNr = [offen(1400, { createdAt: "2026-10-01T05:00:00Z" }), offen(1304, { createdAt: "2026-10-05T05:00:00Z" })];
    expect(T.entscheideTakt({ offene: aeltererMitHoehererNr, mergesSeit: 0 })).toMatchObject({ nr: 1400 });
    const gleich = [offen(1400, { createdAt: "2026-10-01T05:00:00Z" }), offen(1304, { createdAt: "2026-10-01T05:00:00Z" })];
    expect(T.entscheideTakt({ offene: gleich, mergesSeit: 0 })).toMatchObject({ nr: 1304 });
    expect(T.entscheideTakt({ offene: [...gleich].reverse(), mergesSeit: 0 })).toMatchObject({ nr: 1304 });
  });

  test("normalizeOffene ohne created_at wirft (statt still zu sortieren)", () => {
    const issue = { number: 1, title: T.STATUS_TITEL, assignees: [] };
    expect(() => T.normalizeOffene([[issue]])).toThrow(/Form eines Issues/);
    expect(T.normalizeOffene([[{ ...issue, created_at: "2026-10-01T05:00:00Z" }]])).toHaveLength(1);
  });
});
