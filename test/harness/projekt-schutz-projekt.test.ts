/* Projekt-Schutz-Wächter (#1882): die Prüfungen über kubernias EIGENE Schutz-Dateien, die kein Besitz sind.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Mit dem Sync vom Tag zog der Kern-Test-Satz ins Factory-Repo. Dort prüfen die Tests nur dessen eigene
 * Dateien; `.github/CODEOWNERS`, `.github/protected-paths.json` und der Settings-Schlüssel `model` sind
 * kein Besitz (`.factory/besitz.json`), das Drift-Gate sieht sie nicht. Dieser Wächter hält den Rest:
 *
 *   1. `.github/CODEOWNERS` schützt genau die Muster aus `.github/protected-paths.json` (die Quelle).
 *   2. Jeder Test mit dem Marker `@harness-waechter` liegt in `test/harness/`, und jeder dort trägt ihn.
 *   3. `.claude/settings.json` setzt den Hauptchat auf den Alias `sonnet` (docs/model-routing.md).
 *
 * Die Wurzel-Kontextdatei, das Required-Check-Shadowing und die LF-Zeilenenden prüfen die Geschwister
 * `agents-md-native-projekt`, `required-check-shadowing-projekt` und `line-endings-projekt`.
 *
 * Grenze: Die Muster werden als Text verglichen, nicht gegen die Auswertung von GitHub.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lies = (rel: string): string => readFileSync(join(WURZEL, rel), "utf8");

const WAECHTER_ORDNER = "test/harness/";
const WAECHTER_MARKER = /^\s*(?:\/\*+|\*)?\s*@harness-waechter(?![\w-])/m;

/** Die Muster aus CODEOWNERS (jeweils vor dem `@owner`), Kommentare und Leerzeilen ignoriert. */
function codeownersMuster(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().match(/^(?!#)(\S+)\s+@\S+/)?.[1])
    .filter((p): p is string => p !== undefined);
}

/** Unterschiede zwischen der Quelle (Gruppe → Muster) und CODEOWNERS, als lesbare Zeilen. */
function schutzUnterschiede(quelle: Record<string, string[]>, codeowners: string): string[] {
  const inQuelle = new Set(Object.values(quelle).flat());
  const inOwners = new Set(codeownersMuster(codeowners));
  return [
    ...[...inQuelle].filter((p) => !inOwners.has(p)).map((p) => `fehlt in CODEOWNERS: ${p}`),
    ...[...inOwners].filter((p) => !inQuelle.has(p)).map((p) => `fehlt in der Quelle: ${p}`),
  ].sort();
}

/** Marker und Ordner passen nicht zusammen: Datei → Befund. */
function markerBefunde(dateien: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [pfad, text] of Object.entries(dateien)) {
    const markiert = WAECHTER_MARKER.test(text);
    const imOrdner = pfad.startsWith(WAECHTER_ORDNER);
    if (markiert && !imOrdner) out.push(`${pfad}: trägt @harness-waechter, liegt aber außerhalb von ${WAECHTER_ORDNER}`);
    if (!markiert && imOrdner) out.push(`${pfad}: liegt in ${WAECHTER_ORDNER}, aber ohne @harness-waechter im Kopf`);
  }
  return out;
}

/** Das Hauptchat-Modell muss genau der Alias `sonnet` sein (nie eine feste ID). */
function modellBefunde(settings: { model?: unknown }): string[] {
  return settings.model === "sonnet" ? [] : [`model=${JSON.stringify(settings.model ?? null)}`];
}

function testDateien(): Record<string, string> {
  const dateien: Record<string, string> = {};
  for (const f of readdirSync(join(WURZEL, "test"), { recursive: true, encoding: "utf8" })) {
    const rel = `test/${f.replace(/\\/g, "/")}`;
    if (rel.endsWith(".test.ts")) dateien[rel] = lies(rel);
  }
  return dateien;
}

describe("CODEOWNERS und die Quelle der Schutz-Pfade (#1882)", () => {
  test("CODEOWNERS schützt genau die Muster aus .github/protected-paths.json", () => {
    const quelle = JSON.parse(lies(".github/protected-paths.json")) as Record<string, string[]>;
    assert.deepEqual(
      schutzUnterschiede(quelle, lies(".github/CODEOWNERS")),
      [],
      "CODEOWNERS und die Quelle sind auseinandergelaufen: neue Leitplanken in der Quelle eintragen und die CODEOWNERS-Zeile nachziehen",
    );
  });

  test("Red-Green: ein nur in der Quelle oder nur in CODEOWNERS stehendes Muster fällt auf", () => {
    const quelle = { a: ["/x.mjs", "/y/"] };
    assert.deepEqual(schutzUnterschiede(quelle, "/x.mjs @o\n/y/ @o\n"), []);
    assert.deepEqual(schutzUnterschiede(quelle, "/x.mjs @o\n"), ["fehlt in CODEOWNERS: /y/"]);
    assert.deepEqual(schutzUnterschiede(quelle, "/x.mjs @o\n/y/ @o\n/z @o\n"), ["fehlt in der Quelle: /z"]);
    assert.deepEqual(schutzUnterschiede(quelle, "# /y/ @o\n/x.mjs @o\n"), ["fehlt in CODEOWNERS: /y/"], "Kommentare zählen nicht");
  });
});

describe("Wächter-Marker und Ordner (#1882)", () => {
  test("jeder Test mit @harness-waechter liegt in test/harness/, und jeder dort trägt den Marker", () => {
    assert.deepEqual(markerBefunde(testDateien()), []);
  });

  test("Red-Green: Marker ohne Ordner und Ordner ohne Marker werden gemeldet, Erwähnungen im Fließtext nicht", () => {
    const marker = "/* x\n * @harness-waechter\n */";
    assert.deepEqual(markerBefunde({ "test/harness/a.test.ts": marker, "test/b.test.ts": "// nichts" }), []);
    assert.match(markerBefunde({ "test/b.test.ts": marker }).join(), /b\.test\.ts: trägt @harness-waechter, liegt aber außerhalb/);
    assert.match(markerBefunde({ "test/harness/c.test.ts": "// nichts" }).join(), /c\.test\.ts: liegt in test\/harness\/, aber ohne/);
    assert.deepEqual(markerBefunde({ "test/d.test.ts": " * siehe @harness-waechter im Kopf" }), []);
    assert.deepEqual(markerBefunde({ "test/e.test.ts": " * @harness-waechterX" }), []);
  });
});

describe("Hauptchat-Modell (#1882)", () => {
  test(".claude/settings.json setzt den Hauptchat auf den Alias sonnet", () => {
    assert.deepEqual(modellBefunde(JSON.parse(lies(".claude/settings.json")) as { model?: unknown }), []);
  });

  test("Red-Green: nur der Alias sonnet ist grün, feste IDs, andere Aliasse und ein fehlender Schlüssel nicht", () => {
    assert.deepEqual(modellBefunde({ model: "sonnet" }), []);
    for (const m of ["opus", "claude-sonnet-5-5", "Sonnet "]) assert.deepEqual(modellBefunde({ model: m }), [`model=${JSON.stringify(m)}`], m);
    assert.deepEqual(modellBefunde({}), ["model=null"]);
  });
});
