// Einstieg des Gate-Befehls (factory#182): `node scripts/gate-befehl.mjs <name> [--zeigen]`.
// Die Logik steht in gate-befehl-lib.mjs (Einstiegsskripte importieren nicht voneinander, Lib ohne Direktaufruf-Guard).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cli } from "./gate-befehl-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";

process.exitCode = cli(process.argv.slice(2), { lade: () => ladeProjektConfig(), spawn: spawnSync, cwd: fileURLToPath(new URL("../", import.meta.url)) });
