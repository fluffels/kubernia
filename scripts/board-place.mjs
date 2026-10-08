// Kein Shebang (siehe board-lib.mjs).
/**
 * Mehrere Tickets in einem Rutsch einsortieren (#1217), z.B. nach einer Epic-Aufteilung.
 * EINE Listenabfrage, Item-IDs werden wiederverwendet, die Positionen laufen nacheinander mit kurzer
 * Pause — statt je Ticket die komplette Liste neu zu laden (vermeidet das GraphQL-Rate-Limit).
 *
 *   node scripts/board-place.mjs --top 1240 1241 1242        # an die Spitze, aber hinter das ungeclaimte Sammelticket geklemmt
 *   node scripts/board-place.mjs --notfall rot-main --top 1240   # echter Notfall: wirklich ganz oben
 *   node scripts/board-place.mjs --after 1206 1240 1241      # in dieser Reihenfolge hinter #1206
 *   node scripts/board-place.mjs --dry-run --top 1240        # nur anzeigen
 *   node scripts/board-place.mjs --position 4 1312           # als N. Todo-Item (z.B. Sammelticket, Position laut AGENTS.md)
 *   node scripts/board-place.mjs --missing                   # offene Issues ohne Board-Item (nur Bericht)
 *
 * Nie vor das ungeclaimte Sammelticket: `--top`, `--after` und `--position` klemmen den Anker hinter das offene, nicht zugewiesene
 * Sammelticket „Harness-Härtung (gesammelt)“ (sonst rückt es nicht nach vorn); die Ausgabe nennt die Klemmung. Nur echte Notfälle
 * (`--notfall <art>`, nur mit `--top`) stehen ganz oben. Das Sammelticket selbst (`--position 4 <nr>`) wird nicht geklemmt.
 *
 * Selbstkorrektur (#1390): vor jedem Einsortieren (außer `--notfall`) schiebt das Skript ein ungeclaimtes Harness-Sammelticket, das
 * hinter der Position laut AGENTS.md steht (z.B. am Board-Ende), dorthin zurück (nur nach vorn, nie in den Kopf); sonst klemmte
 * die Klemmung jedes neue Ticket hinter ein ans Ende gerutschtes Sammelticket. `--dry-run` zeigt es nur an. `--notfall <art>` prüft
 * außerdem den Titelmarker des Tickets (docs/ticket-reihenfolge.md): ohne ihn zählt es nicht zum Kopf, Exit 2.
 *
 * Nummern, die die REST-Board-Liste nicht liefert (frische Items kommen teils lange verzögert), holt ein GraphQL-Fallback
 * (`issue.projectItems`, gebündelte Aliase in einer Abfrage); steht ein OFFENES Issue wirklich nicht im Board (frisch per `gh issue create`
 * angelegt, nie aufgenommen), nimmt das Skript es selbst auf (Status Todo, #1428; `--dry-run`: „würde aufnehmen“). Geschlossene, PRs, unbekannte
 * Nummern und der `--after`-Anker werden nie aufgenommen: „fehlt im Board, nicht aufgenommen: <Grund>“, Exit 1.
 * Bei Rate-Limit sofort stoppen, den Rest melden.
 */
import { pathToFileURL } from "node:url";
import {
  NOTFALL_ARTEN,
  REPO,
  abortMessage,
  addToBoardTodo,
  aufnahmePlan,
  ergaenzeFehlende,
  fehlendeNummern,
  ghJson,
  itemsUeberIssues,
  loadItems,
  loadOpenIssueNumbers,
  missingFromBoard,
  notfallTitelFehler,
  planMitKorrektur,
  positionOderWarnung,
  setPosition,
  todoItem,
} from "./board-lib.mjs";

export { NOTFALL_ARTEN };

const PAUSE_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Argumente → { anchor, numbers, dry } bzw. { position, numbers, dry } bzw. { missing } oder null bei falscher Benutzung.
 * `--notfall <art>` (Art aus NOTFALL_ARTEN) gilt nur zusammen mit `--top` und setzt `notfall` im Ergebnis.
 */
export function parseArgs(argv) {
  const dry = argv.includes("--dry-run");
  let rest = argv.filter((a) => a !== "--dry-run");
  const nIdx = rest.indexOf("--notfall");
  let notfall = null;
  if (nIdx >= 0) {
    notfall = rest[nIdx + 1];
    rest = [...rest.slice(0, nIdx), ...rest.slice(nIdx + 2)];
    if (!NOTFALL_ARTEN.includes(notfall) || rest[0] !== "--top") return null;
  }
  const geparst = parseOhneNotfall(rest, dry);
  return geparst && notfall ? { ...geparst, notfall } : geparst;
}

function parseOhneNotfall(rest, dry) {
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

/**
 * Z37 (#1428): Tickets, die auch der GraphQL-Fallback nicht im Board fand (frisch per `gh issue create` angelegt, nie aufgenommen), nimmt das
 * Skript selbst auf (`addProjectV2ItemById` + Status Todo; `--dry-run`: nur Meldung). Nur offene Issues; geschlossene, PRs, unbekannte und der
 * `--after`-Anker nicht (Meldung „fehlt im Board, nicht aufgenommen: <Grund>“, am Ende Exit 1).
 */
function nimmFehlendeAuf(items, args) {
  const fehlend = fehlendeNummern(items, args);
  if (fehlend.length === 0) return items;
  const issues = {};
  for (const nr of fehlend) {
    try {
      issues[nr] = ghJson(["api", `repos/${REPO}/issues/${nr}`]);
    } catch {
      issues[nr] = null;
    }
  }
  const { aufnehmen, abgelehnt } = aufnahmePlan(fehlend, issues, args.anchor);
  for (const a of abgelehnt) console.error(`⚠ #${a.number} fehlt im Board, nicht aufgenommen: ${a.grund}.`);
  const neu = aufnehmen.map((a) => {
    if (args.dry) {
      console.log(`#${a.number} fehlt im Board: würde aufnehmen (Status Todo).`);
      return todoItem({ id: `(neu #${a.number})`, number: a.number, title: a.title });
    }
    console.log(`#${a.number} fehlte im Board: aufgenommen (Status Todo).`);
    return todoItem({ id: addToBoardTodo(a.nodeId), number: a.number, title: a.title });
  });
  return ergaenzeFehlende(items, neu);
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
    console.error("Aufruf: board-place.mjs [--dry-run] ([--notfall <art>] --top <nr>... | --after <ankernr> <nr>... | --position <N> <nr> | --missing)");
    process.exit(2);
  }
  if (args.missing) return reportMissing();
  let plan;
  let korrektur = null;
  try {
    let items = loadItems();
    // Fallback: frisch aufgenommene Items fehlen in der REST-Liste teils lange; ihre Item-ID per GraphQL holen (eine gebündelte Abfrage).
    const fehlend = fehlendeNummern(items, args);
    if (fehlend.length > 0) items = ergaenzeFehlende(items, itemsUeberIssues(fehlend));
    items = nimmFehlendeAuf(items, args);
    if (args.notfall) {
      const fehler = notfallTitelFehler(items, args.numbers, args.notfall);
      if (fehler) {
        console.error(`✖ ${fehler}`);
        process.exit(2);
      }
    }
    ({ korrektur, plan } = planMitKorrektur(items, args, args.notfall ? null : positionOderWarnung()));
    if (plan.klemmung.geklemmt) console.log(`Hinter das ungeclaimte Sammelticket #${plan.klemmung.sammelticket} geklemmt (Notfall: --notfall <art>, nur mit --top, ${NOTFALL_ARTEN.join("|")}).`);
  } catch (e) {
    console.error(`✖ Abbruch: ${abortMessage(e.message)}. Später erneut fahren.`);
    process.exit(1);
  }
  const { steps, missing, anchorMissing } = plan;
  if (anchorMissing) {
    console.error(`✖ Anker #${args.anchor} steht nicht im Board (weder in der REST-Liste noch per GraphQL gefunden).`);
    process.exit(1);
  }
  if (korrektur) {
    console.log(`Sammelticket #${korrektur.nr} stand auf Rang ${korrektur.vonRang}, zurück auf Rang ${korrektur.nachRang} (Position laut AGENTS.md).`);
    if (!args.dry) {
      try {
        setPosition(korrektur.id, korrektur.afterId);
      } catch (e) {
        console.error(`✖ Abbruch bei der Sammelticket-Korrektur: ${abortMessage(e.message)}. Später erneut fahren.`);
        process.exit(1);
      }
      await sleep(PAUSE_MS);
    }
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
    console.error(`⚠ Nicht im Board gefunden (auch nicht per GraphQL): ${missing.map((n) => `#${n}`).join(", ")}.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
