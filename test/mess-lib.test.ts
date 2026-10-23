/* Gemeinsamer Messhelfer (#1561 Z1): Median und Cache-TTL-Schwellen stehen einmal in scripts/mess-lib.mjs. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/mess-lib.mjs";
import { FREMD, projektConfig, repoName } from "./support/fremd-config";

const WT = FREMD.praefixe.worktree;
const M = raw as unknown as { median: (w: number[]) => number | null; CACHE_TTL_MS: { fuenfMin: number; eineStunde: number } };

describe("median", () => {
  test("ungerade, gerade, leer, nicht endliche Werte ignoriert", () => {
    expect(M.median([3, 1, 2])).toBe(2);
    expect(M.median([4, 1, 2, 3])).toBe(2.5);
    expect(M.median([])).toBeNull();
    expect(M.median([Number.NaN, 5])).toBe(5);
    expect(M.median([Number.NaN, Infinity])).toBeNull();
  });
});

describe("CACHE_TTL_MS", () => {
  test("Schwellen 5 min und 1 h, eingefroren", () => {
    expect(M.CACHE_TTL_MS).toEqual({ fuenfMin: 300_000, eineStunde: 3_600_000 });
    expect(Object.isFrozen(M.CACHE_TTL_MS)).toBe(true);
  });
});

describe("keine lokalen Kopien in den Mess-Skripten", () => {
  test.each(["token-baseline", "subagent-laufzeit", "hauptchat-zerlegung"])("%s importiert aus mess-lib.mjs und definiert kein eigenes median", (name) => {
    const src = readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), "utf8");
    expect(src).toMatch(/from "\.\/mess-lib\.mjs"/);
    expect(src).not.toMatch(/(function median|const median\w* =|\d \* 60_000)/);
  });
});

describe("kontextVon und istNeuaufbau (#1572: ein Prädikat für countCacheRebuilds und kontext-treiber)", () => {
  const R = raw as unknown as {
    kontextVon: (c: Record<string, unknown>) => number;
    istNeuaufbau: (e: { gapMs: number; pauseMs: number; call: Record<string, unknown> }) => boolean;
  };
  const PAUSE = 300_000;
  const call = (cacheRead: number, cacheWrite = 100, input = 0) => ({ input, cacheWrite, cacheRead });

  test("kontextVon: Summe aus Input, Cache-Write und Cache-Read; fehlende Felder zählen 0", () => {
    expect(R.kontextVon({ input: 1, cacheWrite: 2, cacheRead: 3 })).toBe(6);
    expect(R.kontextVon({})).toBe(0);
  });
  test("Neuaufbau: Pause über der TTL und Cache-Read unter der Hälfte des Kontexts", () => {
    expect(R.istNeuaufbau({ gapMs: PAUSE + 1, pauseMs: PAUSE, call: call(10) })).toBe(true);
  });
  test("Grenzen: Pause genau TTL, Cache-Read genau die Hälfte und Kontext 0 sind kein Neuaufbau", () => {
    expect(R.istNeuaufbau({ gapMs: PAUSE, pauseMs: PAUSE, call: call(10) })).toBe(false);
    expect(R.istNeuaufbau({ gapMs: PAUSE + 1, pauseMs: PAUSE, call: call(100, 100) })).toBe(false);
    expect(R.istNeuaufbau({ gapMs: PAUSE + 1, pauseMs: PAUSE, call: call(0, 0, 0) })).toBe(false);
    expect(R.istNeuaufbau({ gapMs: PAUSE + 1, pauseMs: PAUSE, call: call(99, 100) })).toBe(true);
  });
  test.each(["token-baseline", "kontext-treiber"])("%s nutzt das gemeinsame Prädikat statt einer eigenen Kopie", (name) => {
    const src = readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), "utf8");
    expect(src).toMatch(/istNeuaufbau/);
    expect(src).not.toMatch(/cacheRead\) < ctx \/ 2/);
  });
});

describe("bereinige (#1572: Wurzel zur Laufzeit, kein lokaler Pfad im Quelltext)", () => {
  const B = raw as unknown as { bereinige: (t: string, o?: { wurzel?: string | null; worktree?: string | null }) => string };
  const WURZEL = "C:/work/projekt";
  test("Home und Worktree-Präfix werden ersetzt, Backslashes zu Schrägstrichen", () => {
    expect(B.bereinige("C:/Users/Max/dev/x.ts")).toBe("~/dev/x.ts");
    expect(B.bereinige("C:\\Users\\Max\\dev\\x.ts")).toBe("~/dev/x.ts");
    expect(B.bereinige("cat /c/Users/Max/x.md")).toBe("cat ~/x.md");
    expect(B.bereinige(`C:/work/projekt/.claude/worktrees/${WT}1559/src/a.ts`, { worktree: WT })).toBe("<wt>/src/a.ts");
    expect(B.bereinige(`cd /c/work/projekt/.claude/worktrees/${WT}1469 && ls`, { worktree: WT })).toBe("cd <wt>/ && ls");
    expect(B.bereinige("a   b\n c")).toBe("a b c");
  });
  test("Wurzel in beiden Schreibweisen, mit und ohne Schrägstrich am Ende der Wurzel und im Text", () => {
    for (const wurzel of ["C:/work/projekt", "C:\\work\\projekt\\", "/c/work/projekt", "/c/work/projekt/"]) {
      expect(B.bereinige("Read C:/work/projekt/docs/a.md", { wurzel })).toBe("Read <repo>/docs/a.md");
      expect(B.bereinige("cat /c/work/projekt/docs/a.md", { wurzel })).toBe("cat <repo>/docs/a.md");
      expect(B.bereinige("cd /c/work/projekt && ls", { wurzel })).toBe("cd <repo>/ && ls");
    }
  });
  test("Geschwister-Pfad, fremder Pfad und fehlende Wurzel bleiben unverändert", () => {
    expect(B.bereinige("C:/work/projekt-alt/x", { wurzel: WURZEL })).toBe("C:/work/projekt-alt/x");
    expect(B.bereinige("D:/andere/y", { wurzel: WURZEL })).toBe("D:/andere/y");
    expect(B.bereinige("C:/work/projekt/a", { wurzel: null })).toBe("C:/work/projekt/a");
    expect(B.bereinige("C:/work/projekt/a")).toBe("C:/work/projekt/a");
  });
  test("keine fest verdrahtete Repo-Wurzel im Quelltext der Messskripte", () => {
    for (const name of ["mess-lib", "kontext-treiber"]) {
      expect(readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), "utf8")).not.toMatch(new RegExp("dev/" + repoName(projektConfig())));
    }
  });
});

describe("vereinigungsLaenge (#1579: eine Intervall-Vereinigung für Zeit und Zeilen)", () => {
  const V = raw as unknown as { vereinigungsLaenge: (i: [number, number][], o?: { geschlossen?: boolean }) => number };
  test("leer, unsortiert, verschachtelt", () => {
    expect(V.vereinigungsLaenge([])).toBe(0);
    expect(V.vereinigungsLaenge([[20, 30], [0, 10]])).toBe(20);
    expect(V.vereinigungsLaenge([[0, 10], [2, 4]])).toBe(10);
    expect(V.vereinigungsLaenge([[0, 10], [5, 15]])).toBe(15);
  });
  test("halboffen: anstoßend ergibt keine Lücke, ein Abstand schon", () => {
    expect(V.vereinigungsLaenge([[0, 3], [3, 5]])).toBe(5);
    expect(V.vereinigungsLaenge([[0, 3], [4, 5]])).toBe(4);
  });
  test("geschlossen (Zeilenbereiche): Länge b-a+1", () => {
    expect(V.vereinigungsLaenge([[1, 3], [4, 5]], { geschlossen: true })).toBe(5);
    expect(V.vereinigungsLaenge([[1, 3], [5, 6]], { geschlossen: true })).toBe(5);
    expect(V.vereinigungsLaenge([[7, 7]], { geschlossen: true })).toBe(1);
  });
  test("ungültige Einträge (NaN, b < a) werden ignoriert", () => {
    expect(V.vereinigungsLaenge([[10, 0], [Number.NaN, 3], [0, 4]])).toBe(4);
    expect(V.vereinigungsLaenge([[10, 0], [Number.NaN, 3]], { geschlossen: true })).toBe(0);
  });
  test.each(["patch-zugriff", "subagent-laeufe"])("%s definiert keine eigene Vereinigung", (name) => {
    const src = readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), "utf8");
    expect(src).toMatch(/vereinigungsLaenge/);
    expect(src).not.toMatch(/function vereinigung(Ms)?\(/);
  });
});

describe("istEchtesModell (#1579)", () => {
  const E = raw as unknown as { istEchtesModell: (m: unknown) => boolean };
  test("leer und der Client-Platzhalter zählen nicht, ein echtes Modell schon", () => {
    expect(E.istEchtesModell("<synthetic>")).toBe(false);
    expect(E.istEchtesModell("")).toBe(false);
    expect(E.istEchtesModell(undefined)).toBe(false);
    expect(E.istEchtesModell("claude-opus-4-7")).toBe(true);
  });
});

describe("Ticketnummer und Ticketfilter (#1609)", () => {
  const T = raw as unknown as {
    ticketNummer: (name: string, wert: unknown) => { nr: number; fehler: string | null };
    passtTicketFilter: (ticket: number | null, f: { tickets?: number[]; ohne?: number[] }) => boolean;
  };
  test("ticketNummer: Ganzzahl ok, sonst Fehlertext mit Flag und Wert", () => {
    expect(T.ticketNummer("--ohne", "12")).toEqual({ nr: 12, fehler: null });
    expect(T.ticketNummer("--ohne", "abc").fehler).toBe("--ohne erwartet eine Ticketnummer, nicht abc");
    expect(T.ticketNummer("--ticket", undefined).fehler).toBe("--ticket erwartet eine Ticketnummer, nicht nichts");
    expect(T.ticketNummer("--ticket", "1.5").fehler).not.toBeNull();
  });
  test("passtTicketFilter: tickets = nur diese, ohne = alle außer diesen, leer = alle", () => {
    expect(T.passtTicketFilter(5, {})).toBe(true);
    expect(T.passtTicketFilter(null, {})).toBe(true);
    expect(T.passtTicketFilter(5, { tickets: [5] })).toBe(true);
    expect(T.passtTicketFilter(6, { tickets: [5] })).toBe(false);
    expect(T.passtTicketFilter(null, { tickets: [5] })).toBe(false);
    expect(T.passtTicketFilter(5, { ohne: [5] })).toBe(false);
    expect(T.passtTicketFilter(6, { ohne: [5] })).toBe(true);
    expect(T.passtTicketFilter(5, { tickets: [5], ohne: [5] })).toBe(false);
  });
});

describe("normPfad (#1646: eine Normalisierung für bereinige und Kontext-Treiber)", () => {
  const N = raw as unknown as { normPfad: (p: string, o?: { wurzel?: string | null; worktree?: string | null }) => string };
  test("Worktree-Präfix und Wurzel fallen weg, klein, POSIX", () => {
    expect(N.normPfad(`C:\\Dev\\Proj\\.claude\\worktrees\\${WT}5-x\\Scripts\\A.mjs`, { wurzel: "C:/dev/proj", worktree: WT })).toBe("scripts/a.mjs");
    expect(N.normPfad("C:/dev/proj/scripts/a.mjs", { wurzel: "C:/dev/proj" })).toBe("scripts/a.mjs");
  });
  test("Wurzel mit Backslash und mit Schrägstrich am Ende", () => {
    expect(N.normPfad("C:/dev/proj/src/b.ts", { wurzel: "C:\\dev\\proj" })).toBe("src/b.ts");
    expect(N.normPfad("C:/dev/proj/src/b.ts", { wurzel: "C:/dev/proj/" })).toBe("src/b.ts");
  });
  test("Git-Bash-Wurzel passt auf einen C:-Pfad und umgekehrt", () => {
    expect(N.normPfad("C:/dev/proj/src/b.ts", { wurzel: "/c/dev/proj" })).toBe("src/b.ts");
    expect(N.normPfad("/c/dev/proj/src/b.ts", { wurzel: "C:/dev/proj" })).toBe("src/b.ts");
  });
  test("Negativ: Pfad außerhalb der Wurzel, ähnlicher Präfix und fehlende Wurzel bleiben unverändert", () => {
    expect(N.normPfad("D:/other/src/b.ts", { wurzel: "C:/dev/proj" })).toBe("d:/other/src/b.ts");
    expect(N.normPfad("C:/dev/proj2/src/b.ts", { wurzel: "C:/dev/proj" })).toBe("c:/dev/proj2/src/b.ts");
    expect(N.normPfad("C:/dev/proj/src/b.ts")).toBe("c:/dev/proj/src/b.ts");
  });
});

describe("ticketZaehlung und mehrlaufHinweis (#1646)", () => {
  const Z = raw as unknown as {
    ticketZaehlung: (l: { ticket: number | null }[]) => { tickets: number; mehrlauf: number };
    mehrlaufHinweis: (mehrlauf: number) => string;
  };
  test("zählt verschiedene Tickets und die mit mehr als einem Lauf; Läufe ohne Ticket zählen nicht", () => {
    expect(Z.ticketZaehlung([{ ticket: 1 }, { ticket: 1 }, { ticket: 2 }, { ticket: null }])).toEqual({ tickets: 2, mehrlauf: 1 });
  });
  test("leere Liste und je ein Lauf: keine Mehrfachläufe", () => {
    expect(Z.ticketZaehlung([])).toEqual({ tickets: 0, mehrlauf: 0 });
    expect(Z.ticketZaehlung([{ ticket: 1 }, { ticket: 2 }])).toEqual({ tickets: 2, mehrlauf: 0 });
  });
  test("Warnzeile nur bei Mehrfachläufen, mit Zahl und Verweis auf --je-ticket", () => {
    expect(Z.mehrlaufHinweis(0)).toBe("");
    expect(Z.mehrlaufHinweis(2)).toBe("Mediane je Lauf, nicht je Ticket (2 Tickets mit mehreren Läufen); Ticket-Schnitt: kontext-treiber --je-ticket");
  });
});

describe("claimNummer (#1616)", () => {
  const C = raw as unknown as { claimNummer: (cmd: string) => number | null };
  test("Claim-Zeile liefert die Ticketnummer", () => {
    expect(C.claimNummer("gh issue edit 1616 --add-assignee @me")).toBe(1616);
    expect(C.claimNummer("cd x && gh issue edit 12 --add-label a --add-assignee @me")).toBe(12);
  });
  test("kein Claim: Entfernen, Ansehen, leer", () => {
    expect(C.claimNummer("gh issue edit 1616 --remove-assignee @me")).toBeNull();
    expect(C.claimNummer("gh issue view 1616")).toBeNull();
    expect(C.claimNummer("")).toBeNull();
    expect(C.claimNummer(undefined as unknown as string)).toBeNull();
  });
});

describe("Ticketfilter aus flagsLesen-Werten (#1790)", () => {
  const T = raw as unknown as {
    TICKET_OPTIONEN: Record<string, { type: string; multiple: boolean }>;
    ticketMeldung: (art: string, flag: string) => string | undefined;
    ticketFilterAus: (werte: { ticket?: string[]; ohne?: string[] }) => { tickets: number[]; ohne: number[]; fehler: string | null };
  };
  test("TICKET_OPTIONEN: --ticket und --ohne sind wiederholbare Wert-Flags", () => {
    expect(T.TICKET_OPTIONEN).toEqual({ ticket: { type: "string", multiple: true }, ohne: { type: "string", multiple: true } });
  });
  test("ticketFilterAus: gültige Listen, leer oder fehlend ergibt []", () => {
    expect(T.ticketFilterAus({ ticket: ["1", "2"], ohne: ["3"] })).toEqual({ tickets: [1, 2], ohne: [3], fehler: null });
    expect(T.ticketFilterAus({})).toEqual({ tickets: [], ohne: [], fehler: null });
  });
  test("ticketFilterAus: Nicht-Ganzzahl und leerer Wert setzen fehler, bei --ohne wie bei --ticket", () => {
    expect(T.ticketFilterAus({ ticket: ["abc"] }).fehler).toBe("--ticket erwartet eine Ticketnummer, nicht abc");
    expect(T.ticketFilterAus({ ohne: [""] }).fehler).toBe("--ohne erwartet eine Ticketnummer, nicht ");
    expect(T.ticketFilterAus({ ticket: ["1.5"] }).fehler).not.toBeNull();
    expect(T.ticketFilterAus({ ticket: ["1", "x"], ohne: ["y"] }).fehler).toBe("--ticket erwartet eine Ticketnummer, nicht x");
  });
  test("ticketMeldung: nur ohne-wert bei --ticket/--ohne, sonst Standardtext (undefined)", () => {
    expect(T.ticketMeldung("ohne-wert", "--ticket")).toBe("--ticket erwartet eine Ticketnummer, nicht nichts");
    expect(T.ticketMeldung("ohne-wert", "--ohne")).toBe("--ohne erwartet eine Ticketnummer, nicht nichts");
    expect(T.ticketMeldung("ohne-wert", "--von")).toBeUndefined();
    expect(T.ticketMeldung("unbekannt", "--ticket")).toBeUndefined();
  });
});
