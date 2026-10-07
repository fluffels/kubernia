// Kein Shebang (siehe docs-gen.mjs). Generator `harness-inventar` (#1355): Subagenten, Skills,
// Workflows, Hooks, Plugins und MCP-Server aus den versionierten Konfigurationsdateien.
// Nie ausgegeben: Header, Tokens, Beschreibungstexte. Nie gelesen: settings.local.json.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brauche, byCodeUnit, parseFrontmatter, renderTable } from "./markdown.mjs";

const NONE = "—";
const code = (s) => `\`${s}\``;

const listDir = (abs) => readdirSync(abs, { withFileTypes: true }).sort((a, b) => byCodeUnit(a.name, b.name));

function agents(rootDir, dir) {
  return listDir(join(rootDir, dir))
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => {
      const fm = parseFrontmatter(readFileSync(join(rootDir, dir, e.name), "utf8"));
      const conf = `model: ${fm.model ?? NONE}, effort: ${fm.effort ?? NONE}`;
      return ["Subagent", fm.name ?? e.name.replace(/\.md$/, ""), conf, `${dir}/${e.name}`];
    });
}

function skills(rootDir, dir) {
  const rows = [];
  for (const e of listDir(join(rootDir, dir))) {
    const rel = `${dir}/${e.name}/SKILL.md`;
    if (!e.isDirectory() || !existsSync(join(rootDir, rel))) continue;
    const fm = parseFrontmatter(readFileSync(join(rootDir, rel), "utf8"));
    rows.push(["Skill", fm.name ?? e.name, `model: ${fm.model ?? "Session-Modell"}`, rel]);
  }
  return rows;
}

function workflows(rootDir, dir) {
  return listDir(join(rootDir, dir))
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => {
      const src = readFileSync(join(rootDir, dir, e.name), "utf8");
      const m = /export const meta\s*=\s*\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/.exec(src);
      return ["Workflow", m ? m[1] : e.name.replace(/\.js$/, ""), NONE, `${dir}/${e.name}`];
    });
}

function hooks(rootDir, file) {
  const settings = JSON.parse(readFileSync(join(rootDir, file), "utf8"));
  const rows = [];
  for (const event of Object.keys(settings.hooks ?? {}).sort(byCodeUnit)) {
    for (const group of settings.hooks[event]) {
      for (const h of group.hooks ?? []) {
        const cmd = [h.command, ...(h.args ?? [])].filter(Boolean).join(" ").replace(/\$\{CLAUDE_PROJECT_DIR\}\//g, "");
        const matcher = group.matcher ? `matcher: ${code(group.matcher)}, ` : "";
        rows.push(["Hook", event, `${matcher}${code(cmd)}`, file]);
      }
    }
  }
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
  const servers = JSON.parse(readFileSync(join(rootDir, file), "utf8")).mcpServers ?? {};
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
  const errors = [];
  const rows = [];
  const parts = [
    ["Verzeichnis", "agents", agents],
    ["Verzeichnis", "skills", skills],
    ["Verzeichnis", "workflows", workflows],
    ["Datei", "settings", hooks],
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
