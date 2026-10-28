/**
 * Verweis auf eine Factory-Seite in Laufzeitmeldungen (#90 Z26). Ein Projekt, das den Harness per Sync bezieht, trägt die Factory-Seiten
 * (`docs/agent-harness.md` & Co.) nicht selbst; eine Meldung mit lokalem Pfad liefe dort ins Leere. Darum: mit Sync-Stand
 * (`.factory/sync-stand.json` › `quelle.tag`) und Factory-Repo (`quelle.repo` des Sync-Stands, sonst ein ausdrücklich gesetztes `repo` des Boards mit Rolle
 * `factory`; nie ein Rückfall aufs eigene Repo, das trüge die Factory-Tags nicht) ein GitHub-Link auf den gesyncten Tag, sonst der lokale Pfad
 * (Upstream selbst, fehlende, kaputte oder nicht bestimmbare Daten). Die Link-Wächter-Erweiterung
 * (Link statt Pfad prüfen) steht in #93; der Wächter `test/harness/factory-seite.test.ts` prüft die Literal-Aufrufe von `factorySeiteIn`.
 */
import { liesSyncStand } from "./factory-sync-lib.mjs";
import { boardDerRolle, istRepoForm, ladeProjektConfig } from "./projekt-config-lib.mjs";

/** Pur: `https://github.com/<repo>/blob/<tag>/<pfad>#<anker>` mit `repo` und `tag`, sonst `<pfad>#<anker>`; ohne Anker ohne `#`. */
export function factorySeite({ pfad, anker, repo, tag }) {
  const ziel = anker ? `${pfad}#${anker}` : pfad;
  return repo && tag ? `https://github.com/${repo}/blob/${tag}/${ziel}` : ziel;
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
  const ausStand = liesSyncStand(wurzel).stand?.quelle?.repo;
  if (istRepoForm(ausStand)) return ausStand;
  try {
    const repo = boardDerRolle("factory", ladeProjektConfig({ rootDir: wurzel, pruefen: false }))?.repo;
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
