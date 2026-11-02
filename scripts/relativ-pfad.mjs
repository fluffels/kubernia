// Blatt-Modul ohne Importe (#101): die Prüfung eines repo-relativen POSIX-Pfads. `arbeitsplatz-lib` führt sie weiter, `projekt-config-lib` importiert direkt.

/** Pur: ein relativer POSIX-Pfad (`src`, `docs/module`): kein absoluter Pfad, kein Laufwerk, keine `.`/`..`-Segmente, kein Backslash, kein End- oder Doppel-Slash. */
export function istRelativPosix(pfad) {
  if (pfad.includes("\\") || pfad.includes(":")) return false;
  return pfad.split("/").every((teil) => teil !== "" && teil !== "." && teil !== "..");
}
