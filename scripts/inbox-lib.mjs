/**
 * Gemeinsame Bausteine der Inbox-Skripte (`audit-einordnung.mjs`, `codescanning-inbox.mjs`, `wiedervorlage.mjs`): Ticket ganz oben im Board
 * einsortieren, das Sammelticket für Befundzeilen wählen, Zeilen dort posten und Titel offener Tickets nur vertrauter Autoren lesen.
 * `vertrauteIssues`/`offeneTitel` sind pur und getestet (test/inbox-lib.test.ts); der Rest ruft `gh` bzw. `board-place.mjs`.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ghJson, ghText } from "./gh-cli.mjs";
import { REPO, SAMMELTICKET_TITEL, kandidatenSammelticket, loadOpenIssuePages, normalizeOffene, waehleBestaetigtes } from "./board-lib.mjs";
import { issueKommentare, istVertraut } from "./fremdtext-lib.mjs";

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

/** Sortiert Ticket `nr` per `board-place.mjs --notfall <art> --top` ganz oben ein. Wirft ohne Token und bei einem Fehler des Skripts. */
export function platziereOben(nr, art, token = process.env.PROJECT_TOKEN) {
  if (!token) throw new Error("PROJECT_TOKEN fehlt: das Ticket steht nicht oben im Board.");
  execFileSync(process.execPath, [BOARD_PLACE, "--notfall", art, "--top", String(nr)], { env: { ...process.env, GH_TOKEN: token }, stdio: "inherit" });
}

/** Das jüngste offene, ungeclaimte Harness-Sammelticket (per Einzelabruf bestätigt) oder null. `offene` aus `normalizeOffene`. */
export const waehleSammelticket = (offene) =>
  waehleBestaetigtes(kandidatenSammelticket(offene, SAMMELTICKET_TITEL), (nr) => ghJson(["api", `repos/${REPO}/issues/${nr}`]), REPO.split("/")[0]);

/** Postet `text` als Kommentar unter Issue `nr`. */
export const postZeilen = (nr, text) => ghText(["api", `repos/${REPO}/issues/${nr}/comments`, "-f", `body=${text}`]);

/** Nummern der offenen Harness-Sammeltickets (exakter Titel, auch geclaimte) aus `normalizeOffene`. Pur. */
export const sammelticketNummern = (offene) => offene.filter((i) => i.titel === SAMMELTICKET_TITEL).map((i) => i.number);

/**
 * Der gemeinsame Abruf der Inbox-Skripte: `{ rohe, offene, kommentare }` = offene Issues (REST-Seiten, `loadOpenIssuePages`), deren Normalform und die
 * Kommentare (`[{ user, body }]`, ungefiltert) aller offenen Harness-Sammeltickets. Das Vertrauensfilter wendet der Aufrufer an (`vertrauteBodies`,
 * `istBekannt`). `io` ist für Tests austauschbar (Default: echtes `gh`).
 */
export function ladeSammelKontext(io = {}) {
  const ladeOffene = io.ladeOffene ?? (() => loadOpenIssuePages());
  const ladeKommentare = io.ladeKommentare ?? ((nr) => issueKommentare(nr, (args) => JSON.parse(ghText(args)), REPO));
  const rohe = ladeOffene();
  const offene = normalizeOffene(rohe);
  const kommentare = sammelticketNummern(offene).flatMap((nr) => ladeKommentare(nr).map((k) => ({ user: k.user, body: k.body })));
  return { rohe, offene, kommentare };
}
