/* gh-Guard: Quote-Dialekt je Shell (PowerShell-Backtick gegen Bash-Backslash) und Backtick-Ersetzung (#1316).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Produktion ruft den Guard immer mit der Shell des Tools auf (`{ shell: "bash" | "powershell" }`), die älteren Suiten laufen
 * neutral. Die Matrix unten fährt Kernfälle in beiden Dialekten, damit beide nicht auseinanderlaufen.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/gh-guard-hook.mjs";

type Shell = "bash" | "powershell";
const hook = raw as unknown as { bewerte: (command: unknown, opt?: { shell?: Shell }) => { ask: boolean; reason?: string } };
const fragt = (c: string, shell?: Shell) => assert.equal(hook.bewerte(c, { shell }).ask, true, `${shell ?? "neutral"}: ${c.slice(0, 120)}`);
const laeuft = (c: string, shell?: Shell) => assert.equal(hook.bewerte(c, { shell }).ask, false, `${shell ?? "neutral"}: ${c.slice(0, 120)}`);
const DEL = "gh api -X DELETE repos/o/r/issues/1";
const LESEN = "gh api repos/o/r/issues/1";

describe("PowerShell-Dialekt: `\\\"` beendet den String (#1316 Z1a)", () => {
  test("ein Pfad mit abschließendem Backslash in Double Quotes verschluckt das folgende gh api nicht", () => {
    fragt(String.raw`Set-Location "C:\dev\"; ${DEL}`, "powershell");
    fragt(String.raw`Set-Location "C:\dev\"; ${DEL}`.replace("; ", "\n"), "powershell");
    fragt(String.raw`Set-Location "C:\dev\" && ${DEL}`, "powershell");
  });

  test("ein Ersetzungsausdruck im Pfad-String wird erreicht", () => {
    fragt(String.raw`Write-Output "C:\dev\$(${DEL})"`, "powershell");
  });

  test("Gegenprobe: Text mit Backtick-Escape bleibt Text (kein Fehlalarm)", () => {
    laeuft("gh issue comment 1 --body \"a `\"; " + DEL + "`\" b\"", "powershell");
    laeuft(String.raw`gh issue comment 1 --body "Pfad C:\dev\ ok"`, "powershell");
    laeuft(String.raw`Set-Location "C:\dev\"; ${LESEN}`, "powershell");
  });

  test("Bash bleibt bei Backslash-Escapes: ein maskiertes Quote beendet den String nicht", () => {
    laeuft(String.raw`gh issue comment 1 --body "a \"; ${DEL}\" b"`, "bash");
  });

  test("ein innerer pwsh-Aufruf liest seinen Text im PowerShell-Dialekt, bash -c im Bash-Dialekt", () => {
    fragt(`pwsh -Command '${String.raw`Set-Location "C:\dev\"; `}${DEL}'`, "bash");
  });
});

describe("Backtick-Ersetzung unter Bash (#1316 Z1c)", () => {
  test("Backticks außerhalb von Single Quotes führen aus, auch in Double Quotes", () => {
    fragt("echo `" + DEL + "`", "bash");
    fragt('echo "`' + DEL + '`"', "bash");
    fragt('GH="gh api"; r=`$GH -X DELETE repos/o/r/issues/1`', "bash");
    fragt('GH="gh api"; echo "`$GH -X DELETE repos/o/r/issues/1`"', "bash");
  });

  test("Gegenproben: maskierte oder gequotete Backticks sind Text", () => {
    laeuft('git commit -m "fix: \\`' + DEL + '\\` fragt"', "bash");
    laeuft("git commit -m '" + "`" + DEL + "`'", "bash");
    laeuft("echo `" + LESEN + "`", "bash");
  });

  test("PowerShell: ein Backtick ist dort Escape, keine Ersetzung", () => {
    laeuft('gh issue comment 1 --body "a `gh api -X DELETE x"', "powershell");
  });
});

describe("Interpreter-Variable `& $b -c '…'` (#1316 Z1b)", () => {
  test("der Aufruf über die Variable mit gh api DELETE im String fragt (beide Dialekte)", () => {
    for (const shell of ["bash", "powershell"] as const) {
      fragt(`$b='bash'; & $b -c '${DEL}'`, shell);
      fragt(`$b='pwsh'; & $b -Command '${DEL}'`, shell);
    }
  });
});

describe("Matrix: Kernfälle in beiden Dialekten (Produktion gegen Tests)", () => {
  const fragend = [
    DEL,
    `try { ${DEL} }`,
    `echo "$(${DEL})"`,
    `bash -c "${DEL}"`,
    `$M="DELETE"; gh api -X $M repos/o/r/issues/1`,
    `eval "${DEL}"`,
    `GH=gh; & $GH api -X DELETE x`,
    `gh api graphql -f query='mutation { deleteIssue(input: {issueId: "x"}) { clientMutationId } }'`,
    `gh api -X PUT repos/o/r/actions/secrets/X`,
    `cat <<'EOF' | bash\n${DEL}\nEOF`,
  ];
  const lesend = [LESEN, `gh issue comment 1 --body "gh api -X DELETE x"`, `echo gh api -X DELETE`.replace("echo ", "echo '") + "'", `jq . $F`];
  for (const shell of ["bash", "powershell"] as const) {
    test(`${shell}: gefährliche Formen fragen`, () => {
      for (const c of fragend) fragt(c, shell);
    });
    test(`${shell}: Lesezugriffe und Text laufen durch`, () => {
      for (const c of lesend) laeuft(c, shell);
    });
  }
});
