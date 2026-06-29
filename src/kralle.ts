/* Kralle-Meilenstein-Sprüche (#236). Kralle (die krallenlose Quiz-Krabbe) erwähnt an
 * bestimmten Gesamt-Übungszahlen, zum wievielten Mal man schon mit ihm geübt hat – das
 * macht das tägliche Üben persönlicher und belohnt Dranbleiben. Bewusst dosiert: nur an
 * Meilensteinen, nicht jede Runde. Pure Domäne (Zahl rein, Spruch oder null raus) und damit
 * unit-testbar; den Gesamtzähler führt die Anwendungsschicht (game/spaced-repetition.ts),
 * die DOM-Anzeige die Präsentation (ui/quiz.ts). */

/** Feste Meilenstein-Runden mit eigenem, zählbewusstem Spruch im Kralle-Ton (frech, maritim). */
const KRALLE_MILESTONE_LINES: Record<number, string> = {
  1: "Schnipp! Deine allererste Übungsrunde mit mir – willkommen am Stapel, Lotse. Das war erst der Anfang!",
  10: "Zehn Runden mit mir geübt – langsam wirst du zum Stammgast an meiner Bude. Schnipp-schnapp!",
  25: "Fünfundzwanzig Runden schon! Du bist kein Greenhorn mehr, Matrose – das hört man an jedem Befehl.",
  50: "Das war deine 50. Runde mit mir – schnipp, du wirst zur Legende der Hafenkrabben!",
  100: "100 Runden mit mir – einhundert! Ich häng dir eine Auszeichnung an die Schere, schnipp-schnapp-Hurra!",
};

/** Gibt für die `count`-te abgeschlossene Übungsrunde mit Kralle den Meilenstein-Spruch
 *  zurück – oder `null`, wenn `count` kein Meilenstein ist (Normalfall). An den festen
 *  Stufen (1/10/25/50/100) der jeweilige Spruch, danach jede weiteren 100 ein generischer.
 *  Defensiv: nicht-positive oder nicht-ganzzahlige Werte ergeben `null`. */
export function krallePracticeMilestone(count: number): string | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  if (count in KRALLE_MILESTONE_LINES) return KRALLE_MILESTONE_LINES[count];
  if (count > 100 && count % 100 === 0) {
    return `Schon ${count} Runden mit mir geübt – du bist nicht zu stoppen, Käpt'n! Schnipp!`;
  }
  return null;
}
