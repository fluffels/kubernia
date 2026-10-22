/* Spielquote nach Issue-Label (#1428 Z22) und die Verdrahtung des Takt-Laufs mit Fakes (#1428 Z23): `fuehreTaktAus` nimmt seine I/O
 * injiziert, die Tests prüfen Fenster, Label-Menge und Listen-Nachzug ohne Netz. Technik wie test/board-takt.test.ts. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-takt.mjs";

type Item = { id: string; number: number; status: string; title: string; assignees: string[]; state: string; labels?: string[] };
type Io = {
  ghJson: (args: string[]) => unknown;
  loadItems: (rolle: string, o: { token: string }) => Item[];
  loadOpenIssuePages: (repo: string) => unknown[];
  positionLautAgentsMd: () => number;
  fuehreStatusAus: (e: { aktion: string; nr?: number }, ctx: unknown) => { ok: boolean; nr?: number; itemId?: string };
  fuehreHarnessAus: (h: { aktion: string; nr?: number }, items: Item[], token: string) => boolean;
  itemsUeberIssues?: (rolle: string, nummern: number[], o: { token?: string }) => ({ number: number } | null)[];
  frischeOffeneIssues?: (a: { repo: string; label: string; anzahl: number }) => { number: number; titel: string }[];
  addToBoardTodo?: (rolle: string, nodeId: string, o: { token?: string }) => string;
  log: (z: string) => void;
};
const T = raw as unknown as {
  istHarnessCommit: (c: unknown, h?: Set<number> | null) => boolean;
  zaehleSpielMerges: (c: unknown[], seit?: string | null, h?: Set<number> | null) => number;
  quotenBericht: (c: unknown[], seit?: string | null, h?: Set<number> | null) => { harness: number; spiel: number };
  harnessTaktAusCommits: (a: { items: Item[]; commits: unknown[]; seit?: string | null; position: number; sammelIssues?: Set<number> }) => { aktion: string };
  fuehreTaktAus: (a: { jetzt: Date; dry?: boolean; repo?: string; ausloeser?: string; token?: string; io: Io; config?: unknown }) => { fehler: boolean };
};

const CFG = { labels: { harness: "area:harness", forum: "forum" } };

/** Fake für `io.loadItems`: die Items stehen auf dem Factory-Board (dort arbeiten Status- und Harness-Takt), das Produkt-Board ist leer. */
const nurFactory = (items: Item[]) => (rolle: string) => (rolle === "factory" ? items : []);
const c = (message: string, date = "2026-10-07T10:00:00Z") => ({ author: { login: "fluffels" }, commit: { message, committer: { date } } });
const H = new Set([102, 103]);

describe("istHarnessCommit nach Label (#1428 Z22)", () => {
  test("Doku-Scope mit Harness-Issue ist Harness; fix(ci) zu einem Harness-Issue ebenso", () => {
    expect(T.istHarnessCommit(c("docs(adr): Wächter (#102)"), H)).toBe(true);
    expect(T.istHarnessCommit(c("fix(ci): rot (#103)"), H)).toBe(true);
  });
  test("feat(harness) zu einem Spiel-Issue (Referenz nicht in der Menge) ist Spiel", () => {
    expect(T.istHarnessCommit(c("feat(harness): x (#7)"), H)).toBe(false);
  });
  test("ohne Referenz oder ohne Menge: Rückfall auf den Scope", () => {
    expect(T.istHarnessCommit(c("feat(harness): x"), H)).toBe(true);
    expect(T.istHarnessCommit(c("docs(adr): x"), H)).toBe(false);
    expect(T.istHarnessCommit(c("docs(adr): x (#102)"), null)).toBe(false);
    expect(T.istHarnessCommit(c("feat(harness): x (#7)"), null)).toBe(true);
  });
  test("mehrere Referenzen: eine Harness-Nummer genügt; nur der Titel zählt, nicht der Körper", () => {
    expect(T.istHarnessCommit(c("feat(sim): x (#7, #102)"), H)).toBe(true);
    expect(T.istHarnessCommit(c("feat(sim): x (#7)\n\nFolge #102"), H)).toBe(false);
  });
  test("Zählung und Bericht nutzen die Menge", () => {
    const l = [c("feat(sim): a (#7)"), c("docs(adr): b (#102)"), c("feat(harness): c (#8)")];
    expect(T.zaehleSpielMerges(l, null, H)).toBe(2); // a und das feat(harness) zu Spiel-Issue #8
    expect(T.zaehleSpielMerges(l)).toBe(2); // ohne Menge zählt nur der Scope: docs(adr) ist Spiel, feat(harness) Harness
    expect(T.quotenBericht(l, null, H)).toMatchObject({ harness: 1, spiel: 2 });
  });
});

describe("fuehreTaktAus: Verdrahtung mit Fakes (#1428 Z23)", () => {
  const it = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = it(12, { title: "Harness-Härtung (gesammelt)" });
  const STATUS = "Langfuse-Status überprüfen";

  function lauf(commits: unknown[], opts: { offeneStatus?: boolean; offeneSammel?: boolean } = {}) {
    const log: string[] = [];
    const aufrufe: { harness: { items: Item[] }[]; status: unknown[]; ghArgs: string[] } = { harness: [], status: [], ghArgs: [] };
    const io: Io = {
      ghJson: (args) => {
        aufrufe.ghArgs.push(args.join(" "));
        if (args.join(" ").includes("state=closed")) {
          return [[
            { number: 100, title: "Harness-Härtung (gesammelt)", closed_at: "2026-10-01T00:00:00Z", created_at: "2026-09-20T00:00:00Z" },
            { number: 102, title: "Wächter", closed_at: "2026-10-05T00:00:00Z", created_at: "2026-10-04T00:00:00Z" },
          ]];
        }
        return [commits];
      },
      loadItems: nurFactory([it(10), it(11), sammel, it(50, { title: STATUS })]),
      loadOpenIssuePages: () => [[
        ...(opts.offeneStatus ? [{ number: 50, title: STATUS, created_at: "2026-10-02T00:00:00Z", assignees: [] }] : []),
        ...(opts.offeneSammel ? [{ number: 160, title: "Langfuse-Befunde (gesammelt)", created_at: "2026-10-02T00:00:00Z", assignees: ["fluffels"] }] : []),
      ]],
      positionLautAgentsMd: () => 4,
      fuehreStatusAus: (e) => {
        aufrufe.status.push(e);
        return { ok: true, nr: 50, itemId: "I50" };
      },
      fuehreHarnessAus: (h, items) => {
        aufrufe.harness.push({ items });
        return true;
      },
      log: (z) => log.push(z),
    };
    const r = T.fuehreTaktAus({ config: CFG, jetzt: new Date("2026-10-08T12:00:00Z"), token: "t", io });
    return { r, log, aufrufe };
  }

  const spiel = (n: number) => c(`feat(sim): s${n} (#${200 + n})`, "2026-10-06T10:00:00Z");
  const doku = c("docs(adr): Wächter (#102)", "2026-10-06T11:00:00Z");

  test("das Harness-Fenster beginnt 60 s nach dem Abschluss des Sammeltickets und die Label-Menge wird durchgereicht: zwei Spiel-Merges plus ein Harness-Doku-Commit (drei Ticket-Merges) holen nichts", () => {
    const { log, aufrufe } = lauf([spiel(1), spiel(2), doku]);
    expect(aufrufe.harness).toHaveLength(0);
    expect(log.join("\n")).toContain("Fenster ab 2026-10-01T00:01:00.000Z");
    expect(log.join("\n")).toMatch(/1 Harness- auf 2 Spiel-Merges/);
  });

  test("fünf Ticket-Merges jeder Art (vier Spiel, ein Harness-Doku) holen das Sammelticket; die Liste ist nach der Status-Aktion nachgezogen (Status-Ticket vorn)", () => {
    const { r, aufrufe } = lauf([spiel(1), spiel(2), spiel(3), spiel(4), doku], { offeneStatus: true });
    expect(aufrufe.status).toHaveLength(1);
    expect(aufrufe.harness).toHaveLength(1);
    expect(aufrufe.harness[0].items[0].number).toBe(50);
    expect(r.fehler).toBe(false);
  });

  test("der Abschluss-Commit eines Sammeltickets (#100, geschlossen, Sammeltitel) zählt nicht: vier Spiel-Merges plus er holen nichts", () => {
    const abschluss = c("feat(harness): Härtung komplett (#100) (#150)", "2026-10-06T12:00:00Z");
    const { aufrufe } = lauf([spiel(1), spiel(2), spiel(3), spiel(4), abschluss]);
    expect(aufrufe.harness).toHaveLength(0);
  });

  test("auch der Commit eines noch offenen Sammeltickets (Langfuse-Titel, #160) zählt nicht", () => {
    const offen = c("feat(harness): Langfuse-Zeilen (#160) (#161)", "2026-10-06T12:00:00Z");
    expect(lauf([spiel(1), spiel(2), spiel(3), spiel(4), offen], { offeneSammel: true }).aufrufe.harness).toHaveLength(0);
    expect(lauf([spiel(1), spiel(2), spiel(3), spiel(4), offen]).aufrufe.harness).toHaveLength(1); // ohne das offene Sammelticket zählt er mit
  });

  describe("Zählfenster beginnt mit dem Anlegen des jüngsten Status-Tickets (#1628)", () => {
    const fensterLauf = (offenCreatedAt: string | null, vorgaengerCreated: string | null = "2026-10-05T08:00:00Z", commitDaten: string[] = [], ausloeser = "push") => {
      const log: string[] = [];
      const io: Io = {
        ghJson: (a) =>
          a.join(" ").includes("state=closed")
            ? [[{ number: 60, title: STATUS, created_at: vorgaengerCreated, closed_at: "2026-10-06T08:00:00Z" }]]
            : [commitDaten.map((d, i) => ({ sha: `c${i}`, commit: { message: `feat: x (#${100 + i})`, committer: { date: d } }, author: { login: "fluffels", type: "User" } }))],
        loadItems: nurFactory([]),
        loadOpenIssuePages: () => [offenCreatedAt ? [{ number: 70, title: STATUS, created_at: offenCreatedAt, assignees: [] }] : []],
        positionLautAgentsMd: () => 4,
        frischeOffeneIssues: () => [],
        fuehreStatusAus: () => ({ ok: true }),
        fuehreHarnessAus: () => true,
        log: (z) => log.push(z),
      };
      T.fuehreTaktAus({ config: CFG, jetzt: new Date("2026-10-15T12:00:00Z"), dry: true, io, ausloeser });
      return log.join("\n");
    };

    test("ungültiges oder fehlendes created_at: das Fenster fällt auf den Abschluss zurück", () => {
      expect(fensterLauf(null, "kaputt")).toContain("Fenster ab 2026-10-06T08:01:00.000Z");
      expect(fensterLauf(null, null)).toContain("Fenster ab 2026-10-06T08:01:00.000Z");
    });
    test("auch die 5 Commits des Montags-Cron zählen ab dem Anlegen (Commits zwischen Anlegen und Abschluss zählen mit)", () => {
      const commits = Array.from({ length: 5 }, () => "2026-10-05T12:00:00Z");
      expect(fensterLauf(null, "2026-10-05T08:00:00Z", commits, "schedule")).toContain("): anlegen");
      expect(fensterLauf(null, "2026-10-06T08:00:00Z", commits, "schedule")).toContain("): nichts");
    });
    test("Vorgänger angelegt Mo, geschlossen Di: das Fenster beginnt beim Anlegen, nicht beim Abschluss", () => {
      expect(fensterLauf(null)).toContain("Fenster ab 2026-10-05T08:01:00.000Z");
    });
    test("ein offenes Status-Ticket mit jüngerem createdAt gewinnt", () => {
      expect(fensterLauf("2026-10-12T08:00:00Z")).toContain("Fenster ab 2026-10-12T08:01:00.000Z");
    });
    test("ein offenes Ticket mit älterem createdAt verschiebt das Fenster nicht", () => {
      expect(fensterLauf("2026-10-01T08:00:00Z")).toContain("Fenster ab 2026-10-05T08:01:00.000Z");
    });
  });

  test("schlagen die Aktionen fehl (Status ok=false, Harness false), ist der Lauf ein Fehler", () => {
    const mk = (statusOk: boolean, harnessOk: boolean): Io => ({
      ghJson: (a) => (a.join(" ").includes("state=closed") ? [[]] : [[spiel(1), spiel(2), spiel(3), spiel(4), spiel(5)]]),
      loadItems: nurFactory([it(10), it(11), sammel, it(50, { title: STATUS })]),
      loadOpenIssuePages: () => [[{ number: 50, title: STATUS, created_at: "2026-10-02T00:00:00Z", assignees: [] }]],
      positionLautAgentsMd: () => 4,
      fuehreStatusAus: () => ({ ok: statusOk }),
      fuehreHarnessAus: () => harnessOk,
      log: () => undefined,
    });
    const jetzt = new Date("2026-10-08T12:00:00Z");
    expect(T.fuehreTaktAus({ config: CFG, jetzt, token: "t", io: mk(true, true) }).fehler).toBe(false);
    expect(T.fuehreTaktAus({ config: CFG, jetzt, token: "t", io: mk(false, true) }).fehler).toBe(true);
    expect(T.fuehreTaktAus({ config: CFG, jetzt, token: "t", io: mk(true, false) }).fehler).toBe(true);
  });

  describe("Status- und Harness-Takt arbeiten auf der Factory-Liste (#1729)", () => {
    const mk = (produkt: Item[], factory: Item[], gesehen: { status: unknown[]; harness: number }): Io => ({
      ghJson: (a) => (a.join(" ").includes("state=closed") ? [[]] : [[spiel(1), spiel(2), spiel(3), spiel(4), spiel(5)]]),
      loadItems: (rolle) => (rolle === "factory" ? factory : produkt),
      loadOpenIssuePages: () => [[{ number: 50, title: STATUS, created_at: "2026-10-02T00:00:00Z", assignees: [] }]],
      positionLautAgentsMd: () => 4,
      fuehreStatusAus: (_e, ctx) => (gesehen.status.push((ctx as { items: Item[] }).items), { ok: true }),
      fuehreHarnessAus: () => ((gesehen.harness += 1), true),
      log: () => undefined,
    });
    const jetzt = new Date("2026-10-08T12:00:00Z");
    test("ein Sammelticket nur auf dem Produkt-Board löst keine Harness-Aktion aus, auf dem Factory-Board schon", () => {
      const nur = { status: [] as unknown[], harness: 0 };
      T.fuehreTaktAus({ config: CFG, jetzt, token: "t", io: mk([it(10), it(11), sammel], [it(1)], nur) });
      expect(nur.harness).toBe(0);
      const auf = { status: [] as unknown[], harness: 0 };
      T.fuehreTaktAus({ config: CFG, jetzt, token: "t", io: mk([], [it(10), it(11), sammel], auf) });
      expect(auf.harness).toBe(1);
    });
    test("das Status-Ticket bekommt die Factory-Liste, nie die Produkt-Liste", () => {
      const g = { status: [] as unknown[], harness: 0 };
      T.fuehreTaktAus({ config: CFG, jetzt, token: "t", io: mk([it(900)], [it(1), it(2)], g) });
      const listen = g.status as Item[][];
      expect(listen).toHaveLength(1);
      expect(listen[0].map((i) => i.number)).toEqual([1, 2]);
    });
    test("ein Item auf beiden Boards, das laut Trennregel auf das Produkt-Board gehört, zählt nicht in der Factory-Liste", () => {
      const g = { status: [] as unknown[], harness: 0 };
      T.fuehreTaktAus({ config: CFG, jetzt, token: "t", io: mk([it(5)], [it(5), it(6)], g) });
      expect((g.status as Item[][])[0].map((i) => i.number)).toEqual([6]);
    });
  });

  test("--dry-run führt nichts aus", () => {
    const log: string[] = [];
    let gerufen = 0;
    const io: Io = {
      ghJson: (a) => (a.join(" ").includes("state=closed") ? [[]] : [[spiel(1), spiel(2), spiel(3), spiel(4), spiel(5)]]),
      loadItems: nurFactory([it(10), it(11), sammel]),
      loadOpenIssuePages: () => [[]],
      positionLautAgentsMd: () => 4,
      fuehreStatusAus: () => ((gerufen += 1), { ok: true }),
      fuehreHarnessAus: () => ((gerufen += 1), true),
      log: (z) => log.push(z),
    };
    expect(T.fuehreTaktAus({ config: CFG, jetzt: new Date("2026-10-08T12:00:00Z"), dry: true, token: "t", io }).fehler).toBe(false);
    expect(gerufen).toBe(0);
  });

  test("ohne Token entfällt nur der Harness-Teil (Warnung, kein Fehler); ohne Position ist es ein Fehler", () => {
    const basis = {
      ghJson: (a: string[]) => (a.join(" ").includes("state=closed") ? [[]] : [[]]),
      loadItems: nurFactory([]),
      loadOpenIssuePages: () => [[]],
      fuehreStatusAus: () => ({ ok: true }),
      fuehreHarnessAus: () => true,
    };
    const log: string[] = [];
    const ohneToken = T.fuehreTaktAus({ config: CFG, jetzt: new Date("2026-10-08T12:00:00Z"), io: { ...basis, positionLautAgentsMd: () => 4, log: (z: string) => log.push(z) } });
    expect(ohneToken.fehler).toBe(false);
    expect(log.join("\n")).toContain("PROJECT_TOKEN fehlt");
    const ohnePos = T.fuehreTaktAus({
      config: CFG,
      jetzt: new Date("2026-10-08T12:00:00Z"),
      token: "t",
      io: { ...basis, positionLautAgentsMd: () => { throw new Error("keine Position"); }, log: () => undefined },
    });
    expect(ohnePos.fehler).toBe(true);
  });
});

describe("Board-Wächter im Takt-Lauf (#1628)", () => {
  const it = (number: number): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open" });
  const sammel: Item = { ...it(12), title: "Harness-Härtung (gesammelt)" };
  const offen = (...nrn: number[]) => [nrn.map((n) => ({ number: n, title: `T${n}`, created_at: "2026-10-02T00:00:00Z", assignees: [] }))];
  const issue = (n: number, extra: Record<string, unknown> = {}) => ({ number: n, state: "open", node_id: `N${n}`, title: `T${n}`, ...extra });

  function lauf(opts: { offene: number[]; imBoard?: number[]; produkt?: number[]; graphql?: (n: number[]) => ({ number: number } | null)[]; rest?: (n: number) => unknown; add?: () => string; dry?: boolean; token?: string }) {
    const log: string[] = [];
    const zaehler = { graphql: 0, graphqlRollen: [] as string[], add: [] as string[], rollen: [] as string[], harness: [] as Item[][] };
    const io: Io = {
      ghJson: (a) => {
        const m = /issues[/]([0-9]+)$/.exec(a.join(" "));
        if (m) return (opts.rest ?? issue)(Number(m[1]));
        return a.join(" ").includes("state=closed") ? [[]] : [[]];
      },
      loadItems: (rolle) => (rolle === "factory" ? [...(opts.imBoard ?? []).map(it), sammel] : (opts.produkt ?? []).map(it)),
      loadOpenIssuePages: () => offen(...opts.offene),
      positionLautAgentsMd: () => 4,
      fuehreStatusAus: () => ({ ok: true }),
      fuehreHarnessAus: (_h, items) => (zaehler.harness.push(items), true),
      itemsUeberIssues: (rolle, n) => ((zaehler.graphql += 1), zaehler.graphqlRollen.push(rolle), (opts.graphql ?? (() => n.map(() => null)))(n)),
      addToBoardTodo: (rolle, id) => (zaehler.add.push(id), zaehler.rollen.push(rolle), (opts.add ?? (() => `PVTI_${id}`))()),
      log: (z) => log.push(z),
    };
    const r = T.fuehreTaktAus({ config: CFG, jetzt: new Date("2026-10-08T12:00:00Z"), dry: opts.dry, token: "token" in opts ? opts.token : "t", io });
    return { r, log, zaehler };
  }

  test("ein offenes Issue ohne Board-Item wird als Todo aufgenommen, mit Warnung samt Nummer, Lauf bleibt grün", () => {
    const { r, log, zaehler } = lauf({ offene: [10, 11], imBoard: [10] });
    expect(zaehler.add).toEqual(["N11"]);
    expect(log.join("\n")).toMatch(/::warning::Board-Wächter: #11 fehlte im Board, als Todo auf dem produkt-Board aufgenommen/);
    expect(r.fehler).toBe(false);
  });
  test("Fehlalarm der REST-Liste: GraphQL kennt das Item, es wird nicht aufgenommen", () => {
    const { r, zaehler } = lauf({ offene: [10, 11], imBoard: [10], graphql: () => [{ number: 11 }] });
    expect(zaehler.add).toEqual([]);
    expect(r.fehler).toBe(false);
  });
  test("keine Kandidaten: keine GraphQL-Abfrage", () => {
    const { zaehler } = lauf({ offene: [10], imBoard: [10] });
    expect(zaehler.graphql).toBe(0);
    expect(zaehler.add).toEqual([]);
  });
  test("ohne Token (keine Board-Liste) läuft der Wächter nicht", () => {
    const { zaehler } = lauf({ offene: [10, 11], imBoard: [], token: undefined });
    expect(zaehler.graphql).toBe(0);
    expect(zaehler.add).toEqual([]);
  });
  test("--dry-run nimmt nicht auf, meldet es aber", () => {
    const { log, zaehler } = lauf({ offene: [11], imBoard: [], dry: true });
    expect(zaehler.add).toEqual([]);
    expect(log.join("\n")).toMatch(/#11 fehlt im Board, würde als Todo aufgenommen/);
  });
  test("scheitert die Aufnahme, ist der Lauf rot und die Meldung trägt Nummer und Ursache", () => {
    const { r, log } = lauf({ offene: [11], imBoard: [], add: () => { throw new Error("Could not resolve to a node"); } });
    expect(r.fehler).toBe(true);
    expect(log.join("\n")).toMatch(/::error::Board-Wächter: #11 nicht aufgenommen: .*Could not resolve/);
  });
  test("scheitert die GraphQL-Gegenprobe, ist der Lauf rot und nichts wird aufgenommen", () => {
    const { r, zaehler } = lauf({ offene: [11], imBoard: [], graphql: () => { throw new Error("rate limit"); } });
    expect(r.fehler).toBe(true);
    expect(zaehler.add).toEqual([]);
  });
  describe("zwei Boards (#1729)", () => {
    const harnessIssue = (n: number) => issue(n, { labels: [{ name: "area:harness" }] });
    test("ein fehlendes Harness-Issue kommt auf das Factory-Board, ein fehlendes Spiel-Issue auf das Produkt-Board", () => {
      const { zaehler, log } = lauf({ offene: [20, 21], imBoard: [], rest: (n) => (n === 20 ? harnessIssue(n) : issue(n)) });
      expect(zaehler.add).toEqual(["N20", "N21"]);
      expect(zaehler.rollen).toEqual(["factory", "produkt"]);
      expect(log.join("\n")).toMatch(/#20 fehlte im Board, als Todo auf dem factory-Board aufgenommen/);
    });
    test("ein Item, das auf dem Produkt-Board steht, gilt als vorhanden und wird nicht neu aufgenommen", () => {
      const { zaehler, r } = lauf({ offene: [10, 11], imBoard: [10], produkt: [11] });
      expect(zaehler.add).toEqual([]);
      expect(zaehler.graphql).toBe(0);
      expect(r.fehler).toBe(false);
    });
    test("die GraphQL-Gegenprobe fragt beide Boards; kennt nur das Produkt-Board das Item, wird nicht aufgenommen", () => {
      const { zaehler } = lauf({ offene: [11], imBoard: [], graphql: () => [{ number: 11 }] });
      expect(zaehler.graphql).toBe(2);
      expect(zaehler.graphqlRollen).toEqual(["produkt", "factory"]);
      expect(zaehler.add).toEqual([]);
    });
    test("nimmFehlendeAuf trägt ein aufgenommenes Issue nur in die Liste seiner Rolle ein", () => {
      const W = raw as unknown as { nimmFehlendeAuf: (a: unknown, io: unknown) => { listen: { produkt: Item[]; factory: Item[] } } };
      const io = {
        itemsUeberIssues: (_r: string, n: number[]) => n.map(() => null),
        ghJson: (a: string[]) => (a.join(" ").endsWith("/20") ? harnessIssue(20) : issue(21)),
        addToBoardTodo: (_r: string, id: string) => `PVTI_${id}`,
        log: () => undefined,
      };
      const r = W.nimmFehlendeAuf({ offene: [{ number: 20 }, { number: 21 }], listen: { produkt: [], factory: [] }, token: "t", config: CFG }, io);
      expect(r.listen.factory.map((i) => i.number)).toEqual([20]);
      expect(r.listen.produkt.map((i) => i.number)).toEqual([21]);
    });
    test("eine Nummer auf beiden Boards ist eine Warnung (kein Fehler) und zählt nur auf dem Board laut Trennregel", () => {
      const { r, log } = lauf({ offene: [10], imBoard: [10], produkt: [10] });
      expect(log.join("\n")).toMatch(/::warning::Board-Wächter: #10 steht auf beiden Boards/);
      expect(r.fehler).toBe(false);
    });
  });
  test("ein inzwischen geschlossenes Issue wird nicht aufgenommen (Warnung, kein Fehler)", () => {
    const { r, log, zaehler } = lauf({ offene: [11], imBoard: [], rest: (n) => issue(n, { state: "closed" }) });
    expect(zaehler.add).toEqual([]);
    expect(log.join("\n")).toMatch(/#11 fehlt im Board, nicht aufgenommen: Issue ist geschlossen/);
    expect(r.fehler).toBe(false);
  });
});

describe("fuehreHarnessAus: Fehlertext und Rückgabe (#1609)", () => {
  const F = (raw as unknown as {
    fuehreHarnessAus: (h: { nr: number; afterId: string | null }, items: { id: string; number: number }[], token: string, o: { setze: (...a: unknown[]) => void; log: (z: string) => void }) => boolean;
  }).fuehreHarnessAus;
  const items = [{ id: "I7", number: 7 }];
  test("Erfolg: setzt die Position des Items und gibt true zurück", () => {
    const aufrufe: unknown[][] = [];
    const log: string[] = [];
    expect(F({ nr: 7, afterId: "A" }, items, "t", { setze: (...a) => aufrufe.push(a), log: (z) => log.push(z) })).toBe(true);
    expect(aufrufe).toEqual([["I7", "A", { token: "t" }]]);
    expect(log).toEqual(["Sammelticket-Position gesetzt."]);
  });
  test("setze wirft mehrzeilig mit stderr: Log trägt Präfix, stderr und idempotent, Rückgabe false", () => {
    const log: string[] = [];
    const wirf = () => {
      throw Object.assign(new Error("Command failed: gh api graphql\nzweite Zeile"), { stderr: "gh: HTTP 502 Bad Gateway" });
    };
    expect(F({ nr: 7, afterId: null }, items, "t", { setze: wirf, log: (z) => log.push(z) })).toBe(false);
    const text = log.join("\n");
    expect(text).toMatch(/^::error::Sammelticket-Position nicht gesetzt: Command failed: gh api graphql/);
    expect(text).toContain("zweite Zeile");
    expect(text).toContain("gh: HTTP 502 Bad Gateway");
    expect(text).toContain("Die Wiederholung ist idempotent.");
  });
  test("Item fehlt in der Liste: false statt Absturz, kein setze-Aufruf", () => {
    const log: string[] = [];
    let gerufen = false;
    expect(F({ nr: 99, afterId: null }, items, "t", { setze: () => { gerufen = true; }, log: (z) => log.push(z) })).toBe(false);
    expect(gerufen).toBe(false);
    expect(log.join("\n")).toContain("::error::");
  });
});

describe("Gegenprobe vor dem Anlegen des Status-Tickets (#1866)", () => {
  const STATUS = "Langfuse-Status überprüfen";
  // Fünf Commits seit dem Vorgänger: der Cron entscheidet „anlegen“ (kein offenes Status-Ticket in der REST-Liste).
  const lauf = (frisch: Io["frischeOffeneIssues"], dry = false) => {
    const log: string[] = [];
    const angelegt: string[] = [];
    const aufrufe: { repo: string; label: string; anzahl: number }[] = [];
    const commits = Array.from({ length: 5 }, (_, i) => ({ sha: `c${i}`, commit: { message: `feat: x (#${100 + i})`, committer: { date: "2026-10-07T12:00:00Z" } }, author: { login: "fluffels", type: "User" } }));
    const io: Io = {
      ghJson: (a) => (a.join(" ").includes("state=closed") ? [[{ number: 60, title: STATUS, created_at: "2026-10-01T08:00:00Z", closed_at: "2026-10-02T08:00:00Z" }]] : [commits]),
      loadItems: () => [],
      loadOpenIssuePages: () => [[]],
      frischeOffeneIssues: (a) => {
        aufrufe.push(a);
        return frisch ? frisch(a) : [];
      },
      positionLautAgentsMd: () => 4,
      fuehreStatusAus: (e) => (angelegt.push(e.aktion), { ok: true }),
      fuehreHarnessAus: () => true,
      log: (z) => log.push(z),
    };
    const r = T.fuehreTaktAus({ config: CFG, jetzt: new Date("2026-10-12T12:00:00Z"), dry, io });
    return { log: log.join("\n"), angelegt, aufrufe, fehler: r.fehler };
  };

  test("GraphQL kennt noch kein Status-Ticket: es wird angelegt, die Abfrage trägt Repo, Harness-Label und 50", () => {
    const r = lauf(() => []);
    expect(r.angelegt).toEqual(["anlegen"]);
    expect(r.aufrufe).toHaveLength(1);
    expect(r.aufrufe[0]).toMatchObject({ label: "area:harness", anzahl: 50 });
  });
  test("GraphQL kennt ein offenes Status-Ticket, das die REST-Liste noch nicht hat: nichts angelegt, Warnung mit Nummer", () => {
    const r = lauf(() => [{ number: 1865, titel: STATUS }]);
    expect(r.angelegt).toEqual([]);
    expect(r.log).toContain("#1865");
    expect(r.log).toContain("): nichts");
  });
  test("GraphQL wirft: fail-closed, nichts angelegt, der Lauf bleibt grün", () => {
    const r = lauf(() => {
      throw new Error("Rate-Limit");
    });
    expect(r.angelegt).toEqual([]);
    expect(r.log).toContain("Rate-Limit");
    expect(r.fehler).toBe(false);
  });
  test("ohne Anlegen (hier: Montags-Cron mit offenem Status-Ticket, nach-oben) entfällt die Abfrage", () => {
    const log: string[] = [];
    const aufrufe: unknown[] = [];
    const io: Io = {
      ghJson: (a) => (a.join(" ").includes("state=closed") ? [[]] : [[]]),
      loadItems: () => [],
      loadOpenIssuePages: () => [[{ number: 70, title: STATUS, created_at: "2026-10-02T00:00:00Z", assignees: [] }]],
      frischeOffeneIssues: (a) => (aufrufe.push(a), []),
      positionLautAgentsMd: () => 4,
      fuehreStatusAus: () => ({ ok: true }),
      fuehreHarnessAus: () => true,
      log: (z) => log.push(z),
    };
    T.fuehreTaktAus({ config: CFG, jetzt: new Date("2026-10-12T12:00:00Z"), dry: true, io });
    expect(aufrufe).toHaveLength(0);
  });
});
