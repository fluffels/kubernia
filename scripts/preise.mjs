// Kein Shebang: wird von Messskripten und Tests importiert.
/**
 * Preistabelle und Kostenrechnung je Call (#1562, ausgelagert aus `token-baseline.mjs`). Reines Node-Modul
 * ohne Abhängigkeiten: der Langfuse-Abgleich läuft später als Hook, und Hook-Importe müssen geschützt und
 * klein sein; die gh-/git-Kette von `token-baseline.mjs` darf nicht mitkommen.
 */

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Stand der Preistabelle (im Report ausgegeben, bei jeder Preisänderung mitziehen). */
export const PRICES_STAND = "2026-10-08";

/**
 * Preise in $ je Mio Tokens (Stand siehe `PRICES_STAND`, Quelle: Preisliste auf claude.com/pricing,
 * deckungsgleich mit den Modell-Definitionen der lokalen Langfuse-Instanz). Langfuse
 * rechnet Kosten nur bei der Ingestion, ein später angelegter Preis gilt nicht
 * rückwirkend — darum kommen die Kosten im Transkript-Modus aus dieser Tabelle.
 * Ein Modell ohne Eintrag ist „ohne Preis" (null), nie 0 $.
 *
 * Ein Eintrag ist ein Preisobjekt (gilt immer) ODER eine Liste von Perioden
 * `[{ validFrom: null | ISO-Zeit, …Preise }]`, aufsteigend nach `validFrom` (`null` = seit
 * Modellstart). Eine Preisänderung wird als neue Periode ANGEHÄNGT, damit alte Läufe ihren
 * damaligen Preis behalten. Preisobjekt oder Periode kann `stufen: [{ ueberPrompt, …Preise }]`
 * tragen: Prompt = input + cacheWrite + cacheRead des Calls; über `ueberPrompt` Tokens
 * (strikt größer) gelten die Preise der höchsten zutreffenden Stufe statt der Grundpreise.
 * Quellen: platform.claude.com/docs/en/about-claude/pricing und die Release Notes
 * (Sonnet 5.5, Cache-Read ab 2026-10-07 0,10 statt 0,20 $; die Uhrzeit ist nicht belegt, 00:00 UTC
 * ist eine Annahme, der Fehler beschränkt sich auf Cache-Reads dieses einen Tages).
 */
export const PRICES = {
  "claude-sonnet-5-5": [
    { validFrom: null, input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
    { validFrom: "2026-10-07T00:00:00Z", input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
  ],
  "claude-opus-5-5": { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  "claude-opus-5": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-haiku-5-5": {
    input: 0.1,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
    output: 0.5,
    stufen: [{ ueberPrompt: 100_000, input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 }],
  },
  "claude-haiku-4-5": { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
};

const matcherCache = new WeakMap();

/** Je Preistabelle einmal gebaut: [{ key, re }] statt pro Call neuer RegExp. */
function matchersOf(prices) {
  let list = matcherCache.get(prices);
  if (!list) {
    list = Object.keys(prices).map((key) => ({ key, re: new RegExp(`^${key}-\\d{8}$`) }));
    matcherCache.set(prices, list);
  }
  return list;
}

/** Eintrag → die zum Zeitpunkt `ts` gültige Periode (Einzelobjekt gilt immer). Bei einer Periodenliste
 *  und fehlendem/ungültigem `ts` ist die Periode nicht bestimmbar: „ohne Preis" (null), nie still die neueste (#1309). */
export function periodAt(entry, ts) {
  if (!Array.isArray(entry)) return entry;
  const at = Date.parse(ts);
  if (!Number.isFinite(at)) return null;
  const valid = entry.filter((p) => p.validFrom == null || !(at < Date.parse(p.validFrom)));
  return valid.length ? valid[valid.length - 1] : null;
}

/** Exakter Name oder Name mit Datums-Suffix (`-20251001`); `claude-opus-5-5` ist kein Opus 5. */
export function priceFor(model, prices, ts) {
  const id = String(model ?? "");
  const hit = matchersOf(prices).find(({ key, re }) => id === key || re.test(id));
  return hit ? periodAt(prices[hit.key], ts) : null;
}

/** Preise der höchsten Stufe, deren `ueberPrompt` der Prompt strikt übersteigt (unabhängig von der Listenreihenfolge); sonst die Grundpreise. */
function stufePreis(preis, prompt) {
  const treffer = (preis.stufen ?? []).filter((st) => prompt > st.ueberPrompt).sort((a, b) => b.ueberPrompt - a.ueberPrompt)[0];
  return treffer ? { ...preis, ...treffer } : preis;
}

/** Kosten eines Calls je Teil in $; null, wenn das Modell keinen Preis hat. */
export function priceParts(c, prices = PRICES) {
  const base = priceFor(c.model, prices, c.ts);
  if (!base) return null;
  const write = num(c.cacheWrite);
  const p = stufePreis(base, num(c.input) + write + num(c.cacheRead));
  const write1h = Math.min(num(c.cacheWrite1h), write);
  // Division statt Multiplikation mit 1e-6: bleibt bei glatten Zahlen exakt.
  const mio = 1e6;
  return {
    input: (num(c.input) * p.input) / mio,
    cacheWrite: ((write - write1h) * p.cacheWrite5m + write1h * p.cacheWrite1h) / mio,
    cacheRead: (num(c.cacheRead) * p.cacheRead) / mio,
    output: (num(c.output) * p.output) / mio,
  };
}

/** Gesamtkosten eines Calls in $; null = ohne Preis. */
export function priceCall(c, prices = PRICES) {
  const parts = c.costParts ?? priceParts(c, prices);
  return parts ? sumParts(parts) : null;
}

export const sumParts = (p) => p.input + p.cacheWrite + p.cacheRead + p.output;

