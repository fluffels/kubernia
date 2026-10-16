// Gemeinsame Bausteine der Mess-Skripte (token-baseline, subagent-laufzeit, hauptchat-zerlegung, kontext-treiber,
// lauf-ergebnis): Median, Cache-Pausen-Schwellen, Ticketnummer und Ticketfilter stehen genau einmal hier, damit die
// Skripte nicht auseinanderlaufen.

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

const regexEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
 * Pfade und Befehle ohne Benutzerordner, Worktree-Präfix und Repo-Wurzel (das Repo ist öffentlich). Die Wurzel kommt von
 * außen (`git rev-parse --git-common-dir`, ohne `.git`), nie fest verdrahtet; beide Schreibweisen (`C:/…`, `/c/…`), mit und
 * ohne abschließenden Schrägstrich. Ohne `wurzel` bleibt nur die Wurzel-Ersetzung aus.
 */
export function bereinige(text, { wurzel = null } = {}) {
  let t = String(text)
    .replace(/\\/g, "/")
    .replace(/[A-Za-z]:\/Users\/[^/\s"']+/g, "~")
    .replace(/\/[a-z]\/Users\/[^/\s"']+/gi, "~")
    .replace(/\S*\/\.claude\/worktrees\/kq-\d+[\w-]*(?:\/|(?=\s|$))/g, "<wt>/");
  const varianten = wurzel ? wurzelVarianten(wurzel) : [];
  if (varianten.length) t = t.replace(new RegExp(`(?:${varianten.map(regexEscape).join("|")})(?:/|(?=[\\s"']|$))`, "gi"), "<repo>/");
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
