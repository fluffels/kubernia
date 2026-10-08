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

describe("Agent: Lens-Auftrag-Guard (#1425)", () => {
  const agent = (prompt: string, subagentType: string | null = "kubernia-lens") =>
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Agent", cwd: WURZEL, tool_input: { ...(subagentType === null ? {} : { subagent_type: subagentType }), description: "Lens X R1", prompt } });
  const deny = (text: string) => hook.dispatch(text, WURZEL);
  const grund = (text: string) => deny(text)?.hookSpecificOutput.permissionDecisionReason ?? "";

  // Die ECHTEN Blöcke aus dem Skill, wie der Orchestrator sie wörtlich in den Prompt kopiert (Fehlalarm-Schutz: sie tragen absichtlich `<…>`).
  const skill = lies(".claude/skills/review-lenses/SKILL.md");
  const diaet = skill.slice(skill.indexOf("### Kontext-Diät je Lens"), skill.indexOf("> **Was die Diät ausdrücklich NICHT trifft:**"));
  const format = /## Findings-Format[\s\S]*?```\n([\s\S]*?)```/.exec(skill)?.[1] ?? "";
  const KOPF = "Brille: Architektur (Schichtregeln)";
  const gut = (extra = "") =>
    `${KOPF} · Arbeitsverzeichnis: C:/dev/kubernia/.claude/worktrees/kq-1 · Patch: /tmp/x/kq-1-r1.patch · erwarteter HEAD: abc1234def${extra} · ${diaet} · ${format}`;

  test("die echten Skill-Blöcke tragen `<…>` und gehen trotzdem durch (kein generischer Platzhalter-Test)", () => {
    assert.match(diaet, /<Arbeitsverzeichnis>/);
    assert.match(format, /<Befund>/);
    assert.equal(deny(agent(gut())), null);
    assert.equal(deny(agent(gut(), "general-purpose")), null);
  });

  test("R1: ein stehengebliebenes `<… WÖRTLICH>` wird verweigert", () => {
    for (const rest of ["<Brille WÖRTLICH>", "<Kontext-Diät WÖRTLICH>", "<Findings-Format WÖRTLICH>"]) {
      const out = deny(agent(`${rest} · Arbeitsverzeichnis: /w · Patch: /p.patch · erwarteter HEAD: abc1234`));
      assert.equal(out?.hookSpecificOutput.permissionDecision, "deny", rest);
      assert.match(out?.hookSpecificOutput.permissionDecisionReason ?? "", /WÖRTLICH/);
    }
  });

  test("R2: Platzhalter in Arbeitsverzeichnis, Patch, Delta-Patch oder HEAD wird verweigert, mit Feldname im Grund", () => {
    const faelle: [string, RegExp][] = [
      [`${KOPF} · Arbeitsverzeichnis: <worktree> · Patch: /p.patch · erwarteter HEAD: abc1234`, /Arbeitsverzeichnis/],
      [`${KOPF} · Arbeitsverzeichnis: /w · Patch: <TMP>/kq-1-r1.patch · erwarteter HEAD: abc1234`, /Patch/],
      [`${KOPF} · Arbeitsverzeichnis: /w · Patch: /p.patch · Delta-Patch: <TMP>/d.patch · erwarteter HEAD: abc1234`, /Delta-Patch/],
      [`${KOPF} · Arbeitsverzeichnis: /w · Patch: /p.patch · erwarteter HEAD: <sha>`, /erwarteter HEAD/],
      [`${KOPF}\nArbeitsverzeichnis: /w\nPatch: <TMP>/x.patch\nerwarteter HEAD: abc1234`, /Patch/],
    ];
    for (const [prompt, feld] of faelle) {
      assert.match(grund(agent(prompt)), feld, prompt);
      assert.equal(deny(agent(prompt))?.hookSpecificOutput.permissionDecision, "deny", prompt);
    }
  });

  test("R2: ein `<…>` im erklärenden Zusatz derselben Zeile zählt mit, die Meldung nennt das (#1460 Z2)", () => {
    const prompt = `${KOPF} · Arbeitsverzeichnis: /w · Patch: /p.patch · erwarteter HEAD: abc1234 (statt <sha>)`;
    assert.equal(deny(agent(prompt))?.hookSpecificOutput.permissionDecision, "deny");
    assert.match(grund(agent(prompt)), /Zusatz in derselben Zeile zählt mit.*eigene Zeile/);
    // derselbe Zusatz ohne `<…>` bleibt erlaubt (Guard-Logik nicht gelockert)
    assert.equal(deny(agent(`${KOPF} · Arbeitsverzeichnis: /w · Patch: /p.patch · erwarteter HEAD: abc1234 (statt sha)`)), null);
  });

  test("R3: `erwarteter HEAD:` ohne Hex-Hash (7 bis 40 Zeichen) wird verweigert, der Workflow-Fallback nicht", () => {
    for (const head of ["abc", "xyz1234", "HEAD", "a".repeat(41)]) {
      assert.equal(deny(agent(`${KOPF} · Arbeitsverzeichnis: /w · Patch: /p.patch · erwarteter HEAD: ${head}`))?.hookSpecificOutput.permissionDecision, "deny", head);
    }
    for (const head of ["abc1234", "ABCDEF1234", "a".repeat(40), "der HEAD des Feature-Worktrees (git rev-parse HEAD)"]) {
      assert.equal(deny(agent(`${KOPF} · Arbeitsverzeichnis: /w · Patch: /p.patch · erwarteter HEAD: ${head}`)), null, head);
    }
  });

  test("Fallback-Spawn (general-purpose oder ohne Typ) wird geprüft, sobald der Prompt `kubernia-lens.md` nennt", () => {
    const kaputt = "Lies zuerst `.claude/agents/kubernia-lens.md`. Patch: <TMP>/x.patch · erwarteter HEAD: abc1234";
    assert.equal(deny(agent(kaputt, "general-purpose"))?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(deny(agent(kaputt, null))?.hookSpecificOutput.permissionDecision, "deny");
  });

  test("durchgelassen: Nicht-Lens-Agenten mit `<TMP>`, Workflow-Format ohne Kopf-Felder, kaputtes JSON, fehlendes Prompt-Feld", () => {
    const mitPlatzhalter = "Patch: <TMP>/x.patch · erwarteter HEAD: <sha> · <Brille WÖRTLICH>";
    for (const typ of ["Explore", "kubernia-planner", "kubernia-umsetzer", "general-purpose", null]) {
      assert.equal(deny(agent(mitPlatzhalter, typ)), null, String(typ));
    }
    assert.equal(deny(agent(`Prüfe den Patch ${"/p.patch"} mit der Brille Architektur; Findings als <Befund> auflisten.`)), null);
    assert.equal(deny("{kaputt"), null);
    assert.equal(deny(JSON.stringify({ tool_name: "Agent", tool_input: { subagent_type: "kubernia-lens" } })), null);
  });

  test("je Feld zählt der LETZTE Treffer: ein Beispiel in der Brille sperrt den echten Kopf nicht, ein Platzhalter im Kopf wird trotz früherem Treffer gefunden", () => {
    const beispiel = "Brille mit Beispiel `Patch: <TMP>/x.patch` im Text";
    assert.equal(deny(agent(`${beispiel} · Arbeitsverzeichnis: /w · Patch: /p.patch · erwarteter HEAD: abc1234`)), null);
    assert.match(grund(agent(`Fall mit Patch: /a/b.patch davor · Arbeitsverzeichnis: /w · Patch: <TMP>/x.patch · erwarteter HEAD: abc1234`)), /Patch/);
  });

  test("Lookbehind: `Delta-Patch:` ist nicht `Patch:`, ein Platzhalter im echten Patch-Feld hinter dem Delta-Patch wird gefunden", () => {
    const kopf = `${KOPF} · Arbeitsverzeichnis: /w · Delta-Patch: /d.patch · Patch: <TMP>/x.patch · erwarteter HEAD: abc1234`;
    assert.match(grund(agent(kopf)), /„Patch:“/);
    assert.equal(deny(agent(`${KOPF} · Arbeitsverzeichnis: /w · Delta-Patch: /d.patch · Patch: /p.patch · erwarteter HEAD: abc1234`)), null);
    // Das Delta-Patch-Feld hinter einem kaputten Patch-Feld darf dessen Platzhalter nicht überdecken.
    assert.match(grund(agent(`${KOPF} · Arbeitsverzeichnis: /w · Patch: <TMP>/x.patch · Delta-Patch: /d.patch · erwarteter HEAD: abc1234`)), /„Patch:“/);
  });

  test("R3 erlaubt Backticks und einen Zusatz nach dem Hash, verweigert Text vor dem Hash", () => {
    for (const head of ["`724a5d4`", "724a5d4 (origin/main + Fix)", "`724a5d4` (Runde 2)"]) {
      assert.equal(deny(agent(`${KOPF} · Arbeitsverzeichnis: /w · Patch: /p.patch · erwarteter HEAD: ${head}`)), null, head);
    }
    for (const head of ["siehe 724a5d4", "(724a5d4)", "``"]) {
      assert.equal(deny(agent(`${KOPF} · Arbeitsverzeichnis: /w · Patch: /p.patch · erwarteter HEAD: ${head}`))?.hookSpecificOutput.permissionDecision, "deny", head);
    }
  });

  test("Verdrahtung: genau ein PreToolUse-Eintrag trifft Agent, dasselbe Skript wie Bash; das Modul ist geschützt", () => {
    const settings = JSON.parse(lies(".claude/settings.json")) as { hooks: { PreToolUse: { matcher: string; hooks: { args?: string[] }[] }[] } };
    const trifft = (tool: string) => settings.hooks.PreToolUse.filter((e) => new RegExp(`^(${e.matcher})$`).test(tool)).flatMap((e) => e.hooks.flatMap((h) => h.args ?? []));
    assert.equal(trifft("Agent").length, 1);
    assert.equal(trifft("Agent")[0], trifft("Bash")[0]);
    assert.match(lies(".github/protected-paths.json"), /"\/scripts\/lens-auftrag-guard\.mjs"/);
  });

  test("Prozess-Start: ein kaputter Lens-Auftrag erzeugt die Deny-Ausgabe, ein sauberer nichts", () => {
    const start = (p: string) => execFileSync("node", [resolve(WURZEL, "scripts/pretooluse-hook.mjs")], { input: p, encoding: "utf8" });
    const out = JSON.parse(start(agent("Patch: <TMP>/x.patch"))) as Out;
    assert.equal(out?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(start(agent(gut())).trim(), "");
  });
});
