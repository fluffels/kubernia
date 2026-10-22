/* Wächter gegen Textreste entfernter Pfade (#1067, ADR 0028) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Der Workflow `kubernia-ticket.js` und der Skill `kubernia-workflow` sind entfernt; dass die Dateien fehlen, prüft der
 * Absenz-Test in model-routing.test.ts. Beim Entfernen blieben aber Sätze in Doku, Kommentaren und Wächtern stehen, die
 * den Pfad als vorhanden beschrieben: drei Review-Pässe fanden nacheinander je einen neuen Rest, weil jeder nur nach
 * seinem eigenen Muster suchte. Dieser Test scannt alle getrackten Dateien auf die Namen und Umschreibungen des
 * entfernten Pfads. Ausnahmen sind begründet (AUSNAHMEN): ADRs sind historisch und werden nie umgeschrieben, der
 * Absenz-Test nennt die Namen absichtlich, dieser Wächter trägt die Muster selbst. Datierte Messungen und Entscheidungen
 * in lebenden Seiten stehen zwischen den Markern `<!-- schnappschuss:start -->` und `<!-- schnappschuss:ende -->` (je allein
 * auf der Zeile); der Scan überspringt den Block, ein Start ohne Ende oder ein verschachtelter Start ist ein Fund.
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
export const RESTE: { name: string; muster: RegExp; fix: string }[] = [
  { name: "Skill kubernia-workflow", muster: /kubernia-workflow/, fix: "den Ist-Zustand beschreiben: der Ticket-Skill ist der einzige Ablauf, oder den Satz löschen" },
  { name: "Workflow-Skript kubernia-ticket", muster: /kubernia-ticket/, fix: "den Ist-Zustand beschreiben: es gibt kein Workflow-Skript für den Ticket-Ablauf, oder den Satz löschen" },
  { name: "Workflow-Auftrag", muster: /Workflow-Auftrag/, fix: "vom Auftrag des Ticket-Skills sprechen, ein Workflow-Auftrag existiert nicht mehr" },
  { name: "Workflow-Variante", muster: /Workflow-Variante/, fix: "die Variante streichen, es gibt nur den Skill-Ablauf" },
  { name: "cleanup-Agent des Workflows", muster: /im Workflow der `?cleanup/, fix: "das Aufräumen dem Skill-Ablauf zuschreiben, nicht einem Workflow" },
  { name: "beruehrtHarness", muster: /beruehrtHarness/, fix: "den Bezeichner entfernen, das Feld gibt es nicht mehr" },
  { name: "urteilFehler (entfernter Export von nachweis-lib)", muster: /urteilFehler/, fix: "den Export aus nachweis-lib nicht mehr nennen, er ist entfernt" },
  { name: "Konstante NACH_MERGE_PRAEFIX", muster: /\bNACH_MERGE_PRAEFIX\b/, fix: "sprache.spezifikation.nachMerge aus der Projekt-Config nutzen, die Konstante ist entfernt" },
  { name: "Konstante FACTORY_LABEL", muster: /\bFACTORY_LABEL\b/, fix: "die Konstante aus board-lib nicht mehr nennen, sie ist entfernt" },
  { name: "Ausnahmeliste des Flag-Parser-Wächters", muster: /noch nicht migrierten Skripte stehen dort/, fix: "die Ausnahmeliste gibt es nicht mehr, den Ist-Zustand des Wächters beschreiben" },
  { name: "Docs-Gen-Schlüssel diagramme.ruleset", muster: /diagramme\.ruleset/, fix: "den Schlüssel aus der Docs-Gen-Konfiguration nicht mehr nennen, er ist entfernt" },
  { name: "alte Agenten-Dateinamen", muster: /kubernia-(planner|umsetzer|lens|gruppe)\.md/, fix: "den Rollen-Pfad .claude/agents/factory-<rolle>.md nennen" },
  { name: "altes Ticket-Skill-Verzeichnis", muster: /skills\/kubernia\//, fix: "das Verzeichnis .claude/skills/factory-ticket/ nennen" },
  {
    name: "Platzhalter als Dateiname, die Datei heißt nach der Rolle",
    muster: /<agenten\.[A-Za-z]+>\.md|skills\/<agenten\.ticketSkill>\//,
    fix: "den Rollen-Pfad .claude/agents/factory-<rolle>.md ausschreiben statt eines Platzhalters",
  },
  // Kern-Umgebungsvariablen heißen FACTORY_<NAME> (#1824). Geschlossene Liste der 15 früheren Namen: Projektnamen (Quiz-Golden,
  // Git-Guard, Dev-Panel) und die entfallenen Override-Namen fallen nicht darunter.
  {
    name: "Kern-Umgebungsvariable mit Projektpräfix",
    muster: /\bKQ_(?:DIFF_BASE|DIFFSIZE_MAX_FILES|DIFFSIZE_MAX_LINES|PR_NUMBER|PR_DRAFT|PR_BODY|GH_KOSTEN_LOG|MCP_LOG_DIR|MCP_AUSFALL_STAND|PACING_ZIELQUOTE|PACING_PROBE_SKRIPT|RATE_LIMITS_SNAPSHOT|STATUSLINE_DURCHREICHEN|USER_SETTINGS|TEST_FEHLT)\b/,
    fix: "den neuen Namen FACTORY_<NAME> nutzen (Inventar in docs/referenz/befehle.md)",
  },
];

/** Pfad-Präfixe, die die Namen bewusst tragen. Je Eintrag der Grund. */
export const AUSNAHMEN: { praefix: string; grund: string }[] = [
  { praefix: "docs/adr/", grund: "ADRs sind historisch und werden nie umgeschrieben (AGENTS.md § Projekt-Brain pflegen)" },
  { praefix: "test/harness/model-routing.test.ts", grund: "Absenz-Test: prüft, dass die entfernten Dateien nicht mehr existieren (ADR 0028)" },
  { praefix: "test/harness/entfernte-pfade.test.ts", grund: "dieser Wächter trägt die Muster selbst" },
  { praefix: "docs/lens-gegenprobe-", grund: "datierte Schnappschüsse nennen die damaligen Dateinamen (Schnappschuss, nicht aktualisiert)" },
];

/** Ausnahmen für genau eine Regel in genau einer Datei (exakter Pfad); alle anderen Regeln prüfen die Datei weiter. */
export const REGEL_AUSNAHMEN: { pfad: string; regel: string; grund: string }[] = [
  {
    pfad: "docs/referenz/befehle.md",
    regel: "Kern-Umgebungsvariable mit Projektpräfix",
    grund: "das Inventar der Umgebungsvariablen nennt die Altnamen bewusst in einer eigenen Spalte (#1824)",
  },
];

/** Marker eines Schnappschuss-Blocks: datierter Text, der die damaligen Namen bewusst trägt (Glossar „Schnappschuss-Block“). */
export const SCHNAPPSCHUSS_START = "<!-- schnappschuss:start -->";
export const SCHNAPPSCHUSS_ENDE = "<!-- schnappschuss:ende -->";

/** Findet Reste in den übergebenen Dateien; leer = sauber. */
export function findeReste(dateien: { pfad: string; inhalt: string }[]): string[] {
  const treffer: string[] = [];
  for (const d of dateien) {
    if (AUSNAHMEN.some((a) => d.pfad.startsWith(a.praefix))) continue;
    const regeln = RESTE.filter((r) => !REGEL_AUSNAHMEN.some((a) => a.pfad === d.pfad && a.regel === r.name));
    let blockStart = 0; // Zeilennummer des offenen Schnappschuss-Blocks, 0 = außerhalb
    d.inhalt.split("\n").forEach((zeile, i) => {
      const marker = zeile.trim();
      if (marker === SCHNAPPSCHUSS_START) {
        if (blockStart) treffer.push(`${d.pfad}:${i + 1}: Schnappschuss-Block verschachtelt`);
        else blockStart = i + 1;
        return;
      }
      if (marker === SCHNAPPSCHUSS_ENDE) {
        blockStart = 0;
        return;
      }
      if (blockStart) return;
      for (const r of regeln) if (r.muster.test(zeile)) treffer.push(`${d.pfad}:${i + 1}: ${r.name}`);
    });
    if (blockStart) treffer.push(`${d.pfad}:${blockStart}: Schnappschuss-Block ohne Ende`);
  }
  return treffer;
}

/** Meldung mit dem Fix-Hinweis je getroffener Regel (ein Hinweis pro Regel, auch bei mehreren Treffern). */
export function meldungMitFix(treffer: string[]): string {
  const hinweise = RESTE.filter((r) => treffer.some((t) => t.endsWith(`: ${r.name}`))).map((r) => `- ${r.name}: ${r.fix}`);
  const bloecke = treffer.some((t) => t.includes("Schnappschuss-Block"))
    ? ["- Schnappschuss-Block: Marker nur allein auf der Zeile, jeder Start braucht genau ein Ende"]
    : [];
  return `Rest des entfernten Pfads gefunden:\n${[...hinweise, ...bloecke].join("\n")}`;
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
    const treffer = findeReste(dateien);
    assert.deepEqual(treffer, [], `${meldungMitFix(treffer)}\nTreffer: ${treffer.join(", ")}`);
  });

  test("jede Regel nennt einen konkreten Fix-Hinweis", () => {
    for (const r of RESTE) assert.ok(r.fix.length > 10, `Regel ${r.name} ohne Fix-Hinweis`);
  });

  test("die Meldung nennt den Fix der getroffenen Regel und nur den", () => {
    const treffer = findeReste([{ pfad: "docs/x.md", inhalt: "KQ_DIFF_BASE" }]);
    const meldung = meldungMitFix(treffer);
    const env = RESTE.find((r) => r.name === "Kern-Umgebungsvariable mit Projektpräfix");
    assert.ok(env && meldung.includes(env.fix));
    assert.ok(!meldung.includes(RESTE[0].fix));
  });

  // Je Altname ein Literal: sonst bliebe ein aus dem Muster gestrichener Name unbemerkt (#1824)
  test.each([
    "KQ_DIFF_BASE", "KQ_DIFFSIZE_MAX_FILES", "KQ_DIFFSIZE_MAX_LINES", "KQ_PR_NUMBER", "KQ_PR_DRAFT", "KQ_PR_BODY", "KQ_GH_KOSTEN_LOG", "KQ_MCP_LOG_DIR",
    "KQ_MCP_AUSFALL_STAND", "KQ_PACING_ZIELQUOTE", "KQ_PACING_PROBE_SKRIPT", "KQ_RATE_LIMITS_SNAPSHOT", "KQ_STATUSLINE_DURCHREICHEN", "KQ_USER_SETTINGS", "KQ_TEST_FEHLT",
  ])("Negativfall: der Altname %s wird gefunden", (altname) => {
    assert.deepEqual(findeReste([{ pfad: "docs/b.md", inhalt: `export ${altname}=1` }]), ["docs/b.md:1: Kern-Umgebungsvariable mit Projektpräfix"]);
  });

  describe("Schnappschuss-Block", () => {
    const rest = "der Skill kubernia-workflow";
    const start = SCHNAPPSCHUSS_START;
    const ende = SCHNAPPSCHUSS_ENDE;
    const pruefe = (inhalt: string) => findeReste([{ pfad: "docs/s.md", inhalt }]);

    test("ein Rest im Block ist kein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${rest}\n${ende}`), []);
    });
    test("ein Rest nach dem Block ist ein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${rest}\n${ende}\n${rest}`), ["docs/s.md:4: Skill kubernia-workflow"]);
    });
    test("ein Rest vor dem Block ist ein Fund", () => {
      assert.deepEqual(pruefe(`${rest}\n${start}\n${ende}`), ["docs/s.md:1: Skill kubernia-workflow"]);
    });
    test("ein Start ohne Ende ist ein Fund (fail-closed)", () => {
      assert.deepEqual(pruefe(`${start}\n${rest}`), ["docs/s.md:1: Schnappschuss-Block ohne Ende"]);
    });
    test("ein verschachtelter Start ist ein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${start}\n${ende}`), ["docs/s.md:2: Schnappschuss-Block verschachtelt"]);
    });
    test("Marker nur allein auf der Zeile (getrimmt) zählen", () => {
      assert.deepEqual(pruefe(`  ${start}  \n${rest}\n${ende}`), []);
      assert.equal(pruefe(`Text ${start}\n${rest}`).length, 1);
    });
    test("die Meldung erklärt Marker-Fehler", () => {
      assert.ok(meldungMitFix(pruefe(`${start}\n${rest}`)).includes("Schnappschuss-Block"));
    });
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
      "Konstante NACH_MERGE_PRAEFIX": "import { NACH_MERGE_PRAEFIX } from spezifikation-lib",
      "Konstante FACTORY_LABEL": "import { FACTORY_LABEL } from board-lib",
      "Ausnahmeliste des Flag-Parser-Wächters": "die noch nicht migrierten Skripte stehen dort als Liste",
      "Docs-Gen-Schlüssel diagramme.ruleset": "config.diagramme.ruleset fehlt",
      "alte Agenten-Dateinamen": "Definition in .claude/agents/kubernia-lens.md",
      "altes Ticket-Skill-Verzeichnis": "Datei .claude/skills/kubernia/SKILL.md",
      "Platzhalter als Dateiname, die Datei heißt nach der Rolle": "Lies .claude/agents/<agenten.lens>.md",
      "Kern-Umgebungsvariable mit Projektpräfix": "echo KQ_DIFF_BASE=$base >> $GITHUB_ENV",
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
