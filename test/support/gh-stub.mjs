// Test-Naht (#1860): mit `NODE_OPTIONS=--import <diese Datei>` beantwortet ein gestarteter Node-Prozess `gh api`-Aufrufe aus der
// Umgebung statt aus dem Netz (ein Fake-gh auf dem PATH scheitert unter Windows an `.cmd`-Shims). Alle anderen Programme laufen echt.
//   STUB_ISSUE    JSON des Issues, das `gh api repos/…/issues/<nr>` liefert
//   STUB_LEER     "1": jeder andere `gh`-Aufruf liefert `[]`, sonst wirft er
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const echt = cp.execFileSync;
cp.execFileSync = (cmd, args, opts) => {
  if (cmd !== "gh") return echt(cmd, args, opts);
  const ziel = String((args ?? []).find((a) => /^repos\//.test(String(a))) ?? "");
  if (/\/issues\/\d+$/.test(ziel) && process.env.STUB_ISSUE) return process.env.STUB_ISSUE;
  if (process.env.STUB_LEER === "1") return "[]";
  throw new Error(`gh gestubbt, kein Netz: ${(args ?? []).join(" ")}`);
};
syncBuiltinESMExports();
