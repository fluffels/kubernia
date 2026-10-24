#!/usr/bin/env node
/* Langfuse-Vorbedingung (#1663 L36): ohne erreichbares Langfuse startet kein Entwicklungslauf, sonst wird nichts getrackt.
 *
 *   node scripts/langfuse-vorbedingung.mjs                 prüft GET <Langfuse>/api/public/health; Exit 0 = erreichbar, 1 = aus, 2 = Aufruffehler
 *   node scripts/langfuse-vorbedingung.mjs --sessionstart  SessionStart-Hook: Exit immer 0, bei Ausfall steht die Warnung als JSON auf stdout (`systemMessage` für die Nutzerin, `additionalContext` für die Session)
 *   node scripts/langfuse-vorbedingung.mjs --json         maschinenlesbar für das Cockpit: stdout `{"erreichbar":bool,"grund":string|null}`, Exit-Codes wie ohne Flag; nicht mit --sessionstart kombinierbar (Exit 2)
 *
 * Aufrufer: der Ticket-Skill (Schritt 0); bewusst NICHT im Board-Takt.
 * Bekannte Grenze: prüft nur /api/public/health, nicht die MCP-Verbindung der Session; die verbindet beim Session-Start vor Schritt 0 (Ausfall: mcp-ausfall.mjs).
 * Adresse: `LANGFUSE_BASE_URL` (Umgebung, sonst Plugin-Optionen der User-Settings via `basisUrlAus` aus langfuse-zugang.mjs, nie Secret-Dateien), sonst http://localhost:3000. Reines Node-Skript (nur Builtins); die Bewertung ist pur, fetch wird injiziert. */
import { homedir } from "node:os";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { basisUrlAus, langfuseBasisUrl } from "./langfuse-zugang.mjs";

export const HEALTH_PFAD = "/api/public/health";
export const FRIST_MS = 3000;
const HINWEIS = "Langfuse aus, bitte starten (lokal: Rancher Desktop prüfen, notfalls `rdctl shutdown` und `rdctl start`, FAQ „Langfuse lokal aus“).";

/** Urteil aus HTTP-Status oder Verbindungsfehler; ohne beides gilt es als nicht erreichbar. Pur. */
export function bewerteHealth({ status, fehler } = {}) {
  if (status === 200) return { ok: true, grund: "Langfuse erreichbar (HTTP 200)" };
  if (typeof status === "number") return { ok: false, grund: `Langfuse antwortet mit HTTP ${status}` };
  if (fehler) return { ok: false, grund: `Langfuse nicht erreichbar: ${fehler}` };
  return { ok: false, grund: "Langfuse nicht erreichbar: keine Antwort" };
}

/** Basis-URL aus der Umgebung ohne Schrägstrich am Ende. Pur. */
export const basisUrl = langfuseBasisUrl;

/** Fragt den Health-Endpunkt mit Frist ab und bewertet die Antwort. Wirft nie. */
export async function pruefeLangfuse({ baseUrl, fetchImpl = fetch, fristMs = FRIST_MS }) {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), fristMs);
  try {
    const res = await fetchImpl(`${baseUrl}${HEALTH_PFAD}`, { signal: abbruch.signal });
    return bewerteHealth({ status: res.status });
  } catch (e) {
    if (abbruch.signal.aborted) return bewerteHealth({ fehler: `Timeout nach ${fristMs} ms` });
    return bewerteHealth({ fehler: e?.cause?.code ?? e?.code ?? e?.message ?? String(e) });
  } finally {
    clearTimeout(uhr);
  }
}

const USAGE = "Aufruf: node scripts/langfuse-vorbedingung.mjs [--sessionstart | --json]";

export async function main(argv = process.argv.slice(2), env = process.env, out = console.log, err = console.error, { fetchImpl = fetch, fristMs = FRIST_MS, home = homedir(), lies } = {}) {
  const { werte, fehler } = flagsLesen(argv, { sessionstart: { type: "boolean" }, json: { type: "boolean" } });
  const aufrufFehler = fehler?.text ?? (werte.sessionstart && werte.json ? "--json und --sessionstart schließen sich aus" : null);
  if (aufrufFehler) {
    err(`${aufrufFehler}. ${USAGE}`);
    return AUFRUF_EXIT;
  }
  const sessionstart = werte.sessionstart === true;
  const urteil = await pruefeLangfuse({ baseUrl: basisUrl({ LANGFUSE_BASE_URL: basisUrlAus(env, home, lies) }), fetchImpl, fristMs });
  if (werte.json === true) {
    out(JSON.stringify({ erreichbar: urteil.ok, grund: urteil.ok ? null : urteil.grund }));
    return urteil.ok ? 0 : 1;
  }
  if (urteil.ok) return 0;
  const text = `${urteil.grund}. ${HINWEIS}`;
  if (sessionstart) {
    const warnung = `WARNUNG Langfuse-Vorbedingung: ${text} Ohne Langfuse startet kein Ticket.`;
    out(JSON.stringify({ systemMessage: warnung, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: warnung } }));
    return 0;
  }
  err(text);
  return 1;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
