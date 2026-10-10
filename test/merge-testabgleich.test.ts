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
    const root = mkdtempSync(join(tmpdir(), "kq-merge-"));
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

  test("kein Merge (HEAD hat ein Elternteil, kein MERGE_HEAD): Exit 2 mit Erklärung", () => {
    const { root, g } = aufbau();
    const r = M.pruefeMerge({ git: g, lies: lies(root) });
    assert.equal(r.code, 2);
    assert.match(r.text, /weder ein Merge in Arbeit/);
  });
});
