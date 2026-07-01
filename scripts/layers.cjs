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

module.exports = { PRESENTATION, APPLICATION, ENTRY, LAYERS, layerOf, LABEL_TO_LAYER };
