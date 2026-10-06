// Kein Shebang: wird über `.claude/settings.json` per `node scripts/gh-guard-hook.mjs` gestartet UND von
// test/harness/gh-guard.test.ts importiert (ein `#!` bricht den Test-Import, wie bei worktree-guard-hook.mjs).
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
 * Bewusste Grenzen (ehrlich, wie beim worktree-guard):
 *  - Grobe Textprüfung je Segment (Trenner `&&`/`||`/`;`/`|`/Zeilenumbruch außerhalb von Anführungszeichen,
 *    mehrzeilige Queries bleiben ein Segment), kein Shell-Parsing. Eine über
 *    Variablen oder `eval` zusammengesetzte Mutation sieht er nicht. Er fängt die dokumentierten Formen,
 *    keine absichtliche Umgehung; die eigentliche Durchsetzung bleibt PR-Gate + Review.
 *  - Er schaut nur auf `gh api`: `gh issue delete` & Co. stehen als eigene `ask`-Regeln in settings.json.
 *  - Ein Treffer in einem Textargument eines anderen Befehls (`gh issue comment --body "deleteIssue"`,
 *    Commit-Text mit "gh api") zählt nicht: `gh api` muss am Segmentanfang stehen.
 *  - Fail-open bei kaputtem Payload: der Hook darf nie selbst jeden Aufruf blockieren.
 *
 * Reines Node-Skript (nur Builtins). `bewerte` ist pur und exportiert.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

/** `gh api` als Befehl am Segmentanfang (auch nach `&`, `$(`, Klammern oder Variablen-Zuweisungen), nicht als Text in einem fremden Befehl. */
const GH_API_AM_ANFANG = /^[\s(`$&]*(?:\w+=\S*\s+)*gh(?:\.exe)?\s+api\b/;

/**
 * Zerlegt einen Befehl an `&&`, `||`, `;`, `|` und Zeilenumbrüchen, aber NICHT innerhalb von Anführungszeichen
 * (`'…'`, `"…"`, PowerShell-Backtick als Escape): eine mehrzeilige GraphQL-Query im Argument bleibt ein Segment.
 */
export function segmente(command) {
  const out = [];
  let cur = "";
  let quote = null;
  const text = String(command);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === "`" && quote === '"' && i + 1 < text.length) cur += text[++i];
      else if (c === "\\" && quote === '"' && i + 1 < text.length) cur += text[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    const zwei = text.slice(i, i + 2);
    if (zwei === "&&" || zwei === "||") { out.push(cur); cur = ""; i++; continue; }
    if (c === ";" || c === "|" || c === "\n") { out.push(cur); cur = ""; continue; }
    if (c !== "\r") cur += c;
  }
  out.push(cur);
  return out;
}

/** Die ausdrücklich gewählte HTTP-Methode (`-X`/`--method`, auch `--method=DELETE`), sonst null. */
function methode(segment) {
  const m = /(?:^|\s)(?:-X|--method)(?:\s+|=)['"]?([A-Za-z]+)['"]?/.exec(segment);
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

/** Bewertet einen Befehl: `{ ask: true, reason }` bei einem `gh api`-Segment mit Außenwirkung, sonst `{ ask: false }`. */
export function bewerte(command) {
  if (!command || typeof command !== "string") return { ask: false };
  for (const segment of segmente(command)) {
    if (!GH_API_AM_ANFANG.test(segment)) continue;
    const grund = segmentGrund(segment);
    if (grund) return { ask: true, reason: `gh-Guard (#1204): ${grund}. Pre-Flight-Kriterien: AGENTS.md § Human-in-the-Loop-Checkpoints, Rückfrage bei der Maintainerin.` };
  }
  return { ask: false };
}

/** Parst das Hook-stdin-JSON tolerant: bei kaputtem/leerem Input `{}` statt zu werfen. */
export function parseHookInput(text) {
  try {
    const data = JSON.parse(text);
    return { tool: data.tool_name, command: data.tool_input?.command };
  } catch {
    return {};
  }
}

/** Die dokumentierte `hookSpecificOutput`-JSON für ein `PreToolUse`-Ask. */
export function buildAskOutput(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } };
}

function main() {
  let text;
  try {
    text = readFileSync(0, "utf8");
  } catch {
    text = "";
  }
  const { tool, command } = parseHookInput(text);
  if (tool !== undefined && !GEPRUEFTE_TOOLS.includes(tool)) return;
  const r = bewerte(command);
  if (r.ask) console.log(JSON.stringify(buildAskOutput(r.reason)));
  // Kein process.exit(): natürliches Ende flusht stdout auf Windows zuverlässig (wie worktree-guard-hook.mjs).
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
