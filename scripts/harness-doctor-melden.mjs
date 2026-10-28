#!/usr/bin/env node
/* Harness-Doctor, Wochenlauf (#1800, ADR 0022): prüft die Voraussetzungen der Factory wie `harness-doctor.mjs --pruefen` und schreibt jede
 * Lücke, die noch nicht als offene Zeile im Harness-Sammelticket steht, als eine Zeile dorthin, statt still zu scheitern.
 *
 *   node scripts/harness-doctor-melden.mjs [--dry-run]
 *
 * Zeile: `- [ ] <YYYY-MM-DD> Harness-Doctor (Wochenlauf): LÜCKE <Punkt>: <Befund> Fix: <Schritt>`. Bekannt ist ein Punkt, wenn irgendeine offene
 * Zeile `- [ ]` eines vertrauten Autors (`istVertraut`) in einem offenen Harness-Sammelticket (auch einem geclaimten) `Harness-Doctor (Wochenlauf):
 * LÜCKE <Punkt>: ` enthält; Schlüssel ist der Punkt, nicht der Befund (ein geänderter Befund erzeugt keine zweite Zeile). Alle neuen Zeilen
 * eines Laufs gehen in einem Kommentar an das jüngste ungeclaimte Sammelticket. Geprüft wird mit `PROJECT_TOKEN` (Project-Scope); gelesen und
 * gepostet wird im eigenen Repo mit dem Standard-`GH_TOKEN` (`github.token`), in einem fremden Ziel-Repo mit `PROJECT_TOKEN`; fehlt das Secret in Actions, meldet der Lauf genau das als Lücke. Langfuse bleibt außen vor (läuft nur lokal).
 * Exit 0: nichts Neues oder gemeldet (bzw. Dry-Run); 1: Doctor nicht lauffähig, kein ungeclaimtes Sammelticket oder Post fehlgeschlagen
 * (`::error::` mit Fix). Eigenes Skript statt Flag in harness-doctor.mjs: das lädt die Board-Libs nicht (deren Import-Zeit-Config
 * bräche dort den Exit-2-Vertrag der Config-Fehler).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inboxStart, ladeBoardLibs } from "./inbox-start-lib.mjs";
import { fehlerText, ghJson, ghText, tokenFuerZiel } from "./gh-cli.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { istVertraut } from "./fremdtext-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { pruefLauf } from "./harness-doctor-lib.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
export const KENNUNG = "Harness-Doctor (Wochenlauf)";
const einzeilig = (t) => String(t).replace(/\s*\n\s*/g, " ");

/** Schlüssel einer Lücke im Zeilentext (endet mit `: `, damit `Secret A` nicht `Secret AB` trifft). Pur. */
export const schluesselFuer = (punkt) => `${KENNUNG}: LÜCKE ${punkt}: `;

/** Die Sammelticket-Zeile zu einer Lücke `{ punkt, befund, fix }`. Pur. */
export const zeileFuer = (l, heute) => `- [ ] ${heute} ${KENNUNG}: LÜCKE ${l.punkt}: ${einzeilig(l.befund)} Fix: ${l.fix}`;

/** Ist der Punkt schon als offene Zeile eines vertrauten Autors in `kommentare` (`[{ user, body }]`) gemeldet? Pur. */
export function istBekannt(punkt, kommentare, owner) {
  const schluessel = schluesselFuer(punkt);
  return kommentare.some(
    (k) => istVertraut(k?.user ?? null, owner) && String(k?.body ?? "").split(/\r?\n/).some((z) => /^\s*[-*]\s+\[ \]/.test(z) && z.includes(schluessel)),
  );
}

/** Die neuen Zeilen: je Lücke, deren Punkt nicht bekannt ist (zwei Lücken desselben neuen Punkts kommen beide). Pur. */
export const plane = ({ luecken, kommentare, owner, heute }) =>
  luecken.filter((l) => !istBekannt(l.punkt, kommentare, owner)).map((l) => zeileFuer(l, heute));

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
 * Ein Lauf mit eingespeister IO: `ermittle() -> Lücken`, `kontext() -> { kommentare, owner, ziel }` (`ziel` = Nummer des jüngsten ungeclaimten
 * Sammeltickets oder null), `postZeilen(nr, text)`, `heute`, `log`. Trockenlauf druckt die Zeilen und schreibt nichts.
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
    zeilen = plane({ luecken, kommentare: k.kommentare, owner: k.owner, heute: io.heute });
  } catch (err) {
    log(`::error::${KENNUNG}: Sammelticket nicht lesbar: ${einzeilig(fehlerText(err))} Fix: gh-Zugriff und Token prüfen`);
    return 1;
  }
  if (zeilen.length === 0) {
    log(`${KENNUNG}: nichts Neues (${luecken.length} Lücke(n) schon als offene Zeile gemeldet)`);
    return 0;
  }
  if (!ziel) {
    log(`::error::${KENNUNG}: kein ungeclaimtes Harness-Sammelticket für ${zeilen.length} neue Zeile(n) Fix: node scripts/sammelticket-anlegen.mjs harness`);
    return 1;
  }
  if (trocken) {
    for (const z of zeilen) log(`[dry-run] ${z}`);
    return 0;
  }
  try {
    io.postZeilen(ziel, zeilen.join("\n"));
  } catch (err) {
    log(`::error::${KENNUNG}: Zeilen nicht gepostet: ${einzeilig(fehlerText(err))} Fix: Token-Recht issues: write prüfen`);
    return 1;
  }
  log(`${KENNUNG}: ${zeilen.length} Zeile(n) in #${ziel}.`);
  return 0;
}

// ---- IO (ungetestet) ----

/** Einstieg. `deps` (Tests): `env` (Standard `process.env`), `ladeConfig()`, `ladeLibs()` (liefert `REPO`, `ladeSammelKontext`, `postZeilen`, `waehleSammelticket`), `log`, `err`, `pruefLauf` (Doctor-Lauf; der Wochenlauf ruft ihn mit `rootDir`, `gh` und `langfuse: null`, ohne `umgebung`). */
export async function main(argv = process.argv.slice(2), { ladeConfig = () => ladeProjektConfig({ rootDir: WURZEL }), ladeLibs = ladeBoardLibs, log = console.log, err = console.error, pruefLauf: doctorLauf = pruefLauf, env = process.env } = {}) {
  const start = await inboxStart(argv, { skript: "harness-doctor-melden", praefix: `${KENNUNG}: Projekt-Config nicht lesbar: `, ladeConfig, ladeLibs, log, err });
  if (start.code !== undefined) return start.code;
  const { trocken, libs } = start;
  const { REPO, ladeSammelKontext, postZeilen, waehleSammelticket } = libs;
  const ziel = libs.ZIEL ?? REPO; // Ziel-Repo der Harness-Befunde (#78): ein fremdes braucht PROJECT_TOKEN zum Lesen und Posten
  const zielToken = tokenFuerZiel({ ziel, eigenes: REPO, env });
  const projektToken = env.PROJECT_TOKEN;
  const io = {
    ermittle: () =>
      ermittleLuecken({
        env,
        repo: REPO,
        pruefe: () => doctorLauf({ rootDir: WURZEL, gh: (a) => ghText(a, { token: projektToken, timeout: 30000 }), langfuse: null }).ergebnis,
      }),
    kontext: () => {
      const { offene, kommentare, owner } = ladeSammelKontext({ token: zielToken });
      return { kommentare, owner, ziel: waehleSammelticket(offene, ziel, (a) => ghJson(a, { token: zielToken }))?.number ?? null };
    },
    postZeilen: (nr, text) => postZeilen(nr, text, ziel, zielToken),
    heute: new Date().toISOString().slice(0, 10),
    log,
  };
  return lauf({ io, trocken });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
