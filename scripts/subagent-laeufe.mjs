// Kein Shebang, kein Direktaufruf: Lib für `subagent-laufzeit.mjs` und `kontext-treiber.mjs` (#1579, Konvention #1398:
// Einstiegsskripte importieren nicht voneinander, gemeinsamer Code steht in einer Lib).
/**
 * Läufe eines Subagent-Typs aus den Claude-Code-Transkripten: `laufAus` (Kennzahlen eines Laufs aus `{ meta, zeilen }`) und
 * `ladeLaeufe` (Meta und Zeilen unter `<projektordner>/<session>/subagents/`). Felder und Heuristiken: Kopf von subagent-laufzeit.mjs.
 * Das Ticket eines Laufs kommt aus `ticketAusLauf`: erst `kq-<nr>` im Patch-Pfad, dann der Worktree im Prompt, erst zuletzt das erste `#<nr>`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { callsFromTranscript } from "./transkript-calls.mjs";
import { istEchtesModell, vereinigungsLaenge } from "./mess-lib.mjs";
import { transkriptZeilen } from "./transkript.mjs";
import { patchAus, patchPfade } from "./patch-zugriff.mjs";
import { ticketAusRef } from "./ticket-refs.mjs";

export const ms = (ts) => Date.parse(ts);
const gueltig = (ts) => Number.isFinite(ms(ts));
export const MIN = 60_000;

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

const BRILLEN = [[/^arch/i, "Architektur"], [/^req/i, "Requirement-Treue"], [/^test/i, "Test-Adäquanz"], [/^doku/i, "Doku"]];
const brilleNorm = (b) => (/^merge/i.test(b) ? null : (BRILLEN.find(([re]) => re.test(b))?.[1] ?? b));

/** Brille und Runde aus der Spawn-Beschreibung (`Lens <Brille> R<n>`, älter `lens:<brille>:r<n>`); Merge-Läufe heißen `M<n>`. */
export function beschreibungAus(beschreibung) {
  const d = typeof beschreibung === "string" ? beschreibung.trim() : "";
  const merge = /\bMerge|\bM\d+\b/i.test(d);
  const neu = /^Lens\s+(.+?)\s+R(\d+)\b/i.exec(d);
  if (neu) return { brille: brilleNorm(neu[1]), runde: Number(neu[2]), merge };
  const alt = /^lens(-m)?:([^:\s]+):r?(\d+)/i.exec(d);
  if (alt) return { brille: brilleNorm(alt[2]), runde: alt[1] ? null : Number(alt[3]), merge: Boolean(alt[1]) };
  const ohne = /^Lens\s+(\S+)/i.exec(d);
  return { brille: ohne ? brilleNorm(ohne[1]) : null, runde: null, merge };
}

/** Art des Delta-Auftrags: `null` ohne Delta-Patch-Pfad im Prompt, `"merge"` bei Konflikt-Auflösung (Merge-Lens), sonst `"fix"`. */
const deltaArtAus = (prompt, merge) => (!patchPfade(prompt).delta ? null : merge || /Konflikt-Aufl(?:ö|oe)sung/i.test(prompt) ? "merge" : "fix");

/**
 * Ticket eines Laufs (#1579): zuerst `kq-<nr>` aus dem Patch-Pfad (`patch.ticket`), dann der Worktree im Prompt (`worktrees/kq-<nr>`,
 * auch ein Lens-Worktree), erst zuletzt das erste `#<nr>` im Prompt; sonst `null`. Ein `#<nr>` aus Brillen- oder Diät-Text
 * (`schon erledigt durch #1349`, `(#1034)`) darf das Ticket nur zuordnen, wenn nichts Belastbareres da ist.
 */
export function ticketAusLauf({ patch, prompt }) {
  return patch?.ticket ?? ticketAusRef(prompt) ?? (Number(/#(\d+)/.exec(prompt)?.[1]) || null);
}

/** Kennzahlen eines Laufs, `null` ohne gültige Zeitstempel. */
export function laufAus({ meta, zeilen, datei }) {
  const zeiten = zeilen.map((r) => r?.timestamp).filter(gueltig).map(ms);
  if (!zeiten.length) return null;
  const start = Math.min(...zeiten);
  const ende = Math.max(...zeiten);
  const prompt = promptAus(zeilen);
  const { calls } = callsFromTranscript(zeilen);
  const { intervalle, offeneTools } = toolIntervalle(zeilen);
  const dauer = ende - start;
  const beschr = beschreibungAus(meta?.description);
  const patch = patchAus(prompt, zeilen);
  const erster = calls[0];
  const tool = Math.min(vereinigungsLaenge(intervalle), dauer);
  return {
    agentType: meta?.agentType ?? null,
    modelle: [...new Set(calls.map((c) => c.model).filter(istEchtesModell))].sort(),
    datei: datei ?? null,
    beschreibung: typeof meta?.description === "string" ? meta.description : null,
    brille: beschr.brille,
    runde: beschr.runde ?? (beschr.merge ? null : patch?.runde) ?? null,
    deltaArt: deltaArtAus(prompt, beschr.merge),
    promptZeichen: prompt.length,
    ersterCall: erster ? { input: erster.input ?? 0, cacheWrite: erster.cacheWrite ?? 0, cacheRead: erster.cacheRead ?? 0 } : null,
    patch,
    ticket: ticketAusLauf({ patch, prompt }),
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

/** Lädt die Läufe (Meta + Transkriptzeilen) eines Subagent-Typs aus `<projektordner>/<session>/subagents/`, nur Dateien jünger als `von`. */
export function ladeLaeufe(dir, agent, von) {
  const laeufe = [];
  for (const id of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const subDir = join(dir, id, "subagents");
    if (!existsSync(subDir)) continue;
    for (const n of readdirSync(subDir).filter((x) => x.endsWith(".meta.json"))) {
      const basis = n.slice(0, -".meta.json".length);
      const jsonl = join(subDir, `${basis}.jsonl`);
      if (!existsSync(jsonl) || (von && statSync(jsonl).mtimeMs < Date.parse(von))) continue;
      let meta;
      try {
        meta = JSON.parse(readFileSync(join(subDir, n), "utf8"));
      } catch {
        continue;
      }
      if (meta?.agentType !== agent) continue;
      laeufe.push({ meta, zeilen: transkriptZeilen(readFileSync(jsonl, "utf8")), datei: `${id}/subagents/${basis}.jsonl` });
    }
  }
  return laeufe;
}
