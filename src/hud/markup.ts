// #311 – Variable Platzhalter in Beispielbefehlen app-weit einheitlich als „ändere-mich"-
// Wert kennzeichnen. Dies ist die EINE Quelle der Konvention + Mechanik (kein doppelter
// Pflegeaufwand): festgelegt einmal hier, angewandt an der Render-Grenze aller Content-
// Texte (Funkgerät, Dialoge, Hinweise, Drills, Quiz, Erklärungen, Logbuch, Album).
//
// Konvention (app-weit):
//   Einen variablen Wert schreibt man im Content als `<token>` in spitzen Klammern – die
//   universelle CLI-„ersetz-mich"-Schreibweise. Beispiele:
//     docker pull <image>
//     docker run -d --name <eigener-name> <image>
//     kubectl describe pod <name>
//   `token` ist ein einzelnes Wort aus Buchstaben (inkl. Umlauten), Ziffern und Bindestrichen.
//
//   `fmtCmd` wandelt jeden solchen Platzhalter beim Rendern in ein sichtbares, farbig
//   abgesetztes Badge (CSS-Klasse `.ph`, siehe style.css). Die spitzen Klammern bleiben
//   BEWUSST sichtbar (Maintainerin-Entscheid #311, nah an der echten CLI-Doku), klar
//   unterscheidbar von festen Befehlen/Flags, die als `<code>` cyan-monospace erscheinen.
//   Echte HTML-Tags im Content (`<code>`, `<b>`, `<i>` …) bleiben unangetastet – die Texte
//   tragen bewusst Anzeige-HTML.
//
// Warum das nötig ist: Alle diese Texte werden per `innerHTML` gerendert. Ein bare
// `<image>`/`<datei>` galt dem Browser bislang als (unbekanntes) HTML-Element und
// verschwand unsichtbar – genau diese Platzhalter macht `fmtCmd` jetzt sichtbar. (Ersetzt
// die früheren Einzel-Wächter #320/#458, die bare Platzhalter nur punktuell VERBOTEN hatten,
// statt sie zentral darzustellen.)
//
// Reine Domäne: string→string, Phaser-/DOM-frei und damit im Node-Test prüfbar.

/**
 * Echte HTML-Tags, die im Content als Anzeige-Markup vorkommen und darum KEINE
 * Platzhalter sind. Einzige Quelle der Wahrheit für die Allowlist – auch der
 * Content-Wächter-Test (content.test.ts) teilt sie sich hierüber, statt sie zu duplizieren.
 */
export const CONTENT_HTML_TAGS: ReadonlySet<string> = new Set([
  "code", "b", "i", "em", "strong", "br", "span", "u", "small", "sub", "sup", "s",
]);

// Ein Platzhalter ist ein einzelnes Wort in spitzen Klammern: `<name>`, `<eigener-name>`,
// `<schlüssel>`. Bewusst KEIN „/" in der Wortklasse (schließende Tags `</code>` und Pfade
// wie `deployment/<name>` matchen dadurch nicht als Ganzes) und KEINE Leerzeichen (Tags mit
// Attributen `<a href="…">` matchen nicht). Der erste Zeichen muss ein Buchstabe sein –
// so matchen Git-Konfliktmarker `<<<<<<<` (nach `<` folgt `<`) und `<3` nicht.
const PLACEHOLDER = /<([A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß-]*)>/g;

/**
 * Wandelt Platzhalter `<token>` im Content-Text in ein sichtbares `.ph`-Badge (spitze
 * Klammern bleiben sichtbar). Echte HTML-Tags (`CONTENT_HTML_TAGS`) und alles andere
 * bleiben unverändert. Idempotent: ein zweiter Lauf ändert nichts mehr, weil das Badge
 * die Klammern als Entities (`&lt;…&gt;`) trägt und `<span …>` ein Attribut (Leerzeichen) hat.
 */
export function fmtCmd(text: string): string {
  return text.replace(PLACEHOLDER, (whole, word: string) =>
    CONTENT_HTML_TAGS.has(word.toLowerCase())
      ? whole
      : `<span class="ph">&lt;${word}&gt;</span>`,
  );
}
