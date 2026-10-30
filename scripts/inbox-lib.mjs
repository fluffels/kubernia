/**
 * Gemeinsame Bausteine der Inbox-Skripte (`audit-einordnung.mjs`, `codescanning-inbox.mjs`, `secret-inbox.mjs`, `wiedervorlage.mjs`): Ticket ganz oben im Board
 * einsortieren, das Sammelticket für Befundzeilen wählen, Zeilen dort posten und Titel offener Tickets nur vertrauter Autoren lesen.
 * `vertrauteIssues`/`offeneTitel` sind pur und getestet (test/inbox-lib.test.ts); der Rest ruft `gh` bzw. `board-place.mjs`.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ghJson, ghText, tokenFuerZiel } from "./gh-cli.mjs";
import { REPO, SAMMELTICKET_TITEL, kandidatenSammelticket, loadOpenIssuePages, normalizeOffene, waehleBestaetigtes, zielRepo } from "./board-lib.mjs";
import { issueKommentare, istVertraut } from "./fremdtext-lib.mjs";
import { zerlegeRepo } from "./projekt-config-lib.mjs";

/** Das Ziel-Repo der Harness-Befunde (#76): das Repo, dessen Issues das Factory-Board führt (`boards[].repo`, sonst das eigene Repo). Dort liegt das Harness-Sammelticket. */
export const ZIEL = zielRepo("factory");

const BOARD_PLACE = fileURLToPath(new URL("./board-place.mjs", import.meta.url));

/**
 * Offene Issues (REST-Seiten aus `gh api --paginate --slurp`) ohne PRs, deren Autor vertraut ist (`istVertraut`: Owner oder github-actions[bot]).
 * Ein Fremder darf mit einem passenden Titel weder einen Alarm noch das Spitzen-Ticket vortäuschen (#1433). Pur.
 */
export function vertrauteIssues(seiten, owner) {
  if (!Array.isArray(seiten)) throw new Error("Unerwartete Antwortform der offenen Issues (keine Liste von Seiten).");
  return seiten
    .flat()
    .filter((i) => i && !i.pull_request && typeof i.title === "string" && istVertraut(i.user ?? null, owner));
}

/** Titel der offenen Issues vertrauter Autoren. Pur. */
export const offeneTitel = (seiten, owner) => vertrauteIssues(seiten, owner).map((i) => i.title);

/**
 * Sortiert Ticket `nr` per `board-place.mjs --notfall <art> --top` ganz oben ein; mit `repo` (#78) steht das Ticket in diesem Ziel-Repo (`--repo`),
 * sonst im eigenen. Wirft ohne Token und bei einem Fehler des Skripts. `exec` ist die Test-Naht des Prozessaufrufs.
 */
export function platziereOben(nr, art, token = process.env.PROJECT_TOKEN, repo = undefined, exec = execFileSync) {
  if (!token) throw new Error("PROJECT_TOKEN fehlt: das Ticket steht nicht oben im Board.");
  exec(process.execPath, [BOARD_PLACE, ...(repo ? ["--repo", repo] : []), "--notfall", art, "--top", String(nr)], { env: { ...process.env, GH_TOKEN: token }, stdio: "inherit" });
}

/** Das jüngste offene, ungeclaimte Harness-Sammelticket in `repo` (Standard: das Ziel-Repo; per Einzelabruf bestätigt, Vertrauen über dessen Owner) oder null. `offene` aus `normalizeOffene`. */
export const waehleSammelticket = (offene, repo = ZIEL, api = (args) => ghJson(args, { token: zielToken(repo) })) =>
  waehleBestaetigtes(kandidatenSammelticket(offene, SAMMELTICKET_TITEL), (nr) => api(["api", `repos/${repo}/issues/${nr}`]), zerlegeRepo(repo).owner);

/** Token für Aufrufe gegen `repo` (Standard: das Ziel-Repo): `PROJECT_TOKEN` bei einem fremden Ziel-Repo, sonst `undefined` (Standard-`GH_TOKEN`), siehe `tokenFuerZiel`. */
export const zielToken = (repo = ZIEL, env = process.env) => tokenFuerZiel({ ziel: repo, eigenes: REPO, env });

/** Postet `text` als Kommentar unter Issue `nr` im Repo `repo` (Standard: das Ziel-Repo) mit `token` (Standard: `zielToken(repo)`). `exec` ist die Test-Naht von `ghText`. */
export const postZeilen = (nr, text, repo = ZIEL, token = zielToken(repo), exec = undefined) =>
  ghText(["api", `repos/${repo}/issues/${nr}/comments`, "-f", `body=${text}`], { token, ...(exec ? { exec } : {}) });

/** Nummern der offenen Harness-Sammeltickets (exakter Titel, auch geclaimte) aus `normalizeOffene`. Pur. */
export const sammelticketNummern = (offene) => offene.filter((i) => i.titel === SAMMELTICKET_TITEL).map((i) => i.number);

/**
 * Der gemeinsame Abruf der Inbox-Skripte: `{ rohe, offene, kommentare, owner }` = offene Issues des Ziel-Repos (REST-Seiten, `loadOpenIssuePages`), deren Normalform,
 * die Kommentare (`[{ user, body }]`, ungefiltert) aller offenen Harness-Sammeltickets dort und der Owner des Ziel-Repos (für `istVertraut`). Das Vertrauensfilter wendet der Aufrufer an (`vertrauteBodies`,
 * `istBekannt`). `io` ist für Tests austauschbar (Default: echtes `gh`).
 */
export function ladeSammelKontext(io = {}) {
  const token = "token" in io ? io.token : zielToken();
  const ladeOffene = io.ladeOffene ?? ((t) => loadOpenIssuePages(ZIEL, { token: t }));
  const ladeKommentare = io.ladeKommentare ?? ((nr, repo, t) => issueKommentare(nr, (args) => JSON.parse(ghText(args, { token: t })), repo));
  const rohe = ladeOffene(token);
  const offene = normalizeOffene(rohe);
  const kommentare = sammelticketNummern(offene).flatMap((nr) => ladeKommentare(nr, ZIEL, token).map((k) => ({ user: k.user, body: k.body })));
  return { rohe, offene, kommentare, owner: zerlegeRepo(ZIEL).owner };
}
