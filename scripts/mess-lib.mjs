// Gemeinsame Bausteine der Mess-Skripte (token-baseline, subagent-laufzeit, hauptchat-zerlegung, kontext-treiber,
// lauf-ergebnis): Median, Cache-Pausen-Schwellen, Ticketnummer und Ticketfilter stehen genau einmal hier, damit die
// Skripte nicht auseinanderlaufen.
import { repoSegment } from "./arbeitsplatz-lib.mjs";
import { escapeRegex } from "./ticket-namen.mjs";

/** Median einer Zahlenliste (gerade Anzahl: Mittel der beiden mittleren), nicht endliche Werte ignoriert, `null` bei leerer Liste. */
export function median(werte) {
  const s = werte.filter((w) => Number.isFinite(w)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Cache-TTL-Schwellen in Millisekunden: 5 Minuten (Standard-Cache) und 1 Stunde (erweiterter Cache). */
export const CACHE_TTL_MS = Object.freeze({ fuenfMin: 5 * 60_000, eineStunde: 60 * 60_000 });

const zahl = (x) => (Number.isFinite(x) ? x : 0);

/** Kontextgröße eines Calls: Input plus Cache-Write plus Cache-Read (fehlende Felder zählen 0). */
export function kontextVon(c) {
  return zahl(c.input) + zahl(c.cacheWrite) + zahl(c.cacheRead);
}

/**
 * Cache-Neuaufbau eines Calls (#1309, #1572): die Pause seit dem Vorgänger derselben Konversation liegt über der TTL
 * (`pauseMs`) UND der Cache-Read unter der Hälfte des Kontexts (der Prefix wurde neu geschrieben, nicht gelesen).
 * Ein Kontext von 0 zählt nie. Das Prädikat steht hier einmal; `countCacheRebuilds` und der Kontext-Treiber nutzen es.
 */
export function istNeuaufbau({ gapMs, pauseMs, call }) {
  const kontext = kontextVon(call);
  return gapMs > pauseMs && kontext > 0 && zahl(call.cacheRead) < kontext / 2;
}


/** Kern des Worktree-Pfads `/.claude/worktrees/<praefixe.worktree><nr>…` (Regex-Quelltext) zum Präfix aus der Projekt-Config: `bereinige` und `normPfad` nutzen dieselbe Regel. */
const worktreeKern = (worktree) => String.raw`/\.claude/worktrees/${repoSegment(escapeRegex(worktree), "/")}${escapeRegex(worktree)}\d+[\w-]*`;

/** Beide Schreibweisen einer Repo-Wurzel (`C:/x/y` und Git-Bash `/c/x/y`) als Regex-Alternativen. */
function wurzelVarianten(wurzel) {
  const roh = String(wurzel).replace(/\\/g, "/").replace(/\/+$/, "");
  if (!roh) return [];
  const laufwerk = /^([A-Za-z]):(\/.*)$/.exec(roh);
  const gitBash = /^\/([A-Za-z])(\/.*)$/.exec(roh);
  const varianten = [roh];
  if (laufwerk) varianten.push(`/${laufwerk[1].toLowerCase()}${laufwerk[2]}`);
  else if (gitBash) varianten.push(`${gitBash[1].toUpperCase()}:${gitBash[2]}`);
  return varianten;
}

/**
 * Pfad vergleichbar machen: Schrägstriche, klein, ohne Worktree-Pfad `…/worktrees/<praefixe.worktree><nr>…/` und ohne die Repo-Wurzel (beide
 * Schreibweisen aus `wurzelVarianten`, auch mit Backslash oder abschließendem Schrägstrich). Pfade außerhalb der Wurzel bleiben stehen.
 * `worktree` ist das Worktree-Präfix der Projekt-Config (`praefixe.worktree`); ohne Angabe entfällt nur die Worktree-Ersetzung (wie bei `wurzel`).
 */
export function normPfad(pfad, { wurzel = null, worktree = null } = {}) {
  const ohneBackslash = String(pfad).replace(/\\/g, "/");
  const p = (worktree ? ohneBackslash.replace(new RegExp(`^.*?${worktreeKern(worktree)}/`, "i"), "") : ohneBackslash).toLowerCase();
  const praefix = wurzelVarianten(wurzel ?? "").map((v) => `${v.toLowerCase()}/`).find((w) => p.startsWith(w));
  return praefix ? p.slice(praefix.length) : p;
}

/**
 * Pfade und Befehle ohne Benutzerordner, Worktree-Pfad und Repo-Wurzel (das Repo ist öffentlich). Die Wurzel kommt von
 * außen (`git rev-parse --git-common-dir`, ohne `.git`), nie fest verdrahtet; beide Schreibweisen (`C:/…`, `/c/…`), mit und
 * ohne abschließenden Schrägstrich. Das Worktree-Präfix (`worktree`) kommt aus der Projekt-Config. Ohne `wurzel` bleibt nur die
 * Wurzel-Ersetzung aus, ohne `worktree` nur die Worktree-Ersetzung.
 */
export function bereinige(text, { wurzel = null, worktree = null } = {}) {
  let t = String(text)
    .replace(/\\/g, "/")
    .replace(/[A-Za-z]:\/Users\/[^/\s"']+/g, "~")
    .replace(/\/[a-z]\/Users\/[^/\s"']+/gi, "~");
  if (worktree) t = t.replace(new RegExp(`\\S*${worktreeKern(worktree)}(?:/|(?=\\s|$))`, "g"), "<wt>/");
  const varianten = wurzel ? wurzelVarianten(wurzel) : [];
  if (varianten.length) t = t.replace(new RegExp(`(?:${varianten.map(escapeRegex).join("|")})(?:/|(?=[\\s"']|$))`, "gi"), "<repo>/");
  return t.replace(/\s+/g, " ");
}

/**
 * Länge der Vereinigung von [a, b]-Intervallen (#1579): überlappende zählen einmal, ungültige (nicht endlich, b < a) werden
 * ignoriert. Standard halboffen (Zeit in ms: Länge b-a, ein Abstand ist eine Lücke, Anstoßen nicht); `geschlossen: true` für
 * Zeilenbereiche (Länge b-a+1, direkt anschließende Bereiche ergeben dieselbe Summe).
 */
export function vereinigungsLaenge(intervalle, { geschlossen = false } = {}) {
  const plus = geschlossen ? 1 : 0;
  const s = intervalle.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).sort((x, y) => x[0] - y[0]);
  let summe = 0;
  let cur = null;
  for (const [a, b] of s) {
    if (!cur || a > cur[1]) {
      if (cur) summe += cur[1] - cur[0] + plus;
      cur = [a, b];
    } else if (b > cur[1]) cur[1] = b;
  }
  return summe + (cur ? cur[1] - cur[0] + plus : 0);
}

/** Ticketnummer eines CLI-Werts (#1609): Ganzzahl → `{ nr, fehler: null }`, sonst `fehler` (eine Nicht-Ganzzahl würde als NaN still nichts filtern). */
export function ticketNummer(name, wert) {
  const ok = /^[0-9]+$/.test(String(wert ?? ""));
  return { nr: Number(wert), fehler: ok ? null : `${name} erwartet eine Ticketnummer, nicht ${wert ?? "nichts"}` };
}

/** Optionen der wiederholbaren Ticketfilter `--ticket` und `--ohne` für `flagsLesen` (#1790). */
export const TICKET_OPTIONEN = { ticket: { type: "string", multiple: true }, ohne: { type: "string", multiple: true } };

/** Meldung für `flagsLesen`: fehlt der Wert von `--ticket`/`--ohne`, der Text von `ticketNummer`; sonst `undefined` (Standardtext). */
export function ticketMeldung(art, flag) {
  return art === "ohne-wert" && (flag === "--ticket" || flag === "--ohne") ? ticketNummer(flag, undefined).fehler : undefined;
}

/** Ticketlisten aus den `flagsLesen`-Werten: `{ tickets, ohne, fehler }`; der erste ungültige Wert setzt `fehler` (`null` sonst). */
export function ticketFilterAus(werte) {
  let fehler = null;
  const lies = (name) =>
    (werte[name] ?? []).map((w) => {
      const r = ticketNummer(`--${name}`, w);
      fehler ??= r.fehler;
      return r.nr;
    });
  const tickets = lies("ticket");
  const ohne = lies("ohne");
  return { tickets, ohne, fehler };
}

/** Ticketfilter (#1609): `tickets` = nur diese (leer = alle), `ohne` = alle außer diesen; ein Ticket ohne Nummer fällt bei `tickets` heraus. */
export function passtTicketFilter(ticket, { tickets = [], ohne = [] } = {}) {
  return (tickets.length === 0 || tickets.includes(ticket)) && !ohne.includes(ticket);
}

const CLAIM = /\bgh\s+issue\s+edit\s+(\d+)\b(?=[^\n]*--add-assignee)/;

/** Ticketnummer einer Claim-Zeile (`gh issue edit <nr> … --add-assignee`), sonst `null` (#1616; Quelle für Hauptchat-Zerlegung und Factory-Kennzahlen). */
export function claimNummer(command) {
  const nr = CLAIM.exec(String(command ?? ""))?.[1];
  return nr ? Number(nr) : null;
}

/** Ein echter Modellname: nicht leer und nicht der Client-Platzhalter `<synthetic>`. */
export const istEchtesModell = (m) => Boolean(m) && m !== "<synthetic>";

/** Zahl der verschiedenen Tickets und derer mit mehr als einem Lauf (#1646); Läufe ohne Ticket zählen in keiner der beiden Zahlen. */
export function ticketZaehlung(laeufe) {
  const je = new Map();
  for (const { ticket } of laeufe) if (ticket !== null && ticket !== undefined) je.set(ticket, (je.get(ticket) ?? 0) + 1);
  return { tickets: je.size, mehrlauf: [...je.values()].filter((n) => n > 1).length };
}

/** Warnzeile der Standardauswertungen (#1646): die Mediane gelten je Lauf, nicht je Ticket; leer ohne Ticket mit mehreren Läufen. */
export const mehrlaufHinweis = (mehrlauf) =>
  mehrlauf > 0 ? `Mediane je Lauf, nicht je Ticket (${mehrlauf} Tickets mit mehreren Läufen); Ticket-Schnitt: kontext-treiber --je-ticket` : "";
