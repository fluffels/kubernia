// Schicht-Definition als EINE Quelle der Wahrheit (#482).
//
// Vorher gab es die Schicht-Zuordnung faktisch zweimal nebeneinander: einmal als
// Import-Grenzen im dependency-cruiser (.dependency-cruiser.cjs) und einmal als
// Prosa in der CLAUDE.md-Landkarte. Der Doku↔Code-Drift-Wächter (#482,
// scripts/check-docmap.mjs) prüft, dass beide übereinstimmen — dafür müssen beide
// aus derselben Quelle ableiten, sonst hätte der Wächter selbst zwei Wahrheiten.
// Darum leben die Schicht-Muster hier, und sowohl der Cruiser-Config als auch der
// Wächter `require`n sie.
//
// Bewusst .cjs (kein .mjs): der dependency-cruiser-Config ist CommonJS und
// `require`t das hier direkt; der ESM-Wächter zieht es über `createRequire`.

/** Präsentationsschicht – darf Phaser + alles andere anfassen. Deckt die Einzeldatei
 *  (src/ui.ts, src/sfx.ts) UND den Modul-Ordner (src/scenes/*, src/ui/*) ab. */
const PRESENTATION = "^src/(scenes|ui|sfx)(\\.ts$|/)";
/** Anwendungs-/Persistenzschicht – muss phaser- und präsentationsfrei bleiben. Deckt
 *  Einzeldatei (src/game.ts, src/store.ts …) UND Modul-Ordner (src/game/*) ab. */
const APPLICATION = "^src/(game|runtime|devpanel|store)(\\.ts$|/)";
/** Einstieg/Assets – main bootet bewusst Phaser + Szenen; assets-data hält PNG-Imports. */
const ENTRY = "^src/(main|assets-data)\\.ts$";

/** Kanonische Schicht-Buckets — genau die Unterscheidung, die dependency-cruiser trifft
 *  (alles, was nicht Präsentation/Anwendung/Einstieg ist, ist „pure Domäne"). */
const LAYERS = {
  PRESENTATION: "praesentation",
  APPLICATION: "anwendung",
  ENTRY: "einstieg",
  DOMAIN: "domaene",
};

/** Klassifiziert eine repo-relative src-Datei (POSIX-Pfad) in ihren Schicht-Bucket —
 *  dieselben Grenzen, die der dependency-cruiser erzwingt. */
function layerOf(file) {
  if (new RegExp(PRESENTATION).test(file)) return LAYERS.PRESENTATION;
  if (new RegExp(APPLICATION).test(file)) return LAYERS.APPLICATION;
  if (new RegExp(ENTRY).test(file)) return LAYERS.ENTRY;
  return LAYERS.DOMAIN;
}

/** Übersetzt die in der CLAUDE.md-Landkarte genannten Schicht-Labels in die kanonischen
 *  Buckets. Die Landkarte ist bewusst feiner (trennt „Persistenz" von „Anwendung",
 *  „Typen"/„Assets" von Domäne/Einstieg, damit ein Mensch die Rolle sofort sieht) — der
 *  Wächter gleicht auf Bucket-Ebene ab, weil dependency-cruiser nur diese vier kennt.
 *  Ein Label, das hier fehlt, ist entweder ein Tippfehler in der Landkarte oder ein
 *  neuer Schicht-Begriff, der bewusst hier ergänzt gehört — der Wächter meldet es. */
const LABEL_TO_LAYER = {
  Einstieg: LAYERS.ENTRY,
  Assets: LAYERS.ENTRY,
  "pure Domäne": LAYERS.DOMAIN,
  Typen: LAYERS.DOMAIN,
  Anwendung: LAYERS.APPLICATION,
  Persistenz: LAYERS.APPLICATION,
  Präsentation: LAYERS.PRESENTATION,
  // „Daten" fehlt bewusst: das ist ein Verzeichnis-Eintrag (JSON, kein .ts) und wird
  // beim .ts-Schicht-Abgleich übersprungen (siehe check-docmap.mjs).
};

/** Die Wurzel-Namen (Datei- bzw. Verzeichnis-Segmente) der NICHT-Domäne-Schichten. EINE
 *  Quelle für den Domänen-Glob unten: Domäne = „alles unter src, dessen erstes Segment
 *  NICHT hier steht" (Extglob-Ausschluss). Deckungsgleich mit den PRESENTATION/APPLICATION/
 *  ENTRY-RegExps oben — `test/coverage-config.test.ts` beweist die Deckungsgleichheit. */
const NON_DOMAIN = ["scenes", "ui", "sfx", "game", "runtime", "devpanel", "store", "main", "assets-data"];
const _nd = NON_DOMAIN.join("|");

/** Glob-Form derselben Schicht-Grenzen (#495) — für Vitests Coverage-`thresholds`, deren
 *  Schlüssel Globs (picomatch), keine RegExps sind. Bewusst hier co-lokalisiert zu den
 *  RegExp-Mustern oben, damit beide Formen an EINER Stelle stehen; `test/coverage-config.test.ts`
 *  bindet die zwei Formen aneinander, indem es für JEDE echte `src`-Datei prüft, dass GENAU EIN
 *  Bucket-Glob greift und dieser mit `layerOf()` (der RegExp-Wahrheit) übereinstimmt — driftet
 *  eines, wird es rot. GENAU EIN Glob je Bucket, damit Vitest die Schwelle über das ganze
 *  Schicht-Aggregat prüft (nicht Datei-Untergruppen zersplittert). Verzeichnisbasiert und damit
 *  Stardew-fest: neue Dateien fallen automatisch in ihren Bucket. Bewusst KEINE globale Schwelle
 *  daneben — jede Datei ist genau einem Bucket zugeordnet (der ganze Sinn: pro Schicht statt
 *  Repo-Mittel). Das kombinierte `{.ts,/**}` fasst Wurzel-Datei UND Modul-Ordner je Schicht;
 *  der Domänen-Glob `src/!(nd)/**` matcht Wurzel-`.ts` (Globstar matcht leer) UND Unterordner. */
const COVERAGE_GLOBS = {
  [LAYERS.PRESENTATION]: "src/{scenes,ui,sfx}{.ts,/**}",
  [LAYERS.APPLICATION]: "src/{game,runtime,devpanel,store}{.ts,/**}",
  [LAYERS.ENTRY]: "src/{main,assets-data}.ts",
  [LAYERS.DOMAIN]: `src/!(${_nd})/**`,
};

module.exports = { PRESENTATION, APPLICATION, ENTRY, LAYERS, layerOf, LABEL_TO_LAYER, NON_DOMAIN, COVERAGE_GLOBS };
