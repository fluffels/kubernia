#!/usr/bin/env node
/**
 * Code-Scanning-Inbox (#1436): macht neue offene Code-Scanning-Alerts (CodeQL, Scorecard) zu Board-Arbeit.
 *  (a) Spitze: CodeQL-Alerts mit security-severity high/critical (ohne Stufe: severity error) → EIN Ticket
 *      `🔒 Security: Code-Scanning-Befunde auflösen` ganz oben im Board (`board-place.mjs --notfall security --top`); Dedupe über den Titel,
 *      automatisch geschlossen bei null Funden. Nur CodeQL kann die Spitze nehmen: Scorecard meldet Posture-Funde mit `error`/`high`,
 *      die sie dauerhaft belegen würden.
 *  (b) Alles andere: eine Zeile `- [ ] Code-Scanning: …` je (Tool, Regel) als Kommentar im jüngsten ungeclaimten Harness-Sammelticket.
 * Bekannt (also still) ist ein Alert, wenn seine Nummer in einer offenen Zeile eines Harness-Sammeltickets (nur vertraute Autoren) steht
 * oder seine Regel als `codescanning-<slug>` in `.github/wiedervorlagen.json` steht (nur für Zeilen-Alerts; ein Spitzen-Alert bleibt nur still, wenn
 * seine Nummer im Feld `alerts` des Eintrags steht). Ein Alert mit GHSA-IDs im Meldungstext (VulnerabilitiesID) ist bekannt, wenn jede ID schon als
 * Audit-Zeile, `audit-ghsa-<id>` oder Security-Ticket eingeordnet ist. Außerdem deckt ein OFFENES Issue eines vertrauten Autors einen Alert ab
 * (nicht Spitzen-Ticket, nicht Sammeltickets), wenn sein Body `Code-Scanning-Alert N` (bzw. `Code-Scanning-Alerts N, M`; ein
 * bloßes `Alert N` anderer Werkzeuge zählt nicht) nennt oder die Regel-ID (Wortgrenze) samt Verzeichnis des Alert-Pfads;
 * der Lauf loggt die Abdeckung, nach dem Schließen taucht der Alert wieder auf.
 * Nachfolger: ein Spitzen-Alert, der einem vertraut geschlossenen (dismissed) Alert entspricht (gleiches Tool, gleiche Regel, gleicher Pfad,
 * gleicher Meldungstext, wortgleiche markierte Codezeilen im jeweiligen Commit), wird nur eine Zeile mit Vorschlag statt Spitzen-Ticket: CodeQL
 * vergibt nach einer Änderung der Folgezeilen einen neuen Fingerprint. Unlesbare Vorgänger oder Datei: der Alert bleibt Spitze.
 * Bekannte Grenze: Regel+Verzeichnis hält auch einen NEUEN Alert derselben Regel im selben Verzeichnis still, solange das deckende Issue offen ist.
 *
 * Aufruf: node scripts/codescanning-inbox.mjs [--dry-run]   (Workflow: .github/workflows/codescanning-inbox.yml)
 * Die Funktionen oben sind pur und getestet (test/codescanning-inbox.test.ts); die Aufrufe von gh unten nicht.
 */
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { readFileSync } from "node:fs";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { ladeBoardLibs, inboxStart } from "./inbox-start-lib.mjs";
import { escapeRegex } from "./ticket-namen.mjs";
import { istVertraut } from "./fremdtext-lib.mjs";
import { bekannteGhsa, ghsaIn, vertrauteBodies } from "./ghsa-lib.mjs";
import { labelAus } from "./projekt-config-lib.mjs";

export const ZIEL_TITEL = "🔒 Security: Code-Scanning-Befunde auflösen";
const SPITZEN_TOOLS = ["CodeQL"];
const WV_PRAEFIX = "codescanning-";
const WIEDERVORLAGEN = fileURLToPath(new URL("../.github/wiedervorlagen.json", import.meta.url));
const STUFEN_SPITZE = ["high", "critical"];

/** Kleinschreibung, alles außer a-z0-9 wird `-`, Ränder getrimmt (Form der Wiedervorlagen-ID). Pur. */
export const slug = (regel) =>
  String(regel ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Offene Alerts aus der REST-Liste `code-scanning/alerts`, normalisiert zu `{ nummer, tool, regel, stufe, schwere, state }`. Andere Zustände
 * (fixed, dismissed) fallen weg. Kein Array oder eine Nummer ohne Ganzzahl wirft (nie still „keine Funde“). Die Regel-ID wird auf
 * `[A-Za-z0-9/_.-]` geprüft, sonst `unbekannt` (sie landet in Ticket und Zeile). Pur.
 */
export function alertsAus(liste) {
  return alertListeAus(liste).filter((a) => a.state === "open");
}

/** Zeilenbereich `{ von, bis }` (1-basiert) der markierten Stelle oder null, wenn er fehlt oder unbrauchbar ist. Pur. */
function ortAus(loc) {
  const von = loc?.start_line;
  const bis = loc?.end_line ?? von;
  return Number.isInteger(von) && Number.isInteger(bis) && von >= 1 && bis >= von ? { von, bis } : null;
}

/** Normalisiert die Roh-Liste (jeder Zustand); wirft bei Nicht-Liste oder Nummer ohne Ganzzahl. Pur. */
function alertListeAus(liste) {
  if (!Array.isArray(liste)) throw new Error("Unerwartete Code-Scanning-Antwort (keine Liste).");
  return liste.map((a) => {
    if (!Number.isInteger(a?.number)) throw new Error(`Unerwartete Form eines Alerts: ${JSON.stringify(a)?.slice(0, 120)}`);
    const id = String(a?.rule?.id ?? "");
    const stufe = a?.rule?.security_severity_level;
    const inst = a?.most_recent_instance;
    return {
      nummer: a.number,
      tool: String(a?.tool?.name ?? "unbekannt"),
      regel: /^[A-Za-z0-9/_.-]+$/.test(id) ? id : "unbekannt",
      stufe: typeof stufe === "string" && stufe !== "" ? stufe.toLowerCase() : null,
      schwere: String(a?.rule?.severity ?? "").toLowerCase(),
      state: String(a?.state ?? ""),
      pfad: String(inst?.location?.path ?? ""),
      ghsa: ghsaIn(inst?.message?.text),
      meldung: String(inst?.message?.text ?? ""),
      ort: ortAus(inst?.location),
      commit: String(inst?.commit_sha ?? ""),
      geschlossenVon: a?.dismissed_by ?? null,
      grund: String(a?.dismissed_reason ?? ""),
    };
  });
}

/** Vorgänger-Kandidaten: nur dismissed Alerts, die ein VERTRAUTER Account (`istVertraut`) geschlossen hat. Pur. */
export function vorgaengerAus(liste, owner) {
  return alertListeAus(liste).filter((a) => a.state === "dismissed" && istVertraut(a.geschlossenVon, owner));
}

/** Die markierten Zeilen `ort` aus `text` (CRLF-fest, 1-basiert), getrimmt und mit Zeilenumbruch verbunden; ohne Ort oder außerhalb des Textes "". Pur. */
export function codeAusschnitt(text, ort) {
  if (typeof text !== "string" || !ort) return "";
  const zeilen = text.split(/\r?\n/);
  if (ort.von > zeilen.length) return "";
  return zeilen.slice(ort.von - 1, ort.bis).map((z) => z.trim()).join("\n").trim();
}

/**
 * Nachfolger-Erkennung: ein Spitzen-Alert, der einem vertraut geschlossenen Alert entspricht (gleiches Tool, gleiche Regel, gleicher Pfad,
 * gleicher Meldungstext und wortgleiche markierte Codezeilen, jeweils im Stand des eigenen Commits). CodeQL vergibt nach einer Änderung der
 * Folgezeilen einen neuen Fingerprint und damit einen neuen Alert. `lies(pfad, commit)` liefert den Dateitext oder null. Ergebnis:
 * Map Nummer → { vorgaenger: number[], grund }. Unlesbare Datei, leerer Ausschnitt oder fehlender Ort: kein Treffer (der Alert bleibt Spitze). Pur.
 */
export function nachfolgerJeAlert({ alerts, vorgaenger, lies }) {
  const karte = new Map();
  const ausschnitt = (a) => codeAusschnitt(lies(a.pfad, a.commit), a.ort);
  for (const a of alerts) {
    if (klasse(a) !== "spitze" || !a.ort || !a.commit || !a.meldung || a.regel === "unbekannt") continue;
    const kandidaten = vorgaenger
      .filter((v) => v.nummer !== a.nummer && v.tool === a.tool && v.regel === a.regel && v.pfad === a.pfad && v.meldung === a.meldung && v.ort && v.commit)
      .sort((x, y) => x.nummer - y.nummer);
    if (kandidaten.length === 0) continue;
    const eigen = ausschnitt(a);
    if (eigen === "") continue;
    const treffer = kandidaten.filter((v) => ausschnitt(v) === eigen);
    if (treffer.length > 0) karte.set(a.nummer, { vorgaenger: treffer.map((v) => v.nummer), grund: treffer[0].grund });
  }
  return karte;
}

/**
 * `spitze` nur für CodeQL mit security-severity high/critical (ohne Stufe: severity error); alles andere `zeile`. Funde in `test/` (nicht
 * ausgeliefert) bleiben sichtbar, werden aber nie Security-Ticket an der Board-Spitze. Pur.
 */
export function klasse(a) {
  if (!SPITZEN_TOOLS.includes(a.tool)) return "zeile";
  if (String(a.pfad ?? "").replace(/\\/g, "/").startsWith("test/")) return "zeile";
  if (a.stufe === null) return a.schwere === "error" ? "spitze" : "zeile";
  return STUFEN_SPITZE.includes(a.stufe) ? "spitze" : "zeile";
}

/** Alert-Nummern aus `Alerts 5, 6, 7` bzw. `Alert 5` (nie `#5`: GitHub verlinkt das als Issue). Pur. */
export function nummernIn(text) {
  const nummern = [];
  for (const m of String(text ?? "").matchAll(/\bAlerts?\s+(\d+(?:\s*,\s*\d+)*)/g)) nummern.push(...m[1].split(",").map((n) => Number(n.trim())));
  return nummern;
}

/** Alert-Nummern nur aus `Code-Scanning-Alert 5` bzw. `Code-Scanning-Alerts 5, 6` (Konvention deckender Issues; `Alert 5` anderer Werkzeuge zählt nicht). Pur. */
export function codeScanningNummernIn(text) {
  const nummern = [];
  for (const m of String(text ?? "").matchAll(/(?<![\w-])Code-Scanning-Alerts?\s+(\d+(?:\s*,\s*\d+)*)/g)) nummern.push(...m[1].split(",").map((n) => Number(n.trim())));
  return nummern;
}

/**
 * Bekannte Alerts: Nummern aus offenen Zeilen `- [ ] Code-Scanning:` in Kommentaren VERTRAUTER Autoren (`istVertraut`), Regeln (als Slug) aus
 * Wiedervorlagen-IDs `codescanning-<slug>`. `sammelTitel` (Pflicht, Liste): Titel der Sammeltickets (deckt kein Alert ab; der Aufrufer liefert sie aus
 * `board-lib`, das beim Import die Config liest). Pur.
 */
export function bekannteAlerts({ kommentare, owner, wiedervorlagen, offeneTitel = [], offeneIssues = [], sammelTitel }) {
  if (!Array.isArray(sammelTitel)) throw new TypeError("bekannteAlerts: sammelTitel muss eine Liste sein (kein stiller Default, sonst zählten Sammeltickets als deckend)");
  const nummern = new Set();
  const regeln = new Set();
  const alerts = new Set();
  for (const k of kommentare) {
    if (!istVertraut(k?.user ?? null, owner)) continue;
    for (const z of String(k?.body ?? "").split(/\r?\n/)) {
      if (/^\s*[-*]\s+\[ \]\s+Code-Scanning:/.test(z)) nummernIn(z).forEach((n) => nummern.add(n));
    }
  }
  for (const e of wiedervorlagen) {
    if (typeof e?.id !== "string" || !e.id.startsWith(WV_PRAEFIX)) continue;
    regeln.add(e.id.slice(WV_PRAEFIX.length));
    if (Array.isArray(e.alerts)) e.alerts.filter(Number.isInteger).forEach((n) => alerts.add(n));
  }
  const ghsa = bekannteGhsa({ kommentare: vertrauteBodies(kommentare, owner), wiedervorlagen, offeneTitel });
  const ausgenommen = new Set([ZIEL_TITEL, ...sammelTitel]);
  const issues = offeneIssues
    .filter((i) => i && !ausgenommen.has(i.title) && istVertraut(i.user ?? null, owner))
    .map((i) => ({ number: i.number, titel: String(i.title ?? ""), body: String(i.body ?? "") }));
  return { nummern, regeln, alerts, ghsa, issues };
}


/**
 * Das erste offene Issue (`issues` aus `bekannteAlerts`), das den Alert abdeckt: `{ number, grund }` oder null. Grund `nummer`: der Body nennt
 * `Code-Scanning-Alert N`; `regel+verzeichnis`: der Body nennt die Regel-ID (Wortgrenze) und `dirname(pfad)/` (ohne Verzeichnis im Pfad keine Abdeckung). Pur.
 */
export function deckendesIssue(alert, issues) {
  const dir = String(alert.pfad ?? "").replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  const regel = String(alert.regel ?? "");
  // "unbekannt" ist der Ersatzwert für eine unlesbare Regel-ID und darf nie über das bloße Wort im Body abdecken.
  const regelRe = regel && regel !== "unbekannt" ? new RegExp(String.raw`(?<![\w/.-])${escapeRegex(regel)}(?![\w/-])`) : null;
  const dirRe = dir ? new RegExp(String.raw`(?<![\w.-])${escapeRegex(dir)}/`) : null;
  for (const i of issues ?? []) {
    if (codeScanningNummernIn(i.body).includes(alert.nummer)) return { number: i.number, grund: "nummer" };
    if (regelRe && dirRe && regelRe.test(i.body) && dirRe.test(i.body)) return { number: i.number, grund: "regel+verzeichnis" };
  }
  return null;
}

const KOMMENTAR_LEER = "Keine offenen Code-Scanning-Befunde high/critical mehr, automatisch geschlossen.";
const KOMMENTAR_ABGEDECKT = (nummern) =>
  `Die offenen Code-Scanning-Befunde high/critical sind durch ${nummern.map((n) => `#${n}`).join(", ")} abgedeckt, automatisch geschlossen. Sie tauchen wieder auf, sobald das deckende Issue geschlossen ist und der Alert offen bleibt.`;

const alertListe = (g) => `Alerts ${g.nummern.join(", ")}`;
const KOMMENTAR_NACHFOLGER = (nummern) =>
  `Die offenen Code-Scanning-Befunde high/critical sind Nachfolger vertraut geschlossener Alerts (${nummern.map((n) => `Alert ${n}`).join(", ")}) und stehen als Zeile im Sammelticket, automatisch geschlossen.`;

/** Die Zeile für das Sammelticket. Pur. */
export const zeilenText = (g) => {
  const kopf = `- [ ] Code-Scanning: ${g.tool} ${g.regel} (${g.stufe ?? g.schwere}), ${alertListe(g)}.`;
  // "Nr." statt "Alert": `nummernIn` soll die Nummer des Vorgängers nicht als bekannten Alert einlesen.
  if (g.vorgaenger?.length > 0)
    return `${kopf} Vorschlag: Nachfolger von Vorgänger Nr. ${g.vorgaenger.join(", ")} (gleiche Regel, Datei, Meldung und Codezeile; geschlossen als ${g.grund || "unbekannt"}), Schließung mit demselben Grund übernehmen`;
  return `${kopf} Vorschlag: beheben, sonst mit Grund dismissen oder Wiedervorlage ${WV_PRAEFIX}${slug(g.regel)}`;
};

/** Body des Spitzen-Tickets: je Regel eine Zeile, Prüfauftrag, keine Pfade und keine Meldungstexte aus dem Alert. `repo` = `owner/name`. Pur. */
export function issueBody(gruppen, repo = "<owner>/<repo>") {
  const zeilen = gruppen.map((g) => `- ${g.tool} ${g.regel} (${g.stufe ?? g.schwere}): ${alertListe(g)}`);
  return [
    "Offene CodeQL-Alerts mit security-severity high/critical:",
    "",
    ...zeilen,
    "",
    `Prüfauftrag: je Regel beheben, mit Grund dismissen oder per Wiedervorlage \`codescanning-<slug>\` zurückstellen. Details: \`gh api repos/${repo}/code-scanning/alerts/<nummer>\`. Dismiss: \`gh api -X PATCH repos/${repo}/code-scanning/alerts/<nummer> -f state=dismissed -f dismissed_reason="won't fix" -f dismissed_comment="<Grund, Ticket>"\` (Gründe: \`won't fix\`, \`false positive\`, \`used in tests\`). Die Liste wird wöchentlich aktualisiert; bei null Funden schließt der Lauf dieses Ticket selbst. Mechanik: docs/ticket-reihenfolge.md › Code-Scanning-Inbox.`,
  ].join("\n");
}

/** Gruppiert Alerts nach (Tool, Regel), sortiert (Tool, Regel, Nummern). Pur. */
function gruppiere(alerts, nachfolger = null) {
  const karte = new Map();
  for (const a of [...alerts].sort((x, y) => x.nummer - y.nummer)) {
    const key = `${a.tool}\u0000${a.regel}`;
    const g = karte.get(key) ?? { tool: a.tool, regel: a.regel, stufe: a.stufe, schwere: a.schwere, nummern: [] };
    g.nummern.push(a.nummer);
    const n = nachfolger?.get(a.nummer);
    if (n) {
      g.vorgaenger = [...new Set([...(g.vorgaenger ?? []), ...n.vorgaenger])].sort((x, y) => x - y);
      g.grund = [...new Set([...(g.grund ? g.grund.split(" / ") : []), n.grund])].join(" / ");
    }
    karte.set(key, g);
  }
  return [...karte.values()].sort((x, y) => x.tool.localeCompare(y.tool) || x.regel.localeCompare(y.regel));
}

/**
 * Plan eines Laufs: `{ issue, zeilen }`. Spitze = offene `spitze`-Alerts, deren Nummer nicht in `bekannt.alerts` steht (eine regelweite
 * Wiedervorlage deckt sie nicht); leer: Issue schließen (falls offen),
 * sonst anlegen bzw. mit geändertem Body aktualisieren (`neue` = Nummern, die der alte Body noch nicht nannte). Zeilen = `zeile`-Alerts ohne
 * bekannte Nummer, ohne bekannte Regel und ohne vollständig bekannte GHSA-IDs, je (Tool, Regel) eine. Pur, deterministisch.
 */
export function plane({ alerts, bekannt, offenesIssue, repo, nachfolger = new Map() }) {
  const abgedeckt = [];
  const deckt = (a) => {
    const d = deckendesIssue(a, bekannt.issues);
    if (d) abgedeckt.push({ nummer: a.nummer, issue: d.number, grund: d.grund });
    return d !== null;
  };
  const ghsaBekannt = (a) => a.ghsa?.length > 0 && a.ghsa.every((g) => bekannt.ghsa?.has(g));
  const stumm = (a) => bekannt.nummern.has(a.nummer) || bekannt.regeln.has(slug(a.regel)) || ghsaBekannt(a);
  const kandidaten = alerts.filter((a) => klasse(a) === "spitze" && !bekannt.alerts?.has(a.nummer) && !deckt(a));
  const folger = kandidaten.filter((a) => nachfolger.has(a.nummer));
  const spitze = gruppiere(kandidaten.filter((a) => !nachfolger.has(a.nummer)));
  // Ein Nachfolger wird nur still, wenn seine Nummer schon in einer offenen Zeile steht (K4); die regelweite Wiedervorlage deckt keine Spitze.
  const folgerZeilen = gruppiere(folger.filter((a) => !bekannt.nummern.has(a.nummer)), nachfolger);
  const zeilen = [...gruppiere(alerts.filter((a) => klasse(a) === "zeile" && !stumm(a) && !bekannt.alerts?.has(a.nummer) && !deckt(a))), ...folgerZeilen];
  const nachfolgerLog = folger.map((a) => ({ nummer: a.nummer, vorgaenger: nachfolger.get(a.nummer).vorgaenger }));
  if (spitze.length === 0) {
    const durch = [...new Set(abgedeckt.map((x) => x.issue))].sort((x, y) => x - y);
    const schliessen = {
      art: "schliessen",
      nummer: offenesIssue?.number,
      ...(durch.length > 0 ? { abgedecktDurch: durch } : {}),
      ...(folger.length > 0 ? { nachfolger: folger.map((a) => a.nummer) } : {}),
    };
    return { issue: offenesIssue ? schliessen : { art: "nichts" }, zeilen, abgedeckt, nachfolger: nachfolgerLog };
  }
  const body = issueBody(spitze, repo);
  if (!offenesIssue) return { issue: { art: "anlegen", body }, zeilen, abgedeckt, nachfolger: nachfolgerLog };
  if (body === String(offenesIssue.body ?? "").replace(/\r\n/g, "\n")) return { issue: { art: "nichts" }, zeilen, abgedeckt, nachfolger: nachfolgerLog };
  const alt = new Set(nummernIn(offenesIssue.body));
  const neue = spitze.flatMap((g) => g.nummern).filter((n) => !alt.has(n)).sort((a, b) => a - b);
  return { issue: { art: "aktualisieren", nummer: offenesIssue.number, body, neue }, zeilen, abgedeckt, nachfolger: nachfolgerLog };
}

/** Kommentar beim Schließen: leer, durch deckende Issues, durch Nachfolger (oder beides). Pur. */
function schliessKommentar(issue) {
  const teile = [];
  if (issue.abgedecktDurch) teile.push(KOMMENTAR_ABGEDECKT(issue.abgedecktDurch));
  if (issue.nachfolger) teile.push(KOMMENTAR_NACHFOLGER(issue.nachfolger));
  return teile.length > 0 ? teile.join(" ") : KOMMENTAR_LEER;
}

/**
 * Führt einen Plan mit eingespeister IO aus (`legeIssueAn(titel, body) -> Nummer`, `sortiereEin(nr) -> bool`, `aktualisiere(nr, body)`,
 * `kommentiere(nr, text)`, `schliesse(nr)`, `zielSammelticket() -> Nummer|null`, `postZeilen(nr, text)`, `log`, `projectToken`). Exit-Code:
 * 1 bei fehlgeschlagenem Einsortieren, fehlendem Sammelticket oder einer geworfenen Aktion; ohne `PROJECT_TOKEN` nur eine Warnung. Trockenlauf schreibt nichts.
 */
export function fuehreAus({ plan, io, trocken = false }) {
  const { issue, zeilen } = plan;
  const log = io.log ?? console.log;
  if (trocken) {
    if (issue.art !== "nichts") log(`[dry-run] Ticket: ${issue.art}${issue.nummer ? ` #${issue.nummer}` : ""}`);
    if (issue.body) log(`[dry-run] ${issue.body}`);
    for (const g of zeilen) log(`[dry-run] ${zeilenText(g)}`);
    return 0;
  }
  let rot = false;
  try {
    if (issue.art === "anlegen") {
      const nr = io.legeIssueAn(ZIEL_TITEL, issue.body);
      log(`Ticket angelegt: #${nr}`);
      if (!io.projectToken) log("::warning::PROJECT_TOKEN fehlt: das Ticket steht nicht oben im Board.");
      else if (!io.sortiereEin(nr)) {
        log(`::error::Einsortieren von #${nr} an die Board-Spitze fehlgeschlagen.`);
        rot = true;
      }
    } else if (issue.art === "aktualisieren") {
      io.aktualisiere(issue.nummer, issue.body);
      if (issue.neue.length > 0) io.kommentiere(issue.nummer, `Neu seit dem letzten Lauf: Alerts ${issue.neue.join(", ")}`);
      log(`Ticket #${issue.nummer} aktualisiert.`);
    } else if (issue.art === "schliessen") {
      io.schliesse(issue.nummer, schliessKommentar(issue));
      log(`Ticket #${issue.nummer} geschlossen.`);
    }
  } catch (err) {
    log(`::error::Spitzen-Ticket unvollständig: ${fehlerText(err)}`);
    rot = true;
  }
  if (zeilen.length > 0) {
    try {
      const ziel = io.zielSammelticket();
      if (!ziel) {
        log("::error::Kein ungeclaimtes Harness-Sammelticket für die Code-Scanning-Zeilen.");
        rot = true;
      } else {
        io.postZeilen(ziel, zeilen.map(zeilenText).join("\n"));
        log(`${zeilen.length} Zeile(n) in #${ziel}.`);
      }
    } catch (err) {
      log(`::error::Zeilen nicht gepostet: ${fehlerText(err)}`);
      rot = true;
    }
  }
  return rot ? 1 : 0;
}

/** Gruppiert `abgedeckt` nach deckendem Issue: Map Issue → { nummern, gruende }. Pur. */
function abgedecktJeIssue(abgedeckt) {
  const karte = new Map();
  for (const a of [...abgedeckt].sort((x, y) => x.issue - y.issue || x.nummer - y.nummer)) {
    const e = karte.get(a.issue) ?? { nummern: [], gruende: [] };
    e.nummern.push(a.nummer);
    if (!e.gruende.includes(a.grund)) e.gruende.push(a.grund);
    karte.set(a.issue, e);
  }
  return karte;
}

/**
 * Nachfolger-Map für die Spitzen-Kandidaten. Lädt die Vorgänger-Liste nur, wenn es einen Spitzen-Alert gibt und `io.ladeVorgaenger` existiert.
 * Ein Fehler beim Laden ist KEIN Abbruch: Warnung und leere Map, die Alerts bleiben Spitze (laut statt still).
 */
function ladeNachfolger({ alerts, io, owner, log }) {
  if (!io.ladeVorgaenger || !alerts.some((a) => klasse(a) === "spitze")) return new Map();
  try {
    return nachfolgerJeAlert({ alerts, vorgaenger: vorgaengerAus(io.ladeVorgaenger(), owner), lies: io.ladeDatei ?? (() => null) });
  } catch (err) {
    log(`::warning::Vorgänger-Alerts nicht lesbar, Alerts bleiben Spitze: ${fehlerText(err)}`);
    return new Map();
  }
}

/** Ein Lauf: lädt über `io.ladeAlerts()`/`io.ladeKontext()`, plant, führt aus. Nicht lesbare Alerts sind rot und schließen nie ein Ticket (fail-closed). */
export function lauf({ io, trocken = false }) {
  const log = io.log ?? console.log;
  let plan;
  try {
    const alerts = alertsAus(io.ladeAlerts());
    const k = io.ladeKontext();
    const nachfolger = ladeNachfolger({ alerts, io, owner: k.owner, log });
    plan = plane({ alerts, bekannt: bekannteAlerts(k), offenesIssue: k.offenesIssue, repo: io.repo, nachfolger });
    for (const n of plan.nachfolger) log(`Code-Scanning-Inbox: Alert ${n.nummer} ist Nachfolger von Nr. ${n.vorgaenger.join(", ")}`);
    for (const [issue, liste] of abgedecktJeIssue(plan.abgedeckt)) log(`Code-Scanning-Inbox: Alerts ${liste.nummern.join(", ")} abgedeckt durch #${issue} (${liste.gruende.join(", ")})`);
  } catch (err) {
    log(`::error::Code-Scanning-Alerts nicht lesbar: ${fehlerText(err)}`);
    return 1;
  }
  const code = fuehreAus({ plan, io, trocken });
  if (plan.issue.art === "nichts" && plan.zeilen.length === 0 && plan.abgedeckt.length === 0 && plan.nachfolger.length === 0) log("Code-Scanning-Inbox: nichts Neues.");
  return code;
}

/**
 * Der Kontext für `bekannteAlerts` aus den geladenen Libs und Rohdaten. Pur; `libs` liefert `SAMMELTICKET_TITEL_LISTE`, `vertrauteIssues`, `offeneTitel`.
 * Eine fehlende Sammeltitel-Liste ist ein Fehler, nie ein leerer Default.
 */
export function kontextAus({ libs, rohe, kommentare, owner, offenesIssue, wiedervorlagen }) {
  return {
    offenesIssue,
    kommentare,
    owner,
    sammelTitel: libs.SAMMELTICKET_TITEL_LISTE,
    offeneIssues: libs.vertrauteIssues(rohe, owner),
    offeneTitel: libs.offeneTitel(rohe, owner),
    wiedervorlagen,
  };
}

// ---- IO (ungetestet) ----

const seiten = (pfad) => JSON.parse(ghText(["api", "--paginate", "--slurp", pfad])).flat();

/** Dateitext `pfad` im Stand `commit` über die Contents-API (roh); jeder Fehler ergibt null (kein Treffer, der Alert bleibt Spitze). */
function dateiAusGh(repo, pfad, commit) {
  try {
    const segmente = pfad.split("/").map(encodeURIComponent).join("/");
    return ghText(["api", "-H", "Accept: application/vnd.github.raw+json", `repos/${repo}/contents/${segmente}?ref=${encodeURIComponent(commit)}`]);
  } catch {
    return null;
  }
}

/** Merkt sich je (Pfad, Commit) den Dateitext, damit ein Lauf jede Datei höchstens einmal lädt. */
function gemerkt(lade) {
  const speicher = new Map();
  return (pfad, commit) => {
    const key = `${commit}:${pfad}`;
    if (!speicher.has(key)) speicher.set(key, lade(pfad, commit));
    return speicher.get(key);
  };
}

/** Einstieg. `deps` (Tests): `ladeConfig()`, `ladeLibs()` (liefert `REPO`, `SAMMELTICKET_TITEL_LISTE` und die Inbox-Bausteine), `ladeSeiten(pfad)`, `ladeDatei(pfad, commit)`, `log`, `err`. Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), { ladeLibs = ladeBoardLibs, ladeConfig, ladeSeiten = seiten, ladeDatei, log = console.log, err = console.error } = {}) {
  const start = await inboxStart(argv, { skript: "codescanning-inbox", praefix: "Code-Scanning-Inbox: Projekt-Config nicht lesbar: ", ladeLibs, ladeConfig, log, err });
  if (start.code !== undefined) return start.code;
  const { trocken, config, libs } = start;
  const harnessLabel = labelAus(config, "harness");
  const { OWNER, REPO, platziereOben, postZeilen, ladeSammelKontext, vertrauteIssues, waehleSammelticket } = libs;
  let offene = [];
  const io = {
    repo: REPO,
    ladeAlerts: () => ladeSeiten(`repos/${REPO}/code-scanning/alerts?state=open&per_page=100`),
    ladeVorgaenger: () => ladeSeiten(`repos/${REPO}/code-scanning/alerts?state=dismissed&per_page=100`),
    ladeDatei: gemerkt(ladeDatei ?? ((pfad, commit) => dateiAusGh(REPO, pfad, commit))),
    ladeKontext: () => {
      const kontext = ladeSammelKontext();
      const { rohe, kommentare } = kontext;
      offene = kontext.offene;
      const vertraut = new Set(vertrauteIssues(rohe, OWNER).map((i) => i.number));
      // Das Spitzen-Ticket legt github-actions[bot] an (GH_TOKEN = github.token); ein gleichnamiges Ticket eines Fremden zählt nicht.
      const ziele = offene.filter((i) => i.titel === ZIEL_TITEL && vertraut.has(i.number)).sort((a, b) => a.number - b.number);
      if (ziele.length > 1) log(`::warning::Mehrere offene Tickets "${ZIEL_TITEL}" (${ziele.map((z) => `#${z.number}`).join(", ")}); nehme das kleinste.`);
      const offenesIssue = ziele[0] ? { number: ziele[0].number, body: String(ghJson(["api", `repos/${REPO}/issues/${ziele[0].number}`]).body ?? "") } : null;
      return kontextAus({ libs, rohe, kommentare, owner: OWNER, offenesIssue, wiedervorlagen: JSON.parse(readFileSync(WIEDERVORLAGEN, "utf8")) });
    },
    projectToken: process.env.PROJECT_TOKEN,
    log,
    legeIssueAn: (titel, body) => ghText(["issue", "create", "--repo", REPO, "--title", titel, "--label", harnessLabel, "--body", body]).trim().split("/").pop(),
    sortiereEin: (nr) => {
      try {
        platziereOben(nr, "security", process.env.PROJECT_TOKEN);
        return true;
      } catch {
        return false;
      }
    },
    aktualisiere: (nr, body) => ghText(["api", "-X", "PATCH", `repos/${REPO}/issues/${nr}`, "-f", `body=${body}`]),
    kommentiere: postZeilen,
    schliesse: (nr, kommentar = KOMMENTAR_LEER) => ghText(["issue", "close", String(nr), "--repo", REPO, "--reason", "completed", "--comment", kommentar]),
    zielSammelticket: () => waehleSammelticket(offene)?.number ?? null,
    postZeilen,
  };
  return lauf({ io, trocken });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
