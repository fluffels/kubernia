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
    expect(b).toMatch(/^blockiert durch #1390 \(nur solange #1390 offen ist\)$/m);
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
    expect(skript).toMatch(/positionLautAgentsMd|positionOderWarnung/);
    expect(skript).not.toMatch(/readFileSync/);
    expect(skript).not.toMatch(/search\/issues|--search\b/);
    expect(skript).not.toMatch(/Position\s*:?\s*\d+/);
  });
});

describe("pruefSchritt: der Prüf- und Retry-Kern (#1390 Z10, Lens R1)", () => {
  type B = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
  type Schritt = { art: "ok" | "warte" | "setze" | "falsch"; k?: { nr: number; afterId: string | null } };
  const P = (raw as unknown as { pruefSchritt: (a: { items: B[]; nr: number; position: number; neuGesetzt?: number; dry?: boolean }) => Schritt }).pruefSchritt;
  const T = "Harness-Härtung (gesammelt)";
  const b = (number: number, extra: Partial<B> = {}): B => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = (number: number, extra: Partial<B> = {}) => b(number, { title: T, ...extra });
  const fueller = Array.from({ length: 10 }, (_, i) => b(i + 1));

  test("steht auf Position oder davor → ok", () => {
    expect(P({ items: [b(1), b(2), b(3), sammel(20), b(4)], nr: 20, position: 4 }).art).toBe("ok");
  });

  test("(b) noch nicht in der Liste → warte", () => {
    expect(P({ items: fueller, nr: 20, position: 4 }).art).toBe("warte");
  });

  test("falsche Position → setze (mit Ziel); nach 2 Neusetzungen → falsch, kein drittes Setzen", () => {
    const items = [...fueller, sammel(20)];
    expect(P({ items, nr: 20, position: 4 })).toMatchObject({ art: "setze", k: { nr: 20, afterId: "I3" } });
    expect(P({ items, nr: 20, position: 4, neuGesetzt: 1 }).art).toBe("setze");
    expect(P({ items, nr: 20, position: 4, neuGesetzt: 2 }).art).toBe("falsch");
  });

  test("(c) Trockenlauf bei falscher Position → falsch, nie setze", () => {
    expect(P({ items: [...fueller, sammel(20)], nr: 20, position: 4, dry: true }).art).toBe("falsch");
  });

  test("(d) ein anderes ungeclaimtes Sammelticket weiter oben verfälscht die Prüfung nicht: bewertet wird nr", () => {
    const items = [b(1), sammel(5), ...fueller.slice(1), sammel(20)];
    expect(P({ items, nr: 20, position: 4 })).toMatchObject({ art: "setze", k: { nr: 20 } });
    // ein geclaimtes Sammelticket davor zählt ohnehin nicht, dann ist die Lage dieselbe
    expect(P({ items: [b(1), sammel(5, { assignees: ["fluffels"] }), sammel(20)], nr: 20, position: 4 }).art).toBe("ok");
  });

  test("geclaimtes Ticket nr: nichts zu korrigieren", () => {
    expect(P({ items: [...fueller, sammel(20, { assignees: ["fluffels"] })], nr: 20, position: 4 }).art).toBe("ok");
  });
});

describe("Verdrahtung der Selbstkorrektur (#1390, Lens R1)", () => {
  const lies = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  test("board-place korrigiert über planMitKorrektur, board-takt zieht die Liste nach, das Anlege-Skript nutzt pruefSchritt und planMitKorrektur", () => {
    expect(lies("scripts/board-lib.mjs")).toMatch(/function planMitKorrektur\(items, args, n\)/);
    expect(lies("scripts/board-place.mjs")).toMatch(/planMitKorrektur\(items, args, args\.notfall \? null : positionOderWarnung\(\)\)/);
    // Der Listen-Nachzug des Takts ist mit Fakes in test/board-takt-lauf.test.ts getestet (#1428 Z23), keine Quelltext-Regex mehr.
    const anlegen = lies("scripts/sammelticket-anlegen.mjs");
    expect(anlegen).toMatch(/pruefSchritt\(\{ items: loadItems\(\)/);
    expect(anlegen).toMatch(/planMitKorrektur\(items, \{ anchor: null, numbers: \[nr\] \}/);
    expect(anlegen).not.toMatch(/from "\.\/board-place\.mjs"/); // kein Skript importiert aus einem Einstiegsskript (#1398)
  });
});

describe("waehleBestaetigtes und dublettenEntscheidung (#1561 Z6: Anlegen ist idempotent gegen den Wettlauf)", () => {
  type Roh = { state: string; assignees: unknown[] };
  type Dub = { art: "keine" | "eigenes-schliessen" | "warnung"; aelter?: number };
  const Z = raw as unknown as {
    waehleBestaetigtes: (kandidaten: Offen[], einzeln: (nr: number) => Roh) => Offen | null;
    dublettenEntscheidung: (a: { eigenNr: number; titel: string; eigenKommentare: number; andere: Offen[] }) => Dub;
  };
  const T = "Harness-Härtung (gesammelt)";
  const o = (number: number, titel = T, assignees: string[] = []): Offen => ({ number, titel, assignees, createdAt: "2026-10-01T00:00:00Z" });
  const offen = (): Roh => ({ state: "open", assignees: [] });

  test("nimmt das höchste bestätigte Ticket; der Einzelabruf entscheidet, nicht die (nachhinkende) Liste", () => {
    const abgerufen: number[] = [];
    const r = Z.waehleBestaetigtes([o(5), o(9), o(7)], (nr) => {
      abgerufen.push(nr);
      return offen();
    });
    expect(r?.number).toBe(9);
    expect(abgerufen).toEqual([9], "ein Treffer genügt, absteigend");
  });

  test("Liste sagt offen, Einzelabruf sagt geschlossen (das war der Wettlauf #1560/#1561) → das nächste", () => {
    const r = Z.waehleBestaetigtes([o(9), o(7)], (nr) => (nr === 9 ? { state: "closed", assignees: [] } : offen()));
    expect(r?.number).toBe(7);
  });

  test("geclaimt laut Einzelabruf → das nächste; alle ungültig oder leer → null", () => {
    expect(Z.waehleBestaetigtes([o(9), o(7)], (nr) => (nr === 9 ? { state: "open", assignees: [{ login: "fluffels" }] } : offen()))?.number).toBe(7);
    expect(Z.waehleBestaetigtes([o(9)], () => ({ state: "closed", assignees: [] }))).toBeNull();
    expect(Z.waehleBestaetigtes([o(9)], () => ({ state: "open", assignees: [{ login: "x" }] }))).toBeNull();
    expect(Z.waehleBestaetigtes([], () => offen())).toBeNull();
  });

  test("ein werfender Einzelabruf wirft weiter (kein stilles Weiterlaufen mit unbestätigtem Stand)", () => {
    expect(() =>
      Z.waehleBestaetigtes([o(9)], () => {
        throw new Error("gh kaputt");
      }),
    ).toThrow(/gh kaputt/);
  });

  test("Dublette: ein anderes offenes ungeclaimtes Ticket gleichen Titels mit kleinerer Nummer → eigenes-schliessen (nennt das ältere)", () => {
    expect(Z.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(18), o(20)] })).toEqual({ art: "eigenes-schliessen", aelter: 18 });
    expect(Z.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(19), o(15)] })).toEqual({ art: "eigenes-schliessen", aelter: 15 });
  });

  test("hat das eigene Ticket schon Kommentare (Zeilen), wird nicht geschlossen, sondern gewarnt", () => {
    expect(Z.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 2, andere: [o(18)] })).toEqual({ art: "warnung", aelter: 18 });
  });

  test("keine Dublette: nur größere Nummern, geclaimte, anderer Titel, nur das eigene, leer", () => {
    for (const andere of [[o(21)], [o(18, T, ["fluffels"])], [o(18, "Langfuse-Befunde (gesammelt)")], [o(20)], []]) {
      expect(Z.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere }).art).toBe("keine");
    }
  });

  test("Verdrahtung: das Skript nutzt beide Funktionen, bestätigt per Direktabruf und prüft vor und nach der Positions-Schleife", () => {
    const skript = readFileSync(new URL("../scripts/sammelticket-anlegen.mjs", import.meta.url), "utf8");
    expect(skript).toMatch(/waehleBestaetigtes\(/);
    expect(skript).toMatch(/repos\/\$\{REPO\}\/issues\/\$\{nr\}/);
    expect(skript.match(/schliesseWennDublette\(/g)?.length).toBeGreaterThanOrEqual(3); // Definition und zwei Aufrufe
    expect(skript).toMatch(/Dublette von #/);
    expect(skript).toMatch(/state_reason=not_planned/);
  });
});
