/* ===== KubeQuest – Zufall & Determinismus (rng.ts) =====
 * Querschnitts-SSOT für „Zufall" in der puren Domäne + Content (#492).
 *
 * Warum überhaupt: Die Domäne ist als deterministisch/testbar deklariert, streute
 * aber ungeseedetes `Math.random` (Pod-Namen, clusterIPs, Image-Größen, Drill-
 * Auswahl). Wirkung bei Stardew-Scope: `snapshot()`-Round-trips waren nicht
 * wertstabil (kein Golden-Master-/Property-Test möglich), Pod-Namen/IPs zufällig
 * (Quest-Checks/Tests konnten nie auf konkrete Namen prüfen), ein späteres
 * „Seed teilen"-Feature nicht nachrüstbar. Dieses Modul bündelt beides:
 *
 *  1. `hashStr`/`hashHex` – deterministische, aus einem NAMEN abgeleitete Werte,
 *     die über Aufrufe hinweg STABIL bleiben (clusterIP, Pod-IP, Image-ID/-Größe).
 *     Ein Service behält so seine IP; Lesebefehle (`kubectl get`, `docker images`)
 *     perturbieren nichts. Vorbild: der bisherige Metrik-Hash in observability.ts.
 *  2. `mulberry32` + globaler Strom (`nextRandom`) – wo wirklich ein Strom
 *     eindeutiger Werte gebraucht wird (Pod-Namen-Suffixe, Container-IDs, Drill-
 *     Varianten). Seedbar → reproduzierbare Läufe; `game/spaced-repetition.ts`
 *     macht die rand-Injektion bereits vor.
 *
 * Bewusst Phaser-frei und importfrei (Leaf-Modul → kein Zyklus). Es ist die EINE
 * Stelle im Baum, an der Zufall entsteht; `src/sim/**` und `src/content/**` dürfen
 * `Math.random` nicht mehr nutzen (ESLint `no-restricted-properties` + Fitness-
 * Function `test/rng.test.ts`).
 */

/** mulberry32 – winziger, schneller, seedbarer 32-Bit-PRNG. Gleicher Seed →
 *  gleiche Zahlenfolge (reproduzierbare Tests/Snapshots, künftig „Seed teilen").
 *  Liefert eine Funktion, die bei jedem Aufruf die nächste Zahl in [0,1) gibt. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stabiler FNV-1a-Hash: fester Zahlenwert (uint32) aus einem String. Deterministisch –
 *  gleicher Name → gleicher Wert. Grundlage für aus Namen abgeleitete, über Aufrufe
 *  hinweg STABILE Werte (clusterIP, Pod-IP, Image-Größe/-ID …), damit Tests/Quest-Checks
 *  auf konkrete Namen/Adressen prüfen können. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministische Hex-ID fester Länge aus einem Namen (stabile Docker-Image-IDs
 *  o.ä.) – rein aus `hashStr` abgeleitet, kein Zufall, über Aufrufe hinweg stabil. */
export function hashHex(s: string, len: number): string {
  let out = "";
  let h = hashStr(s);
  while (out.length < len) {
    out += h.toString(16).padStart(8, "0");
    h = hashStr(out);
  }
  return out.slice(0, len);
}

// ---- Globaler Zufallsstrom: die EINE Quelle für „Zufall" in Domäne + Content
// (ersetzt Math.random dort, #492). Bewusst mit FESTEM Start-Seed: die Domäne ist
// damit von Haus aus deterministisch (der Determinismus-Anspruch wird real, Tests/
// Snapshots sind stabil). Variabilität innerhalb einer Sitzung entsteht durch das
// Fortschreiten des Stroms; für reproduzierbare Läufe bzw. „Seed teilen" (künftig)
// lässt er sich per `seedGlobalRng()` neu setzen (Tests: known-start pro Fall).
const DEFAULT_SEED = 0x9e3779b9;
let _gen: () => number = mulberry32(DEFAULT_SEED);

/** Setzt den globalen Zufallsstrom neu (Tests: reproduzierbarer Start; künftig:
 *  „Seed teilen"). */
export function seedGlobalRng(seed: number): void {
  _gen = mulberry32(seed >>> 0);
}

/** Die nächste Zufallszahl in [0,1) aus dem globalen Strom – der SSOT-Ersatz für
 *  `Math.random` in `src/sim/**` und `src/content/**`. */
export function nextRandom(): number {
  return _gen();
}
