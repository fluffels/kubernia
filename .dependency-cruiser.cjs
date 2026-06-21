// Architektur-Wächter (#347) – hält die Schichtung aus AGENTS.md automatisch ein,
// statt sie nur per Review-Disziplin zu hoffen. Befund #292 (game.ts → sfx.ts) hatte
// gezeigt, dass sich eine Verletzung sonst unbemerkt einschleicht.
//
// Schichten (siehe AGENTS.md › Architektur, CLAUDE.md › Repo-Landkarte):
//   • pure Domäne      – Phaser-frei, im Node-Test prüfbar (sim, content*, world, decor,
//                        clock, …). Darf NICHT phaser und NICHT die Präsentation importieren.
//   • Anwendung        – game, runtime, devpanel, store (Persistenz). Wie Domäne: kein
//                        phaser, keine Präsentation; darf nur nach „unten" (Domäne) greifen.
//   • Präsentation     – scenes, ui, sfx. Darf alles (nach unten offen) – keine Regel.
//   • Einstieg/Assets  – main (bootet Phaser + Szenen), assets-data. Bewusst ausgenommen.
//
// Umgesetzt als Negativ-Regel ("alles außer Präsentation/Einstieg bleibt rein"), damit der
// Wächter bei Stardew-Scope mitwächst: jedes NEUE Domänen-Modul ist automatisch geschützt,
// ohne dass man es hier nachträgt.

/** Präsentationsschicht – darf Phaser + alles andere anfassen. Deckt sowohl die
 *  Einzeldatei (src/ui.ts, src/sfx.ts) als auch die Modul-Ordner ab (src/scenes/*
 *  seit dem scenes.ts-Split #345; analog künftig src/ui/*). */
const PRESENTATION = "^src/(scenes|ui|sfx)(\\.ts$|/)";
/** Anwendungs-/Persistenzschicht – muss phaser- und präsentationsfrei bleiben. Deckt sowohl
 *  die Einzeldatei (src/game.ts, src/store.ts …) als auch den Modul-Ordner src/game/* ab
 *  (game.ts-Split #392, analog zu src/scenes/* #345 und src/ui/* #356). */
const APPLICATION = "^src/(game|runtime|devpanel|store)(\\.ts$|/)";
/** Einstieg/Assets – main bootet bewusst Phaser + Szenen; assets-data hält PNG-Imports. */
const ENTRY = "^src/(main|assets-data)\\.ts$";
/** Phaser, egal über welchen aufgelösten Pfad (Pfad beginnt mit `node_modules/…`, kein führender Slash). */
const PHASER = "node_modules[/\\\\]phaser[/\\\\]";

module.exports = {
  forbidden: [
    {
      name: "domaene-kein-phaser",
      comment:
        "Pure Domäne muss Phaser-frei bleiben (im Node-Test prüfbar). Logik gehört nicht " +
        "in die Präsentationsschicht – siehe AGENTS.md › Architektur.",
      severity: "error",
      from: { path: "^src/", pathNot: `${PRESENTATION}|${APPLICATION}|${ENTRY}|\\.d\\.ts$` },
      to: { path: PHASER },
    },
    {
      name: "domaene-keine-praesentation",
      comment:
        "Pure Domäne darf scenes/ui/sfx NICHT importieren (Schichtung von unten nach oben).",
      severity: "error",
      from: { path: "^src/", pathNot: `${PRESENTATION}|${APPLICATION}|${ENTRY}|\\.d\\.ts$` },
      to: { path: PRESENTATION },
    },
    {
      name: "anwendung-kein-phaser",
      comment:
        "Anwendung/Persistenz (game/runtime/devpanel/store) muss Phaser-frei bleiben.",
      severity: "error",
      from: { path: APPLICATION },
      to: { path: PHASER },
    },
    {
      name: "anwendung-keine-praesentation",
      comment:
        "Anwendung/Persistenz darf scenes/ui/sfx NICHT importieren (nur nach unten in die Domäne).",
      severity: "error",
      from: { path: APPLICATION },
      to: { path: PRESENTATION },
    },
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
