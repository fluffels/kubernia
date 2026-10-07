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

/** Kanonische Schicht-Buckets — genau die Unterscheidung, die dependency-cruiser trifft
 *  (alles, was nicht Präsentation/Anwendung/Einstieg ist, ist „pure Domäne"). */
const LAYERS = {
  PRESENTATION: "praesentation",
  APPLICATION: "anwendung",
  ENTRY: "einstieg",
  DOMAIN: "domaene",
};

/** Phaser, egal über welchen aufgelösten Pfad (Pfad beginnt mit `node_modules/…`, kein führender Slash). */
const PHASER = "node_modules[/\\\\]phaser[/\\\\]";

/** Pfad-Muster einer Schicht aus ihren Wurzel-Namen (Datei- bzw. Verzeichnis-Segmente unter src/).
 *  Deckt je Wurzel die Einzeldatei (src/ui.ts, src/sfx.ts) UND den Modul-Ordner (src/scenes/*) ab;
 *  `nurDatei` (Einstieg/Assets) nur die Einzeldatei. */
function musterAus(wurzeln, nurDatei) {
  return `^src/(${wurzeln.join("|")})${nurDatei ? "\\.ts$" : "(\\.ts$|/)"}`;
}

/** Schicht-Modell (#1368, #1392): die EINE Quelle für Muster, `layerOf`, `NON_DOMAIN`, Coverage-Globs, die
 *  Regeln von `check:arch` (`verbotsRegeln`) und die Diagramme (`scripts/docs-gen/schichten.mjs`):
 *  Diagramm == geprüfte Regel. Die Reihenfolge ist die Diagramm-Reihenfolge von oben nach unten. Imports
 *  innerhalb einer Schicht sind immer erlaubt; was nicht in `darf` steht, ist verboten (fail-closed).
 *  Eine Schicht besteht aus `wurzeln` (oberste Ebene unter src/; der Ist-Collapse in
 *  scripts/docs-gen/config.json verdichtet auf genau diese Ebene), `nurDatei` markiert reine Datei-Wurzeln
 *  (Einstieg/Assets, kein Modul-Ordner). `muster` wird daraus abgeleitet; `muster: null` = Auffang-Schicht
 *  (alles übrige unter src/, ohne Wurzeln), genau eine davon. `pruefeModell` prüft das Modell und läuft
 *  vor jeder Regelableitung. */
const SCHICHT_MODELL = {
  schichten: [
    { id: LAYERS.ENTRY, label: "Einstieg/Assets", wurzeln: ["main", "assets-data"], nurDatei: true, darf: [LAYERS.PRESENTATION, LAYERS.APPLICATION, LAYERS.DOMAIN, "phaser"] },
    { id: LAYERS.PRESENTATION, label: "Präsentation", technik: "Phaser/DOM", wurzeln: ["scenes", "ui", "sfx"], darf: [LAYERS.ENTRY, LAYERS.APPLICATION, LAYERS.DOMAIN, "phaser"] },
    { id: LAYERS.APPLICATION, label: "Anwendung/Persistenz", wurzeln: ["game", "runtime", "devpanel", "store"], darf: [LAYERS.DOMAIN] },
    { id: LAYERS.DOMAIN, label: "pure Domäne", wurzeln: [], darf: [] },
  ].map((s) => ({ ...s, muster: s.wurzeln.length ? musterAus(s.wurzeln, s.nurDatei === true) : null })),
  extern: [{ id: "phaser", label: "Phaser", muster: PHASER }],
};

const ID = /^[a-z][a-z0-9]*$/;

/** Wirft bei einem unbrauchbaren Modell (alle Probleme in einer Meldung). */
function pruefeModell(modell) {
  const probleme = [];
  const schichten = Array.isArray(modell?.schichten) ? modell.schichten : [];
  const extern = Array.isArray(modell?.extern) ? modell.extern : [];
  if (schichten.length === 0) probleme.push("keine Schichten");
  const alle = [...schichten, ...extern];
  const ids = new Set();
  for (const s of alle) {
    if (typeof s.id !== "string" || !ID.test(s.id) || s.id === "end") probleme.push(`ungültige oder reservierte ID "${String(s.id)}"`);
    else if (ids.has(s.id)) probleme.push(`doppelte ID "${s.id}"`);
    ids.add(s.id);
    if (typeof s.label !== "string" || s.label === "" || /["<>\r\n]/.test(s.label)) probleme.push(`ungültiges Label bei "${String(s.id)}"`);
    if (s.technik !== undefined && /["<>\r\n]/.test(s.technik)) probleme.push(`ungültige Technik bei "${String(s.id)}"`);
  }
  const auffang = schichten.filter((s) => s.muster === null).length;
  if (schichten.length > 0 && auffang !== 1) probleme.push(`genau eine Auffang-Schicht (muster: null) nötig, gefunden: ${auffang}`);
  const wurzelBesitzer = new Map();
  for (const s of schichten) {
    if (!Array.isArray(s.wurzeln) || s.wurzeln.some((w) => typeof w !== "string")) {
      probleme.push(`"${s.id}": wurzeln ist kein Array aus Strings`);
      continue;
    }
    for (const w of s.wurzeln) {
      // Nur schlichte Namen: Regex-Metazeichen würden das abgeleitete Muster verfälschen, eine leere Wurzel träfe alles.
      if (!/^[a-z0-9][a-z0-9-]*$/.test(w)) probleme.push(`"${s.id}": ungültige Wurzel ${JSON.stringify(w)} (leer oder mit Sonderzeichen)`);
      else if (wurzelBesitzer.has(w) && wurzelBesitzer.get(w) !== s.id) probleme.push(`Wurzel "${w}" steht in zwei Schichten ("${wurzelBesitzer.get(w)}" und "${s.id}")`);
      else wurzelBesitzer.set(w, s.id);
    }
  }
  for (const s of schichten) {
    if (!Array.isArray(s.darf)) probleme.push(`"${s.id}": darf ist keine Liste`);
    else for (const z of s.darf) if (!ids.has(z)) probleme.push(`"${s.id}" darf unbekanntes Ziel "${z}" importieren`);
  }
  if (probleme.length) throw new Error(`SCHICHT_MODELL ungültig: ${probleme.join("; ")}`);
}

pruefeModell(SCHICHT_MODELL); // fail-closed beim Laden: ein kaputtes Modell bricht jeden Import dieser Datei

const schichtMit = (id) => SCHICHT_MODELL.schichten.find((s) => s.id === id);
const AUFFANG = SCHICHT_MODELL.schichten.find((s) => s.muster === null);

/** Präsentationsschicht – darf Phaser + alles andere anfassen. */
const PRESENTATION = schichtMit(LAYERS.PRESENTATION).muster;
/** Anwendungs-/Persistenzschicht – muss phaser- und präsentationsfrei bleiben. */
const APPLICATION = schichtMit(LAYERS.APPLICATION).muster;
/** Einstieg/Assets – main bootet bewusst Phaser + Szenen; assets-data hält PNG-Imports. */
const ENTRY = schichtMit(LAYERS.ENTRY).muster;

/** Klassifiziert eine repo-relative src-Datei (POSIX-Pfad) in ihren Schicht-Bucket —
 *  dieselben Grenzen, die der dependency-cruiser erzwingt. Die Muster sind disjunkt; was keins trifft,
 *  gehört der Auffang-Schicht (pure Domäne). */
function layerOf(file) {
  for (const s of SCHICHT_MODELL.schichten) if (s.muster && new RegExp(s.muster).test(file)) return s.id;
  return AUFFANG.id;
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

/** Die Wurzel-Namen (Datei- bzw. Verzeichnis-Segmente) der NICHT-Domäne-Schichten, aus dem Modell abgeleitet:
 *  erst die Schichten mit Modul-Ordnern (Modell-Reihenfolge), dann die reinen Datei-Wurzeln. EINE Quelle für
 *  den Domänen-Glob unten: Domäne = „alles unter src, dessen erstes Segment NICHT hier steht" (Extglob-
 *  Ausschluss). `test/coverage-config.test.ts` beweist die Deckungsgleichheit mit den Mustern. */
const mitWurzeln = SCHICHT_MODELL.schichten.filter((s) => s.wurzeln.length > 0);
const NON_DOMAIN = [...mitWurzeln.filter((s) => !s.nurDatei), ...mitWurzeln.filter((s) => s.nurDatei)].flatMap((s) => s.wurzeln);
const _nd = NON_DOMAIN.join("|");
// Dieselben Namen als vollständige Datei-Token (`ui.ts` statt `ui`) — gebraucht für den
// prä­fix-sicheren Domänen-Glob unten (#539).
const _ndTs = NON_DOMAIN.map((n) => `${n}.ts`).join("|");

/** Glob einer Schicht mit Wurzeln: Einzeldatei UND Modul-Ordner (`{.ts,/**}`), bei reinen Datei-Wurzeln nur `.ts`. */
const globVon = (s) => `src/{${s.wurzeln.join(",")}}${s.nurDatei ? ".ts" : "{.ts,/**}"}`;

/** Glob-Form derselben Schicht-Grenzen (#495) — für Vitests Coverage-`thresholds`, deren
 *  Schlüssel Globs (picomatch), keine RegExps sind. Aus dem Modell abgeleitet (#1392), damit beide Formen
 *  an EINER Stelle stehen; `test/coverage-config.test.ts` bindet die zwei Formen aneinander, indem es für
 *  JEDE echte `src`-Datei prüft, dass GENAU EIN Bucket-Glob greift und dieser mit `layerOf()` (der
 *  RegExp-Wahrheit) übereinstimmt — driftet eines, wird es rot. GENAU EIN Glob je Bucket, damit Vitest die
 *  Schwelle über das ganze Schicht-Aggregat prüft (nicht Datei-Untergruppen zersplittert). Verzeichnisbasiert
 *  und damit Stardew-fest: neue Dateien fallen automatisch in ihren Bucket. Bewusst KEINE globale Schwelle
 *  daneben — jede Datei ist genau einem Bucket zugeordnet (der ganze Sinn: pro Schicht statt Repo-Mittel).
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
  ...Object.fromEntries(mitWurzeln.map((s) => [s.id, globVon(s)])),
  [AUFFANG.id]: `src/{!(${_nd})/**,!(${_ndTs})}`,
};

const D_TS = "\\.d\\.ts$";

/** Pfad-Muster einer Schicht als dependency-cruiser-Bedingung; die Auffang-Schicht ist „src/ ohne alle anderen". */
function bedingung(modell, ziel, alsQuelle) {
  const andere = modell.schichten.filter((s) => s.muster && s.id !== ziel.id).map((s) => s.muster);
  if (ziel.muster) return alsQuelle ? { path: ziel.muster, pathNot: D_TS } : { path: ziel.muster };
  return { path: "^src/", pathNot: [...andere, ...(alsQuelle ? [D_TS] : [])].join("|") };
}

/** Verbotsregeln für dependency-cruiser: je Paar (Schicht → Schicht/Extern), das nicht in `darf` steht, eine Regel
 *  `schicht-<von>-nicht-<nach>`. `.d.ts`-Quellen lösen nie eine Regel aus (reine Typdeklarationen). Prüft das
 *  Modell zuerst: ein kaputtes Modell wirft, statt Regeln mit Lücken zu liefern (fail-closed). */
function verbotsRegeln(modell) {
  pruefeModell(modell);
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

module.exports = { PRESENTATION, APPLICATION, ENTRY, PHASER, LAYERS, layerOf, LABEL_TO_LAYER, NON_DOMAIN, COVERAGE_GLOBS, SCHICHT_MODELL, pruefeModell, verbotsRegeln };
