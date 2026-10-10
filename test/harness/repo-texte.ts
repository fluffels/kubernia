/**
 * Gemeinsamer Scan-Helfer der Text-Wächter (#1526): welche versionierten Dateien gibt es, was steht drin, und wie baut
 * man aus mehreren Mustern einen sicheren Vorfilter.
 * Reiner Helfer ohne eigenen Test-Marker (Präzedenz `hook-importe.ts`); liegt in test/harness/, damit eine Änderung
 * an der Scan-Logik eine Audit-Spur hinterlässt.
 *
 * Warum geteilt: `harness-approval`, `stop-verify-hook` und `playwright-mcp` scannten je mit eigener Mechanik
 * (`git ls-files` oder `readdirSync`, auch Ungetracktes), und jeder Wächter las ~770 Dateien (8 MB) neu. Unter
 * Parallellast riss das den 5-s-Timeout (#1508, #1526). Hier wird die Dateiliste und jeder Inhalt je Testdatei
 * (Modul-Instanz) einmal geladen. Nur versionierte Dateien zählen: die CI scannt ohnehin nur Versioniertes.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";

// Begründete Ausnahme wie in test/harness/agents-refs.test.ts: das .mjs hat kein Declaration-File.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const listTrackedFiles: (rootDir?: string) => string[] = checkBasis.listTrackedFiles;

export const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

let dateienCache: string[] | undefined;
const inhaltCache = new Map<string, string>();

/** Alle versionierten Dateien (relativ, mit `/`), die auch auf der Platte liegen (gelöscht, aber noch im Index: nein). Einmal geladen. */
export function repoDateien(): string[] {
  dateienCache ??= listTrackedFiles(WURZEL).filter((f) => existsSync(WURZEL + f));
  return dateienCache;
}

/** Inhalt einer Datei (relativ zum Repo-Root), je Pfad einmal gelesen. */
export function lies(pfad: string): string {
  let text = inhaltCache.get(pfad);
  if (text === undefined) {
    text = readFileSync(WURZEL + pfad, "utf8");
    inhaltCache.set(pfad, text);
  }
  return text;
}

/**
 * Der Agenten-Kontext: Dateien, die ein Agent liest oder ausführt und in denen eine Anleitung stehen kann (Doku, Prompts,
 * Skills, Workflows, Hooks, Skripte, Wächter). Alle `*.md` überall (auch modul-lokale AGENTS.md), die Wurzeldateien und
 * die Harness-Ordner. Nicht dazu: Spiel-Code (`src/`), Spiel-Tests (`test/` außer `test/harness/`; Grenze wie `.github/protected-paths.json`), Assets, Lockfile.
 */
export const AGENTEN_KONTEXT = (pfad: string): boolean => {
  if (pfad === "package-lock.json") return false;
  return /\.md$/.test(pfad) || !pfad.includes("/") || /^(?:docs|\.claude|\.agents|\.github|\.githooks|scripts|test\/harness)\//.test(pfad);
};

/**
 * Warum lässt sich aus diesen Mustern KEINE Alternation bauen? Die Alternation über `source` verliert Flags und
 * nummeriert Gruppen um. Meldet abweichende Flags, Rückverweise (`\1`–`\9`, `\k<name>`) und Muster, die sich nicht
 * mit den Flags des ersten Musters bauen lassen. Leere Liste: kombinierbar.
 */
export function vorfilterProbleme(muster: readonly RegExp[]): string[] {
  const probleme: string[] = [];
  if (muster.length === 0) return ["keine Muster"];
  const flags = muster[0].flags;
  for (const m of muster) {
    // `g`/`y` machen `.test()` zustandsbehaftet (lastIndex): der Vorfilter könnte bei der nächsten Datei falsch-negativ werden.
    if (/[gy]/.test(m.flags)) probleme.push(`Flag g/y zustandsbehaftet: ${String(m)}`);
    if (m.flags !== flags) probleme.push(`Flags weichen ab: ${String(m)} (erwartet "${flags}")`);
    // Rückverweis nur, wenn der Backslash nicht selbst maskiert ist (gerade Zahl Backslashes davor).
    if (/(?<!\\)(?:\\\\)*\\(?:[1-9]|k<)/.test(m.source)) probleme.push(`Rückverweis im Muster: ${String(m)}`);
  }
  if (probleme.length === 0) {
    try {
      new RegExp(muster.map((m) => m.source).join("|"), flags);
    } catch (e) {
      probleme.push(`Alternation nicht baubar: ${(e as Error).message}`);
    }
  }
  return probleme;
}

/** Eine Alternation über alle Muster, oder `null`, wenn sie sich nicht sicher bauen lässt (dann alle Muster einzeln laufen lassen). */
export function baueVorfilter(muster: readonly RegExp[]): RegExp | null {
  if (vorfilterProbleme(muster).length > 0) return null;
  try {
    return new RegExp(muster.map((m) => m.source).join("|"), muster[0].flags);
  } catch {
    return null;
  }
}
