/* Umlaut-Wächter (#1711, ADR 0022 F8): „Deutsch mit echten Umlauten“ ist ein Projektwert (`sprache.umschrift` in .factory/projekt.json).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Scan-Umfang (geschlossene Liste): getrackte `docs/**\/*.md` ohne `docs/adr/`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `src/**\/AGENTS.md`,
 * `.claude/agents/*.md`, `.claude/skills/*\/*.md`.
 * Bekannte Muster: genau die Wörter der Liste `sprache.umschrift` (ASCII-Umschrift eines Umlauts, etwa „fuer“ für „für“), ohne Beachtung der Schreibweise,
 * als ganzes Wort. Ausgeblendet: Code-Fences, Inline-Code, Link-Ziele, HTML-Tags und jedes Wort, das direkt an `-`, `/` oder `_` hängt oder vor einem
 * Punkt mit Buchstabe/Ziffer steht (`fuer.md`) bzw. hinter einem Punkt (`a.fuer`): Dateinamen, Bezeichner, Pfade bleiben ASCII. Ein Punkt am Satzende
 * blendet nichts aus. Ein Teil eines Bindestrich-Worts („Asset-Aenderung“) zählt als Bezeichner und wird nicht gemeldet.
 * Bekannte Grenze: Code-Kommentare, Spieltexte (`src/content/data/`), Commit-Texte, ADRs (historisch) und alle Wörter außerhalb der Liste prüft er nicht;
 * ein neues Umschrift-Wort kommt in die Liste der Config, nicht in diesen Test.
 * Fehlt `sprache.umschrift`, bricht er ab (`umschriftAus`), es gibt keinen stillen Deutsch-Standardwert. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";
import { echteConfig, umschriftAus } from "../support/echte-sprache";

const listTrackedFiles = (checkBasis as unknown as { listTrackedFiles: (rootDir?: string) => string[] }).listTrackedFiles;

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

const IM_SCOPE = (f: string): boolean =>
  /^docs\/(?!adr\/).+\.md$/.test(f) ||
  /^(?:AGENTS|README|CONTRIBUTING)\.md$/.test(f) ||
  /^src\/(?:.+\/)?AGENTS\.md$/.test(f) ||
  /^\.claude\/agents\/[^/]+\.md$/.test(f) ||
  /^\.claude\/skills\/[^/]+\/[^/]+\.md$/.test(f);

interface Fund {
  zeile: number;
  wort: string;
}

/** Fundstellen der Umschrift-Wörter in einem Markdown-Text (siehe Kopfkommentar für das Ausgeblendete). */
function findeUmschrift(text: string, woerter: string[]): Fund[] {
  if (woerter.length === 0) return [];
  const treffer = new RegExp(`(?<![\\p{L}\\p{N}_./\\-])(${woerter.join("|")})(?![\\p{L}\\p{N}_/\\-]|\\.[\\p{L}\\p{N}])`, "giu");
  const funde: Fund[] = [];
  let fence = false;
  text.split(/\r?\n/).forEach((zeile, i) => {
    if (/^\s*(?:```|~~~)/.test(zeile)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const sichtbar = zeile.replace(/`[^`]*`/g, " ").replace(/\]\([^)]*\)/g, "]").replace(/<[^>]+>/g, " ");
    for (const m of sichtbar.matchAll(treffer)) funde.push({ zeile: i + 1, wort: m[1].toLowerCase() });
  });
  return funde;
}

const WOERTER = ["fuer", "ueber", "naechstes", "pruefen"];

describe("findeUmschrift: Muster und Negativfälle", () => {
  test("ein Umlaut-Verstoß wird erkannt, mit Zeile und Wort (auch großgeschrieben)", () => {
    assert.deepEqual(findeUmschrift("Das ist fuer dich", WOERTER), [{ zeile: 1, wort: "fuer" }]);
    assert.deepEqual(findeUmschrift("ok\nFuer jeden", WOERTER), [{ zeile: 2, wort: "fuer" }]);
    assert.deepEqual(findeUmschrift("naechstes und pruefen", WOERTER).map((f) => f.wort), ["naechstes", "pruefen"]);
  });
  test("echte Umlaute und Wörter außerhalb der Liste sind kein Fund", () => {
    assert.deepEqual(findeUmschrift("Für dich, über alles, nächstes Ticket, prüfen", WOERTER), []);
    assert.deepEqual(findeUmschrift("fuerst und Zufuer und a.fuer", WOERTER), [], "nur ganze Wörter, auch hinter einem Punkt");
  });
  test("Code, Link-Ziele, HTML und Bezeichner werden ausgeblendet", () => {
    assert.deepEqual(findeUmschrift("`fuer` und `a fuer b`", WOERTER), []);
    assert.deepEqual(findeUmschrift("[Text](docs/fuer.md) und [x](fuer)", WOERTER), []);
    assert.deepEqual(findeUmschrift('<a href="fuer">x</a>', WOERTER), []);
    assert.deepEqual(findeUmschrift("naechstes-ticket.mjs, flag-fuer, a/fuer, fuer_x, x_fuer, ueber.md", WOERTER), []);
    assert.deepEqual(findeUmschrift("```\nfuer\n```\nund fuer", WOERTER), [{ zeile: 4, wort: "fuer" }], "Fence-Inhalt zählt nicht, Text danach schon");
    assert.deepEqual(findeUmschrift("~~~\nfuer\n~~~", WOERTER), []);
  });
  test("Randfälle: Satzende, Ziffern, Pfad-Schrägstrich, CRLF, eingerückter Fence", () => {
    assert.deepEqual(findeUmschrift("Das ist fuer.\nEs geht ueber, pruefen.", WOERTER).map((f) => f.wort), ["fuer", "ueber", "pruefen"], "ein Punkt am Satzende ist kein Dateiname");
    assert.deepEqual(findeUmschrift("fuer2 und 2fuer und fuer/x und a/fuer", WOERTER), [], "Ziffern und Schrägstrich hängen am Bezeichner");
    assert.deepEqual(findeUmschrift("ok\r\nDas ist fuer dich\r\n", WOERTER), [{ zeile: 2, wort: "fuer" }]);
    assert.deepEqual(findeUmschrift("  ```yaml\n  fuer\n  ```\nfuer", WOERTER), [{ zeile: 4, wort: "fuer" }], "eingerückter Fence blendet aus");
  });
  test("die Wortliste kommt von außen: ohne das Wort kein Fund, mit leerer Liste nie", () => {
    assert.deepEqual(findeUmschrift("fuer dich", ["ueber"]), []);
    assert.deepEqual(findeUmschrift("fuer dich", []), []);
  });
  test("Negativfall: eine Config ohne sprache.umschrift bricht ab (kein stiller Deutsch-Standardwert)", () => {
    assert.throws(() => umschriftAus({}), /sprache\.umschrift[\s\S]*Fix:/);
    assert.throws(() => umschriftAus({ sprache: { umschrift: [] } }), /sprache\.umschrift/);
  });
});

describe("Scan-Umfang", () => {
  test("geschlossene Liste: Docs ohne ADRs, Wurzeldateien, Modul-AGENTS, Agenten und Skills", () => {
    for (const f of ["docs/referenz/befehle.md", "docs/agent-harness.md", "AGENTS.md", "README.md", "CONTRIBUTING.md", "src/AGENTS.md", "src/content/AGENTS.md", ".claude/agents/factory-lens.md", ".claude/skills/review-lenses/SKILL.md"]) {
      assert.equal(IM_SCOPE(f), true, f);
    }
    for (const f of ["docs/adr/0022-x.md", "docs/x.json", "src/ui/x.ts", "src/content/data/quests/knut.json", "CHANGELOG.md", ".claude/worktrees/kq-1/AGENTS.md", ".claude/agents/x/y.md", ".claude/skills/x/y/z.md"]) {
      assert.equal(IM_SCOPE(f), false, f);
    }
  });
});

describe("Umlaut-Wächter über die echte Fläche", () => {
  test("keine ASCII-Umschrift aus sprache.umschrift in Docs, Agenten und Skills", () => {
    const woerter = umschriftAus(echteConfig());
    const dateien = listTrackedFiles(WURZEL).filter(IM_SCOPE);
    assert.ok(dateien.length > 50, "Dateiliste unerwartet klein: git ls-files fehlgeschlagen?");
    const meldungen = dateien.flatMap((f) => findeUmschrift(readFileSync(WURZEL + f, "utf8"), woerter).map((x) => `${f}:${x.zeile}: ${x.wort}`));
    assert.deepEqual(meldungen, [], `ASCII-Umschrift statt Umlaut (Regel: Deutsch mit echten Umlauten):\n${meldungen.join("\n")}\nFix: den Umlaut setzen; ein Bezeichner oder Pfad gehört in Backticks.`);
  });
});
