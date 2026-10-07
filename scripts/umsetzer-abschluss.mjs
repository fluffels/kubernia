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
 * Grenze: die Wirkung von `deny` auf `SubagentHandback` ist live nicht belegt (eine `claude -p`-Probe hat das Tool nicht);
 * der Matcher ist wirkungslos, wenn er nie feuert, und R1 bis R3 gelten über `SubagentStop` ohnehin.
 * Zwei Abfangpunkte (#1342): `PreToolUse` auf `SubagentHandback` (vor der Zustellung, hier gilt zusätzlich die
 * Formatprüfung R0) und `SubagentStop` (nach der Zustellung, Nachricht aus dem Transkript). Neu: `festgefahren`
 * bei offenem PR geht nur mit dem Label `status:festgefahren` durch (R3).
 *
 * Reines Node-Skript (nur Builtins); `prStatus` ist injizierbar.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { letzteErgebnisNachricht, transkriptZeilen } from "./transkript.mjs";

/** Erlaubte Werte hinter `ERGEBNIS:` (Format in `.claude/agents/kubernia-umsetzer.md`, Test bindet beides). */
export const ERGEBNIS_WERTE = ["gemergt", "entscheidung-noetig", "festgefahren", "abgebrochen"];

/** Label, das das Festgefahren-Protokoll setzt (SSOT: `check-festgefahren.mjs`, der Test bindet beide). */
const STUCK_LABEL = "status:festgefahren";

/**
 * Liest `ERGEBNIS:` und `PR:` aus einer Nachricht. `token` ist das führende Wort, falls es ein erlaubter Wert ist
 * (sonst `null`), `zusatz` der Rest der Zeile (Klammern, Satzzeichen), `pr` der `PR:`-Wert; fehlende Zeile → `null`.
 */
export function parseErgebnis(text) {
  const zeile = (key) => {
    const m = new RegExp("^[ \t]*" + key + ":[ \t]*(.+?)[ \t]*$", "im").exec(String(text ?? ""));
    return m ? m[1] : null;
  };
  const roh = zeile("ERGEBNIS");
  const m = roh === null ? null : /^([a-z-]+)(.*)$/i.exec(roh);
  const kandidat = m ? m[1].toLowerCase() : null;
  const token = kandidat && ERGEBNIS_WERTE.includes(kandidat) ? kandidat : null;
  return { token, zusatz: token ? m[2].trim() : roh, pr: zeile("PR") };
}

/** PR-Nummer aus `PR:`-Wert (URL oder `#123`); sonst `null` (z.B. `-`). */
export function prNummer(pr) {
  const m = /(?:\/pull\/|#)(\d+)/.exec(String(pr ?? "")) ?? /^(\d+)$/.exec(String(pr ?? "").trim());
  return m ? m[1] : null;
}

/** `--json`-Felder von `gh pr view`; `labels` braucht R3 (der Test bindet die Liste). */
export const PR_FELDER = "state,autoMergeRequest,labels";

/** Standard-`prStatus`: `gh pr view <nr> --json state,autoMergeRequest,labels`; wirft bei jedem Fehler. */
export function ghPrStatus(nummer) {
  const out = execFileSync("gh", ["pr", "view", nummer, "--json", PR_FELDER], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
  return JSON.parse(out);
}

const FORMAT =
  "ERGEBNIS: gemergt | entscheidung-noetig | festgefahren | abgebrochen (nur das Wort, ohne Zusatz) und eine PR:-Zeile (URL oder -)";
const WARTEN = (nr) =>
  `Warte im Vordergrund und blockierend: \`timeout 590 gh pr checks ${nr} --watch\` (Bash-timeout: 600000), danach eine begrenzte ` +
  `Schleife, bis der PR MERGED ist. Ein Monitor hält deinen Lauf nicht offen. Hängt die CI, melde entscheidung-noetig.`;

/**
 * Grund für die Blockade oder `null`. `input`: `{ hookEvent, agentType, toolName, lastMessage }`.
 * Gilt für den Umsetzer, an zwei Stellen: `SubagentStop` und `PreToolUse` auf `SubagentHandback`. Blockiert:
 *  - R0 (nur PreToolUse): Format verletzt (kein gültiges Token, Zusatz, keine PR:-Zeile),
 *  - R1: `gemergt`/`abgebrochen` mit PR OPEN + Auto-Merge (CI läuft noch),
 *  - R2: `gemergt` mit einem PR, der nicht MERGED ist,
 *  - R3: `festgefahren` mit offenem PR ohne Label `status:festgefahren`.
 */
export function abschlussBlockade({ hookEvent, agentType, toolName, lastMessage }, deps = {}) {
  if (agentType !== "kubernia-umsetzer") return null;
  const vorher = hookEvent === "PreToolUse";
  if (vorher ? toolName !== "SubagentHandback" : hookEvent !== "SubagentStop") return null;
  const { token, zusatz, pr } = parseErgebnis(lastMessage);
  if (vorher) {
    const fehler = [];
    if (!token) fehler.push("kein gültiges ERGEBNIS-Token");
    else if (zusatz) fehler.push(`Zusatz hinter dem Token („${zusatz}“)`);
    if (pr === null) fehler.push("PR:-Zeile fehlt");
    if (fehler.length)
      return (
        `Umsetzer-Abschluss (#1342): Handback abgelehnt (${fehler.join(", ")}). Format wörtlich: ${FORMAT}. ` +
        `Laufen deine Lenses noch, beende den Turn mit einer kurzen Statuszeile ohne SubagentHandback; ihre Berichte setzen dich fort.`
      );
  }
  if (!token) return null;
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
  if (offen && status.autoMergeRequest && (token === "gemergt" || token === "abgebrochen")) {
    return `Umsetzer-Abschluss (#1331): PR #${nr} ist noch offen und hat Auto-Merge, die CI läuft noch. Das ist kein Ende (ERGEBNIS: ${token}). ${WARTEN(nr)} Danach Audit-Kommentar, Aufräumen und erst dann der Bericht.`;
  }
  if (token === "gemergt" && status.state !== "MERGED") {
    return `Umsetzer-Abschluss (#1331): ERGEBNIS: gemergt, aber PR #${nr} hat den Status ${status.state}. Erst nach dem Merge berichten.`;
  }
  if (token === "festgefahren" && offen && !(status.labels ?? []).some((l) => l?.name === STUCK_LABEL)) {
    return (
      `Umsetzer-Abschluss (#1342): ERGEBNIS: festgefahren bei offenem PR #${nr}, aber das Label ${STUCK_LABEL} fehlt. ` +
      `festgefahren gilt erst nach dem Protokoll (drei Fix-Versuche, ein konsolidierter PR-Kommentar, Label gesetzt). ` +
      `Wartest du nur auf die CI: ${WARTEN(nr)}`
    );
  }
  return null;
}

/** Jüngste Nachricht mit `ERGEBNIS:`-Zeile aus einem JSONL-Transkript (Handback-Text oder Text-Block); `null` bei jedem Problem. */
export function letzteNachrichtAusTranskript(pfad) {
  try {
    return letzteErgebnisNachricht(transkriptZeilen(readFileSync(pfad, "utf8")));
  } catch {
    return null; // fail-open
  }
}

/** Hook-Input (stdin-JSON) → `{ hookEvent, agentType, toolName, lastMessage }`; wirft nie. */
export function parseAbschlussInput(text, readTranscript = letzteNachrichtAusTranskript) {
  try {
    const d = JSON.parse(text);
    const vorher = d.hook_event_name === "PreToolUse";
    const lastMessage = vorher
      ? (d.tool_input?.message ?? null)
      : ((d.agent_transcript_path ? readTranscript(d.agent_transcript_path) : null) ?? d.last_assistant_message ?? null);
    return { hookEvent: d.hook_event_name, agentType: d.agent_type, toolName: d.tool_name, lastMessage };
  } catch {
    return {};
  }
}
