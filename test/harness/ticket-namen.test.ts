/* Ticket-Namen aus der Projekt-Config (#1742, ADR 0022 F3): Hooks und Guards leiten Präfixe und Agentennamen aus
 * `.factory/projekt.json` ab, nicht aus Literalen.
 *
 * @harness-waechter – einziger Durchsetzer der Config-Anbindung der Hooks, darum im geschützten test/harness/ (#1165).
 *
 * Fixture `AB` trägt andere Präfixe und Agentennamen als das echte Projekt: gilt ein Verhalten nur mit dem echten Wert,
 * wird der Fall rot. `OHNE` lässt einen Pflichtschlüssel weg: jeder Hook blockiert fail-closed und nennt den Fix.
 */
import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lies, repoDateien } from "./repo-texte";
import { FREMD, projektConfig } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as configLibRaw from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRaw from "../../scripts/ticket-namen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as docsGenRaw from "../../scripts/docs-gen/markdown.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lensEditRaw from "../../scripts/lens-edit-guard.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lensAuftragRaw from "../../scripts/lens-auftrag-guard.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as abschlussRaw from "../../scripts/umsetzer-abschluss.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as stopRaw from "../../scripts/stop-verify-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as guardRaw from "../../scripts/worktree-guard-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as patchRaw from "../../scripts/patch-zugriff.mjs";

type Cfg = Record<string, unknown>;
type Namen = {
  praefixe: { branch: string; worktree: string };
  agenten: Record<string, string>;
  worktreeName: (nr: number | string) => string;
  branchName: (nr: number | string, slug: string) => string;
  lensNameKern: string;
  ticketAus: (t: string) => number | null;
  patchMuster: { ticketRunde: RegExp; voll: RegExp; delta: RegExp };
  dateiMuster: RegExp;
  ticketBranchMuster: RegExp;
};
const docsGen = docsGenRaw as unknown as { escapeRegex: (t: string) => string };
const N = namenRaw as unknown as {
  escapeRegex: (t: string) => string;
  ticketNamen: (c: Cfg) => Namen;
  ladeTicketNamen: (o?: { pfad?: string }) => Namen;
  failClosedGrund: (werkzeug: string, fehler: unknown) => string;
  namenOderGrund: (w: string, d?: { config?: Cfg }) => { namen?: Namen; config?: Cfg; grund?: string };
};
const lensEdit = lensEditRaw as unknown as { bewerteLensEdit: (f: string, cwd?: string, d?: { config?: Cfg }) => { block: boolean; reason?: string } };
const lensAuftrag = lensAuftragRaw as unknown as { lensAuftragBlockade: (i: { subagentType?: string; prompt?: string }, d?: { config?: Cfg }) => string | null };
const abschluss = abschlussRaw as unknown as {
  abschlussBlockade: (i: Record<string, unknown>, d?: Record<string, unknown>) => string | null;
};
const stop = stopRaw as unknown as {
  runHook: (stdin: string, root: string, check?: (r: string) => Record<string, unknown>, d?: Record<string, unknown>) => { exit: number; stdout: string; stderr: string };
};
const guard = guardRaw as unknown as {
  decide: (o: { cwd?: string; command: string; repoRoot: string; deps?: Record<string, unknown> }) => { block: boolean; reason?: string };
};
const patch = patchRaw as unknown as {
  patchPfade: (p: string, n?: Namen) => { voll: string | null; delta: string | null };
  patchAus: (p: string, z: unknown[], n?: Namen) => { ticket: number | null; runde: number | null } | null;
};

const AB: Cfg = {
  praefixe: { commitZeile: "AB-", branch: "feature/ab-", worktree: "ab-" },
  agenten: { planer: "ab-planer", umsetzer: "ab-umsetzer", lens: "ab-lens", gruppe: "ab-gruppe", ticketSkill: "ab" },
  labels: { harness: "h", festgefahren: "zustand:fest", forum: "f", dependabotInbox: "h" },
};
// Negativfälle „der Wert des echten Projekts gilt nicht“ nehmen ihn aus der echten Config (mit FREMD wäre er leer, ein Rückfall bliebe grün).
const ECHT = projektConfig();
const ohneAgent = (rolle: string): Cfg => ({ ...AB, agenten: { ...(AB.agenten as object), [rolle]: undefined } });
const OHNE_UMSETZER = ohneAgent("umsetzer");
const OHNE_WORKTREE: Cfg = { ...AB, praefixe: { commitZeile: "AB-", branch: "feature/ab-" } };
const OHNE_BRANCH: Cfg = { ...AB, praefixe: { commitZeile: "AB-", worktree: "ab-" } };

describe("ticketNamen: Muster aus der Config (AK4)", () => {
  const n = N.ticketNamen(AB);
  test("Worktree und Branch mit dem Präfix der Config gelten, die des echten Projekts nicht", () => {
    expect(n.ticketAus(".claude/worktrees/ab-12")).toBe(12);
    expect(n.ticketAus(`.claude/worktrees/${ECHT.praefixe.worktree}12`)).toBeNull();
    expect(n.ticketAus("feature/ab-12-slug")).toBe(12);
    expect(n.ticketAus(`${ECHT.praefixe.branch}12-slug`)).toBeNull();
    expect(n.ticketAus("C:\\x\\.claude\\worktrees\\ab-7\\src")).toBe(7);
  });
  test("Ticketnummer endet an Trenner, nicht mitten in einer längeren Zahl", () => {
    expect(n.ticketAus("feature/ab-12")).toBe(12);
    expect(n.ticketAus("feature/ab-12 ")).toBe(12);
    expect(n.ticketAus("feature/ab-12x")).toBeNull();
    expect(n.ticketAus(".claude/worktrees/ab-12/src")).toBe(12);
    expect(n.ticketAus(undefined as unknown as string)).toBeNull();
  });
  test("Namen entstehen aus den Präfixen", () => {
    expect(n.worktreeName(12)).toBe("ab-12");
    expect(n.branchName(12, "x")).toBe("feature/ab-12-x");
    expect(n.agenten.lens).toBe("ab-lens");
  });
  test("lensNameKern: Gruppe 1 ist Worktree-Name samt Nummer, r und m gelten", () => {
    const re = new RegExp(`^${n.lensNameKern}$`);
    expect(re.exec("ab-12-lens-r1")?.[1]).toBe("ab-12");
    expect(re.exec("ab-12-lens-m2")?.[1]).toBe("ab-12");
    expect(re.test(`${ECHT.praefixe.worktree}12-lens-r1`)).toBe(false);
    expect(re.test("ab-12-lens-x1")).toBe(false);
  });
  test("dateiMuster und ticketBranchMuster sind am Namensanfang verankert: ein vorangestelltes Präfix passt nicht", () => {
    expect(n.dateiMuster.test("ab-7.bak")).toBe(true);
    expect(n.dateiMuster.test("x-ab-7.bak")).toBe(false);
    expect(n.ticketBranchMuster.test("feature/ab-12")).toBe(true);
    expect(n.ticketBranchMuster.test("x-feature/ab-12")).toBe(false);
  });
  test("Regex-Metazeichen im Präfix werden maskiert", () => {
    const m = N.ticketNamen({ ...AB, praefixe: { branch: "feature/a.b-", worktree: "a.b-" } });
    expect(m.ticketAus("worktrees/a.b-12")).toBe(12);
    expect(m.ticketAus("worktrees/axb-12")).toBeNull();
    expect(N.escapeRegex("a.b+c")).toBe(String.raw`a\.b\+c`);
    expect(new RegExp(N.escapeRegex("a.b+c(d)[e]{f}|g^h$i?j*k\\l")).test("a.b+c(d)[e]{f}|g^h$i?j*k\\l")).toBe(true);
  });

  test("escapeRegex: jedes Sonderzeichen läuft als Literal durch, ein escaptes Zeichen ist kein Platzhalter", () => {
    const alle = ".*+?^${}()|[]\\/-";
    for (const z of alle) expect(new RegExp("^" + N.escapeRegex(z) + "$").test(z), z).toBe(true);
    expect(new RegExp("^" + N.escapeRegex(alle) + "$").test(alle)).toBe(true);
    expect(new RegExp("^" + N.escapeRegex(".") + "$").test("x")).toBe(false);
  });
});

describe("ticketNamen: fehlender Schlüssel (AK3)", () => {
  test.each([
    ["agenten.umsetzer", OHNE_UMSETZER],
    ["praefixe.worktree", OHNE_WORKTREE],
    ["praefixe.branch", OHNE_BRANCH],
  ])("%s fehlt: wirft mit Schlüssel und Fix-Zeile, ohne stillen Standardwert", (schluessel, cfg) => {
    expect(() => N.ticketNamen(cfg)).toThrow(new RegExp(schluessel.replace(".", "\\.")));
    expect(() => N.ticketNamen(cfg)).toThrow(/Fix: .*\.factory\/projekt\.json/);
  });
  test("leerer oder kein Text zählt als fehlend, kein Config-Objekt ebenso", () => {
    expect(() => N.ticketNamen({ ...AB, praefixe: { branch: "  ", worktree: "ab-" } })).toThrow(/praefixe\.branch/);
    expect(() => N.ticketNamen(undefined as unknown as Cfg)).toThrow(/Fix:/);
  });
  test("ladeTicketNamen: Datei ohne Schlüssel wirft mit Fix", () => {
    const dir = mkdtempSync(join(tmpdir(), "ticket-namen-"));
    try {
      const pfad = join(dir, "projekt.json");
      writeFileSync(pfad, JSON.stringify({ version: 2 }));
      expect(() => N.ladeTicketNamen({ pfad })).toThrow(/Fix:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("namenOderGrund wirft nie: Grund mit Werkzeug, fail-closed und Fix; sonst Namen und Config", () => {
    const r = N.namenOderGrund("Mein-Hook", { config: OHNE_UMSETZER });
    expect(r.namen).toBeUndefined();
    expect(r.grund).toMatch(/^Mein-Hook: .*fail-closed.*agenten\.umsetzer.*Fix:/s);
    const ok = N.namenOderGrund("Mein-Hook", { config: AB });
    expect(ok.grund).toBeUndefined();
    expect(ok.namen?.agenten.umsetzer).toBe("ab-umsetzer");
    expect(ok.config).toBe(AB);
  });
  test("failClosedGrund: ein Text für Fehler und Nicht-Fehler, wörtlich gleich in allen Aufrufern", () => {
    const kopf = "Mein-Hook: Projekt-Config nicht nutzbar, darum blockiert (fail-closed). ";
    expect(N.failClosedGrund("Mein-Hook", new Error("labels.festgefahren fehlt"))).toBe(`${kopf}labels.festgefahren fehlt`);
    expect(N.failClosedGrund("Mein-Hook", "nur Text")).toBe(`${kopf}nur Text`);
    expect(N.failClosedGrund("Mein-Hook", undefined)).toBe(`${kopf}undefined`);
    expect(N.namenOderGrund("Mein-Hook", { config: OHNE_UMSETZER }).grund).toBe(N.failClosedGrund("Mein-Hook", (() => { try { N.ticketNamen(OHNE_UMSETZER); } catch (e) { return e; } })()));
  });
  test("die echte Config trägt alle Schlüssel (Standard ohne deps)", () => {
    const r = N.namenOderGrund("x");
    expect(r.grund).toBeUndefined();
    expect(r.namen?.praefixe.worktree).toBeTruthy();
  });
});

describe("lens-edit-guard mit Config", () => {
  test("Edit im Lens-Worktree mit dem Präfix der Config ist erlaubt, mit fremdem Präfix abgelehnt", () => {
    expect(lensEdit.bewerteLensEdit("/r/.claude/worktrees/ab-12-lens-r1/src/a.ts", "", { config: AB }).block).toBe(false);
    expect(lensEdit.bewerteLensEdit("/r/.claude/worktrees/ab-12-lens-m2/src/a.ts", "", { config: AB }).block).toBe(false);
    const fremd = lensEdit.bewerteLensEdit(`/r/.claude/worktrees/${FREMD.praefixe.worktree}12-lens-r1/src/a.ts`, "", { config: AB });
    expect(fremd.block).toBe(true);
    expect(fremd.reason).toMatch(/ab-lens .*ab-<nr>-lens-r<runde>/);
  });
  test("Edit im Feature-Worktree wird abgelehnt", () => {
    expect(lensEdit.bewerteLensEdit("/r/.claude/worktrees/ab-12/src/a.ts", "", { config: AB }).block).toBe(true);
  });
  test("ohne Schlüssel: block mit Fix-Zeile, auch für einen sonst erlaubten Pfad", () => {
    const r = lensEdit.bewerteLensEdit("/r/.claude/worktrees/ab-12-lens-r1/src/a.ts", "", { config: OHNE_UMSETZER });
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/Fix:/);
  });
});

describe("lens-auftrag-guard mit Config", () => {
  const kopf = "Arbeitsverzeichnis: <worktree>\nPatch: /t/ab-1-r1.patch\nerwarteter HEAD: abcdef1";
  test("der Lens-Agent der Config wird geprüft, der echte Name nicht", () => {
    expect(lensAuftrag.lensAuftragBlockade({ subagentType: "ab-lens", prompt: kopf }, { config: AB })).toMatch(/Arbeitsverzeichnis/);
    expect(lensAuftrag.lensAuftragBlockade({ subagentType: ECHT.agenten.lens, prompt: kopf }, { config: AB })).toBeNull();
  });
  test("Fallback general-purpose mit der Lens-Definition der Config im Prompt", () => {
    // kein Übergangs-Zweig mehr: `<lens>.md` aus der Config macht den Fallback nicht zum Lens-Spawn
    expect(lensAuftrag.lensAuftragBlockade({ subagentType: "general-purpose", prompt: `Lies ab-lens.md\n${kopf}` }, { config: AB })).toBeNull();
    expect(lensAuftrag.lensAuftragBlockade({ subagentType: "general-purpose", prompt: `Lies fremd-lens.md\n${kopf}` }, { config: AB })).toBeNull();
    // Kern-Dateiname (#1748): gilt unabhängig vom Agentennamen der Config
    expect(lensAuftrag.lensAuftragBlockade({ subagentType: "general-purpose", prompt: `Lies .claude/agents/factory-lens.md\n${kopf}` }, { config: AB })).toMatch(/Arbeitsverzeichnis/);
  });
  test("ein Spawn eines anderen Agenten, der den Kern-Dateinamen nennt, ist kein Lens-Spawn (#1748)", () => {
    for (const subagentType of ["Explore", "ab-umsetzer"]) {
      expect(lensAuftrag.lensAuftragBlockade({ subagentType, prompt: `Lies .claude/agents/factory-lens.md\n${kopf}` }, { config: AB })).toBeNull();
    }
  });
  test("ohne Schlüssel: deny mit Fix-Zeile", () => {
    expect(lensAuftrag.lensAuftragBlockade({ subagentType: "ab-lens", prompt: "ok" }, { config: OHNE_UMSETZER })).toMatch(/Fix:/);
  });
  test("ohne Schlüssel blockiert auch ein fremder Spawn (fail-closed, kein Agentenvergleich davor)", () => {
    expect(lensAuftrag.lensAuftragBlockade({ subagentType: "Explore", prompt: "ok" }, { config: OHNE_UMSETZER })).toMatch(/Fix:/);
  });
});

describe("umsetzer-abschluss mit Config", () => {
  const bericht = "ERGEBNIS: festgefahren\nTICKET: #1\nPR: https://github.com/x/y/pull/5\nBEFUNDE: keine\n";
  const eingabe = (agentType: string) => ({ hookEvent: "SubagentStop", agentType, lastMessage: bericht });
  const offen = () => ({ state: "OPEN", autoMergeRequest: null, labels: [] });
  test("nur der Umsetzer der Config wird geprüft; das Label kommt aus der Config", () => {
    const r = abschluss.abschlussBlockade(eingabe("ab-umsetzer"), { config: AB, prStatus: offen });
    expect(r).toMatch(/zustand:fest/);
    expect(abschluss.abschlussBlockade(eingabe(ECHT.agenten.umsetzer), { config: AB, prStatus: offen })).toBeNull();
  });
  test("das Label der Config am PR genügt", () => {
    const mit = () => ({ state: "OPEN", autoMergeRequest: null, labels: [{ name: "zustand:fest" }] });
    expect(abschluss.abschlussBlockade(eingabe("ab-umsetzer"), { config: AB, prStatus: mit })).toBeNull();
  });
  test("ohne Schlüssel: Grund mit Fix bei SubagentHandback und SubagentStop", () => {
    const vorher = { hookEvent: "PreToolUse", toolName: "SubagentHandback", agentType: "ab-umsetzer", lastMessage: bericht };
    expect(abschluss.abschlussBlockade(vorher, { config: OHNE_UMSETZER })).toMatch(/Fix:/);
    expect(abschluss.abschlussBlockade(eingabe("ab-umsetzer"), { config: OHNE_UMSETZER })).toMatch(/Fix:/);
  });
  test("ohne Schlüssel blockiert auch ein fremder Agent (fail-closed)", () => {
    const vorher = { hookEvent: "PreToolUse", toolName: "SubagentHandback", agentType: "ab-lens", lastMessage: bericht };
    expect(abschluss.abschlussBlockade(vorher, { config: OHNE_UMSETZER })).toMatch(/Fix:/);
    expect(abschluss.abschlussBlockade(eingabe("Explore"), { config: OHNE_UMSETZER })).toMatch(/Fix:/);
  });
  test("ein fremdes Ereignis braucht keine Config", () => {
    expect(abschluss.abschlussBlockade({ hookEvent: "Stop", agentType: "x", lastMessage: bericht }, { config: OHNE_UMSETZER })).toBeNull();
  });
});

describe("stop-verify-hook ersetzt den Matcher durch den Vergleich mit agenten.umsetzer", () => {
  const payload = (extra: Record<string, unknown>) => JSON.stringify({ last_assistant_message: "ERGEBNIS: gemergt\nPR: -\n", ...extra });
  const lauf = (extra: Record<string, unknown>, config: Cfg) => {
    let geprueft = 0;
    const r = stop.runHook(payload(extra), "/x", () => { geprueft++; return { blocked: false }; }, { config, prStatus: () => ({ state: "MERGED", autoMergeRequest: null, labels: [] }) });
    return { r, geprueft };
  };
  test("SubagentStop des Umsetzers der Config läuft durch die Prüfung", () => {
    expect(lauf({ hook_event_name: "SubagentStop", agent_type: "ab-umsetzer" }, AB).geprueft).toBe(1);
  });
  test("SubagentStop eines anderen Agenten (auch des echten Umsetzer-Namens) steigt aus, ohne Prüfung", () => {
    for (const typ of ["Explore", ECHT.agenten.umsetzer, undefined]) {
      const { r, geprueft } = lauf({ hook_event_name: "SubagentStop", agent_type: typ }, AB);
      expect(r.exit).toBe(0);
      expect(geprueft).toBe(0);
    }
  });
  test("ohne Schlüssel: Exit 2 mit Fix-Zeile; stop_hook_active gibt trotzdem frei", () => {
    const { r } = lauf({ hook_event_name: "SubagentStop", agent_type: "ab-umsetzer" }, OHNE_UMSETZER);
    expect(r.exit).toBe(2);
    expect(r.stderr).toMatch(/Fix:/);
    expect((JSON.parse(r.stdout) as { decision: string }).decision).toBe("block");
    expect(lauf({ hook_event_name: "SubagentStop", agent_type: "ab-umsetzer", stop_hook_active: true }, OHNE_UMSETZER).r.exit).toBe(0);
  });
  test("ohne Schlüssel blockiert auch das SubagentStop eines fremden Agenten (fail-closed)", () => {
    expect(lauf({ hook_event_name: "SubagentStop", agent_type: "Explore" }, OHNE_UMSETZER).r.exit).toBe(2);
  });
  test("der Stop des Hauptchats braucht die Config nicht und prüft weiter", () => {
    const { r, geprueft } = lauf({ hook_event_name: "Stop" }, OHNE_UMSETZER);
    expect(r.exit).toBe(0);
    expect(geprueft).toBe(1);
  });
});

describe("worktree-guard-hook: Beispiel aus der Config, Block bleibt", () => {
  const repoRoot = "/c/git/x";
  const exec = {
    execFileSync: (_c: unknown, args: unknown) => {
      if ((args as string[]).includes("--show-toplevel")) return `${repoRoot}\n${repoRoot}/.git\n`;
      throw new Error("unerwartet");
    },
    statSync: () => ({ isDirectory: () => true }),
  };
  const commit = (config: Cfg) => guard.decide({ cwd: repoRoot, command: 'git commit -m "x"', repoRoot, deps: { ...exec, config } });
  test("die Meldung nennt Worktree und Branch mit den Präfixen der Config", () => {
    const r = commit(AB);
    expect(r.block).toBe(true);
    expect(r.reason).toContain("git worktree add .claude/worktrees/ab-<nr> -b feature/ab-<nr>-<slug> origin/main");
    expect(r.reason).not.toContain(ECHT.praefixe.worktree);
  });
  test("ohne Schlüssel bleibt es ein Block, die Meldung trägt die Fix-Zeile", () => {
    for (const cfg of [OHNE_WORKTREE, OHNE_BRANCH]) {
      const r = commit(cfg);
      expect(r.block).toBe(true);
      expect(r.reason).toMatch(/Fix:/);
    }
  });
});

describe("patch-zugriff mit Namen aus der Config", () => {
  const n = N.ticketNamen(AB);
  test("ohne Label gilt der Pfad mit dem Präfix der Config, der mit fremdem Präfix nicht", () => {
    expect(patch.patchPfade("Patch bereit:\n /t/ab-12-r3.patch", n).voll).toBe("ab-12-r3.patch");
    expect(patch.patchPfade(`Patch bereit:\n /t/${FREMD.praefixe.worktree}12-r3.patch`, n).voll).toBeNull();
    expect(patch.patchPfade("Patch bereit:\n /t/x/ab-12-r3-delta.patch", n).delta).toBe("ab-12-r3-delta.patch");
    expect(patch.patchPfade(`x /t/${FREMD.praefixe.worktree}12-r3-delta.patch`, n).delta).toBeNull();
  });
  test("patchAus liest Ticket und Runde mit dem Präfix der Config", () => {
    expect(patch.patchAus("Patch: /t/ab-12-r3.patch", [], n)).toMatchObject({ ticket: 12, runde: 3 });
    expect(patch.patchAus(`Patch: /t/${FREMD.praefixe.worktree}12-r3.patch`, [], n)).toMatchObject({ ticket: null, runde: null });
  });
  test("Groß-/Kleinschreibung zählt nicht (Flag i)", () => {
    expect(patch.patchPfade("Patch bereit:\n /t/AB-12-r3.patch", n).voll).toBe("ab-12-r3.patch");
    expect(patch.patchPfade("x /t/AB-12-r3-delta.patch", n).delta).toBe("ab-12-r3-delta.patch");
    expect(patch.patchAus("Patch: /t/AB-12-R3.patch", [], n)).toMatchObject({ ticket: 12, runde: 3 });
    const g = N.ticketNamen({ ...AB, praefixe: { commitZeile: "AB-", branch: "feature/AB-", worktree: "AB-" } });
    expect(patch.patchAus("Patch: /t/AB-12-r3.patch", [], g)).toMatchObject({ ticket: 12, runde: 3 });
  });
  test("ohne übergebene Namen gilt die echte Config", () => {
    expect(patch.patchAus(`Patch: /t/${ECHT.praefixe.worktree}12-r3.patch`, [])).toMatchObject({ ticket: 12, runde: 3 });
  });
});

describe("Regex-Escape-Helfer: keine Kopien der Zeichenklasse", () => {
  // Nadel per Verkettung gebaut, damit dieser Wächter sich nicht selbst trifft.
  // Bekannte Grenze: gefunden wird nur die wörtliche Zeichenklasse; eine umgestellte oder umgeordnete Klasse rutscht durch.
  const NADEL = "[.*+?^$" + "{}()|[\\]\\\\";
  // Die erlaubten Quellen: Kern und docs-gen-Kern (darf nur node:* und sich selbst importieren) fest hier, die Projektkopien
  // (z. B. ein CommonJS-Config, die den ESM-Kern nicht laden kann, oder eine Produkt-Funktion) aus `struktur.escapeKopien` der Config.
  const ERLAUBT_KERN = ["scripts/ticket-namen.mjs", "scripts/docs-gen/markdown.mjs"];
  const configKopien = (configLibRaw as unknown as { escapeKopienAus: (c: unknown) => string[] }).escapeKopienAus(ECHT);
  const ERLAUBT = [...ERLAUBT_KERN, ...configKopien];
  const kopien = (dateien: string[], lesen: (p: string) => string, erlaubt: string[] = ERLAUBT): string[] =>
    dateien.filter((f) => /\.(?:ts|mjs|js|cjs)$/.test(f) && !erlaubt.includes(f) && lesen(f).includes(NADEL));

  test("außerhalb der erlaubten Quellen steht die Zeichenklasse nirgends im Code", () => {
    expect(kopien(repoDateien(), lies)).toEqual([]);
  });
  test("Wächter erkennt eine Kopie, erlaubte Quellen zählen nicht", () => {
    const inhalt: Record<string, string> = { "test/x.ts": `s.replace(/${NADEL}]/g, "")`, "scripts/ticket-namen.mjs": NADEL, "docs/a.md": NADEL };
    expect(kopien(Object.keys(inhalt), (p) => inhalt[p])).toEqual(["test/x.ts"]);
  });
  test("eine Projektkopie aus der Config ist erlaubt, derselbe Pfad ohne Eintrag ist eine Kopie", () => {
    const inhalt: Record<string, string> = { "lib/eigen.cjs": NADEL, "test/x.ts": NADEL };
    const dateien = Object.keys(inhalt);
    const lesen = (p: string) => inhalt[p];
    expect(kopien(dateien, lesen, [...ERLAUBT_KERN, "lib/eigen.cjs"])).toEqual(["test/x.ts"]);
    expect(kopien(dateien, lesen, ERLAUBT_KERN)).toEqual(["lib/eigen.cjs", "test/x.ts"]);
  });
  test("docs-gen-Kopie maskiert dieselben Metazeichen wie der Kern (Drift-Schutz)", () => {
    for (const z of ".*+?^$" + "{}()|[]\\") expect(docsGen.escapeRegex(z), z).toBe(N.escapeRegex(z));
    expect(docsGen.escapeRegex("a/b-c")).toBe("a/b-c"); // wie bisher in docs-gen: `/` und `-` bleiben unmaskiert
  });
  test("die erlaubten Quellen (Kern und Config) existieren und tragen die Zeichenklasse wirklich", () => {
    for (const f of ERLAUBT) expect(lies(f), f).toContain(NADEL);
  });
});
