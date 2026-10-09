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
 * mit gleichem Namensanfang. Importiert nur Builtins und die hook-tauglichen Module (`preise`, `transkript`, `transkript-calls`, `langfuse-api`), damit es
 * später als Hook laufen kann, ohne die gh-/git-Kette von `token-baseline.mjs` mitzuziehen. Aufruf und Einordnung:
 * docs/model-routing.md › Checkliste Punkt 1. Den Schreibweg (nur fehlende Calls nachliefern) trägt `langfuse-nachliefern.mjs`.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hauptrepoPfad, istProjektOrdner, ladeSessionDatei, projektSlug } from "./transkript.mjs";
import { callsFromTranscript, eindeutigeCalls } from "./transkript-calls.mjs";
import { fetchSessionObservations, langfuseZugang, queryMetrics, usageAusObservation } from "./langfuse-api.mjs";

/** Eine Session, deren Dateien jünger sind, läuft noch: ihre Calls sind noch nicht (vollständig) in Langfuse. */
export const RUHEFRIST_MIN = 30;
/** Obergrenze der Metrics-Zeilen; wird sie erreicht, ist das Ergebnis abgeschnitten (fail-closed, nie still kürzen). */
export const ROW_LIMIT = 1000;
const FEHLEND_ANZEIGE = 20;

const sha = (text) => createHash("sha256").update(text).digest("hex");
/** Observation-ID: 16 Hex, deterministisch aus Session und Message (idempotentes Nachtragen in 2/3). */
export const beobachtungsId = (session, messageId) => sha(session + messageId).slice(0, 16);
/** Trace-ID: 32 Hex, je Session ein Abgleich-Trace. */
export const traceIdVon = (session) => sha(session).slice(0, 32);
/** Span-ID eines Subagenten: 16 Hex, deterministisch aus Session und Agent-ID (Nachliefern sendet den Span je Session einmal). */
export const subagentSpanId = (session, agentId) => sha(session + "agent:" + agentId).slice(0, 16);
/** Score-ID: 32 Hex, deterministisch aus Name und Session (Upsert statt Dublette). */
export const scoreId = (session, name) => sha("score:" + name + ":" + session).slice(0, 32);

// ── Soll (pur) ───────────────────────────────────────────────────────────────

/** `kq-<nr>` aus dem Branch-Namen, sonst null. */
export function ticketAusBranch(gitBranch) {
  const m = /\bkq-(\d+)\b/.exec(String(gitBranch ?? ""));
  return m ? `kq-${m[1]}` : null;
}

/**
 * Ergebnis von `ladeSessionDatei` → ein Eintrag je Message (`message.id`, Rückfall `uuid`) über Hauptdatei und Subagenten.
 * Eine Message in mehreren Dateien zählt einmal (Output = Maximum, der erste Fund bestimmt die Rolle).
 */
export function sollEintraege(sitzung, { session = sitzung.id } = {}) {
  const quellen = [
    { zeilen: sitzung.main, rolle: null },
    ...sitzung.subagents.map((s) => ({
      zeilen: s.zeilen,
      rolle: {
        agentId: s.datei.replace(/\.jsonl$/, "").replace(/^agent-/, ""),
        agentType: s.meta?.agentType,
        description: s.meta?.description,
        parentAgentId: s.meta?.parentAgentId,
      },
    })),
  ];
  // Dieselbe Zusammenführung wie `readTranscriptSession` (token-baseline): die Rolle steht als `subagent` am Call.
  const calls = eindeutigeCalls(quellen.flatMap(({ zeilen, rolle }) => callsFromTranscript(zeilen, rolle).calls));
  return calls.map((c) => {
    const write1h = Math.min(c.cacheWrite1h, c.cacheWrite);
    return {
      id: beobachtungsId(session, c.messageId),
      traceId: traceIdVon(session),
      session,
      messageId: c.messageId,
      model: c.model ?? null,
      ts: c.ts,
      usage: { input: c.input, output: c.output, cacheRead: c.cacheRead, cacheWrite5m: c.cacheWrite - write1h, cacheWrite1h: write1h },
      rolle: c.subagent,
      ticket: ticketAusBranch(c.gitBranch),
    };
  });
}

/** Projektordner unter `~/.claude/projects` aus dem Repo-Pfad: die gemeinsame Ableitung aus `transkript.mjs` (Worktrees gelten als Hauptrepo). */
export const projektPraefix = projektSlug;

/** Wurzel des Hauptrepos: ein Worktree-Pfad wird gekürzt, ein Schlussstrich entfällt (gemeinsam mit `projektSlug`). */
export const repoWurzel = hauptrepoPfad;
}

const jsonlDateien = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".jsonl")) : []);

/**
 * Sessions des Projekts: `[{ id, pfad, mtime, groesse }]` (mtime = jüngste Datei der Session, groesse = Bytes von Haupt- und Subagent-Dateien).
 * Nur der Ordner `<präfix>` selbst und `<präfix>--claude-worktrees-…` zählen (kein Geschwister-Repo wie `<präfix>-tools`).
 * `seitMs` filtert nach mtime, `sessionId` gilt unabhängig davon.
 */
export function findeSessions({ projectsRoot, praefix, seitMs = 0, sessionId = null }) {
  if (!existsSync(projectsRoot)) return [];
  const out = new Map();
  for (const d of readdirSync(projectsRoot).filter((n) => istProjektOrdner(n, praefix))) {
    for (const datei of jsonlDateien(join(projectsRoot, d))) {
      const id = datei.replace(/\.jsonl$/, "");
      if (sessionId && id !== sessionId) continue;
      const pfad = join(projectsRoot, d, datei);
      const subDir = join(projectsRoot, d, id, "subagents");
      const stats = [statSync(pfad), ...jsonlDateien(subDir).map((n) => statSync(join(subDir, n)))];
      const mtime = Math.max(...stats.map((s) => s.mtimeMs));
      if (!sessionId && mtime < seitMs) continue;
      const prev = out.get(id);
      if (!prev || prev.mtime < mtime) out.set(id, { id, pfad, mtime, groesse: stats.reduce((s, x) => s + x.size, 0) });
    }
  }
  return [...out.values()].sort((a, b) => a.mtime - b.mtime);
}

// ── Ist (Abfrage bauen, Antwort lesen) ───────────────────────────────────────

/** Die zwei Metrics-Abfragen: Zählung und Token-Summen je Session (High-Cardinality-Dimension braucht `row_limit` und `orderBy desc`). */
export function istAbfragen({ von, bis, session = null }) {
  const filters = [{ column: "type", operator: "=", value: "GENERATION", type: "string" }];
  if (session) filters.push({ column: "sessionId", operator: "=", value: session, type: "string" });
  const basis = { view: "observations", filters, fromTimestamp: von, toTimestamp: bis, config: { row_limit: ROW_LIMIT } };
  return {
    zaehlung: { ...basis, dimensions: [{ field: "sessionId" }], metrics: [{ measure: "count", aggregation: "count" }], orderBy: [{ field: "count_count", direction: "desc" }] },
    tokens: {
      ...basis,
      dimensions: [{ field: "sessionId" }, { field: "usageType" }],
      metrics: [{ measure: "usageByType", aggregation: "sum" }],
      orderBy: [{ field: "sum_usageByType", direction: "desc" }],
    },
  };
}

const zahl = (v) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const leereSumme = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * Metrics-Zeilen (`{data:[…]}` oder nacktes Array; Zahlen auch als String) → `Map<sessionId, { calls, tokens }>`.
 * `calls` ohne Zählzeile null, `tokens` ohne usageType-Zeilen null. Eine unbekannte Form wirft.
 */
export function istAusMetrics(zeilen) {
  const rows = Array.isArray(zeilen) ? zeilen : zeilen?.data;
  if (!Array.isArray(rows)) throw new Error("Unbekannte Metrics-Form: erwartet {data:[…]} oder ein Array von Zeilen mit sessionId.");
  const map = new Map();
  const typen = new Map();
  for (const r of rows) {
    if (typeof r?.sessionId !== "string") throw new Error("Unbekannte Metrics-Zeile ohne sessionId (View observations, Dimension sessionId erwartet).");
    const e = map.get(r.sessionId) ?? { calls: null, tokens: null };
    map.set(r.sessionId, e);
    const count = zahl(r.count_count);
    if (count !== null) e.calls = (e.calls ?? 0) + count;
    const wert = zahl(r.sum_usageByType);
    if (typeof r.usageType === "string" && wert !== null) {
      const t = typen.get(r.sessionId) ?? {};
      t[r.usageType] = (t[r.usageType] ?? 0) + wert;
      typen.set(r.sessionId, t);
    }
  }
  for (const [id, t] of typen) {
    const geteilt = "input_cache_creation_5m" in t || "input_cache_creation_1h" in t;
    const s = leereSumme();
    s.input = t.input ?? 0;
    s.output = t.output ?? 0;
    s.cacheRead = t.cache_read_input_tokens ?? 0;
    s.cacheWrite = geteilt ? (t.input_cache_creation_5m ?? 0) + (t.input_cache_creation_1h ?? 0) : (t.cache_creation_input_tokens ?? 0);
    map.get(id).tokens = s;
  }
  return map;
}

// ── Diff (pur) ───────────────────────────────────────────────────────────────

const fingerabdruck = (modell, u) => [modell ?? "", u.input, u.output, u.cacheRead, u.cacheWrite5m, u.cacheWrite1h].join("|");

/** `messageId`, wenn ALLE Observations eine Message-ID tragen (`metadata.message_id`), sonst `fingerprint` (Modell + fünf Token-Felder). */
export function schluesselArt(observations) {
  return observations.length > 0 && observations.every((o) => typeof o?.metadata?.message_id === "string" && o.metadata.message_id) ? "messageId" : "fingerprint";
}

/**
 * Multimenge Soll minus Ist: `fehlend` = Soll-Einträge ohne Gegenstück, `dubletten` = überzählige Ist-Observations
 * (nur melden, nie löschen). Jede Observation deckt höchstens einen Soll-Eintrag.
 */
export function diffMultimenge(soll, observations, art = schluesselArt(observations)) {
  const istSchluessel = (o) => (art === "messageId" ? o.metadata.message_id : fingerabdruck(o.providedModelName ?? o.model, usageAusObservation(o)));
  const sollSchluessel = (e) => (art === "messageId" ? e.messageId : fingerabdruck(e.model, e.usage));
  const frei = new Map();
  for (const o of observations) {
    const k = istSchluessel(o);
    frei.set(k, [...(frei.get(k) ?? []), o]);
  }
  const fehlend = [];
  for (const e of soll) {
    const treffer = frei.get(sollSchluessel(e));
    if (treffer?.length) treffer.shift();
    else fehlend.push(e);
  }
  return { fehlend, dubletten: [...frei.values()].flat(), art };
}

const summe = (soll) => soll.reduce((s, e) => ({ input: s.input + e.usage.input, output: s.output + e.usage.output, cacheRead: s.cacheRead + e.usage.cacheRead, cacheWrite: s.cacheWrite + e.usage.cacheWrite5m + e.usage.cacheWrite1h }), leereSumme());
const gleich = (a, b) => a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite;

/** Weicht Zählung oder (verfügbare) Token-Summe ab? Nur dann lohnt der Observations-Abruf. */
export function hatDifferenz(soll, ist) {
  return ist.calls !== soll.length || (ist.tokens !== null && !gleich(summe(soll), ist.tokens));
}

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

/**
 * Eine Metrics-Abfrage; erreicht sie `ROW_LIMIT`, wird das Zeitfenster halbiert und die Teile werden zusammengeführt
 * (Zählung und Summen sind je Observation-Startzeit additiv, `istAusMetrics` addiert gleiche Sessions). Unter 2 h Fenster
 * ist Schluss: dann abgeschnitten (fail-closed, nie still kürzen).
 */
export async function holeMetrics(abfrage, zugang, fetchImpl) {
  const rows = await queryMetrics(abfrage, { ...zugang, fetchImpl });
  if (rows.length < ROW_LIMIT) return rows;
  const von = Date.parse(abfrage.fromTimestamp);
  const bis = Date.parse(abfrage.toTimestamp);
  if (bis - von < 2 * 3_600_000) throw new Error(`Metrics-Antwort abgeschnitten (${rows.length} Zeilen = row_limit): Fenster unter 2 h noch zu voll, --session nutzen.`);
  // Beide Hälften teilen die Grenze `mitte`; eine Observation exakt auf dieser Millisekunde ist praktisch ausgeschlossen.
  const mitte = new Date((von + bis) / 2).toISOString();
  return [...(await holeMetrics({ ...abfrage, toTimestamp: mitte }, zugang, fetchImpl)), ...(await holeMetrics({ ...abfrage, fromTimestamp: mitte }, zugang, fetchImpl))];
}

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
    const sessions = findeSessions({ projectsRoot, slug: projektSlug(repoRoot), seitMs, sessionId: args.session });
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
