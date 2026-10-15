/* ===== Tastenhinweise folgen der Belegung (#1553) – pur, Phaser-/DOM-frei =====
 *
 * Texte, die eine umbelegbare Taste nennen (Reden, Funkgerät, …), tragen ein Token
 * `{taste:<aktion>}` statt eines festen Buchstabens; hier wird es durch die gerade
 * belegte Taste ersetzt. Das Token liefert nur den Buchstaben (kein HTML): ein `<b>`
 * schreibt der Text selbst. Unbekannte Token bleiben wörtlich stehen (der Wächter in
 * `test/content.test.ts` fängt sie).
 */
import { BINDABLE_ACTIONS, type BindableAction, type Keybindings } from "../core/keybindings";

/** Token-Muster `{taste:<aktion>}` (Aktion = Kleinbuchstaben, Gültigkeit prüft `fillKeyTokens`). */
export const KEY_TOKEN = /\{taste:([a-z]+)\}/g;

/** Die belegte Taste einer Aktion, groß geschrieben (z.B. „F“). */
export function keyLabel(keys: Keybindings, action: BindableAction): string {
  return keys[action].toUpperCase();
}

/** Alle in `text` genannten Token-Aktionsnamen (auch ungültige, für den Wächter). */
export function keyTokenActions(text: string): string[] {
  return [...text.matchAll(KEY_TOKEN)].map(m => m[1]);
}

/** Ersetzt jedes bekannte Token durch den belegten Buchstaben; Unbekanntes bleibt stehen. */
export function fillKeyTokens(text: string, keys: Keybindings): string {
  return text.replace(KEY_TOKEN, (whole, a: string) =>
    (BINDABLE_ACTIONS as readonly string[]).includes(a) ? keyLabel(keys, a as BindableAction) : whole);
}

/** UI-Texte mit belegbarer Taste (HUD, Logbuch, Innenraum). */
export const TASTEN_HINWEISE = {
  funkAufgabe: "💻 Terminal öffnen (<b>{taste:radio}</b>)!",
  funkLogbuch: "💻 Öffne dein Terminal (<b>{taste:radio}</b>) und erledige die Aufgaben.",
  uebenNachAusbildung: "🏅 Grundausbildung geschafft! Halte den Hafen am Laufen – und übe bei der Crew ({taste:talk} → Üben).",
  naehe: "<b>{taste:talk}</b> – ",
  innenAnLand: "{taste:talk} – an Land   ·   ↓ Gangway",
  innenAnsDeck: "{taste:talk} – ans Deck",
  innenHinaus: "{taste:talk} – Hinausgehen   ·   ↓ durch die Tür",
  innenReden: "{taste:talk} – reden",
} as const;

export type TastenHinweisId = keyof typeof TASTEN_HINWEISE;

/** Rendert einen Tabellen-Hinweis mit der aktuellen Belegung. */
export function tastenHinweis(id: TastenHinweisId, keys: Keybindings): string {
  return fillKeyTokens(TASTEN_HINWEISE[id], keys);
}
