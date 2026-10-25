/* Lens-Sabotage-Guard (#1349) – die Lens darf per `Edit` nur im eigenen Lens-Worktree ändern.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Verhalten über die öffentliche API (`bewerteLensEdit`, `entscheideHook`) plus die Verdrahtung im Frontmatter der
 * Lens-Definition. Grenzen (Bash-Sabotage, Symlinks) stehen im Kopf des Skripts und sind hier bewusst nicht getestet.
 */
import { describe, expect, test } from "vitest";
import { FREMD, projektConfig } from "../support/fremd-config";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/lens-edit-guard.mjs";

const G = raw as unknown as {
  bewerteLensEdit: (p: unknown, cwd?: string, deps?: { config: unknown }) => { block: boolean; reason?: string };
  entscheideHook: (text: string, deps?: { config: unknown }) => { hookSpecificOutput: { permissionDecision: string } } | null;
};

const W = FREMD.praefixe.worktree;
const DEPS = { config: FREMD };
const LENS = `C:/dev/projekt/.claude/worktrees/${W}1349-lens-r1`;
const FEATURE = `C:/dev/projekt/.claude/worktrees/${W}1349`;

describe("bewerteLensEdit", () => {
  test("Datei im Lens-Worktree: erlaubt, in Slash- und Backslash-Schreibweise und auf POSIX-Pfaden", () => {
    expect(G.bewerteLensEdit(`${LENS}/src/a.ts`, "", DEPS).block).toBe(false);
    expect(G.bewerteLensEdit(`${LENS.replace(/\//g, "\\")}\\src\\a.ts`, "", DEPS).block).toBe(false);
    expect(G.bewerteLensEdit(`/home/x/repo/.claude/worktrees/${W}12-lens-r3/src/a.ts`, "", DEPS).block).toBe(false);
  });

  test("Zusatzpass-Worktrees zählen die Runde weiter (`-lens-r4` bis `-lens-r6`): erlaubt", () => {
    for (const r of [4, 5, 6]) expect(G.bewerteLensEdit(`C:/dev/projekt/.claude/worktrees/${W}1349-lens-r${r}/src/a.ts`, "", DEPS).block, `r${r}`).toBe(false);
  });

  test("Datei im Feature-Worktree, im Hauptrepo oder anderswo: abgelehnt", () => {
    for (const p of [`${FEATURE}/src/a.ts`, "C:/dev/projekt/src/a.ts", "C:/Users/x/Temp/a.ts", `${FEATURE.replace(/\//g, "\\")}\\src\\a.ts`]) {
      const e = G.bewerteLensEdit(p, "", DEPS);
      expect(e.block, p).toBe(true);
      expect(e.reason).toMatch(/Lens-Worktree/);
      // #1748: der Verweis nennt den festen Rollen-Pfad, nicht eine aus dem Agentennamen abgeleitete Datei
      expect(e.reason).toContain(".claude/agents/factory-lens.md");
      expect(e.reason).not.toContain(`${FREMD.agenten.lens}.md`); // alter, aus dem Agentennamen abgeleiteter Dateiname (Rückfall-Wächter)
    }
  });

  test("Ausbruch per `..` aus dem Lens-Worktree in den Feature-Worktree: abgelehnt", () => {
    expect(G.bewerteLensEdit(`${LENS}/../${W}1349/src/a.ts`, "", DEPS).block).toBe(true);
    expect(G.bewerteLensEdit(`${LENS}\\..\\${W}1349\\src\\a.ts`, "", DEPS).block).toBe(true);
    expect(G.bewerteLensEdit(`${LENS}/src/../../../../src/a.ts`, "", DEPS).block).toBe(true);
  });

  test("ähnliche Namen sind keine Lens-Worktrees (ohne Nummer, ohne Runde, falsche Ebene)", () => {
    for (const p of [
      `C:/dev/projekt/.claude/worktrees/${W}lens-r1/a.ts`,
      `C:/dev/projekt/.claude/worktrees/${W}1349-lens/a.ts`,
      `C:/dev/projekt/.claude/worktrees/${W}1349-lens-r1`,
      `C:/dev/projekt/worktrees/${W}1349-lens-r1/a.ts`,
    ]) {
      expect(G.bewerteLensEdit(p, "", DEPS).block, p).toBe(true);
    }
  });

  test("Merge-Delta-Lens `<präfix><nr>-lens-m<n>` ist ein Lens-Worktree, ähnliche Namen nicht", () => {
    expect(G.bewerteLensEdit(`C:/dev/projekt/.claude/worktrees/${W}1496-lens-m1/a.ts`, "", DEPS).block).toBe(false);
    expect(G.bewerteLensEdit(`C:/dev/projekt/.claude/worktrees/${W}1496-lens-m12/a.ts`, "", DEPS).block).toBe(false);
    for (const p of [
      `C:/dev/projekt/.claude/worktrees/${W}1-lens-m/a.ts`,
      `C:/dev/projekt/.claude/worktrees/${W}1-lens-x1/a.ts`,
      `C:/dev/projekt/.claude/worktrees/${W}lens-m1/a.ts`,
    ]) {
      expect(G.bewerteLensEdit(p, "", DEPS).block, p).toBe(true);
    }
  });

  test("Abnahme-Fix-Delta-Lens `<präfix><nr>-lens-a<n>` ist ein Lens-Worktree, ähnliche Namen nicht", () => {
    expect(G.bewerteLensEdit(`C:/dev/projekt/.claude/worktrees/${W}1708-lens-a1/a.ts`, "", DEPS).block).toBe(false);
    expect(G.bewerteLensEdit(`C:/dev/projekt/.claude/worktrees/${W}1708-lens-a12/a.ts`, "", DEPS).block).toBe(false);
    for (const p of [
      `C:/dev/projekt/.claude/worktrees/${W}1708-lens-a/a.ts`,
      `C:/dev/projekt/.claude/worktrees/${W}lens-a1/a.ts`,
      `C:/dev/projekt/.claude/worktrees/${W}1708-lens-b1/a.ts`,
    ]) {
      expect(G.bewerteLensEdit(p, "", DEPS).block, p).toBe(true);
    }
  });

  test("Pfadform ignoriert Groß-/Kleinschreibung (Windows), der Ordnername selbst nicht (Aufräumen)", () => {
    expect(G.bewerteLensEdit(`C:/Dev/X/.Claude/Worktrees/${W.toUpperCase()}1-Lens-R1/a.ts`, "", DEPS).block).toBe(false);
    expect(G.bewerteLensEdit(`C:/Dev/X/.Claude/Worktrees/${W.toUpperCase()}1-Lens-M2/a.ts`, "", DEPS).block).toBe(false);
  });

  test("relativer Pfad wird gegen cwd aufgelöst", () => {
    expect(G.bewerteLensEdit("src/a.ts", LENS, DEPS).block).toBe(false);
    expect(G.bewerteLensEdit("src/a.ts", FEATURE, DEPS).block).toBe(true);
    expect(G.bewerteLensEdit(`../${W}1349/src/a.ts`, LENS, DEPS).block).toBe(true);
  });

  test("fehlender oder leerer Pfad: abgelehnt (fail-closed)", () => {
    for (const p of [undefined, null, "", "   ", 42]) expect(G.bewerteLensEdit(p, "", DEPS).block, String(p)).toBe(true);
  });
});

describe("entscheideHook", () => {
  const payload = (file_path: unknown, tool_name = "Edit") => JSON.stringify({ tool_name, cwd: FEATURE, tool_input: { file_path } });
  test("Feature-Worktree: deny mit hookSpecificOutput; Lens-Worktree: durchgelassen (null)", () => {
    expect(G.entscheideHook(payload(`${FEATURE}/src/a.ts`), DEPS)?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(G.entscheideHook(payload(`${LENS}/src/a.ts`), DEPS)).toBeNull();
  });
  test("Payload ohne file_path: deny; kaputtes JSON und fremdes Tool: durchgelassen", () => {
    expect(G.entscheideHook(payload(undefined), DEPS)?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(G.entscheideHook("{kaputt", DEPS)).toBeNull();
    expect(G.entscheideHook(payload(`${FEATURE}/x`, "Read"), DEPS)).toBeNull();
  });
});

describe("Prozess-Start ohne deps (echter Hook-Pfad, liest die Projekt-Config selbst)", () => {
  const echt = projektConfig().praefixe.worktree;
  const start = (file_path: string): string =>
    execFileSync("node", [fileURLToPath(new URL("../../scripts/lens-edit-guard.mjs", import.meta.url))], {
      input: JSON.stringify({ tool_name: "Edit", cwd: `C:/dev/projekt/.claude/worktrees/${echt}1349`, tool_input: { file_path } }),
      encoding: "utf8",
    });
  test("Lens-Worktree: durchgelassen (leere Ausgabe); Feature-Worktree: deny", () => {
    expect(start(`C:/dev/projekt/.claude/worktrees/${echt}1349-lens-r1/src/a.ts`).trim()).toBe("");
    expect(start(`C:/dev/projekt/.claude/worktrees/${echt}1349/src/a.ts`)).toContain('"deny"');
  });
});

describe("Verdrahtung", () => {
  test("die Lens-Definition startet den Guard als PreToolUse-Hook mit Matcher Edit (und nur dafür)", () => {
    const md = readFileSync(new URL("../../.claude/agents/factory-lens.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const kopf = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? "";
    expect(kopf).toMatch(/hooks:\s*\n\s+PreToolUse:\s*\n\s+- matcher: "Edit"/);
    expect(kopf).toContain("/scripts/lens-edit-guard.mjs");
    expect(kopf).toMatch(/^tools:.*\bEdit\b/m);
  });
});
