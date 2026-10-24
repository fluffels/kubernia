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
import { escapeRegex } from "../../scripts/ticket-namen.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const esc = (s: string): string => (escapeRegex as (t: string) => string)(s);
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
    assert.ok(new RegExp(esc(wert), "iu").test(wort), `${begriff} trifft ${wort} nicht`);
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
});
