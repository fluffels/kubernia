// Einstieg der Projekt-Config (#1611): `node scripts/projekt-config.mjs [--config <pfad>] <schluessel.pfad>`.
// Die Logik steht in der Lib projekt-config-lib.mjs (Einstiegsskripte importieren nicht voneinander, Lib ohne Direktaufruf-Guard).
import { cli } from "./projekt-config-lib.mjs";

process.exitCode = cli(process.argv.slice(2));
