/* ===== Inhalte: Fortschritt & Shop (Content-as-Data, #583) =====
 * Ränge (XP-Schwellen) und Shop-Angebot sind reine Daten und liegen seit #583 als JSON
 * (`./data/ranks.json`/`./data/shop.json`), nicht mehr als TS-Objekt-Literal – wie NPCs
 * (#348) und Übungs-Pools (#521). Einzelne JSON-Dateien ohne Aufteilung (kein Glob-Loader-
 * Quartett nötig, dafür sind es zu wenige/zu kleine Einträge): beim Modul-Laden einmal
 * validiert und als Konstante gehalten.
 */
import ranksData from "./data/ranks.json";
import shopData from "./data/shop.json";
import { fail, asArray, asRecord, asNonEmptyString, asInt, asHexColor, assertNoUnknownKeys } from "./parse";

/* ---------- Ränge (geschlechtsneutral) ---------- */
export interface Rank {
  xp: number;
  name: string;
  icon: string;
}

const RANK_KEYS = ["xp", "name", "icon"] as const;

/** Validiert die rohen Rang-Daten. Wirft `ContentValidationError` beim ersten Verstoß
 *  (nie still durchwinken); die inhaltliche Regel „XP aufsteigend" prüft weiterhin
 *  `content/validate.ts` (referenzielle/Business-Prüfung, nicht Schema). */
export function parseRanks(raw: unknown): Rank[] {
  const arr = asArray(raw, "ranks");
  if (arr.length === 0) fail("ranks", "mindestens ein Rang erwartet");
  return arr.map((v, i) => {
    const o = asRecord(v, `ranks[${i}]`);
    assertNoUnknownKeys(o, `ranks[${i}]`, RANK_KEYS);
    return {
      xp: asInt(o.xp, `ranks[${i}].xp`),
      name: asNonEmptyString(o.name, `ranks[${i}].name`),
      icon: asNonEmptyString(o.icon, `ranks[${i}].icon`),
    };
  });
}

/** Validierte Ränge – Quelle: `./data/ranks.json`. */
export const RANKS: Rank[] = parseRanks(ranksData);

/* ---------- Shop ---------- */
/** Ein Eintrag im Shop-Angebot. Heterogen (Verbrauchsgut/Haustier/Flagge/Upgrade/Komfort-
 *  Funktion) – die je nach `type` optionalen Felder bleiben darum optional statt je Variante
 *  einen eigenen Union-Zweig zu brauchen; Kauf-Logik (`game/economy.ts`) und Content-Validator
 *  (`content/validate.ts`) verzweigen über `type`. */
export interface ShopItem {
  id: string;
  icon: string;
  name: string;
  price: number;
  type: string;
  desc: string;
  sprite?: number;
  tex?: string;
  color?: number;
  /** Komfort-Funktionen (#572, Zwei-Stufen-Gate verdienen→kaufen): wie oft die Grundlage
   *  benutzt werden muss, bevor der Kauf freigeschaltet wird. Nur bei `type: "comfort"`. */
  unlockAt?: number;
  /** Maximale Stapelgröße (#421): wie viele Exemplare ein Inventar-Stapel maximal fassen darf.
   *  Fehlt/undefined = unbegrenzt (aktuell noch nicht erzwungen, Fundament für künftigen Scope). */
  maxStack?: number;
}

const SHOP_KEYS = ["id", "icon", "name", "price", "type", "desc", "sprite", "tex", "color", "unlockAt", "maxStack"] as const;

/** Validiert die rohen Shop-Daten. `color` steht in der JSON als lesbarer Hex-String
 *  (`"#rrggbb"`) statt als `0x......`-Zahlenliteral, siehe `asHexColor`. Wirft
 *  `ContentValidationError` beim ersten Verstoß; die Business-Regeln (eindeutige ID,
 *  bekannter `type`, positiver `price`, `comfort` braucht `unlockAt` …) prüft weiterhin
 *  `content/validate.ts`. */
export function parseShop(raw: unknown): ShopItem[] {
  const arr = asArray(raw, "shop");
  if (arr.length === 0) fail("shop", "mindestens ein Shop-Eintrag erwartet");
  return arr.map((v, i) => {
    const o = asRecord(v, `shop[${i}]`);
    assertNoUnknownKeys(o, `shop[${i}]`, SHOP_KEYS);
    const item: ShopItem = {
      id: asNonEmptyString(o.id, `shop[${i}].id`),
      icon: asNonEmptyString(o.icon, `shop[${i}].icon`),
      name: asNonEmptyString(o.name, `shop[${i}].name`),
      price: asInt(o.price, `shop[${i}].price`),
      type: asNonEmptyString(o.type, `shop[${i}].type`),
      desc: asNonEmptyString(o.desc, `shop[${i}].desc`),
    };
    if (o.sprite !== undefined) item.sprite = asInt(o.sprite, `shop[${i}].sprite`);
    if (o.tex !== undefined) item.tex = asNonEmptyString(o.tex, `shop[${i}].tex`);
    if (o.color !== undefined) item.color = asHexColor(o.color, `shop[${i}].color`);
    if (o.unlockAt !== undefined) item.unlockAt = asInt(o.unlockAt, `shop[${i}].unlockAt`);
    if (o.maxStack !== undefined) item.maxStack = asInt(o.maxStack, `shop[${i}].maxStack`);
    return item;
  });
}

// #573: "befehlshistorie" ist die erste echte Komfort-Funktion (Zwei-Stufen-Gate #572) –
// die ID in shop.json muss zu CMD_HISTORY_ITEM_ID in game/shared.ts passen (Content ist
// pure Domäne und darf die Anwendungsschicht nicht importieren, daher kein geteilter
// Konstanten-Import).
/** Validierter Shop – Quelle: `./data/shop.json`. */
export const SHOP: ShopItem[] = parseShop(shopData);
