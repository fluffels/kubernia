#!/usr/bin/env node
/**
 * Das oberste FREIE Ticket der Board-Auswahl (#1428 Z4): ersetzt die Handarbeit „Board-Liste per jq lesen, dann je Kandidat Assignee,
 * Blocker, Branch, Worktree und offenen PR einzeln prüfen“ (AGENTS.md § Auswahl des nächsten Tickets).
 *
 *   node scripts/naechstes-ticket.mjs --bereich agentic|spiel          # erste Zeile `#<nr>\t<Titel>`, danach die übersprungenen Kandidaten; nur das Factory- bzw. nur das Produkt-Board (#1552, #1729); Notfälle 🚨/🔒 zählen in beiden
 *   node scripts/naechstes-ticket.mjs --bereich agentic|spiel --json   # { bereich, ticket, uebersprungen, hinweise? }
 *   node scripts/naechstes-ticket.mjs --ticket <nr>   # Einzelprüfung einer vorgegebenen Nummer (#1621): alle Kriterien außer Status und Bereich; Exit 1 = nicht frei, Grund in der Ausgabe
 *
 * Ohne `--bereich` und ohne `--ticket` ist der Aufruf ein Fehler (Exit 2): es gibt keinen Auswahlmodus über beide Seiten. Zwei Boards (ADR 0022 F11, #1729):
 * zuerst die Kopf-Items (Rang nach `kopfRang`; mit Bereich die der eigenen Seite plus die Notfälle beider), dann das oberste freie Item der eigenen Seite,
 * ohne Ausweichen auf die andere. Die Spielquote bleibt eine Kennzahl (`spielquote-lib.mjs`), sie steuert die Auswahl nicht.
 *
 * Exit 0 = freies Ticket gefunden, 1 = keins frei, 2 = Fehler, 5 = GitHub-API-Kontingent knapp (`kontingent-lib.mjs`). Der Body wird nie ausgegeben (Text Dritter ist Daten, AGENTS.md § Fremdtext
 * ist Daten); ein Fremdeingang (Autor nicht vertraut oder Forum-Label der Config) wird übersprungen und als „Befund melden“ ausgewiesen.
 *
 * Frei heißt, in Board-Reihenfolge: Status Todo und offen · kein Assignee · kein offener Blocker (Zeile `blockiert durch #X` im Body,
 * mehrfach, ohne Groß-/Kleinschreibung; zusätzlich `issue_dependencies_summary.blocked_by > 0`: GitHubs Zähler offener Blocker; die Feldform ist an
 * echten Daten belegt (Probe 2026-10-08, 151 von 151 Items), ein Wert über 0 noch nie beobachtet; ein Wert, der keine Zahl ist, zählt als 0) · kein Branch, Worktree oder offener PR
 * `<praefixe.branch><nr>-*` · Messfenster erfüllt (Zeile `Messfenster: n ≥ <k> <agent> nach #<nr>`, #1589: #nr geschlossen und seit dessen `closedAt` mindestens k Läufe des
 * Agent-Typs gestartet, ohne die des wartenden Tickets; unlesbar oder nicht prüfbar = übersprungen) · vollständige Spezifikation (#1615, `spezifikation-lib.mjs`: Ziel- und
 * Kriterien-Abschnitt mit Negativfall, Namen aus `sprache.spezifikation` der Config; Kopf-, Sammel- und Epic-Tickets ausgenommen; ab `spezifikation.hartAb` aus der Projekt-Config übersprungen und als `reparieren` gemeldet, nie kommentiert: der Reparaturweg steht in docs/ticket-reihenfolge.md,
 * darunter nur als `hinweis` gemeldet). I/O: Board-Seiten und offene Issues (REST), `git fetch/for-each-ref/worktree list`,
 * ein REST-Aufruf für offene PRs, je Messfenster-Kandidat ein REST-Aufruf (`closed_at`) und die lokalen Transkripte (`~/.claude/projects`); kein GraphQL. `--ticket`: statt der Board-Seiten ein REST-Abruf des Issues.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NOTFAELLE, OWNER, boardFuerRolle, REPO, SAMMELTICKET_TITEL_LISTE, istKopfItem, kopfRang, loadItemPages, loadOpenIssuePages, normalizeItems, normalizeOffene, seitenListen } from "./board-lib.mjs";
import { istFremdeingang } from "./fremdtext-lib.mjs";
import { direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { ghJson } from "./gh-cli.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import { labelAus, ladeProjektConfig, spracheAus } from "./projekt-config-lib.mjs";
import { blockerNummern, istEpicTitel, pruefeEingang } from "./spezifikation-lib.mjs";
import { ladeLaeufe, laufAus } from "./subagent-laeufe.mjs";
import { projektOrdner } from "./transkript.mjs";
import { ladeTicketNamen, ticketNamen } from "./ticket-namen.mjs";
import { belegteNummern } from "./ticket-refs.mjs";
import { parseWorktreeBloecke } from "./worktree-aufraeumen.mjs";

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

/** Nutzersichtbare Bereichsnamen (#1552); das Label für „agentic“ ist `labels.harness` der Projekt-Config. */
export const BEREICHE = { agentic: "Agentic Engineering", spiel: "Spielentwicklung" };

/** Skript-eigene Texte für einen fehlenden Wert (die übrigen Arten nehmen die Standardtexte von `flagsLesen`). */
const OHNE_WERT = {
  "--bereich": "--bereich erwartet agentic oder spiel (bekommen: nichts)",
  "--ticket": "--ticket erwartet eine Ticketnummer (bekommen: nichts)",
};

/**
 * Liest den Aufruf über `flagsLesen` (`--bereich <wert>`, `--ticket <nr>` auch als `--x=<wert>` und `#<nr>`, `--json`) und prüft die Werte:
 * `{ bereich, ticket, json }` (`bereich` und `ticket` null ohne Schalter) oder `{ fehler }`. Pur, ohne I/O.
 * Schließt `--ticket` und `--bereich` gegenseitig aus und verlangt genau eines davon.
 */
export function aufrufLesen(argv) {
  const r = flagsLesen(argv, { bereich: { type: "string" }, ticket: { type: "string" }, json: { type: "boolean" } }, {
    meldung: (art, flag) => (art === "ohne-wert" ? OHNE_WERT[flag] : undefined),
  });
  if (r.fehler) return { fehler: r.fehler.text };
  const { bereich: roh, ticket: nr, json } = r.werte;
  if (roh !== undefined && !Object.hasOwn(BEREICHE, roh)) return { fehler: `--bereich erwartet agentic oder spiel (bekommen: „${roh}“)` };
  let ticket = null;
  if (nr !== undefined) {
    const m = /^#?(\d+)$/.exec(nr);
    if (!m || Number(m[1]) <= 0) return { fehler: `--ticket erwartet eine Ticketnummer (bekommen: „${nr}“)` };
    ticket = Number(m[1]);
  }
  const bereich = roh ?? null;
  if (ticket !== null && bereich) return { fehler: "--ticket und --bereich schließen sich aus" };
  if (ticket === null && !bereich) return { fehler: "Aufruf ohne Auswahl: --bereich agentic|spiel (oberstes freies Ticket des Bereichs) oder --ticket <nr> (Einzelprüfung)" };
  return { bereich, ticket, json: json === true };
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
export function pruefeTicket({ item, offene, refs = [], worktrees = [], prHeads = [], owner = "", messfenster = MESSFENSTER_OHNE_LADER, hartAb = 0, namen, config }) {
  const nr = item.number;
  if (item.state !== "open") return { ticket: null, uebersprungen: [{ nr, grund: "geschlossen" }] };
  const r = ueberspringGrund(item, { offene, belegt: belegteNummern({ refs, worktrees, prHeads }, namen), owner, messfenster, hartAb, config });
  return r.grund ? { ticket: null, uebersprungen: [uebersprungenEintrag(nr, r)] } : { ticket: ticketVon(item, r), uebersprungen: [] };
}

/** 🚨 CI rot auf main und 🔒 Security gelten auf beiden Boards (Roter main geht vor). Pur. */
export function istNotfallBeider(item) {
  return NOTFAELLE.filter((n) => n.art === "rot-main" || n.art === "security").some((n) => String(item.title ?? "").startsWith(n.marker));
}

/** Gehört das Item zum Bereich? Ohne Bereich immer; Notfälle (`istNotfallBeider`) zählen in beiden. Das Harness-Label kommt aus `config` (Pflicht, wirft ohne `labels.harness`). Pur. */
export function imBereich(item, bereich, config) {
  if (!bereich) return true;
  return istNotfallBeider(item) || item.labels.includes(labelAus(config, "harness")) === (bereich === "agentic");
}

/**
 * Wählt das oberste freie Ticket. `items`: normalisierte Board-Items (`normalizeItems` aus board-lib, Board-Reihenfolge), `offene`: Menge offener Issue-Nummern,
 * `refs`/`worktrees`/`prHeads`: Texte (Branch-Namen, Worktree-Pfade bzw. -Branches, PR-Branches), `owner` für die Vertrauensprüfung.
 * `nur`: zusätzlicher Filter (Kopf- bzw. Nicht-Kopf-Walk der Zwei-Boards-Auswahl). Liefert `{ ticket: { nr, titel } | null, uebersprungen: [{ nr, grund }] }`. Pur.
 */
export function waehleNaechstes({ items, offene, refs = [], worktrees = [], prHeads = [], owner = "", bereich = null, messfenster = MESSFENSTER_OHNE_LADER, hartAb = 0, nur = () => true, namen, config }) {
  labelAus(config, "harness"); // fail-fast, auch ohne Bereich: ohne Config gibt es keine Auswahl
  const belegt = belegteNummern({ refs, worktrees, prHeads }, namen);
  const uebersprungen = [];
  for (const item of items) {
    if (item.status !== "Todo" || item.state !== "open" || !imBereich(item, bereich, config) || !nur(item)) continue;
    const r = ueberspringGrund(item, { offene, belegt, owner, messfenster, hartAb, config });
    if (r.grund) uebersprungen.push(uebersprungenEintrag(item.number, r));
    else return { ticket: ticketVon(item, r), uebersprungen };
  }
  return { ticket: null, uebersprungen };
}

/** Hinweise zu den Board-Listen: Nummern auf beiden Boards und Items nur auf dem falschen Board (Sammelhinweis mit bis zu 10 Nummern). Pur. */
function listenHinweise({ doppelt, falsch }) {
  const h = doppelt.map((n) => `#${n} steht auf beiden Boards, gezählt auf dem Board laut Trennregel`);
  if (falsch.length > 0) h.push(`${falsch.length} Items nur auf dem falschen Board (zählen auf ihrer Seite laut Trennregel): ${falsch.slice(0, 10).map((n) => `#${n}`).join(", ")}${falsch.length > 10 ? ", …" : ""}`);
  return h;
}

/** Kopf-Items der eigenen Seite plus die Notfälle beider, stabil nach `kopfRang`, bei Gleichstand Produkt vor Factory. Pur. */
function kopfKandidaten(listen, eigene) {
  const mitSeite = (seite) => listen[seite].filter((i) => istKopfItem(i) && (eigene === seite || istNotfallBeider(i)));
  return [...mitSeite("produkt"), ...mitSeite("factory")].sort((a, b) => kopfRang(a) - kopfRang(b));
}

/**
 * Die Auswahl über beide Boards (#1729) für einen Bereich (Pflicht, wirft sonst): 1. Kopf-Items der eigenen Seite plus die Notfälle beider, 2. das oberste
 * freie Item der eigenen Seite, ohne Ausweichen auf die andere. `produkt`/`factory`: normalisierte Items je Board; der Rest wie `waehleNaechstes`.
 * Liefert `{ ticket, uebersprungen, hinweise? }`. Pur.
 */
export function waehleUeberBoards({ produkt, factory, bereich, config, ...belegung }) {
  if (!Object.hasOwn(BEREICHE, bereich ?? "")) throw new Error("waehleUeberBoards: bereich erwartet agentic oder spiel");
  const listen = seitenListen(produkt, factory, config);
  const hinweise = listenHinweise(listen);
  const eigene = bereich === "agentic" ? "factory" : "produkt";
  const uebersprungen = [];
  const lauf = (items, extra) => {
    const r = waehleNaechstes({ ...belegung, config, items, ...extra });
    uebersprungen.push(...r.uebersprungen);
    return r.ticket;
  };
  const ticket = lauf(kopfKandidaten(listen, eigene), {}) ?? lauf(listen[eigene], { nur: (i) => !istKopfItem(i) });
  return { ticket, uebersprungen, ...(hinweise.length > 0 ? { hinweise } : {}) };
}

const uebersprungenEintrag = (nr, r) => ({ nr, grund: r.grund, ...(r.fehlt ? { fehlt: r.fehlt } : {}) });
const ticketVon = (item, r) => ({ nr: item.number, titel: item.title, ...(r.bestandFehlt ? { spezifikation: { bestand: true, fehlt: r.bestandFehlt } } : {}) });

/** Kopf-Items (Status-Ticket, Notfälle), Sammel- und Epic-Tickets haben eigene Formate und sind vom Spezifikations-Gate ausgenommen. */
const spezAusgenommen = (t) => istKopfItem({ title: t.titel }) || SAMMELTICKET_TITEL_LISTE.includes(t.titel) || istEpicTitel(t.titel);

const MESSFENSTER_OHNE_LADER = () => ({ fehler: "Messfenster nicht prüfbar (kein Lader)" });

/** `{ grund }` (`""` = frei); dazu `fehlt` bei hartem Spezifikations-Mangel, `bestandFehlt` bei freiem Bestandsticket mit Mangel. */
function ueberspringGrund(c, { offene, belegt, owner, messfenster, hartAb, config }) {
  if (c.assignees.length > 0) return { grund: `Assignee ${c.assignees.map((a) => `@${a}`).join(", ")}` };
  if (istFremdeingang({ user: c.autor, labels: c.labels }, owner, { config }).fremdeingang) return { grund: "Fremdeingang (Autor nicht vertraut oder Forum-Label): Befund melden" };
  const offeneBlocker = blockerNummern(c.body, spracheAus(config).spezifikation).filter((n) => offene.has(n) && n !== c.number);
  if (offeneBlocker.length > 0) return { grund: `offener Blocker ${offeneBlocker.map((n) => `#${n}`).join(", ")}` };
  const fenster = messfensterZeilen(c.body);
  const unlesbar = fenster.find((f) => "fehler" in f);
  if (unlesbar) return { grund: unlesbar.fehler };
  const offenesFenster = fenster.find((f) => offene.has(f.nach));
  if (offenesFenster) return { grund: messfensterGrund(offenesFenster, { closedAt: null, n: 0 }) };
  if (c.blockedBy > 0) return { grund: "offener Blocker laut GitHub-Abhängigkeit" };
  if (belegt.has(c.number)) return { grund: "Branch, Worktree oder offener PR vorhanden" };
  const spez = pruefeEingang({ nummer: c.number, titel: c.title, body: c.body }, { ausgenommen: spezAusgenommen, hartAb, sprache: spracheAus(config).spezifikation });
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

/** Textausgabe: erste Zeile das Ticket (oder „kein freies Ticket“), danach Hinweise, `reparieren`-Zeilen und je übersprungenem Kandidaten eine Zeile. Pur. */
export function formatiere({ ticket, uebersprungen, bereich, einzel = null, hinweise = [] }) {
  if (einzel !== null && !ticket) return [`#${einzel} nicht frei: ${uebersprungen[0]?.grund ?? "unbekannt"}`, ...reparierenZeilen(uebersprungen)].join("\n") + "\n";
  const keins = `kein freies Ticket im Bereich ${BEREICHE[bereich]}`; // ohne Einzelprüfung ist `bereich` immer gesetzt (`fuehreAus` verlangt eines von beiden)
  const kopf = ticket ? `#${ticket.nr}\t${ticket.titel}` : keins;
  const hinweis = ticket?.spezifikation ? [`hinweis #${ticket.nr}: Spezifikation unvollständig (Bestand, nur berichtet): ${ticket.spezifikation.fehlt.join("; ")}`] : [];
  return [kopf, ...hinweise.map((h) => `hinweis ${h}`), ...hinweis, ...reparierenZeilen(uebersprungen), ...uebersprungen.map((u) => `übersprungen #${u.nr}: ${u.grund}`)].join("\n") + "\n";
}

/** Ausführung mit injizierbarer I/O: `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const aufruf = aufrufLesen(argv);
  if (aufruf.fehler) return fehlerErgebnis(aufruf.fehler);
  try {
    const einzel = aufruf.ticket;
    const roh =
      einzel === null
        ? { ...waehleUeberBoards({ ...io.lade(), owner: io.owner, bereich: aufruf.bereich, hartAb: io.hartAb, namen: io.namen, config: io.config }), bereich: aufruf.bereich }
        : pruefeTicket({ ...io.ladeEinzeln(einzel), owner: io.owner, hartAb: io.hartAb, namen: io.namen, config: io.config });
    const reparieren = reparierenVon(roh.uebersprungen);
    const ergebnis = reparieren.length > 0 ? { ...roh, reparieren } : roh;
    const out = aufruf.json ? `${JSON.stringify(ergebnis, null, 2)}\n` : formatiere({ ...ergebnis, einzel });
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
export function messfensterLader({ dir, holeIssue = (nr) => ghJson(["api", `repos/${REPO}/issues/${nr}`]), ladeNamen = ladeTicketNamen } = {}) {
  let ticketNamenCache = null; // beim ersten Bedarf aus der Projekt-Config (`ladeNamen` wirft mit Schlüssel und Fix-Zeile)
  const memo = new Map(); // je `agent|nach`: closedAt und geladene Läufe; nur die Zählung hängt am wartenden Ticket
  return (fenster, wartend) => {
    const schluessel = `${fenster.agent}|${fenster.nach}`;
    if (!memo.has(schluessel)) memo.set(schluessel, messfensterLaeufe(fenster, dir ?? projektOrdner(), holeIssue, () => (ticketNamenCache ??= ladeNamen())));
    const r = memo.get(schluessel);
    if ("fehler" in r) return r;
    if (r.closedAt === null) return { closedAt: null, n: 0 };
    return { closedAt: r.closedAt, n: ticketsImFenster(r.laeufe, { closedAt: r.closedAt, ohneTicket: wartend }) };
  };
}

function messfensterLaeufe(fenster, dir, holeIssue, holeNamen) {
  let closedAt;
  try {
    const issue = holeIssue(fenster.nach);
    closedAt = issue.state === "closed" ? issue.closed_at : null;
  } catch {
    return { fehler: `Messfenster nicht prüfbar (#${fenster.nach} nicht abrufbar)` };
  }
  if (closedAt === null) return { closedAt: null, laeufe: [] };
  if (!existsSync(dir)) return { fehler: "Messfenster nicht prüfbar (keine lokalen Transkripte)" };
  let namen;
  try {
    namen = holeNamen();
  } catch {
    return { fehler: "Messfenster nicht prüfbar (Projekt-Config nicht nutzbar)" };
  }
  try {
    return { closedAt, laeufe: ladeLaeufe(dir, fenster.agent, closedAt).map((l) => laufAus(l, namen)).filter(Boolean) };
  } catch {
    return { fehler: "Messfenster nicht prüfbar (Transkripte nicht lesbar)" };
  }
}

/** Gemeinsame Belegungs-I/O beider Wege: offene Issues, Branch-Refs, Worktrees, offene PRs; der Messfenster-Lader kommt fertig herein. */
function ladeBelegung(messfenster) {
  const offene = new Set(normalizeOffene(loadOpenIssuePages()).map((i) => i.number));
  try {
    git(["fetch", "--prune", "origin"]); // fail-open: ohne Netz zählen die lokalen Remote-Refs
  } catch {
    /* lokale Refs genügen */
  }
  const refs = git(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).split(/\r?\n/).filter(Boolean);
  const worktrees = parseWorktreeBloecke(git(["worktree", "list", "--porcelain"])).flatMap((b) => [b.pfad, b.branch].filter(Boolean));
  const prHeads = prHeadsAus(ghJson(["api", "--paginate", "--slurp", `repos/${REPO}/pulls?state=open&per_page=100`]));
  return { offene, refs, worktrees, prHeads, messfenster };
}

/** Echte I/O samt Namen aus der Projekt-Config; wirft mit Schlüssel und Fix-Zeile, wenn `praefixe` oder `agenten` unvollständig sind (kein Standardwert). Der Messfenster-Lader (`messfensterLader`, Test-Naht) bekommt die schon geladenen Namen. */
export function echteIo({ config, messfensterLader: erzeugeLader = messfensterLader } = {}) {
  const cfg = config ?? ladeProjektConfig();
  labelAus(cfg, "harness");
  labelAus(cfg, "forum"); // fail-fast: das Fremdeingang-Label gehört zur Eingabe der Auswahl
  const namen = ticketNamen(cfg);
  spracheAus(cfg); // fail-fast: das Spezifikations-Gate liest Abschnittsnamen und Schlüsselwörter aus der Config
  const messfenster = erzeugeLader({ ladeNamen: () => namen });
  const lade = () => ({
    produkt: normalizeItems(loadItemPages(boardFuerRolle("produkt"))),
    factory: normalizeItems(loadItemPages(boardFuerRolle("factory"))),
    ...ladeBelegung(messfenster),
  });
  /** Einzelweg (`--ticket`): das eine Issue per REST, keine Board-Seiten. */
  const ladeEinzeln = (nr) => ({ item: itemAusIssue(ghJson(["api", `repos/${REPO}/issues/${nr}`])), ...ladeBelegung(messfenster) });
  return { lade, ladeEinzeln, owner: OWNER, hartAb: cfg.spezifikation?.hartAb, namen, config: cfg };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Aufruf-Fehler vor jedem I/O: sonst schriebe `mitKontingent` seinen Hinweis vor den Fehler (#1817).
  direktaufruf(process.argv.slice(2), {
    pruefe: aufrufLesen,
    fehlerErgebnis: (_argv, vorab) => fehlerErgebnis(vorab.fehler),
    vorbereiten: () => mitKontingent("naechstes-ticket", { arten: ["core"] }), // nur REST, ein knappes GraphQL-Kontingent sperrt den Einstieg nicht
    io: () => {
      try {
        return echteIo();
      } catch (e) {
        return { configFehler: e instanceof Error ? e.message : String(e) }; // `fuehreAus` unten meldet die Config-Ursache (Exit 2)
      }
    },
    fuehreAus: (argv, io) => (io.configFehler === undefined ? fuehreAus(argv, io) : fehlerErgebnis(io.configFehler)),
  });
}
