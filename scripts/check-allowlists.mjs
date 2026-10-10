// Kein Shebang, kein Direktaufruf: Lib der Gate-Skripte (#1579, Konvention #1398). Die Druckventile von check:size und check:contextsize
// stehen hier, damit check-doc-tickets sie lesen kann, ohne aus einem Gate-Einstieg zu importieren; der Glob /scripts/check-*.mjs hält
// die Datei als Gate-Code geschützt (eine neue Ausnahme ist eine reviewte Änderung mit offenem Ticket, AGENTS.md › Kein Grün-durch-Aufweichen).
/**
 * Ausnahme-Listen der Größen-Gates: `SIZE_ALLOWLIST` (check-size.mjs, `src`-Module über dem Zeilenbudget) und `CONTEXT_ALLOWLIST`
 * (check-context-size.mjs, AGENTS.md über dem Zeichenbudget). Jede Ausnahme nennt ein offenes Ticket (check:doctickets prüft das).
 */

/** Bewusst geduldete Ausnahmen: Datei (repo-relativ, POSIX) → Grund mit Tracking-Ticket.
 *  „Kein Grün-durch-Aufweichen": jede Ausnahme MUSS ein offenes Split-Ticket nennen.
 *  Fällt die Datei unter Budget (Split erledigt), meldet der Wächter den Eintrag als
 *  stale und schlägt fehl – das erinnert daran, die Ausnahme wieder zu entfernen. */
export const SIZE_ALLOWLIST = [
  // sim.ts liegt über dem Budget; der Split ist als #893 offen (Kern nach sim/core.ts
  // auslagern, Ziel: unter 800 LOC). #864 (Builder-Registry) hat die Datei geringfügig
  // vergrößert, aber den Erweiterungs-Aufwand für neue Ressourcentypen auf 1 Eintrag reduziert.
  { file: 'src/sim.ts', reason: '#893 (Split offen): sim.ts entflechten, God-File von der Allowlist.' },
]

/** Bewusst geduldete Ausnahmen: Datei → Grund mit offenem Tracking-Ticket (bei Harness-Befunden zählt das
 *  ungeclaimte Sammelticket samt Zeile als offenes Ticket; sein PR löst den Eintrag wieder auf). Gleiche
 *  Ratchet-Philosophie wie SIZE_ALLOWLIST (#390) – kein Grün-durch-Aufweichen
 *  des Budgets selbst, nur eine begründete Einzelfall-Ausnahme. Fällt die Datei wieder
 *  unter ihr Budget, meldet der Wächter den Eintrag als stale. */
export const CONTEXT_ALLOWLIST = [];
