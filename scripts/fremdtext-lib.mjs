// Kein Shebang, kein Direktaufruf: Lib für `fremdtext.mjs` und `naechstes-ticket.mjs` (#1579, Konvention #1398: Einstiegsskripte
// importieren nicht voneinander, gemeinsamer Code steht in einer Lib). Die Vertrauensliste des Fremdtext-Gates (#1433) und der gemeinsame Kommentar-Abruf (`issueKommentare`), pur, ohne Importe.

/** REST-Logins vertrauter Bots (zusätzlich zum Repo-Owner); gelten nur mit `type === "Bot"`. */
export const VERTRAUTE_BOTS = Object.freeze(["github-actions[bot]", "dependabot[bot]"]);
/** Labels, die einen Eintrag als Fremdeingang kennzeichnen, egal wer ihn anlegte. */
export const FREMDEINGANG_LABELS = Object.freeze(["forum"]);

/** Ist der REST-User `{login, type}` vertraut? Alles Unbekannte, auch `null`, ist fremd. */
export function istVertraut(user, owner) {
  if (!user || typeof user.login !== "string" || user.login === "") return false;
  if (typeof owner === "string" && owner !== "" && user.login.toLowerCase() === owner.toLowerCase()) return true;
  return user.type === "Bot" && VERTRAUTE_BOTS.includes(user.login);
}

/**
 * Alle Kommentare eines Issues/PRs (paginiert, sonst nur die ersten 30) als flache Liste. `json(args)` führt `gh` mit den Argumenten aus und liefert
 * geparstes JSON (injiziert: die Lib bleibt ohne Importe); ein Fehler wirft weiter. `repo` ist `{owner}/{repo}` (gh setzt das Repo selbst ein) oder `owner/name`.
 */
export function issueKommentare(nr, json, repo = "{owner}/{repo}") {
  const seiten = json(["api", "--paginate", "--slurp", `repos/${repo}/issues/${nr}/comments?per_page=100`]);
  return Array.isArray(seiten) ? seiten.flat() : [];
}
