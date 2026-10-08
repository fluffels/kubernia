/* Lens-Sabotage-Guard (#1349) – `kubernia-lens` darf per `Edit` nur im eigenen Lens-Worktree ändern.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Verhalten über die öffentliche API (`bewerteLensEdit`, `entscheideHook`) plus die Verdrahtung im Frontmatter der
 * Lens-Definition. Grenzen (Bash-Sabotage, Symlinks) stehen im Kopf des Skripts und sind hier bewusst nicht getestet.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/lens-edit-guard.mjs";

const G = raw as unknown as {
  bewerteLensEdit: (p: unknown, cwd?: string) => { block: boolean; reason?: string };
  entscheideHook: (text: string) => { hookSpecificOutput: { permissionDecision: string } } | null;
};

const LENS = "C:/dev/kubernia/.claude/worktrees/kq-1349-lens-r1";
const FEATURE = "C:/dev/kubernia/.claude/worktrees/kq-1349";

describe("bewerteLensEdit", () => {
  test("Datei im Lens-Worktree: erlaubt, in Slash- und Backslash-Schreibweise und auf POSIX-Pfaden", () => {
    expect(G.bewerteLensEdit(`${LENS}/src/a.ts`).block).toBe(false);
    expect(G.bewerteLensEdit(`${LENS.replace(/\//g, "\\")}\\src\\a.ts`).block).toBe(false);
    expect(G.bewerteLensEdit("/home/x/repo/.claude/worktrees/kq-12-lens-r3/src/a.ts").block).toBe(false);
  });

  test("Datei im Feature-Worktree, im Hauptrepo oder anderswo: abgelehnt", () => {
    for (const p of [`${FEATURE}/src/a.ts`, "C:/dev/kubernia/src/a.ts", "C:/Users/x/Temp/a.ts", `${FEATURE.replace(/\//g, "\\")}\\src\\a.ts`]) {
      const e = G.bewerteLensEdit(p);
      expect(e.block, p).toBe(true);
      expect(e.reason).toMatch(/Lens-Worktree/);
    }
  });

  test("Ausbruch per `..` aus dem Lens-Worktree in den Feature-Worktree: abgelehnt", () => {
    expect(G.bewerteLensEdit(`${LENS}/../kq-1349/src/a.ts`).block).toBe(true);
    expect(G.bewerteLensEdit(`${LENS}\\..\\kq-1349\\src\\a.ts`).block).toBe(true);
    expect(G.bewerteLensEdit(`${LENS}/src/../../../../src/a.ts`).block).toBe(true);
  });

  test("ähnliche Namen sind keine Lens-Worktrees (ohne Nummer, ohne Runde, falsche Ebene)", () => {
    for (const p of [
      "C:/dev/kubernia/.claude/worktrees/kq-lens-r1/a.ts",
      "C:/dev/kubernia/.claude/worktrees/kq-1349-lens/a.ts",
      "C:/dev/kubernia/.claude/worktrees/kq-1349-lens-r1",
      "C:/dev/kubernia/worktrees/kq-1349-lens-r1/a.ts",
    ]) {
      expect(G.bewerteLensEdit(p).block, p).toBe(true);
    }
  });

  test("Merge-Delta-Lens `kq-<nr>-lens-m<n>` ist ein Lens-Worktree, ähnliche Namen nicht", () => {
    expect(G.bewerteLensEdit("C:/dev/kubernia/.claude/worktrees/kq-1496-lens-m1/a.ts").block).toBe(false);
    expect(G.bewerteLensEdit("C:/dev/kubernia/.claude/worktrees/kq-1496-lens-m12/a.ts").block).toBe(false);
    for (const p of [
      "C:/dev/kubernia/.claude/worktrees/kq-1-lens-m/a.ts",
      "C:/dev/kubernia/.claude/worktrees/kq-1-lens-x1/a.ts",
      "C:/dev/kubernia/.claude/worktrees/kq-lens-m1/a.ts",
    ]) {
      expect(G.bewerteLensEdit(p).block, p).toBe(true);
    }
  });

  test("Pfadform ignoriert Groß-/Kleinschreibung (Windows), der Ordnername selbst nicht (Aufräumen)", () => {
    expect(G.bewerteLensEdit("C:/Dev/X/.Claude/Worktrees/KQ-1-Lens-R1/a.ts").block).toBe(false);
    expect(G.bewerteLensEdit("C:/Dev/X/.Claude/Worktrees/KQ-1-Lens-M2/a.ts").block).toBe(false);
  });

  test("relativer Pfad wird gegen cwd aufgelöst", () => {
    expect(G.bewerteLensEdit("src/a.ts", LENS).block).toBe(false);
    expect(G.bewerteLensEdit("src/a.ts", FEATURE).block).toBe(true);
    expect(G.bewerteLensEdit("../kq-1349/src/a.ts", LENS).block).toBe(true);
  });

  test("fehlender oder leerer Pfad: abgelehnt (fail-closed)", () => {
    for (const p of [undefined, null, "", "   ", 42]) expect(G.bewerteLensEdit(p).block, String(p)).toBe(true);
  });
});

describe("entscheideHook", () => {
  const payload = (file_path: unknown, tool_name = "Edit") => JSON.stringify({ tool_name, cwd: FEATURE, tool_input: { file_path } });
  test("Feature-Worktree: deny mit hookSpecificOutput; Lens-Worktree: durchgelassen (null)", () => {
    expect(G.entscheideHook(payload(`${FEATURE}/src/a.ts`))?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(G.entscheideHook(payload(`${LENS}/src/a.ts`))).toBeNull();
  });
  test("Payload ohne file_path: deny; kaputtes JSON und fremdes Tool: durchgelassen", () => {
    expect(G.entscheideHook(payload(undefined))?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(G.entscheideHook("{kaputt")).toBeNull();
    expect(G.entscheideHook(payload(`${FEATURE}/x`, "Read"))).toBeNull();
  });
});

describe("Verdrahtung", () => {
  test("die Lens-Definition startet den Guard als PreToolUse-Hook mit Matcher Edit (und nur dafür)", () => {
    const md = readFileSync(new URL("../../.claude/agents/kubernia-lens.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const kopf = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? "";
    expect(kopf).toMatch(/hooks:\s*\n\s+PreToolUse:\s*\n\s+- matcher: "Edit"/);
    expect(kopf).toContain("/scripts/lens-edit-guard.mjs");
    expect(kopf).toMatch(/^tools:.*\bEdit\b/m);
  });
});
