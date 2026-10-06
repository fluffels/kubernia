/* gh-Guard: gh api an beliebiger Stelle außerhalb von Quotes, Interpreter-Optionen, Laufzeit und Listen (#1311).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Seit der Erkennung ohne Befehlsposition (`ghStellen`) zählt jedes offene `gh api`; Text in Quotes zählt nicht. Je Umweg ein
 * eigener Test, damit eine Sabotage einzeln sichtbar wird; die Laufzeit-Tests binden die Schranken (`LAENGE_MAX`, `STELLEN_MAX`,
 * keine superlineare Zerlegung).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/gh-guard-hook.mjs";

const hook = raw as unknown as { bewerte: (command: unknown) => { ask: boolean; reason?: string } };
const fragt = (c: string) => assert.equal(hook.bewerte(c).ask, true, c.slice(0, 120));
const laeuft = (c: string) => assert.equal(hook.bewerte(c).ask, false, c.slice(0, 120));
const DEL = "gh api -X DELETE repos/o/r/issues/1";
const schnell = (c: string, grenzeMs = 1500) => {
  const t0 = Date.now();
  const r = hook.bewerte(c);
  assert.ok(Date.now() - t0 < grenzeMs, `zu langsam (${Date.now() - t0} ms) für ${c.slice(0, 40)}…`);
  return r;
};

describe("gh api an beliebiger Stelle außerhalb von Quotes", () => {
  test("PowerShell: try/catch/finally, if/else, switch, Invoke-Command, ForEach-Object", () => {
    fragt(`try { ${DEL} } catch { }`);
    fragt(`try { $r = ${DEL} } finally { }`);
    fragt(`if ($a) { ${DEL} } else { 1 }`);
    fragt(`switch (1) { 1 { ${DEL} } }`);
    fragt(`Invoke-Command { ${DEL} }`);
    fragt(`ForEach-Object -Process { 1 } -End { ${DEL} }`);
    fragt(`Write-Output (${DEL})`);
    fragt(`. ${DEL}`);
  });

  test("Bash: Ersetzung, Prozess-Substitution, Backtick, Wrapper, Umleitung, Zuweisung mit Leerzeichen", () => {
    fragt(`diff <(${DEL}) y`);
    fragt("R=`" + DEL + "`");
    fragt(`watch ${DEL}`);
    fragt(`>/dev/null ${DEL}`);
    fragt(`2>&1 ${DEL}`);
    fragt(`a[0]=1 ${DEL}`);
    fragt(`FOO="a b" ${DEL}`);
    fragt(`FOO='a b' ${DEL}`);
  });

  test("gequotetes api und gequotetes gh", () => {
    fragt("gh 'api' -X DELETE repos/o/r/issues/1");
    fragt('gh "api" -X DELETE repos/o/r/issues/1');
    fragt("'gh' 'api' -X DELETE repos/o/r/issues/1");
  });

  test("Gegenprobe: Text in Quotes und lesende Aufrufe", () => {
    laeuft('echo "gh api -X DELETE repos/o/r/issues/1"');
    laeuft("git commit -m 'gh api -X DELETE repos/o/r/issues/1'");
    laeuft('gh issue comment 1 --body "gh api -X DELETE x"');
    laeuft(`try { gh api repos/o/r/issues/1 } catch { }`);
    laeuft("command -v gh");
    laeuft("my-gh api -X DELETE x");
  });

  test("dynamisches Kommando mit Aufrufoperator: & $c api …", () => {
    fragt("$c = 'gh'; & $c api -X DELETE repos/o/r/issues/1");
    fragt("c=gh; . $c api -X DELETE repos/o/r/issues/1");
  });
});

describe("Interpreter hinter Klammer, ! und {", () => {
  test("( … ), ! … und { … } vor bash -c und eval", () => {
    fragt(`( bash -c '${DEL}' )`);
    fragt(`(eval "${DEL}")`);
    fragt(`! bash -c '${DEL}'`);
    fragt(`! eval "${DEL}"`);
    fragt(`{ bash -c '${DEL}'; }`);
    fragt(`{ eval "${DEL}"; }`);
  });

  test("zusammengezogene Short-Optionen und cmd /C", () => {
    for (const opt of ["-xc", "-ce", "-ic", "-lic", "-ec", "-c"]) fragt(`bash ${opt} '${DEL}'`);
    fragt(`cmd /C "${DEL}"`);
    fragt(`cmd /c "${DEL}"`);
  });

  test("Anführungszeichen im Interpreter-String", () => {
    fragt('bash -c "gh api -X \\"DELETE\\" repos/o/r/issues/1"');
    fragt('bash -c "gh api --method=\\"DELETE\\" repos/o/r/issues/1"');
  });

  test("Variable: Single Quotes und Maskierung in der äußeren Shell sind keine Expansion", () => {
    laeuft("bash -c 'gh api repos/o/r/issues/$N'");
    laeuft('bash -c "gh api repos/o/r/issues/\\$N"');
  });
});

describe("Listen: REST-Pfade und Mutationen mit Außenwirkung", () => {
  test("Repo-Transfer, Git-Refs, updateRef", () => {
    fragt("gh api -X POST repos/o/r/transfer -f new_owner=x");
    fragt("gh api -X PATCH repos/o/r/git/refs/heads/main -F force=true");
    fragt("gh api graphql -f query='mutation { updateRef(input: {refId: \"x\", oid: \"y\"}) { clientMutationId } }'");
    laeuft("gh api repos/o/r/git/refs/heads/main");
  });
});

describe("Laufzeit und Schranken (der Dispatcher darf nie in den Timeout laufen)", () => {
  test("tief geschachtelte $( … ) mit gh api", () => {
    const n = 250;
    schnell("echo " + "$(".repeat(n) + "gh api repos/o/r/issues/1" + ")".repeat(n));
    fragt("echo " + "$(".repeat(40) + DEL + ")".repeat(40));
  });

  test("viele abwechselnde Präfixe und Wrapper", () => {
    schnell("env ! ".repeat(8000) + DEL);
    schnell("env then ".repeat(5000) + DEL);
    schnell("sh ".repeat(8000) + DEL);
  });

  test("zu viele Fundstellen in einem Segment fragen pauschal, wenige nicht", () => {
    fragt("gh api repos/o/r/issues/1 ".repeat(60));
    laeuft("gh api repos/o/r/issues/1 ".repeat(5));
  });

  test("LAENGE_MAX: ein langer, lesender Befehl darunter läuft, einer darüber mit gh api fragt, ohne gh api läuft er", () => {
    laeuft("gh api repos/o/r/issues/1 --jq " + "x".repeat(40_000));
    fragt("gh api repos/o/r/issues/1 --jq " + "x".repeat(60_000));
    laeuft("echo " + "x".repeat(60_000));
  });
});
