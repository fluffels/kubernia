/* Generischer Board-Takt (#1390): Commit-Fenster, Harness-Sammelticket nach Aktivität und Positionskorrektur sind pur und idempotent.
 * Die Status-Ticket-Entscheidung testet test/langfuse-takt.test.ts.
 *
 * Reines Node-Tooling-Skript ohne Declaration-File: Import über `unknown` auf ein lokales Interface (Technik wie test/board.test.ts). */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawStatus from "../scripts/langfuse-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";

type Item = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Harness = { aktion: "nach-oben" | "auf-position" | "nichts"; nr?: number; afterId?: string | null; grund: string };
type Takt = {
  HARNESS_TAKT_MERGES: number;
  harnessVoraussetzung: (a: { items: Item[] | null; position: number | null; positionFehler?: string | null }) => { ok: boolean; fehler?: boolean; meldung?: string };
  mergeFensterAb: (letzter: string | null, jetzt: string | Date) => Date;
  zaehleTicketMerges: (commits: unknown, seit?: string | Date | null) => number;
  istHarnessCommit: (c: unknown) => boolean;
  zaehleSpielMerges: (commits: unknown, seit?: string | Date | null) => number;
  quotenBericht: (commits: unknown[], seit?: string | null) => { harness: number; spiel: number; eingehalten: boolean; zeile: string };
  SPIEL_QUOTE: number;
  entscheideHarnessTakt: (a: { items: Item[]; ticketMergesSeitAbschluss: number; position: number }) => Harness;
  ziehListeNach: (items: Item[], ergebnis: { nr: number; itemId?: string | null } | null) => Item[];
};
const T = raw as unknown as Takt;
const normalizeOffene = (rawLib as unknown as { normalizeOffene: (pages: unknown) => Offen[] }).normalizeOffene;
const STATUS_TITEL = (rawStatus as unknown as { STATUS_TITEL: string }).STATUS_TITEL;
const verschiebe = (rawLib as unknown as { verschiebe: (i: Item[], id: string, after: string | null) => Item[] }).verschiebe;

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

describe("normalizeOffene", () => {
  const issue = (number: number, extra: Record<string, unknown> = {}) => ({
    number,
    title: "x",
    created_at: "2026-10-01T00:00:00Z",
    assignees: [{ login: "fluffels" }],
    ...extra,
  });
  test("filtert Pull Requests und liest Assignees", () => {
    const r = normalizeOffene([[issue(1), issue(2, { pull_request: {} })], [issue(3, { assignees: [] })]]);
    expect(r.map((i) => i.number)).toEqual([1, 3]);
    expect(r[0].assignees).toEqual(["fluffels"]);
    expect(r[1].assignees).toEqual([]);
  });
  test("falsche Form wirft", () => {
    expect(() => normalizeOffene({})).toThrow();
    expect(() => normalizeOffene([issue(1)])).toThrow();
    expect(() => normalizeOffene([[{ number: 1 }]])).toThrow();
  });
  test("ohne created_at wirft (statt still zu sortieren)", () => {
    const i = { number: 1, title: STATUS_TITEL, assignees: [] };
    expect(() => normalizeOffene([[i]])).toThrow(/Form eines Issues/);
    expect(normalizeOffene([[{ ...i, created_at: "2026-10-01T05:00:00Z" }]])).toHaveLength(1);
  });
});

describe("zaehleTicketMerges (#1349)", () => {
  const c = (login: string | null, date = "2026-10-07T10:00:00Z") => ({ author: login === null ? null : { login }, commit: { committer: { date } } });

  test("Bots zählen nicht (dependabot[bot], github-actions[bot]), Menschen und fehlender Autor schon", () => {
    expect(T.zaehleTicketMerges([c("fluffels"), c("dependabot[bot]"), c("github-actions[bot]"), c(null)])).toBe(2);
    expect(T.zaehleTicketMerges([])).toBe(0);
  });

  test("seit: nur Commits ab dem Zeitpunkt, Grenze inklusive, kaputtes Datum zählt nicht", () => {
    const l = [c("a", "2026-10-07T09:59:59Z"), c("a", "2026-10-07T10:00:00Z"), c("a", "kaputt")];
    expect(T.zaehleTicketMerges(l, "2026-10-07T10:00:00Z")).toBe(1);
    expect(() => T.zaehleTicketMerges(l, "morgen")).toThrow();
  });

  test("keine Liste wirft", () => {
    expect(() => T.zaehleTicketMerges({})).toThrow();
  });
});

describe("Spielquote im Takt (#1425)", () => {
  const c = (message: string, login: string | null = "fluffels", date = "2026-10-07T10:00:00Z") => ({ author: login === null ? null : { login }, commit: { message, committer: { date } } });
  const harness = c("feat(harness): Härtung (#1)\n\nKörper");
  const spiel = c("feat(sim): Pod (#2)");

  test("Harness-Scope wird am Titel des Squash-Commits erkannt, auch mit Ausrufezeichen und Großschreibung; Körper und andere Scopes nicht", () => {
    for (const m of ["feat(harness): x", "fix(harness)!: x", "CHORE(HARNESS): x"]) expect(T.istHarnessCommit(c(m)), m).toBe(true);
    for (const m of ["feat(sim): x", "feat: harness", "feat(harness-x): x", "docs(adr): x\n\nfeat(harness): y", "", "harness"]) expect(T.istHarnessCommit(c(m)), m).toBe(false);
    expect(T.istHarnessCommit(null)).toBe(false);
    expect(T.istHarnessCommit({})).toBe(false);
  });

  test("zaehleSpielMerges: Harness-, Bot- und zu alte Commits zählen nicht", () => {
    const l = [spiel, harness, c("feat(sim): y", "dependabot[bot]"), c("feat(sim): z", "fluffels", "2026-10-06T10:00:00Z"), c("feat(inhalt): q")];
    expect(T.zaehleSpielMerges(l)).toBe(3);
    expect(T.zaehleSpielMerges(l, "2026-10-07T00:00:00Z")).toBe(2);
    expect(() => T.zaehleSpielMerges({})).toThrow();
  });

  test("quotenBericht: 1:3 ist eingehalten, 2:3 überschritten, leeres Fenster eingehalten", () => {
    expect(T.SPIEL_QUOTE).toBe(3);
    const q = T.quotenBericht([harness, spiel, spiel, spiel]);
    expect(q).toMatchObject({ harness: 1, spiel: 3, eingehalten: true });
    expect(q.zeile).toMatch(/1 Harness- auf 3 Spiel-Merges/);
    expect(T.quotenBericht([harness, harness, spiel, spiel, spiel]).eingehalten).toBe(false);
    expect(T.quotenBericht([]).eingehalten).toBe(true);
    expect(T.quotenBericht([c("feat(harness): x", "dependabot[bot]"), spiel], null).harness).toBe(0);
  });

  test("der Takt zählt für das Sammelticket nur Spiel-Merges: viele Harness-Merges lösen es nicht aus", () => {
    const commits = [harness, harness, harness, harness, harness, spiel];
    expect(T.zaehleTicketMerges(commits)).toBe(6);
    expect(T.zaehleSpielMerges(commits)).toBe(1);
    expect(T.zaehleSpielMerges(commits)).toBeLessThan(T.HARNESS_TAKT_MERGES);
  });
});

describe("entscheideHarnessTakt (#1349 Z15, Positionskorrektur #1390)", () => {
  const TITEL = "Harness-Härtung (gesammelt)";
  const it = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = (number: number, extra: Partial<Item> = {}) => it(number, { title: TITEL, ...extra });
  const status = (number: number) => it(number, { title: STATUS_TITEL });
  const fueller = (von: number, bis: number) => Array.from({ length: bis - von + 1 }, (_, i) => it(von + i));
  const h = (items: Item[], n: number, position = 4) => T.entscheideHarnessTakt({ items, ticketMergesSeitAbschluss: n, position });

  test("Grenze 2/3: erst ab 3 Spiel-Merges nach oben", () => {
    expect(T.HARNESS_TAKT_MERGES).toBe(3);
    const board = [it(10), it(11), sammel(12)];
    expect(h(board, 2).aktion).toBe("nichts");
    expect(h(board, 3)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
  });

  test("kommt hinter den Kopf, nicht davor: Status-Ticket und roter main bleiben oben", () => {
    const board = [it(1, { title: "🚨 CI rot auf main" }), status(2), it(10), sammel(12)];
    expect(h(board, 5)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: "I2" });
  });

  test("idempotent: steht es schon direkt hinter dem Kopf (auch mit geschlossenem Item dazwischen), passiert nichts", () => {
    expect(h([status(2), sammel(12), it(10)], 9).aktion).toBe("nichts");
    expect(h([sammel(12), it(10)], 9).aktion).toBe("nichts");
    expect(h([status(2), it(9, { state: "closed" }), sammel(12)], 9).aktion).toBe("nichts");
  });

  test("geclaimtes, geschlossenes oder fehlendes Sammelticket: nichts", () => {
    expect(h([it(10), sammel(12, { assignees: ["fluffels"] })], 9).aktion).toBe("nichts");
    expect(h([it(10), sammel(12, { state: "closed" })], 9).aktion).toBe("nichts");
    expect(h([it(10)], 9).aktion).toBe("nichts");
  });

  test("ungültige Eingaben werfen (auch ein ungültiges position)", () => {
    expect(() => h([], -1)).toThrow();
    expect(() => T.entscheideHarnessTakt({ items: null as unknown as Item[], ticketMergesSeitAbschluss: 5, position: 4 })).toThrow();
    for (const bad of [0, -1, 1.5, Number.NaN, "4" as unknown as number]) expect(() => h([sammel(1)], 0, bad), String(bad)).toThrow(/position/);
  });

  test("auf-position (#1390 Z10): wenig Aktivität, aber das Sammelticket steht am Board-Ende → zurück auf die Position", () => {
    const ende = [...fueller(1, 10), sammel(20)];
    expect(h(ende, 0)).toMatchObject({ aktion: "auf-position", nr: 20, afterId: "I3" });
    expect(h(ende, 0).grund).toMatch(/Rang 11, zurück auf Rang 4/);
    expect(h(ende, 2).aktion).toBe("auf-position");
  });

  test("viel Aktivität hat Vorrang: ≥ 3 Spiel-Merges und nicht hinter dem Kopf → nach-oben, nicht auf-position", () => {
    expect(h([...fueller(1, 10), sammel(20)], 5)).toMatchObject({ aktion: "nach-oben", nr: 20, afterId: null });
  });

  test("auf-position wandert nie in den Kopf: ein großer Kopf verschiebt das Ziel hinter ihn", () => {
    const kopf = [1, 2, 3, 4, 5].map((n) => it(n, { title: `Forum #${n}: x` }));
    expect(h([...kopf, it(30), it(31), sammel(20)], 0)).toMatchObject({ aktion: "auf-position", nr: 20, afterId: "I5" });
    expect(h([...kopf, sammel(20), it(30)], 0).aktion).toBe("nichts");
  });

  test("steht es auf Position N oder davor: nichts, auch mit wenig Aktivität", () => {
    expect(h([it(1), it(2), it(3), sammel(20), it(5)], 0).aktion).toBe("nichts");
    expect(h([it(1), sammel(20), it(3), it(4), it(5)], 0).aktion).toBe("nichts");
  });

  test("Fixpunkt: nach dem Anwenden der Entscheidung (nach-oben wie auf-position) ist der nächste Lauf ein nichts", () => {
    const boards = [[...fueller(1, 10), sammel(20)], [status(1), ...fueller(2, 10), sammel(20)], [it(1), it(2), sammel(20)], [it(30), sammel(20), ...fueller(1, 6)]];
    let geprueft = 0;
    for (const board of boards) {
      for (const n of [0, 4, 5, 20]) {
        const e = h(board, n);
        if (e.aktion === "nichts") continue;
        geprueft++;
        const danach = verschiebe(board, `I${e.nr}`, e.afterId ?? null);
        expect(h(danach, n).aktion, `${e.aktion} bei ${n} Merges auf ${board.map((x) => x.number).join(",")}`).toBe("nichts");
      }
    }
    expect(geprueft, "die Schleife prüft wirklich etwas").toBeGreaterThan(4);
  });
});

describe("ziehListeNach: die Board-Liste wird nach der Status-Aktion im Speicher nachgezogen (#1390 Z6c)", () => {
  const it = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });

  test("ohne itemId (nichts bewegt, kein Token, Fehler) bleibt die Liste, wie sie war", () => {
    const liste = [it(1), it(2)];
    expect(T.ziehListeNach(liste, null)).toBe(liste);
    expect(T.ziehListeNach(liste, { nr: 5, itemId: null })).toBe(liste);
  });

  test("ein schon gelistetes Status-Ticket wandert an die Spitze (auch bei bekannter Nummer mit anderer ID)", () => {
    const liste = [it(1), it(2), it(5, { title: STATUS_TITEL })];
    expect(T.ziehListeNach(liste, { nr: 5, itemId: "I5" }).map((i) => i.number)).toEqual([5, 1, 2]);
    expect(T.ziehListeNach(liste, { nr: 5, itemId: "PVTI_neu" }).map((i) => i.number)).toEqual([5, 1, 2]);
  });

  test("ein frisch angelegtes, noch nicht gelistetes Status-Ticket wird vorn ergänzt und zählt zum Kopf", () => {
    const liste = T.ziehListeNach([it(1), it(2)], { nr: 9, itemId: "PVTI_9" });
    expect(liste.map((i) => i.number)).toEqual([9, 1, 2]);
    expect(liste[0]).toMatchObject({ id: "PVTI_9", title: STATUS_TITEL, state: "open", assignees: [] });
    const kopfEnde = (rawLib as unknown as { kopfEnde: (i: Item[]) => number }).kopfEnde;
    expect(kopfEnde(liste)).toBe(1);
  });

  test("Komposition: nach dem Nachziehen entscheidet der Harness-Takt gegen die aktuelle Liste (Sammelticket hinter dem frischen Status-Ticket)", () => {
    const board = [it(1), it(2), it(12, { title: "Harness-Härtung (gesammelt)" })];
    const nachgezogen = T.ziehListeNach(board, { nr: 9, itemId: "PVTI_9" });
    expect(T.entscheideHarnessTakt({ items: nachgezogen, ticketMergesSeitAbschluss: 5, position: 4 })).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: "PVTI_9" });
  });
});

describe("Bindung der Aktivitäts-Zahlen an die Doku (#1349)", () => {
  const lies = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  const status = rawStatus as unknown as { MIN_TICKET_MERGES_PUSH: number; MIN_ABSTAND_STUNDEN: number };
  test("MIN_TICKET_MERGES_PUSH und HARNESS_TAKT_MERGES stehen in ADR 0016, im Workflow-Kommentar und in ticket-reihenfolge.md", () => {
    const adr = lies("docs/adr/0016-langfuse-takt-woechentlich.md");
    const yml = lies(".github/workflows/board-takt.yml");
    const doc = lies("docs/ticket-reihenfolge.md");
    expect(Number(/mindestens (\d+) Ticket-Merges/.exec(yml)?.[1])).toBe(status.MIN_TICKET_MERGES_PUSH);
    expect(Number(/nach (\d+) Spiel-Merges/.exec(yml)?.[1])).toBe(T.HARNESS_TAKT_MERGES);
    expect(Number(/(\d+) Ticket-Merges \(ohne Bots\)/.exec(adr)?.[1])).toBe(status.MIN_TICKET_MERGES_PUSH);
    expect(Number(/nach (\d+) Spiel-Merges seit dem Abschluss des letzten Sammeltickets/.exec(adr)?.[1])).toBe(T.HARNESS_TAKT_MERGES);
    expect(Number(/(\d+) Ticket-Merges \(ohne Bots\)/.exec(doc)?.[1])).toBe(status.MIN_TICKET_MERGES_PUSH);
    expect(Number(/Mindestabstand von (\d+) Stunden/.exec(adr)?.[1])).toBe(status.MIN_ABSTAND_STUNDEN);
    expect(Number(/Mindestabstand von (\d+) Stunden/.exec(doc)?.[1])).toBe(status.MIN_ABSTAND_STUNDEN);
    expect(Number(/Mindestabstand von (\d+) Stunden/.exec(yml)?.[1])).toBe(status.MIN_ABSTAND_STUNDEN);
    expect(Number(/nach (\d+) Spiel-Merges seit dem Abschluss des letzten Sammeltickets/.exec(doc)?.[1])).toBe(T.HARNESS_TAKT_MERGES);
  });
  test("der Workflow löst auf Push nach main aus und ruft board-takt.mjs", () => {
    const yml = lies(".github/workflows/board-takt.yml");
    expect(yml).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(yml).toMatch(/run: node scripts\/board-takt\.mjs/);
  });
});
