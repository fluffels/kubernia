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
 * einen Teilstand tragen). Subagent-Transkripte zeichnen den Output nur beim Stand `message_start` auf (3 bis 8 je
 * Nachricht, #1568); `output` und `cost` bleiben der aufgezeichnete Wert, `outputGeschaetzt`/`costGeschaetzt`
 * ergänzen die Schätzung aus dem Kontext-Zuwachs (`schaetzeOutput`). Je Call zusätzlich `messageId` (Rückfall `uuid`), `sessionId`, `gitBranch`.
 */
export function callsFromTranscript(textOderZeilen, subagent = null) {
  const byId = new Map();
  let questions = 0;
  /** Zeichen der Texte und Tool-Eingaben je Call und Fremdzuwachs (User-Zeilen) bis zum nächsten Call. */
  const sichtbar = new Map();
  const fremd = new Map();
  let offen = null;
  // Text oder die schon geparsten Zeilen (`transkriptZeilen`): `readTranscriptSession` parst jede Zeile nur einmal.
  for (const row of Array.isArray(textOderZeilen) ? textOderZeilen : transkriptZeilen(textOderZeilen)) {
    const msg = row?.message;
    if (row?.type === "user" && offen !== null) fremd.set(offen, (fremd.get(offen) ?? 0) + zeichenVon(msg?.content));
    if (row?.type !== "assistant" || !msg?.usage) continue;
    // Eine Zeile trägt genau einen Content-Block — jede Rückfrage zählt also einmal.
    for (const c of msg.content ?? []) if (c?.type === "tool_use" && c.name === "AskUserQuestion") questions += 1;
    const key = msg.id ?? row.uuid;
    const u = msg.usage;
    const prev = byId.get(key);
    sichtbar.set(key, (sichtbar.get(key) ?? 0) + sichtbareZeichen(msg.content));
    offen = key;
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
  const calls = [...byId.values()];
  calls.forEach((c, i) => {
    const naechster = calls[i + 1];
    const zuwachs = naechster ? kontextVon(naechster) - kontextVon(c) - Math.round((fremd.get(c.id) ?? 0) / 4) : 0;
    c.outputSichtbar = Math.ceil((sichtbar.get(c.id) ?? 0) / 4);
    c.outputGeschaetzt = schaetzeOutput({ output: c.output, sichtbar: c.outputSichtbar, zuwachs });
    c.costGeschaetzt = preisMitOutput(c, c.outputGeschaetzt);
  });
  return { calls, questions };
}

const kontextVon = (c) => num(c.input) + num(c.cacheWrite) + num(c.cacheRead);

/** Zeichen eines Content-Werts (Text oder Blöcke: Text, `tool_result`-Inhalt), ohne Binäres zu raten. */
function zeichenVon(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const b of content) {
    if (typeof b === "string") n += b.length;
    else if (b?.type === "text") n += (b.text ?? "").length;
    else if (b?.type === "tool_result") n += zeichenVon(b.content);
  }
  return n;
}

/** Sichtbarer Output einer Assistant-Zeile: Text plus Tool-Eingabe als JSON (Thinking ist verschlüsselt, zählt nicht). */
function sichtbareZeichen(content) {
  let n = 0;
  for (const b of content ?? []) {
    if (b?.type === "text") n += (b.text ?? "").length;
    else if (b?.type === "tool_use") n += JSON.stringify(b.input ?? {}).length;
  }
  return n;
}

/**
 * Output-Schätzung (#1568): der Kontext-Zuwachs bis zum nächsten Call, abzüglich der Fremdtexte (Zeichen / 4), ist
 * der Output dieses Calls (inklusive Thinking). Ohne Nachfolger oder bei schrumpfendem Kontext (Verdichtung) bleibt
 * das Sichtbare; nie unter dem Sichtbaren und nie unter dem aufgezeichneten Wert.
 */
export function schaetzeOutput({ output, sichtbar, zuwachs }) {
  return Math.max(output, sichtbar, zuwachs > 0 ? zuwachs : 0);
}

function preisMitOutput(c, output) {
  const parts = priceParts({ ...c, output });
  return parts ? priceCall({ ...c, output, costParts: parts }) : null;
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
    const geschaetzt = Math.max(prev.outputGeschaetzt ?? 0, c.outputGeschaetzt ?? 0);
    if (output === prev.output && geschaetzt === (prev.outputGeschaetzt ?? 0)) continue;
    const merged = { ...prev, output, outputSichtbar: Math.max(prev.outputSichtbar ?? 0, c.outputSichtbar ?? 0) };
    merged.costParts = priceParts(merged);
    merged.cost = merged.costParts ? priceCall(merged) : null;
    if (geschaetzt > 0 || prev.outputGeschaetzt !== undefined) {
      merged.outputGeschaetzt = geschaetzt;
      merged.costGeschaetzt = preisMitOutput(merged, geschaetzt);
    }
    byId.set(key, merged);
  }
  return [...byId.values()];
}
