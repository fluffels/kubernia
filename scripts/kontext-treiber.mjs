// Kein Shebang: wird per `node scripts/kontext-treiber.mjs` gestartet UND von test/kontext-treiber.test.ts importiert.
/**
 * Kontext-Treiber eines Subagent-Typs (#1559), Standard `kubernia-umsetzer`: was macht den Kontext je Call groß und was kostet es?
 *
 *   node scripts/kontext-treiber.mjs --von <ISO> [--bis <ISO>] [--agent kubernia-umsetzer] [--ticket <nr>]… [--ohne <nr>]… [--projekt <slug>] [--json]
 *
 * Je Lauf (Transkript unter `<session>/subagents/`): Requests, Kontext je Call (input + cacheWrite + cacheRead), Kosten (aus PRICES,
 * nur aufgezeichnete Usage: Output unterzählt), Phase je Call, Tool-Ergebnisse mit Größe und Last, Cache-Neuaufbauten mit Ursache.
 *  - Phase (Heuristik, Vorrang von oben): CI-Warten (`gh pr checks`, `pr-warten`, `gh run watch`, `until`-Schleife mit `gh pr view`),
 *    verify (`verify:*`, `vitest`, `eslint`, `typecheck`, `check:*`), sonst der Zustand: Umsetzung → Pflege (zwischen den Markern
 *    `pflege: start/ende`) → Review (ab dem ersten `kubernia-lens`-Spawn) → Lens-Fix (Edit/Write im Review) → ab `gh pr create` CI-Fix
 *    (Edit/Write) bzw. Merge/Cleanup. Calls ohne Tool erben den Zustand. Grenze: ein Befehl mit mehreren Zwecken zählt zum ersten Treffer.
 *  - Tokens eines Tool-Ergebnisses = Zeichen / 4 (Konvention aus docs/model-routing.md § Planer-Kosten); Last = Tokens × Zahl der
 *    späteren Calls des Laufs (so oft wird das Ergebnis erneut aus dem Cache gelesen).
 *  - Neuaufbau: Pause > 5 min zum Vorgänger und Cache-Read unter der Hälfte des Kontexts (wie `countCacheRebuilds`); Mehrkosten =
 *    neu geschriebene Tokens × (Write-5m − Read-Preis), ohne Preisstufen.
 * Pur und ohne IO bis auf das CLI. Importiert transkript-calls, preise, brain-metrics, subagent-laufzeit; wird selbst nicht importiert.
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { toolEventsFromTranscript } from "./brain-metrics.mjs";
import { callsFromTranscript } from "./transkript-calls.mjs";
import { PRICES, priceFor } from "./preise.mjs";
import { istNeuaufbau, kontextVon, median } from "./mess-lib.mjs";
import { projektSlug } from "./transkript.mjs";
import { ladeLaeufe, laufAus } from "./subagent-laufzeit.mjs";

const MIN = 60_000;
const PAUSE_MS = 5 * MIN;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
export const PHASEN = ["Umsetzung", "Pflege", "verify", "Review", "Lens-Fix", "CI-Warten", "CI-Fix", "Merge/Cleanup"];

const CI_WARTEN = /gh\s+pr\s+checks|pr-warten|gh\s+run\s+watch|until\b[^\n]*gh\s+pr\s+view/;
const VERIFY = /verify:|npm\s+run\s+verify|vitest|eslint|typecheck|check:/;
const num = (x) => (Number.isFinite(x) ? x : 0);
const summe = (liste) => liste.reduce((s, x) => s + x, 0);

/** Pfade und Befehle ohne Benutzerordner und Worktree-Präfix (das Repo ist öffentlich). */
export function bereinige(text) {
  return String(text)
    .replace(/\\/g, "/")
    .replace(/[A-Za-z]:\/Users\/[^/\s"']+/g, "~")
    .replace(/\/[a-z]\/Users\/[^/\s"']+/gi, "~")
    .replace(/\S*\/\.claude\/worktrees\/kq-\d+[\w-]*(?:\/|(?=\s|$))/g, "<wt>/")
    .replace(/(?:[A-Za-z]:|\/[a-z])\/dev\/kubernia\//g, "<repo>/")
    .replace(/\s+/g, " ");
}

const befehlVon = (tool) => (SHELL_TOOLS.has(tool.tool) ? String(tool.input?.command ?? "") : "");
const istLinse = (tool) => tool.tool === "Agent" && String(tool.input?.subagent_type ?? "") === "kubernia-lens";

/** Kurzbeschreibung eines Tool-Aufrufs für die Top-10 (Tool plus ~60 Zeichen Befehl, Pfad oder Muster). */
function labelVon(tool) {
  const i = tool.input ?? {};
  const detail = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.description ?? i.subagent_type ?? "";
  return bereinige(`${tool.tool} ${detail}`).slice(0, 70).trim();
}

/** Calls des Laufs mit ihren Tool-Aufrufen und der Phase je Call. */
function phasenUndTools(zeilen) {
  const { calls } = callsFromTranscript(zeilen);
  const events = toolEventsFromTranscript(zeilen);
  const jeCall = new Map();
  for (const ev of events) {
    if (!jeCall.has(ev.msgId)) jeCall.set(ev.msgId, []);
    jeCall.get(ev.msgId).push(ev);
  }
  let zustand = "Umsetzung";
  let pflege = false;
  let review = false;
  let pr = false;
  const eintraege = calls.map((call) => {
    const tools = jeCall.get(call.id) ?? [];
    let ci = false;
    let verify = false;
    let edit = false;
    for (const tool of tools) {
      const befehl = befehlVon(tool);
      if (/pflege:\s*start/.test(befehl)) pflege = true;
      if (/pflege:\s*ende/.test(befehl)) pflege = false;
      if (/gh\s+pr\s+create/.test(befehl)) pr = true;
      if (istLinse(tool)) {
        review = true;
        zustand = "Review";
      }
      if (EDIT_TOOLS.has(tool.tool)) edit = true;
      if (CI_WARTEN.test(befehl)) ci = true;
      else if (VERIFY.test(befehl)) verify = true;
    }
    if (pr && tools.length) zustand = edit ? "CI-Fix" : "Merge/Cleanup";
    else if (review && edit) zustand = "Lens-Fix";
    const phase = ci ? "CI-Warten" : verify ? "verify" : pflege ? "Pflege" : zustand;
    return { call, tools, phase };
  });
  return eintraege;
}

/** Phase je Call (gleiche Reihenfolge wie `callsFromTranscript`). */
export function phaseDerCalls(zeilen) {
  return phasenUndTools(zeilen).map((e) => e.phase);
}

function ursacheVon(vorher) {
  if (!vorher) return "sonstiges";
  if (vorher.phase === "CI-Warten") return "CI-Warten";
  if (vorher.tools.some(istLinse) || (!vorher.tools.length && (vorher.phase === "Review" || vorher.phase === "Lens-Fix"))) return "Lens-Warten";
  if (vorher.phase === "verify") return "verify";
  return "sonstiges";
}

function neuaufbauten(eintraege) {
  const liste = [];
  for (let i = 1; i < eintraege.length; i++) {
    const c = eintraege[i].call;
    const gap = Date.parse(c.ts) - Date.parse(eintraege[i - 1].call.ts);
    if (!istNeuaufbau({ gapMs: gap, pauseMs: PAUSE_MS, call: c })) continue;
    const preis = priceFor(c.model, PRICES, c.ts);
    liste.push({
      ursache: ursacheVon(eintraege[i - 1]),
      tokens: num(c.cacheWrite),
      mehrkosten: preis ? (num(c.cacheWrite) * (preis.cacheWrite5m - preis.cacheRead)) / 1e6 : null,
    });
  }
  return liste;
}

/** Kennzahlen eines Laufs (`{ meta, zeilen }`), `null` ohne Call. */
export function analysiereLauf(lauf) {
  const eintraege = phasenUndTools(lauf.zeilen);
  if (!eintraege.length) return null;
  const kopf = laufAus(lauf);
  const ctx = eintraege.map((e) => kontextVon(e.call));
  const ergebnisse = [];
  const wachstum = { ergebnis: 0, eingabe: 0, rest: 0 };
  eintraege.forEach((e, idx) => {
    const spaeter = eintraege.length - idx - 1;
    let ergTokens = 0;
    let einTokens = 0;
    for (const tool of e.tools) {
      const tokens = Math.round(tool.resultChars / 4);
      ergTokens += tokens;
      einTokens += Math.round(JSON.stringify(tool.input ?? {}).length / 4);
      ergebnisse.push({ label: labelVon(tool), tokens, last: tokens * spaeter, phase: e.phase });
    }
    const naechster = idx + 1 < eintraege.length ? ctx[idx + 1] - ctx[idx] : 0;
    if (naechster <= 0) return;
    const erg = Math.min(naechster, ergTokens);
    const ein = Math.min(naechster - erg, einTokens);
    wachstum.ergebnis += erg;
    wachstum.eingabe += ein;
    wachstum.rest += naechster - erg - ein;
  });
  const kosten = eintraege.some((e) => e.call.cost == null) ? null : summe(eintraege.map((e) => e.call.cost));
  const kostenTeile = eintraege.every((e) => e.call.costParts)
    ? {
        read: summe(eintraege.map((e) => e.call.costParts.cacheRead)),
        write: summe(eintraege.map((e) => e.call.costParts.cacheWrite)),
        output: summe(eintraege.map((e) => e.call.costParts.output)),
        input: summe(eintraege.map((e) => e.call.costParts.input)),
      }
    : null;
  return {
    ticket: kopf?.ticket ?? null,
    sammel: kopf?.sammel ?? false,
    start: kopf?.start ?? Date.parse(eintraege[0].call.ts),
    requests: eintraege.length,
    ersterKontext: ctx[0],
    maxKontext: Math.max(...ctx),
    kontextSumme: summe(ctx),
    kosten,
    kostenTeile,
    phasen: eintraege.map((e) => e.phase),
    phasenDetail: eintraege.map((e, i) => ({ phase: e.phase, kontext: ctx[i], kosten: e.call.cost ?? null })),
    ergebnisse,
    neuaufbauten: neuaufbauten(eintraege),
    wachstum,
  };
}

function gruppe(analysen) {
  if (!analysen.length) return { gesamt: null, top: [], phasen: {}, neuaufbau: {}, wachstum: { ergebnis: 0, eingabe: 0, rest: 0 } };
  const requests = summe(analysen.map((a) => a.requests));
  const mitPreis = analysen.filter((a) => a.kosten !== null);
  const phasen = {};
  for (const a of analysen) {
    for (const d of a.phasenDetail) {
      const p = (phasen[d.phase] ??= { calls: 0, kontextSumme: 0, kosten: 0 });
      p.calls += 1;
      p.kontextSumme += d.kontext;
      p.kosten += d.kosten ?? 0;
    }
  }
  const neuaufbau = {};
  for (const a of analysen) {
    for (const n of a.neuaufbauten) {
      const u = (neuaufbau[n.ursache] ??= { n: 0, tokens: 0, mehrkosten: 0 });
      u.n += 1;
      u.tokens += n.tokens;
      u.mehrkosten += n.mehrkosten ?? 0;
    }
  }
  const teile = mitPreis.map((a) => a.kostenTeile).filter(Boolean);
  const wachstum = { ergebnis: 0, eingabe: 0, rest: 0 };
  for (const a of analysen) for (const k of Object.keys(wachstum)) wachstum[k] += a.wachstum[k];
  return {
    gesamt: {
      n: analysen.length,
      requests,
      requestsMedian: median(analysen.map((a) => a.requests)),
      kontextCallGewichtet: summe(analysen.map((a) => a.kontextSumme)) / requests,
      kontextMedianLaeufe: median(analysen.map((a) => a.kontextSumme / a.requests)),
      ersterKontextMedian: median(analysen.map((a) => a.ersterKontext)),
      maxKontextMedian: median(analysen.map((a) => a.maxKontext)),
      kostenMedian: median(mitPreis.map((a) => a.kosten)),
      kostenMittel: mitPreis.length ? summe(mitPreis.map((a) => a.kosten)) / mitPreis.length : null,
      kostenSumme: summe(mitPreis.map((a) => a.kosten)),
      ohnePreis: analysen.length - mitPreis.length,
      kostenRead: summe(teile.map((t) => t.read)),
      kostenWrite: summe(teile.map((t) => t.write)),
      kostenOutput: summe(teile.map((t) => t.output)),
    },
    top: analysen
      .flatMap((a) => a.ergebnisse.map((e) => ({ ...e, ticket: a.ticket })))
      .sort((x, y) => y.last - x.last)
      .slice(0, 10),
    phasen,
    neuaufbau,
    wachstum,
  };
}

/**
 * Kern: Läufe des Typs im Start-Fenster [von, bis] (optional nur/ohne bestimmte Tickets) → Bericht je Gruppe (alle, ohne Sammeltickets, Sammeltickets).
 * @param {{ laeufe: { meta: object, zeilen: object[] }[], agent?: string, von?: string, bis?: string, tickets?: number[], ohne?: number[] }} e
 */
export function kontextTreiber({ laeufe, agent = "kubernia-umsetzer", von, bis, tickets = [], ohne = [] }) {
  const analysen = laeufe
    .filter((l) => l?.meta?.agentType === agent)
    .map(analysiereLauf)
    .filter(Boolean)
    .filter((a) => (!von || a.start >= Date.parse(von)) && (!bis || a.start <= Date.parse(bis)))
    .filter((a) => !tickets.length || tickets.includes(a.ticket))
    .filter((a) => !ohne.includes(a.ticket));
  return {
    agent,
    gesamt: gruppe(analysen),
    ohneSammel: gruppe(analysen.filter((a) => !a.sammel)),
    sammel: gruppe(analysen.filter((a) => a.sammel)),
  };
}

const f = (x, d = 2) => (x === null || x === undefined ? "-" : x.toFixed(d));
const k = (x) => (x === null || x === undefined ? "-" : `${Math.round(x / 1000)}k`);

function renderGruppe(titel, g) {
  if (!g.gesamt) return [`## ${titel}`, "", "keine Läufe", ""];
  const s = g.gesamt;
  const out = [`## ${titel}`, ""];
  out.push(
    `n=${s.n}, Requests gesamt ${s.requests} (Median ${f(s.requestsMedian, 1)} je Lauf), Ø Kontext je Call (call-gewichtet) ${k(s.kontextCallGewichtet)}, Median der Lauf-Mittel ${k(s.kontextMedianLaeufe)}, erster Call (Median) ${k(s.ersterKontextMedian)}, max. Kontext (Median) ${k(s.maxKontextMedian)}`,
    `Kosten je Lauf: Median ${f(s.kostenMedian)} $, Mittel ${f(s.kostenMittel)} $, Σ ${f(s.kostenSumme)} $ (ohne Preis: ${s.ohnePreis}); Read ${f(s.kostenRead)} $, Write ${f(s.kostenWrite)} $, Output ${f(s.kostenOutput)} $ (Output unterzählt)`,
    "",
    "| Phase | Calls | Anteil | Σ Kontext (Tok) | Kosten ($) |",
    "|---|--:|--:|--:|--:|",
  );
  for (const p of PHASEN.filter((x) => g.phasen[x])) {
    const d = g.phasen[p];
    out.push(`| ${p} | ${d.calls} | ${f((100 * d.calls) / s.requests, 0)} % | ${k(d.kontextSumme)} | ${f(d.kosten)} |`);
  }
  out.push("", "| Neuaufbau-Ursache | Ereignisse | neu geschriebene Tokens | Mehrkosten ($) |", "|---|--:|--:|--:|");
  for (const [u, d] of Object.entries(g.neuaufbau)) out.push(`| ${u} | ${d.n} | ${k(d.tokens)} | ${f(d.mehrkosten)} |`);
  out.push("", `Wachstum des Kontexts (Σ Zuwachs): Tool-Ergebnisse ${k(g.wachstum.ergebnis)}, eigene Tool-Eingaben ${k(g.wachstum.eingabe)}, Rest (Text, Overhead) ${k(g.wachstum.rest)}`);
  out.push("", "Top-10 Tool-Ergebnisse nach Last (Tokens × spätere Calls):", "", "| Last (Tok) | Tokens | Phase | Ticket | Tool-Aufruf |", "|--:|--:|---|--:|---|");
  for (const t of g.top) out.push(`| ${k(t.last)} | ${t.tokens} | ${t.phase} | ${t.ticket ? `#${t.ticket}` : "-"} | ${t.label.replace(/\|/g, "/")} |`);
  return [...out, ""];
}

/** Markdown-Bericht (Top-10, Phasen, Neuaufbau) je Gruppe. */
export function renderMarkdown(r) {
  return [`Kontext-Treiber \`${r.agent}\``, "", ...renderGruppe("Alle Läufe", r.gesamt), ...renderGruppe("Ohne Sammeltickets", r.ohneSammel), ...renderGruppe("Sammeltickets", r.sammel)].join("\n");
}

// ── CLI (dünn, ungetestet: Dateisuche) ───────────────────────────────────────

export function parseArgs(argv) {
  const a = { agent: "kubernia-umsetzer", tickets: [], ohne: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--von") a.von = argv[++i];
    else if (x === "--bis") a.bis = argv[++i];
    else if (x === "--agent") a.agent = argv[++i];
    else if (x === "--ticket") a.tickets.push(Number(argv[++i]));
    else if (x === "--ohne") a.ohne.push(Number(argv[++i]));
    else if (x === "--projekt") a.projekt = argv[++i];
    else if (x === "--json") a.json = true;
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.von) {
    console.error("Aufruf: node scripts/kontext-treiber.mjs --von <ISO> [--bis <ISO>] [--agent kubernia-umsetzer] [--ticket <nr>]… [--ohne <nr>]… [--projekt <slug>] [--json]");
    process.exit(2);
  }
  const slug = args.projekt ?? projektSlug(process.cwd());
  const dir = join(homedir(), ".claude", "projects", slug);
  readdirSync(dir);
  const r = kontextTreiber({ laeufe: ladeLaeufe(dir, args.agent, args.von), agent: args.agent, von: args.von, bis: args.bis, tickets: args.tickets, ohne: args.ohne });
  console.log(args.json ? JSON.stringify(r, null, 2) : renderMarkdown(r));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
