// Kein Shebang, kein Direktaufruf: Lib für `naechstes-ticket.mjs` und `ticket-lock.mjs` (#1572, Konvention #1398: Einstiegsskripte
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
