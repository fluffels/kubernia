/* Harness-Freigabe-Wächter (#1012, Regel seit #1069) – Sign-off + Audit-Spur für Leitplanken-Diffs.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Kubernia mergt autonom. Leitplanken-Änderungen (Selbstmodifikation) waren bis #1069 ein
 * Pflicht-Stopp; seitdem setzt der Agent das Label `maintainer-approved` bei der intendierten
 * Änderung seines Tickets selbst, mergt und hinterlässt einen Audit-Kommentar. Dieser Wächter
 * deckt die zwei Fehlklassen ab, die diese Regel leise aushöhlen:
 *
 *   1. **Die portable Regel verschwindet.** Die Verhaltensregel (Pre-Flight-Klärung + Audit-
 *      Kommentar nach dem Selbst-Merge) lebt tool-neutral in AGENTS.md. Wird sie umformuliert bis
 *      der Marker fehlt, liest ein fremder Agent (der nur AGENTS.md kennt) sie nicht mehr.
 *   2. **Die Durchsetzungs-Artefakte driften von der Quelle weg.** Seit #1157 stehen die geschützten
 *      Pfade genau einmal in `.github/protected-paths.json`. Der CI-Riegel `gate-change-guard` liest
 *      sie zur Laufzeit vom **Base**-Commit (über die Quelle kann sich ein PR so nicht entschützen);
 *      `.github/CODEOWNERS` bleibt handgepflegt (GitHub kann keine Datei einbinden) und wird hier
 *      gegen die Quelle geprüft. Die frühere dritte Liste `HARNESS_PFADE` im Ticket-Workflow ist
 *      entfallen – die Workflow-Sandbox kann keine Dateien lesen, der Prompt verweist auf die Quelle.
 *
 * Zusätzlich wird geprüft, dass die Quelle die Leitplanken-Dateien (über die reine Gate-Config
 * hinaus: AGENTS.md, CLAUDE.md, CLAUDE.local.md, .claude/, .agents/, docs/agent-harness) wirklich
 * enthalten – sonst wäre die Regel dokumentiert, aber der Riegel liefe ins Leere. Seit #1156
 * schützt die Quelle auch die Wächter-Tests selbst (diese Datei eingeschlossen), und kein Eintrag
 * darf pauschal den ganzen test/-Ordner sperren.
 *
 * Fitness-Function-Kategorie neben agents-md-native/docmap/readme (#1087/#482), nicht mit
 * Verhaltens-Tests vermischen. Bewusst **ohne** eigenes `scripts/check-*.mjs`: `scripts/check-`
 * ist selbst gate-config-geschützt (Goodhart-Guard #903, Label-Pflicht) – für rein
 * doku-/config-strukturelle Wächter gibt es die etablierte test-only-Familie (Präzedenz:
 * `test/harness/agents-md-native.test.ts`).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/**
 * Normalisiert einen geschützten Pfad auf seine Substring-Form: führenden `/` weg
 * (CODEOWNERS-Anker) und ab dem ersten Glob-`*` abschneiden. So werden die zwei
 * Schreibweisen vergleichbar – CODEOWNERS `/scripts/check-*.mjs` und der
 * gate-change-guard.yml-Substring `scripts/check-` landen beide auf `scripts/check-`.
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

/** Alle Pfade der Quelle in Substring-Form – dieselbe Abbildung, die der Guard per jq vornimmt. */
function sourcePaths(src: ProtectedSource): Set<string> {
  return new Set(Object.values(src).flat().map(normalizeProtected));
}

/**
 * Leitplanken-Dateien, die über die reine Gate-Config hinaus den sichtbaren Sign-off tragen
 * (Ticket #1012 / Maintainerin-Entscheidung „breit"). In Substring-Form – so wie
 * die Quelle sie nach der Normalisierung führen muss.
 */
// CLAUDE.md bleibt geschützt, obwohl sie seit #1087 gelöscht ist: ihre Wiederanlage würde
// AGENTS.md als geladene SSOT verdrängen und muss darum die Label-Pflicht auslösen.
// Dasselbe gilt für CLAUDE.local.md (#1116) – der Guard matcht per Substring, `CLAUDE.md` trifft sie nicht.
const LEITPLANKEN = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", ".claude/", ".agents/", "docs/agent-harness"];

/**
 * Wächter-Tests, die selbst der EINZIGE Durchsetzer ihrer Regel sind (#1156) – ohne eigenes,
 * schon geschütztes `scripts/check-*.mjs` dahinter. Liefen sie ungeschützt, könnte ein PR den
 * Riegel ohne `maintainer-approved` still abschwächen. Seit #1165 liegen sie alle in EINEM Ordner,
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
 * damit eine Erwähnung im Fließtext oder Code nicht zählt.
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
 * Ebene – in CODEOWNERS (gitignore-Semantik) genauso wie im Substring-Guard. Jede modul-lokale
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
  "Human-in-the-Loop", // der Checkpoint-Regel-Bullet (Pre-Flight-Klärung)
  "Leitplanken-Änderung selbst gemergt", // Audit-Kommentar-Pflicht nach dem Selbst-Merge (#1069)
  "Mehr-Perspektiven-Review", // die erzwungene Review-Konvergenzschleife vor dem Merge
];

const codeowners = read(".github/CODEOWNERS");
const guardWf = read(".github/workflows/gate-change-guard.yml");
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
        // Der Guard verwirft leere Muster – ein Eintrag wie '/*' fiele sonst still aus dem Schutz.
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
    // Sonst streicht ein PR still einen Pfad aus der Quelle, ohne dass das Label fällig wird.
    assert.ok(sourcePaths(quelle).has(QUELLE), `${QUELLE} fehlt in sich selbst`);
  });

  test("die Quelle deckt die Leitplanken-Dateien ab (nicht nur Gate-Config)", () => {
    const sp = sourcePaths(quelle);
    const fehlend = LEITPLANKEN.filter((p) => !sp.has(p));
    assert.deepEqual(
      fehlend,
      [],
      "Leitplanken-Dateien fehlen im Sign-off-Riegel (#1012/#1069: Harness-Änderungen tragen das Label als sichtbaren Marker):\n" +
        fehlend.join("\n"),
    );
  });

  test("jede AGENTS.md ist geschützt, auch modul-lokale – in Quelle UND CODEOWNERS (#1168)", () => {
    // Der Sync-Test oben fängt das nicht: `/AGENTS.md` und `AGENTS.md` normalisieren beide auf
    // `AGENTS.md`. Der Guard traf modul-lokale Dateien per Substring schon immer, CODEOWNERS
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
      `${QUELLE}: '/${WAECHTER_ORDNER}' fehlt – sonst lässt sich der Wächter des Riegels ohne Label abschwächen`,
    );
  });

  test("kein Eintrag schützt pauschal den ganzen test/-Ordner (#1156)", () => {
    // Ein Muster wie /test/*harness*.test.ts normalisiert auf `test/` – dann bräuchte jeder PR mit
    // Teständerung das Label, und ein immer nötiges Label markiert nichts mehr (Label-Fatigue).
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

  test("der Guard führt keine eigene Pfadliste mehr, sondern liest die Quelle", () => {
    assert.doesNotMatch(guardWf, /PROTECTED=\(\s*'/, "gate-change-guard.yml führt wieder ein handgepflegtes PROTECTED-Array");
    assert.ok(guardWf.includes(`QUELLE=${QUELLE}`), `gate-change-guard.yml verweist nicht auf ${QUELLE}`);
  });

  test("der Guard liest die Quelle vom Base-Commit – über die Quelle kann sich ein PR nicht entschützen", () => {
    // Der Checkout ist der PR-Merge-Ref (Head-Inhalt). Läse der Guard nur die Arbeitskopie, könnte ein PR
    // die Quelle leeren und gleichzeitig eine Gate-Datei ändern – grün ohne Label.
    assert.match(guardWf, /git show "\$BASE_SHA:\$QUELLE"/, "Guard liest die Quelle nicht per git show vom BASE_SHA");
  });

  test("der Guard ist fail-closed: fehlende oder leere Base-Quelle macht jede Datei label-pflichtig", () => {
    assert.match(guardWf, /alles_geschuetzt=1/, "Guard hat keinen fail-closed-Zweig für eine fehlende/leere Base-Quelle");
  });

  test("der Guard leitet die Substring-Form genau wie normalizeProtected ab", () => {
    // jq-Filter im Guard und normalizeProtected hier müssen dieselbe Abbildung sein, sonst prüft der
    // CODEOWNERS-Sync etwas anderes, als der Guard matcht.
    assert.ok(
      guardWf.includes(String.raw`sub("^/"; "") | sub("\\*.*$"; "")`),
      "jq-Normalisierung im Guard weicht von normalizeProtected ab (führenden '/' weg, ab '*' abschneiden)",
    );
  });

  test("der Ticket-Workflow führt keine Spiegel-Liste mehr, sondern verweist auf die Quelle", () => {
    assert.doesNotMatch(ticketWf, /HARNESS_PFADE/, "kubernia-ticket.js führt wieder eine eigene Pfadliste (HARNESS_PFADE)");
    assert.ok(ticketWf.includes(QUELLE), `kubernia-ticket.js verweist im Umsetzungs-Prompt nicht auf ${QUELLE}`);
  });
});

describe("Der Guard-Workflow triggert auf Label-Änderung (#1015)", () => {
  test("gate-change-guard.yml reagiert auf labeled/unlabeled (sonst bleibt der Required-Check nach dem Label rot)", () => {
    // Kern-Deliverable von #1015: der ausgelagerte Guard MUSS zusätzlich auf
    // labeled/unlabeled triggern, damit das Setzen von 'maintainer-approved' den
    // Required-Check automatisch neu grün laufen lässt. Ohne diesen Wächter könnte
    // jemand `labeled` aus types entfernen und der Ticket-Zweck regressierte still
    // (alle anderen Tests blieben grün) – genau das „von außen grün, kein echter
    // Schutz"-Muster, das diese Fitness-Function-Familie adressiert.
    // Beide Trigger-Blöcke prüfen (#1167): auch pull_request_target muss aufs Label reagieren.
    for (const trigger of ["pull_request", "pull_request_target"]) {
      const m = guardWf.match(new RegExp(`\\n  ${trigger}:\\s*\\n\\s*types:\\s*\\[([^\\]]*)\\]`));
      assert.ok(m, `kein ${trigger}.types-Trigger in gate-change-guard.yml gefunden`);
      // Auch die Push-Events: fehlt z.B. synchronize, bliebe nach einem neuen Push ein altes Grün stehen.
      for (const typ of ["opened", "synchronize", "reopened", "labeled", "unlabeled"]) {
        assert.match(m[1], new RegExp(`\\b${typ}\\b`), `${trigger}: Trigger enthält '${typ}' nicht`);
      }
    }
  });
});

describe("Der Guard läuft aus der Base-Fassung, nicht aus dem PR (#1167)", () => {
  // Unter pull_request käme die Workflow-Definition aus dem PR-Merge-Ref: ein PR, der diese Datei
  // selbst ändert (z.B. `exit 0`), wäre im selben Lauf schon entschärft. pull_request_target nimmt
  // die Fassung von main. Phase 1 lässt pull_request als Übergang stehen (sonst meldet der
  // einführende PR den Required-Check nie – Deadlock), Phase 2 entfernt ihn.
  // Fehlt der Job-Schlüssel, liefe slice(-1) auf das letzte Zeichen – alle doesNotMatch-Tests wären still grün.
  const jobStart = guardWf.indexOf("\n  gate-change-guard:");
  const guardJob = guardWf.slice(Math.max(jobStart, 0));

  test("der Guard-Job wird gefunden (sonst prüfen die Negativfälle unten ins Leere)", () => {
    assert.ok(jobStart > 0, "Job-Schlüssel gate-change-guard: nicht gefunden");
  });

  test("der Guard triggert auf pull_request_target", () => {
    assert.match(guardWf, /\n {2}pull_request_target:\s*\n/, "gate-change-guard.yml triggert nicht auf pull_request_target");
  });

  test("der Job hat kein if: und kein continue-on-error (übersprungen bzw. geschluckt zählt als bestanden)", () => {
    // Ein per if: übersprungener Job meldet „skipped" – Branch-Protection wertet das als bestanden.
    // Jede Form zählt (if: false, != 'pull_request_target', an Job oder Step), darum gar kein if:.
    // continue-on-error schluckt das exit 1 des Label-Gates genauso still.
    assert.doesNotMatch(guardJob, /\n\s+(?:-\s+)?if:/, "Guard-Job oder ein Step hat ein if:");
    assert.doesNotMatch(guardJob, /continue-on-error/, "Guard-Job oder ein Step hat continue-on-error");
  });

  test("die Concurrency-Gruppe hängt an PR-Nummer + Event, nicht an github.ref", () => {
    // Unter pull_request_target ist github.ref = refs/heads/main für ALLE PRs: eine Gruppe mit
    // cancel-in-progress würde den Guard fremder PRs abbrechen. Das Event gehört mit hinein, damit
    // sich die beiden Übergangs-Trigger desselben PRs nicht gegenseitig canceln.
    const m = guardWf.match(/\n\s+group:\s*([^\n]+)/);
    assert.ok(m, "keine concurrency.group in gate-change-guard.yml");
    assert.doesNotMatch(m[1], /github\.ref\b/, "concurrency.group hängt an github.ref");
    assert.match(m[1], /github\.event\.pull_request\.number/, "concurrency.group enthält die PR-Nummer nicht");
    assert.match(m[1], /github\.event_name/, "concurrency.group enthält den Event-Namen nicht");
  });

  test("der Job hat minimale, rein lesende Permissions", () => {
    const m = guardJob.match(/\n {4}permissions:\s*\n((?: {6}[^\n]*\n)+)/);
    assert.ok(m, "Guard-Job hat keinen eigenen permissions:-Block (Default unter pull_request_target wäre schreibend)");
    assert.doesNotMatch(m[1], /\bwrite\b/, "Guard-Job hat schreibende Permissions");
  });

  test("es wird kein PR-Code ausgecheckt oder ausgeführt", () => {
    // Jedes ref: am Checkout (head.sha, github.head_ref, …) holte PR-Code als Arbeitskopie.
    assert.doesNotMatch(guardJob, /\n\s+ref:/, "Checkout setzt ein ref: – die Arbeitskopie muss die Base bleiben");
    assert.doesNotMatch(guardJob, /uses:\s*\.\//, "Guard-Job lädt eine lokale Action aus dem Repo");
    assert.doesNotMatch(guardJob, /git (checkout|switch|worktree)\b/, "Guard-Job checkt einen anderen Stand aus");
    assert.doesNotMatch(guardJob, /allow-unsafe-pr-checkout/, "unsicherer PR-Checkout ist erlaubt");
    assert.match(guardJob, /persist-credentials:\s*false/, "Checkout lässt das Token in der Git-Config liegen");
    assert.doesNotMatch(guardJob, /\b(npm|npx|node)\s|bash\s+\.?\/?[\w-]+\//, "Guard-Job führt Repo-Code aus");
  });

  test("der Head-Commit wird nachgeholt, falls er fehlt (Fork-PR unter pull_request_target)", () => {
    assert.match(guardJob, /git cat-file -e "\$HEAD_SHA\^\{commit\}"[^\n]*?(?:\\\r?\n\s*)?\|\|\s*git fetch[^\n]*refs\/pull\/\$PR_NUMBER\/head/, "kein Nachholen des PR-Heads");
  });

  test("der Job-Name bleibt wortgleich – der Required-Check-Kontext im Ruleset hängt daran (#984)", () => {
    assert.match(
      guardJob,
      /\r?\n {4}name: Gate-Config-Aenderungsschutz \(Goodhart-Guard, #903\)\r?\n/,
      "Job-Name geändert/gequotet – der Required-Check-Kontext im Ruleset main-schutz bricht",
    );
  });

  test("der Guard-Job hat genau einen run:-Block (das e2e-Skript unten extrahiert den ersten)", () => {
    assert.equal(guardJob.match(/\n {8}run: \|/g)?.length, 1, "mehr/weniger als ein run: |-Block im Guard-Job");
  });
});

describe("Harness-Freigabe – die portable Regel steht in AGENTS.md (#1012)", () => {
  test("AGENTS.md nennt die Human-in-the-Loop-Checkpoints und den erzwungenen Review", () => {
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

  test("CLAUDE.md deckt CLAUDE.local.md im Substring-Guard NICHT mit ab (#1116)", () => {
    // Der Grund für den eigenen Eintrag: der Guard matcht per Substring auf den geänderten Pfad.
    assert.equal("CLAUDE.local.md".includes("CLAUDE.md"), false);
  });

  test("der unverankerte AGENTS.md-Eintrag ist für den Guard verhaltensneutral (#1168)", () => {
    // Guard-Seite unverändert: beide Schreibweisen ergeben dasselbe Muster, und es trifft Modul-Dateien.
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

describe("Der Guard diffed gegen die Merge-Base, nicht gegen den main-Tip (#1095)", () => {
  /** Die `git diff …`-Argumente aus der `changed=$(git diff …)`-Zeile des Guards, mit eingesetzten SHAs. */
  function guardDiffArgs(wf: string, base: string, head: string): string[] {
    const m = wf.match(/changed=\$\(git diff ([^)]*)\)/);
    assert.ok(
      m,
      "changed=$(git diff …)-Zeile in gate-change-guard.yml nicht gefunden",
    );
    return [
      "diff",
      ...m[1]
        .replaceAll("$BASE_SHA", base)
        .replaceAll("$HEAD_SHA", head)
        .split(/\s+/)
        .filter(Boolean)
        .map((a) => a.replace(/^"|"$/g, "")),
    ];
  }

  test("ein nach dem Abzweigen auf main gemergter Harness-Commit zählt NICHT als PR-Änderung", () => {
    // Repro von PR #1093: der PR ändert nur Doku, auf main landet derweil eine .claude/-Änderung.
    // Mit Zwei-Punkt-Diff (base.sha = main-Tip) meldete der Guard die fremde Datei und blieb rot.
    const dir = mkdtempSync(join(tmpdir(), "kq-guard-"));
    // GIT_DIR & Co. aus einem umgebenden git-Hook (pre-push → verify) nicht erben –
    // sonst liefen die Fixture-Befehle gegen das echte Repo statt gegen `dir`.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|PREFIX)$/.test(k)),
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "t@example.invalid");
      git("config", "user.name", "t");
      git("config", "commit.gpgsign", "false");
      writeFileSync(join(dir, "README.md"), "x\n");
      git("add", ".");
      git("commit", "-q", "-m", "basis");
      git("checkout", "-q", "-b", "feature");
      mkdirSync(join(dir, "docs"));
      writeFileSync(join(dir, "docs", "adr.md"), "pr\n");
      git("add", ".");
      git("commit", "-q", "-m", "pr");
      const head = git("rev-parse", "HEAD");
      git("checkout", "-q", "main");
      mkdirSync(join(dir, ".claude"));
      writeFileSync(join(dir, ".claude", "fremd.js"), "main\n");
      git("add", ".");
      git("commit", "-q", "-m", "fremder main-commit");
      const base = git("rev-parse", "HEAD");

      const changed = git(...guardDiffArgs(guardWf, base, head))
        .split(/\r?\n/)
        .filter(Boolean);
      assert.deepEqual(
        changed,
        ["docs/adr.md"],
        "Der Guard zählt Dateien fremder main-Commits zum PR (Zwei- statt Drei-Punkt-Diff)",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("der Checkout holt die volle Historie (ohne sie findet der Drei-Punkt-Diff keine Merge-Base)", () => {
    assert.match(guardWf, /fetch-depth:\s*0\b/, "gate-change-guard.yml: actions/checkout braucht fetch-depth: 0");
  });
});

describe("Der Guard liest die Quelle wirklich richtig – echter Lauf mit bash + jq (#1157)", () => {
  // Führt das run:-Skript des Guards wirklich aus (Fixture-Repo, gefälschtes `gh`). jq/bash gibt es auf
  // ubuntu-latest; lokal ohne jq wird der Block sichtbar übersprungen. In CI MUSS er laufen (Test unten),
  // sonst fiele der einzige Verhaltensbeweis des Guards still weg.
  const hatJq = (() => {
    try {
      execFileSync("jq", ["--version"], { stdio: "ignore" });
      execFileSync("bash", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  /** Das `run: |`-Skript des Guard-Steps, um die YAML-Einrückung bereinigt. */
  function guardSkript(wf: string): string {
    const blk = wf.split(/\r?\n {8}run: \|\r?\n/)[1];
    assert.ok(blk, "run: |-Block in gate-change-guard.yml nicht gefunden");
    return blk
      .split(/\r?\n/)
      .map((l) => l.replace(/^ {10}/, ""))
      .join("\n");
  }

  const ECHTE_QUELLE = JSON.stringify(quelle);
  const SIGN_OFF_FEHLT = "Gate-/Harness-Aenderung ohne Sign-off";

  /**
   * Baut Base (Quelle mit `baseQuelle` als Inhalt, `null` = keine Quelle) + PR-Commit, lässt den Guard
   * ohne Label laufen und liefert Exit-Code + Ausgabe (die Ausgabe trennt „Label fehlt" von einem Absturz).
   */
  function guardLauf(baseQuelle: string | null, pr: Record<string, string>): { exit: number; out: string } {
    const dir = mkdtempSync(join(tmpdir(), "kq-guard-e2e-"));
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|PREFIX)$/.test(k)),
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const schreibe = (dateien: Record<string, string>) => {
      for (const [rel, inhalt] of Object.entries(dateien)) {
        mkdirSync(join(dir, rel, ".."), { recursive: true });
        writeFileSync(join(dir, rel), inhalt);
      }
    };
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "t@example.invalid");
      git("config", "user.name", "t");
      git("config", "commit.gpgsign", "false");
      schreibe({ "README.md": "x\n", "eslint.config.js": "e\n", ...(baseQuelle === null ? {} : { [QUELLE]: baseQuelle }) });
      git("add", "-A");
      git("commit", "-q", "-m", "basis");
      const base = git("rev-parse", "HEAD");
      git("checkout", "-q", "-b", "pr");
      schreibe(pr);
      git("add", "-A");
      git("commit", "-q", "-m", "pr");
      const head = git("rev-parse", "HEAD");
      // Gefälschtes gh: meldet „kein maintainer-approved-Label".
      const bin = join(dir, ".fake-bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "gh"), "#!/bin/sh\necho false\n", { mode: 0o755 });
      const skript = join(dir, ".guard.sh");
      writeFileSync(skript, guardSkript(guardWf));
      const lauf = spawnSync("bash", [skript], {
        cwd: dir,
        env: { ...env, PATH: `${bin}:${env.PATH ?? ""}`, BASE_SHA: base, HEAD_SHA: head, PR_NUMBER: "1", REPO: "x/y" },
        encoding: "utf8",
      });
      return { exit: lauf.status ?? -1, out: `${lauf.stdout}${lauf.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Erwartet „rot, weil das Label fehlt" – und dass die genannte Datei als geschützt gemeldet wird. */
  function erwarteSignOffFehlt(lauf: { exit: number; out: string }, datei: string): void {
    assert.equal(lauf.exit, 1, `Guard sollte rot sein:\n${lauf.out}`);
    assert.ok(lauf.out.includes(SIGN_OFF_FEHLT), `Guard ist rot, aber nicht wegen des fehlenden Labels (Absturz?):\n${lauf.out}`);
    assert.ok(lauf.out.includes(datei), `Guard meldet ${datei} nicht als geschützt:\n${lauf.out}`);
  }

  test("in CI läuft dieser Block wirklich (jq + bash vorhanden)", () => {
    if (process.env.CI) assert.ok(hatJq, "CI ohne jq/bash – der Verhaltensbeweis des Guards würde still übersprungen");
  });

  test.skipIf(!hatJq)("ein harmloser PR bleibt grün (Gegenprobe: der Guard ist nicht immer rot)", () => {
    const lauf = guardLauf(ECHTE_QUELLE, { "README.md": "y\n" });
    assert.equal(lauf.exit, 0, lauf.out);
  });

  test.skipIf(!hatJq)("ein Wildcard-Pfad greift (/scripts/check-*.mjs trifft scripts/check-neu.mjs)", () => {
    erwarteSignOffFehlt(guardLauf(ECHTE_QUELLE, { "scripts/check-neu.mjs": "x\n" }), "scripts/check-neu.mjs");
  });

  test.skipIf(!hatJq)("eine modul-lokale AGENTS.md ist label-pflichtig (#1168)", () => {
    // Regressions-Pin: der Substring-Guard trifft sie schon seit jeher; ein späteres verankertes
    // Glob-Matching darf sie nicht still entschützen.
    erwarteSignOffFehlt(guardLauf(ECHTE_QUELLE, { "src/content/AGENTS.md": "x\n" }), "src/content/AGENTS.md");
  });

  test.skipIf(!hatJq)("ein neuer Test in test/harness/ ist label-pflichtig, ein Test daneben nicht (#1165)", () => {
    // Der Präfix greift wirklich im Guard – und sperrt nicht den ganzen test/-Ordner (Label-Fatigue).
    erwarteSignOffFehlt(guardLauf(ECHTE_QUELLE, { "test/harness/neu.test.ts": "x\n" }), "test/harness/neu.test.ts");
    const daneben = guardLauf(ECHTE_QUELLE, { "test/sonstwas.test.ts": "x\n" });
    assert.equal(daneben.exit, 0, daneben.out);
  });

  test.skipIf(!hatJq)("ein PR, der die Quelle leert und eine Gate-Datei ändert, bleibt ohne Label rot", () => {
    const lauf = guardLauf(ECHTE_QUELLE, { [QUELLE]: '{"gate":["/nix"]}', "eslint.config.js": "aufgeweicht\n" });
    erwarteSignOffFehlt(lauf, "eslint.config.js");
  });

  test.skipIf(!hatJq)("ein im PR neu eingetragener Pfad greift schon im selben PR (Head additiv)", () => {
    const erweitert = JSON.stringify({ ...quelle, harness: [...(quelle.harness ?? []), "/neu.txt"] });
    erwarteSignOffFehlt(guardLauf(ECHTE_QUELLE, { [QUELLE]: erweitert, "neu.txt": "x\n" }), "neu.txt");
  });

  for (const [fall, inhalt] of [
    ["fehlt", null],
    ["ist leer ({})", "{}"],
    ["ist kaputtes JSON", "kaputt{"],
    ["hat nur leere Gruppen", '{"gate":[]}'],
  ] as const) {
    test.skipIf(!hatJq)(`Base-Quelle ${fall} → jede Änderung ist label-pflichtig (fail-closed)`, () => {
      erwarteSignOffFehlt(guardLauf(inhalt, { "README.md": "y\n" }), "README.md");
    });
  }
});
