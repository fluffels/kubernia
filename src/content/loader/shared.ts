/* ===== Inhalte: generische Loader-Bausteine (#517) =====
 * Vor dem Split wiederholte `loader.ts` für JEDE Glob-Sammlung (Quests, Befehls-
 * Karten, Quiz, Terraform-Konfigs, Funk-Erklärungen) dasselbe Quartett:
 *   parseOne* → parse* (eine Datei) → assemble* (Dateien zusammenführen) → get* (glob).
 * Die `assemble*` waren bis auf die Fehlermeldung identisch (Duplikat-ID-Prüfung),
 * die `get*` bis aufs Detail gleich (glob → nach Pfad sortieren → parsen → assemble).
 * Jede neue Sammlung kostete so ~55 Zeilen Boilerplate — bei Stardew-Scope (viele
 * Regionen/Themen/Tools) reproduziert sich das immer weiter. Diese drei Helfer
 * bündeln das gemeinsame Skelett; jede Sammlung liefert nur noch ihren eigenen
 * `parse*`-Reviver und (für die Fehlermeldung) ihre Benennung.
 *
 * Leaf-Modul: hängt nur an `./parse` (den geteilten Primitiven) — keine Zyklen,
 * Phaser-frei, im Node-Test prüfbar.
 */
import { fail, memo, asArray, asNonEmptyString } from "../parse";

/** Ein eager `import.meta.glob`-Ergebnis: Pfad → Modul mit `default`-Export (das rohe JSON). */
export type GlobModules = Record<string, { default: unknown }>;

/** Glob-Module deterministisch nach Pfad sortieren und jede Datei durch ihren `parseList`
 *  jagen. Die Datei-/Glob-Reihenfolge ist bewusst stabil (localeCompare), damit der Aufbau
 *  reproduzierbar ist; wo eine INHALTLICHE Reihenfolge load-bearing ist (Quests: `questIdx`),
 *  stellt der Aufrufer sie separat her (quest-order.json), nicht über diese Sortierung. */
export function loadGroups<T>(
  modules: GlobModules,
  parseList: (raw: unknown, where: string) => T[],
): T[][] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, mod]) => parseList(mod.default, path));
}

/** Führt die pro-Datei-Gruppen zu EINER Sammlung zusammen und prüft auf doppelte `id`
 *  über die Dateien hinweg. Reihenfolge bleibt erhalten (erste Datei zuerst). Eine
 *  Dublette ist Pflichtverstoß: die `id` ist referenziert (bzw. im Spielstand persistiert),
 *  zwei gleiche IDs würden kollidieren. `collection` benennt die Sammlung im Fehlerpfad,
 *  `unit` das Element (z.B. „Karten-ID") und `across` die Aufteilungsachse (z.B.
 *  „Geber-Dateien") — so bleibt die Meldung so sprechend wie die früheren Einzel-Assembler. */
export function assembleUnique<T extends { id: string }>(
  groups: T[][],
  collection: string,
  unit: string,
  across = "Dateien",
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) fail(collection, `doppelte ${unit} „${item.id}" (über ${across} hinweg)`);
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Baut einen lazy-memoisierten Glob-Loader (#435): glob → sortieren+parsen (`loadGroups`)
 *  → zusammenführen (`assemble`), Ergebnis beim ersten Zugriff gecacht. Deckt jede Sammlung
 *  OHNE load-bearing Reihenfolge ab (Befehls-Karten/Quiz/Terraform-Konfigs/Funk-Erklärungen);
 *  die Quests brauchen zusätzlich quest-order.json und bleiben ein eigener Getter. */
export function makeGlobLoader<T>(
  modules: GlobModules,
  parseList: (raw: unknown, where: string) => T[],
  assemble: (groups: T[][]) => T[],
): () => T[] {
  return memo(() => assemble(loadGroups(modules, parseList)));
}

/** `accept`-Pattern (Strings aus der JSON) zu `RegExp` kompilieren. Von Quests, Befehls-
 *  Karten und Funk-Erklärungen genutzt (alle tragen String-Pattern in der JSON). */
export function reviveAccept(v: unknown, path: string): RegExp[] {
  const arr = asArray(v, path);
  if (arr.length === 0) fail(path, "nicht-leeres accept-Array erwartet");
  return arr.map((s, i) => {
    const src = asNonEmptyString(s, `${path}[${i}]`);
    try {
      return new RegExp(src);
    } catch {
      return fail(`${path}[${i}]`, `ungültiges RegExp-Pattern: ${src}`);
    }
  });
}
