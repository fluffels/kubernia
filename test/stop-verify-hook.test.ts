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

  const MAIN = "/root";
  const WT = "/root/.claude/worktrees";

  /**
   * Fake-IO fuer den Waisen-Cleanup.
   *
   * ⚠️ Bewusst PFADBASIERT, nicht ueber einen Aufruf-Zaehler (#1051): der
   * Schutzgurt schiebt zusaetzliche fs-Aufrufe dazwischen: eine zaehlerbasierte
   * Attrappe waere danach aus dem falschen Grund rot und wuerde echte Regressionen
   * verdecken. `existsSync` antwortet jetzt nach dem gefragten Pfad.
   */
  function makeDeps(opts: {
    orphanName: string | null;
    existsAfterRm: boolean;
    statusBefore?: string;
    statusAfter?: string;
    symlink?: boolean;
  }): OrphanDeps {
    let statusCalls = 0;
    return {
      execSync: (cmd: string) => {
        if (cmd.includes("worktree list")) {
          return "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n";
        }
        if (cmd.includes("status --porcelain")) {
          statusCalls++;
          return statusCalls === 1 ? (opts.statusBefore ?? "") : (opts.statusAfter ?? "");
        }
        return "";
      },
      // Der Worktrees-Ordner existiert immer; der Waisen-Pfad je nach Szenario.
      existsSync: (path: string) =>
        path.replace(/\\/g, "/") === WT ? true : opts.existsAfterRm,
      readdirSync: () =>
        opts.orphanName
          ? [
              {
                name: opts.orphanName,
                isDirectory: () => !opts.symlink,
                isSymbolicLink: () => Boolean(opts.symlink),
              },
            ]
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
  //
  // Der Hook laeuft unbeaufsichtigt bei JEDEM Turn-Ende. Loescht der Cleanup
  // versionierte Dateien mit (wie am 2026-08-08 alle 9 Dateien unter .claude/),
  // muss das LAUT gemeldet werden statt still durchzugehen. Gezaehlt werden nur
  // NEU hinzugekommene Loeschungen -- ein Turn darf legitim mit eigenen enden.
  const STATUS: Array<{ was: string; before: string; after: string; blockt: boolean }> = [
    { was: "unveraenderter Status", before: " M src/game.ts\n", after: " M src/game.ts\n", blockt: false },
    {
      was: "Loeschung war VORHER schon da (agenten-eigene, kein Fehlalarm)",
      before: " D docs/alt.md\n",
      after: " D docs/alt.md\n",
      blockt: false,
    },
    {
      was: "Loeschung erst NACHHER (der eigentliche Alarm)",
      before: "",
      after: " D .claude/settings.json\n D .claude/skills/kubernia/SKILL.md\n",
      blockt: true,
    },
    { was: "gestagete Loeschung (D im ersten Spaltenzeichen)", before: "", after: "D  .claude/settings.json\n", blockt: true },
    {
      was: "untracked-Eintrag, dessen Pfad mit D beginnt (kein Fehlalarm)",
      before: "",
      after: "?? Dokumente/neu.md\n",
      blockt: false,
    },
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

  test("der Alarm nennt den Pfad UND den Wiederherstellungs-Befehl", () => {
    const result = checkAndFixOrphanWorktrees(
      MAIN,
      makeDeps({
        orphanName: "kq-862",
        existsAfterRm: false,
        statusBefore: "",
        statusAfter: " D .claude/settings.json\n",
      })
    );
    assert.ok(result.reason?.includes(".claude/settings.json"), `Pfad fehlt: ${result.reason}`);
    assert.ok(result.reason?.includes("git checkout --"), `Befehl fehlt: ${result.reason}`);
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
