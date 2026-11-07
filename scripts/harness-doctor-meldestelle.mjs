/* Harness-Doctor, Punkt `Meldestelle` (factory#153, factory#208): prüft, ob ein Bezieher an seine fremde Meldestelle melden kann. Nur bei einer fremden Stelle
 * (`config.meldestelle` oder das Repo des Boards mit Rolle `factory` ist nicht das eigene Repo) gibt es den Punkt; ohne fremde Stelle liefert die Funktion keinen Punkt (nichts zu prüfen).
 *
 *   - Ohne `MELDESTELLE_TOKEN` und ohne `PROJECT_TOKEN` ist der Punkt in Actions eine Lücke (der Wochenlauf kann an der fremden Stelle weder lesen noch posten); lokal gilt das `gh`-Login, der Punkt prüft dann damit.
 *   - Die Meldestelle muss mit dem Token lesbar sein, Issues haben (`has_issues`) und darf nicht archiviert sein; ein Lesefehler (403, 404, Netz) ist `NICHT PRÜFBAR`, nie still grün.
 *
 * Grenze: das Schreibrecht belegt der Punkt nicht (die REST-Antwort trägt es für fein granulare Tokens nicht zuverlässig); ein Post-Fehler meldet `schreibrechtText` beim Senden.
 * `lesen(args, token)` ist die `gh`-Naht (liefert die geparste Antwort, wirft bei einem Fehler); `mitMeldestelle` hängt den Punkt an die Dateipunkte des Doctors (`dateien({ rootDir, config })`).
 */
import { fehlerText } from "./gh-cli.mjs";
import { luecke, gut, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { meldestelleZugang } from "./meldung-lib.mjs";
import { meldestelleAus } from "./projekt-config-lib.mjs";

const PUNKT = "Meldestelle";

/** Der Zugang zur fremden Meldestelle (dieselbe Rechnung wie der Wochenlauf: `meldestelleZugang`) oder `null` (eigenes Repo, keine Config, Config ohne ableitbare Stelle). */
function fremderZugang(config, env) {
  if (!config) return null;
  try {
    const stelle = meldestelleAus(config);
    if (typeof stelle !== "string") return null;
    const zugang = meldestelleZugang({ stelle, eigenes: config.repo, env });
    return zugang.fremd ? zugang : null;
  } catch {
    return null;
  }
}

/** Der Punkt `Meldestelle` als Liste: leer ohne fremde Stelle, sonst genau ein Ergebnis. */
export function meldestellePunkt({ config, env, lesen }) {
  const zugang = fremderZugang(config, env);
  if (zugang === null) return [];
  const { stelle, token } = zugang;
  if (token === undefined && env.GITHUB_ACTIONS === "true") {
    return [luecke(PUNKT, `die Meldestelle ${stelle} ist ein fremdes Repo, aber weder MELDESTELLE_TOKEN noch PROJECT_TOKEN ist gesetzt: der Wochenlauf kann dort weder lesen noch posten`, `Secret MELDESTELLE_TOKEN (Issues: Lesen und Schreiben an ${stelle}) im Repo anlegen und im Workflow harness-doctor.yml als Umgebungsvariable reichen (Anlegen ist ein Pre-Flight-Stopp, Anleitung: Seite docs/erstbezug.md des Factory-Repos, Abschnitt Meldestelle)`)];
  }
  let repo;
  try {
    repo = lesen(["api", `repos/${stelle}`], token);
  } catch (e) {
    return [nichtPruefbar(PUNKT, `die Meldestelle ${stelle} ist nicht lesbar (${fehlerText(e).split("\n")[0]})`, "Token mit Lese- und Schreibrecht auf die Issues der Meldestelle prüfen (MELDESTELLE_TOKEN oder gh-Login), dann erneut prüfen")];
  }
  if (repo?.archived === true) return [luecke(PUNKT, `die Meldestelle ${stelle} ist archiviert: Kommentare lassen sich dort nicht mehr schreiben`, "die Meldestelle entarchivieren oder `meldestelle` in der Projekt-Config auf ein aktives Repo setzen")];
  if (repo?.has_issues !== true) return [luecke(PUNKT, `die Meldestelle ${stelle} hat Issues nicht aktiviert (oder die Antwort nennt has_issues nicht)`, `in den Einstellungen von ${stelle} Issues aktivieren und das Harness-Sammelticket „Harness-Härtung (gesammelt)“ dort anlegen lassen`)];
  return [gut(PUNKT)];
}

/** Die Dateipunkte `dateien` samt Punkt `Meldestelle` (Config aus dem Aufruf, `env` und `lesen` vom Rand): dieselbe Form `dateien({ rootDir, config })`. */
export const mitMeldestelle = (dateien, { env, lesen }) => (a) => [...dateien(a), ...meldestellePunkt({ config: a.config, env, lesen })];
