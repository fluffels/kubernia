// Kein Shebang: wird über den Dispatcher `scripts/pretooluse-hook.mjs` (oder direkt per `node scripts/gh-guard-hook.mjs`)
// gestartet UND von test/harness/gh-guard.test.ts importiert (ein `#!` bricht den Test-Import, wie bei worktree-guard-hook.mjs).
/**
 * gh-Guard-Hook (#1311, Z5 aus #1204) — Claude-Code-`PreToolUse`-Hook für `Bash` und `PowerShell`.
 *
 * Lücke: `permissions.allow` enthält `Bash(gh api:*)` (das Board läuft über GraphQL-Mutationen). Über
 * `gh api` lassen sich aber auch die Dinge tun, die AGENTS.md § Human-in-the-Loop-Checkpoints als
 * Pflicht-Stopp führt: Issues/Board-Items/Labels löschen, Ruleset, Secrets und Repo-Einstellungen ändern,
 * im Forum posten. Ein `ask` auf `gh api` insgesamt träfe jeden Board-Lesezugriff; darum sieht dieser
 * Hook den Aufruf an und fragt nur bei den Formen mit Außenwirkung (`permissionDecision: "ask"`, kein `deny`:
 * die Maintainerin soll es ausdrücklich erlauben können).
 *
 * Er fragt auch, wenn der Aufruf nicht statisch lesbar ist: dynamische Methode (`-X $M`), dynamische GraphQL-Query
 * (unmaskiertes `$` im `query=`), `--input`/`query=@datei`, ein schreibender Aufruf mit dynamischem Endpunkt, `eval`/
 * `iex`/`Invoke-Expression`, ein dynamisches Kommando (`$CMD`) und ein Interpreter-String mit Variable neben `gh api`;
 * der String hinter `bash|sh|pwsh -c`/`cmd /c` wird rekursiv bewertet (Tiefe `MAX_INTERPRETER`).
 *
 * Warum kein `parseBash`: der Hook gilt für Bash UND PowerShell und bleibt shell-neutral. PowerShell hat Backtick-
 * Escapes, Zuweisungen mit Cast (`[array]$r = gh api …`) und `$(…)`/`@(…)` ohne Bash-Entsprechung. Die gemeinsame
 * Quote-Zerlegung (`quoteFolge` in `hook-io.mjs`) ist die EINE Hilfsfunktion für Segmentierung und Variablen-Suche.
 *
 * Bewusste Grenzen (ehrlich, wie beim worktree-guard):
 *  - Textprüfung je Segment (Trenner `&&`/`||`/`;`/`|`/Zeilenumbruch außerhalb von Anführungszeichen, mehrzeilige
 *    Queries bleiben ein Segment), kein vollständiges Shell-Parsing. Er fängt die dokumentierten Formen, keine
 *    absichtliche Umgehung; die eigentliche Durchsetzung bleibt PR-Gate + Review.
 *  - Er schaut nur auf `gh api`: `gh issue delete` & Co. stehen als eigene `ask`-Regeln in settings.json.
 *  - Ein Treffer in einem Textargument eines anderen Befehls (`gh issue comment --body "deleteIssue"`,
 *    Commit-Text mit "gh api") zählt nicht: `gh api` muss am Segmentanfang stehen.
 *  - Fail-open bei kaputtem Payload: der Hook darf nie selbst jeden Aufruf blockieren.
 *
 * Reines Node-Skript (nur Builtins). `bewerte` ist pur und exportiert.
 */
import { MAX_INTERPRETER, buildAskOutput, emit, istDirektaufruf, mergeDecisions, parseHookInput, quoteFolge, readStdin } from "./hook-io.mjs";

export { buildAskOutput, parseHookInput };

/** Tools, für die der Hook gilt. */
export const GEPRUEFTE_TOOLS = ["Bash", "PowerShell"];

/** GraphQL-Mutationen mit Außenwirkung (geschlossene Liste, case-sensitiv wie im Schema). Gesucht wird der AUFRUF
 *  `name(` hinter dem Schlüsselwort `mutation`, nicht der bloße Name: ein Lese-Feld wie `deleteBranchOnMerge` in einer
 *  Query ist kein Aufruf. */
const MUTATIONEN = [
  /\bdelete[A-Z]\w*(?=\s*\()/, // deleteIssue, deleteProjectV2Item, deleteProjectV2, deleteLabel, deleteRef, deleteDiscussion, …
  /\btransferIssue(?=\s*\()/,
  /\b(addDiscussionComment|createDiscussion|updateDiscussion|updateDiscussionComment)(?=\s*\()/,
  /\b(createRepository|updateRepository|archiveRepository|unarchiveRepository)(?=\s*\()/,
  /\b(create|update)BranchProtectionRule(?=\s*\()/,
  /\b(create|update)RepositoryRuleset(?=\s*\()/,
];

/** REST-Pfade für Einstellungen und Veröffentlichung. */
const REST_PFADE = [
  /\/rulesets\b/,
  /\/branches\/[^\s'"]+\/protection\b/,
  /\/actions\/(secrets|variables)\b/,
  /\/(environments|collaborators|hooks|keys|discussions)\b/,
  /\/(dependabot|codespaces)\/secrets\b/,
];

/** `gh api` als Befehl am Segmentanfang (auch nach `&`, `$(`, Klammern, Variablen-Zuweisungen, auch mit PowerShell-Cast
 *  `[array]$r = (gh api …)`), nicht als Text in einem fremden Befehl. */
const GH_API_AM_ANFANG = /^[\s(`$&]*(?:\[[\w.,[\] ]+\]\s*)*(?:\$[\w:]+\s*=\s*[\s(`$@&]*)?(?:\w+=\S*\s+)*gh(?:\.exe)?\s+api\b/;

/**
 * Zerlegt einen Befehl an `&&`, `||`, `;`, `|` und Zeilenumbrüchen, aber NICHT innerhalb von Anführungszeichen
 * (`'…'`, `"…"`, Escapes mit Backslash oder PowerShell-Backtick): eine mehrzeilige GraphQL-Query im Argument bleibt
 * ein Segment.
 */
export function segmente(command) {
  const text = String(command);
  const out = [];
  let cur = "";
  const folge = quoteFolge(text);
  for (let k = 0; k < folge.length; k++) {
    const { i, c, q, masked } = folge[k];
    if (q === null && !masked) {
      const zwei = text.slice(i, i + 2);
      if (zwei === "&&" || zwei === "||") {
        out.push(cur);
        cur = "";
        k++;
        continue;
      }
      if (c === ";" || c === "|" || c === "\n") {
        out.push(cur);
        cur = "";
        continue;
      }
      if (c === "\r") continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Die ausdrücklich gewählte HTTP-Methode (`-X`/`--method`, auch `--method=DELETE`), sonst null. */
function methode(segment) {
  const m = /(?:^|\s)(?:-X\s*|--method(?:\s+|=))['"]?([A-Za-z]+)['"]?/.exec(segment);
  return m ? m[1].toUpperCase() : null;
}

/** Trägt der Aufruf Felder (`-f`/`-F`/`--field`/`--raw-field`/`--input`)? Dann ist die implizite Methode POST. */
const hatFelder = (segment) => /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?:\s|=)/.test(segment);

/** Der erste Treffer-Grund für ein einzelnes `gh api`-Segment oder null. */
function segmentGrund(segment) {
  const m = methode(segment);
  if (m === "DELETE") return "`gh api` mit Methode DELETE löscht etwas (unumkehrbar)";
  const nachMutation = segment.includes("mutation") ? segment.slice(segment.indexOf("mutation")) : "";
  for (const muster of MUTATIONEN) {
    const treffer = muster.exec(nachMutation);
    if (treffer) return `GraphQL-Mutation ${treffer[0]} (Außenwirkung oder Löschen)`;
  }
  const mutierend = m !== null ? m !== "GET" : hatFelder(segment);
  if (!mutierend) return null; // reiner Lesezugriff auf Einstellungspfade ist erlaubt
  for (const muster of REST_PFADE) if (muster.test(segment)) return `schreibender REST-Aufruf auf Einstellungen/Veröffentlichung (${muster.source})`;
  if (m === "PATCH" && /\brepos\/[^/\s'"]+\/[^/\s'"]+(?=\s|$|['"])/.test(segment)) return "PATCH auf die Repo-Einstellungen";
  return null;
}

/** Liest ab `von` ein Wort bis zum nächsten unquotierten Leerraum (bzw. bis zum schließenden Quote, wenn `von` schon in
 *  Anführungszeichen steht) und meldet, ob darin ein unmaskiertes `$` außerhalb von `'…'` steht. Maskiert: `\$` (Bash),
 *  `` `$ `` (PowerShell). */
function dynamischesWort(text, von, quote) {
  for (const { c, q, masked } of quoteFolge(text, von, quote)) {
    if (masked || q === "'") continue;
    if (c === "$") return true;
    if (q === null && /\s/.test(c)) return false;
  }
  return false;
}

/** Wörter ohne Optionen (und deren Werte) eines gh-api-Segments; das erste ist der Endpunkt. */
function endpunkt(segment) {
  const m = /gh(?:\.exe)?\s+api\b(.*)$/s.exec(segment);
  const tokens = (m?.[1] ?? "").match(/"(?:[^"\\`]|\\.|`.)*"|'[^']*'|\S+/g) ?? [];
  const MIT_WERT = new Set(["-X", "--method", "-f", "-F", "--field", "--raw-field", "-H", "--header", "-q", "--jq", "-t", "--template", "--hostname", "--input", "--cache"]);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith("-")) {
      if (MIT_WERT.has(tokens[i])) i++;
    } else return tokens[i];
  }
  return null;
}

/** Zusätzliche Rückfrage-Gründe für ein `gh api`-Segment, dessen Inhalt nicht statisch lesbar ist. */
function dynamischerGrund(segment, mutierend) {
  if (/(?:^|\s)(?:-X\s*|--method(?:\s+|=))['"]?\$/.test(segment)) return "die HTTP-Methode von `gh api` ist dynamisch (Variable)";
  if (/(?:^|\s)--input(?:\s|=)/.test(segment) || /query=@/.test(segment)) return "`gh api` liest die Anfrage aus einer Datei (--input / query=@), der Inhalt ist nicht prüfbar";
  const qi = segment.search(/\bquery=/);
  if (qi >= 0 && dynamischesWort(segment, qi + 6, quoteFolge(segment.slice(0, qi)).ende)) return "die GraphQL-Query von `gh api` ist dynamisch zusammengesetzt (Variable im query=)";
  const ep = endpunkt(segment);
  if (mutierend && ep && /^["']?\$/.test(ep)) return "schreibender `gh api`-Aufruf mit dynamischem Endpunkt (Variable)";
  return null;
}

/** Die Skript-Zeichenkette hinter `-c`/`-Command` bzw. `cmd /c` eines Interpreter-Segments, sonst null. */
function interpreterString(segment) {
  const m = /^[\s(`$&]*(?:\w+=\S*\s+)*(?:bash|sh|zsh|dash|pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*?-(?:c|lc|ec|Command)\s+(.+)$/is.exec(segment) ?? /^[\s(]*cmd(?:\.exe)?\s+\/c\s+(.+)$/is.exec(segment);
  if (!m) return null;
  const rest = m[1].trim();
  const q = rest[0];
  if ((q === '"' || q === "'") && rest.lastIndexOf(q) > 0) return rest.slice(1, rest.lastIndexOf(q)).replace(q === '"' ? /\\"/g : /''/g, q);
  return rest;
}

const REGEL = "Pre-Flight-Kriterien: AGENTS.md § Human-in-the-Loop-Checkpoints, Rückfrage bei der Maintainerin.";
const frage = (grund, nr = "#1311") => ({ ask: true, reason: `gh-Guard (${nr}): ${grund}. ${REGEL}` });
const hatVariable = (text) => /\$/.test(text.replace(/'[^']*'/g, "").replace(/\\\$|`\$/g, ""));

/** Ein `gh api`-Segment: Außenwirkung (#1204) oder nicht lesbarer Inhalt (#1311), sonst null. */
function ghApiSegment(segment) {
  const grund = segmentGrund(segment);
  if (grund) return frage(grund, "#1204");
  const m = methode(segment);
  const dyn = dynamischerGrund(segment, m !== null ? m !== "GET" : hatFelder(segment));
  return dyn ? frage(dyn) : null;
}

/** Ein Segment ohne `gh api` am Anfang, in einem Befehl, der `gh api` irgendwo enthält. */
function umweg(segment, tiefe) {
  if (/^[\s(]*(?:eval|iex|Invoke-Expression)\b/i.test(segment)) return frage("`eval`/`iex` neben `gh api`: der zusammengesetzte Aufruf ist nicht prüfbar");
  if (/^[\s(]*\$\{?\w+\}?(?![\w:]|\s*=)/.test(segment)) return frage("dynamisches Kommando ($CMD) neben `gh api`: der Aufruf ist nicht prüfbar");
  const inner = tiefe < MAX_INTERPRETER ? interpreterString(segment) : null;
  if (!inner) return null;
  if (hatVariable(inner)) return frage("Interpreter-String mit Variable neben `gh api`: der Aufruf ist nicht prüfbar");
  const r = bewerte(inner, tiefe + 1);
  return r.ask ? r : null;
}

/** Bewertet einen Befehl: `{ ask: true, reason }` bei einem `gh api`-Segment mit Außenwirkung oder nicht prüfbarem
 *  Inhalt (Variablen, `eval`/`iex`, Interpreter-Strings), sonst `{ ask: false }`. Nie `deny`. */
export function bewerte(command, tiefe = 0) {
  if (!command || typeof command !== "string") return { ask: false };
  const hatGhApi = /\bgh(?:\.exe)?\b/.test(command) && /\bapi\b/.test(command);
  for (const segment of segmente(command)) {
    const r = GH_API_AM_ANFANG.test(segment) ? ghApiSegment(segment) : hatGhApi ? umweg(segment, tiefe) : null;
    if (r) return r;
  }
  return { ask: false };
}

function main() {
  const { tool, command } = parseHookInput(readStdin());
  if (tool !== undefined && !GEPRUEFTE_TOOLS.includes(tool)) return;
  emit(mergeDecisions([bewerte(command)]));
}

if (istDirektaufruf(import.meta.url)) main();
