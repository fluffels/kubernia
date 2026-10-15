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
// Ausfälle (#1634): Endet der Server ohne Signal des Aufrufers oder mit Exit ≠ 0 (auch Exit 0 nach ersetzter lokaler
// Installation), steht eine Zeile auf stderr (`mcp-logs-*` von Claude Code als „Server stderr“). Ein harter Kill des
// Launchers selbst hinterlässt keine Zeile, nur den Reconnect im Log (`node scripts/mcp-ausfall.mjs`).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
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

/** Datei-Kennung des bins (Inode, Anlege- und Änderungszeit) oder null; ein `npm ci` legt `node_modules` neu an und ändert sie. */
export function statInstallation(binPath) {
  try {
    const s = statSync(binPath);
    return { ino: s.ino, birthtimeMs: s.birthtimeMs, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

/** Wurde die lokale Installation während der Laufzeit ersetzt? `vorher === null` (npx-Modus) ist nie „ersetzt“. Pur. */
export function installationErsetzt(vorher, nachher) {
  if (!vorher) return false;
  if (!nachher) return true;
  return vorher.ino !== nachher.ino || vorher.birthtimeMs !== nachher.birthtimeMs || vorher.mtimeMs !== nachher.mtimeMs;
}

/** Stderr-Zeile für ein unerwartetes Ende des Servers (#1634) oder null: gewollte Beendigung und sauberer Exit 0 bleiben still. Pur. */
export function exitMeldung({ code, signal, vonAussen, laufzeitMs, modus, ersetzt }) {
  if (vonAussen || (code === 0 && !ersetzt)) return null;
  const ende = signal ? `Signal ${signal}` : `Exit ${code}`;
  const zusatz = ersetzt ? "; lokale Installation während der Laufzeit ersetzt, etwa durch npm ci" : "";
  return `playwright-mcp: Server beendet (${ende}, nach ${Math.round(laufzeitMs / 1000)} s, Modus ${modus}${zusatz})`;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const plan = planLaunch({ lockVersion: readLockVersion(root), installed: readInstalled(root) });
  const start = Date.now();
  const vorher = plan.mode === "local" ? statInstallation(plan.binPath) : null;
  let vonAussen = false;
  // stdout gehört dem MCP-Protokoll – Hinweise nur auf stderr.
  const child =
    plan.mode === "local"
      ? spawn(process.execPath, [plan.binPath, ...args], { stdio: "inherit" })
      : (process.stderr.write(`playwright-mcp: lokale Installation fehlt oder weicht ab → npx ${plan.spec}\n`),
        spawn("npx", ["-y", plan.spec, ...args], { stdio: "inherit", shell: process.platform === "win32" }));
  child.on("error", (e) => {
    process.stderr.write(`playwright-mcp: Start fehlgeschlagen (${e.code ?? e.message})\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    const ersetzt = plan.mode === "local" && installationErsetzt(vorher, statInstallation(plan.binPath));
    const zeile = exitMeldung({ code, signal, vonAussen, laufzeitMs: Date.now() - start, modus: plan.mode === "local" ? "local" : "npx", ersetzt });
    if (zeile) process.stderr.write(`${zeile}\n`);
    process.exit(code ?? (signal ? 1 : 0));
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      vonAussen = true;
      child.kill(sig);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
