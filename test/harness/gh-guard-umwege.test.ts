/* gh-Guard: Fortsetzung im Befehl, Wrapper mit Optionswert, Interpreter-Optionen, Ersetzungen und Grenzen (#1311).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Ergänzt gh-guard.test.ts und gh-guard-praefixe.test.ts; je Umweg ein eigener Test, damit eine Sabotage einzeln sichtbar wird.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/gh-guard-hook.mjs";

const hook = raw as unknown as { bewerte: (command: unknown) => { ask: boolean; reason?: string } };
const fragt = (c: string) => assert.equal(hook.bewerte(c).ask, true, c);
const laeuft = (c: string) => assert.equal(hook.bewerte(c).ask, false, c);
const DEL = "gh api -X DELETE repos/o/r/issues/1";

describe("Zeilenfortsetzung mitten in der gh api-Zeile", () => {
  test("Bash: nach -X, nach --method, zwischen gh und api, vor dem Interpreter-String", () => {
    fragt("gh api -X \\\n DELETE repos/o/r/issues/1");
    fragt("gh api repos/o/r/issues/1 --method \\\n DELETE");
    fragt("gh \\\n api -X DELETE repos/o/r/issues/1");
    fragt("bash -c \\\n 'gh api -X DELETE repos/o/r/issues/1'");
  });

  test("PowerShell: Backtick, auch mit CRLF", () => {
    fragt("gh api repos/o/r/issues/1 --method `\n DELETE");
    fragt("gh `\r\n api -X DELETE repos/o/r/issues/1");
  });

  test("in Single Quotes ist \\ + Zeilenumbruch keine Fortsetzung (Text bleibt Text)", () => {
    laeuft("echo 'gh \\\n api -X DELETE repos/o/r/issues/1'");
  });
});

describe("Wrapper mit Optionswert und Pfade vor gh", () => {
  test("xargs -I {}, timeout -s KILL 5, env -u FOO, sudo -u x, /usr/bin/env", () => {
    fragt("echo 1 | xargs -I {} gh api -X DELETE repos/o/r/issues/{}");
    fragt("xargs -0 -I {} gh api -X DELETE x");
    fragt("timeout -s KILL 5 gh api -X DELETE x");
    fragt("env -u FOO gh api -X DELETE x");
    fragt("sudo -u x gh api -X DELETE x");
    fragt("/usr/bin/env gh api -X DELETE x");
  });

  test("Pfad und Quotes um gh", () => {
    fragt("/usr/bin/gh api -X DELETE repos/o/r/issues/1");
    fragt("'gh' api -X DELETE repos/o/r/issues/1");
    fragt('"C:\\Program Files\\GitHub CLI\\gh.exe" api -X DELETE repos/o/r/issues/1');
    fragt("& 'C:\\Program Files\\GitHub CLI\\gh.exe' api -X DELETE repos/o/r/issues/1");
  });

  test("Gegenprobe: gh api als Text hinter einem Wrapper-Kommando", () => {
    laeuft("env -u FOO echo gh api -X DELETE x");
    laeuft("xargs -I {} echo gh api -X DELETE {}");
  });
});

describe("Interpreter-Optionen und Variablen der äußeren Shell", () => {
  test("PowerShell mit -ExecutionPolicy davor, -c mit -- dahinter", () => {
    fragt('pwsh -ExecutionPolicy Bypass -Command "gh api -X DELETE repos/o/r/issues/1"');
    fragt('powershell.exe -NoProfile -ExecutionPolicy Bypass -c "gh api -X DELETE repos/o/r/issues/1"');
    fragt("bash -c -- 'gh api -X DELETE repos/o/r/issues/1'");
  });

  test("eine Variable in der äußeren Double-Quote-Shell expandiert, in Single Quotes nicht", () => {
    fragt("bash -c \"gh api graphql -f query='$Q'\"");
    fragt("pwsh -c \"gh api graphql -f query='$Q'\"");
    laeuft("bash -c 'gh api repos/o/r/issues/1 --jq .title'");
    laeuft("bash -c 'gh api repos/o/r/issues/1 --jq \".title\"'");
  });
});

describe("Präfix-Zeichen und Schleifenende der Präfix-Zerlegung", () => {
  test("Backtick und ! vor gh api", () => {
    fragt("`" + DEL + "`");
    fragt("! " + DEL);
    fragt("if ! " + DEL + "; then :; fi");
  });

  test("zweiter case-Arm", () => {
    fragt("case a in a) echo;; b) " + DEL + ";; esac");
    fragt("case a in\n a) echo ;;\n b) " + DEL + " ;;\nesac");
  });

  test("sehr viele Präfixe vor gh api werden nicht abgeschnitten (kein stilles Durchlassen)", () => {
    fragt("env ".repeat(60) + DEL);
    fragt("then ".repeat(60) + DEL);
    fragt("FOO=1 ".repeat(60) + DEL);
    fragt("if ($a) { ".repeat(60) + DEL);
  });

  test("zu lange Befehle mit gh api fragen, ohne gh api laufen sie durch", () => {
    fragt("echo x; ".repeat(20000) + "gh api repos/o/r/issues/1");
    laeuft("echo x; ".repeat(20000));
  });
});

describe("Ersetzungen $( … ) mitten im Segment", () => {
  test("Zuweisung, export, echo", () => {
    fragt("R=$(" + DEL + ")");
    fragt("export R=$(" + DEL + ")");
    fragt("echo $(" + DEL + ")");
    fragt("echo $(echo $(" + DEL + "))");
    fragt("echo \"$(" + DEL + ")\"");
  });

  test("Gegenprobe: lesend, Single Quotes, maskiert", () => {
    laeuft("R=$(gh api repos/o/r/issues/1)");
    laeuft("echo '$(" + DEL + ")'");
    laeuft("echo \\$(" + DEL + ")");
  });
});
