// Blatt-Modul ohne Importe (#101): die Form `owner/name` eines Repos, ihre Prüfung und Zerlegung. Einzige Quelle; `projekt-config-lib` und
// `spezifikation-lib` führen sie weiter, `gh-cli`, `inbox-lib`, `sync-stand-lib` und `claims-pruefen` importieren direkt (kein Zyklus über die Config-Lib).

/** Die Form `owner/name` eines Repos (SSOT): GitHub-Zeichen `[\w.-]` je Teil, genau ein Schrägstrich. Streng, weil Owner/Name ungeprüft in GraphQL-Texte gehen. */
export const REPO_FORM = /^([\w.-]+)\/([\w.-]+)$/;

/** Pur: hat `repo` genau die Form `owner/name`? Ein Nicht-String nie. */
export const istRepoForm = (repo) => typeof repo === "string" && REPO_FORM.test(repo);

/** Pur: zerlegt `owner/name` in `{ owner, name }`; wirft mit Fix-Zeile, wenn `repo` nicht genau diese Form hat (kein stiller Standardwert, #1745). */
export function zerlegeRepo(repo) {
  const m = typeof repo === "string" ? REPO_FORM.exec(repo) : null;
  if (!m) throw new Error("repo fehlt oder hat nicht die Form owner/name\nFix: repo als owner/name angeben (in der Projekt-Config der Schlüssel repo in .factory/projekt.json)");
  return { owner: m[1], name: m[2] };
}

/** Pur: sind zwei Repo-Angaben (`owner/name`) dasselbe Repo? GitHub unterscheidet Groß- und Kleinschreibung nicht; ein Nicht-String ist nie gleich. */
export const gleichesRepo = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
