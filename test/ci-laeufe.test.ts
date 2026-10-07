/* Rote CI-Läufe (#1398): ein gemeinsamer Abruf für Festgefahren-Wächter, Messskript und Ergebnis je Ticket-Lauf. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as modul from "../scripts/ci-laeufe.mjs";

type Lauf = { branch: string; sha: string; createdAt: string };
const m = modul as unknown as {
  MAX_TREFFER: number;
  roteLaeufePfad: (o?: { branch?: string; seit?: string; repo?: string }) => string;
  parseLaeufe: (tsv: string) => Lauf[];
  holeRoteLaeufe: (runGh: (a: string[]) => string, o?: { branch?: string; seit?: string; repo?: string }) => Lauf[];
  distinctRoteShas: (l: Lauf[], f?: { von?: string; bis?: string }) => string[];
};

const L = (sha: string, createdAt: string, branch = "feature/x"): Lauf => ({ branch, sha, createdAt });

describe("roteLaeufePfad", () => {
  test("immer nur rote PR-Läufe von ci.yml, 100 je Seite", () => {
    const p = m.roteLaeufePfad();
    assert.match(p, /^repos\/\{owner\}\/\{repo\}\/actions\/workflows\/ci\.yml\/runs\?/);
    assert.match(p, /status=failure/);
    assert.match(p, /event=pull_request/);
    assert.match(p, /per_page=100/);
    assert.ok(!p.includes("branch=") && !p.includes("created="));
  });
  test("Branch wird URL-kodiert, Datum auf den Tag gekürzt und kodiert, Repo überschreibbar", () => {
    const p = m.roteLaeufePfad({ branch: "feature/kq-40-a&b#c+d", seit: "2026-10-01T10:30:00Z", repo: "x/y" });
    assert.ok(p.startsWith("repos/x/y/actions/"));
    assert.ok(p.includes(`branch=${encodeURIComponent("feature/kq-40-a&b#c+d")}`));
    assert.ok(p.includes("created=%3E%3D2026-10-01"));
    assert.ok(!p.includes("T10:30"));
  });
});

describe("parseLaeufe", () => {
  test("TSV, CRLF und Leerzeilen", () => {
    assert.deepEqual(m.parseLaeufe("b1\ta\t2026-10-01T10:00:00Z\r\n\r\nb2\tb\t2026-10-01T11:00:00Z\n"), [
      { branch: "b1", sha: "a", createdAt: "2026-10-01T10:00:00Z" },
      { branch: "b2", sha: "b", createdAt: "2026-10-01T11:00:00Z" },
    ]);
    assert.deepEqual(m.parseLaeufe(""), []);
  });
});

describe("holeRoteLaeufe", () => {
  test("ruft gh api mit --paginate und dem TSV-jq auf", () => {
    const gesehen: string[][] = [];
    const l = m.holeRoteLaeufe((a) => {
      gesehen.push(a);
      return "b\ta\t2026-10-01T10:00:00Z\n";
    }, { branch: "b" });
    assert.equal(gesehen.length, 1);
    assert.equal(gesehen[0][0], "api");
    assert.ok(gesehen[0].includes("--paginate"), "ohne --paginate kommt nur eine Seite");
    assert.ok(gesehen[0].some((x) => x.includes("@tsv")));
    assert.equal(l.length, 1);
  });
  test("ab 1000 Treffern ist die Liste abgeschnitten: wirft statt weniger Fehlschläge zu melden", () => {
    const zeile = (i: number) => `b\tsha${i}\t2026-10-01T10:00:00Z`;
    const voll = Array.from({ length: m.MAX_TREFFER }, (_, i) => zeile(i)).join("\n");
    assert.throws(() => m.holeRoteLaeufe(() => voll), /abgeschnitten/);
    const knapp = Array.from({ length: m.MAX_TREFFER - 1 }, (_, i) => zeile(i)).join("\n");
    assert.equal(m.holeRoteLaeufe(() => knapp).length, m.MAX_TREFFER - 1);
  });
  test("ein gh-Fehler läuft durch (kein stilles Leer)", () => {
    assert.throws(() => m.holeRoteLaeufe(() => { throw new Error("gh kaputt"); }), /gh kaputt/);
  });
});

describe("distinctRoteShas", () => {
  const laeufe = [
    L("a", "2026-10-01T10:30:00Z"),
    L("a", "2026-10-01T10:40:00Z"), // Rerun: dieselbe SHA
    L("b", "2026-10-01T11:00:00Z"),
    L("c", "2026-10-01T09:00:00Z"), // vor dem Fenster (früherer PR auf demselben Branch)
    L("d", "2026-10-01T13:00:00Z"), // nach dem Fenster
  ];
  test("nur das Fenster, distinct je SHA, Grenzen inklusive", () => {
    assert.deepEqual(m.distinctRoteShas(laeufe, { von: "2026-10-01T10:00:00Z", bis: "2026-10-01T12:00:00Z" }), ["a", "b"]);
    assert.deepEqual(m.distinctRoteShas(laeufe, { von: "2026-10-01T10:30:00Z", bis: "2026-10-01T11:00:00Z" }), ["a", "b"]);
  });
  test("ohne Grenzen zählen alle, offene Grenzen sind unbegrenzt", () => {
    assert.equal(m.distinctRoteShas(laeufe).length, 4);
    assert.deepEqual(m.distinctRoteShas(laeufe, { von: "2026-10-01T12:00:00Z" }), ["d"]);
    assert.deepEqual(m.distinctRoteShas(laeufe, { bis: "2026-10-01T09:30:00Z" }), ["c"]);
    assert.deepEqual(m.distinctRoteShas([]), []);
  });
});

describe("eine Quelle (Fitness)", () => {
  test("nur ci-laeufe.mjs kennt den API-Pfad der roten CI-Läufe; die Zähler nutzen den Helfer", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../scripts/", import.meta.url);
    const mjs = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
    const kenntPfad = mjs.filter((f) => readFileSync(new URL(f, dir), "utf8").includes("workflows/ci.yml/runs"));
    assert.deepEqual(kenntPfad, ["ci-laeufe.mjs"]);
    for (const f of ["check-festgefahren.mjs", "token-baseline.mjs", "lauf-ergebnis.mjs"]) {
      assert.match(readFileSync(new URL(f, dir), "utf8"), /from "\.\/ci-laeufe\.mjs"/, `${f} muss ci-laeufe.mjs nutzen`);
    }
  });
});
