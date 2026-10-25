/* Projektinhalt der Kontextdatei und der Projekt-Config (#1903): die Projektliterale und die Projekt-Leitfrage des Spiels.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel (kein eigenes check-Skript), darum im geschützten test/harness/ (#1165).
 *
 * Die Kern-Tests prüfen nur die Mechanik (jedes Projektliteral der Config zählt, im Kern steht keins) und bleiben literalfrei
 * (Null-Regel); was ein Projekt konkret in Config und Projekt-Block trägt, prüft dieser Projekt-Test. Er zieht nicht ins Factory-Repo.
 *
 * Grenze: geprüft wird nur, dass die Pflicht-Begriffe in der Config stehen und die Leitfrage samt Messlatten-Zeile im Projekt-Block
 * der AGENTS.md; die Bedeutung des Textes prüft kein Wächter. Dieser Test importiert nichts aus einer anderen `*.test.ts`. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { projektConfig } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { PROJEKT_BLOCK_ENDE, PROJEKT_BLOCK_START } from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { SPIEL_QUOTE } from "../../scripts/spielquote-lib.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const agents = readFileSync(WURZEL + "AGENTS.md", "utf8").replace(/\r\n/g, "\n");
const projektBlock = agents.slice(agents.indexOf(PROJEKT_BLOCK_START as string), agents.indexOf(PROJEKT_BLOCK_ENDE as string));

describe("Projektliterale der Config (#1843, #1903)", () => {
  // Pflicht-Begriffe: Dev-Helfer, Anti-Corruption-Begriff, Engine-Name und Referenzspiel; je ein Projektwort, das der Begriff treffen muss.
  const pflicht: [string, string][] = [
    ["Stardew", "STARDEW"],
    ["kqDev", "kqDev"],
    ["Hafen", "Hafen"],
    ["Phaser", "Phaser.Scene"],
  ];
  test.each(pflicht)("projektliterale.%s steht in der Projekt-Config und trifft das Projektwort %s, sonst wäre der Wächter still aus", (begriff, wort) => {
    const wert = projektConfig().projektliterale?.[begriff];
    assert.ok(wert, `projektliterale.${begriff} fehlt`);
    // ganzes Wort wie beim Wächter (Wortgrenzen), ohne seine Regex nachzubauen: ein verkürzter Wert („phase“ für „phaser“) trifft nicht mehr
    const woerter = wort.toLowerCase().split(/[^\p{L}\p{N}_]+/u);
    assert.ok(woerter.includes(wert.toLowerCase()), `${begriff} trifft ${wort} nicht als ganzes Wort`);
  });
});

describe("Projekt-Block der AGENTS.md (#1709, #1903)", () => {
  test("die Projekt-Leitfrage nennt das Referenzspiel", () => {
    assert.match(projektBlock, /\*\*Projekt-Leitfrage\*\*[^\n]*Stardew/);
  });
  test("die Optik-Messlatte nennt ihre Referenzdatei, und die Datei existiert", () => {
    const messlatte = projektBlock.split("\n").find((z) => z.includes("Optik-Messlatte") && z.includes("docs/stardew-referenz.md"));
    assert.ok(messlatte, "der Projekt-Block nennt die Optik-Messlatte mit ihrer Referenzdatei");
    assert.ok(existsSync(WURZEL + "docs/stardew-referenz.md"), "die Referenzdatei existiert");
  });
  test("der Projekt-Block trägt den Projektteil der Ticket-Auswahl (--bereich spiel, Spielquote) (#1932)", () => {
    assert.match(projektBlock, /--bereich spiel/);
    assert.match(projektBlock, /Spielquote/);
  });
  test("die Spielquote im Projekt-Block ist an die Konstante der Auswahl gebunden (#1663 T5, #1935)", () => {
    const quote = SPIEL_QUOTE as number;
    const zahlen = (re: RegExp): number[] => [...projektBlock.matchAll(re)].map((m) => Number(m[1]));
    for (const re of [/nach (\d+) Produkt-Merges \(Spielquote 1:\d+/g, /Spielquote 1:(\d+)/g]) {
      const z = zahlen(re);
      assert.ok(z.length >= 1, `Muster ${re} trifft zu selten`);
      assert.deepEqual(z.filter((n) => n !== quote), [], `Muster ${re}: ${z.join(", ")} statt ${quote}`);
    }
  });
});
