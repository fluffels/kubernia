// Kein Shebang: wird per `node scripts/hauptchat-zerlegung.mjs` gestartet UND von test/hauptchat-zerlegung.test.ts importiert.
/**
 * Hauptchat-Kosten nach Tätigkeit (#1356): wofür der Hauptchat Tokens verbraucht.
 * Aufruf, Kategorien und Grenzen: docs/model-routing.md §5 „Hauptchat nach Tätigkeit“.
 *
 *   node scripts/hauptchat-zerlegung.mjs --von <ISO> --bis <ISO> [--brain <pfad>]… [--projekt <slug>] [--json]
 *
 * Kategorien je Turn (Vorrang von oben): Brain (Tool berührt eine `--brain`-Wurzel oder Skill `brain-input`),
 * Ticket-Orchestrierung (vom Claim-Turn bis `closedAt`), Nachlauf (nach dem Merge bis zum nächsten Claim),
 * Ad-hoc. Turn = Nutzerzeile (kein tool_result, keine Benachrichtigung); Benachrichtigungs-Turns bleiben im Turn davor.
 * Calls ohne gültigen Zeitstempel stehen in „ohne Zeit“. kubernia-Subagenten und verschachtelte zählen nicht zum
 * Hauptchat; andere Subagenten (Forks) folgen der Kategorie des Turns, in dem sie starten (eigene Quelle „Fork“).
 *
 * Pur und ohne IO bis auf das CLI (liest `~/.claude/projects`, fragt `gh`); der Kern ist getestet.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { toolEventsFromTranscript } from "./brain-metrics.mjs";
import { callsFromTranscript, classifySubagent } from "./token-baseline.mjs";
import { transkriptZeilen } from "./transkript.mjs";

export const KAT = { BRAIN: "Brain", TICKET: "Ticket-Orchestrierung", NACHLAUF: "Nachlauf", ADHOC: "Ad-hoc", OHNE_ZEIT: "ohne Zeit" };

const CLAIM = /\bgh\s+issue\s+edit\s+(\d+)\b(?=[^\n]*--add-assignee)/;
const norm = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();
const gueltig = (ts) => Number.isFinite(Date.parse(ts));

/** Projektordner-Name unter `~/.claude/projects`: jedes Nicht-Alphanumerische wird `-`. */
export function slugFuerPfad(p) {
  return String(p).replace(/[^A-Za-z0-9]/g, "-");
}

/** Text einer Nutzerzeile (String- oder Block-Inhalt), `null` bei reinen tool_result-Zeilen. */
function nutzerText(row) {
  const c = row?.message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c) || c.some((b) => b?.type === "tool_result")) return null;
  const t = c.filter((b) => b?.type === "text").map((b) => b.text);
  return t.length ? t.join("\n") : null;
}

/** Echter Turn-Start: Nutzerzeile ohne Meta-Flag, tool_result, Benachrichtigung oder lokale Befehlsausgabe. */
function turnStart(row) {
  if (row?.type !== "user" || row.isMeta) return null;
  const text = nutzerText(row);
  if (text === null || !text.trim()) return null;
  if (/^\s*<(task-notification|local-command|system-reminder)/.test(text) || /^\s*\[Request interrupted/.test(text)) return null;
  return { text, slash: /<command-name>\/([^<\s]+)<\/command-name>/.exec(text)?.[1] ?? null };
}

/** Pfad-Präfix mit Trennzeichen: `/x/notizen` trifft `/x/notizen/a.md`, nicht `/x/notizen-alt/a.md`. */
function beruehrtWurzel(text, wurzeln) {
  const t = norm(text);
  for (const w of wurzeln) {
    for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
      if (!/[a-z0-9_.-]/.test(t[i + w.length] ?? "")) return true;
    }
  }
  return false;
}

function eventBeruehrtBrain(ev, wurzeln) {
  if (ev.tool === "Skill") return ev.input?.skill === "brain-input";
  const felder = [ev.input?.file_path, ev.input?.path, ev.input?.notebook_path, ev.input?.command, ev.input?.pattern];
  return felder.some((f) => typeof f === "string" && beruehrtWurzel(f, wurzeln));
}

/** Eine Session in Turns zerlegen: jede Zeile gehört zum zuletzt begonnenen Turn. */
function turnsAus(zeilen, wurzeln) {
  const gruppen = [{ start: null, rows: [] }];
  for (const row of zeilen) {
    const s = turnStart(row);
    if (s) gruppen.push({ start: { ...s, ts: row.timestamp }, rows: [] });
    gruppen[gruppen.length - 1].rows.push(row);
  }
  return gruppen.map((g, idx) => {
    const events = toolEventsFromTranscript(g.rows);
    const { calls } = callsFromTranscript(g.rows);
    const skillGeladen = events.some((e) => e.tool === "Skill" && e.input?.skill === "kubernia");
    const workflow = events.some((e) => /workflow/i.test(e.tool));
    const art = g.start?.slash === "kubernia" ? "Slash" : skillGeladen ? "Skill-Tool" : workflow ? "Workflow" : "frei";
    const brain = g.start?.slash === "brain-input" || events.some((e) => eventBeruehrtBrain(e, wurzeln));
    return { idx, startTs: g.start?.ts ?? null, art, brain, calls, events };
  });
}

/** Der Turn, in dem ein Zeitpunkt liegt: der zuletzt begonnene mit `startTs ≤ ts`. */
function turnZu(turns, ts) {
  const t = Date.parse(ts);
  let best = turns[0];
  for (const turn of turns) if (turn.startTs && Date.parse(turn.startTs) <= t) best = turn;
  return best;
}

function claimsAus(events, turnVon) {
  const claims = [];
  for (const ev of events) {
    if (ev.tool !== "Bash" && ev.tool !== "PowerShell") continue;
    const nr = CLAIM.exec(String(ev.input?.command ?? ""))?.[1];
    if (nr) claims.push({ nr: Number(nr), ts: ev.ts, turn: turnVon(ev) });
  }
  return claims;
}

const istKubernia = (meta) => Boolean(meta.parentAgentId) || /umsetzer/i.test(meta.agentType ?? "") || classifySubagent(meta.agentType, meta.description) !== null;

/**
 * Kern: Sessions (Hauptzeilen + Subagenten) → Summen je Kategorie × Modell × Quelle plus Ticket-Fenster.
 * @param {{ sessions: { id: string, main: object[], subagents?: { meta: object, zeilen: object[] }[] }[],
 *   von?: string, bis?: string, brainRoots?: string[], closedAtOf?: (nr: number) => string | null }} e
 */
export function zerlegeHauptchat({ sessions, von, bis, brainRoots = [], closedAtOf = () => null }) {
  const wurzeln = brainRoots.map((r) => norm(r).replace(/\/+$/, "")).filter(Boolean);
  const summen = new Map();
  const fenster = [];
  const kubernia = { calls: 0, cost: 0 };
  let ohnePreis = 0;
  const imFenster = (ts) => !gueltig(ts) || ((!von || Date.parse(ts) >= Date.parse(von)) && (!bis || Date.parse(ts) <= Date.parse(bis)));

  const buche = (kategorie, quelle, c) => {
    const key = `${kategorie}|${quelle}|${c.model}`;
    const z = summen.get(key) ?? { kategorie, quelle, modell: c.model, calls: 0, cost: 0 };
    z.calls += 1;
    z.cost += c.cost ?? 0;
    if (c.cost == null) ohnePreis += 1;
    summen.set(key, z);
  };

  for (const s of sessions) {
    const turns = turnsAus(s.main, wurzeln);
    const subs = (s.subagents ?? []).map((sa) => ({
      meta: sa.meta ?? {},
      calls: callsFromTranscript(sa.zeilen).calls,
      events: toolEventsFromTranscript(sa.zeilen),
    }));
    const claims = [
      ...turns.flatMap((t) => claimsAus(t.events, () => t.idx)),
      ...subs.filter((sa) => !sa.meta.parentAgentId).flatMap((sa) => claimsAus(sa.events, (ev) => turnZu(turns, ev.ts).idx)),
    ].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.turn - b.turn);
    // Pro Ticket nur der früheste Claim; Fenster ordnen nach Claim-Turn.
    const fruehste = new Map();
    for (const c of claims) if (!fruehste.has(c.nr)) fruehste.set(c.nr, c); // claims ist nach Zeit sortiert: der erste gewinnt
    const erste = [...fruehste.values()].sort((a, b) => a.turn - b.turn || Date.parse(a.ts) - Date.parse(b.ts));
    const fenstern = erste.map((c) => ({
      nr: c.nr,
      turn: c.turn,
      closedAt: closedAtOf(c.nr),
      startTs: turns[c.turn]?.startTs ?? c.ts,
      art: turns[c.turn]?.art ?? "frei",
      modelle: {},
      kosten: {},
      session: s.id,
    }));

    const fensterVon = (turn) => [...fenstern].reverse().find((w) => turn.idx >= w.turn);
    const kategorieFuer = (turn, ts) => {
      if (!gueltig(ts)) return KAT.OHNE_ZEIT;
      if (turn.brain) return KAT.BRAIN;
      const f = fensterVon(turn);
      if (!f) return KAT.ADHOC;
      if (f.closedAt && Date.parse(ts) >= Date.parse(f.closedAt)) return KAT.NACHLAUF;
      return KAT.TICKET;
    };

    for (const turn of turns) {
      for (const c of turn.calls) {
        if (!imFenster(c.ts)) continue;
        const kat = kategorieFuer(turn, c.ts);
        buche(kat, "Hauptchat", c);
        if (kat === KAT.TICKET) {
          const w = fensterVon(turn);
          if (w) {
            w.modelle[c.model] = (w.modelle[c.model] ?? 0) + 1;
            w.kosten[c.model] = (w.kosten[c.model] ?? 0) + (c.cost ?? 0);
          }
        }
      }
    }
    for (const sa of subs) {
      for (const c of sa.calls) {
        if (!imFenster(c.ts)) continue;
        if (istKubernia(sa.meta)) {
          kubernia.calls += 1;
          kubernia.cost += c.cost ?? 0;
          if (c.cost == null) ohnePreis += 1;
          continue;
        }
        // Fork: Kategorie des Turns beim ersten Call des Forks (ohne gültige Zeit: eigene Zeile).
        const erster = sa.calls.find((x) => gueltig(x.ts));
        const turn = erster ? turnZu(turns, erster.ts) : turns[0];
        buche(kategorieFuer(turn, c.ts), "Fork", c);
      }
    }
    fenster.push(
      ...fenstern.map((w) => ({ nr: w.nr, closedAt: w.closedAt, startTs: w.startTs, art: w.art, modelle: w.modelle, kosten: w.kosten, session: w.session })),
    );
  }
  const rows = [...summen.values()].sort((a, b) => a.kategorie.localeCompare(b.kategorie) || a.quelle.localeCompare(b.quelle) || a.modell.localeCompare(b.modell));
  return { rows, fenster, kubernia, ohnePreis, ohneBrainWurzel: wurzeln.length === 0 };
}

/** Markdown-Tabelle Kategorie × Modell (Hauptchat und Forks getrennt) plus Fensterliste. */
export function renderMarkdown(r) {
  const $ = (n) => `${n.toFixed(2)} $`;
  const out = ["| Kategorie | Quelle | Modell | Calls | Kosten |", "|---|---|---|--:|--:|"];
  for (const z of r.rows) out.push(`| ${z.kategorie} | ${z.quelle} | \`${z.modell}\` | ${z.calls} | ${$(z.cost)} |`);
  const total = r.rows.reduce((s, z) => s + z.cost, 0);
  const n = r.rows.reduce((s, z) => s + z.calls, 0);
  out.push(`| **Summe** | | | ${n} | ${$(total)} |`, "");
  out.push(`kubernia-Subagenten (nicht Hauptchat): ${r.kubernia.calls} Calls, ${$(r.kubernia.cost)}`);
  if (r.ohneBrainWurzel) out.push("Hinweis: ohne --brain gemessen, Brain-Arbeit im Notiz-Brain außerhalb des Repos landet in Nachlauf bzw. Ad-hoc (nur der Skill brain-input zählt als Brain).");
  if (r.ohnePreis) out.push(`Hinweis: ${r.ohnePreis} Calls ohne Preis (Modell nicht in PRICES), nicht als 0 $ zu lesen.`);
  out.push("", "| Ticket | Session | Start | Start-Art | Hauptchat-Calls je Modell |", "|---|---|---|---|---|");
  for (const f of r.fenster) {
    const m = Object.entries(f.modelle).map(([k, v]) => `${k}: ${v} (${f.kosten[k].toFixed(2)} $)`).join(", ") || "-";
    out.push(`| #${f.nr} | ${String(f.session).slice(0, 8)} | ${f.startTs} | ${f.art} | ${m} |`);
  }
  return out.join("\n");
}

// ── CLI (dünn, ungetestet: Dateisuche und gh) ────────────────────────────────

export function parseArgs(argv) {
  const a = { brain: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--von") a.von = argv[++i];
    else if (k === "--bis") a.bis = argv[++i];
    else if (k === "--brain") a.brain.push(argv[++i]);
    else if (k === "--projekt") a.projekt = argv[++i];
    else if (k === "--json") a.json = true;
  }
  return a;
}

function ladeSessions(dir, von) {
  const sessions = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    const p = join(dir, f);
    if (von && statSync(p).mtimeMs < Date.parse(von)) continue;
    const id = f.replace(/\.jsonl$/, "");
    const subDir = join(dir, id, "subagents");
    const subagents = existsSync(subDir)
      ? readdirSync(subDir)
          .filter((n) => n.endsWith(".jsonl"))
          .map((n) => {
            const meta = join(subDir, n.replace(/\.jsonl$/, ".meta.json"));
            return {
              meta: existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")) : {},
              zeilen: transkriptZeilen(readFileSync(join(subDir, n), "utf8")),
            };
          })
      : [];
    sessions.push({ id, main: transkriptZeilen(readFileSync(p, "utf8")), subagents });
  }
  return sessions;
}

function closedAtViaGh(nr) {
  try {
    const out = execFileSync("gh", ["issue", "view", String(nr), "--json", "closedAt"], { encoding: "utf8" });
    return JSON.parse(out).closedAt || null;
  } catch (err) {
    console.error(`Warnung: closedAt für #${nr} nicht lesbar (${String(err.message).split("\n")[0]}); Fenster läuft bis zum nächsten Claim.`);
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.von || !args.bis) {
    console.error("Aufruf: node scripts/hauptchat-zerlegung.mjs --von <ISO> --bis <ISO> [--brain <pfad>]… [--projekt <slug>] [--json]");
    process.exit(2);
  }
  const root = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim().replace(/[\\/]\.git[\\/]?$/, ""); // Hauptrepo auch aus einem Worktree
  const slug = args.projekt ?? slugFuerPfad(root);
  const dir = join(homedir(), ".claude", "projects", slug);
  const cache = new Map();
  const closedAtOf = (nr) => (cache.has(nr) ? cache.get(nr) : cache.set(nr, closedAtViaGh(nr)).get(nr));
  const r = zerlegeHauptchat({ sessions: ladeSessions(dir, args.von), von: args.von, bis: args.bis, brainRoots: args.brain, closedAtOf });
  console.log(args.json ? JSON.stringify(r, null, 2) : renderMarkdown(r));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
