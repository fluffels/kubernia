// Kein Shebang: wird per `node scripts/playwright-mcp.mjs` gestartet UND von
// test/harness/playwright-mcp.test.ts importiert.
// Launcher für den Playwright-MCP-Server der Agenten (#1283), gestartet aus `.mcp.json`.
// Die Startlogik (Version aus dem Lockfile, lokal bei passender Version, sonst `npx -y <paket>@<exakt>`,
// Ausfallzeile) steckt in `scripts/mcp-launch.mjs`; hier stehen nur die Werte des Servers.
// Der Server läuft im Startverzeichnis der Session (`--output-dir .playwright-mcp` ist relativ dazu).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as launch from "./mcp-launch.mjs";

export const PKG = "@playwright/mcp";
export const BIN = "playwright-mcp";
const NAME = "playwright-mcp";

export const readLockVersion = (root) => launch.readLockVersion(root, PKG);
export const readInstalled = (root) => launch.readInstalled(root, PKG, BIN);
export const planLaunch = ({ lockVersion, installed }) => launch.planLaunch({ pkg: PKG, lockVersion, installed });
export const { statInstallation, installationErsetzt } = launch;
export const exitMeldung = (o) => launch.exitMeldung({ name: NAME, ...o });

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  launch.starte({ name: NAME, pkg: PKG, bin: BIN, root, args: process.argv.slice(2) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
