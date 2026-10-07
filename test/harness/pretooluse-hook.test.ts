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
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/pretooluse-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as ioRaw from "../../scripts/hook-io.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as ghRaw0 from "../../scripts/gh-guard-hook.mjs";

// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as tabRaw from "../../scripts/shell-tabellen.mjs";

const ghRaw = ghRaw0 as unknown as { GEPRUEFTE_TOOLS: string[]; bewerte: (c: string, o: unknown) => unknown };
type Guards = Record<string, (o: never) => unknown>;
type Out = { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } } | null;
const io = ioRaw as unknown as { mergeDecisions: (d: unknown[]) => Out };
const tabellen = tabRaw as unknown as { SHELL_VON_TOOL: Record<string, string> };
const hook = raw as unknown as { dispatch: (text: string, repoRoot: string, guards?: Guards, shellVonTool?: Record<string, string>, abschlussDeps?: unknown) => Out };

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

  test("jede Shell der Tabelle hat einen Worktree-Guard, eine ohne wird verweigert (#1331)", () => {
    const blockt = () => ({ block: true, reason: "x" });
    const nichts = () => ({ block: false });
    for (const tool of Object.keys(tabellen.SHELL_VON_TOOL)) {
      const mitGuard = hook.dispatch(payload(tool, "x"), WURZEL, { decide: blockt, bewertePowerShell: blockt, bewerteGh: nichts });
      assert.equal(mitGuard?.hookSpecificOutput.permissionDecision, "deny", `${tool}: ein Worktree-Guard muss gefragt werden`);
      assert.equal(hook.dispatch(payload(tool, "x"), WURZEL, { decide: nichts, bewertePowerShell: nichts, bewerteGh: nichts }), null, tool);
    }
    const fremd = hook.dispatch(payload("Zsh", "x"), WURZEL, { decide: nichts, bewertePowerShell: nichts, bewerteGh: nichts }, { Zsh: "zsh" });
    assert.equal(fremd?.hookSpecificOutput.permissionDecision, "deny");
    assert.match(fremd?.hookSpecificOutput.permissionDecisionReason ?? "", /keinen Worktree-Guard/);
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

  test("der gh-Guard bekommt die Shell des Tools (Dialekt, #1316)", () => {
    const gesehen: unknown[] = [];
    const nichts = () => ({ block: false });
    const guards = { decide: nichts, bewertePowerShell: nichts, bewerteGh: (_c: unknown, opt: unknown) => (gesehen.push(opt), { ask: false }) };
    hook.dispatch(payload("Bash", "x"), WURZEL, guards as never);
    hook.dispatch(payload("PowerShell", "x"), WURZEL, guards as never);
    assert.deepEqual(gesehen, [{ shell: "bash" }, { shell: "powershell" }]);
  });

  test("Ende zu Ende: PowerShell-Pfad mit abschließendem Backslash verschluckt das folgende gh api nicht (#1316 Z1a)", () => {
    const nichts = () => ({ block: false });
    const gh = (ghRaw as unknown as { bewerte: (c: string, o: unknown) => unknown }).bewerte;
    const guards = { decide: nichts, bewertePowerShell: nichts, bewerteGh: gh };
    const cmd = String.raw`Set-Location "C:\dev\"; gh api -X DELETE repos/o/r/issues/1`;
    assert.equal(hook.dispatch(payload("PowerShell", cmd), WURZEL, guards as never)?.hookSpecificOutput.permissionDecision, "ask");
    const bash = String.raw`git commit -m "a \"; gh api -X DELETE x\" b"`;
    assert.equal(hook.dispatch(payload("Bash", bash), WURZEL, guards as never), null, "Bash: maskiertes Quote, der Text bleibt Text");
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

  test("bei einer Rückfrage (kein deny) wird der gh-Guard weiter gefragt, seine Begründung bleibt erhalten", () => {
    let ghAufrufe = 0;
    const gh = () => {
      ghAufrufe++;
      return { ask: true, reason: "gh-Grund" };
    };
    const fragtWorktree = () => ({ block: false, ask: true, reason: "worktree-Grund" });
    const nichts = () => ({ block: false });
    assert.equal(hook.dispatch(payload("Bash", "x"), WURZEL, { decide: nichts, bewertePowerShell: nichts, bewerteGh: gh })?.hookSpecificOutput.permissionDecisionReason, "gh-Grund");
    assert.equal(ghAufrufe, 1);
    assert.equal(hook.dispatch(payload("Bash", "x"), WURZEL, { decide: fragtWorktree, bewertePowerShell: nichts, bewerteGh: gh })?.hookSpecificOutput.permissionDecision, "ask");
    assert.equal(ghAufrufe, 2, "auch bei einer Worktree-Frage läuft der gh-Guard");
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

describe("SubagentHandback: Abschluss-Wächter des Umsetzers (#1342)", () => {
  const handback = (message: string, agentType: string | undefined = "kubernia-umsetzer") =>
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "SubagentHandback", agent_type: agentType, cwd: WURZEL, tool_input: { message } });
  const offen = { prStatus: () => ({ state: "OPEN", autoMergeRequest: { enabledAt: "x" }, labels: [] }) };

  test("ein Handback mit Zusatz wird verweigert, ein exakter Bericht und fremde Agenten gehen durch", () => {
    const grund = hook.dispatch(handback("ERGEBNIS: abgebrochen (Zwischenstand)\nPR: -"), WURZEL, undefined, undefined, offen);
    assert.equal(grund?.hookSpecificOutput.permissionDecision, "deny");
    assert.match(grund?.hookSpecificOutput.permissionDecisionReason ?? "", /Zusatz/);
    assert.equal(hook.dispatch(handback("ERGEBNIS: abgebrochen\nPR: -"), WURZEL, undefined, undefined, offen), null);
    assert.equal(hook.dispatch(handback("ERGEBNIS: abgebrochen (x)\nPR: -", "kubernia-lens"), WURZEL, undefined, undefined, offen), null);
    assert.equal(hook.dispatch(handback("ERGEBNIS: abgebrochen (x)\nPR: -", ""), WURZEL, undefined, undefined, offen), null);
  });

  test("festgefahren bei offenem PR ohne Label wird verweigert; ein werfender gh gibt frei", () => {
    const nachricht = "ERGEBNIS: festgefahren\nPR: https://github.com/x/y/pull/9";
    assert.equal(hook.dispatch(handback(nachricht), WURZEL, undefined, undefined, offen)?.hookSpecificOutput.permissionDecision, "deny");
    const wirft = { prStatus: () => { throw new Error("kein gh"); } };
    assert.equal(hook.dispatch(handback(nachricht), WURZEL, undefined, undefined, wirft), null);
  });

  test("Verdrahtung: genau ein PreToolUse-Eintrag trifft SubagentHandback, dasselbe Skript wie Bash", () => {
    const settings = JSON.parse(lies(".claude/settings.json")) as { hooks: { PreToolUse: { matcher: string; hooks: { args?: string[] }[] }[] } };
    const trifft = (tool: string) => settings.hooks.PreToolUse.filter((e) => new RegExp(`^(${e.matcher})$`).test(tool)).flatMap((e) => e.hooks.flatMap((h) => h.args ?? []));
    assert.equal(trifft("SubagentHandback").length, 1);
    assert.equal(trifft("SubagentHandback")[0], trifft("Bash")[0]);
  });

  test("Prozess-Start: ein verweigerter Handback erzeugt die Deny-Ausgabe, ein fremder nichts", () => {
    const start = (p: string) => execFileSync("node", [resolve(WURZEL, "scripts/pretooluse-hook.mjs")], { input: p, encoding: "utf8" });
    const out = JSON.parse(start(handback("kein Format"))) as Out;
    assert.equal(out?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(start(handback("kein Format", "kubernia-lens")).trim(), "");
  });
});

describe("Tool→Dialekt-Tabelle und Kopfkommentare der Guards (#1322 Z14, Z16a)", () => {
  test("SHELL_VON_TOOL ist die eine Tabelle: Dispatcher und gh-Guard-Direktaufruf leiten daraus ab", () => {
    assert.deepEqual({ ...tabellen.SHELL_VON_TOOL }, { Bash: "bash", PowerShell: "powershell" });
    assert.equal(Object.isFrozen(tabellen.SHELL_VON_TOOL), true);
    assert.deepEqual(ghRaw.GEPRUEFTE_TOOLS, Object.keys(tabellen.SHELL_VON_TOOL));
    for (const quelle of ["scripts/pretooluse-hook.mjs", "scripts/gh-guard-hook.mjs"]) {
      const text = lies(quelle);
      assert.match(text, /SHELL_VON_TOOL/, `${quelle} nutzt die Tabelle`);
      assert.doesNotMatch(text, /tool === "PowerShell" \? "powershell"|tool === "Bash" \? "bash"/, `${quelle}: keine zweite Zuordnung`);
    }
  });

  test("Vererbte Objekt-Schlüssel (`constructor`, `__proto__`) sind keine geprüften Tools", () => {
    const nichts = () => ({ block: false });
    const guards = { decide: nichts, bewertePowerShell: nichts, bewerteGh: () => ({ ask: true, reason: "x" }) };
    for (const tool of ["constructor", "toString", "__proto__", "bash"]) assert.equal(hook.dispatch(payload(tool, "x"), WURZEL, guards as never), null, tool);
  });

  test("jeder Guard mit Direktaufruf trägt im ersten Kommentarblock genau einmal den Abschnitt `Bewusste Grenzen:`", () => {
    const guards = readdirSync(resolve(WURZEL, "scripts")).filter((n) => /guard.*\.mjs$/.test(n) && lies(`scripts/${n}`).includes("istDirektaufruf(import.meta.url)"));
    assert.deepEqual(guards.sort(), ["gh-guard-hook.mjs", "lens-edit-guard.mjs", "worktree-guard-hook.mjs", "worktree-guard-powershell.mjs"]);
    for (const n of guards) {
      const kopf = /\/\*\*[\s\S]*?\*\//.exec(lies(`scripts/${n}`))?.[0] ?? "";
      assert.equal(kopf.split("\n").filter((z) => /^ \* Bewusste Grenzen:\s*$/.test(z)).length, 1, `${n}: Abschnitt „Bewusste Grenzen:“ genau einmal im Kopfkommentar`);
      assert.doesNotMatch(kopf, /Ehrliche Grenze|Verbleibende Grenze|ehrlich, wie/, `${n}: keine abweichende Überschrift`);
    }
  });
});
