#!/usr/bin/env node
/* Harness-Doctor, Wochenlauf (#1800, ADR 0022): prüft die Voraussetzungen der Factory wie `harness-doctor.mjs --pruefen` und schreibt jede
 * Lücke, die noch nicht als offene Zeile im Harness-Sammelticket steht, als eine Zeile dorthin, statt still zu scheitern.
 *
 *   node scripts/harness-doctor-melden.mjs [--dry-run]
 *
 * Zeile: `- [ ] <YYYY-MM-DD> Harness-Doctor (Wochenlauf): LÜCKE <Punkt>: <Befund> Fix: <Schritt>`, bei einem nicht prüfbaren Punkt (factory#116) `NICHT PRÜFBAR` statt `LÜCKE`.
 * Bekannt ist ein Punkt, wenn irgendeine offene Zeile `- [ ]` eines vertrauten Autors (`istVertraut`) in einem offenen Harness-Sammelticket (auch einem geclaimten)
 * `Harness-Doctor (Wochenlauf): <Art> <Punkt>: ` mit derselben Art enthält; Schlüssel ist Art und Punkt, nicht der Befund (ein geänderter Befund erzeugt keine zweite Zeile;
 * wird aus „nicht prüfbar“ eine Lücke, ändert sich die Abhilfe und es kommt eine neue Zeile). Alle neuen Zeilen
 * eines Laufs gehen in einem Kommentar an das jüngste ungeclaimte Sammelticket der Meldestelle (factory#153, Schlüssel `meldestelle`, Standard das Repo des Factory-Boards), mit dem Factory-Stand als
 * Fußzeile und nach `check-internalrefs --text` (Treffer: nichts gesendet, Exit 1). Geprüft wird mit `PROJECT_TOKEN` (Project-Scope); gelesen und
 * gepostet wird im eigenen Repo mit dem Standard-`GH_TOKEN` (`github.token`), an einer fremden Meldestelle mit `MELDESTELLE_TOKEN` (Rückfall `PROJECT_TOKEN`); fehlt `PROJECT_TOKEN` in Actions, meldet der Lauf genau das als Lücke. Langfuse bleibt außen vor (läuft nur lokal).
 * Exit 0: nichts Neues oder gemeldet (bzw. Dry-Run); 1: Doctor nicht lauffähig, kein ungeclaimtes Sammelticket oder Post fehlgeschlagen
 * (`::error::` mit Fix). Eigenes Skript statt Flag in harness-doctor.mjs: das lädt die Board-Libs nicht (deren Import-Zeit-Config
 * bräche dort den Exit-2-Vertrag der Config-Fehler).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inboxStart, ladeBoardLibs } from "./inbox-start-lib.mjs";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { pruefeDateien } from "./harness-doctor-dateien.mjs";
import { mitMeldestelle } from "./harness-doctor-meldestelle.mjs";
import { pruefLauf } from "./harness-doctor-lib.mjs";
import { bereiteMeldung, eigenerLogin, keinSammelticketText, meldestelleZugang, zeileBekannt } from "./meldung-lib.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
export const KENNUNG = "Harness-Doctor (Wochenlauf)";
const einzeilig = (t) => String(t).replace(/\s*\n\s*/g, " ");

/** Art der Meldung zu einem Ergebnis des Doctors: `NICHT PRÜFBAR` bei `nichtPruefbar`, sonst `LÜCKE`. Pur. */
export const artFuer = (l) => (l.nichtPruefbar === true ? "NICHT PRÜFBAR" : "LÜCKE");

/** Schlüssel einer Meldung im Zeilentext (endet mit `: `, damit `Secret A` nicht `Secret AB` trifft). Pur. */
export const schluesselFuer = (punkt, art = "LÜCKE") => `${KENNUNG}: ${art} ${punkt}: `;

/** Die Sammelticket-Zeile zu einer Lücke oder einem nicht prüfbaren Punkt `{ punkt, befund, fix, nichtPruefbar? }`. Pur. */
export const zeileFuer = (l, heute) => `- [ ] ${heute} ${schluesselFuer(l.punkt, artFuer(l))}${einzeilig(l.befund)} Fix: ${l.fix}`;

/** Ist der Punkt (mit dieser Art) schon als offene Zeile eines vertrauten Autors in `kommentare` (`[{ user, body }]`) gemeldet? `eigen`: Login des eigenen Kontos an einer fremden Meldestelle (zählt als vertraut, factory#153). Pur. */
export const istBekannt = (punkt, kommentare, owner, art = "LÜCKE", eigen = null) => zeileBekannt({ kommentare, owner, eigen, schluessel: schluesselFuer(punkt, art) });

/** Die neuen Zeilen: je Lücke, deren Punkt nicht bekannt ist (zwei Lücken desselben neuen Punkts kommen beide). Pur. */
export const plane = ({ luecken, kommentare, owner, heute, eigen = null }) =>
  luecken.filter((l) => !istBekannt(l.punkt, kommentare, owner, artFuer(l), eigen)).map((l) => zeileFuer(l, heute));

/**
 * Die Lücken dieses Laufs. In Actions ohne `PROJECT_TOKEN` kann der Doctor nichts prüfen (kein einziger Aufruf): dann ist genau das die Lücke.
 * `pruefe()` liefert die Ergebnisliste des Doctors.
 */
export function ermittleLuecken({ env, repo, pruefe }) {
  if (env.GITHUB_ACTIONS === "true" && !env.PROJECT_TOKEN) {
    return [{ punkt: "Secret PROJECT_TOKEN", befund: "im Wochenlauf leer, der Doctor kann nicht prüfen", fix: `Wert per stdin, ohne TTY: \`<wert-quelle> | gh secret set PROJECT_TOKEN --repo ${repo}\` (z. B. \`Get-Clipboard | …\`)` }];
  }
  return pruefe().filter((p) => !p.ok);
}

/**
 * Ein Lauf mit eingespeister IO: `ermittle() -> Lücken`, `kontext() -> { kommentare, owner, ziel, eigen? }` (`ziel` = Nummer des jüngsten ungeclaimten
 * Sammeltickets, sonst keine Nummer), `bereite(zeilen)` (`bereiteMeldung`: `{ ok, text | grund }`), `postZeilen(nr, text)`, `heute`, `log`. Trockenlauf druckt die Zeilen und schreibt nichts.
 */
export function lauf({ io, trocken = false }) {
  const log = io.log ?? console.log;
  let luecken;
  try {
    luecken = io.ermittle();
  } catch (err) {
    log(`::error::${KENNUNG}: Doctor nicht lauffähig: ${einzeilig(fehlerText(err))} Fix: Projekt-Config und Ruleset-Spiegel prüfen (node scripts/harness-doctor.mjs --pruefen)`);
    return 1;
  }
  log("HINWEIS Langfuse: im Wochenlauf nicht geprüft (lokal: node scripts/langfuse-vorbedingung.mjs)");
  if (luecken.length === 0) {
    log(`${KENNUNG}: nichts Neues`);
    return 0;
  }
  let zeilen;
  let ziel;
  try {
    const k = io.kontext();
    ziel = k.ziel;
    zeilen = plane({ luecken, kommentare: k.kommentare, owner: k.owner, heute: io.heute, eigen: k.eigen ?? null });
  } catch (err) {
    log(`::error::${KENNUNG}: Sammelticket nicht lesbar: ${einzeilig(fehlerText(err))} Fix: gh-Zugriff und Token prüfen`);
    return 1;
  }
  if (zeilen.length === 0) {
    log(`${KENNUNG}: nichts Neues (${luecken.length} Lücke(n) schon als offene Zeile gemeldet)`);
    return 0;
  }
  if (!ziel) {
    log(`::error::${KENNUNG}: ${keinSammelticketText({ fuer: `für ${zeilen.length} neue Zeile(n)`, ci: true, trenner: " " })}`);
    return 1;
  }
  const m = io.bereite(zeilen);
  if (!m.ok) {
    log(`::error::${KENNUNG}: ${einzeilig(m.grund)}`);
    return 1;
  }
  if (trocken) {
    log(`[dry-run] ${m.text}`);
    return 0;
  }
  try {
    io.postZeilen(ziel, m.text);
  } catch (err) {
    log(`::error::${KENNUNG}: Zeilen nicht gepostet: ${einzeilig(fehlerText(err))} Fix: Token-Recht issues: write an der Meldestelle prüfen (MELDESTELLE_TOKEN)`);
    return 1;
  }
  log(`${KENNUNG}: ${zeilen.length} Zeile(n) in #${ziel}.`);
  return 0;
}

// ---- IO (ungetestet) ----

/** Einstieg. `deps` (Tests): `env` (Standard `process.env`), `api` (Standard `ghJson`: Wahl des Sammeltickets und `gh api user` für das eigene Konto), `ladeConfig()`, `ladeLibs()` (liefert `REPO`, `MELDESTELLE`, `ladeSammelKontext`, `postZeilen`, `waehleSammelticket`), `log`, `err`, `bereite(zeilen, { herkunft })` (Standard `bereiteMeldung`), `pruefLauf` (Doctor-Lauf; der Wochenlauf ruft ihn mit `rootDir`, `gh`, `langfuse: null` und `dateien` (factory#94, dazu der Punkt `Meldestelle` an einer fremden Stelle, factory#208), ohne `umgebung`). */
export async function main(argv = process.argv.slice(2), { ladeConfig = () => ladeProjektConfig({ rootDir: WURZEL }), ladeLibs = ladeBoardLibs, log = console.log, err = console.error, pruefLauf: doctorLauf = pruefLauf, env = process.env, api = ghJson, bereite = (zeilen, opt) => bereiteMeldung(zeilen, { wurzel: WURZEL, ...opt }) } = {}) {
  const start = await inboxStart(argv, { skript: "harness-doctor-melden", praefix: `${KENNUNG}: Projekt-Config nicht lesbar: `, ladeConfig, ladeLibs, log, err });
  if (start.code !== undefined) return start.code;
  const { trocken, libs } = start;
  const { REPO, ladeSammelKontext, postZeilen, waehleSammelticket } = libs;
  const ziel = libs.MELDESTELLE ?? libs.ZIEL ?? REPO; // Meldestelle (factory#153): eine fremde braucht MELDESTELLE_TOKEN (Rückfall PROJECT_TOKEN) zum Lesen und Posten
  const zugang = meldestelleZugang({ stelle: ziel, eigenes: REPO, env });
  const projektToken = env.PROJECT_TOKEN;
  const io = {
    ermittle: () =>
      ermittleLuecken({
        env,
        repo: REPO,
        pruefe: () => doctorLauf({ rootDir: WURZEL, gh: (a) => ghText(a, { token: projektToken, timeout: 30000 }), langfuse: null, dateien: mitMeldestelle(pruefeDateien, { env, lesen: (a, token) => api(a, { token, timeout: 30000 }) }) }).ergebnis,
      }),
    kontext: () => {
      const { offene, kommentare, owner } = ladeSammelKontext({ repo: ziel, token: zugang.token });
      const eigen = eigenerLogin({ zugang, api, warn: log });
      return { kommentare, owner, eigen, ziel: waehleSammelticket(offene, ziel, (a) => api(a, { token: zugang.token }))?.number };
    },
    bereite: (zeilen) => bereite(zeilen, { herkunft: zugang.herkunft }),
    postZeilen: (nr, text) => postZeilen(nr, text, ziel, zugang.token),
    heute: new Date().toISOString().slice(0, 10),
    log,
  };
  return lauf({ io, trocken });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
