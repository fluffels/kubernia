// Kein Shebang: wird von Messskripten und Tests importiert.
/**
 * Langfuse-REST-Zugriff (#1562, ausgelagert aus `token-baseline.mjs`). Nur Builtins und globales `fetch`:
 * der Abgleich läuft später als Hook, die gh-/git-Kette von `token-baseline.mjs` darf nicht mitkommen.
 */

/** Alle Observations einer Session über die v2-API holen (cursor-paginiert). */
export async function fetchSessionObservations(
  sessionId,
  { baseUrl, publicKey, secretKey, fetchImpl = fetch, type, name, fields = "core,basic,model,usage,metadata" },
) {
  const auth = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const out = [];
  let cursor;
  do {
    const q = new URLSearchParams({ sessionId, limit: "1000", fields });
    if (type) q.set("type", type);
    if (name) q.set("name", name);
    if (cursor) q.set("cursor", cursor);
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/public/v2/observations?${q}`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) throw new Error(`Langfuse ${res.status}: ${await res.text()}`);
    const body = await res.json();
    out.push(...(body.data ?? []));
    cursor = body.meta?.cursor;
  } while (cursor);
  return out;
}

/** Zugangsdaten aus der Umgebung; ohne Secret-Key (Agentenläufe haben ihn nicht) wirft es `meldung` (Ersatzweg-Hinweis des Aufrufers). */
export function langfuseZugang(env, meldung = "LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY fehlen.") {
  const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = env;
  if (!publicKey || !secretKey) throw new Error(meldung);
  return { baseUrl: env.LANGFUSE_BASE_URL ?? "http://localhost:3000", publicKey, secretKey };
}
