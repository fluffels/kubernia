/* Review-Kontext-Wächter (#1034) – die Lens-Pässe beschaffen ihren Kontext EINMAL, nicht fünfmal.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Gemessen an Ticket #1021 / PR #1029: ein einzelnes Ticket verbrauchte 1,03 Mio Subagent-Tokens,
 * 85 % davon im Review. Die Befunde rechtfertigten den Review inhaltlich – die Kontext-BESCHAFFUNG
 * war aber fünffach redundant: jeder Lens-Agent fuhr `git diff` selbst, las die geänderten Dateien
 * vollständig und öffnete die Root-Kontextdateien erneut, obwohl Claude Code sie bereits (seit #1087 nativ)
 * vollständig in seinen Kontext legt. Das produziert keinen einzigen zusätzlichen Befund.
 * (Die gemessenen Zahlen und ihre Deutung stehen in docs/agent-harness.md § 2.5 – hier nur, was
 * maschinell festgenagelt wird.)
 *
 * Dieser Wächter nagelt die drei Maßnahmen fest, die sonst leise zurückdriften – jede von ihnen
 * würde beim Zurückdrehen NICHTS anderes rot machen (der Ablauf lief vorher ja auch):
 *
 *   1. **Materialisierung.** Der Diff wird einmal als Patch-Datei geschrieben und den Lenses als
 *      PFAD übergeben. Der Skill lässt den Diff nur einmal erheben.
 *   2. **Kontext-Diät.** Die Anweisung „AGENTS.md ist schon in deinem Kontext – nicht
 *      erneut lesen, punktuell greppen" ist der größte Einzelposten (~30k Tokens pro Lens).
 *   3. **Frische-Guard.** Der Patch trägt eine Rundennummer und den erwarteten HEAD, jede Lens
 *      prüft ihn gegen `git rev-parse HEAD`. Ohne das reviewt
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
 * Fitness-Function-Kategorie neben agents-md-native/harness-approval/docmap (#992/#1012/#482), nicht
 * mit Verhaltens-Tests vermischen. Bewusst **ohne** eigenes `scripts/check-*.mjs`: `scripts/check-`
 * ist selbst Gate-Config – für doku-/prompt-strukturelle Wächter gibt es
 * die etablierte test-only-Familie (Präzedenz: `test/harness/agents-md-native.test.ts`).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { projektConfig } from "../support/fremd-config";
import { liesMitProjektwerten } from "../support/ticket-ablauf";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/** Echte Projektwerte: die Texte werden mit ihnen gelesen (Präfix nur aus [A-Za-z0-9-], daher ohne Escaping in Regex). */
const ECHT = projektConfig();
const WT = ECHT.praefixe.worktree;
const lensSkill = liesMitProjektwerten(".agents/skills/review-lenses/SKILL.md");
const planner = liesMitProjektwerten(".claude/agents/factory-planer.md");
const lensAgent = liesMitProjektwerten(".claude/agents/factory-lens.md");

/** Schneidet den Abschnitt von `von` bis (ohne) `bis` aus; wirft, wenn ein Anker fehlt (kein stilles Leerlaufen). */
function teil(text: string, von: string, bis: string): string {
  const a = text.indexOf(von);
  const b = a < 0 ? -1 : text.indexOf(bis, a + von.length);
  if (a < 0 || b < 0) throw new Error(`Skill-Abschnitt nicht gefunden: ${von} … ${bis}`);
  return text.slice(a, b);
}

// Die Prädikate laufen über den jeweiligen Abschnitt, nicht über die ganze Datei: sonst trägt ein zweiter Treffer
// an anderer Stelle (z. B. „greppen“ in Lens 4, `rev-parse` im Patch-Befehl) eine zurückgedrehte Regel.
const patchSkill = teil(lensSkill, "## Was ist „der Diff", "### Kontext-Diät je Lens");
const diaetSkill = teil(lensSkill, "### Kontext-Diät je Lens", "> **Was die Diät");
const frischeSkill = teil(lensSkill, "⚠️ **Frische-Guard", "### Kontext-Diät je Lens");

// ── Prädikate: EIN Ort je Regel, angewandt auf echtes Artefakt UND Gegenbeispiel ──

/** Nennt der Text die vorbereitete Patch-Datei als Quelle? */
const nenntPatchDatei = (s: string) => /Patch-Datei/.test(s) && /\.patch/.test(s);

/** Verbietet der Text das erneute Vollöffnen der Kontextdateien und nennt Grep als Ersatz? */
const haeltKontextDiaet = (s: string) => /bereits[\s\S]{0,60}Kontext[\s\S]{0,300}grepp/i.test(s);

/** Weist der Text an, Dateien gezielt statt vollständig zu öffnen? */
const liestGezielt = (s: string) => /gezielt per Grep oder offset\/limit/.test(s) && /gezielt um die Hunk-Zeilen, nicht die ganze Datei/.test(s);

/** Lässt der Text den HEAD gegen den Patch-Stand abgleichen? */
const hatFrischeGuard = (s: string) => /rev-parse/.test(s);

/** Trägt der Patch-Dateiname eine Rundennummer? */
const hatRundenNummer = (s: string) => /-r<runde>[^\s"]*\.patch/i.test(s);

/** Erhebt der Text den Diff als Drei-Punkt-Diff gegen origin/main? */
const istDreiPunkt = (s: string) => /git diff origin\/main\.\.\.HEAD > /.test(s);

/** Bleibt die Sabotage-/Red-Green-Prüfung im Test-Lens-Auftrag? */
const fordertSabotage = (s: string) => /sabotier/i.test(s) && /\brot\b/i.test(s);

describe("Der Diff wird einmal materialisiert statt pro Lens erhoben (#1034)", () => {
  test("der Skill schreibt den Diff einmal in eine Patch-Datei und übergibt den Pfad", () => {
    assert.ok(
      nenntPatchDatei(patchSkill),
      "review-lenses/SKILL.md nennt die Patch-Datei nicht. Akzeptanzkriterium von #1034: " +
        "die Lens-Agenten erheben den Diff NICHT selbst, sie lesen die einmal geschriebene Datei.",
    );
  });

  test("der Patch wird als Drei-Punkt-Diff gegen origin/main erhoben, mit Rundennummer", () => {
    // Maintainerin-Entscheidung zu #1034: der Review soll denselben Slice sehen, den
    // check:diffsize/check:diffcoverage messen — nicht zusätzlich fremde main-Zeilen.
    assert.ok(
      istDreiPunkt(patchSkill),
      "Der Skill erhebt nicht origin/main...HEAD. Zwei-Punkt gegen ein lokal veraltetes " +
        "main zieht fremde Zeilen in den Review (Entscheidung zu #1034).",
    );
    assert.ok(hatRundenNummer(patchSkill), "Der Patch-Dateiname trägt keine Rundennummer");
  });
});

describe("Kontext-Diät: AGENTS.md wird nicht erneut gelesen (#1034)", () => {
  test("der Skill verbietet das erneute Vollöffnen der Kontextdateien", () => {
    assert.ok(
      haeltKontextDiaet(diaetSkill),
      "Dem Lens-Skill fehlt der Hinweis, dass AGENTS.md schon vollständig im Kontext " +
        "liegt (Claude Code lädt sie nativ), oder die Anweisung, statt zu lesen punktuell zu greppen. " +
        "Das erneute Read ist der größte Einzelposten (~30k pro Lens).",
    );
  });

  test("der Skill macht den Patch zur Primärquelle statt ganze Dateien zu öffnen", () => {
    assert.ok(
      liestGezielt(diaetSkill),
      "Dem Lens-Skill fehlt die Anweisung, eine geänderte Datei nur gezielt (offset/limit um die " +
        "Hunk-Zeilen) statt vollständig zu öffnen.",
    );
  });

  test("jede Brille bekommt ihren eigenen Regel-Ausschnitt", () => {
    // Sonst liest jede Lens wieder alles.
    assert.match(lensSkill, /eigenen Regel-Ausschnitt/, "Der Skill nennt den Regel-Ausschnitt je Brille nicht");
    for (const brille of ["Architektur", "Requirement-Treue", "Test-Adäquanz", "Doku"]) {
      assert.match(lensSkill, new RegExp(`${brille} →`), `Kein Regel-Ausschnitt für die Brille ${brille}`);
    }
  });

  test("auch der Planungs-Agent liest die Kontextdateien nicht erneut", () => {
    // Maintainerin-Entscheidung zu #1034: der Planner (150k in der Messung) läuft im selben
    // Redundanz-Muster und wird mit einbezogen.
    assert.ok(
      haeltKontextDiaet(planner),
      "Der Planungs-Agent fordert AGENTS.md weiter zum Lesen an, obwohl Claude " +
        "Code sie nativ und schon vollständig in seinen Kontext legt (#1034).",
    );
  });

  test("auch der Lens-Agent liest die Kontextdateien nicht erneut (#1209)", () => {
    assert.ok(
      haeltKontextDiaet(lensAgent),
      "Der Lens-Agent fordert AGENTS.md weiter zum Lesen an, obwohl Claude Code sie nativ und schon " +
        "vollständig in seinen Kontext legt (#1034).",
    );
  });
});

describe("Abschnittsprädikate: eine zurückgedrehte Regel im eigenen Abschnitt wird rot (#1067)", () => {
  test("Regel 1 der Kontext-Diät ohne Grep-Anweisung fällt durch", () => {
    assert.ok(!haeltKontextDiaet(diaetSkill.replace("**punktuell greppen**", "**die Datei lesen**")));
  });
  test("Frische-Guard-Absatz ohne HEAD-Abgleich fällt durch", () => {
    assert.ok(!hatFrischeGuard(frischeSkill.replace(/`git rev-parse HEAD`/g, "den Stand")));
  });
  test("Patch-Schreibbefehl als Zwei-Punkt-Diff fällt durch (der --stat-Befehl trägt die Drei-Punkt-Form weiter)", () => {
    assert.ok(!istDreiPunkt(patchSkill.replace("git diff origin/main...HEAD > ", "git diff main > ")));
  });
  test("Regel 3 ohne den Hunk-Zeilen-Satz (Datei nur gezielt öffnen) fällt durch", () => {
    assert.ok(!liestGezielt(diaetSkill.replace("dann gezielt um die Hunk-Zeilen, nicht die ganze Datei", "dann vollständig")));
  });
  test("Regel 3 der Kontext-Diät ohne die Gezielt-Anweisung fällt durch (kein größeres `limit` zählt nicht)", () => {
    assert.ok(!liestGezielt(diaetSkill.replace("danach nur gezielt per Grep oder offset/limit", "danach nach Belieben")));
  });
  test("ein fehlender Abschnittsanker wirft statt leer zu laufen", () => {
    assert.throws(() => teil(lensSkill, "### Nicht vorhanden", "> **Was die Diät"), /nicht gefunden/);
  });
});

describe("Frische-Guard: keine Lens reviewt einen veralteten Patch (#1034)", () => {
  test("der Skill lässt den HEAD gegen den erwarteten Stand prüfen", () => {
    assert.ok(
      hatFrischeGuard(frischeSkill),
      "Dem Lens-Skill fehlt der HEAD-Abgleich (git rev-parse HEAD gegen den erwarteten HEAD).",
    );
  });
});

describe("Was NICHT gekürzt werden durfte (#1034)", () => {
  test("die Test-Lens prüft weiter per Sabotage auf False Positives", () => {
    assert.ok(
      fordertSabotage(lensSkill),
      "Der Test-Adäquanz-Auftrag im Skill hat den Sabotage-/Red-Green-Schritt verloren. Das Ticket #1034 nennt " +
        "ihn ausdrücklich als das, was die Kontext-Diät NICHT treffen darf — er fand in der " +
        "Messsession den einzigen echten Blocker.",
    );
  });

  test("der tool-neutrale Skill dokumentiert Materialisierung und Commit-Pflicht", () => {
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
  // Prädikat aufgeweicht, fällt hier sein eigener Gegenbeweis.

  test("nenntPatchDatei verlangt Benennung UND Dateiendung", () => {
    assert.ok(nenntPatchDatei("Die Patch-Datei liegt unter x-1-r1.patch"));
    assert.ok(!nenntPatchDatei("Die Patch-Datei liegt irgendwo"), "ohne Dateiendung nicht grün");
    assert.ok(!nenntPatchDatei("x-1-r1.patch"), "ohne Benennung nicht grün");
  });

  test("haeltKontextDiaet fällt bei ausgehöhltem Baustein", () => {
    assert.ok(haeltKontextDiaet("AGENTS.md liegt bereits vollständig in deinem Kontext — greppe punktuell."));
    assert.ok(!haeltKontextDiaet("Lies AGENTS.md und CLAUDE.md vollständig."), "alte Fassung muss rot sein");
    assert.ok(!haeltKontextDiaet("Es liegt bereits im Kontext."), "ohne Grep-Anweisung nicht grün");
  });

  test("hatRundenNummer und istDreiPunkt fallen bei Zwei-Punkt und fehlender Runde", () => {
    assert.ok(hatRundenNummer('git diff origin/main...HEAD > "$TMP/x-<nr>-r<runde>.patch"'));
    assert.ok(!hatRundenNummer('git diff origin/main...HEAD > "$TMP/x-<nr>.patch"'), "ohne Runde rot");
    assert.ok(istDreiPunkt("git diff origin/main...HEAD > \"$TMP/x.patch\""));
    assert.ok(!istDreiPunkt("git diff main > \"$TMP/x.patch\""), "Zwei-Punkt gegen main rot");
  });

  test("fordertSabotage fällt, wenn der Schritt entschärft wird", () => {
    assert.ok(fordertSabotage("sabotiere die Assertion kurz, sieh rot, setze zurück"));
    assert.ok(!fordertSabotage("prüfe die Assertion kritisch"), "entschärfte Fassung muss rot sein");
  });
});

// ── Lens-Worktree und Blocker-Maßstab (#1316) ───────────────────────────────────
describe("Sabotage im eigenen Lens-Worktree, Fixes erst nach allen Berichten (#1316 Z3)", () => {
  const harness = read("docs/agent-harness.md");
  const umsetzer = liesMitProjektwerten(".claude/agents/factory-umsetzer.md");
  /** Der Lens-Worktree ist in Definition und Skill beschrieben (Pfadmuster, Detach, Entfernen). */
  const beschreibtLensWorktree = (s: string) => new RegExp(`${WT}<nr>-lens-r<runde>`).test(s) && /worktree add --detach/.test(s) && /worktree remove --force/.test(s);

  test("die Lens-Definition verlangt die Sabotage im Lens-Worktree, nie im Feature-Worktree", () => {
    assert.ok(beschreibtLensWorktree(lensAgent), "factory-lens.md beschreibt den Lens-Worktree nicht");
    assert.match(lensAgent, /nie im Feature-Worktree/);
    assert.match(lensAgent, /Test-Path/);
  });

  test("der Skill: keine falsche Aussage mehr, Lens-Worktree und Nachbessern erst nach allen Berichten", () => {
    assert.ok(!/Der Workflow hat das Problem nicht/.test(lensSkill), "die falsche Aussage steht noch im Skill");
    assert.ok(beschreibtLensWorktree(lensSkill), "SKILL.md beschreibt den Lens-Worktree nicht");
    assert.match(lensSkill, /alle Berichte der Runde da sind/);
  });

  test("Umsetzer und Harness-Doku ziehen mit", () => {
    assert.match(umsetzer, new RegExp(`${WT}<nr>-lens-\\*`));
    assert.ok(!/keine gemeinsame Datei/.test(harness), "agent-harness.md §2.5 behauptet weiter, die Lenses teilten nichts");
    assert.match(harness, /eigenen Lens-Worktree/);
  });

  test("der Wächter schlägt an, wenn eine Stelle die Regel verliert", () => {
    assert.ok(!beschreibtLensWorktree(lensAgent.replace("worktree remove --force", "worktree remove")));
    assert.ok(!beschreibtLensWorktree(lensAgent.replace("--detach", "")));
  });
});

describe("Blocker-Maßstab für Guard-/Parser-Code (#1316 Z4)", () => {
  const harness = read("docs/agent-harness.md");
  /** Der Maßstab trennt Verstöße/Regressionen (blockierend) von neuen Umwegen („Bekannte Grenze“). */
  const hatMassstab = (s: string) => /Blocker-Maßstab/.test(s) && /Regression/.test(s) && /Bekannte Grenze/.test(s) && /Akzeptanzkriterien/.test(s);

  test("Lens-Definition, Harness-Doku und Skill tragen den Maßstab", () => {
    assert.ok(hatMassstab(lensAgent), "factory-lens.md hat den Abschnitt Blocker-Maßstab verloren");
    assert.ok(hatMassstab(harness), "agent-harness.md §4 hat den Blocker-Maßstab verloren");
    assert.match(lensSkill, /Blocker-Maßstab/);
  });

  test("ein neuer Umweg ist kein Blocker: der Text sagt es ausdrücklich", () => {
    assert.match(lensAgent, /neu gefundener Umweg[\s\S]{0,200}kein Blocker/);
  });

  test("hatMassstab fällt, wenn ein Kernbegriff fehlt", () => {
    assert.ok(!hatMassstab(lensAgent.replace(/Regression/g, "Fehler")));
    assert.ok(!hatMassstab(lensAgent.replace(/Bekannte Grenze/g, "Hinweis")));
  });
});
