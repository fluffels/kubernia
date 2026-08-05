/* Stop-Worktree-Cleanup-Hook (#708/#909/#952) — Stop-Hook, der verwaiste
 * Worktree-Ordner aufräumt.
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

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hook from "../scripts/stop-verify-hook.mjs";

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
    // Nutzt import.meta.url des TESTS selbst: test/ → repo-root (eine Ebene hoch).
    // Das Skript liegt in scripts/ (auch eine Ebene unter Root), also muss
    // repoRootFromScriptUrl auf eine gefakte scripts/-URL dieselbe Tiefe liefern.
    // Wir simulieren mit einem Pfad, der auf der aktuellen Plattform gültig ist,
    // indem wir den echten scripts/-Pfad aus dem bekannten import.meta.url ableiten.
    const scriptUrl = import.meta.url.replace(/\/test\/[^/]+$/, "/scripts/stop-verify-hook.mjs");
    const root = repoRootFromScriptUrl(scriptUrl);
    const rootNorm = root.replace(/\\/g, "/");
    // Repo-Root muss auf "kubernia" enden (keine scripts/-Komponente mehr)
    assert.ok(
      !rootNorm.endsWith("/scripts") && rootNorm.includes("kubernia"),
      `Erwartet Pfad mit kubernia ohne /scripts/, bekam: ${root}`
    );
  });
});

// ── checkAndFixOrphanWorktrees (#908/#952) ───────────────────────────────────

describe("checkAndFixOrphanWorktrees (#908/#952)", () => {
  type OrphanDeps = {
    execSync?: (cmd: string, opts: object) => string;
    existsSync?: (path: string) => boolean;
    readdirSync?: () => Array<{ name: string; isDirectory: () => boolean }>;
    rmSync?: (path: string) => void;
  };

  function makeDeps(opts: { orphanName: string | null; existsAfterRm: boolean }): OrphanDeps {
    let existsCalls = 0;
    return {
      execSync: (cmd: string) =>
        cmd.includes("worktree list")
          ? "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n"
          : "",
      existsSync: () => {
        existsCalls++;
        // Erster Aufruf: prueft, ob der Worktrees-Ordner selbst existiert (fuer readdirSync).
        // Weitere Aufrufe: prueft nach rmSync, ob der Waisen-Ordner noch da ist.
        return existsCalls === 1 ? true : opts.existsAfterRm;
      },
      readdirSync: () =>
        opts.orphanName ? [{ name: opts.orphanName, isDirectory: () => true }] : [],
      rmSync: () => {},
    };
  }

  const checkAndFixOrphanWorktrees: (
    repoRoot: string,
    deps?: OrphanDeps
  ) => { blocked: boolean; reason?: string; removed?: string[] } = hook.checkAndFixOrphanWorktrees;

  test("keine Waisen-Ordner vorhanden, blocked false", () => {
    const result = checkAndFixOrphanWorktrees("/root", makeDeps({ orphanName: null, existsAfterRm: false }));
    assert.equal(result.blocked, false);
  });

  test("Waisen-Ordner gefunden und erfolgreich geloescht, blocked false, still", () => {
    const result = checkAndFixOrphanWorktrees(
      "/root",
      makeDeps({ orphanName: "kq-862", existsAfterRm: false })
    );
    assert.equal(result.blocked, false);
    assert.deepEqual(result.removed, ["kq-862"]);
  });

  test("Waisen-Ordner gefunden, Loeschen schlaegt fehl (Datei-Lock), blocked true mit Ordnername in reason", () => {
    const result = checkAndFixOrphanWorktrees(
      "/root",
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
    const result = checkAndFixOrphanWorktrees("/root", deps);
    assert.equal(result.blocked, false);
  });
});
