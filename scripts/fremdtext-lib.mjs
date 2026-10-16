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

/** `gh api --paginate --slurp` liefert eine Liste von Seiten; flach machen (kein Array: leere Liste). */
export function flach(slurped) {
  return Array.isArray(slurped) ? slurped.flat() : [];
}

/**
 * Alle Kommentare eines Issues/PRs (paginiert, sonst nur die ersten 30) als flache Liste. `json(args)` führt `gh` mit den Argumenten aus und liefert
 * geparstes JSON (injiziert: die Lib bleibt ohne Importe); ein Fehler wirft weiter. `repo` ist `{owner}/{repo}` (gh setzt das Repo selbst ein) oder `owner/name`.
 */
export function issueKommentare(nr, json, repo = "{owner}/{repo}") {
  const seiten = json(["api", "--paginate", "--slurp", `repos/${repo}/issues/${nr}/comments?per_page=100`]);
  return flach(seiten);
}

const labelName = (l) => (typeof l === "string" ? l : l?.name);

/**
 * Die eine Fremdeingang-Entscheidung (Autor nicht vertraut ODER Fremdeingang-Label), gemeinsam für `fremdtext`, `naechstes-ticket` und `spezifikation`.
 * `issue`: `{ user, labels }` (labels als Strings oder `{name}`). Liefert `{ fremdeingang, grund, label }`; `grund` ist `""`, wenn vertraut.
 */
export function istFremdeingang(issue, owner) {
  const autorVertraut = istVertraut(issue?.user, owner);
  const label = (issue?.labels ?? []).map(labelName).find((n) => FREMDEINGANG_LABELS.includes(n));
  const login = typeof issue?.user?.login === "string" && issue.user.login !== "" ? issue.user.login : "unbekannt";
  const grund = !autorVertraut ? `Autor @${login} ist nicht vertraut` : label !== undefined ? `Label ${label} (Text Dritter über das Forum)` : "";
  return { fremdeingang: !autorVertraut || label !== undefined, grund, label };
}
