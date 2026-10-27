#!/usr/bin/env node
/**
 * Das oberste FREIE Ticket der Board-Auswahl (#1428 Z4): ersetzt die Handarbeit „Board-Liste per jq lesen, dann je Kandidat Assignee,
 * Blocker, Branch, Worktree und offenen PR einzeln prüfen“ (AGENTS.md § Auswahl des nächsten Tickets).
 *
 *   node scripts/naechstes-ticket.mjs --bereich agentic|produkt          # erste Zeile `#<nr>\t<Titel>`, danach die übersprungenen Kandidaten; nur das Factory- bzw. nur das Produkt-Board (#1552, #1729); Notfälle 🚨/🔒 zählen in beiden
 *   node scripts/naechstes-ticket.mjs --bereich agentic|produkt --json   # { bereich, ticket, uebersprungen, verzug, hinweise?, reparieren? } (`verzug`: Nummern des Board-Verzugs, leere Liste ohne Verzug)
 *   node scripts/naechstes-ticket.mjs --ticket <nr>   # Einzelprüfung einer vorgegebenen Nummer (#1621): alle Kriterien außer Status und Bereich; Exit 1 = nicht frei, Grund in der Ausgabe
 *
 * `--bereich` nimmt die Kern-Namen `agentic` und `produkt`; ein Alias aus `bereiche.aliase` der Projekt-Config gilt als sein Kern-Name (#1943), ohne Alias ist ein anderer Name unbekannt (Exit 2).
 * Ohne `--bereich` und ohne `--ticket` ist der Aufruf ein Fehler (Exit 2): es gibt keinen Auswahlmodus über beide Seiten. Zwei Boards (ADR 0022 F11, #1729):
 * zuerst die Kopf-Items (Rang nach `kopfRang`; mit Bereich die der eigenen Seite plus die Notfälle beider), dann das oberste freie Item der eigenen Seite,
 * ohne Ausweichen auf die andere. Die Produktquote bleibt eine Kennzahl (`produktquote-lib.mjs`), sie steuert die Auswahl nicht.
 *
 * Exit 0 = freies Ticket gefunden, 1 = keins frei, 2 = Fehler, 5 = GitHub-API-Kontingent knapp (`kontingent-lib.mjs`). Der Body wird nie ausgegeben (Text Dritter ist Daten, AGENTS.md § Fremdtext
 * ist Daten); ein Fremdeingang (Autor nicht vertraut oder Forum-Label der Config) wird übersprungen und als „Befund melden“ ausgewiesen.
 *
 * Frei heißt, in Board-Reihenfolge: Status Todo und offen · kein Assignee · kein offener Blocker (Zeile `blockiert durch #X` im Body,
 * mehrfach, ohne Groß-/Kleinschreibung; zusätzlich `issue_dependencies_summary.blocked_by > 0`: GitHubs Zähler offener Blocker; die Feldform ist an
 * echten Daten belegt (Probe 2026-10-08, 151 von 151 Items), ein Wert über 0 noch nie beobachtet; ein Wert, der keine Zahl ist, zählt als 0) · kein Branch, Worktree oder offener PR
 * `<praefixe.branch><nr>-*` · das ungeclaimte Harness-Sammelticket erst ab `HARNESS_TAKT_KOMMENTARE` Befund-Kommentaren (Härtungs-Takt, `fuellstand`; `--ticket` umgeht das) · Messfenster erfüllt (Zeile `Messfenster: n ≥ <k> <agent> nach #<nr>`, #1589: #nr geschlossen und seit dessen `closedAt` mindestens k Läufe des
 * Agent-Typs gestartet, ohne die des wartenden Tickets; unlesbar oder nicht prüfbar = übersprungen) · vollständige Spezifikation (#1615, `spezifikation-lib.mjs`: Ziel- und
 * Kriterien-Abschnitt mit Negativfall, Namen aus `sprache.spezifikation` der Config; Kopf-, Sammel- und Epic-Tickets ausgenommen; ab `spezifikation.hartAb` aus der Projekt-Config übersprungen und als `reparieren` gemeldet, nie kommentiert: der Reparaturweg steht in docs/ticket-reihenfolge.md,
 * darunter nur als `hinweis` gemeldet). I/O: Board-Seiten und offene Issues (REST), `git fetch/for-each-ref/worktree list`,
 * ein REST-Aufruf für offene PRs, je Messfenster-Kandidat ein REST-Aufruf (`closed_at`) und die lokalen Transkripte (`~/.claude/projects`); dazu EINE GraphQL-Abfrage der 50 jüngsten offenen Issues für den Board-Verzug (#1866: Items auf einem Board, die die REST-Listen noch nicht führen, stehen als Zeile `VERZUG #a, #b: …` und als `verzug` im JSON; fail-open, ein Fehler wird zum Hinweis). `--ticket`: statt der Board-Seiten ein REST-Abruf des Issues.
 *
 * Ein Board führt die Issues EINES Repos (`boards[].repo` der Projekt-Config, sonst `repo`; ADR 0022 F10): die Auswahl sieht nur Items des eigenen Repos (Nummern verschiedener Repos kollidieren nicht),
 * ein Board eines anderen Repos bleibt leer („fremdes Board“, Hinweis nennt das Repo, in dem die Auswahl läuft), eigene Items darauf stehen als „verwaist“. Ein Blocker darf auch `owner/name#n`
 * heißen: ein fremder Verweis wird per REST geprüft, nicht prüfbar zählt als offen (fail-closed).
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { NOTFAELLE, OWNER, boardFuerRolle, REPO, SAMMELTICKET_TITEL, SAMMELTICKET_TITEL_LISTE, frischeOffeneIssues, istKopfItem, kopfRang, loadItemPages, loadOpenIssuePages, normalizeItems, normalizeOffene, seitenListen } from "./board-lib.mjs";
import { istFremdeingang, issueKommentare } from "./fremdtext-lib.mjs";
import { direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { ghJson } from "./gh-cli.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import { BEREICHE, BEREICH_BOARD, bereichAliaseAus, boardRepo, configAusAufruf, gleichesRepo, labelAus, ladeProjektConfig, nurRepo, spracheAus } from "./projekt-config-lib.mjs";
import { HARNESS_TAKT_KOMMENTARE, fuellstandVon } from "./produktquote-lib.mjs";
import { blockerVerweise, istEpicTitel, pruefeEingang } from "./spezifikation-lib.mjs";
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

/** Löst den rohen `--bereich`-Wert auf: ein Kern-Bereich oder ein Alias aus `bereiche.aliase` (#1943); sonst `undefined`. Pur. */
function bereichAus(roh, aliase) {
  if (Object.hasOwn(BEREICHE, roh)) return roh;
  const ziel = Object.hasOwn(aliase, roh) ? aliase[roh] : undefined;
  return typeof ziel === "string" && Object.hasOwn(BEREICHE, ziel) ? ziel : undefined;
}

/** Die Kern-Bereichsnamen, für Meldungen mit Trenner verbunden. */
const bereichsNamen = (trenner) => Object.keys(BEREICHE).join(trenner);

/** Skript-eigene Texte für einen fehlenden Wert (die übrigen Arten nehmen die Standardtexte von `flagsLesen`). */
const OHNE_WERT = {
  "--bereich": `--bereich erwartet ${bereichsNamen(" oder ")} (bekommen: nichts)`,
  "--ticket": "--ticket erwartet eine Ticketnummer (bekommen: nichts)",
};

/** Der `--bereich`-Wert des Aufrufs: `{ bereich }` (null ohne Schalter) oder `{ fehler }` bei einem unbekannten Namen. Pur. */
function bereichLesen(rohWert, aliase) {
  if (rohWert === undefined) return { bereich: null };
  const bereich = bereichAus(rohWert, aliase);
  return bereich === undefined ? { fehler: `--bereich erwartet ${bereichsNamen(" oder ")} (bekommen: „${rohWert}“)` } : { bereich };
}

/** Die `--ticket`-Nummer des Aufrufs: `{ ticket }` (null ohne Schalter) oder `{ fehler }`. Pur. */
function ticketLesen(nr) {
  if (nr === undefined) return { ticket: null };
  const m = /^#?(\d+)$/.exec(nr);
  return !m || Number(m[1]) <= 0 ? { fehler: `--ticket erwartet eine Ticketnummer (bekommen: „${nr}“)` } : { ticket: Number(m[1]) };
}

/**
 * Liest den Aufruf über `flagsLesen` (`--bereich <wert>`, `--ticket <nr>` auch als `--x=<wert>` und `#<nr>`, `--json`) und prüft die Werte:
 * `{ bereich, ticket, json }` (`bereich` und `ticket` null ohne Schalter) oder `{ fehler }`. Pur, ohne I/O.
 * Schließt `--ticket` und `--bereich` gegenseitig aus und verlangt genau eines davon.
 */
export function aufrufLesen(argv, { aliase = {} } = {}) {
  const r = flagsLesen(argv, { bereich: { type: "string" }, ticket: { type: "string" }, json: { type: "boolean" }, maengel: { type: "boolean" } }, {
    meldung: (art, flag) => (art === "ohne-wert" ? OHNE_WERT[flag] : undefined),
  });
  if (r.fehler) return { fehler: r.fehler.text };
  const { bereich: rohWert, ticket: nr, json, maengel } = r.werte;
  const b = bereichLesen(rohWert, aliase);
  if (b.fehler) return { fehler: b.fehler };
  const tk = ticketLesen(nr);
  if (tk.fehler) return { fehler: tk.fehler };
  const { bereich } = b;
  const { ticket } = tk;
  if (maengel === true && ticket !== null) return { fehler: "--maengel und --ticket schließen sich aus" };
  if (maengel === true) return { bereich, ticket: null, json: json === true, maengel: true };
  if (ticket !== null && bereich) return { fehler: "--ticket und --bereich schließen sich aus" };
  if (ticket === null && !bereich) return { fehler: `Aufruf ohne Auswahl: --bereich ${bereichsNamen("|")} (oberstes freies Ticket des Bereichs) oder --ticket <nr> (Einzelprüfung)` };
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
export function pruefeTicket({ item, offene, refs = [], worktrees = [], prHeads = [], owner = "", messfenster = MESSFENSTER_OHNE_LADER, hartAb = 0, namen, config, repo, fremdStatus }) {
  const nr = item.number;
  if (repo !== undefined && item.repo !== "" && !gleichesRepo(item.repo, repo)) return { ticket: null, uebersprungen: [{ nr, grund: `gehört zu ${item.repo}, nicht zu ${repo}` }] };
  if (item.state !== "open") return { ticket: null, uebersprungen: [{ nr, grund: "geschlossen" }] };
  const r = ueberspringGrund(item, { offene, belegt: belegteNummern({ refs, worktrees, prHeads }, namen), owner, messfenster, hartAb, config, repo, fremdStatus });
  return r.grund ? { ticket: null, uebersprungen: [uebersprungenEintrag(nr, r)] } : { ticket: ticketVon(item, r), uebersprungen: [] };
}

/** 🚨 CI rot auf main und 🔒 Security gelten auf beiden Boards (Roter main geht vor). Pur. */
export function istNotfallBeider(item) {
  return NOTFAELLE.filter((n) => n.art === "rot-main" || n.art === "security").some((n) => String(item.title ?? "").startsWith(n.marker));
}

/** Gehört das Item zum Bereich? Ohne Bereich immer; Notfälle (`istNotfallBeider`) zählen in beiden. Das Harness-Label kommt aus `config` (Pflicht, wirft ohne `labels.harness`). Pur. */
export function imBereich(item, bereich, config) {
  if (!bereich) return true;
  return istNotfallBeider(item) || item.labels.includes(labelAus(config, "harness")) === (BEREICH_BOARD[bereich] === "factory");
}

/**
 * Wählt das oberste freie Ticket. `items`: normalisierte Board-Items (`normalizeItems` aus board-lib, Board-Reihenfolge), `offene`: Menge offener Issue-Nummern,
 * `refs`/`worktrees`/`prHeads`: Texte (Branch-Namen, Worktree-Pfade bzw. -Branches, PR-Branches), `owner` für die Vertrauensprüfung.
 * `fuellstand(nr)`: Füllstand des Harness-Sammeltickets (`fuellstandVon`) oder `{ fehler }`; das ungeclaimte Harness-Sammelticket unter `HARNESS_TAKT_KOMMENTARE` wird übersprungen
 * (Härtungs-Takt: „füllt sich“), ein nicht prüfbarer Füllstand ebenso (fail-closed; Standard ohne Lader). Er wird nur für dieses Ticket als Kandidat geladen.
 * `nur`: zusätzlicher Filter (Kopf- bzw. Nicht-Kopf-Walk der Zwei-Boards-Auswahl). Liefert `{ ticket: { nr, titel } | null, uebersprungen: [{ nr, grund }] }`. Pur.
 */
export function waehleNaechstes({ items, offene, refs = [], worktrees = [], prHeads = [], owner = "", bereich = null, messfenster = MESSFENSTER_OHNE_LADER, fuellstand = FUELLSTAND_OHNE_LADER, hartAb = 0, nur = () => true, namen, config, repo, fremdStatus }) {
  labelAus(config, "harness"); // fail-fast, auch ohne Bereich: ohne Config gibt es keine Auswahl
  const belegt = belegteNummern({ refs, worktrees, prHeads }, namen);
  const uebersprungen = [];
  for (const item of items) {
    if (item.status !== "Todo" || item.state !== "open" || !imBereich(item, bereich, config) || !nur(item)) continue;
    const r = ueberspringGrund(item, { offene, belegt, owner, messfenster, fuellstand, hartAb, config, repo, fremdStatus });
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
  if (!Object.hasOwn(BEREICHE, bereich ?? "")) throw new Error(`waehleUeberBoards: bereich erwartet ${bereichsNamen(" oder ")}`);
  const listen = seitenListen(produkt, factory, config);
  const hinweise = listenHinweise(listen);
  const eigene = BEREICH_BOARD[bereich];
  const uebersprungen = [];
  const lauf = (items, extra) => {
    const r = waehleNaechstes({ ...belegung, config, items, ...extra });
    uebersprungen.push(...r.uebersprungen);
    return r.ticket;
  };
  const ticket = lauf(kopfKandidaten(listen, eigene), {}) ?? lauf(listen[eigene], { nur: (i) => !istKopfItem(i) });
  return { ticket, uebersprungen, ...(hinweise.length > 0 ? { hinweise } : {}) };
}

/**
 * Board-Verzug (#1866): offene Issues, die laut GraphQL (`frisch` = `frischeOffeneIssues`, frisch ohne Verzögerung) ein Item auf dem Produkt- oder
 * Factory-Board haben (`projektIds` = deren Projekt-IDs), aber in keiner der REST-Board-Listen stehen: die Auswahl sieht sie nicht. Sortierte
 * Nummern; ein Issue ohne Board-Item ist kein Verzug (das ist Sache des Board-Wächters). Pur.
 */
export function verzugNummern({ frisch, produkt, factory, projektIds }) {
  const gelistet = new Set([...produkt, ...factory].map((i) => i.number));
  return frisch
    .filter((i) => !gelistet.has(i.number) && i.projektIds.some((id) => projektIds.includes(id)))
    .map((i) => i.number)
    .sort((a, b) => a - b);
}

const verzugZeile = (verzug) => `VERZUG ${verzug.map((n) => `#${n}`).join(", ")}: Board-REST-Liste hinkt, die Auswahl sieht sie nicht`;

/**
 * `daten` = Ergebnis von `io.lade()`; `frisch` (optional) ist dort `{ issues, projektIds }` oder `{ fehler }`. Liefert `{ verzug, hinweis? }`:
 * fail-open, ein GraphQL-Fehler wird zum Hinweis, die Auswahl läuft unverändert. Pur.
 */
export function verzugAus(daten) {
  const f = daten.frisch;
  if (!f) return { verzug: [] };
  if (f.fehler) return { verzug: [], hinweis: `Board-Verzug nicht prüfbar (GraphQL): ${f.fehler}` };
  return { verzug: verzugNummern({ frisch: f.issues, produkt: daten.produkt, factory: daten.factory, projektIds: f.projektIds }) };
}

const uebersprungenEintrag = (nr, r) => ({ nr, grund: r.grund, ...(r.fehlt ? { fehlt: r.fehlt } : {}) });
const ticketVon = (item, r) => ({ nr: item.number, titel: item.title, ...(r.bestandFehlt ? { spezifikation: { bestand: true, fehlt: r.bestandFehlt } } : {}) });

/** Kopf-Items (Status-Ticket, Notfälle), Sammel- und Epic-Tickets haben eigene Formate und sind vom Spezifikations-Gate ausgenommen. */
const spezAusgenommen = (t) => istKopfItem({ title: t.titel }) || SAMMELTICKET_TITEL_LISTE.includes(t.titel) || istEpicTitel(t.titel);

const MESSFENSTER_OHNE_LADER = () => ({ fehler: "Messfenster nicht prüfbar (kein Lader)" });
const FUELLSTAND_OHNE_LADER = () => ({ fehler: "kein Lader" });

/** Härtungs-Takt: Grund, das ungeclaimte Harness-Sammelticket noch nicht zu nehmen (`""` = nehmen). `fuellstand === null` schaltet die Prüfung ab (Einzelprüfung `--ticket`, Mängelliste). */
function fuellstandGrund(c, fuellstand) {
  if (fuellstand === null || c.title !== SAMMELTICKET_TITEL) return "";
  const f = fuellstand(c.number);
  if (typeof f !== "number") return `Füllstand nicht prüfbar (${f.fehler})`;
  return f < HARNESS_TAKT_KOMMENTARE ? `füllt sich (${f}/${HARNESS_TAKT_KOMMENTARE} Befund-Kommentare)` : "";
}

const FREMDSTATUS_OHNE_LADER = () => ({ fehler: "kein Lader" });

/**
 * Überspringgrund der Blocker-Zeile (`""` = kein offener Blocker): ein Verweis ohne Repo oder auf das eigene Repo (`repo`) zählt gegen `offene`,
 * ein Verweis auf ein anderes Repo fragt `fremdStatus(repo, nr)` (`{ offen }` oder `{ fehler }`); nicht prüfbar gilt als Grund (fail-closed). Pur.
 */
export function blockerGrund(c, { offene, repo, fremdStatus = FREMDSTATUS_OHNE_LADER, sprache }) {
  const offen = [];
  for (const v of blockerVerweise(c.body, sprache)) {
    if (v.repo === null || gleichesRepo(v.repo, repo)) {
      if (offene.has(v.nummer) && v.nummer !== c.number) offen.push(`#${v.nummer}`);
      continue;
    }
    let s;
    try {
      s = fremdStatus(v.repo, v.nummer);
    } catch (e) {
      s = { fehler: e instanceof Error ? e.message : String(e) };
    }
    if (s.fehler !== undefined) return `Blocker ${v.repo}#${v.nummer} nicht prüfbar (${s.fehler})`;
    if (s.offen) offen.push(`${v.repo}#${v.nummer}`);
  }
  return offen.length > 0 ? `offener Blocker ${offen.join(", ")}` : "";
}

/** `{ grund }` (`""` = frei); dazu `fehlt` bei hartem Spezifikations-Mangel, `bestandFehlt` bei freiem Bestandsticket mit Mangel. */
function ueberspringGrund(c, { offene, belegt, owner, messfenster, fuellstand = null, hartAb, config, repo, fremdStatus }) {
  if (c.assignees.length > 0) return { grund: `Assignee ${c.assignees.map((a) => `@${a}`).join(", ")}` };
  if (istFremdeingang({ user: c.autor, labels: c.labels }, owner, { config }).fremdeingang) return { grund: "Fremdeingang (Autor nicht vertraut oder Forum-Label): Befund melden" };
  const blocker = blockerGrund(c, { offene, repo, fremdStatus, sprache: spracheAus(config).spezifikation });
  if (blocker) return { grund: blocker };
  const fenster = messfenster === null ? [] : messfensterZeilen(c.body); // `null`: Mängelliste, das teure Messfenster zählt dort nicht
  const unlesbar = fenster.find((f) => "fehler" in f);
  if (unlesbar) return { grund: unlesbar.fehler };
  const offenesFenster = fenster.find((f) => offene.has(f.nach));
  if (offenesFenster) return { grund: messfensterGrund(offenesFenster, { closedAt: null, n: 0 }) };
  if (c.blockedBy > 0) return { grund: "offener Blocker laut GitHub-Abhängigkeit" };
  if (belegt.has(c.number)) return { grund: "Branch, Worktree oder offener PR vorhanden" };
  const fuell = fuellstandGrund(c, fuellstand);
  if (fuell) return { grund: fuell };
  const spez = pruefeEingang({ nummer: c.number, titel: c.title, body: c.body }, { ausgenommen: spezAusgenommen, hartAb, sprache: spracheAus(config).spezifikation });
  if (spez.art === "hart") return { grund: `Spezifikation unvollständig: ${spez.fehlt.join("; ")}`, fehlt: spez.fehlt };
  for (const f of fenster) {
    const grund = messfensterGrund(f, messfenster(f, c.number)); // teuer (REST + Transkripte): erst für sonst freie Kandidaten
    if (grund) return { grund };
  }
  return spez.art === "bestand" ? { grund: "", bestandFehlt: spez.fehlt } : { grund: "" };
}

/**
 * Die Mängelliste (`--maengel`): freie, vertraute, unblockierte Todo-Items mit Spezifikations-Mangel (hart oder Bestand) in Board-Reihenfolge (Produkt vor Factory,
 * mit `bereich` nur dessen Board); Kopf-, Sammel- und Epic-Tickets sind vom Gate ausgenommen. Das Messfenster zählt hier nicht. Liefert `{ anzahl, maengel: [{ nr, titel, fehlt }] }`. Pur.
 */
export function listeMaengel({ produkt, factory, bereich = null, config, offene, refs = [], worktrees = [], prHeads = [], owner = "", hartAb = 0, namen, repo, fremdStatus }) {
  if (bereich !== null && !Object.hasOwn(BEREICHE, bereich)) throw new Error(`listeMaengel: bereich erwartet ${bereichsNamen(" oder ")}`);
  const listen = seitenListen(produkt, factory, config);
  const items = bereich === null ? [...listen.produkt, ...listen.factory] : listen[BEREICH_BOARD[bereich]];
  const belegt = belegteNummern({ refs, worktrees, prHeads }, namen);
  const maengel = [];
  for (const item of items) {
    if (item.status !== "Todo" || item.state !== "open") continue;
    const r = ueberspringGrund(item, { offene, belegt, owner, messfenster: null, hartAb, config, repo, fremdStatus });
    const fehlt = r.fehlt ?? r.bestandFehlt;
    if (fehlt) maengel.push({ nr: item.number, titel: item.title, fehlt });
  }
  return { anzahl: maengel.length, maengel };
}

/** Textausgabe der Mängelliste: erste Zeile die Zahl, dann je Ticket `#<nr>TAB<Titel>: <Mängel>` (nie der Body). Pur. */
export const formatiereMaengel = ({ anzahl, maengel }) =>
  [`${anzahl} ${anzahl === 1 ? "Ticket" : "Tickets"} mit Mangel`, ...maengel.map((m) => `#${m.nr}\t${m.titel}: ${m.fehlt.join("; ")}`)].join("\n") + "\n";

/** Reparaturaufträge (#1698): hart übersprungene Tickets mit Spezifikations-Mangel (`fehlt`), nur vertraute und freie (`ueberspringGrund` setzt `fehlt` erst nach Assignee-, Fremdeingangs-, Blocker- und Belegungsprüfung). Pur. */
export const reparierenVon = (uebersprungen) => uebersprungen.filter((u) => u.fehlt).map((u) => ({ nr: u.nr, fehlt: u.fehlt }));

const reparierenZeilen = (uebersprungen) => reparierenVon(uebersprungen).map((r) => `reparieren #${r.nr}: ${r.fehlt.join("; ")}`);

/** Textausgabe: erste Zeile das Ticket (oder „kein freies Ticket“), danach Hinweise, `reparieren`-Zeilen und je übersprungenem Kandidaten eine Zeile. Pur. */
export function formatiere({ ticket, uebersprungen, bereich, einzel = null, hinweise = [], verzug = [] }) {
  if (einzel !== null && !ticket) return [`#${einzel} nicht frei: ${uebersprungen[0]?.grund ?? "unbekannt"}`, ...reparierenZeilen(uebersprungen)].join("\n") + "\n";
  const keins = `kein freies Ticket im Bereich ${BEREICHE[bereich]}`; // ohne Einzelprüfung ist `bereich` immer gesetzt (`fuehreAus` verlangt eines von beiden)
  const kopf = ticket ? `#${ticket.nr}\t${ticket.titel}` : keins;
  const hinweis = ticket?.spezifikation ? [`hinweis #${ticket.nr}: Spezifikation unvollständig (Bestand, nur berichtet): ${ticket.spezifikation.fehlt.join("; ")}`] : [];
  return [kopf, ...(verzug.length > 0 ? [verzugZeile(verzug)] : []), ...hinweise.map((h) => `hinweis ${h}`), ...hinweis, ...reparierenZeilen(uebersprungen), ...uebersprungen.map((u) => `übersprungen #${u.nr}: ${u.grund}`)].join("\n") + "\n";
}

const nummernText = (items) => `${items.slice(0, 10).map((i) => `#${i.number}`).join(", ")}${items.length > 10 ? ", …" : ""}`;

/**
 * Die Board-Listen für das Repo `repo` der Auswahl (ADR 0022 F10): nur dessen Items (`nurRepo`; Nummern verschiedener Repos kollidieren sonst), ein Board eines
 * anderen Repos (`boardRepos[rolle]`, aus `boardRepo`) liefert keine Auswahl-Items. `alle`: die eigenen Items beider Boards (für den Board-Verzug). `hinweise`:
 * Items des Repos auf einem fremden Board („verwaist“) und, mit `bereich`, dass die Auswahl dieses Bereichs im Repo des Boards läuft. Pur.
 */
export function seitenDesRepos({ produkt, factory }, { repo, boardRepos, bereich = null }) {
  const alle = { produkt: nurRepo(produkt, repo), factory: nurRepo(factory, repo) };
  const hinweise = [];
  const seiten = {};
  const fremd = {};
  for (const rolle of ["produkt", "factory"]) {
    fremd[rolle] = !gleichesRepo(boardRepos?.[rolle], repo);
    seiten[rolle] = fremd[rolle] ? [] : alle[rolle];
    if (fremd[rolle] && alle[rolle].length > 0) {
      hinweise.push(`${alle[rolle].length} Items von ${repo} stehen auf dem Board ${rolle}, das die Issues von ${boardRepos?.[rolle]} führt (verwaist, nicht in der Auswahl): ${nummernText(alle[rolle])}`);
    }
  }
  const eigene = bereich ? BEREICH_BOARD[bereich] : null;
  if (eigene && fremd[eigene]) {
    hinweise.unshift(`Das Board ${eigene} (Bereich ${BEREICHE[bereich]}) führt die Issues von ${boardRepos?.[eigene]}, nicht die von ${repo}: die Auswahl für diesen Bereich läuft in ${boardRepos?.[eigene]}`);
  }
  return { ...seiten, alle, hinweise };
}

/** Die Ladedaten für das Repo der Auswahl: `{ daten, listen, hinweise }` (`daten` für die Auswahl, `listen` für den Verzug). Ohne `io.repo` (Einspeisung in Tests) unverändert; `echteIo` setzt es immer. */
function datenDesRepos(daten, io, bereich) {
  if (io.repo === undefined) return { daten, listen: daten, hinweise: [] };
  const s = seitenDesRepos(daten, { repo: io.repo, boardRepos: io.boardRepos, bereich });
  return { daten: { ...daten, produkt: s.produkt, factory: s.factory }, listen: { ...daten, ...s.alle }, hinweise: s.hinweise };
}

/** Ausführung mit injizierbarer I/O: `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const aufruf = aufrufLesen(argv, { aliase: bereichAliaseAus(io.config) });
  if (aufruf.fehler) return fehlerErgebnis(aufruf.fehler);
  try {
    const gemeinsam = { owner: io.owner, hartAb: io.hartAb, namen: io.namen, config: io.config, repo: io.repo, fremdStatus: io.fremdStatus };
    if (aufruf.maengel) {
      const liste = listeMaengel({ ...datenDesRepos(io.lade(), io, aufruf.bereich).daten, ...gemeinsam, bereich: aufruf.bereich });
      return { code: 0, out: aufruf.json ? `${JSON.stringify(liste, null, 2)}\n` : formatiereMaengel(liste), err: "" };
    }
    const einzel = aufruf.ticket;
    const geladen = einzel === null ? datenDesRepos(io.lade(), io, aufruf.bereich) : null;
    const daten = geladen?.daten ?? null;
    const { verzug, hinweis: verzugHinweis } = geladen ? verzugAus(geladen.listen) : { verzug: [] };
    const roh =
      daten
        ? { ...waehleUeberBoards({ ...daten, ...gemeinsam, bereich: aufruf.bereich, fuellstand: io.fuellstand }), bereich: aufruf.bereich }
        : pruefeTicket({ ...io.ladeEinzeln(einzel), ...gemeinsam });
    const hinweise = [...(geladen?.hinweise ?? []), ...(roh.hinweise ?? []), ...(verzugHinweis ? [verzugHinweis] : [])];
    const reparieren = reparierenVon(roh.uebersprungen);
    const mitVerzug = daten ? { ...roh, ...(hinweise.length > 0 ? { hinweise } : {}), verzug } : roh;
    const ergebnis = reparieren.length > 0 ? { ...mitVerzug, reparieren } : mitVerzug;
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

/**
 * Lader für den Füllstand (Härtungs-Takt), I/O: die Kommentare des Sammeltickets per REST (`holeKommentare`), gezählt mit `fuellstandVon`. Memo je Nummer;
 * ein Ladefehler wird zu `{ fehler }` (fail-closed: das Sammelticket wird dann übersprungen, die Auswahl läuft weiter).
 */
export function fuellstandLader({ holeKommentare = (nr, repo) => issueKommentare(nr, ghJson, repo), repo = REPO } = {}) {
  const memo = new Map();
  return (nr) => {
    if (!memo.has(nr)) {
      const r = fuellstandVon({ nr, repo, ladeKommentare: holeKommentare });
      memo.set(nr, r.fehler === undefined ? r.wert : { fehler: r.fehler });
    }
    return memo.get(nr);
  };
}

/**
 * Lader für Blocker in einem anderen Repo (`owner/name#n`), I/O: der Stand des Issues per REST (`holeIssue`). Memo je Verweis; ein Abruffehler wird zu `{ fehler }`
 * (fail-closed: `blockerGrund` meldet den Blocker als nicht prüfbar). `{ offen }` ist true, solange das Issue nicht geschlossen ist.
 */
export function fremdStatusLader({ holeIssue = (repo, nr) => ghJson(["api", `repos/${repo}/issues/${nr}`]) } = {}) {
  const memo = new Map();
  return (repo, nr) => {
    const schluessel = `${repo.toLowerCase()}#${nr}`;
    if (!memo.has(schluessel)) {
      try {
        const issue = holeIssue(repo, nr);
        memo.set(schluessel, typeof issue?.state === "string" ? { offen: issue.state !== "closed" } : { fehler: "Antwort ohne Stand" });
      } catch {
        memo.set(schluessel, { fehler: "nicht abrufbar" });
      }
    }
    return memo.get(schluessel);
  };
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

/** Die frischen offenen Issues per GraphQL für den Verzugs-Vergleich; fail-open: ein Fehler kommt als `{ fehler }` zurück, die Auswahl läuft weiter. */
export function ladeFrisch(lade = frischeOffeneIssues) {
  try {
    return { issues: lade({ anzahl: 50 }), projektIds: ["produkt", "factory"].map((r) => boardFuerRolle(r).projectId) };
  } catch (e) {
    return { fehler: e instanceof Error ? e.message : String(e) };
  }
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
    frisch: ladeFrisch(),
  });
  /** Einzelweg (`--ticket`): das eine Issue per REST, keine Board-Seiten. */
  const ladeEinzeln = (nr) => ({ item: itemAusIssue(ghJson(["api", `repos/${REPO}/issues/${nr}`])), ...ladeBelegung(messfenster) });
  const boardRepos = { produkt: boardRepo(boardFuerRolle("produkt"), { repo: REPO }), factory: boardRepo(boardFuerRolle("factory"), { repo: REPO }) };
  return { lade, ladeEinzeln, fuellstand: fuellstandLader(), fremdStatus: fremdStatusLader(), repo: REPO, boardRepos, owner: OWNER, hartAb: cfg.spezifikation?.hartAb, namen, config: cfg };
}

if (istDirektaufruf(import.meta.url)) {
  // Aufruf-Fehler vor jedem I/O: sonst schriebe `mitKontingent` seinen Hinweis vor den Fehler (#1817).
  const { args, config, fehler: configFehler } = configAusAufruf(process.argv.slice(2)); // --config <pfad>, vor jedem I/O; übersteuert Sprache, Labels, Namen und hartAb, Repo und Board-IDs kommen aus der Repo-Config (board-lib/inbox-lib)
  direktaufruf(args, {
    pruefe: (argv) => (configFehler ? { fehler: configFehler } : aufrufLesen(argv, { aliase: bereichAliaseAus(config) })),
    fehlerErgebnis: (_argv, vorab) => fehlerErgebnis(vorab.fehler),
    vorbereiten: () => mitKontingent("naechstes-ticket", { arten: ["core"] }), // nur REST zählt: das eine GraphQL (Verzug) ist fail-open, ein knappes GraphQL-Kontingent sperrt den Einstieg nicht
    io: () => {
      try {
        return echteIo({ config });
      } catch (e) {
        return { configFehler: e instanceof Error ? e.message : String(e) }; // `fuehreAus` unten meldet die Config-Ursache (Exit 2)
      }
    },
    fuehreAus: (argv, io) => (io.configFehler === undefined ? fuehreAus(argv, io) : fehlerErgebnis(io.configFehler)),
  });
}
