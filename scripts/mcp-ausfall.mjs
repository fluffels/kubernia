#!/usr/bin/env node
/* MCP-Ausfall (#1634): wertet die Logs aus, die Claude Code je MCP-Server schreibt, und meldet Abweichungen.
 *
 *   node scripts/mcp-ausfall.mjs --sessionstart   SessionStart-Hook: nennt neue Abweichungen seit dem letzten Lauf (Klartext), Exit immer 0, blockiert nie
 *   node scripts/mcp-ausfall.mjs [--seit <ISO|Nh>] [--json]   Beleg-Befehl: Rohwerte der letzten 24 h (oder ab --seit), schreibt keinen Stand
 *
 * Anlass: Fällt ein MCP-Server mitten in der Session weg, sieht das nur der Hauptchat als flüchtige Systemmeldung ohne Fehlertext.
 * Es gibt kein Hook-Ereignis dafür; die Spur steht in den Logs `<Cache>/<Projekt-Slug>/mcp-logs-<Server>/<Start>.jsonl`
 * (Zeilen `{debug|error, timestamp, sessionId, cwd}`). Pfad und Format sind undokumentierte Interna von Claude Code: ein fehlender
 * Ordner wird sichtbar genannt, unbekannte Zeilen werden ignoriert. Plattform-Pfade: Windows gemessen, macOS/Linux nach env-paths-Konvention.
 * Meldepflicht: AGENTS.md › Harness-Befunde sind Zeilen. Reines Node-Skript (nur Builtins); die Funktionen sind pur bzw. nehmen Eingaben als Parameter.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig, umgebungsWert } from "./projekt-config-lib.mjs";
import { worktreePraefix } from "./ticket-namen.mjs";

/** Server-Arten aus `.mcp.json`, die das Skript kennt (ein Wächter-Test hält `.mcp.json` dagegen). */
export const BEKANNTE_ARTEN = ["stdio", "http"];

/** Normaler Verbindungs-Betrieb von http/SSE-Servern, der kein Ausfall ist. */
export const ROUTINE = /SSE stream disconnected|Terminal connection error|max consecutive terminal errors|HTTP connection dropped|attempting automatic reconnection|reconnection successful/i;

/** Netzabbruch-Code in einer Logzeile (`ECONNRESET`, `fetch failed`, `socket`) oder `""`. Pur. */
export function netzCode(text) {
  const m = /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE)\b|fetch failed|\bsocket\b/i.exec(text);
  if (!m) return "";
  return m[1] ?? m[0].toLowerCase();
}

const MAX_ZEILEN = 10;

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

/** Ordnername, wie Claude Code ihn aus einem Pfad bildet. Pur. */
export const slug = (pfad) => String(pfad).replace(/[^a-zA-Z0-9]/g, "-");

/** Basisordner der Claude-Code-Logs je Plattform; `FACTORY_MCP_LOG_DIR` hat Vorrang. Liest den Altpräfix lazy aus der Config (Fehler egal). */
export function logBasis({ plattform, env, home }) {
  const dir = umgebungsWert(env, "FACTORY_MCP_LOG_DIR");
  if (dir) return dir;
  if (plattform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "claude-cli-nodejs", "Cache");
  if (plattform === "darwin") return join(home, "Library", "Caches", "claude-cli-nodejs");
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), "claude-cli-nodejs");
}

/** Pfad des Hauptcheckouts zu einer Wurzel, die auch ein Worktree darunter sein darf. Pur. */
export const hauptWurzel = (wurzel) => String(wurzel).replace(/[\\/]+$/, "").replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/, "");

/**
 * Stand-Datei des Hooks: je Hauptcheckout eine (auch für seine Worktrees), Name `<praefixe.worktree>mcp-ausfall-<Slug>.json` aus der Projekt-Config;
 * `FACTORY_MCP_AUSFALL_STAND` hat Vorrang (dann braucht es nur den lazy gelesenen Altpräfix, keine Worktree-Angabe). Ohne `praefixe.worktree` in der Config wirft die Funktion mit Fix-Zeile.
 */
export const standPfad = (wurzel, env, tmp, config) => umgebungsWert(env, "FACTORY_MCP_AUSFALL_STAND") || join(tmp, `${worktreePraefix(config ?? ladeProjektConfig())}mcp-ausfall-${slug(hauptWurzel(wurzel))}.json`);

/** Projekt-Ordner (Hauptcheckout und seine Worktrees) unter den Namen des Basisordners; Suffix `""` = Hauptcheckout. Pur. */
export function projektOrdner(namen, wurzel) {
  const haupt = slug(hauptWurzel(wurzel));
  const praefix = `${haupt}--claude-worktrees-`;
  return namen.filter((n) => n === haupt || n.startsWith(praefix)).map((n) => ({ ordner: n, suffix: n.slice(haupt.length) }));
}

/** Log-Ordnername eines Servers. Pur. */
export const serverOrdner = (name) => `mcp-logs-${slug(name)}`;

/** Server-Name zu einem Log-Ordner: der Konfig-Name bei Treffer, sonst der Ordnername ohne Präfix (user-scope-Server wie langfuse stehen nicht in `.mcp.json`); kein `mcp-logs-`-Ordner ergibt `null`. Pur. */
export function serverNameFuerOrdner(ordner, server) {
  if (!ordner.startsWith("mcp-logs-") || ordner === "mcp-logs-") return null;
  return server.find((s) => serverOrdner(s.name) === ordner)?.name ?? ordner.slice("mcp-logs-".length);
}

/** Anzeigename im Befund: wie `serverNameFuerOrdner`, bei einem Server ohne Eintrag in `.mcp.json` (user-scope, Plugin, Connector) mit dem Zusatz „extern (nicht im Repo konfiguriert)“, damit er nicht als Repo-Defekt gelesen wird. Pur. */
export function serverAnzeige(ordner, server) {
  const name = serverNameFuerOrdner(ordner, server);
  if (!name) return null;
  return server.some((s) => serverOrdner(s.name) === ordner) ? name : `${name} [extern (nicht im Repo konfiguriert)]`;
}

/** Der npx-Hinweis des Launchers (`scripts/mcp-launch.mjs` › `npxHinweis`) als stderr-Zeile des Servers: Pfeil + `npx` oder `npx -y`. Pur. */
export const istNpxFallback = (text) => /→\s*npx\b|\bnpx -y\b/.test(text);

/** Vorspann jedes (Wieder-)Verbindens in den Logs: er sagt nichts über den Anlass und zählt nicht als Ursache eines Reconnects. */
const VORSPANN = /^(Initializing HTTP transport|Node version:|Environment:|HTTP transport (options|created)|Starting connection)/;

/**
 * Die Zeilen einer Log-Datei (Text) als Befunde `[{klasse, zeit, sessionId, text, code}]`; wirft nie, kaputte Zeilen entfallen. Pur.
 * Ein `reconnect` (zweites `Starting connection` unter derselben `sessionId` wie der vorige Start; ein neuer Session-Wert in derselben Datei beginnt neu) trägt `ursache`: die letzte Logzeile davor ohne den Vorspann (≤ 160 Zeichen). Steht dort
 * eine Routine-Meldung (`ROUTINE`, etwa „attempting automatic reconnection“ nach dem SSE-Leerlauf-Timeout), ist der Neustart der normale
 * Wiederaufbau und entfällt.
 */
export function klassifiziere(zeilen) {
  const befunde = [];
  let verbindungen = 0;
  let startSession = "";
  let letzte = "";
  for (const roh of zeilen) {
    let z;
    try {
      z = JSON.parse(roh);
    } catch {
      continue;
    }
    if (!z || typeof z !== "object") continue;
    const text = String(z.error ?? z.debug ?? "");
    const mk = (klasse, code = "", extra = {}) => befunde.push({ klasse, zeit: z.timestamp ?? "", sessionId: z.sessionId ?? "", text, code, ...extra });
    const davor = letzte;
    if (!VORSPANN.test(text)) letzte = text.replace(/\s+/g, " ").slice(0, 160);
    if (typeof z.error === "string") {
      if (z.error.startsWith("Server stderr:")) mk(istNpxFallback(z.error) ? "npx-fallback" : "stderr");
      else if (!z.error.startsWith("###")) mk("fehler");
      continue;
    }
    if (typeof z.debug !== "string") continue;
    if (/^Starting connection/.test(text)) {
      verbindungen += 1;
      const session = z.sessionId ?? "";
      // Ein Start unter neuer sessionId (Session-Wechsel, die Logdatei läuft weiter) ist der erste Start dieser Session.
      if (verbindungen > 1 && session === startSession && !ROUTINE.test(davor)) mk("reconnect", "", { ursache: davor });
      startSession = session;
    } else if (/^Tool '/.test(text)) {
      // Tool-Fehler sind kein Serverausfall, außer der Netzcode zeigt eine gerissene Verbindung (MCP-Protokollfehler und die `### Error`-Ausgabe eines Tools, etwa ein Browser-Tool ohne Dev-Server, bleiben draußen).
      if (/ failed/.test(text) && !/MCP error -32\d+|### Error/.test(text) && netzCode(text)) mk("abbruch", netzCode(text));
    } else if (!ROUTINE.test(text) && (/fail|timed out/i.test(text) || (/connection closed/i.test(text) && !/\(cleanly\)/.test(text)))) {
      mk("abbruch", netzCode(text));
    }
  }
  return befunde;
}

/** Beispielzeile eines Befunds; ein Reconnect nennt seine Ursache („davor: …“). */
const beispielText = (b) => {
  const text = b.text.replace(/\s+/g, " ");
  return (b.ursache ? `${text} (davor: ${b.ursache})` : text).slice(0, 160);
};

/** Befunde nach Server, Klasse und Ordner-Suffix bündeln: Anzahl, Zeitspanne, ≤ 3 Sessions, Beispielzeile. Pur. */
export function buendeln(befunde) {
  const gruppen = new Map();
  for (const b of befunde) {
    const key = `${b.server}\u0000${b.klasse}\u0000${b.code ?? ""}\u0000${b.suffix ?? ""}`;
    const g = gruppen.get(key) ?? { server: b.server, klasse: b.klasse, code: b.code ?? "", suffix: b.suffix ?? "", anzahl: 0, erste: b.zeit, letzte: b.zeit, sessions: [], beispiel: beispielText(b) };
    g.anzahl += 1;
    if (b.zeit && (!g.erste || b.zeit < g.erste)) g.erste = b.zeit;
    if (b.zeit > g.letzte) g.letzte = b.zeit;
    if (b.sessionId && !g.sessions.includes(b.sessionId) && g.sessions.length < 3) g.sessions.push(b.sessionId);
    gruppen.set(key, g);
  }
  return [...gruppen.values()];
}

/** Nur Befunde ab `stand` (ISO-Text). Pur. */
export const neuSeit = (befunde, stand) => befunde.filter((b) => b.zeit >= stand);

/** Hook-/Befehlsausgabe (Klartext) oder `""`, wenn nichts abweicht. Pur. */
export function meldung(gebuendelt, variablenBefunde, seit) {
  if (!gebuendelt.length && !variablenBefunde.length) return "";
  const zeilen = gebuendelt.slice(0, MAX_ZEILEN).map((g) => {
    const wo = g.suffix ? ` [Worktree${g.suffix}]` : "";
    return `- ${g.server}${wo}: ${g.klasse}${g.code ? ` (${g.code})` : ""} ×${g.anzahl} (${g.erste} bis ${g.letzte}; Session ${g.sessions.join(", ") || "?"}): ${g.beispiel}`;
  });
  if (gebuendelt.length > MAX_ZEILEN) zeilen.push(`- … ${gebuendelt.length - MAX_ZEILEN} weitere Gruppen (Rohwerte: --json)`);
  return [
    `MCP-Abweichungen laut Claude-Code-Logs seit ${seit}:`,
    ...zeilen,
    ...variablenBefunde.map((v) => `- ${v}`),
    `Melden: je Befund eine Zeile im Harness-Sammelticket (AGENTS.md › Harness-Befunde), Rohwerte: node scripts/mcp-ausfall.mjs --seit ${seit}`,
  ].join("\n");
}

/** Zeitangabe `<ISO>` oder `<N>h` als ISO-Text; ungültig ergibt den Standard. Pur. */
export function parseSeit(arg, jetzt, standardStunden = 24) {
  if (arg) {
    const h = /^(\d+)h$/.exec(arg);
    if (h) return new Date(jetzt - Number(h[1]) * 3600_000).toISOString();
    const d = new Date(arg);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date(jetzt - standardStunden * 3600_000).toISOString();
}

function lies(basis, wurzel, server, seit) {
  const alle = [];
  let namen;
  try {
    namen = readdirSync(basis);
  } catch {
    return null;
  }
  const seitMs = Date.parse(seit);
  for (const p of projektOrdner(namen, wurzel)) {
    // Alle `mcp-logs-*`-Ordner des Projekts, nicht nur die Server aus `.mcp.json`: user-scope-Server (langfuse) haben dort keinen Eintrag.
    let ordnerNamen;
    try {
      ordnerNamen = readdirSync(join(basis, p.ordner));
    } catch {
      continue;
    }
    for (const o of ordnerNamen) {
      const name = serverAnzeige(o, server);
      if (!name) continue;
      const dir = join(basis, p.ordner, o);
      let dateien;
      try {
        dateien = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of dateien) {
        try {
          if (statSync(join(dir, f)).mtimeMs < seitMs) continue;
          const zeilen = readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean);
          for (const b of klassifiziere(zeilen)) alle.push({ ...b, server: name, suffix: p.suffix });
        } catch {
          // unlesbare Datei überspringen
        }
      }
    }
  }
  return neuSeit(alle, seit);
}

const USAGE = "Aufruf: node scripts/mcp-ausfall.mjs [--sessionstart] [--json] [--seit <ISO|Nh>]";

/** Liest den Aufruf (`--sessionstart`, `--json`, `--seit <wert>`): `{ werte: { sessionstart, json, seit } }` oder `{ fehler }` (Text samt Aufrufzeile). Pur. */
export function aufrufLesen(argv) {
  const r = flagsLesen(argv, { sessionstart: { type: "boolean" }, json: { type: "boolean" }, seit: { type: "string" } });
  if (r.fehler) return { fehler: `${r.fehler.text}. ${USAGE}` };
  return { werte: { sessionstart: r.werte.sessionstart === true, json: r.werte.json === true, seit: r.werte.seit } };
}

export function main(argv = process.argv.slice(2), env = process.env, out = console.log, { plattform = process.platform, home = homedir(), jetzt = Date.now(), err = console.error, config } = {}) {
  const aufruf = aufrufLesen(argv);
  if (aufruf.fehler) {
    err(aufruf.fehler);
    return AUFRUF_EXIT;
  }
  const { sessionstart, json, seit: seitArg } = aufruf.werte;
  try {
    const wurzel = env.CLAUDE_PROJECT_DIR || fileURLToPath(new URL("..", import.meta.url));
    const server = serverAusConfig(readFileSync(join(wurzel, ".mcp.json"), "utf8"));
    // Ohne nutzbare Config: eine Zeile mit Grund (statt stiller Auslassung), die Auswertung läuft ohne Stand-Datei weiter (nichts lesen, nichts schreiben; die `&& stand`-Guards machen das sichtbar, das äußere catch würde es auch abfangen).
    let stand = null;
    try {
      stand = standPfad(wurzel, env, tmpdir(), config);
    } catch (e) {
      out(`MCP-Ausfall-Hinweis ohne Stand-Datei: ${e instanceof Error ? e.message : String(e)}`);
    }
    let standSeit;
    if (sessionstart && stand) {
      try {
        standSeit = JSON.parse(readFileSync(stand, "utf8")).bis;
      } catch {
        // kein Stand: Standardfenster
      }
    }
    const seit = sessionstart ? parseSeit(standSeit, jetzt) : parseSeit(seitArg, jetzt);
    const basis = logBasis({ plattform, env, home });
    const befunde = lies(basis, wurzel, server, seit);
    const variablen = server.filter((s) => s.type === "http").map((s) => [s, fehlendeVariablen(s, env)]).filter(([, f]) => f.length)
      .map(([s, f]) => `${s.name}: Umgebungsvariable(n) ${f.join(", ")} nicht gesetzt (Header-Platzhalter), der Server verbindet voraussichtlich nicht`);
    const unbekannt = server.filter((s) => !BEKANNTE_ARTEN.includes(s.type)).map((s) => `${s.name}: Server-Art "${s.type}" kennt mcp-ausfall nicht (ungeprüft)`);
    if (befunde === null) {
      out(`MCP-Logs nicht gefunden: ${basis} (Pfad oder Format von Claude Code geändert? Ohne Logs keine Ausfall-Auswertung).`);
    } else if (!sessionstart && json) {
      for (const b of befunde) out(JSON.stringify(b));
    } else {
      const text = meldung(buendeln(befunde), [...variablen, ...unbekannt], seit);
      if (text) out(text);
    }
    if (sessionstart && stand) {
      mkdirSync(join(stand, ".."), { recursive: true });
      writeFileSync(stand, JSON.stringify({ bis: new Date(jetzt).toISOString() }));
    }
  } catch {
    // Der Hinweis darf den Start nie blockieren.
  }
  return 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
