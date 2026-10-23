/* Merge-Testabgleich (#1579): Kern pur (Testtitel, verlorene Tests je Seite) und die Orchestrierung gegen ein echtes Temp-Repo mit Merge. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/merge-testabgleich.mjs";

type Fassung = Record<string, string | null>;
type Verloren = { datei: string; titel: string; seite: "ihre" | "unsere" };
const M = raw as unknown as {
  testTitel: (t: string) => Set<string>;
  verloreneTests: (a: { basis: Fassung; unsere: Fassung; ihre: Fassung; ergebnis: Fassung }) => Verloren[];
  formatiere: (v: Verloren[]) => string;
  pruefeMerge: (a: { git: (args: string[]) => string; lies: (p: string) => string | null }) => { code: number; text: string };
};
const quelle = (...titel: string[]) => titel.map((t) => `test("${t}", () => {});`).join("\n");

describe("testTitel", () => {
  test("test, it, describe mit allen drei Anführungszeichen, Zusätze wie .skip/.only", () => {
    const t = M.testTitel(`describe("Gruppe", () => {\n  test('eins', () => {});\n  it(\`zwei\`, () => {});\n  test.skip("drei", () => {});\n  test.only('vier', () => {});\n});`);
    assert.deepEqual([...t].sort(), ["Gruppe", "drei", "eins", "vier", "zwei"]);
  });
  test("Titel mit escaptem Anführungszeichen und mit Klammern", () => {
    assert.deepEqual([...M.testTitel('test("sagt \\"hallo\\" (laut)", () => {});')], ['sagt \\"hallo\\" (laut)']);
  });
  test("kein Treffer: Aufruf ohne Literal, Fremdnamen, leerer und fehlender Text", () => {
    assert.equal(M.testTitel("test(name, fn); latest('x'); expect(1);").size, 0);
    assert.equal(M.testTitel("").size, 0);
    assert.equal(M.testTitel(undefined as unknown as string).size, 0);
  });
});

describe("verloreneTests", () => {
  const D = "test/a.test.ts";
  const fall = (basis: string[], unsere: string[], ihre: string[], ergebnis: string[]) =>
    M.verloreneTests({ basis: { [D]: quelle(...basis) }, unsere: { [D]: quelle(...unsere) }, ihre: { [D]: quelle(...ihre) }, ergebnis: { [D]: quelle(...ergebnis) } });

  test("ein Titel von main, der im Ergebnis fehlt, ist verloren (Negativfall der Zeile)", () => {
    assert.deepEqual(fall(["alt"], ["alt"], ["alt", "von main"], ["alt"]), [{ datei: D, titel: "von main", seite: "ihre" }]);
  });
  test("ein Titel des Feature-Branch, der im Ergebnis fehlt, ist verloren (symmetrisch)", () => {
    assert.deepEqual(fall(["alt"], ["alt", "von uns"], ["alt"], ["alt"]), [{ datei: D, titel: "von uns", seite: "unsere" }]);
  });
  test("bewusst entfernt: in der Basis, vom Feature-Branch gelöscht, von main unverändert: nicht verloren", () => {
    assert.deepEqual(fall(["alt", "weg"], ["alt"], ["alt", "weg"], ["alt"]), []);
  });
  test("bewusst entfernt von main, vom Feature-Branch unverändert: nicht verloren", () => {
    assert.deepEqual(fall(["alt", "weg"], ["alt", "weg"], ["alt"], ["alt"]), []);
  });
  test("auf main neu hinzugekommene Datei, die im Ergebnis fehlt: verloren", () => {
    const r = M.verloreneTests({ basis: {}, unsere: {}, ihre: { "test/neu.test.ts": quelle("neu") }, ergebnis: { "test/neu.test.ts": null } });
    assert.deepEqual(r, [{ datei: "test/neu.test.ts", titel: "neu", seite: "ihre" }]);
  });
  test("auf main gelöschte Datei wird nicht erwartet", () => {
    const r = M.verloreneTests({ basis: { [D]: quelle("a") }, unsere: { [D]: quelle("a") }, ihre: { [D]: null }, ergebnis: { [D]: null } });
    assert.deepEqual(r, []);
  });
  test("nichts verloren: Ergebnis hat alles, auch neue Titel beider Seiten", () => {
    assert.deepEqual(fall(["alt"], ["alt", "u"], ["alt", "i"], ["alt", "u", "i"]), []);
  });
  test("ein Titel in einer anderen Datei des Ergebnisses ersetzt den verlorenen nicht (Dateiweise Prüfung)", () => {
    const r = M.verloreneTests({ basis: { "test/a.ts": quelle("x") }, unsere: { "test/a.ts": quelle("x") }, ihre: { "test/a.ts": quelle("x", "y") }, ergebnis: { "test/a.ts": quelle("x"), "test/b.ts": quelle("y") } });
    assert.deepEqual(r, [{ datei: "test/a.ts", titel: "y", seite: "ihre" }]);
  });
  test("formatiere: sauber und mit Liste", () => {
    assert.match(M.formatiere([]), /kein Test.*verloren/);
    const text = M.formatiere([{ datei: "test/a.ts", titel: "t", seite: "ihre" }]);
    assert.match(text, /1 Test\(s\)/);
    assert.match(text, /test\/a\.ts: „t“ \(main\)/);
  });
});

describe("pruefeMerge gegen ein echtes Temp-Repo", () => {
  const ordner: string[] = [];
  afterEach(() => {
    for (const d of ordner.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd: string) => (args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const schreibe = (root: string, pfad: string, text: string) => {
    mkdirSync(dirname(join(root, pfad)), { recursive: true });
    writeFileSync(join(root, pfad), text);
  };
  const lies = (root: string) => (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null);
  /** Basis mit test/x.test.ts (alt); main fügt "von main" hinzu, der Feature-Branch fügt "von uns" hinzu (Konflikt in derselben Zeile). */
  const aufbau = () => {
    const root = mkdtempSync(join(tmpdir(), "merge-abgleich-"));
    ordner.push(root);
    const g = git(root);
    g(["init", "-q", "-b", "main"]);
    schreibe(root, "test/x.test.ts", quelle("alt") + "\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "basis"]);
    g(["checkout", "-q", "-b", "feature"]);
    schreibe(root, "test/x.test.ts", quelle("alt", "von uns") + "\n");
    g(["commit", "-qam", "feature"]);
    g(["checkout", "-q", "main"]);
    schreibe(root, "test/x.test.ts", quelle("alt", "von main") + "\n");
    g(["commit", "-qam", "main"]);
    g(["checkout", "-q", "feature"]);
    return { root, g };
  };
  const konfliktMerge = (g: (a: string[]) => string) => {
    try {
      g(["merge", "--no-commit", "--no-ff", "main"]);
    } catch {
      // erwarteter Konflikt
    }
  };

  test("Konfliktauflösung, die den Test von main weglässt: während des Merges (MERGE_HEAD) rot mit Liste", () => {
    const { root, g } = aufbau();
    konfliktMerge(g);
    schreibe(root, "test/x.test.ts", quelle("alt", "von uns") + "\n"); // „ours“ gewählt: „von main“ fehlt
    const r = M.pruefeMerge({ git: g, lies: lies(root) });
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, /„von main“ \(main\)/);
    assert.doesNotMatch(r.text, /von uns/);
  });

  test("saubere Auflösung (beide Titel): grün; nach dem Merge-Commit ebenso", () => {
    const { root, g } = aufbau();
    konfliktMerge(g);
    schreibe(root, "test/x.test.ts", quelle("alt", "von uns", "von main") + "\n");
    assert.equal(M.pruefeMerge({ git: g, lies: lies(root) }).code, 0);
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "merge"]);
    const nachher = M.pruefeMerge({ git: g, lies: lies(root) });
    assert.equal(nachher.code, 0, nachher.text);
  });

  test("bereits committeter Merge, der den Test von main verlor: rot (zwei Eltern von HEAD)", () => {
    const { root, g } = aufbau();
    konfliktMerge(g);
    schreibe(root, "test/x.test.ts", quelle("alt", "von uns") + "\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "merge"]);
    const r = M.pruefeMerge({ git: g, lies: lies(root) });
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, /von main/);
  });

  test("keine Merge-Basis (git merge-base scheitert): Exit 2 statt stillem Grün", () => {
    const { root, g } = aufbau();
    konfliktMerge(g);
    const ohneBasis = (a: string[]) => {
      if (a[0] === "merge-base") throw new Error("keine gemeinsame Basis");
      return g(a);
    };
    const r = M.pruefeMerge({ git: ohneBasis, lies: lies(root) });
    assert.equal(r.code, 2);
    assert.match(r.text, /keine Merge-Basis/);
  });

  test("beide Seiten hatten den Titel, die Auflösung verliert ihn: je Seite eine Meldung", () => {
    const D = "test/a.test.ts";
    const r = M.verloreneTests({ basis: { [D]: quelle("a") }, unsere: { [D]: quelle("a", "t") }, ihre: { [D]: quelle("a", "t") }, ergebnis: { [D]: quelle("a") } });
    assert.deepEqual(r.map((v) => v.seite).sort(), ["ihre", "unsere"]);
  });

  test("kein Merge (HEAD hat ein Elternteil, kein MERGE_HEAD): Exit 2 mit Erklärung", () => {
    const { root, g } = aufbau();
    const r = M.pruefeMerge({ git: g, lies: lies(root) });
    assert.equal(r.code, 2);
    assert.match(r.text, /weder ein Merge in Arbeit/);
  });
});

describe("Wächter-Lauf-Hinweis", () => {
  const W = M as unknown as {
    WAECHTER_PFAD: RegExp;
    waechterDateien: (u: string[], i: string[]) => string[];
    waechterHinweis: (d: string[]) => string;
  };
  test("Pfadliste: .claude/, .github/, docs/, test/harness/, README.md, jede AGENTS.md (auch modul-lokal)", () => {
    for (const p of [".claude/a", ".github/workflows/x.yml", "docs/x.md", "test/harness/a.test.ts", "README.md", "AGENTS.md", "src/content/AGENTS.md"]) {
      assert.ok(W.WAECHTER_PFAD.test(p), p);
    }
  });
  test("Pfadliste: Präfix-Fallen und fremde Pfade zählen nicht", () => {
    for (const p of ["docs-alt/a.md", "AGENTS.mdx", "src/AGENTS.mdx", "xAGENTS.md", ".claudeX/a", ".githubx/a", "test/other.test.ts", "test/harnessx/a.ts", "src/README.md", "READMEx.md", "src/a.ts"]) {
      assert.ok(!W.WAECHTER_PFAD.test(p), p);
    }
  });
  test("dieselbe Datei auf beiden Seiten: Hinweis mit dieser Datei", () => {
    assert.deepEqual(W.waechterDateien(["docs/x.md", "src/a.ts"], ["docs/x.md", "src/b.ts"]), ["docs/x.md"]);
  });
  test("Kopplung über zwei verschiedene Wächter-Dateien: beide stehen im Hinweis (sortiert)", () => {
    assert.deepEqual(W.waechterDateien(["docs/b.md"], ["README.md"]), ["README.md", "docs/b.md"]);
    assert.deepEqual(W.waechterDateien(["test/harness/a.test.ts", "src/a.ts"], ["src/ui/AGENTS.md"]), ["src/ui/AGENTS.md", "test/harness/a.test.ts"]);
  });
  test("nur eine Seite berührt Wächter-Dateien, oder keine: kein Hinweis", () => {
    assert.deepEqual(W.waechterDateien(["docs/a.md", "docs/b.md"], ["src/a.ts"]), []);
    assert.deepEqual(W.waechterDateien(["src/a.ts"], ["docs/a.md"]), []);
    assert.deepEqual(W.waechterDateien(["docs-alt/a.md", "AGENTS.mdx"], ["docs-alt/a.md", "AGENTS.mdx"]), []);
    assert.deepEqual(W.waechterDateien([], []), []);
  });
  test("waechterHinweis: leer ohne Dateien, bis 5 Dateien alle genannt, ab 6 gekürzt", () => {
    assert.equal(W.waechterHinweis([]), "");
    const fuenf = ["a", "b", "c", "d", "e"].map((n) => `docs/${n}.md`);
    const t5 = W.waechterHinweis(fuenf);
    assert.match(t5, /Wächter-Lauf nötig: npx vitest run test\/harness/);
    assert.ok(fuenf.every((f) => t5.includes(f)));
    assert.doesNotMatch(t5, /weitere/);
    const t7 = W.waechterHinweis([...fuenf, "docs/f.md", "docs/g.md"]);
    assert.match(t7, /und 2 weitere/);
    assert.ok(!t7.includes("docs/f.md") && !t7.includes("docs/g.md"));
    assert.match(W.waechterHinweis([...fuenf, "docs/f.md"]), /und 1 weitere/);
  });
});

describe("pruefeMerge nennt den Wächter-Lauf", () => {
  const ordner: string[] = [];
  afterEach(() => {
    for (const d of ordner.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const gitIn = (cwd: string) => (args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  /** Basis mit docs/a.md und docs/b.md; main ändert die Datei `mainDatei`, der Feature-Branch `featureDatei` (konfliktfrei, wenn verschieden). */
  const merge = (featureDatei: string, mainDatei: string) => {
    const root = mkdtempSync(join(tmpdir(), "merge-abgleich-w-"));
    ordner.push(root);
    const g = gitIn(root);
    const schreibe = (p: string, t: string) => {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), t);
    };
    g(["init", "-q", "-b", "main"]);
    schreibe("docs/a.md", "a\n");
    schreibe("docs/b.md", "b\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "basis"]);
    g(["checkout", "-q", "-b", "feature"]);
    schreibe(featureDatei, "feature\n");
    g(["commit", "-qam", "feature"]);
    g(["checkout", "-q", "main"]);
    schreibe(mainDatei, mainDatei === featureDatei ? "main\n" : "main-anders\n");
    g(["add", "-A"]);
    g(["commit", "-qm", "main"]);
    g(["checkout", "-q", "feature"]);
    g(["merge", "-q", "--no-edit", "main"]);
    return { root, g };
  };
  const lies = (root: string) => (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null);
  const HINWEIS = /Wächter-Lauf nötig: npx vitest run test\/harness/;

  test("nur eine Seite berührt docs/: kein Hinweis", () => {
    const { root, g } = merge("docs/a.md", "src/x.ts");
    const r = M.pruefeMerge({ git: g, lies: lies(root) });
    assert.equal(r.code, 0, r.text);
    assert.doesNotMatch(r.text, HINWEIS);
  });
  test("verschiedene Wächter-Dateien je Seite (Kopplung über zwei Dateien): Hinweis mit beiden", () => {
    const { root, g } = merge("docs/a.md", "docs/b.md");
    const r = M.pruefeMerge({ git: g, lies: lies(root) });
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, HINWEIS);
    assert.match(r.text, /docs\/a\.md, docs\/b\.md/);
  });
  test("beide Seiten berühren dieselbe Datei unter docs/ (ohne Test-Verlust): Hinweis bei Exit 0", () => {
    const root = mkdtempSync(join(tmpdir(), "merge-abgleich-w2-"));
    ordner.push(root);
    const g = gitIn(root);
    const schreibe = (p: string, t: string) => {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), t);
    };
    g(["init", "-q", "-b", "main"]);
    schreibe("docs/a.md", "1\n2\n3\n4\n5\n6\n7\n8\n9\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "basis"]);
    g(["checkout", "-q", "-b", "feature"]);
    schreibe("docs/a.md", "eins\n2\n3\n4\n5\n6\n7\n8\n9\n");
    g(["commit", "-qam", "feature"]);
    g(["checkout", "-q", "main"]);
    schreibe("docs/a.md", "1\n2\n3\n4\n5\n6\n7\n8\nneun\n");
    g(["commit", "-qam", "main"]);
    g(["checkout", "-q", "feature"]);
    g(["merge", "-q", "--no-edit", "main"]);
    const r = M.pruefeMerge({ git: g, lies: lies(root) });
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, HINWEIS);
    assert.match(r.text, /docs\/a\.md/);
  });
});
