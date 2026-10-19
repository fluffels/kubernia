// Kein Shebang: wird vom PreToolUse-Dispatcher (`scripts/pretooluse-hook.mjs`) und vom Wächter-Test importiert.
/**
 * Holdout-Auftrags-Guard (ADR 0022 F13): die Szenarien der Holdout-Abnahme bleiben im Hauptchat. Ein Auftrag, der einen Szenario-Kopf
 * `SZENARIEN #<ziffern>` oder eine Szenario-/Negativfall-Zeile (`Szenario 1.1: Gegeben …`) trägt, geht nur an den Abnahme-Agenten:
 * jeder andere `Agent`-Spawn und jede `SendMessage` (dort alle String-Werte der Eingabe) mit so einem Text wird verweigert.
 * Die Pfad-Guards der beiden Holdout-Agenten (Frontmatter-Hooks) stehen in `holdout-guard.mjs`.
 *
 * Bewusste Grenzen:
 *  - Ein Re-Spawn des Szenario-Agenten, dessen Prompt den erwarteten Kopf mit echter Nummer vorgibt, wird verweigert (den Kopf ohne Ziffern beschreiben).
 *  - Ein Ticket-Body, der wörtlich einen Szenario-Kopf mit Ticketnummer zitiert, blockiert den Planer-Spawn (dann das Zitat umformulieren).
 *  - Ein Hauptchat, der die Szenarien in eine Datei schreibt oder anders umschreibt, wird hier nicht gesehen.
 *
 * Reines Node-Skript (nur Builtins), pure Funktionen, keine I/O beim Import.
 */

/** Name des Abnahme-Agenten (eine Quelle: `abnahme.mjs` exportiert ihn als `ABNAHME_AGENT`; Dateiname `.claude/agents/<name>.md`, der Test prüft ihn). */
export const ABNAHME_EMPFAENGER = "holdout-abnahme";

const SZENARIO_KOPF = /SZENARIEN #\d+/;
const SZENARIO_ZEILE = /^\s*(?:Szenario|Negativfall) \d+\.\d+: Gegeben\b/m;

const trifftSzenario = (text) => SZENARIO_KOPF.test(text) || SZENARIO_ZEILE.test(text);

/** Alle String-Werte (rekursiv) einer Tool-Eingabe. Pure. */
function stringWerte(wert) {
  if (typeof wert === "string") return [wert];
  if (Array.isArray(wert)) return wert.flatMap(stringWerte);
  if (wert && typeof wert === "object") return Object.values(wert).flatMap(stringWerte);
  return [];
}

/** Liest Tool, `subagent_type` und den prüfbaren Text aus dem Hook-Payload (Agent: `prompt`; SendMessage: alle String-Werte); kaputt → `{}`. Pure. */
export function parseHoldoutInput(text) {
  try {
    const data = JSON.parse(text);
    const eingabe = data?.tool_input;
    const tool = data?.tool_name;
    const inhalt = tool === "SendMessage" ? stringWerte(eingabe).join("\n") : eingabe?.prompt;
    return { tool, subagentType: eingabe?.subagent_type, text: typeof inhalt === "string" ? inhalt : "" };
  } catch {
    return {};
  }
}

/** Grund für ein Deny oder `null` (durchlassen). Pure. */
export function holdoutAuftragBlockade({ tool, subagentType, text } = {}) {
  const betroffen = tool === "SendMessage" || (tool === "Agent" && subagentType !== ABNAHME_EMPFAENGER);
  if (!betroffen || !trifftSzenario(String(text ?? ""))) return null;
  return (
    "Holdout-Trennung (ADR 0022 F13): Szenarien (Kopf „SZENARIEN #<nr>“ oder Zeilen „Szenario <i>.<n>: Gegeben …“) gehen nur an " +
    `${ABNAHME_EMPFAENGER}, nie an Planer, Umsetzer, Nachfolger, Gruppen-Umsetzer oder Lens und nie per SendMessage. Nimm sie aus dem Auftrag; ` +
    "der Hauptchat hält sie bis zur Abnahme zurück."
  );
}
