/* Rang-Aufstieg-Feier (#223) — der DOM-freie Kern.
 *
 * Die Präsentation (das mittige Feier-Overlay + Signalflaggen-Konfetti) sitzt in
 * `ui/hud.ts`; hier lebt nur die pure, unit-testbare Entscheidung, WAS gefeiert
 * wird, wenn mehrere Aufstiege aufliefen, während der Spieler noch beschäftigt war
 * (Terminal/Quiz/Dialog offen). Dann darf NICHT ein Popup je Aufstieg aufpoppen –
 * `mergeRankUp` faltet die aufgelaufenen Aufstiege zu EINEM „von → nach" zusammen.
 *
 * Bewusste Abgrenzung: das allgemeine Erfolgs-Feier-System mit Warteschlange und
 * Bündelung UNTERSCHIEDLICHER Erfolgs-Arten (Level-Up + Album-Eintrag + Abkürzung …)
 * ist #314. #223 ist nur der Rang-Aufstieg-Fall – ein einzelner „von → nach"-Slot.
 */

/** Anzeigedaten eines Rang-Aufstiegs: alter → neuer Rang (Icon + Name). */
export interface RankUpView {
  readonly fromIcon: string;
  readonly fromName: string;
  readonly toIcon: string;
  readonly toName: string;
}

/** Einen frischen Aufstieg in einen evtl. schon aufgelaufenen falten.
 *
 *  Läuft mehr als ein Aufstieg auf, bevor der Spieler wieder frei ist (er
 *  überspringt in einem Zug mehrere XP-Schwellen oder erledigt schnell mehrere
 *  belohnte Aktionen), zeigen wir am Ende EIN Popup: vom URSPRÜNGLICHEN Rang
 *  (wo er losstartete) zum ZULETZT erreichten. Also `from` des ältesten
 *  Aufstiegs behalten, `to` des neuesten übernehmen. */
export function mergeRankUp(pending: RankUpView | null, next: RankUpView): RankUpView {
  if (!pending) return next;
  return {
    fromIcon: pending.fromIcon,
    fromName: pending.fromName,
    toIcon: next.toIcon,
    toName: next.toName,
  };
}
