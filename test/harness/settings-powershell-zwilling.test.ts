/* PowerShell-Zwillinge der Bash-deny-Regeln (#1693).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Auf Windows führt der Agent Befehle auch über das PowerShell-Tool aus; eine `Bash(…)`-deny-Regel greift dort nicht. Darum hat jede
 * `Bash(<befehl>:*)`-deny-Regel eine `PowerShell(<befehl> *)`-Schwester, außer sie steht mit Begründung in `OHNE_ZWILLING`.
 * Ehrliche Grenze: Prefix-Match, kein Zaun gegen andere Schreibweisen (siehe settings-permissions.test.ts).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const settings = JSON.parse(readFileSync(fileURLToPath(new URL("../../.claude/settings.json", import.meta.url)), "utf8")) as { permissions?: { deny?: string[] } };
const deny = settings.permissions?.deny ?? [];

/** Bewusst ohne PowerShell-Zwilling (Befehl der Bash-Regel), jeweils mit Grund. */
const OHNE_ZWILLING: Record<string, string> = {
  "rm -rf": "kein PowerShell-Befehl; Remove-Item -Recurse ist der dokumentierte Windows-Aufräumweg (Worktrees)",
  "rm -fr": "wie rm -rf (Remove-Item ist der Windows-Weg)",
  "rm -r -f": "wie rm -rf (Remove-Item ist der Windows-Weg)",
  "rm -f -r": "wie rm -rf (Remove-Item ist der Windows-Weg)",
  "rm --recursive": "wie rm -rf (Remove-Item ist der Windows-Weg)",
  sudo: "unter Windows nicht vorhanden",
};

/** `Bash(git push -f:*)` → `git push -f`; andere Regelformen (MCP, Read) → null. */
const bashBefehl = (regel: string): string | null => /^Bash\((.+):\*\)$/.exec(regel)?.[1] ?? null;
const zwilling = (befehl: string) => `PowerShell(${befehl} *)`;

describe("jede Bash-deny-Regel hat einen PowerShell-Zwilling oder eine begründete Ausnahme", () => {
  const befehle = deny.map(bashBefehl).filter((b): b is string => b !== null);

  test("es gibt Bash-deny-Regeln (der Wächter prüft nicht ins Leere)", () => {
    assert.ok(befehle.length >= 10, `nur ${befehle.length} Bash-deny-Regeln gefunden`);
  });

  test.each(befehle)("%s", (befehl) => {
    if (befehl in OHNE_ZWILLING) {
      assert.ok(OHNE_ZWILLING[befehl].length > 10, "Ausnahme ohne Begründung");
      assert.ok(!deny.includes(zwilling(befehl)), `${befehl} steht in OHNE_ZWILLING, hat aber einen Zwilling: Ausnahme streichen`);
      return;
    }
    assert.ok(deny.includes(zwilling(befehl)), `deny fehlt: ${zwilling(befehl)} (Zwilling von Bash(${befehl}:*)) oder Ausnahme begründen`);
  });

  test("die Ausnahmeliste enthält keine Leichen (jeder Eintrag ist eine Bash-deny-Regel)", () => {
    for (const befehl of Object.keys(OHNE_ZWILLING)) assert.ok(befehle.includes(befehl), `${befehl} ist keine Bash-deny-Regel mehr: aus OHNE_ZWILLING streichen`);
  });

  test("jede PowerShell-deny-Regel hat ihr Bash-Gegenstück (keine Waisen)", () => {
    for (const regel of deny) {
      const m = /^PowerShell\((.+) \*\)$/.exec(regel);
      if (m) assert.ok(befehle.includes(m[1]), `${regel} ohne Bash(${m[1]}:*)`);
    }
  });
});
