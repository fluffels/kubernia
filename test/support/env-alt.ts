/* Altnamen der Kern-Umgebungsvariablen (#1824) für Tests: `FACTORY_<NAME>` → `<Projektpräfix>_<NAME>`, ohne das Projektpräfix als Literal. */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";

interface Pc {
  altEnvName(name: string, config: unknown): string | null;
  ladeProjektConfig(opt?: { pruefen?: boolean }): unknown;
}
const pc = rawPc as unknown as Pc;

/** Der Altname zu einem neuen Namen (`FACTORY_DIFF_BASE` → Projektpräfix + `DIFF_BASE`). */
export function altName(neu: string): string {
  const alt = pc.altEnvName(neu, pc.ladeProjektConfig({ pruefen: false }));
  if (alt === null) throw new Error(`kein Altname für ${neu}`);
  return alt;
}

/** Entfernt den neuen und den alten Namen aus einer Umgebung, damit die Umgebung der Maintainerin einen Test nicht verschiebt. */
export function ohneKernEnv(env: Record<string, string | undefined>, ...namen: string[]): void {
  for (const n of namen) {
    delete env[n];
    delete env[altName(n)];
  }
}
