/* Verwaiste-Worktree-Diagnose/-Cleanup (#908/#952).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
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
import * as cleanupModule from "../../scripts/cleanup-worktrees.mjs";

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
  ) => { ok: boolean; orphans: string[]; young: string[]; mainRoot: string | null; worktreesDir: string | null };
  splitByAge: (worktreesDir: string, names: string[], deps?: object) => { alt: string[]; jung: string[] };
  MIN_ORPHAN_AGE_MS: number;
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
  splitByAge,
  MIN_ORPHAN_AGE_MS,
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

describe("Altersgrenze für Waisen (#1311)", () => {
  const JETZT = 10_000_000_000;
  const stat = (alter: Record<string, number | "fehlt">) => (p: string) => {
    const name = p.replace(/\\/g, "/").split("/").pop() ?? "";
    const a = alter[name];
    if (a === undefined || a === "fehlt") throw new Error("ENOENT");
    return { mtimeMs: JETZT - a };
  };

  test("jünger als die Grenze → jung (nur melden), genau an der Grenze und älter → alt (löschbar)", () => {
    const r = splitByAge("/root/.claude/worktrees", ["neu", "grenze", "alt"], {
      now: JETZT,
      statSync: stat({ neu: 30_000, grenze: MIN_ORPHAN_AGE_MS, alt: 3_600_000 }),
    });
    assert.deepEqual(r.jung, ["neu"]);
    assert.deepEqual(r.alt, ["grenze", "alt"]);
  });

  test("nicht lesbarer Ordner zählt als alt (altes Verhalten), leere Liste bleibt leer", () => {
    assert.deepEqual(splitByAge("/w", ["weg"], { now: JETZT, statSync: stat({ weg: "fehlt" }) }), { alt: ["weg"], jung: [] });
    assert.deepEqual(splitByAge("/w", [], { now: JETZT }), { alt: [], jung: [] });
  });

  test("diagnoseOrphans: ein junger unregistrierter Ordner landet in young, nicht in orphans (wird nie gelöscht)", () => {
    const deps = {
      now: JETZT,
      execSync: () => "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n",
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-neu", isDirectory: () => true },
        { name: "kq-alt", isDirectory: () => true },
      ],
      statSync: stat({ "kq-neu": 20_000, "kq-alt": 7_200_000 }),
    };
    const r = diagnoseOrphans("/root", deps);
    assert.equal(r.ok, true);
    assert.deepEqual(r.orphans, ["kq-alt"]);
    assert.deepEqual(r.young, ["kq-neu"]);
  });
});

// ── Wiederholung, leer/nicht leer, Halter-Suche (#1411) ──────────────────────────

describe("fixOrphans: Wiederholung und leerer gesperrter Ordner (#1411)", () => {
  const okDeps = { lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }), execSync: () => "" };
  type Fix = (m: string, w: string, o: string[], d?: object) => { removed: string[]; errors: string[]; pending: string[]; refused: unknown[]; halter: Record<string, unknown[]> };
  const fix = fixOrphans as unknown as Fix;

  test("rmSync bekommt die Wiederholungs-Optionen (kurze Sperren lösen sich von selbst)", () => {
    const optionen: object[] = [];
    fix("/root", "/root/.claude/worktrees", ["kq-1"], { ...okDeps, rmSync: (_p: string, o: object) => optionen.push(o), existsSync: () => false });
    assert.deepEqual(optionen, [{ recursive: true, force: true, maxRetries: 3, retryDelay: 300 }]);
  });

  test("Ordner bleibt bestehen und ist LEER → pending (kein Fehler), nicht errors", () => {
    const r = fix("/root", "/root/.claude/worktrees", ["kq-1"], { ...okDeps, rmSync: () => {}, existsSync: () => true, readdirSync: () => [] });
    assert.deepEqual(r.pending, ["kq-1"]);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.removed, []);
  });

  test("Ordner bleibt bestehen und ist NICHT leer → errors, nicht pending (Red-Green gegen die Leer-Prüfung)", () => {
    const r = fix("/root", "/root/.claude/worktrees", ["kq-1"], { ...okDeps, rmSync: () => {}, existsSync: () => true, readdirSync: () => ["datei.txt"] });
    assert.deepEqual(r.errors, ["kq-1"]);
    assert.deepEqual(r.pending, []);
  });

  test("rmSync wirft und der Ordner ist leer → ebenfalls pending; nicht lesbarer Ordner → errors (fail-closed)", () => {
    const wirft = () => {
      throw new Error("EBUSY");
    };
    assert.deepEqual(fix("/root", "/root/.claude/worktrees", ["kq-1"], { ...okDeps, rmSync: wirft, existsSync: () => true, readdirSync: () => [] }).pending, ["kq-1"]);
    const unlesbar = fix("/root", "/root/.claude/worktrees", ["kq-1"], {
      ...okDeps,
      rmSync: wirft,
      existsSync: () => true,
      readdirSync: () => {
        throw new Error("EPERM");
      },
    });
    assert.deepEqual(unlesbar.errors, ["kq-1"]);
    assert.deepEqual(unlesbar.pending, []);
  });

  test("bei nicht leerem Ordner nennt `halter` die möglichen Halter mit PID (nur Windows)", () => {
    const prozesse = [{ pid: 4711, ppid: 1, name: "python3.exe", commandLine: "python3 -m http.server", startMs: 2000 }];
    const base = { ...okDeps, rmSync: () => {}, existsSync: () => true, readdirSync: () => ["x"], statSync: () => ({ birthtimeMs: 1000 }), listProcesses: () => prozesse };
    assert.equal((fix("/root", "/root/.claude/worktrees", ["kq-1"], { ...base, platform: "win32" }).halter["kq-1"] as { pid: number }[])[0].pid, 4711);
    assert.deepEqual(fix("/root", "/root/.claude/worktrees", ["kq-1"], { ...base, platform: "linux" }).halter["kq-1"], [], "nur Windows");
    const kaputt = { ...base, platform: "win32", listProcesses: () => { throw new Error("powershell fehlt"); } };
    assert.deepEqual(fix("/root", "/root/.claude/worktrees", ["kq-1"], kaputt).halter["kq-1"], [], "fail-open");
  });
});

describe("moeglicheHalter und formatHalter (#1411)", () => {
  type P = { pid: number; ppid: number; name: string; commandLine: string; startMs: number };
  type H = { pid: number; grund: string }[];
  const m = cleanupModule as unknown as {
    moeglicheHalter: (p: P[], pfad: string, geburt: number | null, eigenePid?: number) => H;
    formatHalter: (h: unknown[]) => string;
  };
  const PFAD = "C:\\dev\\kubernia\\.claude\\worktrees\\kq-1404";
  const proz = (o: Partial<P> & { pid: number }): P => ({ ppid: 1, name: "node.exe", commandLine: "", startMs: 5000, ...o });
  const eltern = proz({ pid: 1, ppid: 0, name: "explorer.exe" });

  test("Kommandozeile mit dem Worktree-Pfad: Backslash-, Schrägstrich- und MSYS-Form, ohne Groß-/Kleinschreibung", () => {
    const liste = [
      eltern,
      proz({ pid: 10, commandLine: "node C:\\dev\\kubernia\\.claude\\worktrees\\kq-1404\\server.mjs" }),
      proz({ pid: 11, commandLine: "node c:/dev/kubernia/.claude/worktrees/kq-1404/a.mjs" }),
      proz({ pid: 12, name: "bash.exe", commandLine: "bash /c/dev/kubernia/.claude/worktrees/KQ-1404/run.sh" }),
      proz({ pid: 13, commandLine: "node C:\\dev\\kubernia\\.claude\\worktrees\\kq-1405\\server.mjs" }),
    ];
    assert.deepEqual(m.moeglicheHalter(liste, PFAD, 0).map((h) => h.pid), [10, 11, 12], "kq-1405 ist ein anderer Worktree");
  });

  test("verwaister Werkzeug-Prozess nach dem Anlegen des Ordners ist Kandidat; davor, mit Elternprozess oder fremder Name nicht", () => {
    const liste = [
      eltern,
      proz({ pid: 20, ppid: 999, name: "python3.exe", startMs: 5000 }), // Elternprozess 999 gibt es nicht → verwaist
      proz({ pid: 21, ppid: 999, name: "python3.exe", startMs: 100 }), // vor dem Ordner gestartet
      proz({ pid: 22, ppid: 1, name: "python3.exe", startMs: 5000 }), // hat einen lebenden Elternprozess
      proz({ pid: 23, ppid: 999, name: "chrome.exe", startMs: 5000 }), // kein Werkzeug
    ];
    const treffer = m.moeglicheHalter(liste, PFAD, 1000);
    assert.deepEqual(treffer.map((h) => h.pid), [20]);
    assert.match(treffer[0].grund, /verwaist/);
    assert.deepEqual(m.moeglicheHalter(liste, PFAD, null).map((h) => h.pid), [20, 21], "ohne bekannte Ordner-Geburt zählt jeder verwaiste Werkzeug-Prozess");
  });

  test("Regel (c): ein Interpreter, der ein Skript von stdin liest (`python -`), nach dem Anlegen des Ordners gestartet, wird genannt (#1428 Z16)", () => {
    const liste = [
      eltern,
      proz({ pid: 30, name: "python.exe", commandLine: "python -", startMs: 5000 }), // lebender Elternprozess: (b) greift nicht, (a) auch nicht
      proz({ pid: 31, name: "python3.exe", commandLine: "C:\\Python\\python3.exe -", startMs: 5000 }),
      proz({ pid: 32, name: "py.exe", commandLine: "py -", startMs: 5000 }),
      proz({ pid: 33, name: "node.exe", commandLine: "node -", startMs: 5000 }),
      proz({ pid: 34, name: "python.exe", commandLine: "python -", startMs: 100 }), // vor dem Ordner gestartet
      proz({ pid: 35, name: "python.exe", commandLine: "python build.py", startMs: 5000 }), // kein stdin-Skript
      proz({ pid: 36, name: "python.exe", commandLine: "python -m http.server", startMs: 5000 }), // `-m`, nicht `-`
      proz({ pid: 37, name: "chrome.exe", commandLine: "chrome -", startMs: 5000 }), // kein Interpreter
    ];
    const treffer = m.moeglicheHalter(liste, PFAD, 1000);
    assert.deepEqual(treffer.map((h) => h.pid), [30, 31, 32, 33]);
    assert.match(treffer[0].grund, /stdin/);
    assert.deepEqual(m.moeglicheHalter(liste, PFAD, null).map((h) => h.pid), [30, 31, 32, 33, 34], "ohne bekannte Ordner-Geburt zählt auch der frühere");
  });

  test("der eigene Prozess ist nie Kandidat; ohne Prozesse oder Treffer bleibt die Liste leer", () => {
    assert.deepEqual(m.moeglicheHalter([proz({ pid: 77, commandLine: "node c:/dev/kubernia/.claude/worktrees/kq-1404/x" })], PFAD, 0, 77), []);
    assert.deepEqual(m.moeglicheHalter([], PFAD, 0), []);
  });

  test("formatHalter: PID, Name und Rat per PID; nie ein Kill per Name; leer sagt es klar", () => {
    const text = m.formatHalter([{ pid: 4711, name: "python3.exe", grund: "verwaist", commandLine: "python3 -" }]);
    assert.match(text, /PID 4711 python3\.exe/);
    assert.match(text, /taskkill \/PID <pid> \/T \/F/, "PowerShell-Weg samt Baum (#1501)");
    assert.match(text, /taskkill \/\/PID <pid> \/\/T \/\/F/, "Git-Bash-Weg (das PowerShell-Tool kann per Policy blockiert sein)");
    assert.doesNotMatch(text, /Stop-Process -Id/, "Stop-Process beendet keinen Baum");
    assert.ok(!/Stop-Process -Name/.test(text));
    assert.match(m.formatHalter([]), /kein Halter/);
  });
});

describe("fixOrphans: Ordner-Geburt begrenzt die Halter-Kandidaten (#1411)", () => {
  type Fix = (m: string, w: string, o: string[], d?: object) => { halter: Record<string, { pid: number }[]> };
  const fix = fixOrphans as unknown as Fix;
  const proz = (pid: number, startMs: number) => ({ pid, ppid: 999, name: "python3.exe", commandLine: "python3 -", startMs });
  const base = {
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    execSync: () => "",
    rmSync: () => {},
    existsSync: () => true,
    readdirSync: () => ["x"],
    platform: "win32",
    listProcesses: () => [proz(1, 500), proz(2, 5000)],
  };
  test("ein verwaister Prozess, der VOR dem Anlegen des Ordners startete, ist kein Halter", () => {
    const r = fix("/root", "/root/.claude/worktrees", ["kq-1"], { ...base, statSync: () => ({ birthtimeMs: 1000 }) });
    assert.deepEqual(r.halter["kq-1"].map((h) => h.pid), [2]);
  });
  test("ist die Geburt des Ordners unbekannt (statSync wirft), zählt jeder verwaiste Werkzeug-Prozess", () => {
    const wirft = () => {
      throw new Error("ENOENT");
    };
    const r = fix("/root", "/root/.claude/worktrees", ["kq-1"], { ...base, statSync: wirft });
    assert.deepEqual(r.halter["kq-1"].map((h) => h.pid), [1, 2]);
  });
});

describe("Lens-Worktrees ohne Feature-Worktree (#1425)", () => {
  type LensModule = {
    verwaisteLensWorktrees: (registered: string[], worktreesDir: string) => string[];
    entferneLensWorktrees: (
      mainRoot: string,
      worktreesDir: string,
      names: string[],
      deps?: object,
    ) => { removed: string[]; errors: string[]; refused: { name: string; reason: string }[]; halter: Record<string, unknown[]> };
  };
  const lensM = cleanupModule as unknown as LensModule;
  const MAIN = "/root";
  const WT = "/root/.claude/worktrees";
  const porcelain = (pfade: string[]) => pfade.map((p) => `worktree ${p}\nHEAD abc\n`).join("\n");

  test("registrierter `kq-<nr>-lens-r<n>` ohne `kq-<nr>` ist verwaist; mit Feature-Worktree nicht", () => {
    const reg = [MAIN, `${WT}/kq-12`, `${WT}/kq-12-lens-r1`, `${WT}/kq-13-lens-r2`, `${WT}/kq-14`];
    assert.deepEqual(lensM.verwaisteLensWorktrees(reg, WT), ["kq-13-lens-r2"]);
  });

  test("Merge-Delta-Lens `kq-<nr>-lens-m<n>` ohne `kq-<nr>` ist verwaist, mit Feature-Worktree nicht", () => {
    const reg = [MAIN, `${WT}/kq-13-lens-m1`, `${WT}/kq-14`, `${WT}/kq-14-lens-m2`, `${WT}/kq-15-lens-m`];
    assert.deepEqual(lensM.verwaisteLensWorktrees(reg, WT), ["kq-13-lens-m1"]);
  });

  test("nie angefasst: `kq-<nr>`, `kq-<nr>-lens-x`, `foo-lens-r1`, fremde Ordner, tiefer verschachtelte Pfade", () => {
    const reg = [MAIN, `${WT}/kq-12`, `${WT}/kq-12-lens-x`, `${WT}/foo-lens-r1`, `/other/kq-9-lens-r1`, `${WT}/kq-9-lens-r1/sub`, `${WT}/kq-9-lens-r10x`];
    assert.deepEqual(lensM.verwaisteLensWorktrees(reg, WT), []);
  });

  test("Windows-Pfade (Backslashes, gemischte Trenner) werden wie POSIX-Pfade behandelt", () => {
    const reg = ["C:/root", "C:/root/.claude/worktrees/kq-5-lens-r1", "C:/root/.claude/worktrees/kq-6", "C:/root/.claude/worktrees/kq-6-lens-r1"];
    assert.deepEqual(lensM.verwaisteLensWorktrees(reg, "C:\\root\\.claude\\worktrees"), ["kq-5-lens-r1"]);
  });

  test("diagnoseOrphans trennt alte (löschbar) von jungen (nur melden) Lens-Worktrees", () => {
    const jetzt = 10_000_000;
    const deps = {
      now: jetzt,
      execSync: () => porcelain([MAIN, `${WT}/kq-1-lens-r1`, `${WT}/kq-2-lens-r1`]),
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-1-lens-r1", isDirectory: () => true },
        { name: "kq-2-lens-r1", isDirectory: () => true },
      ],
      statSync: (p: string) => ({ mtimeMs: p.includes("kq-1-") ? jetzt - MIN_ORPHAN_AGE_MS - 1 : jetzt - 1000 }),
    };
    const r = diagnoseOrphans(MAIN, deps) as unknown as { lensOrphans: string[]; lensYoung: string[]; orphans: string[] };
    assert.deepEqual(r.lensOrphans, ["kq-1-lens-r1"]);
    assert.deepEqual(r.lensYoung, ["kq-2-lens-r1"]);
    assert.deepEqual(r.orphans, [], "registrierte Ordner sind keine Geister-Ordner");
  });

  /** Fake-Git mit Zustand: `worktree remove` nimmt den Pfad aus der Liste, außer `klemmt`. */
  function fakeGit(start: string[], opts: { klemmt?: boolean; wirftTrotzdem?: boolean } = {}) {
    const registriert = new Set(start);
    const befehle: string[] = [];
    return {
      befehle,
      deps: {
        execSync: (cmd: string) => {
          befehle.push(cmd);
          if (cmd.includes("worktree list")) return porcelain([...registriert]);
          const m = /worktree remove --force "([^"]+)"/.exec(cmd);
          if (m && !opts.klemmt) registriert.delete(m[1].replace(/\\/g, "/"));
          if (m && opts.wirftTrotzdem) throw new Error("exit 1");
          if (m && opts.klemmt) throw new Error("Permission denied");
          return "";
        },
        existsSync: (p: string) => registriert.has(p.replace(/\\/g, "/")),
        lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
        statSync: () => ({ birthtimeMs: 1 }),
        platform: "linux",
      },
    };
  }

  test("entfernt per `git worktree remove --force` und prüft: nicht mehr registriert, Ordner weg", () => {
    const g = fakeGit([MAIN, `${WT}/kq-3-lens-r1`]);
    const r = lensM.entferneLensWorktrees(MAIN, WT, ["kq-3-lens-r1"], g.deps);
    assert.deepEqual(r.removed, ["kq-3-lens-r1"]);
    assert.deepEqual(r.errors, []);
    assert.ok(g.befehle.some((c) => /worktree remove --force ".*kq-3-lens-r1"/.test(c)));
  });

  test("scheitert das Entfernen (Sperre), steht der Name in `errors`; ein werfender Exit-Code mit Erfolg zählt als entfernt", () => {
    const klemmt = lensM.entferneLensWorktrees(MAIN, WT, ["kq-3-lens-r1"], fakeGit([MAIN, `${WT}/kq-3-lens-r1`], { klemmt: true }).deps);
    assert.deepEqual(klemmt.errors, ["kq-3-lens-r1"]);
    assert.deepEqual(klemmt.removed, []);
    assert.ok("kq-3-lens-r1" in klemmt.halter);
    const warnung = lensM.entferneLensWorktrees(MAIN, WT, ["kq-3-lens-r1"], fakeGit([MAIN, `${WT}/kq-3-lens-r1`], { wirftTrotzdem: true }).deps);
    assert.deepEqual(warnung.removed, ["kq-3-lens-r1"], "geprüft wird das Ergebnis, nicht der Exit-Code");
  });

  test("git meldet Erfolg, aber der Ordner steht noch (Windows-Sperre): Fehler, nicht entfernt", () => {
    const g = fakeGit([MAIN, `${WT}/kq-3-lens-r1`]);
    const deps = { ...g.deps, existsSync: () => true };
    const r = lensM.entferneLensWorktrees(MAIN, WT, ["kq-3-lens-r1"], deps);
    assert.deepEqual(r.errors, ["kq-3-lens-r1"]);
    assert.deepEqual(r.removed, []);
  });

  test("lässt sich die Worktree-Liste nach dem Entfernen nicht lesen, zählt das fail-closed als nicht entfernt", () => {
    const g = fakeGit([MAIN, `${WT}/kq-3-lens-r1`]);
    const deps = {
      ...g.deps,
      execSync: (cmd: string) => {
        if (cmd.includes("worktree list")) throw new Error("kein git");
        return g.deps.execSync(cmd);
      },
    };
    assert.deepEqual(lensM.entferneLensWorktrees(MAIN, WT, ["kq-3-lens-r1"], deps).errors, ["kq-3-lens-r1"]);
  });

  test("Schutzgurt: ein Symlink wird nicht angefasst (kein `git worktree remove`)", () => {
    const g = fakeGit([MAIN, `${WT}/kq-3-lens-r1`]);
    const deps = { ...g.deps, lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => true }) };
    const r = lensM.entferneLensWorktrees(MAIN, WT, ["kq-3-lens-r1"], deps);
    assert.equal(r.refused.length, 1);
    assert.deepEqual(r.removed, []);
    assert.ok(!g.befehle.some((c) => c.includes("worktree remove")));
  });
});

describe("Lose Dateien unter .claude/worktrees (#1476)", () => {
  type DateiModule = {
    localWorktreeFiles: (worktreesDir: string, deps?: object) => string[];
    sortiereDateien: (
      worktreesDir: string,
      dateien: string[],
      registered: Set<string>,
      deps?: object,
    ) => { verwaist: string[]; jung: string[]; fremd: string[] };
    entferneVerwaisteDateien: (
      mainRoot: string,
      worktreesDir: string,
      names: string[],
      deps?: object,
    ) => { removed: string[]; errors: string[]; refused: { name: string; reason: string }[] };
  };
  const m = cleanupModule as unknown as DateiModule;
  const MAIN = "/root";
  const WT = "/root/.claude/worktrees";
  const JETZT = 10_000_000;
  const alt = (p: string) => ({ mtimeMs: p.includes("jung") ? JETZT - 1000 : JETZT - MIN_ORPHAN_AGE_MS - 1 });
  const porcelain = (pfade: string[]) => pfade.map((p) => `worktree ${p}\nHEAD abc\n`).join("\n");

  test("localWorktreeFiles: nur reguläre Dateien, keine Ordner oder Links; Fake ohne isFile wirft nicht", () => {
    const deps = {
      existsSync: () => true,
      readdirSync: () => [
        { name: "a.bak", isFile: () => true },
        { name: "ordner", isFile: () => false },
        { name: "link", isFile: () => false, isSymbolicLink: () => true },
        { name: "fake-ohne-isfile" },
      ],
    };
    assert.deepEqual(m.localWorktreeFiles(WT, deps), ["a.bak"]);
    assert.deepEqual(m.localWorktreeFiles(WT, { existsSync: () => false }), []);
  });

  test("sortiereDateien: verwaist, jung, fremd; registrierter Worktree schützt seine Dateien", () => {
    const registered = new Set([`${WT}/kq-5`]);
    const r = m.sortiereDateien(WT, ["kq-1361-lens-r2-orig.bak", "kq-9-jung.bak", "kq-5-notiz.txt", "notizen.txt"], registered, { now: JETZT, statSync: alt });
    assert.deepEqual(r.verwaist, ["kq-1361-lens-r2-orig.bak"]);
    assert.deepEqual(r.jung, ["kq-9-jung.bak"]);
    assert.deepEqual(r.fremd, ["notizen.txt"]);
  });

  test("sortiereDateien: kq-13610-x gehört zu kq-13610, nicht zu kq-1361", () => {
    const r = m.sortiereDateien(WT, ["kq-13610-x.bak"], new Set([`${WT}/kq-1361`]), { now: JETZT, statSync: alt });
    assert.deepEqual(r.verwaist, ["kq-13610-x.bak"]);
    const r2 = m.sortiereDateien(WT, ["kq-13610-x.bak"], new Set([`${WT}/kq-13610`]), { now: JETZT, statSync: alt });
    assert.deepEqual(r2.verwaist, []);
    assert.deepEqual(m.sortiereDateien(WT, ["kq-1361x.bak"], new Set(), { now: JETZT, statSync: alt }).fremd, ["kq-1361x.bak"]);
  });

  test("diagnoseOrphans liefert die Dateilisten; Ordner bleiben getrennt", () => {
    const deps = {
      now: JETZT,
      execSync: () => porcelain([MAIN]),
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-7-x.bak", isDirectory: () => false, isFile: () => true },
        { name: "kq-8-jung.bak", isDirectory: () => false, isFile: () => true },
        { name: "fremd.txt", isDirectory: () => false, isFile: () => true },
      ],
      statSync: alt,
    };
    const r = diagnoseOrphans(MAIN, deps) as unknown as { orphanFiles: string[]; youngFiles: string[]; foreignFiles: string[]; orphans: string[] };
    assert.deepEqual(r.orphanFiles, ["kq-7-x.bak"]);
    assert.deepEqual(r.youngFiles, ["kq-8-jung.bak"]);
    assert.deepEqual(r.foreignFiles, ["fremd.txt"]);
    assert.deepEqual(r.orphans, []);
  });

  test("diagnoseOrphans: Dateien eines registrierten Worktrees sind weder verwaist noch fremd (Verdrahtung der Registrierung)", () => {
    const deps = {
      now: JETZT,
      execSync: () => porcelain([MAIN, `${WT}/kq-5`]),
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-5", isDirectory: () => true, isFile: () => false },
        { name: "kq-5-notiz.bak", isDirectory: () => false, isFile: () => true },
      ],
      statSync: alt,
    };
    const r = diagnoseOrphans(MAIN, deps) as unknown as { orphanFiles: string[]; youngFiles: string[]; foreignFiles: string[] };
    assert.deepEqual(r.orphanFiles, []);
    assert.deepEqual(r.youngFiles, []);
    assert.deepEqual(r.foreignFiles, []);
  });

  const reguLaer = { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };

  test("entferneVerwaisteDateien löscht ohne recursive", () => {
    const gerufen: Array<[string, object]> = [];
    let da = true;
    const deps = {
      lstatSync: () => reguLaer,
      rmSync: (p: string, o: object) => {
        gerufen.push([p, o]);
        da = false;
      },
      existsSync: () => da,
    };
    const r = m.entferneVerwaisteDateien(MAIN, WT, ["kq-7-x.bak"], deps);
    assert.deepEqual(r.removed, ["kq-7-x.bak"]);
    assert.equal(gerufen.length, 1);
    assert.equal((gerufen[0][1] as { recursive?: boolean }).recursive, undefined);
  });

  test("Schutzgurt lehnt Link, Ordner, Fremdpfad und Trenner ab, ohne zu löschen", () => {
    let gerufen = 0;
    const basis = { rmSync: () => gerufen++, existsSync: () => true };
    const link = m.entferneVerwaisteDateien(MAIN, WT, ["kq-1-a.bak"], { ...basis, lstatSync: () => ({ ...reguLaer, isSymbolicLink: () => true }) });
    const ordner = m.entferneVerwaisteDateien(MAIN, WT, ["kq-1-b.bak"], { ...basis, lstatSync: () => ({ ...reguLaer, isFile: () => false, isDirectory: () => true }) });
    const fremdPfad = m.entferneVerwaisteDateien(MAIN, "/anderswo/worktrees", ["kq-1-c.bak"], { ...basis, lstatSync: () => reguLaer });
    const trenner = m.entferneVerwaisteDateien(MAIN, WT, ["../x.bak", "a/b.bak"], { ...basis, lstatSync: () => reguLaer });
    assert.equal(link.refused.length, 1);
    assert.equal(ordner.refused.length, 1);
    assert.equal(fremdPfad.refused.length, 1);
    assert.equal(trenner.refused.length, 2);
    assert.equal(gerufen, 0);
  });

  test("gescheiterte Löschung (Datei bleibt, rmSync wirft) landet in errors", () => {
    const deps = {
      lstatSync: () => reguLaer,
      rmSync: () => {
        throw new Error("EBUSY");
      },
      existsSync: () => true,
    };
    const r = m.entferneVerwaisteDateien(MAIN, WT, ["kq-7-x.bak"], deps);
    assert.deepEqual(r.errors, ["kq-7-x.bak"]);
    assert.deepEqual(r.removed, []);
  });

  test("assertSafeOrphanTarget für Dateien verlangt eine reguläre Datei", () => {
    const f = assertSafeOrphanTarget as unknown as (a: string, b: string, c: string, d: object, e: string) => { safe: boolean };
    assert.equal(f(MAIN, WT, "kq-1-a.bak", { lstatSync: () => reguLaer }, "file").safe, true);
    assert.equal(f(MAIN, WT, "kq-1-a.bak", { lstatSync: () => ({ ...reguLaer, isFile: () => false }) }, "file").safe, false);
  });
});
