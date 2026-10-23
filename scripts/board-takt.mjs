#!/usr/bin/env node
// Kein weiterer Shebang-Zwang: wird vom Workflow gestartet UND von test/board-takt.test.ts importiert.
/**
 * Generischer Board-Takt (#1390, ursprünglich #1351/#1349): der Workflow `.github/workflows/board-takt.yml` ruft dieses Skript. Es pflegt
 *  1. das Status-Ticket „Langfuse-Status überprüfen“ (Entscheidung und Anlegen: scripts/langfuse-takt.mjs, ADR 0016) und
 *  2. das ungeclaimte Harness-Sammelticket „Harness-Härtung (gesammelt)“: ab `HARNESS_TAKT_KOMMENTARE` Befund-Kommentaren (Härtungs-Takt, Füllstand) hinter den Kopf
 *     holen und, unabhängig von der Aktivität, auf die Position laut AGENTS.md zurückschieben, wenn es dahinter steht (Selbstkorrektur,
 *     nur nach vorn, nie in den Kopf).
 * Die Entscheidungen sind pur und getestet (test/board-takt.test.ts, test/langfuse-takt.test.ts), nur die gh-Aufrufe in `main` sind es nicht.
 *
 * Idempotent und ohne gespeicherten Zähler: jedes Mal wird aus den offenen Issues, der Commit-Liste von main und der Board-Liste
 * abgeleitet, was zu tun ist. Zwei Läufe hintereinander (der Workflow serialisiert sie über seine Concurrency-Group) legen darum nie
 * zwei Tickets an und lassen die Position nicht springen. Die Board-Liste wird je Lauf EINMAL geladen und nach der Status-Aktion im
 * Speicher nachgezogen.
 *
 * Nur Node-Builtins, analog zu board-lib.mjs. `--dry-run` zeigt die Entscheidungen, ändert nichts. Exit 0 grün, 1 Fehler, 2 Aufruf-Fehler (vor jedem I/O).
 */
import { pathToFileURL } from "node:url";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import { fehlerMeldung, fehlerText } from "./gh-cli.mjs";
import { labelAus, ladeProjektConfig } from "./projekt-config-lib.mjs";
import {
  REPO,
  SAMMELTICKET_TITEL,
  STATUS_TITEL,
  TAG_MS,
  addToBoardTodo,
  boardFuerRolle,
  boardRolleFuer,
  alsDatum,
  aufnahmePlan,
  frischeOffeneIssues,
  ghJson,
  itemsUeberIssues,
  kopfEnde,
  loadItems,
  loadOpenIssuePages,
  missingFromBoard,
  normalizeOffene,
  positionLautAgentsMd,
  sammelticketItem,
  sammelticketKorrektur,
  seitenListen,
  setPosition,
  todoItem,
  ungeclaimt,
  verschiebe,
  wirklichFehlend,
} from "./board-lib.mjs";

import { issueKommentare } from "./fremdtext-lib.mjs";
import { bestaetigeAnlegen, entscheideTakt, fuehreStatusAus } from "./langfuse-takt.mjs";
import { HARNESS_TAKT_KOMMENTARE, SPIEL_QUOTE, befundKommentare, harnessIssuesAnfrage, istHarnessCommit, sammelStand, zaehleTicketMerges } from "./spielquote-lib.mjs";

// Die Quote liegt in spielquote-lib.mjs (auch factory-kennzahlen.mjs braucht sie); die API dieses Skripts bleibt stabil.
export { HARNESS_TAKT_KOMMENTARE, SPIEL_QUOTE, befundKommentare, istHarnessCommit, zaehleTicketMerges };

// Zwei Boards (ADR 0022 F11, #1729): Status-Ticket, Harness-Sammelticket und ihre Selbstkorrektur laufen auf dem Factory-Board; der Wächter
// nimmt fehlende Issues nach der Trennregel (`boardRolleFuer`) auf ihrem Board auf.
const FACTORY_BOARD = boardFuerRolle("factory");

/**
 * Beginn des Aktivitätsfensters: 60 s nach `letzterAbschluss` (beim Status-Ticket das Anlegen des jüngsten Tickets, beim
 * Harness-Sammelticket der Abschluss des letzten; deren eigener Squash-Commit soll nicht zählen), ohne Wert 7 Tage vor `jetzt`.
 */
export function mergeFensterAb(letzterAbschluss, jetzt) {
  const j = alsDatum(jetzt, "jetzt");
  if (letzterAbschluss === null || letzterAbschluss === undefined) return new Date(j.getTime() - 7 * TAG_MS);
  return new Date(alsDatum(letzterAbschluss, "letzterAbschluss").getTime() + 60_000);
}

/** Spiel-Merges in einer Commit-Liste: Ticket-Merges (`zaehleTicketMerges`) ohne Harness-Commits (`istHarnessCommit`); mit `seit` nur ab diesem Zeitpunkt. Pur. */
export function zaehleSpielMerges(commits, seit = null, harnessIssues = null) {
  if (!Array.isArray(commits)) throw new Error("commits muss eine Liste sein.");
  return zaehleTicketMerges(commits.filter((c) => !istHarnessCommit(c, harnessIssues)), seit);
}

/**
 * Die Spielquote des Fensters als Zahlen und Zeile für das Protokoll: `harness` und `spiel` = Ticket-Merges (ohne Bots) mit bzw. ohne
 * Harness-Zuordnung (`istHarnessCommit`), `eingehalten` = höchstens 1 Harness auf `SPIEL_QUOTE` Spiel (Notfälle und Security gelten als Harness, sofern ihr Issue das Harness-Label der Config trägt, und
 * zählen hier mit; das Protokoll ist Information, kein Gate). Pur.
 */
export function quotenBericht(commits, seit = null, harnessIssues = null) {
  const harness = zaehleTicketMerges(commits.filter((c) => istHarnessCommit(c, harnessIssues)), seit);
  const spiel = zaehleSpielMerges(commits, seit, harnessIssues);
  const eingehalten = harness * SPIEL_QUOTE <= spiel;
  return { harness, spiel, eingehalten, zeile: `Spielquote: ${harness} Harness- auf ${spiel} Spiel-Merges im Fenster (Soll höchstens 1:${SPIEL_QUOTE}), ${eingehalten ? "eingehalten" : "überschritten"}` };
}

/**
 * Harness-Sammelticket: `items` = Board in Reihenfolge (board-lib), `befundKommentare` = Füllstand des ungeclaimten Sammeltickets (`befundKommentare`: Kommentare
 * vertrauter Nicht-Bot-Autoren), `position` = Position laut AGENTS.md (`sammelticketPosition`). Reihenfolge der Regeln:
 *  1. Ab `HARNESS_TAKT_KOMMENTARE` kommt das erste ungeclaimte Harness-Sammelticket direkt hinter den zusammenhängenden Kopf ganz oben
 *     (Status-, Notfall-, Dependabot-, Forum-Ticket; die „Spitze“ des Boards) → `nach-oben`. Steht es dort schon, ist der Lauf idempotent.
 *     Ist ein Vorgänger (offenes Sammelticket mit Assignee) in Arbeit, entfällt die Regel.
 *  2. Sonst, und auch bei geringem Füllstand: steht es hinter der Position laut AGENTS.md, geht es dorthin zurück (`sammelticketKorrektur`:
 *     nur nach vorn, nie in den Kopf) → `auf-position`. „Still liegen“ unter der Schwelle leistet die Auswahl (`naechstes-ticket`), nicht der Takt.
 *  3. Sonst nichts.
 * Grenze: ein Kopf-Item, das nicht zusammenhängend oben steht, zählt nicht zum Kopf. Liefert `{ aktion: "nach-oben" | "auf-position" | "nichts", nr?, afterId?, grund }`.
 * Ungültige Eingaben (auch ein `position` unter 1) werfen. Pur.
 */
export function entscheideHarnessTakt({ items, befundKommentare: fuellstand, position }) {
  if (!Array.isArray(items)) throw new Error("items muss eine Liste sein.");
  if (!Number.isInteger(fuellstand) || fuellstand < 0) {
    throw new Error(`befundKommentare muss eine ganze Zahl ≥ 0 sein, war ${String(fuellstand)}`);
  }
  if (!Number.isInteger(position) || position < 1) throw new RangeError(`position muss eine ganze Zahl ≥ 1 sein, war ${String(position)}`);
  const ticket = sammelticketItem(items);
  if (!ticket) return { aktion: "nichts", grund: `kein ungeclaimtes „${SAMMELTICKET_TITEL}“` };
  const ende = kopfEnde(items);
  const idx = items.findIndex((i) => i.id === ticket.id);
  const direktHinterKopf = items.slice(ende, idx).every((i) => i.state !== "open");
  const vorgaenger = items.find((i) => i.state === "open" && i.title === SAMMELTICKET_TITEL && !ungeclaimt(i));
  const voll = fuellstand >= HARNESS_TAKT_KOMMENTARE;
  if (voll && !direktHinterKopf && !vorgaenger) {
    return {
      aktion: "nach-oben",
      nr: ticket.number,
      afterId: ende > 0 ? items[ende - 1].id : null,
      grund: `Füllstand ${fuellstand}/${HARNESS_TAKT_KOMMENTARE} Befund-Kommentare, #${ticket.number} kommt hinter den Kopf`,
    };
  }
  const k = sammelticketKorrektur(items, position);
  if (k) {
    return {
      aktion: "auf-position",
      nr: k.nr,
      afterId: k.afterId,
      grund: `#${k.nr} stand auf Rang ${k.vonRang}, zurück auf Rang ${k.nachRang} (Position ${position} laut AGENTS.md)`,
    };
  }
  if (vorgaenger && voll && !direktHinterKopf) {
    return { aktion: "nichts", grund: `Vorgänger #${vorgaenger.number} in Arbeit, der Takt wartet auf dessen Abschluss` };
  }
  if (!voll) {
    return { aktion: "nichts", grund: `Füllstand ${fuellstand}/${HARNESS_TAKT_KOMMENTARE} Befund-Kommentare (Schwelle ${HARNESS_TAKT_KOMMENTARE}), Position stimmt` };
  }
  return { aktion: "nichts", grund: `#${ticket.number} steht schon direkt hinter dem Kopf` };
}

/** Die Factory-Liste ohne Items, die auch auf dem Produkt-Board stehen und laut Trennregel dorthin gehören (`doppelt` aus `seitenListen`). Pur. */
export const factoryListe = (factory, doppelt, config) => factory.filter((i) => !(doppelt.includes(i.number) && boardRolleFuer(i.labels ?? [], config) !== "factory"));

/**
 * Zieht die im Speicher gehaltene Board-Liste nach einer Status-Aktion nach (statt sie neu zu laden): `ergebnis` = `{ nr, itemId }` aus
 * `fuehreStatusAus` bzw. null/ohne `itemId` (nichts bewegt). Das Status-Item steht danach an der Spitze, ein noch nicht gelistetes
 * (frisch angelegt, die REST-Liste liefert es verzögert) wird vorn ergänzt. Pur.
 */
export function ziehListeNach(items, ergebnis) {
  if (!ergebnis?.itemId) return items;
  const vorhanden = items.find((i) => i.id === ergebnis.itemId || i.number === ergebnis.nr);
  if (vorhanden) return verschiebe(items, vorhanden.id, null);
  return [todoItem({ id: ergebnis.itemId, number: ergebnis.nr, title: STATUS_TITEL }), ...items];
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────

/**
 * Darf der Harness-Teil des Takts laufen? Er braucht die Board-Liste (Projekt-Scope des Tokens) und die Position laut AGENTS.md.
 * Fehlt etwas, entfällt NUR dieser Teil (das Status-Ticket braucht beides nicht) und das wird sichtbar gemeldet: ein fehlender Token
 * ist eine Warnung (Exit 0, der Lauf ohne Token ist bekannt), eine fehlende oder mehrdeutige Position ein Fehler (Exit 1), denn die
 * Selbstkorrektur ist dann blind. Liefert `{ ok: true }` oder `{ ok: false, meldung, fehler }`. Pur.
 */
export function harnessVoraussetzung({ items, position, positionFehler }) {
  if (!items) return { ok: false, fehler: false, meldung: "::warning::PROJECT_TOKEN fehlt: Harness-Sammelticket-Takt übersprungen (die Board-Liste braucht den Projekt-Scope)." };
  if (!Number.isInteger(position) || position < 1) {
    return {
      ok: false,
      fehler: true,
      meldung: `::error::Harness-Sammelticket-Takt übersprungen, die Position laut AGENTS.md fehlt: ${fehlerText(positionFehler ?? "keine Position")}`,
    };
  }
  return { ok: true };
}

/**
 * Die Harness-Entscheidung mit Füllstand (Härtungs-Takt): lädt die Kommentare NUR für das ungeclaimte Sammelticket (`sammelticketItem`), zählt die
 * Befund-Kommentare vertrauter Nicht-Bot-Autoren (`befundKommentare`) und fragt `entscheideHarnessTakt`. Fail-closed: lässt sich der Füllstand
 * nicht laden, steht eine `::warning::` im Log und die Aktion ist `nichts` (der Lauf bleibt grün, der nächste versucht es erneut). Fehlt das
 * ungeclaimte Sammelticket in `items`, steht aber offen und ungeclaimt in `offene`, ist die Board-Liste im Verzug: Warnung statt stillem „keins“.
 * Liefert `{ ...Entscheidung, fuellstand }` (`fuellstand` null, wenn nicht geladen). `io.ladeKommentare(nr, repo)` liefert die flache Kommentar-Liste.
 */
export function entscheideMitFuellstand({ items, offene, position, repo, io }) {
  const kandidat = sammelticketItem(items);
  if (!kandidat) {
    const offenes = offene.find((i) => i.titel === SAMMELTICKET_TITEL && (i.assignees ?? []).length === 0);
    if (offenes) io.log(`::warning::Board-Verzug: #${offenes.number} fehlt in der Board-Liste (REST hinkt oder Item fehlt), der Härtungs-Takt sieht das Sammelticket nicht.`);
    return { ...entscheideHarnessTakt({ items, befundKommentare: 0, position }), fuellstand: null };
  }
  let fuellstand;
  try {
    fuellstand = befundKommentare(io.ladeKommentare(kandidat.number, repo), repo.split("/")[0]);
  } catch (err) {
    io.log(`::warning::Härtungs-Takt: Füllstand von #${kandidat.number} nicht ladbar, keine Bewegung (fail-closed): ${fehlerText(err)}`);
    return { aktion: "nichts", grund: `Füllstand von #${kandidat.number} nicht prüfbar`, fuellstand: null };
  }
  return { ...entscheideHarnessTakt({ items, befundKommentare: fuellstand, position }), fuellstand };
}

/** Harness-Entscheidung ausführen; true bei Erfolg. `setze` und `log` sind für den Test injizierbar. */
export function fuehreHarnessAus(h, items, token, { setze = (id, afterId, opts) => setPosition(FACTORY_BOARD, id, afterId, opts), log = console.log } = {}) {
  try {
    setze(items.find((i) => i.number === h.nr).id, h.afterId, { token });
    log("Sammelticket-Position gesetzt.");
    return true;
  } catch (err) {
    log(fehlerMeldung(err, { praefix: "Sammelticket-Position nicht gesetzt: ", zusatz: "Die Wiederholung ist idempotent." }));
    return false;
  }
}

/**
 * Board-Wächter (#1628, zwei Boards #1729): offene Issues ohne Board-Item auf IRGENDEINEM Board (ein still gescheitertes Einsortieren, z.B.
 * #1608 stand einen Tag nicht im Board) nimmt der Takt als Todo am Ende des Boards laut Trennregel auf (`aufnahmePlan`: `rolle`). Die REST-Liste liefert frische Items verzögert: jeder Kandidat wird per GraphQL
 * per Zweitabfrage gegengeprüft (`wirklichFehlend`); ohne Kandidaten entfällt die Abfrage. Jede Aufnahme steht als `::warning::` mit Nummer im Log, jeder
 * Fehler setzt `fehler` (Lauf rot). `dry`: nur Meldung. `listen` = `{ produkt, factory }`; liefert `{ listen, fehler }` (die Liste der Zielseite um die aufgenommenen Todos ergänzt).
 */
export function nimmFehlendeAuf({ offene, listen, token, dry = false, repo = REPO, config }, io) {
  const kandidaten = missingFromBoard(offene.map((i) => i.number), [...listen.produkt, ...listen.factory]);
  if (kandidaten.length === 0) return { listen, fehler: false };
  let fehlend;
  try {
    fehlend = wirklichFehlend(kandidaten, [...io.itemsUeberIssues("produkt", kandidaten, { token }), ...io.itemsUeberIssues("factory", kandidaten, { token })]);
  } catch (err) {
    io.log(fehlerMeldung(err, { praefix: "Board-Wächter: GraphQL-Zweitabfrage fehlgeschlagen: " }));
    return { listen, fehler: true };
  }
  let neu = listen;
  let fehler = false;
  for (const nr of fehlend) {
    try {
      const { aufnehmen, abgelehnt } = aufnahmePlan([nr], { [nr]: io.ghJson(["api", `repos/${repo}/issues/${nr}`]) }, { config });
      for (const a of abgelehnt) io.log(`::warning::Board-Wächter: #${a.number} fehlt im Board, nicht aufgenommen: ${a.grund}.`);
      for (const a of aufnehmen) {
        if (dry) {
          io.log(`Board-Wächter: #${a.number} fehlt im Board, würde als Todo aufgenommen (--dry-run).`);
          continue;
        }
        const id = io.addToBoardTodo(a.rolle, a.nodeId, { token });
        io.log(`::warning::Board-Wächter: #${a.number} fehlte im Board, als Todo auf dem ${a.rolle}-Board aufgenommen.`);
        neu = { ...neu, [a.rolle]: [...neu[a.rolle], todoItem({ id, number: a.number, title: a.title })] };
      }
    } catch (err) {
      fehler = true;
      io.log(fehlerMeldung(err, { praefix: `Board-Wächter: #${nr} nicht aufgenommen: ` }));
    }
  }
  return { listen: neu, fehler };
}

/** Die echte I/O des Takts (gh, Board, Dateien); `fuehreTaktAus` nimmt sie injiziert, damit die Verdrahtung ohne Netz testbar ist. */
export const ECHTE_IO = {
  ghJson,
  frischeOffeneIssues: (a) => frischeOffeneIssues(a),
  itemsUeberIssues: (rolle, nummern, opts) => itemsUeberIssues(boardFuerRolle(rolle), nummern, opts),
  addToBoardTodo: (rolle, nodeId, opts) => addToBoardTodo(boardFuerRolle(rolle), nodeId, opts),
  loadItems: (rolle, opts) => loadItems(boardFuerRolle(rolle), opts),
  loadOpenIssuePages,
  ladeKommentare: (nr, repo) => issueKommentare(nr, ghJson, repo),
  positionLautAgentsMd,
  fuehreStatusAus,
  fuehreHarnessAus,
  log: (z) => console.log(z),
};

/**
 * Der ganze Lauf (#1428 Z23, vorher `main`): Fenster berechnen, Status-Ticket und Harness-Sammelticket entscheiden und ausführen.
 * `io` bündelt jeden Zugriff nach außen (siehe `ECHTE_IO`). Liefert `{ fehler }`; der Aufrufer setzt daraus den Exit-Code.
 */
export function fuehreTaktAus({ jetzt, dry = false, repo = REPO, ausloeser = "schedule", token, io = ECHTE_IO, config }) {
  const harnessLabel = labelAus(config, "harness");
  let position = null;
  let positionFehler = null;
  try {
    position = io.positionLautAgentsMd();
  } catch (err) {
    positionFehler = err.message;
  }
  const offene = normalizeOffene(io.loadOpenIssuePages(repo));
  const seit = new Date(jetzt.getTime() - 90 * TAG_MS).toISOString();
  const geschlossen = io.ghJson(harnessIssuesAnfrage({ repo, label: harnessLabel, seit }))
    .flat()
    .filter((i) => !i.pull_request && typeof i.closed_at === "string")
    .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
  // Die Nummern aller geschlossenen Harness-Issues: die Spielquote ordnet einen Commit über seine `#N`-Referenz zu (istHarnessCommit).
  const harnessIssues = new Set(geschlossen.map((i) => i.number));
  // Der Abschluss des letzten Harness-Sammeltickets beginnt das Fenster der Spielquote (Protokollzeile).
  const { abschluss } = sammelStand([
    ...geschlossen.map((i) => ({ number: i.number, title: i.title, state: "closed", closedAt: i.closed_at })),
    ...offene.map((i) => ({ number: i.number, title: i.titel, state: "open" })),
  ]);
  const letzter = (titel) => {
    const g = geschlossen.find((i) => i.title === titel);
    return g ? { number: g.number, closedAt: g.closed_at, createdAt: g.created_at } : null;
  };
  const vorgaenger = letzter(STATUS_TITEL);
  // Zählfenster (#1628): beginnt mit dem Anlegen des jüngsten Status-Tickets (offen oder geschlossen); jedes Anlegen setzt den Zähler auf 0.
  const angelegt = [vorgaenger?.createdAt, ...offene.filter((i) => i.titel === STATUS_TITEL).map((i) => i.createdAt)]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t));
  const fensterStart = angelegt.length > 0 ? new Date(Math.max(...angelegt)) : (vorgaenger?.closedAt ?? null);
  const abStatus = mergeFensterAb(fensterStart, jetzt).toISOString();
  const abHarness = mergeFensterAb(abschluss?.closedAt ?? null, jetzt).toISOString();
  const fruehestens = abStatus < abHarness ? abStatus : abHarness;
  const commits = io.ghJson(["api", "--paginate", "--slurp", `repos/${repo}/commits?sha=main&since=${fruehestens}&per_page=100`]).flat();
  const imFenster = commits.filter((c) => new Date(c?.commit?.committer?.date ?? 0).getTime() >= new Date(abStatus).getTime());
  // Beide Board-Listen einmal je Lauf (brauchen den Projekt-Scope des Tokens); Status- und Harness-Takt arbeiten auf der Factory-Liste.
  const roh = token ? { produkt: io.loadItems("produkt", { token }), factory: io.loadItems("factory", { token }) } : null;
  const doppelt = roh ? seitenListen(roh.produkt, roh.factory, config).doppelt : [];
  for (const nr of doppelt) io.log(`::warning::Board-Wächter: #${nr} steht auf beiden Boards, es zählt das Board laut Trennregel.`);
  let items = roh ? factoryListe(roh.factory, doppelt, config) : null;

  const stundenSeitAbschluss = vorgaenger ? (jetzt.getTime() - new Date(vorgaenger.closedAt).getTime()) / (TAG_MS / 24) : null;
  const vorEntscheidung = entscheideTakt({ offene, mergesSeit: imFenster.length, ticketMerges: zaehleTicketMerges(commits, abStatus), ausloeser, stundenSeitAbschluss, jetzt });
  // Zweitabfrage nur vor dem Anlegen: die REST-Liste hinkt bei frischen Tickets nach (fail-closed, #1866).
  const e = bestaetigeAnlegen(vorEntscheidung, { zweit: () => io.frischeOffeneIssues({ repo, label: harnessLabel, anzahl: 50, mitBoard: false }) });
  for (const w of e.warnungen) io.log(`::warning::${w}`);
  io.log(`Status-Ticket (${ausloeser}): ${e.aktion}${e.nr ? ` #${e.nr}` : ""} (${e.grund}); Fenster ab ${abStatus}`);
  let fehler = false;
  if (!dry && e.aktion !== "nichts") {
    const r = io.fuehreStatusAus(e, { repo, vorgaenger, jetzt, token, items: items ?? [], config });
    fehler = !r.ok;
    if (items) items = ziehListeNach(items, r);
  }

  // Board-Wächter (#1628): offene Issues ohne Board-Item aufnehmen.
  if (items) {
    const w = nimmFehlendeAuf({ offene, listen: { produkt: roh.produkt, factory: items }, token, dry, repo, config }, io);
    items = w.listen.factory;
    if (w.fehler) fehler = true;
  }

  // Harness-Sammelticket: Aktivität (eigenes Fenster) und Positionskorrektur, auf der nachgezogenen Liste.
  const voraussetzung = harnessVoraussetzung({ items, position, positionFehler });
  if (!voraussetzung.ok) {
    io.log(voraussetzung.meldung);
    if (voraussetzung.fehler) fehler = true;
  } else {
    const h = entscheideMitFuellstand({ items, offene, position, repo, io });
    io.log(`Harness-Sammelticket: ${h.aktion}${h.nr ? ` #${h.nr}` : ""} (${h.grund}); Füllstand ${h.fuellstand ?? "?"}/${HARNESS_TAKT_KOMMENTARE}; Fenster ab ${abHarness}`);
    io.log(quotenBericht(commits, abHarness, harnessIssues).zeile);
    if (!dry && h.aktion !== "nichts" && !io.fuehreHarnessAus(h, items, token)) fehler = true;
  }
  return { fehler };
}

function main() {
  // Aufruf-Fehler vor jedem I/O: sonst schriebe `mitKontingent` seinen Hinweis vor den Fehler (#1817).
  const aufruf = flagsLesen(process.argv.slice(2), { "dry-run": { type: "boolean" } });
  if (aufruf.fehler) {
    console.error(`board-takt: ${aufruf.fehler.text}\nAufruf: node scripts/board-takt.mjs [--dry-run]`);
    process.exitCode = AUFRUF_EXIT;
    return;
  }
  if (process.env.PROJECT_TOKEN) mitKontingent("board-takt", { token: process.env.PROJECT_TOKEN });
  const { fehler } = fuehreTaktAus({
    jetzt: new Date(),
    dry: aufruf.werte["dry-run"] === true,
    repo: REPO,
    ausloeser: process.env.GITHUB_EVENT_NAME || "schedule",
    token: process.env.PROJECT_TOKEN,
    config: ladeProjektConfig(),
  });
  if (fehler) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.log(fehlerMeldung(err));
    process.exitCode = 1;
  }
}
