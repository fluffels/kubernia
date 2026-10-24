#!/usr/bin/env node
/**
 * Wiedervorlage (#1628): Prüfpunkte mit Fälligkeitsdatum tauchen automatisch als Ticket ganz oben im Board auf.
 *
 * Daten: `.github/wiedervorlagen.json` (Liste von { id, faellig, titel, text, label?, alerts? }; `alerts` nur für `codescanning-*`: Alert-Nummern,
 * die die Code-Scanning-Inbox trotz Spitzen-Stufe still hält). Der tägliche Workflow
 * `.github/workflows/wiedervorlage.yml` legt je fälligem Eintrag ohne Ticket eines an (Dedupe über den Marker
 * `<!-- wiedervorlage:<id> -->` im Body, über alle Zustände) und sortiert es per `board-place.mjs --notfall wiedervorlage --top` ein.
 * Der Agent schließt das Ticket und löscht den Eintrag im selben PR. Wächter: bleibt ein fälliger Eintrag ohne Ticket, endet der Lauf mit Exit 1.
 *
 * Aufruf: node scripts/wiedervorlage.mjs [--dry-run]
 * Die Funktionen oben sind pur und getestet (test/wiedervorlage.test.ts); die gh-Aufrufe unten nicht.
 */
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./hook-io.mjs";
import { readFileSync } from "node:fs";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { inboxStart } from "./inbox-start-lib.mjs";
import { labelAus } from "./projekt-config-lib.mjs";

/** Titel-Präfix der Wiedervorlage-Tickets; derselbe Marker steht als Notfall-Art `wiedervorlage` in `NOTFAELLE` (board-lib.mjs). */
export const TITEL_PRAEFIX = "⏰ Wiedervorlage:";

/** Pur: das Label eines Eintrags; ohne eigenes `label` das Standard-Label (im Lauf das Harness-Label der Projekt-Config). */
export const labelFuer = (eintrag, standard) => eintrag.label ?? standard;

const DATEI = fileURLToPath(new URL("../.github/wiedervorlagen.json", import.meta.url));

/** Der Marker im Ticket-Body, über den ein Eintrag sein Ticket wiederfindet. Pur. */
export const markerFuer = (id) => `<!-- wiedervorlage:${id} -->`;

/** True für ein echtes Kalenderdatum `YYYY-MM-DD` (kein "2026-13-01", kein "2026-02-30"). Pur. */
export function istDatum(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Prüft die Liste; liefert die Fehlermeldungen (leer = gültig). Pur. */
export function pruefeEintraege(liste) {
  if (!Array.isArray(liste)) return ["Die Wiedervorlagen-Datei muss eine Liste sein."];
  const fehler = [];
  const gesehen = new Set();
  liste.forEach((e, i) => {
    const name = `Eintrag ${i + 1}${typeof e?.id === "string" ? ` (${e.id})` : ""}`;
    if (e === null || typeof e !== "object" || Array.isArray(e)) return fehler.push(`${name}: kein Objekt.`);
    for (const feld of ["id", "faellig", "titel", "text"]) {
      if (typeof e[feld] !== "string" || e[feld].trim() === "") fehler.push(`${name}: Pflichtfeld „${feld}“ fehlt oder ist leer.`);
    }
    if (e.label !== undefined && (typeof e.label !== "string" || e.label.trim() === "")) fehler.push(`${name}: „label“ muss eine nicht leere Zeichenkette sein.`);
    if (e.alerts !== undefined && (!Array.isArray(e.alerts) || e.alerts.length === 0 || !e.alerts.every((n) => Number.isInteger(n) && n > 0))) {
      fehler.push(`${name}: „alerts“ muss eine nicht leere Liste positiver Ganzzahlen (Code-Scanning-Alert-Nummern) sein.`);
    }
    if (e.alerts !== undefined && typeof e.id === "string" && !e.id.startsWith("codescanning-")) {
      fehler.push(`${name}: „alerts“ gibt es nur bei einer id „codescanning-<slug>“.`);
    }
    if (typeof e.id === "string" && e.id !== "") {
      if (!/^[a-z0-9-]+$/.test(e.id)) fehler.push(`${name}: „id“ darf nur [a-z0-9-] enthalten.`);
      if (gesehen.has(e.id)) fehler.push(`${name}: „id“ ist doppelt.`);
      gesehen.add(e.id);
    }
    if (typeof e.faellig === "string" && e.faellig !== "" && !istDatum(e.faellig)) fehler.push(`${name}: „faellig“ ist kein gültiges Datum (YYYY-MM-DD): ${e.faellig}`);
  });
  return fehler;
}

/** Fällig ist ein Eintrag am Fälligkeitstag und danach (`heute` als `YYYY-MM-DD`). Pur. */
export function faellige({ eintraege, heute }) {
  return eintraege.filter((e) => e.faellig <= heute);
}

/** Der Schließtag `YYYY-MM-DD` aus `closedAt` (ISO-Zeitstempel) oder null, wenn er fehlt oder kein Datum ist. Pur. */
const schlussTag = (t) => {
  const tag = typeof t?.closedAt === "string" ? t.closedAt.slice(0, 10) : "";
  return istDatum(tag) ? tag : null;
};

/**
 * Aktionen je fälligem Eintrag. `tickets` = [{ number, state (open|closed), body, closedAt? }] (alle Zustände).
 * - kein Ticket mit Marker: `anlegen`
 * - offenes Ticket: nichts
 * - nur geschlossene Tickets, alle mit Schließtag vor `faellig` (Eintrag verschoben): `anlegen`
 * - sonst nur geschlossene (Eintrag steht noch, auch ohne lesbares `closedAt`): `warnen` ("Eintrag löschen"), kein neues Ticket.
 * Pur.
 */
export function planeAktionen({ faellige: liste, tickets }) {
  const aktionen = [];
  for (const e of liste) {
    const marker = markerFuer(e.id);
    const treffer = tickets.filter((t) => String(t.body ?? "").includes(marker));
    if (treffer.length === 0) aktionen.push({ art: "anlegen", eintrag: e });
    else if (!treffer.some((t) => String(t.state).toLowerCase() === "open")) {
      // Verschoben: alle Tickets wurden vor dem (neuen) Fälligkeitstag geschlossen, also gehören sie zum früheren Termin.
      if (treffer.every((t) => schlussTag(t) !== null && schlussTag(t) < e.faellig)) aktionen.push({ art: "anlegen", eintrag: e });
      else aktionen.push({ art: "warnen", eintrag: e, nummer: treffer[0].number });
    }
  }
  return aktionen;
}

/** Titel und Body des Tickets zu einem Eintrag. Pur. */
export function ticketText(e) {
  return {
    titel: `${TITEL_PRAEFIX} ${e.titel}`,
    body: `${markerFuer(e.id)}\n\n${e.text}\n\nFällig seit ${e.faellig}. Abarbeiten: prüfen, dann in **einem** PR den Eintrag \`${e.id}\` aus \`.github/wiedervorlagen.json\` löschen und dieses Ticket schließen; soll der Termin nur wandern, stattdessen \`faellig\` neu setzen (die id bleibt, der Lauf legt dann zum neuen Datum ein neues Ticket an) und dieses Ticket schließen (Mechanik: docs/ticket-reihenfolge.md › Wiedervorlage).`,
  };
}

// ---- IO (ungetestet) ----

function ladeEintraege() {
  const liste = JSON.parse(readFileSync(DATEI, "utf8"));
  const fehler = pruefeEintraege(liste);
  if (fehler.length > 0) throw new Error(`.github/wiedervorlagen.json ungültig:\n- ${fehler.join("\n- ")}`);
  return liste;
}

/** Alle Issues (offen und geschlossen) aus der konsistenten Listenabfrage, nicht aus dem verzögerten Such-Index. */
// Grenze: die jüngsten 1000 Issues (alle Zustände). Ein Wiedervorlage-Ticket wird zeitnah abgearbeitet und der Eintrag im selben PR gelöscht; ein Ticket, das hinter die 1000 fällt, stünde nur bei vergessenem Löschen noch an (dann Dublette statt Warnung).
const ladeTickets = (repo) => ghJson(["issue", "list", "--repo", repo, "--state", "all", "--limit", "1000", "--json", "number,state,body,closedAt"]);

function legeAn(e, label, repo) {
  const { titel, body } = ticketText(e);
  const url = ghText(["issue", "create", "--repo", repo, "--title", titel, "--label", label, "--body", body]).trim();
  return Number(url.split("/").pop());
}

function sortiereEin(nr, platziereOben) {
  const token = process.env.PROJECT_TOKEN;
  if (!token) {
    console.log(`::warning::PROJECT_TOKEN fehlt: #${nr} steht nicht oben im Board.`);
    return false;
  }
  try {
    platziereOben(nr, "wiedervorlage", token);
    return true;
  } catch (err) {
    console.log(`::error::Board-Position für #${nr} nicht gesetzt: ${fehlerText(err)}`);
    return false;
  }
}

/**
 * Ein Lauf mit eingespeister IO (`anlegen(eintrag) -> Nummer`, `sortiereEin(nr) -> bool`, `log`): liefert den Exit-Code.
 * Wächter: ein fälliger Eintrag, dessen Ticket nicht entsteht (oder nicht oben landet), macht den Lauf rot; der Trockenlauf ändert nichts und ist grün.
 */
export function lauf({ eintraege, heute, tickets, trocken = false, anlegen, sortiereEin: sortiere, log = console.log }) {
  let rot = false;
  for (const a of planeAktionen({ faellige: faellige({ eintraege, heute }), tickets })) {
    if (a.art === "warnen") {
      log(`::warning::Wiedervorlage ${a.eintrag.id}: Ticket #${a.nummer} ist geschlossen, der Eintrag steht noch in .github/wiedervorlagen.json. Eintrag löschen.`);
      continue;
    }
    if (trocken) {
      log(`[dry-run] würde anlegen: ${TITEL_PRAEFIX} ${a.eintrag.titel}`);
      continue;
    }
    let nr;
    try {
      nr = anlegen(a.eintrag);
    } catch (err) {
      log(`::error::Ticket für ${a.eintrag.id} nicht angelegt: ${fehlerText(err)}`);
      rot = true;
      continue;
    }
    log(`Angelegt: #${nr} (${a.eintrag.id})`);
    if (!sortiere(nr)) rot = true;
  }
  return rot ? 1 : 0;
}

/** Die Verdrahtung von `lauf` mit dem Standard-Label aus der Config (`labels.harness`, wirft ohne); Eintrags-Label geht vor. */
export function ioAus(config, { legen = legeAn, repo, platziereOben } = {}) {
  const standard = labelAus(config, "harness");
  return { anlegen: (e) => legen(e, labelFuer(e, standard), repo), sortiereEin: (nr) => sortiereEin(nr, platziereOben) };
}

/** Einstieg. `deps` (Tests): `ladeConfig()`, `ladeLibs()` (liefert `REPO`, `platziereOben`), `eintraegeLaden()`, `ticketsLaden(repo)`, `legen(eintrag, label, repo)`, `log`, `err`. Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), { ladeConfig, ladeLibs, eintraegeLaden = ladeEintraege, ticketsLaden = ladeTickets, legen, log = console.log, err = console.error } = {}) {
  const start = await inboxStart(argv, { skript: "wiedervorlage", praefix: "Wiedervorlage: Projekt-Config nicht lesbar: ", ladeConfig, ladeLibs, log, err });
  if (start.code !== undefined) return start.code;
  const { trocken, config, libs } = start;
  const { REPO, platziereOben } = libs;
  return lauf({
    eintraege: eintraegeLaden(),
    heute: new Date().toISOString().slice(0, 10),
    tickets: ticketsLaden(REPO),
    trocken,
    log,
    ...ioAus(config, { legen, repo: REPO, platziereOben }),
  });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
