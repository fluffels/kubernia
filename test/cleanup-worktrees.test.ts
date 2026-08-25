/* Verwaiste-Worktree-Diagnose/-Cleanup (#908/#952).
 *
 * Die Logik lebt in scripts/cleanup-worktrees.mjs (EINE Quelle fuer das
 * CLI-Skript und den automatischen Check in scripts/stop-verify-hook.mjs).
 * git/fs werden NICHT ausgefuehrt -- execSync/fs-Funktionen sind injiziert,
 * damit der Test deterministisch und ohne echten Repo-Zustand laeuft.
 *
 * Ausfuehren mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts fuer das .mjs-Tooling-Skript.
import * as cleanupModule from "../scripts/cleanup-worktrees.mjs";

/**
 * Die Modul-Form EINMAL deklarieren und den Import genau hier casten. Vorher hing
 * jede Funktion am untypisierten Namespace -- 12 `no-unsafe-*`-Verletzungen, in
 * eslint-suppressions.json eingefroren. Ein expliziter Cast macht dieselbe
 * Zusicherung an EINER Stelle sichtbar, ohne stumm geschaltete Regel.
 */
type CleanupModule = {
  parseWorktreeListPorcelain: (output: string) => string[];
  registeredWorktreePaths: (cwd: string, deps?: object) => string[];
  localWorktreeDirs: (worktreesDir: string, deps?: object) => string[];
  suspiciousWorktreeEntries: (worktreesDir: string, deps?: object) => string[];
  computeOrphans: (worktreesDir: string, dirs: string[], registered: Set<string>) => string[];
  diagnoseOrphans: (
    cwd: string,
    deps?: object
  ) => { ok: boolean; orphans: string[]; mainRoot: string | null; worktreesDir: string | null };
  fixOrphans: (
    mainRoot: string,
    worktreesDir: string,
    orphans: string[],
    deps?: object
  ) => {
    removed: string[];
    errors: string[];
    refused: Array<{ name: string; reason: string }>;
  };
  assertSafeOrphanTarget: (
    mainRoot: string,
    worktreesDir: string,
    name: string,
    deps?: object
  ) => { safe: boolean; reason?: string };
};

const cleanup = cleanupModule as unknown as CleanupModule;

const {
  parseWorktreeListPorcelain,
  registeredWorktreePaths,
  localWorktreeDirs,
  suspiciousWorktreeEntries,
  computeOrphans,
  diagnoseOrphans,
  fixOrphans,
  assertSafeOrphanTarget,
} = cleanup;

describe("parseWorktreeListPorcelain (#952)", () => {
  test("ein Eintrag (nur Haupt-Checkout)", () => {
    const out = ["worktree /c/git/kubernia", "HEAD abc123", "branch refs/heads/main", ""].join("\n");
    assert.deepEqual(parseWorktreeListPorcelain(out), ["/c/git/kubernia"]);
  });

  test("Haupt-Checkout zuerst, dann Linked Worktrees in Reihenfolge", () => {
    const out = [
      "worktree /c/git/kubernia",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /c/git/kubernia/.claude/worktrees/kq-1",
      "HEAD def456",
      "branch refs/heads/kq-1",
      "",
      "worktree /c/git/kubernia/.claude/worktrees/kq-2",
      "HEAD ghi789",
      "branch refs/heads/kq-2",
      "",
    ].join("\n");
    assert.deepEqual(parseWorktreeListPorcelain(out), [
      "/c/git/kubernia",
      "/c/git/kubernia/.claude/worktrees/kq-1",
      "/c/git/kubernia/.claude/worktrees/kq-2",
    ]);
  });

  test("Windows-Pfade mit Backslashes werden auf Slashes normalisiert", () => {
        const bs = String.fromCharCode(92);
        const winPath = "worktree C:" + bs + "git" + bs + "kubernia";
        const out = [winPath, "HEAD abc123", "branch refs/heads/main", ""].join("\n");
        assert.deepEqual(parseWorktreeListPorcelain(out), ["C:/git/kubernia"]);
    });


  test("CRLF-Zeilenenden werden korrekt geparst", () => {
    const out = ["worktree /c/git/kubernia", "HEAD abc123", "branch refs/heads/main", ""].join("\r\n");
    assert.deepEqual(parseWorktreeListPorcelain(out), ["/c/git/kubernia"]);
  });

  test("leerer Output ergibt leeres Array", () => {
    assert.deepEqual(parseWorktreeListPorcelain(""), []);
  });
});

describe("registeredWorktreePaths (#952)", () => {
  test("gibt geparste Pfade zurueck", () => {
    const deps = {
      execSync: () => "worktree /c/git/kubernia\nHEAD abc\nbranch refs/heads/main\n\n",
    };
    assert.deepEqual(registeredWorktreePaths("/c/git/kubernia", deps), ["/c/git/kubernia"]);
  });

  test("execSync wirft, Fehler propagiert (Aufrufer entscheidet fail-safe)", () => {
    const deps = {
      execSync: () => {
        throw new Error("kein git");
      },
    };
    assert.throws(() => registeredWorktreePaths("/c/git/kubernia", deps));
  });
});

describe("localWorktreeDirs (#952)", () => {
  test("Ordner existiert nicht, leeres Array", () => {
    const deps = { existsSync: () => false };
    assert.deepEqual(localWorktreeDirs("/x/.claude/worktrees", deps), []);
  });

  test("nur Verzeichnisse werden zurueckgegeben, keine Dateien", () => {
    const deps = {
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-1", isDirectory: () => true },
        { name: ".gitkeep", isDirectory: () => false },
        { name: "kq-2", isDirectory: () => true },
      ],
    };
    assert.deepEqual(localWorktreeDirs("/x/.claude/worktrees", deps), ["kq-1", "kq-2"]);
  });
});

describe("computeOrphans (#952)", () => {
  test("kein Ordner ist registriert, alle sind Waisen", () => {
    const orphans = computeOrphans("/root/.claude/worktrees", ["kq-1", "kq-2"], new Set());
    assert.deepEqual(orphans, ["kq-1", "kq-2"]);
  });

  test("alle Ordner registriert, keine Waisen", () => {
    const registered = new Set(["/root/.claude/worktrees/kq-1", "/root/.claude/worktrees/kq-2"]);
    assert.deepEqual(computeOrphans("/root/.claude/worktrees", ["kq-1", "kq-2"], registered), []);
  });

  test("gemischt, nur die nicht-registrierten sind Waisen", () => {
    const registered = new Set(["/root/.claude/worktrees/kq-1"]);
    assert.deepEqual(
      computeOrphans("/root/.claude/worktrees", ["kq-1", "kq-2", "kq-3"], registered),
      ["kq-2", "kq-3"]
    );
  });
});

describe("diagnoseOrphans (#952)", () => {
  test("Haupt-Checkout sauber, ein Waisen-Ordner, ok true und orphans enthaelt ihn", () => {
    const deps = {
      execSync: () =>
        "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n" +
        "worktree /root/.claude/worktrees/kq-1\nHEAD def\nbranch refs/heads/kq-1\n\n",
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-1", isDirectory: () => true },
        { name: "kq-2", isDirectory: () => true },
      ],
    };
    const result = diagnoseOrphans("/root", deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.orphans, ["kq-2"]);
    assert.equal(result.mainRoot, "/root");
  });

  test("keine lokalen Ordner, ok true, orphans leer", () => {
    const deps = {
      execSync: () => "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n",
      existsSync: () => false,
    };
    const result = diagnoseOrphans("/root", deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.orphans, []);
  });

  test("git worktree list schlaegt fehl, ok false, orphans leer, fail-safe statt alles als Waise zu melden", () => {
    const deps = {
      execSync: () => {
        throw new Error("kein git-Repo");
      },
    };
    const result = diagnoseOrphans("/root", deps);
    assert.equal(result.ok, false);
    assert.deepEqual(result.orphans, []);
  });

  test("leerer git-Output, sollte nie vorkommen, ok false statt Absturz", () => {
    const deps = { execSync: () => "" };
    const result = diagnoseOrphans("/root", deps);
    assert.equal(result.ok, false);
  });
});


// ── assertSafeOrphanTarget (#1051) ───────────────────────────────────────────
// Der Schutzgurt vor dem `rmSync` (Begruendung im Skript-Kopf): fail-closed,
// sobald das Ziel nicht beweisbar ein echtes Verzeichnis echt unterhalb von
// `<mainRoot>/.claude/worktrees/` ist.

describe("assertSafeOrphanTarget (#1051)", () => {
  const MAIN = "/root";
  const WT = "/root/.claude/worktrees";
  const BS = String.fromCharCode(92);

  /** lstat-Fake: meldet ein echtes Verzeichnis (der legitime Normalfall). */
  const dirLstat = { lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }) };

  function safe(name: string, deps: object = dirLstat, main = MAIN, wt = WT) {
    return assertSafeOrphanTarget(main, wt, name, deps);
  }

  test("legitimer Waisen-Ordner unterhalb .claude/worktrees, safe true", () => {
    const r = safe("kq-1027");
    assert.equal(r.safe, true, `sollte safe sein, reason: ${r.reason}`);
  });

  test("gemischte Separatoren im worktreesDir werden trotzdem als legitim erkannt", () => {
    // So entsteht der Pfad real: mainRoot ist slash-normalisiert (aus
    // parseWorktreeListPorcelain), join() haengt auf Windows Backslashes an.
    const mixed = "C:/git/kubernia" + BS + ".claude" + BS + "worktrees";
    const r = safe("kq-1027", dirLstat, "C:/git/kubernia", mixed);
    assert.equal(r.safe, true, `Guard darf sich nicht selbst blockieren, reason: ${r.reason}`);
  });

  // ── Negativfaelle: der eigentliche Wert dieses Guards ─────────────────────
  // Tabellengetrieben, damit JEDER Fall beides prueft: safe:false UND eine
  // nicht-leere Begruendung. `wt` ueberschreibt worktreesDir, `lstat` das stat.
  const symlink = { lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => true }) };
  const REFUSE: Array<{ was: string; name: string; wt?: string; lstat?: object }> = [
    { was: "leerer Name (zeigte sonst auf worktreesDir SELBST)", name: "" },
    { was: "Name ist ein Punkt (zeigte sonst auf worktreesDir selbst)", name: "." },
    { was: "Name ist zwei Punkte (genau der real eingetretene .claude-Schaden)", name: ".." },
    { was: "Name steigt zwei Ebenen auf (traefe sonst den Haupt-Checkout)", name: "../.." },
    { was: "Slash-Trenner im Namen (nur EIN Pfad-Segment erlaubt)", name: "a/b" },
    { was: "Backslash-Trenner im Namen (Windows-Variante)", name: "a" + BS + "b" },
    { was: "worktreesDir ist mainRoot selbst (Hypothese 3 des Tickets)", name: "kq-1027", wt: MAIN },
    { was: "worktreesDir ist .claude selbst (der real eingetretene Schaden)", name: "worktrees", wt: "/root/.claude" },
    { was: "worktreesDir ausserhalb von mainRoot", name: "kq-1027", wt: "/anderswo/.claude/worktrees" },
    // Deckt die Gleichheits-Pruefung: das Ziel liegt UNTERHALB des erwarteten
    // Ordners, die Prefix-Pruefung allein liesse es durch (Red-Green-Probe #1051).
    { was: "worktreesDir eine Ebene ZU TIEF aufgeloest", name: "kq-1027", wt: WT + "/sub" },
    { was: "Ziel ist ein Symlink/Reparse-Point (Junction nie folgen)", name: "kq-1027", lstat: symlink },
    { was: "Symlink, der sich als Verzeichnis ausgibt", name: "kq-1027", lstat: { lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => true }) } },
    { was: "Ziel ist eine Datei", name: "kq-1027", lstat: { lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => false }) } },
    { was: "lstat wirft ENOENT statt Absturz", name: "kq-1027", lstat: { lstatSync: () => { throw new Error("ENOENT"); } } },
  ];

  for (const { was, name, wt, lstat } of REFUSE) {
    test(`verweigert: ${was}`, () => {
      const r = safe(name, lstat ?? dirLstat, MAIN, wt ?? WT);
      assert.equal(r.safe, false, `haette verweigern muessen: ${was}`);
      assert.ok((r.reason ?? "").length > 0, `Verweigerung ohne Begruendung: ${was}`);
    });
  }

  test("Nicht-String als Name, safe false statt TypeError", () => {
    // Die Typ-Pruefung ist NICHT von der Pfad-Pruefung subsumiert: ohne sie
    // wirft fixOrphans einen TypeError, obwohl es "wirft nie" zusagt (#1051).
    for (const krumm of [null, undefined, 42, {}] as unknown[]) {
      const r = assertSafeOrphanTarget(MAIN, WT, krumm as string, dirLstat);
      assert.equal(r.safe, false, `haette verweigern muessen: ${JSON.stringify(krumm)}`);
    }
  });

  test("die Symlink-Begruendung nennt den Reparse-Point beim Namen", () => {
    const r = safe("kq-1027", symlink);
    assert.ok(
      /symlink|junction|reparse/i.test(r.reason ?? ""),
      `reason sollte den Reparse-Point nennen: ${r.reason}`
    );
  });
});

// ── suspiciousWorktreeEntries (#1051) ────────────────────────────────────────
//
// Dirent.isDirectory() ist FALSE fuer eine Junction: localWorktreeDirs uebersah
// einen Reparse-Point deshalb STILLSCHWEIGEND. Jetzt wird er gemeldet.

describe("suspiciousWorktreeEntries (#1051)", () => {
  test("Ordner existiert nicht, leeres Array", () => {
    const deps = { existsSync: () => false };
    assert.deepEqual(suspiciousWorktreeEntries("/x/.claude/worktrees", deps), []);
  });

  test("nur echte Verzeichnisse, nichts verdaechtig", () => {
    const deps = {
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-1", isDirectory: () => true, isSymbolicLink: () => false },
        { name: "kq-2", isDirectory: () => true, isSymbolicLink: () => false },
      ],
    };
    assert.deepEqual(suspiciousWorktreeEntries("/x/.claude/worktrees", deps), []);
  });

  test("Symlink an Worktree-Stelle wird gemeldet, war vorher unsichtbar", () => {
    const deps = {
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-1", isDirectory: () => true, isSymbolicLink: () => false },
        { name: "kq-junction", isDirectory: () => false, isSymbolicLink: () => true },
      ],
    };
    assert.deepEqual(suspiciousWorktreeEntries("/x/.claude/worktrees", deps), ["kq-junction"]);
  });

  test("gewoehnliche Datei ist NICHT verdaechtig, kein Fehlalarm auf .gitkeep", () => {
    const deps = {
      existsSync: () => true,
      readdirSync: () => [
        { name: ".gitkeep", isDirectory: () => false, isSymbolicLink: () => false },
      ],
    };
    assert.deepEqual(suspiciousWorktreeEntries("/x/.claude/worktrees", deps), []);
  });

  test("Dirent ohne isSymbolicLink-Methode, kein Absturz", () => {
    const deps = {
      existsSync: () => true,
      readdirSync: () => [{ name: "kq-1", isDirectory: () => true }],
    };
    assert.deepEqual(suspiciousWorktreeEntries("/x/.claude/worktrees", deps), []);
  });
});

// ── fixOrphans (#952) + Guard-Verdrahtung (#1051) ────────────────────────────

describe("fixOrphans (#952)", () => {
  /** Legitimer lstat-Fake (echtes Verzeichnis) — der Guard muss durchlassen. */
  const okDeps = {
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
  };

  test("erfolgreiches Loeschen, removed enthaelt Namen, errors leer", () => {
    const deps = { ...okDeps, execSync: () => "", rmSync: () => {}, existsSync: () => false };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-1"], deps);
    assert.deepEqual(result.removed, ["kq-1"]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.refused, []);
  });

  test("Ordner besteht nach rmSync weiter, Datei-Lock, errors enthaelt Namen", () => {
    const deps = { ...okDeps, execSync: () => "", rmSync: () => {}, existsSync: () => true };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-1"], deps);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.errors, ["kq-1"]);
  });

  test("rmSync wirft, als error gezaehlt, kein Absturz", () => {
    const deps = {
      ...okDeps,
      execSync: () => "",
      rmSync: () => {
        throw new Error("EBUSY");
      },
      existsSync: () => true,
    };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-1"], deps);
    assert.deepEqual(result.errors, ["kq-1"]);
  });

  test("git worktree prune schlaegt fehl, nicht fatal, Loeschung laeuft trotzdem", () => {
    const deps = {
      ...okDeps,
      execSync: () => {
        throw new Error("prune failed");
      },
      rmSync: () => {},
      existsSync: () => false,
    };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-1"], deps);
    assert.deepEqual(result.removed, ["kq-1"]);
  });

  test("mehrere Waisen, gemischtes Ergebnis", () => {
    const deps = {
      ...okDeps,
      execSync: () => "",
      rmSync: (path: string) => {
        if (path.includes("kq-locked")) throw new Error("EBUSY");
      },
      existsSync: () => false,
    };
    const result = fixOrphans(
      "/root",
      "/root/.claude/worktrees",
      ["kq-1", "kq-locked", "kq-2"],
      deps
    );
    assert.deepEqual(result.removed, ["kq-1", "kq-2"]);
    assert.deepEqual(result.errors, ["kq-locked"]);
  });

  test("leere orphans-Liste, removed und errors beide leer", () => {
    const deps = { execSync: () => "" };
    const result = fixOrphans("/root", "/root/.claude/worktrees", [], deps);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.errors, []);
  });

  // ── Guard-Verdrahtung (#1051) ─────────────────────────────────────────────

  test("Guard verweigert, rmSync wird NACHWEISLICH nicht aufgerufen", () => {
    let rmCalls = 0;
    const deps = {
      execSync: () => "",
      rmSync: () => {
        rmCalls++;
      },
      existsSync: () => false,
      lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => true }),
    };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-junction"], deps);
    assert.equal(rmCalls, 0, "bei safe:false darf NICHT geloescht werden");
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.errors, []);
    assert.equal(result.refused.length, 1);
    assert.equal(result.refused[0].name, "kq-junction");
    assert.ok((result.refused[0].reason ?? "").length > 0);
  });

  test("verweigertes Ziel landet in refused, NICHT in errors, semantisch getrennt", () => {
    const deps = {
      execSync: () => "",
      rmSync: () => {},
      existsSync: () => false,
      lstatSync: () => {
        throw new Error("ENOENT");
      },
    };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-weg"], deps);
    assert.deepEqual(result.errors, [], "refused ist kein Loeschfehler");
    assert.deepEqual(
      result.refused.map((r) => r.name),
      ["kq-weg"]
    );
  });

  test("drei Buckets zugleich, ok und refused und locked, korrekt getrennt", () => {
    const deps = {
      execSync: () => "",
      rmSync: (path: string) => {
        if (path.includes("kq-locked")) throw new Error("EBUSY");
      },
      existsSync: () => false,
      lstatSync: (path: string) =>
        path.includes("kq-junction")
          ? { isDirectory: () => false, isSymbolicLink: () => true }
          : { isDirectory: () => true, isSymbolicLink: () => false },
    };
    const result = fixOrphans(
      "/root",
      "/root/.claude/worktrees",
      ["kq-ok", "kq-junction", "kq-locked"],
      deps
    );
    assert.deepEqual(result.removed, ["kq-ok"]);
    assert.deepEqual(
      result.refused.map((r) => r.name),
      ["kq-junction"]
    );
    assert.deepEqual(result.errors, ["kq-locked"]);
  });

  test("falsch aufgeloester worktreesDir, KEIN einziges rmSync, der Datenverlust-Fall", () => {
    let rmCalls = 0;
    const deps = {
      ...okDeps,
      execSync: () => "",
      rmSync: () => {
        rmCalls++;
      },
      existsSync: () => false,
    };
    // worktreesDir faellt auf .claude/ zurueck (Hypothese 3): darf NICHTS loeschen.
    const result = fixOrphans("/root", "/root/.claude", ["worktrees"], deps);
    assert.equal(rmCalls, 0);
    assert.deepEqual(result.removed, []);
    assert.equal(result.refused.length, 1);
  });
});
