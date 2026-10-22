/**
 * Die echte Sprach-Config des Projekts (`sprache` in .factory/projekt.json, #1711) als typisierte Testhilfe: Tests, die das
 * Spezifikations-Gate oder den Umlaut-Wächter über eine injizierte Config fahren, ziehen ihr Vokabular von hier statt es nachzubauen.
 */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/projekt-config-lib.mjs";

type Block = Record<string, unknown>;
const lib = raw as unknown as {
  ladeProjektConfig: () => Block;
  spracheAus: (config: unknown) => { umschrift: string[]; spezifikation: Block };
  umschriftAus: (config: unknown) => string[];
};

/** Die ganze Projekt-Config. */
export const echteConfig = (): Block => lib.ladeProjektConfig();
/** Der Block `sprache` (umschrift und spezifikation). */
export const echteSprache = (): Block => lib.spracheAus(lib.ladeProjektConfig());
/** Der Block `sprache.spezifikation`, so wie ihn das Spezifikations-Gate bekommt. */
export const echteSpezifikation = (): Block => lib.spracheAus(lib.ladeProjektConfig()).spezifikation;
/** `umschriftAus` der Config-Lib (wirft ohne nicht-leere Liste). */
export const umschriftAus = (config: unknown): string[] => lib.umschriftAus(config);
