import { Game } from "../game";
import { KQContent } from "../content";
import { SFX } from "../sfx";
import { part, $, type UIShopItem } from "./shared";

export const shopUI = part({
  /* ========== Shop ========== */
  openShop() {
    this.closeOverlays();
    $("overlay-shop").classList.remove("hidden");
    const s = Game.state;
    let html = `<p class="dim">„Willkommen! Frische Ware, faire Preise!“ – Du hast <b>${s.coins} 🪙</b>.
      Dein 🔥 Streak (${s.streak.count}) gibt bis zu +50% auf Belohnungen, dein Hafen verdient +${Math.round(Game.incomeRate() * 10) / 10}/min.</p>
      <div class="shop-grid">`;
    for (const item of KQContent.SHOP as UIShopItem[]) {
      const ownedCount = s.inventory[item.id] || 0;
      const ownedPerm = s.owned.includes(item.id);
      let action;
      if (item.type === "consumable") {
        action = `<button class="primary" data-action="buyItem" data-arg="${item.id}">Kaufen – ${item.price} 🪙</button>
          ${ownedCount > 0 ? `<div class="si-owned">Im Beutel: ${ownedCount}</div>` : ""}`;
      } else if (ownedPerm) {
        if (item.type === "upgrade") {
          action = `<div class="si-owned">✅ Installiert</div>`;
        } else {
          const active = s.activePet === item.id || s.activeFlag === item.id;
          action = active
            ? `<button data-action="toggleItem" data-arg="${item.id}" data-on="0">✅ Aktiv – abschalten</button>`
            : `<button data-action="toggleItem" data-arg="${item.id}" data-on="1">Aktivieren</button>`;
        }
      } else {
        action = `<button class="primary" data-action="buyItem" data-arg="${item.id}">Kaufen – ${item.price} 🪙</button>`;
      }
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
