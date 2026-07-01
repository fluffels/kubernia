/* ===== KubeQuest – geteilte Sim-Helfer (sim/util.ts) =====
 * Schritt-übergreifende, pure Helfer der Befehls-Module aus dem sim.ts-Datei-Split
 * (#373 ff., Epic #346, ADR 0004): Zufalls-IDs (`randSuffix`) und die monospace-
 * Tabellen-Ausgabe (`pad`/`table`), wie sie `docker ps`, `kubectl get` usw. brauchen.
 *
 * Bewusst Phaser-frei und zustandslos – damit jedes ausgelagerte Befehls-Modul
 * (docker, kubectl, …) sie teilen kann, OHNE nach `sim.ts` zurückzuimportieren
 * (das gäbe einen Import-Zyklus). `sim.ts` und die Befehls-Module importieren hier.
 */
import { asPodName, type PodName } from "./names";
import { nextRandom, hashStr } from "../rng";

/** Zufällige Kleinbuchstaben-/Ziffern-Folge der Länge `len` – für Container-/Image-IDs.
 *  Zieht aus dem globalen Strom (`src/rng.ts`, #492), nicht aus `Math.random` –
 *  seedbar, damit Pod-Namen & IDs reproduzierbar werden. */
export function randSuffix(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(nextRandom() * chars.length)];
  return s;
}

/** Deterministische Cluster-IP (`10.96.x.y`) aus einem Service-Namen – über Aufrufe
 *  hinweg STABIL (kein Zufall, #492), damit ein Service seine IP behält und Tests/
 *  Quest-Checks darauf prüfen können. */
export function clusterIP(name: string): string {
  const h = hashStr(name);
  return "10.96." + (h % 250) + "." + ((h >>> 8) % 250);
}

/** Deterministische Pod-IP (`10.244.1.x`) aus dem Pod-Namen – über Aufrufe hinweg
 *  stabil (kein Zufall, #492); `kubectl describe pod` zeigt nun konsistent dieselbe IP. */
export function podIP(name: string): string {
  return "10.244.1." + (10 + (hashStr(name) % 200));
}

/** Pod-Name im echten Kubernetes-Stil: `<deployment>-<replicaset-hash>-<pod-suffix>`
 *  (z.B. `web-7d8f9c6b54-x2k9p`). Von `sim.ts` (reset/Helm/Argo) UND `sim/kubectl.ts`
 *  (scale/rollout/apply/delete-Self-Healing) gebraucht – darum hier als geteilter Helfer. */
export function makePodName(depName: string): PodName {
  // Intern erzeugt → vertrauenswürdig: ungeprüft branden (der Name ist per Konstruktion gültig).
  return asPodName(depName + "-" + randSuffix(9) + "-" + randSuffix(5));
}

/** Mit Leerzeichen auf Mindestbreite `n` auffüllen (Spalten-Ausrichtung der CLI-Tabellen). */
export function pad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str + "  " : str + " ".repeat(n - str.length);
}

/** Monospace-Tabelle wie echte CLI-Ausgaben (`docker ps`, `kubectl get`): Spaltenbreite
 *  aus Kopf + Zeilen (je +3 Abstand), Zeilenenden getrimmt. */
export function table(headers: string[], rows: (string | number)[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i]).length)) + 3
  );
  const lines = [headers.map((h, i) => pad(h, widths[i])).join("").trimEnd()];
  for (const r of rows) {
    lines.push(r.map((c, i) => pad(c, widths[i])).join("").trimEnd());
  }
  return lines.join("\n");
}
