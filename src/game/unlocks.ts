/* „Verdiente" Freischaltungen (#392, game.ts-Split): Abkürzungen (#287/#297/#313) und die
 * generische Komfort-Kauf-/Freischalt-Mechanik (#572) — seit #573/#574 der EINZIGE Freischalt-
 * Weg für alle Komfort-Funktionen (Befehlshistorie, jede einzelne Abkürzung): Nutzung zählt
 * Richtung „verdient" (SHOP-Item kaufbar), erst der Kauf (`Game.buy`/`state.owned`) aktiviert
 * sie dauerhaft. Anwendungsschicht, Phaser-frei. */
import { KQContent } from "../content";
import { part, CMD_HISTORY_ITEM_ID } from "./shared";

/** Freischalt-Methoden der Game-Fassade (Abkürzungen + Befehlshistorie). */
export const unlocksBundle = part({
  /* ---------- Abkürzungen: Komfort-Kauf-Mechanik (#572, seit #574 statt additivem Array) ---------- */
  /** Ist diese Abkürzung freigeschaltet, d.h. GEKAUFT (#574)? Die Nutzung ("verdienen") zählt
   *  `recordComfortUse(id)`; erst der Kauf danach (`Game.buy`/`state.owned`) macht die Kurzform
   *  akzeptiert – das Gating der Eingabe-Akzeptanz (#299) baut darauf auf. */
  isAbbrevUnlocked(id: string): boolean {
    return this.state.owned.includes(id);
  },

  /** Schaltet eine Abkürzung SOFORT & KOSTENLOS frei (verdient UND gekauft) – der Lernpfad-
   *  Bypass für einen Quest-Schritt, der eine Kurzform direkt einführt (#300, `step.unlockAbbrev`).
   *  Idempotent, speichert bei echter Änderung. Anders als der reguläre Weg (Nutzung → verdient
   *  → Shop-Kauf) kostet dieser Weg keine Dublonen: er ist kein Kaufmoment, sondern ein erzähltes
   *  Lehr-Geschenk der Quest selbst. */
  unlockAbbrev(id: string) {
    if (this.isAbbrevUnlocked(id)) return;
    if (!this.state.unlockedComfort.includes(id)) this.state.unlockedComfort.push(id);
    this.state.owned.push(id);
    this.save();
  },

  /* ---------- Befehlshistorie freischalten (#316, Kauf-Mechanik seit #573) ---------- */
  /** Ist die ↑/↓-Befehlshistorie im Funkgerät-Terminal freigeschaltet, d.h. GEKAUFT (#573)?
   *  Die Nutzung ("verdienen") zählt `recordComfortUse(CMD_HISTORY_ITEM_ID)`; erst der Kauf
   *  danach (`Game.buy`/`state.owned`) aktiviert sie – wie jede andere Komfort-Funktion. */
  isCmdHistoryUnlocked(): boolean {
    return this.state.owned.includes(CMD_HISTORY_ITEM_ID);
  },

  /* ---------- Komfort-Funktionen: Kauf-/Freischalt-Mechanik (#572) ----------
   * Zwei-Stufen-Gate, verallgemeinert aus dem Abkürzungs-/Befehlshistorie-Muster oben:
   * 1) Nutzung zählen -> ab der im SHOP-Item hinterlegten Schwelle (`unlockAt`) wird der
   *    KAUF freigeschaltet (unlockedComfort) – die Funktion ist NOCH NICHT aktiv.
   * 2) Der Kauf selbst läuft über Game.buy()/state.owned, genau wie bei upgrade/pet/flag;
   *    erst danach ist die Funktion dauerhaft aktiv.
   * Neue Komfort-Funktionen brauchen dafür KEINEN neuen Code-Pfad hier – nur einen
   * SHOP-Eintrag (type "comfort" + unlockAt) und ihren eigenen Zähl-Aufruf (Stardew-Scope:
   * datengetrieben statt je Funktion hart verdrahtet). */

  /** Ist der KAUF dieses Komfort-Items freigeschaltet (verdient)? Sagt nichts über Besitz –
   *  das prüft `hasUpgrade`/`state.owned` wie bei jedem anderen Shop-Item. */
  isComfortUnlocked(itemId: string): boolean {
    return this.state.unlockedComfort.includes(itemId);
  },

  /** Zählt eine Nutzung Richtung „Komfort-Funktion verdient" (analog
   *  `recordAbbrevLongFormUse`). Ist das Item bereits verdient, unbekannt oder kein
   *  `type: "comfort"`, ist der Aufruf ein No-op (`false`). Gibt `true` zurück, wenn GENAU
   *  dieser Aufruf die Schwelle (`unlockAt`) erreicht hat (für die Freischalt-Feier). */
  recordComfortUse(itemId: string): boolean {
    if (this.isComfortUnlocked(itemId)) return false;
    const item = KQContent.SHOP.find(s => s.id === itemId);
    if (!item || item.type !== "comfort" || !item.unlockAt) return false;
    const n = (this.state.comfortUsage[itemId] || 0) + 1;
    this.state.comfortUsage[itemId] = n;
    if (n >= item.unlockAt) {
      this.state.unlockedComfort.push(itemId);
      this.save();
      return true;
    }
    this.save();
    return false;
  },
});
