// Kein Shebang: wird von scripts/token-baseline.mjs und test/brain-metrics.test.ts importiert.
/**
 * Projekt-Brain-Kennzahlen pro Ticket-Lauf (#1205, ADR 0015): welche Brain-Seiten (`docs/**.md`) ein Lauf
 * liest, wie viel er sucht, wie früh er den ersten Edit setzt und ob er das Brain pflegt.
 * Definition der Kennzahlen: docs/model-routing.md §5 „Projekt-Brain-Kennzahlen“.
 *
 * Pur und ohne IO; zwei Quellen liefern dieselbe Eventform `{ ts, tool, input, resultChars }`
 * (Claude-Code-Transkript, Langfuse-TOOL-Observations). Importiert nichts aus token-baseline.mjs (kein Zyklus).
 */

import { parseBash } from "./bash-parser.mjs";

/** Grobe Umrechnung Zeichen → Tokens (nur Größenordnung, bewusst keine Tokenizer-Abhängigkeit). */
export const CHARS_PER_TOKEN = 4;

const READ_CMDS = new Set(["cat", "head", "tail", "less", "more", "sed", "awk", "bat", "get-content", "gc", "type"]);
const SEARCH_CMDS = new Set(["grep", "egrep", "fgrep", "rg", "find", "fd", "ag", "select-string", "sls"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SCRATCH = /[\\/](Temp|tmp)[\\/]/i;

const norm = (p) => String(p ?? "").replace(/\\/g, "/");

/** Seitenschlüssel: Pfad ab `docs/`; dieselbe Seite per absolutem, relativem oder Worktree-Pfad ist eine Seite. */
const pageKey = (p) => norm(p).replace(/^.*?(?:^|\/)docs\//i, "docs/");

/** Brain-Seite = Markdown unter einem `docs/`-Ordner (nicht in node_modules). */
export function isBrainPage(path) {
  const p = norm(path);
  if (p.split("/").includes("node_modules")) return false;
  return /(^|\/)docs\/(.+\/)?[^/]+\.md$/i.test(p);
}

function collectSimple(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectSimple(n, out);
    return;
  }
  if (node.type === "simple") {
    out.push(node.words.map((w) => w.text));
    for (const s of node.substs ?? []) collectSimple(s, out);
    return;
  }
  for (const v of Object.values(node)) if (v && typeof v === "object") collectSimple(v, out);
}

/** Kommandos als Wortlisten: Bash über den AST, sonst (und für PowerShell) grobe Trennung. */
function commandsOf(command, tool) {
  if (tool === "Bash") {
    const r = parseBash(command);
    if (r.ok) {
      const out = [];
      collectSimple(r.ast, out);
      return out;
    }
  }
  return String(command ?? "")
    .split(/[;|\n]|&&|\|\|/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean));
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
  }
  return { brainReads, search };
}

function textLength(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((n, p) => n + (p?.type === "text" && typeof p.text === "string" ? p.text.length : 0), 0);
}

/** Transkript-JSONL → Tool-Events; `tool_use` und `tool_result` werden über die ID verknüpft. */
export function toolEventsFromTranscript(jsonlText) {
  const events = [];
  const byId = new Map();
  for (const line of String(jsonlText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const content = row?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (row.type === "assistant" && c?.type === "tool_use") {
        const ev = { ts: row.timestamp, tool: c.name, input: c.input ?? {}, resultChars: 0 };
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

/** Langfuse-Observations (Typ TOOL, Hook `langfuse-observability`) → Tool-Events. */
export function toolEventsFromLangfuse(observations) {
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
    });
  }
  return events;
}

const tokens = (chars) => Math.round(chars / CHARS_PER_TOKEN);

function inWindow(ts, bounds) {
  if (bounds.from && Date.parse(ts) < Date.parse(bounds.from)) return false;
  if (bounds.mergedAt && Date.parse(ts) >= Date.parse(bounds.mergedAt)) return false;
  return true;
}

/** Pfad des Datei-Tools (Read/Edit/Write/…) eines Events. */
const filePath = (ev) => ev.input?.file_path ?? ev.input?.notebook_path ?? "";

/**
 * Kennzahlen eines Laufs. `events`: Tool-Events, `rows`: Phasenzeilen aus `summarize` (für die Recherche-Tokens),
 * `prFiles`: Dateien des PR (`gh pr view --json files`) — die verlässliche Pflege-Zahl, weil Shell-Schreibzugriffe
 * (`sed -i`, Skripte) das Tool-Zählen nicht sieht.
 */
export function brainMetrics({ events = [], rows = [] }, bounds = {}, prFiles = null) {
  const pages = new Set();
  const acc = { reads: 0, readChars: 0, searches: 0, searchChars: 0, writes: 0 };
  let calls = 0;
  let callsBeforeFirstEdit = null;
  const sorted = events.filter((e) => inWindow(e.ts, bounds)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  for (const ev of sorted) {
    if (callsBeforeFirstEdit === null) {
      if (EDIT_TOOLS.has(ev.tool) && !SCRATCH.test(filePath(ev))) callsBeforeFirstEdit = calls;
      else calls += 1;
    }
    countEvent(ev, pages, acc);
  }
  const research = rows.filter((r) => r.phase === "Recherche");
  const brainFiles = (prFiles ?? []).filter((f) => isBrainPage(f.path));
  return {
    brainReads: acc.reads,
    brainPages: pages.size,
    brainReadTokens: tokens(acc.readChars),
    searchCalls: acc.searches,
    searchTokens: tokens(acc.searchChars),
    rechercheTokens: research.reduce((n, r) => n + r.input + r.cacheWrite + r.cacheRead + r.output, 0),
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
