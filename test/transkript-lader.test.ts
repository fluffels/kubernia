/* Gemeinsamer Session-Lader (#1392 Z29), Ticketlauf-Erkennung (Z30) und Generator-Lader (Z31) für die Transkript-Skripte.
 * Läuft gegen ein Fixture-Root (test/support/tmp-fixture); synthetische Zeilen, kein Zugriff auf ~/.claude. */
import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { fixture } from "./support/tmp-fixture";
import { FREMD, repoName } from "./support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTranskript from "../scripts/transkript.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawHc from "../scripts/hauptchat-zerlegung.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBase from "../scripts/token-baseline.mjs";

type Zeilen = Record<string, unknown>[];
type Sitzung = { id: string; main: Zeilen; subagents: { datei: string; meta: Record<string, unknown>; zeilen: Zeilen }[] };
const T = rawTranskript as unknown as { ladeSessionDatei: (pfad: string) => Sitzung; ladeSessions: (dir: string, von?: string) => Generator<Sitzung> };
const HC = rawHc as unknown as {
  istTicketLauf: (meta: Record<string, unknown> | undefined, ticketAgenten: Set<string>) => boolean;
  hauptchatNamen: (deps: { config: unknown }) => { ticketAgenten: Set<string> };
  zerlegeHauptchat: (e: { sessions: Iterable<Sitzung>; config: unknown }) => { rows: { kategorie: string; quelle: string; calls: number }[] } & Record<string, { calls: number }>;
};
const { planer: PLANER, umsetzer: UMSETZER, lens: LENS, gruppe: GRUPPE } = FREMD.agenten;
const AGENTEN = HC.hauptchatNamen({ config: FREMD }).ticketAgenten;
const istTicketLauf = (meta: Record<string, unknown> | undefined) => HC.istTicketLauf(meta, AGENTEN);
const BASE = rawBase as unknown as { readTranscriptSession: (id: string, root: string) => { calls: { subagent?: { agentType?: string } }[]; questions: number } };

const zeile = (o: Record<string, unknown>) => JSON.stringify(o);
const call = (min: number, id: string) =>
  zeile({
    type: "assistant",
    timestamp: new Date(Date.UTC(2026, 9, 5, 10, min)).toISOString(),
    uuid: id,
    message: { id, role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 0, output_tokens: 10 }, content: [{ type: "text", text: "x" }] },
  });

describe("ladeSessionDatei (#1392 Z29)", () => {
  test("Hauptzeilen, Subagenten mit Meta; eine abgeschnittene letzte Zeile entfällt", () => {
    const root = fixture({
      "p/s1.jsonl": `${call(1, "a")}\n{"abgeschnitten`,
      "p/s1/subagents/agent-1.jsonl": `${call(2, "b")}\n`,
      "p/s1/subagents/agent-1.meta.json": JSON.stringify({ agentType: PLANER, description: "Plan" }),
    });
    const s = T.ladeSessionDatei(join(root, "p/s1.jsonl"));
    expect(s.id).toBe("s1");
    expect(s.main).toHaveLength(1);
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0]).toMatchObject({ datei: "agent-1.jsonl", meta: { agentType: PLANER } });
    expect(s.subagents[0].zeilen).toHaveLength(1);
  });

  test("fehlendes oder kaputtes Meta ergibt {} (der Subagent bleibt lesbar)", () => {
    const root = fixture({
      "p/s1.jsonl": `${call(1, "a")}\n`,
      "p/s1/subagents/ohne.jsonl": `${call(2, "b")}\n`,
      "p/s1/subagents/kaputt.jsonl": `${call(3, "c")}\n`,
      "p/s1/subagents/kaputt.meta.json": "{nicht json",
    });
    const s = T.ladeSessionDatei(join(root, "p/s1.jsonl"));
    expect(s.subagents.map((x) => [x.datei, x.meta])).toEqual([
      ["kaputt.jsonl", {}],
      ["ohne.jsonl", {}],
    ]);
  });

  test("ohne Subagenten-Ordner: leere Liste; andere Dateien im Ordner werden ignoriert", () => {
    const root = fixture({ "p/s1.jsonl": `${call(1, "a")}\n`, "p/s1/subagents/notiz.txt": "x" });
    expect(T.ladeSessionDatei(join(root, "p/s1.jsonl")).subagents).toEqual([]);
    const ohne = fixture({ "p/s2.jsonl": `${call(1, "a")}\n` });
    expect(T.ladeSessionDatei(join(ohne, "p/s2.jsonl")).subagents).toEqual([]);
  });

  test("token-baseline.readTranscriptSession nutzt denselben Lader: Haupt- und Subagenten-Calls, Subagent-Meta", () => {
    const root = fixture({
      "projekte/proj/s1.jsonl": `${call(1, "a")}\n`,
      "projekte/proj/s1/subagents/agent-1.jsonl": `${call(2, "b")}\n`,
      "projekte/proj/s1/subagents/agent-1.meta.json": JSON.stringify({ agentType: LENS }),
    });
    const r = BASE.readTranscriptSession("s1", join(root, "projekte"));
    expect(r.calls).toHaveLength(2);
    expect(r.calls.filter((c) => c.subagent?.agentType === LENS)).toHaveLength(1);
    expect(() => BASE.readTranscriptSession("gibtsnicht", join(root, "projekte"))).toThrow(/Kein Transkript/);
  });
});

describe("istTicketLauf (#1392 Z30)", () => {
  test("nur agentType aus den Agenten der Projekt-Config (Planer, Umsetzer, Lens, Gruppe) oder ein verschachtelter Agent", () => {
    expect(istTicketLauf({ agentType: PLANER })).toBe(true);
    expect(istTicketLauf({ agentType: UMSETZER })).toBe(true);
    expect(istTicketLauf({ agentType: LENS })).toBe(true);
    expect(istTicketLauf({ agentType: GRUPPE })).toBe(true);
    expect(istTicketLauf({ agentType: "general-purpose", parentAgentId: "x" })).toBe(true);
  });

  test("ein Name mit dem Präfix, aber ohne Eintrag in der Config, ist kein Ticketlauf (Menge statt Präfix)", () => {
    expect(istTicketLauf({ agentType: `${LENS}-unbekannt` })).toBe(false);
    expect(HC.istTicketLauf({ agentType: "acme-lens" }, new Set(["acme-lens"]))).toBe(true);
    expect(HC.istTicketLauf({ agentType: LENS }, new Set(["acme-lens"]))).toBe(false);
  });

  test("general-purpose mit Beschreibung „Review des Plans“ ist ein Fork (die alte Beschreibungsheuristik zählte ihn als Ticketlauf)", () => {
    expect(istTicketLauf({ agentType: "general-purpose", description: "Review des Plans" })).toBe(false);
    expect(istTicketLauf({ agentType: "general-purpose", description: "Lens R1" })).toBe(false);
  });

  test("Explore aus dem Hauptchat, fehlendes Meta und ähnliche Typnamen sind keine Ticketlauf-Subagenten", () => {
    expect(istTicketLauf({ agentType: "Explore" })).toBe(false);
    expect(istTicketLauf({ agentType: `my-${LENS}` })).toBe(false);
    expect(istTicketLauf({})).toBe(false);
    expect(istTicketLauf(undefined)).toBe(false);
  });
});

describe("ladeSessions als Generator (#1392 Z31)", () => {
  const root = () =>
    fixture({
      "d/s1.jsonl": `${call(1, "a")}\n`,
      "d/s2.jsonl": `${call(2, "b")}\n`,
      "d/s2/subagents/x.jsonl": `${call(3, "c")}\n`,
      "d/s2/subagents/x.meta.json": JSON.stringify({ agentType: LENS }),
      "d/readme.txt": "x",
    });

  test("liefert die Sessions einzeln und lazy (kein Array)", () => {
    const gen = T.ladeSessions(join(root(), "d"));
    expect(typeof gen.next).toBe("function");
    expect(Array.isArray(gen)).toBe(false);
    const erste = gen.next();
    expect(erste.done).toBe(false);
    expect((erste.value as Sitzung).id).toBe("s1");
    expect((gen.next().value as Sitzung).id).toBe("s2");
    expect(gen.next().done).toBe(true);
  });

  test("ein einmal iterierbarer Generator liefert dasselbe Ergebnis wie ein Array", () => {
    const dir = join(root(), "d");
    const config = FREMD;
    const ausGenerator = HC.zerlegeHauptchat({ sessions: T.ladeSessions(dir), config });
    const ausArray = HC.zerlegeHauptchat({ sessions: [...T.ladeSessions(dir)], config });
    expect(ausGenerator).toEqual(ausArray);
    expect(ausGenerator[repoName(FREMD)].calls).toBe(1);
    expect(ausGenerator.rows.reduce((s, r) => s + r.calls, 0)).toBe(2);
  });
});

describe("Projektordner-Ableitung (#1572, eine Quelle für alle Messskripte)", () => {
  const P = rawTranskript as unknown as { projektSlug: (p: string) => string; istProjektOrdner: (n: string, s: string) => boolean };
  test("projektSlug: Windows und POSIX, Worktree-Pfad zählt als Hauptrepo, abschließender Schrägstrich entfällt", () => {
    expect(P.projektSlug("X:\\dev\\repo")).toBe("X--dev-repo");
    expect(P.projektSlug("/home/x/repo")).toBe("-home-x-repo");
    expect(P.projektSlug("X:\\dev\\repo\\.claude\\worktrees\\wt-1")).toBe("X--dev-repo");
    expect(P.projektSlug("/home/x/repo/.claude/worktrees/wt-1/scripts")).toBe("-home-x-repo");
    expect(P.projektSlug("X:/dev/repo/")).toBe("X--dev-repo");
  });
  const O = rawTranskript as unknown as { projekteWurzel: () => string; projektOrdner: (s?: string | null) => string; hauptrepoWurzel: () => string | null };
  test("projekteWurzel und projektOrdner: Wurzel unter ~/.claude/projects, Slug-Override, sonst Hauptrepo bzw. cwd", () => {
    expect(O.projekteWurzel()).toBe(join(homedir(), ".claude", "projects"));
    expect(O.projektOrdner("X--dev-repo")).toBe(join(O.projekteWurzel(), "X--dev-repo"));
    const erwartet = join(O.projekteWurzel(), P.projektSlug(O.hauptrepoWurzel() ?? process.cwd()));
    expect(O.projektOrdner()).toBe(erwartet);
    expect(O.projektOrdner(null)).toBe(erwartet);
  });
  test("istProjektOrdner: exakter Ordner und Worktree-Ordner ja, Geschwister-Repos mit gleichem Präfix nein", () => {
    expect(P.istProjektOrdner("X--dev-repo", "X--dev-repo")).toBe(true);
    expect(P.istProjektOrdner("X--dev-repo--claude-worktrees-wt-1", "X--dev-repo")).toBe(true);
    expect(P.istProjektOrdner("X--dev-repo-alt", "X--dev-repo")).toBe(false);
    expect(P.istProjektOrdner("X--dev-repo2", "X--dev-repo")).toBe(false);
    expect(P.istProjektOrdner("X--dev", "X--dev-repo")).toBe(false);
  });
});
