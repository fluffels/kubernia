// Kein Shebang: wird von scripts/token-baseline.mjs und test/brain-metrics.test.ts importiert.
/**
 * Projekt-Brain-Kennzahlen pro Ticket-Lauf (#1205, ADR 0015): welche Brain-Seiten (`docs/**.md`) ein Lauf
 * liest, wie viel er sucht, wie früh er den ersten Edit setzt und ob er das Brain pflegt.
 * Definition der Kennzahlen: docs/model-routing.md §5 „Projekt-Brain-Kennzahlen“.
 *
 * Pur und ohne IO; zwei Quellen liefern dieselbe Eventform `{ ts, tool, input, resultChars }`
 * (Claude-Code-Transkript, Langfuse-TOOL-Observations). Importiert nichts aus token-baseline.mjs (kein Zyklus).
 */

import { einfacheKommandos, parseBash } from "./bash-parser.mjs";
import { transkriptZeilen } from "./transkript.mjs";
export { transkriptZeilen }; // bleibt hier erreichbar (Aufrufer und Tests), die Quelle ist transkript.mjs

/** Grobe Umrechnung Zeichen → Tokens (nur Größenordnung, bewusst keine Tokenizer-Abhängigkeit). */
export const CHARS_PER_TOKEN = 4;

const READ_CMDS = new Set(["cat", "head", "tail", "less", "more", "sed", "awk", "bat", "get-content", "gc", "type"]);
const SEARCH_CMDS = new Set(["grep", "egrep", "fgrep", "rg", "find", "fd", "ag", "select-string", "sls"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SCRATCH = /[\\/](Temp|tmp)[\\/]/i;

const norm = (p) => String(p ?? "").replace(/\\/g, "/");

/**
 * Seitenschlüssel: Pfad ab dem LETZTEN `docs/`-Segment, klein geschrieben; dieselbe Seite per absolutem, relativem, Worktree- oder
 * Windows-Pfad (`C:\Dev\X\Docs\Model-Routing.md`) ist eine Seite. Bekannte Grenze: Liegt unterhalb von `docs/` nochmals ein Ordner
 * `docs/` (`docs/module/docs/x.md`), gewinnt der innere; Brain-Seiten tragen das nicht.
 */
const pageKey = (p) => norm(p).toLowerCase().replace(/^.*(?:^|\/)docs\//, "docs/");

/** Brain-Seite = Markdown unter einem `docs/`-Ordner (nicht in node_modules). */
export function isBrainPage(path) {
  const p = norm(path);
  if (p.split("/").includes("node_modules")) return false;
  return /(^|\/)docs\/(.+\/)?[^/]+\.md$/i.test(p);
}

/** Globale git-Optionen mit eigenem Wert (`git -C <dir> show …`). */
const GIT_GLOBAL_MIT_WERT = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

/**
 * Brain-Pfade, die `git [globale Optionen] show <rev>:<pfad>` liest (#1331): der Präfix `<rev>:` fällt weg, damit
 * `isBrainPage` greift (`origin/main:docs/x.md` hat vor `docs/` ein `:` statt `/`). Andere git-Unterbefehle: leer.
 * Ein Windows-Laufwerkspfad (`C:\x`, `C:/x`) ist kein `<rev>:`.
 */
function gitShowBrainPfade(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) i += GIT_GLOBAL_MIT_WERT.has(args[i]) ? 2 : 1;
  if (args[i] !== "show") return [];
  return args
    .slice(i + 1)
    .filter((a) => !a.startsWith("-"))
    .map((a) => /^(?![A-Za-z]:[\\/])[^:\s]+:(.+)$/.exec(a)?.[1])
    .filter((p) => p && isBrainPage(p));
}

/** Kommandos als Wortlisten: Bash über den AST, sonst (und für PowerShell) grobe Trennung. */
function commandsOf(command, tool) {
  if (tool === "Bash") {
    const r = parseBash(command);
    if (r.ok) return einfacheKommandos(r.ast);
  }
  // Rückfall (PowerShell, nicht zerlegbares Bash): grobe Trennung auch an Klammern, umschließende Quotes der Wörter weg
  // (`$t = (Get-Content 'docs/a.md' -Raw)` → `Get-Content`, `docs/a.md`, `-Raw`). Bekannte Grenze: Wörter in Strings bleiben Text.
  return String(command ?? "")
    .split(/[;|\n(){}]|&&|\|\|/)
    .map((s) => s.trim().split(/\s+/).map((w) => w.replace(/^['"]+|['"]+$/g, "")).filter(Boolean))
    .filter((words) => words.length);
}

/**
 * Lese-/Suchzugriffe eines Shell-Befehls: `brainReads` = Brain-Pfade als Argument eines Lesekommandos,
 * `search` = mindestens ein Suchkommando. `grep … docs/x.md` zählt bewusst als Suche, nicht als Lesen.
 */
export function classifyShell(command, tool = "Bash") {
  const brainReads = [];
  let search = false;
  for (const words of commandsOf(command, tool)) {
    const name = (words[0] ?? "").toLowerCase();
    const args = words.slice(1);
    const isSearch =
      SEARCH_CMDS.has(name) ||
      (name === "git" && args[0] === "grep") ||
      (name === "get-childitem" && args.some((a) => /^-r(ecurse)?$/i.test(a)));
    if (isSearch) search = true;
    else if (READ_CMDS.has(name)) brainReads.push(...args.filter((a) => isBrainPage(a)));
    else if (name === "git") brainReads.push(...gitShowBrainPfade(args));
  }
  return { brainReads, search };
}

function textLength(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((n, p) => n + (p?.type === "text" && typeof p.text === "string" ? p.text.length : 0), 0);
}

/** Transkript → Tool-Events; `tool_use` und `tool_result` werden über die ID verknüpft. Nimmt den JSONL-Text oder die Zeilen aus `transkriptZeilen`. */
export function toolEventsFromTranscript(textOderZeilen, agent = null) {
  const events = [];
  const byId = new Map();
  const zeilen = Array.isArray(textOderZeilen) ? textOderZeilen : transkriptZeilen(textOderZeilen);
  for (const row of zeilen) {
    const content = row?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (row.type === "assistant" && c?.type === "tool_use") {
        const ev = { ts: row.timestamp, tool: c.name, input: c.input ?? {}, resultChars: 0, agent };
        events.push(ev);
        if (c.id) byId.set(c.id, ev);
      } else if (row.type === "user" && c?.type === "tool_result") {
        const ev = byId.get(c.tool_use_id);
        if (ev) ev.resultChars = textLength(c.content);
      }
    }
  }
  return events;
}

/** Tools, deren Eingabe (Pfad, Befehl) die Kennzahlen lesen. Nur für sie holt `--langfuse` die `io`-Feldgruppe; Grep/Glob zählen ohne Eingabe. */
export const EINGABE_TOOLS = ["Read", "Bash", "PowerShell", ...EDIT_TOOLS];

/**
 * Hängt die Eingabe aus `io`-Observations (per `id`) an die Metadaten-Observations. Die v2-API liefert `input` nur zusammen mit
 * `output` (Feldgruppe `io`); darum zwei Abrufstufen: alle TOOL-Observations schlank (`core,basic,metadata`), `io` nur für
 * die Tools aus `EINGABE_TOOLS`. Grenze: ohne passenden `io`-Eintrag bleibt das Event ohne Eingabe (zählt dann nicht als Lesezugriff);
 * verwaiste `io`-Einträge ohne Metadaten-Gegenstück entfallen.
 */
export function mitEingabe(meta, io) {
  const eingaben = new Map((io ?? []).map((o) => [o?.id, o?.input]));
  return (meta ?? []).map((o) => (eingaben.has(o?.id) ? { ...o, input: eingaben.get(o.id) } : o));
}

/** Langfuse-Observations (Typ TOOL, Hook `langfuse-observability`) → Tool-Events. */
export function toolEventsFromLangfuse(observations, agentOf = () => null) {
  const events = [];
  for (const o of observations) {
    if (o?.type !== "TOOL") continue;
    let input = o.input;
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        input = {};
      }
    }
    const len = Number(o.metadata?.output_meta?.orig_len);
    events.push({
      ts: o.startTime,
      tool: o.metadata?.tool_name ?? String(o.name ?? "").replace(/^Tool:\s*/, "").replace(/\s*\[.*\]$/, ""),
      input: input && typeof input === "object" ? input : {},
      resultChars: Number.isFinite(len) ? len : 0,
      agent: agentOf(o) ?? null,
    });
  }
  return events;
}

const ECHO_CMDS = new Set(["echo", "write-output", "write-host"]);
const PFLEGE_MARKER = /^pflege:\s*(start|ende)\b/i;

/**
 * Phasen-Marker des Pflegeschritts (#1099): ein einfaches `echo "pflege: start|ende …"` als Shell-Befehl.
 * Nur Bash/PowerShell, nur als Kommando `echo` (ein `grep "pflege: start"` oder ein Commit-Text zählt nicht).
 */
export function pflegeMarker(ev) {
  if (ev?.tool !== "Bash" && ev?.tool !== "PowerShell") return null;
  for (const words of commandsOf(ev.input?.command, ev.tool)) {
    if (!ECHO_CMDS.has((words[0] ?? "").toLowerCase())) continue;
    const m = PFLEGE_MARKER.exec(words.slice(1).join(" ").replace(/["']/g, "").trim());
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Pflege-Intervalle je Agent aus den Markern: Start öffnet, Ende schließt. Ein zweiter Start bei offenem
 * Intervall ersetzt den alten; Ende ohne Start und ein bis zum Schluss offener Start zählen als `unpaired`.
 * Modulgrenze (#1331): Kommt eine zweite Marker-Phase neben „Pflege“ dazu, wandern Marker-Erkennung und Intervalle in ein
 * eigenes Modul (dann teilen sich beide `commandsOf`); bis dahin bleibt es hier, weil es die einzige Phase ist.
 */
export function pflegeIntervals(events) {
  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const open = new Map();
  const intervals = [];
  let unpaired = 0;
  for (const ev of sorted) {
    const kind = pflegeMarker(ev);
    if (!kind) continue;
    const agent = ev.agent ?? null;
    if (kind === "start") {
      if (open.has(agent)) unpaired += 1;
      open.set(agent, ev.ts);
    } else if (open.has(agent)) {
      intervals.push({ agent, from: open.get(agent), to: ev.ts });
      open.delete(agent);
    } else {
      unpaired += 1;
    }
  }
  return { intervals, unpaired: unpaired + open.size };
}

const tokens = (chars) => Math.round(chars / CHARS_PER_TOKEN);

/** Pfad des Datei-Tools (Read/Edit/Write/…) eines Events. */
const filePath = (ev) => ev.input?.file_path ?? ev.input?.notebook_path ?? "";

/**
 * Kennzahlen eines Laufs. `events`: Tool-Events, bereits auf das Ticket-Fenster gefiltert (`summarize` in
 * token-baseline.mjs besitzt das Fenster und die Recherche-Tokens). `prFiles`: Dateien des PR (`gh pr view --json files`) — die verlässliche Pflege-Zahl, weil Shell-Schreibzugriffe
 * (`sed -i`, Skripte) das Tool-Zählen nicht sieht.
 */
export function brainMetrics(events = [], prFiles = null) {
  const pages = new Set();
  const acc = { reads: 0, readChars: 0, searches: 0, searchChars: 0, writes: 0 };
  let calls = 0;
  let callsBeforeFirstEdit = null;
  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  for (const ev of sorted) {
    if (callsBeforeFirstEdit === null) {
      if (EDIT_TOOLS.has(ev.tool) && !SCRATCH.test(filePath(ev))) callsBeforeFirstEdit = calls;
      else calls += 1;
    }
    countEvent(ev, pages, acc);
  }
  const brainFiles = (prFiles ?? []).filter((f) => isBrainPage(f.path));
  return {
    brainReads: acc.reads,
    brainPages: pages.size,
    brainReadTokens: tokens(acc.readChars),
    searchCalls: acc.searches,
    searchTokens: tokens(acc.searchChars),
    callsBeforeFirstEdit,
    brainWrites: acc.writes,
    prBrain: prFiles
      ? {
          pages: brainFiles.length,
          additions: brainFiles.reduce((n, f) => n + (f.additions ?? 0), 0),
          deletions: brainFiles.reduce((n, f) => n + (f.deletions ?? 0), 0),
        }
      : null,
  };
}

function countEvent(ev, pages, acc) {
  if (ev.tool === "Read") {
    if (!isBrainPage(filePath(ev))) return;
    acc.reads += 1;
    acc.readChars += ev.resultChars;
    pages.add(pageKey(filePath(ev)));
  } else if (ev.tool === "Bash" || ev.tool === "PowerShell") {
    const c = classifyShell(ev.input?.command, ev.tool);
    for (const p of c.brainReads) pages.add(pageKey(p));
    if (c.brainReads.length) {
      acc.reads += c.brainReads.length;
      acc.readChars += ev.resultChars;
    }
    if (c.search) {
      acc.searches += 1;
      acc.searchChars += ev.resultChars;
    }
  } else if (ev.tool === "Grep" || ev.tool === "Glob") {
    acc.searches += 1;
    acc.searchChars += ev.resultChars;
  } else if (EDIT_TOOLS.has(ev.tool) && isBrainPage(filePath(ev))) {
    acc.writes += 1;
  }
}
