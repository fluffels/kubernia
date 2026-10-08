// Kein Shebang: wird von check-festgefahren.mjs, token-baseline.mjs und lauf-ergebnis.mjs importiert (und getestet).
/**
 * Rote CI-Läufe auf PRs, EINE Abfrage-Logik für alle drei Zähler (Festgefahren-Wächter, Messskript, Ergebnis je
 * Ticket-Lauf; #1398): immer paginiert (`--paginate`, sonst liefert `gh api` nur 30 Treffer), optional mit Branch- und
 * Zeitfilter, mit hartem Abbruch an der API-Kappung. Nur Node-Builtins; `runGh` ist injizierbar (Test).
 *
 * Grenzen: (1) GitHub liefert für gefilterte Läufe höchstens 1000 Treffer; erreicht die Abfrage diese Zahl, wirft sie
 * (unvollständige Daten sind nicht „weniger Fehlschläge“). (2) `status=failure` bewertet die `conclusion` des
 * neuesten Versuchs: ein Rerun überschreibt sie. Ein Commit, der rot war und im Rerun grün wurde, taucht nicht auf;
 * für den Festgefahren-Wächter und die CI-Fix-Runden ist das gewollt (zählt, was rot BLIEB). (3) Der Datumsfilter
 * `created=>=` wirkt nur tagesgenau; das exakte Zeitfenster eines PRs filtert `distinctRoteShas`.
 */

import { ghText } from "./gh-cli.mjs";

/** Der gemeinsame `gh`-Runner (`gh <args>` → stdout als Text): Default aller Zähler, `runGh` überschreibt ihn im Test. */
export { ghText };

/** Ab dieser Trefferzahl gilt die Liste als von der API abgeschnitten. */
export const MAX_TREFFER = 1000;

/** `--jq`-Ausdruck: je Lauf eine TSV-Zeile `head_branch ⇥ head_sha ⇥ created_at`. */
export const JQ_LAEUFE = ".workflow_runs[] | [.head_branch,.head_sha,.created_at] | @tsv";

/**
 * API-Pfad der roten PR-Läufe von `ci.yml`. `seit` (ISO-Zeitstempel oder Datum) wird auf den Tag gekürzt und als
 * `created=>=<tag>` URL-kodiert angehängt; `repo` ist `owner/name` (Default: der Platzhalter von `gh api`).
 */
export function roteLaeufePfad({ branch, seit, repo = "{owner}/{repo}" } = {}) {
  const q = ["status=failure", "event=pull_request", "per_page=100"];
  if (branch) q.push(`branch=${encodeURIComponent(branch)}`);
  if (seit) q.push(`created=${encodeURIComponent(`>=${String(seit).slice(0, 10)}`)}`);
  return `repos/${repo}/actions/workflows/ci.yml/runs?${q.join("&")}`;
}

/** TSV (`JQ_LAEUFE`) → `[{ branch, sha, createdAt }]`. Pure; Leerzeilen und CRLF werden toleriert. */
export function parseLaeufe(tsv) {
  return String(tsv)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [branch, sha, createdAt] = l.split("\t");
      return { branch, sha, createdAt };
    });
}

/** Holt die roten Läufe über `runGh(args) → stdout`. Wirft bei der API-Kappung (≥ 1000 Treffer). Ohne `runGh` gilt `ghText`. */
export function holeRoteLaeufe(runGh, opts = {}) {
  const laeufe = parseLaeufe((runGh ?? ghText)(["api", "--paginate", roteLaeufePfad(opts), "--jq", JQ_LAEUFE]));
  if (laeufe.length >= MAX_TREFFER) {
    throw new Error(`rote CI-Läufe bei ${MAX_TREFFER} abgeschnitten (GitHub-Kappung): Zeitfenster oder Branch einschränken.`);
  }
  return laeufe;
}

/**
 * Die distinct Head-SHAs der Läufe, deren `createdAt` im Fenster `[von, bis]` liegt (beide inklusive, jede Grenze
 * optional). Ein Rerun hat dieselbe SHA und zählt einmal. Pure.
 */
export function distinctRoteShas(laeufe, { von, bis } = {}) {
  const t0 = von ? new Date(von).getTime() : -Infinity;
  const t1 = bis ? new Date(bis).getTime() : Infinity;
  const shas = laeufe.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= t0 && t <= t1;
  }).map((l) => l.sha);
  return [...new Set(shas)];
}

/**
 * Rote Commits EINES PRs: distinct Head-SHAs roter Läufe auf seinem Branch zwischen Erstellung und Merge (`mergedAt`
 * fehlt: offen, keine obere Grenze). Läufe eines früheren PRs auf einem wiederverwendeten Branch zählen nicht. Die
 * Verdrahtung von Festgefahren-Wächter und Messskript, injizierbar (`runGh`) und damit testbar.
 */
export function zaehleRoteCommits(runGh, { branch, createdAt, mergedAt, repo }) {
  const laeufe = holeRoteLaeufe(runGh, { branch, seit: createdAt, repo });
  return distinctRoteShas(laeufe, { von: createdAt, bis: mergedAt ?? undefined }).length;
}
