// Kein Shebang: wird per `node scripts/playwright-mcp.mjs` gestartet UND von
// test/harness/playwright-mcp.test.ts importiert.
// Launcher für den Playwright-MCP-Server der Agenten (#1283), gestartet aus `.mcp.json`.
//
// Claude Code startet den Server einmal pro Session aus deren Startverzeichnis – meist
// der Haupt-Checkout, dessen node_modules hinter dem Lockfile liegen kann (oder das
// Paket gar nicht hat). Ein fester Pfad auf node_modules/@playwright/mcp fiele dann
// still aus: in der Session fehlen nur die mcp__playwright__*-Tools, kein Fehler.
//
// Darum: Version kommt aus dem Lockfile (die eine Quelle, Dependabot pflegt sie).
// Passt die lokale Installation dazu → lokal starten (schnell, offline). Sonst
// `npx -y @playwright/mcp@<exakte Version>` – nie ungepinnt, nie @latest.
// Alle übrigen Argumente gehen unverändert an den Server.
//
// Bekannte Grenzen (#1309, gemessen unter Windows: nach Beenden des Launchers blieben weder im lokalen
// noch im npx-Modus Prozesse zurück, darum keine Kill-/Retry-Logik): Im npx-Modus werden transitive
// Abhängigkeiten frisch aufgelöst statt aus dem Lockfile, und mehrere Sessions, die nach einem Bump
// gleichzeitig erstmals starten, können sich im `_npx`-Cache in die Quere kommen (ENOTEMPTY). Abhilfe:
// im Haupt-Checkout einmal `npm ci`, dann startet der Server lokal.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PKG = "@playwright/mcp";
export const BIN = "playwright-mcp";

/** Gepinnte Version laut package-lock.json, oder undefined. */
export function readLockVersion(root) {
  try {
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    return lock.packages?.[`node_modules/${PKG}`]?.version;
  } catch {
    return undefined;
  }
}

/** Lokal installierte Version + Pfad des bins, oder null (fehlt / ohne bin). */
export function readInstalled(root) {
  const dir = join(root, "node_modules", PKG);
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[BIN];
    if (!bin) return null;
    const binPath = join(dir, bin);
    return existsSync(binPath) ? { version: pkg.version, binPath } : null;
  } catch {
    return null;
  }
}

/** Pure Startentscheidung: lokal nur bei exakt passender Version, sonst npx gepinnt. */
export function planLaunch({ lockVersion, installed }) {
  if (!lockVersion) {
    throw new Error(`${PKG} fehlt im Lockfile (package-lock.json) – ohne gepinnte Version kein Start.`);
  }
  if (installed && installed.version === lockVersion) return { mode: "local", binPath: installed.binPath };
  return { mode: "npx", spec: `${PKG}@${lockVersion}` };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const plan = planLaunch({ lockVersion: readLockVersion(root), installed: readInstalled(root) });
  // stdout gehört dem MCP-Protokoll – Hinweise nur auf stderr.
  const child =
    plan.mode === "local"
      ? spawn(process.execPath, [plan.binPath, ...args], { stdio: "inherit" })
      : (process.stderr.write(`playwright-mcp: lokale Installation fehlt oder weicht ab → npx ${plan.spec}\n`),
        spawn("npx", ["-y", plan.spec, ...args], { stdio: "inherit", shell: process.platform === "win32" }));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
