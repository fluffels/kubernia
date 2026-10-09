// Gemeinsame Bausteine der Mess-Skripte (token-baseline, subagent-laufzeit, hauptchat-zerlegung): Median und
// Cache-Pausen-Schwellen stehen genau einmal hier, damit die Skripte nicht auseinanderlaufen.

/** Median einer Zahlenliste (gerade Anzahl: Mittel der beiden mittleren), nicht endliche Werte ignoriert, `null` bei leerer Liste. */
export function median(werte) {
  const s = werte.filter((w) => Number.isFinite(w)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Cache-TTL-Schwellen in Millisekunden: 5 Minuten (Standard-Cache) und 1 Stunde (erweiterter Cache). */
export const CACHE_TTL_MS = Object.freeze({ fuenfMin: 5 * 60_000, eineStunde: 60 * 60_000 });
