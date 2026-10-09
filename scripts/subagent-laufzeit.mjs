// Kein Shebang: wird per `node scripts/subagent-laufzeit.mjs` gestartet UND von test/subagent-laufzeit.test.ts importiert.
/**
 * Laufzeit eines Subagent-Typs (#1382), z. B. der Planer-Laufzeit aus docs/model-routing.md § Planer-Laufzeit.
 *
 *   node scripts/subagent-laufzeit.mjs --von <ISO> [--bis <ISO>] [--agent kubernia-planner] [--schnitt <ISO>] [--projekt <slug>] [--json]
 *
 * Liest nur `<session>/subagents/*.meta.json` mit passendem `agentType` und deren JSONL (nicht alle Haupttranskripte).
 * Je Lauf: Ticket (erstes `#<nr>` im Prompt), Sammelticket (`(gesammelt)` im Prompt, Heuristik), Start, Ende, Dauer, Requests,
 * Toolzeit (Vereinigung der Intervalle von `tool_use` bis `tool_result`), Modellzeit (Dauer minus Toolzeit), größter Kontext und
 * Sekunden Modellzeit je Request (`sProRequest`, `null` ohne Request), Kosten in $ (`kosten`, Summe der Call-Preise aus PRICES, `null` bei einem Call ohne Preis; nur
 * aufgezeichnete Usage: Output-Tokens im Transkript stehen auf dem Stand von `message_start`, die Output-Kosten sind unterschätzt, Kinder-Läufe zählen nicht mit) und Zahl der parallel laufenden Läufe desselben Typs. Aggregat: Median je UTC-Tag (alle Läufe, `sammelN` = darin enthaltene Sammeltickets), alt/neu am Schnitt (Start ab Schnitt = neu,
 * alle Läufe; Sammeltickets zusätzlich getrennt). Ein Lauf ohne Ende (letzter `tool_use` ohne Ergebnis) gilt als offen und zählt nicht in die Mediane.
 *
 * Pur und ohne IO bis auf das CLI; der Kern ist getestet. Importiert token-baseline.mjs, nicht umgekehrt.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { callsFromTranscript } from "./token-baseline.mjs";
import { transkriptZeilen } from "./transkript.mjs";

const ms = (ts) => Date.parse(ts);
const gueltig = (ts) => Number.isFinite(ms(ts));
const MIN = 60_000;

/** Median einer Zahlenliste (gerade Anzahl: Mittel der beiden mittleren), `null` bei leerer Liste. */
export function median(werte) {
  const s = werte.filter((w) => Number.isFinite(w)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Vereinigung von [von, bis]-Intervallen in Millisekunden (überlappende zählen einmal). */
export function vereinigungMs(intervalle) {
  const s = intervalle.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).sort((x, y) => x[0] - y[0]);
  let summe = 0;
  let cur = null;
  for (const [a, b] of s) {
    if (!cur || a > cur[1]) {
      if (cur) summe += cur[1] - cur[0];
      cur = [a, b];
    } else if (b > cur[1]) cur[1] = b;
  }
  return summe + (cur ? cur[1] - cur[0] : 0);
}

/** Prompt des Laufs: Text der ersten Nutzerzeile. */
function promptAus(zeilen) {
  for (const r of zeilen) {
    if (r?.type !== "user") continue;
    const c = r.message?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  }
  return "";
}

/** Tool-Intervalle (tool_use → tool_result) und ob am Ende ein Tool-Aufruf offen ist. */
function toolIntervalle(zeilen) {
  const offen = new Map();
  const intervalle = [];
  for (const r of zeilen) {
    if (!gueltig(r?.timestamp) || !Array.isArray(r.message?.content)) continue;
    for (const c of r.message.content) {
      if (r.type === "assistant" && c?.type === "tool_use" && c.id) offen.set(c.id, ms(r.timestamp));
      else if (r.type === "user" && c?.type === "tool_result" && offen.has(c.tool_use_id)) {
        intervalle.push([offen.get(c.tool_use_id), ms(r.timestamp)]);
        offen.delete(c.tool_use_id);
      }
    }
  }
  return { intervalle, offeneTools: offen.size };
}

/** Kosten eines Laufs in $ aus PRICES (nur aufgezeichnete Usage); `null`, sobald ein Call ohne Preis ist oder es keinen Call gibt, nie 0. */
function kostenAus(calls) {
  if (!calls.length || calls.some((c) => c.cost === undefined || c.cost === null)) return null;
  return calls.reduce((summe, c) => summe + c.cost, 0);
}

/** Kennzahlen eines Laufs, `null` ohne gültige Zeitstempel. */
export function laufAus({ meta, zeilen }) {
  const zeiten = zeilen.map((r) => r?.timestamp).filter(gueltig).map(ms);
  if (!zeiten.length) return null;
  const start = Math.min(...zeiten);
  const ende = Math.max(...zeiten);
  const prompt = promptAus(zeilen);
  const { calls } = callsFromTranscript(zeilen);
  const { intervalle, offeneTools } = toolIntervalle(zeilen);
  const dauer = ende - start;
  const tool = Math.min(vereinigungMs(intervalle), dauer);
  return {
    agentType: meta?.agentType ?? null,
    ticket: Number(/#(\d+)/.exec(prompt)?.[1]) || null,
    sammel: /\(gesammelt\)/i.test(prompt),
    start,
    ende,
    dauerMin: dauer / MIN,
    requests: calls.length,
    kosten: kostenAus(calls),
    toolMin: tool / MIN,
    modellMin: (dauer - tool) / MIN,
    sProRequest: calls.length ? ((dauer - tool) / 1000) / calls.length : null,
    maxKontext: Math.max(0, ...calls.map((c) => (c.input ?? 0) + (c.cacheWrite ?? 0) + (c.cacheRead ?? 0))),
    parallel: 0,
    offen: offeneTools > 0,
  };
}

const tagVon = (t) => new Date(t).toISOString().slice(0, 10);
const stat = (laeufe) => ({
  n: laeufe.length,
  dauerMin: median(laeufe.map((l) => l.dauerMin)),
  modellMin: median(laeufe.map((l) => l.modellMin)),
  toolMin: median(laeufe.map((l) => l.toolMin)),
  requests: median(laeufe.map((l) => l.requests)),
  // Median und Summe nur über Läufe mit Preis; `ohnePreis` zählt die übrigen (kein 0 $ für ein unbekanntes Modell).
  kosten: median(laeufe.map((l) => l.kosten).filter((x) => x !== null)),
  kostenSumme: laeufe.reduce((summe, l) => summe + (l.kosten ?? 0), 0),
  ohnePreis: laeufe.filter((l) => l.kosten === null).length,
  // Läufe ohne Request haben keinen Wert je Request (kein Infinity/NaN im Median).
  sProRequest: median(laeufe.map((l) => l.sProRequest).filter((x) => x !== null)),
  parallel: median(laeufe.map((l) => l.parallel)),
  maxKontext: median(laeufe.map((l) => l.maxKontext)),
  maxDauerMin: laeufe.length ? Math.max(...laeufe.map((l) => l.dauerMin)) : null,
});

/**
 * Kern: Läufe aus `{ meta, zeilen }` des gewünschten `agentType` im Fenster [von, bis] (Start) → Läufe plus Aggregat.
 * @param {{ laeufe: { meta: object, zeilen: object[] }[], agent?: string, von?: string, bis?: string, schnitt?: string }} e
 */
export function laufzeiten({ laeufe, agent = "kubernia-planner", von, bis, schnitt }) {
  const alle = laeufe
    .filter((l) => l?.meta?.agentType === agent)
    .map(laufAus)
    .filter(Boolean)
    .filter((l) => (!von || l.start >= ms(von)) && (!bis || l.start <= ms(bis)))
    .sort((a, b) => a.start - b.start);
  for (const l of alle) l.parallel = alle.filter((o) => o !== l && o.start < l.ende && o.ende > l.start).length;
  const gemessen = alle.filter((l) => !l.offen);
  const ohneSammel = gemessen.filter((l) => !l.sammel);
  const tage = [...new Set(gemessen.map((l) => tagVon(l.start)))].sort();
  const je = (liste) => stat(liste);
  const aggregat = {
    gesamt: je(gemessen),
    ohneSammel: je(ohneSammel),
    sammel: je(gemessen.filter((l) => l.sammel)),
    jeTag: tage.map((t) => ({ tag: t, sammelN: gemessen.filter((l) => l.sammel && tagVon(l.start) === t).length, ...je(gemessen.filter((l) => tagVon(l.start) === t)) })),
    offen: alle.length - gemessen.length,
  };
  if (schnitt) {
    const s = ms(schnitt);
    aggregat.alt = je(gemessen.filter((l) => l.start < s));
    aggregat.neu = je(gemessen.filter((l) => l.start >= s));
    aggregat.neuSammel = je(gemessen.filter((l) => l.sammel && l.start >= s));
    aggregat.altSammel = je(gemessen.filter((l) => l.sammel && l.start < s));
    aggregat.altOhneSammel = je(ohneSammel.filter((l) => l.start < s));
    aggregat.neuOhneSammel = je(ohneSammel.filter((l) => l.start >= s));
  }
  return { agent, laeufe: alle.map((l) => ({ ...l, start: new Date(l.start).toISOString(), ende: new Date(l.ende).toISOString() })), aggregat };
}

const f1 = (x) => (x === null ? "-" : x.toFixed(1));
const f2 = (x) => (x === null ? "-" : x.toFixed(2));

/** Markdown: Aggregat-Tabelle und Läufe. */
export function renderMarkdown(r) {
  const out = [`Subagent-Typ \`${r.agent}\`: ${r.laeufe.length} Läufe (${r.aggregat.offen} offen, nicht in den Medianen)`, ""];
  out.push("| Gruppe | n | Dauer (min, Median) | Modell (min) | Tool (min) | Requests | Kosten ($, Median) | Σ Kosten ($) | ohne Preis | s/Req (Modell) | parallel | max. Kontext | längster (min) |", "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  const z = (name, s) => out.push(`| ${name} | ${s.n} | ${f1(s.dauerMin)} | ${f1(s.modellMin)} | ${f1(s.toolMin)} | ${s.requests ?? "-"} | ${f2(s.kosten)} | ${f2(s.kostenSumme)} | ${s.ohnePreis} | ${f1(s.sProRequest)} | ${f1(s.parallel)} | ${s.maxKontext === null ? "-" : Math.round(s.maxKontext)} | ${f1(s.maxDauerMin)} |`);
  z("alle gemessenen", r.aggregat.gesamt);
  z("ohne Sammeltickets", r.aggregat.ohneSammel);
  z("Sammeltickets", r.aggregat.sammel);
  for (const t of r.aggregat.jeTag) z(`${t.tag} (davon ${t.sammelN} Sammel)`, t);
  if (r.aggregat.alt) {
    z("alle vor Schnitt", r.aggregat.alt);
    z("alle ab Schnitt", r.aggregat.neu);
    z("ohne Sammel vor Schnitt", r.aggregat.altOhneSammel);
    z("ohne Sammel ab Schnitt", r.aggregat.neuOhneSammel);
    z("Sammel vor Schnitt", r.aggregat.altSammel);
    z("Sammel ab Schnitt", r.aggregat.neuSammel);
  }
  out.push("", "| Start | Ticket | Sammel | Dauer | Modell | Tool | Requests | Kosten ($) | s/Req | max. Kontext | parallel |", "|---|--:|---|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const l of r.laeufe) {
    out.push(`| ${l.start} | ${l.ticket ? `#${l.ticket}` : "-"} | ${l.sammel ? "ja" : ""} | ${f1(l.dauerMin)}${l.offen ? " (offen)" : ""} | ${f1(l.modellMin)} | ${f1(l.toolMin)} | ${l.requests} | ${f2(l.kosten)} | ${f1(l.sProRequest ?? null)} | ${Math.round(l.maxKontext)} | ${l.parallel} |`);
  }
  return out.join("\n");
}

// ── CLI (dünn, ungetestet: Dateisuche) ───────────────────────────────────────

export function parseArgs(argv) {
  const a = { agent: "kubernia-planner", json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--von") a.von = argv[++i];
    else if (k === "--bis") a.bis = argv[++i];
    else if (k === "--agent") a.agent = argv[++i];
    else if (k === "--schnitt") a.schnitt = argv[++i];
    else if (k === "--projekt") a.projekt = argv[++i];
    else if (k === "--json") a.json = true;
  }
  return a;
}

/** Lädt die Läufe (Meta + Transkriptzeilen) eines Subagent-Typs aus `<projektordner>/<session>/subagents/`, nur Dateien jünger als `von`. */
export function ladeLaeufe(dir, agent, von) {
  const laeufe = [];
  for (const id of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const subDir = join(dir, id, "subagents");
    if (!existsSync(subDir)) continue;
    for (const n of readdirSync(subDir).filter((x) => x.endsWith(".meta.json"))) {
      const jsonl = join(subDir, n.replace(/\.meta\.json$/, ".jsonl"));
      if (!existsSync(jsonl) || (von && statSync(jsonl).mtimeMs < Date.parse(von))) continue;
      let meta;
      try {
        meta = JSON.parse(readFileSync(join(subDir, n), "utf8"));
      } catch {
        continue;
      }
      if (meta?.agentType !== agent) continue;
      laeufe.push({ meta, zeilen: transkriptZeilen(readFileSync(jsonl, "utf8")) });
    }
  }
  return laeufe;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.von) {
    console.error("Aufruf: node scripts/subagent-laufzeit.mjs --von <ISO> [--bis <ISO>] [--agent kubernia-planner] [--schnitt <ISO>] [--projekt <slug>] [--json]");
    process.exit(2);
  }
  const slug = args.projekt ?? process.cwd().replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, "").replace(/[^A-Za-z0-9]/g, "-");
  const dir = join(homedir(), ".claude", "projects", slug);
  const r = laufzeiten({ laeufe: ladeLaeufe(dir, args.agent, args.von), agent: args.agent, von: args.von, bis: args.bis, schnitt: args.schnitt });
  console.log(args.json ? JSON.stringify(r, null, 2) : renderMarkdown(r));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
