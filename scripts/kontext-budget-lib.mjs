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

/** Anteil des Budgets, unter dem der Rest als knapp gilt (factory#215 L12). */
export const KNAPP_ANTEIL = 0.05;

/**
 * Pur: die Kontextdateien, die noch im Budget liegen, deren Rest aber unter `anteil` des Budgets liegt, als `[{ file, chars, budget, rest }]`.
 * Über Budget zählt nicht (das meldet `ueberBudget`); `lies`/`ausnahmen` wie dort.
 */
export function knappeBudgets({ lies, budgets = CONTEXT_BUDGETS, ausnahmen = [], anteil = KNAPP_ANTEIL }) {
  const geduldet = new Set(ausnahmen.map((a) => a.datei));
  const treffer = [];
  for (const { file, budget } of budgets) {
    if (geduldet.has(file)) continue;
    const text = lies(file);
    if (text === null) continue;
    const chars = countChars(text);
    const rest = budget - chars;
    if (rest >= 0 && rest < budget * anteil) treffer.push({ file, chars, budget, rest });
  }
  return treffer;
}

/** Zeichen-Budget des Kern-Blocks von AGENTS.md (zwischen den Besitz-Markern `kern`, ohne den Projekt-Block): Ratchet auf den Ist-Wert, wächst nur bewusst per reviewtem Commit
 *  (factory#208 L19: der Kern wuchs zwischen zwei Tags um ~1,1k Zeichen und brachte einen Bezieher über sein Gesamtbudget). */
export const KERN_BLOCK_BUDGET = 14_987;

/** Raum, den der Kern jedem Bezieher außerhalb des Kern-Blocks in AGENTS.md lässt (Projekt-Block samt Projektwerten): `KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM` bleibt unter dem Budget von AGENTS.md
 *  (factory#177: ein Bezieher mit 12.309 Zeichen Rest, Stand 2026-11-06, sprengte mit dem Kern von 16.572 sein Gesamtbudget). Geeicht am größten gemessenen Rest plus rund 5 %; wächst ein Rest darüber, ist das ein Befund an den Bezieher.
 *  Grenze: gerechnet wird mit dem Kern der Fabrik; im Bezieher trägt der Kern zusätzlich die Projektwert-Tabelle (wenige Dutzend Zeichen mehr). */
export const PROJEKT_BLOCK_RAUM = 13_000;

/** Pur: Meldung, wenn Kern-Budget plus Projekt-Raum das Gesamtbudget von `AGENTS.md` übersteigt, sonst `null` (die Raum-Invariante, geprüft in `test/kern-block-budget.test.ts`). */
export function kernRaumBefund({ kern, raum, gesamt }) {
  if (kern + raum <= gesamt) return null;
  return `Kern-Budget ${kern} + Projekt-Raum ${raum} = ${kern + raum} > Gesamtbudget ${gesamt} von AGENTS.md: ein Bezieher mit Raum-großem Projekt-Block liefe nach dem Sync rot.`;
}

/** Zeichen des Blocks zwischen `marker.start` und `marker.ende` (zeilenenden-neutral) oder `null`, wenn ein Marker fehlt oder das Ende vor dem Start steht. Die Marker gibt der Aufrufer vor (`markerStart`/`markerEnde` aus `besitz-lib.mjs`), die Lib bleibt Blatt. */
export function kernBlockZeichen(text, { start, ende }) {
  const a = text.indexOf(start);
  const b = text.indexOf(ende);
  return a < 0 || b < a ? null : countChars(text.slice(a, b));
}

/** Pur: Meldung, wenn der Kern-Block das Budget überschreitet oder seine Marker fehlen (fail-closed); `null` sonst und immer außerhalb der Fabrik (im Bezieher gilt sein Gesamtbudget, der Kern kommt per Sync). `marker` = `{ start, ende }` (Pflicht). */
export function kernBlockBefund({ text, fabrik, budget = KERN_BLOCK_BUDGET, marker }) {
  if (!fabrik) return null;
  const chars = kernBlockZeichen(text, marker);
  if (chars === null) return `Kern-Block von AGENTS.md nicht messbar: Marker ${marker.start} und ${marker.ende} fehlen oder stehen verdreht.`;
  if (chars <= budget) return null;
  return `Kern-Block von AGENTS.md ${chars} Zeichen > Kern-Block-Budget ${budget}. Kern-Regeln kürzen oder auslagern; das Budget (KERN_BLOCK_BUDGET in scripts/kontext-budget-lib.mjs) wächst nur bewusst per reviewtem Commit.`;
}
