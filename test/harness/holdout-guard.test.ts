/* Holdout-Guard (ADR 0022 F13) – Szenarien bleiben im Hauptchat, der Abnahme-Agent schreibt nur ins Temp-Verzeichnis, der Szenario-Agent liest nur docs/.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Verhalten über die öffentliche API plus die Verdrahtung (Frontmatter beider Agenten, Dispatcher, settings.json).
 * Grenzen (Bash-Schreiben, Symlinks, ganzes Temp-Verzeichnis) stehen im Kopf des Skripts.
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/holdout-guard.mjs";
import { FREMD } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as auftrag from "../../scripts/holdout-auftrag-guard.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { dispatch } from "../../scripts/pretooluse-hook.mjs";

type Urteil = { block: boolean; reason?: string };
type Deny = { hookSpecificOutput: { permissionDecision: string } } | null;
const A = auftrag as unknown as {
  ABNAHME_EMPFAENGER: string;
  holdoutAuftragBlockade: (e?: { tool?: string; subagentType?: string; text?: string }) => string | null;
  parseHoldoutInput: (t: string) => { tool?: string; subagentType?: string; text?: string };
};
const G = raw as unknown as {
  bewerteAbnahmeWrite: (p: unknown, cwd?: string, deps?: { tmp?: string }) => Urteil;
  bewerteSzenarioLesen: (tool: string, input: unknown, cwd?: string, deps?: { root?: string }) => Urteil;
  entscheideHook: (modus: string | undefined, text: string, deps?: { tmp?: string; root?: string }) => Deny;
};
const dispatcher = dispatch as (text: string, root: string) => Deny;
const lies = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const KOPF = "SZENARIEN #" + "1234";
const ZEILE = "Szenario 1.1: Gegeben ein Ticket · Wenn x · Dann y";

describe("holdoutAuftragBlockade", () => {
  test("Szenario-Kopf oder -Zeile an Planer, Umsetzer, general-purpose oder ohne Typ: verweigert, mit Verweis auf die Holdout-Trennung", () => {
    for (const subagentType of [FREMD.agenten.planer, FREMD.agenten.umsetzer, FREMD.agenten.gruppe, FREMD.agenten.lens, "general-purpose", undefined]) {
      for (const text of [`Body\n${KOPF} · x`, `Plan\n${ZEILE}`, "  Negativfall 2.3: Gegeben a"]) {
        expect(A.holdoutAuftragBlockade({ tool: "Agent", subagentType, text }), `${subagentType} ${text}`).toMatch(/Holdout-Trennung/);
      }
    }
  });
  test("Spawn an den Abnahme-Agenten: erlaubt", () => {
    expect(A.holdoutAuftragBlockade({ tool: "Agent", subagentType: "holdout-abnahme", text: `${KOPF}\n${ZEILE}` })).toBeNull();
  });
  test("Platzhalter ohne Ziffern und Fließtext über Szenarien: nicht verweigert", () => {
    expect(A.holdoutAuftragBlockade({ tool: "Agent", subagentType: FREMD.agenten.planer, text: "SZENARIEN #<nr> und Szenario 1.1 ohne Gegeben, Szenarien allgemein" })).toBeNull();
    expect(A.holdoutAuftragBlockade({ tool: "Agent", subagentType: FREMD.agenten.planer, text: "im Satz: Szenario 1.1: Gegeben" })).toBeNull();
  });
  test("SendMessage wird immer geprüft, auch an den Abnahme-Agenten; alle String-Werte zählen", () => {
    expect(A.holdoutAuftragBlockade({ tool: "SendMessage", subagentType: "holdout-abnahme", text: KOPF })).toMatch(/Holdout-Trennung/);
    const t = A.parseHoldoutInput(JSON.stringify({ tool_name: "SendMessage", tool_input: { to: "x", message: { teil: [ZEILE] } } }));
    expect(A.holdoutAuftragBlockade(t)).toMatch(/Holdout-Trennung/);
    expect(A.holdoutAuftragBlockade(A.parseHoldoutInput(JSON.stringify({ tool_name: "SendMessage", tool_input: { to: "x", message: "weiter" } })))).toBeNull();
  });
  test("fremdes Tool und leere Eingabe: nicht verweigert; kaputtes JSON: leeres Objekt", () => {
    expect(A.holdoutAuftragBlockade({ tool: "Bash", text: KOPF })).toBeNull();
    expect(A.holdoutAuftragBlockade()).toBeNull();
    expect(A.parseHoldoutInput("{kaputt")).toEqual({});
  });
  test("der Empfängername ist der Abnahme-Agent: die Agent-Datei trägt den Namen (abnahme.mjs teilt die Quelle)", () => {
    expect(lies(`.claude/agents/${A.ABNAHME_EMPFAENGER}.md`)).toMatch(new RegExp(`^---\\nname: ${A.ABNAHME_EMPFAENGER}\\n`));
  });
});

describe("bewerteAbnahmeWrite", () => {
  const tmp = "C:/Temp";
  const w = (p: unknown, cwd = "C:/dev/repo") => G.bewerteAbnahmeWrite(p, cwd, { tmp });
  test("unter dem Temp-Verzeichnis (Slash und Backslash): erlaubt", () => {
    expect(w("C:/Temp/scratch/a.mjs").block).toBe(false);
    expect(w("C:\\Temp\\scratch\\a.mjs").block).toBe(false);
  });
  test("Präfix ohne Segmentgrenze (C:/Temp2), Repo, Traversal aus dem Temp-Verzeichnis, relativer Pfad ins Repo: abgelehnt", () => {
    for (const p of ["C:/Temp2/a.mjs", "C:/dev/repo/src/a.ts", "C:/Temp/../dev/repo/a.ts", "src/a.ts", "./a.ts"]) expect(w(p).block, p).toBe(true);
    expect(w("src/a.ts").reason).toMatch(/Scratchpad/);
  });
  test("fehlender oder leerer Pfad: abgelehnt", () => {
    for (const p of [undefined, null, "", "  ", 7]) expect(w(p).block, String(p)).toBe(true);
  });
  test("relativer Pfad, der per cwd im Temp-Verzeichnis liegt: erlaubt", () => {
    expect(w("a.mjs", "C:/Temp/s").block).toBe(false);
  });
  test("Temp-Verzeichnis mit Schrägstrich am Ende: ein Pfad darunter ist erlaubt", () => {
    expect(G.bewerteAbnahmeWrite("C:/Temp/a.mjs", "", { tmp: "C:/Temp/" }).block).toBe(false);
    expect(G.bewerteAbnahmeWrite("C:/Temp2/a.mjs", "", { tmp: "C:/Temp/" }).block).toBe(true);
  });
  /** Führt `fn` mit gesetzter Plattform aus (der Vergleich liest `process.platform` bei jedem Aufruf), danach zurück. */
  const auf = (plattform: string, fn: () => void) => {
    const alt = process.platform;
    Object.defineProperty(process, "platform", { value: plattform });
    try {
      fn();
    } finally {
      Object.defineProperty(process, "platform", { value: alt });
    }
  };
  test("Windows: Groß-/Kleinschreibung des Laufwerks und Ordners zählt nicht", () => {
    auf("win32", () => {
      expect(w("c:/temp/a.mjs").block).toBe(false);
      expect(G.bewerteSzenarioLesen("Read", { file_path: "c:/dev/repo/docs/x.md" }, "", { root: "C:/dev/repo" }).block).toBe(false);
    });
  });
  test("POSIX: Groß-/Kleinschreibung zählt (/TMP ist nicht /tmp)", () => {
    auf("linux", () => {
      expect(G.bewerteAbnahmeWrite("/tmp/a.mjs", "", { tmp: "/tmp" }).block).toBe(false);
      expect(G.bewerteAbnahmeWrite("/TMP/a.mjs", "", { tmp: "/tmp" }).block).toBe(true);
      expect(G.bewerteSzenarioLesen("Read", { file_path: "/home/u/Repo/docs/x.md" }, "", { root: "/home/u/repo" }).block).toBe(true);
    });
  });
  test("echtes os.tmpdir() ohne Test-Eingabe: ein Pfad darunter ist erlaubt", () => {
    expect(G.bewerteAbnahmeWrite(`${tmpdir()}/x/a.mjs`, "").block).toBe(false);
  });
});

describe("bewerteSzenarioLesen", () => {
  const root = "C:/dev/repo";
  const l = (tool: string, input: unknown) => G.bewerteSzenarioLesen(tool, input, root, { root });
  test("Read unter docs/ und README.md: erlaubt", () => {
    expect(l("Read", { file_path: `${root}/docs/glossar.md` }).block).toBe(false);
    expect(l("Read", { file_path: `${root}/README.md` }).block).toBe(false);
    expect(l("Read", { file_path: "docs/glossar.md" }).block).toBe(false);
  });
  test("Read von Code, Präfix-Namen und Traversal: abgelehnt, die Meldung nennt den erlaubten Weg", () => {
    for (const p of [`${root}/src/a.ts`, `${root}/docs2/a.md`, `${root}/README.md.bak`, `${root}/docs/../src/a.ts`, "../x.md", "scripts/a.mjs"]) {
      const e = l("Read", { file_path: p });
      expect(e.block, p).toBe(true);
      expect(e.reason).toMatch(/docs\//);
    }
  });
  test("Grep und Glob prüfen path; ohne path abgelehnt", () => {
    expect(l("Grep", { pattern: "x", path: `${root}/docs` }).block).toBe(false);
    expect(l("Glob", { pattern: "*.md", path: `${root}/docs/module` }).block).toBe(false);
    expect(l("Grep", { pattern: "x" }).block).toBe(true);
    expect(l("Glob", { pattern: "*.md" }).block).toBe(true);
    expect(l("Grep", { pattern: "x", path: `${root}/src` }).block).toBe(true);
    expect(l("Grep", { pattern: "x", path: root }).block).toBe(true);
  });
  test("Glob-Muster mit .. oder absolut: abgelehnt, auch unter docs/", () => {
    expect(l("Glob", { pattern: "../src/**", path: `${root}/docs` }).block).toBe(true);
    expect(l("Glob", { pattern: "..\\src\\**", path: `${root}/docs` }).block).toBe(true);
    expect(l("Glob", { pattern: "C:/dev/repo/src/**", path: `${root}/docs` }).block).toBe(true);
    expect(l("Glob", { pattern: "/etc/*", path: `${root}/docs` }).block).toBe(true);
    expect(l("Glob", { pattern: "**/*.md", path: `${root}/docs` }).block).toBe(false);
  });
  test("ohne deps.root gilt cwd als Wurzel (Hook ohne CLAUDE_PROJECT_DIR)", () => {
    expect(G.bewerteSzenarioLesen("Read", { file_path: `${root}/docs/a.md` }, root, {}).block).toBe(false);
    expect(G.bewerteSzenarioLesen("Read", { file_path: `${root}/src/a.ts` }, root, {}).block).toBe(true);
  });
  test("fehlende Eingabe: abgelehnt", () => {
    expect(l("Read", undefined).block).toBe(true);
    expect(l("Read", {}).block).toBe(true);
  });
});

describe("entscheideHook", () => {
  const p = (tool_name: string, tool_input: unknown) => JSON.stringify({ tool_name, cwd: "C:/dev/repo", tool_input });
  test("abnahme-write: Repo-Pfad deny, Temp-Pfad und fremdes Tool durch", () => {
    const d = { tmp: "C:/Temp", root: "C:/dev/repo" };
    expect(G.entscheideHook("abnahme-write", p("Write", { file_path: "C:/dev/repo/a.ts" }), d)?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(G.entscheideHook("abnahme-write", p("Write", { file_path: "C:/Temp/a.ts" }), d)).toBeNull();
    expect(G.entscheideHook("abnahme-write", p("Read", { file_path: "C:/dev/repo/a.ts" }), d)).toBeNull();
  });
  test("szenario-lesen: Code deny, docs durch; unbekannter Modus und kaputtes JSON durch", () => {
    const d = { root: "C:/dev/repo" };
    expect(G.entscheideHook("szenario-lesen", p("Read", { file_path: "C:/dev/repo/src/a.ts" }), d)?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(G.entscheideHook("szenario-lesen", p("Read", { file_path: "C:/dev/repo/docs/a.md" }), d)).toBeNull();
    expect(G.entscheideHook("szenario-lesen", p("Bash", { command: "x" }), d)).toBeNull();
    for (const tool of ["Grep", "Glob"]) {
      expect(G.entscheideHook("szenario-lesen", p(tool, { pattern: "x", path: "C:/dev/repo/src" }), d)?.hookSpecificOutput.permissionDecision, tool).toBe("deny");
      expect(G.entscheideHook("szenario-lesen", p(tool, { pattern: "x", path: "C:/dev/repo/docs" }), d), tool).toBeNull();
    }
    // Payload ohne tool_name im Modus abnahme-write wird als Write behandelt (fail-closed für den Pfad)
    expect(G.entscheideHook("abnahme-write", JSON.stringify({ cwd: "C:/dev/repo", tool_input: { file_path: "C:/dev/repo/a.ts" } }), d)?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(G.entscheideHook("unbekannt", p("Read", { file_path: "C:/dev/repo/src/a.ts" }), d)).toBeNull();
    expect(G.entscheideHook("szenario-lesen", "{kaputt", d)).toBeNull();
  });
});

describe("Verdrahtung", () => {
  const kopf = (name: string) => /^---\n([\s\S]*?)\n---/.exec(lies(`.claude/agents/${name}.md`))?.[1] ?? "";
  test("holdout-abnahme: PreToolUse-Hook, Matcher Write, abnahme-write", () => {
    const k = kopf("holdout-abnahme");
    expect(k).toMatch(/hooks:\s*\n\s+PreToolUse:\s*\n\s+- matcher: "Write"/);
    expect(k).toContain("/scripts/holdout-guard.mjs");
    expect(k).toMatch(/^\s+- abnahme-write$/m);
  });
  test("holdout-szenario: PreToolUse-Hook, Matcher Read|Grep|Glob, szenario-lesen", () => {
    const k = kopf("holdout-szenario");
    expect(k).toMatch(/hooks:\s*\n\s+PreToolUse:\s*\n\s+- matcher: "Read\|Grep\|Glob"/);
    expect(k).toContain("/scripts/holdout-guard.mjs");
    expect(k).toMatch(/^\s+- szenario-lesen$/m);
  });
  test("settings.json: der Dispatcher-Matcher trägt SendMessage", () => {
    expect(lies(".claude/settings.json")).toContain('"matcher": "Bash|PowerShell|SubagentHandback|Agent|SendMessage"');
  });
  test("Dispatcher: Agent- und SendMessage-Zweig verweigern Szenarien, Spawn an die Abnahme läuft durch", () => {
    const d = (tool_name: string, tool_input: unknown) => dispatcher(JSON.stringify({ tool_name, tool_input }), "C:/x");
    expect(d("Agent", { subagent_type: FREMD.agenten.planer, prompt: KOPF })?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(d("SendMessage", { to: "a", message: ZEILE })?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(d("Agent", { subagent_type: "holdout-abnahme", prompt: KOPF })).toBeNull();
    expect(d("SendMessage", { to: "a", message: "weiter" })).toBeNull();
  });
});
