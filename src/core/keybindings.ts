/* ===== Umbelegbare Tastatur-Aktionen (#232) – Phaser-/DOM-frei, pur testbar =====
 *
 * Die diskreten Aktionstasten (Reden, Funkgerät, Logbuch, Sammelalbum) sind frei
 * umbelegbar; Bewegung (WASD/Pfeile), Bestätigen (Enter/Leer), Dialog-Navigation
 * (↑/↓/1–4) und Menü/Schließen (Esc) bleiben feste Konventionen und sind hier NICHT
 * belegbar (siehe `RESERVED_KEYS`). Diese Datei ist die EINE Quelle der Belegungs-
 * regeln: Default-Belegung, was eine Taste belegbar macht, Konflikt-/Auflöse-Logik
 * und das Sanitisieren eines geladenen (evtl. kaputten) Stands. Persistiert wird die
 * Belegung als `settings.keys` im GameState (Save-Format v7, #232).
 *
 * Stardew-Scope: die Aktions-Menge ist eine Daten-Liste (`BINDABLE_ACTIONS`) – neue
 * belegbare Aktionen (z.B. später Bewegung, #<Folge-Ticket>) hängen sich hier an, der
 * Rest (UI/Persistenz/Dispatch) leitet sich daraus ab, statt jede Taste einzeln zu raten.
 */

/** Eine frei umbelegbare Spiel-Aktion. */
export type BindableAction = "talk" | "radio" | "logbook" | "album";

/** Reihenfolge = Anzeige-Reihenfolge in der Menü-Belegungsliste. */
export const BINDABLE_ACTIONS: readonly BindableAction[] = ["talk", "radio", "logbook", "album"];

/** Menschlicher Name je Aktion (deutsch, fürs Menü + HUD-Hinweise). */
export const ACTION_LABELS: Record<BindableAction, string> = {
  talk: "Reden",
  radio: "Funkgerät",
  logbook: "Logbuch",
  album: "Sammelalbum",
};

/** Die Belegung: je Aktion genau eine (normalisierte) Taste. */
export type Keybindings = Record<BindableAction, string>;

/** Default-Belegung (deutsch-mnemonisch, #232): R=Reden, F=Funkgerät, L=Logbuch, B=Album. */
export const DEFAULT_KEYBINDINGS: Keybindings = {
  talk: "r",
  radio: "f",
  logbook: "l",
  album: "b",
};

/** Feste Konventions-Tasten, die NICHT umbelegt werden dürfen (Bewegung, Bestätigen,
 *  Dialog-/Modal-Navigation, Menü). Alles in normalisierter Form (siehe `normalizeKey`). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "w", "a", "s", "d",
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  "enter", " ", "escape", "tab", "backspace",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
]);

/** Normalisiert eine `KeyboardEvent.key`-Roheingabe: Einzelzeichen → Kleinbuchstabe,
 *  benannte Tasten (Arrow*, Enter …) → Kleinschreibung. Spiegelt die Normalisierung
 *  im Tastatur-Dispatch (main.ts), damit Vergleiche hier und dort dieselben sind. */
export function normalizeKey(raw: string): string {
  return raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase();
}

/** Ist `k` (bereits normalisiert) frei belegbar? Genau die einzelnen Buchstaben a–z,
 *  die nicht schon feste Konvention sind (w/a/s/d). Ziffern/benannte Tasten sind tabu. */
export function isAssignableKey(k: string): boolean {
  return /^[a-z]$/.test(k) && !RESERVED_KEYS.has(k);
}

/** Welche Aktion hört auf Taste `key`? null, wenn keine. */
export function resolveAction(bindings: Keybindings, key: string): BindableAction | null {
  const k = normalizeKey(key);
  for (const a of BINDABLE_ACTIONS) if (bindings[a] === k) return a;
  return null;
}

/** Belegt Taste `key` bereits eine ANDERE Aktion als `self`? Gibt sie zurück, sonst null. */
export function findConflict(bindings: Keybindings, self: BindableAction, key: string): BindableAction | null {
  const owner = resolveAction(bindings, key);
  return owner && owner !== self ? owner : null;
}

/** Erste freie, belegbare Taste, die nicht in `used` steckt (Fallback beim Sanitisieren). */
function firstFreeKey(used: ReadonlySet<string>): string {
  for (let c = 97; c <= 122; c++) {
    const k = String.fromCharCode(c);
    if (isAssignableKey(k) && !used.has(k)) return k;
  }
  return "z"; // theoretisch unerreichbar (26 Buchstaben > 4 Aktionen)
}

/** Macht aus einer beliebigen (evtl. kaputten/fremden) Roh-Belegung eine gültige,
 *  kollisionsfreie `Keybindings`: unbelegbare/ungültige oder doppelte Tasten fallen auf
 *  die Default-Belegung zurück; kollidiert auch der Default, wird die erste freie Taste
 *  genommen. Ergebnis ist IMMER vollständig, belegbar und paarweise verschieden. */
export function sanitizeKeybindings(raw: unknown): Keybindings {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Keybindings;
  const used = new Set<string>();
  // 1. Durchgang: gültige, eindeutige Roh-Tasten übernehmen.
  for (const a of BINDABLE_ACTIONS) {
    const k = normalizeKey(String(src[a] ?? ""));
    if (isAssignableKey(k) && !used.has(k)) {
      out[a] = k;
      used.add(k);
    } else {
      out[a] = "";
    }
  }
  // 2. Durchgang: Lücken mit dem Default (bzw. erster freier Taste) füllen.
  for (const a of BINDABLE_ACTIONS) {
    if (out[a]) continue;
    let d = DEFAULT_KEYBINDINGS[a];
    if (used.has(d) || !isAssignableKey(d)) d = firstFreeKey(used);
    out[a] = d;
    used.add(d);
  }
  return out;
}
