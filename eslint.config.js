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
  {
    ignores: ["dist/", "dist-offline/", "dist-devpanel/"],
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
);
