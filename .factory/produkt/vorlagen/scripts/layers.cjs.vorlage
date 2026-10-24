// Schicht-Definition dieses Repos: die Schichtdaten (ADR 0022 F7).
//
// Hier steht, was dem Repo gehört: Schicht-IDs, Wurzeln, Labels und die erlaubten Import-Richtungen (`SCHICHT_MODELL`).
// Prüfung und Ableitung (Muster, Klassifikation, Coverage-Globs) liegen im Kern `scripts/schichten-kern.cjs`; die
// modellgebundenen Werte unten (`layerOf`, `NON_DOMAIN`, `COVERAGE_GLOBS`) leitet dieser aus dem Modell ab.
//
// Die vier Schicht-IDs (`LAYERS`) sind der Vertrag der Diff-Coverage-Floors (`scripts/check-diffcoverage.mjs`): sie bleiben
// auch hier die vier. Die Wurzeln sind Platzhalter, bis dieses Repo eine eigene Schichtung festlegt: `scripts/cockpit/` und
// `scripts/docs-gen/` sind die einzigen Ordner mit eigener Schicht, alles Übrige unter `scripts/` ist die Auffang-Schicht.
//
// Bewusst .cjs (kein .mjs): Konfigurationen dritter Werkzeuge sind CommonJS und `require`n diese Datei direkt; ESM-Skripte
// ziehen sie über `createRequire`.

const kern = require("./schichten-kern.cjs");

/** Kanonische Schicht-Buckets. */
const LAYERS = {
  PRESENTATION: "praesentation",
  APPLICATION: "anwendung",
  ENTRY: "einstieg",
  DOMAIN: "domaene",
};

/** Quellwurzel dieses Repos: das Verzeichnis, unter dem der Code liegt, mit Slash am Ende (gleich `struktur.quelle` der Projekt-Config). */
const QUELLWURZEL = "scripts/";

/** Schicht-Modell: die EINE Quelle für Muster, `layerOf`, `NON_DOMAIN` und Coverage-Globs. Die Reihenfolge ist die
 *  Diagramm-Reihenfolge von oben nach unten. Imports innerhalb einer Schicht sind immer erlaubt; was nicht in `darf`
 *  steht, ist verboten (fail-closed). `muster: null` = Auffang-Schicht (alles übrige unter der Quellwurzel), genau eine davon. */
const SCHICHT_MODELL = {
  quellwurzel: QUELLWURZEL,
  schichten: [
    { id: LAYERS.ENTRY, label: "Einstieg", wurzeln: ["einstieg"], nurDatei: true, darf: [LAYERS.PRESENTATION, LAYERS.APPLICATION, LAYERS.DOMAIN] },
    { id: LAYERS.PRESENTATION, label: "Oberfläche", wurzeln: ["cockpit"], darf: [LAYERS.ENTRY, LAYERS.APPLICATION, LAYERS.DOMAIN] },
    { id: LAYERS.APPLICATION, label: "Generatoren", wurzeln: ["docs-gen"], darf: [LAYERS.DOMAIN] },
    { id: LAYERS.DOMAIN, label: "Kern-Skripte", wurzeln: [], darf: [] },
  ].map((s) => ({ ...s, muster: s.wurzeln.length ? kern.musterAus(QUELLWURZEL, s.wurzeln, s.nurDatei === true) : null })),
  extern: [],
};

kern.pruefeModell(SCHICHT_MODELL); // fail-closed beim Laden: ein kaputtes Modell bricht jeden Import dieser Datei

/** Klassifiziert eine repo-relative Datei (POSIX-Pfad) in ihren Schicht-Bucket (vom Kern aus dem Modell abgeleitet). */
const layerOf = kern.layerOfAus(SCHICHT_MODELL);
/** Wurzel-Namen der NICHT-Auffang-Schichten (vom Kern abgeleitet). */
const NON_DOMAIN = kern.wurzelnAusserAuffangAus(SCHICHT_MODELL);
/** Coverage-Globs je Schicht-Bucket (vom Kern abgeleitet). */
const COVERAGE_GLOBS = kern.coverageGlobsAus(SCHICHT_MODELL);

module.exports = { LAYERS, layerOf, NON_DOMAIN, COVERAGE_GLOBS, SCHICHT_MODELL };
