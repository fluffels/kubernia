#!/usr/bin/env node
/**
 * Das oberste FREIE Ticket der Board-Auswahl (#1428 Z4): ersetzt die Handarbeit „Board-Liste per jq lesen, dann je Kandidat Assignee,
 * Blocker, Branch, Worktree und offenen PR einzeln prüfen“ (AGENTS.md § Auswahl des nächsten Tickets).
 *
 *   node scripts/naechstes-ticket.mjs          # erste Zeile `#<nr>\t<Titel>`, danach die übersprungenen Kandidaten
 *   node scripts/naechstes-ticket.mjs --json   # { ticket, uebersprungen, quote, hinweise? }
 *   node scripts/naechstes-ticket.mjs --ticket <nr>   # Einzelprüfung einer vorgegebenen Nummer (#1621): alle Kriterien außer Status und Bereich; Exit 1 = nicht frei, Grund in der Ausgabe
 *   node scripts/naechstes-ticket.mjs --bereich agentic|spiel   # nur das Factory- bzw. nur das Produkt-Board (#1552, #1729); Notfälle 🚨/🔒 zählen in beiden
 *
 * Zwei Boards (ADR 0022 F11, #1729): zuerst die Kopf-Items beider Boards (Rang nach `kopfRang`), dann die Seite laut Spielquote
 * (`spielquote-lib.mjs`: nach `SPIEL_QUOTE` Produkt-Merges seit dem letzten Factory-Merge Factory, sonst Produkt; ein geclaimtes offenes
 * Nicht-Kopf-Factory-Item heißt „Factory in Arbeit“ und lenkt auf Produkt). Hat die gewählte Seite nichts Freies, wählt der Rückfall die andere
 * (Hinweis „Rückfall“). Die Infozeile hinter der ersten Zeile und `--json` (`quote`) nennen Seite und Zählung. Die Commits lädt der Lauf nur bei Bedarf.
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
import { FACTORY_LABEL, NOTFAELLE, boardFuerRolle, REPO, SAMMELTICKET_TITEL_LISTE, istKopfItem, kopfRang, loadItemPages, loadOpenIssuePages, normalizeItems, normalizeOffene, seitenListen, ungeclaimt } from "./board-lib.mjs";
import { entscheideSeite, produktMergesSeitFactory } from "./spielquote-lib.mjs";
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

/** 🚨 CI rot auf main und 🔒 Security gelten auf beiden Boards (Roter main geht vor). Pur. */
export function istNotfallBeider(item) {
  return NOTFAELLE.filter((n) => n.art === "rot-main" || n.art === "security").some((n) => String(item.title ?? "").startsWith(n.marker));
}

/** Gehört das Item zum Bereich? Ohne Bereich immer; Notfälle (`istNotfallBeider`) zählen in beiden. Pur. */
export function imBereich(item, bereich) {
  if (!bereich) return true;
  return istNotfallBeider(item) || item.labels.includes(FACTORY_LABEL) === (bereich === "agentic");
}

/**
 * Wählt das oberste freie Ticket. `items`: normalisierte Board-Items (`normalizeItems` aus board-lib, Board-Reihenfolge), `offene`: Menge offener Issue-Nummern,
 * `refs`/`worktrees`/`prHeads`: Texte (Branch-Namen, Worktree-Pfade bzw. -Branches, PR-Branches), `owner` für die Vertrauensprüfung.
 * `nur`: zusätzlicher Filter (Kopf- bzw. Nicht-Kopf-Walk der Zwei-Boards-Auswahl). Liefert `{ ticket: { nr, titel } | null, uebersprungen: [{ nr, grund }] }`. Pur.
 */
export function waehleNaechstes({ items, offene, refs = [], worktrees = [], prHeads = [], owner = "", bereich = null, messfenster = MESSFENSTER_OHNE_LADER, hartAb = 0, nur = () => true }) {
  const belegt = belegteNummern({ refs, worktrees, prHeads });
  const uebersprungen = [];
  for (const item of items) {
    if (item.status !== "Todo" || item.state !== "open" || !imBereich(item, bereich) || !nur(item)) continue;
    const r = ueberspringGrund(item, { offene, belegt, owner, messfenster, hartAb });
    if (r.grund) uebersprungen.push(uebersprungenEintrag(item.number, r));
    else return { ticket: ticketVon(item, r), uebersprungen };
  }
  return { ticket: null, uebersprungen };
}

const SEITENNAME = { produkt: "Produkt", factory: "Factory" };
const andere = (seite) => (seite === "factory" ? "produkt" : "factory");

/** Hinweise zu den Board-Listen: Nummern auf beiden Boards und Items nur auf dem falschen Board (Sammelhinweis mit bis zu 10 Nummern). Pur. */
function listenHinweise({ doppelt, falsch }) {
  const h = doppelt.map((n) => `#${n} steht auf beiden Boards, gezählt auf dem Board laut Trennregel`);
  if (falsch.length > 0) h.push(`${falsch.length} Items nur auf dem falschen Board (zählen auf ihrer Seite laut Trennregel): ${falsch.slice(0, 10).map((n) => `#${n}`).join(", ")}${falsch.length > 10 ? ", …" : ""}`);
  return h;
}

/** Kopf-Items beider Seiten, stabil nach `kopfRang`, bei Gleichstand Produkt vor Factory; mit Bereich nur die eigene Seite plus Notfälle beider. Pur. */
function kopfKandidaten(listen, bereich) {
  const eigene = bereich === null ? null : bereich === "agentic" ? "factory" : "produkt";
  const mitSeite = (seite) => listen[seite].filter((i) => istKopfItem(i) && (eigene === null || eigene === seite || istNotfallBeider(i))).map((i) => ({ ...i, seite }));
  return [...mitSeite("produkt"), ...mitSeite("factory")].sort((a, b) => kopfRang(a) - kopfRang(b));
}

/** Die Seite laut Spielquote: Quote nur laden, wenn keine Factory-Arbeit läuft (`ladeQuote` liefert `{ commits, harnessIssues }`, wirft bei Fehlern). */
function waehleSeite(listen, ladeQuote) {
  const inArbeit = listen.factory.find((i) => i.state === "open" && !ungeclaimt(i) && !istKopfItem(i));
  if (inArbeit) return { ...entscheideSeite({ produktMerges: null, factoryInArbeit: inArbeit.number }), produktMerges: null };
  const { commits, harnessIssues } = ladeQuote();
  const produktMerges = produktMergesSeitFactory(commits, harnessIssues);
  return { ...entscheideSeite({ produktMerges }), produktMerges };
}

/**
 * Die Auswahl über beide Boards (#1729): 1. Kopf-Items beider Boards (Quote ruht), 2. mit `bereich` nur die eigene Seite (ohne Quote, ohne Rückfall),
 * 3. sonst die Seite laut Spielquote, bei leerer Seite der Rückfall auf die andere. `produkt`/`factory`: normalisierte Items je Board; der Rest
 * wie `waehleNaechstes`; `ladeQuote` nur bei Bedarf (wirft bei Fehlern, der Lauf endet mit Exit 2). Liefert
 * `{ ticket, uebersprungen, quote: { seite, produktMerges, grund, rueckfall }, hinweise? }`. Pur bis auf `ladeQuote`.
 */
export function waehleUeberBoards({ produkt, factory, bereich = null, ladeQuote, ...belegung }) {
  const listen = seitenListen(produkt, factory);
  const hinweise = listenHinweise(listen);
  const uebersprungen = [];
  const lauf = (items, extra) => {
    const r = waehleNaechstes({ ...belegung, items, ...extra });
    uebersprungen.push(...r.uebersprungen);
    return r.ticket;
  };
  const fertig = (ticket, quote) => ({ ticket, uebersprungen, quote, ...(hinweise.length > 0 ? { hinweise } : {}) });
  const kopf = kopfKandidaten(listen, bereich);
  const kopfTreffer = lauf(kopf, {});
  if (kopfTreffer) return fertig(kopfTreffer, { seite: kopf.find((i) => i.number === kopfTreffer.nr).seite, produktMerges: null, grund: "Kopf-Item, vor der Quote", rueckfall: false });
  const nichtKopf = (i) => !istKopfItem(i);
  if (bereich) {
    const seite = bereich === "agentic" ? "factory" : "produkt";
    return fertig(lauf(listen[seite], { nur: nichtKopf }), { seite, produktMerges: null, grund: `--bereich ${bereich}`, rueckfall: false });
  }
  const wahl = waehleSeite(listen, ladeQuote);
  const erste = lauf(listen[wahl.seite], { nur: nichtKopf });
  if (erste) return fertig(erste, { seite: wahl.seite, produktMerges: wahl.produktMerges, grund: wahl.grund, rueckfall: false });
  const zweite = lauf(listen[andere(wahl.seite)], { nur: nichtKopf });
  if (!zweite) return fertig(null, { seite: wahl.seite, produktMerges: wahl.produktMerges, grund: wahl.grund, rueckfall: false });
  hinweise.push(`Rückfall: kein freies ${SEITENNAME[wahl.seite]}-Item, oberstes freies ${SEITENNAME[andere(wahl.seite)]}-Item`);
  return fertig(zweite, { seite: andere(wahl.seite), produktMerges: wahl.produktMerges, grund: wahl.grund, rueckfall: true });
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

/** Textausgabe: erste Zeile das Ticket (oder „kein freies Ticket“), danach die Infozeile zu Seite und Zählung, Hinweise, `reparieren`-Zeilen und je übersprungenem Kandidaten eine Zeile. Pur. */
export function formatiere({ ticket, uebersprungen, bereich = null, einzel = null, quote = null, hinweise = [] }) {
  if (einzel !== null && !ticket) return [`#${einzel} nicht frei: ${uebersprungen[0]?.grund ?? "unbekannt"}`, ...reparierenZeilen(uebersprungen)].join("\n") + "\n";
  const keins = bereich ? `kein freies Ticket im Bereich ${BEREICHE[bereich]}` : "kein freies Ticket";
  const kopf = ticket ? `#${ticket.nr}\t${ticket.titel}` : keins;
  const hinweis = ticket?.spezifikation ? [`hinweis #${ticket.nr}: Spezifikation unvollständig (Bestand, nur berichtet): ${ticket.spezifikation.fehlt.join("; ")}`] : [];
  const info = quote ? [`Seite ${SEITENNAME[quote.seite]}: ${quote.grund}${quote.rueckfall ? " (Rückfall)" : ""}`] : [];
  return [kopf, ...info, ...hinweise.map((h) => `hinweis ${h}`), ...hinweis, ...reparierenZeilen(uebersprungen), ...uebersprungen.map((u) => `übersprungen #${u.nr}: ${u.grund}`)].join("\n") + "\n";
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
        ? { ...waehleUeberBoards({ ...io.lade(), ladeQuote: io.ladeQuote, owner: io.owner, bereich: b.bereich, hartAb: io.hartAb }), ...(b.bereich ? { bereich: b.bereich } : {}) }
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

const ladeEcht = () => ({
  produkt: normalizeItems(loadItemPages(boardFuerRolle("produkt"))),
  factory: normalizeItems(loadItemPages(boardFuerRolle("factory"))),
  ...ladeBelegung(),
});

/**
 * Die Quote-Eingabe (nur bei Bedarf): eine Commit-Seite von main (100 Commits, neueste zuerst) und die Nummern der geschlossenen `area:harness`-Issues
 * ab dem ältesten dieser Commits (minus 1 Tag). Jeder Lade- oder Formfehler wirft (Exit 2), nie eine stille Seite.
 */
export function ladeQuoteEcht(lade = ghJson) {
  const commits = lade(["api", `repos/${REPO}/commits?sha=main&per_page=100`]);
  if (!Array.isArray(commits) || commits.length === 0) throw new Error("Spielquote: keine Commits von main geladen");
  const datum = (c) => Date.parse(c?.commit?.committer?.date ?? c?.commit?.author?.date ?? "");
  const aelteste = Math.min(...commits.map(datum));
  if (!Number.isFinite(aelteste)) throw new Error("Spielquote: Commits ohne gültiges Datum");
  const seit = new Date(aelteste - 24 * 60 * 60 * 1000).toISOString();
  const seiten = lade(["api", "--paginate", "--slurp", `repos/${REPO}/issues?state=closed&labels=${FACTORY_LABEL}&since=${seit}&per_page=100`]);
  if (!Array.isArray(seiten)) throw new Error("Spielquote: unerwartete Antwortform der geschlossenen Harness-Issues");
  return { commits, harnessIssues: new Set(seiten.flat().filter((i) => !i.pull_request).map((i) => i.number)) };
}

/** Einzelweg (`--ticket`): das eine Issue per REST, keine Board-Seiten. */
const ladeEinzelnEcht = (nr) => ({ item: itemAusIssue(ghJson(["api", `repos/${REPO}/issues/${nr}`])), ...ladeBelegung() });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mitKontingent("naechstes-ticket", { arten: ["core"] }); // nur REST, ein knappes GraphQL-Kontingent sperrt den Einstieg nicht
  const io = { lade: ladeEcht, ladeQuote: () => ladeQuoteEcht(), ladeEinzeln: ladeEinzelnEcht, owner: REPO.split("/")[0], hartAb: ladeProjektConfig().spezifikation?.hartAb };
  const { code, out, err } = fuehreAus(process.argv.slice(2), io);
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
