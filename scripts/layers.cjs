// Schicht-Definition als EINE Quelle der Wahrheit (#482).
//
// Vorher gab es die Schicht-Zuordnung faktisch zweimal nebeneinander: einmal als
// Import-Grenzen im dependency-cruiser (.dependency-cruiser.cjs) und einmal als
// Prosa in der Repo-Landkarte (docs/referenz/repo-landkarte.md). Der Doku↔Code-Drift-Wächter (#482,
// scripts/check-docmap.mjs) prüft, dass beide übereinstimmen — dafür müssen beide
// aus derselben Quelle ableiten, sonst hätte der Wächter selbst zwei Wahrheiten.
// Darum leben die Schicht-Muster hier, und sowohl der Cruiser-Config als auch der
// Wächter `require`n sie.
//
// Bewusst .cjs (kein .mjs): der dependency-cruiser-Config ist CommonJS und
// `require`t das hier direkt; der ESM-Wächter zieht es über `createRequire`.

/** Wurzel-Namen (Datei- bzw. Verzeichnis-Segmente unter src/) der NICHT-Domäne-Schichten: die
 *  EINE Quelle für Muster, `NON_DOMAIN`, Coverage-Globs und die Diagramm-Labels (#1368). */
const WURZELN = {
  praesentation: ["scenes", "ui", "sfx"],
  anwendung: ["game", "runtime", "devpanel", "store"],
  einstieg: ["main", "assets-data"],
};

/** Präsentationsschicht – darf Phaser + alles andere anfassen. Deckt die Einzeldatei
 *  (src/ui.ts, src/sfx.ts) UND den Modul-Ordner (src/scenes/*, src/ui/*) ab. */
const PRESENTATION = `^src/(${WURZELN.praesentation.join("|")})(\\.ts$|/)`;
/** Anwendungs-/Persistenzschicht – muss phaser- und präsentationsfrei bleiben. Deckt
 *  Einzeldatei (src/game.ts, src/store.ts …) UND Modul-Ordner (src/game/*) ab. */
const APPLICATION = `^src/(${WURZELN.anwendung.join("|")})(\\.ts$|/)`;
/** Einstieg/Assets – main bootet bewusst Phaser + Szenen; assets-data hält PNG-Imports. */
const ENTRY = `^src/(${WURZELN.einstieg.join("|")})\\.ts$`;
/** Phaser, egal über welchen aufgelösten Pfad (Pfad beginnt mit `node_modules/…`, kein führender Slash). */
const PHASER = "node_modules[/\\\\]phaser[/\\\\]";

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

/** Übersetzt die in der Repo-Landkarte genannten Schicht-Labels in die kanonischen
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
const NON_DOMAIN = [...WURZELN.praesentation, ...WURZELN.anwendung, ...WURZELN.einstieg];
const _nd = NON_DOMAIN.join("|");
// Dieselben Namen als vollständige Datei-Token (`ui.ts` statt `ui`) — gebraucht für den
// prä­fix-sicheren Domänen-Glob unten (#539).
const _ndTs = NON_DOMAIN.map((n) => `${n}.ts`).join("|");

/** Glob-Form derselben Schicht-Grenzen (#495) — für Vitests Coverage-`thresholds`, deren
 *  Schlüssel Globs (picomatch), keine RegExps sind. Bewusst hier co-lokalisiert zu den
 *  RegExp-Mustern oben, damit beide Formen an EINER Stelle stehen; `test/coverage-config.test.ts`
 *  bindet die zwei Formen aneinander, indem es für JEDE echte `src`-Datei prüft, dass GENAU EIN
 *  Bucket-Glob greift und dieser mit `layerOf()` (der RegExp-Wahrheit) übereinstimmt — driftet
 *  eines, wird es rot. GENAU EIN Glob je Bucket, damit Vitest die Schwelle über das ganze
 *  Schicht-Aggregat prüft (nicht Datei-Untergruppen zersplittert). Verzeichnisbasiert und damit
 *  Stardew-fest: neue Dateien fallen automatisch in ihren Bucket. Bewusst KEINE globale Schwelle
 *  daneben — jede Datei ist genau einem Bucket zugeordnet (der ganze Sinn: pro Schicht statt
 *  Repo-Mittel). Das kombinierte `{.ts,/**}` fasst Wurzel-Datei UND Modul-Ordner je Schicht.
 *
 *  Der Domänen-Glob ist bewusst ZWEIGETEILT (`{!(nd)/**,!(ndTs)}`), NICHT `src/!(nd)/**` (#539):
 *  picomatch rendert `!(…)` als PRÄFIX-Lookahead `(?!(?:…|ui|…))[^/]*?`, der NICHT an die
 *  Segmentgrenze verankert ist. `src/!(nd)/**` matchte Top-Level-`.ts` nur über den „Globstar matcht
 *  leer"-Zweig, und dort verwarf der Präfix-Lookahead jede Datei, deren Name mit einem NON_DOMAIN-
 *  Segment BEGINNT (`uieval.ts` wegen `ui`) — die fiel still aus dem Domänen-Bucket (real bei #500:
 *  `uieval.ts` musste zu `viewdecide.ts` umbenannt werden). Der Datei-Zweig `!(${_ndTs})` negiert
 *  stattdessen die vollständigen Datei-Token (`ui.ts`), sodass das `.ts` als Grenze wirkt und
 *  `uieval.ts` NICHT mehr mit `ui.ts` beginnt → korrekt Domäne. Der Verzeichnis-Zweig `!(${_nd})/**`
 *  deckt Unterordner ab. Rest-Grenze: eine künftige Domänen-DIR mit reserviertem Präfix (`gameplay/`)
 *  träfe denselben picomatch-Präfix-Effekt (in einem einzelnen Glob nicht behebbar, auch nicht mit
 *  `@()`/`bash:true`) — sie fällt aber NICHT still durch, sondern lässt die reale-Datei-Bindung in
 *  `test/coverage-config.test.ts` rot laufen (0 Buckets getroffen), genau wie #500 auffiel.
 *  Prüfung: `test/coverage-config.test.ts` (reale Dateien + synthetische reservierte-Präfix-Namen). */
const COVERAGE_GLOBS = {
  [LAYERS.PRESENTATION]: `src/{${WURZELN.praesentation.join(",")}}{.ts,/**}`,
  [LAYERS.APPLICATION]: `src/{${WURZELN.anwendung.join(",")}}{.ts,/**}`,
  [LAYERS.ENTRY]: `src/{${WURZELN.einstieg.join(",")}}.ts`,
  [LAYERS.DOMAIN]: `src/{!(${_nd})/**,!(${_ndTs})}`,
};

/** Schicht-Modell (#1368): die erlaubten Import-Richtungen als Positivliste. Die Reihenfolge ist
 *  die Diagramm-Reihenfolge von oben nach unten. Imports innerhalb einer Schicht sind immer
 *  erlaubt; was nicht in `darf` steht, ist verboten (fail-closed). `verbotsRegeln` leitet daraus die
 *  Regeln von `check:arch` ab, `scripts/docs-gen/schichten.mjs` die Diagramme: Diagramm == geprüfte
 *  Regel. `muster: null` = Auffang-Schicht (alles übrige unter src/); genau eine davon. Schichten sind über
 *  Wurzel-Segmente der obersten Ebene unter src/ definiert (der Ist-Collapse in scripts/docs-gen/config.json
 *  verdichtet auf genau diese Ebene). `pruefeModell` (scripts/docs-gen/schichten.mjs) prüft das Modell. */
const SCHICHT_MODELL = {
  schichten: [
    { id: LAYERS.ENTRY, label: "Einstieg/Assets", muster: ENTRY, wurzeln: WURZELN.einstieg, darf: [LAYERS.PRESENTATION, LAYERS.APPLICATION, LAYERS.DOMAIN, "phaser"] },
    { id: LAYERS.PRESENTATION, label: "Präsentation", technik: "Phaser/DOM", muster: PRESENTATION, wurzeln: WURZELN.praesentation, darf: [LAYERS.ENTRY, LAYERS.APPLICATION, LAYERS.DOMAIN, "phaser"] },
    { id: LAYERS.APPLICATION, label: "Anwendung/Persistenz", muster: APPLICATION, wurzeln: WURZELN.anwendung, darf: [LAYERS.DOMAIN] },
    { id: LAYERS.DOMAIN, label: "pure Domäne", muster: null, wurzeln: [], darf: [] },
  ],
  extern: [{ id: "phaser", label: "Phaser", muster: PHASER }],
};

const D_TS = "\\.d\\.ts$";

/** Pfad-Muster einer Schicht als dependency-cruiser-Bedingung; die Auffang-Schicht ist „src/ ohne alle anderen". */
function bedingung(modell, ziel, alsQuelle) {
  const andere = modell.schichten.filter((s) => s.muster && s.id !== ziel.id).map((s) => s.muster);
  if (ziel.muster) return alsQuelle ? { path: ziel.muster, pathNot: D_TS } : { path: ziel.muster };
  return { path: "^src/", pathNot: [...andere, ...(alsQuelle ? [D_TS] : [])].join("|") };
}

/** Verbotsregeln für dependency-cruiser: je Paar (Schicht → Schicht/Extern), das nicht in `darf` steht, eine Regel
 *  `schicht-<von>-nicht-<nach>`. `.d.ts`-Quellen lösen nie eine Regel aus (reine Typdeklarationen). */
function verbotsRegeln(modell) {
  const regeln = [];
  const ziele = [...modell.schichten, ...modell.extern];
  for (const von of modell.schichten) {
    for (const nach of ziele) {
      if (nach.id === von.id || von.darf.includes(nach.id)) continue;
      regeln.push({
        name: `schicht-${von.id}-nicht-${nach.id}`,
        comment: `${von.label} darf ${nach.label} nicht importieren (erlaubte Richtungen: SCHICHT_MODELL in scripts/layers.cjs).`,
        severity: "error",
        from: bedingung(modell, von, true),
        to: bedingung(modell, nach, false),
      });
    }
  }
  return regeln;
}

module.exports = { PRESENTATION, APPLICATION, ENTRY, PHASER, LAYERS, layerOf, LABEL_TO_LAYER, NON_DOMAIN, COVERAGE_GLOBS, SCHICHT_MODELL, verbotsRegeln };
