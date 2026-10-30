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
 * Position). Sonst: Issue per REST anlegen (Harness-Label der Config, kein Assignee, kein Such-Index), ins Board holen (Status Todo),
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
import { istDirektaufruf } from "./direktaufruf.mjs";
import { flagsLesen } from "./flag-lib.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import {
  LANGFUSE_SAMMELTICKET_TITEL,
  SAMMELTICKET_TITEL,
  addToBoardTodo,
  boardFuerRolle,
  ergaenzeFehlende,
  ghJson,
  kandidatenSammelticket,
  waehleBestaetigtes,
  loadItems,
  loadOpenIssuePages,
  normalizeOffene,
  REPO,
  planMitKorrektur,
  positionLautAgentsMd,
  positionOderWarnung,
  sammelticketKorrektur,
  setPosition,
  todoItem,
} from "./board-lib.mjs";
import { fehlendeLabels, fehlerText, schreibrechtText, tokenFuerZiel } from "./gh-cli.mjs";
import { boardRolleFuer, labelAus, ladeProjektConfig, spracheAus, zerlegeRepo, zielRepoFuer } from "./projekt-config-lib.mjs";
import { blockerZeile } from "./spezifikation-lib.mjs";

const TITEL = { harness: SAMMELTICKET_TITEL, langfuse: LANGFUSE_SAMMELTICKET_TITEL };
const PRUEF_VERSUCHE = 5;
const PRUEF_PAUSE_MS = 3000;
const NEU_SETZEN_MAX = 2;
const DUBLETTEN_PAUSE_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Argumente → `{ art, vorgaenger, top, dry }` oder null bei falscher Benutzung (unbekanntes, fehlendes, doppeltes Flag, Art nicht als
 * erstes Positionsargument). `--vorgaenger` gilt nur für `harness`, `--top` nur für `langfuse`. Pur.
 */
export function parseArgs(argv) {
  const { werte, positionale, tokens, fehler } = flagsLesen(argv, { "dry-run": { type: "boolean" }, vorgaenger: { type: "string" }, top: { type: "boolean" } }, { positionale: true });
  if (fehler) return null;
  const ohneDry = tokens.filter((t) => !(t.kind === "option" && t.name === "dry-run"));
  if (ohneDry[0]?.kind !== "positional" || positionale.length !== 1) return null;
  const art = positionale[0] ?? "";
  if (!Object.hasOwn(TITEL, art)) return null;
  const basis = { art, vorgaenger: null, top: false, dry: werte["dry-run"] === true };
  if (art === "langfuse") return werte.vorgaenger === undefined ? { ...basis, top: werte.top === true } : null;
  if (werte.top !== undefined) return null;
  if (werte.vorgaenger === undefined) return basis;
  const nr = Number(werte.vorgaenger.replace(/^#/, ""));
  return Number.isInteger(nr) && nr > 0 ? { ...basis, vorgaenger: nr } : null;
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

/**
 * Zustand des Vorgängers aus seiner REST-Form: `in-arbeit` (offen, geclaimt), `offen` (offen, ungeclaimt), `zu`, `unbekannt` (unlesbar,
 * `null`). Pur.
 */
export function zustandVonIssue(issue) {
  if (!issue) return "unbekannt";
  if (issue.state !== "open") return "zu";
  return (issue.assignees ?? []).length > 0 ? "in-arbeit" : "offen";
}

const ZUSATZ = { "in-arbeit": " (dort in Arbeit)" };

/**
 * Body des neuen Sammeltickets (Vorlage wie die der früheren Tickets). Blocker-Zeile `<blocker> #N` (Wort aus `sprache.spezifikation.blocker`, Pflicht dann) bei jedem offenen (auch unlesbaren) Vorgänger, mit dem Zusatz,
 * dass die Sperre nur gilt, solange er offen ist (die Zeile bleibt nach dessen Merge stehen); „(dort in Arbeit)“ nur bei `in-arbeit`. Pur.
 */
export function sammelticketBody({ art, vorgaenger = null, vorgaengerZustand = "zu", blocker }) {
  if (!Object.hasOwn(TITEL, art)) throw new Error(`Unbekannte Art: ${String(art)}`);
  const zeilen =
    art === "harness"
      ? ["Sammelticket für Harness-Befunde (AGENTS.md › Harness-Befunde sind Zeilen, keine Tickets). Befunde als Kommentar `- [ ] …` anhängen."]
      : ["Sammelticket für Befunde aus Langfuse-Daten (docs/ticket-reihenfolge.md › Langfuse-Befunde (gesammelt)). Befunde als Kommentar `- [ ] …` anhängen."];
  if (vorgaenger !== null) zeilen[0] += ` Nachfolger von #${vorgaenger}${ZUSATZ[vorgaengerZustand] ?? ""}.`;
  if (vorgaenger !== null && vorgaengerZustand !== "zu") {
    zeilen.push("", blockerZeile([vorgaenger], { blocker }, `(nur solange #${vorgaenger} offen ist)`));
  }
  return zeilen.join("\n");
}

// `kandidatenSammelticket` und `waehleBestaetigtes` liegen in board-lib.mjs (auch audit-einordnung.mjs braucht sie; ein Einstiegsskript importiert kein anderes).
export { kandidatenSammelticket, waehleBestaetigtes };

/**
 * Dubletten-Entscheidung nach dem Anlegen von `eigenNr`: `andere` sind bestätigt offene Tickets (siehe `waehleBestaetigtes`). Gibt es ein
 * ungeclaimtes mit gleichem `titel` und kleinerer Nummer, ist das ältere das Original: `eigenes-schliessen`, bei schon vorhandenen Kommentaren
 * des eigenen (Zeilen, die nicht verloren gehen dürfen) nur `warnung`. Sonst `keine`. Der `vorgaenger` (Nachfolger beim Claim, `--vorgaenger`) und ältere Tickets sind keine Dubletten: nur strikt jüngere zählen. Pur.
 */
export function dublettenEntscheidung({ eigenNr, titel, eigenKommentare, andere, vorgaenger = null }) {
  const aeltere = andere.filter((i) => i.titel === titel && i.number < eigenNr && (vorgaenger === null || i.number > vorgaenger) && (i.assignees ?? []).length === 0);
  if (aeltere.length === 0) return { art: "keine" };
  const aelter = Math.min(...aeltere.map((i) => i.number));
  return eigenKommentare > 0 ? { art: "warnung", aelter } : { art: "eigenes-schliessen", aelter };
}

/**
 * Pur (#76, ADR 0022 F10): wohin das Sammelticket gehört. Beide Arten tragen das Harness-Label und liegen laut Trennregel auf dem Factory-Board,
 * also im Repo, dessen Issues dieses Board führt (`boards[].repo`, ohne Schlüssel das eigene Repo). Liefert `{ rolle, repo, owner }`; `owner` ist
 * der Besitzer des Ziel-Repos (Vertrauensgrenze der Einzelabrufe).
 */
export function sammelZiel(config) {
  const labels = [labelAus(config, "harness")];
  const repo = zielRepoFuer(labels, config);
  return { rolle: boardRolleFuer(labels, config), repo, owner: zerlegeRepo(repo).owner };
}

/** Die gh-Optionen für Aufrufe gegen das Ziel-Repo `repo` (#97): ein fremdes Repo liest und schreibt der `PROJECT_TOKEN`, das eigene den Standard (`tokenFuerZiel`). */
export const zielOpts = (repo, env = process.env) => ({ token: tokenFuerZiel({ ziel: repo, eigenes: REPO, env }) });

/** Legt das Sammelticket im Ziel-Repo an; fehlende Schreibrechte oder verworfene Labels sind ein klarer Fehler, nie ein Rückfall ins eigene Repo. */
export function legeAn({ repo, titel, body, harness }, api = ghJson, env = process.env) {
  let neu;
  try {
    neu = api(["api", "-X", "POST", `repos/${repo}/issues`, "-f", `title=${titel}`, "-f", `body=${body}`, "-f", `labels[]=${harness}`], zielOpts(repo, env));
  } catch (e) {
    throw new Error(`Anlegen in ${repo} fehlgeschlagen: ${schreibrechtText(e, repo) ?? fehlerText(e)}`, { cause: e });
  }
  if (fehlendeLabels(neu, [harness]).length > 0) {
    throw new Error(`#${neu.number} in ${repo} angelegt, aber ohne Label ${harness} (kein Schreibrecht für Labels dort?)\nFix: Schreibrecht im Ziel-Repo klären, Label und Board-Position dort von Hand setzen`);
  }
  return neu;
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
export const einzelAbrufIn = (repo, gh = ghJson, env = process.env) => (nr) => gh(["api", `repos/${repo}/issues/${nr}`], zielOpts(repo, env));

/**
 * Führt einen Lesezugriff auf das Ziel-Repo `repo` aus (#78 L14). Scheitert er, steht eine Zeile `✖ <Meldung>` (bei fehlenden Rechten `kein Lesezugriff auf <repo> …`,
 * sonst der Fehlertext) auf stderr und das Skript endet mit Exit 1: nichts im eigenen Repo angelegt, kein Stacktrace. `naht` (Tests): `err`, `exit`.
 */
export function lesbarImZiel(repo, fn, { err = console.error, exit = process.exit } = {}) {
  try {
    return fn();
  } catch (e) {
    err(`✖ ${schreibrechtText(e, repo, "lesen") ?? fehlerText(e)}`);
    return exit(1);
  }
}

/** Dubletten-Check für das frisch angelegte Ticket `nr`: lädt die offenen Issues frisch, bestätigt das älteste Original per Direktabruf. */
function pruefeDublette(nr, titel, vorgaenger, { repo, owner }) {
  const einzelAbruf = einzelAbrufIn(repo);
  return lesbarImZiel(repo, () => {
    const kandidaten = kandidatenSammelticket(normalizeOffene(loadOpenIssuePages(repo, zielOpts(repo))), titel, { nach: vorgaenger }).filter((i) => i.number < nr);
    const aelter = waehleBestaetigtes(kandidaten, einzelAbruf, owner);
    return dublettenEntscheidung({ eigenNr: nr, titel, eigenKommentare: einzelAbruf(nr).comments ?? 0, andere: aelter ? [aelter] : [], vorgaenger });
  });
}

/** Wertet `pruefeDublette` aus: schließt das eigene Ticket bei einer Dublette (`true`), warnt sonst. */
function schliesseWennDublette(nr, titel, vorgaenger, ziel) {
  const { repo } = ziel;
  const d = pruefeDublette(nr, titel, vorgaenger, ziel);
  if (d.art === "warnung") console.log(`::warning::#${nr} ist eine Dublette von #${d.aelter}, hat aber schon Kommentare: nicht geschlossen, Zeilen von Hand nach #${d.aelter} übertragen und #${nr} schließen.`);
  if (d.art !== "eigenes-schliessen") return false;
  ghJson(["api", "-X", "POST", `repos/${repo}/issues/${nr}/comments`, "-f", `body=Dublette von #${d.aelter} (Wettlauf beim Anlegen)`], zielOpts(repo));
  ghJson(["api", "-X", "PATCH", `repos/${repo}/issues/${nr}`, "-f", "state=closed", "-f", "state_reason=not_planned"], zielOpts(repo));
  console.log(`Dublette von #${d.aelter} (Wettlauf beim Anlegen): #${nr} geschlossen (stand es schon im Board, bleibt das Item dort geschlossen liegen). Das Original ist #${d.aelter}.`);
  return true;
}
/** Zustand des Vorgängers `nr` per REST (`zustandVonIssue`); unlesbar gilt als offen (die Sperre ist die sichere Seite). */
function vorgaengerZustand(nr, repo) {
  try {
    return zustandVonIssue(ghJson(["api", `repos/${repo}/issues/${nr}`], zielOpts(repo)));
  } catch {
    return "unbekannt";
  }
}

/**
 * Die Korrektur für das Sammelticket `nr` auf `items`: `{ nr, id, afterId, … }` oder null (steht richtig, oder `nr` fehlt in der Liste). Ziel ist die Position laut AGENTS.md
 * (`sammelticketKorrektur`). Andere ungeclaimte Harness-Sammeltickets bleiben außen vor: bewertet wird `nr`, nicht das oberste; eine Korrektur
 * für ein anderes Ticket gibt es nie. Pur.
 */
export function korrekturFuer({ items, nr, position }) {
  const idx = items.findIndex((i) => i.number === nr);
  if (idx < 0) return null;
  const ohneAndere = items.filter((i) => i.number === nr || !(i.title === SAMMELTICKET_TITEL && i.state === "open" && (i.assignees ?? []).length === 0));
  const k = sammelticketKorrektur(ohneAndere, position);
  return k && k.nr === nr ? k : null;
}

/**
 * Ein Prüfschritt: was ist mit dem Sammelticket `nr` auf der frisch geladenen Board-Liste `items` zu tun? Liefert
 * `{ art: "ok" }` (steht richtig, `korrekturFuer` null), `{ art: "warte" }` (noch nicht in der Liste), `{ art: "setze", k }`
 * (neu setzen) oder `{ art: "falsch" }` (nach `NEU_SETZEN_MAX` Versuchen oder im Trockenlauf noch falsch). Pur.
 */
export function pruefSchritt({ items, nr, position, neuGesetzt = 0, dry = false }) {
  if (!items.some((i) => i.number === nr)) return { art: "warte" };
  const k = korrekturFuer({ items, nr, position });
  if (!k) return { art: "ok" };
  if (dry || neuGesetzt >= NEU_SETZEN_MAX) return { art: "falsch" };
  return { art: "setze", k };
}

/**
 * Setzt die Position des Sammeltickets `nr` nach `pruefSchritt` und prüft sie gegen die frisch geladene Board-Liste auf `board` (Pflicht, wirft sonst vor jedem Laden).
 * Liefert `ok`, `falsch` oder `unbekannt` (nie in der Liste). `io` ist für Tests austauschbar (Default: echtes Board und echtes Warten).
 */
export async function setzeUndPruefe({ nr, position, dry = false, board, repo }, io = {}) {
  if (!board) throw new Error("setzeUndPruefe: board fehlt");
  if (!repo) throw new Error("setzeUndPruefe: repo fehlt");
  const lade = io.loadItems ?? (() => loadItems(board, { repo })); // Standard: immer das ausdrücklich übergebene Board
  const setze = io.setPosition ?? ((_board, id, afterId) => setPosition(board, id, afterId));
  const warte = io.sleep ?? sleep;
  let neuGesetzt = 0;
  for (let versuch = 1; versuch <= PRUEF_VERSUCHE; versuch++) {
    const schritt = pruefSchritt({ items: lade(board), nr, position, neuGesetzt, dry });
    if (schritt.art === "ok" || schritt.art === "falsch") return schritt.art;
    if (schritt.art === "setze") {
      console.log(`Position stimmt noch nicht (Rang ${schritt.k.vonRang}, Ziel ${schritt.k.nachRang}): setze neu (${neuGesetzt + 1}/${NEU_SETZEN_MAX}).`);
      setze(board, schritt.k.id, schritt.k.afterId);
      neuGesetzt++;
    }
    await warte(PRUEF_PAUSE_MS);
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
  const config = ladeProjektConfig();
  const harness = labelAus(config, "harness");
  // Zwei Boards (ADR 0022 F11): Status- und Sammeltickets tragen das Harness-Label der Config und stehen laut Trennregel auf dem Factory-Board.
  const ziel = sammelZiel(config);
  const FACTORY_BOARD = boardFuerRolle(ziel.rolle);
  const { repo } = ziel;
  const titel = TITEL[args.art];
  const position = args.art === "harness" ? positionLautAgentsMd() : null;
  const { vorgaenger } = args;
  const vorhanden = lesbarImZiel(repo, () => {
    const offene = normalizeOffene(loadOpenIssuePages(repo, zielOpts(repo)));
    return waehleBestaetigtes(kandidatenSammelticket(offene, titel, { nach: vorgaenger }), einzelAbrufIn(repo), ziel.owner);
  });
  let nr;
  if (vorhanden) {
    nr = vorhanden.number;
    console.log(`Ungeclaimtes „${titel}“ gibt es schon: #${nr}, nichts wird angelegt.`);
  } else if (args.dry) {
    console.log(`Würde „${titel}“ anlegen${position ? ` und auf Position ${position} setzen` : ""}.`);
    return;
  } else {
    const body = sammelticketBody({ art: args.art, vorgaenger, vorgaengerZustand: vorgaenger === null ? "zu" : vorgaengerZustand(vorgaenger, repo), blocker: spracheAus(config).spezifikation.blocker });
    let neu;
    try {
      neu = legeAn({ repo, titel, body, harness });
    } catch (e) {
      console.error(`✖ ${e.message}`);
      process.exit(2);
    }
    nr = neu.number;
    console.log(`Angelegt: #${nr}`);
    await sleep(DUBLETTEN_PAUSE_MS); // die Liste hinkt nach: erst nach einer Pause sieht ein paralleler Lauf dieses Ticket und umgekehrt
    if (schliesseWennDublette(nr, titel, vorgaenger, ziel)) return;
    const itemId = addToBoardTodo(FACTORY_BOARD, neu.node_id, { repo });
    if (args.art === "harness") {
      const items = ergaenzeFehlende(loadItems(FACTORY_BOARD, { repo }), [todoItem({ id: itemId, number: nr, title: titel })]);
      const k = korrekturFuer({ items, nr, position });
      if (k) setPosition(FACTORY_BOARD, k.id, k.afterId);
    } else if (args.top) {
      const items = ergaenzeFehlende(loadItems(FACTORY_BOARD, { repo }), [todoItem({ id: itemId, number: nr, title: titel })]);
      // Wie board-place: ein falsch stehendes Harness-Sammelticket zuerst zurückschieben, sonst klemmt das neue Ticket hinter dessen falschen Platz.
      // Fehlt die Position, warnt das Skript und plant ohne Korrektur (nur `harness` braucht sie zwingend).
      const { korrektur, plan } = planMitKorrektur(items, { anchor: null, numbers: [nr] }, positionOderWarnung());
      if (korrektur) setPosition(FACTORY_BOARD, korrektur.id, korrektur.afterId);
      for (const { item, afterId } of plan.steps) setPosition(FACTORY_BOARD, item.id, afterId);
    }
  }
  if (args.art !== "harness") return;
  const stand = await setzeUndPruefe({ nr, position, dry: args.dry, board: FACTORY_BOARD, repo });
  if (!vorhanden && !args.dry && schliesseWennDublette(nr, titel, vorgaenger, ziel)) return; // zweiter Check: ein paralleler Lauf kann erst während der Positions-Schleife sichtbar werden
  if (stand === "ok") console.log(`Position geprüft: #${nr} steht auf Position ${position} oder davor.`);
  else if (stand === "unbekannt") console.log(`::warning::#${nr} steht noch nicht in der Board-Liste, die Position ist noch nicht prüfbar: board-place.mjs und der Board-Takt korrigieren sie beim nächsten Lauf.`);
  else if (args.dry) console.log(`Trockenlauf: #${nr} steht nicht auf Position ${position}, ein echter Lauf würde es neu setzen.`);
  else {
    console.error(`✖ #${nr} steht nach dem Setzen nicht auf Position ${position}. Erneut fahren oder per board-place.mjs --position ${position} ${nr} setzen.`);
    process.exit(1);
  }
}

if (istDirektaufruf(import.meta.url)) await main();
