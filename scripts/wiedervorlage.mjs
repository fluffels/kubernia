#!/usr/bin/env node
/**
 * Wiedervorlage (#1628): Prüfpunkte mit Fälligkeitsdatum tauchen automatisch als Ticket ganz oben im Board auf.
 *
 * Daten: `.github/wiedervorlagen.json` (Liste von { id, faellig, titel, text, label? }). Der tägliche Workflow
 * `.github/workflows/wiedervorlage.yml` legt je fälligem Eintrag ohne Ticket eines an (Dedupe über den Marker
 * `<!-- wiedervorlage:<id> -->` im Body, über alle Zustände) und sortiert es per `board-place.mjs --notfall wiedervorlage --top` ein.
 * Der Agent schließt das Ticket und löscht den Eintrag im selben PR. Wächter: bleibt ein fälliger Eintrag ohne Ticket, endet der Lauf mit Exit 1.
 *
 * Aufruf: node scripts/wiedervorlage.mjs [--dry-run]
 * Die Funktionen oben sind pur und getestet (test/wiedervorlage.test.ts); die gh-Aufrufe unten nicht.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { REPO } from "./board-lib.mjs";

/** Titel-Präfix der Wiedervorlage-Tickets; derselbe Marker steht als Notfall-Art `wiedervorlage` in `NOTFAELLE` (board-lib.mjs). */
export const TITEL_PRAEFIX = "⏰ Wiedervorlage:";

const STANDARD_LABEL = "area:harness";
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

/**
 * Aktionen je fälligem Eintrag. `tickets` = [{ number, state (open|closed), body }] (alle Zustände).
 * - kein Ticket mit Marker: `anlegen`
 * - offenes Ticket: nichts
 * - nur geschlossenes Ticket (Eintrag steht noch): `warnen` ("Eintrag löschen"), kein neues Ticket.
 * Pur.
 */
export function planeAktionen({ faellige: liste, tickets }) {
  const aktionen = [];
  for (const e of liste) {
    const marker = markerFuer(e.id);
    const treffer = tickets.filter((t) => String(t.body ?? "").includes(marker));
    if (treffer.length === 0) aktionen.push({ art: "anlegen", eintrag: e });
    else if (!treffer.some((t) => String(t.state).toLowerCase() === "open")) {
      aktionen.push({ art: "warnen", eintrag: e, nummer: treffer[0].number });
    }
  }
  return aktionen;
}

/** Titel und Body des Tickets zu einem Eintrag. Pur. */
export function ticketText(e) {
  return {
    titel: `${TITEL_PRAEFIX} ${e.titel}`,
    body: `${markerFuer(e.id)}\n\n${e.text}\n\nFällig seit ${e.faellig}. Abarbeiten: prüfen, dann in **einem** PR den Eintrag \`${e.id}\` aus \`.github/wiedervorlagen.json\` löschen und dieses Ticket schließen (Mechanik: docs/ticket-reihenfolge.md › Wiedervorlage).`,
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
const ladeTickets = () => ghJson(["issue", "list", "--repo", REPO, "--state", "all", "--limit", "1000", "--json", "number,state,body"]);

function legeAn(e, label) {
  const { titel, body } = ticketText(e);
  const url = ghText(["issue", "create", "--repo", REPO, "--title", titel, "--label", label, "--body", body]).trim();
  return Number(url.split("/").pop());
}

function sortiereEin(nr) {
  const token = process.env.PROJECT_TOKEN;
  if (!token) {
    console.log(`::warning::PROJECT_TOKEN fehlt: #${nr} steht nicht oben im Board.`);
    return false;
  }
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL("./board-place.mjs", import.meta.url)), "--notfall", "wiedervorlage", "--top", String(nr)], {
      env: { ...process.env, GH_TOKEN: token },
      stdio: "inherit",
    });
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

function main() {
  const eintraege = ladeEintraege();
  const code = lauf({
    eintraege,
    heute: new Date().toISOString().slice(0, 10),
    tickets: ladeTickets(),
    trocken: process.argv.includes("--dry-run"),
    anlegen: (e) => legeAn(e, e.label ?? STANDARD_LABEL),
    sortiereEin,
  });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
