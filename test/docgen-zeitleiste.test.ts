/* Generator `zeitleiste` (#1367): Tabelle „Bitte → Mauer“ aus docs/adr/*.md (Datum, Titel) und einer
 * kleinen Meilenstein-Datei. Läuft gegen ein Fixture-Root; jeder Fehlerfall ist ein Red-Green-Test. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { fixture } from "./support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as zeit from "../scripts/docs-gen/zeitleiste.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as adrModul from "../scripts/docs-gen/adr.mjs";

type Cfg = Record<string, unknown>;
const api = zeit as unknown as {
  zeitleisteGenerator: (ctx: { rootDir: string; config: Cfg }) => string;
};
const adrApi = adrModul as unknown as { adrListeGenerator: (ctx: { rootDir: string; config: Cfg }) => string };

const conf: Cfg = { adr: { ordner: "docs/adr" }, zeitleiste: { meilensteine: "docs/meilensteine.json" } }; // den ADR-Ordner liefert der adr-Block (#1411)
const confAdr: Cfg = { adr: { ordner: "docs/adr" } }; // adr-liste liest nur den eigenen Block (#1398)
const ms = (...e: { datum: unknown; text: unknown }[]) => JSON.stringify({ hinweis: "x", meilensteine: e });
const adrNeu = (nr: string, titel: string, datum: string) => `# ADR ${nr}: ${titel}\n\n> Status: **akzeptiert** · Datum: ${datum} · Ticket: #1\n\n## Status\nText`;
const adrAlt = (nr: string, titel: string, datum: string) => `# ADR ${nr}: ${titel}\n\n- **Status:** akzeptiert (${datum})\n\n## Kontext\nText`;

const run = (files: Record<string, string>, c: Cfg = conf) => api.zeitleisteGenerator({ rootDir: fixture(files), config: c });
const base = (extra: Record<string, string> = {}) => ({
  "docs/adr/0001-eins.md": adrNeu("0001", "Eins", "2026-06-16"),
  "docs/meilensteine.json": ms(),
  ...extra,
});

describe("Generator zeitleiste", () => {
  test("Gutfall: beide Kopfformate, Datum TT.MM.JJJJ, /-absoluter Link, Titel ohne doppeltes „ADR NNNN:“, sortiert", () => {
    const out = run(
      base({
        "docs/adr/0002-zwei.md": adrAlt("0002", "Zwei", "2026-06-12"),
        "docs/meilensteine.json": ms({ datum: "2026-06-14", text: "Etwas | passierte" }, { datum: "2026-06-10", text: "Start" }),
      }),
    );
    const lines = out.split("\n");
    assert.equal(lines[0], "| Datum | Was passierte |");
    assert.deepEqual(lines.slice(2), [
      "| 10.06.2026 | Start |",
      "| 12.06.2026 | [ADR 0002](/docs/adr/0002-zwei.md): Zwei |",
      "| 14.06.2026 | Etwas \\| passierte |",
      "| 16.06.2026 | [ADR 0001](/docs/adr/0001-eins.md): Eins |",
    ]);
  });
  test("Gleichstand: ADR vor Meilenstein, ADRs nach Nummer, Meilensteine in Dateireihenfolge", () => {
    const out = run({
      "docs/adr/0002-b.md": adrNeu("0002", "B", "2026-07-01"),
      "docs/adr/0001-a.md": adrNeu("0001", "A", "2026-07-01"),
      "docs/meilensteine.json": ms({ datum: "2026-07-01", text: "M-zuerst" }, { datum: "2026-07-01", text: "M-danach" }),
    });
    const order = ["ADR 0001", "ADR 0002", "M-zuerst", "M-danach"].map((s) => out.indexOf(s));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(order.every((i) => i > 0));
  });
  test("ADR ohne Datum: wirft und nennt die Datei (Red-Green-Pflicht)", () => {
    assert.throws(
      () => run(base({ "docs/adr/0002-kaputt.md": "# ADR 0002: Kaputt\n\n> Status: **akzeptiert**\n\n## Status\nText" })),
      /0002-kaputt\.md.*kein Datum im Kopf/s,
    );
  });
  test("Datum nur im Rumpf (nach der ersten ##-Überschrift) zählt als fehlend", () => {
    assert.throws(
      () => run(base({ "docs/adr/0002-rumpf.md": "# ADR 0002: Rumpf\n\n## Status\nDatum: 2026-01-01" })),
      /0002-rumpf\.md.*kein Datum im Kopf/s,
    );
  });
  test("„Datum:“ gewinnt gegen andere Daten im Kopf", () => {
    const out = run(
      base({ "docs/adr/0002-x.md": "# ADR 0002: X\n\n- **Status:** ok (2026-01-01) · Datum: 2026-07-03 · Ticket: #5\n\n## Status\n" }),
    );
    assert.ok(out.includes("| 03.07.2026 | [ADR 0002]"));
    assert.ok(!out.includes("01.01.2026"));
  });
  test("ungültiges Kalenderdatum wirft (ADR und Meilenstein)", () => {
    assert.throws(() => run(base({ "docs/adr/0002-x.md": adrNeu("0002", "X", "2026-02-30") })), /0002-x\.md.*ungültiges Datum 2026-02-30/s);
    assert.throws(() => run(base({ "docs/meilensteine.json": ms({ datum: "2026-02-30", text: "t" }) })), /Meilenstein 0/);
  });
  test("H1 fehlt oder Nummer passt nicht zum Dateinamen: wirft", () => {
    assert.throws(() => run(base({ "docs/adr/0002-x.md": "Kein Titel\nDatum: 2026-01-01" })), /0002-x\.md.*# ADR/s);
    assert.throws(() => run(base({ "docs/adr/0002-x.md": adrNeu("0003", "X", "2026-01-01") })), /0002-x\.md.*0003/s);
  });
  test("doppelte ADR-Nummer wirft", () => {
    assert.throws(() => run(base({ "docs/adr/0001-zweite.md": adrNeu("0001", "Z", "2026-01-01") })), /doppelt/);
  });
  test("README.md und Nicht-.md im ADR-Ordner werden ignoriert", () => {
    const out = run(base({ "docs/adr/README.md": "# Index", "docs/adr/notiz.txt": "x", "docs/adr/0002-bild.png": "x" }));
    assert.equal(out.split("\n").length, 3);
  });
  test("Meilenstein ohne text/datum oder falscher Typ: wirft mit Index", () => {
    assert.throws(() => run(base({ "docs/meilensteine.json": ms({ datum: "2026-01-01", text: "a" }, { datum: "2026-01-02", text: "" }) })), /Meilenstein 1.*"text"/);
    assert.throws(() => run(base({ "docs/meilensteine.json": ms({ datum: undefined, text: "a" }) })), /Meilenstein 0.*"datum"/);
    assert.throws(() => run(base({ "docs/meilensteine.json": ms({ datum: "2026-01-01", text: 5 }) })), /Meilenstein 0.*"text"/);
    assert.throws(() => run(base({ "docs/meilensteine.json": ms({ datum: "2026-01-01", text: "   " }) })), /Meilenstein 0.*"text"/);
    assert.throws(() => run(base({ "docs/meilensteine.json": ms({ datum: "2026-06-12x", text: "a" }) })), /Meilenstein 0.*"datum"/);
  });
  test("kaputtes JSON in der Meilenstein-Datei: wirft mit Dateiname und wird mit ADR-Fehlern gesammelt", () => {
    assert.throws(() => run(base({ "docs/meilensteine.json": "{ kaputt" })), /meilensteine\.json ist kein gültiges JSON/);
    assert.throws(() => run(base({ "docs/meilensteine.json": "{ kaputt", "docs/adr/0002-a.md": "# ADR 0002: A\n" })), /0002-a\.md.*meilensteine\.json ist kein gültiges JSON/s);
  });
  test("meilensteine kein Array wirft", () => {
    assert.throws(() => run(base({ "docs/meilensteine.json": JSON.stringify({ meilensteine: "x" }) })), /Array/);
  });
  test("Config-Block, ADR-Ordner oder Datendatei fehlt: wirft", () => {
    assert.throws(() => run(base(), {}), /zeitleiste/);
    assert.throws(() => run(base(), { zeitleiste: { meilensteine: "docs/meilensteine.json" } }), /Config-Block "adr" mit "ordner" fehlt/); // Block adr fehlt
    assert.throws(() => run({ "docs/meilensteine.json": ms() }), /docs\/adr/);
    assert.throws(() => run({ "docs/adr/0001-eins.md": adrNeu("0001", "Eins", "2026-06-16") }), /meilensteine\.json/);
  });
  test("mehrere Fehler stehen in einer Meldung", () => {
    let msg = "";
    try {
      run(base({ "docs/adr/0002-a.md": "# ADR 0002: A\n", "docs/adr/0003-b.md": "# ADR 0003: B\n" }));
    } catch (e) {
      msg = (e as Error).message;
    }
    assert.match(msg, /0002-a\.md/);
    assert.match(msg, /0003-b\.md/);
  });
  test("Datum mit Anhängsel („2026-06-12x“) ist ungültig, nicht still ein Datum (ADR)", () => {
    assert.throws(() => run(base({ "docs/adr/0002-x.md": adrNeu("0002", "X", "2026-06-12x") })), /0002-x\.md.*ungültiges Datum 2026-06-12x/s);
    assert.throws(() => run(base({ "docs/adr/0002-y.md": adrAlt("0002", "Y", "2026-06-12x") })), /0002-y\.md/);
  });
});

describe("Generator adr-liste (#1392)", () => {
  const liste = (files: Record<string, string>, c: Cfg = confAdr) => adrApi.adrListeGenerator({ rootDir: fixture(files), config: c });
  test("Gutfall: beide Kopfformate, Nummer, Titel, Status, Datum, nach Nummer sortiert", () => {
    const out = liste(base({ "docs/adr/0002-zwei.md": adrAlt("0002", "Zwei", "2026-06-12") }));
    assert.deepEqual(out.split("\n"), [
      "| ADR | Titel | Status | Datum |",
      "|---|---|---|---|",
      "| [0001](/docs/adr/0001-eins.md) | Eins | akzeptiert | 16.06.2026 |",
      "| [0002](/docs/adr/0002-zwei.md) | Zwei | akzeptiert | 12.06.2026 |",
    ]);
  });
  test("Listenform mit weiterem Text hinter dem Datum: Status ist nur das Wort davor", () => {
    const adr = "# ADR 0003: Drei\n\n- **Status:** aktualisiert (2026-06-21) · ergebnisoffen\n\n## Kontext\n";
    assert.match(liste({ "docs/adr/0003-drei.md": adr }), /\| aktualisiert \| 21\.06\.2026 \|/);
  });
  test("Status mit Zusatz im Blockquote bleibt vollständig", () => {
    const adr = "# ADR 0004: Vier\n\n> Status: **akzeptiert als Grundsatz** · Datum: 2026-07-03\n\n## Status\n";
    assert.match(liste({ "docs/adr/0004-vier.md": adr }), /\| akzeptiert als Grundsatz \|/);
  });
  test("fehlender Status ist ein Fehler mit Dateiname", () => {
    const adr = "# ADR 0005: Fünf\n\n> Datum: 2026-07-03\n\n## Status\n";
    assert.throws(() => liste({ "docs/adr/0005-fuenf.md": adr }), /0005-fuenf\.md.*kein Status/s);
  });
  test("ungültiges Datum, fehlender Ordner und fehlender Config-Block sind Fehler", () => {
    assert.throws(() => liste(base({ "docs/adr/0002-x.md": adrNeu("0002", "X", "2026-13-40") })), /ungültiges Datum/);
    assert.throws(() => liste({}, confAdr), /nicht gefunden/);
    assert.throws(() => liste(base(), {}), /Config-Block "adr"/);
  });
  test("adr-liste braucht keinen zeitleiste-Block, aber den adr-Block (ein Block der Zeitleiste genügt nicht)", () => {
    assert.match(liste(base(), { adr: { ordner: "docs/adr" } }), /\| \[0001\]/);
    assert.throws(() => liste(base(), { zeitleiste: { meilensteine: "docs/meilensteine.json" } }), /Config-Block "adr" mit "ordner" fehlt/);
    assert.throws(() => liste(base(), { adr: {} }), /Config-Block "adr"/);
  });
  test("pipe im Titel wird escaped", () => {
    assert.match(liste(base({ "docs/adr/0002-p.md": adrNeu("0002", "A | B", "2026-07-01") })), /A \\| B/);
  });
});
