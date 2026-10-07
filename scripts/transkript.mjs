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

/**
 * Jüngste Assistant-Nachricht mit einer `ERGEBNIS:`-Zeile (#1342): entweder die `message` eines
 * `SubagentHandback`-Aufrufs oder ein Text-Block. `null`, wenn es keine gibt.
 */
export function letzteErgebnisNachricht(zeilen) {
  const hatErgebnis = (t) => typeof t === "string" && /^[ \t]*ERGEBNIS:/im.test(t);
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const msg = zeilen[i]?.message ?? zeilen[i];
    if (msg?.role !== "assistant" && zeilen[i]?.type !== "assistant") continue;
    const c = msg?.content;
    const kandidaten = typeof c === "string" ? [c] : Array.isArray(c) ? c.map((b) => (b?.type === "text" ? b.text : b?.type === "tool_use" && b.name === "SubagentHandback" ? b.input?.message : null)) : [];
    for (let j = kandidaten.length - 1; j >= 0; j--) if (hatErgebnis(kandidaten[j])) return kandidaten[j];
  }
  return null;
}
