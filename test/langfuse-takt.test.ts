/* Langfuse-Takt (#1351, ADR 0016): die Entscheidung für das Status-Ticket ist pur und idempotent. Der generische Board-Takt (Commit-Fenster,
 * Harness-Sammelticket, Positionskorrektur) steht in test/board-takt.test.ts.
 *
 * Reines Node-Tooling-Skript ohne Declaration-File: Import über `unknown` auf ein lokales Interface
 * (gleiche Technik wie test/board.test.ts). */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { FREMD_OWNER, projektConfig } from "./support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/langfuse-takt.mjs";

type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Entscheidung = { aktion: "anlegen" | "nach-oben" | "nichts"; nr?: number; grund: string; warnungen: string[] };
type Takt = {
  STATUS_TITEL: string;
  MIN_MERGES: number;
  entscheideTakt: (a: { offene: Offen[]; mergesSeit: number; ticketMerges?: number; ausloeser?: string; stundenSeitAbschluss?: number | null; jetzt?: string | Date }) => Entscheidung;
  PUSH_RUHETAGE: number[];
  MIN_ABSTAND_STUNDEN: number;
  MIN_TICKET_MERGES_PUSH: number;
  wochenFenster: (jetzt: string | Date) => { letzte: { von: string; bis: string }; davor: { von: string; bis: string } };
  statusBody: (a: { vorgaenger: { number: number; closedAt: string; createdAt?: string } | null; jetzt: string | Date; repo?: string }) => string;
};
type Item = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
const T = raw as unknown as Takt;

const offen = (number: number, over: Partial<Offen> = {}): Offen => ({
  number,
  titel: T.STATUS_TITEL,
  assignees: [],
  createdAt: `2026-10-0${number % 9 || 1}T05:00:00Z`,
  ...over,
});

describe("entscheideTakt", () => {
  test("legt an: kein offenes Status-Ticket und genug Merges", () => {
    const e = T.entscheideTakt({ offene: [], mergesSeit: T.MIN_MERGES });
    expect(e.aktion).toBe("anlegen");
  });

  test("nichts: zu wenig Merges (Grenze MIN_MERGES - 1) und gar keine", () => {
    expect(T.entscheideTakt({ offene: [], mergesSeit: T.MIN_MERGES - 1 }).aktion).toBe("nichts");
    expect(T.entscheideTakt({ offene: [], mergesSeit: 0 }).aktion).toBe("nichts");
  });

  test("nach-oben: ein ungeclaimtes offenes Ticket, auch ohne Merges", () => {
    const e = T.entscheideTakt({ offene: [offen(1304)], mergesSeit: 0 });
    expect(e).toMatchObject({ aktion: "nach-oben", nr: 1304 });
    expect(e.warnungen).toEqual([]);
  });

  test("nichts: ein geclaimtes offenes Ticket läuft schon", () => {
    expect(T.entscheideTakt({ offene: [offen(1304, { assignees: [FREMD_OWNER] })], mergesSeit: 99 }).aktion).toBe("nichts");
  });

  test("zwei offene, keins geclaimt: das älteste nach oben, Warnung 'Mehrere'", () => {
    const e = T.entscheideTakt({
      offene: [offen(1400, { createdAt: "2026-10-05T05:00:00Z" }), offen(1304, { createdAt: "2026-10-01T05:00:00Z" })],
      mergesSeit: 0,
    });
    expect(e).toMatchObject({ aktion: "nach-oben", nr: 1304 });
    expect(e.warnungen.join(" ")).toMatch(/Mehrere/);
  });

  test("zwei offene, das jüngere geclaimt: nichts, Warnung", () => {
    const e = T.entscheideTakt({
      offene: [offen(1304, { createdAt: "2026-10-01T05:00:00Z" }), offen(1400, { createdAt: "2026-10-05T05:00:00Z", assignees: [FREMD_OWNER] })],
      mergesSeit: 0,
    });
    expect(e.aktion).toBe("nichts");
    expect(e.warnungen).toHaveLength(1);
  });

  test("Titel muss exakt passen: Zusatz, Kleinschreibung und Sammelticket treffen nicht", () => {
    const fremd = [
      offen(1, { titel: `${T.STATUS_TITEL} (alt)` }),
      offen(2, { titel: T.STATUS_TITEL.toLowerCase() }),
      offen(3, { titel: "Langfuse-Befunde (gesammelt)" }),
    ];
    expect(T.entscheideTakt({ offene: fremd, mergesSeit: T.MIN_MERGES }).aktion).toBe("anlegen");
  });

  test("zwei Auslösungen nacheinander: nie ein zweites Anlegen, dieselbe Nummer bleibt Ziel", () => {
    const s0: Offen[] = [];
    const e0 = T.entscheideTakt({ offene: s0, mergesSeit: T.MIN_MERGES });
    expect(e0.aktion).toBe("anlegen");
    const s1 = [...s0, offen(1500)]; // der erste Lauf hat das Ticket angelegt
    const e1 = T.entscheideTakt({ offene: s1, mergesSeit: T.MIN_MERGES });
    expect(e1).toMatchObject({ aktion: "nach-oben", nr: 1500 });
    const e2 = T.entscheideTakt({ offene: s1, mergesSeit: T.MIN_MERGES });
    expect(e2).toEqual(e1);
  });

  test("ungültige Eingaben werfen", () => {
    for (const bad of [-1, 1.5, Number.NaN, "5" as unknown as number]) {
      expect(() => T.entscheideTakt({ offene: [], mergesSeit: bad })).toThrow();
    }
    expect(() => T.entscheideTakt({ offene: null as unknown as Offen[], mergesSeit: 5 })).toThrow();
    expect(() => T.entscheideTakt({ offene: [offen(1, { createdAt: "kaputt" }), offen(2)], mergesSeit: 5 })).toThrow();
  });
});

describe("wochenFenster", () => {
  test("letzte volle Woche Mo–So UTC und die davor (Mittwoch als Anker)", () => {
    expect(T.wochenFenster("2026-10-07T12:00:00Z")).toEqual({
      letzte: { von: "2026-09-28", bis: "2026-10-04" },
      davor: { von: "2026-09-21", bis: "2026-09-27" },
    });
  });
  test("Montag früh und Sonntag spät gehören zur selben laufenden Woche", () => {
    expect(T.wochenFenster("2026-10-05T00:00:01Z").letzte.von).toBe("2026-09-28");
    expect(T.wochenFenster("2026-10-11T23:59:59Z").letzte.von).toBe("2026-09-28");
  });
});

describe("statusBody", () => {
  const body = T.statusBody({ vorgaenger: { number: 1276, closedAt: "2026-10-06T10:00:00Z" }, jetzt: "2026-10-07T00:00:00Z" });
  test("enthält Zeitraum, Wochenbudget, beide Links und das Sammelticket", () => {
    expect(body).toContain("#1276");
    expect(body).toContain("2026-09-28");
    expect(body).toContain("#langfuse-status-überprüfen-1293");
    expect(body).toContain("Langfuse-Befunde (gesammelt)");
  });
  test("keine Positions-Regel und kein Folgeticket mehr", () => {
    expect(body).not.toMatch(/Position\s*:?\s*\d+/);
    expect(body).not.toContain("Langfuse-Folgen");
    expect(body).not.toMatch(/Nachfolger/);
  });
  test("die Doku-Links bauen auf dem übergebenen Repo auf (Z5e)", () => {
    const x = T.statusBody({ vorgaenger: null, jetzt: "2026-10-07T00:00:00Z", repo: "x/y" });
    expect(x).toContain("https://github.com/x/y/blob/main/docs/model-routing.md#");
    expect(x).toContain("https://github.com/x/y/blob/main/docs/ticket-reihenfolge.md#");
    expect(x).not.toContain(String(projektConfig().repo));
  });
  test("Factory-Kennzahlen-Aufruf mit dem Abschlusszeitpunkt des Vorgängers, sonst Platzhalter (#1616)", () => {
    expect(body).toContain("node scripts/factory-kennzahlen.mjs --von 2026-10-06T10:00:00Z --bis <Claim-Zeit>");
    const ohne = T.statusBody({ vorgaenger: null, jetzt: "2026-10-07T00:00:00Z" });
    expect(ohne).toContain("--von <Start des Zeitraums> --bis <Claim-Zeit>");
  });
  test("ohne Vorgänger: Bezug auf #1293", () => {
    expect(T.statusBody({ vorgaenger: null, jetzt: "2026-10-07T00:00:00Z" })).toContain("#1293");
  });
});

describe("Bindungen und Sortierung (#1342)", () => {
  const lies = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

  test("MIN_MERGES stimmt mit der Zahl in ADR 0016 und im Workflow-Kommentar überein", () => {
    const adr = /Untergrenze von (\d+) Commits/.exec(lies("docs/adr/0016-langfuse-takt-woechentlich.md"))?.[1];
    const yml = /mindestens (\d+) Commits/.exec(lies(".github/workflows/board-takt.yml"))?.[1];
    expect(Number(adr)).toBe(T.MIN_MERGES);
    expect(Number(yml)).toBe(T.MIN_MERGES);
  });

  test("Sortierung: älteres createdAt gewinnt vor der Nummer, bei gleichem createdAt die kleinere Nummer", () => {
    const aeltererMitHoehererNr = [offen(1400, { createdAt: "2026-10-01T05:00:00Z" }), offen(1304, { createdAt: "2026-10-05T05:00:00Z" })];
    expect(T.entscheideTakt({ offene: aeltererMitHoehererNr, mergesSeit: 0 })).toMatchObject({ nr: 1400 });
    const gleich = [offen(1400, { createdAt: "2026-10-01T05:00:00Z" }), offen(1304, { createdAt: "2026-10-01T05:00:00Z" })];
    expect(T.entscheideTakt({ offene: gleich, mergesSeit: 0 })).toMatchObject({ nr: 1304 });
    expect(T.entscheideTakt({ offene: [...gleich].reverse(), mergesSeit: 0 })).toMatchObject({ nr: 1304 });
  });
});

describe("Push-Auslöser nach Aktivität (#1349 Z14)", () => {
  const DO = "2026-10-15T12:00:00Z"; // Donnerstag
  const push = (ticketMerges: number, offene: Offen[] = [], jetzt: string | Date = DO) =>
    T.entscheideTakt({ offene, mergesSeit: 99, ticketMerges, ausloeser: "push", jetzt });

  test("Grenze 49/50 (#1628): unter der Untergrenze nichts, ab 50 anlegen", () => {
    expect(T.MIN_TICKET_MERGES_PUSH).toBe(50);
    expect(push(49).aktion).toBe("nichts");
    expect(push(50).aktion).toBe("anlegen");
    expect(push(51).aktion).toBe("anlegen");
  });

  test("Push mit offenem ungeclaimtem Status-Ticket: unter 50 nichts (kein Hochschieben bei jedem Merge), ab 50 nach oben", () => {
    expect(push(49, [offen(1304)]).aktion).toBe("nichts");
    expect(push(50, [offen(1304)])).toMatchObject({ aktion: "nach-oben", nr: 1304 });
  });

  test("Push mit geclaimtem Status-Ticket: nichts", () => {
    expect(push(60, [offen(1304, { assignees: [FREMD_OWNER] })]).aktion).toBe("nichts");
  });

  test("Push ruht Fr, Sa, So (UTC): auch mit 60 Merges nichts, Grund nennt die Ruhe; Grenzfälle Fr 00:00 und So 23:59", () => {
    expect(T.PUSH_RUHETAGE).toEqual([5, 6, 0]);
    for (const jetzt of ["2026-10-16T00:00:00Z", "2026-10-16T12:00:00Z", "2026-10-17T12:00:00Z", "2026-10-18T23:59:59Z"]) {
      const e = push(60, [], jetzt);
      expect(e.aktion).toBe("nichts");
      expect(e.grund).toContain("ruht Fr–So, der Montag setzt zurück");
    }
    expect(push(60, [], "2026-10-15T23:59:59Z").aktion).toBe("anlegen"); // Do
    expect(push(60, [], "2026-10-19T00:00:00Z").aktion).toBe("anlegen"); // Mo
    expect(push(60, [offen(1304)], "2026-10-16T12:00:00Z").aktion).toBe("nichts"); // auch kein Hochschieben
    expect(push(60, [], new Date("2026-10-16T12:00:00Z")).aktion).toBe("nichts");
  });

  test("Cron am Montag legt an; der Wochentag sperrt den Cron nicht", () => {
    expect(T.entscheideTakt({ offene: [], mergesSeit: T.MIN_MERGES, ausloeser: "schedule", jetzt: "2026-10-19T05:00:00Z" }).aktion).toBe("anlegen");
    expect(T.entscheideTakt({ offene: [], mergesSeit: T.MIN_MERGES, ausloeser: "schedule", jetzt: "2026-10-16T05:00:00Z" }).aktion).toBe("anlegen");
  });

  test("ungültiges jetzt wirft", () => {
    expect(() => push(60, [], "kein-datum")).toThrow();
  });

  test("Cron bleibt bei MIN_MERGES und ignoriert ticketMerges", () => {
    expect(T.entscheideTakt({ offene: [], mergesSeit: T.MIN_MERGES, ticketMerges: 0, ausloeser: "schedule" }).aktion).toBe("anlegen");
    expect(T.entscheideTakt({ offene: [], mergesSeit: T.MIN_MERGES - 1, ticketMerges: 99, ausloeser: "schedule" }).aktion).toBe("nichts");
  });
});

describe("sollBewegen (#1349): ein Status-Ticket im Kopf bleibt liegen", () => {
  const S = raw as unknown as { sollBewegen: (e: { aktion: string; nr?: number }, items: Item[]) => boolean };
  const it = (number: number, title: string): Item => ({ id: `I${number}`, number, status: "Todo", title, assignees: [], state: "open" });
  test("nach-oben: steht im Kopf → nicht bewegen; steht weiter unten → bewegen; fehlt im Board → bewegen", () => {
    const im = [it(5, T.STATUS_TITEL), it(6, "x")];
    const unten = [it(6, "x"), it(5, T.STATUS_TITEL)];
    expect(S.sollBewegen({ aktion: "nach-oben", nr: 5 }, im)).toBe(false);
    expect(S.sollBewegen({ aktion: "nach-oben", nr: 5 }, unten)).toBe(true);
    expect(S.sollBewegen({ aktion: "nach-oben", nr: 5 }, [])).toBe(true);
  });
  test("anlegen bewegt immer", () => {
    expect(S.sollBewegen({ aktion: "anlegen" }, [it(5, T.STATUS_TITEL)])).toBe(true);
  });
});

describe("Zuständigkeit (#1390): langfuse-takt.mjs ist die Status-Logik, der Takt-Lauf liegt in board-takt.mjs", () => {
  test("langfuse-takt.mjs hat keinen eigenen Lauf mehr und keine Harness-Sammelticket-Logik", () => {
    const skript = readFileSync(new URL("../scripts/langfuse-takt.mjs", import.meta.url), "utf8");
    expect(skript).not.toMatch(/function main\b/);
    expect(skript).not.toMatch(/entscheideHarnessTakt|HARNESS_TAKT_KOMMENTARE/);
    expect(Object.keys(raw as object)).not.toContain("entscheideHarnessTakt");
  });
});

describe("Mindestabstand und Wochenbudget (#1382)", () => {
  const an = (stundenSeitAbschluss: number | null, ausloeser = "schedule", offene: Offen[] = []) =>
    T.entscheideTakt({ offene, mergesSeit: 50, ticketMerges: 60, ausloeser, stundenSeitAbschluss, jetzt: "2026-10-15T12:00:00Z" });

  test("Grenze 23,9 h / 24 h beim Anlegen, bei beiden Auslösern", () => {
    expect(T.MIN_ABSTAND_STUNDEN).toBe(24);
    for (const ausloeser of ["schedule", "push"]) {
      expect(an(23.9, ausloeser).aktion).toBe("nichts");
      expect(an(24, ausloeser).aktion).toBe("anlegen");
    }
  });
  test("ohne Vorgänger (null) und ohne Angabe (undefined) wird angelegt", () => {
    expect(an(null).aktion).toBe("anlegen");
    expect(T.entscheideTakt({ offene: [], mergesSeit: 50 }).aktion).toBe("anlegen");
  });
  test("ungültiger Abstand (NaN, negativ, Text) wirft, statt den Mindestabstand still auszuhebeln", () => {
    for (const bad of [Number.NaN, -1, "5" as unknown as number]) {
      expect(() => an(bad)).toThrow();
    }
  });
  test("Abstand 0 h ist gültig und legt nicht an", () => {
    expect(an(0).aktion).toBe("nichts");
  });
  test("nach-oben ignoriert den Abstand", () => {
    expect(an(1, "schedule", [offen(1304)])).toMatchObject({ aktion: "nach-oben", nr: 1304 });
  });
  test("der Grund nennt den Abstand", () => {
    expect(an(5).grund).toMatch(/24 h/);
  });
  test("statusBody: gleiche Woche → Wochenbudget entfällt; andere Woche, fehlendes createdAt → gemessen", () => {
    const v = (createdAt?: string) => ({ number: 1395, closedAt: "2026-10-07T20:00:00Z", ...(createdAt ? { createdAt } : {}) });
    const jetzt = "2026-10-08T12:00:00Z";
    const gleich = T.statusBody({ vorgaenger: v("2026-10-07T13:56:11Z"), jetzt });
    expect(gleich).toMatch(/Wochenbudget:\*\* entfällt, Woche 2026-09-28 bis 2026-10-04 hat #1395 schon gemessen/);
    const andere = T.statusBody({ vorgaenger: v("2026-09-30T13:56:11Z"), jetzt });
    expect(andere).toMatch(/Wochenbudget:\*\* letzte volle Woche 2026-09-28/);
    expect(T.statusBody({ vorgaenger: v(), jetzt })).toMatch(/Wochenbudget:\*\* letzte volle Woche/);
    expect(T.statusBody({ vorgaenger: null, jetzt })).toMatch(/Wochenbudget:\*\* letzte volle Woche/);
  });
});

describe("fuehreStatusAus: Fehlertext beim Setzen der Board-Position (#1609)", () => {
  test("ein Wurf trägt Präfix, Folgezeilen, stderr und den Idempotenz-Zusatz in eigener Zeile; ok=false", () => {
    const F = (raw as unknown as {
      fuehreStatusAus: (e: unknown, c: unknown) => { ok: boolean; nr: number; itemId: string | null };
    }).fuehreStatusAus;
    const zeilen: string[] = [];
    const orig = console.log;
    console.log = (z: string) => void zeilen.push(String(z));
    try {
      const r = F(
        { aktion: "position", nr: 5 },
        {
          repo: "o/r",
          token: "t",
          items: [],
          config: projektConfig(),
          io: {
            gh: () => ({ node_id: "N" }),
            imBoardAnlegen: () => "I",
            setze: () => {
              throw Object.assign(new Error("Command failed: gh api graphql\nzweite Zeile"), { stderr: "gh: HTTP 502" });
            },
          },
        },
      );
      expect(r).toEqual({ ok: false, nr: 5, itemId: null });
    } finally {
      console.log = orig;
    }
    const text = zeilen.join("\n");
    expect(text).toMatch(/^::error::Board-Position nicht gesetzt: Command failed: gh api graphql/);
    expect(text).toContain("zweite Zeile");
    expect(text).toContain("gh: HTTP 502");
    expect(text).toMatch(/\nDie Wiederholung ist idempotent und legt kein zweites Ticket an\.$/);
  });
});

describe("fuehreStatusAus: Label und Board aus der übergebenen Config (#1798)", () => {
  const F = (raw as unknown as { fuehreStatusAus: (e: unknown, c: unknown) => { ok: boolean } }).fuehreStatusAus;
  const lauf = (config: unknown) => {
    const api: string[][] = [];
    const orig = console.log;
    console.log = () => {};
    try {
      F(
        { aktion: "anlegen" },
        {
          repo: "o/r", vorgaenger: null, jetzt: new Date("2026-10-16T00:00:00Z"), token: "t", items: [], config,
          io: { gh: (a: string[]) => (api.push(a), { number: 5, node_id: "N" }), imBoardAnlegen: () => "I", setze: () => {} },
        },
      );
    } finally {
      console.log = orig;
    }
    return api.flat();
  };
  test("das Label der Config (nicht das echte Literal) wird beim Anlegen gesendet", () => {
    expect(lauf({ labels: { harness: "bereich:fabrik" } })).toContain("labels[]=bereich:fabrik");
  });
  test("ohne Config oder ohne labels.harness wirft die Funktion", () => {
    expect(() => lauf(undefined)).toThrow(/labels\.harness[\s\S]*Fix:/);
    expect(() => lauf({ labels: {} })).toThrow(/labels\.harness[\s\S]*Fix:/);
  });
});

describe("bestaetigeAnlegen (#1866, fail-closed)", () => {
  type E = { aktion: string; nr?: number; grund: string; warnungen: string[] };
  const B = raw as unknown as { bestaetigeAnlegen: (e: E, a: { zweit: () => { number: number; titel: string }[] }) => E };
  const anlegen: E = { aktion: "anlegen", grund: "g", warnungen: ["alt"] };
  test("GraphQL kennt ein offenes Status-Ticket (die REST-Liste noch nicht): nichts, Nummer in Grund und Warnung, alte Warnungen bleiben", () => {
    const r = B.bestaetigeAnlegen(anlegen, { zweit: () => [{ number: 1865, titel: T.STATUS_TITEL }] });
    expect(r.aktion).toBe("nichts");
    expect(r.grund).toContain("#1865");
    expect(r.warnungen).toHaveLength(2);
    expect(r.warnungen[0]).toBe("alt");
    expect(r.warnungen[1]).toContain("#1865");
  });
  test("GraphQL wirft: fail-closed, nichts mit Warnung samt Fehlertext", () => {
    const r = B.bestaetigeAnlegen(anlegen, { zweit: () => { throw new Error("Rate-Limit"); } });
    expect(r.aktion).toBe("nichts");
    expect(r.warnungen.join("\n")).toContain("Rate-Limit");
  });
  test("GraphQL liefert keine Liste: wie ein Fehler, nichts", () => {
    expect(B.bestaetigeAnlegen(anlegen, { zweit: () => undefined as never }).aktion).toBe("nichts");
  });
  test("GraphQL kennt nur andere Titel oder nichts: anlegen bleibt, Entscheidung unverändert", () => {
    expect(B.bestaetigeAnlegen(anlegen, { zweit: () => [] })).toBe(anlegen);
    expect(B.bestaetigeAnlegen(anlegen, { zweit: () => [{ number: 5, titel: "Anderes" }] })).toBe(anlegen);
  });
  test("andere Aktionen bleiben unberührt und fragen GraphQL nicht", () => {
    for (const aktion of ["nichts", "nach-oben"]) {
      const e: E = { aktion, nr: 3, grund: "g", warnungen: [] };
      expect(B.bestaetigeAnlegen(e, { zweit: () => { throw new Error("nicht fragen"); } })).toBe(e);
    }
  });
});
