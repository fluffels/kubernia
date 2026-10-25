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
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawQuote from "../scripts/spielquote-lib.mjs";
import { FREMD, FREMD_OWNER } from "./support/fremd-config";

const OWNER = FREMD_OWNER; // Login des Maintainer-Accounts, nur Testdaten

type Item = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Harness = { aktion: "nach-oben" | "auf-position" | "nichts"; nr?: number; afterId?: string | null; grund: string };
type Takt = {
  HARNESS_TAKT_KOMMENTARE: number;
  harnessVoraussetzung: (a: { items: Item[] | null; position: number | null; positionFehler?: string | null }) => { ok: boolean; fehler?: boolean; meldung?: string };
  mergeFensterAb: (letzter: string | null, jetzt: string | Date) => Date;
  zaehleTicketMerges: (commits: unknown, seit?: string | Date | null) => number;
  istHarnessCommit: (c: unknown, harnessIssues?: Set<number> | null) => boolean;
  zaehleSpielMerges: (commits: unknown, seit?: string | Date | null) => number;
  quotenBericht: (commits: unknown[], seit?: string | null) => { harness: number; spiel: number; eingehalten: boolean; zeile: string };
  SPIEL_QUOTE: number;
  befundKommentare: (kommentare: unknown, owner: string) => number;
  entscheideHarnessTakt: (a: { items: Item[]; befundKommentare: number; position: number }) => Harness;
  ziehListeNach: (items: Item[], ergebnis: { nr: number; itemId?: string | null } | null) => Item[];
};
const T = raw as unknown as Takt;
const Q = rawQuote as unknown as {
  SPIEL_QUOTE: number;
  zaehleTicketMerges: Takt["zaehleTicketMerges"];
  istHarnessCommit: Takt["istHarnessCommit"];
  zaehleTaktMerges: (commits: unknown, seit?: string | Date | null, sammelIssues?: Set<number>) => number;
  befundKommentare: Takt["befundKommentare"];
  HARNESS_TAKT_KOMMENTARE: number;
  fuellstandVon: (a: { nr: number; repo: string; ladeKommentare: (nr: number, repo: string) => unknown }) => { wert: number } | { fehler: string };
};
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
    assignees: [{ login: OWNER }],
    ...extra,
  });
  test("filtert Pull Requests und liest Assignees", () => {
    const r = normalizeOffene([[issue(1), issue(2, { pull_request: {} })], [issue(3, { assignees: [] })]]);
    expect(r.map((i) => i.number)).toEqual([1, 3]);
    expect(r[0].assignees).toEqual([OWNER]);
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
    expect(T.zaehleTicketMerges([c(OWNER), c("dependabot[bot]"), c("github-actions[bot]"), c(null)])).toBe(2);
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
  const c = (message: string, login: string | null = OWNER, date = "2026-10-07T10:00:00Z") => ({ author: login === null ? null : { login }, commit: { message, committer: { date } } });
  const harness = c("feat(harness): Härtung (#1)\n\nKörper");
  const spiel = c("feat(sim): Pod (#2)");

  test("Harness-Scope wird am Titel des Squash-Commits erkannt, auch mit Ausrufezeichen und Großschreibung; Körper und andere Scopes nicht", () => {
    for (const m of ["feat(harness): x", "fix(harness)!: x", "CHORE(HARNESS): x"]) expect(T.istHarnessCommit(c(m)), m).toBe(true);
    for (const m of ["feat(sim): x", "feat: harness", "feat(harness-x): x", "docs(adr): x\n\nfeat(harness): y", "", "harness"]) expect(T.istHarnessCommit(c(m)), m).toBe(false);
    expect(T.istHarnessCommit(null)).toBe(false);
    expect(T.istHarnessCommit({})).toBe(false);
  });

  test("Label-Zuordnung (#1460 Z6): nur die Issue-Nummer macht einen Commit zu Harness, eine PR-Nummer allein nicht (keine PR→Issue-Auflösung)", () => {
    const menge = new Set([1428]);
    // Titel mit Issue UND PR (die Regel bei jedem Ticket-Merge): Harness
    expect(T.istHarnessCommit(c("feat(harness): x (#1428) (#1500)"), menge)).toBe(true);
    // Titel nur mit PR-Nummer: zählt als Spiel, auch mit Scope harness (Grenze, gemessen: 128 von 139 Commits tragen Issue und PR, 11 nur Dependabot)
    expect(T.istHarnessCommit(c("feat(harness): x (#1500)"), menge)).toBe(false);
    // ohne Menge bleibt der Rückfall auf den Scope
    expect(T.istHarnessCommit(c("feat(harness): x (#1500)"), null)).toBe(true);
  });

  test("zaehleSpielMerges: Harness-, Bot- und zu alte Commits zählen nicht", () => {
    const l = [spiel, harness, c("feat(sim): y", "dependabot[bot]"), c("feat(sim): z", OWNER, "2026-10-06T10:00:00Z"), c("feat(inhalt): q")];
    expect(T.zaehleSpielMerges(l)).toBe(3);
    expect(T.zaehleSpielMerges(l, "2026-10-07T00:00:00Z")).toBe(2);
    expect(() => T.zaehleSpielMerges({})).toThrow();
  });

  test("zaehleTaktMerges: Spiel und Agentic zählen, Bots, Sammelticket-Commits und zu alte nicht", () => {
    const alt = c("feat(sim): alt (#9)", OWNER, "2026-10-06T10:00:00Z");
    const sammelCommit = c("feat(harness): Härtung (#40) (#41)");
    const l = [spiel, harness, sammelCommit, c("feat(sim): z", "dependabot[bot]"), alt];
    expect(Q.zaehleTaktMerges(l, null, new Set([40]))).toBe(3);
    expect(Q.zaehleTaktMerges(l, "2026-10-07T00:00:00Z", new Set([40]))).toBe(2);
    expect(Q.zaehleTaktMerges(l)).toBe(4);
    expect(() => Q.zaehleTaktMerges({})).toThrow();
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

  test("quotenBericht: ein Harness-Merge VOR dem Fenster zählt nicht", () => {
    const alt = c("feat(harness): alt", OWNER, "2026-10-06T10:00:00Z");
    const altSpiel = c("feat(sim): alt", OWNER, "2026-10-06T10:00:00Z");
    const q = T.quotenBericht([alt, alt, altSpiel, spiel], "2026-10-07T00:00:00Z");
    expect(q).toMatchObject({ harness: 0, spiel: 1 });
    expect(T.quotenBericht([alt, alt, altSpiel, spiel], null)).toMatchObject({ harness: 2, spiel: 2 });
  });

  describe("fuellstandVon: Laden, Zählen und Fail-closed an einer Stelle", () => {
    const k = (login: string) => ({ user: { login, type: "User" } });
    const repo = `${OWNER}/projekt`;
    test("zählt die Owner-Kommentare (Owner aus dem Repo) und reicht Nummer und Repo an den Lader", () => {
      const gesehen: unknown[] = [];
      const r = Q.fuellstandVon({ nr: 7, repo, ladeKommentare: (nr, rp) => (gesehen.push([nr, rp]), [k(OWNER), k(OWNER), k("fremd")]) });
      expect(r).toEqual({ wert: 2 });
      expect(gesehen).toEqual([[7, repo]]);
    });
    test("ein Ladefehler wird zu { fehler } mit erster Zeile (kein Wurf)", () => {
      const r = Q.fuellstandVon({ nr: 7, repo, ladeKommentare: () => { throw new Error("HTTP 502\nzweite Zeile"); } });
      expect(r).toEqual({ fehler: "Kommentare von #7 nicht ladbar: HTTP 502" });
    });
    test("ein geworfener Nicht-Error (String) wird zu { fehler }", () => {
      const r = Q.fuellstandVon({ nr: 7, repo, ladeKommentare: () => { throw "kaputt"; } }); // eslint-disable-line @typescript-eslint/only-throw-error
      expect(r).toEqual({ fehler: "Kommentare von #7 nicht ladbar: kaputt" });
    });
    test("eine falsche Antwortform und ein kaputtes Repo sind fail-closed { fehler }", () => {
      expect(Q.fuellstandVon({ nr: 7, repo, ladeKommentare: () => ({}) })).toHaveProperty("fehler", "Kommentare von #7 nicht ladbar: kommentare muss eine Liste sein.");
      const kaputt = Q.fuellstandVon({ nr: 7, repo: "ohne-slash", ladeKommentare: () => [] });
      expect("fehler" in kaputt ? kaputt.fehler : "").toMatch(/nicht ladbar.*owner\/name/);
    });
  });

  test("befundKommentare (#1888): nur Kommentare des vertrauten Owners ohne [bot]; fremde, Bot-, anonyme und gelöschte Autoren zählen nicht", () => {
    const k = (login: string | null, type = "User") => ({ user: login === null ? null : { login, type } });
    expect(Q.befundKommentare([k(OWNER), k(OWNER), k("fremd"), k("github-actions[bot]", "Bot"), k("dependabot[bot]", "Bot"), k(null), {}], OWNER)).toBe(2);
    expect(Q.befundKommentare([k(OWNER.toUpperCase())], OWNER)).toBe(1); // Login ohne Groß-/Kleinschreibung
    expect(Q.befundKommentare([], OWNER)).toBe(0);
    expect(Q.befundKommentare([k(OWNER)], "")).toBe(0); // ohne Owner ist niemand vertraut
    expect(Q.befundKommentare([{ user: { login: `${OWNER}[bot]`, type: "User" } }], `${OWNER}[bot]`)).toBe(0); // ein [bot]-Login zählt nie
    expect(() => Q.befundKommentare({}, OWNER)).toThrow(/Liste/);
    expect(() => Q.befundKommentare(null, OWNER)).toThrow(/Liste/);
  });
});

describe("entscheideHarnessTakt (#1349 Z15, Positionskorrektur #1390)", () => {
  const TITEL = "Harness-Härtung (gesammelt)";
  const it = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = (number: number, extra: Partial<Item> = {}) => it(number, { title: TITEL, ...extra });
  const status = (number: number) => it(number, { title: STATUS_TITEL });
  const fueller = (von: number, bis: number) => Array.from({ length: bis - von + 1 }, (_, i) => it(von + i));
  const h = (items: Item[], n: number, position = 4) => T.entscheideHarnessTakt({ items, befundKommentare: n, position });

  test("Grenze 9/10/11: erst ab 10 Befund-Kommentaren nach oben (Härtungs-Takt, Füllstand #1888)", () => {
    expect(T.HARNESS_TAKT_KOMMENTARE).toBe(10);
    expect(T.HARNESS_TAKT_KOMMENTARE).not.toBe(T.SPIEL_QUOTE); // eigene Zahl, nicht an die Seitenwahl gekoppelt
    const board = [it(10), it(11), sammel(12)];
    expect(h(board, 9).aktion).toBe("nichts");
    expect(h(board, 9).grund).toMatch(/Füllstand 9\/10/);
    expect(h(board, 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
    expect(h(board, 11)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
    // schon hinter dem Kopf: bei 11 und 12 idempotent
    expect(h([status(2), sammel(12), it(10)], 11).aktion).toBe("nichts");
    expect(h([status(2), sammel(12), it(10)], 12).aktion).toBe("nichts");
  });

  test("kommt hinter den Kopf, nicht davor: Status-Ticket und roter main bleiben oben", () => {
    const board = [it(1, { title: "🚨 CI rot auf main" }), status(2), it(10), sammel(12)];
    expect(h(board, 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: "I2" });
  });

  test("idempotent: steht es schon direkt hinter dem Kopf (auch mit geschlossenem Item dazwischen), passiert nichts", () => {
    expect(h([status(2), sammel(12), it(10)], 9).aktion).toBe("nichts");
    expect(h([sammel(12), it(10)], 9).aktion).toBe("nichts");
    expect(h([status(2), it(9, { state: "closed" }), sammel(12)], 9).aktion).toBe("nichts");
  });

  test("geclaimtes, geschlossenes oder fehlendes Sammelticket: nichts", () => {
    expect(h([it(10), sammel(12, { assignees: [OWNER] })], 9).aktion).toBe("nichts");
    expect(h([it(10), sammel(12, { state: "closed" })], 9).aktion).toBe("nichts");
    expect(h([it(10)], 9).aktion).toBe("nichts");
  });

  test("Vorgänger in Arbeit (#1646): geclaimtes plus ungeclaimtes Sammelticket → kein nach-oben, auch bei Füllstand 12", () => {
    const board = [it(10), it(11), sammel(12, { assignees: [OWNER] }), sammel(13)];
    const r = h(board, 12);
    expect(r.aktion).toBe("nichts");
    expect(r.grund).toMatch(/Vorgänger #12 in Arbeit/);
    // ohne geclaimten Vorgänger bleibt es nach-oben
    expect(h([it(10), it(11), sammel(13)], 10)).toMatchObject({ aktion: "nach-oben", nr: 13 });
    // geschlossener Vorgänger zählt nicht
    expect(h([it(10), it(11), sammel(12, { assignees: [OWNER], state: "closed" }), sammel(13)], 10)).toMatchObject({ aktion: "nach-oben", nr: 13 });
  });

  test("Vorgänger in Arbeit: Regel 2 (auf-position) bleibt", () => {
    const board = [...fueller(1, 8), sammel(12, { assignees: [OWNER] }), sammel(13)];
    expect(h(board, 10)).toMatchObject({ aktion: "auf-position", nr: 13 });
  });

  test("ungültige Eingaben werfen (auch ein ungültiges position)", () => {
    expect(() => h([], -1)).toThrow();
    expect(() => T.entscheideHarnessTakt({ items: null as unknown as Item[], befundKommentare: 10, position: 4 })).toThrow();
    for (const bad of [0, -1, 1.5, Number.NaN, "4" as unknown as number]) expect(() => h([sammel(1)], 0, bad), String(bad)).toThrow(/position/);
  });

  test("auf-position (#1390 Z10): geringer Füllstand, aber das Sammelticket steht am Board-Ende → zurück auf die Position", () => {
    const ende = [...fueller(1, 10), sammel(20)];
    expect(h(ende, 0)).toMatchObject({ aktion: "auf-position", nr: 20, afterId: "I3" });
    expect(h(ende, 0).grund).toMatch(/Rang 11, zurück auf Rang 4/);
    expect(h(ende, 2).aktion).toBe("auf-position");
  });

  test("voller Füllstand hat Vorrang: ≥ 10 Befund-Kommentare und nicht hinter dem Kopf → nach-oben, nicht auf-position", () => {
    expect(h([...fueller(1, 10), sammel(20)], 10)).toMatchObject({ aktion: "nach-oben", nr: 20, afterId: null });
  });

  test("auf-position wandert nie in den Kopf: ein großer Kopf verschiebt das Ziel hinter ihn", () => {
    const kopf = [1, 2, 3, 4, 5].map((n) => it(n, { title: `Forum #${n}: x` }));
    expect(h([...kopf, it(30), it(31), sammel(20)], 0)).toMatchObject({ aktion: "auf-position", nr: 20, afterId: "I5" });
    expect(h([...kopf, sammel(20), it(30)], 0).aktion).toBe("nichts");
  });

  test("steht es auf Position N oder davor: nichts, auch bei geringem Füllstand", () => {
    expect(h([it(1), it(2), it(3), sammel(20), it(5)], 0).aktion).toBe("nichts");
    expect(h([it(1), sammel(20), it(3), it(4), it(5)], 0).aktion).toBe("nichts");
  });

  test("Fixpunkt: nach dem Anwenden der Entscheidung (nach-oben wie auf-position) ist der nächste Lauf ein nichts", () => {
    const boards = [[...fueller(1, 10), sammel(20)], [status(1), ...fueller(2, 10), sammel(20)], [it(1), it(2), sammel(20)], [it(30), sammel(20), ...fueller(1, 6)]];
    let geprueft = 0;
    for (const board of boards) {
      for (const n of [0, 4, 10, 20]) {
        const e = h(board, n);
        if (e.aktion === "nichts") continue;
        geprueft++;
        const danach = verschiebe(board, `I${e.nr}`, e.afterId ?? null);
        expect(h(danach, n).aktion, `${e.aktion} bei Füllstand ${n} auf ${board.map((x) => x.number).join(",")}`).toBe("nichts");
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
    expect(T.ziehListeNach(liste, { nr: 5, itemId: "ITEM_neu" }).map((i) => i.number)).toEqual([5, 1, 2]);
  });

  test("ein frisch angelegtes, noch nicht gelistetes Status-Ticket wird vorn ergänzt und zählt zum Kopf", () => {
    const liste = T.ziehListeNach([it(1), it(2)], { nr: 9, itemId: "ITEM_9" });
    expect(liste.map((i) => i.number)).toEqual([9, 1, 2]);
    expect(liste[0]).toMatchObject({ id: "ITEM_9", title: STATUS_TITEL, state: "open", assignees: [] });
    const kopfEnde = (rawLib as unknown as { kopfEnde: (i: Item[]) => number }).kopfEnde;
    expect(kopfEnde(liste)).toBe(1);
  });

  test("Komposition: nach dem Nachziehen entscheidet der Harness-Takt gegen die aktuelle Liste (Sammelticket hinter dem frischen Status-Ticket)", () => {
    const board = [it(1), it(2), it(12, { title: "Harness-Härtung (gesammelt)" })];
    const nachgezogen = T.ziehListeNach(board, { nr: 9, itemId: "ITEM_9" });
    expect(T.entscheideHarnessTakt({ items: nachgezogen, befundKommentare: 10, position: 4 })).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: "ITEM_9" });
  });
});

/** Erste Gruppe des LETZTEN Treffers eines globalen Musters (der jüngste Abschnitt eines wachsenden ADR) oder undefined. */
function letzterTreffer(re: RegExp, text: string): string | undefined {
  return [...text.matchAll(re)].at(-1)?.[1];
}

/** Bindet JEDE Stelle, die das globale Muster trägt, an die erwartete Zahl (nicht nur den ersten Treffer je Datei); mindestens `min` Stellen, sonst wäre die Bindung leer. */
function bindeAlle(re: RegExp, text: string, erwartet: number, min = 1): void {
  const zahlen = [...text.matchAll(re)].map((m) => Number(m[1]));
  expect(zahlen.length, `Muster ${re} trifft zu selten`).toBeGreaterThanOrEqual(min);
  expect(zahlen.every((z) => z === erwartet), `Muster ${re}: ${zahlen.join(", ")} statt ${erwartet}`).toBe(true);
}

describe("spielquote-lib (#1729)", () => {
  test("die Bestandsfunktionen sind aus board-takt erreichbar und identisch (Re-Export)", () => {
    expect(T.SPIEL_QUOTE).toBe(Q.SPIEL_QUOTE);
    expect(T.zaehleTicketMerges).toBe(Q.zaehleTicketMerges);
    expect(T.istHarnessCommit).toBe(Q.istHarnessCommit);
  });
  describe("sammelStand (#1798)", () => {
    type I = { number: number; title: string; state: string; closedAt?: string | null; assignees?: unknown[] };
    const SS = (rawQuote as unknown as { sammelStand: (i: I[]) => { abschluss: { number: number; closedAt: string } | null; sammelIssues: Set<number>; inArbeit: number | null } }).sammelStand;
    const H = "Harness-Härtung (gesammelt)";
    test("leere Liste: kein Abschluss, keine Sammeltickets, nichts in Arbeit", () => {
      expect(SS([])).toEqual({ abschluss: null, sammelIssues: new Set(), inArbeit: null });
    });
    test("das jüngste geschlossene Sammelticket gewinnt, ungültiges closedAt wird übersprungen, state ohne Groß/Klein", () => {
      const s = SS([
        { number: 1, title: H, state: "CLOSED", closedAt: "2026-10-01T00:00:00Z" },
        { number: 2, title: H, state: "closed", closedAt: "2026-10-05T00:00:00Z" },
        { number: 3, title: H, state: "CLOSED", closedAt: "kein-datum" },
        { number: 4, title: H, state: "OPEN", closedAt: "2026-10-09T00:00:00Z" },
      ]);
      expect(s.abschluss).toEqual({ number: 2, closedAt: "2026-10-05T00:00:00Z" });
      expect([...s.sammelIssues].sort()).toEqual([1, 2, 3, 4]);
    });
    test("Langfuse-Sammelticket zählt zu sammelIssues, nie als Abschluss und nie als in Arbeit", () => {
      const s = SS([
        { number: 5, title: "Langfuse-Befunde (gesammelt)", state: "CLOSED", closedAt: "2026-10-09T00:00:00Z" },
        { number: 6, title: "Langfuse-Befunde (gesammelt)", state: "OPEN", assignees: [{ login: "x" }] },
        { number: 7, title: "Etwas anderes (gesammelt)", state: "OPEN", assignees: [{ login: "x" }] },
      ]);
      expect(s).toEqual({ abschluss: null, sammelIssues: new Set([5, 6]), inArbeit: null });
    });
    test("offen mit Assignee ist in Arbeit, ohne Assignee oder ohne assignees-Feld nicht", () => {
      expect(SS([{ number: 8, title: H, state: "OPEN", assignees: [{ login: "x" }] }]).inArbeit).toBe(8);
      expect(SS([{ number: 8, title: H, state: "OPEN", assignees: [] }]).inArbeit).toBeNull();
      expect(SS([{ number: 8, title: H, state: "OPEN" }]).inArbeit).toBeNull();
    });
    test("keine Liste: wirft", () => {
      expect(() => SS(null as unknown as I[])).toThrow(/Liste/);
    });
  });
  describe("harnessIssuesAnfrage und harnessIssuesAus (#1798)", () => {
    const L = rawQuote as unknown as { harnessIssuesAnfrage: (a: { repo: string; label: string; seit: string }) => string[]; harnessIssuesAus: (s: unknown) => Set<number> };
    test("Anfrage: paginiert, Label kodiert, seit durchgereicht", () => {
      expect(L.harnessIssuesAnfrage({ repo: "o/r", label: `${FREMD.labels.harness} x`, seit: "2026-10-01T00:00:00.000Z" })).toEqual([
        "api", "--paginate", "--slurp", `repos/o/r/issues?state=closed&labels=${FREMD.labels.harness.replace(":", "%3A")}%20x&since=2026-10-01T00:00:00.000Z&per_page=100`,
      ]);
    });
    test("Aus: Nummern ohne PRs über alle Seiten; falsche Form wirft", () => {
      expect(L.harnessIssuesAus([[{ number: 1 }, { number: 2, pull_request: {} }], [{ number: 3 }]])).toEqual(new Set([1, 3]));
      expect(L.harnessIssuesAus([[null, { number: 4 }]])).toEqual(new Set([4]));
      expect(() => L.harnessIssuesAus({})).toThrow(/Antwortform/);
      expect(() => L.harnessIssuesAus(null)).toThrow(/Antwortform/);
    });
  });
});

describe("letzterTreffer (#1428 Z21)", () => {
  test("alte Zahl vorn, aktuelle hinten: die aktuelle zählt; umgekehrt die hintere", () => {
    expect(letzterTreffer(/(\d+) Merges/g, "5 Merges ... 3 Merges")).toBe("3");
    expect(letzterTreffer(/(\d+) Merges/g, "3 Merges ... 5 Merges")).toBe("5");
    expect(letzterTreffer(/(\d+) Merges/g, "keine Zahl")).toBeUndefined();
  });
});

describe("Bindung der Aktivitäts-Zahlen an die Doku (#1349)", () => {
  const lies = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  const status = rawStatus as unknown as { MIN_TICKET_MERGES_PUSH: number; MIN_ABSTAND_STUNDEN: number };
  test("MIN_TICKET_MERGES_PUSH und HARNESS_TAKT_KOMMENTARE stehen in ADR 0016 samt Fortschreibung, im Workflow-Kommentar und in ticket-reihenfolge.md", () => {
    const adr = lies("docs/adr/0016-langfuse-takt-woechentlich.md");
    const yml = lies(".github/workflows/board-takt.yml");
    const doc = lies("docs/ticket-reihenfolge.md");
    const fortschreibung = lies("docs/adr/fortschreibungen/0016-1888-haertungs-takt-nach-fuellstand.md");
    expect(Number(/mindestens (\d+) Ticket-Merges/.exec(yml)?.[1])).toBe(status.MIN_TICKET_MERGES_PUSH);
    bindeAlle(/ab (\d+) Befund-Kommentaren/g, yml, T.HARNESS_TAKT_KOMMENTARE);
    // #1428 Z21: der ADR wächst durch Fortschreibungen nur am Ende; die Bindung gilt dem LETZTEN Treffer (dem jüngsten Stand).
    expect(Number(letzterTreffer(/(\d+) Ticket-Merges \(ohne Bots\)/g, adr))).toBe(status.MIN_TICKET_MERGES_PUSH);
    bindeAlle(/ab (\d+) Befund-Kommentaren/g, fortschreibung, T.HARNESS_TAKT_KOMMENTARE);
    bindeAlle(/füllt sich \(k\/(\d+) Befund-Kommentare\)/g, fortschreibung, T.HARNESS_TAKT_KOMMENTARE);
    bindeAlle(/Spielquote 1:(\d+)/g, fortschreibung, T.SPIEL_QUOTE);
    expect(Number(/(\d+) Ticket-Merges \(ohne Bots\)/.exec(doc)?.[1])).toBe(status.MIN_TICKET_MERGES_PUSH);
    expect(Number(/Mindestabstand von (\d+) Stunden/.exec(adr)?.[1])).toBe(status.MIN_ABSTAND_STUNDEN);
    expect(Number(/Mindestabstand von (\d+) Stunden/.exec(doc)?.[1])).toBe(status.MIN_ABSTAND_STUNDEN);
    expect(Number(/Mindestabstand von (\d+) Stunden/.exec(yml)?.[1])).toBe(status.MIN_ABSTAND_STUNDEN);
    // ticket-reihenfolge.md nennt Schwelle und Quote an mehreren Stellen (Takt-Absatz, Position, Kennzahl-Soll): jede muss stimmen.
    bindeAlle(/ab (\d+) Befund-Kommentaren/g, doc, T.HARNESS_TAKT_KOMMENTARE, 2);
    bindeAlle(/Schwelle (\d+) Befund-Kommentare/g, doc, T.HARNESS_TAKT_KOMMENTARE);
    bindeAlle(/füllt sich \(k\/(\d+) Befund-Kommentare\)/g, doc, T.HARNESS_TAKT_KOMMENTARE);
    bindeAlle(/Spielquote 1:(\d+)/g, doc, T.SPIEL_QUOTE, 2);
    // die Zahl steht auch in Glossar, Befehlsreferenz und Anlaufstellen
    expect(Number(/ab der Schwelle (\d+) greift der Härtungs-Takt/.exec(lies("docs/harness-glossar.md"))?.[1])).toBe(T.HARNESS_TAKT_KOMMENTARE);
    const befehle = lies("docs/referenz/befehle.md");
    bindeAlle(/erst ab (\d+) Befund-Kommentaren als frei/g, befehle, T.HARNESS_TAKT_KOMMENTARE);
    bindeAlle(/füllt sich \(k\/(\d+) Befund-Kommentare\)/g, befehle, T.HARNESS_TAKT_KOMMENTARE);
    expect(Number(/Harness-Sammelticket ab (\d+) Befund-Kommentaren/.exec(lies("docs/referenz/anlaufstellen.md"))?.[1])).toBe(T.HARNESS_TAKT_KOMMENTARE);
  });
  test("das Kennzahl-Soll (#1729) trägt dieselbe Zahl in ticket-reihenfolge.md und, als jüngster Stand, in ADR 0016", () => {
    const wendung = /nach (\d+) Produkt-Merges \(Spielquote 1:\d+\) seit dem letzten Factory-Merge/;
    expect(Number(wendung.exec(lies("docs/ticket-reihenfolge.md"))?.[1])).toBe(Q.SPIEL_QUOTE);
    expect(Number(letzterTreffer(/nach (\d+) Produkt-Merges seit dem letzten Factory-Merge/g, lies("docs/adr/0016-langfuse-takt-woechentlich.md")))).toBe(Q.SPIEL_QUOTE);
  });
  test("Bibliothek statt Querimport: board-takt importiert die Quote aus spielquote-lib, nicht aus dem Auswahl-Skript; naechstes-ticket kennt die Spielquote nicht (es nutzt aus der Bibliothek nur den Füllstand des Härtungs-Takts)", () => {
    const takt = lies("scripts/board-takt.mjs");
    const wahl = lies("scripts/naechstes-ticket.mjs");
    expect(takt).toContain('from "./spielquote-lib.mjs"');
    expect(wahl).not.toMatch(/SPIEL_QUOTE|quotenBericht|zaehleSpielMerges/); // die Spielquote steuert die Auswahl nicht
    expect(wahl).toMatch(/import \{ HARNESS_TAKT_KOMMENTARE, fuellstandVon \} from "\.\/spielquote-lib\.mjs"/);
    expect(takt).not.toMatch(/from "\.\/naechstes-ticket\.mjs"/);
    expect(wahl).not.toMatch(/from "\.\/board-takt\.mjs"/);
  });
  test("der Workflow löst auf Push nach main aus und ruft board-takt.mjs", () => {
    const yml = lies(".github/workflows/board-takt.yml");
    expect(yml).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(yml).toMatch(/run: node scripts\/board-takt\.mjs/);
  });
});
