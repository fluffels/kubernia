// Kein Shebang: Bibliothek für board-takt.mjs und naechstes-ticket.mjs (Einstiegsskripte importieren nicht voneinander).
/**
 * Die Spielquote (ADR 0016, F11 aus ADR 0022 in #1729): höchstens 1 Factory-Merge auf `SPIEL_QUOTE` Produkt-Merges. Pur, ohne I/O,
 * damit der Takt (Sammelticket nach vorn) und die Auswahl (welche Seite ist dran) dieselbe Zählung benutzen.
 * Ein Factory-Merge ist ein Commit auf main, dessen Titel ein Issue mit dem Harness-Label der Config referenziert (`istHarnessCommit`); Bots zählen nicht.
 */
import { alsDatum } from "./board-lib.mjs";

/** Spielquote (#1425): höchstens 1 Harness-Ticket auf so viele Spiel-Tickets. */
export const SPIEL_QUOTE = 3;

/**
 * Zahl der Ticket-Merges in einer Commit-Liste von main (`repos/<repo>/commits`): Commits, deren Autor kein Bot ist
 * (Dependabot, github-actions: Login endet auf `[bot]`). Mit `seit` zählen nur Commits ab diesem Zeitpunkt. Pur.
 */
export function zaehleTicketMerges(commits, seit = null) {
  if (!Array.isArray(commits)) throw new Error("commits muss eine Liste sein.");
  const ab = seit === null ? null : alsDatum(seit, "seit").getTime();
  return commits.filter((c) => {
    if (istBot(c)) return false;
    if (ab === null) return true;
    const t = new Date(c?.commit?.committer?.date ?? c?.commit?.author?.date ?? "").getTime();
    return Number.isFinite(t) && t >= ab;
  }).length;
}

const istBot = (c) => /\[bot\]$/i.test(String(c?.author?.login ?? ""));

/**
 * Ist dieser Commit von main ein Harness-Merge? Der Squash-Commit trägt den PR-Titel `feat(<scope>): …`; Scope `harness` markiert
 * Harness-Arbeit (Konvention aus AGENTS.md, in den letzten 14 Tagen 86 von 125 Commits). Bot-Commits sind keine Ticket-Merges. Pur.
 * Seit #1428 zählt das Label: `harnessIssues` ist die Menge der Nummern geschlossener Harness-Issues (90 Tage, lädt `main` ohnehin).
 * Nennt die Titelzeile `#N`-Referenzen, entscheiden sie allein: eine davon in der Menge = Harness, sonst Spiel (so zählen `docs(adr)`
 * und `fix(ci)` zu einem Harness-Issue als Harness, ein `feat(harness)` zu einem Spiel-Issue als Spiel). Ohne Referenz oder ohne Menge
 * (null) bleibt der Rückfall auf den COMMIT-SCOPE `(harness)`. Bewusste Grenze: ein Commit ohne `#N` im Titel (Handarbeit) zählt nur
 * über den Scope; ein Titel mit nur einer PR-Nummer zählt als Spiel (keine PR→Issue-Auflösung, #1460 Z6: von 139 Commits tragen 128 Issue und
 * PR, die 11 mit einer Nummer sind Dependabot, keiner ist ohne; der Scope-Rückfall greift praktisch nie).
 */
export function istHarnessCommit(commit, harnessIssues = null) {
  const kopf = String(commit?.commit?.message ?? "").split(/\r?\n/, 1)[0];
  const refs = [...kopf.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  if (harnessIssues && refs.length > 0) return refs.some((n) => harnessIssues.has(n));
  return /^[a-z]+\(harness\)!?:/i.test(kopf);
}

/**
 * Produkt-Merges seit dem letzten Factory-Merge: `commits` neueste zuerst (wie `repos/<repo>/commits`, nicht sortiert). Bot-Commits
 * zählen nicht und stoppen nicht; beim ersten Harness-Commit (`istHarnessCommit`) ist Schluss. Ohne Factory-Merge in der Liste zählen alle
 * Produkt-Merges (Untergrenze des Fensters). Wirft, wenn `commits` keine Liste ist. Pur.
 */
export function produktMergesSeitFactory(commits, harnessIssues = null) {
  if (!Array.isArray(commits)) throw new Error("commits muss eine Liste sein.");
  let n = 0;
  for (const c of commits) {
    if (istBot(c)) continue;
    if (istHarnessCommit(c, harnessIssues)) break;
    n += 1;
  }
  return n;
}

/**
 * Welche Seite ist dran? `factoryInArbeit` (Nummer eines geclaimten offenen Nicht-Kopf-Factory-Items oder null) lenkt auf Produkt; sonst
 * Factory ab `SPIEL_QUOTE` Produkt-Merges seit dem letzten Factory-Merge, sonst Produkt. Liefert `{ seite, grund }`. Wirft bei einer
 * `produktMerges`, die keine ganze Zahl ≥ 0 ist (bei `factoryInArbeit` darf sie null sein). Pur.
 */
export function entscheideSeite({ produktMerges, factoryInArbeit = null }) {
  if (factoryInArbeit !== null && factoryInArbeit !== undefined) return { seite: "produkt", grund: `Factory in Arbeit (#${factoryInArbeit})` };
  if (!Number.isInteger(produktMerges) || produktMerges < 0) throw new Error(`produktMerges muss eine ganze Zahl ≥ 0 sein, war ${String(produktMerges)}`);
  const seite = produktMerges >= SPIEL_QUOTE ? "factory" : "produkt";
  return { seite, grund: `${produktMerges} Produkt-Merges seit dem letzten Factory-Merge (Spielquote 1:${SPIEL_QUOTE})` };
}
