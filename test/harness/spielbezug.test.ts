/* Projektinhalt der Kontextdatei und der Projekt-Config (#1903): die Projektliterale und die Projekt-Leitfrage des Spiels.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel (kein eigenes check-Skript), darum im geschützten test/harness/ (#1165).
 *
 * Die Kern-Tests prüfen nur die Mechanik (jedes Projektliteral der Config zählt, im Kern steht keins) und bleiben literalfrei
 * (Null-Regel); was ein Projekt konkret in Config und Projekt-Block trägt, prüft dieser Projekt-Test. Er zieht nicht ins Factory-Repo.
 *
 * Grenze: geprüft wird nur, dass die Pflicht-Begriffe in der Config stehen und die Leitfrage samt Messlatten-Zeile im Projekt-Block
 * der AGENTS.md; die Bedeutung des Textes prüft kein Wächter. Der Spielwort-Wächter (#1943, #1942) prüft den Kern (alle Einheiten der Besitz-Ringe), die Skill-Quelle und die
 * Projekt-Vorlagen, nicht die Factory-Seiten. Dieser Test importiert nichts aus einer anderen `*.test.ts`. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { projektConfig } from "../support/fremd-config";
import { ladeBesitzManifest } from "../support/besitz-anker";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as projektLib from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { PROJEKT_BLOCK_ENDE, PROJEKT_BLOCK_START, einheitText as einheitTextRoh } from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { PRODUKT_QUOTE } from "../../scripts/produktquote-lib.mjs";

const ROLLEN_PFADE = (projektLib as unknown as { ROLLEN_PFADE: Record<string, string> }).ROLLEN_PFADE;
const einheitText = einheitTextRoh as (e: unknown, text: string) => string | null;
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
  test("der Projekt-Block trägt den Projektteil der Ticket-Auswahl (--bereich produkt, Spielquote) (#1932, #1943)", () => {
    assert.match(projektBlock, /--bereich produkt/);
    assert.match(projektBlock, /Spielquote/);
  });
  test("der Alias spiel kommt aus der Projekt-Config und führt auf den Kern-Bereich produkt (#1943)", () => {
    const config = projektConfig() as unknown as { bereiche?: { aliase?: Record<string, string> } };
    assert.equal(config.bereiche?.aliase?.spiel, "produkt");
  });
  test("die Spielquote im Projekt-Block ist an die Konstante der Auswahl gebunden (#1663 T5, #1935)", () => {
    const quote = PRODUKT_QUOTE as number;
    const zahlen = (re: RegExp): number[] => [...projektBlock.matchAll(re)].map((m) => Number(m[1]));
    for (const re of [/nach (\d+) Produkt-Merges \(Spielquote 1:\d+/g, /Spielquote 1:(\d+)/g]) {
      const z = zahlen(re);
      assert.ok(z.length >= 1, `Muster ${re} trifft zu selten`);
      assert.deepEqual(z.filter((n) => n !== quote), [], `Muster ${re}: ${z.join(", ")} statt ${quote}`);
    }
  });
});

describe("Bereichs-Alias der Projekt-Config (#1943)", () => {
  test("die Config führt den Alias spiel auf produkt", () => {
    const bereichAliaseAus = (projektLib as unknown as { bereichAliaseAus: (c: unknown) => Record<string, string> }).bereichAliaseAus;
    assert.deepEqual(bereichAliaseAus(JSON.parse(readFileSync(WURZEL + ".factory/projekt.json", "utf8"))), { spiel: "produkt" });
  });
  test("der Direktaufruf von naechstes-ticket löst den Alias der Repo-Config auf (--bereich spiel zusammen mit --ticket ist der Ausschluss-Fehler, nicht der Wertfehler)", () => {
    const r = spawnSync(process.execPath, ["scripts/naechstes-ticket.mjs", "--bereich", "spiel", "--ticket", "1"], { cwd: WURZEL, encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--ticket und --bereich schließen sich aus/);
  });
});

describe("Kern und Vorlagen ohne Spielwort (#1943, #1942)", () => {
  // Wortanfang „spiel“ ohne Groß-/Kleinschreibung; „Beispiel“ trifft nicht (davor steht ein Buchstabe).
  const SPIELWORT = /(?<!\p{L})spiel/iu;
  const lies = (pfad: string): string | null => (existsSync(WURZEL + pfad) ? readFileSync(WURZEL + pfad, "utf8").replace(/\r\n/g, "\n") : null);
  const vorlagen = (ordner: string): string[] =>
    readdirSync(WURZEL + ordner, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? vorlagen(`${ordner}/${d.name}`) : [`${ordner}/${d.name}`]));
  // Umfang: Einheiten der Ringe kern, kern-nach-entkopplung und oberflaeche (AGENTS.md nur als Kern-Block, ohne Projekt-Block), die Skill-Quelle,
  // der Factory-Skill samt Ablauf und die Projekt-Vorlagen. Grenze: Factory-Seiten (eigene Extraktion) liegen außerhalb.
  const einheiten = (): [string, string][] => {
    const out: [string, string][] = [];
    for (const e of ladeBesitzManifest<{ pfad: string; ring: string; block?: string; schluessel?: string }>().eintraege) {
      const text = lies(e.pfad);
      const einheit = text === null ? null : einheitText(e, text);
      if (einheit !== null) out.push([e.block || e.schluessel ? `${e.pfad} (${e.block ?? e.schluessel})` : e.pfad, einheit]);
    }
    for (const pfad of [".agents/skills/factory/SKILL.md", ".agents/skills/factory/ablauf.md", ROLLEN_PFADE.ticketSkill, ...vorlagen(".factory/produkt/vorlagen")]) {
      const text = lies(pfad);
      if (text !== null) out.push([pfad, text]);
    }
    return out;
  };
  test("der Umfang ist nicht leer und trägt Kern, Oberfläche, Skill-Quelle und Vorlagen", () => {
    const namen = einheiten().map(([n]) => n);
    for (const teil of ["scripts/naechstes-ticket.mjs", ".agents/skills/factory/SKILL.md", ROLLEN_PFADE.ticketSkill, ".factory/produkt/vorlagen/AGENTS.md.vorlage", "AGENTS.md (kern)"]) {
      assert.ok(namen.includes(teil), `${teil} fehlt im Scan`);
    }
    assert.ok(namen.length > 100, `nur ${namen.length} Einheiten`);
  });
  test("keine Einheit nennt ein Spielwort (Produktquote statt Spielquote, Projektunabhängig statt Spielunabhängig)", () => {
    const treffer = einheiten().flatMap(([name, text]) => text.split("\n").map((z, i) => (SPIELWORT.test(z) ? `${name}:${i + 1}: ${z.trim().slice(0, 90)}` : "")).filter(Boolean));
    assert.deepEqual(treffer, []);
  });
  test("das Muster trifft Spielwörter und nicht „Beispiel“", () => {
    for (const ja of ["Spiel-Tickets", "spiel", "Spielquote", "nächstes Spiel", "Spielraum"]) assert.ok(SPIELWORT.test(ja), ja);
    for (const nein of ["Beispiel", "beispielsweise", "Produkt"]) assert.ok(!SPIELWORT.test(nein), nein);
  });
});
