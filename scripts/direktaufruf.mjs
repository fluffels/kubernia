// Kein Shebang: Lib ohne Einstieg, nur Node-Builtins (wird von jedem Skript mit Direktaufruf-Guard importiert, auch von Hook-Skripten).
/**
 * Direktaufruf-Erkennung (#1906): EINE Quelle für den Guard am Dateiende jedes Einstiegsskripts. Der Wächter
 * `test/harness/direktaufruf.test.ts` lässt keine ausgeschriebene Kopie des Vergleichs mehr zu.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** True, wenn `metaUrl` das gestartete Skript ist (statt von einem Test importiert zu werden). Beide Seiten werden
 *  über `realpath` verglichen: Node löst den Einstieg zu einem echten Pfad auf, `process.argv[1]` bleibt der Pfad des
 *  Aufrufers (macOS: Temp-Ordner unter /var ist ein Symlink nach /private/var; Windows: Junction). */
export const istDirektaufruf = (metaUrl) => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync.native(fileURLToPath(metaUrl)) === realpathSync.native(arg);
  } catch {
    return metaUrl === pathToFileURL(arg).href;
  }
};
