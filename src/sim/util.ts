/* ===== Kubernia – geteilte Sim-Helfer (sim/util.ts) =====
 * Schritt-übergreifende, pure Helfer der Befehls-Module aus dem sim.ts-Datei-Split
 * (#373 ff., Epic #346, ADR 0004): Zufalls-IDs (`randSuffix`) und die monospace-
 * Tabellen-Ausgabe (`pad`/`table`), wie sie `docker ps`, `kubectl get` usw. brauchen.
 *
 * Bewusst Phaser-frei und zustandslos – damit jedes ausgelagerte Befehls-Modul
 * (docker, kubectl, …) sie teilen kann, OHNE nach `sim.ts` zurückzuimportieren
 * (das gäbe einen Import-Zyklus). `sim.ts` und die Befehls-Module importieren hier.
 */
import { asPodName, type PodName } from "./names";
import { hashStr } from "../core/rng";

/** Zufällige Kleinbuchstaben-/Ziffern-Folge der Länge `len` – für Container-/Image-IDs.
 *  Zieht aus dem übergebenen Strom `rng` (#580) statt aus dem globalen `nextRandom`:
 *  jede `Sim`-Instanz reicht ihren EIGENEN, in `reset()` geseedeten Strom durch (wie den
 *  `clock`), damit Pod-Namen/IDs nur an der Instanz hängen, nicht an der globalen Ausführungs-
 *  reihenfolge. Kein `Math.random` (Determinismus-SSOT, #492). */
export function randSuffix(len: number, rng: () => number, chars = "abcdefghijklmnopqrstuvwxyz0123456789"): string {
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(rng() * chars.length)];
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

/** Adresse und Name der Control-Plane: kubeadm-Static-Pods laufen mit hostNetwork und teilen sich ihre IP (#1466);
 *  dieselbe Adresse nennt `kubeadm join` als API-Server. */
export const CONTROL_PLANE_IP = "10.0.0.10";
export const CONTROL_PLANE_NODE = "ahoi-control";

/** Name des n-ten Worker-Knotens (`ahoi-worker-<n>`, ab 1): die EINE Namenskonvention der Sim (#1483). */
export const workerNodeName = (n: number): string => "ahoi-worker-" + n;

/** Labels und Selektoren sind Maps (Schlüssel → Wert); jeder Text (`app=x,tier=y`) wird daraus abgeleitet (#1500). */
export type Labels = Readonly<Record<string, string>>;

/** Das Label (und der Selektor), das ein Workload in der Sim trägt: `{ app: <name> }` (Grenze `selektor-ueber-namen`). */
export const workloadLabels = (name: string): Labels => ({ app: name });

/** Labels als Text, wie `kubectl` sie zeigt (`labels.FormatLabels`): Schlüssel sortiert, `k=v` mit Komma verbunden,
 *  `null` oder leer als `<none>`. Der Wert darf `=` enthalten, er wird nicht zerlegt. */
export function formatLabels(labels: Labels | null): string {
  const keys = labels ? Object.keys(labels).sort() : [];
  return keys.length === 0 ? "<none>" : keys.map(k => k + "=" + labels![k]).join(",");
}

/** Label und Selektor eines Workloads als Text `app=<name>`: der EINE Helfer statt der handgeschriebenen Konvention (#1483). */
export const workloadSelector = (name: string): string => formatLabels(workloadLabels(name));

/** Alter der eingebauten Objekte (kubeadm-Static-Pods, CoreDNS, Service und Endpoints `kubernetes`, Nodes):
 *  sie existieren seit Clusteraufbau, nicht seit dem Spielstart (#1483). */
export const BUILTIN_AGE = "3d";

/** Deterministische Adresse (`203.0.113.100–249`, TEST-NET-3) hinter einem ExternalName-CNAME-Ziel:
 *  je Ziel stabil, `.10` bleibt dem Ingress vorbehalten (#1403). */
export function externalIP(name: string): string {
  return "203.0.113." + (100 + (hashStr(name) % 150));
}

/** Das Alphabet, aus dem Kubernetes Pod-Suffixe und pod-template-hashes zieht (`rand.alphanums`):
 *  keine Vokale und keine Ziffern 0, 1, 3 – so entstehen keine lesbaren Wörter. */
export const K8S_ALPHANUMS = "bcdfghjklmnpqrstvwxz2456789";
/** Länge des zufälligen Pod-Suffixes (`<dep>-<hash>-<suffix>`). */
export const POD_SUFFIX_LEN = 5;

/** Kodiert einen Hash-Wert wie `rand.SafeEncodeString`: je Zeichen des Dezimaltexts
 *  (Zeichen-Code mod 27) ein Zeichen aus `K8S_ALPHANUMS`. Pur und deterministisch. */
export function safeEncode(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += K8S_ALPHANUMS[s.charCodeAt(i) % K8S_ALPHANUMS.length];
  return out;
}

/** Pod-Name im echten Kubernetes-Stil: `<deployment>-<pod-template-hash>-<pod-suffix>`
 *  (z.B. `web-7d8f9c6b54-x2k9p`). Der Hash gehört dem ReplicaSet und ist für alle Pods eines
 *  Deployments gleich (`sim/replicasets.ts`), nur der 5-stellige Suffix ist zufällig. Von
 *  `sim/workload.ts` (scale/rollout/heal) gebraucht – darum hier als geteilter Helfer. */
export function makePodName(depName: string, hash: string, rng: () => number): PodName {
  // Intern erzeugt → vertrauenswürdig: ungeprüft branden (der Name ist per Konstruktion gültig).
  return asPodName(depName + "-" + hash + "-" + randSuffix(POD_SUFFIX_LEN, rng, K8S_ALPHANUMS));
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

/* ---------- Eingabe-Parsing: Vorschläge (#499) ----------
 * Reine, zustandslose Helfer, die vorher als `_editDistance`/`_suggest`-Methoden in sim.ts hingen. Da sie kein bisschen Cluster-Zustand brauchen,
 * gehören sie hierher zu den geteilten Sim-Helfern – das hält den sim.ts-Kern unter dem
 * God-File-Budget und verschmälert die Host-Interfaces (KubectlHost/DockerHost/…), die
 * sie sonst als Methode durchreichen mussten. */

/** Editierdistanz (Levenshtein) – Basis für „Meintest du …?"-Vorschläge (`suggest`). */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i].concat(new Array(n).fill(0)));
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
  }
  return d[m][n];
}

/** Nächstliegendes bekanntes Wort, wenn nah genug dran (sonst null). */
export function suggest(word: string, list: string[]): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const cand of list) {
    const dist = editDistance(word.toLowerCase(), cand.toLowerCase());
    if (dist < bestD) { bestD = dist; best = cand; }
  }
  const limit = word.length <= 4 ? 1 : 2; // bei kurzen Wörtern strenger
  return bestD <= limit && bestD > 0 ? best : null;
}

/** Speicherangabe wie "256Mi", "1Gi", "512M" in Mi umrechnen (null bei Unsinn). */
export function parseMem(spec: string): number | null {
  const m = spec.match(/^(\d+)(Mi|Gi|M|G)?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2] || "Mi";
  if (unit === "Gi" || unit === "G") return n * 1024;
  return n; // Mi / M ~ als Mi behandeln (didaktisch genau genug)
}

/** CPU-Angabe wie "250m", "1", "0.5" in Milli-Cores umrechnen (null bei Unsinn). Ganze und
 *  gebrochene Cores (höchstens 3 Nachkommastellen, kleiner geht nicht) werden ×1000 genommen. */
export function parseCpuMilli(spec: string): number | null {
  const milli = spec.match(/^(\d+)m$/);
  if (milli) return parseInt(milli[1], 10);
  const cores = spec.match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (!cores) return null;
  return parseInt(cores[1], 10) * 1000 + (cores[2] ? parseInt(cores[2].padEnd(3, "0"), 10) : 0);
}
