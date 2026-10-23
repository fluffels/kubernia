import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/inbox-lib.mjs";
import { FREMD_OWNER } from "./support/fremd-config";

const L = raw as unknown as {
  vertrauteIssues: (s: unknown, owner: string) => { title: string }[];
  offeneTitel: (s: unknown, owner: string) => string[];
  platziereOben: (nr: number, art: string, token?: string) => void;
  sammelticketNummern: (offene: { number: number; titel: string }[]) => number[];
  ladeSammelKontext: (io: { ladeOffene: () => unknown; ladeKommentare: (nr: number) => { user: unknown; body: string; extra?: string }[] }) => { rohe: unknown; offene: { number: number }[]; kommentare: { user: unknown; body: string }[] };
};

const OWNER = FREMD_OWNER;
const issue = (title: string, user: unknown, extra: Record<string, unknown> = {}) => ({ title, user, ...extra });
const bot = { login: "github-actions[bot]", type: "Bot" };

describe("offeneTitel", () => {
  test("Owner und github-actions[bot] zählen, ein Fremder mit gleichem Titel nicht", () => {
    const seiten = [
      [issue("🔒 Security: A", bot), issue("🔒 Security: B", { login: FREMD_OWNER, type: "User" }), issue("🔒 Security: C", { login: "fremd", type: "User" })],
      [issue("🔒 Security: D", null), issue("🔒 Security: E", { login: "github-actions[bot]", type: "User" })],
    ];
    expect(L.offeneTitel(seiten, OWNER)).toEqual(["🔒 Security: A", "🔒 Security: B"]);
  });
  test("PRs fallen weg, auch vertraute", () => {
    expect(L.offeneTitel([[issue("PR", bot, { pull_request: {} })]], OWNER)).toEqual([]);
  });
  test("null-Einträge in den Seiten werden übersprungen, ohne zu werfen", () => {
    expect(L.offeneTitel([[null, issue("🔒 Security: A", bot), undefined]], OWNER)).toEqual(["🔒 Security: A"]);
  });
  test("keine Seitenliste wirft (nie still „keine Titel“)", () => {
    expect(() => L.offeneTitel({}, OWNER)).toThrow();
  });
});

describe("platziereOben", () => {
  test("ohne Token wirft es, bevor etwas startet", () => {
    expect(() => L.platziereOben(1, "security", "")).toThrow(/PROJECT_TOKEN/);
  });
});

describe("sammelticketNummern und ladeSammelKontext (Z3)", () => {
  const T = "Harness-Härtung (gesammelt)";
  test("nur der exakte Titel zählt, auch geclaimte; andere Titel und leere Liste → leer", () => {
    expect(L.sammelticketNummern([{ number: 3, titel: T }, { number: 4, titel: "Langfuse-Befunde (gesammelt)" }, { number: 5, titel: T + " x" }, { number: 9, titel: T }])).toEqual([3, 9]);
    expect(L.sammelticketNummern([])).toEqual([]);
  });
  test("lädt Kommentare nur der Sammeltickets, ungefiltert (user, body), und liefert rohe und normalisierte Seiten", () => {
    const rohe = [[
      { number: 3, title: T, user: bot, assignees: [], created_at: "2026-10-01T00:00:00Z" },
      { number: 4, title: "anderes", user: bot, assignees: [], created_at: "2026-10-01T00:00:00Z" },
    ]];
    const abgefragt: number[] = [];
    const k = L.ladeSammelKontext({
      ladeOffene: () => rohe,
      ladeKommentare: (nr) => {
        abgefragt.push(nr);
        return [{ user: { login: "fremd", type: "User" }, body: "- [ ] x", extra: "fällt weg" }];
      },
    });
    expect(abgefragt).toEqual([3]);
    expect(k.rohe).toBe(rohe);
    expect(k.offene.map((i) => i.number)).toEqual([3, 4]);
    expect(k.kommentare).toEqual([{ user: { login: "fremd", type: "User" }, body: "- [ ] x" }]);
  });
  test("ein werfender Abruf wirft weiter (kein stilles Leer)", () => {
    expect(() => L.ladeSammelKontext({ ladeOffene: () => { throw new Error("gh kaputt"); }, ladeKommentare: () => [] })).toThrow(/gh kaputt/);
  });
});
