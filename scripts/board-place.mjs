// Kein Shebang (siehe board-lib.mjs).
/**
 * Mehrere Tickets in einem Rutsch einsortieren (#1217), z.B. nach einer Epic-Aufteilung.
 * EINE Listenabfrage, Item-IDs werden wiederverwendet, die Positionen laufen nacheinander mit kurzer
 * Pause — statt je Ticket die komplette Liste neu zu laden (das riss das GraphQL-Rate-Limit).
 *
 *   node scripts/board-place.mjs --top 1240 1241 1242        # in dieser Reihenfolge an die Spitze
 *   node scripts/board-place.mjs --after 1206 1240 1241      # in dieser Reihenfolge hinter #1206
 *   node scripts/board-place.mjs --dry-run --top 1240        # nur anzeigen
 *
 * Nummern, die `gh project item-list` noch nicht liefert (frische Items kommen verzögert), werden
 * gemeldet und übersprungen: später erneut aufrufen. Bei Rate-Limit sofort stoppen, den Rest melden.
 * Danach den Spielrhythmus-Schritt fahren (`node scripts/board-rhythm.mjs`).
 */
import { pathToFileURL } from "node:url";
import { isRateLimit, loadItems, planPlacements, setPosition } from "./board-lib.mjs";

const PAUSE_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Argumente → { mode, anchor, numbers, dry } oder null bei falscher Benutzung. */
export function parseArgs(argv) {
  const dry = argv.includes("--dry-run");
  const rest = argv.filter((a) => a !== "--dry-run");
  const top = rest[0] === "--top";
  const after = rest[0] === "--after";
  if (!top && !after) return null;
  const nums = rest.slice(1).map((a) => Number(a.replace(/^#/, "")));
  if (nums.length === 0 || nums.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  if (top) return { anchor: null, numbers: nums, dry };
  return nums.length < 2 ? null : { anchor: nums[0], numbers: nums.slice(1), dry };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) {
    console.error("Aufruf: board-place.mjs [--dry-run] (--top <nr>... | --after <ankernr> <nr>...)");
    process.exit(2);
  }
  let plan;
  try {
    plan = planPlacements(loadItems(), args.numbers, args.anchor);
  } catch (e) {
    console.error(`✖ Abbruch${isRateLimit(e.message) ? " (API-Rate-Limit)" : ""}: ${e.message.split("\n")[0]}. Später erneut fahren.`);
    process.exit(1);
  }
  const { steps, missing, anchorMissing } = plan;
  if (anchorMissing) {
    console.error(`✖ Anker #${args.anchor} steht nicht in der Board-Liste (frische Items kommen verzögert). Später erneut.`);
    process.exit(1);
  }
  for (const [n, { item, afterId }] of steps.entries()) {
    console.log(`#${item.number} → ${afterId === null ? "Spitze" : "hinter Vorgänger"}`);
    if (args.dry) continue;
    try {
      setPosition(item.id, afterId);
    } catch (e) {
      const rest = steps.slice(n).map((s) => `#${s.item.number}`).join(", ");
      console.error(`✖ Abbruch${isRateLimit(e.message) ? " (API-Rate-Limit)" : ""}: offen bleiben ${rest}. Später erneut fahren.`);
      process.exit(1);
    }
    await sleep(PAUSE_MS);
  }
  if (missing.length > 0) {
    console.error(`⚠ Noch nicht in der Board-Liste: ${missing.map((n) => `#${n}`).join(", ")} — später erneut aufrufen.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
