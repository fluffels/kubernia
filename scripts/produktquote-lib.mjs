// Kein Shebang: Bibliothek für board-takt.mjs und factory-kennzahlen.mjs (Einstiegsskripte importieren nicht voneinander).
/**
 * Die Produktquote (ADR 0016, F11 aus ADR 0022 in #1729): höchstens 1 Factory-Merge auf `PRODUKT_QUOTE` Produkt-Merges. Pur, ohne I/O,
 * damit der Takt (Sammelticket nach vorn) und die Kennzahlen dieselbe Zählung benutzen. Die Quote ist Kennzahl, sie wählt keine Seite.
 * Ein Factory-Merge ist ein Commit auf main, dessen Titel ein Issue mit dem Harness-Label der Config referenziert (`istHarnessCommit`); Bots zählen nicht.
 */
import { SAMMELTICKET_TITEL, SAMMELTICKET_TITEL_LISTE, alsDatum } from "./board-lib.mjs";
import { istVertraut } from "./fremdtext-lib.mjs";
import { fehlerText, tokenFuerZiel } from "./gh-cli.mjs";
import { gleichesRepo, repoDerRolle, zerlegeRepo } from "./projekt-config-lib.mjs";

/** Produktquote (#1425): höchstens 1 Harness-Ticket auf so viele Produkt-Tickets. */
export const PRODUKT_QUOTE = 3;

/** Härtungs-Takt (Füllstand): so viele Befund-Kommentare vertrauter Nicht-Bot-Autoren muss das ungeclaimte Harness-Sammelticket tragen, bevor der Takt es
 *  hinter den Kopf holt und die Auswahl es nimmt. Eigene Zahl, nicht an die Seitenwahl (`PRODUKT_QUOTE`) gekoppelt. */
export const HARNESS_TAKT_KOMMENTARE = 10;

/**
 * Füllstand des Harness-Sammeltickets: Zahl der Kommentare (REST `repos/<repo>/issues/<nr>/comments`, flache Liste) von vertrauten Autoren
 * (`istVertraut`: Repo-Owner oder vertrauter Bot) ohne `[bot]`-Login, also nur Menschen-Kommentare des Owners. Kommentare ohne `user.login`
 * zählen nicht. Wirft, wenn `kommentare` keine Liste ist. Pur.
 */
export function befundKommentare(kommentare, owner) {
  if (!Array.isArray(kommentare)) throw new Error("kommentare muss eine Liste sein.");
  return kommentare.filter((k) => istVertraut(k?.user, owner) && !/\[bot\]$/i.test(String(k.user.login))).length;
}

/**
 * Füllstand des Sammeltickets `nr` samt Laden und Fail-closed, die eine Stelle für Takt und Auswahl: `ladeKommentare(nr, repo)` liefert die flache Kommentar-Liste,
 * gezählt wird mit `befundKommentare` für den Owner aus `repo` (`zerlegeRepo`). Rückgabe `{ wert }` oder, bei jedem Fehler (Laden, Antwortform, kaputtes Repo),
 * `{ fehler }` mit der ersten Fehlerzeile: kein Wurf, der Aufrufer geht fail-closed vor. Der Lader ist I/O und kommt von außen.
 */
export function fuellstandVon({ nr, repo, ladeKommentare }) {
  try {
    const { owner } = zerlegeRepo(repo);
    return { wert: befundKommentare(ladeKommentare(nr, repo), owner) };
  } catch (e) {
    return { fehler: `Kommentare von #${nr} nicht ladbar: ${e instanceof Error ? e.message.split(/\r?\n/)[0] : String(e)}` };
  }
}

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
 * Nennt die Titelzeile `#N`-Referenzen, entscheiden sie allein: eine davon in der Menge = Harness, sonst Produkt (so zählen `docs(adr)`
 * und `fix(ci)` zu einem Harness-Issue als Harness, ein `feat(harness)` zu einem Produkt-Issue als Produkt). Ohne Referenz oder ohne Menge
 * (null) bleibt der Rückfall auf den COMMIT-SCOPE `(harness)`. Bewusste Grenze: ein Commit ohne `#N` im Titel (Handarbeit) zählt nur
 * über den Scope; ein Titel mit nur einer PR-Nummer zählt als Produkt (keine PR→Issue-Auflösung, #1460 Z6: von 139 Commits tragen 128 Issue und
 * PR, die 11 mit einer Nummer sind Dependabot, keiner ist ohne; der Scope-Rückfall greift praktisch nie).
 */
export function istHarnessCommit(commit, harnessIssues = null) {
  if (commit?.quellRolle === "harness") return true;
  if (commit?.quellRolle === "produkt") return false;
  const kopf = String(commit?.commit?.message ?? "").split(/\r?\n/, 1)[0];
  const refs = commitRefs(commit);
  if (harnessIssues && refs.length > 0) return refs.some((n) => harnessIssues.has(n));
  return /^[a-z]+\(harness\)!?:/i.test(kopf);
}

/** Die `#N`-Referenzen der Titelzeile eines Commits (Issue und PR) als Zahlen. Pur. */
export function commitRefs(commit) {
  const kopf = String(commit?.commit?.message ?? "").split(/\r?\n/, 1)[0];
  return [...kopf.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

/**
 * Ticket-Merges für den Härtungs-Takt: `zaehleTicketMerges` (ohne Bots, ab `seit`) ohne Commits, deren Titel ein Sammelticket
 * (`sammelIssues`: Menge der Nummern, geschlossen wie offen) referenziert; der Abschluss eines Sammeltickets zählt nicht als Ticket. Pur.
 */
export function zaehleTaktMerges(commits, seit = null, sammelIssues = new Set()) {
  if (!Array.isArray(commits)) throw new Error("commits muss eine Liste sein.");
  return zaehleTicketMerges(commits.filter((c) => c?.quellRolle === "produkt" || !commitRefs(c).some((n) => sammelIssues.has(n))), seit);
}

/**
 * Pur (#78): die Repos, aus deren main Quote und Takt zählen. Führen Produkt- und Factory-Board verschiedene Repos (`boards[].repo`), sind es beide
 * mit ihrer Rolle (`{ repo, rolle: "harness" | "produkt" }`: ein Commit aus dem Repo des Factory-Boards ist Harness, aus dem des Produkt-Boards
 * Produkt; Ticketnummern sind nur je Repo eindeutig). Sonst das eigene Repo ohne Rolle (`rolle: null`, die Nummernregel `istHarnessCommit` gilt).
 */
export function quotenQuellen({ config, repo }) {
  const eigen = { repo: config?.repo ?? repo };
  const von = (rolle) => repoDerRolle(rolle, { ...config, repo: eigen.repo });
  const factory = von("factory");
  const produkt = von("produkt");
  if (typeof factory === "string" && typeof produkt === "string" && !gleichesRepo(factory, produkt)) return [{ repo: factory, rolle: "harness" }, { repo: produkt, rolle: "produkt" }];
  return [{ repo, rolle: null }];
}

/**
 * Pur (#97): der `lies(repo)` für `holeQuotenCommits`: die Commits von main seit `since` über `gh api` (`gh(args, { token })`), je Repo mit dem Token des
 * Ziels (`tokenFuerZiel`: ein fremdes Repo liest der Projekt-Token). `env` kommt vom Aufrufer (kein verstecktes `process.env`).
 */
export const quotenCommitLeser = ({ gh, repo, since, env }) => (r) =>
  gh(["api", "--paginate", "--slurp", `repos/${r}/commits?sha=main&since=${since}&per_page=100`], { token: tokenFuerZiel({ ziel: r, eigenes: repo, env }) }).flat();

/**
 * Die Commits von main aller Quellen (`quotenQuellen`), je mit der Rolle ihres Repos als `quellRolle` gekennzeichnet. `lies(repo)` liefert die
 * Commit-Liste eines Repos. Fail-closed: scheitert ein Repo, wirft sie mit dem Repo im Text, nie eine Teilmenge (die Quote wäre sonst falsch).
 */
export function holeQuotenCommits({ quellen, lies }) {
  return quellen.flatMap(({ repo, rolle }) => {
    let commits;
    try {
      commits = lies(repo);
    } catch (err) {
      throw new Error(`Commits von ${repo} nicht lesbar: ${fehlerText(err, 200)}`, { cause: err });
    }
    return rolle === null ? commits : commits.map((c) => ({ ...c, quellRolle: rolle }));
  });
}

/**
 * Der Sammelticket-Stand aus einer Issue-Liste `[{ number, title, state, closedAt, assignees }]` (state ohne Groß/Klein, assignees eine Liste
 * oder fehlend): `abschluss` = jüngstes geschlossenes Harness-Sammelticket mit gültigem `closedAt` (`{ number, closedAt }` oder null),
 * `sammelIssues` = Nummern aller Sammeltickets beider Titel (offen wie geschlossen), `inArbeit` = Nummer eines offenen Harness-Sammeltickets
 * mit Assignee oder null. Das Langfuse-Sammelticket zählt nur zu `sammelIssues`. Wirft, wenn `issues` keine Liste ist. Pur.
 */
export function sammelStand(issues) {
  if (!Array.isArray(issues)) throw new Error("issues muss eine Liste sein.");
  const sammel = issues.filter((i) => SAMMELTICKET_TITEL_LISTE.includes(i?.title));
  const harness = sammel.filter((i) => i.title === SAMMELTICKET_TITEL);
  const status = (i) => String(i.state ?? "").toLowerCase();
  const abschluss = harness
    .filter((i) => status(i) === "closed" && Number.isFinite(Date.parse(i.closedAt)))
    .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt))[0];
  const inArbeit = harness.find((i) => status(i) === "open" && (i.assignees ?? []).length > 0);
  return {
    abschluss: abschluss ? { number: abschluss.number, closedAt: abschluss.closedAt } : null,
    sammelIssues: new Set(sammel.map((i) => i.number)),
    inArbeit: inArbeit?.number ?? null,
  };
}

/** gh-Argumente für die geschlossenen Issues mit dem Harness-Label ab `seit` (ISO), paginiert und gesammelt. Pur. */
export function harnessIssuesAnfrage({ repo, label, seit }) {
  return ["api", "--paginate", "--slurp", `repos/${repo}/issues?state=closed&labels=${encodeURIComponent(label)}&since=${seit}&per_page=100`];
}

/** Nummern (ohne Pull Requests) aus der Antwort von `harnessIssuesAnfrage`; wirft bei falscher Form (keine Liste von Seiten). Pur. */
export function harnessIssuesAus(seiten) {
  if (!Array.isArray(seiten)) throw new Error("Unerwartete Antwortform der geschlossenen Harness-Issues (keine Liste von Seiten).");
  return new Set(seiten.flat().filter((i) => i && !i.pull_request).map((i) => i.number));
}
