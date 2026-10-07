/* Stop-Worktree-Cleanup-Hook (#708/#909/#952) — Stop-Hook, der verwaiste
 * Worktree-Ordner aufräumt.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Der frühere verify-Frühindikator (#708 Haupt-Checkout, #909 Linked Worktrees)
 * wurde entfernt (Maintainerin-Wunsch, 2026-08-05); PR-/CI-Gate + pre-push-Hook
 * sind die maßgebliche Mauer. Übrig bleibt das stille Waisen-Cleanup (#952).
 *
 * Die Erkennungslogik lebt in scripts/stop-verify-hook.mjs (EINE Quelle für
 * Hook-CLI und Test). git/fs werden NICHT ausgeführt — die IO ist injiziert,
 * damit der Test deterministisch und ohne echten Repo-Zustand läuft.
 *
 * Ausführen mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hook from "../../scripts/stop-verify-hook.mjs";

const parseStopInput: (text: string) => { stopHookActive: boolean } = hook.parseStopInput;
const repoRootFromScriptUrl: (url: string) => string = hook.repoRootFromScriptUrl;

// ── parseStopInput ────────────────────────────────────────────────────────────

describe("parseStopInput (#708)", () => {
  test("stop_hook_active:true → stopHookActive true", () => {
    const r = parseStopInput(JSON.stringify({ stop_hook_active: true }));
    assert.equal(r.stopHookActive, true);
  });

  test("stop_hook_active:false → stopHookActive false", () => {
    const r = parseStopInput(JSON.stringify({ stop_hook_active: false }));
    assert.equal(r.stopHookActive, false);
  });

  test("leeres JSON-Objekt → stopHookActive false", () => {
    assert.equal(parseStopInput("{}").stopHookActive, false);
  });

  test("kaputtes JSON → stopHookActive false (kein Absturz)", () => {
    assert.equal(parseStopInput("KEIN JSON").stopHookActive, false);
  });

  test("leerer String → stopHookActive false", () => {
    assert.equal(parseStopInput("").stopHookActive, false);
  });
});

// ── repoRootFromScriptUrl (Smoke) ────────────────────────────────────────────

describe("repoRootFromScriptUrl", () => {
  test("leitet Repo-Root korrekt aus scripts/-Pfad ab (zwei Ebenen hoch)", () => {
    // Das Skript liegt in scripts/ (eine Ebene unter Root). Wir leiten seine echte URL
    // aus import.meta.url des TESTS ab (test/harness/<datei> → scripts/stop-verify-hook.mjs),
    // damit der Pfad auf der aktuellen Plattform gültig ist.
    const scriptUrl = import.meta.url.replace(/\/test\/harness\/[^/]+$/, "/scripts/stop-verify-hook.mjs");
    const root = repoRootFromScriptUrl(scriptUrl);
    // Exakt der Repo-Root (zwei Ebenen über diesem Test). Der frühere Check „enthält
    // kubernia, endet nicht auf /scripts" blieb grün, wenn die Regex oben nicht traf
    // und der Root auf …/test fiel (Review #1177).
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "");
    assert.equal(norm(root), norm(fileURLToPath(new URL("../../", import.meta.url))));
  });
});


// ── checkAndFixOrphanWorktrees (#908/#952) + Datenverlust-Nachpruefung (#1051) ─

describe("checkAndFixOrphanWorktrees (#908/#952)", () => {
  type Dirent = { name: string; isDirectory: () => boolean; isSymbolicLink?: () => boolean };
  type OrphanDeps = {
    execSync?: (cmd: string, opts?: object) => string;
    existsSync?: (path: string) => boolean;
    readdirSync?: () => Dirent[];
    rmSync?: (path: string) => void;
    lstatSync?: (path: string) => { isDirectory: () => boolean; isSymbolicLink: () => boolean };
  };

  const NUL = String.fromCharCode(0); // git status -z trennt mit NUL statt Zeilenumbruch

  const MAIN = "/root";
  const WT = "/root/.claude/worktrees";

  /** Fake-IO. Bewusst PFADBASIERT statt per Aufruf-Zaehler (#1051): der Guard
   *  schiebt fs-Aufrufe dazwischen, eine Zaehler-Attrappe waere danach aus dem
   *  falschen Grund rot und wuerde echte Regressionen verdecken. */
  function makeDeps(opts: {
    orphanName: string | null;
    existsAfterRm: boolean;
    statusBefore?: string[];
    statusAfter?: string[];
    symlink?: boolean;
  }): OrphanDeps {
    let statusCalls = 0;
    return {
      execSync: (cmd: string) => {
        if (cmd.includes("worktree list")) {
          return "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n";
        }
        if (cmd.includes("status --porcelain")) {
          // Pathspec-Pin: ohne ihn wuerde repo-weit gemessen (Fehlalarm-Risiko).
          if (!cmd.includes("-- .claude")) throw new Error("Pathspec -- .claude fehlt");
          statusCalls++;
          const eintraege = statusCalls === 1 ? (opts.statusBefore ?? []) : (opts.statusAfter ?? []);
          return eintraege.map((e) => e + NUL).join("");
        }
        return "";
      },
      // Der Worktrees-Ordner existiert immer; der Waisen-Pfad je nach Szenario.
      existsSync: (path: string) =>
        path.replace(/\\/g, "/") === WT ? true : opts.existsAfterRm,
      readdirSync: () =>
        opts.orphanName
          ? [{ name: opts.orphanName, isDirectory: () => !opts.symlink, isSymbolicLink: () => Boolean(opts.symlink) }]
          : [],
      rmSync: () => {},
      lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    };
  }

  const checkAndFixOrphanWorktrees: (
    repoRoot: string,
    deps?: OrphanDeps
  ) => {
    blocked: boolean;
    reason?: string;
    removed?: string[];
  } = hook.checkAndFixOrphanWorktrees;

  test("keine Waisen-Ordner vorhanden, blocked false", () => {
    const result = checkAndFixOrphanWorktrees(
      MAIN,
      makeDeps({ orphanName: null, existsAfterRm: false })
    );
    assert.equal(result.blocked, false);
  });

  test("Waisen-Ordner gefunden und erfolgreich geloescht, blocked false, still", () => {
    const result = checkAndFixOrphanWorktrees(
      MAIN,
      makeDeps({ orphanName: "kq-862", existsAfterRm: false })
    );
    assert.equal(result.blocked, false);
    assert.deepEqual(result.removed, ["kq-862"]);
  });

  test("Waisen-Ordner gefunden, Loeschen schlaegt fehl (Datei-Lock), blocked true mit Ordnername in reason", () => {
    const result = checkAndFixOrphanWorktrees(
      MAIN,
      makeDeps({ orphanName: "kq-862", existsAfterRm: true })
    );
    assert.equal(result.blocked, true);
    assert.ok(result.reason?.includes("kq-862"), `reason sollte kq-862 nennen: ${result.reason}`);
  });

  test("git worktree list schlaegt fehl, fail-open, blocked false", () => {
    const deps: OrphanDeps = {
      execSync: () => {
        throw new Error("kein git");
      },
    };
    assert.equal(checkAndFixOrphanWorktrees(MAIN, deps).blocked, false);
  });

  // ── Datenverlust-Nachpruefung (#1051) ─────────────────────────────────────
  // Nur NEU hinzugekommene Loeschungen zaehlen -- ein Turn darf legitim mit
  // eigenen enden. Eintraege sind eine LISTE, erst im Fake NUL-verkettet: als
  // Zeilen-String waeren sie EIN Eintrag und die Tests gruen aus falschem Grund.
  const STATUS: Array<{ was: string; before: string[]; after: string[]; blockt: boolean }> = [
    { was: "unveraenderter Status", before: [" M src/game.ts"], after: [" M src/game.ts"], blockt: false },
    { was: "Loeschung war VORHER schon da (agenten-eigene, kein Fehlalarm)", before: [" D docs/alt.md"], after: [" D docs/alt.md"], blockt: false },
    { was: "Loeschung erst NACHHER (der eigentliche Alarm)", before: [], after: [" D .claude/settings.json", " D .claude/skills/kubernia/SKILL.md"], blockt: true },
    { was: "gestagete Loeschung (D im ersten Spaltenzeichen)", before: [], after: ["D  .claude/settings.json"], blockt: true },
    { was: "untracked-Eintrag, dessen Pfad mit D beginnt: kein Fehlalarm", before: [], after: ["?? Dokumente/neu.md"], blockt: false },
    { was: "nur eine von zwei Loeschungen ist neu", before: [" D docs/alt.md"], after: [" D docs/alt.md", " D .claude/settings.json"], blockt: true },
  ];

  for (const { was, before, after, blockt } of STATUS) {
    test(`Datenverlust-Check: ${was} → blocked ${blockt}`, () => {
      const result = checkAndFixOrphanWorktrees(
        MAIN,
        makeDeps({
          orphanName: "kq-862",
          existsAfterRm: false,
          statusBefore: before,
          statusAfter: after,
        })
      );
      assert.equal(result.blocked, blockt, `${was}: reason war "${result.reason}"`);
    });
  }

  test("der Alarm nennt den Pfad UND den gequoteten Wiederherstellungs-Befehl", () => {
    const result = checkAndFixOrphanWorktrees(
      MAIN,
      makeDeps({
        orphanName: "kq-862",
        existsAfterRm: false,
        statusBefore: [],
        statusAfter: [" D .claude/mit leerzeichen.json"],
      })
    );
    assert.ok(
      result.reason?.includes('git -C /root checkout -- ".claude/mit leerzeichen.json"'),
      `Pfad muss gequotet sein, sonst zerfaellt der Befehl: ${result.reason}`
    );
  });

  test("mehrere Loeschungen werden EINZELN erkannt und einzeln gequotet", () => {
    // Schaerft die NUL-Trennung: bei Zeilen-Split waeren beide Eintraege EIN Pfad.
    const result = checkAndFixOrphanWorktrees(
      MAIN,
      makeDeps({
        orphanName: "kq-862",
        existsAfterRm: false,
        statusBefore: [],
        statusAfter: [" D .claude/a.json", " D .claude/b.json"],
      })
    );
    assert.ok(
      result.reason?.includes('git -C /root checkout -- ".claude/a.json" ".claude/b.json"'),
      `beide Pfade muessen einzeln gequotet sein: ${result.reason}`
    );
    assert.ok(result.reason?.includes("2 versionierte"), `Anzahl falsch: ${result.reason}`);
  });

  test("git status wirft, fail-open, blocked false statt jeden Turn zu blockieren", () => {
    const deps: OrphanDeps = {
      ...makeDeps({ orphanName: "kq-862", existsAfterRm: false }),
      execSync: (cmd: string) => {
        if (cmd.includes("worktree list")) {
          return "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n";
        }
        if (cmd.includes("status --porcelain")) throw new Error("kein git");
        return "";
      },
    };
    assert.equal(checkAndFixOrphanWorktrees(MAIN, deps).blocked, false);
  });

  test("keine Waisen, git status wird NICHT aufgerufen, null Zusatz-Latenz im Normalfall", () => {
    let statusCalls = 0;
    const deps: OrphanDeps = {
      execSync: (cmd: string) => {
        if (cmd.includes("status --porcelain")) statusCalls++;
        return cmd.includes("worktree list")
          ? "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n"
          : "";
      },
      existsSync: () => false,
    };
    checkAndFixOrphanWorktrees(MAIN, deps);
    assert.equal(statusCalls, 0, "ohne Waisen darf kein git status laufen");
  });

  test("Junction OHNE Waise blockt, ruft aber KEIN git status, deckt den Latenz-Wrapper", () => {
    // Ohne diesen Fall bliebe `if (orphans.length > 0)` ungetestet (#1051).
    let statusCalls = 0;
    const base = makeDeps({ orphanName: "kq-junction", existsAfterRm: false, symlink: true });
    const deps: OrphanDeps = {
      ...base,
      execSync: (cmd: string) => {
        if (cmd.includes("status --porcelain")) statusCalls++;
        return base.execSync?.(cmd) ?? "";
      },
    };
    const result = checkAndFixOrphanWorktrees(MAIN, deps);
    assert.equal(result.blocked, true);
    assert.equal(statusCalls, 0, "ohne Waisen kein git status, auch wenn eine Junction blockt");
  });

  test("Waise UND Junction zugleich, beide Gruende stehen in reason", () => {
    // Mischzustand: `problems.join` war ungetestet, problems[0] blieb gruen (#1051).
    const deps: OrphanDeps = {
      ...makeDeps({ orphanName: "kq-locked", existsAfterRm: true }),
      readdirSync: () => [
        { name: "kq-locked", isDirectory: () => true, isSymbolicLink: () => false },
        { name: "kq-junction", isDirectory: () => false, isSymbolicLink: () => true },
      ],
    };
    const result = checkAndFixOrphanWorktrees(MAIN, deps);
    assert.equal(result.blocked, true);
    assert.ok(result.reason?.includes("kq-locked"), `Datei-Lock fehlt: ${result.reason}`);
    assert.ok(result.reason?.includes("kq-junction"), `Junction fehlt: ${result.reason}`);
  });

  // ── Junction an Worktree-Stelle (#1051) ───────────────────────────────────

  test("Symlink an Worktree-Stelle, blocked true mit Aufloese-Befehl, nie geloescht", () => {
    let rmCalls = 0;
    const deps: OrphanDeps = {
      ...makeDeps({ orphanName: "kq-junction", existsAfterRm: false, symlink: true }),
      rmSync: () => {
        rmCalls++;
      },
    };
    const result = checkAndFixOrphanWorktrees(MAIN, deps);
    assert.equal(result.blocked, true);
    assert.equal(rmCalls, 0, "eine Junction wird NIE geloescht, nur gemeldet");
    assert.ok(result.reason?.includes("kq-junction"), `Name fehlt: ${result.reason}`);
    assert.ok(result.reason?.includes("rmdir"), `Aufloese-Befehl fehlt: ${result.reason}`);
  });

  test("Schutzgurt verweigert ein Ziel, blocked true, Begruendung in reason", () => {
    const deps: OrphanDeps = {
      ...makeDeps({ orphanName: "kq-862", existsAfterRm: false }),
      lstatSync: () => {
        throw new Error("ENOENT");
      },
    };
    const result = checkAndFixOrphanWorktrees(MAIN, deps);
    assert.equal(result.blocked, true);
    assert.ok(result.reason?.includes("kq-862"), `Name fehlt: ${result.reason}`);
  });
});

// ── SubagentStop + Ausgabeformat (#1309) ──────────────────────────────────────

type HookErgebnis = { exit: number; stdout: string; stderr: string };
type RunHook = (
  stdin: string,
  root: string,
  check?: (r: string) => { blocked: boolean; reason?: string },
  abschlussDeps?: { prStatus?: (nr: string) => { state: string; autoMergeRequest: object | null } },
) => HookErgebnis;
const runHook = (hook as unknown as { runHook: RunHook }).runHook;
const geblockt = () => ({ blocked: true, reason: "Waise kq-1" });
const frei = () => ({ blocked: false });

describe("runHook – Ausgabe bei Block und Freigabe (#1309)", () => {
  test("blockiert: decision+reason auf stdout, Grund auf stderr, Exit 2", () => {
    const r = runHook("{}", "/x", geblockt);
    assert.equal(r.exit, 2);
    assert.deepEqual(JSON.parse(r.stdout), { decision: "block", reason: "Waise kq-1" });
    assert.equal(r.stderr, "Waise kq-1");
  });

  test("nicht blockiert: Exit 0 und keine Ausgabe", () => {
    assert.deepEqual(runHook("{}", "/x", frei), { exit: 0, stdout: "", stderr: "" });
  });

  test("SubagentStop-Payload mit stop_hook_active:true gibt frei, auch wenn geblockt würde (kein Endlos-Block)", () => {
    const payload = JSON.stringify({ hook_event_name: "SubagentStop", agent_type: "kubernia-umsetzer", stop_hook_active: true });
    assert.deepEqual(runHook(payload, "/x", geblockt), { exit: 0, stdout: "", stderr: "" });
    const ohne = JSON.stringify({ hook_event_name: "SubagentStop", agent_type: "kubernia-umsetzer", stop_hook_active: false });
    assert.equal(runHook(ohne, "/x", geblockt).exit, 2, "ohne stop_hook_active blockt derselbe Hook");
  });

  test("kaputtes stdin-JSON blockt nicht pauschal frei, sondern prüft", () => {
    assert.equal(runHook("{kaputt", "/x", geblockt).exit, 2);
  });
});

describe("runHook – Umsetzer-Abschluss (#1331)", () => {
  const payload = (ergebnis: string, extra = {}) =>
    JSON.stringify({ hook_event_name: "SubagentStop", agent_type: "kubernia-umsetzer", last_assistant_message: `ERGEBNIS: ${ergebnis}
PR: https://github.com/x/y/pull/7`, ...extra });
  const offen = () => ({ state: "OPEN", autoMergeRequest: { enabledAt: "x" } });

  test("offener PR mit Auto-Merge blockiert den Umsetzer auch bei sauberem Worktree-Cleanup", () => {
    const r = runHook(payload("abgebrochen"), "/x", frei, { prStatus: offen });
    assert.equal(r.exit, 2);
    assert.match((JSON.parse(r.stdout) as { reason: string }).reason, /noch offen und hat Auto-Merge/);
  });

  test("beide Gründe werden zusammengeführt", () => {
    const r = runHook(payload("gemergt"), "/x", geblockt, { prStatus: offen });
    assert.match(r.stderr, /Waise kq-1 \| .*Auto-Merge/);
  });

  test("festgefahren bei offenem PR: nur mit Label status:festgefahren frei (#1342)", () => {
    assert.equal(runHook(payload("festgefahren"), "/x", frei, { prStatus: offen }).exit, 2);
    assert.equal(runHook(payload("festgefahren"), "/x", frei, { prStatus: () => ({ state: "OPEN", autoMergeRequest: null, labels: [{ name: "status:festgefahren" }] }) }).exit, 0);
  });

  test("frei bei stop_hook_active und bei gh-Fehler", () => {
    assert.equal(runHook(payload("abgebrochen", { stop_hook_active: true }), "/x", frei, { prStatus: offen }).exit, 0);
    assert.equal(runHook(payload("abgebrochen"), "/x", frei, { prStatus: () => { throw new Error("x"); } }).exit, 0);
  });
});

describe("settings.json hängt den Hook auch an das Ende des Umsetzers (#1309)", () => {
  test("SubagentStop mit Matcher kubernia-umsetzer startet stop-verify-hook.mjs", async () => {
    const { readFileSync } = await import("node:fs");
    const s = JSON.parse(readFileSync(fileURLToPath(new URL("../../.claude/settings.json", import.meta.url)), "utf8")) as {
      hooks: Record<string, { matcher?: string; hooks: { command: string; args: string[] }[] }[]>;
    };
    const eintrag = s.hooks.SubagentStop?.find((e) => e.matcher === "kubernia-umsetzer");
    assert.ok(eintrag, "hooks.SubagentStop mit matcher kubernia-umsetzer fehlt");
    assert.ok(eintrag.hooks.some((h) => h.args.some((a) => a.endsWith("scripts/stop-verify-hook.mjs"))));
    assert.ok(s.hooks.Stop?.some((e) => e.hooks.some((h) => h.args.some((a) => a.endsWith("scripts/stop-verify-hook.mjs")))), "der Stop-Hook des Hauptchats bleibt");
  });

  test("Umsetzer und Skill sagen, was bei einer Blockade zu tun ist", async () => {
    const { readFileSync } = await import("node:fs");
    const lies = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
    assert.match(lies(".claude/agents/kubernia-umsetzer.md"), /SubagentStop-Hook/);
    assert.match(lies(".claude/skills/kubernia/SKILL.md"), /cleanup-worktrees\.mjs --fix/);
    assert.match(lies(".claude/skills/kubernia/SKILL.md"), /git diff --quiet <Sitzungsbasis> origin\/main -- \.claude\/agents \.claude\/skills/);
    assert.match(lies(".claude/skills/review-lenses/SKILL.md"), /Agent type 'kubernia-lens' not found/);
  });
});

// ── Leerer gesperrter Ordner warnt nur, nicht leerer nennt Halter (#1411) ─────

describe("Stop-Hook: leerer gesperrter Waisen-Ordner und Halter-Meldung (#1411)", () => {
  type Deps = Record<string, unknown>;
  type Check = (root: string, deps?: Deps) => { blocked: boolean; reason?: string; warning?: string; removed?: string[] };
  const check = (hook as unknown as { checkAndFixOrphanWorktrees: Check }).checkAndFixOrphanWorktrees;
  const WT = "/root/.claude/worktrees";
  const basisDeps = (inhalt: string[]): Deps => ({
    execSync: (cmd: string) => (cmd.includes("worktree list") ? "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n" : ""),
    existsSync: () => true, // der Ordner bleibt nach dem Löschversuch bestehen
    // Wurzel-Listing: ein Waisen-Ordner; Listing des Ordners selbst: `inhalt`
    readdirSync: (p: string) =>
      String(p).replace(/\\/g, "/") === WT ? [{ name: "kq-1404", isDirectory: () => true, isSymbolicLink: () => false }] : inhalt,
    rmSync: () => {},
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    platform: "win32",
    listProcesses: () => [{ pid: 4711, ppid: 999, name: "python3.exe", commandLine: "python3 -", startMs: Date.now() + 10_000 }],
    statSync: () => ({ birthtimeMs: 0, mtimeMs: 0 }),
  });

  test("leerer, gesperrter Ordner: kein Block, nur eine Warnung (der nächste Stop versucht es erneut)", () => {
    const r = check("/root", basisDeps([]));
    assert.equal(r.blocked, false);
    assert.match(r.warning ?? "", /kq-1404.*leer.*nächste Stop/);
  });

  test("nicht leerer, gesperrter Ordner: Block, nennt den möglichen Halter mit PID und rät nie zum Kill per Name", () => {
    const r = check("/root", basisDeps(["datei.txt"]));
    assert.equal(r.blocked, true);
    assert.match(r.reason ?? "", /kq-1404/);
    assert.match(r.reason ?? "", /PID 4711 python3\.exe/);
    assert.match(r.reason ?? "", /Stop-Process -Id <pid>/);
    assert.ok(!/Stop-Process -Name/.test(r.reason ?? ""), "kein pauschaler Kill per Name");
  });

  test("runHook: Warnung gibt den Stop frei (exit 0) und geht als systemMessage raus, nicht als Block", () => {
    const warn = () => ({ blocked: false, warning: "Worktree-Ordner kq-1 ist leer, aber gerade gesperrt." });
    const r = (hook as unknown as { runHook: (s: string, root: string, c: typeof warn) => { exit: number; stdout: string; stderr: string } }).runHook("{}", "/root", warn);
    assert.equal(r.exit, 0);
    assert.deepEqual(JSON.parse(r.stdout), { systemMessage: "Worktree-Ordner kq-1 ist leer, aber gerade gesperrt." });
    assert.equal(r.stderr, "");
    const still = (hook as unknown as { runHook: (s: string, root: string, c: () => object) => { exit: number; stdout: string } }).runHook("{}", "/root", () => ({ blocked: false }));
    assert.deepEqual([still.exit, still.stdout], [0, ""]);
  });
});

// ── Kein pauschaler Prozess-Kill per Name im Agenten-Kontext (#1411) ───────────

describe("Wächter: keine Anleitung zum Kill per Name (#1411)", () => {
  // Parallele Agenten laufen in anderen Worktrees; ein Kill per Name (`Stop-Process -Name`, `taskkill /IM`) beendet ihre
  // Prozesse mit. Erlaubt ist nur der gezielte Kill per PID (`Stop-Process -Id`).
  const VERBOTEN = /Stop-Process\s+-Name\b|taskkill\s+\/IM\b/i;

  /** Texte der Agenten-Anweisungen, Docs, Hooks und Skripte, in denen eine solche Anleitung stehen könnte. */
  async function texte(): Promise<Record<string, string>> {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const wurzel = fileURLToPath(new URL("../../", import.meta.url));
    const out: Record<string, string> = { "AGENTS.md": readFileSync(join(wurzel, "AGENTS.md"), "utf8") };
    const sammle = (rel: string, passt: (n: string) => boolean) => {
      for (const e of readdirSync(join(wurzel, rel), { withFileTypes: true })) {
        const p = join(wurzel, rel, e.name);
        if (e.isDirectory()) {
          if (e.name !== "worktrees" && e.name !== "node_modules") sammle(relative(wurzel, p), passt); // fremde Worktrees sind nicht dieser Stand
        }
        else if (passt(e.name) && e.name !== "settings.local.json" && statSync(p).size < 2_000_000) out[relative(wurzel, p).replace(/\\/g, "/")] = readFileSync(p, "utf8");
      }
    };
    sammle("docs", (n) => /^agent-harness.*\.md$/.test(n));
    sammle(".claude", (n) => /\.(md|js|mjs|json)$/.test(n));
    sammle("scripts", (n) => /\.mjs$/.test(n));
    return out;
  }

  test("kein Dokument, Skill, Workflow, Agent und Skript rät zu `Stop-Process -Name` oder `taskkill /IM`", async () => {
    const treffer = Object.entries(await texte())
      .filter(([, t]) => VERBOTEN.test(t))
      .map(([pfad]) => pfad);
    assert.deepEqual(treffer, [], "Kill per Name beendet auch Prozesse paralleler Agenten: gezielt per PID (`Stop-Process -Id`)");
  });

  test("Red-Green: das Muster erkennt beide Formen und lässt den Kill per PID zu", () => {
    assert.ok(VERBOTEN.test("pwsh: Stop-Process -Name node -Force"));
    assert.ok(VERBOTEN.test("cmd: taskkill /IM node.exe /F"));
    assert.ok(VERBOTEN.test("stop-process  -name python"));
    assert.ok(!VERBOTEN.test("Stop-Process -Id 4711"));
    assert.ok(!VERBOTEN.test("nie per Name (Stop-Process -Id <pid>)"));
  });
});

describe("checkAndFixOrphanWorktrees: Lens-Worktrees ohne Feature-Worktree (#1425)", () => {
  const MAIN = "/root";
  const WT = "/root/.claude/worktrees";
  const JETZT = 50_000_000;
  const porcelain = (pfade: string[]) => pfade.map((p) => `worktree ${p}\nHEAD abc\n`).join("\n");
  const check = (hook as unknown as {
    checkAndFixOrphanWorktrees: (root: string, deps: object) => { blocked: boolean; reason?: string; removed?: string[] };
  }).checkAndFixOrphanWorktrees;

  function deps(start: string[], opts: { alterMs?: number; klemmt?: boolean } = {}) {
    const registriert = new Set(start);
    const befehle: string[] = [];
    return {
      befehle,
      deps: {
        now: JETZT,
        execSync: (cmd: string) => {
          befehle.push(cmd);
          if (cmd.includes("worktree list")) return porcelain([...registriert]);
          if (cmd.includes("status --porcelain")) return "";
          const m = /worktree remove --force "([^"]+)"/.exec(cmd);
          if (m && opts.klemmt) throw new Error("gesperrt");
          if (m) registriert.delete(m[1].replace(/\\/g, "/"));
          return "";
        },
        existsSync: (p: string) => p.replace(/\\/g, "/") === WT || registriert.has(p.replace(/\\/g, "/")),
        readdirSync: () => [...registriert].filter((p) => p.startsWith(`${WT}/`)).map((p) => ({ name: p.slice(WT.length + 1), isDirectory: () => true, isSymbolicLink: () => false })),
        statSync: () => ({ mtimeMs: JETZT - (opts.alterMs ?? 10 * 60_000), birthtimeMs: 1 }),
        lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
        rmSync: () => {},
        platform: "linux",
      },
    };
  }

  test("verwaister, alter Lens-Worktree wird entfernt, der Stop bleibt frei", () => {
    const g = deps([MAIN, `${WT}/kq-7-lens-r1`]);
    const r = check(MAIN, g.deps);
    assert.equal(r.blocked, false);
    assert.deepEqual(r.removed, ["kq-7-lens-r1"]);
    assert.ok(g.befehle.some((c) => c.includes("worktree remove --force")));
  });

  test("bleibt unberührt: Lens-Worktree mit Feature-Worktree, junger Lens-Worktree", () => {
    const mitEltern = deps([MAIN, `${WT}/kq-7`, `${WT}/kq-7-lens-r1`]);
    assert.equal(check(MAIN, mitEltern.deps).blocked, false);
    assert.ok(!mitEltern.befehle.some((c) => c.includes("worktree remove")));
    const jung = deps([MAIN, `${WT}/kq-8-lens-r1`], { alterMs: 60_000 });
    assert.equal(check(MAIN, jung.deps).blocked, false);
    assert.ok(!jung.befehle.some((c) => c.includes("worktree remove")));
  });

  test("scheitert das Entfernen, blockiert der Stop mit Namen und Hinweis auf --fix", () => {
    const g = deps([MAIN, `${WT}/kq-9-lens-r2`], { klemmt: true });
    const r = check(MAIN, g.deps);
    assert.equal(r.blocked, true);
    assert.match(r.reason ?? "", /kq-9-lens-r2/);
    assert.match(r.reason ?? "", /cleanup-worktrees\.mjs --fix/);
  });

  test("git-Fehler bei `worktree list`: fail-open", () => {
    const r = check(MAIN, { execSync: () => { throw new Error("kein git"); } });
    assert.equal(r.blocked, false);
  });
});
