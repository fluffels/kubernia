/* Review- und Plan-Nachweis-Wächter (#1270).
 *
 * Jeder Agenten-PR trägt per Commit-Zeilen `KQ-Plan:` / `KQ-Review:` einen prüfbaren Nachweis
 * über Planungspass und konvergierten Lens-Review; die PR-CI erzwingt ihn pfadunabhängig.
 * Logik aus scripts/check-review-nachweis.mjs importiert (eine Quelle der Wahrheit), git
 * ist injiziert.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

type Nachweis = {
  plan: { art: string; grund?: string; zeile?: string } | null;
  review: { head: string | null; runden: number; lenses: string[]; verdikt: string | null } | null;
};
type Mod = {
  MAX_FIX_RUNDEN: number;
  MAX_REVIEW_PAESSE: number;
  parseNachweis: (text: string) => Nachweis;
  pflichtLenses: (d: unknown) => string[];
  bewerteNachweis: (o: { nachweis: Nachweis; dateien: string[]; headBekannt: boolean; headImSlice: boolean }) => string[];
  checkReviewNachweis: (o: { runGit: (a: string[]) => string; env?: Record<string, string> }) => {
    ok: boolean;
    fehler: string[];
    override?: string;
    skipped?: boolean;
    commitsNachReview?: number | null;
  };
};
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/check-review-nachweis.mjs";
const { MAX_FIX_RUNDEN, MAX_REVIEW_PAESSE, parseNachweis, pflichtLenses, bewerteNachweis, checkReviewNachweis } = raw as Mod;

const DREI = "architektur,requirement-treue,test-adaequanz";
const SHA = "a".repeat(40);
const review = (felder = `head=${SHA} runden=2 lenses=${DREI} verdikt=ok`) => `KQ-Plan: kubernia-planner\nKQ-Review: ${felder}`;

describe("Cap-Semantik (W1)", () => {
  test("Cap 2 = höchstens 2 Fix-Runden = höchstens 3 Pässe", () => {
    assert.equal(MAX_FIX_RUNDEN, 2);
    assert.equal(MAX_REVIEW_PAESSE, 3);
  });
});

describe("parseNachweis", () => {
  test("gültige Zeilen", () => {
    const n = parseNachweis(review());
    assert.deepEqual(n.plan, { art: "planer" });
    assert.equal(n.review?.head, SHA);
    assert.equal(n.review?.runden, 2);
    assert.deepEqual(n.review?.lenses, DREI.split(","));
    assert.equal(n.review?.verdikt, "ok");
  });
  test("eingerückt oder mitten im Satz wird ignoriert", () => {
    const n = parseNachweis(`  KQ-Review: head=${SHA} runden=1 lenses=doku verdikt=ok\nsiehe KQ-Plan: kubernia-planner`);
    assert.equal(n.review, null);
    assert.equal(n.plan, null);
  });
  test("CRLF", () => {
    const n = parseNachweis(review().replace(/\n/g, "\r\n"));
    assert.equal(n.review?.verdikt, "ok");
    assert.deepEqual(n.plan, { art: "planer" });
  });
  test("mehrere Zeilen: die letzte gewinnt", () => {
    const n = parseNachweis(`${review(`head=${SHA} runden=1 lenses=doku verdikt=blockiert`)}\n${review()}`);
    assert.equal(n.review?.runden, 2);
    assert.equal(n.review?.verdikt, "ok");
  });
  test("fehlende Felder bleiben leer, kaputte Zahl wird NaN", () => {
    const n = parseNachweis("KQ-Review: runden=zwei");
    assert.equal(n.review?.head, null);
    assert.ok(Number.isNaN(n.review?.runden));
    assert.deepEqual(n.review?.lenses, []);
    assert.equal(n.review?.verdikt, null);
  });
  test("KQ-Plan ohne Planer braucht eine Begründung", () => {
    assert.deepEqual(parseNachweis("KQ-Plan: ohne — Spawn scheiterte").plan, { art: "ohne", grund: "Spawn scheiterte" });
    assert.equal(parseNachweis("KQ-Plan: ohne").plan?.art, "ungueltig");
    assert.equal(parseNachweis("KQ-Plan: ohne —").plan?.art, "ungueltig");
    assert.equal(parseNachweis("KQ-Plan: egal").plan?.art, "ungueltig");
  });
});

describe("pflichtLenses", () => {
  test("nur Markdown → doku", () => assert.deepEqual(pflichtLenses(["a.md", "docs/B.MD"]), ["doku"]));
  test("gemischt → drei Code-Brillen", () => assert.deepEqual(pflichtLenses(["a.md", "x.ts"]), DREI.split(",")));
  test("leer, kaputt, kein Array → voller Satz (fail-closed)", () => {
    for (const x of [[], [""], [1], undefined, "a.md"]) assert.deepEqual(pflichtLenses(x), DREI.split(","));
  });
});

describe("bewerteNachweis", () => {
  const ok = (text: string, o: Partial<{ dateien: string[]; headBekannt: boolean; headImSlice: boolean }> = {}) =>
    bewerteNachweis({ nachweis: parseNachweis(text), dateien: ["src/x.ts"], headBekannt: true, headImSlice: true, ...o });

  test("gültiger Code-Nachweis ist ok", () => assert.deepEqual(ok(review()), []));
  test("runden 3 ist ok, 0, 4 und „zwei“ sind rot", () => {
    assert.deepEqual(ok(review(`head=${SHA} runden=3 lenses=${DREI} verdikt=ok`)), []);
    for (const r of ["0", "4", "zwei"]) {
      const f = ok(review(`head=${SHA} runden=${r} lenses=${DREI} verdikt=ok`));
      assert.equal(f.length, 1, r);
      assert.match(f[0], /runden/);
    }
  });
  test("head unbekannt oder nicht im Slice (z.B. aus main) ist rot", () => {
    assert.match(ok(review(), { headBekannt: false }).join(), /kein bekannter Commit/);
    assert.match(ok(review(), { headImSlice: false }).join(), /nicht im Slice/);
    assert.match(ok("KQ-Plan: kubernia-planner\nKQ-Review: runden=1 lenses=doku verdikt=ok").join(), /head fehlt/);
  });
  test("Code-Diff nur mit doku ist rot, fehlende Code-Brille ist rot", () => {
    assert.match(ok(review(`head=${SHA} runden=1 lenses=doku verdikt=ok`)).join(), /lenses fehlt/);
    assert.match(ok(review(`head=${SHA} runden=1 lenses=architektur,requirement-treue verdikt=ok`)).join(), /test-adaequanz/);
  });
  test("Markdown-Diff: doku genügt, der volle Code-Satz auch, eine Teilmenge nicht", () => {
    const md = { dateien: ["docs/a.md"] };
    assert.deepEqual(ok(review(`head=${SHA} runden=1 lenses=doku verdikt=ok`), md), []);
    assert.deepEqual(ok(review(), md), []);
    assert.match(ok(review(`head=${SHA} runden=1 lenses=architektur verdikt=ok`), md).join(), /doku/);
  });
  test("verdikt ungleich ok ist rot", () => {
    assert.match(ok(review(`head=${SHA} runden=1 lenses=${DREI} verdikt=blockiert`)).join(), /verdikt=blockiert/);
    assert.match(ok(review(`head=${SHA} runden=1 lenses=${DREI}`)).join(), /verdikt=\(fehlt\)/);
  });
  test("KQ-Plan fehlt oder ist ungültig ist rot, mit Begründung ok", () => {
    const rev = `KQ-Review: head=${SHA} runden=1 lenses=${DREI} verdikt=ok`;
    assert.match(ok(rev).join(), /KQ-Plan-Zeile fehlt/);
    assert.match(ok(`KQ-Plan: ohne\n${rev}`).join(), /KQ-Plan ungültig/);
    assert.deepEqual(ok(`KQ-Plan: ohne — Spawn scheiterte\n${rev}`), []);
  });
  test("KQ-Review-Zeile fehlt ist rot", () => {
    assert.match(ok("KQ-Plan: kubernia-planner").join(), /KQ-Review-Zeile fehlt/);
  });
});

/** Fake-git: Basis B, HEAD H, Commit-Messages und Dateien frei wählbar. */
function fakeGit(o: { messages: string; files?: string; inSlice?: string[]; known?: string[]; head?: string; baseOk?: boolean; throws?: string }) {
  const H = o.head ?? "h".repeat(40);
  const B = "b".repeat(40);
  return (args: string[]): string => {
    const cmd = args.join(" ");
    if (o.throws && cmd.startsWith(o.throws)) throw new Error("git kaputt");
    if (cmd.startsWith("rev-parse --verify --quiet") && cmd.includes("^{commit}")) {
      const arg = args[3].replace("^{commit}", "");
      if (arg === B || arg === "base") return o.baseOk === false ? "" : B;
      if ((o.known ?? [SHA]).includes(arg)) return arg;
      throw new Error("unknown");
    }
    if (cmd === "rev-parse HEAD") return H + "\n";
    // Exakte Bereiche: ein Aufruf mit falschem Bereich (z.B. nur "HEAD" statt "<basis>..HEAD") fällt
    // durch und wirft, statt dieselbe Antwort zu liefern (sonst bewacht der Test den Slice nicht).
    if (cmd === `log --format=%B ${B}..HEAD`) return o.messages;
    if (cmd === `diff --name-only ${B}...HEAD`) return o.files ?? "src/x.ts\n";
    if (cmd.startsWith("rev-list --count --no-merges")) return "1\n";
    if (cmd === `rev-list ${B}..HEAD`) return (o.inSlice ?? [SHA, H]).join("\n") + "\n";
    throw new Error(`unerwartet: ${cmd}`);
  };
}
const env = { KQ_DIFF_BASE: "base" };

describe("checkReviewNachweis (git injiziert)", () => {
  test("gültiger Nachweis im Slice ist grün", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review() }), env });
    assert.deepEqual(r.fehler, []);
    assert.equal(r.ok, true);
    assert.equal(r.commitsNachReview, 1);
  });
  test("head nicht im Slice (z.B. aus main) ist rot", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review(), inSlice: ["x".repeat(40)] }), env });
    assert.equal(r.ok, false);
    assert.match(r.fehler.join(), /nicht im Slice/);
  });
  test("Markdown-Diff mit lenses=doku ist grün, Code-Diff mit lenses=doku rot (Dateiliste kommt an)", () => {
    const doku = review(`head=${SHA} runden=1 lenses=doku verdikt=ok`);
    assert.deepEqual(checkReviewNachweis({ runGit: fakeGit({ messages: doku, files: "docs/a.md\n" }), env }).fehler, []);
    assert.equal(checkReviewNachweis({ runGit: fakeGit({ messages: doku, files: "src/x.ts\n" }), env }).ok, false);
  });
  test("abgekürzter SHA wird zum vollen aufgelöst und im Slice gefunden", () => {
    const kurz = SHA.slice(0, 8);
    const git = fakeGit({ messages: review(`head=${kurz} runden=1 lenses=${DREI} verdikt=ok`) });
    const runGit = (a: string[]) => (a[0] === "rev-parse" && a[3] === `${kurz}^{commit}` ? `${SHA}\n` : git(a));
    assert.deepEqual(checkReviewNachweis({ runGit, env }).fehler, []);
  });
  test("head unbekannt ist rot", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review(), known: [] }), env });
    assert.match(r.fehler.join(), /kein bekannter Commit/);
  });
  test("ohne jeden Nachweis rot", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: "feat: x\n" }), env });
    assert.equal(r.ok, false);
    assert.equal(r.fehler.length, 2);
  });
  test("Override mit Begründung lässt durch, ohne Ticketnummer/Begründung nicht", () => {
    const g = (m: string) => checkReviewNachweis({ runGit: fakeGit({ messages: m }), env });
    const ok = g("revert\n\nKQ-Review-Override: #1270 Revert-PR");
    assert.equal(ok.ok, true);
    assert.match(ok.override ?? "", /Revert-PR/);
    assert.equal(g("KQ-Review-Override: Revert").ok, false);
    assert.equal(g("KQ-Review-Override: #1270").ok, false);
  });
  test("git-Fehler ist rot (fail-closed)", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review(), throws: "diff" }), env });
    assert.equal(r.ok, false);
    assert.match(r.fehler.join(), /git-Fehler/);
  });
  test("Basis nicht auflösbar ist rot", () => {
    const r = checkReviewNachweis({
      runGit: () => {
        throw new Error("nix");
      },
      env: {},
    });
    assert.equal(r.ok, false);
    assert.match(r.fehler.join(), /Basis/);
  });
  test("Basis == HEAD ist grün (nichts zu prüfen)", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: "", head: "b".repeat(40) }), env });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
  });
});
