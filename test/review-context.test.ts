/* Review-Kontext-Wächter (#1034) – die Lens-Pässe beschaffen ihren Kontext EINMAL, nicht fünfmal.
 *
 * Gemessen an Ticket #1021 / PR #1029: ein einzelnes Ticket verbrauchte 1,03 Mio Subagent-Tokens,
 * 85 % davon im Review. Die Befunde rechtfertigten den Review inhaltlich – die Kontext-BESCHAFFUNG
 * war aber fünffach redundant: jeder Lens-Agent fuhr `git diff` selbst, las die geänderten Dateien
 * vollständig und öffnete AGENTS.md/CLAUDE.md erneut, obwohl der `@AGENTS.md`-Import beide bereits
 * vollständig in seinen Kontext legt. Das produziert keinen einzigen zusätzlichen Befund.
 * (Die gemessenen Zahlen und ihre Deutung stehen in docs/agent-harness.md § 2.5 – hier nur, was
 * maschinell festgenagelt wird.)
 *
 * Dieser Wächter nagelt die drei Maßnahmen fest, die sonst leise zurückdriften – jede von ihnen
 * würde beim Zurückdrehen NICHTS anderes rot machen (der Workflow lief vorher ja auch):
 *
 *   1. **Materialisierung.** Der Diff wird einmal als Patch-Datei geschrieben und den Lenses als
 *      PFAD übergeben. Der Lens-Prompt darf den Diff im Primärpfad NICHT selbst erheben.
 *   2. **Kontext-Diät.** Die Anweisung „AGENTS.md/CLAUDE.md sind schon in deinem Kontext – nicht
 *      erneut lesen, punktuell greppen" ist der größte Einzelposten (~30k Tokens pro Lens).
 *   3. **Frische-Guard.** Der Patch trägt eine Rundennummer und den erwarteten HEAD, und der
 *      Orchestrator verwirft einen Vorrunden-Patch, statt ihn weiterzureichen. Ohne das reviewt
 *      Runde 2 den Stand von Runde 1 und attestiert Fixes, die sie nie gesehen hat – ein Review,
 *      der von außen grün aussieht, aber nichts geprüft hat. Das ist der gefährlichste Fehlerfall
 *      dieses Tickets, nicht bloß eine Ersparnis.
 *
 * Dazu die harte Schutzklausel des Tickets: die **Sabotage-/Red-Green-Prüfung** der Test-Lens darf
 * die Kürzung NICHT treffen. Sie fand in der Messsession den einzigen echten Blocker. Ein Wächter,
 * der nur Ersparnis prüft, würde ihr Wegkürzen belohnen – darum steht sie hier als Zusicherung.
 *
 * ⚠️ **Warum die Prüfungen benannte PRÄDIKATE sind und keine Inline-Regexe** (Lehre aus dem
 * Review dieses Tickets, #1034): die erste Fassung prüfte das echte Artefakt mit einem Regex und
 * „bewies" die Nicht-False-Positivität, indem sie eine ABGESCHRIEBENE Kopie desselben Regex auf
 * ein String-Literal anwandte. Das ist tautologisch – ein Sabotage-Lauf zeigte, dass sich vier
 * Zusicherungen zurückdrehen ließen, ohne dass ein Test fiel (u.a. die fallback-freie
 * diff-Zuweisung und eine zusätzliche Selbst-Erhebung in Drei-Punkt-Form). Jetzt läuft jedes
 * Prädikat über DIESELBE Funktion gegen (a) das echte Artefakt und (b) ein Gegenbeispiel, das
 * rot sein MUSS. Ein aufgeweichtes Prädikat lässt damit sofort seinen eigenen Gegenbeweis fallen.
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

// ── Ausschnitte aus dem Workflow ────────────────────────────────────────────────
// Der Workflow ist eine Datei; die Zusicherungen gelten aber je Prompt/Block. Ein Regex über die
// GANZE Datei wäre grün, sobald der gesuchte Text irgendwo sonst vorkommt – genau dieser Fehler
// liess in der ersten Fassung einen zurueckgedrehten patchAuftrag durchgehen.

/** Rumpf einer Template-String-Konstante (`const NAME = \`…\``). */
function konstante(text: string, name: string): string {
  const m = text.match(new RegExp(`const ${name} =\\s*\`([\\s\\S]*?)\``));
  assert.ok(m, `Template-Konstante ${name} im Workflow nicht gefunden`);
  return m[1];
}

/**
 * Rumpf einer Arrow-Funktion mit Template-Literal (`const NAME = (…) => \`…\``).
 * `\r?\n` statt `\n`: die Datei liegt im Arbeitsbaum mit CRLF (git-Autoconversion) — ein
 * reines `\n` hinter dem schließenden Backtick findet den Block auf Windows nie.
 */
function templateFunktion(text: string, name: string): string {
  const m = text.match(new RegExp(`const ${name} = \\([^)]*\\) =>\\s*\`([\\s\\S]*?)\`\\r?\\n`));
  assert.ok(m, `Template-Funktion ${name} im Workflow nicht gefunden`);
  return m[1];
}

/**
 * Der Lens-Prompt – von `const reviewPass` bis zum Options-Objekt des Lens-`agent()`-Aufrufs,
 * mit aufgelöstem Diät-Baustein. Die Auflösung ist nötig, weil der Diät-Text weiter oben in der
 * Datei steht: ohne sie würde der Wächter die Textform prüfen statt der Wirkung und wäre grün,
 * sobald der Baustein ausgehöhlt (aber weiter interpoliert) wird.
 */
function lensPrompt(text: string): string {
  const start = text.indexOf("const reviewPass");
  assert.notEqual(start, -1, "reviewPass-Definition im Workflow nicht gefunden");
  const end = text.indexOf("phase: 'Review'", start);
  assert.notEqual(end, -1, "Ende des Lens-agent()-Aufrufs (phase: 'Review') nicht gefunden");
  const roh = text.slice(start, end);
  // Schnitt-Validierung. Der frühere „Ausschnitt trifft nur den Lens-Pass"-Test war VAKUANT: er
  // suchte einen Text, der VOR `const reviewPass` steht und daher nie im Ausschnitt liegen kann.
  // Also gegen Marker prüfen, die HINTER dem Lens-Pass stehen (Nachbessern-Phase).
  assert.ok(roh.includes("lens.auftrag"), "Ausschnitt enthält den Lens-Auftrag nicht — Startmarke falsch");
  assert.doesNotMatch(roh, /phase: 'Nachbessern'/, "Ausschnitt reicht in die Nachbessern-Phase hinein");
  assert.doesNotMatch(roh, /NACHBESSERN_SCHEMA/, "Ausschnitt reicht über den Lens-Pass hinaus");
  assert.match(roh, /\$\{KONTEXT_DIAET\}/, "Der Lens-Prompt interpoliert den Kontext-Diät-Block nicht mehr (#1034).");
  return roh.replace("${KONTEXT_DIAET}", konstante(text, "KONTEXT_DIAET"));
}

/**
 * Der PRIMÄRPFAD des Lens-Prompts: der `diff.pfad ? … : …`-Zweig ohne seinen Fallback. Nur hier
 * gilt „erhebe den Diff nicht selbst" absolut — der Fallback-Zweig DARF eine Selbst-Erhebung
 * nennen (er greift ja gerade, wenn kein Patch da ist). Ohne diese Trennung musste die
 * Assertion die Drei-Punkt-Form per Lookahead durchlassen, und eine zusätzliche
 * Selbst-Erhebung in genau dieser Form blieb unentdeckt.
 */
function primaerpfad(promptText: string): string {
  const start = promptText.indexOf("Der Diff liegt bereits als Patch-Datei bereit");
  assert.notEqual(start, -1, "Primärzweig (Patch-Datei-Anweisung) im Lens-Prompt nicht gefunden");
  const end = promptText.indexOf("Es liegt KEINE vorbereitete Patch-Datei", start);
  assert.notEqual(end, -1, "Fallback-Zweig im Lens-Prompt nicht gefunden — beide Zweige müssen existieren");
  return promptText.slice(start, end);
}

/** Die diff-Zuweisung nach dem Nachbessern (der Frische-Guard im Kontrollfluss). */
function diffZuweisung(text: string): string {
  const start = text.indexOf("const vorherigerHead");
  assert.notEqual(start, -1, "Die diff-Neuzuweisung nach dem Nachbessern wurde nicht gefunden");
  return text.slice(start, text.indexOf("if (nachbesserung && nachbesserung.zusammenfassung) log", start));
}

// ── Prädikate: EIN Ort je Regel, angewandt auf echtes Artefakt UND Gegenbeispiel ──

/** Fordert der Text den Leser auf, den Diff selbst per git diff zu erheben? (Beide Formen.) */
const erhebtDiffSelbst = (s: string) => /git diff\s+(?:--\S+\s+)*(?:main|origin\/main)/.test(s);

/** Nennt der Text die vorbereitete Patch-Datei als Quelle? */
const nenntPatchDatei = (s: string) => /Patch-Datei/.test(s) && /diff\.pfad/.test(s);

/**
 * Verzweigt der Prompt wirklich auf `diff.pfad` — oder nur auf etwas Konstantes?
 * Ohne diese Prüfung liess sich die Bedingung auf `false` setzen (alle Lenses fielen in den
 * Fallback und erhoben den Diff wieder selbst), ohne dass ein Test fiel: der Token `diff.pfad`
 * steht ja weiterhin im Rumpf des Zweigs.
 */
const verzweigtAufPatch = (s: string) => /\$\{\s*diff\.pfad\s*\?/.test(s);

/** Verbietet der Text das erneute Vollöffnen der Kontextdateien und nennt Grep als Ersatz? */
const haeltKontextDiaet = (s: string) => /bereits[\s\S]{0,60}Kontext/i.test(s) && /grep/i.test(s);

/** Weist der Text an, Dateien gezielt statt vollständig zu öffnen? */
const liestGezielt = (s: string) => /offset|limit/.test(s);

/** Lässt der Text den HEAD gegen den Patch-Stand abgleichen? */
const hatFrischeGuard = (s: string) => /rev-parse/.test(s);

/** Trägt der Patch-Dateiname eine Rundennummer? */
const hatRundenNummer = (s: string) => /-r\$\{[^}]*runde[^}]*\}\.patch/i.test(s);

/** Erhebt der Text den Diff als Drei-Punkt-Diff gegen origin/main? */
const istDreiPunkt = (s: string) => /origin\/main\.\.\.HEAD/.test(s);

/** Verwirft die Zuweisung einen Vorrunden-Patch, statt auf ihn zurückzufallen? */
const verwirftVorrundenPatch = (s: string) =>
  /diff = diffAus\(nachbesserung\)/.test(s) && // die neue Runde ersetzt, statt zu ergänzen
  !/\bdiff\s*=\s*[^\n]*\|\|\s*diff\b/.test(s) && // kein `|| diff`-Fallback
  !/\?\s*[^\n]*:\s*diff\b/.test(s) && // kein `: diff` im Ternär
  /diff\.head === vorherigerHead/.test(s); // identischer HEAD wird erkannt

/** Bleibt die Sabotage-/Red-Green-Prüfung im Test-Lens-Auftrag? */
const fordertSabotage = (s: string) => /sabotier/i.test(s) && /\brot\b/i.test(s);

/**
 * Die Ausschnitte werden LAZY und gemerkt ermittelt, nicht im Modul-Scope. Grund: eine
 * Assertion im Modul-Scope lässt Vitest mit „no tests" enden — der Exit-Code ist zwar 1 (kein
 * False Positive), aber alle übrigen Zusicherungen inklusive der Sabotage-Schutzklausel laufen
 * dann nicht mehr, und die Diagnose steht ohne Test-Namen da. So bleibt jeder Fehlschlag lokal.
 */
function memo<T>(f: () => T): () => T {
  let wert: { v: T } | undefined;
  return () => (wert ??= { v: f() }).v;
}

const prompt = memo(() => lensPrompt(workflow));
const primaer = memo(() => primaerpfad(prompt()));
const patchAuftrag = memo(() => templateFunktion(workflow, "patchAuftrag"));
const zuweisung = memo(() => diffZuweisung(workflow));
const testLensAuftrag = memo(() =>
  workflow.slice(workflow.indexOf("test-adaequanz"), workflow.indexOf("]", workflow.indexOf("test-adaequanz"))),
);

describe("Der Diff wird einmal materialisiert statt pro Lens erhoben (#1034)", () => {
  test("der Lens-Prompt übergibt die Patch-Datei als Pfad", () => {
    assert.ok(
      nenntPatchDatei(prompt()),
      "Der Lens-Prompt setzt den Pfad der Patch-Datei nicht ein. Akzeptanzkriterium von #1034: " +
        "die Lens-Agenten erheben den Diff NICHT selbst, sie lesen die einmal geschriebene Datei.",
    );
    assert.ok(
      verzweigtAufPatch(prompt()),
      "Der Prompt verzweigt nicht auf diff.pfad. Eine konstante Bedingung würde ALLE Lenses in den " +
        "Fallback schicken — sie erheben den Diff dann wieder selbst, und der Ticket-Zweck ist weg.",
    );
  });

  test("im Primärpfad fordert der Lens-Prompt KEINE eigene Diff-Erhebung", () => {
    assert.ok(
      !erhebtDiffSelbst(primaer()),
      "Im Primärzweig des Lens-Prompts steht eine Anweisung, git diff selbst zu fahren — genau die " +
        "fünffache Beschaffung, die #1034 beseitigt hat. (Der Fallback-Zweig darf das, dieser nicht.)",
    );
  });

  test("der Fallback-Zweig existiert und erhebt den Diff einmal selbst", () => {
    // Bewusste, LAUTE Degradation: fehlt der Patch, arbeitet die Lens weiter — aber sie meldet es.
    // Ein Wächter, der nur die Ersparnis prüft, würde ein stilles Scheitern nicht bemerken.
    const fallback = prompt().slice(prompt().indexOf("Es liegt KEINE vorbereitete Patch-Datei"));
    assert.ok(erhebtDiffSelbst(fallback), "Der Fallback-Zweig sagt nicht, wie ohne Patch zu arbeiten ist");
    assert.match(fallback, /Harness-Defekt/, "Der Fallback meldet das fehlende Artefakt nicht als Defekt");
  });

  test("Umsetzung und Nachbesserung liefern Pfad + HEAD im Schema", () => {
    for (const name of ["UMSETZUNG_SCHEMA", "NACHBESSERN_SCHEMA"]) {
      const start = workflow.indexOf(`const ${name}`);
      // Bis zur NÄCHSTEN Top-Level-const schneiden statt mit festem Zeichen-Fenster: ein zu
      // grosses Fenster blutet in den Folgecode aus und wäre ein latenter Falsch-Grün-Kanal.
      const block = workflow.slice(start, workflow.indexOf("\nconst ", start + 1));
      assert.match(block, /diffPfad/, `${name} führt kein diffPfad-Feld — der Review bekäme keinen Patch.`);
      assert.match(block, /diffHead/, `${name} führt kein diffHead-Feld — der Frische-Guard hätte keinen Bezug.`);
    }
  });

  test("der Patch wird als Drei-Punkt-Diff gegen origin/main erhoben", () => {
    // Maintainerin-Entscheidung zu #1034: der Review soll denselben Slice sehen, den
    // check:diffsize/check:diffcoverage messen — nicht zusätzlich fremde main-Zeilen.
    // Geprüft wird der patchAuftrag SELBST, nicht die ganze Datei: sonst hält ein beliebiges
    // anderes Vorkommen von origin/main...HEAD den Test grün.
    assert.ok(
      istDreiPunkt(patchAuftrag()),
      "Der Patch-Auftrag erhebt nicht origin/main...HEAD. Zwei-Punkt gegen ein lokal veraltetes " +
        "main zieht fremde Zeilen in den Review (Entscheidung zu #1034).",
    );
    assert.ok(hatRundenNummer(patchAuftrag()), "Der Patch-Dateiname trägt keine Rundennummer");
  });
});

describe("Kontext-Diät: AGENTS.md/CLAUDE.md werden nicht erneut gelesen (#1034)", () => {
  test("der Lens-Prompt verbietet das erneute Vollöffnen der Kontextdateien", () => {
    assert.ok(
      haeltKontextDiaet(prompt()),
      "Dem Lens-Prompt fehlt der Hinweis, dass AGENTS.md/CLAUDE.md schon vollständig im Kontext " +
        "liegen (per @AGENTS.md-Import), oder die Anweisung, statt zu lesen punktuell zu greppen. " +
        "Das erneute Read ist der größte Einzelposten (~30k pro Lens).",
    );
  });

  test("der Lens-Prompt macht den Patch zur Primärquelle statt ganze Dateien zu öffnen", () => {
    assert.ok(
      liestGezielt(prompt()),
      "Dem Lens-Prompt fehlt die Anweisung, eine geänderte Datei nur gezielt (offset/limit um die " +
        "Hunk-Zeilen) statt vollständig zu öffnen.",
    );
  });

  test("jede Brille bekommt ihren eigenen Regel-Ausschnitt", () => {
    // Aufgabe (2) des Tickets verlangt ausdrücklich einen ANDEREN Ausschnitt je Brille — sonst
    // liest jede Lens wieder alles.
    const lenses = workflow.slice(workflow.indexOf("const LENSES"), workflow.indexOf("\nconst MAX_FIX_VERSUCHE"));
    const treffer = lenses.match(/Dein Regel-Ausschnitt/g) || [];
    assert.equal(treffer.length, 3, `Nur ${treffer.length} von 3 Lens-Aufträgen benennen ihren Regel-Ausschnitt`);
  });

  test("auch der Planungs-Agent liest die Kontextdateien nicht erneut", () => {
    // Maintainerin-Entscheidung zu #1034: der Planner (150k in der Messung) läuft im selben
    // Redundanz-Muster und wird mit einbezogen.
    assert.ok(
      haeltKontextDiaet(planner),
      "Der kubernia-planner fordert AGENTS.md/CLAUDE.md weiter zum Lesen an, obwohl der " +
        "@AGENTS.md-Import sie schon vollständig in seinen Kontext legt (#1034).",
    );
  });
});

describe("Frische-Guard: keine Lens reviewt einen veralteten Patch (#1034)", () => {
  test("der Lens-Prompt lässt den HEAD gegen den erwarteten Stand prüfen", () => {
    assert.ok(
      hatFrischeGuard(prompt()),
      "Dem Lens-Prompt fehlt der HEAD-Abgleich (git rev-parse HEAD gegen diffHead).",
    );
  });

  test("der Orchestrator verwirft einen Vorrunden-Patch, statt auf ihn zurückzufallen", () => {
    // Das ist der Kontrollfluss, nicht die Prompt-Textform — und der gefährlichste Fehlerfall
    // des Tickets. Eine reine Textprüfung liess hier zu, dass die Zuweisung auf den alten
    // Patch zurückfällt, ohne dass ein Test fiel.
    assert.ok(
      verwirftVorrundenPatch(zuweisung()),
      "Die diff-Zuweisung nach dem Nachbessern reicht den Patch der Vorrunde weiter (Fallback auf " +
        "den alten Pfad oder fehlender HEAD-Vergleich). Dann attestiert Runde 2 Fixes, die sie nie " +
        "gesehen hat — ein Review, der von außen grün aussieht und nichts geprüft hat.",
    );
  });

  test("die Zusammenfassung an die Lenses ist die der aktuellen Runde", () => {
    // Sonst liest Runde 2 einen als aktuell etikettierten Begleittext aus Runde 1 und meldet
    // bewusst liegen gelassene Punkte erneut als blockierend.
    assert.match(prompt(), /letzteZusammenfassung/, "Der Lens-Prompt reicht die Zusammenfassung der Vorrunde durch");
    assert.match(
      workflow,
      /letzteZusammenfassung = nachbesserung\.zusammenfassung/,
      "Die Nachbesserungs-Zusammenfassung erreicht die nächsten Kritiker nicht",
    );
  });
});

describe("Was NICHT gekürzt werden durfte (#1034)", () => {
  test("die Test-Lens prüft weiter per Sabotage auf False Positives", () => {
    assert.ok(
      fordertSabotage(testLensAuftrag()),
      "Der Test-Lens-Auftrag hat den Sabotage-/Red-Green-Schritt verloren. Das Ticket #1034 nennt " +
        "ihn ausdrücklich als das, was die Kontext-Diät NICHT treffen darf — er fand in der " +
        "Messsession den einzigen echten Blocker.",
    );
  });

  test("der tool-neutrale Skill dokumentiert Materialisierung und Commit-Pflicht", () => {
    // Eine fremde KI liest .claude/workflows/ nicht — sie folgt dem Skill. Steht die Mechanik nur
    // im Workflow, gilt die Ersparnis nur unter Claude Code.
    assert.match(lensSkill, /\.patch/, "review-lenses/SKILL.md beschreibt die Patch-Materialisierung nicht.");
    assert.match(
      lensSkill,
      /porcelain/,
      "Dem Skill fehlt die Commit-Pflicht. Drei-Punkt gegen HEAD enthält nur Committetes — wer den " +
        "Review mitten in der Arbeit anstößt, bekäme ein ok über Code, den keine Lens gesehen hat.",
    );
  });
});

describe("Erkennung greift wirklich (Red-Green, #1034)", () => {
  // Jedes Gegenbeispiel läuft durch DASSELBE Prädikat wie das echte Artefakt oben. Wird ein
  // Prädikat aufgeweicht, fällt hier sein eigener Gegenbeweis — anders als bei der ersten
  // Fassung, die abgeschriebene Regex-Kopien auf String-Literale anwandte und damit nichts bewies.

  test("erhebtDiffSelbst fängt BEIDE Erhebungs-Schreibweisen", () => {
    assert.ok(erhebtDiffSelbst("Überblick: git diff main --stat, voller Diff: git diff main"), "Zwei-Punkt");
    assert.ok(erhebtDiffSelbst("voller Diff: git diff origin/main...HEAD"), "Drei-Punkt");
    assert.ok(erhebtDiffSelbst("erhebe ihn mit git diff --stat origin/main...HEAD"), "mit Flag");
    assert.ok(!erhebtDiffSelbst("lies die Patch-Datei unter ${diff.pfad}"), "darf den Patch-Weg nicht treffen");
  });

  test("verzweigtAufPatch fällt bei konstanter Bedingung", () => {
    assert.ok(verzweigtAufPatch("${\n  diff.pfad\n    ? `lies ${diff.pfad}`\n    : `kein Patch`\n}"));
    assert.ok(
      !verzweigtAufPatch("${\n  false\n    ? `lies ${diff.pfad}`\n    : `kein Patch`\n}"),
      "konstant-falsche Bedingung muss rot sein — der Rumpf nennt diff.pfad ja weiterhin",
    );
  });

  test("nenntPatchDatei verlangt Pfad UND Benennung", () => {
    assert.ok(nenntPatchDatei("Die Patch-Datei liegt unter ${diff.pfad}"));
    assert.ok(!nenntPatchDatei("Die Patch-Datei liegt irgendwo"), "ohne Pfad-Interpolation nicht grün");
    assert.ok(!nenntPatchDatei("${diff.pfad}"), "ohne Benennung nicht grün");
  });

  test("haeltKontextDiaet fällt bei ausgehöhltem Baustein", () => {
    assert.ok(haeltKontextDiaet("AGENTS.md liegt bereits vollständig in deinem Kontext — greppe punktuell."));
    assert.ok(!haeltKontextDiaet("Lies AGENTS.md und CLAUDE.md vollständig."), "alte Fassung muss rot sein");
    assert.ok(!haeltKontextDiaet("Es liegt bereits im Kontext."), "ohne Grep-Anweisung nicht grün");
  });

  test("verwirftVorrundenPatch fällt bei jeder der drei Aufweichungen", () => {
    const gut =
      "const vorherigerHead = diff.head\ndiff = diffAus(nachbesserung)\nif (diff.head && vorherigerHead && diff.head === vorherigerHead) { diff = diffAus(null) }";
    assert.ok(verwirftVorrundenPatch(gut), "die echte Fassung muss grün sein");
    assert.ok(
      !verwirftVorrundenPatch(gut.replace("diff = diffAus(nachbesserung)", "diff = diffAus(nachbesserung) || diff")),
      "`|| diff`-Fallback muss rot sein",
    );
    assert.ok(
      !verwirftVorrundenPatch("const vorherigerHead = diff.head\ndiff = nachbesserung ? diffAus(nachbesserung) : diff"),
      "`: diff`-Ternär muss rot sein",
    );
    assert.ok(
      !verwirftVorrundenPatch("const vorherigerHead = diff.head\ndiff = diffAus(nachbesserung)"),
      "fehlender HEAD-Vergleich muss rot sein",
    );
  });

  test("fordertSabotage fällt, wenn der Schritt entschärft wird", () => {
    assert.ok(fordertSabotage("sabotiere die Assertion kurz, sieh rot, setze zurück"));
    assert.ok(!fordertSabotage("prüfe die Assertion kritisch"), "entschärfte Fassung muss rot sein");
  });

  test("die Ausschnitt-Funktionen schneiden wirklich", () => {
    // Gegen die frühere VAKUANTE Grenzprüfung: der Ausschnitt muss echt kleiner sein als die
    // Datei, und der Primärpfad echt kleiner als der Prompt.
    assert.ok(prompt().length < workflow.length, "Lens-Ausschnitt ist die ganze Datei");
    assert.ok(primaer().length < prompt().length, "Primärpfad ist der ganze Prompt");
    assert.ok(patchAuftrag().length < workflow.length, "patchAuftrag-Ausschnitt ist die ganze Datei");
    assert.ok(zuweisung().length > 0 && zuweisung().length < 1500, "diff-Zuweisungs-Ausschnitt ist unplausibel groß");
  });
});
