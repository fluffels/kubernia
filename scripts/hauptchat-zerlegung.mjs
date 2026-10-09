// Kein Shebang: wird per `node scripts/hauptchat-zerlegung.mjs` gestartet UND von test/hauptchat-zerlegung.test.ts importiert.
/**
 * Hauptchat-Kosten nach Tätigkeit (#1356): wofür der Hauptchat Tokens verbraucht.
 * Aufruf, Kategorien und Grenzen: docs/model-routing.md §5 „Hauptchat nach Tätigkeit“.
 *
 *   node scripts/hauptchat-zerlegung.mjs --von <ISO> --bis <ISO> [--brain <pfad>]… [--projekt <slug>] [--json]
 *
 * Kategorien (Vorrang von oben): Brain (ab dem ersten Call, dessen Tool eine `--brain`-Wurzel berührt oder der Skill `brain-input` ist, bis Turn-Ende; ein Turn mit `/brain-input` ganz),
 * Ticket-Orchestrierung (vom Claim-Turn bis `closedAt`), Nachlauf (nach dem Merge bis zum nächsten Claim),
 * Ad-hoc. Turn = Nutzerzeile (kein tool_result, keine Benachrichtigung); Benachrichtigungs-Turns bleiben im Turn davor.
 * Kennzahlen der Ticket-Orchestrierung (#1557): Zeile `Modellanteil` (Sonnet-Anteil, Median je Fenster) und Zeile `TTL` (1h-Ist gegen 5m-Simulation).
 * Calls ohne gültigen Zeitstempel stehen in „ohne Zeit“. kubernia-Subagenten und verschachtelte zählen nicht zum
 * Hauptchat; andere Subagenten (Forks) folgen der Kategorie des Turns, in dem sie starten (eigene Quelle „Fork“).
 *
 * Pur und ohne IO bis auf das CLI (liest `~/.claude/projects`, fragt `gh`); der Kern ist getestet.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { toolEventsFromTranscript } from "./brain-metrics.mjs";
import { ghText } from "./gh-cli.mjs";
import { callsFromTranscript, priceParts } from "./token-baseline.mjs";
import { ladeSessionDatei } from "./transkript.mjs";

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
    // Brain gilt ab dem ersten Brain-Ereignis bis Turn-Ende (#1382); ein Turn mit /brain-input ist ganz Brain.
    const brainTs = events.filter((e) => eventBeruehrtBrain(e, wurzeln)).map((e) => (gueltig(e.ts) ? Date.parse(e.ts) : -Infinity));
    const brainAb = g.start?.slash === "brain-input" ? -Infinity : brainTs.length ? Math.min(...brainTs) : null;
    return { idx, startTs: g.start?.ts ?? null, art, brainAb, calls, events };
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

/**
 * kubernia-Subagent im Sinn der Zerlegung: ein verschachtelter Agent (`parentAgentId`) oder ein `agentType` mit dem Präfix `kubernia-`
 * (Planer, Umsetzer, Lens). Explore und andere Subagenten, die der Hauptchat selbst startet, sind Arbeit des Hauptchats (Forks).
 */
export const istKubernia = (meta) => Boolean(meta?.parentAgentId) || /^kubernia-/.test(meta?.agentType ?? "");

const medianVon = (werte) => {
  if (werte.length === 0) return null;
  const s = [...werte].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Modellanteil der Ticket-Orchestrierung (#1557): Calls je Familie über das Präfix `claude-<familie>-`, über alle Fenster mit Calls.
 * `<synthetic>` (Client-Platzhalter) zählt nicht. `null` ohne Fenster mit Calls.
 * @param {{ modelle: Record<string, number>, kosten?: Record<string, number> }[]} fenster
 */
export function modellAnteil(fenster) {
  const z = { sonnet: 0, opus: 0, haiku: 0, sonst: 0 };
  const kosten = [];
  for (const w of fenster) {
    let calls = 0;
    for (const [m, n] of Object.entries(w.modelle ?? {})) {
      if (m === "<synthetic>") continue;
      calls += n;
      z[/^claude-(sonnet|opus|haiku)-/.exec(m)?.[1] ?? "sonst"] += n;
    }
    if (calls > 0) kosten.push(Object.values(w.kosten ?? {}).reduce((a, b) => a + b, 0));
  }
  const gesamt = z.sonnet + z.opus + z.haiku + z.sonst;
  if (gesamt === 0) return null;
  return { ...z, gesamt, anteil: z.sonnet / gesamt, fenster: kosten.length, medianKosten: medianVon(kosten) };
}

const FUENF_MIN = 5 * 60_000;
const SECHZIG_MIN = 60 * 60_000;

/**
 * 1h-gegen-5m-TTL (#1557) für die Hauptchat-Calls der Ticket-Orchestrierung: Pause = Abstand zum vorigen Call derselben Session.
 * Ist-Kosten = Cache-Write und Cache-Read wie gebucht (1h-Write); Simulation 5m: bei Pause über 5 min, Modellwechsel oder ohne
 * Vorgänger wird Write + Read zum 5m-Write-Preis neu geschrieben, sonst 5m-Write plus Read. Calls ohne gültige Zeit oder
 * Preis zählen nur in `uebersprungen`. Die Preisverhältnisse (1h-Write zu 5m-Write, Read zu 5m-Write) sind bei Sonnet und Opus gleich.
 * @param {{ session: string, ts?: string, model: string, input: number, cacheWrite: number, cacheWrite1h: number, cacheRead: number, output: number }[]} calls
 */
export function ttlVergleich(calls) {
  const r = { calls: 0, uebersprungen: 0, pausenUeber5: 0, pausenUeber60: 0, medianPauseMin: null, istKosten: 0, sim5mKosten: 0 };
  const proSession = new Map();
  for (const c of calls) {
    if (!gueltig(c.ts) || !priceParts(c)) {
      r.uebersprungen += 1;
      continue;
    }
    proSession.set(c.session, [...(proSession.get(c.session) ?? []), c]);
  }
  const lange = [];
  for (const liste of proSession.values()) {
    liste.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    liste.forEach((c, i) => {
      const prev = liste[i - 1];
      const pause = prev ? Date.parse(c.ts) - Date.parse(prev.ts) : null;
      if (pause !== null && pause > FUENF_MIN) lange.push(pause);
      if (pause !== null && pause > SECHZIG_MIN) r.pausenUeber60 += 1;
      const kalt = !prev || prev.model !== c.model || pause > FUENF_MIN;
      const ist = priceParts(c);
      const sim = priceParts({ ...c, cacheWrite: kalt ? c.cacheWrite + c.cacheRead : c.cacheWrite, cacheRead: kalt ? 0 : c.cacheRead, cacheWrite1h: 0 });
      r.calls += 1;
      r.istKosten += ist.cacheWrite + ist.cacheRead;
      r.sim5mKosten += sim.cacheWrite + sim.cacheRead;
    });
  }
  r.pausenUeber5 = lange.length;
  const med = medianVon(lange);
  r.medianPauseMin = med === null ? null : med / 60_000;
  return r;
}

/**
 * Kern: Sessions (Hauptzeilen + Subagenten) → Summen je Kategorie × Modell × Quelle plus Ticket-Fenster.
 * @param {{ sessions: Iterable<{ id: string, main: object[], subagents?: { meta: object, zeilen: object[] }[] }>,
 *   von?: string, bis?: string, brainRoots?: string[], closedAtOf?: (nr: number) => string | null }} e
 */
export function zerlegeHauptchat({ sessions, von, bis, brainRoots = [], closedAtOf = () => null }) {
  const wurzeln = brainRoots.map((r) => norm(r).replace(/\/+$/, "")).filter(Boolean);
  const summen = new Map();
  const fenster = [];
  const ticketCalls = [];
  const kubernia = { calls: 0, cost: 0 };
  let ohnePreis = 0;
  const ohnePreisModelle = {};
  const zaehleOhnePreis = (c) => {
    ohnePreis += 1;
    const name = String(c.model ?? "unbekannt");
    ohnePreisModelle[name] = (ohnePreisModelle[name] ?? 0) + 1;
  };
  const imFenster = (ts) => !gueltig(ts) || ((!von || Date.parse(ts) >= Date.parse(von)) && (!bis || Date.parse(ts) <= Date.parse(bis)));

  const buche = (kategorie, quelle, c) => {
    const key = `${kategorie}|${quelle}|${c.model}`;
    const z = summen.get(key) ?? { kategorie, quelle, modell: c.model, calls: 0, cost: 0 };
    z.calls += 1;
    z.cost += c.cost ?? 0;
    if (c.cost == null) zaehleOhnePreis(c);
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
      if (turn.brainAb !== null && Date.parse(ts) >= turn.brainAb) return KAT.BRAIN;
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
          ticketCalls.push({ ...c, session: s.id });
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
          if (c.cost == null) zaehleOhnePreis(c);
          continue;
        }
        // Fork: Kategorie des Turns beim ersten Call des Forks (ohne gültige Zeit: eigene Zeile).
        const erster = sa.calls.find((x) => gueltig(x.ts));
        const turn = erster ? turnZu(turns, erster.ts) : turns[0];
        buche(kategorieFuer(turn, c.ts), "Fork", c);
      }
    }
    fenster.push(
      ...fenstern.map((w) => ({ hauptchatCalls: Object.values(w.modelle).reduce((a, b) => a + b, 0), nr: w.nr, closedAt: w.closedAt, startTs: w.startTs, art: w.art, modelle: w.modelle, kosten: w.kosten, session: w.session })),
    );
  }
  const rows = [...summen.values()].sort((a, b) => a.kategorie.localeCompare(b.kategorie) || a.quelle.localeCompare(b.quelle) || a.modell.localeCompare(b.modell));
  return { rows, fenster, kubernia, ohnePreis, ohnePreisModelle, ohneBrainWurzel: wurzeln.length === 0, modellanteil: modellAnteil(fenster), ttl: ttlVergleich(ticketCalls) };
}

const de = (n, stellen = 1) => n.toFixed(stellen).replace(".", ",");

/** Die beiden Kennzahl-Zeilen der Ticket-Orchestrierung (#1557): Modellanteil und TTL-Vergleich. */
function kennzahlZeilen(r) {
  const m = r.modellanteil;
  const t = r.ttl;
  return [
    m
      ? `Modellanteil Ticket-Orchestrierung: sonnet ${m.sonnet}/${m.gesamt} (${de(m.anteil * 100)} %), opus ${m.opus}, haiku ${m.haiku}, sonst ${m.sonst}, Fenster ${m.fenster}, Median ${de(m.medianKosten, 2)} $/Fenster`
      : "Modellanteil Ticket-Orchestrierung: keine Fenster mit Calls",
    t && t.calls > 0
      ? `TTL Ticket-Orchestrierung: ${t.calls} Calls (${t.uebersprungen} übersprungen), Pausen über 5 min ${t.pausenUeber5} (Median ${t.medianPauseMin === null ? "-" : de(t.medianPauseMin)} min), über 60 min ${t.pausenUeber60}, Cache-Kosten Ist (1h) ${de(t.istKosten, 2)} $, Simulation 5m ${de(t.sim5mKosten, 2)} $`
      : "TTL Ticket-Orchestrierung: keine Calls",
  ];
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
  if (r.ohnePreis) out.push(`Hinweis: ${r.ohnePreis} Calls ohne Preis: ${Object.entries(r.ohnePreisModelle ?? {}).map(([k, n]) => `${k} (${n})`).join(", ")} (Modell in PRICES nachtragen oder Zeitpunkt fehlt), nicht als 0 $ zu lesen.`);
  out.push(...kennzahlZeilen(r));
  out.push("", "| Ticket | Session | Start | Start-Art | Hauptchat-Calls je Modell |", "|---|---|---|---|---|");
  for (const f of r.fenster) {
    const m = Object.entries(f.modelle).map(([k, v]) => `${k}: ${v} (${f.kosten[k].toFixed(2)} $)`).join(", ") || "0 Calls";
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

/** Sessions eines Projektordners, eine nach der anderen (Generator): nur die gerade verarbeitete liegt im Speicher. */
export function* ladeSessions(dir, von) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    const p = join(dir, f);
    if (von && statSync(p).mtimeMs < Date.parse(von)) continue;
    yield ladeSessionDatei(p);
  }
}

function closedAtViaGh(nr) {
  try {
    const out = ghText(["issue", "view", String(nr), "--json", "closedAt"]);
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
