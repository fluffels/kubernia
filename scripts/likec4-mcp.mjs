// Kein Shebang: wird per `node scripts/likec4-mcp.mjs` gestartet UND von test/harness/likec4-mcp.test.ts importiert.
// Launcher für den LikeC4-MCP-Server (#1422): Abfragewerkzeug für das Architekturmodell `docs/architektur/`.
// Startlogik und Version aus dem Lockfile: `scripts/mcp-launch.mjs` (`launcherFuer`). Der Server liest den Ordner des
// Checkouts, in dem die Session gestartet wurde (meist der Haupt-Checkout), nicht den eines Branch-Worktrees.
// Er ist nie Gate-Quelle (ADR 0017); `apply-semantic-layout` schreibt Layout und steht in settings.json auf `ask`.
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { dirname, join } from "node:path";
import { launcherFuer } from "./mcp-launch.mjs";

const launcher = launcherFuer({ name: "likec4-mcp", pkg: "likec4", bin: "likec4" });
export const { PKG, BIN, NAME, readLockVersion, readInstalled, planLaunch, exitMeldung, npxHinweis } = launcher;
/** Modellordner, relativ zum Repo-Root (der Server startet mit `cwd: root`). */
export const WORKSPACE = "docs/architektur";

/** Argumente für `likec4`: stdio-Server auf dem Modellordner, Zusatzargumente des Aufrufers hinten dran. Pur. */
export const serverArgs = (extra = []) => ["mcp", "--stdio", WORKSPACE, ...extra];

if (istDirektaufruf(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  launcher.starte({ root, args: serverArgs(process.argv.slice(2)), cwd: root });
}
