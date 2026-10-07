/* Board-Härtung (#1390): Notfall-Tabelle, Titelprüfung, gebündelter GraphQL-Fallback und die Positionskorrektur des Sammeltickets.
 *
 * Reines Node-Tooling ohne Declaration-File: Namespaces einmal über `unknown` auf lokale Interfaces (Technik wie test/board.test.ts). */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPlace from "../scripts/board-place.mjs";

type B = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
type Korrektur = { nr: number; id: string; afterId: string | null; vonRang: number; nachRang: number };
type Plan = { steps: { item: B; afterId: string | null }[]; klemmung: { geklemmt: boolean; sammelticket: number | null } };
type Lib = {
  notfallTitelFehler: (items: B[], numbers: number[], art: string) => string | null;
  aliasAbfrage: (nummern: number[], repo?: string) => { nummern: number[]; query: string }[];
  itemsAusAliasAntwort: (antwort: unknown, nummern: number[]) => (B | null)[];
  PROJECT_ID: string;
  sammelticketPosition: (text: string) => number;
  verschiebe: (items: B[], id: string, afterId: string | null) => B[];
  sammelticketKorrektur: (items: B[], n: number) => Korrektur | null;
  kopfEnde: (items: B[]) => number;
  planFuerArgs: (items: B[], args: object) => Plan;
  ALIAS_MAX: number;
};
type Place = {
  parseArgs: (argv: string[]) => object | null;
  planMitKorrektur: (items: B[], args: object, n: number) => { korrektur: Korrektur | null; items: B[]; plan: Plan };
};
const L = rawLib as unknown as Lib;
const P = rawPlace as unknown as Place;

const TITEL = "Harness-Härtung (gesammelt)";
const STATUS = "Langfuse-Status überprüfen";
const b = (number: number, extra: Partial<B> = {}): B => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
const sammel = (number: number, extra: Partial<B> = {}) => b(number, { title: TITEL, ...extra });
const status = (number: number) => b(number, { title: STATUS });
const reihe = (items: B[]) => items.map((i) => i.number);

describe("Notfall-Titelprüfung (#1390 Z6a)", () => {
  test("jede Art: passender Marker ok, falscher Titel meldet das Präfix", () => {
    const marker = { "rot-main": "🚨 CI rot auf main", security: "🔒 Security:", dependabot: "🤖 Dependabot-PRs auflösen", forum: "Forum #" };
    for (const [art, m] of Object.entries(marker)) {
      expect(L.notfallTitelFehler([b(5, { title: `${m} x` })], [5], art), art).toBeNull();
      expect(L.notfallTitelFehler([b(5, { title: "irgendwas" })], [5], art), art).toContain(m);
    }
  });

  test("Negativfälle: unbekannte Art, Titel mit dem Marker nur in der Mitte, nicht gelistetes Ticket", () => {
    expect(L.notfallTitelFehler([b(5)], [5], "egal")).toMatch(/Unbekannte/);
    expect(L.notfallTitelFehler([b(5, { title: "x 🔒 Security:" })], [5], "security")).not.toBeNull();
    expect(L.notfallTitelFehler([b(5)], [99], "forum"), "nicht beurteilbar, der Aufrufer ergänzt es vorher").toBeNull();
    expect(L.notfallTitelFehler([b(5, { title: "Forum #1" }), b(6)], [5, 6], "forum")).toMatch(/#6/);
  });

  test("ein unmarkierter Notfall oben ließe den Kopf bei 0 enden, ein markierter Security-Titel zählt zum Kopf", () => {
    expect(L.kopfEnde([b(1), status(2), b(3)])).toBe(0);
    expect(L.kopfEnde([b(1, { title: "🔒 Security: X" }), status(2), b(3)])).toBe(2);
  });
});

describe("Gebündelter GraphQL-Fallback (#1390 Z6d)", () => {
  test("aliasAbfrage: ein Aliasblock je Nummer, Nummern inline", () => {
    const [block, ...rest] = L.aliasAbfrage([5, 9]);
    expect(rest).toEqual([]);
    expect(block.nummern).toEqual([5, 9]);
    expect(block.query).toContain("i0: issue(number: 5)");
    expect(block.query).toContain("i1: issue(number: 9)");
    expect(block.query).toContain('owner:"fluffels",name:"kubernia"');
  });

  test("mehr als ALIAS_MAX Nummern → mehrere Blöcke, keine Nummer geht verloren", () => {
    const nummern = Array.from({ length: L.ALIAS_MAX + 1 }, (_, k) => k + 1);
    const bloecke = L.aliasAbfrage(nummern);
    expect(bloecke).toHaveLength(2);
    expect(bloecke.flatMap((x) => x.nummern)).toEqual(nummern);
    expect(bloecke[1].query).toContain("i0: issue(number: 51)");
    expect(L.aliasAbfrage([])).toEqual([]);
  });

  test("keine Injektion: nur positive Ganzzahlen und ein sauberes Repo", () => {
    for (const bad of [[1.5], [0], [-3], [Number.NaN], ["5) { x" as unknown as number]]) expect(() => L.aliasAbfrage(bad), JSON.stringify(bad)).toThrow(/Ganzzahlen/);
    expect(() => L.aliasAbfrage("5" as unknown as number[])).toThrow();
    for (const bad of ['a/b"){x', "kein-slash", "a/b/c", ""]) expect(() => L.aliasAbfrage([1], bad), bad).toThrow(/Repo/);
  });

  const issue = (number: number, nodes: unknown[]) => ({ number, title: `T${number}`, state: "OPEN", assignees: { nodes: [{ login: "fluffels" }] }, projectItems: { nodes } });

  test("itemsAusAliasAntwort: in Reihenfolge der Nummern; unbekanntes Issue, fremdes Projekt und leere Items → null", () => {
    const antwort = {
      data: {
        repository: {
          i0: issue(5, [{ id: "PVTI_5", project: { id: L.PROJECT_ID } }]),
          i1: null, // unbekanntes Issue (NOT_FOUND)
          i2: issue(7, [{ id: "PVTI_x", project: { id: "PVT_fremd" } }]),
          i3: issue(8, []),
        },
      },
    };
    expect(L.itemsAusAliasAntwort(antwort, [5, 6, 7, 8])).toEqual([{ id: "PVTI_5", number: 5, status: "", title: "T5", assignees: ["fluffels"], state: "open" }, null, null, null]);
  });

  test("kaputte Antwortform wirft, statt Nummern still als fehlend zu melden", () => {
    for (const bad of [null, {}, { data: null }, { data: { repository: null } }, { data: { repository: "x" } }]) expect(() => L.itemsAusAliasAntwort(bad, [1]), JSON.stringify(bad)).toThrow(/Antwortform/);
  });
});

describe("sammelticketPosition (#1390 Z10)", () => {
  test("liest die Zahl aus dem echten AGENTS.md (genau ein Treffer)", () => {
    const n = L.sammelticketPosition(readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8"));
    expect(Number.isInteger(n) && n >= 1).toBe(true);
  });
  test("Negativfälle: kein Treffer und zwei Treffer werfen, Schreibweise mit Doppelpunkt gilt", () => {
    expect(() => L.sammelticketPosition("keine Zahl")).toThrow(/genau einmal/);
    expect(() => L.sammelticketPosition("Position 4 und Position: 5")).toThrow(/genau einmal/);
    expect(L.sammelticketPosition("Board-Position: 4")).toBe(4);
    expect(() => L.sammelticketPosition(undefined as unknown as string)).toThrow();
  });
});

describe("verschiebe (#1390)", () => {
  const liste = [b(1), b(2), b(3), b(4)];
  test("hinter einen Anker, an die Spitze, die Eingabe bleibt unverändert", () => {
    expect(reihe(L.verschiebe(liste, "I4", "I1"))).toEqual([1, 4, 2, 3]);
    expect(reihe(L.verschiebe(liste, "I3", null))).toEqual([3, 1, 2, 4]);
    expect(reihe(L.verschiebe(liste, "I1", "I3"))).toEqual([2, 3, 1, 4]);
    expect(reihe(liste)).toEqual([1, 2, 3, 4]);
  });
  test("Negativfälle: unbekannte ID oder unbekannter Anker wirft", () => {
    expect(() => L.verschiebe(liste, "I99", null)).toThrow(/Item/);
    expect(() => L.verschiebe(liste, "I1", "I99")).toThrow(/Anker/);
    expect(() => L.verschiebe(liste, "I1", "I1")).toThrow(/Anker/);
  });
});

describe("sammelticketKorrektur (#1390 Z10)", () => {
  const f = (n: number) => (items: B[]) => L.sammelticketKorrektur(items, n);
  const k4 = f(4);
  const fueller = (von: number, bis: number) => Array.from({ length: bis - von + 1 }, (_, i) => b(von + i));

  test("steht es auf Position N oder davor: nichts", () => {
    expect(k4([b(1), b(2), b(3), sammel(9), b(5)])).toBeNull();
    expect(k4([b(1), sammel(9), b(3), b(4), b(5)])).toBeNull();
    expect(k4([sammel(9), b(2)])).toBeNull();
  });

  test("Board-Ende: zurück auf Position N (Anker = das (N-1). Todo-Item)", () => {
    const items = [...fueller(1, 10), sammel(20)];
    expect(k4(items)).toEqual({ nr: 20, id: "I20", afterId: "I3", vonRang: 11, nachRang: 4 });
    expect(reihe(L.verschiebe(items, "I20", "I3")).slice(0, 5)).toEqual([1, 2, 3, 20, 4]);
  });

  test("Done-Items zählen für die Position nicht mit", () => {
    const items = [b(1), b(2, { status: "Done" }), b(3), b(4), b(5), sammel(20)];
    expect(k4(items)).toMatchObject({ afterId: "I4", nachRang: 5 });
  });

  test("großer Kopf (mindestens N Items) mit dem Sammelticket direkt dahinter: nichts; mit offenem Ticket dazwischen: hinter den Kopf, nie hinein", () => {
    const kopf = [1, 2, 3, 4, 5].map((n) => b(n, { title: `Forum #${n}: x` }));
    expect(L.kopfEnde([...kopf, sammel(20)])).toBe(5);
    expect(k4([...kopf, sammel(20), b(30)])).toBeNull();
    expect(k4([...kopf, b(30), b(31), sammel(20)])).toEqual({ nr: 20, id: "I20", afterId: "I5", vonRang: 8, nachRang: 6 });
  });

  test("Kopf kleiner als N: Ziel bleibt Position N; Position 1 mit Kopf: hinter den Kopf", () => {
    expect(k4([status(1), ...fueller(2, 10), sammel(20)])).toMatchObject({ afterId: "I3", nachRang: 4 }); // das Kopf-Item zählt als Todo-Item mit
    expect(f(1)([status(1), b(2), sammel(20)])).toEqual({ nr: 20, id: "I20", afterId: "I1", vonRang: 3, nachRang: 2 });
    expect(f(1)([b(2), sammel(20)])).toMatchObject({ afterId: null, nachRang: 1 });
  });

  test("geclaimt, geschlossen, fehlend: nichts; nur nach vorn, nie nach hinten", () => {
    expect(k4([...fueller(1, 10), sammel(20, { assignees: ["fluffels"] })])).toBeNull();
    expect(k4([...fueller(1, 10), sammel(20, { state: "closed" })])).toBeNull();
    expect(k4(fueller(1, 10))).toBeNull();
    expect(k4([])).toBeNull();
    // steht weiter vorn als N: kein Zurückschieben auf N
    expect(L.sammelticketKorrektur([b(1), sammel(9), ...fueller(2, 8)], 6)).toBeNull();
  });

  test("Fixpunkt: nach dem Anwenden der Korrektur meldet sie nichts mehr; ungültiges N wirft", () => {
    let geprueft = 0;
    for (const items of [[...fueller(1, 10), sammel(20)], [status(1), ...fueller(2, 10), sammel(20)], [b(1), b(2), sammel(20)]]) {
      const k = k4(items);
      if (!k) continue;
      geprueft++;
      expect(k4(L.verschiebe(items, k.id, k.afterId))).toBeNull();
    }
    expect(geprueft, "die Schleife prüft wirklich etwas").toBe(2);
    expect(() => L.sammelticketKorrektur([sammel(1)], 0)).toThrow(RangeError);
  });
});

describe("planMitKorrektur: Komposition von board-place (#1390 Z10, Form des Vorfalls)", () => {
  // Vorfall: das neue Sammelticket stand am Board-Ende, ein neues --top-Ticket landete dahinter.
  const ende = [...Array.from({ length: 10 }, (_, i) => b(i + 1)), sammel(1390), b(1400)];
  const plan = (argv: string[], items = ende) => {
    const args = P.parseArgs(argv);
    expect(args, argv.join(" ")).not.toBeNull();
    return P.planMitKorrektur(items, args as object, 4);
  };

  test("--top landet hinter dem korrigierten Sammelticket, nicht am Board-Ende; die Korrektur wird gemeldet", () => {
    const r = plan(["--top", "1400"]);
    expect(r.korrektur).toMatchObject({ nr: 1390, nachRang: 4 });
    expect(r.plan.steps.map((s) => [s.item.number, s.afterId])).toEqual([[1400, "I1390"]]);
    expect(reihe(r.items).slice(0, 5)).toEqual([1, 2, 3, 1390, 4]);
    expect(r.plan.klemmung).toEqual({ geklemmt: true, sammelticket: 1390 });
  });

  test("ohne Korrektur (steht richtig): identisch zu planFuerArgs", () => {
    const richtig = [b(1), b(2), b(3), sammel(1390), b(5), b(1400)];
    const r = plan(["--top", "1400"], richtig);
    expect(r.korrektur).toBeNull();
    expect(r.plan.steps).toEqual(L.planFuerArgs(richtig, { anchor: null, numbers: [1400] }).steps);
  });

  test("--notfall korrigiert nicht; das Sammelticket selbst (--position 4 <nr>) auch nicht", () => {
    expect(plan(["--notfall", "rot-main", "--top", "1400"]).korrektur).toBeNull();
    expect(plan(["--position", "4", "1390"]).korrektur).toBeNull();
  });

  test("geclaimtes Sammelticket am Ende: keine Korrektur", () => {
    const geclaimt = [...Array.from({ length: 10 }, (_, i) => b(i + 1)), sammel(1390, { assignees: ["fluffels"] })];
    expect(plan(["--top", "1400"], [...geclaimt, b(1400)]).korrektur).toBeNull();
  });
});

describe("teilantwortAusStdout: wann ein gh-Fehler eine Teilantwort ist (#1390 Z6d, Lens R1)", () => {
  const T = (rawLib as unknown as { teilantwortAusStdout: (s: unknown) => unknown }).teilantwortAusStdout;
  const mit = (errors: unknown) => JSON.stringify({ data: { repository: { i0: null } }, errors });

  test("nur NOT_FOUND (auch mehrfach) → die Antwort gilt", () => {
    expect(T(mit([{ type: "NOT_FOUND" }]))).toMatchObject({ data: { repository: {} } });
    expect(T(mit([{ type: "NOT_FOUND" }, { type: "NOT_FOUND" }]))).not.toBeNull();
  });

  test("daneben ein anderer Fehler (Rate-Limit) → null, der Fehler wird weitergeworfen", () => {
    expect(T(mit([{ type: "NOT_FOUND" }, { type: "RATE_LIMITED" }]))).toBeNull();
    expect(T(mit([{ type: "RATE_LIMITED" }]))).toBeNull();
    expect(T(mit([{}]))).toBeNull();
  });

  test("kein repository, kaputtes oder fehlendes stdout → null", () => {
    expect(T(JSON.stringify({ data: null, errors: [{ type: "NOT_FOUND" }] }))).toBeNull();
    expect(T(JSON.stringify({ errors: [{ type: "NOT_FOUND" }] }))).toBeNull();
    for (const bad of ["kein json", "", undefined, null, "[]"]) expect(T(bad), String(bad)).toBeNull();
  });
});
