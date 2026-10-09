// Kein Shebang: wird von den Messskripten, vom Stop-Hook-Baustein und von Tests importiert.
/**
 * Neutrales Transkript-Lesen (#1331): drei Verbraucher teilen es (`brain-metrics.mjs`, `token-baseline.mjs`,
 * `umsetzer-abschluss.mjs`), darum steht es in keinem von ihnen. Reines Node-Skript ohne Abhängigkeiten.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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

/**
 * Jüngste Assistant-Nachricht mit einer `ERGEBNIS:`-Zeile (#1342): entweder die `message` eines
 * `SubagentHandback`-Aufrufs oder ein Text-Block. `null`, wenn es keine gibt.
 */
export function letzteErgebnisNachricht(zeilen) {
  const hatErgebnis = (t) => typeof t === "string" && /^[ \t]*ERGEBNIS:/im.test(t);
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const msg = zeilen[i]?.message ?? zeilen[i];
    if (msg?.role !== "assistant" && zeilen[i]?.type !== "assistant") continue;
    const c = msg?.content;
    const kandidaten = typeof c === "string" ? [c] : Array.isArray(c) ? c.map((b) => (b?.type === "text" ? b.text : b?.type === "tool_use" && b.name === "SubagentHandback" ? b.input?.message : null)) : [];
    for (let j = kandidaten.length - 1; j >= 0; j--) if (hatErgebnis(kandidaten[j])) return kandidaten[j];
  }
  return null;
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

/**
 * Projektordner-Name unter `~/.claude/projects` aus dem Repo-Pfad (#1572): Worktree-Suffix `.claude/worktrees/…` und
 * abschließende Schrägstriche entfallen (das Hauptrepo zählt), jedes Nicht-Alphanumerische wird `-`. EINE Ableitung für alle Messskripte.
 */
export function projektSlug(pfad) {
  return String(pfad)
    .replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, "")
    .replace(/[\\/]+$/, "")
    .replace(/[^A-Za-z0-9]/g, "-");
}

/** Gehört der Ordnername zum Projekt `slug`: das Hauptrepo selbst oder einer seiner Worktrees; Geschwister (`<slug>-alt`) nicht. */
export function istProjektOrdner(name, slug) {
  return name === slug || String(name).startsWith(`${slug}--claude-worktrees-`);
}
