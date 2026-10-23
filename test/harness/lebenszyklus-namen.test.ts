/* Ticket-Lebenszyklus-Werkzeuge leiten Branch- und Worktree-Präfix aus der Projekt-Config ab (#1743, ADR 0022 F3, Teil 3).
 *
 * @harness-waechter – einziger Durchsetzer dieser Config-Anbindung, darum im geschützten test/harness/ (#1165).
 *
 * Fixture `AB` trägt andere Präfixe als das echte Projekt: gilt ein Verhalten nur mit dem echten Literal, wird der Fall rot.
 * `OHNE_WT` lässt `praefixe.worktree` weg: jedes Werkzeug bricht mit Schlüssel und Fix-Zeile ab, ein Standardwert fehlt.
 */
import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lies } from "./repo-texte";
import { FREMD } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRaw from "../../scripts/ticket-namen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as projektRaw from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as refsRaw from "../../scripts/ticket-refs.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as aufraeumenRaw from "../../scripts/worktree-aufraeumen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cleanupRaw from "../../scripts/cleanup-worktrees.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as stopRaw from "../../scripts/stop-verify-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lockRaw from "../../scripts/ticket-lock.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as naechstesRaw from "../../scripts/naechstes-ticket.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as budgetRaw from "../../scripts/budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ausfallRaw from "../../scripts/mcp-ausfall.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as syncRaw from "../../scripts/haupt-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardRaw from "../../scripts/board-lib.mjs";

type Cfg = Record<string, unknown>;
type Namen = { praefixe: { branch: string; worktree: string } };
const ticketNamen = (namenRaw as unknown as { ticketNamen: (c: Cfg) => Namen }).ticketNamen;
const ladeProjektConfig = (projektRaw as unknown as { ladeProjektConfig: (o?: { pfad?: string; pruefen?: boolean }) => Cfg }).ladeProjektConfig;
const worktreeNamenOderGrund = (namenRaw as unknown as { worktreeNamenOderGrund: (w: string, d?: { config?: Cfg; pfad?: string }) => { namen?: Namen & { lensNameKern: string }; grund?: string } }).worktreeNamenOderGrund;
const R = refsRaw as unknown as {
  ticketAusRef: (t: string, n?: Namen) => number | null;
  belegteNummern: (e: { refs?: string[]; worktrees?: string[]; prHeads?: string[] }, n?: Namen) => Set<number>;
  lensWorktreeName: (n?: Namen) => RegExp;
};
const A = aufraeumenRaw as unknown as {
  sortiereDateien: (dir: string, dateien: string[], registered: Set<string>, deps?: object) => { verwaist: string[]; jung: string[]; fremd: string[] };
  verwaisteLensWorktrees: (pfade: string[], dir: string, n?: Namen) => string[];
  aufraeumbareBranches: (o: { refs: { name: string; gone: boolean; sha: string }[]; worktreeBranches: string[]; gemergteHeads: { headRefName: string; headRefOid: string }[]; namen?: Namen }) => string[];
  branchesAufraeumen: (o: { git: (a: string[]) => string; gh: () => unknown[]; namen?: Namen }) => { ok?: boolean; kandidaten: string[] };
};
const C = cleanupRaw as unknown as {
  branchenModus: (root: string, loeschen: boolean, o: { config?: Cfg; ghJson?: (a: string[]) => unknown[]; git?: (a: string[]) => string; gh?: () => unknown[]; out?: (t: string) => void; err?: (t: string) => void }) => number;
};
const S = stopRaw as unknown as {
  runHook: (stdin: string, root: string, check?: (r: string, d?: { namen?: Namen }) => Record<string, unknown>, d?: Record<string, unknown>) => { exit: number; stdout: string; stderr: string };
};
const L = lockRaw as unknown as {
  fuehreAus: (argv: string[], deps: Record<string, unknown>) => { code: number; out: string; err: string };
  echteDeps: (o?: { config?: Cfg }) => Record<string, unknown> & { lockDir: string };
};
const N = naechstesRaw as unknown as {
  waehleNaechstes: (e: Record<string, unknown>) => { ticket: { nr: number } | null };
  echteIo: (o?: { config?: Cfg }) => { namen: Namen };
};
const B = budgetRaw as unknown as { snapshotPfad: (env?: Record<string, string | undefined>) => string };
const M = ausfallRaw as unknown as {
  standPfad: (w: string, env: Record<string, string | undefined>, tmp: string, c?: Cfg) => string;
  main: (argv: string[], env: Record<string, string | undefined>, out: (t: string) => void, o?: { config?: Cfg; jetzt?: number }) => number;
};
const H = syncRaw as unknown as {
  ordneHarnessAenderungen: (d: string[]) => { skill: string[]; sonstige: string[] };
  TICKET_SKILL_VERZEICHNIS: string;
  configGrund: (d?: { config?: Cfg }) => string | null;
  baueText: (e: Record<string, unknown>, o?: { sitzungsbasis?: boolean }) => string;
};
const normalizeItems = (boardRaw as unknown as { normalizeItems: (p: unknown[][]) => unknown[] }).normalizeItems;

const AB: Cfg = {
  praefixe: { commitZeile: "AB-", branch: "feature/ab-", worktree: "ab-" },
  agenten: { planer: "ab-planer", umsetzer: "ab-umsetzer", lens: "ab-lens", gruppe: "ab-gruppe", ticketSkill: "ab" },
  labels: { harness: "h", festgefahren: "zustand:fest", forum: "f", dependabotInbox: "h" },
  sprache: ladeProjektConfig().sprache, // das Spezifikations-Gate der Auswahl liest die Sprache aus der Config (#1711)
};
const OHNE_WT: Cfg = { ...AB, praefixe: { commitZeile: "AB-", branch: "feature/ab-" } };
const OHNE_SKILL: Cfg = { ...AB, agenten: { ...(AB.agenten as object), ticketSkill: undefined } };
const NAMEN = ticketNamen(AB);
// Das eigene Präfix des Projekts darf unter der Config `AB` nirgends durchschlagen: die Erwartung kommt aus der echten Config.
const WTP = (ladeProjektConfig().praefixe as { worktree: string }).worktree;
const BRP = (ladeProjektConfig().praefixe as { branch: string }).branch;
const OWNER = FREMD.repo.split("/")[0] ?? "";
/** Zeile mit new RegExp( und escapeRegex( auf praefixe: der Musterbau gehört zentral in ticket-namen.mjs. */
const verstreuterMusterbau = (text: string) => text.split("\n").some((z) => z.includes("new RegExp(") && z.includes("escapeRegex(") && z.includes("praefixe"));
const LIES_FEHLER = (text: string) => {
  expect(text).toContain("praefixe.worktree");
  expect(text).toContain("Fix:");
  expect(text).not.toContain(WTP);
};

describe("ticket-refs: Präfixe aus der Config", () => {
  test("Branch- und Worktree-Namen mit dem Präfix der Config zählen, die des echten Projekts nicht", () => {
    const belegt = R.belegteNummern({ refs: ["feature/ab-12-x", `${BRP}13-x`, "origin/feature/ab-14-y"], worktrees: ["C:/r/.claude/worktrees/ab-15", `C:/r/.claude/worktrees/${WTP}16`] }, NAMEN);
    expect([...belegt].sort((a, b) => a - b)).toEqual([12, 14, 15]);
    expect(R.belegteNummern({ prHeads: ["feature/ab-17-z", `${BRP}18-z`] }, NAMEN)).toEqual(new Set([17]));
  });
  test(`ticketAusRef: feature/ab-12-x gefunden, ${BRP}12-x ignoriert`, () => {
    expect(R.ticketAusRef("feature/ab-12-x", NAMEN)).toBe(12);
    expect(R.ticketAusRef(`${BRP}12-x`, NAMEN)).toBeNull();
  });
  test("lensWorktreeName erkennt ab-<nr>-lens-r<n> und -m<n>, nicht das fremde Präfix und nicht lens-x", () => {
    const re = R.lensWorktreeName(NAMEN);
    expect(re.exec("ab-12-lens-r1")?.[1]).toBe("ab-12");
    expect(re.test("ab-12-lens-m2")).toBe(true);
    expect(re.test(`${WTP}12-lens-r1`)).toBe(false);
    expect(re.test("ab-12-lens-x")).toBe(false);
  });
});

describe("worktree-aufraeumen: Präfixe aus der Config", () => {
  const WT = "/r/.claude/worktrees";
  const alt = () => ({ mtimeMs: 0 });
  const deps = { now: 10 * 60_000, statSync: alt, namen: NAMEN };
  test(`sortiereDateien: ab-7-x.bak ist Kandidat, ${WTP}7-x.bak fremd, ab-70.bak gehört nicht zu ab-7`, () => {
    const registered = new Set([`${WT}/ab-7`]);
    const r = A.sortiereDateien(WT, ["ab-7-x.bak", `${WTP}7-x.bak`, "ab-70.bak"], registered, deps);
    expect(r.fremd).toEqual([`${WTP}7-x.bak`]);
    expect(r.verwaist).toEqual(["ab-70.bak"]);
    expect(A.sortiereDateien(WT, ["ab-7-x.bak"], new Set(), deps).verwaist).toEqual(["ab-7-x.bak"]);
  });
  test(`verwaisteLensWorktrees: ab-3-lens-r1 ohne ab-3 ist verwaist, ${WTP}3-lens-r1 wird ignoriert`, () => {
    expect(A.verwaisteLensWorktrees([`${WT}/ab-3-lens-r1`, `${WT}/${WTP}3-lens-r1`], WT, NAMEN)).toEqual(["ab-3-lens-r1"]);
    expect(A.verwaisteLensWorktrees([`${WT}/ab-3`, `${WT}/ab-3-lens-r1`], WT, NAMEN)).toEqual([]);
  });
  test("aufraeumbareBranches: nur der Namensraum der Config", () => {
    const sha = "a".repeat(40);
    const refs = [{ name: "feature/ab-1-a", gone: true, sha }, { name: `${BRP}2-b`, gone: true, sha }];
    const gemergt = refs.map((r) => ({ headRefName: r.name, headRefOid: sha }));
    expect(A.aufraeumbareBranches({ refs, worktreeBranches: [], gemergteHeads: gemergt, namen: NAMEN })).toEqual(["feature/ab-1-a"]);
  });
  test("branchesAufraeumen fragt git nach refs/heads/<praefixe.branch>*", () => {
    const befehle: string[][] = [];
    const git = (a: string[]) => {
      befehle.push(a);
      return "";
    };
    A.branchesAufraeumen({ git, gh: () => [], namen: NAMEN });
    expect(befehle[0]?.at(-1)).toBe("refs/heads/feature/ab-*");
  });
});

describe("Präfixe mit Regex-Sonderzeichen werden maskiert", () => {
  const PUNKT = ticketNamen({ ...AB, praefixe: { commitZeile: "AB-", branch: "feature/a.b-", worktree: "a.b-" } });
  test("aufraeumbareBranches: feature/aXb-1 ist kein Ticket-Branch, feature/a.b-1 schon", () => {
    const sha = "a".repeat(40);
    const refs = [{ name: "feature/a.b-1-x", gone: true, sha }, { name: "feature/aXb-2-x", gone: true, sha }];
    const gemergt = refs.map((r) => ({ headRefName: r.name, headRefOid: sha }));
    expect(A.aufraeumbareBranches({ refs, worktreeBranches: [], gemergteHeads: gemergt, namen: PUNKT })).toEqual(["feature/a.b-1-x"]);
  });
  test("sortiereDateien: aXb-5.bak ist fremd, a.b-5.bak Kandidat", () => {
    const r = A.sortiereDateien("/r/.claude/worktrees", ["aXb-5.bak", "a.b-5.bak"], new Set(), { now: 10 * 60_000, statSync: () => ({ mtimeMs: 0 }), namen: PUNKT });
    expect(r.fremd).toEqual(["aXb-5.bak"]);
    expect(r.verwaist).toEqual(["a.b-5.bak"]);
  });
});

describe("cleanup-worktrees --branches", () => {
  test("Meldung und gh-Suche tragen das Präfix der Config", () => {
    const aus: string[] = [];
    const git = (a: string[]) => (a[0] === "for-each-ref" ? "" : "");
    expect(C.branchenModus("/r", false, { config: AB, git, gh: () => [], out: (t) => aus.push(t), err: () => undefined })).toBe(0);
    expect(aus.join("\n")).toContain("feature/ab-*");
    expect(aus.join("\n")).not.toContain(WTP);
  });
  test("die gh-Suche nach gemergten PRs trägt das Branch-Präfix der Config", () => {
    let argumente: string[] = [];
    const ghJson = (a: string[]) => ((argumente = a), []);
    C.branchenModus("/r", false, { config: AB, git: () => "", ghJson, out: () => undefined, err: () => undefined });
    expect(argumente[argumente.indexOf("--search") + 1]).toBe("head:feature/ab-");
  });
  test("ohne praefixe.worktree: Abbruch mit Schlüssel und Fix-Zeile, git und gh bleiben unberührt", () => {
    let aufrufe = 0;
    const fehler: string[] = [];
    const code = C.branchenModus("/r", true, { config: OHNE_WT, git: () => (++aufrufe, ""), gh: () => (++aufrufe, []), out: () => undefined, err: (t) => fehler.push(t) });
    expect(code).not.toBe(0);
    LIES_FEHLER(fehler.join("\n"));
    expect(aufrufe).toBe(0);
  });
});

describe("stop-verify-hook: Namen aus der Config", () => {
  test("ohne Config-Schlüssel blockt auch der Stop des Hauptchats, die Prüfung läuft nicht", () => {
    let gerufen = 0;
    const r = S.runHook('{"hook_event_name":"Stop"}', "/x", () => (++gerufen, { blocked: false }), { config: OHNE_WT });
    expect(r.exit).toBe(2);
    const antwort = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(antwort.decision).toBe("block");
    LIES_FEHLER(antwort.reason);
    expect(gerufen).toBe(0);
  });
  test("mit Config bekommt die Prüfung die Namen (Worktree-Präfix ab-)", () => {
    let namen: Namen | undefined;
    const r = S.runHook('{"hook_event_name":"Stop"}', "/x", (_root, d) => ((namen = d?.namen), { blocked: false }), { config: AB });
    expect(r.exit).toBe(0);
    expect(namen?.praefixe.worktree).toBe("ab-");
  });
  test("der Stop des Hauptchats braucht nur praefixe.worktree: ein fehlender Agentenname blockt ihn nicht", () => {
    let namen: Namen | undefined;
    const ohneUmsetzer = { ...AB, agenten: { ...(AB.agenten as object), umsetzer: undefined } };
    const r = S.runHook('{"hook_event_name":"Stop"}', "/x", (_root, d) => ((namen = d?.namen), { blocked: false }), { config: ohneUmsetzer });
    expect(r.exit).toBe(0);
    expect(namen?.praefixe.worktree).toBe("ab-");
  });
  test("echter Lader: eine Config-Datei ohne agenten.umsetzer blockt den Stop des Hauptchats nicht; SubagentStop (volle Config) und der volle Lader schon", () => {
    const dir = mkdtempSync(join(tmpdir(), "lz-cfg-"));
    try {
      const echt = JSON.parse(lies(".factory/projekt.json")) as { agenten: Record<string, unknown> };
      delete echt.agenten.umsetzer;
      (echt as unknown as { praefixe: { worktree: string } }).praefixe.worktree = "zz-";
      const pfad = join(dir, "projekt.json");
      writeFileSync(pfad, JSON.stringify(echt));
      let namen: Namen | undefined;
      const r = S.runHook('{"hook_event_name":"Stop"}', "/x", (_root, d) => ((namen = d?.namen), { blocked: false }), { pfad });
      expect(r.exit).toBe(0);
      expect(namen?.praefixe.worktree).toBe("zz-"); // aus der Temp-Datei, nicht aus der echten Config
      expect(S.runHook('{"hook_event_name":"SubagentStop","agent_type":"x"}', "/x", () => ({ blocked: false }), { config: echt }).exit).toBe(2);
      expect(() => ladeProjektConfig({ pfad })).toThrow(/agenten\.umsetzer/);
      expect(() => ladeProjektConfig({ pfad, pruefen: false })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("eine Config-Datei mit Inhalt null: Grund mit Schlüssel und Fix-Zeile statt TypeError", () => {
    const dir = mkdtempSync(join(tmpdir(), "lz-null-"));
    try {
      const pfad = join(dir, "projekt.json");
      writeFileSync(pfad, "null");
      LIES_FEHLER(worktreeNamenOderGrund("T", { pfad }).grund ?? "");
      expect(S.runHook('{"hook_event_name":"Stop"}', "/x", () => ({ blocked: false }), { pfad }).exit).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("SubagentStop reicht die Namen der Config an die Prüfung weiter", () => {
    let namen: Namen | undefined;
    const r = S.runHook('{"hook_event_name":"SubagentStop","agent_type":"ab-umsetzer"}', "/x", (_root, d) => ((namen = d?.namen), { blocked: false }), { config: AB, prStatus: () => ({ state: "MERGED", autoMergeRequest: null, labels: [] }) });
    expect(r.exit).toBe(0);
    expect(namen?.praefixe.worktree).toBe("ab-");
  });
  test("SubagentStop braucht dagegen die volle Config (fehlender Agentenname blockt)", () => {
    const ohneUmsetzer = { ...AB, agenten: { ...(AB.agenten as object), umsetzer: undefined } };
    expect(S.runHook('{"hook_event_name":"SubagentStop","agent_type":"x"}', "/x", () => ({ blocked: false }), { config: ohneUmsetzer }).exit).toBe(2);
  });
  test("worktreeNamenOderGrund: liefert Präfix und Lens-Muster, ohne Schlüssel einen Grund mit Fix-Zeile", () => {
    const r = worktreeNamenOderGrund("T", { config: { praefixe: { worktree: "a.b-" } } });
    expect(r.namen?.praefixe.worktree).toBe("a.b-");
    expect(new RegExp(`^${r.namen?.lensNameKern}$`).test("a.b-3-lens-r1")).toBe(true);
    expect(new RegExp(`^${r.namen?.lensNameKern}$`).test("aXb-3-lens-r1")).toBe(false);
    LIES_FEHLER(worktreeNamenOderGrund("T", { config: OHNE_WT }).grund ?? "");
    LIES_FEHLER(worktreeNamenOderGrund("T", { config: {} }).grund ?? "");
  });
  test("Vertrag: das Teilobjekt reicht für die Lens-Waisen-Prüfung von worktree-aufraeumen", () => {
    const teil = worktreeNamenOderGrund("T", { config: AB }).namen;
    expect(A.verwaisteLensWorktrees(["/r/.claude/worktrees/ab-3-lens-r1", `/r/.claude/worktrees/${WTP}3-lens-r1`], "/r/.claude/worktrees", teil)).toEqual(["ab-3-lens-r1"]);
    expect(A.sortiereDateien("/r/.claude/worktrees", ["ab-7-x.bak", `${WTP}7-x.bak`], new Set(), { now: 10 * 60_000, statSync: () => ({ mtimeMs: 0 }), namen: teil }).fremd).toEqual([`${WTP}7-x.bak`]);
  });
  test("stop_hook_active gibt auch bei kaputter Config frei (keine Schleife)", () => {
    expect(S.runHook('{"hook_event_name":"Stop","stop_hook_active":true}', "/x", () => ({ blocked: true, reason: "x" }), { config: OHNE_WT }).exit).toBe(0);
  });
});

describe("ticket-lock: Namen aus der Config", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  const claim = (refs: string[]) => {
    dir = mkdtempSync(join(tmpdir(), "lz-lock-"));
    const git = (args: string[]) => {
      const a = args.join(" ");
      if (a.startsWith("for-each-ref")) return refs.join("\n");
      if (a.startsWith("worktree list")) return "worktree /repo";
      return "";
    };
    const deps = { ...L.echteDeps({ config: AB }), git, lockDir: join(dir, "locks"), jetzt: () => Date.UTC(2026, 9, 9, 12), nonce: () => "n-1" };
    return L.fuehreAus(["claim", "12"], deps);
  };
  test("Ref mit dem Präfix der Config belegt das Ticket (Exit 4, Meldung mit feature/ab-12-*)", () => {
    const r = claim(["feature/ab-12-x"]);
    expect(r.code).toBe(4);
    expect(r.err).toContain("feature/ab-12-*");
    expect(r.err).not.toContain(WTP);
  });
  test("ein Ref mit dem Präfix des echten Projekts belegt nichts (Exit 0)", () => {
    expect(claim([`${BRP}12-x`]).code).toBe(0);
  });
  test("echteDeps ohne praefixe.worktree wirft mit Schlüssel und Fix-Zeile", () => {
    let text = "";
    try {
      L.echteDeps({ config: OHNE_WT });
    } catch (e) {
      text = (e as Error).message;
    }
    LIES_FEHLER(text);
  });
});

describe("naechstes-ticket: Namen aus der Config", () => {
  const item = (nr: number) => ({
    node_id: `ITEM_${nr}`,
    content_type: "Issue",
    fields: [{ name: "Status", value: { name: { raw: "Todo" } } }],
    content: { number: nr, title: `T${nr}`, state: "open", assignees: [], user: { login: OWNER, type: "User" }, labels: [], body: "## Ziel\nZ\n\n## Akzeptanzkriterien\n- Negativfall: A\n", issue_dependencies_summary: { blocked_by: 0 } },
  });
  const waehle = (refs: string[]) => N.waehleNaechstes({ items: normalizeItems([[item(5)]]), offene: new Set(), owner: OWNER, refs, namen: NAMEN, config: { labels: { harness: FREMD.labels.harness, forum: "forum" }, sprache: AB.sprache } });
  test("ein Branch mit dem Präfix der Config überspringt das Ticket, der des echten Projekts nicht", () => {
    expect(waehle(["feature/ab-5-x"]).ticket).toBeNull();
    expect(waehle([`${BRP}5-x`]).ticket?.nr).toBe(5);
  });
  test("echteIo ohne praefixe.worktree wirft mit Schlüssel und Fix-Zeile", () => {
    expect(() => N.echteIo({ config: OHNE_WT })).toThrow(/praefixe\.worktree[\s\S]*Fix:/);
    expect(N.echteIo({ config: AB }).namen.praefixe.worktree).toBe("ab-");
  });
});

describe("worktreePraefix und zentrale Muster in ticketNamen", () => {
  const praefixVon = (namenRaw as unknown as { worktreePraefix: (c: Cfg) => string }).worktreePraefix;
  const N2 = namenRaw as unknown as { namenOderGrund: (w: string, d?: { config?: Cfg; pfad?: string }) => { namen?: Namen; grund?: string } };
  test("worktreePraefix prüft nur praefixe.worktree: Branch-Präfix und Agenten dürfen fehlen, ohne Schlüssel Abbruch mit Fix-Zeile", () => {
    expect(praefixVon({ praefixe: { worktree: "ab-" } })).toBe("ab-");
    expect(() => praefixVon({ praefixe: { branch: "feature/ab-" } })).toThrow(/praefixe\.worktree[\s\S]*Fix:/);
    expect(() => praefixVon({})).toThrow(/praefixe\.worktree/);
  });
  test(`ticketNamen trägt dateiMuster, lensWorktreeMuster, lensPfadMuster, ticketBranchMuster (Präfix ab-, ${WTP} passt nicht)`, () => {
    const n = ticketNamen(AB) as unknown as Record<string, RegExp>;
    expect(n.dateiMuster.exec("ab-13610-x.bak")?.[1]).toBe("ab-13610");
    expect(n.dateiMuster.test(`${WTP}7.bak`)).toBe(false);
    expect(n.lensWorktreeMuster.test("ab-3-lens-r2")).toBe(true);
    expect(n.lensWorktreeMuster.test("x-ab-3-lens-r2")).toBe(false);
    expect(n.lensPfadMuster.test("C:/R/.Claude/worktrees/ab-3-lens-m1/src/a.ts")).toBe(true);
    expect(n.lensPfadMuster.test(`/r/.claude/worktrees/${WTP}3-lens-r1/a.ts`)).toBe(false);
    expect(n.ticketBranchMuster.test("feature/ab-12-x")).toBe(true);
    expect(n.ticketBranchMuster.test(`${BRP}12-x`)).toBe(false);
    expect(n.ticketBranchMuster.test("ab-12-x")).toBe(false);
  });
  test("namenOderGrund liest deps.pfad: vollständige Datei liefert Namen (Präfix zz-), unvollständige einen Grund", () => {
    const dir = mkdtempSync(join(tmpdir(), "lz-pfad-"));
    try {
      const echt = JSON.parse(lies(".factory/projekt.json")) as { praefixe: { worktree: string }; agenten: Record<string, unknown> };
      echt.praefixe.worktree = "zz-";
      const voll = join(dir, "voll.json");
      writeFileSync(voll, JSON.stringify(echt));
      expect(N2.namenOderGrund("T", { pfad: voll }).namen?.praefixe.worktree).toBe("zz-");
      delete echt.agenten.umsetzer;
      const teil = join(dir, "teil.json");
      writeFileSync(teil, JSON.stringify(echt));
      expect(N2.namenOderGrund("T", { pfad: teil }).grund).toMatch(/agenten\.umsetzer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("Wächter: außerhalb von ticket-namen.mjs baut kein Skript Muster aus praefixe (new RegExp mit escapeRegex auf praefixe)", () => {
    const treffer = readdirSync("scripts")
      .filter((f) => f.endsWith(".mjs") && f !== "ticket-namen.mjs")
      .filter((f) => verstreuterMusterbau(lies("scripts/" + f)));
    expect(treffer).toEqual([]);
  });
  test("Wächter-Probe: erkennt den verstreuten Musterbau im Fixture-Text, nicht den zentralen Zugriff", () => {
    expect(verstreuterMusterbau("return new RegExp(escapeRegex(namen.praefixe.branch));")).toBe(true);
    expect(verstreuterMusterbau("return namen.ticketBranchMuster;")).toBe(false);
    expect(verstreuterMusterbau("new RegExp(escapeRegex(term))")).toBe(false);
  });
});

describe("Temp- und Stand-Dateien: Präfix aus der Config", () => {
  test("snapshotPfad: kontoweit und projektneutral (kein Präfix, keine Config nötig); die Umgebungsvariable gewinnt", () => {
    expect(B.snapshotPfad({})).toBe(join(tmpdir(), "claude-rate-limits.json"));
    expect(B.snapshotPfad({ FACTORY_RATE_LIMITS_SNAPSHOT: "/x/s.json" })).toBe("/x/s.json");
  });
  test("standPfad braucht nur praefixe.worktree: ohne Agenten-, Branch- und Label-Schlüssel entsteht der Pfad, ohne Worktree-Präfix nicht", () => {
    const nurWt: Cfg = { praefixe: { worktree: "ab-" } };
    expect(M.standPfad("/dev/proj", {}, "/tmp", nurWt)).toContain(join("/tmp", "ab-mcp-ausfall-"));
    expect(() => M.standPfad("/dev/proj", {}, "/tmp", { praefixe: { branch: "feature/ab-" }, agenten: AB.agenten })).toThrow(/praefixe\.worktree/);
  });
  test("standPfad: <praefixe.worktree>mcp-ausfall-…; ohne Schlüssel Abbruch; die Umgebungsvariable gewinnt", () => {
    expect(M.standPfad("/dev/proj", {}, "/tmp", AB)).toContain(join("/tmp", "ab-mcp-ausfall-"));
    expect(() => M.standPfad("/dev/proj", {}, "/tmp", OHNE_WT)).toThrow(/praefixe\.worktree/);
    expect(M.standPfad("/dev/proj", { FACTORY_MCP_AUSFALL_STAND: "/y/s.json" }, "/tmp", OHNE_WT)).toBe("/y/s.json");
  });
  describe("mcp-ausfall main", () => {
    let wurzel = "";
    afterEach(() => wurzel && rmSync(wurzel, { recursive: true, force: true }));
    const lauf = (config: Cfg) => {
      wurzel = mkdtempSync(join(tmpdir(), "lz-ausfall-"));
      writeFileSync(join(wurzel, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
      const aus: string[] = [];
      const env = { CLAUDE_PROJECT_DIR: wurzel, FACTORY_MCP_LOG_DIR: join(wurzel, "logs") };
      const code = M.main(["--sessionstart"], env, (t) => aus.push(t), { config });
      return { code, aus: aus.join("\n"), stand: M.standPfad(wurzel, env, tmpdir(), AB) };
    };
    test("mit Config entsteht die Stand-Datei mit dem Präfix ab-", () => {
      const r = lauf(AB);
      try {
        expect(r.code).toBe(0);
        expect(existsSync(r.stand)).toBe(true);
      } finally {
        rmSync(r.stand, { force: true });
      }
    });
    test("ohne praefixe.worktree: Exit 0, Zeile mit Grund, keine Stand-Datei", () => {
      const r = lauf(OHNE_WT);
      expect(r.code).toBe(0);
      LIES_FEHLER(r.aus);
      expect(existsSync(r.stand)).toBe(false);
      expect(readdirSync(tmpdir()).filter((n) => n.startsWith("ab-mcp-ausfall-") && r.stand.endsWith(n))).toEqual([]);
    });
  });
});

describe("haupt-sync: Skill-Verzeichnis als Kern-Pfad (#1748)", () => {
  test("ordneHarnessAenderungen: der feste Rollen-Pfad factory-ticket/ zählt als Skill, ein anderes Skill-Verzeichnis (demo/) als sonstige", () => {
    const dateien = [".claude/skills/demo/SKILL.md", ".agents/skills/factory-ticket/SKILL.md", "AGENTS.md"];
    const r = H.ordneHarnessAenderungen(dateien);
    expect(r.skill).toEqual([".agents/skills/factory-ticket/SKILL.md", "AGENTS.md"]);
    expect(r.sonstige).toEqual([".claude/skills/demo/SKILL.md"]);
    const mitZweitem = H.ordneHarnessAenderungen as (d: string[], verz: string) => { skill: string[]; sonstige: string[] };
    expect(mitZweitem(dateien, ".claude/skills/demo/")).toEqual(r);
  });
  test("baueText nennt die SKILL.md aus dem Diff; nur AGENTS.md ergibt den allgemeinen Hinweis ohne erfundenen Pfad", () => {
    const mit = H.baueText({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [".claude/skills/demo/SKILL.md"], agenten: [], sonstige: [], lockGeaendert: false } }, { sitzungsbasis: false });
    expect(mit).toContain("`.claude/skills/demo/SKILL.md` jetzt neu lesen");
    const nurAgents = H.baueText({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: ["AGENTS.md"], agenten: [], sonstige: [], lockGeaendert: false } }, { sitzungsbasis: false });
    expect(nurAgents).toContain("Den Ticket-Skill jetzt neu lesen");
    expect(nurAgents).not.toContain("SKILL.md");
  });
  test("Kern-Pfad: das Verzeichnis gilt als Skill, auch ohne agenten.ticketSkill; die Config meldet den Grund weiter", () => {
    expect(H.TICKET_SKILL_VERZEICHNIS).toBe(".agents/skills/factory-ticket/");
    expect(H.ordneHarnessAenderungen([".agents/skills/factory-ticket/SKILL.md", ".claude/skills/ab/SKILL.md"]).skill).toEqual([".agents/skills/factory-ticket/SKILL.md"]);
    expect(H.configGrund({ config: OHNE_SKILL })).toMatch(/agenten\.ticketSkill[\s\S]*Fix:/);
    expect(H.configGrund({ config: AB })).toBeNull();
  });
  test("Fitness: das Verzeichnis der echten Config existiert (rot, sobald eine Umbenennung es verschiebt)", () => {
    expect(lies(`${H.TICKET_SKILL_VERZEICHNIS}SKILL.md`).length).toBeGreaterThan(0);
  });
});
