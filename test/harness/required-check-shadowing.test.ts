/* Required-Check-Shadowing-Wächter (#1172) – jeder Required-Check-Kontext hat genau eine Quelle.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Das Ruleset `main-schutz` gleicht die Required-Checks nur über den **Namen** ab (kein App-/
 * Workflow-Pinning; auch mit `integration_id` kämen alle Runs von github-actions). Legt ein PR eine
 * neue Workflow-Datei mit einem gleichnamigen Job daneben (z.B. `sleep 120; exit 0`), wertet GitHub
 * bei gleichem Namen + SHA den zuletzt fertigen Run – ein roter echter Check würde grün überschrieben.
 * Die Kontexte stehen im Ruleset (Spiegel: .github/ruleset-main-schutz.json); Gate-Config-Änderungen sind seit ADR 0014 nur noch auditpflichtig.
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
 * der `name:` jedes Jobs und jedes Schritts (gelesen mit der `yaml`-Bibliothek, also auch Block-Scalars,
 * gefaltete Werte, YAML-Escapes und Flow-Style), der mit einem Kontext **beginnt**. Enthält der Name `${{`,
 * zählt er als Treffer, sobald sein wörtliches Präfix davor ein Anfang des Kontexts ist (ein komplett
 * dynamischer Name passt damit auf jeden Kontext). Lieber ein Fehlalarm als ein still durchgerutschter
 * Doppelgänger. Job-Keys ohne `name:` sind kein Weg: Keys erlauben weder Leerzeichen noch Klammern, die
 * Kontexte schon.
 * Ehrliche Grenze: Wirkung nur lokal – in CI läuft dieser Test im Job „Tests, Typecheck & Builds", der per
 * demselben Trick ebenfalls überschreibbar ist.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import { parse } from "yaml";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rulesetSpiegel from "../../scripts/docs-gen/ruleset-spiegel.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as projektConfig from "../../scripts/projekt-config-lib.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

/** Die Required-Check-Kontexte **genau so, wie das Ruleset `main-schutz` sie führt**, gelesen aus dem geschützten Spiegel,
 *  dessen Pfad der Schlüssel `rulesetSpiegel` der Projekt-Config nennt (Z1): dieselbe Quelle speist das Leitplanken-Diagramm (docs/diagramme). Die Wahrheit ist das
 *  out-of-repo-Ruleset (`gh api repos/{owner}/{repo}/rulesets/20151454`); ändert sich dort ein Kontext, zieht der PR den Spiegel nach. */
const spiegelPfad = (projektConfig as unknown as { ladeProjektConfig: () => { rulesetSpiegel?: string } }).ladeProjektConfig().rulesetSpiegel;
if (!spiegelPfad) throw new Error("rulesetSpiegel fehlt in der Projekt-Config (.factory/projekt.json)");
const RULESET_SPIEGEL = join(ROOT, spiegelPfad);
// Dieselbe Eingangsprüfung wie der Generator `leitplanken-schichten` (#1411): ein Modul statt zweier Kopien.
const pruefeRulesetSpiegel = (rulesetSpiegel as unknown as { pruefeRulesetSpiegel: (roh: unknown, pfad: string) => { requiredChecks: string[] } }).pruefeRulesetSpiegel;
function leseKontexte(json: string): string[] {
  return pruefeRulesetSpiegel(JSON.parse(json), "Spiegel").requiredChecks;
}
const REQUIRED_CONTEXTS: readonly string[] = leseKontexte(readFileSync(RULESET_SPIEGEL, "utf8"));

/** Liest die `name:`-Werte aller Jobs und Schritte strukturell mit der YAML-Bibliothek (der Workflow-Name auf
 *  oberster Ebene zählt nicht; ein Parse-Fehler wirft, statt still nichts zu finden). */
function nameWerte(workflow: string): string[] {
  const doc = parse(workflow) as { jobs?: unknown } | null;
  const jobs = doc?.jobs;
  if (jobs === null || typeof jobs !== "object") return [];
  const werte: string[] = [];
  const nimm = (w: unknown) => {
    if (typeof w === "string" && w.trim() !== "") werte.push(w.trim());
  };
  for (const job of Object.values(jobs as Record<string, unknown>)) {
    if (job === null || typeof job !== "object") continue;
    const j = job as { name?: unknown; steps?: unknown };
    nimm(j.name);
    if (Array.isArray(j.steps)) {
      for (const schritt of j.steps) {
        if (schritt !== null && typeof schritt === "object") nimm((schritt as { name?: unknown }).name);
      }
    }
  }
  return werte;
}

/** Beansprucht der Name den Kontext? Wörtlich: Name beginnt mit dem Kontext. Dynamisch (`${{`): das wörtliche
 *  Präfix davor ist ein Anfang des Kontexts (fail-closed). */
function beansprucht(wert: string, kontext: string): boolean {
  const i = wert.indexOf("${{");
  return i === -1 ? wert.startsWith(kontext) : kontext.startsWith(wert.slice(0, i));
}

/** Fundstellen je Kontext über ein Set von Workflow-Dateien (Datei → Inhalt). */
function fundstellen(workflows: Map<string, string>, kontexte: readonly string[]): Map<string, string[]> {
  const treffer = new Map<string, string[]>(kontexte.map((k) => [k, []]));
  for (const [datei, inhalt] of workflows) {
    for (const wert of nameWerte(inhalt)) {
      for (const k of kontexte) if (beansprucht(wert, k)) treffer.get(k)?.push(`${datei}: ${wert}`);
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
    assert.deepEqual(nameWerte(`name: Workflow\n# name: A\njobs:\n  a:\n    # name: B\n    name:\n`), []);
  });
  test("Block-Scalar, gefalteter Wert und Flow-Style werden gelesen", () => {
    assert.deepEqual(nameWerte(`jobs:\n  a:\n    name: |\n      Block-Name\n`), ["Block-Name"]);
    assert.deepEqual(nameWerte(`jobs:\n  a:\n    name: >-\n      Erste\n      Zweite\n`), ["Erste Zweite"]);
    assert.deepEqual(nameWerte(`jobs:\n  a: { name: Flow-Name, runs-on: x }\n`), ["Flow-Name"]);
    assert.deepEqual(nameWerte(`jobs:\n  a:\n    steps: [ { name: Flow-Schritt } ]\n`), ["Flow-Schritt"]);
  });
  test("YAML-Escapes im gequoteten Namen werden aufgelöst", () => {
    assert.deepEqual(nameWerte(`jobs:\n  a:\n    name: "Tests,\\x20Typecheck"\n`), ["Tests, Typecheck"]);
  });
  test("kaputtes YAML wirft statt still nichts zu finden", () => {
    assert.throws(() => nameWerte("jobs:\n  a: [\n"));
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
  test("Block-Scalar- und Flow-Style-Doppelgänger ⇒ Verstoß", () => {
    const block = `jobs:\n  x:\n    name: |\n      Beispiel-Check (Zusatz, #5)\n`;
    const flow = `jobs:\n  x: { name: "Beispiel-Check (Zusatz, #5)" }\n`;
    assert.equal(verstoesse(new Map([["beispiel.yml", MIT_RAUTE], ["fake.yml", block]]), K).length, 1);
    assert.equal(verstoesse(new Map([["beispiel.yml", MIT_RAUTE], ["fake.yml", flow]]), K).length, 1);
  });
  test("dynamischer Name mit Kontext-Präfix ⇒ Verstoß (fail-closed); fremdes Präfix nicht", () => {
    const dyn = (n: string) => `jobs:\n  x:\n    name: "${n}"\n`;
    assert.equal(verstoesse(new Map([["beispiel.yml", MIT_RAUTE], ["fake.yml", dyn("Beispiel-Check ${{ matrix.x }}")]]), K).length, 1);
    assert.equal(verstoesse(new Map([["beispiel.yml", MIT_RAUTE], ["fake.yml", dyn("${{ matrix.x }}")]]), K).length, 1);
    assert.deepEqual(verstoesse(new Map([["beispiel.yml", MIT_RAUTE], ["ok.yml", dyn("Anderes ${{ matrix.x }}")]]), K), []);
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

describe("Ruleset-Spiegel – Form (Z1)", () => {
  test("leere, fehlende oder nicht-textuelle Kontext-Liste wirft", () => {
    const mit = (checks: string) => `{"name":"n","bypassActors":[],"requiredChecks":${checks}}`;
    assert.throws(() => leseKontexte('{"name":"n","bypassActors":[]}'), /nicht leere Liste/);
    assert.throws(() => leseKontexte(mit("[]")), /nicht leere Liste/);
    assert.throws(() => leseKontexte(mit('"x"')), /nicht leere Liste/);
    assert.throws(() => leseKontexte(mit('["a",3]')), /nicht leere Liste aus Texten/);
    assert.throws(() => leseKontexte(mit('[" "]')), /nicht leere Liste aus Texten/);
    assert.deepEqual(leseKontexte(mit('["a"]')), ["a"]);
  });
  test("Name und Bypass-Liste fehlen oder sind kaputt: wirft (eine Eingangsprüfung für Generator und Wächter)", () => {
    assert.throws(() => leseKontexte('{"requiredChecks":["a"],"bypassActors":[]}'), /name fehlt/);
    assert.throws(() => leseKontexte('{"name":" ","requiredChecks":["a"],"bypassActors":[]}'), /name fehlt/);
    assert.throws(() => leseKontexte('{"name":"n","requiredChecks":["a"]}'), /bypassActors muss eine Liste sein/);
    assert.throws(() => leseKontexte('{"name":"n","requiredChecks":["a"],"bypassActors":{}}'), /bypassActors muss eine Liste sein/);
  });
  test("der echte Spiegel nennt den Ruleset-Namen und hat die Bypass-Liste", () => {
    const r = JSON.parse(readFileSync(RULESET_SPIEGEL, "utf8")) as { name?: unknown; bypassActors?: unknown };
    assert.equal(r.name, "main-schutz");
    assert.ok(Array.isArray(r.bypassActors));
  });
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
        `den Spiegel .github/ruleset-main-schutz.json nachziehen.\n${v.join("\n")}`,
    );
  });
});
