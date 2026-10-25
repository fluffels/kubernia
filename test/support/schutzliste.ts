/* Schutzlisten-Hilfe der Kern-Tests (#1921): „Pfad X ist Leitplanke nur durch seinen eigenen Eintrag“ gegen die echte Liste
 * (`.github/protected-paths.json`), mit dem Matcher aus `scripts/besitz-extraktion.mjs`. */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as abschlussRoh from "../../scripts/umsetzer-abschluss.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as extraktionRoh from "../../scripts/besitz-extraktion.mjs";

const lib = { ...abschlussRoh, ...extraktionRoh } as unknown as { leitplankenMuster: () => string[]; trifftLeitplanke: (pfad: string, muster: string[]) => boolean };

/** Für `pfad` (repo-relativ, ohne führenden Slash): trifft ihn die echte Liste, und trifft sie ihn ohne den Eintrag `/<pfad>` nicht mehr. */
export function nurDurchEigenenEintrag(pfad: string): { trifftEchte: boolean; trifftOhneEintrag: boolean } {
  const muster = lib.leitplankenMuster();
  return { trifftEchte: lib.trifftLeitplanke(pfad, muster), trifftOhneEintrag: lib.trifftLeitplanke(pfad, muster.filter((m) => m !== `/${pfad}`)) };
}
