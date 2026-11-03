// Blatt-Modul: nur Builtins, keine Imports; die Doctor-Module importieren es direkt.
/* Ergebnis-Form der Doctor-Punkte (SSOT): `gut`, `luecke`, `nichtPruefbar`, `ausFehler`. Optionale Felder (`link`, `aktion`, `hinweis`)
 * fehlen im Ergebnis, wenn sie nicht gesetzt sind; modulspezifische Standardwerte setzt der Aufrufer. */

export const gut = (punkt, hinweis) => ({ punkt, ok: true, ...(hinweis ? { hinweis } : {}) });
export const luecke = (punkt, befund, fix, link, aktion) => ({ punkt, ok: false, befund, fix, ...(link ? { link } : {}), ...(aktion ? { aktion } : {}) });
/** Ein nicht prüfbarer Punkt: `ok: false` ohne belegte Lücke (der Zustand ist unbekannt). */
export const nichtPruefbar = (punkt, grund, fix, link) => ({ punkt, ok: false, nichtPruefbar: true, befund: grund, fix, ...(link ? { link } : {}) });
/** Nicht prüfbar, weil die Quelle selbst fehlschlug; `quelle.fix` hat Vorrang vor `standardFix`. */
export const ausFehler = (punkt, was, quelle, standardFix, link) => nichtPruefbar(punkt, `${was} nicht lesbar (${quelle.fehler})`, quelle.fix ?? standardFix, link);
