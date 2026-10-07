// Architektur-Wächter (#347) – hält die Schichtung aus AGENTS.md automatisch ein,
// statt sie nur per Review-Disziplin zu hoffen. Befund #292 (game.ts → sfx.ts) hatte
// gezeigt, dass sich eine Verletzung sonst unbemerkt einschleicht.
//
// Schichten (siehe AGENTS.md › Architektur, docs/referenz/schichtregeln.md): pure Domäne,
// Anwendung/Persistenz, Präsentation, Einstieg/Assets. Die erlaubten Import-Richtungen stehen als
// Positivliste in SCHICHT_MODELL (scripts/layers.cjs); verbotsRegeln() leitet daraus je verbotenem
// Paar eine Regel ab, und dieselbe Tabelle erzeugt die Schichtdiagramme (npm run docs:gen).
// Neue Domänen-Module sind automatisch geschützt (Auffang-Schicht „alles übrige unter src/“),
// eine neue Schicht muss ihre Richtungen im Modell deklarieren.
const { SCHICHT_MODELL, verbotsRegeln } = require("./scripts/layers.cjs");

module.exports = {
  forbidden: [
    ...verbotsRegeln(SCHICHT_MODELL),
    // ── Architektur-Unit-Tests über die Schichtung hinaus (#390) ──────────────
    {
      name: "keine-zyklen",
      comment:
        "Import-Zyklen sind verboten (#390). Genau dafür gibt es das runtime.ts-/Host-Interface-" +
        "Muster – zyklenfreie Module bleiben bei Stardew-Scope les-, test- und tree-shake-bar. " +
        "Zyklus auflösen (z.B. geteilten Zustand nach runtime.ts ziehen), nicht die Regel aufweichen.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "keine-verwaisten-module",
      comment:
        "Verwaiste Module (nichts importiert sie, sie importieren nichts) sind toter Code (#390). " +
        "Einbinden oder löschen. Bewusste Ausnahmen hier per pathNot dokumentieren (mit Begründung).",
      severity: "error",
      from: {
        orphan: true,
        pathNot: [
          // Reine Typdeklarationen sind per Definition „verwaist“ (kein Laufzeit-Import) – kein toter Code.
          "\\.d\\.ts$",
          // Lernpfad-Wächter: enthält Domänenlogik (lernpfadVerstoesse + introOrderFromContent), die
          // bewusst NUR der Test-Wächter test/learnorder.test.ts aufruft – kein src-Laufzeit-Import. Da
          // check:arch nur `src` cruist, gilt das Modul sonst fälschlich als verwaist (#390).
          "^src/content/learnorder\\.ts$",
          // Quiz-Korrektheits-Wächter (#597): reine Prüflogik (correctAnswers/snapshotViolations/
          // indexConventionViolations), die bewusst NUR der Test-Wächter test/quizcheck.test.ts
          // aufruft – kein src-Laufzeit-Import, genau wie learnorder.ts darüber.
          "^src/content/quizcheck\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    // TS-Pfade sauber auflösen.
    tsConfig: { fileName: "tsconfig.json" },
    // Typ-Importe (`import type …`) als Abhängigkeit MITzählen (#390). Ohne das gelten reine
    // Typ-Module wie types.ts/sim/state.ts als „verwaist" (der Import wird wegkompiliert) und
    // Zyklen über Typen blieben unsichtbar. Mit dieser Option sieht der Wächter den echten Graphen.
    tsPreCompilationDeps: true,
    // node_modules als Ziel erfassen (für die Phaser-Grenze), aber nicht hineincruisen.
    // (Kein includeOnly: "^src/" – das würde die Kante zu node_modules/phaser
    //  herausfiltern, sodass die Phaser-Grenze nie anschlagen könnte. Der CLI-Aufruf
    //  `depcruise src` begrenzt die Einstiegspunkte bereits auf den Quellcode.)
    doNotFollow: { path: "node_modules" },
  },
};
