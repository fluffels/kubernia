/* ===== Freies Funken: „Was ist gerade passiert?"-Erklärungen (#362) =====
 * Pure Domäne (Phaser-frei, unit-testbar): wählt zu einer im freien Funken
 * ausgeführten Befehlszeile eine kurze, in der Spielwelt verankerte Einordnung.
 *
 * Der Erklär-Katalog selbst ist Content-as-Data (`src/content/data/funk-explain/*`,
 * geladen+validiert vom Loader); hier liegt nur die reine Auswahl-Mechanik. Bewusst
 * DOSIERT: nur bei einem echten Lernmoment (Befehl steht im Katalog) und nie zweimal
 * dieselbe Erklärung pro Sitzung – „nicht nach jeder Ausgabe", wie das Ticket fordert. */

/** Eine Erklärung in Laufzeit-Form: `match` sind verb-/befehlsweite RegExp (vom Loader
 *  aus String-Pattern kompiliert), `text` die In-World-Einordnung (HTML erlaubt: <code>). */
export interface FunkExplanation {
  id: string;
  match: RegExp[];
  text: string;
}

/** Wählt die passende Erklärung für eine Befehlszeile aus dem Katalog.
 *  Gibt die ERSTE Erklärung zurück, deren Muster die (whitespace-normalisierte) Zeile
 *  trifft und die in dieser Sitzung noch nicht gezeigt wurde (`shown`) – sonst null.
 *  Reihenfolge im Katalog ist damit die Priorität bei mehreren Treffern. */
export function pickFunkExplanation(
  line: string,
  catalog: FunkExplanation[],
  shown: Set<string>,
): FunkExplanation | null {
  const norm = line.trim().replace(/\s+/g, " ");
  if (!norm) return null;
  for (const e of catalog) {
    if (shown.has(e.id)) continue;
    if (e.match.some(re => re.test(norm))) return e;
  }
  return null;
}
