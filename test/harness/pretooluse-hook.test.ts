/* PreToolUse-Dispatcher (#1311) — ein Node-Prozess je Tool-Aufruf für Worktree-Guard, PowerShell-Guard und gh-Guard.
 *
 * @harness-waechter – einziger Durchsetzer der Verdrahtung (Settings, geschützte Pfade, Routing), darum im geschützten test/harness/.
 *
 * Geprüft wird das Verhalten über die öffentliche API `dispatch` (Routing, deny vor ask, Fehlerisolation) und über den
 * echten CLI-Start (Spawn); dazu die Verdrahtung in `.claude/settings.json` und die geschützten Pfade.
 *
 * Ausführen mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/pretooluse-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as ioRaw from "../../scripts/hook-io.mjs";

type Out = { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } } | null;
const io = ioRaw as unknown as { mergeDecisions: (d: unknown[]) => Out };
const hook = raw as unknown as { dispatch: (text: string, repoRoot: string, guards?: Record<string, (o: never) => unknown>) => Out };

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lies = (rel: string) => readFileSync(resolve(WURZEL, rel), "utf8");
const payload = (tool: string, command: string, cwd = WURZEL) => JSON.stringify({ tool_name: tool, cwd, tool_input: { command } });

describe("Routing und Entscheidung (#1311)", () => {
  test("gh api -X DELETE fragt (Bash und PowerShell), Alltag läuft durch", () => {
    for (const tool of ["Bash", "PowerShell"]) {
      assert.equal(hook.dispatch(payload(tool, "gh api -X DELETE repos/o/r/issues/1"), WURZEL)?.hookSpecificOutput.permissionDecision, "ask", tool);
      assert.equal(hook.dispatch(payload(tool, "gh issue list"), WURZEL), null, tool);
    }
  });

  test("fremde Tools und kaputtes JSON ergeben keine Ausgabe", () => {
    assert.equal(hook.dispatch(payload("Read", "gh api -X DELETE x"), WURZEL), null);
    assert.equal(hook.dispatch("{kaputt", WURZEL), null);
    assert.equal(hook.dispatch("", WURZEL), null);
  });

  test("Routing: Bash geht an den Bash-Guard, PowerShell an den PowerShell-Guard (Attrappen)", () => {
    const blockt = () => ({ block: true, reason: "x" });
    const nichts = () => ({ block: false });
    const nurBash = { decide: blockt, bewertePowerShell: nichts, bewerteGh: nichts };
    const nurPs = { decide: nichts, bewertePowerShell: blockt, bewerteGh: nichts };
    assert.equal(hook.dispatch(payload("Bash", "x"), WURZEL, nurBash)?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(hook.dispatch(payload("PowerShell", "x"), WURZEL, nurBash), null);
    assert.equal(hook.dispatch(payload("PowerShell", "x"), WURZEL, nurPs)?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(hook.dispatch(payload("Bash", "x"), WURZEL, nurPs), null);
  });

  test("mergeDecisions: deny vor ask, unabhängig von der Reihenfolge", () => {
    assert.equal(io.mergeDecisions([{ ask: true, reason: "a" }, { block: true, reason: "d" }])?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(io.mergeDecisions([{ block: true, reason: "d" }, { ask: true, reason: "a" }])?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(io.mergeDecisions([{ block: false }, { ask: true, reason: "a" }])?.hookSpecificOutput.permissionDecision, "ask");
    assert.equal(io.mergeDecisions([null, { block: false }]), null);
  });

  test("deny geht vor ask: ein Haupt-Checkout-Commit samt gh-Frage ergibt deny", () => {
    const haupt = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: WURZEL, encoding: "utf8" }).trim();
    const mainDir = resolve(WURZEL, haupt, "..");
    const out = hook.dispatch(payload("Bash", "gh api -X DELETE repos/o/r/issues/1; git commit -m x", mainDir), WURZEL);
    assert.equal(out?.hookSpecificOutput.permissionDecision, "deny");
  });
});

describe("Prozess-Start (#1311)", () => {
  const start = (skript: string, eingabe: string) => execFileSync("node", [resolve(WURZEL, "scripts", skript)], { input: eingabe, encoding: "utf8", cwd: WURZEL });

  test("der Dispatcher gibt bei gh api -X DELETE ein ask-JSON aus, bei kaputtem JSON nichts", () => {
    const out = JSON.parse(start("pretooluse-hook.mjs", payload("Bash", "gh api -X DELETE repos/o/r/issues/1"))) as Out;
    assert.equal(out?.hookSpecificOutput.permissionDecision, "ask");
    assert.equal(start("pretooluse-hook.mjs", "{kaputt").trim(), "");
    assert.equal(start("pretooluse-hook.mjs", payload("Bash", "ls")).trim(), "");
  });

  test("die drei Direktaufrufe bleiben lauffähig (laufende Sessions behalten ihre alte Hook-Konfiguration)", () => {
    const ask = JSON.parse(start("gh-guard-hook.mjs", payload("Bash", "gh api -X DELETE repos/o/r/issues/1"))) as Out;
    assert.equal(ask?.hookSpecificOutput.permissionDecision, "ask");
    assert.equal(start("worktree-guard-hook.mjs", payload("Bash", "ls")).trim(), "");
    assert.equal(start("worktree-guard-powershell.mjs", payload("PowerShell", "ls")).trim(), "");
    // deny-Payload je Direktaufruf (ein toter main() ergäbe auch bei "ls" eine leere Ausgabe)
    const mainDir = resolve(WURZEL, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: WURZEL, encoding: "utf8" }).trim(), "..");
    const deny = (skript: string, tool: string) => (JSON.parse(start(skript, payload(tool, "git commit -m x", mainDir))) as Out)?.hookSpecificOutput.permissionDecision;
    assert.equal(deny("worktree-guard-hook.mjs", "Bash"), "deny");
    assert.equal(deny("worktree-guard-powershell.mjs", "PowerShell"), "deny");
  });
});

describe("Verdrahtung (#1311)", () => {
  type Settings = { hooks: { PreToolUse: { matcher: string; hooks: { args?: string[] }[] }[] } };
  const settings = JSON.parse(lies(".claude/settings.json")) as Settings;
  const gilt = (tool: string) => settings.hooks.PreToolUse.filter((e) => new RegExp(`^(${e.matcher})$`).test(tool));

  test("genau ein PreToolUse-Kommando trifft Bash, genau eines PowerShell, dasselbe Skript", () => {
    const skripte = (tool: string) => gilt(tool).flatMap((e) => e.hooks.flatMap((h) => h.args ?? []));
    assert.equal(skripte("Bash").length, 1);
    assert.equal(skripte("PowerShell").length, 1);
    assert.equal(skripte("Bash")[0], skripte("PowerShell")[0]);
    assert.ok(skripte("Bash")[0].endsWith("scripts/pretooluse-hook.mjs"));
  });

  test("Dispatcher und alle seine transitiven ./*.mjs-Importe sind geschützte Pfade", () => {
    const quelle = JSON.parse(lies(".github/protected-paths.json")) as { harness: string[] };
    const codeowners = lies(".github/CODEOWNERS");
    const gesehen = new Set<string>();
    const besuche = (datei: string) => {
      if (gesehen.has(datei)) return;
      gesehen.add(datei);
      for (const m of lies(`scripts/${datei}`).matchAll(/from "\.\/([\w-]+\.mjs)"/g)) besuche(m[1]);
    };
    besuche("pretooluse-hook.mjs");
    for (const f of ["gh-guard-hook.mjs", "worktree-guard-hook.mjs", "worktree-guard-powershell.mjs", "stop-verify-hook.mjs"]) gesehen.add(f);
    assert.ok(gesehen.has("bash-parser.mjs") && gesehen.has("hook-io.mjs"), "Import-Ableitung funktioniert");
    for (const f of gesehen) {
      assert.ok(quelle.harness.includes(`/scripts/${f}`), `protected-paths.json › harness braucht /scripts/${f}`);
      assert.ok(codeowners.includes(`/scripts/${f} @`), `CODEOWNERS braucht /scripts/${f}`);
    }
  });

  test("bei deny wird der gh-Guard gar nicht erst gefragt (ein langsamer Guard darf deny nicht aushebeln)", () => {
    let ghAufrufe = 0;
    const gh = () => {
      ghAufrufe++;
      return { ask: true, reason: "x" };
    };
    const blockt = () => ({ block: true, reason: "y" });
    assert.equal(hook.dispatch(payload("Bash", "x"), WURZEL, { decide: blockt, bewertePowerShell: blockt, bewerteGh: gh })?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(ghAufrufe, 0);
    assert.equal(hook.dispatch(payload("PowerShell", "x"), WURZEL, { decide: blockt, bewertePowerShell: blockt, bewerteGh: gh })?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(ghAufrufe, 0);
  });

  test("ein werfender Guard legt den anderen nicht lahm", () => {
    const wirft = () => {
      throw new Error("kaputt");
    };
    const fragt = () => ({ ask: true, reason: "x" });
    const blockt = () => ({ block: true, reason: "y" });
    const nichts = () => ({ block: false });
    assert.equal(hook.dispatch(payload("Bash", "x"), WURZEL, { decide: wirft, bewertePowerShell: nichts, bewerteGh: fragt })?.hookSpecificOutput.permissionDecision, "ask");
    assert.equal(hook.dispatch(payload("Bash", "x"), WURZEL, { decide: blockt, bewertePowerShell: nichts, bewerteGh: wirft })?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(hook.dispatch(payload("PowerShell", "x"), WURZEL, { decide: wirft, bewertePowerShell: blockt, bewerteGh: fragt })?.hookSpecificOutput.permissionDecision, "deny", "deny vor ask");
    assert.equal(hook.dispatch(payload("PowerShell", "x"), WURZEL, { decide: blockt, bewertePowerShell: wirft, bewerteGh: wirft }), null, "Bash-Guard ist bei PowerShell nicht zuständig");
  });
});
