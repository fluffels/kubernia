/* Projekt-Test, bleibt im Projekt (#1934): Aufruf-Fehler der Projektskripte (sbom, audit-einordnung, codescanning-inbox,
 * forum-sanitize, mermaid-vorschau). Dieselbe Prüfung wie `test/flag-aufrufe.test.ts`, der Runner liegt in
 * `test/support/flag-aufruf.ts`; die Kern-Tabelle nennt nur Kern-Skripte, die im Export liegen. */
import { describe, expect, test } from "vitest";
import { faelleAus, maskiere, nurSchalter, pruefeFall, STD, starte, type Zeile } from "./support/flag-aufruf";

const SBOM_USAGE = "Aufruf: node scripts/sbom.mjs [--aus <pfad>]";

const ZEILEN: Zeile[] = [
  {
    skript: "sbom",
    exit: 2,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/sbom\.mjs \[--aus <pfad>\]$/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--aus"], doppelt: ["--aus", "a", "--aus", "b"] },
    meldungen: { unbekannt: SBOM_USAGE, ohneWert: SBOM_USAGE, doppelt: SBOM_USAGE },
  },
  nurSchalter("audit-einordnung", "--dry-run", "Aufruf: node scripts/audit-einordnung.mjs [--dry-run]"),
  nurSchalter("codescanning-inbox", "--dry-run", "Aufruf: node scripts/codescanning-inbox.mjs [--dry-run]"),
  nurSchalter("forum-sanitize", "--body", "Aufruf: node scripts/forum-sanitize.mjs [--body]"),
  {
    skript: "mermaid-vorschau",
    exit: 2,
    erste: (m) => m,
    aufruf: new RegExp(`^${maskiere("Aufruf: node scripts/mermaid-vorschau.mjs <datei.md> --mermaid <ordner-mit-node_modules/mermaid> [--port 4173]")}$`, "m"),
    faelle: { unbekannt: ["x.md", "--bogus"], ohneWert: ["x.md", "--mermaid"], doppelt: ["x.md", "--mermaid", "a", "--mermaid", "b"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--mermaid braucht einen Wert", doppelt: "--mermaid ist doppelt angegeben" },
  },
];

describe("Aufruf-Fehler der Projektskripte", () => {
  test.concurrent.each(faelleAus(ZEILEN))("%s: %s", { timeout: 60_000 }, (_skript, fall, z) => {
    pruefeFall(z, fall);
  });

  const ZUSATZ: [string, string[], number, string][] = [
    ["mermaid-vorschau", ["a.md", "b.md", "--mermaid", "x"], 2, "genau eine Markdown-Datei erwartet"],
    ["mermaid-vorschau", ["a.md", "--mermaid", "x", "--port", "abc"], 2, "--port erwartet eine Portnummer, nicht abc"],
    ["mermaid-vorschau", ["a.md", "--mermaid", "x", "--port", "65536"], 2, "--port erwartet eine Portnummer, nicht 65536"],
    ["mermaid-vorschau", ["a.md", "--mermaid", "x", "--port=-1"], 2, "--port erwartet eine Portnummer, nicht -1"],
    ["mermaid-vorschau", ["--mermaid", "x"], 2, "genau eine Markdown-Datei erwartet"],
  ];
  test.concurrent.each(ZUSATZ)("%s %j: weitere Aufruf-Fehler (Positionsargument, Portprüfung)", { timeout: 60_000 }, (skript, argv, exit, erste) => {
    const r = starte(skript, argv);
    expect(r.status).toBe(exit);
    expect(r.stderr.split("\n")[0]).toBe(erste);
    expect(r.stdout).toBe("");
  });

  test.concurrent("mermaid-vorschau: --port 65535 (Obergrenze) ist gültig, scheitert erst am fehlenden mermaid-Ordner", { timeout: 60_000 }, () => {
    const r = starte("mermaid-vorschau", ["a.md", "--mermaid", "x", "--port", "65535"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("mermaid fehlt unter");
    expect(r.stderr).not.toContain("--port erwartet");
  });

  test.concurrent("Options-Terminator `--` ist auch bei sbom ein Aufruf-Fehler (zentral in flagsLesen)", { timeout: 60_000 }, () => {
    const r = starte("sbom", ["--"]);
    expect([r.status, r.stderr.split("\n")[0]]).toEqual([2, SBOM_USAGE]);
  });
});
