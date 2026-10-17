#!/usr/bin/env node
/**
 * Factory-Kennzahlen (ADR 0022 §6, F14): Lauf-Ergebnis, Nacharbeit und Kosten je Ticket als ein Markdown-Block
 * für den Bericht-Kommentar des Wochen-Status-Tickets, dazu die Abnahme-Quote im ersten Durchgang. Fehlende Daten erscheinen als Lücke mit Grund, nie als 0.
 *
 *   node scripts/factory-kennzahlen.mjs --von <ISO> --bis <ISO> [--langfuse] [--json]
 *
 * Verkettung über Unterprozesse mit `--json` (Einstiegsskripte importieren einander nicht): `lauf-ergebnis.mjs` für
 * Lauf-Ergebnis und Nacharbeit, `token-baseline.mjs` je Ticket für die Kosten (Standard: Transkript, `--langfuse`
 * ausdrücklich). Ticket → Session über die Claim-Zeile im lokalen Transkript. Definitionen und Grenzen:
 * docs/model-routing.md › Factory-Kennzahlen.
 *
 * Exit 0 ok (auch mit Kosten-Lücken), 1 Aufruffehler, 2 Lauf-Ergebnis fehlt oder verletzt den Vertrag (Block erscheint trotzdem).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toolEventsFromTranscript } from "./brain-metrics.mjs";
import { claimNummer, median } from "./mess-lib.mjs";
import { ladeSessions, projektOrdner } from "./transkript.mjs";

/** Nacharbeitsfenster von `lauf-ergebnis.mjs` (NACHARBEIT_TAGE dort; ein Einstiegsskript importiert das andere nicht, Test `vertrag` hält beide gleich). */
export const NACHARBEIT_TAGE = 14;
const TAG_MS = 24 * 3600 * 1000;
export const AUFRUFHILFE = "Aufruf: node scripts/factory-kennzahlen.mjs --von <ISO> --bis <ISO> [--langfuse] [--json]";

const gueltig = (iso) => Number.isFinite(Date.parse(String(iso ?? "")));

/** Argumente; ein fehlendes oder ungültiges `--von`/`--bis` setzt `fehler`. Pure. */
export function parseArgs(argv) {
  const a = { von: undefined, bis: undefined, langfuse: false, json: false, fehler: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--von") a.von = argv[++i];
    else if (x === "--bis") a.bis = argv[++i];
    else if (x === "--langfuse") a.langfuse = true;
    else if (x === "--json") a.json = true;
    else a.fehler ??= `Unbekanntes Argument: ${x}`;
  }
  if (!gueltig(a.von) || !gueltig(a.bis)) a.fehler ??= "--von und --bis brauchen je ein gültiges ISO-Datum.";
  return a;
}

/** PRs, deren Nacharbeitsfenster im Zeitraum `[von, bis]` abläuft: gemergt in `[von − 14 T, bis − 14 T]`. Pure. */
export function nacharbeitFenster(von, bis) {
  const iso = (t) => new Date(Date.parse(t) - NACHARBEIT_TAGE * TAG_MS).toISOString();
  return { von: iso(von), bis: iso(bis) };
}

/**
 * Ticket → Sessions mit Claim-Zeile (`gh issue edit <nr> … --add-assignee`) in Haupt- und Subagenten-Zeilen, je Session der früheste Claim.
 * `sessions` darf ein Generator sein (`ladeSessions`). Liefert `Map<ticket, [{session, ts}]>`, je Ticket nach `ts` sortiert. Pure.
 */
export function claimSessions(sessions) {
  const karte = new Map();
  for (const s of sessions) {
    const zeilenSaetze = [s.main, ...(s.subagents ?? []).map((a) => a.zeilen)];
    for (const zeilen of zeilenSaetze) {
      for (const ev of toolEventsFromTranscript(zeilen)) {
        if (ev.tool !== "Bash" && ev.tool !== "PowerShell") continue;
        const nr = claimNummer(ev.input?.command);
        if (!nr || !gueltig(ev.ts)) continue;
        const liste = karte.get(nr) ?? [];
        const vorhanden = liste.find((e) => e.session === s.id);
        if (!vorhanden) liste.push({ session: s.id, ts: ev.ts });
        else if (Date.parse(ev.ts) < Date.parse(vorhanden.ts)) vorhanden.ts = ev.ts;
        karte.set(nr, liste);
      }
    }
  }
  for (const liste of karte.values()) liste.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return karte;
}

/** Je Ticket der zuletzt gemergte PR (bei Gleichstand die größere PR-Nummer); PRs ohne Ticket werden nur gezählt. Pure. */
export function ticketLaeufe(zeilen) {
  const je = new Map();
  let ohneTicket = 0;
  for (const z of zeilen) {
    if (!z.ticket) {
      ohneTicket += 1;
      continue;
    }
    const alt = je.get(z.ticket);
    if (!alt || Date.parse(z.gemergt) > Date.parse(alt.gemergt) || (z.gemergt === alt.gemergt && z.pr > alt.pr)) je.set(z.ticket, z);
  }
  return { tickets: [...je.values()].sort((a, b) => a.ticket - b.ticket), ohneTicket };
}

/** Kosten eines Tickets aus der `token-baseline`-JSON-Ausgabe oder dem Fehlertext des Unterprozesses → `{ kosten }` oder `{ luecke }`. Nie 0 für fehlende Daten. Pure. */
export function kostenAus({ json, fehler }) {
  if (fehler !== undefined && fehler !== null) {
    const zeile = String(fehler).split(/\r?\n/).find((l) => l.trim()) ?? "token-baseline ohne Meldung";
    return { luecke: /^--langfuse braucht/.test(zeile) ? "kein Langfuse-Zugang" : zeile.trim() };
  }
  const total = json?.total;
  if (!total || typeof total.cost !== "number" || !Number.isFinite(total.cost)) return { luecke: "token-baseline ohne total.cost" };
  if (!(total.calls > 0)) return { luecke: "keine Calls im Ticket-Fenster" };
  if (!json.hasCost) return { luecke: "Calls ohne Preis" };
  if (json.unpriced > 0) {
    const modelle = Object.entries(json.unpricedModels ?? {}).map(([m, n]) => `${m} (${n})`).join(", ");
    return { luecke: `${json.unpriced} Calls ohne Preis${modelle ? `: ${modelle}` : ""}` };
  }
  return { kosten: total.cost };
}

const ABNAHME_FELDER = ["gemessen", "ersterDurchgang", "entfaellt", "override", "ohne"];
/** Abnahme-Feld einer Zeile von `lauf-ergebnis.mjs`: null, "entfaellt", "override" oder { durchgaenge: Ganzzahl ≥ 1 }. */
const abnahmeGueltig = (a) => a === null || a === "entfaellt" || a === "override" || (typeof a === "object" && a !== undefined && Number.isInteger(a.durchgaenge) && a.durchgaenge >= 1);

const FELDER = ["prs", "ohneNacharbeit", "nachweisbareFenster", "nacharbeitOffen", "ciFixSumme", "festgefahrenSumme", "runde1MitBlocker", "mitBlockerFeld"];

/** Prüft die JSON-Ausgabe von `lauf-ergebnis.mjs` gegen den Vertrag; Verstoß → `{ luecke }`, sonst `{ daten }`. Pure. */
export function vertragPruefen(json) {
  if (!json || !Array.isArray(json.zeilen) || !json.kennzahlen) return { luecke: "lauf-ergebnis: Ausgabe ohne zeilen/kennzahlen (Vertrag verletzt)" };
  const fehlt = FELDER.filter((f) => !Number.isFinite(json.kennzahlen[f]));
  if (fehlt.length > 0) return { luecke: `lauf-ergebnis: Kennzahl-Feld fehlt: ${fehlt.join(", ")} (Vertrag verletzt)` };
  const ab = json.kennzahlen.abnahme;
  if (!ab || typeof ab !== "object") return { luecke: "lauf-ergebnis: Kennzahl-Feld fehlt: abnahme (Vertrag verletzt)" };
  const abFehlt = ABNAHME_FELDER.filter((f) => !Number.isFinite(ab[f]));
  if (abFehlt.length > 0) return { luecke: `lauf-ergebnis: Kennzahl-Feld fehlt: ${abFehlt.map((f) => `abnahme.${f}`).join(", ")} (Vertrag verletzt)` };
  const kaputt = json.zeilen.find((z) => !z || !Number.isFinite(z.pr) || !Number.isFinite(z.ciFix) || !gueltig(z.gemergt) || typeof z.nacharbeit !== "string" || !abnahmeGueltig(z.abnahme));
  if (kaputt !== undefined) return { luecke: "lauf-ergebnis: Zeile ohne pr/ciFix/gemergt/nacharbeit/abnahme (Vertrag verletzt)" };
  return { daten: json };
}

const anteil = (a, b, leer = "–") => (b === 0 ? leer : `${Math.round((a / b) * 100)} % (${a}/${b})`);
const dollar = (x) => `${x.toFixed(2).replace(".", ",")} $`;

function laufAbschnitt(lauf) {
  if (lauf.luecke) return [`- Lücke: ${lauf.luecke}`];
  const { zeilen, kennzahlen: k } = lauf.daten;
  const { tickets, ohneTicket } = ticketLaeufe(zeilen);
  const ohneCiFix = zeilen.filter((z) => z.ciFix === 0).length;
  return [
    `- PRs: ${k.prs} (Tickets: ${tickets.length}, ohne Ticket: ${ohneTicket})`,
    `- Ohne CI-Fix: ${anteil(ohneCiFix, zeilen.length)}`,
    `- Runde 1 mit Blocker: ${anteil(k.runde1MitBlocker, k.mitBlockerFeld)}`,
    `- Σ CI-Fix-Runden: ${k.ciFixSumme}, Σ festgefahren: ${k.festgefahrenSumme}`,
  ];
}

function nacharbeitAbschnitt(n, fenster) {
  const kopf = `Fenster: PRs gemergt ${fenster.von.slice(0, 10)} bis ${fenster.bis.slice(0, 10)}, ${NACHARBEIT_TAGE} T Nacharbeitsfrist abgelaufen`;
  if (n.luecke) return [kopf, `- Lücke: ${n.luecke}`];
  const k = n.daten.kennzahlen;
  const treffer = n.daten.zeilen.filter((z) => z.nacharbeit === "revert" || z.nacharbeit === "folge");
  return [
    kopf,
    `- Ohne Nacharbeit: ${anteil(k.ohneNacharbeit, k.nachweisbareFenster, "– (kein Fenster fällig)")}`,
    ...treffer.map((z) => `- Nacharbeit (${z.nacharbeit}): PR #${z.pr}${z.ticket ? `, Ticket #${z.ticket}` : ""}`),
    ...(k.nacharbeitOffen > 0 ? [`- Fenster noch offen: ${k.nacharbeitOffen}`] : []),
  ];
}

function kostenAbschnitt(tickets, quelle) {
  if (tickets.length === 0) return ["- Lücke: keine Tickets im Zeitraum"];
  const gemessen = tickets.filter((t) => t.ergebnis.kosten !== undefined);
  const med = median(gemessen.map((t) => t.ergebnis.kosten));
  return [
    "| Ticket | PR | Kosten |",
    "|---|---|---|",
    ...tickets.map((t) => `| #${t.ticket} | #${t.pr} | ${t.ergebnis.kosten !== undefined ? dollar(t.ergebnis.kosten) : `Lücke: ${t.ergebnis.luecke}`} |`),
    "",
    `- Quelle: ${quelle}; gemessen: ${gemessen.length} von ${tickets.length}`,
    `- Median Kosten/Ticket: ${med === null ? "–" : dollar(med)}`,
  ];
}

/** Abnahme-Quote im ersten Durchgang aus dem Lauf-Ergebnis; ohne Urteil im Zeitraum eine Lücke mit Grund, nie 0 %. */
function abnahmeAbschnitt(lauf) {
  if (lauf.luecke) return ["- Lücke: kein Lauf-Ergebnis"];
  const a = lauf.daten.kennzahlen.abnahme;
  const overrides = lauf.daten.zeilen.filter((z) => z.abnahme === "override").map((z) => `#${z.pr}`);
  return [
    a.gemessen === 0 ? "- Lücke: keine PR mit Abnahme-Urteil im Zeitraum" : `- ${a.ersterDurchgang} von ${a.gemessen} im ersten Durchgang (${Math.round((a.ersterDurchgang / a.gemessen) * 100)} %)`,
    `- Nicht in der Quote: entfällt ${a.entfaellt}, Override ${a.override}${overrides.length > 0 ? ` (PR ${overrides.join(", ")})` : ""}, ohne Abnahme-Zeile ${a.ohne}`,
  ];
}

/** Bericht als Daten: `lauf`/`nacharbeit` = `vertragPruefen`-Ergebnis, `tickets` = `[{ticket, pr, ergebnis}]`. Pure. */
export function bericht({ von, bis, lauf, nacharbeit, tickets, quelle }) {
  return {
    zeitraum: { von, bis },
    nacharbeitFenster: nacharbeitFenster(von, bis),
    quelle,
    lauf,
    nacharbeit,
    tickets,
  };
}

/** Markdown-Block für den Bericht-Kommentar. Pure. */
export function renderMarkdown(b) {
  const kosten = b.lauf.luecke ? ["- Lücke: kein Lauf-Ergebnis, damit keine Ticketliste"] : kostenAbschnitt(b.tickets, b.quelle);
  return [
    `### Factory-Kennzahlen (${b.zeitraum.von} bis ${b.zeitraum.bis})`,
    "",
    "**Lauf-Ergebnis**",
    ...laufAbschnitt(b.lauf),
    "",
    "**Nacharbeit**",
    ...nacharbeitAbschnitt(b.nacharbeit, b.nacharbeitFenster),
    "",
    "**Kosten je Ticket**",
    ...kosten,
    "",
    "**Abnahme-Quote**",
    ...abnahmeAbschnitt(b.lauf),
  ].join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const HIER = dirname(fileURLToPath(import.meta.url));

/** Startet ein Nachbarskript als Unterprozess; Ergebnis `{ status, stdout, stderr }`. */
function runSkript(name, args) {
  const r = spawnSync(process.execPath, [join(HIER, name), ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
}

/** `lauf-ergebnis.mjs --json` für ein Zeitfenster → `vertragPruefen`-Ergebnis. IO injizierbar. */
export function holeLauf(von, bis, run = runSkript) {
  const r = run("lauf-ergebnis.mjs", ["--von", von, "--bis", bis, "--json"]);
  if (r.status !== 0) return { luecke: `lauf-ergebnis Exit ${r.status}: ${String(r.stderr).split(/\r?\n/).find((l) => l.trim()) ?? "ohne Meldung"}` };
  try {
    return vertragPruefen(JSON.parse(r.stdout));
  } catch {
    return { luecke: "lauf-ergebnis: Ausgabe ist kein JSON" };
  }
}

function kostenLauf(sessions, { ticket, pr, von, langfuse }, run) {
  const args = [...sessions.flatMap((c) => ["--session", c.session]), "--issue", String(ticket), "--pr", String(pr), "--from", von, ...(langfuse ? ["--langfuse"] : []), "--json"];
  const r = run("token-baseline.mjs", args);
  if (r.status !== 0) return kostenAus({ fehler: r.stderr || `token-baseline Exit ${r.status}` });
  try {
    return kostenAus({ json: JSON.parse(r.stdout) });
  } catch {
    return { luecke: "token-baseline: Ausgabe ist kein JSON" };
  }
}

/**
 * Kosten eines Tickets über `token-baseline.mjs --json`; IO injizierbar. Transkript: ein Lauf über alle Claim-Sessions.
 * Langfuse: je Session ein Lauf, denn `token-baseline` führt Sessions zusammen und eine Session ohne Langfuse-Daten
 * trüge still 0 $ bei; fehlt eine, ist das ganze Ticket eine Lücke (keine Teilsumme).
 */
export function holeKosten({ ticket, pr, claims, langfuse }, run = runSkript) {
  if (!claims || claims.length === 0) return { luecke: "keine Session mit Claim-Zeile" };
  const von = claims[0].ts;
  if (!langfuse) return kostenLauf(claims, { ticket, pr, von, langfuse }, run);
  let summe = 0;
  for (const c of claims) {
    const e = kostenLauf([c], { ticket, pr, von, langfuse }, run);
    if (e.luecke !== undefined) return { luecke: claims.length > 1 ? `Session ${c.session}: ${e.luecke}` : e.luecke };
    summe += e.kosten;
  }
  return { kosten: summe };
}

/**
 * Setzt den Bericht zusammen; IO injiziert (`run` für die Unterprozesse, `claimKarte` liefert die Karte Ticket → Sessions).
 * Exit 2, wenn Lauf-Ergebnis oder Nacharbeit-Lauf fehlen (der Block erscheint trotzdem). Nur mit gültigem `von`/`bis` rufen.
 */
export function erstelle({ von, bis, langfuse = false }, { run = runSkript, claimKarte }) {
  const fenster = nacharbeitFenster(von, bis);
  const lauf = holeLauf(von, bis, run);
  const nacharbeit = holeLauf(fenster.von, fenster.bis, run);
  let tickets = [];
  if (lauf.daten) {
    const claims = claimKarte();
    tickets = ticketLaeufe(lauf.daten.zeilen).tickets.map((z) => ({ ticket: z.ticket, pr: z.pr, ergebnis: holeKosten({ ticket: z.ticket, pr: z.pr, claims: claims.get(z.ticket), langfuse }, run) }));
  }
  const b = bericht({ von, bis, lauf, nacharbeit, tickets, quelle: langfuse ? "Langfuse" : "Transkript" });
  return { bericht: b, exit: lauf.luecke || nacharbeit.luecke ? 2 : 0 };
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.fehler) {
    console.error([args.fehler, AUFRUFHILFE].join("\n"));
    process.exit(1);
  }
  const { von, bis, langfuse } = args;
  const claimKarte = () => claimSessions(ladeSessions(projektOrdner(), new Date(Date.parse(von) - TAG_MS).toISOString()));
  const r = erstelle({ von, bis, langfuse }, { claimKarte });
  console.log(args.json ? JSON.stringify(r.bericht, null, 2) : renderMarkdown(r.bericht));
  if (r.exit !== 0) process.exit(r.exit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
