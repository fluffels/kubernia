/* Wächter gegen Textreste entfernter Pfade (#1067, ADR 0028) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Der Workflow `<Repo-Name>-ticket.js` und der Skill `<Repo-Name>-workflow` sind entfernt; dass die Dateien fehlen, prüft der
 * Absenz-Test in model-routing.test.ts. Beim Entfernen blieben aber Sätze in Doku, Kommentaren und Wächtern stehen, die
 * den Pfad als vorhanden beschrieben: drei Review-Pässe fanden nacheinander je einen neuen Rest, weil jeder nur nach
 * seinem eigenen Muster suchte. Dieser Test scannt alle getrackten Dateien auf die Namen und Umschreibungen des
 * entfernten Pfads. Ausnahmen sind begründet (AUSNAHMEN): ADRs sind historisch und werden nie umgeschrieben, der
 * Absenz-Test nennt die Namen absichtlich, dieser Wächter trägt die Muster selbst. Datierte Messungen und Entscheidungen
 * in lebenden Seiten stehen zwischen den Markern `<!-- schnappschuss:start -->` und `<!-- schnappschuss:ende -->` (je allein
 * auf der Zeile); der Scan überspringt den Block, ein Start ohne Ende, ein Ende ohne Start oder ein verschachtelter Start ist ein Fund.
 *
 * Bewusste Grenze: freie Umschreibungen ohne einen der Namen („orchestrierter Workflow, der dieselben Phasen fährt“)
 * fängt der Scan nicht; das Wort „Workflow“ allein wäre zu breit (GitHub-Actions-Workflows, generische Mechanik).
 *
 * Dazu (#1748): die Agenten-Dateien heißen nach der Rolle (`factory-planer.md` usw.), das Ticket-Skill-Verzeichnis `factory-ticket/`; die alten
 * Namen mit Projektwort und ein Platzhalter als Dateiname (`<agenten.…>.md`) sind Rückfälle.
 *
 * Ein neues Workflow-Skript unter `.claude/workflows/` heißt anders und löst diesen Wächter nicht aus; trägt ein Satz
 * künftig wieder den Namen `<Repo-Name>-ticket`, ist das ein Rückfall und rot.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { projektConfig, repoName } from "../support/fremd-config";
import { escapeRe as esc } from "../support/regex";

// Die Namen kommen aus der echten Projekt-Config, nicht aus Literalen: der Scan liest die echten Repo-Dateien.
const C = projektConfig();
const R = repoName(C);
const NAME_WORKFLOW = `Skill ${R}-workflow`;
const NAME_TICKET = `Workflow-Skript ${R}-ticket`;
const ROLLEN_AGENTEN = [C.agenten.planer, C.agenten.umsetzer, C.agenten.lens, C.agenten.gruppe];

/** Namen und Umschreibungen des entfernten Ticket-Workflows und seines Einstiegs-Skills. */
export const RESTE: { name: string; muster: RegExp; fix: string }[] = [
  { name: NAME_WORKFLOW, muster: new RegExp(`${esc(R)}-workflow`), fix: "den Ist-Zustand beschreiben: der Ticket-Skill ist der einzige Ablauf, oder den Satz löschen" },
  { name: NAME_TICKET, muster: new RegExp(`${esc(R)}-ticket`), fix: "den Ist-Zustand beschreiben: es gibt kein Workflow-Skript für den Ticket-Ablauf, oder den Satz löschen" },
  { name: "Workflow-Auftrag", muster: /Workflow-Auftrag/, fix: "vom Auftrag des Ticket-Skills sprechen, ein Workflow-Auftrag existiert nicht mehr" },
  { name: "Workflow-Variante", muster: /Workflow-Variante/, fix: "die Variante streichen, es gibt nur den Skill-Ablauf" },
  { name: "cleanup-Agent des Workflows", muster: /im Workflow der `?cleanup/, fix: "das Aufräumen dem Skill-Ablauf zuschreiben, nicht einem Workflow" },
  { name: "beruehrtHarness", muster: /beruehrtHarness/, fix: "den Bezeichner entfernen, das Feld gibt es nicht mehr" },
  { name: "urteilFehler (entfernter Export von nachweis-lib)", muster: /urteilFehler/, fix: "den Export aus nachweis-lib nicht mehr nennen, er ist entfernt" },
  { name: "Konstante NACH_MERGE_PRAEFIX", muster: /\bNACH_MERGE_PRAEFIX\b/, fix: "sprache.spezifikation.nachMerge aus der Projekt-Config nutzen, die Konstante ist entfernt" },
  { name: "Konstante FACTORY_LABEL", muster: /\bFACTORY_LABEL\b/, fix: "die Konstante aus board-lib nicht mehr nennen, sie ist entfernt" },
  { name: "Ausnahmeliste des Flag-Parser-Wächters", muster: /noch nicht migrierten Skripte stehen dort/, fix: "die Ausnahmeliste gibt es nicht mehr, den Ist-Zustand des Wächters beschreiben" },
  { name: "Docs-Gen-Schlüssel diagramme.ruleset", muster: /diagramme\.ruleset/, fix: "den Schlüssel aus der Docs-Gen-Konfiguration nicht mehr nennen, er ist entfernt" },
  { name: "alte Agenten-Dateinamen", muster: new RegExp(`(?:${ROLLEN_AGENTEN.map(esc).join("|")})\\.md`), fix: "den Rollen-Pfad .claude/agents/factory-<rolle>.md nennen" },
  { name: "altes Ticket-Skill-Verzeichnis", muster: new RegExp(`skills/${esc(C.agenten.ticketSkill)}/`), fix: "das Verzeichnis .agents/skills/factory-ticket/ nennen" },
  { name: "Ticket-Ablauf am alten Ort", muster: /\.claude\/skills\/factory\/ablauf\.md/, fix: "den Ticket-Ablauf unter .agents/skills/factory/ablauf.md nennen (Skill-Quelle, #1850)" },
  {
    name: "Platzhalter als Dateiname, die Datei heißt nach der Rolle",
    muster: /<agenten\.[A-Za-z]+>\.md|skills\/<agenten\.ticketSkill>\//,
    fix: "den Rollen-Pfad .claude/agents/factory-<rolle>.md ausschreiben statt eines Platzhalters",
  },
  {
    name: "Härtungs-Takt nach Merge-Zahl",
    muster: /\bHARNESS_TAKT_MERGES\b|\bharnessTaktAusCommits\b|\bmergesSeitAbschluss\b|(?:nach 5|fünf) Ticket-Merges jeder Art|Ticket-Merges seit dem Abschluss des letzten Sammeltickets hinter den Kopf/,
    fix: "den Härtungs-Takt nach Füllstand beschreiben: HARNESS_TAKT_KOMMENTARE Befund-Kommentare vertrauter Nicht-Bot-Autoren im Harness-Sammelticket (#1888)",
  },
  // Der Altnamen-Rückfall der Kern-Umgebungsvariablen ist entfernt (#1872): gelesen wird nur FACTORY_<NAME>.
  {
    name: "Altnamen-Rückfall",
    muster: /\b(?:altNameZuPraefix|ladeAltPraefix|standardAltPraefix)\b/,
    fix: "Kern-Variablen nur als FACTORY_<NAME> lesen; gesetzte Altnamen meldet harness-doctor --pruefen",
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
export const REGEL_AUSNAHMEN: { pfad: string; regel: string; grund: string }[] = [];

/** Marker eines Schnappschuss-Blocks: datierter Text, der die damaligen Namen bewusst trägt (Glossar „Schnappschuss-Block“). */
export const SCHNAPPSCHUSS_START = "<!-- schnappschuss:start -->";
export const SCHNAPPSCHUSS_ENDE = "<!-- schnappschuss:ende -->";
const ISO_DATUM = /\d{4}-\d{2}-\d{2}/;

/** Findet Reste in den übergebenen Dateien; leer = sauber. */
export function findeReste(dateien: { pfad: string; inhalt: string }[]): string[] {
  const treffer: string[] = [];
  for (const d of dateien) {
    if (AUSNAHMEN.some((a) => d.pfad.startsWith(a.praefix))) continue;
    const regeln = RESTE.filter((r) => !REGEL_AUSNAHMEN.some((a) => a.pfad === d.pfad && a.regel === r.name));
    let blockStart = 0; // Zeilennummer des offenen Schnappschuss-Blocks, 0 = außerhalb
    let blockDatiert = false; // trägt der offene Block zwischen Start und Ende ein ISO-Datum
    d.inhalt.split("\n").forEach((zeile, i) => {
      const marker = zeile.trim();
      if (marker === SCHNAPPSCHUSS_START) {
        if (blockStart) treffer.push(`${d.pfad}:${i + 1}: Schnappschuss-Block verschachtelt`);
        else {
          blockStart = i + 1;
          blockDatiert = false;
        }
        return;
      }
      if (marker === SCHNAPPSCHUSS_ENDE) {
        if (!blockStart) treffer.push(`${d.pfad}:${i + 1}: Schnappschuss-Ende ohne Start`);
        else if (!blockDatiert) treffer.push(`${d.pfad}:${blockStart}: Schnappschuss-Block ohne Datum`);
        blockStart = 0;
        return;
      }
      if (blockStart) {
        if (ISO_DATUM.test(zeile)) blockDatiert = true;
        return;
      }
      for (const r of regeln) if (r.muster.test(zeile)) treffer.push(`${d.pfad}:${i + 1}: ${r.name}`);
    });
    if (blockStart) treffer.push(`${d.pfad}:${blockStart}: Schnappschuss-Block ohne Ende`);
  }
  return treffer;
}

/** Meldung mit dem Fix-Hinweis je getroffener Regel (ein Hinweis pro Regel, auch bei mehreren Treffern). */
export function meldungMitFix(treffer: string[]): string {
  const hinweise = RESTE.filter((r) => treffer.some((t) => t.endsWith(`: ${r.name}`))).map((r) => `- ${r.name}: ${r.fix}`);
  const bloecke = treffer.some((t) => t.includes("Schnappschuss-Block") || t.includes("Schnappschuss-Ende"))
    ? ["- Schnappschuss-Block: Marker nur allein auf der Zeile, jeder Start braucht genau ein Ende (und jedes Ende einen Start) und zwischen beiden ein ISO-Datum (JJJJ-MM-TT)"]
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
    const treffer = findeReste([{ pfad: "docs/x.md", inhalt: "import { altNameZuPraefix } from lib" }]);
    const meldung = meldungMitFix(treffer);
    const regel = RESTE.find((r) => r.name === "Altnamen-Rückfall");
    assert.ok(regel && meldung.includes(regel.fix));
    assert.ok(!meldung.includes(RESTE[0].fix));
  });

  test("Ticket-Ablauf am alten Ort: der alte Pfad ist ein Fund, der neue Pfad und eine ADR nicht", () => {
    const alt = ".claude/skills/factory/ablauf.md";
    assert.deepEqual(findeReste([{ pfad: "docs/x.md", inhalt: `Lies ${alt}` }]), ["docs/x.md:1: Ticket-Ablauf am alten Ort"]);
    assert.deepEqual(findeReste([{ pfad: "docs/x.md", inhalt: "Lies .agents/skills/factory/ablauf.md und ../.agents/skills/factory/ablauf.md" }]), []);
    assert.deepEqual(findeReste([{ pfad: "docs/adr/0022-x.md", inhalt: alt }]), []);
  });

  // Je Alternative der Muster ein Literal: sonst bliebe ein gestrichener Name unbemerkt
  test.each(["altNameZuPraefix", "ladeAltPraefix", "standardAltPraefix"])("Negativfall: der Name %s wird gefunden", (name) => {
    assert.deepEqual(findeReste([{ pfad: "docs/b.md", inhalt: `export ${name}()` }]), ["docs/b.md:1: Altnamen-Rückfall"]);
  });

  describe("Schnappschuss-Block", () => {
    const rest = `der Skill ${R}-workflow`;
    const datum = "Stand 2026-10-01";
    const start = SCHNAPPSCHUSS_START;
    const ende = SCHNAPPSCHUSS_ENDE;
    const pruefe = (inhalt: string) => findeReste([{ pfad: "docs/s.md", inhalt }]);

    test("ein Rest im datierten Block ist kein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${rest}\n${ende}`), []);
    });
    test("ein Rest nach dem Block ist ein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${rest}\n${ende}\n${rest}`), [`docs/s.md:5: ${NAME_WORKFLOW}`]);
    });
    test("ein Rest vor dem Block ist ein Fund", () => {
      assert.deepEqual(pruefe(`${rest}\n${start}\n${datum}\n${ende}`), [`docs/s.md:1: ${NAME_WORKFLOW}`]);
    });
    test("ein Start ohne Ende ist ein Fund (fail-closed)", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${rest}`), ["docs/s.md:1: Schnappschuss-Block ohne Ende"]);
    });
    test("ein verschachtelter Start ist ein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${start}\n${ende}`), ["docs/s.md:3: Schnappschuss-Block verschachtelt"]);
    });
    test("Marker nur allein auf der Zeile (getrimmt) zählen", () => {
      assert.deepEqual(pruefe(`  ${start}  \n${datum}\n${rest}\n${ende}`), []);
      assert.equal(pruefe(`Text ${start}\n${rest}`).length, 1);
    });
    test("ein Block ohne ISO-Datum ist ein Fund (Schnappschuss ist datiert)", () => {
      assert.deepEqual(pruefe(`${start}\n${rest}\n${ende}`), ["docs/s.md:1: Schnappschuss-Block ohne Datum"]);
    });
    test("ein Ende-Marker ohne Start ist ein eigener Fund, kein Datum-Fund (nur ein offener Block braucht ein Datum)", () => {
      assert.deepEqual(pruefe(`${ende}\n${datum}`), ["docs/s.md:1: Schnappschuss-Ende ohne Start"]);
      assert.deepEqual(pruefe(`${start}\n${datum}\n${ende}\n${ende}`), ["docs/s.md:4: Schnappschuss-Ende ohne Start"]);
    });
    test("ein leerer Block ist ein Fund, ein Datum außerhalb des Blocks zählt nicht", () => {
      assert.deepEqual(pruefe(`${start}\n${ende}`), ["docs/s.md:1: Schnappschuss-Block ohne Datum"]);
      assert.deepEqual(pruefe(`2026-10-01\n${start}\n${rest}\n${ende}\n2026-10-02`), ["docs/s.md:2: Schnappschuss-Block ohne Datum"]);
    });
    test("ein unvollständiges Datum zählt nicht", () => {
      assert.deepEqual(pruefe(`${start}\n2026-10\n${rest}\n${ende}`), ["docs/s.md:1: Schnappschuss-Block ohne Datum"]);
    });
    test("mehrere Blöcke werden einzeln geprüft", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${ende}\n${start}\n${rest}\n${ende}`), ["docs/s.md:4: Schnappschuss-Block ohne Datum"]);
    });
    test("die Meldung erklärt Marker-Fehler", () => {
      assert.ok(meldungMitFix(pruefe(`${start}\n${rest}`)).includes("Schnappschuss-Block"));
      assert.ok(meldungMitFix(pruefe(`${start}\n${rest}\n${ende}`)).includes("Datum"));
    });
  });

  test.each(RESTE.map((r) => [r.name, r] as const))("Negativfall: ein eingeschleuster Rest wird gefunden (%s)", (_name, r) => {
    const beispiele: Record<string, string> = {
      [NAME_WORKFLOW]: `Der Skill \`${R}-workflow\` startet den Lauf.`,
      [NAME_TICKET]: `Workflow({ name: "${R}-ticket" })`,
      "Workflow-Auftrag": "der Workflow-Auftrag gleicht ab",
      "Workflow-Variante": "Workflow-Variante nur weich gesichert",
      "cleanup-Agent des Workflows": "im Workflow der `cleanup`-Agent trägt ein",
      beruehrtHarness: "Auftrag beruehrtHarness",
      "urteilFehler (entfernter Export von nachweis-lib)": "import { urteilFehler } from nachweis-lib",
      "Konstante NACH_MERGE_PRAEFIX": "import { NACH_MERGE_PRAEFIX } from spezifikation-lib",
      "Konstante FACTORY_LABEL": "import { FACTORY_LABEL } from board-lib",
      "Ausnahmeliste des Flag-Parser-Wächters": "die noch nicht migrierten Skripte stehen dort als Liste",
      "Docs-Gen-Schlüssel diagramme.ruleset": "config.diagramme.ruleset fehlt",
      "alte Agenten-Dateinamen": `Definition in .claude/agents/${C.agenten.lens}.md`,
      "altes Ticket-Skill-Verzeichnis": `Datei .claude/skills/${C.agenten.ticketSkill}/SKILL.md`,
      "Ticket-Ablauf am alten Ort": "Lies .claude/skills/factory/ablauf.md",
      "Platzhalter als Dateiname, die Datei heißt nach der Rolle": "Lies .claude/agents/<agenten.lens>.md",
      "Altnamen-Rückfall": "const alt = altNameZuPraefix(name, praefix);",
      "Härtungs-Takt nach Merge-Zahl": "export const HARNESS_TAKT_MERGES = 5;",
    };
    const text = beispiele[r.name];
    assert.ok(text, `Beispiel fehlt für ${r.name}`);
    const treffer = findeReste([{ pfad: "docs/beispiel.md", inhalt: `vorher\n${text}\nnachher` }]);
    assert.deepEqual(treffer, [`docs/beispiel.md:2: ${r.name}`]);
  });

  // Je Alternative der Muster mit „|“ ein eigenes Beispiel (#1748): sonst bliebe eine gestrichene Alternative unbemerkt
  test.each([
    ["alte Agenten-Dateinamen", `.claude/agents/${C.agenten.planer}.md`],
    ["alte Agenten-Dateinamen", `.claude/agents/${C.agenten.umsetzer}.md`],
    ["alte Agenten-Dateinamen", `.claude/agents/${C.agenten.gruppe}.md`],
    ["Härtungs-Takt nach Merge-Zahl", "harnessTaktAusCommits({ items })"],
    ["Härtungs-Takt nach Merge-Zahl", "entscheideHarnessTakt({ mergesSeitAbschluss: 5 })"],
    ["Härtungs-Takt nach Merge-Zahl", "holt es nach 5 Ticket-Merges jeder Art"],
    ["Härtungs-Takt nach Merge-Zahl", "nach fünf Ticket-Merges jeder Art"],
    ["Härtungs-Takt nach Merge-Zahl", "nach 10 Ticket-Merges seit dem Abschluss des letzten Sammeltickets hinter den Kopf"],
    ["Platzhalter als Dateiname, die Datei heißt nach der Rolle", ".claude/skills/<agenten.ticketSkill>/SKILL.md"],
  ])("Negativfall: jede Alternative wird gefunden (%s: %s)", (name, text) => {
    assert.deepEqual(findeReste([{ pfad: "docs/b.md", inhalt: text }]), [`docs/b.md:1: ${name}`]);
  });

  test("Negativfall: harmlose Nachbarn lösen nicht aus (Projektname mit großem T, Workflows der CI)", () => {
    const sauber = `Der ${R}-Ticket-Ablauf ist der Skill ${C.agenten.ticketSkill}; die CI läuft in .github/workflows/ci.yml.`;
    assert.deepEqual(findeReste([{ pfad: "docs/x.md", inhalt: sauber }]), []);
  });

  test("Negativfall: harmlose Nachbarn des Altnamen-Musters lösen nicht aus (altEnvName, Wortgrenze)", () => {
    assert.deepEqual(findeReste([{ pfad: "docs/x.md", inhalt: "altEnvName und altEnvPraefix, xaltNameZuPraefixy" }]), []);
  });

  test("Ausnahmen: ADRs und der Absenz-Test dürfen die Namen tragen, andere Pfade nicht", () => {
    const text = `${R}-ticket.js und ${R}-workflow`;
    assert.deepEqual(findeReste([{ pfad: "docs/adr/0028-ein-ticket-ablauf.md", inhalt: text }]), []);
    assert.deepEqual(findeReste([{ pfad: "test/harness/model-routing.test.ts", inhalt: text }]), []);
    assert.ok(findeReste([{ pfad: "docs/modul.md", inhalt: text }]).length > 0);
  });

  test("Verankerung am echten Projekt: die abgeleiteten Muster treffen die echten Altnamen aus den ADRs (außerhalb der Ausnahme)", () => {
    // Die Muster kommen aus der Config; ein falsch abgeleiteter Name (z. B. der Owner-Präfix) bliebe mit selbstgebauten Beispielen grün.
    const adr = (nr: string): string => {
      const pfad = getrackteTextdateien().find((d) => d.pfad.startsWith(`docs/adr/${nr}-`));
      assert.ok(pfad, `ADR ${nr} fehlt`);
      return pfad.inhalt;
    };
    const namen = (inhalt: string): string[] => findeReste([{ pfad: "docs/x.md", inhalt }]).map((t) => t.replace(/^docs\/x\.md:\d+: /, ""));
    const aus0022 = namen(adr("0022"));
    assert.ok(aus0022.includes(NAME_WORKFLOW), "ADR 0022 trägt den alten Skill-Namen");
    assert.ok(aus0022.includes(NAME_TICKET), "ADR 0022 trägt den alten Workflow-Skript-Namen");
    assert.ok(namen(adr("0012")).includes("alte Agenten-Dateinamen"), "ADR 0012 trägt alte Agenten-Dateinamen");
  });

  test("jede Ausnahme nennt einen Grund", () => {
    for (const a of REGEL_AUSNAHMEN) assert.ok(a.grund.length > 10, `Ausnahme ${a.pfad} ohne Grund`);
    for (const a of AUSNAHMEN) assert.ok(a.grund.length > 10, `Ausnahme ${a.praefix} ohne Grund`);
  });
});
