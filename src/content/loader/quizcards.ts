/* ===== Quiz-Karteikarten (Content-as-Data, #368) =====
 * Die Verständnis-Karten der Quiz-Krabbe Kralle (Multiple Choice): Frage (`q`),
 * `options` (≥2), Index der richtigen Antwort (`correct`) + Begründung (`explain`,
 * Pflichtfeld #233). Anders als Quests/Befehls-Karten **pro THEMA aufgeteilt**
 * (`../data/crabquiz/<thema>.json`) – ein Wissens-Quiz ist nach Wissensgebiet
 * organisiert, nicht nach Geber, und ein Thema (z.B. RBAC) existiert auch dann
 * schon, wenn seine Region/sein Geber noch nicht gebaut ist. Welche Quest eine
 * Karte über `reviewId` einbindet, prüft `validateContent` (`content/validate.ts`). */
import { fail, asRecord, asArray, asNonEmptyString, asInt, asNonEmptyStringArray, assertNoUnknownKeys } from "../parse";
import { assembleUnique, makeGlobLoader } from "./shared";

// Quiz-Karteikarten (#368) liegen pro THEMA in data/crabquiz/<thema>.json (nicht pro Geber).
const crabQuizModules = import.meta.glob<{ default: unknown }>("../data/crabquiz/*.json", { eager: true });

/** Quiz-Karteikarte in Laufzeit-Form (Multiple Choice). */
export interface QuizCard {
  id: string;
  /** Quest-ID, nach deren Abschluss diese Karte in den SR-Pool kommt (analog zu CmdCard.chapter). */
  chapter?: string;
  /** Quest-ID, in der das Konzept eingeführt wird (Lernreihenfolge-Wächter #235).
   *  Optional (#412): fehlt es, gilt `chapter` – nur setzen, wenn das Konzept
   *  FRÜHER eingeführt wird als die Karte freigeschaltet wird. */
  introducedIn?: string;
  q: string;
  options: string[];
  correct: number;
  explain: string;
}

/** Validiert EINE rohe Quiz-Karte und gibt sie typisiert zurück.
 *  Wirft `ContentValidationError` beim ersten Verstoß. */
const QUIZCARD_KEYS = ["id", "chapter", "introducedIn", "q", "options", "correct", "explain"] as const;

function parseOneQuizCard(v: unknown, where: string): QuizCard {
  const o = asRecord(v, where);
  assertNoUnknownKeys(o, where, QUIZCARD_KEYS);
  const id = asNonEmptyString(o.id, `${where}.id`);
  const path = `quizcard ${id}`;
  const options = asNonEmptyStringArray(o.options, `${path}.options`);
  if (options.length < 2) fail(`${path}.options`, "mindestens zwei Optionen erwartet");
  const correct = asInt(o.correct, `${path}.correct`);
  if (correct < 0 || correct >= options.length) {
    fail(`${path}.correct`, `Index ${correct} außerhalb der ${options.length} Optionen`);
  }
  const chapter = o.chapter !== undefined ? asNonEmptyString(o.chapter, `${path}.chapter`) : undefined;
  const introducedIn = o.introducedIn !== undefined ? asNonEmptyString(o.introducedIn, `${path}.introducedIn`) : undefined;
  return {
    id,
    ...(chapter !== undefined && { chapter }),
    ...(introducedIn !== undefined && { introducedIn }),
    q: asNonEmptyString(o.q, `${path}.q`),
    options,
    correct,
    explain: asNonEmptyString(o.explain, `${path}.explain`),
  };
}

/** Validiert eine rohe Quiz-Liste (eine Thema-Datei). Wirft beim ersten Verstoß. */
export function parseQuizCards(raw: unknown, where = "crabquiz"): QuizCard[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens eine Quiz-Karte erwartet");
  return arr.map((c, i) => parseOneQuizCard(c, `${where}[${i}]`));
}

/** Führt die Thema-Listen zusammen und prüft auf doppelte IDs über die Dateien
 *  hinweg (die Karten-ID ist im Spielstand persistiert – die Spaced-Repetition-Box
 *  hängt an ihr, eine Dublette würde den Lernfortschritt teilen). Keine Reihenfolge
 *  nötig: Karten werden per `id` referenziert, nicht per Index. */
export function assembleQuizCards(topics: QuizCard[][]): QuizCard[] {
  return assembleUnique(topics, "crabquiz", "Quiz-ID", "Thema-Dateien");
}

/** Validierte Quiz-Karteikarten in Laufzeit-Form – Quelle: `../data/crabquiz/<thema>.json`.
 *  Lazy (#435): die Thema-Dateien werden erst beim ersten Zugriff geparst (Krabben-Quiz),
 *  deterministisch nach Pfad sortiert zusammengeführt; dann gecacht. */
export const getQuizCards = makeGlobLoader(crabQuizModules, parseQuizCards, assembleQuizCards);
