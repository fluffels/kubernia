#!/usr/bin/env node
// Kein weiterer Shebang-Zwang: wird von Agenten gestartet UND von test/sammelticket-anlegen.test.ts importiert.
/**
 * Sammelticket anlegen, einsortieren und die Position prüfen (#1390), statt des früheren Doku-Snippets: das Anlegen des Nachfolgers
 * lief einmal nicht bis zur Position, das Ticket stand am Board-Ende und klemmte jedes neue `--top`-Ticket dorthin.
 *
 *   node scripts/sammelticket-anlegen.mjs harness [--vorgaenger <nr>] [--dry-run]   # Harness-Sammelticket auf der Position laut AGENTS.md
 *   node scripts/sammelticket-anlegen.mjs langfuse [--top] [--dry-run]              # Langfuse-Sammelticket (mit --top an die Spitze)
 *   node scripts/sammelticket-anlegen.mjs codequalitaet [--vorgaenger <nr>] [--dry-run]   # Codequalität-Sammelticket im eigenen Repo (factory#156)
 *
 * Idempotent: gibt es schon ein ungeclaimtes Sammelticket dieser Art, legt das Skript nichts an (bei `harness` prüft es nur die
 * Position). Sonst: Issue per REST anlegen (Harness-Label der Config, kein Assignee, kein Such-Index), ins Board holen (Status Todo),
 * auf Position bringen (`sammelticketKorrektur`), dann prüfen: die Board-Liste liefert Neues verzögert, darum bis zu 5 Ladeversuche mit
 * Pause; steht das Ticket falsch, wird es bis zu zweimal neu gesetzt (sonst Exit 1). Erscheint es nie in der Liste, warnt das Skript
 * (Exit 0); ein volles Sammelticket holt der Board-Takt (`board-takt.mjs`) an die Spitze, die Position korrigiert niemand nachträglich.
 * Race-fest (#1561): `vorhanden` wird per Direktabruf (`repos/<repo>/issues/<nr>`) bestätigt, weil die Listen-Abfrage nachhinkt (ein gerade geschlossenes
 * Ticket stand noch als offen und ungeclaimt darin, Evidenz #1560/#1561). Nach dem Anlegen und nach der Positions-Schleife läuft ein Dubletten-Check:
 * gibt es ein älteres offenes ungeclaimtes Ticket gleichen Titels, schließt das Skript das eigene (Kommentar, `not planned`, Exit 0; ein Item, das schon im Board stand, bleibt dort geschlossen liegen); hat das eigene
 * schon Kommentare, warnt es nur.
 * `codequalitaet` ist freiwillig: nur mit `labels.codequalitaet` in der Projekt-Config (Label, das auf das Produkt-Board des eigenen Repos führt); ohne
 * Label meldet das Skript „nichts angelegt“ (Exit 0, ohne gh-Aufruf). Das Ticket kommt hinter den Kopf des Produkt-Boards (ohne Klemmung hinter andere Sammeltickets, factory#162).
 * Mit `--vorgaenger <nr>` nennt der Body den Vorgänger; `blockiert durch #<nr>` steht nur drin, solange er offen ist.
 *
 * Nur Node-Builtins und board-lib.mjs, analog zu board-place.mjs.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { flagsLesen } from "./flag-lib.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import { BEFUND_ZEILE, BEFUND_ZEILE_OFFEN } from "./produktquote-lib.mjs";
import {
  CODEQUALITAET_SAMMELTICKET_TITEL,
  LANGFUSE_SAMMELTICKET_TITEL,
  SAMMELTICKET_TITEL,
  addToBoardTodo,
  boardFuerRolle,
  ergaenzeFehlende,
  ghJson,
  kandidatenSammelticket,
  kopfEnde,
  waehleBestaetigtes,
  loadItems,
  loadOpenIssuePages,
  normalizeOffene,
  REPO,
  planFuerArgs,
  positionLautAgentsMd,
  sammelticketKorrektur,
  setPosition,
  todoItem,
} from "./board-lib.mjs";
import { fehlendeLabels, fehlerText, schreibrechtText, tokenFuerZiel } from "./gh-cli.mjs";
import { boardRolleFuer, labelAus, ladeProjektConfig, langfuseZiel, spracheAus, zielRepoFuer } from "./projekt-config-lib.mjs";
import { istBezieher as istBezieherWurzel } from "./sync-stand-lib.mjs";
import { zerlegeRepo } from "./repo-form.mjs";
import { blockerZeile } from "./spezifikation-lib.mjs";
import { factorySeiteIn } from "./factory-seite.mjs";
import { echteVerknuepfung, verknuepfeBlocker } from "./blocker-lib.mjs";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));

const TITEL = { harness: SAMMELTICKET_TITEL, langfuse: LANGFUSE_SAMMELTICKET_TITEL, codequalitaet: CODEQUALITAET_SAMMELTICKET_TITEL };
const KEIN_LABEL_TEXT = "labels.codequalitaet ist in der Projekt-Config nicht gesetzt: kein Codequalität-Sammelticket in diesem Projekt, nichts angelegt.";
const PRUEF_VERSUCHE = 5;
const PRUEF_PAUSE_MS = 3000;
const NEU_SETZEN_MAX = 2;
const DUBLETTEN_PAUSE_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Argumente → `{ art, vorgaenger, top, dry }` oder null bei falscher Benutzung (unbekanntes, fehlendes, doppeltes Flag, Art nicht als
 * erstes Positionsargument). `--vorgaenger` gilt für `harness` und `codequalitaet`, `--top` nur für `langfuse`. Pur.
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
  const muster = nurOffen ? BEFUND_ZEILE_OFFEN : BEFUND_ZEILE;
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

const ANHAENGEN = "Befunde als Kommentar anhängen, je Zeile `- [ ] …` (Fließtext ohne Checkbox zählt weder als Zeile noch füllt er das Ticket).";
const BODY_ZEILE = {
  harness: () => `Sammelticket für Harness-Befunde (AGENTS.md › Harness-Befunde sind Zeilen, keine Tickets). ${ANHAENGEN}`,
  langfuse: () => `Sammelticket für Befunde aus Langfuse-Daten (${factorySeiteIn(WURZEL, "docs/ticket-reihenfolge.md", "langfuse-befunde-gesammelt")}). ${ANHAENGEN}`,
  codequalitaet: () => `Sammelticket für Codequalität außerhalb des Slices: fehlender Test, zu lange oder umständliche Funktion, doppeltes Muster (${factorySeiteIn(WURZEL, "docs/ticket-reihenfolge.md", "codequalität-gesammelt")}). Im Slice des Tickets behebt der Umsetzer sofort, hier steht nur, was außerhalb liegt. ${ANHAENGEN}`,
};

/**
 * Body des neuen Sammeltickets (Vorlage wie die der früheren Tickets). Blocker-Zeile `<blocker> #N` (Wort aus `sprache.spezifikation.blocker`, Pflicht dann) bei jedem offenen (auch unlesbaren) Vorgänger, mit dem Zusatz,
 * dass die Sperre nur gilt, solange er offen ist (die Zeile bleibt nach dessen Merge stehen); „(dort in Arbeit)“ nur bei `in-arbeit`. Pur.
 */
export function sammelticketBody({ art, vorgaenger = null, vorgaengerZustand = "zu", blocker }) {
  if (!Object.hasOwn(TITEL, art)) throw new Error(`Unbekannte Art: ${String(art)}`);
  const zeilen = [BODY_ZEILE[art]()];
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
 * Pur (factory#156): das Label, mit dem das Sammelticket der Art angelegt wird: `harness`/`langfuse` tragen `labels.harness`, `codequalitaet` das freiwillige
 * `labels.codequalitaet` der Config; fehlt oder leer ist es → `null` (kein Codequalität-Sammelticket in diesem Projekt, es wird nichts angelegt).
 */
export function sammelLabel(config, art) {
  if (art !== "codequalitaet") return labelAus(config, "harness");
  const l = config?.labels?.codequalitaet;
  return typeof l === "string" && l.trim() !== "" ? l : null;
}

/**
 * Pur (factory#156): der Platzierungsplan des neuen Codequalität-Sammeltickets `nr` (steht schon in `items`): hinter dem Kopf des Boards (letztes Kopf-Item als Anker,
 * ohne Kopf die Spitze), ohne Klemmung hinter andere Sammeltickets (factory#162). Das Füllstand-Gate in naechstes-ticket.mjs hält es bis zur Schwelle zurück.
 */
export function codequalitaetPlan(items, nr) {
  const ende = kopfEnde(items);
  return planFuerArgs(items, { anchor: ende > 0 ? items[ende - 1].number : null, numbers: [nr] });
}

/**
 * Pur (#76, ADR 0022 F10): wohin das Sammelticket gehört. Harness und Langfuse tragen das Harness-Label und liegen laut Trennregel auf dem Factory-Board; `codequalitaet` (Label aus `sammelLabel`)
 * liegt auf dem Produkt-Board des eigenen Repos. Ziel ist das Repo, dessen Issues das Board der Rolle führt (`boards[].repo`, ohne Schlüssel das eigene Repo). Liefert `{ rolle, repo, owner }`; `owner` ist
 * der Besitzer des Ziel-Repos (Vertrauensgrenze der Einzelabrufe).
 */
export function sammelZiel(config, label = labelAus(config, "harness")) {
  const labels = [label];
  const repo = zielRepoFuer(labels, config);
  return { rolle: boardRolleFuer(labels, config), repo, owner: zerlegeRepo(repo).owner };
}

/**
 * Pur (factory#195): Label und Ziel des Sammeltickets der Art `art`. `harness` und `codequalitaet` wie bisher (`sammelLabel`, `sammelZiel`; ohne Label für `codequalitaet` `{ label: null, ziel: null }`);
 * `langfuse` folgt `langfuseZiel` (im Bezieher das eigene Repo, `label` darf dort `null` sein: kein Label beim Anlegen). Wirft wie `langfuseZiel`. Liefert `{ label, ziel }`.
 */
export function zielFuerArt(config, art, { bezieher = false } = {}) {
  if (art === "langfuse") {
    const lz = langfuseZiel(config, { bezieher });
    return { label: lz.label, ziel: { rolle: lz.rolle, repo: lz.repo, owner: zerlegeRepo(lz.repo).owner } };
  }
  const label = sammelLabel(config, art);
  return { label, ziel: label === null ? null : sammelZiel(config, label) };
}

/** `zielFuerArt`, aber ein Konfigurationsfehler endet mit `✖`-Zeile und Exit 2 statt mit einem Stacktrace. */
function zielOderAbbruch(config, art, bezieher) {
  try {
    return zielFuerArt(config, art, { bezieher });
  } catch (e) {
    console.error(`✖ ${e.message}`);
    return process.exit(2);
  }
}

/** Die gh-Optionen für Aufrufe gegen das Ziel-Repo `repo` (#97): ein fremdes Repo liest und schreibt der `PROJECT_TOKEN`, das eigene den Standard (`tokenFuerZiel`). */
export const zielOpts = (repo, env = process.env) => ({ token: tokenFuerZiel({ ziel: repo, eigenes: REPO, env }) });

/** Legt das Sammelticket im Ziel-Repo an (`harness` = Label oder `null`: ohne Label, factory#195); fehlende Schreibrechte oder verworfene Labels sind ein klarer Fehler, nie ein Rückfall ins eigene Repo. */
export function legeAn({ repo, titel, body, harness }, api = ghJson, env = process.env) {
  let neu;
  try {
    neu = api(["api", "-X", "POST", `repos/${repo}/issues`, "-f", `title=${titel}`, "-f", `body=${body}`, ...(harness === null ? [] : ["-f", `labels[]=${harness}`])], zielOpts(repo, env));
  } catch (e) {
    throw new Error(`Anlegen in ${repo} fehlgeschlagen: ${schreibrechtText(e, repo) ?? fehlerText(e)}`, { cause: e });
  }
  if (harness !== null && fehlendeLabels(neu, [harness]).length > 0) {
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

/**
 * Die Nähte der gh-Zugriffe (#101 L5/L6): `gh` (`args, opt`, Standard `ghJson`), `ladeSeiten` (`repo, opt`, Standard `loadOpenIssuePages`), `env` (Standard `process.env`),
 * `log`, `err`, `exit` (siehe `lesbarImZiel`). Ohne Angabe läuft alles echt.
 */
const naehte = (n = {}) => ({ gh: ghJson, ladeSeiten: loadOpenIssuePages, env: process.env, log: console.log, ...n });

/**
 * Die offenen Kandidaten des Sammeltickets `titel` im Ziel-Repo `repo` (frisch geladen, bei `vorgaenger` nur jüngere), höchstens mit der Nummer unter `vorVon`. Das Lesen steht in
 * `lesbarImZiel` (#78 L14: unlesbar heißt `✖`-Meldung und Exit 1, kein Stacktrace) und nutzt die Token-Optionen des Ziel-Repos (`zielOpts`).
 */
function offeneKandidaten({ repo, titel, vorgaenger, vorVon = Infinity }, n) {
  return kandidatenSammelticket(normalizeOffene(n.ladeSeiten(repo, zielOpts(repo, n.env))), titel, { nach: vorgaenger }).filter((i) => i.number < vorVon);
}

/** Das älteste bestätigte ungeclaimte Sammelticket `titel` im Ziel-Repo (Direktabruf bestätigt, die Liste hinkt nach) oder null. Ein unlesbares Ziel endet mit Exit 1 (`lesbarImZiel`). */
export function findeVorhandenes({ repo, titel, vorgaenger, owner }, naht = {}) {
  const n = naehte(naht);
  return lesbarImZiel(repo, () => waehleBestaetigtes(offeneKandidaten({ repo, titel, vorgaenger }, n), einzelAbrufIn(repo, n.gh, n.env), owner), n);
}

/** Dubletten-Check für das frisch angelegte Ticket `nr`: lädt die offenen Issues frisch, bestätigt das älteste Original per Direktabruf. */
function pruefeDublette(nr, titel, vorgaenger, { repo, owner }, n) {
  const einzelAbruf = einzelAbrufIn(repo, n.gh, n.env);
  return lesbarImZiel(repo, () => {
    const aelter = waehleBestaetigtes(offeneKandidaten({ repo, titel, vorgaenger, vorVon: nr }, n), einzelAbruf, owner);
    return dublettenEntscheidung({ eigenNr: nr, titel, eigenKommentare: einzelAbruf(nr).comments ?? 0, andere: aelter ? [aelter] : [], vorgaenger });
  }, n);
}

/** Wertet `pruefeDublette` aus: schließt das eigene Ticket bei einer Dublette (`true`), warnt sonst. Schreibt mit den Token-Optionen des Ziel-Repos. */
export function schliesseWennDublette(nr, titel, vorgaenger, ziel, naht = {}) {
  const n = naehte(naht);
  const { repo } = ziel;
  const d = pruefeDublette(nr, titel, vorgaenger, ziel, n);
  if (d.art === "warnung") n.log(`::warning::#${nr} ist eine Dublette von #${d.aelter}, hat aber schon Kommentare: nicht geschlossen, Zeilen von Hand nach #${d.aelter} übertragen und #${nr} schließen.`);
  if (d.art !== "eigenes-schliessen") return false;
  n.gh(["api", "-X", "POST", `repos/${repo}/issues/${nr}/comments`, "-f", `body=Dublette von #${d.aelter} (Wettlauf beim Anlegen)`], zielOpts(repo, n.env));
  n.gh(["api", "-X", "PATCH", `repos/${repo}/issues/${nr}`, "-f", "state=closed", "-f", "state_reason=not_planned"], zielOpts(repo, n.env));
  n.log(`Dublette von #${d.aelter} (Wettlauf beim Anlegen): #${nr} geschlossen (stand es schon im Board, bleibt das Item dort geschlossen liegen). Das Original ist #${d.aelter}.`);
  return true;
}

/** Zustand des Vorgängers `nr` per REST (`zustandVonIssue`, Lesezugriff mit den Token-Optionen des Ziel-Repos); unlesbar gilt als `unbekannt` (die Sperre ist die sichere Seite). */
export function vorgaengerZustand(nr, repo, naht = {}) {
  const n = naehte(naht);
  try {
    return zustandVonIssue(n.gh(["api", `repos/${repo}/issues/${nr}`], zielOpts(repo, n.env)));
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

/** Erste Position eines Nicht-Harness-Tickets `nr` (Item `itemId` im Board `board`): `langfuse --top` an die Spitze (wörtlich, ohne Klemmung), `codequalitaet` hinter den Kopf; `langfuse` ohne `--top` bleibt am Ende. */
function setzeErstePosition({ art, top, board, repo, itemId, nr, titel }, d) {
  if (!top && art !== "codequalitaet") return;
  const items = ergaenzeFehlende(d.loadItems(board, { repo }), [todoItem({ id: itemId, number: nr, title: titel })]);
  const plan = art === "codequalitaet" ? codequalitaetPlan(items, nr) : planFuerArgs(items, { anchor: null, numbers: [nr] });
  for (const { item, afterId } of plan.steps) d.setPosition(board, item.id, afterId);
}

/** Bezieher (factory#195): Sync-Stand in der Wurzel vorhanden; `bezieher` und `wurzel` in `d` sind Test-Nähte. */
const istBezieher = (d) => d.bezieher ?? istBezieherWurzel(d.wurzel ?? WURZEL);

/** Neu anlegen (Zweig von `main`): liefert die Nummer, oder `null`, wenn nichts weiter zu tun ist (Dublette). */
async function legeNeuAn({ args, d, config, ziel, label, board, repo, titel, position }) {
  const { vorgaenger } = args;
  const vZustand = vorgaenger === null ? "zu" : d.vorgaengerZustand(vorgaenger, repo);
  const body = sammelticketBody({ art: args.art, vorgaenger, vorgaengerZustand: vZustand, blocker: spracheAus(config).spezifikation.blocker });
  let neu;
  try {
    neu = d.legeAn({ repo, titel, body, harness: label });
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exit(2);
  }
  const nr = neu.number;
  d.log(`Angelegt: #${nr}`);
  await d.sleep(DUBLETTEN_PAUSE_MS); // die Liste hinkt nach: erst nach einer Pause sieht ein paralleler Lauf dieses Ticket und umgekehrt
  if (d.schliesseWennDublette(nr, titel, vorgaenger, ziel)) return null;
  if (vZustand !== "zu") { // die Blocker-Zeile steht im Body; zusätzlich die native Kante (Blocked-Icon im Board), Scheitern nur Warnung (factory#202 L1)
    const warnung = verknuepfeBlocker(neu, [{ repo, nummer: vorgaenger }], repo, { verknuepfeBlocker: d.verknuepfeBlocker });
    if (warnung) d.log(warnung.trimEnd());
  }
  const itemId = d.addToBoardTodo(board, neu.node_id, { repo });
  if (args.art === "harness") {
    const items = ergaenzeFehlende(d.loadItems(board, { repo }), [todoItem({ id: itemId, number: nr, title: titel })]);
    const k = korrekturFuer({ items, nr, position });
    if (k) d.setPosition(board, k.id, k.afterId);
  } else setzeErstePosition({ art: args.art, top: args.top, board, repo, itemId, nr, titel }, d);
  return nr;
}

/** Ergebnis der Positionsprüfung melden (Zweig von `main`); eine verfehlte Position beendet mit Exit 1. */
function meldeStand({ stand, nr, position, dry }, d) {
  if (stand === "ok") d.log(`Position geprüft: #${nr} steht auf Position ${position} oder davor.`);
  else if (stand === "unbekannt") d.log(`::warning::#${nr} steht noch nicht in der Board-Liste, die Position ist noch nicht prüfbar: board-place.mjs und der Board-Takt korrigieren sie beim nächsten Lauf.`);
  else if (dry) d.log(`Trockenlauf: #${nr} steht nicht auf Position ${position}, ein echter Lauf würde es neu setzen.`);
  else {
    console.error(`✖ #${nr} steht nach dem Setzen nicht auf Position ${position}. Erneut fahren oder per board-place.mjs --position ${position} ${nr} setzen.`);
    process.exit(1);
  }
}

/** Einstieg. `deps` (Tests): `ladeConfig`, `log`, `kontingent` und die gh-/Board-Nähte (`findeVorhandenes`, `legeAn`, `addToBoardTodo`, `loadItems`, `setPosition`, `vorgaengerZustand`, `schliesseWennDublette`, `setzeUndPruefe`, `sleep`); ohne Angabe läuft alles echt. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const d = { ladeConfig: ladeProjektConfig, log: console.log, kontingent: () => mitKontingent("sammelticket-anlegen"), findeVorhandenes, legeAn, addToBoardTodo: (board, nodeId, opts) => addToBoardTodo(board, nodeId, opts), loadItems: (board, opts) => loadItems(board, opts), setPosition: (board, id, afterId) => setPosition(board, id, afterId), vorgaengerZustand, schliesseWennDublette, setzeUndPruefe, sleep, verknuepfeBlocker: echteVerknuepfung({ eigenes: REPO }), ...deps };
  d.bezieher = istBezieher(d);
  const args = parseArgs(argv);
  if (!args) {
    console.error("Aufruf: sammelticket-anlegen.mjs harness [--vorgaenger <nr>] [--dry-run] | langfuse [--top] [--dry-run] | codequalitaet [--vorgaenger <nr>] [--dry-run]");
    process.exit(2);
  }
  if (args.art === "harness" && d.bezieher) {
    console.error("✖ Im Bezieher gibt es kein Harness-Sammelticket (ADR 0031: nur im Factory-Repo).\nFix: Kern-Befunde per `node scripts/melden.mjs` an die Meldestelle melden (AGENTS.md › Harness-Befunde).");
    return process.exit(2);
  }
  const config = d.ladeConfig();
  // Zwei Boards (ADR 0022 F11): Harness-/Langfuse-Sammeltickets tragen das Harness-Label der Config und stehen laut Trennregel auf dem Factory-Board; Codequalität liegt auf dem Produkt-Board.
  // Langfuse im Bezieher (factory#195): das eigene Repo, ohne Harness-Label auf dem Produkt-Board (`zielFuerArt`).
  const { label, ziel } = zielOderAbbruch(config, args.art, d.bezieher);
  if (ziel === null) return d.log(KEIN_LABEL_TEXT); // Opt-in: ohne labels.codequalitaet kein Ticket, kein gh-Aufruf
  d.kontingent();
  const board = boardFuerRolle(ziel.rolle);
  const { repo } = ziel;
  const titel = TITEL[args.art];
  const position = args.art === "harness" ? positionLautAgentsMd() : null;
  const { vorgaenger } = args;
  const vorhanden = d.findeVorhandenes({ repo, titel, vorgaenger, owner: ziel.owner });
  let nr;
  if (vorhanden) {
    nr = vorhanden.number;
    d.log(`Ungeclaimtes „${titel}“ gibt es schon: #${nr}, nichts wird angelegt.`);
  } else if (args.dry) {
    d.log(`Würde „${titel}“ anlegen${position ? ` und auf Position ${position} setzen` : ""}.`);
    return;
  } else {
    const angelegt = await legeNeuAn({ args, d, config, ziel, label, board, repo, titel, position });
    if (angelegt === null) return;
    nr = angelegt;
  }
  if (args.art !== "harness") return;
  const stand = await d.setzeUndPruefe({ nr, position, dry: args.dry, board, repo });
  if (!vorhanden && d.schliesseWennDublette(nr, titel, vorgaenger, ziel)) return; // zweiter Check: ein paralleler Lauf kann erst während der Positions-Schleife sichtbar werden
  meldeStand({ stand, nr, position, dry: args.dry }, d);
}

if (istDirektaufruf(import.meta.url)) await main();
