// Kein Shebang, kein Direktaufruf: Lib für `naechstes-ticket.mjs`, `ticket-lock.mjs`, `cleanup-worktrees.mjs` und `lens-edit-guard.mjs` (#1572, #1579, Konvention #1398: Einstiegsskripte
// importieren nicht voneinander, gemeinsamer Code steht in einer Lib). Rein, ohne Importe.

/** Ticketnummer aus einem Branch-, Worktree- oder Ref-Namen `…feature/kq-<nr>-…` bzw. `…worktrees/kq-<nr>`; sonst null. Pur. */
export function ticketAusRef(text) {
  const m = /(?:feature\/kq-|worktrees[\\/]kq-)(\d+)(?=$|[-/\\\s])/.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** Nummern, zu denen Branch, Worktree oder offener PR existieren. Pur. */
export function belegteNummern({ refs = [], worktrees = [], prHeads = [] }) {
  return new Set([...refs, ...worktrees, ...prHeads].map(ticketAusRef).filter((n) => n !== null));
}

/**
 * Name eines Lens-Worktrees (SSOT für lens-edit-guard und worktree-aufraeumen): `kq-<nr>-lens-r<runde>` (Lens-Runde) oder
 * `kq-<nr>-lens-m<n>` (Merge-Delta-Lens nach einem Konflikt-Merge von main, n = laufende Merge-Nummer). Gruppe 1 ist `kq-<nr>`.
 */
export const LENS_NAME_KERN = String.raw`(kq-\d+)-lens-[rm]\d+`;
export const LENS_WORKTREE_NAME = new RegExp(`^${LENS_NAME_KERN}$`);
