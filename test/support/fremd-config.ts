/* Fremd-Config der Kern-Tests (#1876): Projektwerte kommen aus einer Config mit fremden Präfixen (`ZZ-`), nicht aus Literalen.
 * `FREMD` wird dem getesteten Code per `deps.config` injiziert und liefert zugleich die Erwartung; nur ein echter
 * Prozess-Start (Kindprozess) oder ein Standardpfad-Test im selben Prozess (ohne injizierte Config) liest die
 * Projekt-Config selbst (`projektConfig()`). */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRoh from "../../scripts/ticket-namen.mjs";

/** Ausschnitt der Projekt-Config (nur die Gruppen, die Tests lesen), nicht das volle Schema. */
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

/** Die echte Projekt-Config: für Tests, die einen Kindprozess starten (der liest sie selbst), und für Standardpfad-Tests im selben Prozess (Rückfall ohne injizierte Config). */
export const projektConfig = (): ProjektConfig => lib.ladeProjektConfig();

/** Der Repo-Name einer Config (der Teil hinter dem Owner), etwa als Ergebnisschlüssel. */
export const repoName = (config: { repo: string }): string => lib.repoName(config);

/** Der Owner der Fremd-Config (`zz-org`): Login und Besitzer in Tests mit injizierter Config. */
export const FREMD_OWNER = FREMD.repo.split("/")[0] ?? "";

/** Die Ticket-Namen (Präfixe, Agenten) der Fremd-Config, wie `ticketNamen(config)` sie den Skripten liefert (opak, wird nur durchgereicht). */
export const FREMD_NAMEN: object = (namenRoh as unknown as { ticketNamen: (c: unknown) => object }).ticketNamen(FREMD);
