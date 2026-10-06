/* gh-Guard-Wächter (#1311, Z5 aus #1204) – `gh api` mit Außenwirkung fragt nach, alles andere läuft durch.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * `permissions.allow` enthält `Bash(gh api:*)`. Darüber ließen sich ohne Rückfrage Issues und Board-Items
 * löschen, Rulesets/Secrets/Repo-Einstellungen ändern oder im Forum posten. Der Hook
 * `scripts/gh-guard-hook.mjs` setzt für genau diese Formen `permissionDecision: "ask"`; die Board-Mutationen
 * des Alltags (Position, Item hinzufügen, Status) und alle Lesezugriffe laufen weiter durch.
 *
 * Ehrliche Grenze: grobe Textprüfung, keine Shell-Auswertung (siehe Kopf des Hooks).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/gh-guard-hook.mjs";

type Bewertung = { ask: boolean; reason?: string };
const hook = raw as unknown as {
  bewerte: (command: unknown) => Bewertung;
  parseHookInput: (text: string) => { tool?: string; command?: string };
  segmente: (command: string) => string[];
  buildAskOutput: (reason: string) => { hookSpecificOutput: { permissionDecision: string; hookEventName: string } };
  GEPRUEFTE_TOOLS: string[];
};

const lies = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const graphql = (mutation: string) => `gh api graphql -f query='mutation($i:ID!){ ${mutation}(input:{id:$i}){ clientMutationId } }' -f i=X`;

describe("gh api mit Außenwirkung fragt nach (#1204)", () => {
  test.each([
    ["deleteIssue", graphql("deleteIssue")],
    ["deleteProjectV2Item", graphql("deleteProjectV2Item")],
    ["deleteDiscussion", graphql("deleteDiscussion")],
    ["transferIssue", graphql("transferIssue")],
    ["addDiscussionComment (Forum posten)", graphql("addDiscussionComment")],
    ["createDiscussion", graphql("createDiscussion")],
    ["updateRepository", graphql("updateRepository")],
    ["updateBranchProtectionRule", graphql("updateBranchProtectionRule")],
    ["createRepositoryRuleset", graphql("createRepositoryRuleset")],
    ["-X DELETE auf ein Label", "gh api -X DELETE repos/fluffels/kubernia/labels/x"],
    ["--method=DELETE", "gh api --method=DELETE repos/fluffels/kubernia/issues/comments/1"],
    ["--method DELETE (Kleinschreibung)", "gh api --method delete repos/o/r/git/refs/heads/x"],
    ["REST: Ruleset schreiben", "gh api -X PUT repos/o/r/rulesets/1 -f name=x"],
    ["REST: Secret setzen (implizit POST über -f)", "gh api repos/o/r/actions/secrets/X -f value=y"],
    ["REST: Branch-Protection", "gh api -X PUT repos/o/r/branches/main/protection --input p.json"],
    ["REST: Repo-Einstellungen PATCH", "gh api -X PATCH repos/o/r -f private=false"],
    ["REST: Forum per REST", "gh api repos/o/r/discussions/1/comments -f body=hallo"],
    ["nach && verkettet", "git status && gh api graphql -f query='mutation{ deleteIssue(input:{issueId:\"X\"}){ clientMutationId } }'"],
    ["gh.exe (Windows)", "gh.exe api -X DELETE repos/o/r/labels/x"],
    ["mehrzeilige Mutation im Query-Argument", "gh api graphql -f query='\n  mutation($i:ID!) {\n    deleteIssue(input:{issueId:$i}) {\n      clientMutationId\n    }\n  }' -f i=X"],
    ["mehrzeilig in doppelten Anführungszeichen (PowerShell)", 'gh api graphql -f query="\nmutation {\n  deleteProjectV2Item(input:{}) { deletedItemId }\n}"'],
    ["Variablen-Zuweisung vor gh api", "GH_TOKEN=x gh api -X DELETE repos/o/r/labels/y"],
    ["nach Pipe", "echo x | gh api -X DELETE repos/o/r/labels/z"],
  ])("%s → ask", (_name, command) => {
    const r = hook.bewerte(command);
    assert.equal(r.ask, true, command);
    assert.match(r.reason ?? "", /gh-Guard/);
  });
});

describe("Alltags-Aufrufe laufen durch (kein Dauer-Nachfragen)", () => {
  test.each([
    ["Board-Position", graphql("updateProjectV2ItemPosition")],
    ["Item hinzufügen", graphql("addProjectV2ItemById")],
    ["Board-Items lesen (REST)", "gh api --paginate users/fluffels/projectsV2/1/items?per_page=100&fields=358708531 --jq '.[].id'"],
    ["Ruleset nur lesen (GET)", "gh api repos/o/r/rulesets/1"],
    ["Ruleset lesen mit -X GET", "gh api -X GET repos/o/r/rulesets"],
    ["Rate-Limit", "gh api rate_limit --jq .resources.core"],
    ["GraphQL-Query ohne Mutation", "gh api graphql -f query='{ rateLimit { remaining } }'"],
    ["Text mit Mutationsnamen in einem anderen Befehl", 'gh issue comment 5 --body "deleteIssue ist verboten"'],
    ["Lese-Query mit einem Feld deleteBranchOnMerge (kein Aufruf, keine Mutation)", "gh api graphql -f query='{ repository(owner:\"o\", name:\"r\") { deleteBranchOnMerge } }'"],
    ["mehrzeilige Lese-Query", "gh api graphql -f query='\nquery {\n  viewer { login }\n}'"],
    ["Mutationsname als Wert, ohne Aufruf", "gh api graphql -f query='mutation { __typename }' -f note=deleteIssue"],
    ["Commit-Text", 'git commit -m "feat: deleteIssue-Guard (gh api)"'],
    ["Issue-Kommentar per REST", "gh api repos/o/r/issues/5/comments -f body=hallo"],
    ["leerer Befehl", ""],
    ["kein gh", "npm run verify"],
  ])("%s → durch", (_name, command) => {
    assert.equal(hook.bewerte(command).ask, false, command);
  });

  test("kaputte Eingaben: kein Absturz, nie ask", () => {
    for (const bad of [undefined, null, 42, {}, []]) assert.equal(hook.bewerte(bad).ask, false);
  });
});

describe("Hook-Verdrahtung (#1311)", () => {
  test("Payload des Bash- und des PowerShell-Tools wird gelesen, kaputtes JSON ergibt {}", () => {
    assert.deepEqual(hook.parseHookInput('{"tool_name":"PowerShell","tool_input":{"command":"gh api x"}}'), { tool: "PowerShell", command: "gh api x" });
    assert.deepEqual(hook.parseHookInput('{"tool_name":"Bash","tool_input":{"command":"ls"}}'), { tool: "Bash", command: "ls" });
    assert.deepEqual(hook.parseHookInput("kein json"), {});
    assert.deepEqual(hook.parseHookInput(""), {});
    assert.deepEqual(hook.GEPRUEFTE_TOOLS, ["Bash", "PowerShell"]);
  });

  test("die Ausgabe ist ein PreToolUse-ask, kein deny", () => {
    const o = hook.buildAskOutput("grund").hookSpecificOutput;
    assert.equal(o.hookEventName, "PreToolUse");
    assert.equal(o.permissionDecision, "ask");
  });

  test("settings.json registriert den Hook für Bash und PowerShell", () => {
    const s = JSON.parse(lies(".claude/settings.json")) as { hooks: { PreToolUse: { matcher: string; hooks: { args?: string[] }[] }[] } };
    const eintrag = s.hooks.PreToolUse.find((e) => e.hooks.some((h) => (h.args ?? []).some((a) => a.endsWith("scripts/gh-guard-hook.mjs"))));
    assert.ok(eintrag, "kein PreToolUse-Eintrag für scripts/gh-guard-hook.mjs");
    assert.deepEqual(eintrag.matcher.split("|").sort(), ["Bash", "PowerShell"]);
  });

  test("die Hook-Skripte sind geschützte Pfade (ein abgeschwächter Wächter hinterlässt eine Audit-Spur)", () => {
    const quelle = JSON.parse(lies(".github/protected-paths.json")) as { harness: string[] };
    for (const f of ["gh-guard-hook.mjs", "worktree-guard-hook.mjs", "worktree-guard-powershell.mjs", "stop-verify-hook.mjs"]) {
      assert.ok(quelle.harness.includes(`/scripts/${f}`), `protected-paths.json › harness braucht /scripts/${f}`);
    }
  });
});

describe("Segmentierung respektiert Anführungszeichen (#1311)", () => {
  test("Trenner innerhalb von Quotes teilen nicht, außerhalb schon", () => {
    assert.deepEqual(hook.segmente("a && b; c | d\ne"), ["a ", " b", " c ", " d", "e"]);
    assert.deepEqual(hook.segmente("gh api x -f q='a;b\nc' && ls"), ["gh api x -f q='a;b\nc' ", " ls"]);
    assert.deepEqual(hook.segmente('echo "a && b" || c'), ['echo "a && b" ', " c"]);
    assert.deepEqual(hook.segmente("echo 'it' ; ls"), ["echo 'it' ", " ls"]);
    assert.deepEqual(hook.segmente(""), [""]);
  });

  test("ein unbalanciertes Anführungszeichen wirft nicht (der Rest bleibt ein Segment)", () => {
    assert.equal(hook.segmente("gh api -X DELETE x 'offen && ls").length, 1);
    assert.equal(hook.bewerte("gh api -X DELETE repos/o/r/labels/x 'offen").ask, true);
  });
});
