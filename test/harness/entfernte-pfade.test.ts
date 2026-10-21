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
  // Kern-Umgebungsvariablen heißen FACTORY_<NAME> (#1824). Geschlossene Liste der 15 früheren Namen: Projektnamen (Quiz-Golden,
  // Git-Guard, Dev-Panel) und die entfallenen Override-Namen fallen nicht darunter.
  {
    name: "Kern-Umgebungsvariable mit Projektpräfix",
    muster: /\bKQ_(?:DIFF_BASE|DIFFSIZE_MAX_FILES|DIFFSIZE_MAX_LINES|PR_NUMBER|PR_DRAFT|PR_BODY|GH_KOSTEN_LOG|MCP_LOG_DIR|MCP_AUSFALL_STAND|PACING_ZIELQUOTE|PACING_PROBE_SKRIPT|RATE_LIMITS_SNAPSHOT|STATUSLINE_DURCHREICHEN|USER_SETTINGS|TEST_FEHLT)\b/,
  },
];

/** Pfad-Präfixe, die die Namen bewusst tragen. Je Eintrag der Grund. */
export const AUSNAHMEN: { praefix: string; grund: string }[] = [
  { praefix: "docs/adr/", grund: "ADRs sind historisch und werden nie umgeschrieben (AGENTS.md § Projekt-Brain pflegen)" },
  { praefix: "test/harness/model-routing.test.ts", grund: "Absenz-Test: prüft, dass die entfernten Dateien nicht mehr existieren (ADR 0028)" },
  { praefix: "test/harness/entfernte-pfade.test.ts", grund: "dieser Wächter trägt die Muster selbst" },
];

/** Ausnahmen für genau eine Regel in genau einer Datei (exakter Pfad); alle anderen Regeln prüfen die Datei weiter. */
export const REGEL_AUSNAHMEN: { pfad: string; regel: string; grund: string }[] = [
  {
    pfad: "docs/referenz/befehle.md",
    regel: "Kern-Umgebungsvariable mit Projektpräfix",
    grund: "das Inventar der Umgebungsvariablen nennt die Altnamen bewusst in einer eigenen Spalte (#1824)",
  },
];

/** Findet Reste in den übergebenen Dateien; leer = sauber. */
export function findeReste(dateien: { pfad: string; inhalt: string }[]): string[] {
  const treffer: string[] = [];
  for (const d of dateien) {
    if (AUSNAHMEN.some((a) => d.pfad.startsWith(a.praefix))) continue;
    const regeln = RESTE.filter((r) => !REGEL_AUSNAHMEN.some((a) => a.pfad === d.pfad && a.regel === r.name));
    d.inhalt.split("\n").forEach((zeile, i) => {
      for (const r of regeln) if (r.muster.test(zeile)) treffer.push(`${d.pfad}:${i + 1}: ${r.name}`);
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
      "Kern-Umgebungsvariable mit Projektpräfix": "echo KQ_DIFF_BASE=$base >> $GITHUB_ENV",
    };
    const text = beispiele[r.name];
    assert.ok(text, `Beispiel fehlt für ${r.name}`);
    const treffer = findeReste([{ pfad: "docs/beispiel.md", inhalt: `vorher\n${text}\nnachher` }]);
    assert.deepEqual(treffer, [`docs/beispiel.md:2: ${r.name}`]);
  });

  test("Negativfall: harmlose Nachbarn lösen nicht aus (kubernia-Ticket groß, Workflows der CI)", () => {
    const sauber = "Der kubernia-Ticket-Ablauf ist der Skill kubernia; die CI läuft in .github/workflows/ci.yml.";
    assert.deepEqual(findeReste([{ pfad: "docs/x.md", inhalt: sauber }]), []);
  });

  test("Negativfall: Projektnamen, entfallene Override-Namen und die neuen Namen lösen die Umgebungsvariablen-Regel nicht aus", () => {
    const sauber = "KQ_UPDATE_QUIZ_GOLDEN KQ_GIT_SAFECRLF VITE_KQ_DEVPANEL_PW KQ_DIFFSIZE_OVERRIDE KQ_DIFF_BASE_X VITE_KQ_DIFF_BASE __KQ_DIFF_BASE__ FACTORY_DIFF_BASE";
    assert.deepEqual(findeReste([{ pfad: "docs/x.md", inhalt: sauber }]), []);
  });

  test("Ausnahmen: ADRs und der Absenz-Test dürfen die Namen tragen, andere Pfade nicht", () => {
    const text = "kubernia-ticket.js und kubernia-workflow";
    assert.deepEqual(findeReste([{ pfad: "docs/adr/0028-ein-ticket-ablauf.md", inhalt: text }]), []);
    assert.deepEqual(findeReste([{ pfad: "test/harness/model-routing.test.ts", inhalt: text }]), []);
    assert.ok(findeReste([{ pfad: "docs/modul.md", inhalt: text }]).length > 0);
  });

  test("Regel-Ausnahme: das Inventar darf Altnamen tragen, jeder andere Rest dort und jede andere Datei bleibt rot", () => {
    const inv = "docs/referenz/befehle.md";
    assert.deepEqual(findeReste([{ pfad: inv, inhalt: "KQ_DIFF_BASE" }]), []);
    assert.equal(findeReste([{ pfad: inv, inhalt: "der Skill kubernia-workflow" }]).length, 1);
    assert.ok(findeReste([{ pfad: inv + ".bak", inhalt: "KQ_DIFF_BASE" }]).length > 0);
    assert.ok(findeReste([{ pfad: "docs/x.md", inhalt: "KQ_DIFF_BASE" }]).length > 0);
  });

  test("jede Ausnahme nennt einen Grund", () => {
    for (const a of REGEL_AUSNAHMEN) assert.ok(a.grund.length > 10, `Ausnahme ${a.pfad} ohne Grund`);
    for (const a of AUSNAHMEN) assert.ok(a.grund.length > 10, `Ausnahme ${a.praefix} ohne Grund`);
  });
});
