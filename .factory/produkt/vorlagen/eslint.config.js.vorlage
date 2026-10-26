// ESLint-Flat-Config des Factory-Repos: JS-Basisregeln für die Skripte, typbewusste TypeScript-Regeln für die Tests.
// Formatierung ist bewusst nicht Sache des Linters. Ein rotes Gate wird durch Beheben der Ursache grün, nie durch Aufweichen.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import vitest from "@vitest/eslint-plugin";
import regexp from "eslint-plugin-regexp";

export default tseslint.config(
  // Worktrees paralleler Tickets sind vollständige Checkouts und gehören nicht in den Lauf des Hauptordners.
  {
    ignores: ["dist/", ".claude/worktrees/"],
  },

  // Regex-Falle: eine leere Alternative (`/a|/`, `(a|)`) matcht überall und ist fast immer ein Tippfehler.
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    plugins: { regexp },
    rules: { "regexp/no-empty-alternative": "error" },
  },

  // Reine JS-Dateien (diese Config, scripts/*.mjs): JS-Basisregeln und Node-Globals.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // TypeScript (test/, vite.config.ts, exakt der tsconfig-Scope), typbewusst über projectService.
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      // Führende Unterstriche sind die bewusste Opt-out-Konvention für ignorierte Parameter und Rest-Geschwister.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },

  // Komplexität je Funktion in den Skripten: eine God-Function sieht der Dateigröße-Deckel (check:size) nicht. Der Bestand ist als Bulk-Suppressions-Baseline
  // (eslint-suppressions.json) eingefroren, eine neue oder verschlechterte Verletzung bricht sofort, ein stale Eintrag meldet `npm run lint` bis
  // `npm run lint:prune` ihn entfernt. Bewusst nicht auf test/** (Test-Callbacks sind legitim lang). Deckel wie im Quell-Repo (hält gate-satz.test.ts).
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-lines-per-function": ["error", { max: 120, skipBlankLines: true, skipComments: true }],
    },
  },

  // Test-Wächter: ein `expect` im if-/catch-/?:-Zweig wird nie rot, wenn der Zweig nie läuft (falsches Grün).
  {
    files: ["test/**/*.ts"],
    plugins: { vitest },
    rules: { "vitest/no-conditional-expect": "error" },
  },
);
