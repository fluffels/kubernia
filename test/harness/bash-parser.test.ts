/* Bash-Parser des Worktree-Guards (#1311) — AST-Form und Fehlerfälle.
 *
 * @harness-waechter – Struktur-Wächter für scripts/bash-parser.mjs: der Guard stützt seine Entscheidung auf diese
 * Zerlegung, darum liegt der Test im geschützten test/harness/.
 *
 * Geprüft wird die öffentliche API `parseBash` (AST oder `{ ok: false }`), nicht Interna des Tokenizers.
 *
 * Ausführen mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

type Word = { text: string; dynamic: boolean; quoted: boolean };
type Node = { type: string; [k: string]: unknown };
type Pipe = { neg: boolean; cmds: Node[] };
type AndOr = { first: Pipe; rest: { op: string; pipe: Pipe }[] };
type List = { type: "list"; items: { andor: AndOr; bg: boolean }[] };
type Result = { ok: true; ast: List } | { ok: false; reason: string };

// Reines Node-Tooling-Skript ohne Declaration-File.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/bash-parser.mjs";
const { parseBash, MAX_TIEFE } = raw as { parseBash: (c: string) => Result; MAX_TIEFE: number };

const ast = (command: string): List => {
  const r = parseBash(command);
  assert.equal(r.ok, true, command);
  return r.ok ? r.ast : { type: "list", items: [] };
};
const texts = (n: Node): string[] => ((n.words as Word[]) ?? []).map((w) => w.text);
/** Die einfachen Kommandos der obersten Liste, je Eintrag die Wörter. */
const simple = (command: string) => ast(command).items.flatMap((i) => [i.andor.first, ...i.andor.rest.map((r) => r.pipe)].flatMap((p) => p.cmds.map(texts)));

describe("parseBash — Liste, Und-Oder-Kette, Pipeline (#1311)", () => {
  test("Trenner ; & && || | und Zeilenumbruch bauen die Struktur", () => {
    const l = ast("a && b || c; d | e & f\ng");
    assert.equal(l.items.length, 4);
    assert.deepEqual(
      l.items[0].andor.rest.map((r) => r.op),
      ["&&", "||"],
    );
    assert.equal(l.items[1].andor.first.cmds.length, 2, "Pipeline d | e");
    assert.equal(l.items[1].bg, true, "& hinter der Pipeline");
    assert.equal(l.items[2].bg, false);
  });

  test("! negiert die Pipeline; Zeilenumbruch hinter && und | gehört zur Kette", () => {
    assert.equal(ast("! a").items[0].andor.first.neg, true);
    assert.equal(ast("a &&\n b").items[0].andor.rest.length, 1);
    assert.equal(ast("a |\n b").items[0].andor.first.cmds.length, 2);
  });

  test("Wörter: Quotes, Escapes, Zeilenfortsetzung, ANSI-C", () => {
    assert.deepEqual(simple('a b "c d" \'e;f\' g\\ h'), [["a", "b", "c d", "e;f", "g h"]]);
    assert.deepEqual(simple("git \\\n push"), [["git", "push"]]);
    assert.deepEqual(simple("$'gi\\x74' $'a\\tb' $\"x y\""), [["git", "a\tb", "x y"]]);
    assert.deepEqual(simple("cmd 2>&1 &> out"), [["cmd", "2>&1", "&>", "out"]], "Umleitungen mit & sind keine Trenner");
  });

  test("Kommentare sind kein Kommando, a#b ist ein Wort", () => {
    assert.deepEqual(simple("a # b; c"), [["a"]]);
    assert.deepEqual(simple("echo a#b"), [["echo", "a#b"]]);
  });

  test("dynamische Wörter sind markiert, quotierte Schlüsselwörter sind keine", () => {
    const w = (ast("echo $X \"$Y\" 'z' $(a)").items[0].andor.first.cmds[0].words as Word[]).map((x) => [x.dynamic, x.quoted]);
    assert.deepEqual(w, [
      [false, false],
      [true, false],
      [true, true],
      [false, true],
      [true, false],
    ]);
    assert.equal(parseBash('"if" x; fi').ok, false, "quotiertes if ist ein Wort, das fi dahinter verirrt");
    assert.equal(parseBash("echo if then fi done").ok, true, "Schlüsselwörter als Argumente sind Wörter");
  });
});

describe("parseBash — zusammengesetzte Kommandos (#1311)", () => {
  test("Subshell, Gruppe, if, while, for, case, Funktion", () => {
    const type = (c: string) => ast(c).items[0].andor.first.cmds[0].type;
    assert.equal(type("(a; b)"), "subshell");
    assert.equal(type("{ a; b; }"), "group");
    assert.equal(type("if a; then b; elif c; then d; else e; fi"), "if");
    assert.equal(type("while a; do b; done"), "loop");
    assert.equal(type("until a; do b; done"), "loop");
    assert.equal(type("for x in a b; do c; done"), "for");
    assert.equal(type("case $x in a|b) c;; *) d;; esac"), "case");
    assert.equal(type("f() { a; }"), "funcdef");
    assert.equal(type("function f { a; }"), "funcdef");
  });

  test("if-Zweige und case-Arme sind eigene Listen", () => {
    const n = ast("if a; then b; elif c; then d; else e; fi").items[0].andor.first.cmds[0];
    assert.equal((n.clauses as unknown[]).length, 2);
    assert.notEqual(n.else, null);
    const c = ast("case x in a) b;; c) d;; esac").items[0].andor.first.cmds[0];
    assert.equal((c.arms as unknown[]).length, 2);
  });

  test("Umleitungen und & hinter zusammengesetzten Kommandos", () => {
    const l = ast("{ a; } 2>&1 & b");
    assert.equal(l.items[0].bg, true);
    assert.equal(l.items.length, 2);
    const d = ast("while read x; do :; done < <(cat f)").items[0].andor.first.cmds[0];
    assert.equal((d.substs as unknown[]).length, 1, "<(…) hinter done");
  });
});

describe("parseBash — Substitutionen und Heredocs (#1311)", () => {
  test("$(…), Backticks und <(…) sind eigene Listen am Kommando", () => {
    for (const c of ["echo $(a b)", "echo `a b`", 'echo "$(a b)"', "cat <(a b)"]) {
      const n = ast(c).items[0].andor.first.cmds[0];
      assert.equal((n.substs as List[]).length, 1, c);
      assert.deepEqual(simple(c).length, 1);
    }
  });

  test("Heredoc: quotierter Body ist Text, unquotierter trägt aktive Substitutionen", () => {
    const hd = (c: string) => (ast(c).items[0].andor.first.cmds[0].heredocs as { quoted: boolean; body: string; substs: unknown[]; static: boolean }[])[0];
    assert.deepEqual([hd("cat <<'EOF'\n$(git push)\nEOF").quoted, hd("cat <<'EOF'\n$(git push)\nEOF").substs.length], [true, 0]);
    assert.equal(hd("cat <<EOF\n$(git push)\nEOF").substs.length, 1);
    assert.equal(hd("cat <<EOF\nnur Text\nEOF").static, true);
    assert.equal(hd("cat <<-EOF\n\tx\n\tEOF").body, "x\n");
    assert.equal(hd("cat <<EOF | sh\nbody\nEOF").body, "body\n", "der Body gehört zum Heredoc, die Pipe läuft weiter");
  });

  test("Heredoc innerhalb von $(…) und zwei Heredocs in einer Zeile", () => {
    assert.equal(parseBash('gh pr create --body "$(cat <<\'EOF\'\nText (x)\nEOF\n)"').ok, true);
    assert.equal(parseBash("cat <<A <<B\n1\nA\n2\nB").ok, true);
  });
});

describe("parseBash — nicht zerlegbar (#1311)", () => {
  test("offene Quotes, Substitutionen und Heredocs", () => {
    for (const c of ['echo "x', "echo 'x", "echo $(x", "echo `x", "cat <<EOF\nx", "cat <<EOF", "echo $'x"]) assert.equal(parseBash(c).ok, false, c);
  });

  test("verirrte Schlüsselwörter und Klammern", () => {
    for (const c of ["fi", "done", "}", "echo x)", "then a", "if a; then b", "while a; do b", "case x in a) b", "{ a"]) assert.equal(parseBash(c).ok, false, c);
  });

  test("for ((…)) ist nicht unterstützt", () => {
    assert.equal(parseBash("for ((i=0;i<3;i++)); do x; done").ok, false);
  });

  test("Verschachtelung über MAX_TIEFE", () => {
    assert.equal(parseBash("(".repeat(MAX_TIEFE - 5) + "a" + ")".repeat(MAX_TIEFE - 5)).ok, true);
    assert.equal(parseBash("(".repeat(MAX_TIEFE + 5) + "a" + ")".repeat(MAX_TIEFE + 5)).ok, false);
    assert.equal(parseBash("$(".repeat(MAX_TIEFE + 5) + "a" + ")".repeat(MAX_TIEFE + 5)).ok, false);
  });

  test("leere Eingabe ist ein leeres Programm", () => {
    assert.equal(ast("").items.length, 0);
    assert.equal(ast("  \n # nur Kommentar").items.length, 0);
  });
});

describe("parseBash — Here-String (#1311)", () => {
  test("<<< ist ein Wort, kein Heredoc: der Text dahinter bleibt ein eigenes Wort", () => {
    const n = ast("bash <<< 'git push'").items[0].andor.first.cmds[0];
    assert.deepEqual((n.words as Word[]).map((w) => w.text), ["bash", "<<<", "git push"]);
    assert.equal((n.heredocs as unknown[]).length, 0);
  });
});

describe("einfacheKommandos — alle einfachen Kommandos eines AST (#1322 Z4)", () => {
  const mod = raw as { einfacheKommandos: (ast: unknown) => string[][]; ASSIGN_RE: RegExp };
  const kommandos = (command: string) => mod.einfacheKommandos(ast(command));

  test("Env-Präfixe fallen weg, eine reine Zuweisung ergibt kein Kommando", () => {
    assert.deepEqual(kommandos("LANG=C cat docs/a.md"), [["cat", "docs/a.md"]]);
    assert.deepEqual(kommandos("A=1 B=2 grep x f"), [["grep", "x", "f"]]);
    assert.deepEqual(kommandos("X=1"), []);
    assert.deepEqual(kommandos("X=1; Y=$(echo hi)"), [["echo", "hi"]], "nur die Ersetzung ist ein Kommando");
    assert.deepEqual(kommandos("cat a=b"), [["cat", "a=b"]], "Zuweisung nur am Anfang");
  });

  test("Liste, Und-Oder, Pipe, if/for/case, Gruppen und Funktionen werden durchlaufen", () => {
    assert.deepEqual(kommandos("a x && b | c; (d) ; { e; }"), [["a", "x"], ["b"], ["c"], ["d"], ["e"]]);
    assert.deepEqual(kommandos("if t; then u; else v; fi").map((k) => k[0]), ["t", "u", "v"]);
    assert.deepEqual(kommandos("for i in $(ls); do echo $i; done").map((k) => k[0]).sort(), ["echo", "ls"], "for-Liste mit Ersetzung");
    assert.deepEqual(kommandos("case $(pwd) in x) p;; esac").map((k) => k[0]).sort(), ["p", "pwd"], "case-Subjekt mit Ersetzung");
    assert.deepEqual(kommandos("case x in a) p;; b) q;; esac").map((k) => k[0]), ["p", "q"]);
    assert.deepEqual(kommandos("f() { g; }; h").map((k) => k[0]), ["g", "h"]);
  });

  test("Ersetzungen (`$(…)`, Backticks, `<(…)`) und Heredoc-Bodies mit Ersetzungen zählen", () => {
    assert.deepEqual(kommandos("echo $(cat docs/a.md)"), [["echo", ""], ["cat", "docs/a.md"]], "dynamische Wörter tragen keinen Text");
    assert.deepEqual(kommandos("echo `ls`").map((k) => k[0]), ["echo", "ls"]);
    assert.deepEqual(kommandos("diff <(sort a) b").map((k) => k[0]), ["diff", "sort"]);
    const heredoc = kommandos("cat <<EOF\n$(cat docs/a.md)\nEOF");
    assert.deepEqual(heredoc.map((k) => k[0]), ["cat", "cat"], "Ersetzung im Heredoc-Body");
    assert.deepEqual(kommandos("cat <<'EOF'\n$(cat docs/a.md)\nEOF"), [["cat"]], "gequotetes Heredoc ist Text");
  });

  test("Randfälle: leere Eingabe, Nicht-AST", () => {
    assert.deepEqual(kommandos(""), []);
    assert.deepEqual(mod.einfacheKommandos(null), []);
    assert.deepEqual(mod.einfacheKommandos(undefined), []);
  });

  test("ASSIGN_RE ist die eine Quelle: der Worktree-Guard re-exportiert sie", async () => {
    // @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
    const tab = (await import("../../scripts/worktree-guard-tabellen.mjs")) as { ASSIGN_RE: RegExp };
    assert.equal(tab.ASSIGN_RE, mod.ASSIGN_RE);
    assert.equal(mod.ASSIGN_RE.test("LANG=C"), true);
    assert.equal(mod.ASSIGN_RE.test("=x"), false);
    assert.equal(mod.ASSIGN_RE.test("a-b=1"), false);
  });
});
