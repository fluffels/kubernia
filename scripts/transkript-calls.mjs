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
  const unsicher = new Set();
  let offen = null;
  // Text oder die schon geparsten Zeilen (`transkriptZeilen`): `readTranscriptSession` parst jede Zeile nur einmal.
  for (const row of Array.isArray(textOderZeilen) ? textOderZeilen : transkriptZeilen(textOderZeilen)) {
    const msg = row?.message;
    if (offen !== null) {
      if (row?.type === "user") {
        // Nur Tool-Ergebnisse haben eine verlässliche Größe; eigener Text (Aufträge, Skill-Inhalte) kommt mit unbekanntem Anhang in den Kontext.
        if (nurToolErgebnisse(msg?.content)) fremd.set(offen, (fremd.get(offen) ?? 0) + zeichenVon(msg?.content));
        else unsicher.add(offen);
      } else if (row?.type === "system") unsicher.add(offen);
      // Anhänge anderer Art (Hook-Ausgaben, Skill-Inhalte) gehen unbekannt groß in den Kontext: der Zuwachs taugt dann nicht.
      if (row?.type === "attachment") {
        if (KLEINE_ANHAENGE.has(row.attachment?.type)) fremd.set(offen, (fremd.get(offen) ?? 0) + JSON.stringify(row.attachment).length);
        else unsicher.add(offen);
      }
    }
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
  // Token je Zeichen Fremdtext ist je Transkript verschieden (Code und Zeilennummern tokenisieren dichter als Prosa):
  // die kleinste Rate, die zu einem Output von mindestens dem Sichtbaren passt, ist eine obere Grenze der echten Rate,
  // der daraus geschätzte Output also eine Untergrenze (#1568).
  const luecken = calls.map((c, i) => {
    const naechster = calls[i + 1];
    c.outputSichtbar = Math.ceil((sichtbar.get(c.id) ?? 0) / 4);
    if (!naechster || unsicher.has(c.id)) return null;
    return { zuwachs: kontextVon(naechster) - kontextVon(c), zeichen: fremd.get(c.id) ?? 0 };
  });
  const rate = ratesGrenze(luecken.map((l, i) => (l ? { ...l, sichtbar: calls[i].outputSichtbar } : null)));
  calls.forEach((c, i) => {
    const l = luecken[i];
    const zuwachs = l ? Math.round(l.zuwachs - rate * l.zeichen) : 0;
    c.outputGeschaetzt = schaetzeOutput({ output: c.output, sichtbar: c.outputSichtbar, zuwachs });
    c.costGeschaetzt = preisMitOutput(c, c.outputGeschaetzt);
  });
  return { calls, questions };
}

/** Anhänge, die nur wenige Token in den Kontext bringen und deren Zeichen daher mitzählen. */
const KLEINE_ANHAENGE = new Set(["total_tokens_reminder", "deferred_tools_record"]);

const kontextVon = (c) => num(c.input) + num(c.cacheWrite) + num(c.cacheRead);

const nurToolErgebnisse = (content) => Array.isArray(content) && content.length > 0 && content.every((b) => b?.type === "tool_result");

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

/** Kleinste Token-je-Zeichen-Rate über alle Lücken mit Fremdtext (Obergrenze der echten Rate); 0,25 (Zeichen / 4) ohne Lücke. */
export function ratesGrenze(luecken) {
  let rate = Infinity;
  for (const l of luecken) if (l && l.zeichen > 0 && l.zuwachs > 0) rate = Math.min(rate, Math.max(0, l.zuwachs - l.sichtbar) / l.zeichen);
  return Number.isFinite(rate) ? rate : 0.25;
}

/**
 * Output-Schätzung (#1568): der Kontext-Zuwachs bis zum nächsten Call, abzüglich der Fremdtexte (Zeichen mal Rate, `ratesGrenze`), ist
 * der Output dieses Calls (inklusive Thinking). Ohne Nachfolger oder bei schrumpfendem Kontext (Verdichtung) bleibt
 * das Sichtbare (ebenso bei Anhängen unbekannter Größe); Untergrenze, kein Messwert; nie unter dem Sichtbaren und nie unter dem aufgezeichneten Wert.
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
