/* gh-Guard: Präfixe, Fortsetzungen und Interpreter-Strings (#1311) — je Fall ein eigener Test, damit eine Sabotage einzeln sichtbar wird.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Ergänzt test/harness/gh-guard.test.ts: Zeilenfortsetzungen in Bash und PowerShell, Wrapper vor `gh api`, Kontroll-Präfixe,
 * die Formen des Interpreter-Strings (`bash -lc`, Env-Präfix, Pfad, `cmd /c`, zusammengesetzte Wörter, `-o pipefail`) und
 * die Laufzeit der Präfix-Zerlegung (kein exponentielles oder kubisches Backtracking).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/gh-guard-hook.mjs";

const hook = raw as unknown as { bewerte: (command: unknown) => { ask: boolean; reason?: string } };
const fragt = (c: string) => assert.equal(hook.bewerte(c).ask, true, c);
const laeuft = (c: string) => assert.equal(hook.bewerte(c).ask, false, c);

describe("Zeilenfortsetzung trennt ein gh api-Segment nicht (Bash \\ und PowerShell-Backtick)", () => {
  test("Bash: Backslash vor dem Zeilenumbruch", () => {
    fragt("gh api repos/o/r/issues/1 \\\n  -X DELETE");
    fragt("gh api \\\n -X DELETE repos/o/r/issues/1");
    fragt("gh api graphql \\\n -f query='mutation { deleteIssue(input: {issueId: \"x\"}) { clientMutationId } }'");
  });

  test("PowerShell: Backtick vor dem Zeilenumbruch, auch mit CRLF", () => {
    fragt("gh api repos/o/r/issues/1 `\n -X DELETE");
    fragt("gh api repos/o/r/issues/1 `\r\n -X DELETE");
    fragt("gh api graphql `\n -f query='mutation { deleteIssue(input: {issueId: \"x\"}) { clientMutationId } }'");
  });

  test("Gegenprobe: ein lesender Aufruf mit Fortsetzung fragt nicht; PowerShell-Pfad vor ; trennt weiter", () => {
    laeuft("gh api repos/o/r/issues/1 \\\n  --jq .title");
    fragt("cd C:\\dev\\; gh api -X DELETE repos/o/r/issues/1");
  });
});

describe("Wrapper und Kontroll-Präfixe vor gh api", () => {
  test("env, timeout, xargs, time -p, nohup", () => {
    for (const w of ["env", "env FOO=1", "timeout 5", "xargs -n 1", "time -p", "nohup", "nice -n 5", "sudo -E"]) fragt(`${w} gh api -X DELETE repos/o/r/issues/1`);
  });

  test("Gegenprobe: gh api als Text hinter einem Wrapper-Kommando ist kein Aufruf", () => {
    laeuft("env FOO=1 echo \"gh api -X DELETE repos/o/r/issues/1\"");
    laeuft("timeout 5 echo 'gh api -X DELETE x'");
  });

  test("PowerShell -Process, if rechts vom =, Bash-case-Arm", () => {
    fragt("1..3 | ForEach-Object -Process { gh api -X DELETE repos/o/r/issues/$_ }");
    fragt("$x = if ($true) { gh api -X DELETE repos/o/r/issues/1 }");
    fragt("case a in a) gh api -X DELETE repos/o/r/issues/1;; esac");
  });
});

describe("Interpreter-Strings neben gh api", () => {
  test("bash -lc, Env-Präfix, voller Pfad, cmd /c mit Pfad", () => {
    fragt('bash -lc "gh api -X DELETE repos/o/r/issues/1"');
    fragt('FOO=1 bash -c "gh api -X DELETE repos/o/r/issues/1"');
    fragt('/bin/bash -c "gh api -X DELETE repos/o/r/issues/1"');
    fragt('C:\\Windows\\System32\\cmd.exe /c "gh api -X DELETE repos/o/r/issues/1"');
  });

  test("hinter einem Kontroll-Präfix", () => {
    fragt('if true; then bash -c "gh api -X DELETE repos/o/r/issues/1"; fi');
  });

  test("zusammengesetzte Wörter und Shell-Optionen mit Wert", () => {
    fragt("bash -c 'gh api -X DELETE repos/o/r/issues/'1");
    fragt('bash -c "gh api -X DELETE repos/o/r/issues/"1');
    fragt("bash -c 'gh api -X DELETE x'\"y\"");
    fragt("bash -o pipefail -c 'gh api -X DELETE repos/o/r/issues/1'");
  });

  test("Gegenprobe: ein lesender Interpreter-String fragt nicht", () => {
    laeuft('bash -lc "gh api repos/o/r/issues/1"');
    laeuft("bash -o pipefail -c 'gh api repos/o/r/issues/1'");
  });
});

describe("Laufzeit der Präfix-Zerlegung", () => {
  test("lange Klammer- und Leerzeichenfolgen vor gh api bleiben schnell (kein Backtracking-Blowup)", () => {
    for (const vorne of ["(".repeat(3000), "( ".repeat(1500), "{ ".repeat(1500), "! ".repeat(1500)]) {
      const t0 = Date.now();
      hook.bewerte(`${vorne}x gh api y`);
      assert.ok(Date.now() - t0 < 1000, `zu langsam für ${vorne.slice(0, 6)}…`);
    }
  });
});
