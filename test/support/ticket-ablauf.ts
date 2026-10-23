/* Der gemeinsame Ticket-Ablauf der Ticket-Skills (#1806): eine Datei im Kern mit Platzhaltern `<gruppe.schlüssel>`
 * (Gruppen `agenten`, `labels`, `praefixe`, `skills`), deren Werte im Projektwert-Block derselben Datei stehen (#1747). Tests, die einen Kern-Text
 * (Ablauf, Agenten-Definition, Skill) prüfen, lesen ihn hier mit eingesetzten Werten aus `.factory/projekt.json`. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as projektRaw from "../../scripts/projekt-config-lib.mjs";
const ladeProjektConfig = (projektRaw as unknown as { ladeProjektConfig: () => unknown }).ladeProjektConfig;
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as besitzRaw from "../../scripts/besitz-lib.mjs";
const platzhalterMuster = (besitzRaw as unknown as { platzhalterMuster: () => RegExp }).platzhalterMuster;

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const TICKET_ABLAUF = ".agents/skills/factory/ablauf.md";

type Gruppen = Record<string, Record<string, string>>;

/** Ersetzt `<gruppe.schluessel>` (Gruppen `agenten`, `labels`, `praefixe`, `skills`) durch den Wert aus der Projekt-Config; ein unbekannter Schlüssel ist ein Fehler. */
export function setzeProjektwerte(text: string, cfg: Gruppen): string {
  return text.replace(platzhalterMuster(), (_m, gruppe: string, key: string) => {
    const wert = cfg[gruppe]?.[key];
    if (wert === undefined) throw new Error(`Unbekannter Platzhalter <${gruppe}.${key}>`);
    return wert;
  });
}

/** Wie `setzeProjektwerte`, nur für die Gruppe `agenten`. */
export function setzeAgentenWerte(text: string, agenten: Record<string, string>): string {
  return setzeProjektwerte(text, { agenten, labels: {}, praefixe: {} });
}

/** Eine Projektdatei (Pfad relativ zur Wurzel, Schrägstrich-Form) mit eingesetzten Projektwerten. */
export function liesMitProjektwerten(rel: string): string {
  return setzeProjektwerte(readFileSync(ROOT + rel, "utf8"), ladeProjektConfig() as Gruppen);
}

/** Der Ablauftext mit den Werten aus `.factory/projekt.json`. */
export function liesTicketAblauf(): string {
  return liesMitProjektwerten(TICKET_ABLAUF);
}
