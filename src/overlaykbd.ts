/* ===== KubeQuest – Tastatur-Logik für einfache Modals (#283) =====
 * Pure Domäne (Phaser-/DOM-frei, unit-testbar): entscheidet, was eine Taste in
 * einem blockierenden Overlay ohne eigene Navigation (Stapel-Spiel, Shop,
 * Logbuch, Menü) bewirkt – navigieren zwischen den Buttons oder einen auslösen.
 *
 * Die DOM-Anbindung liegt dünn in `ui.ts` (`overlayKey`): sie liest die
 * sichtbaren Buttons aus, ruft `resolveOverlayKey` und setzt Markierung/Click um.
 * Leitidee wie im Rest des Projekts: Logik bleibt testbar, nur die Präsentation
 * fasst das DOM an (siehe AGENTS.md › Architektur).
 */

/** Minimaler, DOM-freier Button-Steckbrief für die Tastatur-Entscheidung. */
export interface OverlayButton {
  /** Deaktivierte Buttons werden weder markiert noch ausgelöst. */
  disabled?: boolean;
  /** Trägt der Button die CSS-Klasse `primary` (der Standard-Knopf)? */
  primary?: boolean;
}

/** Ergebnis von {@link resolveOverlayKey}:
 *  - `nav`: markiere den Button mit Index `sel`
 *  - `activate`: löse den Button mit Index `index` aus (Click)
 *  - `null`: Taste ist für diese Logik irrelevant (Aufrufer macht weiter) */
export type OverlayKeyResult =
  | { kind: "nav"; sel: number }
  | { kind: "activate"; index: number }
  | null;

const NAV_DOWN = ["ArrowDown", "s"];
const NAV_UP = ["ArrowUp", "w"];
const ACTIVATE = ["Enter", " ", "e"];

/**
 * Entscheidet, wie eine Taste in einem einfachen Modal wirkt.
 *
 * @param buttons  alle Buttons des Overlays in DOM-Reihenfolge (inkl. disabled).
 * @param current  Index des aktuell markierten Buttons in `buttons`,
 *                 oder -1, wenn (noch) keiner markiert ist.
 * @param key      normalisierte Taste (einzelne Zeichen klein, sonst der
 *                 `KeyboardEvent.key`-Name wie "ArrowDown"/"Enter").
 *
 * Regeln:
 * - ↑/↓ (bzw. w/s) wandert nur über **aktivierbare** Buttons, mit Umlauf.
 *   Aus "nichts markiert" (-1) springt ↓ auf den ersten, ↑ auf den letzten.
 * - Enter/Leer/E löst aus: den markierten Button, sonst den `primary`-Button,
 *   sonst den ersten aktivierbaren – damit Modals ohne Maus bedienbar sind.
 * - Gibt es keinen aktivierbaren Button oder ist die Taste keine der obigen,
 *   liefert die Funktion `null`.
 */
export function resolveOverlayKey(
  buttons: OverlayButton[],
  current: number,
  key: string,
): OverlayKeyResult {
  // Nur aktivierbare Buttons mit ihrem Original-Index betrachten.
  const enabled = buttons
    .map((b, i) => ({ b, i }))
    .filter(x => !x.b.disabled);
  if (enabled.length === 0) return null;

  const isDown = NAV_DOWN.includes(key);
  const isUp = NAV_UP.includes(key);
  if (isDown || isUp) {
    const positions = enabled.map(x => x.i);
    const n = positions.length;
    // Position des aktuell markierten Buttons in der „enabled"-Liste finden.
    // Unbekannt (-1 oder disabled markiert): von „nichts" aus starten – ↓ erstes, ↑ letztes.
    let pos = positions.indexOf(current);
    if (pos < 0) pos = isDown ? -1 : 0;
    const next = ((pos + (isDown ? 1 : -1)) % n + n) % n;
    return { kind: "nav", sel: positions[next] };
  }

  if (ACTIVATE.includes(key)) {
    // 1. markierter (sofern aktivierbar), 2. primary, 3. erster aktivierbarer.
    if (current >= 0 && current < buttons.length && !buttons[current].disabled) {
      return { kind: "activate", index: current };
    }
    const primary = enabled.find(x => x.b.primary);
    return { kind: "activate", index: (primary ?? enabled[0]).i };
  }

  return null;
}

/* ===== Mehrzeilige Lese-Dialoge: vor-/zurückblättern (#310) =====
 * Pure Blätter-Logik für NPC-Gespräche UND Bo-Lernblöcke (beide laufen über
 * `showDialogue`): mit „weiter" (E/Enter/Leer) vorwärts, mit „zurück" (←/
 * Backspace) durch die schon gezeigten Zeilen nochmal lesen. Reiner Lese-
 * Rückblick – es wird KEIN Spielzustand und KEINE getroffene Auswahl/Antwort
 * zurückgedreht (eine laufende Frage/ein Menü blockt das in der DOM-Schicht).
 * Die DOM-Anbindung liegt dünn in `ui/dialog.ts` (`advanceDialogue`/
 * `dialogueBack`) + `main.ts` (Tastenwahl).
 */

/** Ergebnis von {@link dialogueNav}:
 *  - `show`: die Zeile mit Index `idx` (neu) anzeigen
 *  - `finish`: über die letzte Zeile hinaus vorwärts → Dialog beenden (schließen + onDone)
 *  - `stay`: am Anfang zurück → nichts ändern (geclampt, reiner Lese-Rückblick) */
export type DialogueNavAction =
  | { kind: "show"; idx: number }
  | { kind: "finish" }
  | { kind: "stay" };

/**
 * Entscheidet, wohin ein Blättern in einem mehrzeiligen Lese-Dialog führt.
 *
 * @param idx        aktuell gezeigte Zeile (0-basiert)
 * @param lineCount  Gesamtzahl der Zeilen (>= 1)
 * @param dir        +1 = weiter (E/Enter/Leer), -1 = zurück (←/Backspace)
 *
 * - weiter: auf der letzten Zeile → `finish` (Dialog schließen), sonst `show idx+1`.
 * - zurück: auf der ersten Zeile → `stay` (geclampt; eine Auswahl/Antwort wird
 *   NIE zurückgedreht), sonst `show idx-1`.
 */
export function dialogueNav(idx: number, lineCount: number, dir: 1 | -1): DialogueNavAction {
  if (dir === 1) {
    return idx < lineCount - 1 ? { kind: "show", idx: idx + 1 } : { kind: "finish" };
  }
  return idx > 0 ? { kind: "show", idx: idx - 1 } : { kind: "stay" };
}

/* ===== Fokusfalle für Modals (#506) =====
 * Pure Rechen-Hilfe für die Tab-Fokusfalle: hält den Tastatur-Fokus zyklisch
 * innerhalb eines offenen Modals, statt ihn in Hintergrund-Elemente wandern zu
 * lassen (Screenreader-/Tastatur-Barrierefreiheit). Wie überall hier ist nur die
 * Index-Mathematik testbar-pur; die DOM-Anbindung (fokussierbare Knoten sammeln,
 * `.focus()` setzen) liegt dünn in `ui/overlay.ts` (`trapFocus`).
 */

/**
 * Nächster Fokus-Index bei Tab / Shift+Tab innerhalb einer Fokusfalle.
 *
 * @param count     Anzahl der fokussierbaren Knoten im Modal.
 * @param current   Index des aktuell fokussierten Knotens, oder -1 (bzw. außerhalb
 *                   des Bereichs), wenn der Fokus (noch) nicht im Modal sitzt.
 * @param backward  true = Shift+Tab (rückwärts), false = Tab (vorwärts).
 *
 * - Vorwärts über den letzten Knoten hinaus springt zyklisch auf den ersten,
 *   rückwärts vor den ersten auf den letzten – so verlässt der Fokus das Modal nie.
 * - Sitzt der Fokus (noch) außerhalb, landet Tab auf dem ersten, Shift+Tab auf dem
 *   letzten Knoten.
 * - Ohne fokussierbaren Knoten (`count <= 0`) gibt es nichts zu fokussieren: `null`.
 */
export function nextFocusIndex(count: number, current: number, backward: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0 || current >= count) return backward ? count - 1 : 0;
  return ((current + (backward ? -1 : 1)) % count + count) % count;
}
