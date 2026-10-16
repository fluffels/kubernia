// Kein Shebang, kein Direktaufruf: Lib für `ticket-lock.mjs` und `claims-pruefen.mjs` (Konvention #1398: Einstiegsskripte importieren
// nicht voneinander, gemeinsamer Code steht in einer Lib). SSOT des Lock-Formats (#1699). Rein, nur `node:path`.
import { join } from "node:path";

/** Ein fremder Lock, der älter ist, gilt als verwaist (Session abgestürzt, bevor ein Worktree entstand). */
export const VERWAIST_MS = 2 * 60 * 60_000;
/** Ein vorhandener Worktree/Branch ohne Aktivität in dieser Zeit ist übernehmbar. */
export const INAKTIV_MS = 30 * 60_000;
/** Eine Lock-Datei, die älter ist, räumt `claim` ab (Session lange tot); über `VERWAIST_MS`, damit ein langer Lauf seinen Lock behält. */
export const ALTLAST_MS = 24 * 60 * 60_000;

/** Lock-Verzeichnis: `<gemeinsames git-Verzeichnis>/<Worktree-Präfix aus der Projekt-Config>locks`, gemeinsam für alle Worktrees einer Maschine. Pur. */
export function lockVerzeichnis({ gemeinsam, praefixWorktree }) {
  return join(gemeinsam, `${praefixWorktree}locks`);
}

/** Lock-Inhalt aus Text oder `null` (kein JSON, kein Objekt, weder `nonce` noch `nonceHash`). Pur. */
export function parseLock(text) {
  try {
    const l = JSON.parse(text);
    return l && typeof l === "object" && (typeof l.nonce === "string" || typeof l.nonceHash === "string") ? l : null;
  } catch {
    return null;
  }
}

/** Jüngstes Lebenszeichen eines Locks in ms: Max aus `erstellt`, `zuletzt.zeit`, Übergabe- und Stopp-Zeitpunkten; nicht endliche entfallen, sonst `null`. Pur. */
export function lebenszeichenMs(lock) {
  if (!lock || typeof lock !== "object") return null;
  const werte = [lock.erstellt, lock.zuletzt?.zeit, lock.uebergabe?.gesetzt, lock.uebergabe?.verbraucht, lock.gestoppt?.gesetzt, lock.gestoppt?.verbraucht]
    .map((t) => (typeof t === "string" ? Date.parse(t) : Number.NaN))
    .filter((w) => Number.isFinite(w));
  return werte.length ? Math.max(...werte) : null;
}

/** Zeitpunkt des Herzschlags (`zuletzt.zeit`) in ms oder `null`; `erstellt` zählt hier bewusst nicht. Pur. */
export function herzschlagMs(lock) {
  const t = Date.parse(lock?.zuletzt?.zeit);
  return Number.isFinite(t) ? t : null;
}

const stand = (v) => (!v ? "keine" : v.verbraucht ? "verbraucht" : "offen");

/** Öffentliche Sicht eines Locks: alle Felder außer `nonce` und `nonceHash`, dazu der Stand von Übergabe und Stopp (`keine`, `offen`, `verbraucht`). Pur. */
export function oeffentlicheSicht(lock) {
  const rest = Object.fromEntries(Object.entries(lock ?? {}).filter(([k]) => k !== "nonce" && k !== "nonceHash"));
  return { ...rest,uebergabeStand: stand(lock?.uebergabe), gestopptStand: stand(lock?.gestoppt) };
}
