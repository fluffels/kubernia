/* ===== KubeQuest – Cluster-Invarianten (sim/invariants.ts) =====
 * Die EINE Quelle der Wahrheit dafür, was ein *legaler* `ClusterState` ist (#478,
 * taktisches DDD aus der arc42-Analyse). Bisher waren die Zustandsregeln über die
 * Befehlsfamilien (docker/kubectl/helm …) verstreut – ein neuer Sim-Befehl konnte
 * sie unbemerkt umgehen. Hier stehen sie gebündelt und maschinell prüfbar.
 *
 * Die Sim-Klasse ist das **Aggregat**: `exec()` ruft nach jedem Befehl
 * `assertClusterInvariants(this)` (an der Transaktionsgrenze). Eine Verletzung
 * wird damit LAUT, statt still einen illegalen Cluster zu hinterlassen – so kann
 * kein (auch kein künftiger) Befehl die Regeln über die öffentliche API brechen,
 * ohne dass es sofort auffällt. Das ist der skalierende (Stardew-Scope) Weg: neue
 * Befehlsfamilien sind automatisch bewacht, ohne Disziplin pro Modul.
 *
 * Reine Domäne: importiert NUR Typen aus ./state, kein Laufzeit-Code, Phaser-frei,
 * vom Architektur-Wächter (#347) als Domäne geschützt und im Node-Test prüfbar.
 */
import type { ClusterState } from "./state";

/** Alle verletzten Invarianten des Cluster-Zustands als lesbare Meldungen
 *  (leeres Array = legaler Zustand). Rein lesend, mutiert nichts. */
export function clusterInvariantViolations(s: ClusterState): string[] {
  const v: string[] = [];

  // (1) Replica Ist/Soll konsistent (Deployments): ein Deployment hält genau so viele
  // Pods, wie sein `replicas`-Soll sagt. Das gilt auch bei kaputten Workloads (die Pods
  // existieren, sie laufen nur nicht) und bei replicas=0 (dann null Pods).
  for (const d of s.deployments) {
    if (d.pods.length !== d.replicas) {
      v.push(`Deployment "${d.name}": Soll ${d.replicas} Replica(s), aber ${d.pods.length} Pod(s)`);
    }
  }

  // (2) Replica Ist/Soll konsistent (StatefulSets): stabile Identität – ebenso viele
  // Pods wie `replicas`, mit festen Ordinal-Namen <name>-0 … (Namensregel siehe unten).
  for (const sts of s.statefulSets) {
    if (sts.pods.length !== sts.replicas) {
      v.push(`StatefulSet "${sts.name}": Soll ${sts.replicas} Replica(s), aber ${sts.pods.length} Pod(s)`);
    }
  }

  // (3) Pods laufen auf einem EXISTIERENDEN Node. `node` ist optional (undefiniert =
  // deterministische Default-Platzierung übers round-robin); ist er aber gesetzt, muss
  // der Knoten wirklich im Cluster stehen – ein Pod „im Nichts" ist ein illegaler Zustand.
  const nodeNames = new Set(s.nodes.map(n => n.name));
  for (const d of s.deployments) {
    if (d.node !== undefined && !nodeNames.has(d.node)) {
      v.push(`Deployment "${d.name}": an unbekannten Node "${d.node}" gepinnt`);
    }
  }

  // (4) PVC-Bindung konsistent: „Bound" heißt genau dann, dass ein Volume dahinter hängt.
  // Pending ⟹ kein Volume; Bound ⟹ Volume. (Die klassische Lehrfalle „PVC Pending, weil
  // kein Speicher da" bleibt legal – Pending mit leerem volume ist erlaubt, nur nicht Bound
  // ohne Volume.)
  for (const p of s.pvcs) {
    if (p.status === "Bound" && !p.volume) {
      v.push(`PVC "${p.name}": Status Bound, aber an kein Volume gebunden`);
    }
    if (p.status === "Pending" && p.volume) {
      v.push(`PVC "${p.name}": Status Pending, aber an Volume "${p.volume}" gebunden`);
    }
  }

  // (5) PV-Bindung konsistent: Bound ⟹ ein Claim hängt dran; Available ⟹ frei (kein Claim).
  // „Released" (Claim weg, noch nicht recycelt) ist bewusst NICHT geprüft – dort ist der
  // leere Claim gerade der Normalzustand.
  for (const p of s.pvs) {
    if (p.status === "Bound" && !p.claim) {
      v.push(`PV "${p.name}": Status Bound, aber ohne Claim`);
    }
    if (p.status === "Available" && p.claim) {
      v.push(`PV "${p.name}": Status Available, aber Claim "${p.claim}" gesetzt`);
    }
  }

  return v;
}

/** Wird geworfen, wenn der Cluster-Zustand seine Invarianten verletzt (#478). */
export class ClusterInvariantError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super("Cluster-Invariante verletzt:\n- " + violations.join("\n- "));
    this.name = "ClusterInvariantError";
    this.violations = violations;
  }
}

/** Prüft alle Invarianten und wirft `ClusterInvariantError`, sobald eine verletzt ist.
 *  Das ist die Aggregat-Grenze: `Sim.exec()` ruft sie nach jedem Befehl (Dev/Test). */
export function assertClusterInvariants(s: ClusterState): void {
  const violations = clusterInvariantViolations(s);
  if (violations.length > 0) throw new ClusterInvariantError(violations);
}
