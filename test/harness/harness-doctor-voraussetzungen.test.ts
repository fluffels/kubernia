/* Wächter des Harness-Doctors (#1799, ADR 0022): jede Voraussetzung, die ein Workflow oder ein Skript liest, hat einen Prüfpunkt in
 * `scripts/harness-doctor.mjs`. Drei Scanner, unabhängig von der Ableitung des Doctors (eigene, breitere Muster, fail-closed):
 *   1. `secrets.X` und `vars.X` in den Workflows (inkl. Kommentare) stehen in `secrets`/`variablen` der Ableitung;
 *   2. Label-Literale (Workflows: `--label`/`--add-label`/Env `*LABEL*:`, Skripte: `"--label", "<v>"`) stehen in `labels`; jeder gelesene
 *      Config-Schlüssel `labels.<k>` bzw. `labelAus(…, "<k>")` existiert in der Config;
 *   3. Project-Felder: jeder Board-Schlüssel der Config, den ein Skript liest (außer `rolle`), ist ein Prüfpunkt; jedes Feld, das ein Skript
 *      per Name liest (REST `fields.find((f) => f.name === "X")`, GraphQL `field(name: "X")`), heißt wie das Status-Feld des Doctors; die
 *      Statusvergleiche der Board-Skripte (nennen `statusFeld` oder importieren `board-lib.mjs`) sind die Todo-Option des Doctors.
 *   4. Die Vorlage der Wochenlauf-Datei, die `--einrichten` installiert (WOCHENLAUF_WORKFLOW), ist die Datei im Repo (Zeilenenden egal).
 * Bekannte Grenzen: nur Literale und die genannten Schreibweisen; ein Label aus einer Berechnung oder `secrets[...]` sieht kein Scanner.
 * Gescannt wird `scripts/*.mjs` auf oberster Ebene (nicht rekursiv, keine `.cjs`). Feldzugriffe mit einfachen Anführungszeichen,
 * umgedrehtem Vergleich, Destructuring, `.filter`/`.some` oder einer Variablen als Feldname erkennt der Feld-Scanner nicht.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FREMD } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDoctor from "../../scripts/harness-doctor.mjs";

interface Vor { secrets: string[]; variablen: string[]; labels: string[] }
interface Doctor {
  voraussetzungenAus(a: { config: unknown; workflows: { pfad: string; text: string }[] }): Vor;
  BOARD_PRUEFPUNKTE: string[];
  STATUS_FELD_NAME: string;
  TODO_OPTION_NAME: string;
  WOCHENLAUF_PFAD: string;
  WOCHENLAUF_WORKFLOW: string;
}
const doctor = rawDoctor as unknown as Doctor;
const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lies = (rel: string): string => readFileSync(WURZEL + rel, "utf8");
const dateien = (ordner: string, ende: RegExp): { pfad: string; text: string }[] =>
  readdirSync(WURZEL + ordner).filter((f) => ende.test(f)).map((f) => ({ pfad: `${ordner}/${f}`, text: lies(`${ordner}/${f}`) }));

/** Pure Scanner (mit Fixtures getestet, damit sie nicht vakuös sind). */
const secretsUndVars = (text: string): { art: string; name: string }[] =>
  [...text.matchAll(/\b(secrets|vars)\.([A-Za-z_]\w*)/g)].map((m) => ({ art: m[1], name: m[2] })).filter((x) => x.name !== "GITHUB_TOKEN");
const labelLiterale = (text: string): string[] => {
  const aus: string[] = [];
  for (const m of text.matchAll(/--(?:add-)?label[ =]+["']?([^\s"'$\\]+)["']?/g)) aus.push(...m[1].split(","));
  for (const m of text.matchAll(/^\s*\w*LABEL\w*:\s*["']?([^\s"'$]+)["']?\s*$/gm)) if (!m[1].includes("{{")) aus.push(m[1]);
  return aus;
};
const skriptLabels = (text: string): string[] => [...text.matchAll(/"--(?:add-)?label",\s*"([^"$]+)"/g)].map((m) => m[1]);
const gelesenerSchluessel = (text: string): string[] => [
  ...[...text.matchAll(/labelAus\(\s*[^,()]+,\s*"(\w+)"\s*\)/g)].map((m) => m[1]),
  ...[...text.matchAll(/\b(?:config|PROJEKT|cfg)\??\.labels\??\.(\w+)/g)].map((m) => m[1]),
];
const boardSchluesselGelesen = (text: string, schluessel: string[]): string[] => schluessel.filter((k) => new RegExp(`\\.${k}\\b`).test(text));
/** Feldnamen, die ein Skript liest: `fields.find((f) => f.name === "X")` (REST-Items) und `field(name: "X")`/`fieldValueByName(name: "X")` (GraphQL). */
const feldNamen = (text: string): string[] => [
  ...[...text.matchAll(/\bfields\??\.find\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\??\.name\s*===\s*"([^"]+)"/g)].map((m) => m[2]),
  ...[...text.matchAll(/\bfield(?:ValueByName)?\(\s*name:\s*\\?"([^"\\]+)\\?"/g)].map((m) => m[1]),
];
/** Ein Board-Skript liest Board-Items: es nennt `statusFeld` oder importiert `board-lib.mjs`. */
const boardSkript = (text: string): boolean => text.includes("statusFeld") || /from\s+"\.\/board-lib\.mjs"/.test(text);
const optionVergleiche = (text: string): string[] => [...text.matchAll(/\bstatus\s*[!=]==\s*"([^"]+)"/g)].map((m) => m[1]);

const config = JSON.parse(lies(".factory/projekt.json")) as { labels: Record<string, string>; boards: Record<string, unknown>[] };
const workflows = dateien(".github/workflows", /\.ya?ml$/);
const skripte = dateien("scripts", /\.mjs$/).filter((s) => !["scripts/harness-doctor.mjs", "scripts/harness-doctor-lib.mjs"].includes(s.pfad));
const vor = doctor.voraussetzungenAus({ config, workflows });
const ohneCase = (liste: string[]): Set<string> => new Set(liste.map((l) => l.toLowerCase()));

describe("Scanner (Fixtures, nicht vakuös)", () => {
  test("secrets und vars, auch im Kommentar; GITHUB_TOKEN ausgenommen", () => {
    assert.deepEqual(secretsUndVars("# ${{ vars.FOO }} ${{ secrets.BAR }} ${{ secrets.GITHUB_TOKEN }}"), [{ art: "vars", name: "FOO" }, { art: "secrets", name: "BAR" }]);
  });
  test("Label-Literale und gelesene Schlüssel", () => {
    assert.deepEqual(labelLiterale('gh x --label forum --label "$V" --add-label a:b,c:d\n  ALARM_LABEL: area:x\n  L: ${{ y }}'), ["forum", "a:b", "c:d"].concat(["area:x"]));
    assert.deepEqual(skriptLabels(`["--label", "${FREMD.labels.harness}", "--label", label]`), [FREMD.labels.harness]);
    assert.deepEqual(gelesenerSchluessel('labelAus(config, "harness") config.labels.forum labels.some(x)'), ["harness", "forum"]);
  });
  test("Board-Schlüssel und Vergleichsliterale", () => {
    assert.deepEqual(boardSchluesselGelesen("b.projectId + x.rolle", ["projectId", "neu", "rolle"]), ["projectId", "rolle"]);
    assert.deepEqual(feldNamen('i.fields?.find((f) => f?.name === "Status")?.value; fields.find(f => f.name === "Aufwand")'), ["Status", "Aufwand"]);
    assert.deepEqual(feldNamen('gql(`{ field(name: "Aufwand") { id } fieldValueByName(name: \\"Prio\\") }`)'), ["Aufwand", "Prio"]);
    assert.deepEqual(feldNamen('x.find((c) => c.name === "npm")'), []);
    assert.deepEqual(feldNamen('fields.find((f) => g.name === "X")'), []);
    assert.deepEqual(feldNamen('myfields.find((f) => f.name === "X"); subfield(name: "X")'), []);
    assert.deepEqual(boardSkript('import { a } from "./board-lib.mjs"; i.status === "Blocked"'), true);
    assert.deepEqual(boardSkript('x.status === "ok"'), false);
    assert.deepEqual(boardSkript("const { statusFeld } = board; i.status === 'x'"), true);
    assert.deepEqual(optionVergleiche('i.status !== "Todo"'), ["Todo"]);
  });
  test("ein ungedecktes vars.FOO fällt auf (Negativfall)", () => {
    const v = doctor.voraussetzungenAus({ config, workflows: [{ pfad: "x.yml", text: "a: ${{ vars.FOO }}" }] });
    assert.ok(v.variablen.includes("FOO"));
    assert.ok(!doctor.voraussetzungenAus({ config, workflows: [] }).variablen.includes("FOO"));
  });
});

describe("Voraussetzungen des Repos sind Prüfpunkte des Harness-Doctors", () => {
  test("jedes secrets.X und vars.X der Workflows steht in der Ableitung", () => {
    const funde = workflows.flatMap((w) => secretsUndVars(w.text));
    assert.ok(funde.length > 0, "Scanner fand kein einziges Secret: vakuös");
    for (const { art, name } of funde) {
      const liste = art === "secrets" ? vor.secrets : vor.variablen;
      assert.ok(liste.includes(name), `${art}.${name} wird in den Workflows gelesen, hat aber keinen Prüfpunkt im Harness-Doctor`);
    }
  });

  test("jedes Label-Literal der Workflows und Skripte steht in der Ableitung", () => {
    const soll = ohneCase(vor.labels);
    const funde = [...workflows.flatMap((w) => labelLiterale(w.text)), ...skripte.flatMap((s) => skriptLabels(s.text))];
    assert.ok(funde.length > 0, "Scanner fand kein Label: vakuös");
    for (const l of funde) assert.ok(soll.has(l.toLowerCase()), `Label "${l}" wird gelesen, hat aber keinen Prüfpunkt im Harness-Doctor (Config-Label oder Workflow-Literal)`);
  });

  test("jeder gelesene Label-Schlüssel existiert in der Config", () => {
    const gelesen = skripte.flatMap((s) => gelesenerSchluessel(s.text));
    assert.ok(gelesen.length > 0, "Scanner fand keinen Schlüssel: vakuös");
    for (const k of gelesen) assert.ok(Object.hasOwn(config.labels, k), `labels.${k} wird gelesen, fehlt aber in .factory/projekt.json`);
  });

  test("jedes Project-Feld der Config, das ein Skript liest, ist ein Prüfpunkt (rolle: intern, keine GitHub-Voraussetzung)", () => {
    const schluessel = Object.keys(config.boards[0]).filter((k) => k !== "rolle");
    const gelesen = new Set(skripte.flatMap((s) => boardSchluesselGelesen(s.text, schluessel)));
    assert.ok(gelesen.has("statusFeldNodeId"), "Scanner fand kein Board-Feld: vakuös");
    for (const k of gelesen) assert.ok(doctor.BOARD_PRUEFPUNKTE.includes(k), `Board-Schlüssel ${k} wird gelesen, hat aber keinen Prüfpunkt im Harness-Doctor`);
  });

  test("jedes Project-Feld, das ein Skript per Name liest, ist das Status-Feld des Doctors", () => {
    const funde = skripte.flatMap((s) => feldNamen(s.text).map((name) => ({ pfad: s.pfad, name })));
    assert.ok(funde.length > 0, "Scanner fand kein Feld: vakuös");
    for (const f of funde) assert.equal(f.name, doctor.STATUS_FELD_NAME, `${f.pfad} liest das Project-Feld "${f.name}", das der Harness-Doctor nicht prüft`);
  });

  test("Todo-Option: die Statusvergleiche der Board-Skripte sind die des Doctors", () => {
    const funde = skripte.filter((s) => boardSkript(s.text)).flatMap((s) => optionVergleiche(s.text));
    assert.ok(funde.length > 0, "Scanner fand keinen Vergleich: vakuös");
    for (const o of funde) assert.equal(o, doctor.TODO_OPTION_NAME);
  });

  test("die Vorlage der Wochenlauf-Datei ist die Datei im Repo (#1800)", () => {
    assert.equal(lies(doctor.WOCHENLAUF_PFAD).replace(/\r\n/g, "\n"), doctor.WOCHENLAUF_WORKFLOW);
  });
});
