// Kein Shebang: wird per `node scripts/playwright-mcp.mjs` gestartet UND von
// test/harness/playwright-mcp.test.ts importiert.
// Launcher für den Playwright-MCP-Server der Agenten (#1283), gestartet aus `.mcp.json`.
// Die Startlogik (Version aus dem Lockfile, lokal wenn installiert, sonst `npx -y <paket>@<exakt>`,
// Ausfallzeile) steckt in `scripts/mcp-launch.mjs` (`launcherFuer`); hier stehen nur die Werte des Servers.
// Der Server läuft im Startverzeichnis der Session (`--output-dir .playwright-mcp` ist relativ dazu).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launcherFuer } from "./mcp-launch.mjs";

const launcher = launcherFuer({ name: "playwright-mcp", pkg: "@playwright/mcp", bin: "playwright-mcp" });
export const { PKG, BIN, readLockVersion, readInstalled, planLaunch, statInstallation, installationErsetzt, exitMeldung } = launcher;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  launcher.starte({ root: join(dirname(fileURLToPath(import.meta.url)), ".."), args: process.argv.slice(2) });
}
