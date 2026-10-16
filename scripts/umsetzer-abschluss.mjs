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
import { ghJson, ghText } from "./gh-cli.mjs";
import { readFileSync } from "node:fs";
import { letzteErgebnisNachricht, transkriptZeilen } from "./transkript.mjs";

/** Erlaubte Werte hinter `ERGEBNIS:` (Format in `.claude/agents/kubernia-umsetzer.md`, Test bindet beides). */
export const ERGEBNIS_WERTE = ["gemergt", "entscheidung-noetig", "festgefahren", "abgebrochen", "uebergabe"];

/** Erlaubte Schnittpunkte hinter `SCHNITT:` bei `ERGEBNIS: uebergabe` (Phasen-Schnitt #1592; Definition: die Umsetzer-Definition unter `.claude/agents/`). */
export const SCHNITTE = ["pr", "verify"];

/** Label, das das Festgefahren-Protokoll setzt (SSOT: `check-festgefahren.mjs`, der Test bindet beide). */
const STUCK_LABEL = "status:festgefahren";

/**
 * Liest `ERGEBNIS:`, `PR:`, `SCHNITT:` und das Vorhandensein einer `UEBERGABE:`-Zeile aus einer Nachricht. `token` ist das führende Wort, falls es ein erlaubter Wert ist
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
  const schnitt = zeile("SCHNITT");
  return { token, zusatz: token ? m[2].trim() : roh, pr: zeile("PR"), schnitt: schnitt === null ? null : schnitt.toLowerCase(), uebergabe: /^[ \t]*UEBERGABE:/im.test(String(text ?? "")) };
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
  return ghJson(["pr", "view", nummer, "--json", PR_FELDER], { timeout: 20000 });
}

const FORMAT =
  "ERGEBNIS: gemergt | entscheidung-noetig | festgefahren | abgebrochen | uebergabe (nur das Wort, ohne Zusatz) und eine PR:-Zeile (URL oder -); uebergabe zusätzlich SCHNITT: pr|verify und eine UEBERGABE:-Zeile";
const WARTEN = (nr) =>
  `Warte im Vordergrund und blockierend: \`node scripts/pr-warten.mjs ${nr}\` (Bash-timeout: 300000), bei Exit 2 erneut, bis der PR MERGED ist. ` +
  `Ein Monitor hält deinen Lauf nicht offen. Hängt die CI (6 Aufrufe ohne Fortschritt), melde entscheidung-noetig.`;

/**
 * Grund für die Blockade oder `null`. `input`: `{ hookEvent, agentType, toolName, lastMessage }`.
 * Gilt für den Umsetzer, an zwei Stellen: `SubagentStop` und `PreToolUse` auf `SubagentHandback`. Blockiert:
 *  - R0 (nur PreToolUse): Format verletzt (kein gültiges Token, Zusatz, keine PR:-Zeile),
 *  - R1: `gemergt`/`abgebrochen` mit PR OPEN + Auto-Merge (CI läuft noch),
 *  - R2: `gemergt` mit einem PR, der nicht MERGED ist,
 *  - R3: `festgefahren` mit offenem PR ohne Label `status:festgefahren`,
 *  - R4 (#1592, beide Ereignisse): `uebergabe` ohne gültiges `SCHNITT: pr|verify` oder ohne `UEBERGABE:`-Zeile,
 *  - R5 (#1592): `uebergabe` mit `SCHNITT: pr` braucht einen PR, der OPEN ist und Auto-Merge hat oder schon MERGED ist (gh-Fehler: frei);
 *    `SCHNITT: verify` ruft kein gh auf. R1 bis R3 gelten für `uebergabe` nicht.
 */
export function abschlussBlockade({ hookEvent, agentType, toolName, lastMessage }, deps = {}) {
  if (agentType !== "kubernia-umsetzer") return null;
  const vorher = hookEvent === "PreToolUse";
  if (vorher ? toolName !== "SubagentHandback" : hookEvent !== "SubagentStop") return null;
  const { token, zusatz, pr, schnitt, uebergabe } = parseErgebnis(lastMessage);
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
  if (token === "uebergabe") return uebergabeBlockade({ schnitt, uebergabe, pr }, deps);
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
  if (token === "gemergt" && status.state === "MERGED") return auditBlockade(nr, deps);
  return null;
}

/** Kopfzeile des Audit-Kommentars nach einem Leitplanken-Merge (steht wörtlich in AGENTS.md, der Test bindet beides). */
export const AUDIT_KOPF = "\u{1F6E1}\uFE0F Leitplanken-Änderung selbst gemergt";

/** Leitplanken-Muster: Vereinigung aller String-Arrays in `.github/protected-paths.json` (SSOT, nicht kopieren). */
export function leitplankenMuster() {
  const quelle = new URL("../.github/protected-paths.json", import.meta.url);
  return Object.values(JSON.parse(readFileSync(quelle, "utf8"))).flatMap((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []));
}

const globSegment = (seg) => new RegExp("^" + seg.split("*").map((t) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");

/**
 * Trifft `pfad` (Repo-relativ, `/`) eines der Muster? CODEOWNERS-Teilmenge: führendes `/` verankert an der Wurzel;
 * ohne `/` (außer am Ende) auf jeder Ebene; `/` am Ende = Verzeichnis-Präfix; `*` = beliebige Zeichen außer `/`;
 * ein Muster, das ein Elternverzeichnis trifft, trifft alle Dateien darin.
 */
export function trifftLeitplanke(pfad, muster) {
  const teile = String(pfad).split("/").filter(Boolean);
  return muster.some((roh) => {
    const verzeichnis = roh.endsWith("/");
    const kern = roh.replace(/^\//, "").replace(/\/$/, "");
    const segmente = kern.split("/").map(globSegment);
    const verankert = roh.startsWith("/") || kern.includes("/");
    const starts = verankert ? [0] : teile.map((_, i) => i);
    return starts.some((start) => {
      const rest = teile.slice(start);
      if (rest.length < segmente.length + (verzeichnis ? 1 : 0)) return false;
      return segmente.every((re, i) => re.test(rest[i]));
    });
  });
}

/** Standard-`prDateien`: geänderte Dateien des PR; wirft bei jedem Fehler. */
export function ghPrDateien(nummer) {
  return ghText(["pr", "diff", nummer, "--name-only"], { timeout: 20000 }).split("\n").map((z) => z.trim()).filter(Boolean);
}

/** Standard-`prKommentare`: Autor und Kommentare des PR; wirft bei jedem Fehler. */
export function ghPrKommentare(nummer) {
  return ghJson(["pr", "view", nummer, "--json", "author,comments"], { timeout: 20000 });
}

/** R6 (#1067): gemergter PR mit Leitplanken-Pfaden braucht den Audit-Kommentar des PR-Autors; Fehler: frei. */
function auditBlockade(nr, deps) {
  try {
    const treffer = (deps.prDateien ?? ghPrDateien)(nr).filter((d) => trifftLeitplanke(d, leitplankenMuster()));
    if (!treffer.length) return null;
    const info = (deps.prKommentare ?? ghPrKommentare)(nr);
    const autor = info?.author?.login;
    const vorhanden = (info?.comments ?? []).some((c) => autor && c?.author?.login === autor && String(c?.body ?? "").trimStart().startsWith(AUDIT_KOPF));
    if (vorhanden) return null;
    return (
      `Umsetzer-Abschluss (#1067): PR #${nr} ändert Leitplanken-Pfade (${treffer.slice(0, 5).join(", ")}${treffer.length > 5 ? ", …" : ""}), ` +
      `aber der Audit-Kommentar fehlt. Poste auf dem PR einen Kommentar, dessen erste Zeile „${AUDIT_KOPF}“ lautet, mit was, warum und wie reverten (\`git revert <squash-sha>\` per PR), dann berichte.`
    );
  } catch {
    return null; // fail-open
  }
}

/** R4/R5 für `ERGEBNIS: uebergabe` (Phasen-Schnitt #1592); `null` = frei. */
function uebergabeBlockade({ schnitt, uebergabe, pr }, deps) {
  const fehler = [];
  if (!SCHNITTE.includes(schnitt)) fehler.push(`SCHNITT: fehlt oder ist unbekannt (erlaubt: ${SCHNITTE.join(" | ")})`);
  if (!uebergabe) fehler.push("UEBERGABE:-Zeile fehlt");
  if (fehler.length) return `Umsetzer-Abschluss (#1592): ERGEBNIS: uebergabe abgelehnt (${fehler.join(", ")}). Format wörtlich: ${FORMAT}.`;
  if (schnitt !== "pr") return null;
  const nr = prNummer(pr);
  if (!nr) return "Umsetzer-Abschluss (#1592): SCHNITT: pr braucht eine PR:-Zeile mit dem offenen PR (nach `gh pr create` und gesetztem Auto-Merge).";
  let status;
  try {
    status = (deps.prStatus ?? ghPrStatus)(nr);
  } catch {
    return null; // fail-open
  }
  if (!status) return null;
  if (status.state === "MERGED") return null; // schon gemergt: der Schnitt ist erreicht
  if (status.state !== "OPEN" || !status.autoMergeRequest)
    return `Umsetzer-Abschluss (#1592): SCHNITT: pr, aber PR #${nr} ist nicht OPEN mit Auto-Merge (Status ${status.state}, Auto-Merge ${status.autoMergeRequest ? "ja" : "nein"}). Erst gh pr merge ${nr} --squash --delete-branch --auto setzen, dann übergeben.`;
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
