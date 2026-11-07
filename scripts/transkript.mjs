// Kein Shebang: wird von den Messskripten, vom Stop-Hook-Baustein und von Tests importiert.
/**
 * Neutrales Transkript-Lesen (#1331): drei Verbraucher teilen es (`brain-metrics.mjs`, `token-baseline.mjs`,
 * `umsetzer-abschluss.mjs`), darum steht es in keinem von ihnen. Reines Node-Skript ohne Abhängigkeiten.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";

/** Transkript-JSONL → geparste Zeilen (leere und abgeschnittene Zeilen entfallen). Einmal parsen, dann an die Adapter reichen. */
export function transkriptZeilen(jsonlText) {
  const rows = [];
  for (const line of String(jsonlText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // abgeschnittene letzte Zeile eines laufenden Transkripts
    }
  }
  return rows;
}

const istToolUse = (row, b) => row?.type === "assistant" && b?.type === "tool_use";

/**
 * Tool-Aufrufe samt Ergebnis (factory#202 L13), verknüpft über die `tool_use`-ID: `[{ id, use: { row, block }, ergebnis: { row, block } | null }]`
 * in Aufruf-Reihenfolge. Die erste Fassung einer ID gilt (Aufruf wie Ergebnis; Haupt- und Subagent-Datei); ein Ergebnis ohne gewählten
 * Aufruf entfällt, ein Aufruf ohne ID (`id: null`) bleibt ohne Ergebnis. `istAufruf(row, block)` wählt die Aufrufe (Standard: jeder `tool_use`
 * einer Assistant-Zeile). Gilt für Claude-Code-Transkripte; Codex-Sitzungen haben ein anderes Format und sind nicht abgedeckt.
 */
export function toolPaare(zeilen, { istAufruf = istToolUse } = {}) {
  const paare = [];
  const byId = new Map();
  for (const row of zeilen) {
    for (const block of Array.isArray(row?.message?.content) ? row.message.content : []) {
      if (istAufruf(row, block)) neuerAufruf(paare, byId, row, block);
      else if (row?.type === "user" && block?.type === "tool_result") ergebnisZu(byId, row, block);
    }
  }
  return paare;
}

function neuerAufruf(paare, byId, row, block) {
  const id = block.id ?? null;
  if (id !== null && byId.has(id)) return; // erste Fassung gilt
  const paar = { id, use: { row, block }, ergebnis: null };
  paare.push(paar);
  if (id !== null) byId.set(id, paar);
}

function ergebnisZu(byId, row, block) {
  const paar = byId.get(block.tool_use_id);
  if (paar && !paar.ergebnis) paar.ergebnis = { row, block };
}

/**
 * Jüngste Assistant-Nachricht mit einer `ERGEBNIS:`-Zeile (#1342): entweder die `message` eines
 * `SubagentHandback`-Aufrufs oder ein Text-Block. Die Suche endet an der jüngsten User-Nachricht mit Text (factory#193: Fortsetzung);
 * `tool_result`-Einträge und Hook-Feedback sind keine Grenze (factory#202 L11). `null`, wenn es keine gibt.
 * Belegte Form des Hook-Feedbacks (Claude-Code-Transkripte, Subagent-Dateien; 24 Zeilen in 15 Dateien durchsucht nach dem Festtext
 * „Stop hook feedback“): `type: "user"`, `isMeta: true`, `message.content` ein String mit Präfix `Stop hook feedback:`. Nur diese Form
 * wird übergangen; jede andere User-Nachricht mit Text bleibt Grenze. Codex-Sitzungen sind nicht belegt.
 */
export function letzteErgebnisNachricht(zeilen) {
  const hatErgebnis = (t) => typeof t === "string" && /^[ \t]*ERGEBNIS:/im.test(t);
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const msg = zeilen[i]?.message ?? zeilen[i];
    const rolle = msg?.role ?? zeilen[i]?.type;
    if (rolle === "user" && istHookFeedback(zeilen[i], msg)) continue;
    if (rolle === "user" && istTextNachricht(msg)) return null;
    if (rolle !== "assistant") continue;
    const kandidaten = berichtKandidaten(msg?.content);
    for (let j = kandidaten.length - 1; j >= 0; j--) if (hatErgebnis(kandidaten[j])) return kandidaten[j];
  }
  return null;
}

/** Die belegte Form des Hook-Feedbacks (Kopfkommentar von `letzteErgebnisNachricht`). */
const istHookFeedback = (row, msg) => row?.type === "user" && row.isMeta === true && typeof msg?.content === "string" && msg.content.startsWith("Stop hook feedback:");

/** Eine User-Nachricht mit Text (Fortsetzung) beginnt eine neue Runde; ein reines `tool_result` nicht. */
const istTextNachricht = (m) => typeof m?.content === "string" || (Array.isArray(m?.content) && m.content.some((b) => b?.type === "text"));

/** Texte, in denen ein Bericht stehen kann: String-Inhalt, Text-Blöcke und die `message` eines `SubagentHandback`-Aufrufs, in Reihenfolge. */
function berichtKandidaten(c) {
  if (typeof c === "string") return [c];
  if (!Array.isArray(c)) return [];
  return c.map((b) => (b?.type === "text" ? b.text : b?.type === "tool_use" && b.name === "SubagentHandback" ? b.input?.message : null));
}

/**
 * Eine Session aus ihrer Hauptdatei `<id>.jsonl` laden (#1392): die Zeilen der Hauptdatei und je Subagent
 * `<id>/subagents/<datei>.jsonl` samt Meta (`<datei>.meta.json`; fehlend oder kaputt ergibt `{}`). Eine EINZIGE Lese-Implementierung
 * für `token-baseline.mjs` und `hauptchat-zerlegung.mjs`. Liefert `{ id, main, subagents: [{ datei, meta, zeilen }] }`.
 */
export function ladeSessionDatei(pfad) {
  const id = basename(pfad).replace(/\.jsonl$/, "");
  const main = transkriptZeilen(readFileSync(pfad, "utf8"));
  const dir = join(dirname(pfad), id, "subagents");
  const subagents = [];
  if (existsSync(dir)) {
    for (const datei of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
      const metaPfad = join(dir, datei.replace(/\.jsonl$/, ".meta.json"));
      let meta = {};
      if (existsSync(metaPfad)) {
        try {
          meta = JSON.parse(readFileSync(metaPfad, "utf8")) ?? {};
        } catch {
          meta = {}; // kaputtes Meta: der Subagent bleibt lesbar, nur ohne agentType
        }
      }
      subagents.push({ datei, meta, zeilen: transkriptZeilen(readFileSync(join(dir, datei), "utf8")) });
    }
  }
  return { id, main, subagents };
}

/** Sessions eines Projektordners, eine nach der anderen (Generator): nur die gerade verarbeitete liegt im Speicher. */
export function* ladeSessions(dir, von) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    const p = join(dir, f);
    if (von && statSync(p).mtimeMs < Date.parse(von)) continue;
    yield ladeSessionDatei(p);
  }
}

/** Repo-Pfad ohne Worktree-Suffix `.claude/worktrees/…` und ohne abschließende Schrägstriche (ein Worktree zählt als Hauptrepo). */
export function hauptrepoPfad(pfad) {
  return String(pfad)
    .replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, "")
    .replace(/[\\/]+$/, "");
}

/**
 * Projektordner-Name unter `~/.claude/projects` aus dem Repo-Pfad (#1572): Worktree-Suffix `.claude/worktrees/…` und
 * abschließende Schrägstriche entfallen (das Hauptrepo zählt), jedes Nicht-Alphanumerische wird `-`. EINE Ableitung für alle Messskripte.
 */
export function projektSlug(pfad) {
  return hauptrepoPfad(pfad).replace(/[^A-Za-z0-9]/g, "-");
}

/** Gehört der Ordnername zum Projekt `slug`: das Hauptrepo selbst oder einer seiner Worktrees; Geschwister (`<slug>-alt`) nicht. */
export function istProjektOrdner(name, slug) {
  return name === slug || String(name).startsWith(`${slug}--claude-worktrees-`);
}

/** Hauptrepo auch aus einem Worktree (`--git-common-dir` ohne `.git`); `null` ohne git. */
export function hauptrepoWurzel() {
  try {
    return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim().replace(/[\\/]\.git[\\/]?$/, "");
  } catch {
    return null;
  }
}

/** Wurzel aller Claude-Code-Transkriptordner: `~/.claude/projects`. */
export function projekteWurzel() {
  return join(homedir(), ".claude", "projects");
}

/**
 * Die Basis (Ordner mit `.factory/projekt.json`) im Arbeitsplatz, sonst `null` (factory#89): dort läuft die Session in der Basis, nicht in einem Hauptrepo.
 * `deps.config` ersetzt das Laden (Test), `deps.basis` die Basis (Standard: das Repo dieses Skripts). Wirft nie.
 */
function arbeitsplatzBasis({ config, basis } = {}) {
  try {
    const c = config ?? ladeProjektConfig({ pruefen: false });
    return c?.arbeitsplatz === undefined ? null : (basis ?? dirname(dirname(fileURLToPath(import.meta.url))));
  } catch {
    return null;
  }
}

/** Transkriptordner des Projekts: `slug` (z.B. aus `--projekt`) oder abgeleitet aus der Basis (Arbeitsplatz), dem Hauptrepo bzw. cwd; git läuft nur ohne Slug und ohne Arbeitsplatz. */
export function projektOrdner(slug, deps = {}) {
  return join(projekteWurzel(), slug ?? projektSlug(arbeitsplatzBasis(deps) ?? hauptrepoWurzel() ?? process.cwd()));
}
