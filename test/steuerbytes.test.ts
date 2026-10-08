/* Steuerbyte-Wächter (#1428 Z17, eigenes Gate seit #1460 Z5): eine getrackte Textdatei mit NUL oder einem anderen
 * C0-Steuerbyte außer Tab/LF/CR ist rot, mit Datei und Zeile. Die Prüflogik kommt aus scripts/check-steuerbytes.mjs
 * (eine Quelle für CLI und Test); der Test scannt nicht das Repo, sondern speist Fixtures über `io` ein.
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:steuerbytes)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawModule from "../scripts/check-steuerbytes.mjs";

type Treffer = { file: string; line: number };
type Api = {
  ersteSteuerzeile: (content: string) => number | null;
  findSteuerbytes: (files: string[], readFile: (f: string) => string) => Treffer[];
  runSteuerbytes: (
    root?: string,
    io?: { listFiles?: (root: string) => string[]; readFile?: (rel: string) => string },
  ) => { files: string[]; violations: Treffer[] };
};
const { ersteSteuerzeile, findSteuerbytes, runSteuerbytes } = rawModule as unknown as Api;

describe("Steuerbyte-Wächter (#1460 Z5)", () => {
  test("ersteSteuerzeile: NUL und ESC melden die Zeile, Tab/CR/LF und Umlaute nicht", () => {
    assert.equal(ersteSteuerzeile("a\nb \0 c\n"), 2);
    assert.equal(ersteSteuerzeile("a\nb\nc \x1b[31m"), 3);
    assert.equal(ersteSteuerzeile("a\tb\r\nc\r\näöüß\n"), null);
    assert.equal(ersteSteuerzeile(""), null);
  });

  test("findSteuerbytes: nicht lesbare Dateien werden übersprungen, nicht gemeldet", () => {
    const hits = findSteuerbytes(["weg.md", "kaputt.md"], (f) => {
      if (f === "weg.md") throw new Error("ENOENT");
      return "x\0";
    });
    assert.deepEqual(hits.map((h) => h.file), ["kaputt.md"]);
  });

  test("runSteuerbytes: NUL und ESC in einer getrackten Textdatei sind rot, mit Datei und Zeile", () => {
    const inhalte: Record<string, string> = {
      "nul.md": "Zeile 1\nZeile 2 \0 kaputt\n",
      "esc.ts": "a\nb\nc \x1b[31m\n",
      "tab-crlf.md": "a\tb\r\nc\r\n",
      "sauber.md": "Umlaute äöüß und Emoji-frei\n",
    };
    const r = runSteuerbytes("/x", { listFiles: () => Object.keys(inhalte), readFile: (rel) => inhalte[rel] });
    assert.deepEqual(r.violations.map((v) => `${v.file}:${v.line}`).sort(), ["esc.ts:3", "nul.md:2"], "Tab und CRLF bleiben ok");
  });

  test("runSteuerbytes: .png bleibt ausgeschlossen, nicht lesbare Dateien lösen nichts aus", () => {
    const r = runSteuerbytes("/x", {
      listFiles: () => ["bild.png", "weg.md"],
      readFile: (rel) => {
        if (rel === "weg.md") throw new Error("ENOENT");
        return "\0\0\0";
      },
    });
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.files, ["weg.md"], "nur prüfbare Dateien zählen als geprüft");
  });
});
