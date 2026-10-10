// Kein Shebang: wird von `langfuse-nachliefern.mjs` und den Tests importiert.
/**
 * OTLP/HTTP-JSON-Payloads für das Nachliefern fehlender Calls (#1577). PUR: keine Datei, kein Netz, keine Uhr.
 * Attributschlüssel nach `packages/shared/src/server/otel/attributes.ts` der Langfuse-Quelle. Jeder Span trägt die
 * Trace-Attribute (v4 ist observation-zentriert, die Ist-Abfrage filtert je Observation nach `sessionId`). Der Scope-Name
 * beginnt NICHT mit `langfuse-sdk`, sonst stuft Langfuse die Spans als SDK-Spans ein.
 */

import { priceParts, sumParts } from "./preise.mjs";
import { subagentSpanId, traceIdVon } from "./langfuse-abgleich-kern.mjs";

export const SCOPE_NAME = "kubernia-abgleich";
export const TRACE_NAME = "Abgleich";
/** Spans je OTLP-Request (Chunking: ein Fehler verwirft nie mehr als einen Chunk). */
export const MAX_SPANS_JE_REQUEST = 200;

/** Ein OTLP-Attribut: Strings als `stringValue`, Arrays als `arrayValue` (so liest Langfuse die Tags). */
export const attr = (key, wert) => ({
  key,
  value: Array.isArray(wert) ? { arrayValue: { values: wert.map((v) => ({ stringValue: String(v) })) } } : { stringValue: String(wert) },
});

/** Zeit als Nanosekunden-String (OTLP-JSON trägt 64-Bit-Zahlen als String). Ungültige Zeit: "0". */
export const nanos = (ts) => {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? String(BigInt(ms) * 1_000_000n) : "0";
};

/** Alle fünf Schlüssel wie beim Hook (auch bei 0), damit der 5m/1h-Split ankommt. */
export const usageDetails = (u) => ({
  input: u.input,
  output: u.output,
  cache_read_input_tokens: u.cacheRead,
  input_cache_creation_5m: u.cacheWrite5m,
  input_cache_creation_1h: u.cacheWrite1h,
});

/** Kosten in $ mit denselben Schlüsseln plus `total`; null ohne Preis (nie still 0). */
export function costDetails(e) {
  const parts = priceParts({
    model: e.model,
    ts: e.ts,
    input: e.usage.input,
    output: e.usage.output,
    cacheRead: e.usage.cacheRead,
    cacheWrite: e.usage.cacheWrite5m + e.usage.cacheWrite1h,
    cacheWrite1h: e.usage.cacheWrite1h,
  });
  if (!parts) return null;
  return {
    input: parts.input,
    output: parts.output,
    cache_read_input_tokens: parts.cacheRead,
    input_cache_creation_5m: parts.cacheWrite5m,
    input_cache_creation_1h: parts.cacheWrite1h,
    total: sumParts(parts),
  };
}

/** Trace-Attribute, die jeder Span trägt. `environment`/`user.id` nur, wenn gesetzt. */
export function traceAttribute({ session, tags, project, env = {} }) {
  const out = [attr("langfuse.session.id", session), attr("langfuse.trace.tags", tags), attr("langfuse.trace.name", TRACE_NAME), attr("langfuse.trace.metadata.project", project)];
  if (env.LANGFUSE_TRACING_ENVIRONMENT) out.push(attr("langfuse.environment", env.LANGFUSE_TRACING_ENVIRONMENT));
  if (env.LANGFUSE_USER_ID) out.push(attr("langfuse.user.id", env.LANGFUSE_USER_ID));
  return out;
}

const span = ({ traceId, spanId, parentSpanId, name, start, ende, attributes }) => ({
  traceId,
  spanId,
  ...(parentSpanId ? { parentSpanId } : {}),
  name,
  kind: 1,
  startTimeUnixNano: start,
  endTimeUnixNano: ende,
  attributes,
});

/** Eine Generation; `ctx` = `{ traceAttrs, parentSpanId? }`. Ohne Modell entfallen Modellname und Kosten, ohne Preis die Kosten. */
export function generationSpan(e, { traceAttrs, parentSpanId = null }) {
  const attributes = [attr("langfuse.observation.type", "generation")];
  if (e.model) attributes.push(attr("langfuse.observation.model.name", e.model));
  attributes.push(attr("langfuse.observation.usage_details", JSON.stringify(usageDetails(e.usage))));
  const kosten = e.model ? costDetails(e) : null;
  if (kosten) attributes.push(attr("langfuse.observation.cost_details", JSON.stringify(kosten)));
  attributes.push(attr("langfuse.observation.metadata.message_id", e.messageId), attr("langfuse.observation.metadata.quelle", "abgleich"), ...traceAttrs);
  return span({ traceId: e.traceId, spanId: e.id, parentSpanId, name: "Call", start: nanos(e.ts), ende: nanos(e.ts), attributes });
}

/** Span eines Subagenten (Name `Subagent: <description>`, `agent_type` in den Metadaten, damit `token-baseline --langfuse` die Phase zuordnet). */
export function subagentSpan(rolle, { traceAttrs, traceId, spanId, parentSpanId = null }, { von, bis }) {
  const attributes = [
    attr("langfuse.observation.type", "span"),
    attr("langfuse.observation.metadata.agent_type", rolle.agentType ?? "unbekannt"),
    attr("langfuse.observation.metadata.agent_id", rolle.agentId),
    attr("langfuse.observation.metadata.quelle", "abgleich"),
    ...traceAttrs,
  ];
  return span({ traceId, spanId, parentSpanId, name: `Subagent: ${rolle.description || rolle.agentType || "unbekannt"}`, start: nanos(von), ende: nanos(bis), attributes });
}

const normAgent = (id) => (id ? String(id).replace(/^agent-/, "") : null);

/** Agenten der Session (`agentId` → Rolle, früheste und späteste Call-Zeit) aus dem vollständigen Soll. */
function agentenVon(soll) {
  const agenten = new Map();
  for (const e of soll) {
    const id = e.rolle?.agentId;
    if (!id) continue;
    const a = agenten.get(id) ?? { rolle: e.rolle, von: e.ts, bis: e.ts };
    if (Date.parse(e.ts) < Date.parse(a.von)) a.von = e.ts;
    if (Date.parse(e.ts) > Date.parse(a.bis)) a.bis = e.ts;
    agenten.set(id, a);
  }
  return agenten;
}

/**
 * Payloads für `eintraege` (die zu sendenden Generationen) einer Session. `soll` = das vollständige Soll (Agenten, Zeiten, Tags),
 * `ledgerSpans` = schon gesendete Subagent-Spans (werden nicht erneut gesendet). Benötigte Eltern-Spans kommen mit; Spans
 * stehen im ersten Chunk vor den Generationen. → `{ chunks: [{ payload, generationIds, spanIds }] }`.
 */
export function bauePayloads(session, eintraege, { soll = eintraege, ledgerSpans = [], env = {}, project, maxSpans = MAX_SPANS_JE_REQUEST }) {
  const traceId = traceIdVon(session);
  const tags = ["kubernia", "abgleich", ...[...new Set(soll.map((e) => e.ticket).filter(Boolean))].sort()];
  const traceAttrs = traceAttribute({ session, tags, project, env });
  const agenten = agentenVon(soll);
  const spanIdVon = (agentId) => subagentSpanId(session, agentId);
  // Eltern-Agent bekannt → dessen Span, sonst Root (unbekannter oder fehlender Eltern-Agent).
  const elternVon = (a) => {
    const p = normAgent(a.rolle.parentAgentId);
    if (!p || p === a.rolle.agentId || !agenten.has(p)) return null;
    // Zyklus (a → b → a): den Eltern-Verweis kappen, damit der Span-Baum ein Baum bleibt.
    for (let id = p, n = 0; id && n <= agenten.size; n++) {
      if (id === a.rolle.agentId) return null;
      id = agenten.has(id) ? normAgent(agenten.get(id).rolle.parentAgentId) : null;
    }
    return spanIdVon(p);
  };
  // Benötigte Agenten: die der zu sendenden Calls samt aller Vorfahren.
  const noetig = new Set();
  for (const e of eintraege) {
    const kette = [];
    let id = e.rolle?.agentId;
    while (id && agenten.has(id) && !noetig.has(id) && !kette.includes(id)) {
      kette.push(id);
      const p = normAgent(agenten.get(id).rolle.parentAgentId);
      id = p && p !== id ? p : null;
    }
    for (const k of kette.reverse()) noetig.add(k); // Eltern vor Kindern
  }
  const schonGesendet = new Set(ledgerSpans);
  const spans = [];
  for (const id of noetig) {
    const sid = spanIdVon(id);
    if (schonGesendet.has(sid)) continue;
    const a = agenten.get(id);
    spans.push({ id: sid, span: subagentSpan(a.rolle, { traceAttrs, traceId, spanId: sid, parentSpanId: elternVon(a) }, a) });
  }
  const generationen = eintraege.map((e) => ({
    id: e.id,
    span: generationSpan(e, { traceAttrs, parentSpanId: e.rolle?.agentId && agenten.has(e.rolle.agentId) ? spanIdVon(e.rolle.agentId) : null }),
    gen: true,
  }));
  const alle = [...spans, ...generationen];
  const chunks = [];
  for (let i = 0; i < alle.length; i += maxSpans) {
    const teil = alle.slice(i, i + maxSpans);
    chunks.push({
      payload: {
        resourceSpans: [{ resource: { attributes: [attr("service.name", SCOPE_NAME)] }, scopeSpans: [{ scope: { name: SCOPE_NAME }, spans: teil.map((t) => t.span) }] }],
      },
      generationIds: teil.filter((t) => t.gen).map((t) => t.id),
      spanIds: teil.filter((t) => !t.gen).map((t) => t.id),
    });
  }
  return { chunks };
}
