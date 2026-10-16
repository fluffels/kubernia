/* PR-Warten (#1559): Kern pur, kein gh-Aufruf, kein echter Schlaf. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/pr-warten.mjs";

type Erg = { exit: number; zeilen: string[] };
const P = raw as unknown as {
  bewerte: (pr: object, pflicht?: readonly string[] | null) => Erg;
  konfliktStand: (seit: number | null, jetzt: number) => { bestaetigt: boolean; seit: number };
  warten: (e: { hole: () => object; pflicht?: () => readonly string[]; schlafe: (ms: number) => void; jetzt: () => number; maxMs: number; intervallMs: number }) => Erg;
  parseArgs: (a: string[]) => { pr: string | null; maxSekunden: number; intervall: number };
};

const lauf = (name: string, status: string, conclusion: string | null = null, url = `https://x/runs/${name}`) => ({ __typename: "CheckRun", name, status, conclusion, detailsUrl: url });
const ctx = (context: string, state: string) => ({ __typename: "StatusContext", context, state, targetUrl: "https://y" });
const offen = (rollup: object[], extra: object = {}) => ({ state: "OPEN", mergeable: "MERGEABLE", autoMergeRequest: { mergeMethod: "SQUASH" }, statusCheckRollup: rollup, ...extra });

describe("bewerte", () => {
  test("MERGED → Exit 0 mit kurzem SHA", () => {
    expect(P.bewerte({ state: "MERGED", mergeCommit: { oid: "abcdef1234567" }, statusCheckRollup: [] })).toEqual({ exit: 0, zeilen: ["MERGED abcdef1"] });
  });
  test.each(["FAILURE", "CANCELLED", "TIMED_OUT"])("roter CheckRun (%s) → Exit 1, eine Zeile je rotem Check", (c) => {
    const r = P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS"), lauf("b", "COMPLETED", c), lauf("c", "COMPLETED", "FAILURE")]));
    expect(r.exit).toBe(1);
    expect(r.zeilen).toEqual(["ROT b https://x/runs/b", "ROT c https://x/runs/c"]);
  });
  test.each(["FAILURE", "ERROR"])("roter StatusContext (%s) → Exit 1", (s) => {
    expect(P.bewerte(offen([ctx("ci", s)])).exit).toBe(1);
  });
  test("Negativ: SKIPPED und NEUTRAL sind nicht rot", () => {
    const r = P.bewerte(offen([lauf("a", "COMPLETED", "SKIPPED"), lauf("b", "COMPLETED", "NEUTRAL"), lauf("c", "COMPLETED", "SUCCESS")]));
    expect(r.exit).toBe(2);
    expect(r.zeilen[0]).toBe("OFFEN 3/3 grün, Merge steht aus");
  });
  test("wartende Checks → Exit 2 mit Namen und x/y", () => {
    const r = P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS"), lauf("b", "IN_PROGRESS"), ctx("ci", "PENDING")]));
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 1/3 grün, wartend: b, ci"] });
  });
  test("Rot hat Vorrang vor wartenden Checks", () => {
    expect(P.bewerte(offen([lauf("a", "IN_PROGRESS"), lauf("b", "COMPLETED", "FAILURE")])).exit).toBe(1);
  });
  test("CONFLICTING → Exit 3, CLOSED → Exit 3", () => {
    expect(P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS")], { mergeable: "CONFLICTING" }))).toEqual({ exit: 3, zeilen: ["KONFLIKT"] });
    expect(P.bewerte({ state: "CLOSED", statusCheckRollup: [] })).toEqual({ exit: 3, zeilen: ["GESCHLOSSEN"] });
  });
  test("grün ohne Auto-Merge → Exit 3, leerer Rollup ist nicht grün", () => {
    expect(P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS")], { autoMergeRequest: null }))).toEqual({ exit: 3, zeilen: ["GRÜN OHNE AUTO-MERGE"] });
    expect(P.bewerte(offen([], { autoMergeRequest: null })).exit).toBe(2);
  });
});

describe("bewerte: Check-Kategorie Pflicht gegen sonstig (#1663 L17)", () => {
  const PFLICHT = ["Tests, Typecheck & Builds"];
  const gruen = lauf(PFLICHT[0], "COMPLETED", "SUCCESS");
  const hinweis = (n: string) => `HINWEIS ${n} https://x/runs/${n} (kein Pflicht-Check, kein Merge-Gate)`;
  test("rotes Nicht-Pflicht-Check bei sonst grünem Stand: Exit 2 mit Merge steht aus plus HINWEIS", () => {
    const r = P.bewerte(offen([gruen, lauf("CodeQL", "COMPLETED", "FAILURE")]), PFLICHT);
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 1/1 grün, Merge steht aus", hinweis("CodeQL")] });
  });
  test("rotes Nicht-Pflicht-Check plus roter Pflicht-Check: nur der Pflicht-Check ist ROT, dazu HINWEIS", () => {
    const r = P.bewerte(offen([lauf("Deploy", "COMPLETED", "FAILURE"), lauf(PFLICHT[0], "COMPLETED", "FAILURE")]), PFLICHT);
    expect(r.exit).toBe(1);
    expect(r.zeilen).toEqual([`ROT ${PFLICHT[0]} https://x/runs/${PFLICHT[0]}`, hinweis("Deploy")]);
  });
  test("laufendes Nicht-Pflicht-Check blockiert nicht und wird nicht als wartend gezählt", () => {
    const r = P.bewerte(offen([gruen, lauf("CodeQL-Analyse (actions)", "IN_PROGRESS")]), PFLICHT);
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 1/1 grün, Merge steht aus"] });
  });
  test("grünes Nicht-Pflicht-Check ohne Auto-Merge zählt nicht zum grünen Stand", () => {
    const r = P.bewerte(offen([gruen, lauf("Deploy", "COMPLETED", "SUCCESS")], { autoMergeRequest: null }), PFLICHT);
    expect(r).toEqual({ exit: 3, zeilen: ["GRÜN OHNE AUTO-MERGE"] });
  });
  test("nur Nicht-Pflicht-Checks zählen wie ein leerer Rollup", () => {
    const r = P.bewerte(offen([lauf("Deploy", "COMPLETED", "SUCCESS")], { autoMergeRequest: null }), PFLICHT);
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 0/0 grün, wartend: Checks starten"] });
  });
  test("rotes Nicht-Pflicht-Check plus laufender Pflicht-Check: wartend plus HINWEIS", () => {
    const r = P.bewerte(offen([gruen, lauf("b", "IN_PROGRESS"), lauf("Deploy", "COMPLETED", "FAILURE")]), [...PFLICHT, "b"]);
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 1/2 grün, wartend: b", hinweis("Deploy")] });
  });
  test("MERGED bleibt ohne HINWEIS", () => {
    const r = P.bewerte({ state: "MERGED", mergeCommit: { oid: "abcdef1234567" }, statusCheckRollup: [lauf("Deploy", "COMPLETED", "FAILURE")] }, PFLICHT);
    expect(r).toEqual({ exit: 0, zeilen: ["MERGED abcdef1"] });
  });
  test.each(["XTests, Typecheck & Builds", "tests, typecheck & builds"])("Negativ: Namensvergleich ist exakt, %s ist kein Pflicht-Check", (n) => {
    const r = P.bewerte(offen([lauf(n, "COMPLETED", "FAILURE")]), PFLICHT);
    expect(r.zeilen[0]).not.toMatch(/^ROT/);
  });
  test.each([null, undefined, []])("Fail-closed: ohne Pflicht-Liste (%j) gatet jedes rote Check", (pflicht) => {
    const r = P.bewerte(offen([gruen, lauf("CodeQL", "COMPLETED", "FAILURE")]), pflicht);
    expect(r).toEqual({ exit: 1, zeilen: ["ROT CodeQL https://x/runs/CodeQL"] });
  });
  test("Konflikt mit rotem Nicht-Pflicht-Check: KONFLIKT plus HINWEIS", () => {
    const r = P.bewerte(offen([lauf("Deploy", "COMPLETED", "FAILURE")], { mergeable: "CONFLICTING" }), PFLICHT);
    expect(r).toEqual({ exit: 3, zeilen: ["KONFLIKT", hinweis("Deploy")] });
  });
});

describe("warten: Pflicht-Checks holen (#1663 L17)", () => {
  const u = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  const rot = offen([lauf("Pflicht", "COMPLETED", "SUCCESS"), lauf("Deploy", "COMPLETED", "FAILURE")]);
  test("die Pflicht-Liste kommt aus dem Aufruf und wird nur einmal geholt", () => {
    let n = 0;
    const r = P.warten({ hole: () => rot, pflicht: () => (n++, ["Pflicht"]), ...u(), maxMs: 90_000, intervallMs: 30_000 });
    expect(r.zeilen[0]).toBe("OFFEN 1/1 grün, Merge steht aus");
    expect(n).toBe(1);
  });
  test("Fehler beim Holen der Pflicht-Liste: fail-closed, alle Checks gaten", () => {
    const r = P.warten({
      hole: () => rot,
      pflicht: () => {
        throw new Error("gh down");
      },
      ...u(),
      maxMs: 90_000,
      intervallMs: 30_000,
    });
    expect(r.exit).toBe(1);
    expect(r.zeilen).toEqual(["ROT Deploy https://x/runs/Deploy"]);
  });
});

describe("konfliktStand: KONFLIKT erst nach zweiter Abfrage im Abstand (#1663 L33)", () => {
  test("erste Abfrage: unbestätigt, merkt sich den Zeitpunkt", () => {
    expect(P.konfliktStand(null, 5000)).toEqual({ bestaetigt: false, seit: 5000 });
  });
  test("zweite Abfrage unter 15 s: weiter unbestätigt, der erste Zeitpunkt bleibt", () => {
    expect(P.konfliktStand(5000, 19_999)).toEqual({ bestaetigt: false, seit: 5000 });
  });
  test("zweite Abfrage ab genau 15 s: bestätigt", () => {
    expect(P.konfliktStand(5000, 20_000).bestaetigt).toBe(true);
  });
});

describe("warten", () => {
  const uhr = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  test("endet beim ersten Ergebnis ≠ Exit 2, schläft zwischen den Abfragen", () => {
    const u = uhr();
    const folge = [offen([lauf("a", "IN_PROGRESS")]), offen([lauf("a", "COMPLETED", "FAILURE")])];
    let i = 0;
    const r = P.warten({ hole: () => folge[i++], ...u, maxMs: 240_000, intervallMs: 30_000 });
    expect(r.exit).toBe(1);
    expect(u.jetzt()).toBe(30_000);
  });
  test("Zeitbudget abgelaufen → Exit 2 mit letzter Zeile, kein Schlaf über das Budget hinaus", () => {
    const u = uhr();
    const r = P.warten({ hole: () => offen([lauf("a", "IN_PROGRESS")]), ...u, maxMs: 90_000, intervallMs: 30_000 });
    expect(r.exit).toBe(2);
    expect(u.jetzt()).toBeLessThanOrEqual(90_000);
  });
  test("ein gh-Fehler wird überbrückt, drei in Folge → Exit 3", () => {
    const u = uhr();
    let n = 0;
    const ok = P.warten({
      hole: () => {
        if (n++ === 0) throw new Error("API down");
        return { state: "MERGED", mergeCommit: { oid: "abc1234" }, statusCheckRollup: [] };
      },
      ...u,
      maxMs: 240_000,
      intervallMs: 30_000,
    });
    expect(ok.exit).toBe(0);
    const u2 = uhr();
    const aus = P.warten({
      hole: () => {
        throw new Error("API down\nzweite Zeile");
      },
      ...u2,
      maxMs: 240_000,
      intervallMs: 30_000,
    });
    expect(aus).toEqual({ exit: 3, zeilen: ["GH-FEHLER API down"] });
  });
});

describe("warten: Konflikt wird erst nach zweiter Abfrage gemeldet (#1663 L33)", () => {
  const konflikt = offen([lauf("a", "IN_PROGRESS")], { mergeable: "CONFLICTING" });
  const uhr = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  test("flackernder Konflikt (einmal CONFLICTING, dann MERGEABLE): kein KONFLIKT", () => {
    const folge = [konflikt, offen([lauf("a", "COMPLETED", "FAILURE")])];
    let i = 0;
    const r = P.warten({ hole: () => folge[i++], ...uhr(), maxMs: 240_000, intervallMs: 30_000 });
    expect(r.exit).toBe(1);
  });
  test("zweimal CONFLICTING im Abstand von mindestens 15 s: KONFLIKT, genau zwei Abfragen", () => {
    const u = uhr();
    let n = 0;
    const r = P.warten({ hole: () => (n++, konflikt), ...u, maxMs: 240_000, intervallMs: 5_000 });
    expect(r).toEqual({ exit: 3, zeilen: ["KONFLIKT"] });
    expect(n).toBe(2);
    expect(u.jetzt()).toBeGreaterThanOrEqual(15_000);
  });
  test("ein kleines Budget verhindert die Bestätigung nicht: trotzdem zwei Abfragen", () => {
    let n = 0;
    const r = P.warten({ hole: () => (n++, konflikt), ...uhr(), maxMs: 1_000, intervallMs: 30_000 });
    expect(r.exit).toBe(3);
    expect(n).toBe(2);
  });
});

describe("parseArgs", () => {
  test("PR-Nummer und Optionen, Standardwerte", () => {
    expect(P.parseArgs(["12"])).toEqual({ pr: "12", maxSekunden: 240, intervall: 30 });
    expect(P.parseArgs(["--max-sekunden", "60", "--intervall", "10", "7"])).toEqual({ pr: "7", maxSekunden: 60, intervall: 10 });
  });
});

describe("Fail-closed und Fehlerzähler (Grenzfälle)", () => {
  test("COMPLETED mit unbekannter oder fehlender conclusion ist rot, nie grün", () => {
    expect(P.bewerte(offen([lauf("a", "COMPLETED", "STALE")])).exit).toBe(1);
    expect(P.bewerte(offen([lauf("a", "COMPLETED", null)])).exit).toBe(1);
  });
  test("StatusContext SUCCESS ist grün, ohne __typename wird er am Feld context erkannt", () => {
    expect(P.bewerte(offen([ctx("ci", "SUCCESS")]))).toEqual({ exit: 2, zeilen: ["OFFEN 1/1 grün, Merge steht aus"] });
    expect(P.bewerte(offen([{ context: "ci", state: "FAILURE", targetUrl: "u" }])).zeilen).toEqual(["ROT ci u"]);
  });
  test("Fehler, Erfolg, Fehler, Fehler sind kein Exit 3: der Zähler wird nach einem Erfolg zurückgesetzt", () => {
    let n = 0;
    const antworten: (object | Error)[] = [new Error("a"), offen([lauf("x", "IN_PROGRESS")]), new Error("b"), new Error("c"), { state: "MERGED", mergeCommit: { oid: "abc1234" }, statusCheckRollup: [] }];
    let t = 0;
    const r = P.warten({
      hole: () => {
        const a = antworten[n++];
        if (a instanceof Error) throw a;
        return a;
      },
      jetzt: () => t,
      schlafe: (ms) => void (t += ms),
      maxMs: 600_000,
      intervallMs: 30_000,
    });
    expect(r.exit).toBe(0);
  });
  test("läuft das Budget nach einem gh-Fehler ab, steht GH-FEHLER mit Exit 2 da", () => {
    let t = 0;
    const r = P.warten({
      hole: () => {
        throw new Error("down");
      },
      jetzt: () => t,
      schlafe: (ms) => void (t += ms),
      maxMs: 40_000,
      intervallMs: 30_000,
    });
    expect(r).toEqual({ exit: 2, zeilen: ["GH-FEHLER down"] });
  });
  test("das Budget wird genau ausgeschöpft: letzter Poll vor Ablauf, kein Schlaf darüber hinaus", () => {
    let t = 0;
    P.warten({ hole: () => offen([lauf("a", "IN_PROGRESS")]), jetzt: () => t, schlafe: (ms) => void (t += ms), maxMs: 90_000, intervallMs: 30_000 });
    expect(t).toBe(60_000);
  });
});

describe("warten: Pflicht-Liste neu holen und Konflikt-Reset (#1663 T2, T3)", () => {
  const uhr = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  const rot = offen([lauf("Pflicht", "COMPLETED", "SUCCESS"), lauf("Deploy", "COMPLETED", "FAILURE")]);
  test("nach einem Fehlschlag wird die Pflicht-Liste neu geholt: zweite Abfrage meldet HINWEIS statt ROT", () => {
    let n = 0;
    const folge = [offen([lauf("Pflicht", "IN_PROGRESS")]), rot];
    let i = 0;
    const r = P.warten({
      hole: () => folge[i++],
      pflicht: () => {
        n++;
        if (n === 1) throw new Error("gh down");
        return ["Pflicht"];
      },
      ...uhr(),
      maxMs: 240_000,
      intervallMs: 30_000,
    });
    expect(n).toBe(2);
    expect(r.exit).toBe(2);
    expect(r.zeilen[1]).toContain("HINWEIS Deploy");
  });
  test("eine leere Pflicht-Liste wird nicht gecacht (fail-closed bleibt, nächste Abfrage holt neu)", () => {
    let n = 0;
    const folge = [offen([lauf("Pflicht", "IN_PROGRESS")]), rot];
    let i = 0;
    const r = P.warten({ hole: () => folge[i++], pflicht: () => (n++, n === 1 ? [] : ["Pflicht"]), ...uhr(), maxMs: 240_000, intervallMs: 30_000 });
    expect(n).toBe(2);
    expect(r.exit).toBe(2);
  });
  test("Konflikt, dann konfliktfreie Abfrage, dann Konflikt: die Zeit der ersten Beobachtung ist zurückgesetzt (vier Abfragen)", () => {
    const konflikt = offen([lauf("a", "IN_PROGRESS")], { mergeable: "CONFLICTING" });
    const folge = [konflikt, offen([lauf("a", "IN_PROGRESS")]), konflikt, konflikt];
    let i = 0;
    const r = P.warten({ hole: () => folge[i++], ...uhr(), maxMs: 240_000, intervallMs: 5_000 });
    expect(r).toEqual({ exit: 3, zeilen: ["KONFLIKT"] });
    expect(i).toBe(4);
  });
});

describe("holePflicht (#1663 T4)", () => {
  const H = raw as unknown as { holePflicht: (pr: string, gh: (a: string[], o: object) => string) => string[] };
  test("Exit 8 bei laufenden Checks: das JSON in stdout des Fehlers liefert die Namen", () => {
    const gh = () => {
      throw Object.assign(new Error("exit 8"), { stdout: '[{"name":"A"},{"name":"B"}]' });
    };
    expect(H.holePflicht("7", gh)).toEqual(["A", "B"]);
  });
  test("Fehler ohne JSON in stdout wird weitergeworfen", () => {
    const gh = () => {
      throw Object.assign(new Error("kaputt"), { stdout: "kein json" });
    };
    expect(() => H.holePflicht("7", gh)).toThrow("kaputt");
  });
  test("Erfolg: Namen aus der JSON-Ausgabe, Aufruf mit --required", () => {
    let args: string[] = [];
    expect(H.holePflicht("7", (a) => ((args = a), '[{"name":"C"}]'))).toEqual(["C"]);
    expect(args).toContain("--required");
  });
});
