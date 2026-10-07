/* Sammelticket anlegen (#1390 Z10): Argumente, Body und die Suche nach einem vorhandenen Ticket sind pure Funktionen; die gh-Aufrufe
 * (Anlegen, Position setzen und prüfen) laufen im Glue und werden per --dry-run gegen das echte Board gesichtet.
 *
 * Reines Node-Tooling ohne Declaration-File: Namespace über `unknown` auf ein lokales Interface (Technik wie test/board.test.ts). */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/sammelticket-anlegen.mjs";

type Args = { art: string; vorgaenger: number | null; top: boolean; dry: boolean };
type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Anlegen = {
  parseArgs: (argv: string[]) => Args | null;
  sammelticketBody: (a: { art: string; vorgaenger?: number | null; vorgaengerOffen?: boolean }) => string;
  vorhandenesSammelticket: (offene: Offen[], titel: string) => Offen | null;
};
const A = raw as unknown as Anlegen;

describe("parseArgs", () => {
  test("harness ohne und mit Vorgänger, langfuse ohne und mit --top, --dry-run an beliebiger Stelle", () => {
    expect(A.parseArgs(["harness"])).toEqual({ art: "harness", vorgaenger: null, top: false, dry: false });
    expect(A.parseArgs(["harness", "--vorgaenger", "#1390"])).toEqual({ art: "harness", vorgaenger: 1390, top: false, dry: false });
    expect(A.parseArgs(["--dry-run", "harness", "--vorgaenger", "7"])).toMatchObject({ vorgaenger: 7, dry: true });
    expect(A.parseArgs(["langfuse"])).toEqual({ art: "langfuse", vorgaenger: null, top: false, dry: false });
    expect(A.parseArgs(["langfuse", "--top", "--dry-run"])).toEqual({ art: "langfuse", vorgaenger: null, top: true, dry: true });
  });

  test("falsche Benutzung → null", () => {
    for (const bad of [[], ["egal"], ["harness", "--vorgaenger"], ["harness", "--vorgaenger", "abc"], ["harness", "--vorgaenger", "0"], ["harness", "--vorgaenger", "1.5"], ["harness", "--top"], ["harness", "--vorgaenger", "5", "x"], ["langfuse", "--vorgaenger", "5"], ["langfuse", "--top", "x"], ["--dry-run"], ["toString"]]) {
      expect(A.parseArgs(bad), bad.join(" ")).toBeNull();
    }
  });
});

describe("sammelticketBody", () => {
  test("Vorlage ohne Vorgänger: Zeile mit Kommentar-Hinweis, keine Blocker-Zeile", () => {
    const b = A.sammelticketBody({ art: "harness" });
    expect(b).toContain("Sammelticket für Harness-Befunde");
    expect(b).toContain("`- [ ] …`");
    expect(b).not.toMatch(/blockiert durch|Nachfolger/);
  });

  test("offener Vorgänger: Nachfolger-Zeile UND „blockiert durch #N“", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerOffen: true });
    expect(b).toContain("Nachfolger von #1390 (dort in Arbeit).");
    expect(b).toMatch(/^blockiert durch #1390$/m);
  });

  test("geschlossener Vorgänger: genannt, aber ohne Blocker (kein stale „blockiert durch“)", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerOffen: false });
    expect(b).toContain("Nachfolger von #1390.");
    expect(b).not.toContain("blockiert durch");
    expect(b).not.toContain("dort in Arbeit");
  });

  test("Langfuse-Vorlage nennt Langfuse; unbekannte Art wirft", () => {
    expect(A.sammelticketBody({ art: "langfuse" })).toContain("Langfuse");
    expect(() => A.sammelticketBody({ art: "x" })).toThrow(/Unbekannte Art/);
  });
});

describe("vorhandenesSammelticket", () => {
  const o = (number: number, titel: string, assignees: string[] = []): Offen => ({ number, titel, assignees, createdAt: "2026-10-01T00:00:00Z" });
  const T = "Harness-Härtung (gesammelt)";

  test("exakter Titel, ungeclaimt; bei mehreren das mit der höchsten Nummer", () => {
    expect(A.vorhandenesSammelticket([o(5, T), o(9, T), o(7, T)], T)?.number).toBe(9);
    expect(A.vorhandenesSammelticket([o(5, T)], T)?.number).toBe(5);
  });

  test("Negativfälle: geclaimt, anderer oder fast gleicher Titel, leer → null", () => {
    expect(A.vorhandenesSammelticket([o(5, T, ["fluffels"])], T)).toBeNull();
    expect(A.vorhandenesSammelticket([o(5, `${T} x`), o(6, T.toLowerCase()), o(7, "Langfuse-Befunde (gesammelt)")], T)).toBeNull();
    expect(A.vorhandenesSammelticket([], T)).toBeNull();
    expect(A.vorhandenesSammelticket([o(5, T, ["fluffels"]), o(6, T)], T)?.number).toBe(6);
  });
});

describe("Verdrahtung (#1390)", () => {
  const skript = readFileSync(new URL("../scripts/sammelticket-anlegen.mjs", import.meta.url), "utf8");
  test("das Skript liest die Position aus AGENTS.md (keine eigene Zahl) und nutzt keinen Such-Index", () => {
    expect(skript).toMatch(/sammelticketPosition\(readFileSync\(new URL\("\.\.\/AGENTS\.md"/);
    expect(skript).not.toMatch(/search\/issues|--search\b/);
    expect(skript).not.toMatch(/Position\s*:?\s*\d+/);
  });
});
