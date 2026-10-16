/** HTML-Escape für Text- und Attributkontext (`"` und `'` auch, sonst bricht ein Wert aus `data-arg="…"` aus). Pur, ohne DOM. */
export function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
