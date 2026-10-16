// Kein Shebang: wird per `node scripts/likec4-mcp.mjs` gestartet UND von test/harness/likec4-mcp.test.ts importiert.
// Launcher für den LikeC4-MCP-Server (#1422): Abfragewerkzeug für das Architekturmodell `docs/architektur/`.
// Startlogik und Version aus dem Lockfile: `scripts/mcp-launch.mjs`. Der Server liest den Ordner des
// Checkouts, in dem die Session gestartet wurde (meist der Haupt-Checkout), nicht den eines Branch-Worktrees.
// Er ist nie Gate-Quelle (ADR 0017); `apply-semantic-layout` schreibt Layout und steht in settings.json auf `ask`.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as launch from "./mcp-launch.mjs";

export const PKG = "likec4";
export const BIN = "likec4";
export const NAME = "likec4-mcp";
/** Modellordner, relativ zum Repo-Root (der Server startet mit `cwd: root`). */
export const WORKSPACE = "docs/architektur";

/** Argumente für `likec4`: stdio-Server auf dem Modellordner, Zusatzargumente des Aufrufers hinten dran. Pur. */
export const serverArgs = (extra = []) => ["mcp", "--stdio", WORKSPACE, ...extra];

export const readLockVersion = (root) => launch.readLockVersion(root, PKG);
export const readInstalled = (root) => launch.readInstalled(root, PKG, BIN);
export const planLaunch = ({ lockVersion, installed }) => launch.planLaunch({ pkg: PKG, lockVersion, installed });
export const exitMeldung = (o) => launch.exitMeldung({ name: NAME, ...o });
export const npxHinweis = (spec) => launch.npxHinweis(NAME, spec);

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  launch.starte({ name: NAME, pkg: PKG, bin: BIN, root, args: serverArgs(process.argv.slice(2)), cwd: root });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
