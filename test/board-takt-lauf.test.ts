/* Spielquote nach Issue-Label (#1428 Z22) und die Verdrahtung des Takt-Laufs mit Fakes (#1428 Z23): `fuehreTaktAus` nimmt seine I/O
 * injiziert, die Tests prüfen Fenster, Label-Menge und Listen-Nachzug ohne Netz. Technik wie test/board-takt.test.ts. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-takt.mjs";

type Item = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
type Io = {
  ghJson: (args: string[]) => unknown;
  loadItems: (o: { token: string }) => Item[];
  loadOpenIssuePages: (repo: string) => unknown[];
  positionLautAgentsMd: () => number;
  fuehreStatusAus: (e: { aktion: string; nr?: number }, ctx: unknown) => { ok: boolean; nr?: number; itemId?: string };
  fuehreHarnessAus: (h: { aktion: string; nr?: number }, items: Item[], token: string) => boolean;
  log: (z: string) => void;
};
const T = raw as unknown as {
  istHarnessCommit: (c: unknown, h?: Set<number> | null) => boolean;
  zaehleSpielMerges: (c: unknown[], seit?: string | null, h?: Set<number> | null) => number;
  quotenBericht: (c: unknown[], seit?: string | null, h?: Set<number> | null) => { harness: number; spiel: number };
  harnessTaktAusCommits: (a: { items: Item[]; commits: unknown[]; seit?: string | null; position: number; harnessIssues?: Set<number> | null }) => { aktion: string };
  fuehreTaktAus: (a: { jetzt: Date; dry?: boolean; repo?: string; ausloeser?: string; token?: string; io: Io }) => { fehler: boolean };
};

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

  function lauf(commits: unknown[], opts: { offeneStatus?: boolean } = {}) {
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
      loadItems: () => [it(10), it(11), sammel, it(50, { title: STATUS })],
      loadOpenIssuePages: () => [opts.offeneStatus ? [{ number: 50, title: STATUS, created_at: "2026-10-02T00:00:00Z", assignees: [] }] : []],
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
    const r = T.fuehreTaktAus({ jetzt: new Date("2026-10-08T12:00:00Z"), token: "t", io });
    return { r, log, aufrufe };
  }

  const spiel = (n: number) => c(`feat(sim): s${n} (#${200 + n})`, "2026-10-06T10:00:00Z");
  const doku = c("docs(adr): Wächter (#102)", "2026-10-06T11:00:00Z");

  test("das Harness-Fenster beginnt 60 s nach dem Abschluss des Sammeltickets und die Label-Menge wird durchgereicht: zwei Spiel-Merges plus ein Harness-Doku-Commit holen nichts", () => {
    const { log, aufrufe } = lauf([spiel(1), spiel(2), doku]);
    expect(aufrufe.harness).toHaveLength(0);
    expect(log.join("\n")).toContain("Fenster ab 2026-10-01T00:01:00.000Z");
    expect(log.join("\n")).toMatch(/1 Harness- auf 2 Spiel-Merges/);
  });

  test("drei Spiel-Merges holen das Sammelticket; die Liste ist nach der Status-Aktion nachgezogen (Status-Ticket vorn)", () => {
    const { r, aufrufe } = lauf([spiel(1), spiel(2), spiel(3), doku], { offeneStatus: true });
    expect(aufrufe.status).toHaveLength(1);
    expect(aufrufe.harness).toHaveLength(1);
    expect(aufrufe.harness[0].items[0].number).toBe(50);
    expect(r.fehler).toBe(false);
  });

  test("--dry-run führt nichts aus", () => {
    const log: string[] = [];
    let gerufen = 0;
    const io: Io = {
      ghJson: (a) => (a.join(" ").includes("state=closed") ? [[]] : [[spiel(1), spiel(2), spiel(3)]]),
      loadItems: () => [it(10), it(11), sammel],
      loadOpenIssuePages: () => [[]],
      positionLautAgentsMd: () => 4,
      fuehreStatusAus: () => ((gerufen += 1), { ok: true }),
      fuehreHarnessAus: () => ((gerufen += 1), true),
      log: (z) => log.push(z),
    };
    expect(T.fuehreTaktAus({ jetzt: new Date("2026-10-08T12:00:00Z"), dry: true, token: "t", io }).fehler).toBe(false);
    expect(gerufen).toBe(0);
  });

  test("ohne Token entfällt nur der Harness-Teil (Warnung, kein Fehler); ohne Position ist es ein Fehler", () => {
    const basis = {
      ghJson: (a: string[]) => (a.join(" ").includes("state=closed") ? [[]] : [[]]),
      loadItems: () => [],
      loadOpenIssuePages: () => [[]],
      fuehreStatusAus: () => ({ ok: true }),
      fuehreHarnessAus: () => true,
    };
    const log: string[] = [];
    const ohneToken = T.fuehreTaktAus({ jetzt: new Date("2026-10-08T12:00:00Z"), io: { ...basis, positionLautAgentsMd: () => 4, log: (z: string) => log.push(z) } });
    expect(ohneToken.fehler).toBe(false);
    expect(log.join("\n")).toContain("PROJECT_TOKEN fehlt");
    const ohnePos = T.fuehreTaktAus({
      jetzt: new Date("2026-10-08T12:00:00Z"),
      token: "t",
      io: { ...basis, positionLautAgentsMd: () => { throw new Error("keine Position"); }, log: () => undefined },
    });
    expect(ohnePos.fehler).toBe(true);
  });
});
