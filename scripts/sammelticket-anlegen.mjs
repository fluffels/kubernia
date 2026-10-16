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
import { istVertraut } from "./fremdtext-lib.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import {
  LANGFUSE_SAMMELTICKET_TITEL,
  REPO,
  SAMMELTICKET_TITEL,
  addToBoardTodo,
  ergaenzeFehlende,
  ghJson,
  kandidatenSammelticket,
  waehleBestaetigtes,
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

/** Ab so vielen offenen Zeilen im jüngsten ungeclaimten Harness-Sammelticket legt `--generation` den Nachfolger an (ADR 0026). */
export const SAMMEL_ZEILEN_GRENZE = 12;

/**
 * Argumente → `{ art, vorgaenger, top, dry, generation }` oder null bei falscher Benutzung. `--vorgaenger` und `--generation` gelten nur für
 * `harness` und schließen sich aus, `--top` nur für `langfuse`. Pur.
 */
export function parseArgs(argv) {
  const dry = argv.includes("--dry-run");
  const [art, ...rest] = argv.filter((a) => a !== "--dry-run");
  if (!Object.hasOwn(TITEL, art ?? "")) return null;
  const basis = { art, vorgaenger: null, top: false, dry, generation: false };
  if (art === "langfuse") return rest.length === 0 ? basis : rest.length === 1 && rest[0] === "--top" ? { ...basis, top: true } : null;
  if (rest.length === 0) return basis;
  if (rest.length === 1 && rest[0] === "--generation") return { ...basis, generation: true };
  const nr = Number((rest[1] ?? "").replace(/^#/, ""));
  return rest.length === 2 && rest[0] === "--vorgaenger" && Number.isInteger(nr) && nr > 0 ? { ...basis, vorgaenger: nr } : null;
}

/**
 * Zählt die Befundzeilen (`- [ ]`, auch `*` und eingerückt) in den Kommentaren VERTRAUTER Autoren (`vertraut(user)`, Liste aus
 * fremdtext-lib.mjs). `nurOffen` (Standard) zählt nur `[ ]`, sonst auch `[x]`. Kommentare ohne Checkbox, fremde oder ohne `user` zählen nicht. Pur.
 */
export function zaehleBefundZeilen(kommentare, { vertraut, nurOffen = true }) {
  const muster = nurOffen ? /^\s*[-*]\s+\[ \]/ : /^\s*[-*]\s+\[[ xX]\]/;
  let n = 0;
  for (const k of kommentare) {
    if (!vertraut(k.user ?? null)) continue;
    n += String(k.body ?? "").split(/\r?\n/).filter((z) => muster.test(z)).length;
  }
  return n;
}

/** `nachfolger`, sobald `zeilen` die Grenze erreicht (>=), sonst `nichts`. Eine Grenze unter 1 oder keine Ganzzahl wirft. Pur. */
export function entscheideGeneration({ zeilen, grenze = SAMMEL_ZEILEN_GRENZE }) {
  if (!Number.isInteger(grenze) || grenze < 1) throw new Error(`Ungültige Grenze: ${String(grenze)}`);
  return zeilen >= grenze ? "nachfolger" : "nichts";
}

/** Kommentar an den vollen Vorgänger. Pur. */
export const generationsKommentar = ({ zeilen, nachfolger }) => `Generation voll (${zeilen} Zeilen), neue Zeilen in #${nachfolger}`;

/**
 * Der Entscheidungsteil von `--generation`: das jüngste ungeclaimte, per Direktabruf bestätigte Harness-Sammelticket X (`einzeln`, REST-Form),
 * dessen Befundzeilen (`kommentareVon(nr)`, wirft bei Fehler weiter) gegen die Grenze. Liefert `{ art: "nichts", grund }` oder
 * `{ art: "nachfolger", vorgaenger: X, zeilen }`. Ist der Nachfolger schon das jüngste und unter der Grenze, zählt der volle Vorgänger nicht. Pur bis auf die Abrufe.
 */
export function planeGeneration({ offene, einzeln, kommentareVon, vertraut, grenze = SAMMEL_ZEILEN_GRENZE }) {
  const x = waehleBestaetigtes(kandidatenSammelticket(offene, SAMMELTICKET_TITEL), einzeln);
  if (!x) return { art: "nichts", grund: "kein ungeclaimtes Harness-Sammelticket" };
  const zeilen = zaehleBefundZeilen(kommentareVon(x.number), { vertraut, nurOffen: true });
  if (entscheideGeneration({ zeilen, grenze }) === "nichts") return { art: "nichts", grund: `#${x.number} hat ${zeilen} offene Zeilen (Grenze ${grenze})` };
  return { art: "nachfolger", vorgaenger: x.number, zeilen };
}

/**
 * Zustand des Vorgängers aus seiner REST-Form: `in-arbeit` (offen, geclaimt), `voll` (offen, ungeclaimt: Generation voll), `zu`, `unbekannt` (unlesbar,
 * `null`). Pur.
 */
export function zustandVonIssue(issue) {
  if (!issue) return "unbekannt";
  if (issue.state !== "open") return "zu";
  return (issue.assignees ?? []).length > 0 ? "in-arbeit" : "voll";
}

const ZUSATZ = { "in-arbeit": " (dort in Arbeit)", voll: " (Generation voll)" };

/**
 * Body des neuen Sammeltickets (Vorlage wie die der früheren Tickets). `blockiert durch #N` bei jedem offenen (auch unlesbaren) Vorgänger, mit dem Zusatz,
 * dass die Sperre nur gilt, solange er offen ist (die Zeile bleibt nach dessen Merge stehen); „(dort in Arbeit)“ nur bei `in-arbeit`, „(Generation voll)“ nur bei `voll`. Pur.
 */
export function sammelticketBody({ art, vorgaenger = null, vorgaengerZustand = "zu" }) {
  if (!Object.hasOwn(TITEL, art)) throw new Error(`Unbekannte Art: ${String(art)}`);
  const zeilen =
    art === "harness"
      ? ["Sammelticket für Harness-Befunde (AGENTS.md › Harness-Befunde sind Zeilen, keine Tickets). Befunde als Kommentar `- [ ] …` anhängen."]
      : ["Sammelticket für Befunde aus Langfuse-Daten (docs/ticket-reihenfolge.md › Langfuse-Befunde (gesammelt)). Befunde als Kommentar `- [ ] …` anhängen."];
  if (vorgaenger !== null) zeilen[0] += ` Nachfolger von #${vorgaenger}${ZUSATZ[vorgaengerZustand] ?? ""}.`;
  if (vorgaenger !== null && vorgaengerZustand !== "zu") zeilen.push("", `blockiert durch #${vorgaenger} (nur solange #${vorgaenger} offen ist)`);
  return zeilen.join("\n");
}

// `kandidatenSammelticket` und `waehleBestaetigtes` liegen in board-lib.mjs (auch audit-einordnung.mjs braucht sie; ein Einstiegsskript importiert kein anderes).
export { kandidatenSammelticket, waehleBestaetigtes };

/**
 * Dubletten-Entscheidung nach dem Anlegen von `eigenNr`: `andere` sind bestätigt offene Tickets (siehe `waehleBestaetigtes`). Gibt es ein
 * ungeclaimtes mit gleichem `titel` und kleinerer Nummer, ist das ältere das Original: `eigenes-schliessen`, bei schon vorhandenen Kommentaren
 * des eigenen (Zeilen, die nicht verloren gehen dürfen) nur `warnung`. Sonst `keine`. Der `vorgaenger` (Generationsnachfolger) und ältere Tickets sind keine Dubletten: nur strikt jüngere zählen. Pur.
 */
export function dublettenEntscheidung({ eigenNr, titel, eigenKommentare, andere, vorgaenger = null }) {
  const aeltere = andere.filter((i) => i.titel === titel && i.number < eigenNr && (vorgaenger === null || i.number > vorgaenger) && (i.assignees ?? []).length === 0);
  if (aeltere.length === 0) return { art: "keine" };
  const aelter = Math.min(...aeltere.map((i) => i.number));
  return eigenKommentare > 0 ? { art: "warnung", aelter } : { art: "eigenes-schliessen", aelter };
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
const einzelAbruf = (nr) => ghJson(["api", `repos/${REPO}/issues/${nr}`]);
/** Alle Kommentare eines Issues (paginiert, sonst nur die ersten 30); ein Fehler wirft, damit `--generation` nichts auf Verdacht anlegt. */
const kommentareVon = (nr) => ghJson(["api", "--paginate", "--slurp", `repos/${REPO}/issues/${nr}/comments?per_page=100`]).flat();

/** Dubletten-Check für das frisch angelegte Ticket `nr`: lädt die offenen Issues frisch, bestätigt das älteste Original per Direktabruf. */
function pruefeDublette(nr, titel, vorgaenger) {
  const kandidaten = kandidatenSammelticket(normalizeOffene(loadOpenIssuePages()), titel, { nach: vorgaenger }).filter((i) => i.number < nr);
  const aelter = waehleBestaetigtes(kandidaten, einzelAbruf);
  return dublettenEntscheidung({ eigenNr: nr, titel, eigenKommentare: einzelAbruf(nr).comments ?? 0, andere: aelter ? [aelter] : [], vorgaenger });
}

/** Wertet `pruefeDublette` aus: schließt das eigene Ticket bei einer Dublette (`true`), warnt sonst. */
function schliesseWennDublette(nr, titel, vorgaenger) {
  const d = pruefeDublette(nr, titel, vorgaenger);
  if (d.art === "warnung") console.log(`::warning::#${nr} ist eine Dublette von #${d.aelter}, hat aber schon Kommentare: nicht geschlossen, Zeilen von Hand nach #${d.aelter} übertragen und #${nr} schließen.`);
  if (d.art !== "eigenes-schliessen") return false;
  ghJson(["api", "-X", "POST", `repos/${REPO}/issues/${nr}/comments`, "-f", `body=Dublette von #${d.aelter} (Wettlauf beim Anlegen)`]);
  ghJson(["api", "-X", "PATCH", `repos/${REPO}/issues/${nr}`, "-f", "state=closed", "-f", "state_reason=not_planned"]);
  console.log(`Dublette von #${d.aelter} (Wettlauf beim Anlegen): #${nr} geschlossen (stand es schon im Board, bleibt das Item dort geschlossen liegen). Das Original ist #${d.aelter}.`);
  return true;
}
/** Zustand des Vorgängers `nr` per REST (`zustandVonIssue`); unlesbar gilt als offen (die Sperre ist die sichere Seite). */
function vorgaengerZustand(nr) {
  try {
    return zustandVonIssue(ghJson(["api", `repos/${REPO}/issues/${nr}`]));
  } catch {
    return "unbekannt";
  }
}

/** Der Vorgänger `nr` als offenes, ungeclaimtes Item der Board-Liste, sonst null (dann gilt nicht „direkt dahinter“, sondern die Position laut AGENTS.md). Pur. */
export function offenerVorgaenger(items, nr) {
  if (nr === null) return null;
  return items.find((i) => i.number === nr && i.state === "open" && (i.assignees ?? []).length === 0) ?? null;
}

/**
 * Die Korrektur für das Sammelticket `nr` auf `items`: `{ nr, id, afterId, … }` oder null (steht richtig, oder `nr` fehlt in der Liste). Mit `hinter`
 * (Generationsnachfolger, Vorgänger noch ungeclaimt im Board) ist das Ziel „direkt hinter dem Vorgänger“, sonst die Position laut AGENTS.md
 * (`sammelticketKorrektur`). Andere ungeclaimte Harness-Sammeltickets bleiben außen vor: bewertet wird `nr`, nicht das oberste; eine Korrektur
 * für ein anderes Ticket gibt es nie. Pur.
 */
export function korrekturFuer({ items, nr, position, hinter = null }) {
  const idx = items.findIndex((i) => i.number === nr);
  if (idx < 0) return null;
  const x = offenerVorgaenger(items, hinter);
  if (x) return items[items.indexOf(x) + 1]?.number === nr ? null : { nr, id: items[idx].id, afterId: x.id };
  const ohneAndere = items.filter((i) => i.number === nr || !(i.title === SAMMELTICKET_TITEL && i.state === "open" && (i.assignees ?? []).length === 0));
  const k = sammelticketKorrektur(ohneAndere, position);
  return k && k.nr === nr ? k : null;
}

/**
 * Ein Prüfschritt: was ist mit dem Sammelticket `nr` auf der frisch geladenen Board-Liste `items` zu tun? Liefert
 * `{ art: "ok" }` (steht richtig, `korrekturFuer` null), `{ art: "warte" }` (noch nicht in der Liste), `{ art: "setze", k }`
 * (neu setzen) oder `{ art: "falsch" }` (nach `NEU_SETZEN_MAX` Versuchen oder im Trockenlauf noch falsch). Pur.
 */
export function pruefSchritt({ items, nr, position, neuGesetzt = 0, dry = false, hinter = null }) {
  if (!items.some((i) => i.number === nr)) return { art: "warte" };
  const k = korrekturFuer({ items, nr, position, hinter });
  if (!k) return { art: "ok" };
  if (dry || neuGesetzt >= NEU_SETZEN_MAX) return { art: "falsch" };
  return { art: "setze", k };
}

/** Setzt die Position des Sammeltickets `nr` nach `pruefSchritt` und prüft sie gegen die frisch geladene Board-Liste. Liefert `ok`, `falsch` oder `unbekannt` (nie in der Liste). */
async function setzeUndPruefe(nr, position, dry, hinter) {
  let neuGesetzt = 0;
  for (let versuch = 1; versuch <= PRUEF_VERSUCHE; versuch++) {
    const schritt = pruefSchritt({ items: loadItems(), nr, position, neuGesetzt, dry, hinter });
    if (schritt.art === "ok" || schritt.art === "falsch") return schritt.art;
    if (schritt.art === "setze") {
      const ziel = schritt.k.vonRang === undefined ? "direkt hinter dem Vorgänger" : `Rang ${schritt.k.vonRang}, Ziel ${schritt.k.nachRang}`;
      console.log(`Position stimmt noch nicht (${ziel}): setze neu (${neuGesetzt + 1}/${NEU_SETZEN_MAX}).`);
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
    console.error("Aufruf: sammelticket-anlegen.mjs harness [--vorgaenger <nr> | --generation] [--dry-run] | langfuse [--top] [--dry-run]");
    process.exit(2);
  }
  mitKontingent("sammelticket-anlegen");
  const titel = TITEL[args.art];
  const position = args.art === "harness" ? positionLautAgentsMd() : null;
  let { vorgaenger } = args;
  const offene = normalizeOffene(loadOpenIssuePages());
  let hinter = null;
  let generationsZeilen = 0;
  if (args.generation) {
    // Generationsgrenze (ADR 0026): nur wenn das jüngste ungeclaimte Sammelticket voll ist, entsteht ein Nachfolger direkt dahinter.
    const owner = REPO.split("/")[0];
    const plan = planeGeneration({ offene, einzeln: einzelAbruf, kommentareVon: kommentareVon, vertraut: (u) => istVertraut(u, owner) });
    if (plan.art === "nichts") {
      console.log(`Keine neue Generation nötig: ${plan.grund}.`);
      return;
    }
    vorgaenger = plan.vorgaenger;
    hinter = plan.vorgaenger;
    generationsZeilen = plan.zeilen;
    console.log(`Generation voll: #${vorgaenger} hat ${generationsZeilen} offene Zeilen (Grenze ${SAMMEL_ZEILEN_GRENZE}).`);
  }
  const vorhanden = waehleBestaetigtes(kandidatenSammelticket(offene, titel, { nach: vorgaenger }), einzelAbruf);
  let nr;
  if (vorhanden) {
    nr = vorhanden.number;
    console.log(`Ungeclaimtes „${titel}“ gibt es schon: #${nr}, nichts wird angelegt.`);
  } else if (args.dry) {
    console.log(`Würde „${titel}“ anlegen${position ? ` und auf Position ${position} setzen` : ""}.`);
    return;
  } else {
    const body = sammelticketBody({ art: args.art, vorgaenger, vorgaengerZustand: vorgaenger === null ? "zu" : vorgaengerZustand(vorgaenger) });
    const neu = ghJson(["api", "-X", "POST", `repos/${REPO}/issues`, "-f", `title=${titel}`, "-f", `body=${body}`, "-f", "labels[]=area:harness"]);
    nr = neu.number;
    console.log(`Angelegt: #${nr}`);
    await sleep(DUBLETTEN_PAUSE_MS); // die Liste hinkt nach: erst nach einer Pause sieht ein paralleler Lauf dieses Ticket und umgekehrt
    if (schliesseWennDublette(nr, titel, vorgaenger)) return;
    const itemId = addToBoardTodo(neu.node_id);
    if (hinter !== null) ghJson(["api", "-X", "POST", `repos/${REPO}/issues/${hinter}/comments`, "-f", `body=${generationsKommentar({ zeilen: generationsZeilen, nachfolger: nr })}`]);
    if (args.art === "harness") {
      const items = ergaenzeFehlende(loadItems(), [todoItem({ id: itemId, number: nr, title: titel })]);
      const k = korrekturFuer({ items, nr, position, hinter });
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
  const stand = await setzeUndPruefe(nr, position, args.dry, hinter);
  if (!vorhanden && !args.dry && schliesseWennDublette(nr, titel, vorgaenger)) return; // zweiter Check: ein paralleler Lauf kann erst während der Positions-Schleife sichtbar werden
  if (stand === "ok") console.log(hinter === null ? `Position geprüft: #${nr} steht auf Position ${position} oder davor.` : `Position geprüft: #${nr} steht direkt hinter #${hinter} (oder dieser ist nicht mehr ungeclaimt, dann gilt Position ${position}).`);
  else if (stand === "unbekannt") console.log(`::warning::#${nr} steht noch nicht in der Board-Liste, die Position ist noch nicht prüfbar: board-place.mjs und der Board-Takt korrigieren sie beim nächsten Lauf.`);
  else if (args.dry) console.log(`Trockenlauf: #${nr} steht nicht auf Position ${position}, ein echter Lauf würde es neu setzen.`);
  else {
    console.error(`✖ #${nr} steht nach dem Setzen nicht auf Position ${position}. Erneut fahren oder per board-place.mjs --position ${position} ${nr} setzen.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
