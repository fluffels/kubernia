// Kein Shebang: wird von Messskripten und Tests importiert.
/**
 * Transkript → Calls (#1562, ausgelagert aus `token-baseline.mjs`). Hook-tauglich: importiert nur
 * `preise.mjs` und `transkript.mjs`, keine gh-/git-Kette (`transkript.mjs` ruft git nur in `hauptrepoWurzel()` auf Anfrage auf).
 */

import { num, priceCall, priceParts } from "./preise.mjs";
import { transkriptZeilen } from "./transkript.mjs";

/**
 * JSONL-Zeilen eines Transkripts → Calls. Claude Code schreibt pro Content-
 * Block eine Zeile mit derselben `message.id`; die Usage wird je Nachricht
 * genau einmal gezählt (Output = Maximum über die Zeilen, weil Zwischenzeilen
 * einen Teilstand tragen). Je Call zusätzlich `messageId` (Rückfall `uuid`), `sessionId`, `gitBranch`.
 */
export function callsFromTranscript(textOderZeilen, subagent = null) {
  const byId = new Map();
  let questions = 0;
  // Text oder die schon geparsten Zeilen (`transkriptZeilen`): `readTranscriptSession` parst jede Zeile nur einmal.
  for (const row of Array.isArray(textOderZeilen) ? textOderZeilen : transkriptZeilen(textOderZeilen)) {
    const msg = row?.message;
    if (row?.type !== "assistant" || !msg?.usage) continue;
    // Eine Zeile trägt genau einen Content-Block — jede Rückfrage zählt also einmal.
    for (const c of msg.content ?? []) if (c?.type === "tool_use" && c.name === "AskUserQuestion") questions += 1;
    const key = msg.id ?? row.uuid;
    const u = msg.usage;
    const prev = byId.get(key);
    if (prev) {
      prev.output = Math.max(prev.output, num(u.output_tokens));
      prev.costParts = priceParts(prev);
      prev.cost = prev.costParts ? priceCall(prev) : null;
      continue;
    }
    const call = {
      id: key,
      ts: row.timestamp,
      model: msg.model,
      input: num(u.input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
      // Ohne Aufteilung zählt alles als 5m (der günstigere Preis, bewusst nicht geraten).
      cacheWrite1h: num(u.cache_creation?.ephemeral_1h_input_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      output: num(u.output_tokens),
      subagent,
      // Für den Langfuse-Abgleich (#1562): Schlüssel der Nachricht, Session und Branch aus der ersten Zeile der Nachricht.
      messageId: key,
      sessionId: row.sessionId ?? null,
      gitBranch: row.gitBranch ?? null,
    };
    call.costParts = priceParts(call);
    call.cost = call.costParts ? priceCall(call) : null;
    byId.set(key, call);
  }
  return { calls: [...byId.values()], questions };
}


/**
 * Calls über mehrere Dateien einer Session zusammenführen (#1572): dieselbe `message.id` kann in der Hauptdatei und in einer
 * Subagent-Datei stehen und zählt dann einmal. Der erste Fund bestimmt Rolle und Zeitpunkt, der Output ist das Maximum;
 * Kosten werden aus dem zusammengeführten Stand neu berechnet. Die Eingabe bleibt unverändert.
 */
export function eindeutigeCalls(calls) {
  const byId = new Map();
  for (const c of calls) {
    const key = c.messageId ?? c.id;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, c);
      continue;
    }
    const output = Math.max(prev.output, c.output);
    if (output === prev.output) continue;
    const merged = { ...prev, output };
    merged.costParts = priceParts(merged);
    merged.cost = merged.costParts ? priceCall(merged) : null;
    byId.set(key, merged);
  }
  return [...byId.values()];
}
