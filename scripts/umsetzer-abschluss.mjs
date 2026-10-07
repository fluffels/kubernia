// Kein Shebang: wird vom Stop-Hook und vom Wächter-Test importiert.
/**
 * Abschluss-Wächter des `kubernia-umsetzer` (#1331): ein offener PR mit Auto-Merge ist kein Ende.
 *
 * Der SubagentStop-Hook (`stop-verify-hook.mjs`) fragt diese Prüfung bei jedem Ende des Umsetzers. Meldet er
 * `ERGEBNIS: gemergt` oder `abgebrochen`, obwohl sein PR noch offen ist und Auto-Merge hat (die CI läuft noch,
 * z.B. weil `gh pr checks --watch` am Tool-Timeout starb), blockiert der Hook mit einem klaren Grund. Bei
 * `festgefahren` und `entscheidung-noetig` ist ein offener PR gewollt. Jeder Fehler (kein gh, kein Netz, keine
 * Nachricht) gibt frei: ein kaputter Wächter darf den Umsetzer nie festhalten.
 *
 * Reines Node-Skript (nur Builtins); `prStatus` ist injizierbar.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Liest `ERGEBNIS:` und `PR:` aus der letzten Nachricht; fehlende Zeile → `null`. */
export function parseErgebnis(text) {
  const zeile = (key) => {
    const m = new RegExp("^[ \\t]*" + key + ":[ \\t]*(.+?)[ \\t]*$", "im").exec(String(text ?? ""));
    return m ? m[1] : null;
  };
  return { ergebnis: zeile("ERGEBNIS")?.toLowerCase() ?? null, pr: zeile("PR") };
}

/** PR-Nummer aus `PR:`-Wert (URL oder `#123`); sonst `null` (z.B. `-`). */
export function prNummer(pr) {
  const m = /(?:\/pull\/|#)(\d+)/.exec(String(pr ?? "")) ?? /^(\d+)$/.exec(String(pr ?? "").trim());
  return m ? m[1] : null;
}

/** Standard-`prStatus`: `gh pr view <nr> --json state,autoMergeRequest`; wirft bei jedem Fehler. */
export function ghPrStatus(nummer) {
  const out = execFileSync("gh", ["pr", "view", nummer, "--json", "state,autoMergeRequest"], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
  return JSON.parse(out);
}

/**
 * Grund für die Blockade oder `null`. `input`: `{ hookEvent, agentType, lastMessage }`.
 * Blockiert nur: SubagentStop des Umsetzers, und
 *  - `gemergt`/`abgebrochen` mit PR OPEN + Auto-Merge (CI läuft noch), oder
 *  - `gemergt` mit einem PR, der nicht MERGED ist.
 */
export function abschlussBlockade({ hookEvent, agentType, lastMessage }, deps = {}) {
  if (hookEvent !== "SubagentStop" || agentType !== "kubernia-umsetzer") return null;
  const { ergebnis, pr } = parseErgebnis(lastMessage);
  if (ergebnis !== "gemergt" && ergebnis !== "abgebrochen") return null;
  const nr = prNummer(pr);
  if (!nr) return null;
  let status;
  try {
    status = (deps.prStatus ?? ghPrStatus)(nr);
  } catch {
    return null; // fail-open
  }
  if (!status) return null;
  const offen = status.state === "OPEN";
  if (offen && status.autoMergeRequest) {
    return (
      `Umsetzer-Abschluss (#1331): PR #${nr} ist noch offen und hat Auto-Merge, die CI läuft noch. ` +
      `Das ist kein Ende (ERGEBNIS: ${ergebnis}). Warte bis zum Merge (gh pr checks ${nr} --watch mit ` +
      `timeout 600000 oder eine Monitor-until-Schleife; ein Tool-Timeout ist kein Abbruchgrund), ` +
      `dann Audit-Kommentar, Aufräumen und erst danach den Bericht.`
    );
  }
  if (ergebnis === "gemergt" && status.state !== "MERGED") {
    return `Umsetzer-Abschluss (#1331): ERGEBNIS: gemergt, aber PR #${nr} hat den Status ${status.state}. Erst nach dem Merge berichten.`;
  }
  return null;
}

/** Letzter Assistant-Text aus einem JSONL-Transkript; `null` bei jedem Problem. */
export function letzteNachrichtAusTranskript(pfad) {
  try {
    const zeilen = readFileSync(pfad, "utf8").split("\n").filter(Boolean);
    for (let i = zeilen.length - 1; i >= 0; i--) {
      const e = JSON.parse(zeilen[i]);
      const msg = e.message ?? e;
      if (msg.role !== "assistant" && e.type !== "assistant") continue;
      const c = msg.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
      if (text.trim()) return text;
    }
  } catch {
    /* fail-open */
  }
  return null;
}

/** Hook-Input (stdin-JSON) → `{ hookEvent, agentType, lastMessage }`; wirft nie. */
export function parseAbschlussInput(text, readTranscript = letzteNachrichtAusTranskript) {
  try {
    const d = JSON.parse(text);
    const lastMessage = d.last_assistant_message ?? (d.agent_transcript_path ? readTranscript(d.agent_transcript_path) : null);
    return { hookEvent: d.hook_event_name, agentType: d.agent_type, lastMessage };
  } catch {
    return {};
  }
}
