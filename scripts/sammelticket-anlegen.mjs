#!/usr/bin/env node
// Kein weiterer Shebang-Zwang: wird von Agenten gestartet UND von test/sammelticket-anlegen.test.ts importiert.
/**
 * Sammelticket anlegen, einsortieren und die Position prüfen (#1390), statt des früheren Doku-Snippets: das Anlegen des Nachfolgers
 * lief einmal nicht bis zur Position, das Ticket stand am Board-Ende und klemmte jedes neue `--top`-Ticket dorthin.
 *
 *   node scripts/sammelticket-anlegen.mjs harness [--vorgaenger <nr>] [--dry-run]   # Harness-Sammelticket auf der Position laut AGENTS.md
 *   node scripts/sammelticket-anlegen.mjs langfuse [--top] [--dry-run]              # Langfuse-Sammelticket (mit --top hinter den Sammelblock)
 *
 * Idempotent: gibt es schon ein ungeclaimtes Sammelticket dieser Art, legt das Skript nichts an (bei `harness` korrigiert es nur die
 * Position). Sonst: Issue per REST anlegen (Label `area:harness`, kein Assignee, kein Such-Index), ins Board holen (Status Todo),
 * auf Position bringen (`sammelticketKorrektur`), dann prüfen: die Board-Liste liefert Neues verzögert, darum bis zu 5 Ladeversuche mit
 * Pause; steht das Ticket falsch, wird es bis zu zweimal neu gesetzt (sonst Exit 1). Erscheint es nie in der Liste, warnt das Skript
 * (Exit 0): `board-place.mjs` und der Board-Takt (`board-takt.mjs`) korrigieren die Position beim nächsten Lauf selbst.
 * Race-fest (#1561): `vorhanden` wird per Direktabruf (`repos/<repo>/issues/<nr>`) bestätigt, weil die Listen-Abfrage nachhinkt (ein gerade geschlossenes
 * Ticket stand noch als offen und ungeclaimt darin, Evidenz #1560/#1561). Nach dem Anlegen und nach der Positions-Schleife läuft ein Dubletten-Check:
 * gibt es ein älteres offenes ungeclaimtes Ticket gleichen Titels, schließt das Skript das eigene (Kommentar, `not planned`, Exit 0; ein Item, das schon im Board stand, bleibt dort geschlossen liegen); hat das eigene
 * schon Kommentare, warnt es nur.
 * Mit `--vorgaenger <nr>` nennt der Body den Vorgänger; `blockiert durch #<nr>` steht nur drin, solange er offen ist.
 *
 * Nur Node-Builtins und board-lib.mjs, analog zu board-place.mjs.
 */
import { pathToFileURL } from "node:url";
import { mitKontingent } from "./gh-kontingent.mjs";
import {
  LANGFUSE_SAMMELTICKET_TITEL,
  REPO,
  SAMMELTICKET_TITEL,
  addToBoardTodo,
  ergaenzeFehlende,
  ghJson,
  loadItems,
  loadOpenIssuePages,
  normalizeOffene,
  planMitKorrektur,
  positionLautAgentsMd,
  positionOderWarnung,
  sammelticketKorrektur,
  setPosition,
  todoItem,
} from "./board-lib.mjs";

const TITEL = { harness: SAMMELTICKET_TITEL, langfuse: LANGFUSE_SAMMELTICKET_TITEL };
const PRUEF_VERSUCHE = 5;
const PRUEF_PAUSE_MS = 3000;
const NEU_SETZEN_MAX = 2;
const DUBLETTEN_PAUSE_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Argumente → `{ art, vorgaenger, top, dry }` oder null bei falscher Benutzung. `--vorgaenger` gilt nur für `harness`, `--top` nur für `langfuse`. Pur. */
export function parseArgs(argv) {
  const dry = argv.includes("--dry-run");
  const [art, ...rest] = argv.filter((a) => a !== "--dry-run");
  if (!Object.hasOwn(TITEL, art ?? "")) return null;
  if (art === "langfuse") return rest.length === 0 ? { art, vorgaenger: null, top: false, dry } : rest.length === 1 && rest[0] === "--top" ? { art, vorgaenger: null, top: true, dry } : null;
  if (rest.length === 0) return { art, vorgaenger: null, top: false, dry };
  const nr = Number((rest[1] ?? "").replace(/^#/, ""));
  return rest.length === 2 && rest[0] === "--vorgaenger" && Number.isInteger(nr) && nr > 0 ? { art, vorgaenger: nr, top: false, dry } : null;
}

/** Body des neuen Sammeltickets (Vorlage wie die der früheren Tickets). `blockiert durch #N` nur bei offenem Vorgänger, mit dem Zusatz, dass die Sperre nur gilt, solange er offen ist (die Zeile bleibt nach dessen Merge stehen). Pur. */
export function sammelticketBody({ art, vorgaenger = null, vorgaengerOffen = false }) {
  if (!Object.hasOwn(TITEL, art)) throw new Error(`Unbekannte Art: ${String(art)}`);
  const zeilen =
    art === "harness"
      ? ["Sammelticket für Harness-Befunde (AGENTS.md › Harness-Befunde sind Zeilen, keine Tickets). Befunde als Kommentar `- [ ] …` anhängen."]
      : ["Sammelticket für Befunde aus Langfuse-Daten (docs/ticket-reihenfolge.md › Langfuse-Befunde (gesammelt)). Befunde als Kommentar `- [ ] …` anhängen."];
  if (vorgaenger !== null) zeilen[0] += ` Nachfolger von #${vorgaenger}${vorgaengerOffen ? " (dort in Arbeit)" : ""}.`;
  if (vorgaenger !== null && vorgaengerOffen) zeilen.push("", `blockiert durch #${vorgaenger} (nur solange #${vorgaenger} offen ist)`);
  return zeilen.join("\n");
}

/** Die Kandidaten (offen laut Liste aus `normalizeOffene`, exakter Titel, ungeclaimt) in absteigender Nummer (das jüngste zuerst). Pur. */
export function kandidatenSammelticket(offene, titel) {
  return offene.filter((i) => i.titel === titel && (i.assignees ?? []).length === 0).sort((a, b) => b.number - a.number);
}

/**
 * Das höchste Ticket der absteigend geprüften `kandidaten`, das der Direktabruf `einzeln(nr)` (REST-Form: `state`, `assignees`) als offen und
 * ungeclaimt bestätigt; sonst null. Die Listen-Abfrage hinkt nach, nur der Einzelabruf ist maßgeblich. Ein werfender Abruf wirft weiter. Pur bis auf `einzeln`.
 */
export function waehleBestaetigtes(kandidaten, einzeln) {
  for (const k of [...kandidaten].sort((a, b) => b.number - a.number)) {
    const e = einzeln(k.number);
    if (e && e.state === "open" && (e.assignees ?? []).length === 0) return k;
  }
  return null;
}

/**
 * Dubletten-Entscheidung nach dem Anlegen von `eigenNr`: `andere` sind bestätigt offene Tickets (siehe `waehleBestaetigtes`). Gibt es ein
 * ungeclaimtes mit gleichem `titel` und kleinerer Nummer, ist das ältere das Original: `eigenes-schliessen`, bei schon vorhandenen Kommentaren
 * des eigenen (Zeilen, die nicht verloren gehen dürfen) nur `warnung`. Sonst `keine`. Pur.
 */
export function dublettenEntscheidung({ eigenNr, titel, eigenKommentare, andere }) {
  const aeltere = andere.filter((i) => i.titel === titel && i.number < eigenNr && (i.assignees ?? []).length === 0);
  if (aeltere.length === 0) return { art: "keine" };
  const aelter = Math.min(...aeltere.map((i) => i.number));
  return eigenKommentare > 0 ? { art: "warnung", aelter } : { art: "eigenes-schliessen", aelter };
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
const einzelAbruf = (nr) => ghJson(["api", `repos/${REPO}/issues/${nr}`]);

/** Dubletten-Check für das frisch angelegte Ticket `nr`: lädt die offenen Issues frisch, bestätigt das älteste Original per Direktabruf. */
function pruefeDublette(nr, titel) {
  const kandidaten = kandidatenSammelticket(normalizeOffene(loadOpenIssuePages()), titel).filter((i) => i.number < nr);
  const aelter = waehleBestaetigtes(kandidaten, einzelAbruf);
  return dublettenEntscheidung({ eigenNr: nr, titel, eigenKommentare: einzelAbruf(nr).comments ?? 0, andere: aelter ? [aelter] : [] });
}

/** Wertet `pruefeDublette` aus: schließt das eigene Ticket bei einer Dublette (`true`), warnt sonst. */
function schliesseWennDublette(nr, titel) {
  const d = pruefeDublette(nr, titel);
  if (d.art === "warnung") console.log(`::warning::#${nr} ist eine Dublette von #${d.aelter}, hat aber schon Kommentare: nicht geschlossen, Zeilen von Hand nach #${d.aelter} übertragen und #${nr} schließen.`);
  if (d.art !== "eigenes-schliessen") return false;
  ghJson(["api", "-X", "POST", `repos/${REPO}/issues/${nr}/comments`, "-f", `body=Dublette von #${d.aelter} (Wettlauf beim Anlegen)`]);
  ghJson(["api", "-X", "PATCH", `repos/${REPO}/issues/${nr}`, "-f", "state=closed", "-f", "state_reason=not_planned"]);
  console.log(`Dublette von #${d.aelter} (Wettlauf beim Anlegen): #${nr} geschlossen (stand es schon im Board, bleibt das Item dort geschlossen liegen). Das Original ist #${d.aelter}.`);
  return true;
}
/** Zustand des Vorgängers (offen?) per REST; unlesbar zählt als offen (die Sperre ist die sichere Seite). */
function vorgaengerOffen(nr) {
  try {
    return ghJson(["api", `repos/${REPO}/issues/${nr}`]).state === "open";
  } catch {
    return true;
  }
}

/**
 * Ein Prüfschritt: was ist mit dem Sammelticket `nr` auf der frisch geladenen Board-Liste `items` zu tun? Liefert
 * `{ art: "ok" }` (steht auf Position `position` oder davor), `{ art: "warte" }` (noch nicht in der Liste), `{ art: "setze", k }`
 * (neu setzen, `k` aus sammelticketKorrektur) oder `{ art: "falsch" }` (nach `NEU_SETZEN_MAX` Versuchen oder im Trockenlauf noch
 * falsch). Andere ungeclaimte Harness-Sammeltickets bleiben außen vor, damit die Prüfung die Position von `nr` bewertet und nicht die
 * des obersten. Pur.
 */
export function pruefSchritt({ items, nr, position, neuGesetzt = 0, dry = false }) {
  if (!items.some((i) => i.number === nr)) return { art: "warte" };
  const ohneAndere = items.filter((i) => i.number === nr || !(i.title === SAMMELTICKET_TITEL && i.state === "open" && (i.assignees ?? []).length === 0));
  const k = sammelticketKorrektur(ohneAndere, position);
  if (!k || k.nr !== nr) return { art: "ok" };
  if (dry || neuGesetzt >= NEU_SETZEN_MAX) return { art: "falsch" };
  return { art: "setze", k };
}

/** Setzt die Position des Sammeltickets `nr` nach `pruefSchritt` und prüft sie gegen die frisch geladene Board-Liste. Liefert `ok`, `falsch` oder `unbekannt` (nie in der Liste). */
async function setzeUndPruefe(nr, position, dry) {
  let neuGesetzt = 0;
  for (let versuch = 1; versuch <= PRUEF_VERSUCHE; versuch++) {
    const schritt = pruefSchritt({ items: loadItems(), nr, position, neuGesetzt, dry });
    if (schritt.art === "ok" || schritt.art === "falsch") return schritt.art;
    if (schritt.art === "setze") {
      console.log(`Position stimmt noch nicht (Rang ${schritt.k.vonRang}, Ziel ${schritt.k.nachRang}): setze neu (${neuGesetzt + 1}/${NEU_SETZEN_MAX}).`);
      setPosition(schritt.k.id, schritt.k.afterId);
      neuGesetzt++;
    }
    await sleep(PRUEF_PAUSE_MS);
  }
  return neuGesetzt === 0 ? "unbekannt" : "falsch";
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) {
    console.error("Aufruf: sammelticket-anlegen.mjs harness [--vorgaenger <nr>] [--dry-run] | langfuse [--top] [--dry-run]");
    process.exit(2);
  }
  mitKontingent("sammelticket-anlegen");
  const titel = TITEL[args.art];
  const position = args.art === "harness" ? positionLautAgentsMd() : null;
  const vorhanden = waehleBestaetigtes(kandidatenSammelticket(normalizeOffene(loadOpenIssuePages()), titel), einzelAbruf);
  let nr;
  if (vorhanden) {
    nr = vorhanden.number;
    console.log(`Ungeclaimtes „${titel}“ gibt es schon: #${nr}, nichts wird angelegt.`);
  } else if (args.dry) {
    console.log(`Würde „${titel}“ anlegen${position ? ` und auf Position ${position} setzen` : ""}.`);
    return;
  } else {
    const offen = args.vorgaenger === null ? false : vorgaengerOffen(args.vorgaenger);
    const body = sammelticketBody({ art: args.art, vorgaenger: args.vorgaenger, vorgaengerOffen: offen });
    const neu = ghJson(["api", "-X", "POST", `repos/${REPO}/issues`, "-f", `title=${titel}`, "-f", `body=${body}`, "-f", "labels[]=area:harness"]);
    nr = neu.number;
    console.log(`Angelegt: #${nr}`);
    await sleep(DUBLETTEN_PAUSE_MS); // die Liste hinkt nach: erst nach einer Pause sieht ein paralleler Lauf dieses Ticket und umgekehrt
    if (schliesseWennDublette(nr, titel)) return;
    const itemId = addToBoardTodo(neu.node_id);
    if (args.art === "harness") {
      const items = ergaenzeFehlende(loadItems(), [todoItem({ id: itemId, number: nr, title: titel })]);
      const k = sammelticketKorrektur(items, position);
      if (k) setPosition(k.id, k.afterId);
    } else if (args.top) {
      const items = ergaenzeFehlende(loadItems(), [todoItem({ id: itemId, number: nr, title: titel })]);
      // Wie board-place: ein falsch stehendes Harness-Sammelticket zuerst zurückschieben, sonst klemmt das neue Ticket hinter dessen falschen Platz.
      // Fehlt die Position, warnt das Skript und plant ohne Korrektur (nur `harness` braucht sie zwingend).
      const { korrektur, plan } = planMitKorrektur(items, { anchor: null, numbers: [nr] }, positionOderWarnung());
      if (korrektur) setPosition(korrektur.id, korrektur.afterId);
      for (const { item, afterId } of plan.steps) setPosition(item.id, afterId);
    }
  }
  if (args.art !== "harness") return;
  const stand = await setzeUndPruefe(nr, position, args.dry);
  if (!vorhanden && !args.dry && schliesseWennDublette(nr, titel)) return; // zweiter Check: ein paralleler Lauf kann erst während der Positions-Schleife sichtbar werden
  if (stand === "ok") console.log(`Position geprüft: #${nr} steht auf Position ${position} oder davor.`);
  else if (stand === "unbekannt") console.log(`::warning::#${nr} steht noch nicht in der Board-Liste, die Position ist noch nicht prüfbar: board-place.mjs und der Board-Takt korrigieren sie beim nächsten Lauf.`);
  else if (args.dry) console.log(`Trockenlauf: #${nr} steht nicht auf Position ${position}, ein echter Lauf würde es neu setzen.`);
  else {
    console.error(`✖ #${nr} steht nach dem Setzen nicht auf Position ${position}. Erneut fahren oder per board-place.mjs --position ${position} ${nr} setzen.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
