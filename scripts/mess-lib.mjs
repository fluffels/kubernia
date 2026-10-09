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

const zahl = (x) => (Number.isFinite(x) ? x : 0);

/** Kontextgröße eines Calls: Input plus Cache-Write plus Cache-Read (fehlende Felder zählen 0). */
export function kontextVon(c) {
  return zahl(c.input) + zahl(c.cacheWrite) + zahl(c.cacheRead);
}

/**
 * Cache-Neuaufbau eines Calls (#1309, #1572): die Pause seit dem Vorgänger derselben Konversation liegt über der TTL
 * (`pauseMs`) UND der Cache-Read unter der Hälfte des Kontexts (der Prefix wurde neu geschrieben, nicht gelesen).
 * Ein Kontext von 0 zählt nie. Das Prädikat steht hier einmal; `countCacheRebuilds` und der Kontext-Treiber nutzen es.
 */
export function istNeuaufbau({ gapMs, pauseMs, call }) {
  const kontext = kontextVon(call);
  return gapMs > pauseMs && kontext > 0 && zahl(call.cacheRead) < kontext / 2;
}
