#!/usr/bin/env node
/**
 * Das oberste FREIE Ticket der Board-Auswahl (#1428 Z4): ersetzt die Handarbeit „Board-Liste per jq lesen, dann je Kandidat Assignee,
 * Blocker, Branch, Worktree und offenen PR einzeln prüfen“ (AGENTS.md § Auswahl des nächsten Tickets).
 *
 *   node scripts/naechstes-ticket.mjs          # erste Zeile `#<nr>\t<Titel>`, danach die übersprungenen Kandidaten
 *   node scripts/naechstes-ticket.mjs --json   # { ticket, uebersprungen }
 *   node scripts/naechstes-ticket.mjs --ticket <nr>   # Einzelprüfung einer vorgegebenen Nummer (#1621): alle Kriterien außer Status und Bereich; Exit 1 = nicht frei, Grund in der Ausgabe
 *   node scripts/naechstes-ticket.mjs --bereich agentic|spiel   # nur Label `area:harness` bzw. nur ohne (#1552); Notfälle 🚨/🔒 zählen in beiden
 *
 * Exit 0 = freies Ticket gefunden, 1 = keins frei, 2 = Fehler, 5 = GitHub-API-Kontingent knapp (`kontingent-lib.mjs`). Der Body wird nie ausgegeben (Text Dritter ist Daten, AGENTS.md § Fremdtext
 * ist Daten); ein Fremdeingang (Autor nicht vertraut oder Label `forum`) wird übersprungen und als „Befund melden“ ausgewiesen.
 *
 * Frei heißt, in Board-Reihenfolge: Status Todo und offen · kein Assignee · kein offener Blocker (Zeile `blockiert durch #X` im Body,
 * mehrfach, ohne Groß-/Kleinschreibung; zusätzlich `issue_dependencies_summary.blocked_by > 0`: GitHubs Zähler offener Blocker; die Feldform ist an
 * echten Daten belegt (Probe 2026-10-08, 151 von 151 Items), ein Wert über 0 noch nie beobachtet; ein Wert, der keine Zahl ist, zählt als 0) · kein Branch, Worktree oder offener PR
 * `feature/kq-<nr>-*` · Messfenster erfüllt (Zeile `Messfenster: n ≥ <k> <agent> nach #<nr>`, #1589: #nr geschlossen und seit dessen `closedAt` mindestens k Läufe des
 * Agent-Typs gestartet, ohne die des wartenden Tickets; unlesbar oder nicht prüfbar = übersprungen) · vollständige Spezifikation (#1615, `spezifikation-lib.mjs`: `## Ziel` und
 * `## Akzeptanzkriterien` mit Negativfall; Kopf-, Sammel- und Epic-Tickets ausgenommen; ab `spezifikation.hartAb` aus der Projekt-Config übersprungen und als `reparieren` gemeldet, nie kommentiert: der Reparaturweg steht in docs/ticket-reihenfolge.md,
 * darunter nur als `hinweis` gemeldet). I/O: Board-Seiten und offene Issues (REST), `git fetch/for-each-ref/worktree list`,
 * ein REST-Aufruf für offene PRs, je Messfenster-Kandidat ein REST-Aufruf (`closed_at`) und die lokalen Transkripte (`~/.claude/projects`); kein GraphQL. `--ticket`: statt der Board-Seiten ein REST-Abruf des Issues.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NOTFAELLE, boardFuerRolle, REPO, SAMMELTICKET_TITEL_LISTE, istKopfItem, loadItemPages, loadOpenIssuePages, normalizeItems, normalizeOffene } from "./board-lib.mjs";

// Verhalten unverändert: diese Werkzeuge arbeiten auf dem Produkt-Board (die Rolle steht in der Projekt-Config).
const PRODUKT_BOARD = boardFuerRolle("produkt");
import { istFremdeingang } from "./fremdtext-lib.mjs";
import { ghJson } from "./gh-cli.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { istEpicTitel, pruefeEingang } from "./spezifikation-lib.mjs";
import { ladeLaeufe, laufAus } from "./subagent-laeufe.mjs";
import { projektOrdner } from "./transkript.mjs";
import { belegteNummern } from "./ticket-refs.mjs";

/** `Nummern` hinter `blockiert durch` (Zeilenweise, bis zu einer öffnenden Klammer oder dem Zeilenende), z.B. „blockiert durch #12, #13 (nur solange …)“. Pur. */
export function blockerNummern(body) {
  const nummern = new Set();
  for (const zeile of String(body ?? "").split(/\r?\n/)) {
    for (const m of zeile.matchAll(/blockiert\s+durch\b([^(\n]*)/gi)) {
      for (const n of m[1].matchAll(/#(\d+)/g)) nummern.add(Number(n[1]));
    }
  }
  return [...nummern];
}

/**
 * Zeilen `Messfenster: n ≥ <k> <agent> nach #<nr>` (#1589; am Zeilenanfang, Listenpunkt erlaubt, `≥` oder `>=`, k ≥ 1; eine bloße Erwähnung im
 * Fließtext zählt nicht). Je Zeile `{ k, agent, nach }` oder `{ fehler }` (unlesbar, ohne den Body-Text zu zitieren). Pur.
 */
export function messfensterZeilen(body) {
  const fenster = [];
  for (const zeile of String(body ?? "").split(/\r?\n/)) {
    const kopf = /^\s*(?:[-*]\s+)?Messfenster:(.*)$/i.exec(zeile);
    if (!kopf) continue;
    const m = /^\s*n\s*(?:≥|>=)\s*(\d+)\s+(\S+)\s+nach\s+#(\d+)\s*\.?\s*$/i.exec(kopf[1]);
    if (m && Number(m[1]) >= 1) fenster.push({ k: Number(m[1]), agent: m[2], nach: Number(m[3]) });
    else fenster.push({ fehler: "Messfenster-Zeile unlesbar (erwartet „Messfenster: n ≥ <k> <agent> nach #<nr>“)" });
  }
  return fenster;
}

/** Anzahl der verschiedenen Tickets (#1646) mit einem Lauf (`{ start (ms), ticket }`) ab `closedAt`, ohne das wartende Ticket. Läufe ohne Ticket zählen nicht: eine Untergrenze, die sichere Richtung. Pur. */
export function ticketsImFenster(laeufe, { closedAt, ohneTicket }) {
  const ab = Date.parse(closedAt);
  const tickets = laeufe.filter((l) => l.start >= ab && l.ticket !== null && l.ticket !== undefined && l.ticket !== ohneTicket).map((l) => l.ticket);
  return new Set(tickets).size;
}

/** Überspringgrund eines Messfensters (`""` = erfüllt); `stand`: `{ closedAt, n }` (closedAt `null` = #nach offen) oder `{ fehler }`. Pur. */
export function messfensterGrund(fenster, stand) {
  if ("fehler" in stand) return stand.fehler;
  if (stand.closedAt === null) return `offener Blocker #${fenster.nach} (Messfenster)`;
  if (stand.n < fenster.k) return `Messfenster offen (${stand.n}/${fenster.k} Tickets mit ${fenster.agent} nach #${fenster.nach})`;
  return "";
}

/** Nutzersichtbare Bereichsnamen (#1552); das Label für „agentic“ bleibt `area:harness`. */
export const BEREICHE = { agentic: "Agentic Engineering", spiel: "Spielentwicklung" };

/** `--bereich <wert>` bzw. `--bereich=<wert>` aus argv: `{ bereich }` (null ohne Schalter) oder `{ fehler }`. Pur. */
export function bereichAusArgv(argv) {
  const i = argv.findIndex((a) => a === "--bereich" || a.startsWith("--bereich="));
  if (i < 0) return { bereich: null };
  const wert = argv[i].includes("=") ? argv[i].slice("--bereich=".length) : argv[i + 1];
  if (Object.hasOwn(BEREICHE, wert ?? "")) return { bereich: wert };
  return { fehler: `--bereich erwartet agentic oder spiel (bekommen: ${wert === undefined ? "nichts" : `„${wert}“`})` };
}

/** `--ticket <nr>`, `--ticket=<nr>` bzw. `--ticket #<nr>` aus argv: `{ ticket }` (null ohne Schalter) oder `{ fehler }`. Pur. */
export function ticketAusArgv(argv) {
  const i = argv.findIndex((a) => a === "--ticket" || a.startsWith("--ticket="));
  if (i < 0) return { ticket: null };
  const wert = argv[i].includes("=") ? argv[i].slice("--ticket=".length) : argv[i + 1];
  const m = /^#?(\d+)$/.exec(wert ?? "");
  if (m && Number(m[1]) > 0) return { ticket: Number(m[1]) };
  return { fehler: `--ticket erwartet eine Ticketnummer (bekommen: ${wert === undefined ? "nichts" : `„${wert}“`})` };
}

/** Normalisiertes Item aus der REST-Antwort `repos/<repo>/issues/<nr>` (gleiche Felder wie ein Board-Item, ohne Status). Wirft bei einem PR oder unerwarteter Form. Pur. */
export function itemAusIssue(issue) {
  if (!issue || typeof issue !== "object" || issue.pull_request) throw new Error("Unerwartete Antwort: kein Issue");
  const items = normalizeItems([[{ content_type: "Issue", node_id: String(issue.node_id ?? ""), content: issue, fields: [] }]]);
  if (items.length !== 1) throw new Error("Unerwartete Antwortform des Issues");
  return items[0];
}

/**
 * Einzelprüfung einer vorgegebenen Nummer: dieselben Kriterien wie die Board-Auswahl (`ueberspringGrund`, auch Messfenster), aber ohne Status- und
 * Bereichsfilter; ein geschlossenes Issue ist nicht frei. `item` aus `itemAusIssue`. Liefert wie `waehleNaechstes` `{ ticket, uebersprungen }`. Pur.
 */
export function pruefeTicket({ item, offene, refs = [], worktrees = [], prHeads = [], owner = "", messfenster = MESSFENSTER_OHNE_LADER, hartAb = 0 }) {
  const nr = item.number;
  if (item.state !== "open") return { ticket: null, uebersprungen: [{ nr, grund: "geschlossen" }] };
  const r = ueberspringGrund(item, { offene, belegt: belegteNummern({ refs, worktrees, prHeads }), owner, messfenster, hartAb });
  return r.grund ? { ticket: null, uebersprungen: [uebersprungenEintrag(nr, r)] } : { ticket: ticketVon(item, r), uebersprungen: [] };
}

/** Gehört das Item zum Bereich? Ohne Bereich immer; 🚨 CI rot auf main und 🔒 Security zählen in beiden (Roter main geht vor). Pur. */
export function imBereich(item, bereich) {
  if (!bereich) return true;
  const notfall = NOTFAELLE.filter((n) => n.art === "rot-main" || n.art === "security");
  if (notfall.some((n) => String(item.title ?? "").startsWith(n.marker))) return true;
  return item.labels.includes("area:harness") === (bereich === "agentic");
}

/**
 * Wählt das oberste freie Ticket. `items`: normalisierte Board-Items (`normalizeItems` aus board-lib, Board-Reihenfolge), `offene`: Menge offener Issue-Nummern,
 * `refs`/`worktrees`/`prHeads`: Texte (Branch-Namen, Worktree-Pfade bzw. -Branches, PR-Branches), `owner` für die Vertrauensprüfung.
 * Liefert `{ ticket: { nr, titel } | null, uebersprungen: [{ nr, grund }] }`. Pur.
 */
export function waehleNaechstes({ items, offene, refs = [], worktrees = [], prHeads = [], owner = "", bereich = null, messfenster = MESSFENSTER_OHNE_LADER, hartAb = 0 }) {
  const belegt = belegteNummern({ refs, worktrees, prHeads });
  const uebersprungen = [];
  for (const item of items) {
    if (item.status !== "Todo" || item.state !== "open" || !imBereich(item, bereich)) continue;
    const r = ueberspringGrund(item, { offene, belegt, owner, messfenster, hartAb });
    if (r.grund) uebersprungen.push(uebersprungenEintrag(item.number, r));
    else return { ticket: ticketVon(item, r), uebersprungen };
  }
  return { ticket: null, uebersprungen };
}

const uebersprungenEintrag = (nr, r) => ({ nr, grund: r.grund, ...(r.fehlt ? { fehlt: r.fehlt } : {}) });
const ticketVon = (item, r) => ({ nr: item.number, titel: item.title, ...(r.bestandFehlt ? { spezifikation: { bestand: true, fehlt: r.bestandFehlt } } : {}) });

/** Kopf-Items (Status-Ticket, Notfälle), Sammel- und Epic-Tickets haben eigene Formate und sind vom Spezifikations-Gate ausgenommen. */
const spezAusgenommen = (t) => istKopfItem({ title: t.titel }) || SAMMELTICKET_TITEL_LISTE.includes(t.titel) || istEpicTitel(t.titel);

const MESSFENSTER_OHNE_LADER = () => ({ fehler: "Messfenster nicht prüfbar (kein Lader)" });

/** `{ grund }` (`""` = frei); dazu `fehlt` bei hartem Spezifikations-Mangel, `bestandFehlt` bei freiem Bestandsticket mit Mangel. */
function ueberspringGrund(c, { offene, belegt, owner, messfenster, hartAb }) {
  if (c.assignees.length > 0) return { grund: `Assignee ${c.assignees.map((a) => `@${a}`).join(", ")}` };
  if (istFremdeingang({ user: c.autor, labels: c.labels }, owner).fremdeingang) return { grund: "Fremdeingang (Autor nicht vertraut oder Forum-Label): Befund melden" };
  const offeneBlocker = blockerNummern(c.body).filter((n) => offene.has(n) && n !== c.number);
  if (offeneBlocker.length > 0) return { grund: `offener Blocker ${offeneBlocker.map((n) => `#${n}`).join(", ")}` };
  const fenster = messfensterZeilen(c.body);
  const unlesbar = fenster.find((f) => "fehler" in f);
  if (unlesbar) return { grund: unlesbar.fehler };
  const offenesFenster = fenster.find((f) => offene.has(f.nach));
  if (offenesFenster) return { grund: messfensterGrund(offenesFenster, { closedAt: null, n: 0 }) };
  if (c.blockedBy > 0) return { grund: "offener Blocker laut GitHub-Abhängigkeit" };
  if (belegt.has(c.number)) return { grund: "Branch, Worktree oder offener PR vorhanden" };
  const spez = pruefeEingang({ nummer: c.number, titel: c.title, body: c.body }, { ausgenommen: spezAusgenommen, hartAb });
  if (spez.art === "hart") return { grund: `Spezifikation unvollständig: ${spez.fehlt.join("; ")}`, fehlt: spez.fehlt };
  for (const f of fenster) {
    const grund = messfensterGrund(f, messfenster(f, c.number)); // teuer (REST + Transkripte): erst für sonst freie Kandidaten
    if (grund) return { grund };
  }
  return spez.art === "bestand" ? { grund: "", bestandFehlt: spez.fehlt } : { grund: "" };
}

/** Reparaturaufträge (#1698): hart übersprungene Tickets mit Spezifikations-Mangel (`fehlt`), nur vertraute und freie (`ueberspringGrund` setzt `fehlt` erst nach Assignee-, Fremdeingangs-, Blocker- und Belegungsprüfung). Pur. */
export const reparierenVon = (uebersprungen) => uebersprungen.filter((u) => u.fehlt).map((u) => ({ nr: u.nr, fehlt: u.fehlt }));

const reparierenZeilen = (uebersprungen) => reparierenVon(uebersprungen).map((r) => `reparieren #${r.nr}: ${r.fehlt.join("; ")}`);

/** Textausgabe: erste Zeile das Ticket (oder „kein freies Ticket“), danach Hinweis, `reparieren`-Zeilen und je übersprungenem Kandidaten eine Zeile. Pur. */
export function formatiere({ ticket, uebersprungen, bereich = null, einzel = null }) {
  if (einzel !== null && !ticket) return [`#${einzel} nicht frei: ${uebersprungen[0]?.grund ?? "unbekannt"}`, ...reparierenZeilen(uebersprungen)].join("\n") + "\n";
  const keins = bereich ? `kein freies Ticket im Bereich ${BEREICHE[bereich]}` : "kein freies Ticket";
  const kopf = ticket ? `#${ticket.nr}\t${ticket.titel}` : keins;
  const hinweis = ticket?.spezifikation ? [`hinweis #${ticket.nr}: Spezifikation unvollständig (Bestand, nur berichtet): ${ticket.spezifikation.fehlt.join("; ")}`] : [];
  return [kopf, ...hinweis, ...reparierenZeilen(uebersprungen), ...uebersprungen.map((u) => `übersprungen #${u.nr}: ${u.grund}`)].join("\n") + "\n";
}

/** Ausführung mit injizierbarer I/O: `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const b = bereichAusArgv(argv);
  if ("fehler" in b) return fehlerErgebnis(b.fehler);
  const t = ticketAusArgv(argv);
  if ("fehler" in t) return fehlerErgebnis(t.fehler);
  if (t.ticket !== null && b.bereich) return fehlerErgebnis("--ticket und --bereich schließen sich aus");
  try {
    const einzel = t.ticket;
    const roh =
      einzel === null
        ? { ...waehleNaechstes({ ...io.lade(), owner: io.owner, bereich: b.bereich, hartAb: io.hartAb }), ...(b.bereich ? { bereich: b.bereich } : {}) }
        : pruefeTicket({ ...io.ladeEinzeln(einzel), owner: io.owner, hartAb: io.hartAb });
    const reparieren = reparierenVon(roh.uebersprungen);
    const ergebnis = reparieren.length > 0 ? { ...roh, reparieren } : roh;
    const out = argv.includes("--json") ? `${JSON.stringify(ergebnis, null, 2)}\n` : formatiere({ ...ergebnis, einzel });
    return { code: ergebnis.ticket ? 0 : 1, out, err: "" };
  } catch (e) {
    return fehlerErgebnis(e instanceof Error ? e.message : String(e));
  }
}

const fehlerErgebnis = (text) => ({ code: 2, out: "", err: `✖ naechstes-ticket: ${text}\n` });

/** Branchnamen der offenen PRs aus den REST-Seiten (`gh api --paginate --slurp`); GraphQL-frei und ohne 200er-Deckel. Pur. */
export const prHeadsAus = (seiten) => seiten.flat().map((p) => `${p.head.ref}`);

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

/**
 * Lader für `waehleNaechstes({ messfenster })` (#1589), I/O: `closedAt` von #nach per REST (`holeIssue`) und die gestarteten Läufe des Agent-Typs
 * aus den lokalen Transkripten (`dir`, Default der Projektordner wie `subagent-laufzeit.mjs`). Memo je `agent|nach`. Fail-closed:
 * `{ fehler }` ohne Transkript-Ordner, bei Abruf- oder Lesefehlern (Texte ohne lokalen Pfad).
 */
export function messfensterLader({ dir, holeIssue = (nr) => ghJson(["api", `repos/${REPO}/issues/${nr}`]) } = {}) {
  const memo = new Map(); // je `agent|nach`: closedAt und geladene Läufe; nur die Zählung hängt am wartenden Ticket
  return (fenster, wartend) => {
    const schluessel = `${fenster.agent}|${fenster.nach}`;
    if (!memo.has(schluessel)) memo.set(schluessel, messfensterLaeufe(fenster, dir ?? projektOrdner(), holeIssue));
    const r = memo.get(schluessel);
    if ("fehler" in r) return r;
    if (r.closedAt === null) return { closedAt: null, n: 0 };
    return { closedAt: r.closedAt, n: ticketsImFenster(r.laeufe, { closedAt: r.closedAt, ohneTicket: wartend }) };
  };
}

function messfensterLaeufe(fenster, dir, holeIssue) {
  let closedAt;
  try {
    const issue = holeIssue(fenster.nach);
    closedAt = issue.state === "closed" ? issue.closed_at : null;
  } catch {
    return { fehler: `Messfenster nicht prüfbar (#${fenster.nach} nicht abrufbar)` };
  }
  if (closedAt === null) return { closedAt: null, laeufe: [] };
  if (!existsSync(dir)) return { fehler: "Messfenster nicht prüfbar (keine lokalen Transkripte)" };
  try {
    return { closedAt, laeufe: ladeLaeufe(dir, fenster.agent, closedAt).map(laufAus).filter(Boolean) };
  } catch {
    return { fehler: "Messfenster nicht prüfbar (Transkripte nicht lesbar)" };
  }
}

/** Gemeinsame Belegungs-I/O beider Wege: offene Issues, Branch-Refs, Worktrees, offene PRs, Messfenster-Lader. */
function ladeBelegung() {
  const offene = new Set(normalizeOffene(loadOpenIssuePages()).map((i) => i.number));
  try {
    git(["fetch", "--prune", "origin"]); // fail-open: ohne Netz zählen die lokalen Remote-Refs
  } catch {
    /* lokale Refs genügen */
  }
  const refs = git(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).split(/\r?\n/).filter(Boolean);
  const worktrees = git(["worktree", "list", "--porcelain"]).split(/\r?\n/).filter((z) => /^(worktree|branch) /.test(z));
  const prHeads = prHeadsAus(ghJson(["api", "--paginate", "--slurp", `repos/${REPO}/pulls?state=open&per_page=100`]));
  return { offene, refs, worktrees, prHeads, messfenster: messfensterLader() };
}

const ladeEcht = () => ({ items: normalizeItems(loadItemPages(PRODUKT_BOARD)), ...ladeBelegung() });

/** Einzelweg (`--ticket`): das eine Issue per REST, keine Board-Seiten. */
const ladeEinzelnEcht = (nr) => ({ item: itemAusIssue(ghJson(["api", `repos/${REPO}/issues/${nr}`])), ...ladeBelegung() });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mitKontingent("naechstes-ticket", { arten: ["core"] }); // nur REST, ein knappes GraphQL-Kontingent sperrt den Einstieg nicht
  const io = { lade: ladeEcht, ladeEinzeln: ladeEinzelnEcht, owner: REPO.split("/")[0], hartAb: ladeProjektConfig().spezifikation?.hartAb };
  const { code, out, err } = fuehreAus(process.argv.slice(2), io);
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
