/* Worktree-Guard: Alias-Gültigkeit und Parser-Umleitung `>|` (#1311).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * `-c alias.x=…` gilt nur für den eigenen Aufruf und die inneren Läufe seines `!`-Aliases (eine eigene Ebene `cAliases`), ein
 * `git config alias.*` im inneren Lauf bleibt befehlsweit; Konfigurationsnamen (`alias`, `ALIAS`, der Aliasname) sind nicht
 * case-sensitiv. `>|` ist eine Umleitung und kein Pipe-Trenner (exakte Ziele, damit die grobe Wortregel es nicht verdeckt).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { resolve } from "node:path";

type Analyse = { targets: string[]; asks: Map<string, { reason: string; mainOnly: boolean }> };
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/worktree-guard-hook.mjs";

const analyse = (raw as { analyse: (c: string, cwd: string, deps: unknown) => Analyse }).analyse;
const deps = { statSync: () => ({ isDirectory: () => true }), execFileSync: () => { throw new Error("kein git"); }, homedir: () => "/home/x" };
const HAUPT = resolve("/repo/main");
const WT = resolve("/repo/wt");
const ziele = (cmd: string, d: unknown = deps) => analyse(cmd, HAUPT, d).targets;

describe("Konfigurationsnamen sind nicht case-sensitiv", () => {
  test("Abschnitt alias in -c und git config, auch gemischt", () => {
    assert.ok(ziele("git -c ALIAS.p=push p").length > 0);
    assert.ok(ziele("git -c Alias.P=push p").length > 0);
    assert.ok(ziele("git config ALIAS.p push; git p").length > 0);
    assert.ok(ziele("git config --add Alias.p push; git P").length > 0);
  });

  test("Gegenprobe: ein Alias auf status ist kein Push", () => {
    assert.deepEqual(ziele("git -c ALIAS.p=status p"), []);
  });
});

describe("Gültigkeit der -c-Aliase", () => {
  const konfig = { ...deps, execFileSync: (_c: string, args: string[]) => { if (args[0] === "config") return "push"; throw new Error("kein git"); } };

  test("ein git config alias.q im inneren !-Alias bleibt befehlsweit gültig", () => {
    assert.ok(ziele("git -c alias.p='!git config alias.q push' p; git q").length > 0);
    assert.ok(ziele("git -c alias.p='!git config alias.q push' p && git q").length > 0);
  });

  test("-c-Aliase gelten nicht für spätere Aufrufe: dort gilt die echte Konfiguration", () => {
    assert.ok(ziele("git -c alias.p='!git status' p; git p", konfig).length > 0);
  });

  test("Vorrang: der -c des Aufrufs schlägt einen im selben Befehl gesetzten git config-Alias", () => {
    assert.ok(ziele("git config alias.p status; git -c alias.p=push p").length > 0);
    assert.ok(ziele("git config alias.p status && git -c alias.p=push p").length > 0);
    assert.deepEqual(ziele("git config alias.p push; git -c alias.p=status p"), [], "umgekehrt: der -c-Alias auf status gilt");
  });

  test("ein -c-Alias gilt für den inneren Aufruf des !-Aliases", () => {
    assert.ok(ziele("git -c alias.a='!git b' -c alias.b=push a").length > 0);
  });
});

describe("Umleitung >| ist kein Pipe-Trenner", () => {
  test("exakte Ziele: das Kommando hinter >| ist ein Dateiname, ein cd davor gilt weiter", () => {
    assert.deepEqual(ziele("echo a >| git push"), []);
    assert.deepEqual(analyse(`cd '${WT}' >| log; git push`, HAUPT, deps).targets, [WT]);
    assert.deepEqual(analyse(`cd '${WT}' >|log; git push`, HAUPT, deps).targets, [WT], "angehängte Form");
    assert.deepEqual(analyse(`cd '${WT}' 2>|log; git push`, HAUPT, deps).targets, [WT], "mit Dateideskriptor");
  });
});
