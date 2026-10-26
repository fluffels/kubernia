/* Wächter gegen Textreste entfernter Pfade (#1067, ADR 0028) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Der Ticket-Workflow und sein Einstiegs-Skill sind entfernt; dass die Dateien fehlen, prüft der
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
 * Die Muster, die an der Projekthistorie hängen (der alte Skill- und Workflow-Name aus dem Repo-Namen, das alte Ticket-Skill-Verzeichnis), prüft
 * `entfernte-pfade-projekt.test.ts` (Projekt-Test, zieht nicht in das Factory-Repo); Scan und Schnappschuss-Blöcke liegen in `test/support/entfernte-pfade.ts`.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { type Datei, type Rest, AUSNAHMEN, findeReste, getrackteTextdateien, meldungMitFix, REGEL_AUSNAHMEN, SCHNAPPSCHUSS_ENDE, SCHNAPPSCHUSS_START } from "../support/entfernte-pfade";
import { projektConfig } from "../support/fremd-config";
import { escapeRe as esc } from "../support/regex";

// Die Namen kommen aus der echten Projekt-Config, nicht aus Literalen: der Scan liest die echten Repo-Dateien.
const C = projektConfig();
const ROLLEN_AGENTEN = [C.agenten.planer, C.agenten.umsetzer, C.agenten.lens, C.agenten.gruppe];

/** Namen und Umschreibungen des entfernten Ticket-Workflows und seines Einstiegs-Skills. */
export const RESTE: Rest[] = [
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
  {
    name: "Baseline der Kern-Test-Literale",
    muster: /kern-test-literale-baseline/,
    fix: "für Kern-Tests gilt die Null-Regel ohne Baseline: Projektwerte aus FREMD bzw. projektConfig() nehmen, Projektinhalt in einen projekt-test",
  },
  {
    name: "Spielquote-Bibliothek (heißt produktquote-lib)",
    muster: /spielquote-lib|\bSPIEL_QUOTE\b|\bzaehleSpielMerges\b/,
    fix: "den Kern-Begriff Produktquote nutzen: scripts/produktquote-lib.mjs, PRODUKT_QUOTE, zaehleProduktMerges (#1942)",
  },
];

const reste = (dateien: Datei[]): string[] => findeReste(dateien, RESTE);
const meldungKern = (treffer: string[]): string => meldungMitFix(treffer, RESTE);

/** Entfernte Dateien, die nie wieder angelegt werden dürfen (exakter Pfad, je Eintrag der Grund). */
export const ENTFERNTE_DATEIEN: { pfad: string; grund: string }[] = [
  { pfad: "test/harness/kern-test-literale-baseline.json", grund: "Null-Regel der Kern-Tests (#1903)" },
];

/** Meldungen für wieder angelegte entfernte Dateien; leer = sauber. */
export function entfernteDateien(pfade: string[]): string[] {
  return ENTFERNTE_DATEIEN.filter((e) => pfade.includes(e.pfad)).map((e) => `${e.pfad}: entfernte Datei wieder angelegt (${e.grund})`);
}

describe("Keine Textreste des entfernten Ticket-Workflows (#1067, ADR 0028)", () => {
  test("das Repo ist frei von Resten außerhalb der begründeten Ausnahmen", () => {
    const dateien = getrackteTextdateien();
    assert.ok(dateien.length > 200, "Dateiliste unerwartet klein: git ls-files fehlgeschlagen?");
    const treffer = reste(dateien);
    assert.deepEqual(treffer, [], `${meldungKern(treffer)}\nTreffer: ${treffer.join(", ")}`);
  });

  describe("entfernte Dateien (#1903)", () => {
    test("im echten Repo ist keine entfernte Datei wieder angelegt", () => {
      assert.deepEqual(entfernteDateien(getrackteTextdateien().map((d) => d.pfad)), []);
    });
    test("Negativfall: eine wieder angelegte Baseline-Datei ist genau eine Meldung mit Pfad und Grund", () => {
      const meldungen = entfernteDateien(["README.md", ENTFERNTE_DATEIEN[0].pfad]);
      assert.equal(meldungen.length, 1);
      assert.ok(meldungen[0].startsWith(ENTFERNTE_DATEIEN[0].pfad) && meldungen[0].includes("Null-Regel"));
    });
    test("ein Nachbarpfad mit ähnlichem Namen löst nicht aus", () => {
      assert.deepEqual(entfernteDateien(["test/harness/kern-test-literale.json"]), []);
    });
  });

  test("jede Regel nennt einen konkreten Fix-Hinweis", () => {
    for (const r of RESTE) assert.ok(r.fix.length > 10, `Regel ${r.name} ohne Fix-Hinweis`);
  });

  test("die Meldung nennt den Fix der getroffenen Regel und nur den", () => {
    const treffer = reste([{ pfad: "docs/x.md", inhalt: "import { altNameZuPraefix } from lib" }]);
    const meldung = meldungKern(treffer);
    const regel = RESTE.find((r) => r.name === "Altnamen-Rückfall");
    assert.ok(regel && meldung.includes(regel.fix));
    assert.ok(!meldung.includes(RESTE[0].fix));
  });

  test("Ticket-Ablauf am alten Ort: der alte Pfad ist ein Fund, der neue Pfad und eine ADR nicht", () => {
    const alt = ".claude/skills/factory/ablauf.md";
    assert.deepEqual(reste([{ pfad: "docs/x.md", inhalt: `Lies ${alt}` }]), ["docs/x.md:1: Ticket-Ablauf am alten Ort"]);
    assert.deepEqual(reste([{ pfad: "docs/x.md", inhalt: "Lies .agents/skills/factory/ablauf.md und ../.agents/skills/factory/ablauf.md" }]), []);
    assert.deepEqual(reste([{ pfad: "docs/adr/0022-x.md", inhalt: alt }]), []);
  });

  test.each(["scripts/spielquote-lib.mjs", "SPIEL_QUOTE", "zaehleSpielMerges"])("Negativfall: der entfernte Name %s wird gefunden, der neue nicht", (name) => {
    assert.deepEqual(reste([{ pfad: "docs/c.md", inhalt: name }]), ["docs/c.md:1: Spielquote-Bibliothek (heißt produktquote-lib)"]);
    assert.deepEqual(reste([{ pfad: "docs/c.md", inhalt: "scripts/produktquote-lib.mjs PRODUKT_QUOTE zaehleProduktMerges" }]), []);
  });

  // Je Alternative der Muster ein Literal: sonst bliebe ein gestrichener Name unbemerkt
  test.each(["altNameZuPraefix", "ladeAltPraefix", "standardAltPraefix"])("Negativfall: der Name %s wird gefunden", (name) => {
    assert.deepEqual(reste([{ pfad: "docs/b.md", inhalt: `export ${name}()` }]), ["docs/b.md:1: Altnamen-Rückfall"]);
  });

  describe("Schnappschuss-Block", () => {
    const rest = "der Workflow-Auftrag gleicht ab";
    const datum = "Stand 2026-10-01";
    const start = SCHNAPPSCHUSS_START;
    const ende = SCHNAPPSCHUSS_ENDE;
    const pruefe = (inhalt: string) => reste([{ pfad: "docs/s.md", inhalt }]);

    test("ein Rest im datierten Block ist kein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${rest}\n${ende}`), []);
    });
    test("ein Rest nach dem Block ist ein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${rest}\n${ende}\n${rest}`), [`docs/s.md:5: Workflow-Auftrag`]);
    });
    test("ein Rest vor dem Block ist ein Fund", () => {
      assert.deepEqual(pruefe(`${rest}\n${start}\n${datum}\n${ende}`), [`docs/s.md:1: Workflow-Auftrag`]);
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
      assert.ok(meldungKern(pruefe(`${start}\n${rest}`)).includes("Schnappschuss-Block"));
      assert.ok(meldungKern(pruefe(`${start}\n${rest}\n${ende}`)).includes("Datum"));
    });
  });

  test.each(RESTE.map((r) => [r.name, r] as const))("Negativfall: ein eingeschleuster Rest wird gefunden (%s)", (_name, r) => {
    const beispiele: Record<string, string> = {
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
      "Ticket-Ablauf am alten Ort": "Lies .claude/skills/factory/ablauf.md",
      "Platzhalter als Dateiname, die Datei heißt nach der Rolle": "Lies .claude/agents/<agenten.lens>.md",
      "Altnamen-Rückfall": "const alt = altNameZuPraefix(name, praefix);",
      "Härtungs-Takt nach Merge-Zahl": "export const HARNESS_TAKT_MERGES = 5;",
      "Spielquote-Bibliothek (heißt produktquote-lib)": "import { SPIEL_QUOTE } from board-takt",
      "Baseline der Kern-Test-Literale": "gelesen aus test/harness/kern-test-literale-baseline.json",
    };
    const text = beispiele[r.name];
    assert.ok(text, `Beispiel fehlt für ${r.name}`);
    const treffer = reste([{ pfad: "docs/beispiel.md", inhalt: `vorher\n${text}\nnachher` }]);
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
    assert.deepEqual(reste([{ pfad: "docs/b.md", inhalt: text }]), [`docs/b.md:1: ${name}`]);
  });

  test("Negativfall: harmlose Nachbarn des Altnamen-Musters lösen nicht aus (altEnvName, Wortgrenze)", () => {
    assert.deepEqual(reste([{ pfad: "docs/x.md", inhalt: "altEnvName und altEnvPraefix, xaltNameZuPraefixy" }]), []);
  });

  test("Ausnahmen: ADRs und der Absenz-Test dürfen die Namen tragen, andere Pfade nicht", () => {
    const text = "der Workflow-Auftrag gleicht ab";
    assert.deepEqual(reste([{ pfad: "docs/adr/0028-ein-ticket-ablauf.md", inhalt: text }]), []);
    assert.deepEqual(reste([{ pfad: "test/harness/model-routing.test.ts", inhalt: text }]), []);
    assert.ok(reste([{ pfad: "docs/modul.md", inhalt: text }]).length > 0);
  });

  test("jede Ausnahme nennt einen Grund", () => {
    for (const a of REGEL_AUSNAHMEN) assert.ok(a.grund.length > 10, `Ausnahme ${a.pfad} ohne Grund`);
    for (const a of AUSNAHMEN) assert.ok(a.grund.length > 10, `Ausnahme ${a.praefix} ohne Grund`);
  });
});
