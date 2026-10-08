// Kein Shebang (siehe docs-gen.mjs). Generator `harness-inventar` (#1355): Subagenten, Skills,
// Workflows, Hooks, Plugins und MCP-Server aus den versionierten Konfigurationsdateien.
// Nie ausgegeben: Header, Tokens, Beschreibungstexte. Nie gelesen: settings.local.json.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brauche, byCodeUnit, leseJson, parseFrontmatter, renderTable } from "./markdown.mjs";

const NONE = "—";
const code = (s) => `\`${s}\``;

const listDir = (abs) => readdirSync(abs, { withFileTypes: true }).sort((a, b) => byCodeUnit(a.name, b.name));

const entquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, "$2");

/**
 * Hooks aus dem Frontmatter einer Agenten-/Skill-Datei (#1476): `[{event, matcher, command}]`.
 * Eigener, zeilenweiser Parser für die Form `hooks: <Event>: - matcher: … hooks: - type: command,
 * command: …, args: - …` (keine YAML-Dependency). Fail-closed: ein `hooks:`-Block ohne lesbaren Befehl
 * wirft mit Dateinamen, damit ein neuer Hook nie still im Inventar fehlt.
 * Bewusste Grenzen: die Flow-Form `args: ["a", "b"]` und Block-Scalare (`command: >`) liest er nicht (dann
 * fehlen Argumente bzw. der Befehl wird `>`); die Form bleibt nicht abgedeckt, bis ein Hook sie braucht.
 */
export function frontmatterHooks(text, datei) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return [];
  const zeilen = m[1].split(/\r?\n/);
  const start = zeilen.findIndex((l) => /^hooks:\s*$/.test(l));
  if (start < 0) return [];
  const ergebnis = [];
  let event = null;
  let matcher = "";
  let handler = null;
  let inArgs = false;
  let eventEinzug = -1;
  const abschliessen = () => {
    if (!handler) return;
    if (!handler.command || !event) throw new Error(`${datei}: Hook im Frontmatter ohne lesbaren Befehl`);
    ergebnis.push({ event, matcher, command: [handler.command, ...handler.args].join(" ") });
    handler = null;
  };
  for (const l of zeilen.slice(start + 1)) {
    if (!l.trim()) continue;
    const einzug = l.length - l.trimStart().length;
    if (einzug === 0) break;
    const inhalt = l.trim();
    if (eventEinzug < 0) eventEinzug = einzug;
    const evt = /^(\w+):\s*$/.exec(inhalt);
    if (einzug === eventEinzug && evt) {
      abschliessen();
      event = evt[1];
      matcher = "";
      inArgs = false;
      continue;
    }
    const ohneStrich = inhalt.replace(/^-\s+/, "");
    const istStrich = ohneStrich !== inhalt;
    const kv = /^(\w+):\s*(.*)$/.exec(ohneStrich);
    if (inArgs && istStrich && !kv) {
      handler.args.push(entquote(ohneStrich));
      continue;
    }
    inArgs = false;
    if (!kv) continue;
    const [, key, wert] = kv;
    if (key === "matcher") {
      abschliessen();
      matcher = entquote(wert);
    } else if (key === "type" || (key === "command" && istStrich)) {
      abschliessen();
      handler = { command: key === "command" ? entquote(wert) : "", args: [] };
    } else if (key === "command") {
      handler ??= { command: "", args: [] };
      handler.command = entquote(wert);
    } else if (key === "args" && handler) {
      inArgs = true;
    }
  }
  abschliessen();
  if (!ergebnis.length) throw new Error(`${datei}: hooks im Frontmatter ohne lesbaren Befehl`);
  return ergebnis;
}

/** Subagenten aus `dir`: `{name, model, effort, datei, hooks}` (Name wie im Frontmatter, sonst Dateiname). */
function agentKatalog(rootDir, dir) {
  return listDir(join(rootDir, dir))
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => {
      const text = readFileSync(join(rootDir, dir, e.name), "utf8");
      const fm = parseFrontmatter(text);
      const datei = `${dir}/${e.name}`;
      return { name: fm.name ?? e.name.replace(/\.md$/, ""), model: fm.model, effort: fm.effort, datei, hooks: frontmatterHooks(text, datei) };
    });
}

/** Skills aus `dir/<name>/SKILL.md`: `{name, model, effort, datei, hooks}`. */
function skillKatalog(rootDir, dir) {
  const items = [];
  for (const e of listDir(join(rootDir, dir))) {
    const rel = `${dir}/${e.name}/SKILL.md`;
    if (!e.isDirectory() || !existsSync(join(rootDir, rel))) continue;
    const text = readFileSync(join(rootDir, rel), "utf8");
    const fm = parseFrontmatter(text);
    items.push({ name: fm.name ?? e.name, model: fm.model, effort: fm.effort, datei: rel, hooks: frontmatterHooks(text, rel) });
  }
  return items;
}

/** Workflows aus `dir/*.js`: `{name, datei}` (`meta.name`, sonst Dateiname). */
function workflowKatalog(rootDir, dir) {
  return listDir(join(rootDir, dir))
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => {
      const src = readFileSync(join(rootDir, dir, e.name), "utf8");
      const m = /export const meta\s*=\s*\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/.exec(src);
      return { name: m ? m[1] : e.name.replace(/\.js$/, ""), datei: `${dir}/${e.name}` };
    });
}

/**
 * Katalog der Harness-Bausteine unter `.claude/` (ein Parser für Inventar und Diagramme, #1369).
 * Fehlende Verzeichnisse oder nicht konfigurierte Schlüssel ergeben eine leere Liste.
 */
export function harnessKatalog(rootDir, harnessCfg) {
  const lies = (key, fn) => (harnessCfg?.[key] && existsSync(join(rootDir, harnessCfg[key])) ? fn(rootDir, harnessCfg[key]) : []);
  return {
    agents: lies("agents", agentKatalog),
    skills: lies("skills", skillKatalog),
    workflows: lies("workflows", workflowKatalog),
  };
}

function agents(rootDir, dir) {
  return agentKatalog(rootDir, dir).map((a) => ["Subagent", a.name, `model: ${a.model ?? NONE}, effort: ${a.effort ?? NONE}`, a.datei]);
}

function skills(rootDir, dir) {
  return skillKatalog(rootDir, dir).map((s) => ["Skill", s.name, `model: ${s.model ?? "Session-Modell"}`, s.datei]);
}

function workflows(rootDir, dir) {
  return workflowKatalog(rootDir, dir).map((w) => ["Workflow", w.name, NONE, w.datei]);
}

/** Eine Hook-Zeile; `${CLAUDE_PROJECT_DIR}/` fällt weg, der Matcher steht in Code. */
function hookZeile(event, matcher, cmd, quelle) {
  const m = matcher ? `matcher: ${code(matcher)}, ` : "";
  return ["Hook", event, `${m}${code(cmd.replace(/\$\{CLAUDE_PROJECT_DIR\}\//g, ""))}`, quelle];
}

/** Hooks aus Agenten und Skills (Frontmatter), sortiert nach Quelldatei, dann Event. */
function frontmatterHookZeilen(katalog) {
  return katalog
    .flatMap((k) => k.hooks.map((h) => ({ ...h, quelle: k.datei })))
    .sort((a, b) => byCodeUnit(a.quelle, b.quelle) || byCodeUnit(a.event, b.event))
    .map((h) => hookZeile(h.event, h.matcher, h.command, h.quelle));
}

function hooks(rootDir, file, frontmatter = []) {
  const settings = leseJson(rootDir, file, "Hook-Einstellungen");
  const rows = [];
  for (const event of Object.keys(settings.hooks ?? {}).sort(byCodeUnit)) {
    for (const group of settings.hooks[event]) {
      for (const h of group.hooks ?? []) {
        rows.push(hookZeile(event, group.matcher, [h.command, ...(h.args ?? [])].filter(Boolean).join(" "), file));
      }
    }
  }
  rows.push(...frontmatterHookZeilen(frontmatter));
  for (const [id, on] of Object.entries(settings.enabledPlugins ?? {}).sort(([a], [b]) => byCodeUnit(a, b))) {
    if (on !== true) continue;
    const at = id.indexOf("@");
    const name = at < 0 ? id : id.slice(0, at);
    rows.push(["Plugin", name, at < 0 ? NONE : `Marktplatz: ${id.slice(at + 1)}`, file]);
  }
  return rows;
}

function gitHooks(rootDir, dir) {
  return listDir(join(rootDir, dir))
    .filter((e) => e.isFile())
    .map((e) => ["Git-Hook", e.name, NONE, `${dir}/${e.name}`]);
}

function mcp(rootDir, file) {
  const servers = leseJson(rootDir, file, "MCP-Konfiguration").mcpServers ?? {};
  return Object.keys(servers)
    .sort(byCodeUnit)
    .map((name) => {
      const s = servers[name];
      let conf;
      if (s.url) conf = `${s.type ?? "http"}, ${new URL(s.url).host}`;
      else conf = `${s.type ?? "stdio"}, ${[s.command, (s.args ?? []).find((a) => !a.startsWith("-"))].filter(Boolean).join(" ")}`;
      return ["MCP-Server", name, conf, file];
    });
}

export function harnessInventarGenerator({ rootDir, config }) {
  const h = config.harness ?? {};
  const k = harnessKatalog(rootDir, h);
  const errors = [];
  const rows = [];
  const parts = [
    ["Verzeichnis", "agents", agents],
    ["Verzeichnis", "skills", skills],
    ["Verzeichnis", "workflows", workflows],
    ["Datei", "settings", (r, f) => hooks(r, f, [...(k.agents ?? []), ...(k.skills ?? [])])],
    ["Verzeichnis", "gitHooks", gitHooks],
    ["Datei", "mcp", mcp],
  ];
  for (const [what, key, fn] of parts) {
    if (!h[key]) continue;
    if (brauche(rootDir, h[key], `${what} (harness.${key})`, errors)) rows.push(...fn(rootDir, h[key]));
  }
  if (errors.length) throw new Error(errors.join("; "));
  return renderTable(
    ["Art", "Name", "Konfiguration", "Quelle"],
    rows.map(([art, name, conf, src]) => [art, code(name), conf, code(src)]),
  );
}
