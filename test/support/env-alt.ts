/* Altnamen der Kern-Umgebungsvariablen (#1824) für Tests: `FACTORY_<NAME>` → `<Projektpräfix>_<NAME>`, ohne das Projektpräfix als Literal. */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";

interface Pc {
  altEnvPraefix(config: unknown): string | null;
  ladeProjektConfig(opt?: { pruefen?: boolean }): unknown;
}
const pc = rawPc as unknown as Pc;

/** Der Altname zu einem neuen Namen (`FACTORY_DIFF_BASE` → Projektpräfix + `DIFF_BASE`). */
export function altName(neu: string): string {
  const alt = pc.altEnvPraefix(pc.ladeProjektConfig({ pruefen: false }));
  if (alt === null || !neu.startsWith("FACTORY_")) throw new Error(`kein Altname für ${neu}`);
  return alt + neu.slice("FACTORY_".length);
}

/** Entfernt den neuen und den alten Namen aus einer Umgebung, damit die Umgebung der Maintainerin einen Test nicht verschiebt. */
export function ohneKernEnv(env: Record<string, string | undefined>, ...namen: string[]): void {
  for (const n of namen) {
    delete env[n];
    delete env[altName(n)];
  }
}
