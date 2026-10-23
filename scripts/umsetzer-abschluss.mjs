// Kein Shebang: wird vom Stop-Hook und vom Wächter-Test importiert.
/**
 * Abschluss-Wächter des Umsetzers (`agenten.umsetzer` der Projekt-Config, #1331): ein offener PR mit Auto-Merge ist kein Ende.
 *
 * Der SubagentStop-Hook (`stop-verify-hook.mjs`) fragt diese Prüfung bei jedem Ende des Umsetzers. Meldet er
 * `ERGEBNIS: gemergt` oder `abgebrochen`, obwohl sein PR noch offen ist und Auto-Merge hat (die CI läuft noch,
 * z.B. weil `gh pr checks --watch` am Tool-Timeout starb), blockiert der Hook mit einem klaren Grund. Bei
 * `festgefahren` und `entscheidung-noetig` ist ein offener PR gewollt. Ein Config-Fehler (fehlende Namen oder `labels.festgefahren`)
 * blockiert mit Fix-Zeile (fail-closed, #1742/#1743); ein zweiter Stop mit `stop_hook_active` gibt frei. Laufzeitfehler
 * (kein gh, kein Netz, keine Nachricht) geben weiter frei: ein kaputter Wächter darf den Umsetzer nie festhalten.
 *
 * Grenze: die Wirkung von `deny` auf `SubagentHandback` ist live nicht belegt (eine `claude -p`-Probe hat das Tool nicht);
 * der Matcher ist wirkungslos, wenn er nie feuert, und R1 bis R3 gelten über `SubagentStop` ohnehin.
 * Zwei Abfangpunkte (#1342): `PreToolUse` auf `SubagentHandback` (vor der Zustellung, hier gilt zusätzlich die
 * Formatprüfung R0) und `SubagentStop` (nach der Zustellung, Nachricht aus dem Transkript). Neu: `festgefahren`
 * bei offenem PR geht nur mit dem Label `labels.festgefahren` der Config durch (R3).
 *
 * Reines Node-Skript (nur Builtins); `prStatus` ist injizierbar.
 */
import { ghJson, ghText } from "./gh-cli.mjs";
import { readFileSync } from "node:fs";
import { musterRegex } from "./besitz-lib.mjs";
import { labelAus } from "./projekt-config-lib.mjs";
import { failClosedGrund, namenOderGrund } from "./ticket-namen.mjs";
import { letzteErgebnisNachricht, transkriptZeilen } from "./transkript.mjs";

/** Erlaubte Werte hinter `ERGEBNIS:` (Format in der Umsetzer-Definition unter `.claude/agents/`, Test bindet beides). */
export const ERGEBNIS_WERTE = ["gemergt", "entscheidung-noetig", "festgefahren", "abgebrochen", "uebergabe", "abnahme"];

/** Erlaubte Schnittpunkte hinter `SCHNITT:` bei `ERGEBNIS: uebergabe` (Phasen-Schnitt #1592; Definition: die Umsetzer-Definition unter `.claude/agents/`). */
export const SCHNITTE = ["pr", "verify"];

/** Art des Festgefahren-Berichts hinter `FESTGEFAHREN:` (optional, fehlt sie: `ci`). Jede Art verlangt bei offenem PR das Label am PR (R3); `abnahme` (#1754) verlangt zusätzlich einen Entwurf ohne Auto-Merge (R8). Ohne PR gehört das Label an das Issue (Prosa der Umsetzer-Definition, der Hook sieht dann keinen PR). */
export const FESTGEFAHREN_ARTEN = ["review", "ci", "abnahme"];

/**
 * Liest `ERGEBNIS:`, `PR:`, `SCHNITT:`, `FESTGEFAHREN:` (klein geschrieben, sonst `null`) und das Vorhandensein einer `UEBERGABE:`-Zeile aus einer Nachricht. `token` ist das führende Wort, falls es ein erlaubter Wert ist
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
  const art = zeile("FESTGEFAHREN");
  return { token, zusatz: token ? m[2].trim() : roh, pr: zeile("PR"), schnitt: schnitt === null ? null : schnitt.toLowerCase(), uebergabe: /^[ \t]*UEBERGABE:/im.test(String(text ?? "")), festgefahren: art === null ? null : art.toLowerCase() };
}

/**
 * Liest die `ABNAHME:`-Zeile (`head=<7-40 hex> worktree=<Rest der Zeile>`, #1754) des Tokens `abnahme`; `null`, wenn sie fehlt oder ungültig ist.
 * Die Zeile steht am Zeilenanfang (eingerückt ok), ein Treffer mitten im Satz zählt nicht.
 */
export function parseAbnahme(text) {
  const m = /^[ \t]*ABNAHME:[ \t]*head=([0-9a-f]{7,40})[ \t]+worktree=(\S.*?)[ \t]*$/im.exec(String(text ?? ""));
  return m ? { head: m[1].toLowerCase(), worktree: m[2] } : null;
}

/**
 * Wert der `BEFUNDE:`-Zeile samt eingerückten Folgezeilen bis zur nächsten `SCHLÜSSEL:`-Zeile (#1723);
 * `null`, wenn die Zeile fehlt.
 */
export function befundeBlock(text) {
  const zeilen = String(text ?? "").split(/\r?\n/);
  const start = zeilen.findIndex((z) => /^[ \t]*BEFUNDE:/i.test(z));
  if (start < 0) return null;
  const rest = [];
  for (const z of zeilen.slice(start + 1)) {
    if (/^[ \t]*[A-ZÄÖÜ]+:/.test(z)) break;
    rest.push(z);
  }
  return [zeilen[start].replace(/^[ \t]*BEFUNDE:/i, ""), ...rest].join("\n").trim();
}

/** Angebot oder Frage statt eingetragener Befunde (#1723).
 * Bewusste Grenzen: ein `?` zählt nur vor Leerraum oder Zeilenende (`a?.b` und URLs mit Query gehen durch); eine Frage mit `?` vor einem Satzzeichen („(rein?)“) geht durch.
 */
const BEFUNDE_ANGEBOT = /\?(\s|$)|soll ich|sag (mir )?Bescheid|wenn du (willst|möchtest)/i;

/** PR-Nummer aus `PR:`-Wert (URL oder `#123`); sonst `null` (z.B. `-`). */
export function prNummer(pr) {
  const m = /(?:\/pull\/|#)(\d+)/.exec(String(pr ?? "")) ?? /^(\d+)$/.exec(String(pr ?? "").trim());
  return m ? m[1] : null;
}

/** `--json`-Felder des einen `gh pr view`: R1 bis R3 lesen state/autoMergeRequest/labels, R7/R8 zusätzlich isDraft, R6 files/author/comments (der Test bindet die Liste). */
export const PR_FELDER = "state,isDraft,autoMergeRequest,labels,files,author,comments";

/** Standard-`prStatus`: ein `gh pr view <nr> --json <PR_FELDER>` liefert alles, was der Abschluss liest; wirft bei jedem Fehler. */
export function ghPrStatus(nummer) {
  return ghJson(["pr", "view", nummer, "--json", PR_FELDER], { timeout: 20000 });
}

const FORMAT =
  "ERGEBNIS: gemergt | entscheidung-noetig | festgefahren | abgebrochen | uebergabe | abnahme (nur das Wort, ohne Zusatz) und eine PR:-Zeile (URL oder -) sowie BEFUNDE: (je Befund „<Befund> → #<nr>“, sonst keine); uebergabe zusätzlich SCHNITT: pr|verify und eine UEBERGABE:-Zeile; abnahme zusätzlich ABNAHME: head=<sha> worktree=<pfad>";
const WARTEN = (nr) =>
  `Warte im Vordergrund und blockierend: \`node scripts/pr-warten.mjs ${nr}\` (Bash-timeout: 300000), bei Exit 2 erneut, bis der PR MERGED ist. ` +
  `Ein Monitor hält deinen Lauf nicht offen. Hängt die CI (6 Aufrufe ohne Fortschritt), melde entscheidung-noetig.`;

/**
 * Grund für die Blockade oder `null`. `input`: `{ hookEvent, agentType, toolName, lastMessage }`.
 * Gilt für den Umsetzer, an zwei Stellen: `SubagentStop` und `PreToolUse` auf `SubagentHandback`. Blockiert:
 *  - R0 (nur PreToolUse): Format verletzt (kein gültiges Token, Zusatz, keine PR:-Zeile, keine BEFUNDE:-Zeile oder BEFUNDE als Angebot/Frage, #1723),
 *  - R1: `gemergt`/`abgebrochen` mit PR OPEN + Auto-Merge (CI läuft noch),
 *  - R2: `gemergt` mit einem PR, der nicht MERGED ist,
 *  - R3: `festgefahren` mit offenem PR ohne das Label `labels.festgefahren` der Config, für jede Art (`FESTGEFAHREN: review|ci|abnahme`, fehlt die Zeile: `ci`);
 *    ein anderer Wert wird verweigert. Mit `PR: -` prüft der Hook nichts (das Label am Issue deckt die Prosa ab),
 *  - R4 (#1592, beide Ereignisse): `uebergabe` ohne gültiges `SCHNITT: pr|verify` oder ohne `UEBERGABE:`-Zeile,
 *  - R5 (#1592): `uebergabe` mit `SCHNITT: pr` braucht einen PR, der OPEN ist und Auto-Merge hat oder schon MERGED ist (gh-Fehler: frei);
 *    `SCHNITT: verify` ruft kein gh auf. R1 bis R3 gelten für `uebergabe` nicht,
 *  - R7 (#1754): `abnahme` braucht eine gültige `ABNAHME:`-Zeile und einen PR, der OPEN und Entwurf ist, ohne Auto-Merge (gh-Fehler: frei); R1 bis R3 gelten nicht,
 *  - R8 (#1754): `festgefahren` mit `FESTGEFAHREN: abnahme` braucht (bei erreichbarem PR, OPEN) einen Entwurf ohne Auto-Merge und das Label.
 */
export function abschlussBlockade({ hookEvent, agentType, toolName, lastMessage }, deps = {}) {
  const vorher = hookEvent === "PreToolUse";
  if (vorher ? toolName !== "SubagentHandback" : hookEvent !== "SubagentStop") return null;
  // Die Config lädt der Einstiegspunkt (Hook) und reicht sie als `deps.config` durch; dieser Kern lädt nie selbst (fail-closed ohne).
  if (!deps.config) return failClosedGrund("Umsetzer-Abschluss", new Error("keine Config übergeben (der Einstiegspunkt lädt sie)"));
  const { namen, config, grund } = namenOderGrund("Umsetzer-Abschluss", deps);
  if (grund) return grund;
  if (agentType !== namen.agenten.umsetzer) return null;
  let stuckLabel;
  try {
    stuckLabel = labelAus(config, "festgefahren");
  } catch (e) {
    // Config-Fehler blockieren mit Fix-Zeile (fail-closed, wie namenOderGrund); ein Wurf ließe beide Hooks durch.
    return failClosedGrund("Umsetzer-Abschluss", e);
  }
  const { token, zusatz, pr, schnitt, uebergabe, festgefahren } = parseErgebnis(lastMessage);
  if (vorher) {
    const fehler = [];
    if (!token) fehler.push("kein gültiges ERGEBNIS-Token");
    else if (zusatz) fehler.push(`Zusatz hinter dem Token („${zusatz}“)`);
    if (pr === null) fehler.push("PR:-Zeile fehlt");
    const befunde = befundeBlock(lastMessage);
    if (befunde === null) fehler.push("BEFUNDE:-Zeile fehlt");
    else if (befunde === "") fehler.push("BEFUNDE: ist leer (je Befund „<Befund> → #<nr>“ oder keine)");
    else if (BEFUNDE_ANGEBOT.test(befunde)) fehler.push("BEFUNDE bietet an statt einzutragen: Befunde trägst du vor dem Bericht selbst ein (AGENTS.md § Abschluss ohne offene Befunde)");
    if (fehler.length)
      return (
        `Umsetzer-Abschluss (#1342): Handback abgelehnt (${fehler.join(", ")}). Format wörtlich: ${FORMAT}. ` +
        `Laufen deine Lenses noch, beende den Turn mit einer kurzen Statuszeile ohne SubagentHandback; ihre Berichte setzen dich fort.`
      );
  }
  if (!token) return null;
  if (token === "uebergabe") return uebergabeBlockade({ schnitt, uebergabe, pr }, deps);
  if (token === "abnahme") return abnahmeBlockade({ ablauf: parseAbnahme(lastMessage), pr }, deps);
  if (token === "festgefahren" && festgefahren !== null && !FESTGEFAHREN_ARTEN.includes(festgefahren)) {
    return `Umsetzer-Abschluss (#1663): FESTGEFAHREN: ${festgefahren} ist ungültig (erlaubt: ${FESTGEFAHREN_ARTEN.join(" | ")}; ohne die Zeile gilt ci).`;
  }
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
  if (token === "festgefahren" && festgefahren === "abnahme") return offen ? (entwurfBlockade(nr, status, "FESTGEFAHREN: abnahme") ?? labelBlockade(nr, status, stuckLabel, "FESTGEFAHREN: abnahme")) : null;
  if (offen && status.autoMergeRequest && (token === "gemergt" || token === "abgebrochen")) {
    return `Umsetzer-Abschluss (#1331): PR #${nr} ist noch offen und hat Auto-Merge, die CI läuft noch. Das ist kein Ende (ERGEBNIS: ${token}). ${WARTEN(nr)} Danach Audit-Kommentar, Aufräumen und erst dann der Bericht.`;
  }
  if (token === "gemergt" && status.state !== "MERGED") {
    return `Umsetzer-Abschluss (#1331): ERGEBNIS: gemergt, aber PR #${nr} hat den Status ${status.state}. Erst nach dem Merge berichten.`;
  }
  if (token === "festgefahren" && offen) {
    const fehlt = labelBlockade(nr, status, stuckLabel, "ERGEBNIS: festgefahren");
    if (fehlt) return `${fehlt} festgefahren gilt erst nach dem Protokoll (drei Fix-Versuche, ein konsolidierter PR-Kommentar, Label gesetzt). Wartest du nur auf die CI: ${WARTEN(nr)}`;
  }
  if (token === "gemergt" && status.state === "MERGED") return auditBlockade(nr, deps, status);
  return null;
}

/** Kopfzeile des Audit-Kommentars nach einem Leitplanken-Merge (steht wörtlich in AGENTS.md, der Test bindet beides). */
export const AUDIT_KOPF = "\u{1F6E1}\uFE0F Leitplanken-Änderung selbst gemergt";

/** Leitplanken-Muster: Vereinigung aller String-Arrays in `.github/protected-paths.json` (SSOT, nicht kopieren). */
export function leitplankenMuster() {
  const quelle = new URL("../.github/protected-paths.json", import.meta.url);
  return Object.values(JSON.parse(readFileSync(quelle, "utf8"))).flatMap((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []));
}

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
    const segmente = kern.split("/").map(musterRegex);
    const verankert = roh.startsWith("/") || kern.includes("/");
    const starts = verankert ? [0] : teile.map((_, i) => i);
    return starts.some((start) => {
      const rest = teile.slice(start);
      if (rest.length < segmente.length + (verzeichnis ? 1 : 0)) return false;
      return segmente.every((re, i) => re.test(rest[i]));
    });
  });
}

/** GraphQL liefert in `files` höchstens so viele Einträge; genau so viele heißen: möglicherweise abgeschnitten. */
export const GRAPHQL_DATEIEN_GRENZE = 100;

const ghDiffNamen = (nummer) => ghText(["pr", "diff", nummer, "--name-only"], { timeout: 20000 });

/**
 * Standard-`prDateien`: geänderte Dateien des PR aus `status.files` (kein zweiter gh-Aufruf); fehlt `files` oder sind es
 * genau `GRAPHQL_DATEIEN_GRENZE` Einträge (Abschneidegrenze), Rückfall auf `gh pr diff --name-only`; wirft bei jedem Fehler.
 */
export function ghPrDateien(nummer, status, diff = ghDiffNamen) {
  const files = status?.files;
  if (Array.isArray(files) && files.length < GRAPHQL_DATEIEN_GRENZE) return files.map((f) => f?.path).filter(Boolean);
  return diff(nummer).split("\n").map((z) => z.trim()).filter(Boolean);
}

const ghKommentareAnsicht = (nummer) => ghJson(["pr", "view", nummer, "--json", "author,comments"], { timeout: 20000 });

/** Standard-`prKommentare`: Autor und Kommentare aus dem einen `gh pr view`; ohne sie (z.B. injizierter Status) ein eigener Aufruf; wirft bei jedem Fehler. */
export function ghPrKommentare(nummer, status, ansicht = ghKommentareAnsicht) {
  if (status && "comments" in status && "author" in status) return status;
  return ansicht(nummer);
}

/** R6 (#1067): gemergter PR mit Leitplanken-Pfaden braucht den Audit-Kommentar des PR-Autors; Fehler: frei. */
function auditBlockade(nr, deps, status) {
  try {
    const muster = leitplankenMuster();
    const treffer = (deps.prDateien ?? ghPrDateien)(nr, status).filter((d) => trifftLeitplanke(d, muster));
    if (!treffer.length) return null;
    const info = (deps.prKommentare ?? ghPrKommentare)(nr, status);
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

/** Entwurf ohne Auto-Merge (R7/R8): `null` = frei. */
function entwurfBlockade(nr, status, was) {
  if (status.state === "OPEN" && status.isDraft === true && !status.autoMergeRequest) return null;
  return `Umsetzer-Abschluss (#1754): ${was}, aber PR #${nr} ist nicht OPEN als Entwurf ohne Auto-Merge (Status ${status.state}, Entwurf ${status.isDraft ? "ja" : "nein"}, Auto-Merge ${status.autoMergeRequest ? "ja" : "nein"}). ` +
    `Vor der Abnahme: gh pr create --draft, ohne Auto-Merge; erst nach bestandener Abnahme gh pr ready und Auto-Merge.`;
}

/** Label-Prüfung für `festgefahren` (R3, R8): das Label `stuckLabel` muss am offenen PR stehen; `null` = vorhanden. */
function labelBlockade(nr, status, stuckLabel, was) {
  if ((status.labels ?? []).some((l) => l?.name === stuckLabel)) return null;
  return `Umsetzer-Abschluss (#1342): ${was} bei offenem PR #${nr}, aber das Label ${stuckLabel} fehlt. Setze es am PR: gh pr edit ${nr} --add-label ${stuckLabel}.`;
}

/** R7 für `ERGEBNIS: abnahme` (#1754); `null` = frei. */
function abnahmeBlockade({ ablauf, pr }, deps) {
  if (!ablauf) return `Umsetzer-Abschluss (#1754): ERGEBNIS: abnahme abgelehnt (ABNAHME:-Zeile fehlt oder ist ungültig). Format wörtlich: ${FORMAT}.`;
  const nr = prNummer(pr);
  if (!nr) return "Umsetzer-Abschluss (#1754): ERGEBNIS: abnahme braucht eine PR:-Zeile mit dem Entwurfs-PR.";
  let status;
  try {
    status = (deps.prStatus ?? ghPrStatus)(nr);
  } catch {
    return null; // fail-open
  }
  return status ? entwurfBlockade(nr, status, "ERGEBNIS: abnahme") : null;
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
