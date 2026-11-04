/**
 * Verweis auf eine Factory-Seite in Laufzeitmeldungen (#90 Z26). Ein Projekt, das den Harness per Sync bezieht, trägt die Factory-Seiten
 * (`docs/agent-harness.md` & Co.) nicht selbst; eine Meldung mit lokalem Pfad liefe dort ins Leere. Darum: mit Sync-Stand
 * (`.factory/sync-stand.json` › `quelle.tag`) und Factory-Repo (`quelle.repo` des Sync-Stands, sonst ein ausdrücklich gesetztes `repo` des Boards mit Rolle
 * `factory`; nie ein Rückfall aufs eigene Repo, das trüge die Factory-Tags nicht) ein GitHub-Link auf den gesyncten Tag, sonst der lokale Pfad
 * (Upstream selbst, fehlende, kaputte oder nicht bestimmbare Daten). Bau (`factorySeite`) und Zerlegung (`factoryUrlTeile`) dieser URL-Form stehen nur
 * hier; der Link-Wächter `check-factory-links.mjs` (factory#130) prüft die gebauten Links. Der Wächter `test/harness/factory-seite.test.ts` prüft die Literal-Aufrufe von `factorySeiteIn`.
 */
import { liesSyncStand } from "./sync-stand-lib.mjs";
import { boardDerRolle, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { istRepoForm } from "./repo-form.mjs";

/** Pur: die Basis-URL eines Repos (`owner/name`) auf GitHub. */
export const repoBasis = (repo) => `https://github.com/${repo}`;

/** Pur: `https://github.com/<repo>/blob/<tag>/<pfad>#<anker>` mit `repo` und `tag`, sonst `<pfad>#<anker>`; ohne Anker ohne `#`. */
export function factorySeite({ pfad, anker, repo, tag }) {
  const ziel = anker ? `${pfad}#${anker}` : pfad;
  return repo && tag ? `${repoBasis(repo)}/blob/${tag}/${ziel}` : ziel;
}

const dekodiert = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Pur: ordnet eine URL zu (die Umkehrung von `factorySeite`): `null` (nicht dieses Repo, oder bewusst nicht erfasst: Repo-Wurzel, `/issues`, `/pull`, `/pulls`) oder
 * `{ form, ref, pfad, anker, refOffset }`; `form` ist `blob`, `tree` oder `fremd` (jede andere URL auf dieses Repo). Pfad und Anker sind dekodiert,
 * `refOffset` ist die Position des Refs in der URL. Groß-/Kleinschreibung des Repos ist egal.
 */
export function factoryUrlTeile(url, repo) {
  const basis = repoBasis(repo);
  if (url.slice(0, basis.length).toLowerCase() !== basis.toLowerCase()) return null;
  const rest = url.slice(basis.length);
  if (rest !== "" && !/^[/?#]/.test(rest)) return null; // anderes Repo mit gleichem Namensanfang
  if (/^\/?$/.test(rest) || /^[?#]/.test(rest) || /^\/(?:issues|pulls?)(?:[/?#]|$)/.test(rest)) return null;
  const m = /^\/(blob|tree)\/([^/?#]+)\/([^?#]+)(?:#(.*))?$/.exec(rest);
  if (!m) return { form: "fremd", ref: "", pfad: "", anker: "", refOffset: 0 };
  return { form: m[1], ref: m[2], pfad: dekodiert(m[3]), anker: dekodiert(m[4] ?? ""), refOffset: basis.length + m[1].length + 2 };
}

/** Liest `quelle.tag` des Sync-Stands; `undefined` bei fehlender oder kaputter Datei. */
function syncTag(wurzel) {
  const tag = liesSyncStand(wurzel).stand?.quelle?.tag;
  return typeof tag === "string" && tag !== "" ? tag : undefined;
}

/**
 * Das Factory-Repo (`owner/name`): `quelle.repo` des Sync-Stands, sonst das ausdrücklich gesetzte `repo` des Boards mit Rolle `factory`.
 * Bewusst ohne Rückfall auf `config.repo` (`repoDerRolle` fiele darauf zurück): das eigene Repo eines Beziehers trägt die Factory-Tags nicht.
 * `undefined`, wenn nichts davon gesetzt ist, die Config fehlt oder ungültig ist.
 */
export function factoryRepo(wurzel) {
  return factoryRepoAus(liesSyncStand(wurzel).stand, () => ladeProjektConfig({ rootDir: wurzel, pruefen: false }));
}

/** Pur: wie `factoryRepo`, aber auf einem gegebenen Sync-Stand (`quelle.repo`) und einem Lader der Projekt-Config (`ladeConfig`, nur gerufen, wenn der Stand kein Repo trägt; wirft er, ist das Ergebnis `undefined`). */
export function factoryRepoAus(stand, ladeConfig) {
  const ausStand = stand?.quelle?.repo;
  if (istRepoForm(ausStand)) return ausStand;
  try {
    const repo = boardDerRolle("factory", ladeConfig())?.repo;
    return istRepoForm(repo) ? repo : undefined;
  } catch {
    return undefined;
  }
}

/** Verweis auf `pfad#anker` der Factory-Seite, bezogen auf die Wurzel eines Projekts. Wirft nie; bei fehlenden Daten der lokale Pfad. */
export function factorySeiteIn(wurzel, pfad, anker) {
  const tag = syncTag(wurzel);
  return factorySeite({ pfad, anker, tag, repo: tag ? factoryRepo(wurzel) : undefined });
}
