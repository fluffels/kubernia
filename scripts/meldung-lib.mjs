/**
 * Meldungen an die Meldestelle (factory#153): der eine Weg, auf dem ein Bezieher Harness-Befunde an sein Eingangs-Repo schickt (Schlüssel `meldestelle`
 * der Projekt-Config, Standard das Repo des Boards mit Rolle `factory`). Drei Bausteine, alle pur bis auf die Prüfung:
 *  - `factoryStand`/`meldungsText`: jede Meldung trägt als letzte Zeile den Factory-Stand aus `.factory/sync-stand.json` (Tag und Commit); ohne Sync-Stand
 *    (das Repo ist selbst upstream) bleibt der Text unverändert, ein unlesbarer Stand sperrt das Senden (`bereiteMeldung`: keine Meldung ohne Herkunftsangabe, Fix-Zeile nennt die Datei).
 *  - `textSauber`: startet `check-internalrefs.mjs --text` als Kindprozess; nur Exit 0 ist sauber, alles andere (Treffer, Aufruffehler, Signal, Startfehler)
 *    sperrt das Senden (fail-closed). Das Skript nennt den Begriff nie.
 *  - `meldestelleToken`/`meldestelleZugang`: das Token gegen die Meldestelle (`MELDESTELLE_TOKEN`, Rückfall `PROJECT_TOKEN`; das eigene Repo braucht keins) und der Zugang `{ stelle, fremd, herkunft, token }`,
 *    den alle drei Schreiber einmal rechnen (`herkunft`: das eigene Repo, wenn die Stelle fremd ist; `zielToken` in inbox-lib gilt dem Ziel-Repo der Sicherheits-Inboxen und bleibt getrennt).
 *  - `nummernMitHerkunft`: nackte `#n` einer Meldung werden an einer fremden Meldestelle `owner/name#n` (sonst verlinkt `#n` dort auf ein fremdes Issue); `bereiteMeldung` tut das vor der Sperrprüfung.
 *  - `eigenerLogin`/`zeileBekannt`: die Dedupe der Wochen- und Reparaturzeilen erkennt an einer fremden Meldestelle auch die Zeilen des eigenen Kontos (`gh api user`; ohne Login Rückfall auf den Owner plus Warnzeile).
 *  - `keinSammelticketText`: der gemeinsame Fix-Text, wenn die Meldestelle kein ungeclaimtes Harness-Sammelticket hat (Agentenvariante und CI-Variante).
 * `bereiteMeldung` ist der Einstieg für alle Schreiber (`melden.mjs`, `harness-doctor-melden.mjs`, `spezifikation.mjs gescheitert`): kein Treffer, kein Post.
 * Der Wächter in `test/meldung-lib.test.ts` verlangt, dass jedes Skript, das `postZeilen` aufruft, `bereiteMeldung` nutzt; Grenze: direkte Kommentar-Posts zur
 * Ticket-Pflege und Doku-Snippets fasst er nicht. Kein Import von `board-lib`/`inbox-lib` (Zyklus): Repo und Token reicht der Aufrufer herein.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fehlerText, tokenFuerZiel } from "./gh-cli.mjs";
import { istVertraut } from "./fremdtext-lib.mjs";
import { gleichesRepo } from "./repo-form.mjs";
import { STAND_PFAD, liesSyncStand } from "./sync-stand-lib.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRUEFER = join(WURZEL, "scripts", "check-internalrefs.mjs");

/** Pur: die Stand-Zeile (`factory: v0.6.0 (abc1234)`) zu einem Sync-Stand `{ zustand, stand }` (`liesSyncStand`); `null` ohne Sync-Stand (kein Bezieher). */
export function factoryStand({ zustand, stand }) {
  if (zustand === "fehlt") return null;
  if (zustand !== "ok") return "factory: unbekannt (Sync-Stand unlesbar)";
  const quelle = stand?.quelle ?? {};
  const tag = typeof quelle.tag === "string" && quelle.tag !== "" ? quelle.tag : "ohne Tag";
  const commit = typeof quelle.commit === "string" && quelle.commit !== "" ? quelle.commit.slice(0, 7) : "unbekannt";
  return `factory: ${tag} (${commit})`;
}

const STAND_ZEILE = /^factory: .+ \((?:[0-9a-f]{7}|unbekannt)\)$/;
/** Pur (factory#152): ist `zeile` genau eine Stand-Zeile, wie `factoryStand` sie erzeugt (`factory: <tag> (<7 hex|unbekannt>)` oder `factory: unbekannt (Sync-Stand unlesbar)`)? */
export const istStandZeile = (zeile) => STAND_ZEILE.test(zeile) || zeile === "factory: unbekannt (Sync-Stand unlesbar)";

/** Pur: der Kommentartext aus den Zeilen und der Stand-Zeile (`null` = ohne Fußzeile). */
export const meldungsText = (zeilen, stand) => (stand === null ? zeilen.join("\n") : `${zeilen.join("\n")}\n\n${stand}`);

/** Pur: Token gegen die Meldestelle `stelle`. Das eigene Repo (`eigenes`) braucht keins (`undefined` = Standard-`GH_TOKEN`); ein fremdes `MELDESTELLE_TOKEN`, sonst `PROJECT_TOKEN`. */
export function meldestelleToken({ stelle, eigenes, env }) {
  if (gleichesRepo(stelle, eigenes)) return undefined;
  return env.MELDESTELLE_TOKEN || tokenFuerZiel({ ziel: stelle, eigenes, env });
}

/** Pur: der Zugang zur Meldestelle `stelle` aus Sicht des Repos `eigenes`: `{ stelle, fremd, herkunft, token }`. `herkunft` (das eigene Repo) ist nur bei einer fremden Stelle gesetzt, sonst `null`. */
export function meldestelleZugang({ stelle, eigenes, env }) {
  const fremd = !gleichesRepo(stelle, eigenes);
  return { stelle, fremd, herkunft: fremd ? eigenes : null, token: meldestelleToken({ stelle, eigenes, env }) };
}

/** Pur: nackte Ticketnummern `#n` im Text mit Repo-Herkunft (`owner/name#n`); ohne `herkunft` (`null`) unverändert. Nummern mit Herkunft (`factory#12`, `a/b#3`) und `##n` bleiben. */
export const nummernMitHerkunft = (text, herkunft) => (herkunft ? String(text).replace(/(?<![\w#])#(\d+)\b/g, `${herkunft}#$1`) : text);

/** Der Login des eigenen Kontos an einer fremden Meldestelle (`api(["api", "user"], { token })`, die Naht ist `ghJson`); `null` ohne fremde Stelle oder bei Fehler (dann `warn` mit Grund). */
export function eigenerLogin({ zugang, api, warn }) {
  if (!zugang.fremd) return null;
  try {
    const login = api(["api", "user"], { token: zugang.token })?.login;
    if (typeof login === "string" && login !== "") return login;
    warn("HINWEIS Dedupe: gh api user liefert keinen Login, eigene Zeilen an der fremden Meldestelle werden nicht als bekannt erkannt");
  } catch (e) {
    warn(`HINWEIS Dedupe: eigenes Konto nicht lesbar (${fehlerText(e).split("\n")[0]}), eigene Zeilen an der fremden Meldestelle werden nicht als bekannt erkannt`);
  }
  return null;
}

/** Pur: steht in `kommentare` (`[{ user, body }]`) eine offene Zeile `- [ ]` mit `schluessel` von einem vertrauten Autor (`istVertraut` gegen `owner`) oder vom eigenen Konto `eigen` (Login, `null` ohne)? */
export function zeileBekannt({ kommentare, owner, eigen = null, schluessel }) {
  const eigenKlein = typeof eigen === "string" && eigen !== "" ? eigen.toLowerCase() : null;
  const vertraut = (user) => istVertraut(user, owner) || (eigenKlein !== null && typeof user?.login === "string" && user.login.toLowerCase() === eigenKlein);
  return kommentare.some((k) => vertraut(k?.user) && String(k?.body).split(/\r?\n/).some((z) => /^\s*[-*]\s+\[ \]/.test(z) && z.includes(schluessel)));
}

const FIX_SAMMELTICKET = "Fix: node scripts/sammelticket-anlegen.mjs harness";

/**
 * Pur: der gemeinsame Text „kein ungeclaimtes Harness-Sammelticket `fuer`“ samt Fix. Agentenvariante (`melden.mjs`, `spezifikation.mjs`): der Bezieher nennt die Zeile unter BEFUNDE im Bericht;
 * CI-Variante (`ci`, Wochenlauf, kein Bericht): der Bezieher lässt an der Meldestelle ein Sammelticket anlegen, der nächste Wochenlauf meldet die Zeilen erneut. `trenner` trennt Befund und Fix (Zeilenumbruch, in einer Logzeile ein Leerzeichen).
 */
export const keinSammelticketText = ({ fuer, ci = false, trenner = "\n" }) =>
  `kein ungeclaimtes Harness-Sammelticket ${fuer}${trenner}${FIX_SAMMELTICKET}; ${
    ci ? "im Bezieher an der Meldestelle ein Harness-Sammelticket anlegen lassen, der nächste Wochenlauf meldet die Zeilen erneut" : "im Bezieher die Zeile unter BEFUNDE im Bericht nennen"
  }`;

/** `check-internalrefs --text` als Kindprozess; nur Exit 0 ist sauber. `exec` ist die Test-Naht (Standard `spawnSync`). */
export function textSauber(text, exec = spawnSync) {
  const res = exec(process.execPath, [PRUEFER, "--text"], { input: text, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"], cwd: WURZEL });
  return res?.error === undefined && res?.signal == null && res?.status === 0;
}

/**
 * Die Meldung zu den Zeilen: `{ ok: true, text }` oder `{ ok: false, grund }`, wenn die Sperrprüfung anschlägt. `pruefe(text)` (Standard `textSauber`) sieht den
 * ganzen Text samt Stand-Zeile (nach `nummernMitHerkunft`, wenn `herkunft` gesetzt ist); `stand` ist die Stand-Zeile (`null`: keine; Standard: aus `.factory/sync-stand.json` unter `wurzel`, ist die Datei dann unlesbar, wird nichts gesendet).
 */
export function bereiteMeldung(zeilen, { wurzel = WURZEL, pruefe = textSauber, stand = undefined, herkunft = null } = {}) {
  let zeile = stand;
  if (zeile === undefined) {
    const gelesen = liesSyncStand(wurzel);
    if (gelesen.zustand === "kaputt") return { ok: false, grund: `Meldung nicht gesendet: ${STAND_PFAD} ist nicht lesbar (kein JSON-Objekt), die Meldung hätte keine Herkunftsangabe
Fix: die Datei reparieren (git checkout -- ${STAND_PFAD} oder factory-update erneut ausführen)` };
    zeile = factoryStand(gelesen);
  }
  const text = meldungsText(zeilen.map((z) => nummernMitHerkunft(z, herkunft)), zeile);
  if (!pruefe(text)) return { ok: false, grund: "Meldung nicht gesendet: check-internalrefs --text meldet einen Treffer\nFix: die Zeile neutral formulieren (die Sache benennen, keine internen Namen)" };
  return { ok: true, text };
}
