// Kein Shebang, kein Direktaufruf: Lib für `langfuse-auftrag.mjs` (Einstieg des Agenten) und `langfuse-nachliefern.mjs` (Konvention #1398: Einstiegsskripte importieren nicht voneinander).
/**
 * Nachliefer-Aufträge (factory#213): ein Agent darf den Langfuse-Secret-Key nie lesen und startet kein Skript, das ihn liest (AGENTS.md › Kein Secret-Key im Agentenlauf).
 * Der Einstieg `langfuse-auftrag.mjs` ist der key-freie Weg dafür: er legt nur eine Session-ID in einer Zustandsdatei ab, ohne Zugang und ohne Netz. Ausgeführt wird der Auftrag
 * vom nächsten SessionStart-Lauf des Hooks (`langfuse-nachliefern.mjs`), der den Key im eigenen Prozess liest; der Lauf prüft die Session auch außerhalb des
 * 7-Tage-Fensters. Importiert nur Node-Builtins (`test/harness/langfuse-auftrag.test.ts` hält die Import-Hülle von Einstieg und Lib fest: der Beweis des Negativfalls
 * „der Agentenkontext liest den Key nie“).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const AUFTRAG_DATEI = "langfuse-nachliefer-auftraege.json";
/** Ein nie erledigter Auftrag (z.B. dauerhaft mehrdeutige Session) verfällt nach dieser Zeit. */
export const AUFTRAG_ALTER_MS = 7 * 86_400_000;
/** Session-IDs sind UUIDs; ein führendes `-` würde als Flag gelesen. */
export const SESSION_ID = /^[0-9A-Za-z][\w-]*$/;

function lies(stateDir) {
  try {
    const j = JSON.parse(readFileSync(join(stateDir, AUFTRAG_DATEI), "utf8"));
    return j && typeof j === "object" && j.auftraege && typeof j.auftraege === "object" ? j.auftraege : {};
  } catch {
    return {};
  }
}

/** Atomarer JSON-Zustandsschreiber (Ledger und Aufträge): Ordner anlegen, erst `<datei>.<pid>.tmp`, dann `rename`; je Prozess eigene Tmp-Datei, damit Agent und Hook nie dieselbe beschreiben. */
export function schreibeJsonAtomar(datei, wert) {
  mkdirSync(dirname(datei), { recursive: true });
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(wert, null, 2) + "\n");
  renameSync(tmp, datei);
}

function schreibe(stateDir, auftraege) {
  schreibeJsonAtomar(join(stateDir, AUFTRAG_DATEI), { version: 1, auftraege });
}

/** Legt den Auftrag ab; `false` bei einer ungültigen Session-ID (nichts geschrieben). */
export function auftragLegen(stateDir, session, now = Date.now()) {
  if (typeof session !== "string" || !SESSION_ID.test(session)) return false;
  schreibe(stateDir, { ...lies(stateDir), [session]: new Date(now).toISOString() });
  return true;
}

/** Offene Aufträge (Session-IDs, älteste zuerst); verfallene und ungültige zählen nicht. */
export function auftraegeLesen(stateDir, now = Date.now()) {
  return Object.entries(lies(stateDir))
    .filter(([id, zeit]) => SESSION_ID.test(id) && now - Date.parse(zeit) < AUFTRAG_ALTER_MS)
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
    .map(([id]) => id);
}

/** Entfernt einen Auftrag (auch einen verfallenen); ohne Datei oder Eintrag nichts zu tun. */
export function auftragErledigen(stateDir, session) {
  const auftraege = lies(stateDir);
  if (!(session in auftraege)) return;
  delete auftraege[session];
  schreibe(stateDir, auftraege);
}

export const AUFRUFHILFE = "Aufruf: node scripts/langfuse-auftrag.mjs <session-id>   (legt einen Nachliefer-Auftrag ab; der nächste SessionStart-Lauf liefert die Session nach)";

/** Einstieg: `{ exitCode, text }`; 0 = abgelegt, 2 = Aufruf falsch (keine oder mehr als eine Session-ID, ungültige ID, Flag). */
export function auftragAufruf(argv, stateDir, now = Date.now()) {
  if (argv.length !== 1) return { exitCode: 2, text: AUFRUFHILFE };
  if (!auftragLegen(stateDir, argv[0], now)) return { exitCode: 2, text: `ungültige Session-ID: ${argv[0]}\n${AUFRUFHILFE}` };
  return { exitCode: 0, text: `Auftrag abgelegt: ${argv[0]} (der nächste SessionStart-Lauf liefert nach)` };
}
