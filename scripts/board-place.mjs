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
 *   node scripts/board-place.mjs --missing                   # offene Issues ohne Board-Item auf irgendeinem Board (nur Bericht)
 *
 * Zwei Boards (ADR 0022 F11, #1729): das Ziel-Board bestimmt die Trennregel (`boardRolleFuer` der Labels: `area:harness` Factory, sonst Produkt;
 * Labels aus dem Board-Item, für Nummern ohne Item aus der Issue-REST). Gemischte Nummern und ein `--after`-Anker nur auf dem anderen Board
 * sind Exit 2. Steht eine Nummer auf beiden Boards, meldet das Skript es und sortiert auf dem Board laut Trennregel; eine Nummer nur auf dem
 * anderen Board wird zusätzlich auf dem Ziel-Board aufgenommen (Entfernen ist nicht Aufgabe dieses Skripts).
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
import { mitKontingent } from "./kontingent-lib.mjs";
import {
  NOTFALL_ARTEN,
  REPO,
  abortMessage,
  addToBoardTodo,
  boardFuerRolle,
  boardRolleFuer,
  aufnahmePlan,
  ergaenzeFehlende,
  fehlendeNummern,
  ghJson,
  itemsUeberIssues,
  loadItems,
  loadOpenIssueNumbers,
  missingFromBoard,
  mitWiederholung,
  notfallTitelFehler,
  planMitKorrektur,
  positionOderWarnung,
  setPosition,
  todoItem,
  wirklichFehlend,
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
export function nimmFehlendeAuf(items, args, io = {}) {
  const { ghJson: lade = ghJson, addToBoardTodo: aufnehmenIns, log = console.log, warn = console.error } = io;
  const fehlend = fehlendeNummern(items, args);
  if (fehlend.length === 0) return items;
  const issues = {};
  for (const nr of fehlend) {
    try {
      issues[nr] = lade(["api", `repos/${REPO}/issues/${nr}`]);
    } catch {
      issues[nr] = null;
    }
  }
  const { aufnehmen, abgelehnt } = aufnahmePlan(fehlend, issues, args.anchor);
  for (const a of abgelehnt) warn(`⚠ #${a.number} fehlt im Board, nicht aufgenommen: ${a.grund}.`);
  const neu = aufnehmen.map((a) => {
    if (args.dry) {
      log(`#${a.number} fehlt im Board: würde aufnehmen (Status Todo).`);
      return todoItem({ id: `(neu #${a.number})`, number: a.number, title: a.title });
    }
    log(`#${a.number} fehlte im Board: aufgenommen (Status Todo).`);
    return todoItem({ id: aufnehmenIns(a.nodeId), number: a.number, title: a.title });
  });
  return ergaenzeFehlende(items, neu);
}

/**
 * Das Ziel-Board einer Einsortier-Aktion (Trennregel, #1729). `produkt`/`factory`: Items beider Boards (mit `labels`), `labelsRest`: Nummer → Labels aus
 * der Issue-REST (für Nummern, deren Item keine Labels trägt). Liefert `{ rolle, doppelt }` (`doppelt`: Nummern auf beiden Boards) oder `{ fehler }`
 * bei gemischten Rollen, einem `--after`-Anker nur auf dem anderen Board oder nicht bestimmbarer Rolle. Pur.
 */
export function zielRolle({ numbers, anchor = null, produkt, factory, labelsRest = {} }) {
  const stehtAuf = (liste, nr) => liste.find((i) => i.number === nr);
  const rollen = new Map();
  for (const nr of numbers) {
    const labels = [stehtAuf(produkt, nr), stehtAuf(factory, nr)].map((i) => i?.labels).find(Array.isArray) ?? labelsRest[nr];
    if (!Array.isArray(labels)) return { fehler: `#${nr}: Board-Rolle nicht bestimmbar (weder Labels im Board-Item noch aus dem Issue)` };
    rollen.set(nr, boardRolleFuer(labels));
  }
  const verschieden = new Set(rollen.values());
  if (verschieden.size !== 1) return { fehler: `gemischte Nummern: ${[...rollen].map(([nr, rolle]) => `#${nr} ${rolle}`).join(", ")}; getrennt einsortieren` };
  const rolle = [...verschieden][0];
  const ziel = rolle === "factory" ? factory : produkt;
  const fremd = rolle === "factory" ? produkt : factory;
  if (anchor !== null && !stehtAuf(ziel, anchor) && stehtAuf(fremd, anchor)) {
    return { fehler: `Anker #${anchor} steht nur auf dem ${rolle === "factory" ? "Produkt" : "Factory"}-Board, die Nummern gehören auf das ${rolle === "factory" ? "Factory" : "Produkt"}-Board` };
  }
  return { rolle, doppelt: numbers.filter((nr) => stehtAuf(produkt, nr) && stehtAuf(factory, nr)) };
}

/** Bericht: offene Issues, die auf keinem Board stehen; REST-Treffer werden per GraphQL gegengeprüft (frische Items fehlen in der REST-Liste teils lange, #1628). */
function reportMissing() {
  try {
    const beide = ["produkt", "factory"].map((rolle) => ({ rolle, items: loadItems(boardFuerRolle(rolle)) }));
    const rest = missingFromBoard(loadOpenIssueNumbers(), beide.flatMap((b) => b.items));
    const missing = rest.length === 0 ? [] : wirklichFehlend(rest, beide.flatMap((b) => itemsUeberIssues(boardFuerRolle(b.rolle), rest)));
    console.log(missing.length === 0 ? "Alle offenen Issues stehen im Board." : `Offen, aber nicht im Board: ${missing.map((n) => `#${n}`).join(", ")}`);
  } catch (e) {
    console.error(`✖ Abbruch: ${abortMessage(e.message)}.`);
    process.exit(1);
  }
}

/** Labels eines Issues per REST (für Nummern ohne Board-Item mit Labels); `null` bei einem Ladefehler (dann ist die Rolle nicht bestimmbar). */
function ladeLabels(nr) {
  try {
    return (ghJson(["api", `repos/${REPO}/issues/${nr}`]).labels ?? []).map((l) => (typeof l === "string" ? l : l?.name));
  } catch {
    return null;
  }
}

/** Fehler mit Exit-Code: `einsortieren` wirft statt `process.exit`, damit `mitWiederholung` vorübergehende Wettläufe wiederholen kann. */
const abbruch = (message, exitCode = 1) => Object.assign(new Error(message), { exitCode });

/** Ein Durchlauf: laden, aufnehmen, planen, positionieren. Wirft bei jedem Fehler (`exitCode` am Fehler, Standard 1). */
async function einsortieren(args) {
  const listen = { produkt: loadItems(boardFuerRolle("produkt")), factory: loadItems(boardFuerRolle("factory")) };
  const labelsRest = {};
  for (const nr of args.numbers) {
    if (![...listen.produkt, ...listen.factory].some((i) => i.number === nr && Array.isArray(i.labels))) labelsRest[nr] = ladeLabels(nr);
  }
  const ziel = zielRolle({ numbers: args.numbers, anchor: args.anchor ?? null, ...listen, labelsRest });
  if (ziel.fehler) throw abbruch(ziel.fehler, 2);
  for (const nr of ziel.doppelt) console.error(`⚠ #${nr} steht auf beiden Boards; eingeordnet auf dem ${ziel.rolle}-Board (Trennregel).`);
  const board = boardFuerRolle(ziel.rolle);
  let items = listen[ziel.rolle];
  // Fallback: frisch aufgenommene Items fehlen in der REST-Liste teils lange; ihre Item-ID per GraphQL holen (eine gebündelte Abfrage).
  const fehlend = fehlendeNummern(items, args);
  if (fehlend.length > 0) items = ergaenzeFehlende(items, itemsUeberIssues(board, fehlend));
  items = nimmFehlendeAuf(items, args, { addToBoardTodo: (nodeId, opts) => addToBoardTodo(board, nodeId, opts) });
  if (args.notfall) {
    const fehler = notfallTitelFehler(items, args.numbers, args.notfall);
    if (fehler) throw abbruch(fehler, 2);
  }
  const { korrektur, plan } = planMitKorrektur(items, args, args.notfall ? null : positionOderWarnung());
  if (plan.klemmung.geklemmt) console.log(`Hinter das ungeclaimte Sammelticket #${plan.klemmung.sammelticket} geklemmt (Notfall: --notfall <art>, nur mit --top, ${NOTFALL_ARTEN.join("|")}).`);
  const { steps, missing, anchorMissing } = plan;
  if (anchorMissing) throw abbruch(`Anker #${args.anchor} steht nicht im Board (weder in der REST-Liste noch per GraphQL gefunden).`);
  if (korrektur) {
    console.log(`Sammelticket #${korrektur.nr} stand auf Rang ${korrektur.vonRang}, zurück auf Rang ${korrektur.nachRang} (Position laut AGENTS.md).`);
    if (!args.dry) {
      setPosition(board, korrektur.id, korrektur.afterId);
      await sleep(PAUSE_MS);
    }
  }
  for (const [n, { item, afterId }] of steps.entries()) {
    console.log(`#${item.number} → ${afterId === null ? "Spitze" : "hinter Vorgänger"}`);
    if (args.dry) continue;
    try {
      setPosition(board, item.id, afterId);
    } catch (e) {
      const rest = steps.slice(n).map((x) => `#${x.item.number}`).join(", ");
      throw abbruch(`${abortMessage(e.message)}. Offen bleiben ${rest}`);
    }
    await sleep(PAUSE_MS);
  }
  if (missing.length > 0) throw abbruch(`Nicht im Board gefunden (auch nicht per GraphQL): ${missing.map((n) => `#${n}`).join(", ")}`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) {
    console.error("Aufruf: board-place.mjs [--dry-run] ([--notfall <art>] --top <nr>... | --after <ankernr> <nr>... | --position <N> <nr> | --missing)");
    process.exit(2);
  }
  mitKontingent("board-place");
  if (args.missing) return reportMissing();
  try {
    // Wettlauf (#1628): ein frisch angelegtes Issue hat teils noch keinen GraphQL-Node; vorübergehende Fehler werden mit Pause wiederholt.
    await mitWiederholung(
      () => einsortieren(args),
      { schlafe: sleep },
    );
  } catch (e) {
    console.error(`✖ ${e.exitCode ? e.message : `Abbruch: ${abortMessage(e.message)}. Später erneut fahren.`}`);
    process.exit(e.exitCode ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
