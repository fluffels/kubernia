/* Least-Privilege-Wächter für die Agenten-Permissions (#901).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Ein voll-autonomer Agent mit Merge-Recht hat unbegrenzten Shell-Zugriff, wenn
 * `.claude/settings.json` keinen `permissions`-Block hat — die einzige Leitplanke
 * wären dann zwei eng geschnittene Hooks. Anthropics Permissions-Doku + OWASP
 * Agentic 2026 nennen Least-Privilege (read-only-Default, `deny` fürs Irreversible,
 * Netz-Befehle nicht auto-approven) als Kernleitplanke autonomer Setups.
 *
 * Dieser Test hält die Leitplanke am Leben: ein späterer Agent (oder ein
 * versehentlicher Merge-Konflikt) darf die `deny`-/`ask`-Einträge nicht still
 * entfernen, ohne dass `npm test` rot wird. Rein struktureller Wächter (wie
 * diffsize/docdrift/eslint-worktrees-ignore): er liest die getrackte
 * `.claude/settings.json` und prüft ihre Form — er ruft nichts aus.
 *
 * ⚠️ Ehrliche Grenze (dieselbe Offenheit wie beim CODEOWNERS-Hinweis in AGENTS.md
 * und beim fail-open des worktree-guard-Hooks): `deny` für Bash ist ein
 * PREFIX-Match und kein wasserdichter Sicherheitszaun — es fängt die dokumentierten
 * Formen (`rm -rf …`, `git push --force …`), nicht jede erdenkliche Schreibweise
 * (`rm  -rf`, `rm --recursive --force`, ein Alias). Der Wert liegt darin, die
 * NIE-im-Workflow-nötigen katastrophalen Kommandos hart zu blocken und rohen
 * Netz-Zugriff (curl/wget/nc) auf `ask` zu stellen; die eigentliche Durchsetzung
 * für Code-Qualität bleibt das PR-Gate (#592).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Permissions = { allow?: string[]; ask?: string[]; deny?: string[] };
type Settings = { permissions?: Permissions };

const settings = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../.claude/settings.json", import.meta.url)), "utf8"),
) as Settings;

const perms = settings.permissions ?? {};
const allow = perms.allow ?? [];
const ask = perms.ask ?? [];
const deny = perms.deny ?? [];

describe("Agenten-Permissions in .claude/settings.json (#901)", () => {
  test("hat überhaupt einen permissions-Block mit allow/ask/deny", () => {
    assert.ok(settings.permissions, ".claude/settings.json braucht einen `permissions`-Block");
    assert.ok(Array.isArray(perms.allow), "`permissions.allow` muss eine Liste sein");
    assert.ok(Array.isArray(perms.ask), "`permissions.ask` muss eine Liste sein");
    assert.ok(Array.isArray(perms.deny), "`permissions.deny` muss eine Liste sein");
  });

  test("deny blockt die irreversiblen/gefährlichen Kern-Muster (rm -rf, force-push, sudo, publish, repo delete)", () => {
    const required = [
      "Bash(rm -rf:*)",
      "Bash(git push --force:*)",
      "Bash(git push -f:*)",
      "Bash(sudo:*)",
      "Bash(npm publish:*)",
      "Bash(gh repo delete:*)",
    ];
    for (const rule of required) {
      assert.ok(
        deny.includes(rule),
        `deny muss ${rule} enthalten (irreversibel/gefährlich, nie Teil des Workflows) — nicht still entfernen (#901)`,
      );
    }
  });

  test("ask setzt rohen Netz-Zugriff (nicht Workflow) auf einen menschlichen Checkpoint", () => {
    for (const rule of ["Bash(curl:*)", "Bash(wget:*)"]) {
      assert.ok(
        ask.includes(rule),
        `ask muss ${rule} enthalten — roher Netz-/Fetch-Zugriff wird nicht auto-approved (#901)`,
      );
    }
  });

  test("Issue-Löschen steht auf ask: erlaubt, aber jede Löschung bestätigt die Maintainerin (#1201)", () => {
    const rule = "Bash(gh issue delete:*)";
    // ask gewinnt gegen das breite `Bash(gh issue:*)` in allow; deny würde das Löschen ganz verbieten.
    assert.ok(ask.includes(rule), `ask muss ${rule} enthalten — Löschen ist unumkehrbar und braucht eine Rückfrage (#1201)`);
    assert.ok(!deny.includes(rule), `${rule} gehört nicht mehr in deny — die Maintainerin will Issues löschen lassen (#1201)`);
    assert.ok(!allow.includes(rule), `${rule} darf nicht in allow stehen — sonst entfällt die Rückfrage (#1201)`);
  });

  test("allow deckt die bekannten Workflow-Kommandos ab (npm/git/gh), damit der Ablauf nicht ausgebremst wird", () => {
    for (const rule of ["Bash(npm:*)", "Bash(git:*)", "Bash(gh issue:*)", "Bash(gh pr:*)"]) {
      assert.ok(allow.includes(rule), `allow sollte ${rule} enthalten (kuratierte Workflow-Allowlist, #901)`);
    }
  });

  test("Langfuse-Lesetools stehen einzeln in allow, ohne Server-Wildcard und ohne Schreib-Tools (#1276)", () => {
    const lesen = [
      "mcp__langfuse__queryMetrics",
      "mcp__langfuse__getMetricsSchema",
      "mcp__langfuse__listObservations",
      "mcp__langfuse__getObservation",
    ];
    for (const rule of lesen) {
      assert.ok(allow.includes(rule), `allow muss ${rule} enthalten — Lesezugriff für die Langfuse-Auswertung (#1276)`);
    }
    const langfuse = allow.filter((r) => r.startsWith("mcp__langfuse"));
    assert.deepEqual(
      [...langfuse].sort(),
      [...lesen].sort(),
      "allow darf für Langfuse nur die vier Lesetools nennen: weder `mcp__langfuse` noch `mcp__langfuse__*` noch Schreib-Tools (Prompts, Scores, Kommentare, Datasets)",
    );
  });

  test("kein Kommando steht gleichzeitig in allow und deny (deny gewinnt, aber Doppeleinträge sind ein Redaktionsfehler)", () => {
    const overlap = allow.filter((r) => deny.includes(r));
    assert.deepEqual(overlap, [], `Diese Regeln stehen in allow UND deny: ${overlap.join(", ")}`);
  });
});
