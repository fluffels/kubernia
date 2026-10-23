/* Review- und Plan-Nachweis-Wächter (#1270).
 *
 * Jeder Agenten-PR trägt per Commit-Zeilen `${Z.plan}:` / `${Z.review}:` einen prüfbaren Nachweis
 * über Planungspass und konvergierten Lens-Review; die PR-CI erzwingt ihn pfadunabhängig.
 * Logik aus scripts/check-review-nachweis.mjs importiert (eine Quelle der Wahrheit), git
 * ist injiziert.
 */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Nachweis = {
  plan: { art: string; grund?: string; zeile?: string } | null;
  review: { head: string | null; runden: number; lenses: string[]; blocker: { lens: string; n: number }[] | null; verdikt: string | null } | null;
};
type Zeilen = { praefix: string; planer: string; plan: string; review: string; reviewOverride: string; diffsizeOverride: string };
type Mod = {
  MAX_FIX_RUNDEN: number;
  MAX_REVIEW_PAESSE: number;
  parseNachweis: (text: string, zeilen: Zeilen) => Nachweis;
  pflichtLenses: (d: unknown) => string[];
  bewerteNachweis: (o: { nachweis: Nachweis; dateien: string[]; headBekannt: boolean; headImSlice: boolean; konfliktMerges?: string[]; aenderungsCommits?: { sha: string; dateien: string[] }[]; zeilen: Zeilen }) => string[];
  konfliktMergesNach: (git: (a: string[]) => string, headSha: string) => string[];
  vorlage: (zeilen: Zeilen) => string;
  checkReviewNachweis: (o: { runGit: (a: string[]) => string; env?: Record<string, string>; ladeZeilen?: () => Zeilen }) => {
    ok: boolean;
    fehler: string[];
    override?: string;
    skipped?: boolean;
    commitsNachReview?: number | null;
  };
};
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/check-review-nachweis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";
import { FREMD, projektConfig } from "./support/fremd-config";
const { MAX_FIX_RUNDEN, MAX_REVIEW_PAESSE, pflichtLenses } = raw as Mod;
const { konfliktMergesNach } = sliceRaw as unknown as Pick<Mod, "konfliktMergesNach">;
const { commitZeilen } = sliceRaw as unknown as { commitZeilen: (praefix: string, planer: string) => Zeilen };

/** Die Zeilen der Fremd-Config; die Wrapper reichen sie durch, damit die Bestandstests unverändert lesbar bleiben. */
const PL = FREMD.agenten.planer;
const Z = commitZeilen(FREMD.praefixe.commitZeile, PL);
const ECHT = projektConfig();
const parseNachweis = (text: string) => (raw as Mod).parseNachweis(text, Z);
const bewerteNachweis = (o: Omit<Parameters<Mod["bewerteNachweis"]>[0], "zeilen"> & { zeilen?: Zeilen }) => (raw as Mod).bewerteNachweis({ zeilen: Z, ...o });
const checkReviewNachweis = (o: Parameters<Mod["checkReviewNachweis"]>[0]) => (raw as Mod).checkReviewNachweis({ ladeZeilen: () => Z, ...o });

const DREI = "architektur,requirement-treue,test-adaequanz";
const SHA = "a".repeat(40);
const review = (felder = `head=${SHA} runden=2 lenses=${DREI} verdikt=ok`) => `${Z.plan}: ${PL}\n${Z.review}: ${felder}`;

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
    const n = parseNachweis(`  ${Z.review}: head=${SHA} runden=1 lenses=doku verdikt=ok\nsiehe ${Z.plan}: ${PL}`);
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
  test("ein Head mit Großbuchstaben wird kleingeschrieben übernommen, ein zu kurzer bleibt leer", () => {
    const n = parseNachweis(`${Z.review}: head=${"AB12CD3".repeat(5)}12345 runden=1 lenses=doku verdikt=ok`);
    assert.equal(n.review?.head, `${"ab12cd3".repeat(5)}12345`);
    assert.equal(parseNachweis(`${Z.review}: head=ABC123 runden=1 lenses=doku verdikt=ok`).review?.head, null);
  });
  test("fehlende Felder bleiben leer, kaputte Zahl wird NaN", () => {
    const n = parseNachweis(`${Z.review}: runden=zwei`);
    assert.equal(n.review?.head, null);
    assert.ok(Number.isNaN(n.review?.runden));
    assert.deepEqual(n.review?.lenses, []);
    assert.equal(n.review?.verdikt, null);
  });
  test("Plan-Zeile ohne Planer braucht eine Begründung", () => {
    assert.deepEqual(parseNachweis(`${Z.plan}: ohne — Spawn scheiterte`).plan, { art: "ohne", grund: "Spawn scheiterte" });
    assert.equal(parseNachweis(`${Z.plan}: ohne`).plan?.art, "ungueltig");
    assert.equal(parseNachweis(`${Z.plan}: ohne —`).plan?.art, "ungueltig");
    assert.equal(parseNachweis(`${Z.plan}: egal`).plan?.art, "ungueltig");
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
    assert.match(ok(`${Z.plan}: ${PL}\n${Z.review}: runden=1 lenses=doku verdikt=ok`).join(), /head fehlt/);
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
  test("Plan-Zeile fehlt oder ist ungültig ist rot, mit Begründung ok", () => {
    const rev = `${Z.review}: head=${SHA} runden=1 lenses=${DREI} verdikt=ok`;
    assert.match(ok(rev).join(), new RegExp(`${Z.plan}-Zeile fehlt`));
    assert.match(ok(`${Z.plan}: ohne\n${rev}`).join(), new RegExp(`${Z.plan} ungültig`));
    assert.deepEqual(ok(`${Z.plan}: ohne — Spawn scheiterte\n${rev}`), []);
  });
  test(`${Z.review}-Zeile fehlt ist rot`, () => {
    assert.match(ok(`${Z.plan}: ${PL}`).join(), new RegExp(`${Z.review}-Zeile fehlt`));
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
    const n = parseNachweis(`${Z.review}: blocker=architektur:x`);
    assert.ok(Number.isNaN(n.review?.blocker?.[0].n));
    assert.deepEqual(parseNachweis(`${Z.review}: blocker= verdikt=ok`).review?.blocker, []);
  });
  test("alte Zeile ohne blocker bleibt gültig", () => {
    assert.deepEqual(bewerteNachweis({ nachweis: parseNachweis(review()), dateien: ["src/x.ts"], headBekannt: true, headImSlice: true }), []);
  });
  test("checkReviewNachweis meldet blockerFehlt für alte Zeilen, nicht für neue", () => {
    const lauf = (felder: string) =>
      checkReviewNachweis({ runGit: fakeGit({ messages: review(felder) }), env: { FACTORY_DIFF_BASE: "base" } }) as { ok: boolean; blockerFehlt?: boolean };
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
  /** Nicht-Merge-Commits nach dem reviewten Stand (#1740 L17): SHA → geänderte Dateien, älteste zuerst; leere Liste = leerer Commit. */
  nach?: Record<string, string[]>;
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
    // Commits nach dem reviewten Stand (#1740 L17): `<head>..HEAD` ohne die Basis, die Dateien je Commit per diff-tree.
    if (cmd.startsWith("rev-list --reverse --no-merges ") && cmd.endsWith(`..HEAD ^${B}`) && /^[0-9a-f]{40}$/.test(cmd.split(" ")[3].split("..")[0])) {
      return Object.keys(o.nach ?? {}).join("\n") + "\n";
    }
    const baum = /^diff-tree --no-commit-id --name-only -r ([0-9a-f]{40})$/.exec(cmd);
    if (baum) return (o.nach?.[baum[1]] ?? []).join("\n") + "\n";
    throw new Error(`unerwartet: ${cmd}`);
  };
}
const env = { FACTORY_DIFF_BASE: "base" };

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
    const ok = g(`revert\n\n${Z.reviewOverride}: #1270 Revert-PR`);
    assert.equal(ok.ok, true);
    assert.match(ok.override ?? "", /Revert-PR/);
    assert.equal(g(`${Z.reviewOverride}: Revert`).ok, false);
    assert.equal(g(`${Z.reviewOverride}: #1270`).ok, false);
  });
  test("Widerruf (#<nr> entfällt) hebt den Review-Override auf: der Nachweis wird geprüft (L7)", () => {
    const g = (m: string) => checkReviewNachweis({ runGit: fakeGit({ messages: m }), env });
    const widerrufen = g(`revert\n\n${Z.reviewOverride}: #1270 Revert-PR\n\n${Z.reviewOverride}: #1270 entfällt`);
    assert.equal(widerrufen.ok, false);
    assert.equal(widerrufen.override, undefined);
    assert.match(widerrufen.fehler.join(), new RegExp(`${Z.review}-Zeile fehlt`));
    const allein = g(`${Z.reviewOverride}: #1270 entfällt`);
    assert.equal(allein.ok, false);
    assert.equal(allein.override, undefined);
    // Mit gültigem Nachweis bleibt ein widerrufener Override grün (der Nachweis trägt).
    const mitNachweis = g(`${review()}\n\n${Z.reviewOverride}: #1270 Revert-PR\n\n${Z.reviewOverride}: #1270 entfällt`);
    assert.equal(mitNachweis.ok, true);
    assert.equal(mitNachweis.override, undefined);
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
    const dir = mkdtempSync(join(tmpdir(), "nachweis-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "eins\nzwei\ndrei\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "basis");
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
    git(dir, "commit", "-q", "--allow-empty", "-m", `Nachweis\n\n${Z.plan}: ${PL}\n${Z.review}: head=${reviewt} runden=1 lenses=${DREI} verdikt=ok`);
    // Wie im Betrieb: nach dem Einmergen ist die Basis (merge-base mit main) die Spitze von main; deren Commits zählen nicht zum Slice.
    return { dir, basis: git(dir, "rev-parse", "main").trim() };
  }
  const pruefe = (r: { dir: string; basis: string }) =>
    checkReviewNachweis({ runGit: (a) => execFileSync("git", a, { cwd: r.dir, encoding: "utf8" }), env: { FACTORY_DIFF_BASE: r.basis } });

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
    const dir = mkdtempSync(join(tmpdir(), "nachweis-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "x\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "basis");
    const basis = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "a.txt"), "y\n");
    git(dir, "commit", "-q", "-am", "feature");
    const reviewt = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "commit", "-q", "--allow-empty", "-m", `Nachweis\n\n${Z.plan}: ${PL}\n${Z.review}: head=${reviewt} runden=1 lenses=${DREI} verdikt=ok`);
    assert.equal(pruefe({ dir, basis }).ok, true);
  });
});

describe("Commit mit Baumänderung nach dem Review (#1740 L17)", () => {
  const X = "e".repeat(40);
  const Y = "f".repeat(40);

  test("bewerteNachweis: je Commit ein Fehler mit Dateien (höchstens fünf, dann …) und Fix-Weg; ohne Commits unverändert", () => {
    const n = parseNachweis(review());
    const dateien = ["src/x.ts"];
    assert.deepEqual(bewerteNachweis({ nachweis: n, dateien, headBekannt: true, headImSlice: true, aenderungsCommits: [] }), []);
    const f = bewerteNachweis({
      nachweis: n,
      dateien,
      headBekannt: true,
      headImSlice: true,
      aenderungsCommits: [
        { sha: X, dateien: ["a.ts", "b.ts"] },
        { sha: Y, dateien: ["1", "2", "3", "4", "5", "6"] },
      ],
    });
    assert.equal(f.length, 2);
    assert.match(f[0], new RegExp(`Commit ${X} nach dem Review ändert a\\.ts, b\\.ts: Delta-Lens der betroffenen Brillen auf ${SHA}\\.\\.HEAD, dann neuer Nachweis \\(head ≥ ${X}\\)`));
    assert.match(f[1], /ändert 1, 2, 3, 4, 5, …:/);
    assert.match(f[0], /review-lenses › Nachweis nach Konvergenz/);
  });

  test("bewerteNachweis: genau fünf Dateien ohne …, sechs mit … und nur fünf Namen (Grenze)", () => {
    const n = parseNachweis(review());
    const meldung = (dateien: string[]) =>
      bewerteNachweis({ nachweis: n, dateien: ["src/x.ts"], headBekannt: true, headImSlice: true, aenderungsCommits: [{ sha: X, dateien }] })[0];
    assert.match(meldung(["1", "2", "3", "4", "5"]), /ändert 1, 2, 3, 4, 5: Delta-Lens/);
    assert.doesNotMatch(meldung(["1", "2", "3", "4", "5"]), /…/);
    const sechs = meldung(["1", "2", "3", "4", "5", "6"]);
    assert.match(sechs, /ändert 1, 2, 3, 4, 5, …: Delta-Lens/);
    assert.doesNotMatch(sechs, /ändert [^:]*6/);
  });

  test("checkReviewNachweis: ein leerer Commit nach head (Nachweis, Override) bleibt grün", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review(), nach: { [X]: [] } }), env });
    assert.deepEqual(r.fehler, []);
    assert.equal(r.ok, true);
  });

  test("checkReviewNachweis: ein Code-Commit nach head ist rot, auch zwischen leeren Commits", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review(), nach: { [Y]: [], [X]: ["src/a.ts"] } }), env });
    assert.equal(r.ok, false);
    assert.equal(r.fehler.length, 1);
    assert.match(r.fehler[0], new RegExp(`Commit ${X} nach dem Review ändert src/a\\.ts`));
  });

  test("checkReviewNachweis: ein git-Fehler bei diff-tree ist rot", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review(), nach: { [X]: ["a.ts"] }, throws: "diff-tree" }), env });
    assert.equal(r.ok, false);
    assert.match(r.fehler.join(), /git-Fehler/);
  });

  describe("echtes git-Repo", { timeout: 30_000 }, () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const nachweis = (dir: string, head: string, extra = "") =>
      git(dir, "commit", "-q", "--allow-empty", "-m", `Nachweis${extra}\n\n${Z.plan}: ${PL}\n${Z.review}: head=${head} runden=1 lenses=${DREI} verdikt=ok`);
    const sha = (dir: string) => git(dir, "rev-parse", "HEAD").trim();
    const pruefe = (dir: string, basis: string) =>
      checkReviewNachweis({ runGit: (a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }), env: { FACTORY_DIFF_BASE: basis } });

    /** Basis auf main, ein Feature-Commit (reviewt) darauf. */
    function repo() {
      const dir = mkdtempSync(join(tmpdir(), "nachweis-"));
      dirs.push(dir);
      git(dir, "init", "-q", "-b", "main");
      writeFileSync(join(dir, "a.txt"), "x\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "basis");
      const basis = sha(dir);
      git(dir, "checkout", "-q", "-b", "feature");
      writeFileSync(join(dir, "a.txt"), "y\n");
      git(dir, "commit", "-q", "-am", "feature");
      return { dir, basis, reviewt: sha(dir) };
    }

    test("Code-Commit nach dem Nachweis ist rot, nennt Commit und Datei", () => {
      const { dir, basis, reviewt } = repo();
      nachweis(dir, reviewt);
      writeFileSync(join(dir, "a.txt"), "z\n");
      git(dir, "commit", "-q", "-am", "fix nach dem Review");
      const fix = sha(dir);
      const r = pruefe(dir, basis);
      assert.equal(r.ok, false);
      assert.match(r.fehler.join(), new RegExp(`Commit ${fix} nach dem Review ändert a\\.txt: Delta-Lens .* auf ${reviewt}\\.\\.HEAD`));
    });

    test("leere Commits nach dem Nachweis (Override-Zeile) bleiben grün", () => {
      const { dir, basis, reviewt } = repo();
      nachweis(dir, reviewt);
      git(dir, "commit", "-q", "--allow-empty", "-m", `${Z.diffsizeOverride}: #1 entfällt`);
      assert.deepEqual(pruefe(dir, basis).fehler, []);
    });

    test("neuer Nachweis mit head = Fix: grün; ein zweiter Fix danach wieder rot", () => {
      const { dir, basis, reviewt } = repo();
      nachweis(dir, reviewt);
      writeFileSync(join(dir, "a.txt"), "z\n");
      git(dir, "commit", "-q", "-am", "fix");
      nachweis(dir, sha(dir), " 2");
      const r = pruefe(dir, basis);
      assert.deepEqual(r.fehler, []);
      assert.equal(r.ok, true);
      writeFileSync(join(dir, "a.txt"), "w\n");
      git(dir, "commit", "-q", "-am", "noch ein fix");
      assert.equal(pruefe(dir, basis).ok, false);
    });

    test("main-Commits eines konfliktfreien Merges zählen nicht, ein eigener Code-Commit danach schon", () => {
      const { dir, reviewt } = repo();
      git(dir, "checkout", "-q", "main");
      writeFileSync(join(dir, "b.txt"), "b\n");
      git(dir, "add", "b.txt");
      git(dir, "commit", "-q", "-m", "main-aenderung");
      git(dir, "checkout", "-q", "feature");
      git(dir, "merge", "-q", "--no-edit", "main");
      nachweis(dir, reviewt);
      const basis = git(dir, "rev-parse", "main").trim();
      assert.deepEqual(pruefe(dir, basis).fehler, []);
      writeFileSync(join(dir, "a.txt"), "q\n");
      git(dir, "commit", "-q", "-am", "eigener fix");
      assert.equal(pruefe(dir, basis).ok, false);
    });
  });
});

// ── Commit-Zeilen-Präfix aus der Projekt-Config (#1741, ADR 0022 F3) ─────────────────────────────

/** Wörtliche Commit-Message des gemergten Squash-Commits 1d193666 (Betreff als `* `-Zeilen, zwei Nachweise im Body). */
const squash = (z: Zeilen, planer: string): string => [ // die Zeilen der Config stehen als Parameter, der übrige Text ist wörtlich
  "feat(harness): Abschluss ohne offene Befunde, BEFUNDE-Zeile, brain-input im Fortsetzungs-Pfad (#1723) (#1733)",
  "",
  "* feat(harness): R0 verlangt BEFUNDE-Zeile im Umsetzer-Bericht (#1723)",
  "",
  "* feat(harness): Abschluss ohne offene Befunde in AGENTS, Skills, Workflow, Umsetzer (#1723)",
  "",
  "* docs(harness): Ticket-Ende-Mechanik, Glossar, Workflow-Deckel (#1723)",
  "",
  "* fix(harness): Review-Runde 1 (#1723)",
  "",
  "Runde 1: blocker=architektur:2,test-adaequanz:2",
  "",
  "* fix(harness): Review-Runde 2, i-Flags getestet (#1723)",
  "",
  "Runde 2: blocker=test-adaequanz:2",
  "",
  "* chore(harness): Review-Nachweis (#1723)",
  "",
  `${z.plan}: ${planer}`,
  `${z.review}: head=7e145d331598bb4009a8a504b87a7347930416be runden=3 lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:2,requirement-treue:0,test-adaequanz:2 verdikt=ok`,
  "",
  "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>",
  "Claude-Session: https://claude.ai/code/session_01LpXppXWFQtLt6rzgeapR9x",
  "",
  "* fix(harness): AGENTS.md-Bullet knapper für das Zeichenbudget (#1723)",
  "",
  "* chore(harness): Review-Nachweis nach Merge (#1723)",
  "",
  `${z.plan}: ${planer}`,
  `${z.review}: head=47da050d18478970b277ae0d9218482fdd79fd11 runden=3 lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:2,requirement-treue:0,test-adaequanz:2 verdikt=ok`,
  "",
  "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>",
  "Claude-Session: https://claude.ai/code/session_01LpXppXWFQtLt6rzgeapR9x",
  "",
  "---------",
  "",
  "Co-authored-by: Claude Sonnet 5.5 <noreply@anthropic.com>",
].join("\n");

describe("Präfix und Planer kommen aus der Config (#1741)", () => {
  const bewerte = (text: string, zeilen: Zeilen) =>
    (raw as Mod).bewerteNachweis({
      nachweis: (raw as Mod).parseNachweis(text, zeilen),
      dateien: ["src/x.ts"],
      headBekannt: true,
      headImSlice: true,
      zeilen,
    });

  test("AK3: die wörtliche Squash-Message eines gemergten Commits ist mit der Config ein gültiger Nachweis", () => {
    const n = parseNachweis(squash(Z, PL));
    assert.deepEqual(n.plan, { art: "planer" });
    assert.equal(n.review?.head, "47da050d18478970b277ae0d9218482fdd79fd11"); // der jüngste Nachweis gilt
    assert.equal(n.review?.runden, 3);
    assert.deepEqual(bewerte(squash(Z, PL), Z), []);
  });

  test("die Squash-Message mit den Zeilen der echten Config ist mit ihr ein gültiger Nachweis", () => {
    const zeilen = commitZeilen(ECHT.praefixe.commitZeile, ECHT.agenten.planer);
    assert.deepEqual(bewerte(squash(zeilen, ECHT.agenten.planer), zeilen), []);
  });

  test("Red-Green: mit der Config AB- zählen die Zeilen der anderen Config nicht, die Meldungen nennen das Präfix der Config", () => {
    const ab = commitZeilen("AB-", PL);
    const f = bewerte(squash(Z, PL), ab).join("\n");
    assert.match(f, /AB-Plan-Zeile fehlt/);
    assert.match(f, /AB-Review-Zeile fehlt/);
    assert.doesNotMatch(f, new RegExp(Z.praefix));
    assert.deepEqual(bewerte(squash(ab, PL), ab), []);
  });

  test("ein ungültiger Plan nennt den Planer der Config, nicht einen festen Namen", () => {
    const f = bewerte(`${Z.plan}: egal\n${Z.review}: head=${SHA} runden=1 lenses=${DREI} blocker=architektur:0,requirement-treue:0,test-adaequanz:0 verdikt=ok`, commitZeilen(Z.praefix, "mein-planer")).join("\n");
    assert.match(f, /"mein-planer"/);
    assert.doesNotMatch(f, new RegExp(`"${PL}"`));
  });

  test("bewerteNachweis ohne Zeilen wirft (kein Standardwert)", () => {
    assert.throws(
      () => (raw as unknown as { bewerteNachweis: (o: unknown) => string[] }).bewerteNachweis({ nachweis: { plan: null, review: null }, dateien: [], headBekannt: false, headImSlice: false }),
      /Commit-Zeilen/,
    );
  });

  test("AK4: Plan- und Review-Zeilen mit fremdem Präfix zählen nicht", () => {
    const r = checkReviewNachweis({ runGit: fakeGit({ messages: review().replaceAll(Z.praefix, "XQ-") }), env });
    assert.equal(r.ok, false);
    assert.match(r.fehler.join("\n"), new RegExp(`${Z.plan}-Zeile fehlt`));
  });

  test(`ein Override trägt das Präfix der Config: ${Z.reviewOverride} gilt bei seinem Präfix, bei AB- nicht`, () => {
    const text = `${Z.reviewOverride}: #5 Revert-PR`;
    assert.equal(checkReviewNachweis({ runGit: fakeGit({ messages: text }), env }).ok, true);
    const ab = (raw as Mod).checkReviewNachweis({ ladeZeilen: () => commitZeilen("AB-", PL), runGit: fakeGit({ messages: text }), env });
    assert.equal(ab.ok, false);
  });

  test("ein Ladefehler der Config macht den Check rot, ohne dass git gefragt wird", () => {
    const r = (raw as Mod).checkReviewNachweis({
      ladeZeilen: () => {
        throw new Error("Projekt-Config ungültig: praefixe.commitZeile fehlt\nFix: ergänzen");
      },
      runGit: () => {
        throw new Error("git darf nicht aufgerufen werden");
      },
      env,
    });
    assert.equal(r.ok, false);
    assert.match(r.fehler.join("\n"), /praefixe\.commitZeile/);
    assert.doesNotMatch(r.fehler.join("\n"), /git darf nicht/);
  });

  test("die Vorlage trägt Präfix und Planer der Config", () => {
    const v = (raw as Mod).vorlage(commitZeilen("AB-", "x-planer"));
    assert.match(v, /^AB-Plan: x-planer\nAB-Review: head=/);
    assert.doesNotMatch(v, new RegExp(Z.praefix));
  });
});

describe("check-review-nachweis CLI mit --config (#1741)", { timeout: 60_000 }, () => {
  const SKRIPT = join(fileURLToPath(new URL("../", import.meta.url)), "scripts", "check-review-nachweis.mjs");
  const echteConfig = (): Record<string, unknown> => ({
    version: 2,
    repo: "acme/demo",
    boards: ["produkt", "factory"].map((rolle, i) => ({ rolle, besitzer: "acme", besitzerTyp: "org", nummer: i + 1, projectId: `p${i}`, statusFeldId: 5, statusFeldNodeId: "s", todoOptionId: "t" })),
    praefixe: { commitZeile: "ZD-", branch: "feature/zd-", worktree: "zd-" },
    labels: { harness: "area:werk", festgefahren: "status:steckt", forum: "forum", dependabotInbox: "area:werk" },
    agenten: { planer: "demo-planer", umsetzer: "u", lens: "l", gruppe: "g", ticketSkill: "t" },
  });
  const lauf = (dir: string, args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [SKRIPT, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
  const mkdir = () => {
    const d = mkdtempSync(join(tmpdir(), "nw-cli-"));
    dirs.push(d);
    return d;
  };

  test("Config ohne praefixe.commitZeile: Exit ≠ 0 vor jedem git-Aufruf, stderr nennt Pfad, Schlüssel und Fix:", () => {
    const d = mkdir(); // kein git-Repo: ein git-Aufruf würde anders scheitern
    const c = echteConfig();
    delete (c.praefixe as Record<string, unknown>).commitZeile;
    const pfad = join(d, "c.json");
    writeFileSync(pfad, JSON.stringify(c));
    const r = lauf(d, ["--config", pfad]);
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes(pfad), r.stderr);
    assert.match(r.stderr, /praefixe\.commitZeile/);
    assert.match(r.stderr, /Fix:/);
  });

  test("Config ohne Label- oder Agentenschlüssel: Exit ≠ 0 mit Schlüssel und Fix:", () => {
    const d = mkdir();
    for (const [gruppe, schluessel] of [["labels", "forum"], ["agenten", "planer"]] as const) {
      const c = echteConfig();
      delete (c[gruppe] as Record<string, unknown>)[schluessel];
      const pfad = join(d, `${gruppe}.json`);
      writeFileSync(pfad, JSON.stringify(c));
      const r = lauf(d, ["--config", pfad]);
      assert.notEqual(r.status, 0, gruppe);
      assert.match(r.stderr, new RegExp(`${gruppe}\\.${schluessel}`));
      assert.match(r.stderr, /Fix:/);
    }
  });

  test("--config ohne Pfad: Exit ≠ 0", () => {
    const r = lauf(mkdir(), ["--config"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--config braucht einen Pfad/);
  });

  test("mit der Config ZD- zählen ZD-Zeilen im Repo (Exit 0), die Zeilen einer anderen Config nicht (Exit 1)", () => {
    const d = mkdir();
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false", ...a], { cwd: d, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q", "-b", "main");
    writeFileSync(join(d, "a.md"), "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", "basis");
    const basis = git("rev-parse", "HEAD").trim();
    writeFileSync(join(d, "a.md"), "y\n");
    git("commit", "-q", "-am", "doku");
    const reviewt = git("rev-parse", "HEAD").trim();
    const pfad = join(d, "c.json");
    writeFileSync(pfad, JSON.stringify(echteConfig()));
    const nachweis = (p: string) => `${p}Plan: demo-planer\n${p}Review: head=${reviewt} runden=1 lenses=doku blocker=doku:0 verdikt=ok`;
    git("commit", "-q", "--allow-empty", "-m", "Nachweis", "-m", nachweis(Z.praefix));
    const rot = lauf(d, ["--config", pfad], { FACTORY_DIFF_BASE: basis });
    assert.equal(rot.status, 1, rot.stdout + rot.stderr);
    assert.match(rot.stderr, /ZD-Plan-Zeile fehlt/);
    git("commit", "-q", "--allow-empty", "-m", "Nachweis ZD", "-m", nachweis("ZD-"));
    const gruen = lauf(d, ["--config", pfad], { FACTORY_DIFF_BASE: basis });
    assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
    assert.match(gruen.stdout, /Nachweis ok/);
  });
});
