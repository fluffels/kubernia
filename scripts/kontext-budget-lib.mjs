// Blatt-Modul (nur Node-Builtins) und Lib ohne Direktaufruf-Guard; `check-context-size.mjs` und `factory-sync.mjs` importieren sie (Konvention #1398: Einstiege importieren nicht voneinander).
/* Kontext-Budget (SSOT): Zeichen-Budget je Root-Kontextdatei und die Zählung. `check-context-size.mjs` misst damit das Repo, `factory-sync.mjs` warnt damit
 * im Trockenlauf und beim Sync, bevor der Sync-PR im Ziel rot wird. Grenze: es gilt das Budget des ausführenden Werkzeugs (Checklisten-Trockenlauf: das der Quelle;
 * eigenes Werkzeug des Beziehers: sein altes); ändert der neue Tag das Budget, stimmt der Hinweis dort erst nach dem Sync. Alles pur, nur Builtins. */

/** Zeichen-Budget je Root-Kontextdatei (repo-relativer Pfad, #1064). Kalibriert am Bestand
 *  bei der Umstellung von Zeilen auf Zeichen (AGENTS.md 73.612, CLAUDE.md 18.068 Zeichen) +
 *  kleine Kopffreiheit. Das ist KEIN Aufweichen: das alte Zeilen-Budget hat die Größe nie
 *  gemessen. Im zweiten #1064-Slice wurde AGENTS.md auf ~24k Zeichen gekürzt
 *  (Langbegründung nach Factory-Seite docs/agent-harness.md §3a) und das Budget auf 28.000 gezogen
 *  (Ist + ~15 %, wie beim ersten Kalibrieren; Ratchet nach unten). Mit #1078 (Slice A1) sind
 *  die Nachschlage-Tabellen der CLAUDE.md on-demand nach docs/referenz/ gezogen; seit #1087 ist
 *  CLAUDE.md gelöscht (AGENTS.md wird nativ geladen) und ihr Eintrag entfallen – dass sie nicht
 *  zurückkehrt, bewacht (im Factory-Repo) test/harness/agents-md-native.test.ts.
 *  Weitere immer geladene Dateien (z.B. README) können hier bei Bedarf ergänzt werden. */
export const CONTEXT_BUDGETS = [
  { file: "AGENTS.md", budget: 28_000 },
];

/** Zeichen eines Textes, zeilenenden-neutral (CRLF zählt wie LF). */
export function countChars(text) {
  return text.replace(/\r/g, "").length;
}

/**
 * Pur: die Kontextdateien aus `budgets`, die über ihrem Budget liegen, als `[{ file, chars, budget }]`. `lies(datei)` liefert den Text oder `null` (fehlt: zählt nicht);
 * `ausnahmen` = geduldete Dateien (`ausnahmen.kontext` der Projekt-Config, `[{ datei }]`), die nie gemeldet werden.
 */
export function ueberBudget({ lies, budgets = CONTEXT_BUDGETS, ausnahmen = [] }) {
  const geduldet = new Set(ausnahmen.map((a) => a.datei));
  const treffer = [];
  for (const { file, budget } of budgets) {
    if (geduldet.has(file)) continue;
    const text = lies(file);
    const chars = text === null ? 0 : countChars(text);
    if (chars > budget) treffer.push({ file, chars, budget });
  }
  return treffer;
}
