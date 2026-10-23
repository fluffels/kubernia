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
import { describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { lies, repoDateien } from "./repo-texte";
import { liesMitProjektwerten } from "../support/ticket-ablauf";
import { FREMD, FREMD_NAMEN, projektConfig } from "../support/fremd-config";

// Zähler der PowerShell-Starts (#1526): bei einem gesperrten Waisen-Ordner fragt `checkAndFixOrphanWorktrees` unter Windows
// die Prozessliste per `powershell` (WMI) ab; ein Start kostet ~600 ms und riss unter Parallellast den Timeout. Die Tests
// injizieren darum `listProcesses` (`ohnePowershell`); der letzte Test dieser Datei belegt, dass nie ein echter Start passiert (nur unter Windows aussagekräftig, `listProcessesWindows` läuft sonst nie; bewusst der letzte Test, mit `-t`-Filter läuft er leer).
const powershellStarts = vi.hoisted(() => ({ n: 0 }));
vi.mock("node:child_process", async (importOriginal) => {
  const echt = await importOriginal<typeof import("node:child_process")>();
  const execFileSync = (file: string, ...rest: unknown[]): unknown => {
    if (/^powershell/i.test(file)) powershellStarts.n++;
    return (echt.execFileSync as unknown as (...a: unknown[]) => unknown)(file, ...rest);
  };
  return { ...echt, execFileSync };
});

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hook from "../../scripts/stop-verify-hook.mjs";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRoh from "../../scripts/ticket-namen.mjs";

const { escapeRegex } = namenRoh as unknown as { escapeRegex: (t: string) => string };
/** Worktree-Präfix der Fremd-Config: alle Ordner- und Dateinamen dieser Datei leiten sich daraus ab. */
const W = FREMD.praefixe.worktree;
const NAMEN = FREMD_NAMEN;

const checkRoh = (hook as unknown as { checkAndFixOrphanWorktrees: unknown }).checkAndFixOrphanWorktrees;

/** Gibt `checkAndFixOrphanWorktrees` mit leerer Prozessliste als Vorgabe zurück; eigene `listProcesses`-Fakes der Tests gewinnen. */
const ohnePowershell = <F>(f: unknown): F =>
  ((root: string, deps?: object) => (f as (r: string, d: object) => unknown)(root, { listProcesses: () => [], namen: NAMEN, ...deps })) as unknown as F;

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
    // den Repo-Namen, endet nicht auf /scripts" blieb grün, wenn die Regex oben nicht traf
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
  } = ohnePowershell(checkRoh);

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
      makeDeps({ orphanName: `${W}862`, existsAfterRm: false })
    );
    assert.equal(result.blocked, false);
    assert.deepEqual(result.removed, [`${W}862`]);
  });

  test("Waisen-Ordner gefunden, Loeschen schlaegt fehl (Datei-Lock), blocked true mit Ordnername in reason", () => {
    const result = checkAndFixOrphanWorktrees(
      MAIN,
      makeDeps({ orphanName: `${W}862`, existsAfterRm: true })
    );
    assert.equal(result.blocked, true);
    assert.ok(result.reason?.includes(`${W}862`), `reason sollte ${W}862 nennen: ${result.reason}`);
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
    { was: "Loeschung erst NACHHER (der eigentliche Alarm)", before: [], after: [" D .claude/settings.json", " D .claude/skills/demo/SKILL.md"], blockt: true },
    { was: "gestagete Loeschung (D im ersten Spaltenzeichen)", before: [], after: ["D  .claude/settings.json"], blockt: true },
    { was: "untracked-Eintrag, dessen Pfad mit D beginnt: kein Fehlalarm", before: [], after: ["?? Dokumente/neu.md"], blockt: false },
    { was: "nur eine von zwei Loeschungen ist neu", before: [" D docs/alt.md"], after: [" D docs/alt.md", " D .claude/settings.json"], blockt: true },
  ];

  for (const { was, before, after, blockt } of STATUS) {
    test(`Datenverlust-Check: ${was} → blocked ${blockt}`, () => {
      const result = checkAndFixOrphanWorktrees(
        MAIN,
        makeDeps({
          orphanName: `${W}862`,
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
        orphanName: `${W}862`,
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
        orphanName: `${W}862`,
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
      ...makeDeps({ orphanName: `${W}862`, existsAfterRm: false }),
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
    const base = makeDeps({ orphanName: `${W}junction`, existsAfterRm: false, symlink: true });
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
      ...makeDeps({ orphanName: `${W}locked`, existsAfterRm: true }),
      readdirSync: () => [
        { name: `${W}locked`, isDirectory: () => true, isSymbolicLink: () => false },
        { name: `${W}junction`, isDirectory: () => false, isSymbolicLink: () => true },
      ],
    };
    const result = checkAndFixOrphanWorktrees(MAIN, deps);
    assert.equal(result.blocked, true);
    assert.ok(result.reason?.includes(`${W}locked`), `Datei-Lock fehlt: ${result.reason}`);
    assert.ok(result.reason?.includes(`${W}junction`), `Junction fehlt: ${result.reason}`);
  });

  // ── Junction an Worktree-Stelle (#1051) ───────────────────────────────────

  test("Symlink an Worktree-Stelle, blocked true mit Aufloese-Befehl, nie geloescht", () => {
    let rmCalls = 0;
    const deps: OrphanDeps = {
      ...makeDeps({ orphanName: `${W}junction`, existsAfterRm: false, symlink: true }),
      rmSync: () => {
        rmCalls++;
      },
    };
    const result = checkAndFixOrphanWorktrees(MAIN, deps);
    assert.equal(result.blocked, true);
    assert.equal(rmCalls, 0, "eine Junction wird NIE geloescht, nur gemeldet");
    assert.ok(result.reason?.includes(`${W}junction`), `Name fehlt: ${result.reason}`);
    assert.ok(result.reason?.includes("rmdir"), `Aufloese-Befehl fehlt: ${result.reason}`);
  });

  test("Schutzgurt verweigert ein Ziel, blocked true, Begruendung in reason", () => {
    const deps: OrphanDeps = {
      ...makeDeps({ orphanName: `${W}862`, existsAfterRm: false }),
      lstatSync: () => {
        throw new Error("ENOENT");
      },
    };
    const result = checkAndFixOrphanWorktrees(MAIN, deps);
    assert.equal(result.blocked, true);
    assert.ok(result.reason?.includes(`${W}862`), `Name fehlt: ${result.reason}`);
  });
});

// ── SubagentStop + Ausgabeformat (#1309) ──────────────────────────────────────

type HookErgebnis = { exit: number; stdout: string; stderr: string };
type RunHook = (
  stdin: string,
  root: string,
  check?: (r: string) => { blocked: boolean; reason?: string },
  abschlussDeps?: { prStatus?: (nr: string) => { state: string; autoMergeRequest: object | null; labels?: { name: string }[] }; config?: unknown },
) => HookErgebnis;
const runHookRoh = (hook as unknown as { runHook: RunHook }).runHook;
/** `runHook` mit der Fremd-Config als Vorgabe (`deps.config`); eigene Deps der Tests gewinnen. */
const runHook: RunHook = (stdin, root, check, deps) => runHookRoh(stdin, root, check, { config: FREMD, ...deps });
const geblockt = () => ({ blocked: true, reason: "Waise w-1" });
const frei = () => ({ blocked: false });

describe("runHook – Ausgabe bei Block und Freigabe (#1309)", () => {
  test("blockiert: decision+reason auf stdout, Grund auf stderr, Exit 2", () => {
    const r = runHook("{}", "/x", geblockt);
    assert.equal(r.exit, 2);
    assert.deepEqual(JSON.parse(r.stdout), { decision: "block", reason: "Waise w-1" });
    assert.equal(r.stderr, "Waise w-1");
  });

  test("nicht blockiert: Exit 0 und keine Ausgabe", () => {
    assert.deepEqual(runHook("{}", "/x", frei), { exit: 0, stdout: "", stderr: "" });
  });

  test("SubagentStop-Payload mit stop_hook_active:true gibt frei, auch wenn geblockt würde (kein Endlos-Block)", () => {
    const payload = JSON.stringify({ hook_event_name: "SubagentStop", agent_type: FREMD.agenten.umsetzer, stop_hook_active: true });
    assert.deepEqual(runHook(payload, "/x", geblockt), { exit: 0, stdout: "", stderr: "" });
    const ohne = JSON.stringify({ hook_event_name: "SubagentStop", agent_type: FREMD.agenten.umsetzer, stop_hook_active: false });
    assert.equal(runHook(ohne, "/x", geblockt).exit, 2, "ohne stop_hook_active blockt derselbe Hook");
  });

  test("kaputtes stdin-JSON blockt nicht pauschal frei, sondern prüft", () => {
    assert.equal(runHook("{kaputt", "/x", geblockt).exit, 2);
  });
});

describe("runHook – Umsetzer-Abschluss (#1331)", () => {
  const payload = (ergebnis: string, extra = {}) =>
    JSON.stringify({ hook_event_name: "SubagentStop", agent_type: FREMD.agenten.umsetzer, last_assistant_message: `ERGEBNIS: ${ergebnis}
PR: https://github.com/x/y/pull/7`, ...extra });
  const offen = () => ({ state: "OPEN", autoMergeRequest: { enabledAt: "x" } });

  test("offener PR mit Auto-Merge blockiert den Umsetzer auch bei sauberem Worktree-Cleanup", () => {
    const r = runHook(payload("abgebrochen"), "/x", frei, { prStatus: offen });
    assert.equal(r.exit, 2);
    assert.match((JSON.parse(r.stdout) as { reason: string }).reason, /noch offen und hat Auto-Merge/);
  });

  test("beide Gründe werden zusammengeführt", () => {
    const r = runHook(payload("gemergt"), "/x", geblockt, { prStatus: offen });
    assert.match(r.stderr, /Waise w-1 \| .*Auto-Merge/);
  });

  test("festgefahren bei offenem PR: nur mit dem Festgefahren-Label frei (#1342)", () => {
    assert.equal(runHook(payload("festgefahren"), "/x", frei, { prStatus: offen }).exit, 2);
    assert.equal(runHook(payload("festgefahren"), "/x", frei, { prStatus: () => ({ state: "OPEN", autoMergeRequest: null, labels: [{ name: FREMD.labels.festgefahren }] }) }).exit, 0);
  });

  test("uebergabe (#1592): ein aktiver, registrierter Worktree ist keine Waise, der Stop bleibt frei; ohne Auto-Merge blockt R5", () => {
    const WT = "/root/.claude/worktrees";
    const registriert = ["/root", `${WT}/${W}1592`];
    const befehle: string[] = [];
    const echteWaisenPruefung = (root: string) =>
      (ohnePowershell<(r: string, d: object) => { blocked: boolean; reason?: string }>(checkRoh))(root, {
        now: 50_000_000,
        execSync: (cmd: string) => {
          befehle.push(cmd);
          return cmd.includes("worktree list") ? registriert.map((p) => `worktree ${p}\nHEAD abc\n`).join("\n") : "";
        },
        existsSync: (p: string) => p.replace(/\\/g, "/") === WT || registriert.includes(p.replace(/\\/g, "/")),
        readdirSync: () => [{ name: `${W}1592`, isDirectory: () => true, isSymbolicLink: () => false }],
        statSync: () => ({ mtimeMs: 50_000_000 - 600_000, birthtimeMs: 1 }),
        lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
        rmSync: () => {
          throw new Error("ein registrierter Worktree darf nie gelöscht werden");
        },
        platform: "linux",
      });
    const uebergabe = JSON.stringify({
      hook_event_name: "SubagentStop",
      agent_type: FREMD.agenten.umsetzer,
      last_assistant_message: `ERGEBNIS: uebergabe\nPR: https://github.com/x/y/pull/7\nSCHNITT: pr\nUEBERGABE:\n  Worktree: /root/.claude/worktrees/${W}1592`,
    });
    assert.deepEqual(runHook(uebergabe, "/root", echteWaisenPruefung, { prStatus: offen }), { exit: 0, stdout: "", stderr: "" });
    assert.ok(befehle.some((c) => c.includes("worktree list")), "die Waisenprüfung lief wirklich");
    assert.ok(!befehle.some((c) => c.includes("worktree remove")), "kein Worktree wurde entfernt");
    assert.equal(runHook(uebergabe, "/root", echteWaisenPruefung, { prStatus: () => ({ state: "OPEN", autoMergeRequest: null }) }).exit, 2);
  });

  test("frei bei stop_hook_active und bei gh-Fehler", () => {
    assert.equal(runHook(payload("abgebrochen", { stop_hook_active: true }), "/x", frei, { prStatus: offen }).exit, 0);
    assert.equal(runHook(payload("abgebrochen"), "/x", frei, { prStatus: () => { throw new Error("x"); } }).exit, 0);
  });
});

describe("settings.json hängt den Hook auch an das Ende des Umsetzers (#1309)", () => {
  test("SubagentStop ohne Matcher startet stop-verify-hook.mjs (der Agentenname kommt aus der Projekt-Config, #1742)", async () => {
    const { readFileSync } = await import("node:fs");
    const s = JSON.parse(readFileSync(fileURLToPath(new URL("../../.claude/settings.json", import.meta.url)), "utf8")) as {
      hooks: Record<string, { matcher?: string; hooks: { command: string; args: string[] }[] }[]>;
    };
    const eintrag = s.hooks.SubagentStop?.find((e) => e.hooks.some((h) => h.args.some((a) => a.endsWith("scripts/stop-verify-hook.mjs"))));
    assert.ok(eintrag, "hooks.SubagentStop mit stop-verify-hook fehlt");
    assert.equal(eintrag.matcher, undefined, "ein Matcher würde den Agentennamen in settings.json festschreiben");
    assert.ok(eintrag.hooks.some((h) => h.args.some((a) => a.endsWith("scripts/stop-verify-hook.mjs"))));
    assert.ok(s.hooks.Stop?.some((e) => e.hooks.some((h) => h.args.some((a) => a.endsWith("scripts/stop-verify-hook.mjs")))), "der Stop-Hook des Hauptchats bleibt");
  });

  test("Umsetzer und Skill sagen, was bei einer Blockade zu tun ist", () => {
    const lies = (p: string) => liesMitProjektwerten(p);
    assert.match(lies(".claude/agents/factory-umsetzer.md"), /SubagentStop-Hook/);
    assert.match(lies(".agents/skills/factory/ablauf.md"), /cleanup-worktrees\.mjs --fix/);
    assert.match(lies(".agents/skills/factory/ablauf.md"), /git diff --quiet <Sitzungsbasis> origin\/main -- \.claude\/agents \.claude\/skills/);
    assert.match(lies(".agents/skills/review-lenses/SKILL.md"), new RegExp(`Agent type '${escapeRegex(projektConfig().agenten.lens)}' not found`));
  });
});

// ── Leerer gesperrter Ordner warnt nur, nicht leerer nennt Halter (#1411) ─────

describe("Stop-Hook: leerer gesperrter Waisen-Ordner und Halter-Meldung (#1411)", () => {
  type Deps = Record<string, unknown>;
  type Check = (root: string, deps?: Deps) => { blocked: boolean; reason?: string; warning?: string; removed?: string[] };
  const check = ohnePowershell<Check>(checkRoh);
  const WT = "/root/.claude/worktrees";
  const basisDeps = (inhalt: string[]): Deps => ({
    execSync: (cmd: string) => (cmd.includes("worktree list") ? "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n" : ""),
    existsSync: () => true, // der Ordner bleibt nach dem Löschversuch bestehen
    // Wurzel-Listing: ein Waisen-Ordner; Listing des Ordners selbst: `inhalt`
    readdirSync: (p: string) =>
      String(p).replace(/\\/g, "/") === WT ? [{ name: `${W}1404`, isDirectory: () => true, isSymbolicLink: () => false }] : inhalt,
    rmSync: () => {},
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    platform: "win32",
    listProcesses: () => [{ pid: 4711, ppid: 999, name: "python3.exe", commandLine: "python3 -", startMs: Date.now() + 10_000 }],
    statSync: () => ({ birthtimeMs: 0, mtimeMs: 0 }),
  });

  test("leerer, gesperrter Ordner: kein Block, nur eine Warnung (der nächste Stop versucht es erneut)", () => {
    const r = check("/root", basisDeps([]));
    assert.equal(r.blocked, false);
    assert.match(r.warning ?? "", new RegExp(`${escapeRegex(W)}1404.*leer.*nächste Stop`));
  });

  test("nicht leerer, gesperrter Ordner: Block, nennt den möglichen Halter mit PID und rät nie zum Kill per Name", () => {
    const r = check("/root", basisDeps(["datei.txt"]));
    assert.equal(r.blocked, true);
    assert.match(r.reason ?? "", new RegExp(`${escapeRegex(W)}1404`));
    assert.match(r.reason ?? "", /PID 4711 python3\.exe/);
    assert.match(r.reason ?? "", /taskkill \/PID <pid> \/T \/F/, "PowerShell-Weg samt Baum (#1501)");
    assert.match(r.reason ?? "", /taskkill \/\/PID <pid> \/\/T \/\/F/, "Git-Bash-Weg");
    assert.doesNotMatch(r.reason ?? "", /Stop-Process -Id/);
    assert.ok(!/Stop-Process -Name/.test(r.reason ?? ""), "kein pauschaler Kill per Name");
  });

  test("runHook: Warnung gibt den Stop frei (exit 0) und geht als systemMessage raus, nicht als Block", () => {
    const warn = () => ({ blocked: false, warning: "Worktree-Ordner w-1 ist leer, aber gerade gesperrt." });
    const r = (hook as unknown as { runHook: (s: string, root: string, c: typeof warn) => { exit: number; stdout: string; stderr: string } }).runHook("{}", "/root", warn);
    assert.equal(r.exit, 0);
    assert.deepEqual(JSON.parse(r.stdout), { systemMessage: "Worktree-Ordner w-1 ist leer, aber gerade gesperrt." });
    assert.equal(r.stderr, "");
    const still = (hook as unknown as { runHook: (s: string, root: string, c: () => object) => { exit: number; stdout: string } }).runHook("{}", "/root", () => ({ blocked: false }));
    assert.deepEqual([still.exit, still.stdout], [0, ""]);
  });
});

// ── Kein pauschaler Prozess-Kill per Name im Agenten-Kontext (#1411) ───────────

describe("Wächter: keine Anleitung zum Kill per Name (#1411)", () => {
  // Parallele Agenten laufen in anderen Worktrees; ein Kill per Name (`Stop-Process -Name`, `taskkill /IM`) beendet ihre
  // Prozesse mit. Erlaubt ist nur der gezielte Kill per PID samt Baum (`taskkill /PID … /T`).
  // Auch `-Force -Name`, der Alias-Parameter `-ProcessName`, `spps`/`kill -Name` und `/IM` nicht als erste taskkill-Option (#1526);
  // Stopp an Backtick, `|` und `;`: Prosa wie "`Stop-Process` -Name" ist kein Rat.
  const VERBOTEN = /\b(?:Stop-Process|spps)\b[^\n`|;]*?\s-(?:Name|ProcessName)\b|(?<![\w-])kill\s+(?:-\w+\s+)*-(?:Name|ProcessName)\b|\btaskkill(?:\.exe)?\b[^\n`|;]*?\s\/{1,2}IM\b/i;

  /** Texte der Agenten-Anweisungen, Docs, Hooks und Skripte, in denen eine solche Anleitung stehen könnte. */
  // Nur versionierte Dateien aus dem gecachten Scan-Helfer (#1526): die CI scannt ohnehin nur Versioniertes, und ein
  // zweiter Scan-Mechanismus (readdirSync) las dieselben Dateien unter Last erneut.
  function texte(): Record<string, string> {
    const out: Record<string, string> = { "AGENTS.md": lies("AGENTS.md") };
    const passt = (pfad: string): boolean =>
      // alle Docs außer den ADRs (historisch, nie umgeschrieben): auch docs/referenz/, model-routing.md, sicherheit-agenten.md
      (pfad.startsWith("docs/") && pfad.endsWith(".md") && !pfad.startsWith("docs/adr/")) ||
      (pfad.startsWith(".claude/") && /\.(md|js|mjs|json)$/.test(pfad)) ||
      (pfad.startsWith("scripts/") && pfad.endsWith(".mjs"));
    for (const pfad of repoDateien()) if (passt(pfad)) out[pfad] = lies(pfad);
    return out;
  }

  test("texte() scannt alle Docs außer den ADRs (#1508)", () => {
    const pfade = Object.keys(texte());
    for (const pflicht of ["docs/referenz/befehle.md", "docs/model-routing.md", "docs/sicherheit-agenten.md", "docs/agent-harness-faq.md"]) {
      assert.ok(pfade.includes(pflicht), `${pflicht} fehlt im Scan`);
    }
    assert.deepEqual(pfade.filter((p) => p.startsWith("docs/adr/")), [], "ADRs sind historisch und zählen nicht");
  });

  test("kein Dokument, Skill, Workflow, Agent und Skript rät zu `Stop-Process -Name` oder `taskkill /IM`", () => {
    const treffer = Object.entries(texte())
      .filter(([, t]) => VERBOTEN.test(t))
      .map(([pfad]) => pfad);
    assert.deepEqual(treffer, [], "Kill per Name beendet auch Prozesse paralleler Agenten: gezielt per PID (`taskkill /PID … /T`)");
  });

  test("Red-Green: das Muster erkennt beide Formen und lässt den Kill per PID zu", () => {
    assert.ok(VERBOTEN.test("pwsh: Stop-Process -Name node -Force"));
    assert.ok(VERBOTEN.test("cmd: taskkill /IM node.exe /F"));
    assert.ok(VERBOTEN.test("Git-Bash: taskkill //IM node.exe //F"));
    assert.ok(VERBOTEN.test("stop-process  -name python"));
    assert.ok(!VERBOTEN.test("Stop-Process -Id 4711"));
    assert.ok(!VERBOTEN.test("taskkill //PID 4711 //F"));
    assert.ok(!VERBOTEN.test("nie per Name (Stop-Process -Id <pid>)"));
  });

  test("Red-Green (#1526): auch `-Force -Name`, `-ProcessName`, Aliase und `taskkill /F /IM` treffen; Prosa und Kill per PID nicht", () => {
    for (const roh of [
      "taskkill /F /IM node.exe",
      "taskkill.exe /T /F /IM node.exe",
      "taskkill //F //IM node.exe",
      "Stop-Process -Force -Name node",
      "Stop-Process -ProcessName node",
      "spps -ProcessName node",
      "spps -Name node",
      "kill -Name node",
    ]) assert.ok(VERBOTEN.test(roh), roh);
    for (const ok of [
      "taskkill /PID 4711 /T /F",
      "Stop-Process -Id 4711",
      "Stop-Process kann keinen Baum beenden (`Stop-Process` -Name wäre ohnehin falsch)",
      "Bash: kill -9 $pid",
      "der Name des Prozesses steht in der Liste",
    ]) assert.ok(!VERBOTEN.test(ok), ok);
  });

  // #1501: Die PID ist oft nur die npx-/npm-Hülle; ein Kill ohne Baum (`/T`) lässt den node.exe-Listener stehen, und
  // `Stop-Process` kann keinen Baum beenden. Jeder Rat zum Kill per PID nennt darum `taskkill … /T`.
  const OHNE_BAUM = (text: string): string[] => {
    const treffer: string[] = [];
    // Wert-Teil `\S+` (auch `$pid`, `<PID-Nr>`), aber nie ein folgender Schalter; `taskkill.exe` zählt mit
    for (const m of text.matchAll(/\btaskkill(?:\.exe)?((?:\s+\/{1,2}\w+(?:\s+(?!\/)\S+)?)*)/gi)) {
      if (/\/{1,2}PID\b/i.test(m[1]) && !/\/{1,2}T\b/i.test(m[1])) treffer.push(m[0].trim());
    }
    // PowerShell kann keinen Baum beenden: `-Id` an beliebiger Stelle (`-Force -Id`), Aliase `spps`/`kill`, positionale PID.
    // Stopp an Backtick, `|` und `;`: Prosa wie "`Stop-Process` (…) -Id" ist kein Rat.
    for (const re of [
      /\b(?:Stop-Process|spps)\b[^\n`|;]*?\s-I(?:d|nputObject)?\b/gi,
      /(?<![\w-])kill\s+(?:-\w+\s+)*-I(?:d|nputObject)?\b/gi,
      /(?<![\w-])kill\s+(?:\d+|\$\w+|<[^>\s]+>)/gi,
      /\b(?:Stop-Process|spps)\s+(?:\d+|\$\w+|<[^>\s]+>)/gi,
    ]) {
      for (const m of text.matchAll(re)) treffer.push(m[0].trim());
    }
    return treffer;
  };

  test("kein Rat zum Kill per PID ohne Baum: weder `taskkill /PID` ohne `/T` noch `Stop-Process -Id` (#1501)", () => {
    const treffer = Object.entries(texte())
      .map(([pfad, t]) => [pfad, OHNE_BAUM(t)] as const)
      .filter(([, t]) => t.length > 0);
    assert.deepEqual(treffer, [], "Hülle statt Listener beendet: `taskkill /PID <pid> /T /F` (PowerShell) bzw. `taskkill //PID <pid> //T //F` (Git-Bash)");
  });

  test("Red-Green (#1501): der Matcher erkennt den Kill ohne Baum und lässt den Baum-Kill zu", () => {
    assert.deepEqual(OHNE_BAUM("taskkill //PID 4711 //F"), ["taskkill //PID 4711 //F"]);
    assert.equal(OHNE_BAUM("taskkill /PID <pid> /F").length, 1);
    assert.equal(OHNE_BAUM("pwsh: Stop-Process -Id <pid>").length, 1);
    assert.deepEqual(OHNE_BAUM("taskkill //PID <pid> //T //F"), []);
    assert.deepEqual(OHNE_BAUM("taskkill /PID <pid> /T /F"), []);
    assert.deepEqual(OHNE_BAUM("taskkill /F /T /PID 1"), []);
    assert.deepEqual(OHNE_BAUM("PowerShells `Stop-Process` kann keinen Baum beenden"), []);
    // erweiterte Formen: sollen treffen
    for (const roh of [
      "taskkill.exe /PID 4711 /F",
      "Stop-Process -Force -Id 4711",
      "Stop-Process -Id $pid -Force",
      "spps -Id 4711",
      "kill -Id 4711",
      "Stop-Process 4711",
      "taskkill /PID $pid /F",
      "Stop-Process -I 4711", // Kurzform von -Id (eindeutiges Präfix)
      "Stop-Process -InputObject $p",
      "kill 4711", // Alias `kill` mit positionaler PID
      "kill $pid",
      "kill <pid>",
    ]) assert.equal(OHNE_BAUM(roh).length, 1, roh);
    // Platzhalter und Prosa: sollen nicht treffen
    for (const ok of [
      "taskkill /PID $pid /T /F",
      "taskkill //PID <PID-Nr> //T //F",
      "taskkill.exe /PID 1 /T /F",
      "PowerShells `Stop-Process` (es kann keinen Baum beenden)",
      "kill %1",
      "Bash: kill -9 $pid",
      "kill -n 9 $pid",
      "PowerShells `Stop-Process` kann keinen Baum beenden, `kill` auch nicht",
    ]) assert.deepEqual(OHNE_BAUM(ok), [], ok);
  });
});

describe("checkAndFixOrphanWorktrees: Lens-Worktrees ohne Feature-Worktree (#1425)", () => {
  const MAIN = "/root";
  const WT = "/root/.claude/worktrees";
  const JETZT = 50_000_000;
  const porcelain = (pfade: string[]) => pfade.map((p) => `worktree ${p}\nHEAD abc\n`).join("\n");
  const check = ohnePowershell<(root: string, deps: object) => { blocked: boolean; reason?: string; removed?: string[] }>(checkRoh);

  function deps(start: string[], opts: { alterMs?: number; klemmt?: boolean; symlink?: boolean; geisterOrdner?: string[] } = {}) {
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
        readdirSync: () =>
          [...[...registriert].filter((p) => p.startsWith(`${WT}/`)).map((p) => p.slice(WT.length + 1)), ...(opts.geisterOrdner ?? [])].map((name) => ({
            name,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          })),
        statSync: () => ({ mtimeMs: JETZT - (opts.alterMs ?? 10 * 60_000), birthtimeMs: 1 }),
        lstatSync: () => ({ isDirectory: () => !opts.symlink, isSymbolicLink: () => Boolean(opts.symlink) }),
        rmSync: () => {},
        platform: "linux",
      },
    };
  }

  test("Schutzgurt: ein Lens-Worktree als Symlink blockiert den Stop mit Namen und Schutzgurt, `git worktree remove` läuft nicht", () => {
    const g = deps([MAIN, `${WT}/${W}7-lens-r1`], { symlink: true });
    const r = check(MAIN, g.deps);
    assert.equal(r.blocked, true);
    assert.match(r.reason ?? "", /Schutzgurt/);
    assert.match(r.reason ?? "", new RegExp(`${escapeRegex(W)}7-lens-r1`));
    assert.ok(!g.befehle.some((c) => c.includes("worktree remove")));
  });

  test("Lens-Waise und Ordner-Waise im selben Lauf: beide stehen in `removed`", () => {
    const g = deps([MAIN, `${WT}/${W}7-lens-r1`], { geisterOrdner: [`${W}99`] });
    const r = check(MAIN, g.deps);
    assert.equal(r.blocked, false);
    assert.deepEqual([...(r.removed ?? [])].sort(), [`${W}7-lens-r1`, `${W}99`]);
  });

  test("verwaister, alter Lens-Worktree wird entfernt, der Stop bleibt frei", () => {
    const g = deps([MAIN, `${WT}/${W}7-lens-r1`]);
    const r = check(MAIN, g.deps);
    assert.equal(r.blocked, false);
    assert.deepEqual(r.removed, [`${W}7-lens-r1`]);
    assert.ok(g.befehle.some((c) => c.includes("worktree remove --force")));
  });

  test("bleibt unberührt: Lens-Worktree mit Feature-Worktree, junger Lens-Worktree", () => {
    const mitEltern = deps([MAIN, `${WT}/${W}7`, `${WT}/${W}7-lens-r1`]);
    assert.equal(check(MAIN, mitEltern.deps).blocked, false);
    assert.ok(!mitEltern.befehle.some((c) => c.includes("worktree remove")));
    const jung = deps([MAIN, `${WT}/${W}8-lens-r1`], { alterMs: 60_000 });
    assert.equal(check(MAIN, jung.deps).blocked, false);
    assert.ok(!jung.befehle.some((c) => c.includes("worktree remove")));
  });

  test("scheitert das Entfernen, blockiert der Stop mit Namen und Hinweis auf --fix", () => {
    const g = deps([MAIN, `${WT}/${W}9-lens-r2`], { klemmt: true });
    const r = check(MAIN, g.deps);
    assert.equal(r.blocked, true);
    assert.match(r.reason ?? "", new RegExp(`${escapeRegex(W)}9-lens-r2`));
    assert.match(r.reason ?? "", /cleanup-worktrees\.mjs --fix/);
  });

  test("git-Fehler bei `worktree list`: fail-open", () => {
    const r = check(MAIN, { execSync: () => { throw new Error("kein git"); } });
    assert.equal(r.blocked, false);
  });
});

describe("checkAndFixOrphanWorktrees: lose Dateien unter .claude/worktrees (#1476)", () => {
  const MAIN = "/root";
  const WT = "/root/.claude/worktrees";
  const JETZT = 50_000_000;
  type Ergebnis = { blocked: boolean; reason?: string; removed?: string[]; warning?: string };
  const check = ohnePowershell<(root: string, deps: object) => Ergebnis>(checkRoh);

  function deps(dateien: string[], opts: { rmWirft?: boolean; link?: boolean; alterMs?: number } = {}) {
    const befehle: string[] = [];
    const geloescht: string[] = [];
    return {
      befehle,
      geloescht,
      deps: {
        now: JETZT,
        execSync: (cmd: string) => {
          befehle.push(cmd);
          return cmd.includes("worktree list") ? `worktree ${MAIN}\nHEAD abc\n` : "";
        },
        existsSync: (p: string) => p.replace(/\\/g, "/") === WT || (dateien.some((d) => p.replace(/\\/g, "/").endsWith(`/${d}`)) && !geloescht.includes(p)),
        readdirSync: () => dateien.map((name) => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })),
        statSync: () => ({ mtimeMs: JETZT - (opts.alterMs ?? 10 * 60_000), birthtimeMs: 1 }),
        lstatSync: () => ({ isFile: () => !opts.link, isDirectory: () => false, isSymbolicLink: () => Boolean(opts.link) }),
        rmSync: (p: string) => {
          if (opts.rmWirft) throw new Error("EBUSY");
          geloescht.push(p);
        },
        platform: "linux",
      },
    };
  }

  test("Datei eines registrierten Worktrees bleibt unangetastet (nichts gelöscht, keine Meldung)", () => {
    const g = deps([`${W}5-notiz.bak`]);
    const d = { ...g.deps, execSync: (cmd: string) => (cmd.includes("worktree list") ? `worktree ${MAIN}
HEAD abc

worktree ${WT}/${W}5
HEAD abc
` : "") };
    const r = check(MAIN, d);
    assert.deepEqual(r, { blocked: false });
    assert.equal(g.geloescht.length, 0);
  });

  test("verwaiste Datei und verwaister Lens-Worktree im selben Lauf: beide in removed", () => {
    const g = deps([`${W}1361-x.bak`]);
    let lensDa = true;
    const d = {
      ...g.deps,
      execSync: (cmd: string) => {
        if (cmd.includes("worktree list")) return `worktree ${MAIN}
HEAD abc
` + (lensDa ? `
worktree ${WT}/${W}7-lens-r1
HEAD abc
` : "");
        if (cmd.includes("worktree remove")) lensDa = false;
        return "";
      },
      existsSync: (p: string) => p.replace(/\\/g, "/") === WT || (p.replace(/\\/g, "/").endsWith(`${W}1361-x.bak`) && g.geloescht.length === 0),
      readdirSync: () => [
        { name: `${W}1361-x.bak`, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
        ...(lensDa ? [{ name: `${W}7-lens-r1`, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false }] : []),
      ],
      lstatSync: () => ({ isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false }),
    };
    const r = check(MAIN, d);
    assert.equal(r.blocked, false);
    assert.deepEqual([...(r.removed ?? [])].sort(), [`${W}1361-x.bak`, `${W}7-lens-r1`]);
  });

  test("verwaiste, alte Datei wird still entfernt: kein Block, keine Warnung", () => {
    const g = deps([`${W}1361-lens-r2-orig.bak`]);
    const r = check(MAIN, g.deps);
    assert.equal(r.blocked, false);
    assert.deepEqual(r.removed, [`${W}1361-lens-r2-orig.bak`]);
    assert.equal(r.warning, undefined);
    assert.equal(g.geloescht.length, 1);
  });

  test("fremde Datei: nur Warnung mit Namen, nichts gelöscht, kein Block", () => {
    const g = deps(["notizen.txt"]);
    const r = check(MAIN, g.deps);
    assert.equal(r.blocked, false);
    assert.match(r.warning ?? "", /notizen\.txt/);
    assert.equal(g.geloescht.length, 0);
  });

  test("gescheiterte Löschung und Schutzgurt-Ablehnung sind nur Warnungen, nie ein Block", () => {
    const wirft = check(MAIN, deps([`${W}7-x.bak`], { rmWirft: true }).deps);
    assert.equal(wirft.blocked, false);
    assert.match(wirft.warning ?? "", new RegExp(`${escapeRegex(W)}7-x\\.bak.*nicht gelöscht`));
    const g = deps([`${W}7-x.bak`], { link: true });
    const link = check(MAIN, g.deps);
    assert.equal(link.blocked, false);
    assert.match(link.warning ?? "", /Schutzgurt/);
    assert.equal(g.geloescht.length, 0);
  });

  test("junge verwaiste Datei bleibt unberührt und ohne Meldung", () => {
    const g = deps([`${W}8-x.bak`], { alterMs: 60_000 });
    const r = check(MAIN, g.deps);
    assert.deepEqual(r, { blocked: false });
    assert.equal(g.geloescht.length, 0);
  });

  test("nichts gefunden: Frühausstieg ohne weiteren git-Aufruf (kein status)", () => {
    const g = deps([]);
    assert.deepEqual(check(MAIN, g.deps), { blocked: false });
    assert.ok(!g.befehle.some((c) => c.includes("status --porcelain")));
  });

  test("runHook gibt die Warnung als systemMessage aus (Exit 0)", () => {
    const g = deps(["notizen.txt"]);
    const r = (hook as unknown as { runHook: (s: string, root: string, c: (root: string) => Ergebnis) => { exit: number; stdout: string } }).runHook("{}", MAIN, (root) => check(root, g.deps));
    assert.equal(r.exit, 0);
    assert.match(r.stdout, /systemMessage/);
    assert.match(r.stdout, /notizen\.txt/);
  });
});

// Die Gegenproben laufen bewusst nicht gegen FREMD: beim Tausch der Projekt-Config wären echte Config und FREMD gleich.
describe("Rückfall auf die echte Config ohne injizierte Namen oder Config", () => {
  const ECHT = projektConfig();
  const MAIN = "/root";
  const WT = "/root/.claude/worktrees";
  const JETZT = 50_000_000;
  type Ergebnis = { blocked: boolean; removed?: string[] };

  const lauf = (datei: string) => {
    const geloescht: string[] = [];
    const r = (checkRoh as (root: string, d: object) => Ergebnis)(MAIN, {
      listProcesses: () => [],
      now: JETZT,
      execSync: (cmd: string) => (cmd.includes("worktree list") ? `worktree ${MAIN}\nHEAD abc\n` : ""),
      existsSync: (p: string) => p.replace(/\\/g, "/") === WT || (p.replace(/\\/g, "/").endsWith(`/${datei}`) && !geloescht.includes(p)),
      readdirSync: () => [{ name: datei, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }],
      statSync: () => ({ mtimeMs: JETZT - 10 * 60_000, birthtimeMs: 1 }),
      lstatSync: () => ({ isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }),
      rmSync: (p: string) => void geloescht.push(p),
      platform: "linux",
    });
    return { r, geloescht };
  };

  test("ohne `namen` räumt die Waisen-Prüfung eine lose Datei mit dem Präfix der echten Config weg, ein abgewandeltes Präfix bleibt", () => {
    const echt = lauf(`${ECHT.praefixe.worktree}1361-x.bak`);
    assert.deepEqual(echt.r.removed, [`${ECHT.praefixe.worktree}1361-x.bak`]);
    assert.equal(echt.geloescht.length, 1);
    const anders = lauf(`x${ECHT.praefixe.worktree}1361-x.bak`);
    assert.equal(anders.geloescht.length, 0);
    assert.notDeepEqual(anders.r.removed, [`x${ECHT.praefixe.worktree}1361-x.bak`]);
  });

  test("ohne `config` gilt als Umsetzer der Agent der echten Config, ein abgewandelter Name steigt aus", () => {
    const stop = (typ: string) => JSON.stringify({ hook_event_name: "SubagentStop", agent_type: typ });
    assert.equal(runHookRoh(stop(ECHT.agenten.umsetzer), "/x", geblockt).exit, 2);
    assert.equal(runHookRoh(stop(`${ECHT.agenten.umsetzer}-x`), "/x", geblockt).exit, 0);
  });
});

describe("keine echten Prozessstarts (#1526)", () => {
  test("kein Test dieser Datei hat PowerShell gestartet (listProcesses ist überall injiziert)", () => {
    assert.equal(powershellStarts.n, 0, "ein deps-Objekt ohne `listProcesses` löst unter Windows einen echten PowerShell/WMI-Start aus (~600 ms)");
  });
});
