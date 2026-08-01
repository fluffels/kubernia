/* Interne-Referenzen-Wächter (#990) — hält Arbeitgeber-/Kundenbezüge aus dem öffentlichen Repo.
 *
 * Analog zu test/context-size.test.ts (#719): die Prüflogik wird aus
 * scripts/check-internalrefs.mjs importiert — EINE Quelle der Wahrheit für CLI und Test.
 *
 * WICHTIG: Dieser Test arbeitet mit DUMMY-Begriffen. Die echten Begriffe stehen bewusst nur
 * base64-kodiert im Skript (Begründung im Datei-Kopf dort) — sie hier für einen Red-Green-Fall
 * im Klartext hinzuschreiben würde genau den Fehler begehen, den das Gate verhindern soll.
 * Wo der Test die echten Begriffe braucht, holt er sie über `decodeTerms()`, ohne sie zu nennen.
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:internalrefs)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs ist aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// Anders als die älteren Gate-Tests (diffsize/context-size) wird der Namespace EINMAL über
// `unknown` auf ein lokales Interface gebracht, statt jeden Export einzeln aus einem
// error-typed Wert zu ziehen — das kommt ohne `no-unsafe-*`-Suppressions aus (Ratchet #868).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawModule from "../scripts/check-internalrefs.mjs";

type Violation = { file: string; line: number; term: string; excerpt: string };

type InternalRefsApi = {
  ENCODED_TERMS: string[];
  decodeTerms: (encoded?: string[]) => string[];
  encodeTerm: (term: string) => string;
  buildTermPattern: (term: string) => RegExp;
  isCheckable: (file: string) => boolean;
  findViolations: (files: string[], terms: string[], readFile: (f: string) => string) => Violation[];
  runCheck: () => { files: string[]; violations: Violation[] };
};

const {
  ENCODED_TERMS,
  decodeTerms,
  encodeTerm,
  buildTermPattern,
  isCheckable,
  findViolations,
  runCheck,
} = rawModule as unknown as InternalRefsApi;

const DUMMY = "zzzdummyfirma";
const readRepo = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

describe("Interne-Referenzen-Wächter (#990)", () => {
  test("das Repo ist frei von den gelisteten Begriffen", () => {
    // Der eigentliche Wächter. Schlägt er an, ist die Fundstelle neutral umzuformulieren —
    // NICHT die Liste zu kürzen.
    const { violations } = runCheck();
    assert.deepEqual(
      violations.map((v) => `${v.file}:${v.line}`),
      [],
      "Interne Referenz(en) gefunden — neutral umformulieren (die Sache benennen, nicht die Herkunft).",
    );
  });

  test("Detektion greift wirklich (Red-Green)", () => {
    // No-op-Schutz: ein Wächter, der nie anschlägt, wäre wertlos.
    const hit = findViolations(["doc.md"], [DUMMY], () => `Vorbild ist die ${DUMMY}-Pipeline (#532).`);
    assert.equal(hit.length, 1, "Ein klarer Treffer muss gefunden werden.");
    assert.equal(hit[0]?.line, 1);

    const clean = findViolations(["doc.md"], [DUMMY], () => "Vorbild sind produktive Pipelines.");
    assert.deepEqual(clean, [], "Neutral formulierter Text darf nicht anschlagen.");
  });

  test("Wortgrenzen verhindern Zufallstreffer in base64-Blobs", () => {
    // Das ist kein Feinschliff, sondern notwendig: ohne Wortgrenzen wäre das Gate auf dem
    // aktuellen Stand sofort rot, weil fonts.css eine base64-`@font-face` enthält, in der
    // zufällig ein Listenbegriff als Substring steckt (siehe nächster Test).
    assert.equal(buildTermPattern(DUMMY).test(`AA${DUMMY}BB`), false, "Substring ohne Wortgrenzen: kein Treffer.");
    assert.equal(buildTermPattern(DUMMY).test(`ein ${DUMMY}.`), true, "Als eigenes Wort: Treffer.");
    assert.equal(buildTermPattern(DUMMY).test(DUMMY.toUpperCase()), true, "Case-insensitive.");
  });

  test("fonts.css bleibt in der Prüfung und ist trotz base64-Zufall grün", () => {
    // Regressionsschutz für die Design-Entscheidung oben: die Datei wird NICHT ausgeschlossen,
    // sondern korrekt bewertet. Die echten Begriffe kommen dekodiert aus dem Skript, damit
    // hier kein Klartext steht.
    assert.equal(isCheckable("fonts.css"), true, "fonts.css darf nicht pauschal ausgeschlossen werden.");
    const raw = readRepo("fonts.css");
    const terms = decodeTerms();
    const naive = terms.some((t) => raw.toLowerCase().includes(t.toLowerCase()));
    assert.equal(naive, true, "Annahme dieses Tests: ein naiver Substring-Match würde hier treffen.");
    assert.deepEqual(findViolations(["fonts.css"], terms, () => raw), [], "Mit Wortgrenzen muss es grün sein.");
  });

  test("die Begriffsliste ist nicht leer und steht nirgends im Klartext im Repo", () => {
    assert.ok(ENCODED_TERMS.length > 0, "Eine leere Liste wäre ein stiller No-op.");
    // Jeder Begriff muss dekodierbar und nicht-trivial sein; der Klartext-Test ist der
    // runCheck() oben (er würde das Skript/den Test selbst mit erfassen).
    for (const term of decodeTerms()) assert.ok(term.length >= 3, "Zu kurze Begriffe erzeugen nur Rauschen.");
  });

  test("Kodierung ist ein verlustfreier Roundtrip", () => {
    assert.deepEqual(decodeTerms([encodeTerm(DUMMY)]), [DUMMY]);
    assert.deepEqual(decodeTerms(decodeTerms().map(encodeTerm)), decodeTerms());
  });

  test("Binärassets und das Lockfile sind ausgeschlossen, Quelltext nicht", () => {
    assert.equal(isCheckable("package-lock.json"), false, "base64-Integrity-Hashes erzeugen Rauschen.");
    assert.equal(isCheckable("assets/pixellab/held.png"), false);
    assert.equal(isCheckable("assets/fonts/silkscreen.woff2"), false);
    assert.equal(isCheckable("AGENTS.md"), true);
    assert.equal(isCheckable("src/game.ts"), true);
    assert.equal(isCheckable("docs/agent-harness.md"), true);
  });

  test("mehrere Fundstellen werden je Zeile einzeln gemeldet", () => {
    const hits = findViolations(["a.md"], [DUMMY], () => `erste ${DUMMY}\nharmlos\ndritte ${DUMMY}`);
    assert.deepEqual(
      hits.map((h) => h.line),
      [1, 3],
      "Jede betroffene Zeile soll einzeln auffindbar sein.",
    );
  });

  test("nicht lesbare Dateien kippen das Gate nicht (fail-open wie check:diffsize)", () => {
    const hits = findViolations(["weg.md", "da.md"], [DUMMY], (f) => {
      if (f === "weg.md") throw new Error("ENOENT");
      return `hier steht ${DUMMY}`;
    });
    assert.deepEqual(
      hits.map((h) => h.file),
      ["da.md"],
      "Eine unlesbare Datei wird übersprungen, die lesbare weiter geprüft.",
    );
  });
});
