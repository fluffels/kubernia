// Kein Shebang (siehe board-lib.mjs).
/**
 * Mehrere Tickets in einem Rutsch einsortieren (#1217), z.B. nach einer Epic-Aufteilung.
 * EINE Listenabfrage, Item-IDs werden wiederverwendet, die Positionen laufen nacheinander mit kurzer
 * Pause — statt je Ticket die komplette Liste neu zu laden (vermeidet das GraphQL-Rate-Limit).
 *
 *   node scripts/board-place.mjs --top 1240 1241 1242        # in dieser Reihenfolge an die Spitze
 *   node scripts/board-place.mjs --after 1206 1240 1241      # in dieser Reihenfolge hinter #1206
 *   node scripts/board-place.mjs --dry-run --top 1240        # nur anzeigen
 *   node scripts/board-place.mjs --position 6 1312           # als N. Todo-Item (z.B. Sammelticket)
 *   node scripts/board-place.mjs --missing                   # offene Issues ohne Board-Item (nur Bericht)
 *
 * Nummern, die die Board-Liste noch nicht liefert (frische Items kommen verzögert), werden
 * gemeldet und übersprungen: später erneut aufrufen. Bei Rate-Limit sofort stoppen, den Rest melden.
 */
import { pathToFileURL } from "node:url";
import { abortMessage, ankerNummerFuerPosition, loadItems, loadOpenIssueNumbers, missingFromBoard, planPlacements, setPosition } from "./board-lib.mjs";

const PAUSE_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Argumente → { anchor, numbers, dry } bzw. { position, numbers, dry } bzw. { missing } oder null bei falscher Benutzung. */
export function parseArgs(argv) {
  const dry = argv.includes("--dry-run");
  const rest = argv.filter((a) => a !== "--dry-run");
  if (rest.length === 1 && rest[0] === "--missing") return { missing: true, dry };
  if (rest[0] === "--position") {
    const [n, nr, ...more] = rest.slice(1).map((a) => Number(a.replace(/^#/, "")));
    if (more.length > 0 || ![n, nr].every((x) => Number.isInteger(x) && x > 0)) return null;
    return { anchor: null, position: n, numbers: [nr], dry };
  }
  const top = rest[0] === "--top";
  const after = rest[0] === "--after";
  if (!top && !after) return null;
  const nums = rest.slice(1).map((a) => Number(a.replace(/^#/, "")));
  if (nums.length === 0 || nums.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  if (top) return { anchor: null, numbers: nums, dry };
  return nums.length < 2 ? null : { anchor: nums[0], numbers: nums.slice(1), dry };
}

/** Bericht: offene Issues, die nicht auf dem Board stehen (Einsortieren bleibt eine Abwägung der Agentin). */
function reportMissing() {
  try {
    const missing = missingFromBoard(loadOpenIssueNumbers(), loadItems());
    console.log(missing.length === 0 ? "Alle offenen Issues stehen im Board." : `Offen, aber nicht im Board: ${missing.map((n) => `#${n}`).join(", ")}`);
  } catch (e) {
    console.error(`✖ Abbruch: ${abortMessage(e.message)}.`);
    process.exit(1);
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) {
    console.error("Aufruf: board-place.mjs [--dry-run] (--top <nr>... | --after <ankernr> <nr>... | --position <N> <nr> | --missing)");
    process.exit(2);
  }
  if (args.missing) return reportMissing();
  let plan;
  try {
    const items = loadItems();
    if (args.position) {
      plan = planPlacements(items, args.numbers, ankerNummerFuerPosition(items, args.position, args.numbers[0]));
    } else plan = planPlacements(items, args.numbers, args.anchor);
  } catch (e) {
    console.error(`✖ Abbruch: ${abortMessage(e.message)}. Später erneut fahren.`);
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
      console.error(`✖ Abbruch: ${abortMessage(e.message)}. Offen bleiben ${rest}. Später erneut fahren.`);
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
