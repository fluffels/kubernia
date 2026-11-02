// Blatt-Modul (#101): Format und Leser des Sync-Stands `.factory/sync-stand.json`. Nur Node-Builtins und `repo-form.mjs` (kein Zyklus über die Config-Lib);
// `factory-sync-lib` führt die Namen weiter (Bezieher-Skripte importieren von dort), Leser-Skripte importieren direkt.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { istRepoForm } from "./repo-form.mjs";

/** Pfad des Sync-Stands im Projekt (Schrägstrich-Form, relativ zur Wurzel). */
export const STAND_PFAD = ".factory/sync-stand.json";

/**
 * Pur: der Sync-Stand aus seinem Dateitext (#97). `zustand`: `fehlt` (kein Text: kein Bezieher), `kaputt` (kein JSON oder kein Objekt, auch `null`,
 * Liste, Zahl) oder `ok` mit dem Objekt in `stand`. Der einzige Leser des Formats; `stand` ist sonst `null`.
 */
export function syncStandAusText(text) {
  if (text === null || text === undefined) return { zustand: "fehlt", stand: null };
  try {
    const stand = JSON.parse(text);
    if (stand === null || typeof stand !== "object" || Array.isArray(stand)) return { zustand: "kaputt", stand: null };
    return { zustand: "ok", stand };
  } catch {
    return { zustand: "kaputt", stand: null };
  }
}

/** Pur: das `repo` (`owner/name`) der Projekt-Config der Quelle (Dateitext oder `null`); `undefined`, wenn es fehlt, keine Form hat oder die Datei kaputt ist. */
export function quelleRepoAusText(text) {
  try {
    const repo = JSON.parse(text ?? "null")?.repo;
    return istRepoForm(repo) ? repo : undefined;
  } catch {
    return undefined;
  }
}

/** Liest den Sync-Stand eines Projekts (`syncStandAusText`); eine nicht lesbare Datei zählt als `fehlt`. Wirft nie. */
export function liesSyncStand(wurzel) {
  let text = null;
  try {
    text = readFileSync(join(wurzel, ...STAND_PFAD.split("/")), "utf8");
  } catch {
    // keine Datei: fehlt.
  }
  return syncStandAusText(text);
}
