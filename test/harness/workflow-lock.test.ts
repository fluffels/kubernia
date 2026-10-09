/* Wächter für den Ticket-Lock im Workflow-Pfad (#1572 Z9): der Workflow hält die Nonce aus `claim` im Zustand, prüft damit
 * vor dem Worktree (`pruefe … --nonce`) und gibt den Lock im Cleanup bzw. am Ende der Sonderfälle frei.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Läuft über den Vollauf-Stub (workflow-lauf.ts) gegen das echte Skript; der Stub liefert `lockNonce` aus dem claim-Agenten.
 */
import { describe, expect, test } from "vitest";
import { workflowLauf } from "./workflow-lauf";

const NONCE = "abc-123";
const prompt = (aufrufe: { label: string; prompt: string }[], label: string) => aufrufe.find((a) => a.label.startsWith(label))?.prompt ?? "";

describe("Workflow hält die Lock-Nonce und gibt den Lock frei (#1572)", () => {
  test("der claim-Prompt verlangt die Nonce als lockNonce zurück", async () => {
    const { aufrufe } = await workflowLauf({ lockNonce: NONCE });
    expect(prompt(aufrufe, "auswahl+claim")).toContain("lockNonce");
  });

  test("normaler Lauf: pruefe mit Nonce vor dem Worktree, freigeben mit Nonce im Cleanup", async () => {
    const { aufrufe, ergebnis } = await workflowLauf({ lockNonce: NONCE });
    expect(ergebnis).toBe("fertig");
    expect(prompt(aufrufe, "umsetzen")).toContain(`ticket-lock.mjs pruefe 42 --nonce ${NONCE}`);
    expect(prompt(aufrufe, "cleanup")).toContain(`ticket-lock.mjs freigeben 42 --nonce ${NONCE}`);
  });

  test.each(["epic", "dependabot"] as const)("Sonderfall %s: freigeben mit Nonce am Ende des Agenten-Auftrags", async (art) => {
    const { aufrufe } = await workflowLauf({ art, lockNonce: NONCE });
    const p = prompt(aufrufe, art === "epic" ? "epic-anlegen" : "dependabot");
    expect(p).toContain(`ticket-lock.mjs freigeben 42 --nonce ${NONCE}`);
  });

  test("ohne Nonce (claim lieferte keine): kein `--nonce undefined`, kein freigeben-Auftrag", async () => {
    const { aufrufe } = await workflowLauf({});
    const alle = aufrufe.map((a) => a.prompt).join("\n");
    expect(alle).not.toContain("undefined");
    expect(alle).not.toContain("ticket-lock.mjs freigeben");
    expect(prompt(aufrufe, "umsetzen")).toMatch(/ticket-lock\.mjs pruefe 42 \(Exit 4/);
  });
});
