// Blatt-Modul ohne Importe (#101): die Prüfung eines repo-relativen POSIX-Pfads. `arbeitsplatz-lib` und `projekt-config-lib` importieren direkt (kein Re-Export, factory#114).

/** Pur: ein relativer POSIX-Pfad (`src`, `docs/module`): kein absoluter Pfad, kein Laufwerk, keine `.`/`..`-Segmente, kein Backslash, kein End- oder Doppel-Slash. */
export function istRelativPosix(pfad) {
  if (pfad.includes("\\") || pfad.includes(":")) return false;
  return pfad.split("/").every((teil) => teil !== "" && teil !== "." && teil !== "..");
}

/** Vereinheitlicht Pfad-Trenner auf POSIX (und entfernt ein führendes `./`). Nötig, weil der v8-lcov-Reporter unter Windows `SF:src\sim\pods.ts` schreibt,
 *  `git diff` aber `src/sim/pods.ts`: ohne Normalisierung fände der Schnitt nie einen Treffer und das Gate wäre still blind. */
export function normalizePath(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}
