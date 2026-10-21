/* Wächter gegen Textreste entfernter Pfade (#1067, ADR 0028) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Der Workflow `kubernia-ticket.js` und der Skill `kubernia-workflow` sind entfernt; dass die Dateien fehlen, prüft der
 * Absenz-Test in model-routing.test.ts. Beim Entfernen blieben aber Sätze in Doku, Kommentaren und Wächtern stehen, die
 * den Pfad als vorhanden beschrieben: drei Review-Pässe fanden nacheinander je einen neuen Rest, weil jeder nur nach
 * seinem eigenen Muster suchte. Dieser Test scannt alle getrackten Dateien auf die Namen und Umschreibungen des
 * entfernten Pfads. Ausnahmen sind begründet (AUSNAHMEN): ADRs sind historisch und werden nie umgeschrieben, der
 * Absenz-Test nennt die Namen absichtlich, dieser Wächter trägt die Muster selbst.
 *
 * Bewusste Grenze: freie Umschreibungen ohne einen der Namen („orchestrierter Workflow, der dieselben Phasen fährt“)
 * fängt der Scan nicht; das Wort „Workflow“ allein wäre zu breit (GitHub-Actions-Workflows, generische Mechanik).
 *
 * Dazu (#1748): die Agenten-Dateien heißen nach der Rolle (`factory-planer.md` usw.), das Ticket-Skill-Verzeichnis `factory-ticket/`; die alten
 * Namen mit Projektwort und ein Platzhalter als Dateiname (`<agenten.…>.md`) sind Rückfälle.
 *
 * Ein neues Workflow-Skript unter `.claude/workflows/` heißt anders und löst diesen Wächter nicht aus; trägt ein Satz
 * künftig wieder den Namen `kubernia-ticket`, ist das ein Rückfall und rot.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Namen und Umschreibungen des entfernten Ticket-Workflows und seines Einstiegs-Skills. */
export const RESTE: { name: string; muster: RegExp }[] = [
  { name: "Skill kubernia-workflow", muster: /kubernia-workflow/ },
  { name: "Workflow-Skript kubernia-ticket", muster: /kubernia-ticket/ },
  { name: "Workflow-Auftrag", muster: /Workflow-Auftrag/ },
  { name: "Workflow-Variante", muster: /Workflow-Variante/ },
  { name: "cleanup-Agent des Workflows", muster: /im Workflow der `?cleanup/ },
  { name: "beruehrtHarness", muster: /beruehrtHarness/ },
  { name: "urteilFehler (entfernter Export von nachweis-lib)", muster: /urteilFehler/ },
  { name: "Konstante FACTORY_LABEL", muster: /\bFACTORY_LABEL\b/ },
  { name: "Ausnahmeliste des Flag-Parser-Wächters", muster: /noch nicht migrierten Skripte stehen dort/ },
  { name: "Docs-Gen-Schlüssel diagramme.ruleset", muster: /diagramme\.ruleset/ },
  { name: "alte Agenten-Dateinamen", muster: /kubernia-(planner|umsetzer|lens|gruppe)\.md/ },
  { name: "altes Ticket-Skill-Verzeichnis", muster: /skills\/kubernia\// },
  { name: "Platzhalter als Dateiname, die Datei heißt nach der Rolle", muster: /<agenten\.[A-Za-z]+>\.md|skills\/<agenten\.ticketSkill>\// },
];

/** Pfad-Präfixe, die die Namen bewusst tragen. Je Eintrag der Grund. */
export const AUSNAHMEN: { praefix: string; grund: string }[] = [
  { praefix: "docs/adr/", grund: "ADRs sind historisch und werden nie umgeschrieben (AGENTS.md § Projekt-Brain pflegen)" },
  { praefix: "test/harness/model-routing.test.ts", grund: "Absenz-Test: prüft, dass die entfernten Dateien nicht mehr existieren (ADR 0028)" },
  { praefix: "test/harness/entfernte-pfade.test.ts", grund: "dieser Wächter trägt die Muster selbst" },
  { praefix: "docs/lens-gegenprobe-", grund: "datierte Schnappschüsse nennen die damaligen Dateinamen (Schnappschuss, nicht aktualisiert)" },
];

/** Findet Reste in den übergebenen Dateien; leer = sauber. */
export function findeReste(dateien: { pfad: string; inhalt: string }[]): string[] {
  const treffer: string[] = [];
  for (const d of dateien) {
    if (AUSNAHMEN.some((a) => d.pfad.startsWith(a.praefix))) continue;
    d.inhalt.split("\n").forEach((zeile, i) => {
      for (const r of RESTE) if (r.muster.test(zeile)) treffer.push(`${d.pfad}:${i + 1}: ${r.name}`);
    });
  }
  return treffer;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Alle getrackten Textdateien mit Inhalt (Binärdateien und nicht lesbare Pfade werden übersprungen). */
function getrackteTextdateien(): { pfad: string; inhalt: string }[] {
  const liste = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const aus: { pfad: string; inhalt: string }[] = [];
  for (const pfad of liste) {
    if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|mp3|ogg|wav|zip|gz|lock)$/i.test(pfad) || pfad === "package-lock.json") continue;
    try {
      const inhalt = readFileSync(`${ROOT}${pfad}`, "utf8");
      if (!inhalt.includes("\u0000")) aus.push({ pfad, inhalt });
    } catch {
      // gelöscht im Arbeitsbaum, aber noch im Index: nichts zu scannen
    }
  }
  return aus;
}

describe("Keine Textreste des entfernten Ticket-Workflows (#1067, ADR 0028)", () => {
  test("das Repo ist frei von Resten außerhalb der begründeten Ausnahmen", () => {
    const dateien = getrackteTextdateien();
    assert.ok(dateien.length > 200, "Dateiliste unerwartet klein: git ls-files fehlgeschlagen?");
    assert.deepEqual(findeReste(dateien), [], "Rest des entfernten Workflow-Pfads: beschreibe den Ist-Zustand (der Skill kubernia ist der einzige Ablauf) oder lösche den Satz");
  });

  test.each(RESTE.map((r) => [r.name, r] as const))("Negativfall: ein eingeschleuster Rest wird gefunden (%s)", (_name, r) => {
    const beispiele: Record<string, string> = {
      "Skill kubernia-workflow": "Der Skill `kubernia-workflow` startet den Lauf.",
      "Workflow-Skript kubernia-ticket": "Workflow({ name: \"kubernia-ticket\" })",
      "Workflow-Auftrag": "der Workflow-Auftrag gleicht ab",
      "Workflow-Variante": "Workflow-Variante nur weich gesichert",
      "cleanup-Agent des Workflows": "im Workflow der `cleanup`-Agent trägt ein",
      beruehrtHarness: "Auftrag beruehrtHarness",
      "urteilFehler (entfernter Export von nachweis-lib)": "import { urteilFehler } from nachweis-lib",
      "Konstante FACTORY_LABEL": "import { FACTORY_LABEL } from board-lib",
      "Ausnahmeliste des Flag-Parser-Wächters": "die noch nicht migrierten Skripte stehen dort als Liste",
      "Docs-Gen-Schlüssel diagramme.ruleset": "config.diagramme.ruleset fehlt",
      "alte Agenten-Dateinamen": "Definition in .claude/agents/kubernia-lens.md",
      "altes Ticket-Skill-Verzeichnis": "Datei .claude/skills/kubernia/SKILL.md",
      "Platzhalter als Dateiname, die Datei heißt nach der Rolle": "Lies .claude/agents/<agenten.lens>.md",
    };
    const text = beispiele[r.name];
    assert.ok(text, `Beispiel fehlt für ${r.name}`);
    const treffer = findeReste([{ pfad: "docs/beispiel.md", inhalt: `vorher\n${text}\nnachher` }]);
    assert.deepEqual(treffer, [`docs/beispiel.md:2: ${r.name}`]);
  });

  // Je Alternative der Muster mit „|“ ein eigenes Beispiel (#1748): sonst bliebe eine gestrichene Alternative unbemerkt
  test.each([
    ["alte Agenten-Dateinamen", ".claude/agents/kubernia-planner.md"],
    ["alte Agenten-Dateinamen", ".claude/agents/kubernia-umsetzer.md"],
    ["alte Agenten-Dateinamen", ".claude/agents/kubernia-gruppe.md"],
    ["Platzhalter als Dateiname, die Datei heißt nach der Rolle", ".claude/skills/<agenten.ticketSkill>/SKILL.md"],
  ])("Negativfall: jede Alternative wird gefunden (%s: %s)", (name, text) => {
    assert.deepEqual(findeReste([{ pfad: "docs/b.md", inhalt: text }]), [`docs/b.md:1: ${name}`]);
  });

  test("Negativfall: harmlose Nachbarn lösen nicht aus (kubernia-Ticket groß, Workflows der CI)", () => {
    const sauber = "Der kubernia-Ticket-Ablauf ist der Skill kubernia; die CI läuft in .github/workflows/ci.yml.";
    assert.deepEqual(findeReste([{ pfad: "docs/x.md", inhalt: sauber }]), []);
  });

  test("Ausnahmen: ADRs und der Absenz-Test dürfen die Namen tragen, andere Pfade nicht", () => {
    const text = "kubernia-ticket.js und kubernia-workflow";
    assert.deepEqual(findeReste([{ pfad: "docs/adr/0028-ein-ticket-ablauf.md", inhalt: text }]), []);
    assert.deepEqual(findeReste([{ pfad: "test/harness/model-routing.test.ts", inhalt: text }]), []);
    assert.ok(findeReste([{ pfad: "docs/modul.md", inhalt: text }]).length > 0);
  });

  test("jede Ausnahme nennt einen Grund", () => {
    for (const a of AUSNAHMEN) assert.ok(a.grund.length > 10, `Ausnahme ${a.praefix} ohne Grund`);
  });
});
