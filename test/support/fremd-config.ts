/* Fremd-Config der Kern-Tests (#1876): Projektwerte kommen aus einer Config mit fremden Präfixen (`ZZ-`), nicht aus Literalen.
 * `FREMD` wird dem getesteten Code per `deps.config` injiziert und liefert zugleich die Erwartung; nur ein echter
 * Prozess-Start liest die Projekt-Config selbst (`projektConfig()`). */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/projekt-config-lib.mjs";

export interface ProjektConfig {
  repo: string;
  boards: { rolle: string; besitzer: string; besitzerTyp: string; nummer: number; projectId: string; statusFeldId: number; statusFeldNodeId: string; todoOptionId: string }[];
  praefixe: { commitZeile: string; branch: string; worktree: string };
  labels: { harness: string; festgefahren: string; forum: string; dependabotInbox: string };
  agenten: { planer: string; umsetzer: string; lens: string; gruppe: string; ticketSkill: string };
  skills: { abschluss: string };
  projektliterale?: Record<string, string>;
}

const lib = raw as unknown as { ladeProjektConfig(opt?: { pfad?: string }): ProjektConfig; repoName(config: { repo: string }): string };

export const FREMD_CONFIG_PFAD = "test/fixtures/projekt-fremd.json";

/** Die Fremd-Config (Schema wird beim Laden geprüft). */
export const FREMD: ProjektConfig = lib.ladeProjektConfig({ pfad: FREMD_CONFIG_PFAD });

/** Die echte Projekt-Config, nur für Tests, die einen Kindprozess starten (der liest sie selbst). */
export const projektConfig = (): ProjektConfig => lib.ladeProjektConfig();

/** Der Repo-Name einer Config (der Teil hinter dem Owner), etwa als Ergebnisschlüssel. */
export const repoName = (config: { repo: string }): string => lib.repoName(config);

/** Der Owner der Fremd-Config (`zz-org`): Login und Besitzer in Tests mit injizierter Config. */
export const FREMD_OWNER = FREMD.repo.split("/")[0] ?? "";
