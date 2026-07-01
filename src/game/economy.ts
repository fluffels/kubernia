/* Hafen-Wirtschaft, Streak, XP/Rang, Dublonen und Shop (#392, game.ts-Split).
 * Die „Belohnungs-Ökonomie" des Spiels: was der Hafen abwirft, wie der Streak den
 * Multiplikator hebt, wie XP in Ränge umschlägt und wofür Dublonen ausgegeben werden.
 * Anwendungsschicht, Phaser-frei. */
import { KQContent } from "../content";
import { add, applyMultiplier, canAfford, subtract, toCoins } from "../coins";
import type { EventMode } from "../types";
import { part, isEventMode, today, type EventProfile } from "./shared";

// EventProfile (Spiel-Feel-Stellschrauben #71) liegt seit #513 in shared.ts, weil GameApi sie
// als Rückgabetyp von eventProfile() braucht; die konkrete Tabelle bleibt hier.
const EVENT_PROFILES: Record<EventMode, EventProfile> = {
  normal: { spawnScale: 1, deadlineScale: 1, malusFactor: 0, enabled: true },
  cozy: { spawnScale: 2, deadlineScale: 1.5, malusFactor: 0.5, enabled: true },
  off: { spawnScale: Infinity, deadlineScale: 1, malusFactor: 1, enabled: false },
};

/** Wirtschaft, Streak, XP/Rang, Dublonen und Shop der Game-Fassade. */
export const economyBundle = part({
  /* ---------- Hafen-Wirtschaft ---------- */
  /** Dublonen pro Minute: jede GESUNDE Pod-Kopie 0.5, jeder Service 1. Kaputte Deployments verdienen nichts! */
  /** Aktives Spiel-Feel-Profil (Frequenz/Härte der Events + Verdienst-Malus, #71). */
  eventProfile(): EventProfile {
    return EVENT_PROFILES[this.state.settings.events] || EVENT_PROFILES.normal;
  },

  /** Spiel-Feel-Stufe setzen und persistieren (vom Menü aufgerufen). */
  setEventMode(mode: EventMode) {
    if (!isEventMode(mode)) return;
    this.state.settings.events = mode;
    this.save();
  },

  incomeRate() {
    if (!this.sim) return 0;
    // Kaputte Dienste verdienen normal nichts (malusFactor 0). Im Cozy-Modus
    // ist der Malus gemildert (0.5), im Aus-Modus aufgehoben (1) – Anti-Frust (#71).
    const malus = this.eventProfile().malusFactor;
    const pods = this.sim.deployments.reduce((sum, d) => sum + (d.broken ? d.replicas * malus : d.replicas), 0);
    return pods * 0.5 + this.sim.services.length * 1;
  },

  /** Wird von der Spielschleife getickt; gibt ausgezahlte Dublonen zurück. */
  economyTick(dt: number) {
    this.incomeAcc += this.incomeRate() / 60 * dt;
    if (this.incomeAcc >= 1) {
      // Nur ganze Dublonen auszahlen; der Nachkomma-Rest bleibt im Akkumulator.
      const payout = toCoins(this.incomeAcc);
      this.incomeAcc -= payout;
      this.state.coins = add(this.state.coins, payout);
      return payout;
    }
    return 0;
  },

  /* ---------- Streak ---------- */
  touchStreak() {
    const t = today();
    const s = this.state.streak;
    if (s.lastDay === t) return;
    s.count = (s.lastDay === t - 1) ? s.count + 1 : 1;
    s.lastDay = t;
  },

  coinMultiplier() {
    return 1 + Math.min(this.state.streak.count, 10) * 0.05;
  },

  /* ---------- XP & Rang ---------- */
  rankIndex(xp?: number) {
    const v = xp === undefined ? this.state.xp : xp;
    let idx = 0;
    KQContent.RANKS.forEach((r, i) => { if (v >= r.xp) idx = i; });
    return idx;
  },
  rank() { return KQContent.RANKS[this.rankIndex()]; },
  nextRank() {
    const i = this.rankIndex();
    return i < KQContent.RANKS.length - 1 ? KQContent.RANKS[i + 1] : null;
  },

  addXp(amount: number) {
    const before = this.rankIndex();
    this.state.xp += amount;
    const after = this.rankIndex();
    this.save();
    return after > before;
  },

  addCoins(amount: number) {
    const real = applyMultiplier(amount, this.coinMultiplier());
    this.state.coins = add(this.state.coins, real);
    this.save();
    return real;
  },

  spendCoins(amount: number) {
    const price = toCoins(amount);
    if (!canAfford(this.state.coins, price)) return false;
    this.state.coins = subtract(this.state.coins, price);
    this.save();
    return true;
  },

  /* ---------- Shop ---------- */
  buy(itemId: string) {
    const item = KQContent.SHOP.find(s => s.id === itemId);
    if (!item) return { ok: false, msg: "Unbekannte Ware." };
    if (item.type !== "consumable" && this.state.owned.includes(itemId)) {
      return { ok: false, msg: "Hast du schon!" };
    }
    if (!this.spendCoins(item.price)) {
      return { ok: false, msg: "Nicht genug Dublonen! Quests, Üben und ein gesunder Hafen füllen den Beutel." };
    }
    if (item.type === "consumable") {
      this.state.inventory[itemId] = (this.state.inventory[itemId] || 0) + 1;
    } else {
      this.state.owned.push(itemId);
      if (item.type === "pet") this.state.activePet = itemId;
      if (item.type === "flag") this.state.activeFlag = itemId;
    }
    this.save();
    return { ok: true, msg: item.name + " gekauft!" };
  },

  useConsumable(itemId: string) {
    if (!this.state.inventory[itemId]) return false;
    this.state.inventory[itemId]--;
    this.save();
    return true;
  },

  hasUpgrade(id: string) { return this.state.owned.includes(id); },
});
