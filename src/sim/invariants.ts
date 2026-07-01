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
 *  (leeres Array = legaler Zustand). Rein lesend, mutiert nichts.
 *
 *  Geprüft werden (#478/#509): (1)/(2) Replica Ist/Soll je Deployment/StatefulSet,
 *  (3) Pods auf realen Nodes, (4)/(5) PVC-/PV-Bindungsstatus, (6) Namens-Eindeutigkeit
 *  je Ressourcentyp, (7) referenzielle Integrität der PVC↔PV-Bindung, (8) die stabilen
 *  StatefulSet-Ordinalnamen <name>-0 … . Bewusst NICHT geprüft: Service→Deployment (ein
 *  ServiceRes trägt in diesem Simulator keinen Selektor/keine Deployment-Referenz, die
 *  Zuordnung ist rein namensbasiert an der Abfrage-Grenze – kein persistenter Verweis, der
 *  ins Leere zeigen könnte) und roleBinding.roleRef→Role (eine Bindung auf eine noch nicht
 *  existierende Role ist in echtem Kubernetes ein zulässiger Zustand, keine Verletzung). */
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
  // Pods wie `replicas`. Die festen Ordinal-Namen prüft Invariante (8) unten.
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

  // (6) Namens-Eindeutigkeit pro Ressourcentyp. In echtem Kubernetes ist ein Objektname
  // je Art (+ Namespace) EINDEUTIG – es kann keine zwei Deployments "kasse" geben. Bisher
  // prüften das nur ad-hoc `some(x => x.name === …)`-Wachen pro Anlege-Befehl; ein Weg an
  // ihnen vorbei (mergeScenario, apply, eine neue Familie) konnte still Duplikate erzeugen,
  // die dann z.B. `get`/`delete` mehrdeutig machen. Hier wird die Regel für alle
  // benannten Aggregat-Mitglieder an EINER Stelle erzwungen (Stardew-Scope: neue
  // Ressourcenart = ein Eintrag hier, keine verstreute Disziplin).
  const uniqueChecks: Array<[string, ReadonlyArray<{ name: string }>]> = [
    ["Deployment", s.deployments],
    ["StatefulSet", s.statefulSets],
    ["Service", s.services],
    ["Ingress", s.ingresses],
    ["NetworkPolicy", s.networkPolicies],
    ["Secret", s.secrets],
    ["ConfigMap", s.configMaps],
    ["Node", s.nodes],
    ["PVC", s.pvcs],
    ["PV", s.pvs],
    ["StorageClass", s.storageClasses],
    ["VolumeSnapshot", s.volumeSnapshots],
    ["ServiceAccount", s.serviceAccounts],
    ["Role", s.roles],
    ["RoleBinding", s.roleBindings],
  ];
  for (const [kind, list] of uniqueChecks) {
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const item of list) {
      if (seen.has(item.name) && !reported.has(item.name)) {
        v.push(`${kind} "${item.name}": Name doppelt vergeben (muss je Typ eindeutig sein)`);
        reported.add(item.name);
      }
      seen.add(item.name);
    }
  }

  // (7) Referenzielle Integrität der intern verwalteten Speicher-Bindung: ein Verweis
  // zeigt auf ein wirklich existierendes Ziel. Bewusst NUR die PVC↔PV-Bindung – sie wird
  // vom Simulator selbst gesetzt und muss darum konsistent bleiben; ein Dangling wäre ein
  // echter Sim-Bug. (roleBinding.roleRef → Role ist BEWUSST NICHT hier: in echtem Kubernetes
  // ist eine RoleBinding auf eine noch nicht existierende Role völlig legal – sie gewährt
  // bloß nichts, bis die Role auftaucht; das ist ein zulässiger Zustand, keine Verletzung.)
  // (7a) PVC "Bound" → das genannte Volume existiert als PV. Ein Bound-PVC ohne Volume
  // fängt schon (4); hier: das Volume ist gesetzt, aber es gibt kein PV dieses Namens.
  const pvNames = new Set(s.pvs.map(p => p.name));
  for (const p of s.pvcs) {
    if (p.status === "Bound" && p.volume && !pvNames.has(p.volume)) {
      v.push(`PVC "${p.name}": an nicht existierendes Volume "${p.volume}" gebunden`);
    }
  }
  // (7b) PV "Bound" → der genannte Claim existiert als PVC. Der Claim wird als "<ns>/<name>"
  // geführt (Default-Namespace "default/…"); geprüft wird gegen den PVC-Namen hinter dem "/".
  const pvcNames = new Set(s.pvcs.map(p => p.name));
  for (const p of s.pvs) {
    if (p.status === "Bound" && p.claim) {
      const claimName = p.claim.includes("/") ? p.claim.slice(p.claim.indexOf("/") + 1) : p.claim;
      if (!pvcNames.has(claimName)) {
        v.push(`PV "${p.name}": an nicht existierendes PVC "${p.claim}" gebunden`);
      }
    }
  }

  // (8) StatefulSet-Ordinalnamen: die Pods eines StatefulSets tragen die STABILEN Namen
  // <name>-0 … <name>-(replicas-1) – exakt diese Menge, jeder genau einmal. Anders als beim
  // Deployment (Zufallsnamen) ist die Identität hier Teil des Vertrags (stabiles Netzwerk,
  // stabiles PVC je Ordinal). Ein abweichender/duplizierter/fehlender Ordinalname ist ein
  // illegaler Zustand. (Setzt Invariante (2) NICHT voraus – prüft die Namensmenge direkt.)
  for (const sts of s.statefulSets) {
    const expected = new Set<string>();
    for (let i = 0; i < sts.replicas; i++) expected.add(`${sts.name}-${i}`);
    const actual = sts.pods.map(p => String(p.name));
    const actualSet = new Set(actual);
    const wrong = actual.some(n => !expected.has(n));
    const missing = [...expected].some(n => !actualSet.has(n));
    const duplicate = actual.length !== actualSet.size;
    if (wrong || missing || duplicate) {
      v.push(`StatefulSet "${sts.name}": Pod-Namen müssen genau ${sts.name}-0 … ${sts.name}-${sts.replicas - 1} sein (stabile Ordinal-Identität)`);
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
