/* ===== KubeQuest – Observability (sim/observability.ts) =====
 * Folge zum sim.ts-Datei-Split (#384, aus Epic #346, ADR 0004). Nach den sieben
 * Befehlsfamilien-Splits (#372–#378) liegt hier die nächste kohärente
 * Nicht-Befehls-Familie aus sim.ts: die Observability-Grundlage (#109/#110).
 *
 * Inhalt: deterministische Pod-/Node-Metriken (für `kubectl top` + Prometheus),
 * Prometheus-Scrape-Targets sowie die Alert-Regeln samt firing→resolved-Verlauf
 * des simulierten Alertmanagers. Wie die Befehls-Splits als freie Funktionen
 * ausgelagert, die die Sim-Instanz über das schmale `ObservabilityHost`-Interface
 * bekommen – so bleibt der Cluster-Zustand in EINER Hand (die `Sim`-Klasse), die
 * Observability-Logik aber in einer eigenen, testbaren Datei.
 *
 * Öffentliche API bleibt auf der Sim-Klasse: `Sim.podMetrics()/nodeMetrics()/
 * scrapeTargets()/alerts()` delegieren nur noch hierher, damit die vielen
 * Aufrufer (kubectl get/top über `KubectlHost`, content/checks + content/drills,
 * Tests) unverändert `sim.podMetrics()` & Co. nutzen können. `exec` in sim.ts ruft
 * vor jeder Eingabe `evaluateAlerts(this)`, damit der firing→resolved-Verlauf
 * mitläuft.
 *
 * Phaser-frei (pure Domäne): Domänentypen aus ./state – kein Rückimport nach
 * sim.ts (kein Zyklus). Der deterministische Namens-Hash (`hashStr`) kommt seit
 * #492 aus dem Zufall-/Determinismus-SSOT `src/rng.ts` (vorher hier lokal) – dieselbe
 * FNV-1a-Idee, jetzt an EINER Stelle für alle aus Namen abgeleiteten stabilen Werte.
 */
import type { ClusterState, Deployment, PodInstance, PodMetrics, NodeMetrics, ScrapeTarget, Alert } from "./state";
import { hashStr } from "../core/rng";
import { isControlPlane } from "./nodes";

/** Was die Observability vom Simulator braucht (von der `Sim`-Klasse erfüllt).
 *  Bewusst schmal: die Daten-Felder (`deployments`/`nodes`/`services`) kommen über
 *  `extends ClusterState` (sim/state.ts, #372); hinzu kommen der Sim-Helfer
 *  `_podReady` und der transiente Alert-Sitzungszustand (`_firingAlerts`/
 *  `_resolvedAlerts` – kein Cluster-Zustand, darum NICHT in ClusterState, sondern
 *  Host-Felder wie kubectls `lastDeletedPod`). */
export interface ObservabilityHost extends ClusterState {
  _podReady(d: Deployment): boolean;
  _firingAlerts: Set<string>;   // brennt gerade
  _resolvedAlerts: Set<string>; // war mal an, Ursache inzwischen behoben
}

/** Momentane Ressourcen-Last eines Pods – oder null, wenn der Container gar nicht
 *  läuft (ImagePull/Pending), dann gibt es schlicht keine Metriken. Deterministisch
 *  aus dem Pod-Namen abgeleitet, damit `kubectl top` über Aufrufe hinweg stabil bleibt. */
function podMetric(d: Deployment, p: PodInstance): PodMetrics | null {
  if (d.broken && (d.broken.type === "imagepull" || d.broken.type === "pending")) return null;
  const h = hashStr(p.name);
  let cpuMilli = 4 + (h % 36);          // 4..39m Grundlast
  let memMi = 14 + ((h >>> 7) % 50);    // 14..63Mi Grundverbrauch
  if (d.cpuHeavy) cpuMilli = 850 + (h % 200); // 850..1049m: weit über der HighCPU-Schwelle
  if (d.broken && d.broken.type === "oomkilled") memMi = d.broken.memNeeded || 256; // klettert ans Limit
  return { cpuMilli, memMi };
}

/** Metriken aller laufenden Pods (für `kubectl top pods` + Prometheus + Alerts). */
export function podMetrics(host: ObservabilityHost): Array<{ name: string; cpuMilli: number; memMi: number }> {
  const out: Array<{ name: string; cpuMilli: number; memMi: number }> = [];
  for (const d of host.deployments) {
    for (const p of d.pods) {
      const m = podMetric(d, p);
      if (m) out.push({ name: p.name, cpuMilli: m.cpuMilli, memMi: m.memMi });
    }
  }
  return out;
}

/** Aggregierte Node-Last: Grundlast (deterministisch aus dem Node-Namen) plus der
 *  gleichmäßig verteilte Pod-Verbrauch – so hebt ein CPU-hungriger Pod auch die Node. */
export function nodeMetrics(host: ObservabilityHost): NodeMetrics[] {
  const CPU_CAP = 2000, MEM_CAP = 4096; // pro Node vereinfacht: 2 Kerne, 4 GiB
  const pods = podMetrics(host);
  const n = host.nodes.length || 1;
  const cpuShare = Math.round(pods.reduce((s, p) => s + p.cpuMilli, 0) / n);
  const memShare = Math.round(pods.reduce((s, p) => s + p.memMi, 0) / n);
  return host.nodes.map(nd => {
    const h = hashStr(nd.name);
    const ctrl = isControlPlane(nd);
    const baseCpu = (ctrl ? 120 : 60) + (h % (ctrl ? 80 : 60));
    const baseMem = (ctrl ? 900 : 500) + (h % 300);
    const cpuMilli = Math.min(CPU_CAP, baseCpu + cpuShare);
    const memMi = Math.min(MEM_CAP, baseMem + memShare);
    return { name: nd.name, cpuMilli, cpuPct: Math.round(cpuMilli / CPU_CAP * 100), memMi, memPct: Math.round(memMi / MEM_CAP * 100) };
  });
}

/** Prometheus-Scrape-Ziele aus dem Cluster-Zustand abgeleitet (Grundgerüst #109):
 *  Node-Targets (kubelet) sowie ein App-Target je Service – up/down je nach Erreichbarkeit. */
export function scrapeTargets(host: ObservabilityHost): ScrapeTarget[] {
  const targets: ScrapeTarget[] = [];
  for (const nd of host.nodes) {
    targets.push({ job: "kubelet", instance: nd.name + ":10250", health: nd.status === "Ready" ? "up" : "down" });
  }
  for (const s of host.services) {
    const dep = host.deployments.find(d => d.name === s.name);
    const healthy = !!dep && host._podReady(dep);
    targets.push({ job: s.name, instance: s.clusterIP + ":" + s.port, health: healthy ? "up" : "down" });
  }
  return targets;
}

/** Die Alert-Regeln samt aktueller Bedingung – die EINE Stelle, die festlegt,
 *  was den simulierten Alertmanager auslöst (hohe CPU, CrashLoop, OOM, Node weg). */
function alertRules(host: ObservabilityHost): Array<{ name: string; severity: "warning" | "critical"; summary: string; firing: boolean }> {
  const crash = host.deployments.some(d => d.broken && d.broken.type === "crashloop");
  const oom = host.deployments.some(d => d.broken && d.broken.type === "oomkilled");
  const hotPod = podMetrics(host).some(m => m.cpuMilli > 500);
  const nodeDown = host.nodes.some(nd => nd.status !== "Ready");
  return [
    { name: "KubePodCrashLooping", severity: "critical", summary: "Ein Pod startet immer wieder neu (CrashLoopBackOff).", firing: crash },
    { name: "KubePodOOMKilled", severity: "critical", summary: "Ein Pod sprengt sein Speicher-Limit und wird gekillt (OOMKilled).", firing: oom },
    { name: "HighPodCPU", severity: "warning", summary: "Ein Pod verbraucht ungewöhnlich viel CPU (über 500m).", firing: hotPod },
    { name: "KubeNodeNotReady", severity: "critical", summary: "Ein Node ist nicht mehr bereit (NotReady).", firing: nodeDown },
  ];
}

/** Aktuellen Zustand gegen die Regeln prüfen und den firing→resolved-Verlauf fortschreiben. */
export function evaluateAlerts(host: ObservabilityHost): void {
  for (const r of alertRules(host)) {
    if (r.firing) {
      host._firingAlerts.add(r.name);
      host._resolvedAlerts.delete(r.name);
    } else if (host._firingAlerts.has(r.name)) {
      // Bedingung weg, war aber an -> als resolved merken (verschwindet erst beim reset).
      host._firingAlerts.delete(r.name);
      host._resolvedAlerts.add(r.name);
    }
  }
}

/** Aktuelle Alerts (firing + resolved), nach Name sortiert. Wertet vorher neu aus,
 *  damit auch eine direkte Abfrage ohne vorausgehenden Befehl stimmt. */
export function alerts(host: ObservabilityHost): Alert[] {
  evaluateAlerts(host);
  const meta = new Map(alertRules(host).map(r => [r.name, r]));
  const out: Alert[] = [];
  for (const name of host._firingAlerts) {
    const r = meta.get(name)!;
    out.push({ name, severity: r.severity, state: "firing", summary: r.summary });
  }
  for (const name of host._resolvedAlerts) {
    const r = meta.get(name)!;
    out.push({ name, severity: r.severity, state: "resolved", summary: r.summary });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
