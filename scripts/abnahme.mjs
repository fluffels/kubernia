#!/usr/bin/env node
/**
 * Holdout-Abnahme, Auswertung (ADR 0022 F13): ein Abnahme-Agent (`holdout-abnahme`) prüft das Ergebnis eines Tickets gegen dessen
 * Akzeptanzkriterien und schreibt je Kriterium ein Urteil in einen Bericht. Dieses Skript nummeriert die Kriterien, prüft den Bericht,
 * schreibt die Spur als PR-Kommentar und entscheidet über bestanden, Fix-Runde oder Hand-off. Format der Zeile und der Marker: slice-override.mjs
 * (`formatAbnahme`, `formatAbnahmeMarker`), Beschreibung: docs/agent-harness.md §3a.
 *
 *   node scripts/abnahme.mjs kriterien <nr>
 *   node scripts/abnahme.mjs auswerten <nr> --pr <pr> --bericht <datei> --worktree <pfad> --head <sha>
 *
 * Bericht: erste nicht leere Zeile `ABNAHME #<nr> · holdout-abnahme`, dann je Kriterium `K<i>: erfuellt|nicht-erfuellt|nicht-pruefbar — <Beleg>`
 * (Beleg Pflicht; andere Zeilen werden ignoriert, Szenarien gehören nicht in den Kommentar). Ausgabe `ENTSCHEIDUNG: bestanden|fix|handoff`
 * (Vorrang handoff > fix > bestanden): bestanden mit der fertigen Abnahme-Zeile, fix mit den Belegen der nicht erfüllten Kriterien,
 * handoff mit den Gründen (ein Ticket-Kommentar mit dem Hand-off-Marker, genau einer je Aufruf).
 *
 * Exit 0 = ausgewertet (Entscheidung auf stdout) bzw. Kriterienliste, 1 = Bericht oder Worktree ungültig (nichts gepostet), 2 = Aufruf- oder
 * gh-Fehler, 3 = Fremdeingang (Autor nicht vertraut oder Fremdeingang-Label: nichts wird ausgewertet).
 * Grenze: Exit 3 heißt hier immer Fremdeingang; ein knappes API-Kontingent meldet `mitKontingent` mit Exit 5.
 * Grenze: scheitert nach dem PR-Kommentar der Hand-off-Kommentar, ist der PR-Kommentar gepostet; ein Neuversuch zählt als weiterer Durchgang (fail-closed).
 * Grenze: der Bericht ist Selbstauskunft des Abnahme-Agenten; das Skript prüft Form, Vollständigkeit und Worktree, nicht die Wahrheit der Belege.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { REPO } from "./board-lib.mjs";
import { istFremdeingang, istVertraut, issueKommentare } from "./fremdtext-lib.mjs";
import { fehlerText, ghJson } from "./gh-cli.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import { abnahmeMarker, formatAbnahme, formatAbnahmeMarker, ladeCommitZeilen, normalisiereLens, parseAbnahmeMarker, URTEILSWERTE } from "./slice-override.mjs";
import { kriterien } from "./spezifikation-lib.mjs";

/** Name des Abnahme-Agenten im Berichtskopf. */
export const ABNAHME_AGENT = "holdout-abnahme";

const AUFRUF = [
  "Aufruf:",
  "  node scripts/abnahme.mjs kriterien <nr>",
  "  node scripts/abnahme.mjs auswerten <nr> --pr <pr> --bericht <datei> --worktree <pfad> --head <sha>",
].join("\n");

const ergebnis = (code, out = "", err = "") => ({ code, out, err });
const aufrufFehler = (text) => ergebnis(2, "", `✖ abnahme: ${text}\n`);
const berichtFehler = (fehler) => ergebnis(1, "", `✖ abnahme: Bericht ungültig, nichts gepostet:\n${fehler.map((f) => `  - ${f}`).join("\n")}\n`);
const positiveZahl = (t) => (/^\d+$/.test(String(t ?? "")) && Number(t) > 0 ? Number(t) : null);

const KOPF = new RegExp(`^ABNAHME\\s+#(\\d+)\\s*·\\s*${ABNAHME_AGENT}\\s*$`);
const URTEILSZEILE = /^\s*(?:[-*]\s+)?K(\d+):\s*(.+?)\s+[—–-]\s+(\S.*)$/;
const KANDIDAT = /^\s*(?:[-*]\s+)?K\d+:/;

/**
 * Prüft den Bericht gegen die Kriterien `[{k, text}]`: `{urteile:[{k, wert, beleg}]}` (in der Reihenfolge der Kriterien) oder `{fehler:[…]}`.
 * Kopf streng (Nummer und Agentenname), Werte tolerant (Groß-/Kleinschreibung, Umlaute), Beleg Pflicht; ein Kriterium fehlt, ist doppelt
 * oder unbekannt → Fehler. Pur.
 */
export function parseBericht(text, nr, kriterienListe) {
  const fehler = [];
  const zeilen = String(text ?? "").replace(/\r/g, "").split("\n");
  const kopf = zeilen.find((z) => z.trim() !== "");
  const km = kopf === undefined ? null : KOPF.exec(kopf.trim());
  if (!km || Number(km[1]) !== nr) fehler.push(`Kopf fehlt oder falsch (erwartet: ABNAHME #${nr} · ${ABNAHME_AGENT})`);
  const bekannt = new Set(kriterienListe.map((c) => c.k));
  const gefunden = new Map();
  for (const zeile of zeilen) {
    if (!KANDIDAT.test(zeile)) continue;
    const m = URTEILSZEILE.exec(zeile);
    const k = `K${/K(\d+):/.exec(zeile)[1]}`;
    if (!m) {
      fehler.push(`${k}: Zeile ohne Beleg oder ohne Urteil („K<i>: <urteil> — <Beleg>“)`);
      continue;
    }
    const wert = normalisiereLens(m[2]);
    if (!bekannt.has(k)) fehler.push(`${k}: unbekanntes Kriterium`);
    else if (!URTEILSWERTE.includes(wert)) fehler.push(`${k}: unbekanntes Urteil „${m[2]}“ (${URTEILSWERTE.join(" | ")})`);
    else if (gefunden.has(k)) fehler.push(`${k}: doppelt`);
    else gefunden.set(k, { k, wert, beleg: m[3].trim() });
  }
  for (const { k } of kriterienListe) if (!gefunden.has(k) && !fehler.some((f) => f.startsWith(`${k}:`))) fehler.push(`${k}: fehlt im Bericht`);
  if (fehler.length > 0) return { fehler };
  return { urteile: kriterienListe.map(({ k }) => gefunden.get(k)) };
}

/** Vorrang handoff > fix > bestanden. Pur. */
export function entscheide(urteile) {
  if (urteile.some((u) => u.wert === "nicht-pruefbar")) return "handoff";
  if (urteile.some((u) => u.wert === "nicht-erfuellt")) return "fix";
  return "bestanden";
}

/** Durchgang dieses Laufs: gültige Marker vertrauter Autoren auf dem PR plus 1; Marker Fremder und der Hand-off-Marker zählen nicht. Pur. */
export function zaehleDurchgang(kommentare, owner, zeilen) {
  const n = (kommentare ?? []).filter((c) => istVertraut(c?.user, owner) && parseAbnahmeMarker(zeilen, c?.body) !== null).length;
  return n + 1;
}

const zelle = (t) => String(t).replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ");
const kurz = (t) => {
  const z = String(t).split("\n")[0];
  return z.length > 100 ? `${z.slice(0, 100)}…` : z;
};

/** PR-Kommentar: Marker, Tabelle Kriterium, Urteil, Beleg (keine anderen Berichtszeilen, keine Szenarien). Pur. */
export function prKommentar({ zeilen, nr, durchgang, head, urteile, kriterienListe }) {
  const marker = formatAbnahmeMarker(zeilen, { durchgang, head, urteil: urteile.map(({ k, wert }) => ({ k, wert })) });
  const text = new Map(kriterienListe.map((c) => [c.k, c.text]));
  const zeilenTabelle = urteile.map((u) => `| ${zelle(`${u.k}: ${kurz(text.get(u.k) ?? "")}`)} | ${u.wert} | ${zelle(u.beleg)} |`);
  return [marker, `### Holdout-Abnahme #${nr}, Durchgang ${durchgang}`, "", `Stand \`${head.slice(0, 7)}\``, "", "| Kriterium | Urteil | Beleg |", "| --- | --- | --- |", ...zeilenTabelle, ""].join("\n");
}

/** Ticket-Kommentar bei `nicht-pruefbar`: Hand-off-Marker, alle nicht prüfbaren Kriterien mit Text und Grund. Pur. */
export function handoffKommentar({ zeilen, nr, urteile, kriterienListe }) {
  const text = new Map(kriterienListe.map((c) => [c.k, c.text]));
  const punkte = urteile.filter((u) => u.wert === "nicht-pruefbar").map((u) => `- **${u.k}** ${zelle(kurz(text.get(u.k) ?? ""))}\n  Grund: ${zelle(u.beleg)}`);
  return [
    `<!-- ${abnahmeMarker(zeilen)}-handoff -->`,
    `### Holdout-Abnahme #${nr}: Kriterium nicht prüfbar`,
    "",
    ...punkte,
    "",
    "Das Kriterium im Ticket präzisieren (Entscheidung der Maintainerin). Der Reparaturweg `node scripts/spezifikation.mjs reparieren <nr> --body-datei <pfad>` greift nur bei unvollständiger Spezifikation (nicht bei einem Ticket mit Assignee und nicht bei Umformulierungen).",
    "",
  ].join("\n");
}

/** Flags `--name wert`; alles andere ist positional. Pur. */
function parseArgs(argv) {
  const werte = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return { fehler: `${argv[i]} braucht einen Wert` };
      werte[argv[i].slice(2)] = v;
      i++;
    } else positional.push(argv[i]);
  }
  return { werte, positional };
}

/** Lädt das Issue und prüft die Vorbedingungen (kein PR, vertraut); `{issue}` oder `{ergebnis}`. */
function ladeTicket(nr, io) {
  let issue;
  try {
    issue = io.ladeIssue(nr);
  } catch (e) {
    return { ergebnis: aufrufFehler(`#${nr} nicht ladbar: ${fehlerText(e)}`) };
  }
  if (issue.pull_request) return { ergebnis: aufrufFehler(`#${nr} ist ein PR`) };
  const f = istFremdeingang(issue, io.owner);
  if (f.fremdeingang) return { ergebnis: ergebnis(3, "", `✖ abnahme: #${nr} ist ein Fremdeingang (${f.grund}): nichts wird ausgewertet\n`) };
  return { issue };
}

const einrueckung = (text) => text.split("\n").map((z, i) => (i === 0 ? z : `    ${z}`)).join("\n");

function zeigeKriterien(nr, io) {
  const t = ladeTicket(nr, io);
  if (t.ergebnis) return t.ergebnis;
  const liste = kriterien(t.issue.body);
  if (liste.length === 0) {
    const zeile = formatAbnahme(io.zeilen, { art: "entfaellt", grund: "Ticket ohne Akzeptanzkriterien" });
    return ergebnis(0, `Keine Akzeptanzkriterien im Ticket; die Abnahme entfällt. Zeile für den Nachweis-Commit:\n${zeile}\n`);
  }
  return ergebnis(0, `${liste.map((c) => `${c.k}: ${einrueckung(c.text)}`).join("\n")}\n`);
}

function pruefeWorktree(werte, io) {
  try {
    const status = io.git(werte.worktree, ["status", "--porcelain"]).trim();
    if (status !== "") return { fehler: `Worktree nach der Abnahme verändert (git status --porcelain nicht leer):\n${status.split("\n").slice(0, 10).map((z) => `  ${z}`).join("\n")}` };
    const head = io.git(werte.worktree, ["rev-parse", "HEAD"]).trim().toLowerCase();
    if (!head.startsWith(werte.head.toLowerCase())) return { fehler: `HEAD ${head.slice(0, 12)} weicht von --head ${werte.head} ab` };
    return { head };
  } catch (e) {
    return { fehler: `Worktree nicht prüfbar: ${fehlerText(e)}` };
  }
}

function ausgabe(entscheidung, urteile, kriterienListe, io, head, durchgang) {
  if (entscheidung === "bestanden") {
    const zeile = formatAbnahme(io.zeilen, { art: "urteil", head, durchgaenge: durchgang, urteil: urteile.map(({ k, wert }) => ({ k, wert })) });
    return `ENTSCHEIDUNG: bestanden\n${zeile}\n`;
  }
  if (entscheidung === "fix") {
    const zeilen = urteile.filter((u) => u.wert === "nicht-erfuellt").map((u) => `${u.k} nicht erfüllt: ${u.beleg}`);
    return `ENTSCHEIDUNG: fix\n${zeilen.join("\n")}\n`;
  }
  const zeilen = urteile.filter((u) => u.wert === "nicht-pruefbar").map((u) => `${u.k} nicht prüfbar: ${u.beleg}`);
  return `ENTSCHEIDUNG: handoff\n${zeilen.join("\n")}\n`;
}

function auswerten(werte, nrText, io) {
  const nr = positiveZahl(nrText);
  const pr = positiveZahl(werte.pr);
  if (nr === null || pr === null || !werte.bericht || !werte.worktree || !/^[0-9a-f]{7,40}$/i.test(werte.head ?? "")) {
    return aufrufFehler(`auswerten braucht <nr>, --pr, --bericht, --worktree und --head (7-40 Hex)\n${AUFRUF}`);
  }
  const t = ladeTicket(nr, io);
  if (t.ergebnis) return t.ergebnis;
  const liste = kriterien(t.issue.body);
  if (liste.length === 0) return aufrufFehler(`#${nr} hat keine Akzeptanzkriterien: die Abnahme entfällt (Zeile: node scripts/abnahme.mjs kriterien ${nr})`);
  let text;
  try {
    text = io.leseDatei(werte.bericht);
  } catch (e) {
    return aufrufFehler(`Bericht ${werte.bericht} nicht lesbar: ${fehlerText(e)}`);
  }
  const bericht = parseBericht(text, nr, liste);
  if (bericht.fehler) return berichtFehler(bericht.fehler);
  const wt = pruefeWorktree(werte, io);
  if (wt.fehler) return ergebnis(1, "", `✖ abnahme: ${wt.fehler}\nKein Urteil gepostet.\n`);
  let kommentare;
  try {
    kommentare = io.ladeKommentare(pr);
  } catch (e) {
    return aufrufFehler(`Kommentare von #${pr} nicht ladbar: ${fehlerText(e)}`);
  }
  const durchgang = zaehleDurchgang(kommentare, io.owner, io.zeilen);
  const entscheidung = entscheide(bericht.urteile);
  const args = { zeilen: io.zeilen, nr, durchgang, head: wt.head, urteile: bericht.urteile, kriterienListe: liste };
  try {
    io.poste(pr, prKommentar(args));
  } catch (e) {
    return aufrufFehler(`PR-Kommentar nicht gepostet: ${fehlerText(e)}`);
  }
  if (entscheidung === "handoff") {
    try {
      io.poste(nr, handoffKommentar(args));
    } catch (e) {
      return aufrufFehler(`PR-Kommentar gepostet, Hand-off-Kommentar fehlt: ${fehlerText(e)}`);
    }
  }
  return ergebnis(0, ausgabe(entscheidung, bericht.urteile, liste, io, wt.head, durchgang));
}

/** Ausführung mit injizierbarer I/O (`owner`, `zeilen`, `leseDatei`, `ladeIssue`, `ladeKommentare`, `poste`, `git`): `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const [befehl, ...rest] = argv;
  const p = parseArgs(rest);
  if (p.fehler) return aufrufFehler(`${p.fehler}\n${AUFRUF}`);
  if (befehl === "kriterien") {
    const nr = positiveZahl(p.positional[0]);
    return nr === null ? aufrufFehler(`kriterien braucht eine Ticketnummer\n${AUFRUF}`) : zeigeKriterien(nr, io);
  }
  if (befehl === "auswerten") return auswerten(p.werte, p.positional[0], io);
  return aufrufFehler(`unbekannter Befehl ${befehl === undefined ? "(keiner)" : `„${befehl}“`}\n${AUFRUF}`);
}

const echteIo = () => ({
  owner: REPO.split("/")[0],
  zeilen: ladeCommitZeilen(),
  leseDatei: (pfad) => readFileSync(pfad, "utf8"),
  ladeIssue: (nr) => ghJson(["api", `repos/${REPO}/issues/${nr}`]),
  ladeKommentare: (pr) => issueKommentare(pr, (a) => ghJson(a), REPO),
  poste: (nr, body) => ghJson(["api", "-X", "POST", `repos/${REPO}/issues/${nr}/comments`, "-f", `body=${body}`]),
  git: (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }),
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mitKontingent("abnahme", { arten: ["core"] });
  const { code, out, err } = fuehreAus(process.argv.slice(2), echteIo());
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
