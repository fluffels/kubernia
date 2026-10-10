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
 * Das Präfix trifft nur das Projekt selbst und seine Worktree-Ordner (`<präfix>--claude-worktrees-…`), nie Geschwister-Repos
 * mit gleichem Namensanfang. Importiert nur Builtins und die hook-tauglichen Module (`preise`, `transkript`, `transkript-calls`, `langfuse-api`, `langfuse-abgleich-kern`), damit es
 * später als Hook laufen kann, ohne die gh-/git-Kette von `token-baseline.mjs` mitzuziehen. Aufruf und Einordnung:
 * docs/model-routing.md › Checkliste Punkt 1. Den Schreibweg (nur fehlende Calls nachliefern) trägt `langfuse-nachliefern.mjs`.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ladeSessionDatei, projektSlug } from "./transkript.mjs";
import { fetchSessionObservations, langfuseZugang } from "./langfuse-api.mjs";
import {
  ROW_LIMIT,
  RUHEFRIST_MIN,
  diffMultimenge,
  findeSessions,
  gleich,
  hatDifferenz,
  holeMetrics,
  istAbfragen,
  istAusMetrics,
  leereSumme,
  sollEintraege,
  summe,
} from "./langfuse-abgleich-kern.mjs";

const FEHLEND_ANZEIGE = 20;

/**
 * Eine Session bewerten. `ist` = `{ calls, tokens }` (calls null zählt als 0), `diff` optional aus `diffMultimenge`
 * (sonst Zählebene: fehlend = max(0, Soll − Ist), Dubletten = max(0, Ist − Soll)). Status: `läuft` (Ruhefrist),
 * `Lücke`, `Dublette`, `Abweichung` (gleiche Zahl, andere Tokens), `vollständig`.
 */
export function bewerteSession({ soll, ist, mtime, now, diff = null }) {
  const calls = ist.calls ?? 0;
  const fehlend = diff ? diff.fehlend.length : Math.max(0, soll.length - calls);
  const dubletten = diff ? diff.dubletten.length : Math.max(0, calls - soll.length);
  const tokensT = summe(soll);
  const tokenAbweichung = ist.tokens !== null && !gleich(tokensT, ist.tokens);
  const laeuft = now - mtime < RUHEFRIST_MIN * 60_000;
  let status = "vollständig";
  if (laeuft) status = "läuft";
  else if (fehlend > 0) status = "Lücke";
  else if (dubletten > 0) status = "Dublette";
  else if (tokenAbweichung) status = "Abweichung";
  return {
    session: soll[0]?.session ?? null,
    status,
    tickets: [...new Set(soll.map((e) => e.ticket).filter(Boolean))].sort(),
    callsTranskript: soll.length,
    callsLangfuse: calls,
    tokensTranskript: tokensT,
    tokensLangfuse: ist.tokens,
    fehlend,
    dubletten,
    quote: soll.length ? (soll.length - fehlend) / soll.length : 1,
    fehlendeCalls: diff ? diff.fehlend.map((e) => ({ messageId: e.messageId, ts: e.ts, model: e.model })) : null,
    schluessel: diff?.art ?? "zählung",
  };
}

/** Summenzeile: Sessions in der Ruhefrist (`läuft`) zählen nicht in Σ und Quote, sondern stehen getrennt. */
export function summenzeile(bewertungen) {
  const fest = bewertungen.filter((b) => b.status !== "läuft");
  const t = fest.reduce((s, b) => s + b.callsTranskript, 0);
  const fehlend = fest.reduce((s, b) => s + b.fehlend, 0);
  return {
    sessions: fest.length,
    laeuft: bewertungen.length - fest.length,
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

export function renderMarkdown(bewertungen, sum) {
  const kopf = ["Session", "Ticket", "Status", "Calls T/L", "Input T/L", "Output T/L", "Cache-Read T/L", "Cache-Write T/L", "fehlend", "Dubletten", "Quote"];
  const zeilen = [`| ${kopf.join(" | ")} |`, `|${kopf.map(() => "---").join("|")}|`];
  for (const b of bewertungen) {
    const l = b.tokensLangfuse;
    zeilen.push(
      `| ${String(b.session).slice(0, 8)} | ${b.tickets.join(", ") || "–"} | ${b.status} | ${paar(b.callsTranskript, b.callsLangfuse)} | ${paar(b.tokensTranskript.input, l?.input ?? null)} | ${paar(b.tokensTranskript.output, l?.output ?? null)} | ${paar(b.tokensTranskript.cacheRead, l?.cacheRead ?? null)} | ${paar(b.tokensTranskript.cacheWrite, l?.cacheWrite ?? null)} | ${b.fehlend} | ${b.dubletten} | ${pct(b.quote)} |`,
    );
  }
  const out = ["# Langfuse-Abgleich (T = Transkript, L = Langfuse)", "", ...zeilen, ""];
  out.push(`**Summe:** ${sum.sessions} Session(s), Calls ${fmt(sum.callsTranskript)} / ${fmt(sum.callsLangfuse)}, fehlend ${sum.fehlend}, Dubletten ${sum.dubletten}, Erfassungsquote ${pct(sum.quote)}${sum.laeuft ? `; ${sum.laeuft} Session(s) läuft noch (Ruhefrist ${RUHEFRIST_MIN} min, nicht in Σ)` : ""}.`);
  for (const b of bewertungen.filter((x) => x.fehlendeCalls?.length)) {
    out.push("", `Fehlende Calls ${String(b.session).slice(0, 8)} (Schlüssel: ${b.schluessel}):`);
    for (const c of b.fehlendeCalls.slice(0, FEHLEND_ANZEIGE)) out.push(`- ${c.messageId} · ${c.ts} · ${c.model}`);
    if (b.fehlendeCalls.length > FEHLEND_ANZEIGE) out.push(`- … und ${b.fehlendeCalls.length - FEHLEND_ANZEIGE} weitere`);
  }
  out.push("", "Hinweis: Aufzeichnungen ohne TTL-Aufteilung der Cache-Writes (vor dem Hook-Patch, vor 2026-10-07) passen nicht auf den Fingerabdruck und erscheinen als fehlend plus Dublette.");
  return out.join("\n");
}

export const AUFRUFHILFE = "Aufruf: node scripts/langfuse-abgleich.mjs --pruefen [--seit <ISO>] [--session <id>] [--ist <datei>…] [--json]";
export const OHNE_ZUGANG = "Kein Langfuse-Zugang: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY fehlen. Agentenläufe haben den Secret-Key nicht: queryMetrics-Export aus dem Langfuse-MCP als --ist <datei> übergeben (View observations, Filter type = GENERATION, Dimension sessionId, Zählung: Metrik count; Tokens: Dimensionen sessionId und usageType, Metrik usageByType; jeweils orderBy desc, row_limit 1000, Export unter 1000 Zeilen: sonst enger fenstern oder je --session), siehe docs/model-routing.md › Checkliste Punkt 1.";

export function parseArgs(argv) {
  const a = { pruefen: false, json: false, seit: null, session: null, ist: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--pruefen") a.pruefen = true;
    else if (k === "--json") a.json = true;
    else if (k === "--seit") a.seit = argv[++i];
    else if (k === "--session") a.session = argv[++i];
    else if (k === "--ist") a.ist.push(argv[++i]);
  }
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
  for (const abfrage of [q.zaehlung, q.tokens]) rows.push(...(await holeMetrics(abfrage, zugang, fetchImpl)));
  return istAusMetrics(rows);
}

/** `--pruefen` ausführen: `{ exitCode, text }`. 0 = Bericht (auch mit Lücken: Messwerkzeug, kein Gate), 1 = Fehler beim Lesen/Abfragen, 2 = Aufruf oder Zugang fehlt. */
export async function pruefen(args, { env = process.env, now = Date.now(), projectsRoot, repoRoot, fetchImpl = fetch, leseDatei = readFileSync } = {}) {
  if (!args.pruefen) return { exitCode: 2, text: AUFRUFHILFE };
  const seitMs = args.seit ? Date.parse(args.seit) : now - 7 * 86_400_000;
  if (!Number.isFinite(seitMs)) return { exitCode: 2, text: `--seit ist keine ISO-Zeit: ${args.seit}\n${AUFRUFHILFE}` };
  let zugang = null;
  try {
    zugang = langfuseZugang(env, OHNE_ZUGANG);
  } catch (e) {
    if (!args.ist.length) return { exitCode: 2, text: e.message };
  }
  try {
    const sessions = findeSessions({ projectsRoot, praefix: projektSlug(repoRoot), seitMs, sessionId: args.session });
    const soll = new Map();
    const mtimes = new Map();
    for (const s of sessions) {
      const eintraege = sollEintraege(ladeSessionDatei(s.pfad), { session: s.id });
      if (eintraege.length) soll.set(s.id, eintraege);
      mtimes.set(s.id, s.mtime);
    }
    if (!soll.size) return { exitCode: 0, text: args.json ? JSON.stringify({ sessions: [], summe: summenzeile([]) }) : "Keine Sessions mit Calls im Fenster." };
    const ist = await istHolen({ args, soll, zugang, now, fetchImpl, leseDatei });
    const bewertungen = [];
    for (const [id, eintraege] of soll) {
      const istSession = ist.get(id) ?? { calls: 0, tokens: leereSumme() };
      const laeuft = now - mtimes.get(id) < RUHEFRIST_MIN * 60_000;
      let diff = null;
      if (zugang && !laeuft && hatDifferenz(eintraege, { calls: istSession.calls ?? 0, tokens: istSession.tokens })) {
        const obs = await fetchSessionObservations(id, { ...zugang, fetchImpl, type: "GENERATION", fields: "core,basic,model,usage,metadata" });
        diff = diffMultimenge(eintraege, obs);
      }
      bewertungen.push(bewerteSession({ soll: eintraege, ist: { calls: istSession.calls ?? 0, tokens: istSession.tokens }, mtime: mtimes.get(id), now, diff }));
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
  const { exitCode, text } = await pruefen(args, { projectsRoot: join(homedir(), ".claude", "projects"), repoRoot });
  (exitCode === 0 ? console.log : console.error)(text);
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
