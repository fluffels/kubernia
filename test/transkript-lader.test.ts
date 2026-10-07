/* Gemeinsamer Session-Lader (#1392 Z29), kubernia-Erkennung (Z30) und Generator-Lader (Z31) für die Transkript-Skripte.
 * Läuft gegen ein Fixture-Root (test/support/tmp-fixture); synthetische Zeilen, kein Zugriff auf ~/.claude. */
import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTranskript from "../scripts/transkript.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawHc from "../scripts/hauptchat-zerlegung.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBase from "../scripts/token-baseline.mjs";

type Zeilen = Record<string, unknown>[];
type Sitzung = { id: string; main: Zeilen; subagents: { datei: string; meta: Record<string, unknown>; zeilen: Zeilen }[] };
const T = rawTranskript as unknown as { ladeSessionDatei: (pfad: string) => Sitzung };
const HC = rawHc as unknown as {
  istKubernia: (meta: Record<string, unknown> | undefined) => boolean;
  ladeSessions: (dir: string, von?: string) => Generator<Sitzung>;
  zerlegeHauptchat: (e: { sessions: Iterable<Sitzung> }) => { rows: { kategorie: string; quelle: string; calls: number }[]; kubernia: { calls: number } };
};
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
      "p/s1/subagents/agent-1.meta.json": JSON.stringify({ agentType: "kubernia-planner", description: "Plan" }),
    });
    const s = T.ladeSessionDatei(join(root, "p/s1.jsonl"));
    expect(s.id).toBe("s1");
    expect(s.main).toHaveLength(1);
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0]).toMatchObject({ datei: "agent-1.jsonl", meta: { agentType: "kubernia-planner" } });
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
      "projekte/proj/s1/subagents/agent-1.meta.json": JSON.stringify({ agentType: "kubernia-lens" }),
    });
    const r = BASE.readTranscriptSession("s1", join(root, "projekte"));
    expect(r.calls).toHaveLength(2);
    expect(r.calls.filter((c) => c.subagent?.agentType === "kubernia-lens")).toHaveLength(1);
    expect(() => BASE.readTranscriptSession("gibtsnicht", join(root, "projekte"))).toThrow(/Kein Transkript/);
  });
});

describe("istKubernia (#1392 Z30)", () => {
  test("nur agentType mit Präfix kubernia- oder ein verschachtelter Agent", () => {
    expect(HC.istKubernia({ agentType: "kubernia-planner" })).toBe(true);
    expect(HC.istKubernia({ agentType: "kubernia-umsetzer" })).toBe(true);
    expect(HC.istKubernia({ agentType: "general-purpose", parentAgentId: "x" })).toBe(true);
  });

  test("general-purpose mit Beschreibung „Review des Plans“ ist ein Fork (die alte Beschreibungsheuristik zählte ihn als kubernia)", () => {
    expect(HC.istKubernia({ agentType: "general-purpose", description: "Review des Plans" })).toBe(false);
    expect(HC.istKubernia({ agentType: "general-purpose", description: "Lens R1" })).toBe(false);
  });

  test("Explore aus dem Hauptchat, fehlendes Meta und ähnliche Typnamen sind keine kubernia-Subagenten", () => {
    expect(HC.istKubernia({ agentType: "Explore" })).toBe(false);
    expect(HC.istKubernia({ agentType: "my-kubernia-x" })).toBe(false);
    expect(HC.istKubernia({})).toBe(false);
    expect(HC.istKubernia(undefined)).toBe(false);
  });
});

describe("ladeSessions als Generator (#1392 Z31)", () => {
  const root = () =>
    fixture({
      "d/s1.jsonl": `${call(1, "a")}\n`,
      "d/s2.jsonl": `${call(2, "b")}\n`,
      "d/s2/subagents/x.jsonl": `${call(3, "c")}\n`,
      "d/s2/subagents/x.meta.json": JSON.stringify({ agentType: "kubernia-lens" }),
      "d/readme.txt": "x",
    });

  test("liefert die Sessions einzeln und lazy (kein Array)", () => {
    const gen = HC.ladeSessions(join(root(), "d"));
    expect(typeof gen.next).toBe("function");
    expect(Array.isArray(gen)).toBe(false);
    const erste = gen.next();
    expect(erste.done).toBe(false);
    expect(erste.value.id).toBe("s1");
    expect(gen.next().value?.id).toBe("s2");
    expect(gen.next().done).toBe(true);
  });

  test("ein einmal iterierbarer Generator liefert dasselbe Ergebnis wie ein Array", () => {
    const dir = join(root(), "d");
    const ausGenerator = HC.zerlegeHauptchat({ sessions: HC.ladeSessions(dir) });
    const ausArray = HC.zerlegeHauptchat({ sessions: [...HC.ladeSessions(dir)] });
    expect(ausGenerator).toEqual(ausArray);
    expect(ausGenerator.kubernia.calls).toBe(1);
    expect(ausGenerator.rows.reduce((s, r) => s + r.calls, 0)).toBe(2);
  });
});
