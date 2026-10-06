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
 * Quote-Zerlegung (`quoteFolge` in `quote-folge.mjs`) ist die EINE Hilfsfunktion für Segmentierung und Variablen-Suche.
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
import { MAX_INTERPRETER, buildAskOutput, emit, istDirektaufruf, mergeDecisions, parseHookInput, readStdin } from "./hook-io.mjs";
import { quoteFolge } from "./quote-folge.mjs";

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

/**
 * Präfixe vor einem Befehl, die iterativ abgeschält werden (jedes Muster einzeln und verankert, kein geschachteltes
 * Backtracking): PowerShell-Zuweisung `$r = ` und Cast `[array]`, Kontrollwörter (`if (…) {`, `foreach (…) {`, `then`, `do`,
 * `else`, `ForEach-Object {`, `-Process`), ein Block vor `else`/`catch`, Bash-`case`-Arme, Wrapper (`env`, `timeout 5`,
 * `xargs -n 1`, `time -p` …) und Variablen-Zuweisungen `FOO=1`. Hinter ihnen steht der eigentliche Befehl wie am Segmentanfang.
 */
const WRAPPER = "env|nice|nohup|sudo|doas|xargs|timeout|stdbuf|ionice|setsid|winpty|unbuffer|time|command|exec|builtin";
const PRAEFIXE = [
  /^\$[\w:]+\s*=\s*/,
  /^\[[\w.,[\] ]+\]\s*/,
  /^(?:if|elseif|foreach|while|for|switch|until)\s*\((?:[^()]|\([^()]*\))*\)\s*/,
  /^(?:if|then|else|elif|do|while|until|try|catch|finally|ForEach-Object|%)\s+/,
  /^-(?:Process|Begin|End)\s+/i,
  /^\{(?:[^{}]|\{[^{}]*\})*\}\s*(?=(?:else|elseif|catch|finally)\b)/,
  /^case\s+[^)]*\)\s*/,
  /^[\w*|]+\)\s+/,
  new RegExp(String.raw`^(?:${WRAPPER})\b(?:\s+(?:-\S*|\d+\S*|\w+=\S*))*\s+`),
  /^\w+=\S*\s+/,
];
const ZEICHEN_VOLL = /^[\s(`$@&!{]+/; // `$(gh api`, `@(gh api`, `& gh api`, `{ gh api`
const ZEICHEN_ENG = /^[\s(!{]+/; // wie voll, aber ein `$` bleibt stehen (dynamisches Kommando `$CMD`)

/** Schält die Präfixe ab; `mitSonderzeichen: false` lässt ein führendes `$`/`@`/`&` stehen. */
function abschaelen(segment, mitSonderzeichen) {
  const regeln = [...PRAEFIXE, mitSonderzeichen ? ZEICHEN_VOLL : ZEICHEN_ENG];
  let rest = segment;
  for (let n = 0; n < 50; n++) {
    const treffer = regeln.map((re) => re.exec(rest)).find((m) => m && m[0].length > 0);
    if (!treffer) break;
    rest = rest.slice(treffer[0].length);
  }
  return rest;
}

/** Steht `gh api` am Segmentanfang (hinter den Präfixen)? Ein Treffer in einem Textargument eines anderen Befehls zählt nicht. */
const beginntMitGhApi = (segment) => /^gh(?:\.exe)?\s+api\b/.test(abschaelen(segment, true));

/**
 * Zerlegt einen Befehl an `&&`, `||`, `;`, `|` und Zeilenumbrüchen, aber NICHT innerhalb von Anführungszeichen
 * (`'…'`, `"…"`, Escapes mit Backslash oder PowerShell-Backtick): eine mehrzeilige GraphQL-Query im Argument bleibt
 * ein Segment. `escAussen`: Backslash/Backtick maskieren auch außerhalb von Quotes (Bash: ``+Zeilenumbruch ist eine
 * Fortsetzung); ohne bleibt `C:dev; gh api …` getrennt (PowerShell-Pfade).
 */
export function segmente(command, escAussen = false) {
  const text = String(command);
  const out = [];
  let cur = "";
  const folge = quoteFolge(text, 0, null, escAussen);
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

/** Wörter eines Textes (Rohtext inkl. Quotes), getrennt an unquotiertem, unmaskiertem Leerraum. */
function woerter(text) {
  const out = [];
  let cur = "";
  for (const { c, q, masked } of quoteFolge(text)) {
    if (q === null && !masked && /\s/.test(c)) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** Der erste Nicht-Options-Wert eines gh-api-Segments (nach den Optionen mit Wert) ist der Endpunkt. */
function endpunkt(segment) {
  const m = /gh(?:\.exe)?\s+api\b(.*)$/s.exec(segment);
  const tokens = woerter(m?.[1] ?? "");
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

/** Wert eines Rohwortes: Anführungszeichen weglassen, maskierte Zeichen übernehmen (auch zusammengesetzte Wörter `'a'"b"c`). */
function wortWert(roh) {
  const f = quoteFolge(roh);
  let out = "";
  for (let k = 0; k < f.length; k++) {
    const { c, q, masked } = f[k];
    if (f[k + 1]?.masked) continue; // das Escape-Zeichen selbst
    if (!masked && (q === null ? c === "'" || c === '"' : c === q)) continue; // öffnendes/schließendes Quote
    out += c;
  }
  return out;
}

const SHELL_OPTIONEN_MIT_WERT = ["-o", "+o", "-O", "+O", "--rcfile", "--init-file"];

/** Die Skript-Zeichenkette hinter `-c`/`-Command` bzw. `cmd /c` eines Interpreter-Segments, sonst null. */
function interpreterString(segment) {
  const t = woerter(abschaelen(segment, false));
  while (t.length && /^\w+=/.test(t[0])) t.shift();
  const name = (t.shift() ?? "").replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.exe$/, "");
  if (name === "cmd") {
    const k = t.findIndex((x) => /^\/c$/i.test(x));
    return k >= 0 && t.length > k + 1 ? wortWert(t.slice(k + 1).join(" ")) : null;
  }
  if (!["bash", "sh", "zsh", "dash", "pwsh", "powershell"].includes(name)) return null;
  for (let i = 0; i < t.length; i++) {
    if (/^-(?:c|lc|ec|command)$/i.test(t[i])) return t[i + 1] === undefined ? null : wortWert(t[i + 1]);
    if (SHELL_OPTIONEN_MIT_WERT.includes(t[i])) i++;
    else if (!t[i].startsWith("-")) return null;
  }
  return null;
}

const REGEL = "Pre-Flight-Kriterien: AGENTS.md § Human-in-the-Loop-Checkpoints, Rückfrage bei der Maintainerin.";
const frage = (grund, nr = "#1311") => ({ ask: true, reason: `gh-Guard (${nr}): ${grund}. ${REGEL}` });
const hatVariable = (text) => quoteFolge(text).some(({ c, q, masked }) => c === "$" && q !== "'" && !masked);

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
  const rest = abschaelen(segment, false);
  if (/^(?:eval|iex|Invoke-Expression)\b/i.test(rest)) return frage("`eval`/`iex` neben `gh api`: der zusammengesetzte Aufruf ist nicht prüfbar");
  if (/^\$\{?\w+\}?(?![\w:]|\s*=)/.test(rest)) return frage("dynamisches Kommando ($CMD) neben `gh api`: der Aufruf ist nicht prüfbar");
  const inner = tiefe < MAX_INTERPRETER ? interpreterString(segment) : null;
  if (!inner) return null;
  if (hatVariable(inner)) return frage("Interpreter-String mit Variable neben `gh api`: der Aufruf ist nicht prüfbar");
  const r = bewerte(inner, tiefe + 1);
  return r.ask ? r : null;
}

/** Bewertet einen Befehl: `{ ask: true, reason }` bei einem `gh api`-Segment mit Außenwirkung oder nicht prüfbarem
 *  Inhalt (Variablen, `eval`/`iex`, Interpreter-Strings), sonst `{ ask: false }`. Nie `deny`. Segmentiert wird zweimal: mit
 *  Bash-Escapes (`\`+Zeilenumbruch ist eine Fortsetzung) und ohne (PowerShell-Pfade `C:\dev\;`); das strengere Ergebnis gilt. */
export function bewerte(command, tiefe = 0) {
  if (!command || typeof command !== "string") return { ask: false };
  const hatGhApi = /\bgh(?:\.exe)?\b/.test(command) && /\bapi\b/.test(command);
  for (const segment of new Set([...segmente(command, true), ...segmente(command, false)])) {
    const r = beginntMitGhApi(segment) ? ghApiSegment(segment) : hatGhApi ? umweg(segment, tiefe) : null;
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
