import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/inbox-lib.mjs";

const L = raw as unknown as {
  vertrauteIssues: (s: unknown, owner: string) => { title: string }[];
  offeneTitel: (s: unknown, owner: string) => string[];
  platziereOben: (nr: number, art: string, token?: string) => void;
};

const OWNER = "fluffels";
const issue = (title: string, user: unknown, extra: Record<string, unknown> = {}) => ({ title, user, ...extra });
const bot = { login: "github-actions[bot]", type: "Bot" };

describe("offeneTitel", () => {
  test("Owner und github-actions[bot] zählen, ein Fremder mit gleichem Titel nicht", () => {
    const seiten = [
      [issue("🔒 Security: A", bot), issue("🔒 Security: B", { login: "fluffels", type: "User" }), issue("🔒 Security: C", { login: "fremd", type: "User" })],
      [issue("🔒 Security: D", null), issue("🔒 Security: E", { login: "github-actions[bot]", type: "User" })],
    ];
    expect(L.offeneTitel(seiten, OWNER)).toEqual(["🔒 Security: A", "🔒 Security: B"]);
  });
  test("PRs fallen weg, auch vertraute", () => {
    expect(L.offeneTitel([[issue("PR", bot, { pull_request: {} })]], OWNER)).toEqual([]);
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
