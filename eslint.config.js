// ESLint 9 Flat Config (#389) – ein automatisches Netz für Konsistenz neben dem
// TS-Strict-Typecheck (#81-Ratchet) und dem Architektur-Wächter (#347).
//
// Leitlinie aus dem Ticket: PRAGMATISCH starten, keine Fehler-Flut. „Sinnvolle
// Regeln an, Bestand grün bekommen." Der Linter fängt das, was der Typecheck
// nicht sieht (ungenutzte Variablen, schwebende Promises seit der async-
// IndexedDB-Persistenz #350, leere Blöcke …) – billig im Vergleich zu den
// Test-/Review-Runden, die solche Trivialfehler sonst kosten.
//
// Schichten/Importe bleiben Sache des Architektur-Wächters (.dependency-cruiser.cjs),
// Formatierung ist bewusst NICHT hier (Prettier wäre ein eigenes, optionales Thema) –
// ESLint kümmert sich nur um Code-Qualität, nicht um Stil/Whitespace.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // 1) Was der Linter NIE anfasst: Build-Artefakte. node_modules ignoriert ESLint 9
  //    selbst – die Dist-Ordner aber nicht, also hier explizit raus.
  //    Ebenso `.claude/worktrees/**` (#541): dort liegen vollständige Parallel-Checkouts
  //    anderer Tickets. Ohne diesen Ausschluss scannt ein `eslint .` im Haupt-Checkout
  //    JEDEN Worktree mit – und die #502-Komplexitäts-Suppressions (eslint-suppressions.json,
  //    repo-relative Pfade) greifen dort NICHT, sodass vorbestehende God-Functions als
  //    frische Fehler anschlagen und JEDEN main-Push blockieren, solange irgendein
  //    halbfertiger Worktree existiert. Jeder Worktree wird ohnehin über seinen eigenen
  //    `eslint`-Lauf (aus seiner Wurzel) geprüft.
  {
    ignores: ["dist/", "dist-offline/", "dist-devpanel/", ".claude/worktrees/"],
  },

  // 2) Reine JS-Dateien (diese Config, scripts/*.mjs): nur die JS-Basisregeln,
  //    Node-Globals. Kein TypeScript-Parser/keine Typprüfung nötig.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // 3) TypeScript (src/, test/, vite.config.ts – exakt der tsconfig-Scope).
  //    Typbewusstes Linting via projectService: nötig für no-floating-promises,
  //    das der async-Speicher (#350) konkret motiviert.
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Schwebende Promises sind seit dem async-IndexedDB-Backend (#350) eine
      // echte Fehlerquelle (vergessenes await auf SaveStore-Schreiber). Typbewusst,
      // darum erst durch projectService oben möglich. Das ist der Kern-Mehrwert
      // dieses Linters über den Typecheck hinaus.
      "@typescript-eslint/no-floating-promises": "error",

      // Ungenutzte Variablen: führende Unterstriche sind die bewusste Opt-out-
      // Konvention (z.B. absichtlich ignorierte Callback-Parameter, Rest-Siblings
      // beim Weg-Destrukturieren). Das hält die Regel scharf, ohne legitime Muster
      // zu blockieren.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // `any` ist laut Konvention (AGENTS.md) zu vermeiden. Seit #423 ist der
      // Alt-Bestand aufgeräumt (0 Treffer im ganzen Baum) – darum jetzt als FEHLER,
      // der die CI blockt (zusammen mit `--max-warnings 0` im lint-Script): kein neues
      // `any` rutscht mehr unbemerkt rein. Die wenigen bewusst nötigen Stellen
      // (ThisType-Escape-Hatches GameSelf/UISelf, der lose WorldSceneLike-Struktur-Seam,
      // die Roh-JSON-Korruptions-Fixtures in den Tests) tragen ein begründetes
      // `// eslint-disable-next-line` – das ist der dokumentierte Weg für Ausnahmen.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  // 4) Komplexitäts-/God-Function-Wächter (#502) – NUR Produktionscode (src/**).
  //    Der Dateigröße-Deckel (scripts/check-size.mjs, 800 LOC/Datei) misst nur
  //    physische Zeilen JE DATEI; er sieht die eigentliche God-Function nicht: eine
  //    400-Zeilen-Datei mit einer 300-Zeilen-verschachtelten Funktion, und er
  //    provoziert Zeilen-Zusammenziehen statt kohäsivem Schnitt. Diese drei Regeln
  //    ergänzen genau die Dimensionen, die der Zeilen-Deckel nicht misst:
  //      • complexity            – zyklomatische Komplexität je Funktion (Verzweigungslast)
  //      • max-lines-per-function – Funktionslänge (der per-Funktion-Deckel neben dem per-Datei-Deckel)
  //      • max-depth             – Verschachtelungstiefe (der „300-Zeilen-nested"-Kern)
  //    Bewusst NICHT auf test/** angewandt: Test-Callbacks (describe/it) sind
  //    legitim lang und keine God-Functions – die Regeln zielen auf die Spiel-/
  //    Sim-/Wirtschaftslogik in src/, exakt der Ort der im Ticket genannten God-Functions.
  //
  //    Einführung in eine gewachsene Codebasis OHNE Big-Bang-Refactor: der Bestand
  //    an Verletzungen ist als committete ESLint-Bulk-Suppressions-Baseline
  //    (eslint-suppressions.json) festgehalten – GENAU wie der ALLOWLIST-Ratchet in
  //    check-size.mjs bzw. der Coverage-Ratchet (#495). Jede NEUE oder
  //    VERSCHLECHTERTE Verletzung bricht sofort (die Baseline zählt pro Datei/Regel);
  //    wird eine God-Function aufgeteilt, meldet ESLint den stale Suppressions-Eintrag
  //    (`npm run lint` rot) bis er per `npm run lint:prune` entfernt ist – dieselbe
  //    „stale-Eintrag wird gemeldet"-Disziplin wie beim Dateigröße-Wächter. Der
  //    Abbau der Baseline läuft über session-große Burn-down-Tickets (Diff-Size-Gate #533).
  {
    files: ["src/**/*.ts"],
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-lines-per-function": [
        "error",
        { max: 120, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // 5) Determinismus-Wächter (#492): In der puren Domäne (src/sim/**) und im
  //    Content (src/content/**) ist `Math.random` verboten – die Schicht ist als
  //    deterministisch/testbar deklariert. Zufall kommt ausschließlich aus dem
  //    SSOT src/core/rng.ts (`nextRandom`/`hashStr`), damit snapshot()-Round-trips
  //    wertstabil sind, Pod-Namen/IPs auf konkrete Namen prüfbar werden und ein
  //    „Seed teilen" nachrüstbar bleibt. Doppelt gesichert durch die Fitness-
  //    Function test/rng.test.ts (läuft auch im reinen `npm test`).
  {
    files: ["src/sim/**/*.ts", "src/content/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Kein Math.random in Domäne/Content (#492): nutze src/core/rng.ts – nextRandom() für einen seedbaren Strom, hashStr()/hashHex() für aus Namen abgeleitete stabile Werte.",
        },
      ],
    },
  },
);
