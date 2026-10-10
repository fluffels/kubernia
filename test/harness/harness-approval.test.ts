/* Harness-Wächter für Leitplanken-Pfade (#1012, Regel seit #1069, Audit-Spur statt Label seit #1303).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Kubernia mergt autonom. Leitplanken-Änderungen (Selbstmodifikation) waren bis #1069 ein
 * Pflicht-Stopp; seitdem mergt der Agent bei der intendierten Änderung seines Tickets selbst und
 * hinterlässt einen Audit-Kommentar (ADR 0014: kein CI-Riegel, keine Label-Pflicht mehr). Dieser
 * Wächter deckt die Fehlklassen ab, die diese Regel leise aushöhlen:
 *
 *   1. **Die portable Regel verschwindet.** Die Verhaltensregel (Pre-Flight-Klärung + Audit-
 *      Kommentar nach dem Selbst-Merge) lebt tool-neutral in AGENTS.md. Wird sie umformuliert bis
 *      der Marker fehlt, liest ein fremder Agent (der nur AGENTS.md kennt) sie nicht mehr.
 *   2. **Die Pfadlisten driften auseinander.** Die geschützten Pfade stehen genau einmal in
 *      `.github/protected-paths.json`; der Workflow-Auftrag `beruehrtHarness` gleicht per Substring
 *      gegen sie ab. `.github/CODEOWNERS` bleibt handgepflegt (GitHub kann keine Datei einbinden),
 *      ist nur noch informativ und wird hier gegen die Quelle geprüft.
 *   3. **Die abgelöste Label-Mechanik kehrt zurück.** Ein Scan über die versionierten Dateien
 *      (außer ADRs als Historie) hält fest, dass der frühere CI-Riegel samt Label nirgends mehr
 *      vorkommt – weder als Workflow noch als Anleitung in Doku und Prompts.
 *
 * Zusätzlich wird geprüft, dass die Quelle die Leitplanken-Dateien (über die reine Gate-Config
 * hinaus: AGENTS.md, CLAUDE.md, CLAUDE.local.md, .claude/, .agents/, docs/agent-harness) wirklich
 * enthält – sonst wäre die Regel dokumentiert, aber die Erkennung liefe ins Leere. Die Quelle
 * schützt auch die Wächter-Tests selbst (diese Datei eingeschlossen), und kein Eintrag darf
 * pauschal den ganzen test/-Ordner sperren.
 *
 * Fitness-Function-Kategorie neben agents-md-native/docmap/readme (#1087/#482), nicht mit
 * Verhaltens-Tests vermischen. Bewusst **ohne** eigenes `scripts/check-*.mjs`: `scripts/check-`
 * ist selbst Gate-Config – für rein doku-/config-strukturelle Wächter gibt es die etablierte
 * test-only-Familie (Präzedenz: `test/harness/agents-md-native.test.ts`).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hookSkripte, lokaleImporteTransitiv } from "./hook-importe";
import { fileURLToPath } from "node:url";
import { AGENTEN_KONTEXT, baueVorfilter, lies, repoDateien, vorfilterProbleme } from "./repo-texte";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(WURZEL + rel, "utf8");

/**
 * Normalisiert einen geschützten Pfad auf seine Substring-Form: führenden `/` weg
 * (CODEOWNERS-Anker) und ab dem ersten Glob-`*` abschneiden. So werden die zwei
 * Schreibweisen vergleichbar – CODEOWNERS `/scripts/check-*.mjs` und der Substring-Abgleich
 * des Workflows (`beruehrtHarness`) landen beide auf `scripts/check-`.
 */
function normalizeProtected(p: string): string {
  return p.replace(/^\//, "").replace(/\*.*$/, "");
}


/** Die geschützten Pfade aus `.github/CODEOWNERS` (jeweils vor dem `@owner`). */
function codeownersPaths(text: string): Set<string> {
  const set = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)\s+@\S+/);
    if (m) set.add(normalizeProtected(m[1]));
  }
  return set;
}

/** Die Quelle der geschützten Pfade (#1157): Gruppe → Pfade in CODEOWNERS-Schreibweise. */
type ProtectedSource = Record<string, string[]>;

/** Alle Pfade der Quelle in Substring-Form – dieselbe Abbildung, die der Substring-Abgleich des Workflows vornimmt. */
function sourcePaths(src: ProtectedSource): Set<string> {
  return new Set(Object.values(src).flat().map(normalizeProtected));
}

/**
 * Leitplanken-Dateien, die über die reine Gate-Config hinaus als auditpflichtig gelten
 * (Ticket #1012 / Maintainerin-Entscheidung „breit"). In Substring-Form – so wie
 * die Quelle sie nach der Normalisierung führen muss.
 */
// CLAUDE.md bleibt geschützt, obwohl sie seit #1087 gelöscht ist: ihre Wiederanlage würde
// AGENTS.md als geladene SSOT verdrängen und muss darum auditpflichtig sein.
// Dasselbe gilt für CLAUDE.local.md (#1116) – der Abgleich matcht per Substring, `CLAUDE.md` trifft sie nicht.
const LEITPLANKEN = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", ".claude/", ".mcp.json", "scripts/playwright-mcp.mjs", ".agents/", "docs/agent-harness"];

/**
 * Wächter-Tests, die selbst der EINZIGE Durchsetzer ihrer Regel sind (#1156) – ohne eigenes,
 * schon geschütztes `scripts/check-*.mjs` dahinter. Liefen sie ungeschützt, könnte ein PR den
 * Wächter ohne Audit-Spur still abschwächen. Seit #1165 liegen sie alle in EINEM Ordner,
 * der als echtes Präfix geschützt ist: ein neuer Wächter braucht damit keinen eigenen Eintrag mehr
 * (vorher vier: Quelle, CODEOWNERS, diese Liste, Prosa). Ein Präfix statt eines Globs, weil
 * `normalizeProtected` jedes Glob ab dem `*` kürzt (`/test/*harness*` → `test/`).
 * Tests mit geschütztem check-Skript dahinter (filesize, docmap, diffsize, …) gehören nicht hierher.
 */
const WAECHTER_ORDNER = "test/harness/";

/**
 * Marker im Dateikopf jedes Wächter-Tests (#1165). Erst er macht den Ordner prüfbar: ohne ihn hieße
 * „vier Einträge vergessen" nur noch „den Ordner vergessen" – ein neuer Wächter direkt unter test/
 * wäre wieder still ungeschützt. Erkannt nur als eigene Kommentar-Zeile (` * @harness-waechter`),
 * damit eine Erwähnung im Fließtext oder Code nicht zählt. Grenze: ein Wächter, der weder Marker
 * noch Ordner bekommt, bleibt unsichtbar – die Regel senkt die Vergess-Stellen von vier auf eine.
 */
const WAECHTER_MARKER = /^\s*(?:\/\*+|\*)?\s*@harness-waechter(?![\w-])/m;

/** Alle `*.test.ts` unter `test/` (rekursiv), relativ zum Repo-Root mit `/`. */
function testDateien(): string[] {
  const wurzel = fileURLToPath(new URL("../../", import.meta.url));
  return readdirSync(join(wurzel, "test"), { recursive: true, encoding: "utf8" })
    .map((f) => `test/${f.replace(/\\/g, "/")}`)
    .filter((f) => f.endsWith(".test.ts"));
}

/**
 * Bewusst tiefen-unabhängige Einträge (#1168): ohne führenden `/` schützen sie die Datei auf JEDER
 * Ebene – in CODEOWNERS (gitignore-Semantik) genauso wie im Substring-Abgleich. Jede modul-lokale
 * AGENTS.md (#1088) ist eine Agenten-Anweisung und damit Leitplanke. Geschlossene Liste: jeder
 * andere unverankerte Eintrag bleibt ein Fehler.
 */
const TIEFENUNABHAENGIG = ["AGENTS.md"];

/**
 * Deckt ein normalisierter Schutz-Eintrag den ganzen test/-Ordner ab? Das gilt für `test/` selbst,
 * jedes kürzere Präfix davon (`t`, aus `/t*`) und den Leer-String (aus `/*.test.ts` oder `/**`).
 */
function decktTestOrdnerAb(p: string): boolean {
  return "test/".startsWith(p);
}

/**
 * Marker der portablen Regeln in AGENTS.md. Bewusst wording-gekoppelt (wie readme.test.ts die
 * Quest-Zahl): die Regel darf umformuliert werden, aber der tragende Begriff muss stehen bleiben,
 * sonst findet ihn ein fremder Agent nicht mehr.
 */
const AGENTS_MARKER = [
  ".github/protected-paths.json", // die geschlossene Liste der Leitplanken-Pfade (ADR 0014)
  "@harness-waechter", // die Regel für neue Wächter-Tests (Marker im Kopf)
  "Human-in-the-Loop", // der Checkpoint-Regel-Bullet (Pre-Flight-Klärung)
  "Leitplanken-Änderung selbst gemergt", // Audit-Kommentar-Pflicht nach dem Selbst-Merge (#1069)
  "Mehr-Perspektiven-Review", // die erzwungene Review-Konvergenzschleife vor dem Merge
];

const codeowners = read(".github/CODEOWNERS");
const QUELLE = ".github/protected-paths.json";
const quelle = JSON.parse(read(QUELLE)) as ProtectedSource;
const agentsMd = read("AGENTS.md");
const ticketWf = read(".claude/workflows/kubernia-ticket.js");

describe("Harness-Freigabe – eine Quelle, die Artefakte folgen ihr (#1012, #1157)", () => {
  test("die Quelle ist eine nicht-leere Gruppe→Pfade-Liste in CODEOWNERS-Schreibweise", () => {
    const gruppen = Object.entries(quelle);
    assert.ok(gruppen.length > 0, `${QUELLE} ist leer`);
    for (const [gruppe, pfade] of gruppen) {
      assert.ok(Array.isArray(pfade) && pfade.length > 0, `${QUELLE}: Gruppe '${gruppe}' ist keine nicht-leere Liste`);
      for (const p of pfade) {
        assert.match(p, /^\S+$/, `${QUELLE}: '${p}' enthält Leerraum`);
        assert.ok(
          p.startsWith("/") || TIEFENUNABHAENGIG.includes(p),
          `${QUELLE}: '${p}' muss wie in CODEOWNERS mit '/' beginnen oder bewusst tiefen-unabhängig sein (#1168)`,
        );
        // Der Abgleich verwirft leere Muster – ein Eintrag wie '/*' fiele sonst still aus dem Schutz.
        assert.notEqual(normalizeProtected(p), "", `${QUELLE}: '${p}' normalisiert zu einem leeren Muster`);
      }
    }
  });

  test("CODEOWNERS schützt genau die Pfade der Quelle", () => {
    assert.deepEqual(
      [...codeownersPaths(codeowners)].sort(),
      [...sourcePaths(quelle)].sort(),
      `.github/CODEOWNERS und ${QUELLE} sind auseinandergelaufen – neue Leitplanken in der Quelle eintragen ` +
        "und die CODEOWNERS-Zeile nachziehen (GitHub kann CODEOWNERS nicht aus einer Datei einbinden).",
    );
  });

  test("die Quelle schützt sich selbst", () => {
    // Sonst streicht ein PR still einen Pfad aus der Quelle, ohne dass der Audit-Kommentar fällig wird.
    assert.ok(sourcePaths(quelle).has(QUELLE), `${QUELLE} fehlt in sich selbst`);
  });

  test("die Quelle deckt die Leitplanken-Dateien ab (nicht nur Gate-Config)", () => {
    const sp = sourcePaths(quelle);
    const fehlend = LEITPLANKEN.filter((p) => !sp.has(p));
    assert.deepEqual(
      fehlend,
      [],
      "Leitplanken-Dateien fehlen in der Quelle (#1012/#1069: Harness-Änderungen sind auditpflichtig):\n" +
        fehlend.join("\n"),
    );
  });

  test("jede AGENTS.md ist geschützt, auch modul-lokale – in Quelle UND CODEOWNERS (#1168)", () => {
    // Der Sync-Test oben fängt das nicht: `/AGENTS.md` und `AGENTS.md` normalisieren beide auf
    // `AGENTS.md`. Der Substring-Abgleich trifft modul-lokale Dateien schon immer, CODEOWNERS
    // (root-verankert) nicht – darum der Anker-Test auf die rohe Schreibweise.
    const roh = Object.values(quelle).flat();
    assert.ok(roh.includes("AGENTS.md"), `${QUELLE}: tiefen-unabhängiger Eintrag 'AGENTS.md' fehlt`);
    assert.ok(!roh.includes("/AGENTS.md"), `${QUELLE}: '/AGENTS.md' ist root-verankert und trifft in CODEOWNERS keine modul-lokale AGENTS.md`);
  });

  test("CODEOWNERS spiegelt die Anker-Form der Quelle: unverankert genau die tiefen-unabhängigen Einträge (#1168)", () => {
    // Der Sync-Test vergleicht normalisierte Mengen und sieht '/X' vs. 'X' nicht – hier die rohe Form.
    const roh = codeowners
      .split(/\r?\n/)
      .map((l) => l.trim().match(/^(\S+)\s+@\S+/)?.[1])
      .filter((p): p is string => p !== undefined);
    const unverankert = roh.filter((p) => !p.startsWith("/")).sort();
    assert.deepEqual(unverankert, [...TIEFENUNABHAENGIG].sort(), "CODEOWNERS: Anker-Form weicht von der Quelle ab (#1168)");
  });

  test("die Quelle schützt den Wächter-Ordner als Präfix (#1156, #1165)", () => {
    assert.ok(
      sourcePaths(quelle).has(WAECHTER_ORDNER),
      `${QUELLE}: '/${WAECHTER_ORDNER}' fehlt – sonst lässt sich der Wächter ohne Audit-Spur abschwächen`,
    );
  });

  test("kein Eintrag schützt pauschal den ganzen test/-Ordner (#1156)", () => {
    // Ein Muster wie /test/*harness*.test.ts normalisiert auf `test/` – dann wäre jeder PR mit
    // Teständerung auditpflichtig, und ein immer nötiger Audit-Kommentar markiert nichts mehr (Audit-Fatigue).
    const alle = [...sourcePaths(quelle), ...codeownersPaths(codeowners)];
    assert.deepEqual(
      alle.filter(decktTestOrdnerAb),
      [],
      `Ein Schutz-Eintrag deckt den ganzen test/-Ordner ab – Wächter-Tests stattdessen nach ${WAECHTER_ORDNER} legen (#1156, #1165)`,
    );
  });

  test("der Wächter-Ordner existiert und ist nicht leer (#1165)", () => {
    // Nach einem Umbenennen/Leeren stünde sonst ein verwaister Präfix in der Quelle – grün, aber ohne Schutz.
    const drin = testDateien().filter((f) => f.startsWith(WAECHTER_ORDNER));
    assert.ok(existsSync(fileURLToPath(new URL(`../../${WAECHTER_ORDNER}`, import.meta.url))), `${WAECHTER_ORDNER} fehlt`);
    assert.ok(drin.length > 0, `${WAECHTER_ORDNER} enthält keine Tests`);
  });

  test("jeder Test mit @harness-waechter liegt in test/harness/ – und jeder dort trägt den Marker (#1165)", () => {
    const falsch: string[] = [];
    for (const f of testDateien()) {
      const markiert = WAECHTER_MARKER.test(read(f));
      const imOrdner = f.startsWith(WAECHTER_ORDNER);
      if (markiert && !imOrdner) falsch.push(`${f}: trägt @harness-waechter, liegt aber außerhalb von ${WAECHTER_ORDNER} (ungeschützt)`);
      if (!markiert && imOrdner) falsch.push(`${f}: liegt in ${WAECHTER_ORDNER}, aber ohne @harness-waechter im Kopf`);
    }
    assert.deepEqual(falsch, [], `Wächter-Tests falsch abgelegt (#1165):\n${falsch.join("\n")}`);
  });


  test("der Ticket-Workflow führt keine Spiegel-Liste mehr, sondern verweist auf die Quelle", () => {
    assert.doesNotMatch(ticketWf, /HARNESS_PFADE/, "kubernia-ticket.js führt wieder eine eigene Pfadliste (HARNESS_PFADE)");
    assert.ok(ticketWf.includes(QUELLE), `kubernia-ticket.js verweist im Umsetzungs-Prompt nicht auf ${QUELLE}`);
  });
});

describe("Harness-Wächter – die portable Regel steht in AGENTS.md (#1012)", () => {
  test("AGENTS.md nennt die Human-in-the-Loop-Checkpoints, die Pfadquelle und den erzwungenen Review", () => {
    const fehlend = AGENTS_MARKER.filter((m) => !agentsMd.includes(m));
    assert.deepEqual(
      fehlend,
      [],
      "In AGENTS.md fehlen die tragenden Regel-Marker (#1012). Ein fremder Agent kennt nur AGENTS.md – " +
        `ohne diese Begriffe findet er die Regel nicht:\n${fehlend.join("\n")}`,
    );
  });
});

describe("Erkennung greift wirklich (Red-Green, #1012)", () => {
  test("Normalisierung führt beide Schreibweisen zusammen", () => {
    assert.equal(normalizeProtected("/scripts/check-*.mjs"), "scripts/check-");
    assert.equal(normalizeProtected("scripts/check-"), "scripts/check-");
    assert.equal(normalizeProtected("/.github/workflows/*.yml"), ".github/workflows/");
    assert.equal(normalizeProtected("/AGENTS.md"), "AGENTS.md");
  });

  test("Parser lesen echte Listen und ignorieren Kommentare/Leerzeilen", () => {
    assert.deepEqual(
      [...codeownersPaths("# Kopf\n\n/foo.js   @fluffels\n/bar/*.yml  @fluffels")].sort(),
      ["bar/", "foo.js"],
    );
    assert.deepEqual([...sourcePaths({ gate: ["/a.js", "/c/*.yml"], harness: ["/b/"] })].sort(), ["a.js", "b/", "c/"]);
  });

  test("CLAUDE.md deckt CLAUDE.local.md im Substring-Abgleich NICHT mit ab (#1116)", () => {
    // Der Grund für den eigenen Eintrag: der Abgleich matcht per Substring auf den geänderten Pfad.
    assert.equal("CLAUDE.local.md".includes("CLAUDE.md"), false);
  });

  test("der unverankerte AGENTS.md-Eintrag ist für den Abgleich verhaltensneutral (#1168)", () => {
    // Beide Schreibweisen ergeben dasselbe Muster, und es trifft Modul-Dateien.
    assert.equal(normalizeProtected("AGENTS.md"), normalizeProtected("/AGENTS.md"));
    assert.equal("src/content/AGENTS.md".includes(normalizeProtected("AGENTS.md")), true);
    assert.equal(decktTestOrdnerAb(normalizeProtected("AGENTS.md")), false);
    // Darum sieht der Sync-Test den Unterschied nie – der Anker-Test auf die rohe Schreibweise ist nötig.
    assert.deepEqual([...codeownersPaths("/AGENTS.md @fluffels")], [...codeownersPaths("AGENTS.md @fluffels")]);
  });

  test("ein nur in der Quelle ergänzter Pfad würde als Drift auffallen", () => {
    // Beweist, dass der Sync-Test nicht immer grün ist: fehlt ein Pfad in CODEOWNERS, kippt der Vergleich.
    const co = codeownersPaths("/AGENTS.md  @fluffels");
    const sp = sourcePaths({ harness: ["/AGENTS.md", "/CLAUDE.md"] });
    assert.notDeepEqual([...co].sort(), [...sp].sort());
  });

  test("ein Glob-Muster für Tests würde auf den ganzen test/-Ordner kürzen (#1156)", () => {
    // Belegt, warum der Wächter-Ordner als Präfix statt als Glob eingetragen ist (#1165) – und dass
    // der Negativ-Wächter oben ein solches Muster wirklich fängt. Feste Literale.
    assert.equal(normalizeProtected("/test/*harness*.test.ts"), "test/");
    assert.equal(normalizeProtected("/test/harness/"), "test/harness/");
  });

  test("der test/-Pauschal-Filter fängt auch breitere Muster, aber keine Einzelpfade (#1156)", () => {
    for (const muster of ["/test/*x*", "/test", "/t*", "/*.test.ts", "/**"]) {
      assert.equal(decktTestOrdnerAb(normalizeProtected(muster)), true, `nicht erkannt: ${muster}`);
    }
    for (const einzeln of ["/test/agents-md-native.test.ts", `/${WAECHTER_ORDNER}`, "/.claude/", "/AGENTS.md", "/tests-x/"]) {
      assert.equal(decktTestOrdnerAb(normalizeProtected(einzeln)), false, `fälschlich erkannt: ${einzeln}`);
    }
  });
});

describe("Der @harness-waechter-Marker zählt nur als eigene Kommentar-Zeile (#1165)", () => {
  test("Kopf-Zeilen werden erkannt", () => {
    for (const kopf of [" * @harness-waechter", "/* @harness-waechter */", "/** @harness-waechter", "// x\n * @harness-waechter (#1165)"]) {
      assert.match(kopf, WAECHTER_MARKER, `nicht erkannt: ${kopf}`);
    }
  });

  test("Erwähnungen in Fließtext oder Code zählen nicht", () => {
    for (const text of [" * siehe @harness-waechter im Kopf", 'const m = "@harness-waechter";', " * @harness-waechterX", " * @harness-waechter-alt", " * @harness-waechter_x"]) {
      assert.doesNotMatch(text, WAECHTER_MARKER, `fälschlich erkannt: ${text}`);
    }
  });
});

/**
 * Begriffe der abgelösten Label-Mechanik (ADR 0014, #1303): der frühere CI-Riegel samt Label, seine
 * Job-Bezeichnung (Required-Check-Kontext im Ruleset) und der Pflicht-Begriff. In ADRs bleibt die
 * Historie stehen; sonst darf keine versionierte Datei sie mehr tragen.
 */
const ABGELOEST = [
  /maintainer-approved/i,
  /gate-change-guard/i,
  /Gate-Config-Aenderungsschutz/i,
  /Label-Pflicht/i,
  /Label selbst/i,
  /legt die Maintainerin fest/i,
  /Optik-Abstimmung/i,
  /Optik[^.\n]{0,60}(per|mit|braucht)[^.\n]{0,20}Rückfrage/i,
  /(Optik|Stil|Look)[^.\n]{0,40}mit der Maintainerin abstimmen/i,
  /(was|wie) in (\*\*)?einen(\*\*)? PR pass(t|en)/i,
  /Rest und neue Befunde ins nächste Sammelticket/i,
  /zweite Hälfte[^.\n]{0,80}(Sammelticket|übertrag)/i,
  /erste Hälfte[^.\n]{0,80}(PR|Sammelticket)/i,
];
/**
 * Eine Alternation über alle Muster: die meisten Dateien treffen keins, dann entfallen die Einzelläufe. Lässt sie sich nicht
 * sicher bauen (abweichende Flags, Rückverweise), ist der Vorfilter `null` und jedes Muster läuft einzeln (fail-safe);
 * der Test „Vorfilter: Muster sind kombinierbar“ meldet das als Rot, damit niemand unbemerkt langsamer wird.
 */
const ABGELOEST_VORFILTER = baueVorfilter(ABGELOEST);
const SCAN_ENDUNGEN = /\.(md|js|mjs|cjs|ts|json|yml|yaml)$/;
const EIGENE_DATEI = "test/harness/harness-approval.test.ts";

/**
 * Alle versionierten Textdateien im Agenten-Kontext (Pfad → Inhalt), die die Text-Wächter unten durchsuchen: Doku, Prompts,
 * Skills, Workflows, Hooks, Skripte, Wächter und jede `*.md`, nicht der Spiel-Code (Umfang: `AGENTEN_KONTEXT`). Einmal je
 * Testdatei geladen und geteilt: die Dateiliste und die Inhalte kommen aus dem gecachten Scan-Helfer.
 */
function agentenKontextDateien(): Record<string, string> {
  const dateien: Record<string, string> = {};
  for (const f of repoDateien().filter(AGENTEN_KONTEXT)) {
    if (SCAN_ENDUNGEN.test(f) || f === ".github/CODEOWNERS") dateien[f] = lies(f);
  }
  return dateien;
}

/** Fundstellen der abgelösten Begriffe; ADRs (Historie) und diese Wächterdatei zählen nicht. */
function abgeloesteFundstellen(dateien: Record<string, string>): string[] {
  const funde: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (pfad.startsWith("docs/adr/") || pfad === EIGENE_DATEI) continue;
    if (ABGELOEST_VORFILTER && !ABGELOEST_VORFILTER.test(inhalt)) continue;
    for (const muster of ABGELOEST) if (muster.test(inhalt)) funde.push(`${pfad}: ${String(muster)}`);
  }
  return funde;
}

describe("Die abgelöste Label-Mechanik kommt nicht zurück (ADR 0014, #1303)", () => {
  test("der Guard-Workflow existiert nicht mehr", () => {
    assert.equal(existsSync(WURZEL + ".github/workflows/gate-change-guard.yml"), false);
  });

  test("die Fundstellen-Suche zählt Doku, aber weder ADRs noch den Wächter selbst (Red-Green)", () => {
    const text = "setze das Label maintainer-approved";
    assert.equal(abgeloesteFundstellen({ "docs/agent-harness.md": text }).length, 1);
    assert.equal(abgeloesteFundstellen({ "docs/adr/0012-x.md": text, [EIGENE_DATEI]: text }).length, 0);
    assert.equal(abgeloesteFundstellen({ "README.md": "harmlos" }).length, 0);
  });

  test("keine versionierte Datei des Agenten-Kontexts außerhalb von docs/adr/ nennt Label, Guard oder veraltete HITL-/Sammelticket-Aussagen", () => {
    const dateien = agentenKontextDateien();
    assert.ok(Object.keys(dateien).length > 50, "Scan liest kaum Dateien – listTrackedFiles liefert nichts?");
    assert.deepEqual(abgeloesteFundstellen(dateien), [], "Abgelöste Mechanik taucht wieder auf (ADR 0014, #1279, #1311)");
  });

  test("Red-Green: die veralteten HITL- und Sammelticket-Aussagen werden erkannt, die gültigen nicht", () => {
    for (const alt of [
      "Die Optik legt die Maintainerin fest.",
      "Eine Optik-Abstimmung per Rückfrage vor dem Code.",
      "Optik braucht eine Rückfrage an die Maintainerin.",
      "Den Stil mit der Maintainerin abstimmen.",
      "Abarbeiten: so viele Zeilen, wie in einen PR passen.",
      "Abarbeiten, was in **einen** PR passt",
      "Rest und neue Befunde ins nächste Sammelticket.",
      "die zweite Hälfte der Zeilen ins nächste Sammelticket übertragen",
      "die erste Hälfte vollständig in einem PR erledigen",
    ]) {
      assert.ok(abgeloesteFundstellen({ "docs/x.md": alt }).length >= 1, alt);
    }
    for (const gueltig of [
      "Weichen (Optik, riskant) entscheidet der Agent selbst, die Maintainerin widerspricht per Revert.",
      "Optik wird an docs/stardew-referenz.md gemessen.",
      "Das Sammelticket wird komplett umgesetzt, kein Rest-Übertrag.",
    ]) {
      assert.equal(abgeloesteFundstellen({ "docs/x.md": gueltig }).length, 0, gueltig);
    }
  });
});

/** Die Kriterien des Pflicht-Stopps stehen nur in AGENTS.md; alle anderen Stellen verweisen darauf (#1311). */
const KRITERIEN = [/Ruleset\/Secrets\/Repo-Einstellungen/, /am Ruleset, an Secrets/, /Löschen, Ruleset/];

const KRITERIEN_VORFILTER = baueVorfilter(KRITERIEN);

/** Fundstellen der ausgeschriebenen Kriterienliste außerhalb von AGENTS.md; ADRs (Historie) und diese Datei zählen nicht. */
function kriterienKopien(dateien: Record<string, string>): string[] {
  const funde: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (pfad === "AGENTS.md" || pfad.startsWith("docs/adr/") || pfad === EIGENE_DATEI) continue;
    if (KRITERIEN_VORFILTER && !KRITERIEN_VORFILTER.test(inhalt)) continue;
    for (const muster of KRITERIEN) if (muster.test(inhalt)) funde.push(`${pfad}: ${String(muster)}`);
  }
  return funde;
}

describe("Scan-Vorfilter und Scan-Umfang (#1526)", () => {
  test("Vorfilter: Muster sind kombinierbar (ABGELOEST, KRITERIEN)", () => {
    assert.deepEqual(vorfilterProbleme(ABGELOEST), [], "ABGELOEST nur mit gleichen Flags und ohne Rückverweise");
    assert.deepEqual(vorfilterProbleme(KRITERIEN), [], "KRITERIEN nur mit gleichen Flags und ohne Rückverweise");
    assert.ok(ABGELOEST_VORFILTER, "Vorfilter über ABGELOEST baubar");
    assert.ok(KRITERIEN_VORFILTER, "Vorfilter über KRITERIEN baubar");
  });

  test("Red-Green: Rückverweise, gemischte Flags und Bau-Fehler werden gemeldet, schlichte Muster nicht", () => {
    assert.equal(vorfilterProbleme([/(a)\1/i]).length, 1, "Rückverweis \\1");
    assert.equal(vorfilterProbleme([/(?<x>a)\k<x>/i]).length, 1, "benannter Rückverweis");
    assert.equal(vorfilterProbleme([/a/i, /b/]).length, 1, "gemischte Flags");
    assert.equal(vorfilterProbleme([/a/gi, /b/gi]).length, 2, "g macht .test() zustandsbehaftet");
    assert.equal(vorfilterProbleme([/a/iy, /b/iy]).length, 2, "y ebenso");
    const kaputt = { source: "(", flags: "i" } as RegExp; // einzeln nie entstehbar, die Alternation wäre nicht baubar
    assert.equal(vorfilterProbleme([kaputt]).length, 1, "Alternation nicht baubar");
    assert.deepEqual(vorfilterProbleme([/a\\1/i]), [], "maskierter Backslash vor der Ziffer ist kein Rückverweis");
    assert.deepEqual(vorfilterProbleme([/a/i, /b[^.\n]{0,5}c/i]), []);
    assert.equal(baueVorfilter([/(a)\1/i]), null, "ohne sichere Alternation kein Vorfilter (fail-safe: alle Muster einzeln)");
    assert.ok(baueVorfilter([/a/i, /b/i])?.test("xB"));
  });

  test("Scan-Umfang: Agenten-Kontext ja (auch modul-lokale AGENTS.md), Spiel-Code und Spiel-Tests nein", () => {
    for (const drin of ["AGENTS.md", "src/content/AGENTS.md", ".github/workflows/x.yml", "docs/x.md", ".claude/skills/a/SKILL.md", "scripts/a.mjs", "test/harness/a.test.ts", "package.json"]) {
      assert.ok(AGENTEN_KONTEXT(drin), drin);
    }
    for (const draussen of ["src/sim/a.ts", "test/sim/b.test.ts", "assets/a.png", "package-lock.json"]) {
      assert.ok(!AGENTEN_KONTEXT(draussen), draussen);
    }
    assert.ok(agentenKontextDateien()["src/content/AGENTS.md"] !== undefined, "modul-lokale AGENTS.md wird gescannt");
  });
});

describe("Die Pre-Flight-Kriterien stehen nur in AGENTS.md (#1311)", () => {
  test("keine Kopie der Kriterienliste in Agenten, Skills, Workflow oder Doku", () => {
    assert.deepEqual(
      kriterienKopien(agentenKontextDateien()),
      [],
      "Die Liste „Löschen, Ruleset/Secrets/Repo-Einstellungen, Veröffentlichen/Forum“ steht nur in AGENTS.md § Human-in-the-Loop-Checkpoints; hier verweisen statt kopieren",
    );
    assert.ok(/Ruleset\/Secrets\/Repo-Einstellungen/.test(read("AGENTS.md")), "AGENTS.md trägt die Kriterien (die SSOT)");
  });

  test("Red-Green: eine Kopie außerhalb von AGENTS.md wird gemeldet, AGENTS.md und ADRs nicht", () => {
    const text = "Rückfrage nötig bei (Löschen, Ruleset/Secrets/Repo-Einstellungen, Veröffentlichen/Forum)";
    assert.equal(kriterienKopien({ ".claude/agents/kubernia-planner.md": text }).length, 2);
    assert.equal(kriterienKopien({ "AGENTS.md": text, "docs/adr/0012-x.md": text }).length, 0);
    assert.equal(kriterienKopien({ "x.md": "Kriterien: AGENTS.md § Human-in-the-Loop-Checkpoints" }).length, 0);
    assert.equal(kriterienKopien({ "x.js": "Ruleset und Secrets sind Außenwirkung" }).length, 0, "Erwähnung ohne die ausgeschriebene Liste");
    assert.equal(kriterienKopien({ "x.js": "etwas löschen, am Ruleset, an Secrets oder Repo-Einstellungen drehen" }).length, 1);
  });
});

// ── Hook-Abhängigkeiten sind geschützt (#1331) ───────────────────────────────

/** Skripte, die kein geschützter Eintrag der Quelle abdeckt (Präfix- oder Gleichheits-Vergleich). */
function ungeschuetzt(skripte: string[], src: ProtectedSource): string[] {
  const eintraege = [...sourcePaths(src)];
  return skripte.filter((s) => !eintraege.some((p) => p !== "" && s.startsWith(p)));
}

describe("Hook-Abhängigkeiten sind geschützt (#1331)", () => {
  test("jedes Hook-Skript und jeder lokale Import davon steht in der Quelle UND in CODEOWNERS", () => {
    const skripte = lokaleImporteTransitiv(hookSkripte(read(".claude/settings.json")), read);
    assert.ok(skripte.includes("scripts/worktree-aufraeumen.mjs"), "der Stop-Hook importiert worktree-aufraeumen.mjs");
    assert.ok(skripte.includes("scripts/umsetzer-abschluss.mjs"), "der Stop-Hook importiert umsetzer-abschluss.mjs");
    assert.deepEqual(ungeschuetzt(skripte, quelle), [], "nicht in .github/protected-paths.json");
    const owners = codeownersPaths(codeowners);
    assert.deepEqual(skripte.filter((s) => ![...owners].some((p) => p !== "" && s.startsWith(p))), [], "nicht in .github/CODEOWNERS");
  });

  test("jedes Gate-Skript (scripts/check-*.mjs) und jeder lokale Import davon ist geschützt (E1)", () => {
    const gates = readdirSync(join(WURZEL, "scripts"))
      .filter((f) => /^check-.*\.mjs$/.test(f))
      .map((f) => `scripts/${f}`);
    assert.ok(gates.length > 5, "die check-Skripte wurden gefunden");
    const skripte = lokaleImporteTransitiv(gates, read);
    assert.ok(skripte.includes("scripts/ci-laeufe.mjs"), "check-festgefahren.mjs importiert ci-laeufe.mjs");
    assert.ok(skripte.includes("scripts/docs-gen/markdown.mjs"), "check-docdrift.mjs importiert docs-gen/markdown.mjs (Unterordner)");
    assert.deepEqual(ungeschuetzt(skripte, quelle), [], "nicht in .github/protected-paths.json");
    const owners = codeownersPaths(codeowners);
    assert.deepEqual(skripte.filter((s) => ![...owners].some((p) => p !== "" && s.startsWith(p))), [], "nicht in .github/CODEOWNERS");
  });

  test("Red-Green: ein ungeschütztes Modul in der Importkette wird gefunden", () => {
    const lies = (rel: string) => (rel === "scripts/a.mjs" ? 'import { x } from "./b.mjs";' : rel === "scripts/b.mjs" ? 'import y from "./c.mjs";' : "");
    const kette = lokaleImporteTransitiv(["scripts/a.mjs"], lies);
    assert.deepEqual(kette, ["scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs"]);
    assert.deepEqual(ungeschuetzt(kette, { harness: ["/scripts/a.mjs", "/scripts/b.mjs"] }), ["scripts/c.mjs"]);
    // Unterordner und ../: relativ zur importierenden Datei aufgelöst (E1), nicht zu scripts/.
    const tief = (rel: string) =>
      rel === "scripts/a.mjs" ? 'import { x } from "./sub/b.mjs";' : rel === "scripts/sub/b.mjs" ? 'import y from "./c.mjs"; import z from "../d.mjs"; const e = require("../e.cjs");' : "";
    assert.deepEqual(lokaleImporteTransitiv(["scripts/a.mjs"], tief), ["scripts/a.mjs", "scripts/d.mjs", "scripts/e.cjs", "scripts/sub/b.mjs", "scripts/sub/c.mjs"]);
    assert.deepEqual(hookSkripte(JSON.stringify({ hooks: { Stop: [{ hooks: [{ args: ["${CLAUDE_PROJECT_DIR}/scripts/h.mjs"] }] }] } })), ["scripts/h.mjs"]);
  });

  test("Red-Green: Side-Effect-, dynamische und createRequire-Importe gehören zur Kette (Z12e)", () => {
    const formen: Record<string, string> = {
      "side-effect": 'import "./b.mjs";',
      dynamisch: 'const m = await import("./b.mjs");',
      "dynamisch mit Leerraum": 'await import( "./b.mjs" );',
      createRequire: 'const r = createRequire(import.meta.url); const x = createRequire(import.meta.url)("./b.cjs");',
    };
    for (const [name, quelltext] of Object.entries(formen)) {
      const kette = lokaleImporteTransitiv(["scripts/a.mjs"], (rel) => (rel === "scripts/a.mjs" ? quelltext : ""));
      assert.ok(kette.length === 2 && kette[1].startsWith("scripts/b."), `${name}: ${kette.join(", ")}`);
    }
    // Kein Fehlalarm: ein Paket-Import und ein Ausdruck mit Klammern ohne lokalen Pfad bleiben außen vor.
    assert.deepEqual(lokaleImporteTransitiv(["scripts/a.mjs"], () => 'import "node:fs"; const x = f(a)("text"); import("pkg");'), ["scripts/a.mjs"]);
  });
});
