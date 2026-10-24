/* Tests für scripts/slice-override.mjs (#1311): die Ausgabe-Helfer und der CLI-Zweig von check:diffcoverage,
 * die bisher ungetestet waren (Befund aus dem Review von #1309).
 *
 * Reines Node-Tooling ohne Declaration-File: Namespace einmal auf eine lokale Oberfläche gebracht. */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { altName, ohneKernEnv } from "./support/env-alt";
import { FREMD, FREMD_CONFIG_PFAD, projektConfig } from "./support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as nlRaw from "../scripts/nachweis-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gate from "../scripts/check-review-nachweis.mjs";

interface Zeilen {
  praefix: string;
  planer: string;
  plan: string;
  review: string;
  abnahme: string;
  reviewOverride: string;
  abnahmeOverride: string;
  diffsizeOverride: string;
  diffcovOverride: string;
  lockfileOverride: string;
}
const so = raw as unknown as {
  meldeUngueltigeOverrides: (invalid: string[] | undefined, o?: { dim?: (s: string) => string; log?: (s: string) => void }) => void;
  staleOverrideHinweis: (key: string, warum: string) => string;
  commitZeilen: (praefix?: unknown, planer?: unknown) => Zeilen;
  commitZeilenAus: (config: unknown) => Zeilen;
  ladeCommitZeilen: (opt?: { rootDir?: string; pfad?: string }) => Zeilen;
  ladeCommitZeilenOderBeende: (o?: { laden?: () => Zeilen; fehler?: (s: string) => void; exit?: (code: number) => void }) => Zeilen | undefined;
  parseOverrideTrailers: (text: string, key: string) => { valid: { nr: number; reason: string }[]; invalid: string[] };
  loeseCommit: (git: (a: string[]) => string, ref: string) => string | null;
  commitImSlice: (
    git: (a: string[]) => string,
    base: string,
    ref: string,
  ) => { sha: string | null; bekannt: boolean; imSlice: boolean; konfliktMerges: string[]; aenderungsCommits: { sha: string; dateien: string[] }[] };
};
const nl = nlRaw as unknown as { parseNachweis: (text: string, zeilen?: Zeilen) => { plan: unknown; review: { runden: number; lenses: string[] } | null; abnahme: unknown } };
const gateModul = gate as unknown as { parseNachweis: unknown };
const Z = so.commitZeilenAus(FREMD);
/** Zeilen der echten Config: für Kindprozesse, die sie selbst lesen. */
const ECHT = so.commitZeilenAus(projektConfig());
const HEAD40 = "a".repeat(40);

describe("commitZeilen (#1741): alle Schlüssel aus dem Präfix, kein Standardwert", () => {
  it("leitet Plan, Review und die fünf Override-Schlüssel aus dem Präfix ab", () => {
    expect(so.commitZeilen("AB-", "x-planer")).toEqual({
      praefix: "AB-",
      planer: "x-planer",
      plan: "AB-Plan",
      review: "AB-Review",
      abnahme: "AB-Abnahme",
      reviewOverride: "AB-Review-Override",
      abnahmeOverride: "AB-Abnahme-Override",
      diffsizeOverride: "AB-Diffsize-Override",
      diffcovOverride: "AB-Diffcov-Override",
      lockfileOverride: "AB-Lockfile-Override",
    });
    expect(Z.diffcovOverride).toBe(`${FREMD.praefixe.commitZeile}Diffcov-Override`);
  });
  it("ungültiges oder fehlendes Präfix/Planer wirft (kein Default)", () => {
    for (const p of [undefined, "xq-", "XQ", "XQ--", "", 5, null]) expect(() => so.commitZeilen(p, "x"), String(p)).toThrow(/Präfix/);
    for (const pl of [undefined, "a:b", "-x", "", "a b"]) expect(() => so.commitZeilen(FREMD.praefixe.commitZeile, pl), String(pl)).toThrow(/Planer/);
  });
  it("commitZeilenAus liest praefixe.commitZeile und agenten.planer; ohne sie wirft es", () => {
    expect(so.commitZeilenAus({ praefixe: { commitZeile: "AB-" }, agenten: { planer: "p" } }).plan).toBe("AB-Plan");
    expect(() => so.commitZeilenAus({})).toThrow(/Präfix/);
    expect(() => so.commitZeilenAus(undefined)).toThrow(/Präfix/);
  });
  it("ladeCommitZeilenOderBeende: Erfolg liefert die Zeilen ohne Meldung, ein werfender Lader endet mit Meldung und exit(1)", () => {
    const meldungen: string[] = [];
    const codes: number[] = [];
    const io = { fehler: (s: string) => meldungen.push(s), exit: (c: number) => codes.push(c) };
    expect(so.ladeCommitZeilenOderBeende({ ...io, laden: () => Z })).toBe(Z);
    expect(meldungen).toEqual([]);
    expect(codes).toEqual([]);
    so.ladeCommitZeilenOderBeende({ ...io, laden: () => { throw new Error("Config kaputt. Fix: x"); } });
    expect(meldungen).toEqual(["✖ Config kaputt. Fix: x"]);
    expect(codes).toEqual([1]);
    // Ein Nicht-Error-Wurf (String) ist hier Absicht: er deckt den `String(e)`-Zweig.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    so.ladeCommitZeilenOderBeende({ ...io, laden: () => { throw "roh"; } });
    expect(meldungen[1]).toBe("✖ roh");
  });
  it("ladeCommitZeilen liest die echte Config, mit `pfad` die genannte, und wirft bei fehlender Datei mit Fix-Zeile", () => {
    expect(so.ladeCommitZeilen().praefix).toBe(projektConfig().praefixe.commitZeile);
    expect(so.ladeCommitZeilen({ pfad: FREMD_CONFIG_PFAD }).praefix).toBe(FREMD.praefixe.commitZeile);
    const dir = mkdtempSync(join(tmpdir(), "cz-"));
    try {
      expect(() => so.ladeCommitZeilen({ pfad: join(dir, "nein.json") })).toThrow(/Fix:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Präfix aus der Config steuert, welche Zeilen zählen (#1741, Red-Green)", () => {
  const text = `${Z.plan}: ${FREMD.agenten.planer}\n${Z.review}: head=${HEAD40} runden=1 lenses=doku blocker=doku:0 verdikt=ok\n${Z.diffsizeOverride}: #5 weil`;
  it("mit AB- zählen die Zeilen der Fremd-Config nicht, AB-Zeilen schon", () => {
    const ab = so.commitZeilen("AB-", FREMD.agenten.planer);
    const n = nl.parseNachweis(text, ab);
    expect(n.plan).toBeNull();
    expect(n.review).toBeNull();
    expect(nl.parseNachweis(text.replaceAll(FREMD.praefixe.commitZeile, "AB-"), ab).plan).toEqual({ art: "planer" });
    expect(so.parseOverrideTrailers(text, ab.diffsizeOverride).valid).toEqual([]);
    expect(so.parseOverrideTrailers(text, Z.diffsizeOverride).valid).toHaveLength(1);
  });
  it("der Planer kommt aus der Config: ein anderer Name ist ungültig", () => {
    expect(nl.parseNachweis(text, so.commitZeilen(FREMD.praefixe.commitZeile, "anderer")).plan).toEqual({ art: "ungueltig", zeile: FREMD.agenten.planer });
  });
  it("parseNachweis ohne Zeilen wirft, auch mit Teilobjekt", () => {
    expect(() => nl.parseNachweis(text)).toThrow(/Commit-Zeilen/);
    expect(() => nl.parseNachweis(text, { plan: Z.plan } as unknown as Zeilen)).toThrow(/Commit-Zeilen/);
    expect(() => nl.parseNachweis(text, { plan: Z.plan, review: Z.review } as unknown as Zeilen)).toThrow(/Commit-Zeilen/); // ohne planer
  });
  it("Regex-Zeichen im Schlüssel sind wörtlich (kein Joker)", () => {
    expect(so.parseOverrideTrailers("AXB-Plan: #1 x", "A.B-Plan").valid).toEqual([]);
    expect(so.parseOverrideTrailers("A.B-Plan: #1 x", "A.B-Plan").valid).toHaveLength(1);
  });
});

describe("meldeUngueltigeOverrides", () => {
  it("loggt je ungültiger Zeile genau eine gedimmte Meldung mit der Zeile", () => {
    const zeilen: string[] = [];
    so.meldeUngueltigeOverrides([`${Z.praefix}X-Override: kaputt`, `${Z.praefix}X-Override: #5`], { dim: (s) => `<${s}>`, log: (s) => zeilen.push(s) });
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]).toBe(`<• ungültige Override-Zeile ignoriert (braucht "#<nr> <warum>"): ${Z.praefix}X-Override: kaputt>`);
    expect(zeilen[1]).toContain(`${Z.praefix}X-Override: #5`);
  });

  it("leere, fehlende oder nicht übergebene Liste: keine Ausgabe, kein Wurf", () => {
    const zeilen: string[] = [];
    for (const leer of [[], undefined]) so.meldeUngueltigeOverrides(leer, { log: (s) => zeilen.push(s) });
    expect(zeilen).toEqual([]);
  });
});

describe("staleOverrideHinweis", () => {
  it("nennt Schlüssel und Grund und den Weg, den Override zu entfernen", () => {
    const t = so.staleOverrideHinweis(Z.diffcovOverride, "der Slice erfüllt die Floors");
    expect(t).toContain(`${Z.diffcovOverride} steht im Slice, aber der Slice erfüllt die Floors`);
    expect(t).toContain("stale");
    expect(t).toContain("Feature-Branch");
  });
});

describe("parseNachweis lebt im neutralen Modul nachweis-lib (#1311)", () => {
  it("das Gate re-exportiert dieselbe Funktion; das Messskript liest sie aus nachweis-lib", () => {
    expect(gateModul.parseNachweis).toBe(nl.parseNachweis);
    const n = nl.parseNachweis(`${Z.plan}: ${FREMD.agenten.planer}\n${Z.review}: head=${"a".repeat(40)} runden=2 lenses=architektur,doku verdikt=ok`, Z);
    expect(n.review?.runden).toBe(2);
    expect(n.review?.lenses).toEqual(["architektur", "doku"]);
  });
});

describe("check:diffcoverage CLI im Doku-Slice (nichts zu messen)", { timeout: 30_000 }, () => {
  const SKRIPT = join(__dirname, "..", "scripts", "check-diffcoverage.mjs");

  /** Umgebung mit der Diff-Basis unter dem gegebenen Namen; die Umgebung der CI und der Maintainerin liefert keine zweite Basis. */
  function umgebung(basisName: string, basis: string): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };
    ohneKernEnv(env, "FACTORY_DIFF_BASE");
    env[basisName] = basis;
    return env;
  }

  /** Temp-Repo: Basis-Commit, dann ein Doku-Commit mit der gegebenen Nachricht; liefert Ergebnis des CLI-Laufs. */
  function lauf(nachricht: string, basisName = "FACTORY_DIFF_BASE") {
    const dir = mkdtempSync(join(tmpdir(), "dcov-"));
    try {
      const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, encoding: "utf8" }).trim();
      git("init", "-q");
      writeFileSync(join(dir, "a.md"), "eins\n");
      git("add", "-A");
      git("commit", "-q", "-m", "basis");
      const basis = git("rev-parse", "HEAD");
      writeFileSync(join(dir, "a.md"), "zwei\n");
      git("add", "-A");
      git("commit", "-q", "-m", "doku", "-m", nachricht);
      const r = spawnSync(process.execPath, [SKRIPT], { cwd: dir, encoding: "utf8", env: umgebung(basisName, basis) });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  it("ungültige Override-Zeile wird auch im grünen Zweig gemeldet, der Lauf bleibt grün", () => {
    const r = lauf(`${ECHT.diffcovOverride}: ohne Nummer`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ungültige Override-Zeile ignoriert");
    expect(r.out).toContain("keinen gemessenen Quellcode (src/**/*.ts)");
  });

  it("gültige Override-Zeile ohne messbaren Code ist stale und rot", () => {
    const r = lauf(`${ECHT.diffcovOverride}: #1 weil`);
    expect(r.code).toBe(1);
    expect(r.out).toContain("stale");
  });

  it("ohne Override-Zeile: grün, keine Meldung", () => {
    const r = lauf("ganz normal");
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("ungültige Override-Zeile");
    expect(r.out).not.toContain("veraltet");
  });

  it("Altname der Diff-Basis: wirkt nicht mehr, keine Warnung", () => {
    const r = lauf("ganz normal", altName("FACTORY_DIFF_BASE"));
    expect(r.out).not.toContain("veraltet");
    expect(r.out).not.toContain("keinen gemessenen Quellcode (src/**/*.ts)");
  });
});

// Format belegt an Commit 913cf17: GitHub schreibt jeden Commit-Betreff als `* <betreff>`, Body-Zeilen
// bleiben unverändert (#1383).
function squash(titel: string, commits: string[]): string {
  const teile = commits.map((c) => c.split("\n").map((z, i) => (i === 0 ? `* ${z}` : z)).join("\n") + "\n");
  return [titel, "", ...teile, "---------"].join("\n");
}
/** Wie `git log --reverse --format=%B` auf dem Branch. */
function branchLog(commits: string[]): string {
  return commits.map((c) => c + "\n").join("\n");
}

describe("PR-Log und Squash-Commit auf main lesen dasselbe (#1383)", () => {
  const KEY = Z.diffsizeOverride;
  const NACHWEIS = `${Z.plan}: ${FREMD.agenten.planer}\n${Z.review}: head=abc1234 runden=1 lenses=architektur verdikt=ok`;
  const szenarien: [string, string[]][] = [
    ["Override als Betreff", ["feat: a", `${KEY}: #5 breit`, "fix: b"]],
    ["Override als Body-Zeile", [`feat: a\n\n${KEY}: #5 breit`, "fix: b"]],
    ["ungültiger Override als Betreff", ["feat: a", `${KEY}: ohne nummer`]],
    ["alter als Betreff, neuer als Body", [`${KEY}: #1 alt`, `feat: a\n\n${KEY}: #2 neu`]],
    [`Nachweis mit ${Z.plan} als Betreff`, ["feat: a", NACHWEIS]],
    ["Nachweis wie im Skill (beide im Body)", ["feat: a", `chore: Nachweis\n\n${NACHWEIS}`]],
  ];
  it.each(szenarien)("%s", (_name, commits) => {
    const pr = branchLog(commits);
    const main = squash("titel (#9)", commits);
    expect(so.parseOverrideTrailers(main, KEY)).toEqual(so.parseOverrideTrailers(pr, KEY));
    expect(nl.parseNachweis(main, Z)).toEqual(nl.parseNachweis(pr, Z));
  });

  it("neuester gewinnt in beiden Formen", () => {
    const commits = [`${KEY}: #1 alt`, `feat: a\n\n${KEY}: #2 neu`];
    expect(so.parseOverrideTrailers(branchLog(commits), KEY).valid.at(-1)?.nr).toBe(2);
    expect(so.parseOverrideTrailers(squash("t", commits), KEY).valid.at(-1)?.nr).toBe(2);
  });
});

describe("versetzteOverrideZeilen (#1349 Z31): die Zeile steht knapp neben dem Format und wird still ignoriert", () => {
  const V = raw as unknown as {
    versetzteOverrideZeilen: (text: string, key: string) => string[];
    versetzteOverrideHinweis: (key: string, zeilen: string[] | undefined) => string[];
    sliceOverride: (runGit: (args: string[]) => string, base: string, key: string) => { reason: string | null; versetzt: string[] };
  };
  const KEY = Z.diffsizeOverride;

  it("eingerückt, mit '- '-Präfix und mitten im Fließtext: gemeldet", () => {
    const text = [`  ${KEY}: #1 eingerückt`, `- ${KEY}: #1 mit Strich`, `siehe ${KEY}: #1 im Text`].join("\n");
    expect(V.versetzteOverrideZeilen(text, KEY)).toEqual([`${KEY}: #1 eingerückt`, `- ${KEY}: #1 mit Strich`, `siehe ${KEY}: #1 im Text`]);
  });

  it("gültige Zeilen (Zeilenanfang und '* '-Betreff aus #1383) und ungültige Werte am Zeilenanfang: kein Hinweis", () => {
    const text = [`${KEY}: #1 gültig`, `* ${KEY}: #2 Squash-Betreff`, `${KEY}: kaputt ohne Nummer`].join("\n");
    expect(V.versetzteOverrideZeilen(text, KEY)).toEqual([]);
  });

  it("anderer Schlüssel und leerer Text: kein Treffer; CRLF stört nicht", () => {
    expect(V.versetzteOverrideZeilen(`${Z.diffcovOverride}: #1 x`, KEY)).toEqual([]);
    expect(V.versetzteOverrideZeilen("", KEY)).toEqual([]);
    expect(V.versetzteOverrideZeilen(`a\r\n  ${KEY}: #1 x\r\n`, KEY)).toEqual([`${KEY}: #1 x`]);
  });

  it("sliceOverride liefert die versetzten Zeilen mit, ohne den gültigen Override zu stören", () => {
    const log = [`- ${KEY}: #5 falsch eingerückt`, `${KEY}: #5 richtig`].join("\n");
    const r = V.sliceOverride(() => log, "BASE", KEY);
    expect(r.reason).toBe("#5 richtig");
    expect(r.versetzt).toEqual([`- ${KEY}: #5 falsch eingerückt`]);
    const nur = V.sliceOverride(() => `- ${KEY}: #5 falsch`, "BASE", KEY);
    expect(nur.reason).toBeNull();
    expect(nur.versetzt).toHaveLength(1);
  });

  it("der Hinweis nennt Schlüssel, Zeile und das erwartete Format; ohne Zeilen leer", () => {
    const h = V.versetzteOverrideHinweis(KEY, [`- ${KEY}: #1 x`]);
    expect(h).toHaveLength(1);
    expect(h[0]).toContain("nicht am Zeilenanfang");
    expect(h[0]).toContain(`"${KEY}: #<nr> <warum>"`);
    expect(V.versetzteOverrideHinweis(KEY, [])).toEqual([]);
    expect(V.versetzteOverrideHinweis(KEY, undefined)).toEqual([]);
  });
});

describe("aktiverOverride: jüngste Zeile mit Widerruf-Logik (#1756)", () => {
  const ao = raw as unknown as { aktiverOverride: (text: string, key: string) => string | null };
  const KEY = Z.abnahmeOverride;
  const text = (...zeilen: string[]) => zeilen.join(String.fromCharCode(10));
  it("ohne Zeile: null", () => {
    expect(ao.aktiverOverride("nur Text", KEY)).toBeNull();
  });
  it("gültige Zeile liefert den Grund", () => {
    expect(ao.aktiverOverride(text("x", `${KEY}: #5 Sitzung vor den Agenten`), KEY)).toBe("#5 Sitzung vor den Agenten");
  });
  it("Widerruf als jüngste Zeile: null", () => {
    expect(ao.aktiverOverride(text(`${KEY}: #5 a`, `${KEY}: #5 entfällt`), KEY)).toBeNull();
  });
  it("Override nach dem Widerruf gilt wieder", () => {
    expect(ao.aktiverOverride(text(`${KEY}: #5 a`, `${KEY}: #5 entfällt`, `${KEY}: #5 doch`), KEY)).toBe("#5 doch");
  });
  it("ungültige Zeile ohne #nr und Grund: null", () => {
    expect(ao.aktiverOverride(`${KEY}: einfach so`, KEY)).toBeNull();
  });
  it("Betreff-Präfix `* <key>:` zählt", () => {
    expect(ao.aktiverOverride(`* ${KEY}: #5 x`, KEY)).toBe("#5 x");
  });
});

describe("Widerruf eines Overrides: `<key>: #<nr> entfällt` (#1693 L47)", () => {
  const so2 = raw as unknown as {
    sliceOverride: (runGit: (a: string[]) => string, base: string, key: string) => { reason: string | null; invalid: string[] };
  };
  const KEY = Z.diffsizeOverride;
  const mit = (...nachrichten: string[]) => so2.sliceOverride(() => nachrichten.join("\n\n"), "base", KEY);

  it("ohne Widerruf zählt der Override (Gegenprobe)", () => {
    expect(mit(`${KEY}: #5 breit gewollt`).reason).toBe("#5 breit gewollt");
  });
  it("ein späterer Widerruf hebt den Override auf: kein Grund, nicht ungültig", () => {
    const r = mit(`${KEY}: #5 breit gewollt`, "fix", `${KEY}: #5 entfällt`);
    expect(r.reason).toBeNull();
    expect(r.invalid).toEqual([]);
  });
  it("die jüngste Zeile gilt: Override nach dem Widerruf gilt wieder", () => {
    expect(mit(`${KEY}: #5 a`, `${KEY}: #5 entfällt`, `${KEY}: #5 doch nötig`).reason).toBe("#5 doch nötig");
  });
  it("ein Widerruf vor dem Override gilt nicht (der Override ist jünger)", () => {
    expect(mit(`${KEY}: #5 entfällt`, `${KEY}: #5 echt`).reason).toBe("#5 echt");
  });
  it("nur das exakte Wort `entfällt` widerruft: ein Grund, der damit beginnt, bleibt ein Override", () => {
    expect(mit(`${KEY}: #5 a`, `${KEY}: #5 entfällt nicht, weil Merge`).reason).toBe("#5 entfällt nicht, weil Merge");
  });
  it("ein Widerruf ohne Override im Slice bleibt folgenlos", () => {
    expect(mit(`${KEY}: #5 entfällt`).reason).toBeNull();
  });
  it("der Hinweis der stale-Meldung nennt den Widerruf statt Historien-Umschreiben", () => {
    const t = so.staleOverrideHinweis(KEY, "der Diff liegt im Budget");
    expect(t).toContain(`${KEY}: #<nr> entfällt`);
    expect(t).not.toContain("umzuschreiben");
  });
});

describe("Gates ohne Projekt-Config (#1741): kein Standardwert, Exit 1 mit der Meldung des Laders", { timeout: 60_000 }, () => {
  it.each(["check-diffsize.mjs", "check-diffcoverage.mjs", "check-lockfile.mjs"])("%s", (skript) => {
    const dir = mkdtempSync(join(tmpdir(), "gate-ohne-config-"));
    try {
      // Kopie der Skripte ohne .factory/projekt.json: der Lader sucht die Config relativ zu seinem Ort.
      cpSync(join(__dirname, "..", "scripts"), join(dir, "scripts"), { recursive: true });
      const r = spawnSync(process.execPath, [join(dir, "scripts", skript)], { cwd: dir, encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Projekt-Config");
      expect(r.stderr).toContain("Fix:");
      expect(r.stderr).not.toMatch(/\n\s+at /); // saubere Meldung statt Stacktrace (try/catch in main)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("commitImSlice / loeseCommit (#1781 L5a): head im Slice an einer Stelle", () => {
  const BASE = "b".repeat(40);
  const IM_SLICE = "1".repeat(40);
  const MERGE = "2".repeat(40);
  const FIX = "3".repeat(40);
  /** Fake-git: `known` löst Refs auf, `slice` ist `<base>..HEAD`; Aufrufe werden mitgeschrieben. */
  const fake = (o: { known?: string[]; slice?: string[]; wirft?: boolean }) => {
    const aufrufe: string[] = [];
    const git = (args: string[]): string => {
      const cmd = args.join(" ");
      aufrufe.push(cmd);
      if (cmd.startsWith("rev-parse --verify --quiet")) {
        if (o.wirft) throw new Error("git kaputt");
        const ref = args[3].replace("^{commit}", "");
        return (o.known ?? []).includes(ref) ? `${ref}\n` : "";
      }
      if (cmd === `rev-list ${BASE}..HEAD`) return (o.slice ?? []).join("\n") + "\n";
      if (cmd === `rev-list --merges ${IM_SLICE}..HEAD`) return `${MERGE}\n`;
      if (cmd === `show --remerge-diff --format= ${MERGE}`) return "diff --cc datei\n";
      if (cmd === `rev-list --reverse --no-merges ${IM_SLICE}..HEAD ^${BASE}`) return `${FIX}\n`;
      if (cmd === `diff-tree --no-commit-id --name-only -r ${FIX}`) return "src/x.ts\n";
      throw new Error(`unerwarteter git-Aufruf: ${cmd}`);
    };
    return { git, aufrufe };
  };

  it("unbekannter Ref: nicht bekannt, nichts weiter gelesen", () => {
    const { git, aufrufe } = fake({ known: [], slice: [IM_SLICE] });
    expect(so.commitImSlice(git, BASE, "deadbee")).toEqual({ sha: null, bekannt: false, imSlice: false, konfliktMerges: [], aenderungsCommits: [] });
    expect(aufrufe).toHaveLength(1);
  });
  it("git-Fehler beim Auflösen zählt als unbekannt (kein Wurf)", () => {
    expect(so.loeseCommit(fake({ wirft: true }).git, "abc1234")).toBeNull();
    expect(so.commitImSlice(fake({ wirft: true }).git, BASE, "abc1234").bekannt).toBe(false);
  });
  it("bekannt, aber außerhalb des Slice: Merges und Änderungen werden nicht gelesen", () => {
    const { git, aufrufe } = fake({ known: [IM_SLICE], slice: [FIX] });
    const r = so.commitImSlice(git, BASE, IM_SLICE);
    expect(r).toEqual({ sha: IM_SLICE, bekannt: true, imSlice: false, konfliktMerges: [], aenderungsCommits: [] });
    expect(aufrufe.some((c) => c.includes("--merges") || c.startsWith("diff-tree"))).toBe(false);
  });
  it("im Slice: Konflikt-Merge und Änderungs-Commit nach dem Ref, der Kurz-Ref wird zum vollen SHA", () => {
    const { git } = fake({ known: ["1111111"], slice: [IM_SLICE, FIX] });
    const loese = (a: string[]) => (a[0] === "rev-parse" ? `${IM_SLICE}\n` : git(a));
    expect(so.commitImSlice(loese, BASE, "1111111")).toEqual({
      sha: IM_SLICE,
      bekannt: true,
      imSlice: true,
      konfliktMerges: [MERGE],
      aenderungsCommits: [{ sha: FIX, dateien: ["src/x.ts"] }],
    });
  });
  it("Teil-SHA ist kein Treffer im Slice (volle Gleichheit)", () => {
    const { git } = fake({ known: [IM_SLICE], slice: [IM_SLICE.slice(0, 7)] });
    expect(so.commitImSlice(git, BASE, IM_SLICE).imSlice).toBe(false);
  });
});
