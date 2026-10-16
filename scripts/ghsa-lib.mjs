/**
 * GHSA-Bausteine der Sicherheits-Skripte (`audit-einordnung.mjs`, `codescanning-inbox.mjs`): GHSA-IDs aus Text lesen und festhalten, welche
 * Advisories schon eingeordnet sind (offene Audit-Zeilen vertrauter Autoren, Wiedervorlagen `audit-<ghsa>`, Titel vertrauter Security-Tickets).
 * Alles pur, getestet über test/audit-einordnung.test.ts.
 */
import { istVertraut } from "./fremdtext-lib.mjs";

export const ALARM_PRAEFIX = "🔒 Security:";
const GHSA_MUSTER = /GHSA(?:-[a-z0-9]{4}){3}/gi;

/** Alle GHSA-IDs eines Textes, kleingeschrieben. Pur. */
export const ghsaIn = (text) => (String(text ?? "").match(GHSA_MUSTER) ?? []).map((g) => g.toLowerCase());

/** Bodies der Kommentare vertrauter Autoren (Owner, github-actions[bot]); eine `- [ ] Audit:`-Zeile eines Fremden darf keinen Alarm unterdrücken (#1433). Pur. */
export function vertrauteBodies(kommentare, owner) {
  return kommentare.filter((k) => istVertraut(k?.user, owner)).map((k) => String(k.body ?? ""));
}

/** Bekannte GHSA-IDs aus den Quellen: offene Audit-Zeilen in Kommentaren, Wiedervorlagen-Einträge `audit-<ghsa>`, Titel offener Security-Tickets. Pur. */
export function bekannteGhsa({ kommentare, wiedervorlagen, offeneTitel }) {
  const menge = new Set();
  for (const k of kommentare) {
    for (const z of String(k ?? "").split(/\r?\n/)) {
      if (/^\s*[-*]\s+\[ \]\s+Audit:/.test(z)) ghsaIn(z).forEach((g) => menge.add(g));
    }
  }
  for (const e of wiedervorlagen) {
    if (typeof e?.id === "string" && e.id.startsWith("audit-")) ghsaIn(e.id.slice("audit-".length).replace(/^ghsa-/, "GHSA-")).forEach((g) => menge.add(g));
  }
  for (const t of offeneTitel) if (String(t).startsWith(ALARM_PRAEFIX)) ghsaIn(t).forEach((g) => menge.add(g));
  return menge;
}
