/* Required-Check-Shadowing-Wächter (#1172) – jeder Required-Check-Kontext hat genau eine Quelle.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Das Ruleset `main-schutz` gleicht die Required-Checks nur über den **Namen** ab (kein App-/
 * Workflow-Pinning; auch mit `integration_id` kämen alle Runs von github-actions). Legt ein PR eine
 * neue Workflow-Datei mit einem gleichnamigen Job daneben (z.B. `sleep 120; exit 0`), wertet GitHub
 * bei gleichem Namen + SHA den zuletzt fertigen Run – ein roter echter Check würde grün überschrieben.
 * Die Kontexte stehen im Ruleset; Gate-Config-Änderungen sind seit ADR 0014 nur noch auditpflichtig.
 *
 * Evaluiert in #1172 und bewusst verworfen: (a) ein Check prüft per API, dass nur ein Run seines
 * Namens existiert – sein Rot würde vom Fake-Run genauso überschrieben; (b) ein Commit-Status mit
 * eigenem Kontext aus dem pull_request_target-Lauf – braucht `statuses: write` (weicht die rein
 * lesenden Permissions auf) und ein Fake-Workflow kann denselben Kontext ebenso grün posten.
 * In-Repo lässt sich die Lücke nicht schließen, nur verteuern: dieser Wächter macht einen
 * gleichnamigen Job **lokal** in `npm run verify` rot, wo kein Run-Timing ihn überschreiben kann.
 * Ein bewusster Angriff muss also einen roten Wächter ignorieren – sichtbar intentional, passend
 * zum Speed-Bump-Charakter der Leitplanken (#723).
 *
 * Bewusst über-approximierend (fail-closed, wie der Substring-Abgleich der Leitplanken-Pfade): gezählt wird
 * jede eingerückte `name:`-Zeile (Job- wie Step-Ebene, beliebige Einrückung), deren Wert mit einem
 * Kontext **beginnt**. Lieber ein Fehlalarm als ein still durchgerutschter Doppelgänger. Job-Keys
 * ohne `name:` sind kein Weg: Keys erlauben weder Leerzeichen noch Klammern, die Kontexte schon.
 * Ehrliche Grenzen: (1) Wirkung nur lokal – in CI läuft dieser Test im Job „Tests, Typecheck &
 * Builds", der per demselben Trick ebenfalls überschreibbar ist. (2) Der Regex-Parser liest nur
 * wörtlich notierte Namen: zur Laufzeit erzeugte (`${{ … }}`, Matrix), Block-Scalars, über
 * Folgezeilen gefaltete Werte, YAML-Escapes und Flow-Style (`{ name: … }`) erkennt er nicht (keine YAML-Lib im Projekt, Präzedenz
 * harness-approval.test.ts).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

/** Die Required-Check-Kontexte **genau so, wie das Ruleset `main-schutz` sie führt** (Stand 2026-10-06, #1303).
 *  SSOT ist das out-of-repo-Ruleset (`gh api repos/fluffels/kubernia/rulesets/20151454`); ändert sich
 *  dort ein Kontext, wird diese Liste beim Ruleset-Handgriff von Hand mitgepflegt. */
const REQUIRED_CONTEXTS = [
  "Tests, Typecheck & Builds",
  "Security-Audit (npm audit)",
  "PR-Text interne Bezuege pruefen",
] as const;

/** Liest die Werte aller eingerückten `name:`-Zeilen so, wie YAML sie sieht: Kommentarzeilen raus,
 *  Listen-Präfix `- ` weg, Quotes abziehen, unquotete Werte an ` #` abschneiden (#984). */
function nameWerte(workflow: string): string[] {
  const werte: string[] = [];
  for (const zeile of workflow.split(/\r?\n/)) {
    const m = /^[ \t]+(?:-[ \t]+)?name:[ \t]*(.*)$/.exec(zeile);
    if (!m) continue;
    const roh = m[1].trim();
    const quoted = /^(["'])(.*)\1/.exec(roh);
    const wert = quoted ? quoted[2] : roh.split(/[ \t]#/)[0].trim();
    if (wert !== "") werte.push(wert);
  }
  return werte;
}

/** Fundstellen je Kontext über ein Set von Workflow-Dateien (Datei → Inhalt). */
function fundstellen(workflows: Map<string, string>, kontexte: readonly string[]): Map<string, string[]> {
  const treffer = new Map<string, string[]>(kontexte.map((k) => [k, []]));
  for (const [datei, inhalt] of workflows) {
    for (const wert of nameWerte(inhalt)) {
      for (const k of kontexte) if (wert.startsWith(k)) treffer.get(k)?.push(`${datei}: ${wert}`);
    }
  }
  return treffer;
}

/** Kontexte, die nicht genau eine Quelle haben, mit ihren Fundstellen. */
function verstoesse(workflows: Map<string, string>, kontexte: readonly string[]): string[] {
  return [...fundstellen(workflows, kontexte)]
    .filter(([, orte]) => orte.length !== 1)
    .map(([k, orte]) => `„${k}": ${orte.length} Quellen${orte.length ? ` (${orte.join("; ")})` : ""}`);
}

/** GitHub liest beide Endungen – ein `fake.yaml` darf dem Wächter nicht entgehen. */
function istWorkflowDatei(datei: string): boolean {
  return /\.ya?ml$/.test(datei);
}

function echteWorkflows(): Map<string, string> {
  return new Map(
    readdirSync(WORKFLOW_DIR)
      .filter(istWorkflowDatei)
      .map((f) => [f, readFileSync(join(WORKFLOW_DIR, f), "utf8")]),
  );
}

const MIT_RAUTE = `jobs:
  beispiel:
    name: Beispiel-Check (Zusatz, #903)
    runs-on: ubuntu-latest
`;

describe("nameWerte – liest name: wie YAML", () => {
  test("unquotet wird an ' #' abgeschnitten (#984)", () => {
    assert.deepEqual(nameWerte(MIT_RAUTE), ["Beispiel-Check (Zusatz,"]);
  });
  test("gequotet bleibt der Wert vollständig, auch mit ' #'", () => {
    assert.deepEqual(nameWerte(`jobs:\n  a:\n    name: "A (X, #903)"\n`), ["A (X, #903)"]);
    assert.deepEqual(nameWerte(`jobs:\n  a:\n    name: 'B'\n`), ["B"]);
  });
  test("Step-Namen mit Listen-Präfix und tiefer Einrückung zählen mit", () => {
    assert.deepEqual(nameWerte(`jobs:\n    a:\n        steps:\n          - name: Schritt\n`), ["Schritt"]);
  });
  test("Kommentare, Workflow-Name (Spalte 0) und leere Werte zählen NICHT", () => {
    assert.deepEqual(nameWerte(`name: Workflow\n# name: A\n    # name: B\n    name:\n`), []);
  });
  test("mehrere Jobs in einer Datei liefern alle Namen, CRLF eingeschlossen", () => {
    assert.deepEqual(nameWerte(`jobs:\r\n  a:\r\n    name: Eins\r\n  b:\r\n    name: Zwei\r\n`), ["Eins", "Zwei"]);
  });
  test("kaputte/leere Eingabe wirft nicht", () => {
    assert.deepEqual(nameWerte(""), []);
    assert.deepEqual(nameWerte("on: push\n"), []);
  });
});

describe("verstoesse – gleichnamige Fremd-Jobs werden erkannt (#1172)", () => {
  const K = ["Beispiel-Check (Zusatz,"];

  test("genau eine Quelle ⇒ kein Verstoß", () => {
    assert.deepEqual(verstoesse(new Map([["beispiel.yml", MIT_RAUTE]]), K), []);
  });
  test("zweite Datei mit wortgleichem Job ⇒ Verstoß mit beiden Fundstellen", () => {
    const v = verstoesse(new Map([["beispiel.yml", MIT_RAUTE], ["fake.yml", MIT_RAUTE]]), K);
    assert.equal(v.length, 1);
    assert.match(v[0], /2 Quellen.*beispiel\.yml.*fake\.yml/);
  });
  test("Variante mit anderer Ticketnummer (#999) parst auf denselben Kontext ⇒ Verstoß", () => {
    const fake = `jobs:\n  x:\n    name: Beispiel-Check (Zusatz, #999)\n`;
    assert.equal(verstoesse(new Map([["beispiel.yml", MIT_RAUTE], ["fake.yml", fake]]), K).length, 1);
  });
  test("gequotete Variante mit Zusatz beginnt mit dem Kontext ⇒ Verstoß (fail-closed)", () => {
    const fake = `jobs:\n  x:\n    name: "Beispiel-Check (Zusatz, #903)"\n`;
    assert.equal(verstoesse(new Map([["beispiel.yml", MIT_RAUTE], ["fake.yml", fake]]), K).length, 1);
  });
  test("zweiter gleichnamiger Job in DERSELBEN Datei ⇒ Verstoß", () => {
    const doppelt = `${MIT_RAUTE}  fake:\n    name: Beispiel-Check (Zusatz, #1)\n`;
    assert.equal(verstoesse(new Map([["beispiel.yml", doppelt]]), K).length, 1);
  });
  test("Kontext ganz ohne Quelle ⇒ Verstoß (sonst prüfte der Wächter nach Umbenennung ins Leere)", () => {
    assert.match(verstoesse(new Map([["ci.yml", "jobs:\n  a:\n    name: Anderes\n"]]), K)[0], /0 Quellen/);
  });
});

test("istWorkflowDatei zählt .yml UND .yaml, aber nichts anderes", () => {
  assert.ok(istWorkflowDatei("ci.yml"));
  assert.ok(istWorkflowDatei("fake.yaml"));
  assert.ok(!istWorkflowDatei("README.md"));
  assert.ok(!istWorkflowDatei("ci.yml.bak"));
});

describe("echte Workflows – jeder Required-Check-Kontext hat genau eine Quelle", () => {
  test("die Kontext-Liste ist nicht leer und es gibt Workflow-Dateien", () => {
    assert.ok(REQUIRED_CONTEXTS.length > 0);
    assert.ok(echteWorkflows().size > 0, `keine Workflows unter ${WORKFLOW_DIR}`);
  });
  test("kein Required-Check-Name wird von einem zweiten Job beansprucht", () => {
    const v = verstoesse(echteWorkflows(), REQUIRED_CONTEXTS);
    assert.deepEqual(
      v,
      [],
      `Required-Check-Shadowing (#1172): ein Job-Name entspricht einem Required-Check-Kontext des Rulesets ` +
        `\`main-schutz\` mehr (oder weniger) als einmal. Ein gleichnamiger Job könnte den echten Check grün ` +
        `überschreiben. Job umbenennen – oder, bei Umbenennung des echten Checks, Ruleset UND ` +
        `REQUIRED_CONTEXTS nachziehen.\n${v.join("\n")}`,
    );
  });
});
