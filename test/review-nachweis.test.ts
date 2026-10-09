/* Review- und Plan-Nachweis-Wächter (#1270).
 *
 * Jeder Agenten-PR trägt per Commit-Zeilen `KQ-Plan:` / `KQ-Review:` einen prüfbaren Nachweis
 * über Planungspass und konvergierten Lens-Review; die PR-CI erzwingt ihn pfadunabhängig.
 * Logik aus scripts/check-review-nachweis.mjs importiert (eine Quelle der Wahrheit), git
 * ist injiziert.
 */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Nachweis = {
  plan: { art: string; grund?: string; zeile?: string } | null;
  review: { head: string | null; runden: number; lenses: string[]; blocker: { lens: string; n: number }[] | null; verdikt: string | null } | null;
};
type Mod = {
  MAX_FIX_RUNDEN: number;
  MAX_REVIEW_PAESSE: number;
  parseNachweis: (text: string) => Nachweis;
  pflichtLenses: (d: unknown) => string[];
  bewerteNachweis: (o: { nachweis: Nachweis; dateien: string[]; headBekannt: boolean; headImSlice: boolean; konfliktMerges?: string[] }) => string[];
  konfliktMergesNach: (git: (a: string[]) => string, headSha: string) => string[];
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
const { MAX_FIX_RUNDEN, MAX_REVIEW_PAESSE, parseNachweis, pflichtLenses, bewerteNachweis, checkReviewNachweis, konfliktMergesNach } = raw as Mod;

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

describe("blocker-Feld (#1123, Runde-1-Blocker je Brille)", () => {
  const mit = (blocker: string, runden = 2, lenses = DREI) =>
    bewerteNachweis({
      nachweis: parseNachweis(review(`head=${SHA} runden=${runden} lenses=${lenses} blocker=${blocker} verdikt=ok`)),
      dateien: ["src/x.ts"],
      headBekannt: true,
      headImSlice: true,
    });
  test("Parser: fehlt das Feld, ist blocker null; sonst Liste, tolerant bei Leerzeichen und Umlauten", () => {
    assert.equal(parseNachweis(review()).review?.blocker, null);
    const n = parseNachweis(review(`head=${SHA} runden=2 lenses=${DREI} blocker=Architektur:1, Test-Adäquanz:0 verdikt=ok`));
    assert.deepEqual(n.review?.blocker, [
      { lens: "architektur", n: 1 },
      { lens: "test-adaequanz", n: 0 },
    ]);
    assert.equal(n.review?.verdikt, "ok");
  });
  test("Parser: kaputte Zahl wird NaN, leerer Wert ergibt leere Liste", () => {
    const n = parseNachweis("KQ-Review: blocker=architektur:x");
    assert.ok(Number.isNaN(n.review?.blocker?.[0].n));
    assert.deepEqual(parseNachweis("KQ-Review: blocker= verdikt=ok").review?.blocker, []);
  });
  test("alte Zeile ohne blocker bleibt gültig", () => {
    assert.deepEqual(bewerteNachweis({ nachweis: parseNachweis(review()), dateien: ["src/x.ts"], headBekannt: true, headImSlice: true }), []);
  });
  test("checkReviewNachweis meldet blockerFehlt für alte Zeilen, nicht für neue", () => {
    const lauf = (felder: string) =>
      checkReviewNachweis({ runGit: fakeGit({ messages: review(felder) }), env: { KQ_DIFF_BASE: "base" } }) as { ok: boolean; blockerFehlt?: boolean };
    assert.equal(lauf(`head=${SHA} runden=2 lenses=${DREI} verdikt=ok`).blockerFehlt, true);
    const neu = lauf(`head=${SHA} runden=2 lenses=${DREI} blocker=architektur:1,requirement-treue:0,test-adaequanz:0 verdikt=ok`);
    assert.equal(neu.ok, true);
    assert.equal(neu.blockerFehlt, false);
  });
  test("runden=2 mit Blockern in Runde 1 ist ok", () => {
    assert.deepEqual(mit("architektur:2,requirement-treue:0,test-adaequanz:1"), []);
  });
  test("runden=1 mit allen Brillen und 0 Blockern ist ok", () => {
    assert.deepEqual(mit("architektur:0,requirement-treue:0,test-adaequanz:0", 1), []);
  });
  test("runden=1 mit Blockern ist rot (kein Fix-Pass)", () => {
    assert.match(mit("architektur:1,requirement-treue:0,test-adaequanz:0", 1).join(), /kein Fix-Pass/);
  });
  test("runden=1: Brillen von blocker müssen den lenses entsprechen (auch bei gleicher Anzahl)", () => {
    assert.match(mit("architektur:0", 1).join(), /blocker.*lenses|lenses.*blocker/);
    assert.match(mit("architektur:0,requirement-treue:0,doku:0", 1).join(), /weichen von lenses/);
    assert.match(mit("architektur:0", 1, "doku").join(), /weichen von lenses/);
  });
  test("ungültige Werte sind rot: Zahl, negativ, Bruch, unbekannte Brille, Duplikat, leer", () => {
    for (const b of ["architektur:", "architektur", "architektur:x", "architektur:-1", "architektur:1.5", "stil:1", "architektur:1,architektur:0", ""]) {
      assert.ok(mit(b).length > 0, `"${b}" müsste rot sein`);
      assert.match(mit(b).join(), /blocker/);
    }
  });
});

/** Fake-git: Basis B, HEAD H, Commit-Messages und Dateien frei wählbar. */
function fakeGit(o: {
  messages: string;
  /** Commit-Messages chronologisch (ältester zuerst); überschreibt `messages` und macht die Log-Reihenfolge prüfbar. */
  commits?: string[];
  files?: string;
  inSlice?: string[];
  known?: string[];
  head?: string;
  baseOk?: boolean;
  throws?: string;
  merges?: string[];
  remerge?: Record<string, string>;
}) {
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
    // Wie echtes git: ohne `--reverse` kommt der neueste Commit zuerst (Z8a: sonst gewinnt der älteste Nachweis).
    const chrono = o.commits ?? [o.messages];
    if (cmd === `log --reverse --format=%B ${B}..HEAD`) return chrono.join("\n\n");
    if (cmd === `log --format=%B ${B}..HEAD`) return [...chrono].reverse().join("\n\n");
    if (cmd === `diff --name-only ${B}...HEAD`) return o.files ?? "src/x.ts\n";
    // Exakt (#1309): die Basis des Zählens ist der geprüfte head, nicht beliebig; ein anderer Bereich wirft.
    const zaehlen = /^rev-list --count --no-merges ([0-9a-f]{40})\.\.HEAD$/.exec(cmd);
    if (zaehlen) {
      if (!(o.known ?? [SHA]).includes(zaehlen[1])) throw new Error(`unbekannter head: ${zaehlen[1]}`);
      return "1\n";
    }
    if (cmd === `rev-list ${B}..HEAD`) return (o.inSlice ?? [SHA, H]).join("\n") + "\n";
    // Merges nach dem reviewten Stand (#1392): exakt der Bereich <head>..HEAD, `show --remerge-diff` je Merge.
    const merges = /^rev-list --merges ([0-9a-f]{40})\.\.HEAD$/.exec(cmd);
    if (merges) return (o.merges ?? []).join("\n") + "\n";
    const remerge = /^show --remerge-diff --format= ([0-9a-f]{40})$/.exec(cmd);
    if (remerge) return o.remerge?.[remerge[1]] ?? "";
    throw new Error(`unerwartet: ${cmd}`);
  };
}
const env = { KQ_DIFF_BASE: "base" };

describe("checkReviewNachweis (git injiziert)", () => {
  test("zwei Nachweis-Commits: der jüngste gilt, ein alter mit unbekanntem head stört nicht (Z8a)", () => {
    const alt = review(`head=${"c".repeat(40)} runden=2 lenses=${DREI} verdikt=ok`);
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: "", commits: [alt, review()] }), env });
    assert.deepEqual(r.fehler, []);
    assert.equal(r.ok, true);
    // Umgekehrt: ist der jüngste Nachweis der kaputte, ist es rot (nicht der ältere gute).
    assert.equal(checkReviewNachweis({ runGit: fakeGit({ messages: "", commits: [review(), alt] }), env }).ok, false);
  });
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

describe("Konflikt-Merge nach dem Review (#1392 Z9)", () => {
  const M = "c".repeat(40);
  const M2 = "d".repeat(40);

  test("bewerteNachweis: ein Konflikt-Merge ist ein Fehler mit Fix-Text, ohne Merges bleibt alles beim Alten", () => {
    const n = parseNachweis(review());
    const dateien = ["src/x.ts"];
    assert.deepEqual(bewerteNachweis({ nachweis: n, dateien, headBekannt: true, headImSlice: true }), []);
    const f = bewerteNachweis({ nachweis: n, dateien, headBekannt: true, headImSlice: true, konfliktMerges: [M, M2] });
    assert.equal(f.length, 2);
    assert.match(f[0], new RegExp(`Konflikt-Merge ${M} nach dem Review.*Delta-Lens.*neuer Nachweis \\(head ≥ ${M}\\)`));
    assert.match(f[1], new RegExp(M2));
    assert.match(f[0], /review-lenses › Nach jedem Merge von main/);
  });

  test("checkReviewNachweis: Merge mit Auflösung (remerge-diff nicht leer) ist rot", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review(), merges: [M], remerge: { [M]: "diff --cc a.txt\n+C" } }), env });
    assert.equal(r.ok, false);
    assert.match(r.fehler.join(), /Konflikt-Merge c{40}/);
  });

  test("checkReviewNachweis: konfliktfreier Merge (remerge-diff leer) bleibt grün", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review(), merges: [M], remerge: {} }), env });
    assert.deepEqual(r.fehler, []);
    assert.equal(r.ok, true);
  });

  test("checkReviewNachweis: ein git-Fehler bei der Merge-Prüfung (z.B. git < 2.36) ist rot", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review(), merges: [M], throws: "show --remerge-diff" }), env });
    assert.equal(r.ok, false);
    assert.match(r.fehler.join(), /git-Fehler/);
  });

  test("konfliktMergesNach: nur Merges mit Auflösung, Reihenfolge bleibt", () => {
    const git = fakeGit({ messages: "", merges: [M, M2], remerge: { [M2]: "+x" } });
    assert.deepEqual(konfliktMergesNach(git, SHA), [M2]);
    assert.deepEqual(konfliktMergesNach(fakeGit({ messages: "" }), SHA), []);
  });
});

describe("Konflikt-Merge: echtes git-Repo (#1392 Z9)", { timeout: 30_000 }, () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  /** Repo mit Basis, Feature-Commit (der „reviewte“ Stand) und einem Merge von main; `konflikt` wählt, ob main dieselbe Zeile ändert. */
  function repoMitMerge(konflikt: boolean) {
    const dir = mkdtempSync(join(tmpdir(), "kq-nachweis-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "eins\nzwei\ndrei\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "basis");
    const basis = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "checkout", "-q", "-b", "feature");
    writeFileSync(join(dir, "a.txt"), "EINS-feature\nzwei\ndrei\n");
    git(dir, "commit", "-q", "-am", "feature");
    const reviewt = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "checkout", "-q", "main");
    if (konflikt) writeFileSync(join(dir, "a.txt"), "EINS-main\nzwei\ndrei\n");
    else writeFileSync(join(dir, "b.txt"), "b-main\n");
    git(dir, "commit", "-q", "-am", "main-aenderung");
    git(dir, "checkout", "-q", "feature");
    try {
      git(dir, "merge", "-q", "--no-edit", "main");
    } catch {
      writeFileSync(join(dir, "a.txt"), "EINS-aufgeloest\nzwei\ndrei\n"); // Konflikt von Hand auflösen
      git(dir, "add", "a.txt");
      git(dir, "commit", "-q", "--no-edit");
    }
    git(dir, "commit", "-q", "--allow-empty", "-m", `Nachweis\n\nKQ-Plan: kubernia-planner\nKQ-Review: head=${reviewt} runden=1 lenses=${DREI} verdikt=ok`);
    return { dir, basis };
  }
  const pruefe = (r: { dir: string; basis: string }) =>
    checkReviewNachweis({ runGit: (a) => execFileSync("git", a, { cwd: r.dir, encoding: "utf8" }), env: { KQ_DIFF_BASE: r.basis } });

  test("Merge von main mit echtem Konflikt nach dem Review ist rot", () => {
    const r = pruefe(repoMitMerge(true));
    assert.equal(r.ok, false);
    assert.match(r.fehler.join(), /Konflikt-Merge [0-9a-f]{40} nach dem Review/);
  });

  test("konfliktfreier Merge von main nach dem Review bleibt grün", () => {
    const r = pruefe(repoMitMerge(false));
    assert.deepEqual(r.fehler, []);
    assert.equal(r.ok, true);
  });

  test("ohne Merge nach dem Review: grün", () => {
    const dir = mkdtempSync(join(tmpdir(), "kq-nachweis-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "x\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "basis");
    const basis = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "a.txt"), "y\n");
    git(dir, "commit", "-q", "-am", "feature");
    const reviewt = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "commit", "-q", "--allow-empty", "-m", `Nachweis\n\nKQ-Plan: kubernia-planner\nKQ-Review: head=${reviewt} runden=1 lenses=${DREI} verdikt=ok`);
    assert.equal(pruefe({ dir, basis }).ok, true);
  });
});
