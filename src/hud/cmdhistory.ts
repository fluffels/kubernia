/* ===== Befehlshistorie fürs Funkgerät-Terminal (#316) – Phaser-/DOM-frei, pur testbar =====
 * Wie in einer echten Shell holt man mit ↑/↓ vorherige Befehle zurück. Die reine
 * Navigations-Mathematik liegt hier (wie overlaykbd.ts fürs Modal-Keyboard): die DOM-
 * Anbindung (Eingabefeld, ↑/↓-Tasten) ist dünn in ui/radio.ts + main.ts. So ist das
 * Shell-Verhalten im Node-Test prüfbar, statt in der Präsentation zu stecken.
 *
 * Cursor-Modell (bash-nah): `index` läuft über [0 .. history.length].
 *   - index == history.length  → „neuer Entwurf" (leere Zeile), Text "".
 *   - index <  history.length  → history[index] (0 = ältester, length-1 = neuester).
 * ↑ (dir -1) geht zu älteren Einträgen (Richtung 0, dort geklemmt), ↓ (dir +1) zurück
 * Richtung Entwurf (bei length geklemmt). Nach dem Absenden steht der Cursor wieder am
 * Entwurf (index == length), sodass ↑ den gerade getippten Befehl zurückholt.
 */

/** Begrenzung der gespeicherten Befehle – genug für eine Sitzung, ohne unbegrenzt zu wachsen. */
export const CMD_HISTORY_MAX = 50;

/** Hängt eine abgesendete Zeile an die Historie an (gibt eine NEUE Liste zurück, pur).
 *  Shell-Manier: leere/whitespace-Zeilen werden nicht gespeichert, und eine Zeile, die
 *  mit dem zuletzt gespeicherten Befehl identisch ist, wird übersprungen (ignoredups) –
 *  so füllt mehrfaches Wiederholen die Historie nicht mit Dubletten. Länger als `max`
 *  wird vorne (ältester Eintrag) gekappt. */
export function pushHistory(history: readonly string[], line: string, max = CMD_HISTORY_MAX): string[] {
  const trimmed = line.trim();
  if (!trimmed) return history.slice();
  if (history.length > 0 && history[history.length - 1] === trimmed) return history.slice();
  const next = history.concat(trimmed);
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Ergebnis eines Navigationsschritts: neuer Cursor-Index + der dort anzuzeigende Text. */
export interface HistoryNav {
  index: number;
  text: string;
}

/** Ein ↑/↓-Schritt durch die Historie. `dir` = -1 (↑, älter) oder +1 (↓, neuer/Entwurf).
 *  `index` wird zunächst defensiv auf [0..length] geklemmt, dann um `dir` bewegt und erneut
 *  geklemmt. Liefert den neuen Index und den Text dazu ("" am Entwurfs-Ende). Bei leerer
 *  Historie bleibt der Cursor bei 0 und der Text leer (No-op). */
export function navigateHistory(history: readonly string[], index: number, dir: -1 | 1): HistoryNav {
  const len = history.length;
  const cur = Math.max(0, Math.min(index, len));
  const next = Math.max(0, Math.min(cur + dir, len));
  return { index: next, text: next < len ? history[next]! : "" };
}
