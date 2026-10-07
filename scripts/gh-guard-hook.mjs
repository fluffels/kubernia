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
 * Erkennung ohne Befehlsposition: `gh api` zählt an JEDER Stelle des Befehls, die nicht in Anführungszeichen steht
 * (`try { gh api … }`, `(gh api …)`, `` `gh api …` ``, `watch gh api …`, `>/dev/null gh api …`, `. gh api …`, hinter beliebigen
 * Wrappern, auch als `/usr/bin/gh` oder `'gh'`). Text in Quotes (`gh issue comment --body "gh api -X DELETE"`) zählt nicht;
 * Aufrufe in Quotes erreicht der Hook über Interpreter-Strings (`bash -c "…"`, rekursiv bis `MAX_INTERPRETER`) und `$( … )`.
 *
 * Er fragt auch, wenn der Aufruf nicht statisch lesbar ist: dynamische Methode (`-X $M`), dynamische GraphQL-Query
 * (unmaskiertes `$` im `query=`), `--input`/`query=@datei`, ein schreibender Aufruf mit dynamischem Endpunkt, `eval`/
 * `iex`/`Invoke-Expression`, ein dynamisches Kommando (`$CMD`, `& $c`) und ein Interpreter-String mit Variable neben `gh api`.
 *
 * Warum kein `parseBash`: der Hook gilt für Bash UND PowerShell mit EINER Implementierung. PowerShell hat Backtick-
 * Escapes, Zuweisungen mit Cast (`[array]$r = gh api …`) und `$(…)`/`@(…)` ohne Bash-Entsprechung. Der Quote-Dialekt
 * (Backslash gegen Backtick als Escape) kommt als Parameter `{ shell }` vom Tool (Dispatcher, Direktaufruf); ohne Angabe und für `cmd` gilt
 * der neutrale (beide). Ein innerer Interpreter-String liest im Dialekt seiner Shell, `$( … )` im äußeren. Die gemeinsame
 * Quote-Zerlegung (`quoteFolge` in `quote-folge.mjs`) ist die EINE Hilfsfunktion für Segmentierung, Variablen-Suche und
 * Wörter. Laufzeit: Befehle mit `gh api` über `LAENGE_MAX` Zeichen und Befehle mit mehr als `STELLEN_MAX` Fundstellen
 * (gh/Interpreter) fragen pauschal, damit die Prüfung nie zum Timeout des Dispatchers wird.
 *
 * Bewusste Grenzen:
 *  - Textprüfung je Segment (Trenner `&&`/`||`/`;`/`|`/Zeilenumbruch außerhalb von Anführungszeichen, mehrzeilige
 *    Queries bleiben ein Segment), kein vollständiges Shell-Parsing. Er fängt die dokumentierten Formen, keine
 *    absichtliche Umgehung (`-X DEL""ETE`, Skripte, andere Interpreter wie `node -e`); die eigentliche Durchsetzung bleibt
 *    PR-Gate + Review.
 *  - Backtick-Ersetzungen werden nur unter Bash erkannt und nicht geschachtelt; Wrapper vor einer Variablen höchstens mit 4
 *    Options-/Wertwörtern; neue Umwege (Verschleierung, exotische Shell-Formen) sind Bekannte Grenzen und kein Fehler des Guards
 *    (Blocker-Maßstab, docs/agent-harness.md §4). Bekannt: `gh api`-Text in Heredocs ohne Daten-Befehl davor bleibt Befehlstext (fragt).
 *  - Er schaut nur auf `gh api`: `gh issue delete` & Co. stehen als eigene `ask`-Regeln in settings.json.
 *  - Fail-open bei kaputtem Payload: der Hook darf nie selbst jeden Aufruf blockieren.
 *
 * Reines Node-Skript (nur Builtins). `bewerte` ist pur und exportiert.
 */
import { MAX_INTERPRETER, buildAskOutput, emit, istDirektaufruf, mergeDecisions, parseHookInput, readStdin } from "./hook-io.mjs";
import { quoteFolge } from "./quote-folge.mjs";
import { INTERPRETER_NAMEN, SHELLS, SHELL_VON_TOOL, WRAPPER_NAMEN, baseName } from "./shell-tabellen.mjs";

export { buildAskOutput, parseHookInput };

/** Quote-Dialekt der Shell, die den gerade bewerteten Text liest: `"bash"` (Backslash maskiert), `"powershell"` (Backtick
 *  maskiert, `\` ist ein Pfadzeichen), `"neutral"` (beides; Tool unbekannt). Gesetzt nur von `bewerteIntern` (synchron, mit
 *  try/finally); alle Zerlegungen laufen über `qf`, damit der Dialekt nicht durch jede Hilfsfunktion gereicht werden muss. */
let dialekt = "neutral";
const qf = (text, von = 0, q0 = null, escAussen = true) => quoteFolge(text, von, q0, escAussen, dialekt);
/** Dialekt des Skripts, das ein Interpreter liest (`bash -c "…"` → bash, `pwsh -Command` → powershell, sonst neutral). */
const dialektVon = (name) => (SHELLS.has(name) ? "bash" : name === "pwsh" || name === "powershell" ? "powershell" : "neutral");

/** Tools, für die der Hook gilt. */
export const GEPRUEFTE_TOOLS = Object.keys(SHELL_VON_TOOL);

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
  /\bupdateRefs?(?=\s*\()/,
];

/** REST-Pfade für Einstellungen und Veröffentlichung. */
const REST_PFADE = [
  /\/rulesets\b/,
  /\/branches\/[^\s'"]+\/protection\b/,
  /\/actions\/(secrets|variables)\b/,
  /\/(environments|collaborators|hooks|keys|discussions)\b/,
  /\/(dependabot|codespaces)\/secrets\b/,
  /\/transfer\b/,
  /\/git\/refs\//,
];

/** Befehle länger als das werden nicht mehr zerlegt (Laufzeit der Hook-Prüfung): enthält er `gh api`, wird gefragt. */
const LAENGE_MAX = 50_000;
/** Mehr Fundstellen (gh, Interpreter) je Segment werden nicht einzeln geprüft: es wird gefragt. */
const STELLEN_MAX = 50;

/**
 * Zerlegt einen Befehl an `&&`, `||`, `;`, `|` und Zeilenumbrüchen, aber NICHT innerhalb von Anführungszeichen
 * (`'…'`, `"…"`, Escapes mit Backslash oder PowerShell-Backtick): eine mehrzeilige GraphQL-Query im Argument bleibt
 * ein Segment. `escAussen`: Backslash/Backtick maskieren auch außerhalb von Quotes (Bash: `\`+Zeilenumbruch ist eine
 * Fortsetzung); ohne bleibt `C:\dev\; gh api …` getrennt (PowerShell-Pfade).
 */
export function segmente(command, escAussen = false) {
  const text = String(command);
  const out = [];
  let cur = "";
  const folge = qf(text, 0, null, escAussen);
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

/** Zeilenfortsetzungen (`\`+Zeilenumbruch in Bash, Backtick+Zeilenumbruch in PowerShell, auch CRLF) außerhalb von `'…'` durch ein Leerzeichen ersetzen. */
function ohneFortsetzung(text) {
  const f = qf(text);
  let out = "";
  for (let k = 0; k < f.length; k++) {
    const n = f[k + 1];
    if (n?.masked && (n.c === "\n" || n.c === "\r")) {
      out += " ";
      k++;
      if (f[k].c === "\r" && f[k + 1]?.masked && f[k + 1].c === "\n") k++;
    } else out += f[k].c;
  }
  return out;
}

/** Text derselben Länge, in dem alle Zeichen in Quotes oder hinter einem Escape durch einen Platzhalter ersetzt sind
 *  (ein `gh api` im Argumenttext eines anderen Befehls zählt nicht, ein offenes `gh api` an beliebiger Stelle schon). */
function ohneQuoteInhalt(text) {
  return qf(text, 0, null, false) // Backslash außerhalb von Quotes ist ein Pfadzeichen, kein Escape
    .map((e) => ((e.q !== null && !(e.c === e.q && !e.masked)) || e.masked ? "\uE000" : e.c)) // Quote-Zeichen selbst bleiben stehen
    .join("");
}

/** Wörter eines Textes (Rohtext inkl. Quotes), getrennt an unquotiertem, unmaskiertem Leerraum. */
function woerter(text) {
  const out = [];
  let cur = "";
  for (const { c, q, masked } of qf(text)) {
    if (q === null && !masked && /\s/.test(c)) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** Wert eines Rohwortes: Anführungszeichen weglassen, maskierte Zeichen übernehmen (auch zusammengesetzte Wörter `'a'"b"c`). */
function wortWert(roh) {
  const f = qf(roh);
  let out = "";
  for (let k = 0; k < f.length; k++) {
    const { c, q, masked } = f[k];
    if (f[k + 1]?.masked) continue; // das Escape-Zeichen selbst
    if (!masked && (q === null ? c === "'" || c === '"' : c === q)) continue; // öffnendes/schließendes Quote
    out += c;
  }
  return out;
}

/** Basisname des Kommandowortes (`/usr/bin/gh`, `'gh'`, `C:\Windows\cmd.exe`): Quotes außen entfernen, der Rest bleibt roh (ein `\` ist hier ein Pfadtrenner). */
const kommandoName = (roh) => baseName(roh.replace(/^['"]|['"]$/g, ""));

/** Zeichen vor einem Kommandowort: alles außer den Zeichen, die zu einem Pfad/Namen gehören (`~`, `:` inklusive: sonst quadratisches Backtracking bei `~/~/…`). */
const WORTANFANG = String.raw`(^|[^\w.:~\\/-])`;
const GH_BARE = new RegExp(String.raw`${WORTANFANG}((?:[\w.:~-]*[\\/])*gh(?:\.exe)?)\s+(?:api\b|(['"])\uE000*\3)`, "gi");
const GH_QUOTE = /(^|[^\w])(['"])\uE000*\2\s+(?:api\b|(['"])\uE000*\3)/g;
const GH_QUOTE_ORIGINAL = /^(['"])(?:[^'"]*[\\/])?gh(?:\.exe)?\1\s/;
const INTERPRETER_STELLE = new RegExp(String.raw`${WORTANFANG}((?:[\w.:~-]*[\\/])*(?:${INTERPRETER_NAMEN.join("|")})(?:\.exe)?)\s`, "gi");
const EVAL_STELLE = new RegExp(String.raw`${WORTANFANG}(?:eval|iex|Invoke-Expression)\b`, "i");

/** Startindizes (im Originaltext) von `gh api` an beliebiger Stelle außerhalb von Quotes; das zweite Wort wird geprüft (`gh 'api'`). */
function ghStellen(text, maske) {
  const kandidaten = [];
  for (const x of maske.matchAll(GH_BARE)) kandidaten.push(x.index + x[1].length);
  for (const x of maske.matchAll(GH_QUOTE)) {
    const start = x.index + x[1].length;
    if (GH_QUOTE_ORIGINAL.test(text.slice(start, start + 400))) kandidaten.push(start);
  }
  return kandidaten.filter((start) => wortWert(woerter(text.slice(start, start + 400))[1] ?? "") === "api");
}

/** Startindizes eines Interpreter-Wortes (Shell, pwsh, cmd) außerhalb von Quotes. */
const interpreterStellen = (maske) => [...maske.matchAll(INTERPRETER_STELLE)].map((x) => x.index + x[1].length);

/** Die äußersten `$( … )` außerhalb von `'…'` (die Rekursion in `bewerte` erledigt die tieferen). */
function ersetzungen(text) {
  const f = qf(text);
  const out = [];
  for (let k = 0; k < f.length - 1; k++) {
    if (f[k].c !== "$" || f[k].q === "'" || f[k].masked || f[k + 1].c !== "(") continue;
    let tiefe = 1;
    let j = k + 2;
    for (; j < f.length && tiefe > 0; j++) {
      const e = f[j];
      if (e.q !== "'" && !e.masked) tiefe += e.c === "(" ? 1 : e.c === ")" ? -1 : 0;
    }
    out.push(f.slice(k + 2, tiefe === 0 ? j - 1 : j).map((e) => e.c).join(""));
    k = j - 1; // verschachtelte Ersetzungen liefert die Rekursion
  }
  if (dialekt === "bash") out.push(...backtickErsetzungen(f));
  return out;
}

/** Backtick-Paare (Bash-Befehlsersetzung, auch in `"…"`) außerhalb von `'…'` und ohne `\`-Maskierung; ohne schließenden
 *  Backtick reicht der Inhalt bis zum Ende. Nur im Bash-Dialekt: in PowerShell ist der Backtick ein Escape. Geschachtelte
 *  Backticks (`\``) liefert die Rekursion nicht gesondert (bewusste Grenze). */
function backtickErsetzungen(f) {
  const offen = (e) => e.c === "`" && e.q !== "'" && !e.masked;
  const out = [];
  for (let k = 0; k < f.length; k++) {
    if (!offen(f[k])) continue;
    let j = k + 1;
    while (j < f.length && !offen(f[j])) j++;
    out.push(f.slice(k + 1, j).map((e) => e.c).join(""));
    k = j;
  }
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
  for (const { c, q, masked } of qf(text, von, quote)) {
    if (masked || q === "'") continue;
    if (c === "$") return true;
    if (q === null && /\s/.test(c)) return false;
  }
  return false;
}

/** Der erste Nicht-Options-Wert eines gh-api-Segments (nach den Optionen mit Wert) ist der Endpunkt. */
function endpunkt(segment) {
  const tokens = woerter(segment).slice(2); // gh, api
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
  if (qi >= 0 && dynamischesWort(segment, qi + 6, qf(segment.slice(0, qi)).ende)) return "die GraphQL-Query von `gh api` ist dynamisch zusammengesetzt (Variable im query=)";
  const ep = endpunkt(segment);
  if (mutierend && ep && /^["']?\$/.test(ep)) return "schreibender `gh api`-Aufruf mit dynamischem Endpunkt (Variable)";
  return null;
}

const REGEL = "Pre-Flight-Kriterien: AGENTS.md § Human-in-the-Loop-Checkpoints, Rückfrage bei der Maintainerin.";
const frage = (grund, nr = "#1311") => ({ ask: true, reason: `gh-Guard (${nr}): ${grund}. ${REGEL}` });
const hatVariable = (text) => qf(text).some(({ c, q, masked }) => c === "$" && q !== "'" && !masked);

/** Ein `gh api`-Aufruf ab seinem Startindex: Außenwirkung (#1204) oder nicht lesbarer Inhalt (#1311), sonst null. */
function ghApiAufruf(aufruf) {
  const grund = segmentGrund(aufruf);
  if (grund) return frage(grund, "#1204");
  const m = methode(aufruf);
  const dyn = dynamischerGrund(aufruf, m !== null ? m !== "GET" : hatFelder(aufruf));
  return dyn ? frage(dyn) : null;
}

/** Die Skript-Zeichenkette hinter `-c`/`-xc`/`-Command` bzw. `cmd /c` eines Interpreter-Aufrufs (`roh` mit Quotes der
 *  äußeren Shell, `wert` ohne), sonst null. Die Option wird irgendwo in den Wörtern gesucht (`-ExecutionPolicy Bypass -Command`). */
function interpreterString(aufruf) {
  const t = woerter(aufruf);
  const name = kommandoName(t[0] ?? "");
  const rest = t.slice(1);
  if (name === "cmd") {
    const k = rest.findIndex((x) => /^\/c$/i.test(x));
    const roh = rest.slice(k + 1).join(" ");
    return k >= 0 && roh ? { roh, wert: wortWert(roh), dialekt: dialektVon(name) } : null;
  }
  const option = SHELLS.has(name) ? /^-[A-Za-z]*c[A-Za-z]*$/ : /^-(?:c|command)$/i;
  if (!SHELLS.has(name) && name !== "pwsh" && name !== "powershell") return null;
  const k = rest.findIndex((x) => option.test(x));
  const v = k < 0 ? undefined : rest[k + 1] === "--" ? rest[k + 2] : rest[k + 1];
  return v === undefined ? null : { roh: v, wert: wortWert(v), dialekt: dialektVon(name) };
}

/** Kommandoposition am Segmentanfang: Klammern, `!`, Kontrollwörter (`then`, `do`, `try`, `if (…)` …) davor; Wrapper streift `ohneWrapper` vorher ab. */
const KOMMANDOPOS = String.raw`^(?:[\s(!{]|(?:then|do|else|elif|if|while|until|try|catch|finally|ForEach-Object)\s|(?:if|elseif|foreach|while|switch)\s*\([^)]*\))*`;

const WRAPPER_ALT = [...WRAPPER_NAMEN].join("|");
const WRAPPER_VOR_VARIABLE = new RegExp(String.raw`(?<=^|[\s(!{])(?:${WRAPPER_ALT})(?:\s+[^\s$;|&()]+){0,4}(?=\s+(?:\$|(?:${WRAPPER_ALT})\s))`, "g");
/** Streicht Wrapper (Namen aus `WRAPPER_NAMEN`, eine Quelle mit dem Worktree-Guard) samt bis zu 4 Options-/Wertwörtern, wenn danach eine
 *  Variable oder ein weiterer Wrapper folgt (`timeout 5 $GH`, `sudo -u x $GH`, `nice -n 5 $GH`). Linear: jede Fundstelle liest höchstens 5 Wörter. */
const ohneWrapper = (maske) => maske.replace(WRAPPER_VOR_VARIABLE, "");

/** Dynamisches Kommando neben `gh api`: `$c api …` (die Variable steht für `gh`) an beliebiger Stelle, `& $c`/`. $c` (Aufrufoperator)
 *  und `$X <Argumente>` an Kommandoposition, wenn `X` im Befehl einen String oder eine Ersetzung mit `gh` bekommt (`GH="gh api"; $GH -X …`,
 *  `x=$(…gh…); $x`). Ein bloßes PowerShell-`$x` (`$items | …`, `$r.title`) führt nichts aus und zählt nicht; `jq . $F` auch nicht. */
function dynamischesKommando(segment, maske, command) {
  const frei = ohneWrapper(maske);
  const quote = String.raw`["']?`;
  const wort = String.raw`(?:\$\{?\w+\}?|\$\([^)]*\)|\`[^\`]*\`)`; // Variable, Ersetzung oder Backtick als Kommandowort
  if (new RegExp(String.raw`(^|[\s(!{&.])${quote}${wort}${quote}\s+${quote}api${quote}(?=\s|$)`).test(segment)) return true;
  if (/(?:^|[^&>\w])&\s*\$\{?\w+/.test(maske) || new RegExp(String.raw`${KOMMANDOPOS}\.\s*\$\{?\w+`).test(frei)) return true; // `&` an jeder Stelle, `.` nur an Kommandoposition (`jq . $F`)
  const variable = new RegExp(String.raw`${KOMMANDOPOS}\$\{?(\w+)\}?(?=[\s)}]|$)`).exec(frei);
  return variable !== null && new RegExp(String.raw`\b${variable[1]}\s*=\s*(?:['"][^'"]*\bgh\b|\$\([^)]*\bgh\b|\`[^\`]*\bgh\b)`).test(command);
}

/** Ein Segment, in einem Befehl, der `gh api` irgendwo enthält: Interpreter-Strings (rekursiv), eval/iex, dynamisches Kommando. */
function umweg(segment, maske, tiefe, command) {
  if (EVAL_STELLE.test(maske)) return frage("`eval`/`iex` neben `gh api`: der zusammengesetzte Aufruf ist nicht prüfbar");
  if (dynamischesKommando(segment, maske, command)) return frage("dynamisches Kommando ($CMD) neben `gh api`: der Aufruf ist nicht prüfbar");
  if (tiefe >= MAX_INTERPRETER) return null;
  const stellen = interpreterStellen(maske);
  if (stellen.length > STELLEN_MAX) return frage("zu viele Interpreter-Aufrufe für die Textprüfung");
  for (const start of stellen) {
    const ip = interpreterString(segment.slice(start));
    if (!ip) continue;
    if (hatVariable(ip.roh)) return frage("Interpreter-String mit Variable neben `gh api`: der Aufruf ist nicht prüfbar");
    const r = bewerteIntern(ip.wert, tiefe + 1, command, ip.dialekt);
    if (r.ask) return r;
  }
  return null;
}

/** Ein `$( … )` innerhalb eines Segments (`echo "$(gh api -X DELETE …)"`): der Inhalt wird einzeln bewertet. */
function ersetzung(segment, tiefe, command) {
  if (tiefe >= MAX_INTERPRETER) return null;
  for (const inner of ersetzungen(segment)) {
    const r = bewerteIntern(inner, tiefe + 1, command, dialekt);
    if (r.ask) return r;
  }
  return null;
}

/** Ein Segment bewerten: jedes offene `gh api` (Außenwirkung), dann Umwege und Ersetzungen. */
function segmentUrteil(segment, command, tiefe) {
  const maske = ohneQuoteInhalt(segment);
  const stellen = ghStellen(segment, maske);
  if (stellen.length > STELLEN_MAX) return frage("zu viele gh-api-Aufrufe für die Textprüfung");
  for (const start of stellen) {
    const r = ghApiAufruf(segment.slice(start));
    if (r) return r;
  }
  return umweg(segment, maske, tiefe, command) ?? ersetzung(segment, tiefe, command);
}

const HEREDOC = /<<-?[ \t]*(?:'(\w+)'|"(\w+)"|\\(\w+))/g;
const KONSUMENT = new RegExp(String.raw`${WORTANFANG}(?:(?:${INTERPRETER_NAMEN.join("|")}|eval|source|iex)(?:\.exe)?\b|\.(?=\s))`, "i");
/** Befehle, die einen Heredoc nur als Daten lesen (Commit-/PR-Texte, Dateien schreiben). */
const DATEN_BEFEHL = /(?:^|[\s("'])(?:cat|tee|git\s+commit|gh\s+(?:pr|issue|release|repo|gist)\s+\w+)\b[^\n<|;&#]*$/;

/** Entfernt die Bodies von Heredocs mit gequotetem Begrenzer (`<<'EOF'`: reiner Text), aber nur in der sicheren Form: der Befehl
 *  davor ist ein Daten-Befehl (`cat`, `tee`, `git commit`, `gh pr/issue …`), hinter dem Begrenzer steht nichts (außer `)`/`"`), und
 *  im Rest des Befehls (ohne diese Bodies) außerhalb von Quotes weder ein Interpreter noch `eval`/`source` vorkommt (`cat > x.sh <<'EOF' … EOF; bash x.sh`);
 *  Wörter wie `bash` im Heredoc-Text selbst zählen nicht.
 *  Commit-/PR-Texte, die `gh api` nur erwähnen, fragen so nicht; im Zweifel bleibt der Body Befehlstext. */
function ohneDatenHeredocs(text) {
  if (!text.includes("<<")) return text;
  let out = "";
  let pos = 0;
  let zeilenEnde = -1;
  for (const m of text.matchAll(HEREDOC)) {
    if (m.index < pos) continue;
    if (zeilenEnde < m.index) zeilenEnde = text.indexOf("\n", m.index); // je Zeile nur einmal suchen (viele Marker auf einer Zeile)
    if (zeilenEnde < 0) break;
    const dahinter = text.slice(m.index + m[0].length, zeilenEnde);
    if (!/^[\s)"]*$/.test(dahinter)) continue; // billige Prüfung zuerst: nur der letzte Marker einer Zeile passt, sonst bliebe die Suche quadratisch
    const davor = text.slice(text.lastIndexOf("\n", m.index) + 1, m.index);
    if (!DATEN_BEFEHL.test(davor)) continue;
    const ende = new RegExp(String.raw`^\t*${m[1] ?? m[2] ?? m[3]}[ \t]*$`, "m").exec(text.slice(zeilenEnde + 1));
    if (!ende) break; // ohne Terminator bleibt alles Befehlstext (und die Suche endet: kein quadratischer Aufwand)
    out += text.slice(pos, zeilenEnde + 1);
    pos = zeilenEnde + 1 + ende.index + ende[0].length;
  }
  const rest = out + text.slice(pos);
  return KONSUMENT.test(ohneQuoteInhalt(rest)) ? text : rest; // zweiter Durchgang: ein Konsument zählt nur außerhalb der Daten-Heredocs
}

/** Bewertet einen Befehl: `{ ask: true, reason }` bei einem `gh api` mit Außenwirkung oder nicht prüfbarem Inhalt
 *  (Variablen, `eval`/`iex`, Interpreter-Strings, Ersetzungen), sonst `{ ask: false }`. Nie `deny`. Segmentiert wird
 *  zweimal: mit Bash-Escapes (`\`+Zeilenumbruch ist eine Fortsetzung) und ohne (PowerShell-Pfade `C:\dev\;`); das
 *  strengere Ergebnis gilt. Fortsetzungen werden vor den Textprüfungen zu Leerzeichen. */
function bewerteIntern(command, tiefe, kontext, d) {
  const vorher = dialekt;
  dialekt = d;
  try {
    if (!command || typeof command !== "string") return { ask: false };
    if (!(/\bgh(?:\.exe)?\b/i.test(kontext) && /\bapi\b/.test(kontext))) return { ask: false }; // ohne gh und api kann nichts davon zutreffen
    if (command.length > LAENGE_MAX) return frage("der Befehl ist für die Textprüfung zu lang");
    const text = ohneDatenHeredocs(command);
    for (const roh of new Set([...segmente(text, true), ...segmente(text, false)])) {
      const r = segmentUrteil(ohneFortsetzung(roh), kontext, tiefe);
      if (r) return r;
    }
    return { ask: false };
  } finally {
    dialekt = vorher;
  }
}

/** Öffentlicher Einstieg. `shell`: `"bash"` | `"powershell"` (Tool des Hooks), sonst neutral (beide Escape-Arten). */
export function bewerte(command, { shell } = {}) {
  return bewerteIntern(command, 0, command, shell === "bash" || shell === "powershell" ? shell : "neutral");
}

function main() {
  const { tool, command } = parseHookInput(readStdin());
  if (tool !== undefined && !Object.hasOwn(SHELL_VON_TOOL, tool)) return;
  emit(mergeDecisions([bewerte(command, { shell: tool === undefined ? undefined : SHELL_VON_TOOL[tool] })]));
}

if (istDirektaufruf(import.meta.url)) main();
