/**
 * Release-Planung über GitHub-Milestones (factory#194), pur und nur mit Builtins.
 * `naechstes-ticket.mjs` zieht die Items des frühesten offenen Milestones vor, `tag-takt.mjs` wertet seit dem letzten Tag geschlossene Milestones als Auslöser.
 * Unerwartete Formen gelten als „ohne Milestone“ (Auswahl) bzw. brechen laut ab (Tag-Takt-Liste, dort fängt der Aufrufer fail-open).
 */

/** `content.milestone` eines Board-Items → `{ nummer, titel, state, faellig }` (`faellig`: ISO-String oder null) oder null bei fehlender oder unerwarteter Form. */
export function milestoneAus(roh) {
  if (!roh || typeof roh !== "object") return null;
  if (!Number.isInteger(roh.number) || typeof roh.title !== "string" || (roh.state !== "open" && roh.state !== "closed")) return null;
  return { nummer: roh.number, titel: roh.title, state: roh.state, faellig: typeof roh.due_on === "string" && roh.due_on !== "" ? roh.due_on : null };
}

const zeit = (iso) => Date.parse(iso);

/** Fälligkeit aufsteigend, ohne Fälligkeit dahinter, Gleichstand nach Nummer. */
function vergleiche(a, b) {
  if ((a.faellig === null) !== (b.faellig === null)) return a.faellig === null ? 1 : -1;
  if (a.faellig !== null && zeit(a.faellig) !== zeit(b.faellig)) return zeit(a.faellig) - zeit(b.faellig);
  return a.nummer - b.nummer;
}

/** Der früheste offene Milestone aus normalisierten Milestones (`milestoneAus`); null ohne offenen. */
export function fruehesterMilestone(milestones) {
  const offen = (Array.isArray(milestones) ? milestones : []).filter((m) => m && m.state === "open" && Number.isInteger(m.nummer));
  return offen.length === 0 ? null : [...offen].sort(vergleiche)[0];
}

/** Titel für Hinweise und Ticket-Texte: Steuerzeichen und Zeilenumbrüche werden zu Leerzeichen, auf 80 Zeichen gekürzt. */
export function titelBereinigt(titel) {
  const ohneSteuer = [...String(titel ?? "")].map((c) => (c.charCodeAt(0) < 32 || c === "\u007f" ? " " : c)).join("");
  const t = ohneSteuer.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

/** Hinweiszeile der Auswahl: `Milestone-Vorrang: „<titel>“ (fällig <YYYY-MM-DD> | ohne Fälligkeit)`. */
export function vorrangHinweis(m) {
  return `Milestone-Vorrang: „${titelBereinigt(m.titel)}“ (${m.faellig === null ? "ohne Fälligkeit" : `fällig ${m.faellig.slice(0, 10)}`})`;
}

/** `gh api --paginate --slurp …/milestones?state=closed` → `[{ nummer, titel, closedAt }]` (nur mit `closed_at`; ein wieder geöffneter trägt keins). Wirft bei falscher Form. */
export function geschlosseneMilestones(pages) {
  if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) throw new Error("Unerwartete Antwortform der Milestones (keine Liste von Seiten).");
  return pages
    .flat()
    .filter((m) => m && typeof m.closed_at === "string" && m.closed_at !== "" && Number.isInteger(m.number))
    .map((m) => ({ nummer: m.number, titel: typeof m.title === "string" ? m.title : "", closedAt: m.closed_at }));
}

/** Die Milestones, die nach `seitIso` geschlossen wurden (echt später), nach Schließzeit sortiert. Ein nicht parsebares `seitIso` liefert eine leere Liste. */
export function geschlossenSeit(liste, seitIso) {
  const seit = zeit(seitIso);
  if (Number.isNaN(seit)) return [];
  return liste.filter((m) => zeit(m.closedAt) > seit).sort((a, b) => zeit(a.closedAt) - zeit(b.closedAt) || a.nummer - b.nummer);
}
