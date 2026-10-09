/* Gemeinsamer Messhelfer (#1561 Z1): Median und Cache-TTL-Schwellen stehen einmal in scripts/mess-lib.mjs. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/mess-lib.mjs";

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
  const B = raw as unknown as { bereinige: (t: string, o?: { wurzel?: string | null }) => string };
  const WURZEL = "C:/work/projekt";
  test("Home und Worktree-Präfix werden ersetzt, Backslashes zu Schrägstrichen", () => {
    expect(B.bereinige("C:/Users/Max/dev/x.ts")).toBe("~/dev/x.ts");
    expect(B.bereinige("C:\\Users\\Max\\dev\\x.ts")).toBe("~/dev/x.ts");
    expect(B.bereinige("cat /c/Users/Max/x.md")).toBe("cat ~/x.md");
    expect(B.bereinige("C:/work/projekt/.claude/worktrees/kq-1559/src/a.ts")).toBe("<wt>/src/a.ts");
    expect(B.bereinige("cd /c/work/projekt/.claude/worktrees/kq-1469 && ls")).toBe("cd <wt>/ && ls");
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
      expect(readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), "utf8")).not.toMatch(/dev\/kubernia/);
    }
  });
});
