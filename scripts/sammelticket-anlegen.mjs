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
 * Mit `--vorgaenger <nr>` nennt der Body den Vorgänger; `blockiert durch #<nr>` steht nur drin, solange er offen ist.
 *
 * Nur Node-Builtins und board-lib.mjs, analog zu board-place.mjs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  LANGFUSE_SAMMELTICKET_TITEL,
  SAMMELTICKET_TITEL,
  addToBoardTodo,
  ergaenzeFehlende,
  loadItems,
  loadOpenIssuePages,
  planFuerArgs,
  sammelticketKorrektur,
  sammelticketPosition,
  setPosition,
} from "./board-lib.mjs";
import { normalizeOffene } from "./board-takt.mjs";

const TITEL = { harness: SAMMELTICKET_TITEL, langfuse: LANGFUSE_SAMMELTICKET_TITEL };
const PRUEF_VERSUCHE = 5;
const PRUEF_PAUSE_MS = 3000;
const NEU_SETZEN_MAX = 2;
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

/** Body des neuen Sammeltickets (Vorlage wie die der früheren Tickets). `blockiert durch #N` nur bei offenem Vorgänger. Pur. */
export function sammelticketBody({ art, vorgaenger = null, vorgaengerOffen = false }) {
  if (!Object.hasOwn(TITEL, art)) throw new Error(`Unbekannte Art: ${String(art)}`);
  const zeilen =
    art === "harness"
      ? ["Sammelticket für Harness-Befunde (AGENTS.md › Harness-Befunde sind Zeilen, keine Tickets). Befunde als Kommentar `- [ ] …` anhängen."]
      : ["Sammelticket für Befunde aus Langfuse-Daten (docs/ticket-reihenfolge.md › Langfuse-Befunde (gesammelt)). Befunde als Kommentar `- [ ] …` anhängen."];
  if (vorgaenger !== null) zeilen[0] += ` Nachfolger von #${vorgaenger}${vorgaengerOffen ? " (dort in Arbeit)" : ""}.`;
  if (vorgaenger !== null && vorgaengerOffen) zeilen.push("", `blockiert durch #${vorgaenger}`);
  return zeilen.join("\n");
}

/** Das ungeclaimte offene Sammelticket mit exaktem Titel (bei mehreren das mit der höchsten Nummer, das jüngste) aus `normalizeOffene`; sonst null. Pur. */
export function vorhandenesSammelticket(offene, titel) {
  const treffer = offene.filter((i) => i.titel === titel && (i.assignees ?? []).length === 0);
  return treffer.length === 0 ? null : treffer.reduce((a, b) => (b.number > a.number ? b : a));
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const ghJson = (args) => JSON.parse(gh(args));

/** Position laut AGENTS.md; wirft, wenn die Datei fehlt oder die Zahl nicht eindeutig ist. */
const positionLautAgentsMd = () => sammelticketPosition(readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8"));

/** Zustand des Vorgängers (offen?) per REST; unlesbar zählt als offen (die Sperre ist die sichere Seite). */
function vorgaengerOffen(nr) {
  try {
    return ghJson(["api", `repos/fluffels/kubernia/issues/${nr}`]).state === "open";
  } catch {
    return true;
  }
}

/** Setzt die Position des Sammeltickets `nr` und prüft sie gegen die frisch geladene Board-Liste. Liefert `ok`, `falsch` oder `unbekannt` (nie in der Liste). */
async function setzeUndPruefe(nr, position, dry) {
  let neuGesetzt = 0;
  for (let versuch = 1; versuch <= PRUEF_VERSUCHE; versuch++) {
    const items = loadItems();
    const ticket = items.find((i) => i.number === nr);
    if (ticket) {
      const k = sammelticketKorrektur(items, position);
      if (!k || k.nr !== nr) return "ok";
      if (dry) return "falsch";
      if (neuGesetzt >= NEU_SETZEN_MAX) return "falsch";
      console.log(`Position stimmt noch nicht (Rang ${k.vonRang}, Ziel ${k.nachRang}): setze neu (${neuGesetzt + 1}/${NEU_SETZEN_MAX}).`);
      setPosition(k.id, k.afterId);
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
  const titel = TITEL[args.art];
  const position = args.art === "harness" ? positionLautAgentsMd() : null;
  const vorhanden = vorhandenesSammelticket(normalizeOffene(loadOpenIssuePages()), titel);
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
    const neu = ghJson(["api", "-X", "POST", "repos/fluffels/kubernia/issues", "-f", `title=${titel}`, "-f", `body=${body}`, "-f", "labels[]=area:harness"]);
    nr = neu.number;
    console.log(`Angelegt: #${nr}`);
    const itemId = addToBoardTodo(neu.node_id);
    if (args.art === "harness") {
      const items = ergaenzeFehlende(loadItems(), [{ id: itemId, number: nr, status: "Todo", title: titel, assignees: [], state: "open" }]);
      const k = sammelticketKorrektur(items, position);
      if (k) setPosition(k.id, k.afterId);
    } else if (args.top) {
      const items = ergaenzeFehlende(loadItems(), [{ id: itemId, number: nr, status: "Todo", title: titel, assignees: [], state: "open" }]);
      for (const { item, afterId } of planFuerArgs(items, { anchor: null, numbers: [nr] }).steps) setPosition(item.id, afterId);
    }
  }
  if (args.art !== "harness") return;
  const stand = await setzeUndPruefe(nr, position, args.dry);
  if (stand === "ok") console.log(`Position geprüft: #${nr} steht auf Position ${position} oder davor.`);
  else if (stand === "unbekannt") console.log(`::warning::#${nr} steht noch nicht in der Board-Liste, die Position ist noch nicht prüfbar: board-place.mjs und der Board-Takt korrigieren sie beim nächsten Lauf.`);
  else {
    console.error(`✖ #${nr} steht nach dem Setzen nicht auf Position ${position}. Erneut fahren oder per board-place.mjs --position ${position} ${nr} setzen.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
