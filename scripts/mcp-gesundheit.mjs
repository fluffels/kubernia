#!/usr/bin/env node
/* MCP-Gesundheit (#1634): prüft beim Session-Start, ob die Server aus `.mcp.json` überhaupt starten.
 *
 *   node scripts/mcp-gesundheit.mjs   SessionStart-Hook: nennt jede Abweichung samt Meldepflicht; endet immer mit Exit 0, blockiert nie
 *
 * Anlass: Fällt ein MCP-Server aus, sieht das nur der Hauptchat als flüchtige Systemmeldung ohne Fehlertext, und niemand hält es
 * fest. Der Hook macht die Abweichung sichtbar, solange sie noch reproduzierbar ist (stdio: echter MCP-`initialize`-Handshake mit
 * Zeitlimit; http: sind die `${VAR}`-Platzhalter der Header gesetzt?). Netz-Aufrufe gibt es bewusst keine.
 * Meldepflicht: AGENTS.md › „Ausfälle melden“. Reines Node-Skript (nur Builtins); die Prüffunktionen sind pur bzw. nehmen
 * ihre Eingaben als Parameter (test/mcp-gesundheit.test.ts).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./hook-io.mjs";

/** Zeitlimit der Handshake-Probe je stdio-Server (der Hook hat 15 s Gesamtbudget, die Proben laufen parallel). */
export const PROBE_MS = 8000;

/** Server aus dem Text von `.mcp.json`: `[{ name, ...konfig }]`; kaputtes/leeres JSON ergibt `[]`. Pur. */
export function serverAusConfig(text) {
  try {
    const server = JSON.parse(text)?.mcpServers ?? {};
    return Object.entries(server).map(([name, konfig]) => ({ name, ...konfig }));
  } catch {
    return [];
  }
}

/** Die `${VAR}`-Platzhalter eines http-Servers (URL und Header) ohne gesetzten Wert in `env`. Pur. */
export function fehlendeVariablen(server, env) {
  const texte = [server.url ?? "", ...Object.values(server.headers ?? {})].map(String);
  const namen = new Set(texte.flatMap((t) => [...t.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1])));
  return [...namen].filter((n) => !env[n]);
}

/** Ergebnis der Probe als Abweichungstext oder `null` (alles gut). Pur. */
export function bewertung(name, { ok, grund, stderr }) {
  const npx = /npx/i.test(stderr ?? "");
  if (!ok) return `${name}: startet nicht (${grund}${stderr ? `; stderr: ${stderr.trim().split("\n").slice(-3).join(" | ")}` : ""})`;
  if (npx) return `${name}: startet nur über den npx-Fallback (lokale Installation passt nicht zum Lockfile; Hauptcheckout: einmal \`npm ci\`)`;
  return null;
}

/**
 * stdio-Probe: Server starten, `initialize` senden, auf die Antwort mit `id: 1` warten, dann beenden.
 * `ok:false` mit `grund` bei Startfehler, vorzeitigem Ende (Exit-Code) oder Zeitüberschreitung. Der Kindprozess wird immer beendet.
 */
export function probeStdio(server, { cwd, env = process.env, timeoutMs = PROBE_MS, plattform = process.platform } = {}) {
  return new Promise((aufloesen) => {
    let stdout = "";
    let stderr = "";
    let fertig = false;
    // `node` startet ohne Shell (Argumente mit `;`/`*` bleiben heil); andere Befehle (npx.cmd) brauchen unter Windows eine.
    const kind = spawn(server.command, server.args ?? [], { cwd, env, shell: plattform === "win32" && server.command !== "node", stdio: ["pipe", "pipe", "pipe"] });
    const beenden = (ergebnis) => {
      if (fertig) return;
      fertig = true;
      clearTimeout(uhr);
      try {
        if (plattform === "win32" && kind.pid) spawn("taskkill", ["/PID", String(kind.pid), "/T", "/F"], { stdio: "ignore" });
        else kind.kill();
      } catch {
        // schon beendet
      }
      aufloesen({ ...ergebnis, stderr: stderr.slice(-600) });
    };
    const uhr = setTimeout(() => beenden({ ok: false, grund: `keine Antwort auf initialize in ${timeoutMs / 1000} s` }), timeoutMs);
    kind.on("error", (e) => beenden({ ok: false, grund: `Start fehlgeschlagen: ${e.code ?? e.message}` }));
    kind.on("exit", (code, signal) => beenden({ ok: false, grund: `beendet vor der Antwort (Exit ${code ?? signal})` }));
    kind.stderr.on("data", (d) => (stderr += d));
    kind.stdout.on("data", (d) => {
      stdout += d;
      if (/"id"\s*:\s*1\b/.test(stdout) && /"result"/.test(stdout)) beenden({ ok: true });
    });
    kind.stdin.on("error", () => {});
    kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-gesundheit", version: "1" } } })}\n`);
  });
}

/** Alle Server prüfen; liefert die Abweichungstexte. Unbekannte Server-Arten sind selbst eine Abweichung (nie still übersprungen). */
export async function pruefeAlle(server, { cwd, env, probe = probeStdio }) {
  const ergebnisse = await Promise.all(
    server.map(async (s) => {
      if (s.type === "stdio") return bewertung(s.name, await probe(s, { cwd, env }));
      if (s.type === "http") {
        const fehlt = fehlendeVariablen(s, env);
        return fehlt.length ? `${s.name}: Umgebungsvariable(n) ${fehlt.join(", ")} nicht gesetzt (Header-Platzhalter), der Server verbindet voraussichtlich nicht` : null;
      }
      return `${s.name}: Server-Art "${s.type}" kennt mcp-gesundheit nicht (ungeprüft)`;
    }),
  );
  return ergebnisse.filter(Boolean);
}

/** Die Hook-Ausgabe (Klartext für den Session-Kontext) oder `""`, wenn alles passt. Pur. */
export function meldung(abweichungen) {
  if (!abweichungen.length) return "";
  return [
    `MCP-Abweichung beim Session-Start (${abweichungen.length}):`,
    ...abweichungen.map((a) => `- ${a}`),
    "Melden: Zeile im Harness-Sammelticket „Harness-Härtung (gesammelt)“ mit Datum, Session-Kontext, wörtlicher Meldung, belegt/Hypothese, betroffener Konfiguration (AGENTS.md › Ausfälle melden). Eine Zeile je Befund, nur aus Evidenz.",
  ].join("\n");
}

export async function main(env = process.env, out = console.log) {
  const wurzel = env.CLAUDE_PROJECT_DIR || fileURLToPath(new URL("..", import.meta.url));
  try {
    const server = serverAusConfig(readFileSync(join(wurzel, ".mcp.json"), "utf8"));
    const text = meldung(await pruefeAlle(server, { cwd: wurzel, env }));
    if (text) out(text);
  } catch {
    // Der Hinweis darf den Start nie blockieren.
  }
  return 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
