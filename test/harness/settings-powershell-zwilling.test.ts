/* PowerShell-Zwillinge der Bash-deny- und -ask-Regeln (#1693).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Auf Windows führt der Agent Befehle auch über das PowerShell-Tool aus; eine `Bash(…)`-Regel greift dort nicht. Darum hat jede
 * `Bash(<befehl>:*)`-Regel in `deny` und in `ask` eine `PowerShell(<befehl> *)`-Schwester in derselben Liste, außer sie steht mit Begründung in `OHNE_ZWILLING`.
 * Ehrliche Grenze: Prefix-Match, kein Zaun gegen andere Schreibweisen (siehe settings-permissions.test.ts im Factory-Repo).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Art = "deny" | "ask";
const settings = JSON.parse(readFileSync(fileURLToPath(new URL("../../.claude/settings.json", import.meta.url)), "utf8")) as { permissions?: Partial<Record<Art, string[]>> };
const regeln = (art: Art): string[] => settings.permissions?.[art] ?? [];

/** Bewusst ohne PowerShell-Zwilling je Art (Befehl der Bash-Regel), jeweils mit Grund. */
const OHNE_ZWILLING: Record<Art, Record<string, string>> = {
  deny: {
    "rm -rf": "kein PowerShell-Befehl; Remove-Item -Recurse ist der dokumentierte Windows-Aufräumweg (Worktrees)",
    "rm -fr": "wie rm -rf (Remove-Item ist der Windows-Weg)",
    "rm -r -f": "wie rm -rf (Remove-Item ist der Windows-Weg)",
    "rm -f -r": "wie rm -rf (Remove-Item ist der Windows-Weg)",
    "rm --recursive": "wie rm -rf (Remove-Item ist der Windows-Weg)",
    sudo: "unter Windows nicht vorhanden",
  },
  ask: {},
};

/** `Bash(git push -f:*)` → `git push -f`; andere Regelformen (MCP, Read) → null. */
const bashBefehl = (regel: string): string | null => /^Bash\((.+):\*\)$/.exec(regel)?.[1] ?? null;
const zwilling = (befehl: string) => `PowerShell(${befehl} *)`;

describe.each<Art>(["deny", "ask"])("jede Bash-%s-Regel hat einen PowerShell-Zwilling oder eine begründete Ausnahme", (art) => {
  const liste = regeln(art);
  const befehle = liste.map(bashBefehl).filter((b): b is string => b !== null);
  const ausnahmen = OHNE_ZWILLING[art];

  test(`es gibt Bash-${art}-Regeln (der Wächter prüft nicht ins Leere)`, () => {
    assert.ok(befehle.length >= 10, `nur ${befehle.length} Bash-${art}-Regeln gefunden`);
  });

  test.each(befehle)("%s", (befehl) => {
    if (befehl in ausnahmen) {
      assert.ok(ausnahmen[befehl].length > 10, "Ausnahme ohne Begründung");
      assert.ok(!liste.includes(zwilling(befehl)), `${befehl} steht in OHNE_ZWILLING, hat aber einen Zwilling: Ausnahme streichen`);
      return;
    }
    assert.ok(liste.includes(zwilling(befehl)), `${art} fehlt: ${zwilling(befehl)} (Zwilling von Bash(${befehl}:*)) oder Ausnahme begründen`);
  });

  test("die Ausnahmeliste enthält keine Leichen (jeder Eintrag ist eine Bash-Regel dieser Art)", () => {
    for (const befehl of Object.keys(ausnahmen)) assert.ok(befehle.includes(befehl), `${befehl} ist keine Bash-${art}-Regel mehr: aus OHNE_ZWILLING streichen`);
  });

  test(`jede PowerShell-${art}-Regel hat ihr Bash-Gegenstück (keine Waisen)`, () => {
    for (const regel of liste) {
      const m = /^PowerShell\((.+) \*\)$/.exec(regel);
      if (m) assert.ok(befehle.includes(m[1]), `${regel} ohne Bash(${m[1]}:*)`);
    }
  });
});
