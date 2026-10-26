// Kein Shebang: wird per `node scripts/langfuse-abgleich.mjs` gestartet UND von test/harness/langfuse-abgleich.test.ts importiert.
/**
 * Langfuse-Abgleich (#1562, Teil 1/3 von #1556): welche Calls des lokalen Transkripts (Soll) fehlen in Langfuse (Ist)
 * oder stehen dort doppelt? NUR LESEND: das Skript schreibt nichts und löscht nie (Dubletten werden gemeldet).
 *
 *   node scripts/langfuse-abgleich.mjs --pruefen [--seit <ISO>] [--session <id>] [--ist <datei>…] [--json]
 *
 * Soll: `~/.claude/projects/<Projektpräfix>*` (Hauptdatei + `<id>/subagents/`), je Assistant-Message (`message.id`) ein
 * Eintrag mit deterministischen IDs. Ist: zwei Metrics-Abfragen (Zählung und `usageByType` je `sessionId`; bei Erreichen von `row_limit` wird das Zeitfenster halbiert), Observations
 * nur für Sessions mit Differenz. Ohne Secret-Key (Agentenläufe) ersatzweise `--ist <datei>` mit einem `queryMetrics`-Export
 * des Langfuse-MCP (mehrfach nutzbar: Zählung und Tokens dürfen zwei Exporte sein).
 *
 * Mit `--session <id>` werden alle Ordner durchsucht (#1862); ein Treffer außerhalb des Projekts bekommt den Score „außerhalb“ und eine Hinweiszeile.
 * Das Präfix trifft sonst nur das Projekt selbst und seine Worktree-Ordner (`<präfix>--claude-worktrees-…`), nie Geschwister-Repos
 * mit gleichem Namensanfang. Importiert nur Builtins und die hook-tauglichen Module (`preise`, `transkript`, `transkript-calls`, `langfuse-api`, `langfuse-abgleich-kern`, `flag-lib`), damit es
 * später als Hook laufen kann, ohne die gh-/git-Kette von `token-baseline.mjs` mitzuziehen. Aufruf und Einordnung:
 * docs/model-routing.md › Checkliste Punkt 1. Den Schreibweg (nur fehlende Calls nachliefern) trägt `langfuse-nachliefern.mjs`.
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ladeSessionDatei, projekteWurzel, projektSlug } from "./transkript.mjs";
import { fetchSessionObservations, langfuseZugang } from "./langfuse-api.mjs";
import { flagsLesen } from "./flag-lib.mjs";
import { costDetails } from "./langfuse-otlp.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { worktreePraefix } from "./ticket-namen.mjs";
import {
  ROW_LIMIT,
  LEDGER_NAME,
  RUHEFRIST_MIN,
  STICHTAG,
  diffMultimenge,
  findeSessions,
  gleich,
  hatDifferenz,
  holeMetrics,
  istAbfragen,
  istAusMetrics,
  endeGiltFuer,
  ledgerLesen,
  leereSumme,
  nachliefererWartet,
  sollEintraege,
  summe,
  vorStichtag,
} from "./langfuse-abgleich-kern.mjs";

const FEHLEND_ANZEIGE = 20;
/** Liegen die Langfuse-Kosten bei gleichen Calls strikt unter (1 − PREIS_TOLERANZ) · Transkript-Kosten, bepreist die Instanz das Modell nicht oder zu niedrig (Hinweis Modellpreis). */
export const PREIS_TOLERANZ = 0.1;

/**
 * Preisvergleich bei gleichen Calls und gleichen Tokens (keine Lücke, keine Dublette, keine Token-Abweichung, T > 0, L bekannt):
 * `preisabweichung` = L − T in $ (positiv: Langfuse bepreist höher, z. B. veralteter Preis in der Instanzdefinition; negativ: niedriger),
 * `hinweisUeberpreis` = L strikt über (1 + PREIS_TOLERANZ) · T. Sonst `preisabweichung` null, Hinweis false. Disjunkt zur Überzählung (die setzt Dubletten voraus).
 */
export function preisVergleich({ fehlend, dubletten, tokenAbweichung, kostenT, kostenL }) {
  const vergleichbar = fehlend === 0 && dubletten === 0 && !tokenAbweichung && kostenT > 0 && Number.isFinite(kostenL);
  if (!vergleichbar) return { preisabweichung: null, hinweisUeberpreis: false };
  return { preisabweichung: kostenL - kostenT, hinweisUeberpreis: kostenL > (1 + PREIS_TOLERANZ) * kostenT };
}

/** Transkript-Kosten eines Solls in $; die Preisabbildung ist `costDetails` (`langfuse-otlp.mjs`), dieselbe, die der Nachlieferer an Langfuse sendet. Calls ohne Preis zählen in `ohnePreis`, nie als 0 $ in der Summe. */
function kostenAusSoll(soll) {
  let kosten = 0;
  let ohnePreis = 0;
  for (const e of soll) {
    const k = costDetails(e);
    if (k === null) ohnePreis++;
    else kosten += k.total;
  }
  return { kosten, ohnePreis };
}

/**
 * Eine Session bewerten. `ist` = `{ calls, tokens, kosten }` (calls null zählt als 0, kosten fehlend/null = unbekannt), `diff` optional aus `diffMultimenge`
 * (sonst Zählebene: fehlend = max(0, Soll − Ist), Dubletten = max(0, Ist − Soll)). Status: `läuft` (Ruhefrist),
 * `Lücke`, `Dublette`, `Abweichung` (gleiche Zahl, andere Tokens), `vollständig`. Dazu `score` (getrennt vom Status): `vor Stichtag`
 * (der Nachlieferer sendet dort nie), `ausstehend` (der Nachlieferer wartet noch: 150 s bei bekanntem Ende laut Ledger `ledgerEintrag`,
 * sonst 24 h), `außerhalb` (#1862: Session liegt außerhalb der Projektordner, weder Projekt-Hook noch Nachlieferer erfassen sie, der Score kommt nie) oder `null`.
 */
export function bewerteSession({ soll, ist, mtime, groesse = null, now, diff = null, ledgerEintrag = null, ausserhalb = false }) {
  const calls = ist.calls ?? 0;
  const fehlend = diff ? diff.fehlend.length : Math.max(0, soll.length - calls);
  const dubletten = diff ? diff.dubletten.length : Math.max(0, calls - soll.length);
  const tokensT = summe(soll);
  const { kosten: kostenT, ohnePreis } = kostenAusSoll(soll);
  const kostenL = ist.kosten ?? null;
  // Überzählung (nur gemeldet, nie gelöscht): was Langfuse durch echte Dubletten mehr führt; ohne Kosten-Export unbekannt.
  const ueberzaehlung = dubletten > 0 && kostenL !== null ? Math.max(0, kostenL - kostenT) : null;
  // Gleiche Calls, aber Langfuse-Kosten klar unter dem Transkript: Modelldefinition der Instanz fehlt oder ist zu niedrig.
  const hinweisModellpreis = fehlend === 0 && dubletten === 0 && kostenT > 0 && kostenL !== null && kostenL < (1 - PREIS_TOLERANZ) * kostenT;
  const tokenAbweichung = ist.tokens !== null && !gleich(tokensT, ist.tokens);
  const { preisabweichung, hinweisUeberpreis } = preisVergleich({ fehlend, dubletten, tokenAbweichung, kostenT, kostenL });
  const laeuft = now - mtime < RUHEFRIST_MIN * 60_000;
  let status = "vollständig";
  if (laeuft) status = "läuft";
  else if (fehlend > 0) status = "Lücke";
  else if (dubletten > 0) status = "Dublette";
  else if (tokenAbweichung) status = "Abweichung";
  const beendet = endeGiltFuer(ledgerEintrag, { mtime, groesse });
  let score = null;
  if (!laeuft) score = ausserhalb ? "außerhalb" : vorStichtag(soll) ? "vor Stichtag" : nachliefererWartet({ mtime, now, beendet }) ? "ausstehend" : null;
  return {
    session: soll[0]?.session ?? null,
    status,
    score,
    ausserhalb,
    tickets: [...new Set(soll.map((e) => e.ticket).filter(Boolean))].sort(),
    callsTranskript: soll.length,
    callsLangfuse: calls,
    tokensTranskript: tokensT,
    tokensLangfuse: ist.tokens,
    kostenTranskript: kostenT,
    kostenLangfuse: kostenL,
    ohnePreis,
    ueberzaehlung,
    hinweisModellpreis,
    preisabweichung,
    hinweisUeberpreis,
    fehlend,
    dubletten,
    leer: diff?.leer?.length ?? 0,
    quote: soll.length ? (soll.length - fehlend) / soll.length : 1,
    fehlendeCalls: diff ? diff.fehlend.map((e) => ({ messageId: e.messageId, ts: e.ts, model: e.model })) : null,
    schluessel: diff?.art ?? "zählung",
  };
}

/** Summenzeile: Sessions in der Ruhefrist (`läuft`) zählen nicht in Σ und Quote, sondern stehen getrennt; unter den festen stehen `scoreAusstehend` (Nachlieferer wartet noch) und `vorStichtag` (nie gesendet) gesondert. */
export function summenzeile(bewertungen) {
  const fest = bewertungen.filter((b) => b.status !== "läuft");
  const t = fest.reduce((s, b) => s + b.callsTranskript, 0);
  const fehlend = fest.reduce((s, b) => s + b.fehlend, 0);
  // Langfuse-Kosten und Überzählung: Summe der bekannten Werte, ohne Kosten-Export null (nie 0).
  const bekannt = (feld) => {
    const werte = fest.map((b) => b[feld]).filter((v) => v !== null);
    return werte.length ? werte.reduce((s, v) => s + v, 0) : null;
  };
  // T und L über dieselbe Menge: nur Sessions mit Kosten-Export; ohne jeden Export gibt es keine L-Seite, dann zählen alle festen Sessions.
  const mitExport = fest.filter((b) => b.kostenLangfuse !== null);
  return {
    kostenTranskript: (mitExport.length ? mitExport : fest).reduce((s, b) => s + b.kostenTranskript, 0),
    kostenLangfuse: bekannt("kostenLangfuse"),
    ohneKostenExport: fest.length - mitExport.length,
    ueberzaehlung: bekannt("ueberzaehlung"),
    preisabweichung: bekannt("preisabweichung"),
    sessions: fest.length,
    laeuft: bewertungen.length - fest.length,
    scoreAusstehend: fest.filter((b) => b.score === "ausstehend").length,
    vorStichtag: fest.filter((b) => b.score === "vor Stichtag").length,
    callsTranskript: t,
    callsLangfuse: fest.reduce((s, b) => s + b.callsLangfuse, 0),
    fehlend,
    dubletten: fest.reduce((s, b) => s + b.dubletten, 0),
    quote: t ? (t - fehlend) / t : 1,
  };
}

// ── Bericht ──────────────────────────────────────────────────────────────────

const fmt = (n) => Math.round(n).toLocaleString("de-DE");
const pct = (q) => `${(q * 100).toFixed(1).replace(".", ",")} %`;
const paar = (a, b) => `${fmt(a)} / ${b === null ? "–" : fmt(b)}`;
const usd = (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const paarUsd = (a, b) => `${usd(a)} / ${b === null ? "–" : usd(b)}`;
const kuerzel = (liste) => liste.map((x) => String(x.session).slice(0, 8)).join(", ");

/** Berichtszeilen zur Preisabweichung (je mit führender Leerzeile); leer ohne vergleichbare Session bzw. ohne Hinweis. */
function preisZeilen(festeSessions) {
  const out = [];
  const mitAbweichung = festeSessions.filter((x) => x.preisabweichung !== null);
  if (mitAbweichung.length) {
    const betrag = mitAbweichung.reduce((s, x) => s + x.preisabweichung, 0);
    out.push("", `Preisabweichung bei gleichen Calls und Tokens: ${betrag > 0 ? "+" : ""}${usd(betrag)} $ in ${mitAbweichung.length} Session(s) (${kuerzel(mitAbweichung)}): Langfuse-Wochensummen um diesen Betrag bereinigen (Checkliste Punkt 7).`);
  }
  const ueberpreis = festeSessions.filter((x) => x.hinweisUeberpreis);
  if (ueberpreis.length) {
    out.push("", `Hinweis Überpreis: ${ueberpreis.length} Session(s) mit gleichen Calls und Tokens, Langfuse-Kosten über ${Math.round((1 + PREIS_TOLERANZ) * 100)} % des Transkripts (${kuerzel(ueberpreis)}): Modelldefinition der Instanz prüfen (docs/langfuse-hook-patch.md › Modelldefinitionen der Instanz).`);
  }
  return out;
}

export function renderMarkdown(bewertungen, sum) {
  const kopf = ["Session", "Ticket", "Status", "Calls T/L", "Input T/L", "Output T/L", "Cache-Read T/L", "Cache-Write T/L", "Kosten T/L ($)", "fehlend", "Dubletten", "Quote"];
  const zeilen = [`| ${kopf.join(" | ")} |`, `|${kopf.map(() => "---").join("|")}|`];
  for (const b of bewertungen) {
    const l = b.tokensLangfuse;
    zeilen.push(
      `| ${String(b.session).slice(0, 8)} | ${b.tickets.join(", ") || "–"} | ${b.status === "vollständig" && b.score === "ausstehend" ? "vollständig, Score ausstehend" : b.status} | ${paar(b.callsTranskript, b.callsLangfuse)} | ${paar(b.tokensTranskript.input, l?.input ?? null)} | ${paar(b.tokensTranskript.output, l?.output ?? null)} | ${paar(b.tokensTranskript.cacheRead, l?.cacheRead ?? null)} | ${paar(b.tokensTranskript.cacheWrite, l?.cacheWrite ?? null)} | ${paarUsd(b.kostenTranskript, b.kostenLangfuse)} | ${b.fehlend} | ${b.dubletten} | ${pct(b.quote)} |`,
    );
  }
  const out = ["# Langfuse-Abgleich (T = Transkript, L = Langfuse)", "", ...zeilen, ""];
  const teile = [];
  if (sum.scoreAusstehend) teile.push(`${sum.scoreAusstehend} davon Score ausstehend (Nachlieferer wartet noch)`);
  if (sum.ohneKostenExport) teile.push(`ohne Kosten-Export: ${sum.ohneKostenExport}`);
  if (sum.vorStichtag) teile.push(`${sum.vorStichtag} vor dem Stichtag (nie gesendet, kein Score)`);
  const zusatz = teile.length ? `; ${teile.join(", ")}` : "";
  out.push(`**Summe:** ${sum.sessions} Session(s), Calls ${fmt(sum.callsTranskript)} / ${fmt(sum.callsLangfuse)}, Kosten ${paarUsd(sum.kostenTranskript, sum.kostenLangfuse)} $, fehlend ${sum.fehlend}, Dubletten ${sum.dubletten}, Erfassungsquote ${pct(sum.quote)}${sum.laeuft ? `; ${sum.laeuft} Session(s) läuft noch (Ruhefrist ${RUHEFRIST_MIN} min, nicht in Σ)` : ""}${zusatz}.`);
  for (const b of bewertungen.filter((x) => x.fehlendeCalls?.length)) {
    out.push("", `Fehlende Calls ${String(b.session).slice(0, 8)} (Schlüssel: ${b.schluessel}):`);
    for (const c of b.fehlendeCalls.slice(0, FEHLEND_ANZEIGE)) out.push(`- ${c.messageId} · ${c.ts} · ${c.model}`);
    if (b.fehlendeCalls.length > FEHLEND_ANZEIGE) out.push(`- … und ${b.fehlendeCalls.length - FEHLEND_ANZEIGE} weitere`);
  }
  for (const b of bewertungen.filter((x) => x.ausserhalb)) {
    out.push("", `Hinweis ${String(b.session).slice(0, 8)}: Session außerhalb des Projekts (Projektordner passt nicht). Weder Projekt-Hook noch Nachlieferer erfassen sie, der Score erfassung kommt nie. Kosten: node scripts/token-baseline.mjs --session ${b.session}; Einordnung: docs/langfuse-hook-patch.md › Läufe außerhalb des Repos.`);
  }
  const zaehlDubletten = bewertungen.filter((x) => x.schluessel === "zählung" && x.dubletten > 0);
  if (zaehlDubletten.length) {
    out.push("", `Hinweis: ${zaehlDubletten.length} Session(s) mit Dubletten auf der Zählebene (${zaehlDubletten.map((x) => String(x.session).slice(0, 8)).join(", ")}): leere Hook-GENERATIONs (ohne Message-ID und Tokens) können dort mitzählen (ein Export mit dem Filter providedModelName none of ["claude"] schließt sie aus). Genau prüfen lässt sich das auch mit dem Secret-Key (Observations je Session), dort trennt der Abgleich sie als „leer“ ab.`);
  }
  // Beide Werte stehen getrennt und werden nie verrechnet; Sessions in der Ruhefrist zählen nicht (wie in der Summe).
  const festeSessions = bewertungen.filter((x) => x.status !== "läuft");
  const ueber = festeSessions.filter((x) => x.ueberzaehlung > 0);
  if (ueber.length) {
    out.push("", `Überzählung durch Dubletten: ${usd(ueber.reduce((s, x) => s + x.ueberzaehlung, 0))} $ in ${ueber.length} Session(s) (${kuerzel(ueber)}): Langfuse-Wochensummen um diesen Betrag bereinigen (Checkliste Punkt 7).`);
  }
  const unterpreis = festeSessions.filter((x) => x.hinweisModellpreis);
  if (unterpreis.length) {
    out.push("", `Hinweis Modellpreis: ${unterpreis.length} Session(s) mit gleichen Calls, Langfuse-Kosten unter ${Math.round((1 - PREIS_TOLERANZ) * 100)} % des Transkripts (${kuerzel(unterpreis)}): Modelldefinition der Instanz prüfen (docs/langfuse-hook-patch.md › Modelldefinitionen der Instanz).`);
  }
  out.push(...preisZeilen(festeSessions));
  out.push("", `Hinweis: Aufzeichnungen ohne TTL-Aufteilung der Cache-Writes (vor dem Hook-Patch, vor ${STICHTAG.slice(0, 10)}) passen nicht auf den Fingerabdruck und erscheinen als fehlend plus Dublette.`);
  return out.join("\n");
}

export const AUFRUFHILFE = "Aufruf: node scripts/langfuse-abgleich.mjs --pruefen [--seit <ISO>] [--session <id>] [--ist <datei>…] [--json]";
export const OHNE_ZUGANG = "Kein Langfuse-Zugang: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY fehlen. Agentenläufe nutzen den Secret-Key nicht (Regel, technisch gesperrt nur unter der Sandbox, nicht unter Windows): queryMetrics-Export aus dem Langfuse-MCP als --ist <datei> übergeben (View observations, Filter type = GENERATION, Dimension sessionId, Zählung: Metrik count mit zusätzlichem Filter providedModelName none of [\"claude\"] (Typ stringOptions; schließt die leeren Hook-GENERATIONs aus); Tokens: Dimensionen sessionId und usageType, Metrik usageByType; Kosten: Dimension sessionId, Metrik totalCost (sum); jeweils orderBy desc, row_limit 1000, Export unter 1000 Zeilen: sonst enger fenstern oder je --session), siehe docs/model-routing.md › Checkliste Punkt 1.";

export function parseArgs(argv) {
  const optionen = { pruefen: { type: "boolean" }, json: { type: "boolean" }, seit: { type: "string" }, session: { type: "string" }, ist: { type: "string", multiple: true } };
  const { werte, fehler } = flagsLesen(argv, optionen);
  const a = { pruefen: werte.pruefen === true, json: werte.json === true, seit: werte.seit ?? null, session: werte.session ?? null, ist: werte.ist ?? [] };
  if (fehler) a.fehler = fehler.text;
  return a;
}

// ── Ablauf (ohne process.exit, damit testbar) ────────────────────────────────

async function istHolen({ args, soll, zugang, now, fetchImpl, leseDatei }) {
  if (args.ist.length) {
    const rows = args.ist.flatMap((pfad) => {
      let j;
      try {
        j = JSON.parse(leseDatei(pfad, "utf8"));
      } catch (e) {
        throw new Error(`--ist ${pfad}: kein lesbares JSON (${e.message})`, { cause: e });
      }
      const r = Array.isArray(j) ? j : j?.data;
      if (!Array.isArray(r)) throw new Error(`--ist ${pfad}: unbekannte Form, erwartet {data:[…]} oder ein Array.`);
      if (r.length >= ROW_LIMIT) throw new Error(`--ist ${pfad}: Export abgeschnitten (${r.length} Zeilen = row_limit): Fenster enger wählen oder je Session (--session) exportieren.`);
      return r;
    });
    return istAusMetrics(rows);
  }
  const fruehester = Math.min(...[...soll.values()].flat().map((e) => Date.parse(e.ts)).filter(Number.isFinite));
  const q = istAbfragen({ von: new Date(fruehester - 3_600_000).toISOString(), bis: new Date(now + 60_000).toISOString(), session: args.session });
  const rows = [];
  for (const abfrage of [q.zaehlung, q.tokens, q.kosten]) rows.push(...(await holeMetrics(abfrage, zugang, fetchImpl)));
  return istAusMetrics(rows);
}

/** `--pruefen` ausführen: `{ exitCode, text }`. 0 = Bericht (auch mit Lücken: Messwerkzeug, kein Gate), 1 = Fehler beim Lesen/Abfragen, 2 = Aufruf oder Zugang fehlt. */
export async function pruefen(args, { env = process.env, now = Date.now(), projectsRoot, repoRoot, fetchImpl = fetch, leseDatei = readFileSync, stateDir = null, config } = {}) {
  if (args.fehler) return { exitCode: 2, text: `${args.fehler}\n${AUFRUFHILFE}` };
  if (!args.pruefen) return { exitCode: 2, text: AUFRUFHILFE };
  const seitMs = args.seit ? Date.parse(args.seit) : now - 7 * 86_400_000;
  if (!Number.isFinite(seitMs)) return { exitCode: 2, text: `--seit ist keine ISO-Zeit: ${args.seit}\n${AUFRUFHILFE}` };
  let zugang = null;
  try {
    zugang = langfuseZugang(env, OHNE_ZUGANG);
  } catch (e) {
    if (!args.ist.length) return { exitCode: 2, text: e.message };
  }
  let worktree;
  try {
    worktree = worktreePraefix(config ?? ladeProjektConfig({ pruefen: false }));
  } catch (e) {
    return { exitCode: 1, text: `Fehler: ${e.message}` };
  }
  try {
    const sessions = findeSessions({ projectsRoot, praefix: projektSlug(repoRoot), seitMs, sessionId: args.session, alleOrdner: Boolean(args.session) });
    const soll = new Map();
    const staende = new Map();
    for (const s of sessions) {
      const eintraege = sollEintraege(ladeSessionDatei(s.pfad), { session: s.id, worktree });
      if (eintraege.length) soll.set(s.id, eintraege);
      staende.set(s.id, { mtime: s.mtime, groesse: s.groesse, ausserhalb: Boolean(s.ausserhalb) });
    }
    if (!soll.size) return { exitCode: 0, text: args.json ? JSON.stringify({ sessions: [], summe: summenzeile([]) }) : "Keine Sessions mit Calls im Fenster." };
    // Ledger nur lesen (bekanntes Ende für die Score-Spalte); kaputt oder fehlend heißt: kein bekanntes Ende, nie schreiben oder sichern.
    const ledger = stateDir ? ledgerLesen(join(stateDir, LEDGER_NAME)).ledger : { sessions: {} };
    const ist = await istHolen({ args, soll, zugang, now, fetchImpl, leseDatei });
    const bewertungen = [];
    for (const [id, eintraege] of soll) {
      const istSession = ist.get(id) ?? { calls: 0, tokens: leereSumme(), kosten: null };
      const { mtime, groesse, ausserhalb } = staende.get(id);
      const laeuft = now - mtime < RUHEFRIST_MIN * 60_000;
      let diff = null;
      if (zugang && !laeuft && hatDifferenz(eintraege, { calls: istSession.calls ?? 0, tokens: istSession.tokens })) {
        const obs = await fetchSessionObservations(id, { ...zugang, fetchImpl, type: "GENERATION", fields: "core,basic,model,usage,metadata" });
        diff = diffMultimenge(eintraege, obs);
      }
      bewertungen.push(bewerteSession({ soll: eintraege, ist: { calls: istSession.calls ?? 0, tokens: istSession.tokens, kosten: istSession.kosten }, mtime, groesse, now, diff, ledgerEintrag: ledger.sessions[id] ?? null, ausserhalb }));
    }
    const sum = summenzeile(bewertungen);
    return { exitCode: 0, text: args.json ? JSON.stringify({ sessions: bewertungen, summe: sum }, null, 2) : renderMarkdown(bewertungen, sum) };
  } catch (e) {
    return { exitCode: 1, text: `Fehler: ${e.message}` };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const { exitCode, text } = await pruefen(args, { projectsRoot: projekteWurzel(), repoRoot, stateDir: join(homedir(), ".claude", "state") });
  (exitCode === 0 ? console.log : console.error)(text);
  process.exitCode = exitCode;
}

if (istDirektaufruf(import.meta.url)) await main();
