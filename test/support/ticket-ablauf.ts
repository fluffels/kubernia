/* Der gemeinsame Ticket-Ablauf der Ticket-Skills (#1806): eine Datei im Kern mit Platzhaltern `<agenten.…>`,
 * die der Hauptchat aus `.factory/projekt.json` einsetzt. Tests, die den Ablauftext prüfen, lesen ihn hier mit eingesetzten Werten. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const TICKET_ABLAUF = ".claude/skills/factory/ablauf.md";

/** Ersetzt `<agenten.schluessel>` durch den Wert aus der Projekt-Config; ein unbekannter Schlüssel ist ein Fehler. */
export function setzeAgentenWerte(text: string, agenten: Record<string, string>): string {
  return text.replace(/<agenten\.(\w+)>/g, (_m, key: string) => {
    const wert = agenten[key];
    if (wert === undefined) throw new Error(`Unbekannter Platzhalter <agenten.${key}> im Ticket-Ablauf`);
    return wert;
  });
}

/** Der Ablauftext mit den Agentennamen aus `.factory/projekt.json`. */
export function liesTicketAblauf(): string {
  const cfg = JSON.parse(readFileSync(ROOT + ".factory/projekt.json", "utf8")) as { agenten: Record<string, string> };
  return setzeAgentenWerte(readFileSync(ROOT + TICKET_ABLAUF, "utf8"), cfg.agenten);
}
