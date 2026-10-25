/* Die Quellwurzel (`struktur.quelle`) einer Projekt-Config als typisierte Testhilfe: Tests, die den Quellordner brauchen,
 * lesen ihn von hier statt `strukturAus(ladeProjektConfig())` je Datei zu casten. */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/projekt-config-lib.mjs";
import { projektConfig } from "./fremd-config";

const lib = raw as unknown as { strukturAus(config: unknown): { quelle: string } };

/** `struktur.quelle` der übergebenen Config (wirft wie `strukturAus` ohne gültigen Block); ohne Angabe die echte Projekt-Config. */
export const quelleAusConfig = (config: unknown = projektConfig()): string => lib.strukturAus(config).quelle;
