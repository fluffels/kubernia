/* „Verdiente" Freischaltungen (#392, game.ts-Split): die per Nutzung freigeschalteten
 * Abkürzungen (#287/#297/#313) und die ↑/↓-Befehlshistorie des Funkgerät-Terminals (#316).
 * Beide folgen demselben Muster: additives Flag/Array, das ein Alt-Stand regulär
 * nachverdient (kein Bruch, kein Versions-Bump). Anwendungsschicht, Phaser-frei. */
import { KQContent } from "../content";
import { part, ALL_ABBREV_UNLOCKED, ABBREV_EARN_THRESHOLD, CMD_HISTORY_UNLOCK_AT } from "./shared";

/** Freischalt-Methoden der Game-Fassade (Abkürzungen + Befehlshistorie). */
export const unlocksBundle = part({
  /* ---------- „Verdiente Abkürzungen" (#287/#297) ---------- */
  /** Ist die Abkürzung mit dieser ID freigeschaltet? true, sobald sie einzeln
   *  freigeschaltet wurde ODER der Stand grandfathered ist (Sentinel "*").
   *  Das eigentliche Gating der Eingabe-Akzeptanz baut darauf auf (#299). */
  isAbbrevUnlocked(id: string): boolean {
    return this.state.unlockedAbbrev.includes(ALL_ABBREV_UNLOCKED) || this.state.unlockedAbbrev.includes(id);
  },

  /** Schaltet eine Abkürzung frei (idempotent, speichert sofort). Aufgerufen vom
   *  Freischalt-Moment im Lernpfad (#300). Bei bereits grandfathertem Stand No-op. */
  unlockAbbrev(id: string) {
    if (this.isAbbrevUnlocked(id)) return;
    this.state.unlockedAbbrev.push(id);
    this.save();
  },

  /** Zählt eine korrekt getippte Langform Richtung „verdiente Abkürzung" (#313).
   *  Ist die Kurzform noch gesperrt, erhöht das ihren Zähler; bei Erreichen von
   *  `ABBREV_EARN_THRESHOLD` wird sie freigeschaltet. Gibt `true` zurück, wenn GENAU
   *  dieser Aufruf sie verdient hat (für die Freischalt-Feier). No-op + `false`,
   *  sobald sie freigeschaltet ist (auch grandfathered `*`). */
  recordAbbrevLongFormUse(id: string): boolean {
    if (this.isAbbrevUnlocked(id)) return false;
    const n = (this.state.abbrevUsage[id] || 0) + 1;
    this.state.abbrevUsage[id] = n;
    if (n >= ABBREV_EARN_THRESHOLD) {
      this.unlockAbbrev(id); // pusht + speichert
      return true;
    }
    this.save();
    return false;
  },

  /* ---------- Befehlshistorie freischalten (#316) ---------- */
  /** Ist die ↑/↓-Befehlshistorie im Funkgerät-Terminal freigeschaltet? */
  isCmdHistoryUnlocked(): boolean {
    return this.state.cmdHistoryUnlocked;
  },

  /** Schaltet die Befehlshistorie frei, sobald genug Befehle getippt wurden
   *  (`CMD_HISTORY_UNLOCK_AT`, Zähler = `stats.commands`). Idempotent; speichert bei der
   *  Freischaltung. Gibt `true` zurück, wenn GENAU dieser Aufruf sie freigeschaltet hat
   *  (für die einmalige Freischalt-Feier), sonst `false`. */
  maybeUnlockCmdHistory(): boolean {
    if (this.state.cmdHistoryUnlocked) return false;
    if ((this.state.stats.commands || 0) < CMD_HISTORY_UNLOCK_AT) return false;
    this.state.cmdHistoryUnlocked = true;
    this.save();
    return true;
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
