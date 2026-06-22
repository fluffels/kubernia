/* ===== Inhalte: Glossar zentraler Begriffe (#226) =====
 * Eine Quelle für die Kurz-Definitionen wiederkehrender Schlüsselbegriffe
 * (Registry, Image, Tag, …). Im Lerntext markiert man einen Begriff mit
 * `[[Registry]]` (oder `[[Images|image]]`, wenn die Anzeige flektiert ist und
 * vom Glossar-Schlüssel abweicht). `applyGlossary` macht daraus beim Rendern
 * einen unaufdringlichen Hover-Chip mit 1-Satz-Auffrischung – Vorwissen wird
 * so nicht mehr vorausgesetzt, der Lesefluss aber nicht gestört.
 *
 * Phaser-frei und rein → in test/ unit-getestet (siehe content.test.ts).
 */

export interface GlossEntry { begriff: string; def: string; }

/** Schlüssel sind klein geschrieben; der Marker wird case-insensitiv aufgelöst. */
export const GLOSSARY: Record<string, GlossEntry> = {
  registry: { begriff: "Registry", def: "Ein Online-Lager für fertige Images – der „Supermarkt“, aus dem docker pull lädt (z.B. Docker Hub)." },
  image:    { begriff: "Image",    def: "Der unveränderliche Bauplan einer App mit allem Drumherum; aus einem Image startest du Container." },
  container:{ begriff: "Container", def: "Eine laufende Instanz eines Images – die Kiste im Betrieb; aus einem Image kannst du viele starten." },
  tag:      { begriff: "Tag",      def: "Ein Name/Zeiger auf ein bestimmtes Image (z.B. :1.0, :latest) – keine Kopie und keine eigene Version." },
  cache:    { begriff: "Cache",    def: "Zwischengespeicherte, unveränderte Image-Schichten, die beim Bauen wiederverwendet werden und Zeit sparen." },
  build:    { begriff: "Build",    def: "Aus einem Dockerfile ein eigenes Image schichten (docker build) – anders als pull, das nur Fertiges holt." },
  busybox:  { begriff: "BusyBox",  def: "Ein winziges Image, das viele kleine Unix-Werkzeuge (ls, cat, wget …) in einer einzigen Datei bündelt – die handliche Allzweck-Kiste, oft für schnelle Tests und zum Reinschauen gestartet." },
};

/** Marker-Syntax im Lerntext: `[[Anzeige]]` oder `[[Anzeige|schlüssel]]`. */
const MARKER = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

/** Für sicheres Einsetzen in das title="…"-Attribut. */
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Den Glossar-Schlüssel eines Markers bestimmen (Anzeige oder explizit nach `|`). */
function markerKey(shown: string, explicitKey?: string): string {
  return (explicitKey ?? shown).trim().toLowerCase();
}

/**
 * Ersetzt alle `[[…]]`-Marker durch Hover-Chips. Unbekannte Schlüssel werden
 * NICHT als rohe `[[ ]]` durchgereicht, sondern fallen auf den reinen
 * Anzeigetext zurück (der Spieler sieht nie kaputte Marker). Dass ein Marker
 * auf einen echten Glossar-Eintrag zeigt, sichert der Konsistenz-Test ab.
 */
export function applyGlossary(text: string): string {
  return text.replace(MARKER, (_m, shown: string, explicitKey?: string) => {
    const display = shown.trim();
    const entry = GLOSSARY[markerKey(shown, explicitKey)];
    if (!entry) return display;
    return `<span class="gloss" title="${escAttr(entry.def)}">${display}</span>`;
  });
}

/** Liefert die Glossar-Schlüssel aller Marker eines Textes (für Konsistenz-Checks). */
export function glossaryMarkerKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(MARKER)) keys.push(markerKey(m[1], m[2]));
  return keys;
}
