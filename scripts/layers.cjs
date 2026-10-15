// Schicht-Definition dieses Projekts: die Schichtdaten (#482, ADR 0022 F7).
//
// Hier steht, was dem Projekt gehört: Schicht-IDs, Wurzeln, Labels und die erlaubten Import-Richtungen
// (`SCHICHT_MODELL`). Prüfung und Ableitung (Muster, Klassifikation, Coverage-Globs, die Regeln von `check:arch`)
// liegen im Kern `scripts/schichten-kern.cjs`; die modellgebundenen Werte unten (`layerOf`, `NON_DOMAIN`,
// `COVERAGE_GLOBS`) leitet dieser aus dem Modell ab. Der dependency-cruiser-Config (.dependency-cruiser.cjs), die
// Vitest-Coverage und die Wächter `require`n diese Datei; der ESM-Wächter zieht sie über `createRequire`.
//
// Bewusst .cjs (kein .mjs): der dependency-cruiser-Config ist CommonJS und `require`t das hier direkt.

const kern = require("./schichten-kern.cjs");

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

/** Quellwurzel dieses Projekts (#1373): das Verzeichnis, unter dem der Code liegt, mit Slash am Ende. Die EINE
 *  Stelle für Muster, Globs, Regeln und Diagramm (ein fremdes Repo setzt hier z.B. `wetter/`). Cruise-Ziel und
 *  Collapse (docs-gen-Config), Coverage-`include` (vite.config.ts) und die Waisen-Ausnahmen in
 *  .dependency-cruiser.cjs nennen den Ordner weiterhin selbst. */
const QUELLWURZEL = "src/";

/** Schicht-Modell (#1368, #1392): die EINE Quelle für Muster, `layerOf`, `NON_DOMAIN`, Coverage-Globs, die
 *  Regeln von `check:arch` und die Diagramme (`scripts/docs-gen/schichten.mjs`): Diagramm == geprüfte Regel. Die
 *  Reihenfolge ist die Diagramm-Reihenfolge von oben nach unten. Imports innerhalb einer Schicht sind immer erlaubt;
 *  was nicht in `darf` steht, ist verboten (fail-closed).
 *  `quellwurzel` ist das Code-Verzeichnis (Pflicht, `src/` hier). Eine Schicht besteht aus `wurzeln` (oberste Ebene
 *  unter der Quellwurzel; der Ist-Collapse in scripts/docs-gen/config.json verdichtet auf genau diese Ebene),
 *  `nurDatei` markiert reine Datei-Wurzeln (Einstieg/Assets, kein Modul-Ordner). `muster` wird daraus abgeleitet;
 *  `muster: null` = Auffang-Schicht (alles übrige unter der Quellwurzel, ohne Wurzeln), genau eine davon. Der Kern
 *  prüft das Modell (`pruefeModell`) vor jeder Ableitung. */
const SCHICHT_MODELL = {
  quellwurzel: QUELLWURZEL,
  schichten: [
    { id: LAYERS.ENTRY, label: "Einstieg/Assets", wurzeln: ["main", "assets-data"], nurDatei: true, darf: [LAYERS.PRESENTATION, LAYERS.APPLICATION, LAYERS.DOMAIN, "phaser"] },
    { id: LAYERS.PRESENTATION, label: "Präsentation", technik: "Phaser/DOM", wurzeln: ["scenes", "ui", "sfx"], darf: [LAYERS.ENTRY, LAYERS.APPLICATION, LAYERS.DOMAIN, "phaser"] },
    { id: LAYERS.APPLICATION, label: "Anwendung/Persistenz", wurzeln: ["game", "runtime", "devpanel", "store"], darf: [LAYERS.DOMAIN] },
    { id: LAYERS.DOMAIN, label: "pure Domäne", wurzeln: [], darf: [] },
  ].map((s) => ({ ...s, muster: s.wurzeln.length ? kern.musterAus(QUELLWURZEL, s.wurzeln, s.nurDatei === true) : null })),
  extern: [{ id: "phaser", label: "Phaser", muster: PHASER }],
};

kern.pruefeModell(SCHICHT_MODELL); // fail-closed beim Laden: ein kaputtes Modell bricht jeden Import dieser Datei

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

/** Klassifiziert eine repo-relative src-Datei (POSIX-Pfad) in ihren Schicht-Bucket (vom Kern aus dem Modell abgeleitet). */
const layerOf = kern.layerOfAus(SCHICHT_MODELL);
/** Wurzel-Namen der NICHT-Domäne-Schichten (vom Kern abgeleitet). */
const NON_DOMAIN = kern.wurzelnAusserAuffangAus(SCHICHT_MODELL);
/** Coverage-Globs je Schicht-Bucket (vom Kern abgeleitet, für Vitests `thresholds`). */
const COVERAGE_GLOBS = kern.coverageGlobsAus(SCHICHT_MODELL);

module.exports = { PHASER, LAYERS, layerOf, LABEL_TO_LAYER, NON_DOMAIN, COVERAGE_GLOBS, SCHICHT_MODELL };
