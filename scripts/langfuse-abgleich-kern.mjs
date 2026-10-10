// Kein Shebang, kein Direktaufruf: Lib für `langfuse-abgleich.mjs`, `langfuse-nachliefern.mjs` und `langfuse-otlp.mjs` (#1579,
// Konvention #1398: Einstiegsskripte importieren nicht voneinander, gemeinsamer Code steht in einer Lib).
/**
 * Kern des Langfuse-Abgleichs: deterministische IDs, Soll aus dem Transkript (`sollEintraege`), Sessions finden, Ist-Abfragen
 * und -Auswertung, Multimengen-Diff. Pur bis auf `findeSessions` (Dateisystem) und `holeMetrics` (Netz über `fetchImpl`).
 * Bewertung, Bericht und CLI stehen in langfuse-abgleich.mjs, der Schreibweg in langfuse-nachliefern.mjs.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { istProjektOrdner } from "./transkript.mjs";
import { callsFromTranscript, eindeutigeCalls } from "./transkript-calls.mjs";
import { queryMetrics, usageAusObservation } from "./langfuse-api.mjs";

/** Obergrenze der Metrics-Zeilen; wird sie erreicht, ist das Ergebnis abgeschnitten (fail-closed, nie still kürzen). */
export const ROW_LIMIT = 1000;

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
export const leereSumme = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

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

export const summe = (soll) => soll.reduce((s, e) => ({ input: s.input + e.usage.input, output: s.output + e.usage.output, cacheRead: s.cacheRead + e.usage.cacheRead, cacheWrite: s.cacheWrite + e.usage.cacheWrite5m + e.usage.cacheWrite1h }), leereSumme());
export const gleich = (a, b) => a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite;

/** Weicht Zählung oder (verfügbare) Token-Summe ab? Nur dann lohnt der Observations-Abruf. */
export function hatDifferenz(soll, ist) {
  return ist.calls !== soll.length || (ist.tokens !== null && !gleich(summe(soll), ist.tokens));
}

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

