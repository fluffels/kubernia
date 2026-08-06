/* Review-Kontext-Wächter (#1034) – die Lens-Pässe beschaffen ihren Kontext EINMAL, nicht fünfmal.
 *
 * Gemessen an Ticket #1021 / PR #1029: ein einzelnes Ticket verbrauchte 1,03 Mio Subagent-Tokens,
 * 85 % davon im Review. Die Befunde rechtfertigten den Review inhaltlich – die Kontext-BESCHAFFUNG
 * war aber fünffach redundant: jeder Lens-Agent fuhr `git diff` selbst, las die geänderten Dateien
 * vollständig und öffnete AGENTS.md/CLAUDE.md erneut, obwohl der `@AGENTS.md`-Import beide bereits
 * vollständig in seinen Kontext legt. Das produziert keinen einzigen zusätzlichen Befund.
 *
 * Dieser Wächter nagelt die drei Maßnahmen fest, die sonst leise zurückdriften – jede von ihnen
 * würde beim Zurückdrehen NICHTS anderes rot machen (der Workflow lief vorher ja auch):
 *
 *   1. **Materialisierung.** Der Diff wird einmal als Patch-Datei geschrieben und den Lenses als
 *      PFAD übergeben. Verschwindet der Platzhalter und steht wieder „fahre git diff" im
 *      Lens-Prompt, ist die Ersparnis weg.
 *   2. **Kontext-Diät.** Die Anweisung „AGENTS.md/CLAUDE.md sind schon in deinem Kontext – nicht
 *      erneut lesen, punktuell greppen" ist der größte Einzelposten (~30k Tokens pro Lens).
 *   3. **Frische-Guard.** Der Patch trägt eine Rundennummer und den erwarteten HEAD. Ohne das
 *      könnte Runde 2 den Patch aus Runde 1 lesen und Fixes attestieren, die sie nie gesehen hat –
 *      ein Review, der von außen grün aussieht, aber nichts geprüft hat. Das ist der gefährlichste
 *      Fehlerfall dieses Tickets, nicht bloß eine Ersparnis.
 *
 * Dazu die harte Schutzklausel des Tickets: die **Sabotage-/Red-Green-Prüfung** der Test-Lens darf
 * die Kürzung NICHT treffen. Sie fand in der Messsession den einzigen echten Blocker. Ein Wächter,
 * der nur Ersparnis prüft, würde ihr Wegkürzen belohnen – darum steht sie hier als Zusicherung.
 *
 * Fitness-Function-Kategorie neben claude-bridge/harness-approval/docmap (#992/#1012/#482), nicht
 * mit Verhaltens-Tests vermischen. Bewusst **ohne** eigenes `scripts/check-*.mjs`: `scripts/check-`
 * ist selbst gate-config-geschützt (Goodhart-Guard) – für doku-/prompt-strukturelle Wächter gibt es
 * die etablierte test-only-Familie (Präzedenz: `test/claude-bridge.test.ts`).
 *
 * ⚠️ Das Workflow-Skript wird bewusst als TEXT gelesen, nicht importiert: es ruft auf Top-Level
 * `await ticketAbarbeiten()` gegen Globals, die nur die Workflow-Laufzeit bereitstellt.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const workflow = read(".claude/workflows/kubernia-ticket.js");
const lensSkill = read(".claude/skills/review-lenses/SKILL.md");
const planner = read(".claude/agents/kubernia-planner.md");

/** Der Rumpf einer Template-String-Konstante (`const NAME = \`…\``) aus dem Workflow. */
function konstante(text: string, name: string): string {
  const m = text.match(new RegExp(`const ${name} =\\s*\`([\\s\\S]*?)\``));
  assert.ok(m, `Template-Konstante ${name} im Workflow nicht gefunden`);
  return m[1];
}

/**
 * Schneidet den Lens-Prompt aus dem Workflow heraus – von `const reviewPass` bis zum
 * schließenden Options-Objekt des Lens-`agent()`-Aufrufs. Nur DIESER Ausschnitt darf keine
 * Diff-Erhebungs-Anweisung mehr enthalten; die Umsetzungs-/Nachbessern-Phasen dürfen `git diff`
 * selbstverständlich weiter fahren (sie SCHREIBEN den Patch ja).
 *
 * Interpolierte Prompt-Bausteine werden dabei **aufgelöst**: der Diät-Block steht als
 * `${KONTEXT_DIAET}` im Prompt, sein Text aber weiter oben in der Datei. Ohne die Auflösung
 * würde der Wächter die Textform prüfen statt der Wirkung – und wäre grün, sobald der Baustein
 * ausgehöhlt (aber weiter interpoliert) wird.
 */
function lensPrompt(text: string): string {
  const start = text.indexOf("const reviewPass");
  assert.notEqual(start, -1, "reviewPass-Definition im Workflow nicht gefunden");
  const end = text.indexOf("phase: 'Review'", start);
  assert.notEqual(end, -1, "Ende des Lens-agent()-Aufrufs (phase: 'Review') nicht gefunden");
  const roh = text.slice(start, end);
  assert.match(roh, /\$\{KONTEXT_DIAET\}/, "Der Lens-Prompt interpoliert den Kontext-Diät-Block nicht mehr (#1034).");
  return roh.replace("${KONTEXT_DIAET}", konstante(text, "KONTEXT_DIAET"));
}

const prompt = lensPrompt(workflow);

describe("Der Diff wird einmal materialisiert statt pro Lens erhoben (#1034)", () => {
  test("der Lens-Prompt übergibt einen Patch-PFAD", () => {
    assert.match(
      prompt,
      /diff\.pfad/,
      "Der Lens-Prompt setzt den Pfad der Patch-Datei nicht mehr ein. Akzeptanzkriterium von #1034: " +
        "die Lens-Agenten erheben den Diff NICHT selbst, sie lesen die einmal geschriebene Datei.",
    );
    assert.match(prompt, /Patch-Datei/, "Der Lens-Prompt benennt die Patch-Datei nicht als Quelle.");
  });

  test("der Lens-Prompt fordert den Diff nicht mehr selbst an", () => {
    // Der eigentliche Regressionsschutz: die alte Fassung stand als
    // „Überblick: git diff main --stat, voller Diff: git diff main" im Prompt.
    assert.doesNotMatch(
      prompt,
      /git diff (main|origin\/main)(?![.\w])/,
      "Im Lens-Prompt steht wieder eine Anweisung, git diff selbst zu fahren — genau die fünffache " +
        "Beschaffung, die #1034 beseitigt hat.",
    );
  });

  test("Umsetzung und Nachbesserung liefern den Patch-Pfad im Schema", () => {
    for (const schema of ["UMSETZUNG_SCHEMA", "NACHBESSERN_SCHEMA"]) {
      const block = workflow.slice(workflow.indexOf(`const ${schema}`), workflow.indexOf(`const ${schema}`) + 2500);
      assert.match(block, /diffPfad/, `${schema} führt kein diffPfad-Feld — der Review bekäme keinen Patch übergeben.`);
      assert.match(block, /diffHead/, `${schema} führt kein diffHead-Feld — der Frische-Guard hätte keinen Bezugspunkt.`);
    }
  });

  test("der Patch wird gegen origin/main als Drei-Punkt-Diff erhoben", () => {
    // Maintainerin-Entscheidung zu #1034: der Review soll denselben Slice sehen, den
    // check:diffsize/check:diffcoverage messen — nicht zusätzlich fremde main-Zeilen.
    assert.match(
      workflow,
      /origin\/main\.\.\.HEAD/,
      "Der Patch wird nicht als origin/main...HEAD erhoben. Zwei-Punkt gegen ein lokal veraltetes " +
        "main zieht fremde Zeilen in den Review (Entscheidung zu #1034).",
    );
  });
});

describe("Kontext-Diät: AGENTS.md/CLAUDE.md werden nicht erneut gelesen (#1034)", () => {
  test("der Lens-Prompt verbietet das erneute Vollöffnen der Kontextdateien", () => {
    assert.match(
      prompt,
      // [\s\S] statt . — der Prompt bricht die Zeile mitten im Satz um.
      /bereits[\s\S]{0,60}Kontext/i,
      "Dem Lens-Prompt fehlt der Hinweis, dass AGENTS.md/CLAUDE.md schon vollständig im Kontext " +
        "liegen (per @AGENTS.md-Import). Das erneute Read ist der größte Einzelposten (~30k/Lens).",
    );
    assert.match(prompt, /grep/i, "Dem Lens-Prompt fehlt die Anweisung, statt zu lesen punktuell zu greppen.");
  });

  test("der Lens-Prompt macht den Patch zur Primärquelle statt ganze Dateien zu öffnen", () => {
    assert.match(
      prompt,
      /offset|limit/,
      "Dem Lens-Prompt fehlt die Anweisung, eine geänderte Datei nur gezielt (offset/limit um die " +
        "Hunk-Zeilen) statt vollständig zu öffnen.",
    );
  });

  test("auch der Planungs-Agent liest die Kontextdateien nicht erneut", () => {
    // Maintainerin-Entscheidung zu #1034: der Planner (150k in der Messung) läuft im selben
    // Redundanz-Muster und wird mit einbezogen.
    assert.match(
      planner,
      /bereits .{0,60}Kontext|nicht erneut/i,
      "Der kubernia-planner fordert AGENTS.md/CLAUDE.md weiter zum Lesen an, obwohl der " +
        "@AGENTS.md-Import sie schon vollständig in seinen Kontext legt (#1034).",
    );
  });
});

describe("Frische-Guard: keine Lens reviewt einen veralteten Patch (#1034)", () => {
  test("der Lens-Prompt lässt den HEAD gegen den erwarteten Stand prüfen", () => {
    assert.match(
      prompt,
      /rev-parse/,
      "Dem Lens-Prompt fehlt der HEAD-Abgleich (git rev-parse HEAD gegen diffHead). Ohne ihn könnte " +
        "Runde 2 den Patch aus Runde 1 lesen und Fixes attestieren, die sie nie gesehen hat.",
    );
  });

  test("der Patch-Dateiname trägt die Runden-Nummer", () => {
    assert.match(
      workflow,
      /-r\$\{[^}]*\}\.patch|r\$\{[^}]*runde[^}]*\}/i,
      "Der Patch-Dateiname enthält keine Rundennummer — Runde 2 würde die Datei aus Runde 1 " +
        "überschreiben oder (schlimmer) unverändert weiterlesen.",
    );
  });
});

describe("Was NICHT gekürzt werden durfte (#1034)", () => {
  test("die Test-Lens prüft weiter per Sabotage auf False Positives", () => {
    const testLens = workflow.slice(workflow.indexOf("test-adaequanz"), workflow.indexOf("]", workflow.indexOf("test-adaequanz")));
    for (const marker of ["sabotier", "rot"]) {
      assert.match(
        testLens.toLowerCase(),
        new RegExp(marker),
        `Der Test-Lens-Auftrag hat den Sabotage-/Red-Green-Schritt verloren ("${marker}"). Das Ticket ` +
          "#1034 nennt ihn ausdrücklich als das, was die Kontext-Diät NICHT treffen darf — er fand in " +
          "der Messsession den einzigen echten Blocker.",
      );
    }
  });

  test("der tool-neutrale Skill dokumentiert die Materialisierung", () => {
    // Eine fremde KI liest .claude/workflows/ nicht — sie folgt dem Skill. Steht die Mechanik nur
    // im Workflow, gilt die Ersparnis nur unter Claude Code.
    assert.match(
      lensSkill,
      /\.patch/,
      "review-lenses/SKILL.md beschreibt die Patch-Materialisierung nicht. Der Skill ist der " +
        "tool-neutrale Pfad (AGENTS.md § Rollentrennung) — ohne ihn greift #1034 nur im Workflow.",
    );
  });
});

describe("Erkennung greift wirklich (Red-Green, #1034)", () => {
  test("der Prompt-Ausschnitt trifft wirklich nur den Lens-Pass", () => {
    // Beweist, dass lensPrompt() schneidet statt die ganze Datei durchzuwinken: der
    // Umsetzungs-Auftrag (eigene Phase) darf NICHT im Ausschnitt liegen, sonst wären die
    // doesNotMatch-Zusicherungen oben wertlos.
    assert.ok(prompt.length > 0 && prompt.length < workflow.length, "Ausschnitt ist die ganze Datei");
    assert.doesNotMatch(prompt, /AUFGABE — das Ticket umsetzen/, "Ausschnitt reicht in die Umsetzungs-Phase hinein");
  });

  test("eine zurückgedrehte Fassung würde auffallen", () => {
    // Gegenbeispiel mit dem alten Wortlaut: der Erhebungs-Check kippt.
    const alt = "voller Diff: git diff main — mit absoluten Pfaden arbeiten";
    assert.match(alt, /git diff (main|origin\/main)(?![.\w])/);
    // …und ein Patch-Pfad ohne Rundennummer fällt am Frische-Guard auf.
    assert.doesNotMatch("kq-${nr}.patch", /-r\$\{[^}]*\}\.patch/);
  });
});
