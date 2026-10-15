/* Wächter für den sichtbaren Selbstcheck im Workflow-Pfad (#1625 Z1): der Umsetzen- und der Nachbessern-Auftrag verlangen
 * vor dem Commit den Block `Selbstcheck:` (Prüffragen der Test-Adäquanz-Lens), der PR-Auftrag übernimmt ihn, die Lenses
 * bekommen ihn nicht (sie sollen unvoreingenommen prüfen).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Läuft über den Vollauf-Stub (workflow-lauf.ts) gegen das echte Skript.
 */
import { describe, expect, test } from "vitest";
import { workflowLauf } from "./workflow-lauf";

const prompt = (aufrufe: { label: string; prompt: string }[], label: string) => aufrufe.find((a) => a.label.startsWith(label))?.prompt ?? "";
const BLOCKER = { architektur: { lens: "architektur", verdikt: "blockierend", findings: [{ schwere: "blockierend", befund: "B", ort: "a.ts:1", begruendung: "b" }] } };
const SC1 = "Selbstcheck:\n1. ok\n2. gefixt\n3. n.a.";
const SC2 = "Selbstcheck:\n1. ok (Fix)\n2. ok\n3. ok";

describe("Selbstcheck im Workflow-Pfad (#1625)", () => {
  test("der Umsetzen-Auftrag verlangt den Block mit den Prüffragen und den drei Urteilen", async () => {
    const { aufrufe } = await workflowLauf({});
    const p = prompt(aufrufe, "umsetzen");
    expect(p).toContain("Selbstcheck:");
    expect(p).toContain("ok, gefixt oder n.a.");
    expect(p).toContain("Zweig auslöst");
    expect(p).toContain("Hat jede neue Bedingung");
  });

  test("der Nachbessern-Auftrag verlangt ihn erneut", async () => {
    const { aufrufe } = await workflowLauf({ runden: [BLOCKER, {}] });
    const p = prompt(aufrufe, "nachbessern");
    expect(p).toContain("Selbstcheck:");
    expect(p).toContain("Zweig auslöst");
  });

  test("der PR-Auftrag übernimmt den Block der Umsetzung, nach einer Nachbesserung den neueren", async () => {
    const eins = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"], extra: { selbstcheck: SC1 } } });
    expect(prompt(eins.aufrufe, "pr+merge")).toContain(SC1);
    const zwei = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"], extra: { selbstcheck: SC1 } }, runden: [BLOCKER, {}], nachbessern: { selbstcheck: SC2 } });
    const p = prompt(zwei.aufrufe, "pr+merge");
    expect(p).toContain(SC2);
    expect(p).not.toContain(SC1);
  });

  test("nach einer Nachbesserung ohne neuen Block bleibt der alte im PR-Auftrag", async () => {
    const { aufrufe } = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"], extra: { selbstcheck: SC1 } }, runden: [BLOCKER, {}] });
    expect(prompt(aufrufe, "pr+merge")).toContain(SC1);
  });

  test("kein Lens-Prompt enthält den Selbstcheck-Inhalt", async () => {
    const { aufrufe } = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"], extra: { selbstcheck: SC1 } }, runden: [BLOCKER, {}], nachbessern: { selbstcheck: SC2 } });
    const lenses = aufrufe.filter((a) => a.label.startsWith("lens:"));
    expect(lenses.length).toBeGreaterThan(0);
    for (const l of lenses) {
      expect(l.prompt).not.toContain(SC1);
      expect(l.prompt).not.toContain(SC2);
    }
  });

  test("ohne Feld selbstcheck: kein Fehler, kein Platzhalter undefined im PR-Auftrag", async () => {
    const { aufrufe, ergebnis } = await workflowLauf({});
    expect(ergebnis).toBe("fertig");
    const p = prompt(aufrufe, "pr+merge");
    expect(p).not.toContain("undefined");
    expect(p).not.toContain("Selbstcheck-Block");
  });
});
