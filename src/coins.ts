/* ===== KubeQuest – Value Object für Dublonen/Wirtschaft (coins.ts) =====
 * Zweiter Schritt der schrittweisen Value-Object-Einführung (#490, Forts. #479, DDD).
 *
 * Eine Dublonen-Menge ist im Spiel KEINE beliebige Zahl, sondern per Definition
 * eine NICHT-NEGATIVE GANZE Zahl – es gibt keine halbe und keine negative Dublone.
 * Bisher lief der Kontostand überall als nackter `number`: jede Rechnung konnte
 * theoretisch Nachkommastellen oder einen negativen Stand erzeugen, und die drei
 * kaufmännischen Regeln (Rundung, Streak-Multiplikator, „reicht das Geld?") lagen
 * verstreut über `game/economy.ts`. Hier bündeln wir die Regel + die komplette
 * Arithmetik an EINER Stelle hinter einer stabilen API – der nächste Schritt davon,
 * illegale Wirtschafts-Zustände langfristig un-repräsentierbar zu machen.
 *
 * **Branded Type:** zur Laufzeit ist `Coins` eine ganz normale Zahl – kein Overhead,
 * und sie serialisiert unverändert (Spielstände bleiben ein `number`-Feld, #350). Der
 * Compiler unterscheidet `Coins` aber von einem beliebigen `number` und zwingt so jede
 * Herkunft durch die Fabriken/Operationen hier: ein roher, ungerundeter oder gar
 * negativer Wert landet nicht mehr versehentlich im Dublonen-Kontostand.
 *
 * Pure Domäne, importfrei – vom Architektur-Wächter (#347) als Domäne geschützt.
 */

/** Der stabile Dublonen-Typ. Branded: zur Laufzeit eine Zahl, für den Compiler ein
 *  eigener Typ, den nur die Fabriken/Operationen hier erzeugen. */
export type Coins = number & { readonly __brand: "Coins" };

/** Die EINE Regel: eine gültige Dublonen-Menge ist ganzzahlig und nicht negativ. */
export function isCoins(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/** Fehler eines prüfenden Smart-Constructors bzw. eines nicht gedeckten Abzugs. */
export class InvalidCoinsError extends Error {
  constructor(raw: number) {
    super("Ungültige Dublonen-Menge: " + raw + " (muss eine nicht-negative ganze Zahl sein).");
    this.name = "InvalidCoinsError";
  }
}

/** Prüfender Smart-Constructor: brandet `n` als `Coins` oder wirft, wenn die Regel
 *  verletzt ist. Für Werte, die per Konstruktion bereits gültig sein MÜSSEN (z.B. ein
 *  Literal-Startbetrag) – ein Wurf deckt hier einen echten Programmierfehler auf. */
export function coins(n: number): Coins {
  if (!isCoins(n)) throw new InvalidCoinsError(n);
  return n as Coins;
}

/** Härtende Fabrik für Werte aus unsicherer Quelle (geladener/kaputter Stand, das
 *  Ergebnis einer Nachkomma-Rechnung): bildet `n` auf die nächste gültige Menge ab
 *  (abrunden, mindestens 0), statt zu werfen – mitten im Laden oder in der Auszahlung
 *  wäre ein Wurf schlechter als ein sauber abgerundeter Wert. */
export function toCoins(n: number): Coins {
  if (!Number.isFinite(n)) return 0 as Coins;
  return Math.max(0, Math.floor(n)) as Coins;
}

/** Verdienst mit einem Multiplikator (Streak-Bonus) verrechnen und kaufmännisch runden –
 *  die EINE Stelle, an der aus rohem Betrag × Faktor eine ganze Dublonen-Gutschrift wird. */
export function applyMultiplier(amount: number, multiplier: number): Coins {
  return toCoins(Math.round(amount * multiplier));
}

/** Zwei Mengen addieren (Kontostand + Gutschrift) – bleibt per Konstruktion gültig. */
export function add(balance: Coins, amount: Coins): Coins {
  return (balance + amount) as Coins;
}

/** Reicht der Kontostand für den Preis? (Affordability an EINER Stelle.) */
export function canAfford(balance: Coins, price: Coins): boolean {
  return balance >= price;
}

/** Preis abziehen; wirft, wenn der Kontostand nicht reicht – ein negativer Stand ist
 *  damit un-repräsentierbar. Aufrufer prüfen vorher mit `canAfford` und behandeln den
 *  „zu teuer"-Fall selbst (z.B. Shop-Meldung), statt den Wurf zu provozieren. */
export function subtract(balance: Coins, price: Coins): Coins {
  if (!canAfford(balance, price)) throw new InvalidCoinsError(balance - price);
  return (balance - price) as Coins;
}
