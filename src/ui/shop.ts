import { Game } from "../game";
import { KQContent } from "../content";
import type { GameState } from "../types";
import { SFX } from "../sfx";
import { part, $, type UIShopItem } from "./shared";

/** Abschnitts-Kategorien des Shops (#575): datengetrieben aus dem Item-`type`,
 *  Reihenfolge der Abschnitte liegt hier, nicht je Item. Ein `type`, der in
 *  keiner Kategorie steckt, landet im Sonstiges-Fallback statt lautlos zu
 *  verschwinden – wichtig bei Stardew-Scope, wenn später ein neuer Item-`type`
 *  dazukommt und diese Liste dabei vergessen wird. */
const SHOP_CATEGORIES: { label: string; icon: string; types: string[] }[] = [
  { label: "Verbrauch", icon: "🧴", types: ["consumable"] },
  { label: "Deko", icon: "🎨", types: ["pet", "flag"] },
  { label: "Komfort", icon: "⚙️", types: ["comfort"] },
  { label: "Upgrades", icon: "🔧", types: ["upgrade"] },
];
const SHOP_FALLBACK_CATEGORY = { label: "Sonstiges", icon: "❔" };

/** Teilt die Shop-Items in ihre Abschnitte auf (Reihenfolge: `SHOP_CATEGORIES`,
 *  innerhalb eines Abschnitts bleibt die Deklarationsreihenfolge aus `KQContent.SHOP`
 *  erhalten). Leere Abschnitte werden weggelassen. */
function groupShopItems(items: UIShopItem[]): { label: string; icon: string; items: UIShopItem[] }[] {
  const groups = SHOP_CATEGORIES.map(cat => ({
    label: cat.label, icon: cat.icon, items: items.filter(i => cat.types.includes(i.type)),
  }));
  const known = new Set(SHOP_CATEGORIES.flatMap(cat => cat.types));
  const rest = items.filter(i => !known.has(i.type));
  if (rest.length > 0) groups.push({ ...SHOP_FALLBACK_CATEGORY, items: rest });
  return groups.filter(g => g.items.length > 0);
}

/** Baut den Aktions-Bereich (Kaufen-Button/Fortschritt/Installiert/Aktivieren) EINES
 *  Shop-Items – aus `openShop` herausgezogen (#572, Komfort-Zustand kam als dritter Zweig
 *  dazu, sonst wäre die Schleife zu komplex geworden, #502). */
function shopItemAction(item: UIShopItem, s: GameState): string {
  const ownedPerm = s.owned.includes(item.id);
  if (item.type === "consumable") {
    const ownedCount = s.inventory[item.id] || 0;
    return `<button class="primary" data-action="buyItem" data-arg="${item.id}">Kaufen – ${item.price} 🪙</button>
      ${ownedCount > 0 ? `<div class="si-owned">Im Beutel: ${ownedCount}</div>` : ""}`;
  }
  if (item.type === "comfort" && !ownedPerm && !Game.isComfortUnlocked(item.id)) {
    // Komfort-Funktion noch nicht verdient (#572): Fortschritt statt Kaufen-Button.
    const have = s.comfortUsage[item.id] || 0;
    const need = item.unlockAt ?? 0;
    return `<div class="si-locked">🔒 Noch ${Math.max(0, need - have)}× ausschreiben (${have}/${need})</div>`;
  }
  if (!ownedPerm) {
    return `<button class="primary" data-action="buyItem" data-arg="${item.id}">Kaufen – ${item.price} 🪙</button>`;
  }
  if (item.type === "upgrade" || item.type === "comfort") {
    return `<div class="si-owned">✅ Installiert</div>`;
  }
  const active = s.activePet === item.id || s.activeFlag === item.id;
  return active
    ? `<button data-action="toggleItem" data-arg="${item.id}" data-on="0">✅ Aktiv – abschalten</button>`
    : `<button data-action="toggleItem" data-arg="${item.id}" data-on="1">Aktivieren</button>`;
}

export const shopUI = part({
  /* ========== Shop ========== */
  openShop() {
    this.closeOverlays();
    $("overlay-shop").classList.remove("hidden");
    const s = Game.state;
    let html = `<p class="dim">„Willkommen! Frische Ware, faire Preise!“ – Du hast <b>${s.coins} 🪙</b>.
      Dein 🔥 Streak (${s.streak.count}) gibt bis zu +50% auf Belohnungen, dein Hafen verdient +${Math.round(Game.incomeRate() * 10) / 10}/min.</p>`;
    for (const group of groupShopItems(KQContent.SHOP as UIShopItem[])) {
      html += `<div class="shop-cat"><span class="shop-cat-icon">${group.icon}</span><span class="shop-cat-label">${group.label}</span></div>
        <div class="shop-grid">`;
      for (const item of group.items) {
        const action = shopItemAction(item, s);
        const icon = item.tex !== undefined
          ? `<canvas width="16" height="16" data-tex="${item.tex}"></canvas>`
          : item.sprite !== undefined
          ? `<canvas width="16" height="16" data-sprite="${item.sprite}"></canvas>`
          : item.icon;
        html += `<div class="shop-item">
          <div class="si-icon">${icon}</div>
          <div class="si-name">${item.name}</div>
          <div class="si-desc">${item.desc}</div>
          ${action}
        </div>`;
      }
      html += "</div>";
    }
    $("shop-body").innerHTML = html;
    document.querySelectorAll("#shop-body canvas[data-sprite]").forEach(cv => {
      const c = cv as HTMLCanvasElement;
      this.drawPortrait(c, parseInt(c.dataset.sprite!, 10));
    });
    document.querySelectorAll("#shop-body canvas[data-tex]").forEach(cv => {
      const c = cv as HTMLCanvasElement;
      this.drawTexIcon(c, c.dataset.tex!);
    });
    this.focusFirstIn($("overlay-shop")); // #506: Fokus ins Modal
  },

  buyItem(itemId: string) {
    const result = Game.buy(itemId);
    this.toast(result.ok ? "🛒 " + result.msg : "⚠️ " + result.msg);
    if (result.ok) SFX.coin();
    this.refreshHud();
    this.openShop();
  },

  toggleItem(itemId: string, on: boolean) {
    const item = KQContent.SHOP.find(s => s.id === itemId);
    if (!item) return;
    if (item.type === "pet") Game.state.activePet = on ? itemId : null;
    if (item.type === "flag") Game.state.activeFlag = on ? itemId : null;
    Game.save();
    this.openShop();
  },

});
