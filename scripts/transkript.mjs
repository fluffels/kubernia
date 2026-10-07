// Kein Shebang: wird von den Messskripten, vom Stop-Hook-Baustein und von Tests importiert.
/**
 * Neutrales Transkript-Lesen (#1331): drei Verbraucher teilen es (`brain-metrics.mjs`, `token-baseline.mjs`,
 * `umsetzer-abschluss.mjs`), darum steht es in keinem von ihnen. Reines Node-Skript ohne Abhängigkeiten.
 */

/** Transkript-JSONL → geparste Zeilen (leere und abgeschnittene Zeilen entfallen). Einmal parsen, dann an die Adapter reichen. */
export function transkriptZeilen(jsonlText) {
  const rows = [];
  for (const line of String(jsonlText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // abgeschnittene letzte Zeile eines laufenden Transkripts
    }
  }
  return rows;
}

/** Text einer Assistant-Zeile (String-Inhalt oder die Text-Blöcke); leer ohne Text. */
export function assistantText(row) {
  const msg = row?.message ?? row;
  if (msg?.role !== "assistant" && row?.type !== "assistant") return "";
  const c = msg?.content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";
}
