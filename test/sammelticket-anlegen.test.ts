/* Sammelticket anlegen (#1390 Z10): Argumente, Body und die Suche nach einem vorhandenen Ticket sind pure Funktionen; die gh-Aufrufe
 * (Anlegen, Position setzen und prüfen) laufen im Glue und werden per --dry-run gegen das echte Board gesichtet.
 *
 * Reines Node-Tooling ohne Declaration-File: Namespace über `unknown` auf ein lokales Interface (Technik wie test/board.test.ts). */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/sammelticket-anlegen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
import { echteSpezifikation } from "./support/echte-sprache";

type Args = { art: string; vorgaenger: number | null; top: boolean; dry: boolean };
type User = { login: string; type?: string } | null;
type Komm = { user: User; body: string };
type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Anlegen = {
  parseArgs: (argv: string[]) => Args | null;
  sammelticketBody: (a: { art: string; vorgaenger?: number | null; vorgaengerZustand?: string; blocker?: string }) => string;
  zustandVonIssue: (issue: { state?: string; assignees?: unknown[] } | null) => string;
  korrekturFuer: (a: { items: unknown[]; nr: number; position: number }) => { nr: number; id: string; afterId: string | null } | null;
  kandidatenSammelticket: (offene: Offen[], titel: string, o?: { nach?: number | null }) => Offen[];
  zaehleBefundZeilen: (k: Komm[], o: { vertraut: (u: User) => boolean; nurOffen?: boolean }) => number;
  dublettenEntscheidung: (a: { eigenNr: number; titel: string; eigenKommentare: number; andere: Offen[]; vorgaenger?: number | null }) => { art: string; aelter?: number };
};
const A = raw as unknown as Anlegen;
const BL = echteSpezifikation().blocker as string;
const ergaenzeFehlende = (rawLib as unknown as { ergaenzeFehlende: (items: unknown[], neu: unknown[]) => unknown[] }).ergaenzeFehlende;

describe("parseArgs", () => {
  test("harness ohne und mit Vorgänger, langfuse ohne und mit --top, --dry-run an beliebiger Stelle", () => {
    expect(A.parseArgs(["harness"])).toEqual({ art: "harness", vorgaenger: null, top: false, dry: false });
    expect(A.parseArgs(["harness", "--vorgaenger", "#1390"])).toEqual({ art: "harness", vorgaenger: 1390, top: false, dry: false });
    expect(A.parseArgs(["--dry-run", "harness", "--vorgaenger", "7"])).toMatchObject({ vorgaenger: 7, dry: true });
    expect(A.parseArgs(["langfuse"])).toEqual({ art: "langfuse", vorgaenger: null, top: false, dry: false });
    expect(A.parseArgs(["langfuse", "--top", "--dry-run"])).toEqual({ art: "langfuse", vorgaenger: null, top: true, dry: true });
  });

  test("Inline-Wert --vorgaenger=7 wird angenommen (node:util)", () => {
    expect(A.parseArgs(["harness", "--vorgaenger=7"])).toMatchObject({ art: "harness", vorgaenger: 7 });
  });

  test("falsche Benutzung → null", () => {
    for (const bad of [["harness", "--generation"], ["--dry-run", "harness", "--generation"], ["langfuse", "--generation"], ["harness", "--vorgaenger", "5", "--generation"], [], ["egal"], ["harness", "--vorgaenger"], ["harness", "--vorgaenger", "abc"], ["harness", "--vorgaenger", "0"], ["harness", "--vorgaenger", "1.5"], ["harness", "--top"], ["harness", "--vorgaenger", "5", "x"], ["langfuse", "--vorgaenger", "5"], ["langfuse", "--top", "x"], ["--dry-run"], ["toString"], ["harness", "--dry-run", "--dry-run"], ["harness", "--vorgaenger", "5", "--vorgaenger", "6"], ["--vorgaenger", "5", "harness"], ["harness", "--"], ["harness", "--vorgaenger", "--dry-run"], ["harness", "--vorgaenger="]]) {
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

  test("Vorgänger in Arbeit: Nachfolger-Zeile mit „dort in Arbeit“ UND „blockiert durch #N“", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerZustand: "in-arbeit", blocker: BL });
    expect(b).toContain("Nachfolger von #1390 (dort in Arbeit).");
    expect(b).toMatch(/^blockiert durch #1390 \(nur solange #1390 offen ist\)$/m);
  });

  test("Vorgänger offen (ungeclaimt): Nachfolger-Zeile ohne Zusatz, Sperrzeile bleibt", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerZustand: "offen", blocker: BL });
    expect(b).toContain("Nachfolger von #1390.");
    expect(b).not.toContain("dort in Arbeit");
    expect(b).not.toContain("voll");
    expect(b).toMatch(/^blockiert durch #1390 /m);
  });

  test("Vorgänger unlesbar: gilt als offen ohne Zusatz, Sperrzeile bleibt", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerZustand: "unbekannt", blocker: BL });
    expect(b).toContain("Nachfolger von #1390.");
    expect(b).not.toMatch(/dort in Arbeit|voll/);
    expect(b).toMatch(/^blockiert durch #1390 /m);
  });

  test("geschlossener Vorgänger: genannt, aber ohne Blocker (kein stale „blockiert durch“)", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerZustand: "zu", blocker: BL });
    expect(b).toContain("Nachfolger von #1390.");
    expect(b).not.toContain("blockiert durch");
    expect(b).not.toContain("dort in Arbeit");
  });

  test("das Blocker-Wort kommt aus dem Parameter, nicht aus einer Konstante; ohne Wort bei offenem Vorgänger wirft er (#1860)", () => {
    expect(A.sammelticketBody({ art: "harness", vorgaenger: 7, vorgaengerZustand: "offen", blocker: "blocked by" })).toMatch(/^blocked by #7 /m);
    expect(() => A.sammelticketBody({ art: "harness", vorgaenger: 7, vorgaengerZustand: "offen" })).toThrow(/blocker/);
    expect(A.sammelticketBody({ art: "harness", vorgaenger: 7, vorgaengerZustand: "zu" })).not.toMatch(/#7 \(nur/);
  });

  test("zustandVonIssue: offen+Assignee in-arbeit, offen ohne Assignee offen, geschlossen zu, unlesbar unbekannt", () => {
    expect(A.zustandVonIssue({ state: "open", assignees: [{ login: "x" }] })).toBe("in-arbeit");
    expect(A.zustandVonIssue({ state: "open", assignees: [] })).toBe("offen");
    expect(A.zustandVonIssue({ state: "open" })).toBe("offen");
    expect(A.zustandVonIssue({ state: "closed", assignees: [{ login: "x" }] })).toBe("zu");
    expect(A.zustandVonIssue(null)).toBe("unbekannt");
  });

  test("Langfuse-Vorlage nennt Langfuse; unbekannte Art wirft", () => {
    expect(A.sammelticketBody({ art: "langfuse" })).toContain("Langfuse");
    expect(() => A.sammelticketBody({ art: "x" })).toThrow(/Unbekannte Art/);
  });
});

describe("kandidatenSammelticket", () => {
  const o = (number: number, titel: string, assignees: string[] = []): Offen => ({ number, titel, assignees, createdAt: "2026-10-01T00:00:00Z" });
  const T = "Harness-Härtung (gesammelt)";

  test("exakter Titel, ungeclaimt; absteigend sortiert (das jüngste zuerst)", () => {
    expect(A.kandidatenSammelticket([o(5, T), o(9, T), o(7, T)], T).map((i) => i.number)).toEqual([9, 7, 5]);
    expect(A.kandidatenSammelticket([o(5, T)], T).map((i) => i.number)).toEqual([5]);
  });

  test("Negativfälle: geclaimt, anderer oder fast gleicher Titel, leer → leere Liste", () => {
    expect(A.kandidatenSammelticket([o(5, T, ["fluffels"])], T)).toEqual([]);
    expect(A.kandidatenSammelticket([o(5, `${T} x`), o(6, T.toLowerCase()), o(7, "Langfuse-Befunde (gesammelt)")], T)).toEqual([]);
    expect(A.kandidatenSammelticket([], T)).toEqual([]);
    expect(A.kandidatenSammelticket([o(5, T, ["fluffels"]), o(6, T)], T).map((i) => i.number)).toEqual([6]);
  });
});

const fluffels = { login: "fluffels", type: "User" };
const vertraut = (u: User) => u?.login === "fluffels";
const k = (body: string, user: User = fluffels): Komm => ({ user, body });

describe("zaehleBefundZeilen", () => {
  test("leer → 0; Kommentar ohne Checkbox → 0", () => {
    expect(A.zaehleBefundZeilen([], { vertraut })).toBe(0);
    expect(A.zaehleBefundZeilen([k("Nur Text, kein Befund")], { vertraut })).toBe(0);
  });

  test("zählt `- [ ]`, auch mehrere je Kommentar, `*` und eingerückt", () => {
    expect(A.zaehleBefundZeilen([k("- [ ] eins")], { vertraut })).toBe(1);
    expect(A.zaehleBefundZeilen([k("Kopf\n- [ ] a\n- [ ] b\n  - [ ] c\n* [ ] d")], { vertraut })).toBe(4);
    expect(A.zaehleBefundZeilen([k("- [ ] a"), k("- [ ] b\n- [ ] c")], { vertraut })).toBe(3);
  });

  test("`- [x]` zählt nur mit nurOffen: false", () => {
    const kk = [k("- [ ] a\n- [x] b\n- [X] c")];
    expect(A.zaehleBefundZeilen(kk, { vertraut })).toBe(1);
    expect(A.zaehleBefundZeilen(kk, { vertraut, nurOffen: true })).toBe(1);
    expect(A.zaehleBefundZeilen(kk, { vertraut, nurOffen: false })).toBe(3);
  });

  test("Kommentar eines nicht vertrauten Autors (auch ohne user) zählt nicht", () => {
    expect(A.zaehleBefundZeilen([k("- [ ] fremd", { login: "fremder" }), k("- [ ] anonym", null), k("- [ ] eigen")], { vertraut })).toBe(1);
  });

  test("keine Checkbox, wenn `[ ]` mitten im Satz steht", () => {
    expect(A.zaehleBefundZeilen([k("Text mit - [ ] mittendrin")], { vertraut })).toBe(0);
  });
});

describe("Vorgänger-Ausschluss (--vorgaenger X, X ungeclaimt)", () => {
  const T = "Harness-Härtung (gesammelt)";
  const o = (number: number, assignees: string[] = []): Offen => ({ number, titel: T, assignees, createdAt: "2026-10-01T00:00:00Z" });

  test("kandidatenSammelticket: nur strikt jüngere als der Vorgänger zählen (auch ältere Tickets davor nicht)", () => {
    expect(A.kandidatenSammelticket([o(5), o(9), o(12)], T, { nach: 9 }).map((i) => i.number)).toEqual([12]);
    expect(A.kandidatenSammelticket([o(5), o(9)], T, { nach: 9 }).map((i) => i.number)).toEqual([]);
    expect(A.kandidatenSammelticket([o(5), o(9)], T, { nach: null }).map((i) => i.number)).toEqual([9, 5]);
    expect(A.kandidatenSammelticket([o(5), o(9)], T).map((i) => i.number)).toEqual([9, 5]);
  });

  test("dublettenEntscheidung: der Vorgänger ist keine ältere Dublette", () => {
    expect(A.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(18)], vorgaenger: 18 }).art).toBe("keine");
  });

  test("ein älteres Ticket vor dem Vorgänger ist keine Dublette des Nachfolgers", () => {
    expect(A.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(15), o(18)], vorgaenger: 18 }).art).toBe("keine");
  });

  test("ein echtes älteres Duplikat (zwischen Vorgänger und Nachfolger) bleibt eine Dublette (Wettlauf #1560/#1561)", () => {
    expect(A.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(18), o(19)], vorgaenger: 18 })).toEqual({ art: "eigenes-schliessen", aelter: 19 });
    expect(A.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(15)] })).toEqual({ art: "eigenes-schliessen", aelter: 15 });
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

describe("korrekturFuer (#1646): die Korrektur gilt dem NEUEN Sammelticket, nie dem älteren", () => {
  type B = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
  const T = "Harness-Härtung (gesammelt)";
  const b = (number: number, extra: Partial<B> = {}): B => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = (number: number, extra: Partial<B> = {}) => b(number, { title: T, ...extra });
  const fueller = Array.from({ length: 10 }, (_, i) => b(i + 1));

  test("älteres ungeclaimtes Sammelticket steht davor, das neue fehlt in der Liste und wird angehängt: Ziel ist das neue", () => {
    const items = [b(1), b(2), sammel(5), ...fueller.slice(2)];
    const mitNeu = ergaenzeFehlende(items, [sammel(20)]);
    const k = A.korrekturFuer({ items: mitNeu, nr: 20, position: 4 });
    expect(k).toMatchObject({ nr: 20, id: "I20" });
    // das ältere würde laut sammelticketKorrektur allein bewertet: es steht auf Position, also keine Korrektur für dessen Nummer
    expect(A.korrekturFuer({ items: mitNeu, nr: 5, position: 4 })).toBeNull();
  });

  test("steht auf Position oder davor → null; nicht in der Liste → null", () => {
    expect(A.korrekturFuer({ items: [b(1), b(2), sammel(20), b(3)], nr: 20, position: 4 })).toBeNull();
    expect(A.korrekturFuer({ items: fueller, nr: 20, position: 4 })).toBeNull();
  });

});

describe("Verdrahtung der Selbstkorrektur (#1390, Lens R1)", () => {
  const lies = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  test("board-place korrigiert über planMitKorrektur, board-takt zieht die Liste nach, das Anlege-Skript nutzt pruefSchritt und planMitKorrektur", () => {
    expect(lies("scripts/board-lib.mjs")).toMatch(/function planMitKorrektur\(items, args, n\)/);
    expect(lies("scripts/board-place.mjs")).toMatch(/planMitKorrektur\(items, args, args\.notfall \? null : positionOderWarnung\(\)\)/);
    // Der Listen-Nachzug des Takts ist mit Fakes in test/board-takt-lauf.test.ts getestet (#1428 Z23), keine Quelltext-Regex mehr.
    const anlegen = lies("scripts/sammelticket-anlegen.mjs");
    expect(anlegen).toMatch(/pruefSchritt\(\{ items: lade\(board\)/);
    expect(anlegen).toMatch(/planMitKorrektur\(items, \{ anchor: null, numbers: \[nr\] \}/);
    expect(anlegen).not.toMatch(/from "\.\/board-place\.mjs"/); // kein Skript importiert aus einem Einstiegsskript (#1398)
  });
});

describe("waehleBestaetigtes und dublettenEntscheidung (#1561 Z6: Anlegen ist idempotent gegen den Wettlauf)", () => {
  type Roh = { state: string; assignees: unknown[]; user?: { login: string; type: string } | null };
  const ICH = { login: "fluffels", type: "User" };
  type Dub = { art: "keine" | "eigenes-schliessen" | "warnung"; aelter?: number };
  const Z = raw as unknown as {
    waehleBestaetigtes: (kandidaten: Offen[], einzeln: (nr: number) => Roh, owner?: string) => Offen | null;
    dublettenEntscheidung: (a: { eigenNr: number; titel: string; eigenKommentare: number; andere: Offen[] }) => Dub;
  };
  const T = "Harness-Härtung (gesammelt)";
  const o = (number: number, titel = T, assignees: string[] = []): Offen => ({ number, titel, assignees, createdAt: "2026-10-01T00:00:00Z" });
  const offen = (): Roh => ({ state: "open", assignees: [], user: ICH });

  test("nimmt das höchste bestätigte Ticket; der Einzelabruf entscheidet, nicht die (nachhinkende) Liste", () => {
    const abgerufen: number[] = [];
    const r = Z.waehleBestaetigtes([o(5), o(9), o(7)], (nr) => {
      abgerufen.push(nr);
      return offen();
    }, "fluffels");
    expect(r?.number).toBe(9);
    expect(abgerufen, "ein Treffer genügt, absteigend").toEqual([9]);
  });

  test("Liste sagt offen, Einzelabruf sagt geschlossen (das war der Wettlauf #1560/#1561) → das nächste", () => {
    const r = Z.waehleBestaetigtes([o(9), o(7)], (nr) => (nr === 9 ? { state: "closed", assignees: [], user: ICH } : offen()), "fluffels");
    expect(r?.number).toBe(7);
  });

  test("geclaimt laut Einzelabruf → das nächste; alle ungültig oder leer → null", () => {
    expect(Z.waehleBestaetigtes([o(9), o(7)], (nr) => (nr === 9 ? { state: "open", assignees: [{ login: "fluffels" }], user: ICH } : offen()), "fluffels")?.number).toBe(7);
    expect(Z.waehleBestaetigtes([o(9)], () => ({ state: "closed", assignees: [], user: ICH }), "fluffels")).toBeNull();
    expect(Z.waehleBestaetigtes([o(9)], () => ({ state: "open", assignees: [{ login: "x" }], user: ICH }), "fluffels")).toBeNull();
    expect(Z.waehleBestaetigtes([], () => offen(), "fluffels")).toBeNull();
  });

  test("ein werfender Einzelabruf wirft weiter (kein stilles Weiterlaufen mit unbestätigtem Stand)", () => {
    expect(() =>
      Z.waehleBestaetigtes([o(9)], () => {
        throw new Error("gh kaputt");
      }, "fluffels"),
    ).toThrow(/gh kaputt/);
  });

  test("Autorprüfung (W14): ein Fremder mit exaktem Titel wird nicht gewählt, der Bot und der Owner schon", () => {
    const fremd: Roh = { state: "open", assignees: [], user: { login: "fremd", type: "User" } };
    const bot: Roh = { state: "open", assignees: [], user: { login: "github-actions[bot]", type: "Bot" } };
    expect(Z.waehleBestaetigtes([o(9)], () => fremd, "fluffels")).toBeNull();
    expect(Z.waehleBestaetigtes([o(9)], () => ({ state: "open", assignees: [] }), "fluffels"), "ohne user fail-closed").toBeNull();
    expect(Z.waehleBestaetigtes([o(9), o(7)], (nr) => (nr === 9 ? fremd : offen()), "fluffels")?.number).toBe(7);
    expect(Z.waehleBestaetigtes([o(9)], () => bot, "fluffels")?.number).toBe(9);
  });

  test("ohne owner wirft es, bevor ein Abruf läuft (Pflicht-Parameter)", () => {
    let abgerufen = 0;
    const einzeln = (): Roh => (abgerufen++, offen());
    expect(() => Z.waehleBestaetigtes([o(9)], einzeln)).toThrow(/owner/);
    expect(() => Z.waehleBestaetigtes([o(9)], einzeln, "")).toThrow(/owner/);
    expect(abgerufen).toBe(0);
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

describe("setzeUndPruefe: das Board kommt als Parameter (L24)", () => {
  type B = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
  type Io = { loadItems: (b: string) => B[]; setPosition: (b: string, id: string, after: string | null) => void; sleep: (ms: number) => Promise<void> };
  const S = (raw as unknown as { setzeUndPruefe: (a: { nr: number; position: number; dry?: boolean; board?: string }, io?: Partial<Io>) => Promise<string> }).setzeUndPruefe;
  const b = (number: number): B => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open" });
  const sammel = (): B => ({ ...b(20), title: "Harness-Härtung (gesammelt)" });
  const items = [b(1), b(2), b(3), b(4), b(5), b(6), sammel()];

  test("loadItems und setPosition bekommen genau das übergebene Board; nach dem Setzen steht es richtig", async () => {
    const geladen: string[] = [];
    const gesetzt: string[] = [];
    let stand = items;
    const io: Partial<Io> = {
      loadItems: (board) => {
        geladen.push(board);
        return stand;
      },
      setPosition: (board, id) => {
        gesetzt.push(`${board}:${id}`);
        stand = [b(1), sammel(), b(2), b(3), b(4), b(5), b(6)];
      },
      sleep: async () => {},
    };
    expect(await S({ nr: 20, position: 3, board: "FB" }, io)).toBe("ok");
    expect(gesetzt).toEqual(["FB:I20"]);
    expect(new Set(geladen)).toEqual(new Set(["FB"]));
  });

  test("ohne board wirft sie vor dem ersten Laden", async () => {
    let geladen = 0;
    await expect(S({ nr: 20, position: 3 }, { loadItems: () => (geladen++, items), sleep: async () => {} })).rejects.toThrow(/board fehlt/);
    expect(geladen).toBe(0);
  });

  test("Verdrahtung: der Aufruf in main übergibt das Factory-Board", () => {
    const skript = readFileSync(new URL("../scripts/sammelticket-anlegen.mjs", import.meta.url), "utf8");
    expect(skript).toMatch(/setzeUndPruefe\(\{[^}]*board:\s*FACTORY_BOARD/);
  });
});
