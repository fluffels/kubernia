/* gh-Guard: Anlege-Sperre für Issues (#1693) — neue Tickets nur über `node scripts/spezifikation.mjs anlegen`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Gefragt wird bei: POST auf genau `repos/<o>/<r>/issues` (ausdrücklich oder implizit über Felder, auch mit `?…`), der GraphQL-Mutation
 * `createIssue` und dem Kommando `gh issue create` (Bash und PowerShell). Nicht gefragt wird bei Kommentaren, Labels und Assignees eines
 * Issues sowie bei Lesezugriffen: davon hängen Sammelticket-Zeilen, Claim und Board ab.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/gh-guard-hook.mjs";

const hook = raw as unknown as { bewerte: (command: unknown, opts?: { shell?: string }) => { ask: boolean; reason?: string } };
const fragt = (c: string, shell?: string) => assert.equal(hook.bewerte(c, { shell }).ask, true, c);
const laeuft = (c: string, shell?: string) => assert.equal(hook.bewerte(c, { shell }).ask, false, c);

describe("neue Issues anlegen ist gesperrt (Rückfrage mit Verweis auf spezifikation.mjs)", () => {
  test("POST auf repos/<o>/<r>/issues ausdrücklich", () => {
    fragt("gh api -X POST repos/o/r/issues -f title=x");
    fragt("gh api --method POST /repos/o/r/issues -f title=x");
    fragt("gh api repos/{owner}/{repo}/issues -X POST");
  });
  test("implizites POST über Felder", () => {
    fragt("gh api repos/o/r/issues -f title=x -f body=y");
    fragt("gh api repos/o/r/issues -F title=x");
    fragt("gh api repos/o/r/issues --input datei.json");
  });
  test("mit Query-String und in Quotes", () => {
    fragt("gh api 'repos/o/r/issues?x=1' -f title=x");
    fragt('gh api "repos/o/r/issues" -f title=x');
  });
  test("PowerShell und verschachtelte Interpreter", () => {
    fragt("gh api repos/o/r/issues -f title=x", "powershell");
    fragt("bash -c \"gh api repos/o/r/issues -f title=x\"");
    fragt("echo ok; gh api -X POST repos/o/r/issues -f title=x");
  });
  test("GraphQL createIssue", () => {
    fragt("gh api graphql -f query='mutation($r:ID!){ createIssue(input:{repositoryId:$r,title:\"x\"}){ issue { number } } }'");
  });
  test("gh issue create (Bash und PowerShell)", () => {
    fragt("gh issue create --title x --body y");
    fragt("gh issue create --title x", "powershell");
    fragt("cd x && gh.exe issue create --title x", "powershell");
  });
  test("die Meldung nennt den erlaubten Weg", () => {
    const r = hook.bewerte("gh api repos/o/r/issues -f title=x");
    assert.match(r.reason ?? "", /node scripts\/spezifikation\.mjs anlegen/);
  });
});

describe("Kommentare, Labels, Assignees und Lesen bleiben frei (Sammelticket-Zeilen, Claim)", () => {
  test("POST auf /issues/<n>/comments, /labels, /assignees", () => {
    laeuft("gh api -X POST repos/o/r/issues/5/comments -f body=x");
    laeuft("gh api repos/o/r/issues/5/comments -f body=x");
    laeuft("gh api repos/o/r/issues/5/labels -f 'labels[]=x'");
    laeuft("gh api -X POST repos/o/r/issues/5/assignees -f 'assignees[]=x'");
  });
  test("PATCH und Lesen auf Issues", () => {
    laeuft("gh api -X PATCH repos/o/r/issues/5 -f state=closed");
    laeuft("gh api repos/o/r/issues");
    laeuft("gh api repos/o/r/issues?state=open --paginate");
    laeuft("gh api repos/o/r/issues/5");
  });
  test("Issue-Befehle außer create und Erwähnungen in Texten", () => {
    laeuft("gh issue comment 5 --body 'x'");
    laeuft("gh issue edit 5 --add-assignee @me");
    laeuft("gh issue view 5");
    laeuft("git commit -m \"nicht gh issue create benutzen\"");
    laeuft("node scripts/spezifikation.mjs anlegen --body-datei x.md");
  });
  test("graphql ohne createIssue", () => {
    laeuft("gh api graphql -f query='query { viewer { login } }'");
  });
});
