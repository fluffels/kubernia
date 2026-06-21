// Dauer-Politik der Toasts (#370). Pure Domäne (kein DOM/Phaser), damit die
// Lesbarkeits-Regeln im Node-Test prüfbar sind; die DOM-Umsetzung steht in
// src/ui/hud.ts. Hintergrund: Toasts hatten eine hartkodierte Standzeit von
// 4,2 s und faden per CSS schon nach 3,4 s weg – echte Hinweise (Befehlstipps,
// Erklärungen) blitzten so nur kurz auf und waren nicht zu Ende lesbar.

/** Standard-Standzeit eines Toasts in ms: kurze Belohnungen/Bestätigungen
 *  (+XP/+Dublonen, „gespeichert"). Bewusst flüchtig, damit sie bei viel
 *  Aktivität nicht den Bildschirmrand zustellen. */
export const TOAST_LIFE_MS = 4200;

/** Mindest-Standzeit eines Hinweis-Toasts in ms: Tipps/Erklärungen, die der
 *  Spieler wirklich lesen (und ggf. befolgen) soll, bleiben >= 15 s stehen –
 *  das Akzeptanzkriterium aus #370 („kein flüchtiges Aufblitzen mehr"). */
export const HINT_LIFE_MS = 15000;

/** Dauer der CSS-Fade-out-Animation (.toast → toast-out in style.css) in ms.
 *  Muss zur dortigen Animationsdauer passen, damit der Fade exakt beim
 *  Entfernen endet. */
export const TOAST_FADE_MS = 400;

/** Verzögerung (in Sekunden) bis der Fade-out startet, abgeleitet aus der
 *  Lebensdauer: JS-Auto-Remove und CSS-Fade kommen so aus EINER Quelle – der
 *  Fade endet genau dann, wenn das Element entfernt wird. Wird als
 *  `--toast-fade-delay` an das Toast-Element gesetzt. Nie negativ: ist die
 *  Lebensdauer kürzer als die Fade-Animation, faded der Toast eben sofort. */
export function toastFadeDelaySeconds(lifeMs: number): number {
  return Math.max(0, lifeMs - TOAST_FADE_MS) / 1000;
}
