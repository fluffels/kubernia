// Kein Shebang, kein Direktaufruf: Lib für `naechstes-ticket.mjs`, `ticket-lock.mjs`, `worktree-aufraeumen.mjs`, `claims-pruefen.mjs` und `subagent-laeufe.mjs` (Konvention #1398: Einstiegsskripte
// importieren nicht voneinander, gemeinsamer Code steht in einer Lib). Branch- und Worktree-Präfix kommen aus der Projekt-Config über `ticket-namen.mjs` (ADR 0022 F3):
// ohne übergebene `namen` wird die Config je Aufruf geladen, ein fehlender Schlüssel wirft (kein Standardwert).
import { ladeTicketNamen } from "./ticket-namen.mjs";

/** Ticketnummer aus einem Branch-, Worktree- oder Ref-Namen `<praefixe.branch><nr>-…` bzw. `…worktrees/<praefixe.worktree><nr>`; sonst null. Pur, wenn `namen` übergeben wird. */
export function ticketAusRef(text, namen = ladeTicketNamen()) {
  return namen.ticketAus(text);
}

/** Nummern, zu denen Branch, Worktree oder offener PR existieren. Pur, wenn `namen` übergeben wird. */
export function belegteNummern({ refs = [], worktrees = [], prHeads = [] }, namen = ladeTicketNamen()) {
  return new Set([...refs, ...worktrees, ...prHeads].map((t) => namen.ticketAus(t)).filter((n) => n !== null));
}

/**
 * Muster eines Lens-Worktree-Namens: `<praefixe.worktree><nr>-lens-r<runde>` (Lens-Runde) oder `<praefixe.worktree><nr>-lens-m<n>` (Merge-Delta-Lens nach einem
 * Konflikt-Merge von main, n = laufende Merge-Nummer) oder `<praefixe.worktree><nr>-lens-a<n>` (Delta-Lens nach einem Abnahme-Fix, n = laufende Nummer). Gruppe 1 ist `<praefixe.worktree><nr>`.
 */
export function lensWorktreeName(namen = ladeTicketNamen()) {
  return namen.lensWorktreeMuster;
}
