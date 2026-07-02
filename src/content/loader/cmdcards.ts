/* ===== Befehls-Karten (Content-as-Data, #352) =====
 * Die Spaced-Repetition-Drill-Karten: Aufgabe (`q`) + akzeptierte Eingaben
 * (`accept` → RegExp) + Musterlösung (`solution`) + Begründung (`explain`,
 * Pflichtfeld #233 „verstehen statt auswendig"). Wie die Quests **pro Geber**
 * aufgeteilt (`../data/cmdcards/<giver>.json`), damit es bei Stardew-Scope kein
 * Monolith wird. `chapter` referenziert die Quest-ID, in deren Kapitel die Karte
 * drillt; dass dieser Verweis auf eine echte Quest zeigt, prüft – wie schon vor
 * der Migration – der referenzielle `validateContent` (`content/validate.ts`),
 * nicht der Loader (der Loader hat hier keine Quest-Liste). */
import { fail, asRecord, asArray, asNonEmptyString, assertNoUnknownKeys } from "../parse";
import { assembleUnique, makeGlobLoader, reviveAccept } from "./shared";

// Befehls-Karten (#352) liegen analog zu den Quests pro Geber in data/cmdcards/<giver>.json.
const cmdCardModules = import.meta.glob<{ default: unknown }>("../data/cmdcards/*.json", { eager: true });

/** Befehls-Karte in Laufzeit-Form (`accept` als kompiliertes RegExp). */
export interface CmdCard {
  id: string;
  /** Quest-ID, nach deren Abschluss die Karte in den SR-Pool kommt (Freischaltung). */
  chapter: string;
  /** Quest-ID, in der das Konzept eingeführt wird (Lernreihenfolge-Wächter #235).
   *  Optional (#412): fehlt es, gilt `chapter` – nur setzen, wenn das Konzept
   *  FRÜHER eingeführt wird als die Karte freigeschaltet wird. */
  introducedIn?: string;
  q: string;
  accept: RegExp[];
  solution: string;
  explain: string;
}

/** Validiert EINE rohe Befehls-Karte und gibt sie in Laufzeit-Form zurück
 *  (`accept` als RegExp). Wirft `ContentValidationError` beim ersten Verstoß. */
const CMDCARD_KEYS = ["id", "chapter", "introducedIn", "q", "accept", "solution", "explain"] as const;

function parseOneCmdCard(v: unknown, where: string): CmdCard {
  const o = asRecord(v, where);
  assertNoUnknownKeys(o, where, CMDCARD_KEYS);
  const id = asNonEmptyString(o.id, `${where}.id`);
  const path = `cmdcard ${id}`;
  const introducedIn = o.introducedIn !== undefined ? asNonEmptyString(o.introducedIn, `${path}.introducedIn`) : undefined;
  return {
    id,
    chapter: asNonEmptyString(o.chapter, `${path}.chapter`),
    ...(introducedIn !== undefined && { introducedIn }),
    q: asNonEmptyString(o.q, `${path}.q`),
    accept: reviveAccept(o.accept, `${path}.accept`),
    solution: asNonEmptyString(o.solution, `${path}.solution`),
    explain: asNonEmptyString(o.explain, `${path}.explain`),
  };
}

/** Validiert eine rohe Karten-Liste (eine Geber-Datei) gegen das Schema und gibt
 *  sie in Laufzeit-Form zurück. Wirft `ContentValidationError` beim ersten Verstoß. */
export function parseCmdCards(raw: unknown, where = "cmdcards"): CmdCard[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens eine Befehls-Karte erwartet");
  return arr.map((c, i) => parseOneCmdCard(c, `${where}[${i}]`));
}

/** Führt die Geber-Listen zu einer Karten-Sammlung zusammen und prüft auf
 *  doppelte IDs über die Dateien hinweg. Anders als die Quests brauchen die
 *  Karten KEINE Reihenfolge (sie werden per `id`/`chapter` referenziert, nicht per
 *  Index) – aber eindeutige IDs sind Pflicht: die Karten-ID ist im Spielstand
 *  persistiert (die Spaced-Repetition-Box hängt an ihr), eine Dublette würde zwei
 *  Karten denselben Lernfortschritt teilen lassen. */
export function assembleCmdCards(regions: CmdCard[][]): CmdCard[] {
  return assembleUnique(regions, "cmdcards", "Karten-ID", "Geber-Dateien");
}

/** Validierte Befehls-Karten in Laufzeit-Form – Quelle: `../data/cmdcards/<giver>.json`.
 *  Lazy (#435): die Geber-Dateien werden erst beim ersten Zugriff geparst (Funkgerät/
 *  Spaced-Repetition), deterministisch nach Pfad sortiert zusammengeführt; dann gecacht. */
export const getCmdCards = makeGlobLoader(cmdCardModules, parseCmdCards, assembleCmdCards);
