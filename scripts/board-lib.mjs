// Kein Shebang: wird von board-place.mjs gestartet UND von test/board.test.ts importiert.
/**
 * Board-Helfer (#1217): Einsortieren mehrerer Tickets mit EINER Listenabfrage als pure, getestete
 * Funktion (test/board.test.ts); nur die gh-Aufrufe ganz unten sind ungetestet.
 *
 * Item-Form (normalisiert aus `gh project item-list`): { id, number }.
 *
 * Nur Node-Builtins, analog zu den anderen scripts/-Wächtern.
 */
import { execFileSync } from "node:child_process";

export const PROJECT_ID = "PVT_kwHOD8746c4Barq_";

/**
 * Einsortieren mehrerer Tickets: `numbers` in der gewünschten Reihenfolge hinter `afterNumber`
 * (oder an die Spitze bei null). Liefert die Positionsschritte [{ item, afterId }], wobei jedes Item
 * am Vorgänger hängt (Reihenfolge bleibt erhalten), und `missing`: Nummern, die (noch) nicht in der
 * Liste stehen (`gh project item-list` liefert frische Items verzögert).
 */
export function planPlacements(items, numbers, afterNumber = null) {
  const byNumber = new Map(items.map((i) => [i.number, i]));
  const missing = numbers.filter((n) => !byNumber.has(n));
  let afterId = null;
  if (afterNumber !== null) {
    const anchor = byNumber.get(afterNumber);
    if (!anchor) return { steps: [], missing, anchorMissing: true };
    afterId = anchor.id;
  }
  const steps = [];
  for (const n of numbers) {
    const item = byNumber.get(n);
    if (!item) continue;
    steps.push({ item, afterId });
    afterId = item.id;
  }
  return { steps, missing, anchorMissing: false };
}

/** True bei GitHubs Rate-Limit-Fehler (Meldung der gh-CLI/GraphQL). */
export const isRateLimit = (message) => /rate limit/i.test(String(message ?? ""));

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Eine Listenabfrage: alle Issue-Items des Boards in Board-Reihenfolge. Bricht laut ab, wenn die
 *  Liste abgeschnitten ist (mehr Items als `--limit`), statt Nummern still als fehlend zu melden. */
export function loadItems() {
  const raw = JSON.parse(gh(["project", "item-list", "1", "--owner", "fluffels", "--format", "json", "--limit", "800"]));
  if (typeof raw.totalCount === "number" && raw.totalCount > raw.items.length) {
    throw new Error(`Board-Liste abgeschnitten (${raw.items.length} von ${raw.totalCount}), --limit erhöhen.`);
  }
  return raw.items.filter((i) => i.content?.type === "Issue").map((i) => ({ id: i.id, number: i.content.number }));
}

/** Position setzen: hinter `afterId`, null = an die Spitze. */
export function setPosition(itemId, afterId) {
  const query =
    "mutation($p:ID!,$i:ID!,$a:ID){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){ items(first:1){ nodes{ id } } } }";
  const args = ["api", "graphql", "-f", `query=${query}`, "-f", `p=${PROJECT_ID}`, "-f", `i=${itemId}`];
  if (afterId) args.push("-f", `a=${afterId}`);
  gh(args);
}
