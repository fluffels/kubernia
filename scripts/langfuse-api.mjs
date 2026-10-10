// Kein Shebang: wird von Messskripten und Tests importiert.
/**
 * Langfuse-REST-Zugriff (#1562, ausgelagert aus `token-baseline.mjs`). Nur Builtins und globales `fetch`:
 * der Abgleich läuft später als Hook, die gh-/git-Kette von `token-baseline.mjs` darf nicht mitkommen.
 */

/** Frist je Anfrage (das Signal gilt auch für das Lesen des Antworttexts; die lesbare Meldung gibt es nur für den Fetch selbst): danach bricht der Aufruf ab, damit kein Lauf länger hängt als sein Lock. */
export const ANFRAGE_FRIST_MS = 30_000;

/** `fetchImpl` mit Abbruch-Signal; ein Ablauf wirft einen Fehler mit lesbarer Meldung (ohne `status`). */
async function mitFrist(fetchImpl, url, init, fristMs) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(fristMs) });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error(`Langfuse antwortete nicht innerhalb von ${Math.round(fristMs / 1000)} s (${new URL(url).pathname})`, { cause: e });
    }
    throw e;
  }
}

const zahl = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Token-Felder einer Langfuse-GENERATION, vereinheitlicht. Die Hook-Aufzeichnung trennt die Cache-Writes nach TTL
 * (`input_cache_creation_5m|1h`); ältere Aufzeichnungen tragen nur die Summe (`cache_creation_input_tokens`, zählt als 5m).
 */
export function usageAusObservation(o) {
  const u = o?.usageDetails ?? {};
  const geteilt = u.input_cache_creation_5m !== undefined || u.input_cache_creation_1h !== undefined;
  return {
    input: zahl(u.input),
    output: zahl(u.output),
    cacheRead: zahl(u.cache_read_input_tokens),
    cacheWrite5m: geteilt ? zahl(u.input_cache_creation_5m) : zahl(u.cache_creation_input_tokens),
    cacheWrite1h: geteilt ? zahl(u.input_cache_creation_1h) : 0,
  };
}

/** Bei einer Fehlerantwort mit dem HTTP-Status (`.status`) werfen; das Protokoll des Nachlieferers weist ihn aus. */
async function wirfHttp(res) {
  if (res.ok) return;
  throw Object.assign(new Error(`Langfuse ${res.status}: ${await res.text()}`), { status: res.status });
}

/** Eine Metrics-Abfrage (v2, nur lesend: GET) → die Zeilen `data`. `fetchImpl` ist für Tests injizierbar. */
export async function queryMetrics(query, { baseUrl, publicKey, secretKey, fetchImpl = fetch, fristMs = ANFRAGE_FRIST_MS }) {
  const auth = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const url = `${baseUrl.replace(/\/$/, "")}/api/public/v2/metrics?query=${encodeURIComponent(JSON.stringify(query))}`;
  const res = await mitFrist(fetchImpl, url, { headers: { Authorization: auth } }, fristMs);
  await wirfHttp(res);
  const body = await res.json();
  return body.data ?? [];
}

/** Alle Observations einer Session über die v2-API holen (cursor-paginiert). */
export async function fetchSessionObservations(
  sessionId,
  { baseUrl, publicKey, secretKey, fetchImpl = fetch, fristMs = ANFRAGE_FRIST_MS, type, name, fields = "core,basic,model,usage,metadata" },
) {
  const auth = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const out = [];
  let cursor;
  do {
    const q = new URLSearchParams({ sessionId, limit: "1000", fields });
    if (type) q.set("type", type);
    if (name) q.set("name", name);
    if (cursor) q.set("cursor", cursor);
    const res = await mitFrist(fetchImpl, `${baseUrl.replace(/\/$/, "")}/api/public/v2/observations?${q}`, { headers: { Authorization: auth } }, fristMs);
    await wirfHttp(res);
    const body = await res.json();
    out.push(...(body.data ?? []));
    cursor = body.meta?.cursor;
  } while (cursor);
  return out;
}

const basisAuth = ({ publicKey, secretKey }) => "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

/**
 * Spans per OTLP/HTTP-JSON senden (einziger Schreibweg des Nachlieferers; Version 4 = observation-zentrierte Ingestion).
 * Wirft mit `.status` bei HTTP-Fehler und bei `partialSuccess.rejectedSpans > 0` (die Ingestion lehnte Spans ab).
 */
export async function sendeOtlp(payload, { baseUrl, publicKey, secretKey, fetchImpl = fetch, fristMs = ANFRAGE_FRIST_MS }) {
  const res = await mitFrist(
    fetchImpl,
    `${baseUrl.replace(/\/$/, "")}/api/public/otel/v1/traces`,
    {
      method: "POST",
      headers: { Authorization: basisAuth({ publicKey, secretKey }), "Content-Type": "application/json", "x-langfuse-ingestion-version": "4" },
      body: JSON.stringify(payload),
    },
    fristMs,
  );
  await wirfHttp(res);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null; // Antwort ohne JSON: kein partialSuccess auswertbar, der HTTP-Status war schon 2xx
  }
  const abgelehnt = Number(body?.partialSuccess?.rejectedSpans ?? 0);
  if (abgelehnt > 0) throw new Error(`Langfuse lehnte ${abgelehnt} Span(s) ab: ${body.partialSuccess.errorMessage ?? "ohne Grund"}`);
  return body;
}

/** Einen Score anlegen oder (bei gleicher `id`) überschreiben. */
export async function sendeScore(score, { baseUrl, publicKey, secretKey, fetchImpl = fetch, fristMs = ANFRAGE_FRIST_MS }) {
  const res = await mitFrist(
    fetchImpl,
    `${baseUrl.replace(/\/$/, "")}/api/public/scores`,
    { method: "POST", headers: { Authorization: basisAuth({ publicKey, secretKey }), "Content-Type": "application/json" }, body: JSON.stringify(score) },
    fristMs,
  );
  await wirfHttp(res);
}

/** Zugangsdaten aus der Umgebung; ohne Secret-Key (Agentenläufe haben ihn nicht) wirft es `meldung` (Ersatzweg-Hinweis des Aufrufers). */
export function langfuseZugang(env, meldung = "LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY fehlen.") {
  const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = env;
  if (!publicKey || !secretKey) throw new Error(meldung);
  return { baseUrl: env.LANGFUSE_BASE_URL ?? "http://localhost:3000", publicKey, secretKey };
}
