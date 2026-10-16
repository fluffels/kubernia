/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (#1460 Z4). */
/* Board-Top der Forum-Action (#644/#747) — struktureller Guard (Fitness-Function).
 *
 * Die Action forum-inbox.yml fügt beim Anlegen eines neuen Inbox-Issues das Issue
 * per addProjectV2ItemById zum Board hinzu und schiebt es via updateProjectV2ItemPosition
 * an die OBERSTE Board-Position. Seit #747 lebt die Reihenfolge als Board-Position (Drag &
 * Drop). Dieser Test bewacht, dass die Board-Verdrahtung nicht still verschwindet — bewusst
 * eine Struktur-/Doku-Prüfung (wie docmap/filesize), keine Verhaltensprüfung (ein
 * YAML-Workflow ist im Node-Test nicht ausführbar). Red-Green: entfernt man die
 * Verdrahtung, wird er rot.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const yml = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/forum-inbox.yml", import.meta.url)),
  "utf8",
);

describe("Forum-Action fügt Issue zum Board hinzu (#644)", () => {
  test("liest ein PROJECT_TOKEN-Secret (GITHUB_TOKEN kann kein User-Project V2 schreiben)", () => {
    assert.match(yml, /PROJECT_TOKEN:\s*\$\{\{\s*secrets\.PROJECT_TOKEN\s*\}\}/);
  });

  test("ruft board-place.mjs mit Notfall-Art und Issue-Nummer auf, kein eigenes GraphQL im Workflow (#1628)", () => {
    assert.ok(yml.includes('nr="${new_url##*/}"'), "Nummer muss aus der create-Ausgabe gezogen werden");
    assert.ok(
      yml.includes('node scripts/board-place.mjs --notfall forum --top "$nr"'),
      "board-place.mjs --notfall forum --top <nr> muss nach gh issue create laufen",
    );
    assert.ok(!yml.includes("addProjectV2ItemById"), "die Mutationen liegen in board-lib, nicht im Workflow");
    assert.ok(!yml.includes("set_board_top"), "die alte Shell-Funktion ist ersetzt");
    assert.doesNotMatch(yml, /\bPVT[A-Z]*_[A-Za-z0-9_-]{6,}/, "Board-Node-ID darf nicht im Workflow stehen");
  });

  test("checkt das Repo aus und richtet Node ein (Voraussetzung für board-place.mjs)", () => {
    assert.match(yml, /actions\/checkout@v7/);
    assert.match(yml, /actions\/setup-node@v7\n\s+(?:continue-on-error: true\n\s+)?with:\n\s+node-version-file: \.nvmrc/);
    assert.doesNotMatch(yml, /sparse-checkout:/, "die Import-Hülle von board-place.mjs ist groß: volles Repo");
  });

  test("bleibt rot, wenn die Position endgültig scheitert (kein stilles `return 0`, #1628)", () => {
    assert.match(
      yml,
      /elif ! GH_TOKEN="\$PROJECT_TOKEN" node scripts\/board-place\.mjs[^\n]*\n\s*echo "::error::[^\n]*"\n\s*exit 1\n\s*fi/,
      "Fehlschlag muss ::error:: melden und mit exit 1 enden",
    );
    assert.doesNotMatch(yml, /return 0/, "kein stilles Weiterlaufen");
  });

  test("degradiert ohne Secret graceful (nur Warnung, kein harter Abbruch)", () => {
    assert.ok(
      yml.includes('if [ -z "${PROJECT_TOKEN:-}" ]'),
      "leeres Secret muss abgefangen werden",
    );
    assert.match(yml, /::warning::[^\n]*PROJECT_TOKEN/);
  });

  test("Fremdtext nirgends eingebettet: kein Discussion-Titel in Env, Issue-Titel oder Body (#1663 L27)", () => {
    const code = yml.split("\n").filter((z) => !z.trimStart().startsWith("#")).join("\n");
    assert.doesNotMatch(code, /DISC_TITLE/, "der Titel der Discussion darf nicht in den Lauf");
    assert.doesNotMatch(code, /discussion\.title/);
    assert.doesNotMatch(code, /safe_title|forum-sanitize/, "ohne eingebetteten Fremdtext keine Entschärfung nötig");
    assert.match(code, /--title "\$\{marker\}[^$"]*"/, "Issue-Titel nur Marker mit Nummer plus fester Text");
  });

  /* #1663 H8: Positivliste statt Titel-Bezeichner. Erlaubt sind nur Zahlen, URLs und Namen, die GitHub selbst vergibt; jedes Feld mit
   * frei wählbarem Text (title, body, Labels, Branch- und Kommentartexte) wäre eingebetteter Fremdtext. */
  const ERLAUBTE_AUSDRUECKE = new Set([
    "github.token",
    "github.repository",
    "github.event_name",
    "github.event.discussion.number",
    "github.event.discussion.html_url",
    "github.event.comment.html_url",
    "github.event.sender.login",
    "secrets.PROJECT_TOKEN",
  ]);
  const unerlaubteAusdruecke = (text: string): string[] =>
    [...text.matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]).filter((a) => !ERLAUBTE_AUSDRUECKE.has(a));

  test("nur Ausdrücke der Positivliste, kein eingebetteter Freitext (#1663 H8)", () => {
    assert.deepEqual(unerlaubteAusdruecke(yml), []);
  });

  test("Negativfall: ein eingebettetes discussion.body oder discussion.title wird erkannt", () => {
    assert.deepEqual(unerlaubteAusdruecke("env:\n  X: ${{ github.event.discussion.body }}\n  Y: ${{github.event.discussion.title}}"), ["github.event.discussion.body", "github.event.discussion.title"]);
    assert.deepEqual(unerlaubteAusdruecke("run: |\n  # Titel: ${{ github.event.discussion.title }}\n  A: ${{ github.repository }}"), ["github.event.discussion.title"], "auch Kommentarzeilen: Actions setzt dort ein");
  });

  test("fügt das NEU angelegte Issue zum Board hinzu (Aufruf hängt an gh issue create)", () => {
    assert.ok(
      yml.includes("new_url=$(gh issue create"),
      "die create-Ausgabe muss als URL erfasst werden",
    );
  });
});
