/* Overlay-Register (#505) — die EINE Datenquelle, welche Overlays es gibt.
 *
 * Vorher stand dieselbe Overlay-ID-Liste wortgleich an mehreren Stellen
 * (blocking/closeOverlays je 7 IDs, overlayKey bereits abweichend mit 5) plus
 * Einzel-Checks in main.ts — die Drift war real (overlayKey wich schon ab). Statt
 * jedes Overlay ad-hoc per hartkodierter ID zu behandeln, ist hier EINE Liste die
 * Wahrheit; `blocking`/`closeOverlays`/`overlayKey` (ui/overlay.ts) leiten daraus ab.
 * **Neues Overlay = ein Eintrag hier.** (Gleiches Muster wie REGION_CONFIGS.)
 *
 * Rein Daten, kein DOM/Phaser — darum unit-testbar; `test/overlays.test.ts` bindet
 * die Liste zusätzlich an die echten `#overlay-*`-Panels in index.html (Anti-Drift).
 *
 * Zwei Eigenschaften je Overlay:
 *  - `blocking`: zählt als „ein Modal ist offen" (sperrt Weltinteraktion) und wird von
 *    closeOverlays geschlossen. Aktuell alle — das Feld hält die Regel aber explizit,
 *    damit ein künftiges nicht-blockierendes Overlay sauber abbildbar ist.
 *  - `keyNav`: bekommt die generische Modal-Tastatur (#283, ↑/↓+Enter über die Buttons).
 *    Terminal (eigenes Eingabefeld) und Wissensrunde/review (eigener reviewKey-Handler)
 *    sind bewusst ausgenommen — sie bringen ihre eigene Tastatur-Logik mit.
 */

export interface OverlayDef {
  /** Semantischer Schlüssel für gezielte Einzel-Referenzen (z.B. OVERLAY_ID.review). */
  readonly key: string;
  /** DOM-Element-ID des Panels in index.html. */
  readonly id: string;
  /** Zählt als blockierendes Modal (sperrt Interaktion, wird von closeOverlays geschlossen). */
  readonly blocking: boolean;
  /** Bekommt die generische Modal-Tastatur-Navigation (#283). */
  readonly keyNav: boolean;
}

export const OVERLAYS = [
  { key: "terminal", id: "overlay-terminal", blocking: true, keyNav: false },
  { key: "quest", id: "overlay-quest", blocking: true, keyNav: true },
  { key: "album", id: "overlay-album", blocking: true, keyNav: true },
  { key: "shop", id: "overlay-shop", blocking: true, keyNav: true },
  { key: "review", id: "overlay-review", blocking: true, keyNav: false },
  { key: "stack", id: "overlay-stack", blocking: true, keyNav: true },
  { key: "menu", id: "overlay-menu", blocking: true, keyNav: true },
] as const satisfies readonly OverlayDef[];

export type OverlayKey = (typeof OVERLAYS)[number]["key"];

/** IDs der blockierenden Overlays — für blocking()/closeOverlays(). */
export const BLOCKING_OVERLAY_IDS: readonly string[] = OVERLAYS.filter(o => o.blocking).map(o => o.id);

/** IDs der Overlays mit generischer Tastatur-Navigation — für overlayKey(). */
export const KEYNAV_OVERLAY_IDS: readonly string[] = OVERLAYS.filter(o => o.keyNav).map(o => o.id);

/** Schlüssel→ID-Nachschlage für gezielte Einzel-Checks (statt hartkodierter Strings). */
export const OVERLAY_ID = Object.fromEntries(OVERLAYS.map(o => [o.key, o.id])) as Record<OverlayKey, string>;
