/* ===== KubeQuest – Terminal-Simulator =====
 * Simuliert einen kleinen Kubernetes-Cluster samt Docker, Helm und Terraform.
 * Kein echtes Cluster nötig – aber die Befehle und Ausgaben fühlen sich echt an.
 */

// Cluster-Zustand & Domänentypen leben seit #372 in ./sim/state.ts (Schritt 1/7 des
// sim.ts-Datei-Splits). Hier für die Sim-Klasse importiert und als Barrel re-exportiert,
// damit bestehende `import … from "../sim"` (game, types, content/*, Tests) unverändert bleiben.
// `ExecResult` liegt seit #390 ebenfalls hier (war in types.ts) – das bricht den Zyklus types ↔ sim.
import type {
  ExecResult,
  Broken, PodInstance, Deployment, ServiceRes, IngressRes, NetworkPolicyRes,
  Secret, ConfigMap, ClusterNode, Container, Release,
  Chart, TfResource, TfProvider, TfModule, TfBackend, TfOutput, GitCommit, GitConflict, GitPending,
  Pipeline, CiDeploy, ArgoApp, ApplyEffect,
  ServiceMonitorRes, PrometheusRuleRes, GrafanaDatasourceRes, GrafanaDashboardRes, StatefulSetRes, PvcRes,
  PvRes, StorageClassRes, VolumeSnapshotRes, S3Bucket, ServiceAccountRes, RoleRes,
  RoleBindingRes, PodSecurityLevel, PodStatus, NodeMetrics,
  ScrapeTarget, Alert, Scenario, ClusterState,
} from "./sim/state";
export type {
  ExecResult,
  Broken, PodInstance, Deployment, ServiceRes, IngressRes, NetworkPolicyRes,
  Secret, ConfigMap, ClusterNode, Container, HistoryEntry, Release,
  Chart, TfResource, TfProvider, TfModule, TfBackend, TfOutput, GitCommit, GitConflict, GitPending, PipelineStage,
  Pipeline, CiDeploy, ArgoDesired, ArgoChildSpec, ArgoApp, ApplyEffect,
  ServiceMonitorRes, PrometheusRuleRes, GrafanaDatasourceRes, GrafanaDashboardRes, StatefulSetRes, PvcRes,
  PvRes, StorageClassRes, VolumeSnapshotRes, S3Bucket, S3Object, ServiceAccountRes, PolicyRule, RoleRes, RbacSubject,
  RoleBindingRes, SecurityContext, PodSecurityLevel, PodStatus, PodMetrics, NodeMetrics,
  ScrapeTarget, Alert, Scenario, ClusterState,
} from "./sim/state";

// Befehls-Module des sim.ts-Splits (Epic #346): die docker-Familie liegt seit #373 in
// ./sim/docker.ts. Geteilte, pure Helfer (Tabellen-Ausgabe, Zufalls-IDs) in ./sim/util.ts –
// von hier UND den Befehls-Modulen importiert (kein Rückimport, der einen Zyklus bauen würde).
import { dockerCommand } from "./sim/docker";
import { kubectlCommand } from "./sim/kubectl";
import { helmCommand } from "./sim/helm";
import { terraformCommand } from "./sim/terraform";
import { gitCommand } from "./sim/git";
import { argocdCommand, reconcileAutoSync, cloneArgoApp } from "./sim/argocd";
import { podMetrics as obsPodMetrics, nodeMetrics as obsNodeMetrics, scrapeTargets as obsScrapeTargets, alerts as obsAlerts, evaluateAlerts as obsEvaluateAlerts } from "./sim/observability";
import { glabCommand } from "./sim/glab";
import { nslookupCommand, curlCommand } from "./sim/net";
import { awsCommand, objectByteLength } from "./sim/s3";
import { depEphemeralUsed, nodeOf, nodeEphemeralUsed, resetEphemeral, evaluateEviction } from "./sim/eviction";
import { randSuffix, makePodName } from "./sim/util";

  class Sim implements ClusterState {
    // `!` = definite assignment: alle Felder werden in reset() gesetzt, das der
    // Konstruktor aufruft. TS sieht das nicht durch den Methodenaufruf hindurch.
    // Die Cluster-Zustands-Felder erfüllen den `ClusterState`-Vertrag (sim/state.ts, #372).
    scenario: Scenario;
    clock!: number;
    docker!: { pulled: string[]; containers: Container[] };
    nodes!: ClusterNode[];
    deployments!: Deployment[];
    services!: ServiceRes[];
    ingresses!: IngressRes[];
    networkPolicies!: NetworkPolicyRes[];
    secrets!: Secret[];
    configMaps!: ConfigMap[];
    files!: Record<string, string>;
    applyEffects!: Record<string, ApplyEffect>;
    serviceMonitors!: ServiceMonitorRes[];
    prometheusRules!: PrometheusRuleRes[];
    grafanaDatasources!: GrafanaDatasourceRes[];
    grafanaDashboards!: GrafanaDashboardRes[];
    statefulSets!: StatefulSetRes[];
    pvcs!: PvcRes[];
    pvs!: PvRes[];
    storageClasses!: StorageClassRes[];
    volumeSnapshots!: VolumeSnapshotRes[];   // Backup/Restore (#140)
    objectStore!: { buckets: S3Bucket[] };   // S3-/MinIO-Object-Store (#241), off-cluster
    // RBAC / ServiceAccounts / Pod-Security (#126)
    serviceAccounts!: ServiceAccountRes[];
    roles!: RoleRes[];                 // Roles UND ClusterRoles (per .cluster unterschieden)
    roleBindings!: RoleBindingRes[];   // RoleBindings UND ClusterRoleBindings (per .cluster)
    podSecurity!: PodSecurityLevel;    // durchgesetzte Pod-Security-Stufe des default-Namespace
    argoApps!: ArgoApp[];
    helmRepos!: string[];
    releases!: Release[];
    charts!: Chart[];
    tf!: { initialized: boolean; applied: boolean; resources: TfResource[]; providers: TfProvider[]; modules: TfModule[]; backend: TfBackend | null; outputs: TfOutput[]; locked: boolean; lockHolder?: string };
    git!: { initialized: boolean; branch: string; branches: string[]; staged: string[]; committed: string[]; commits: GitCommit[]; pushed: boolean; remoteAhead: number; fetched: boolean; conflict: GitConflict | null; pendingConflict: GitPending | null };
    ci!: { pipelines: Pipeline[]; deploy: CiDeploy | null };
    lastDeletedPod: string | null = null;
    lastError!: boolean;
    // Alert-Verlauf der Sitzung (Observability #109). Wie memLimit ein reines
    // Laufzeit-Feld: NICHT serialisiert – Alerts leiten sich aus dem Cluster-Zustand
    // ab, nur der firing→resolved-Übergang braucht ein kurzes Gedächtnis.
    _firingAlerts!: Set<string>;   // brennt gerade
    _resolvedAlerts!: Set<string>; // war mal an, Ursache inzwischen behoben

    constructor(scenario: Scenario = {}) {
      this.scenario = scenario || {};
      this.reset();
    }

    reset() {
      const sc = this.scenario;
      this.clock = 0; // jede Eingabe = ~20s Spielzeit, für AGE-Spalten

      this.docker = {
        pulled: (sc.dockerImages || []).slice(),
        containers: (sc.dockerContainers || []).map(c => Object.assign({}, c)),
      };

      this.nodes = (sc.nodes || [
        { name: "ahoi-control", status: "Ready", roles: "control-plane", version: "v1.30.2" },
        { name: "ahoi-worker-1", status: "Ready", roles: "<none>", version: "v1.30.2" },
        { name: "ahoi-worker-2", status: "Ready", roles: "<none>", version: "v1.30.2" },
      ]).map(n => Object.assign({}, n));

      this.deployments = (sc.deployments || []).map(d => {
        const dep = this._makeDeployment(d.name, d.image, d.replicas, d.broken, d.envFrom, d.cpuHeavy);
        if (d.containerPort !== undefined) dep.containerPort = d.containerPort; // #164
        this._seedEphemeral(dep, d); // node/emptyDir/ephemeral-storage (#240)
        return dep;
      });
      this.services = (sc.services || []).map(s => Object.assign({}, s));
      this.ingresses = (sc.ingresses || []).map(i => Object.assign({}, i));
      this.networkPolicies = (sc.networkPolicies || []).map(n => Object.assign({}, n));
      this.secrets = (sc.secrets || []).map(s => Object.assign({}, s));
      this.configMaps = (sc.configMaps || []).map(c => Object.assign({}, c));
      this.files = Object.assign({}, sc.files || {});
      this.applyEffects = sc.applyEffects || {}; // dateiname -> Wirkung von kubectl apply -f
      this.serviceMonitors = (sc.serviceMonitors || []).map(s => Object.assign({}, s));
      this.prometheusRules = (sc.prometheusRules || []).map(r => Object.assign({}, r));
      this.grafanaDatasources = (sc.grafanaDatasources || []).map(d => Object.assign({}, d));
      this.grafanaDashboards = (sc.grafanaDashboards || []).map(d => Object.assign({}, d));

      // Speicher (#122) – Reihenfolge zählt: StorageClass + PVs müssen stehen, bevor
      // PVCs/StatefulSets binden. Ohne explizite Vorgabe gibt es – wie in kind/minikube –
      // genau eine Default-StorageClass "standard", die PVCs dynamisch ein PV beschafft.
      this.storageClasses = (sc.storageClasses || [
        { name: "standard", provisioner: "rancher.io/local-path", reclaimPolicy: "Delete", isDefault: true },
      ]).map(s => ({ name: s.name, provisioner: s.provisioner || "rancher.io/local-path", reclaimPolicy: s.reclaimPolicy || "Delete", isDefault: !!s.isDefault, created: 0 }));
      this.pvs = (sc.pvs || []).map(p => ({ name: p.name, capacity: p.capacity || "1Gi", status: p.status || "Available", claim: p.claim || "", storageClass: p.storageClass || "", accessModes: p.accessModes || "RWO", reclaimPolicy: p.reclaimPolicy || "Retain", created: 0 }));
      this.pvcs = [];
      for (const p of sc.pvcs || []) {
        let pvc: PvcRes;
        if (p.status === "Bound" && p.volume) {
          // schon gebunden (z.B. aus einem gespeicherten Stand) – nicht neu provisionieren
          pvc = { name: p.name, status: "Bound", volume: p.volume, capacity: p.storage || p.capacity || "1Gi", storageClass: p.storageClass || "", accessModes: p.accessModes || "RWO", created: 0 };
        } else {
          pvc = this._makePvc(p.name, p.storage || p.capacity || "1Gi", p.storageClass, p.accessModes);
        }
        if (p.data !== undefined) pvc.data = p.data; // Volume-Inhalt mitgeben (Backup/Restore #140)
        this.pvcs.push(pvc);
      }
      this.statefulSets = (sc.statefulSets || []).map(s => this._makeStatefulSet(s));
      // Backup/Restore (#140): VolumeSnapshots sind eigenständige, persistierte Objekte.
      this.volumeSnapshots = (sc.volumeSnapshots || []).map(v => ({
        name: v.name, sourcePvc: v.sourcePvc, data: v.data || "",
        restoreSize: v.restoreSize || "1Gi", readyToUse: v.readyToUse !== false, created: 0,
      }));

      // S3-/MinIO-Object-Store (#241): off-cluster Buckets + Objekte. `size` aus dem Inhalt
      // ableiten, wenn nicht explizit vorgegeben (lockere Eingabe-Schreibweise).
      this.objectStore = { buckets: (sc.s3Buckets || []).map(b => this._makeBucket(b)) };

      // RBAC / ServiceAccounts / Pod-Security (#126). Jeder Namespace hat von Haus
      // aus die "default"-SA; weitere kommen aus dem Szenario oder per `kubectl create`.
      this.serviceAccounts = [{ name: "default", created: 0 }];
      for (const name of sc.serviceAccounts || []) {
        if (!this.serviceAccounts.some(s => s.name === name)) this.serviceAccounts.push({ name, created: 0 });
      }
      this.roles = (sc.roles || []).map(r => ({ name: r.name, cluster: !!r.cluster, rules: r.rules.map(rule => ({ verbs: rule.verbs.slice(), resources: rule.resources.slice() })), created: 0 }));
      this.roleBindings = (sc.roleBindings || []).map(b => ({ name: b.name, cluster: !!b.cluster, roleRef: { kind: b.roleRef.kind, name: b.roleRef.name }, subjects: b.subjects.map(s => Object.assign({}, s)), created: 0 }));
      // Ohne Vorgabe ist die Admission "privileged" (keine Einschränkung) – wie ein frischer Cluster.
      this.podSecurity = sc.podSecurity || "privileged";

      this.argoApps = (sc.argoApps || []).map(a => cloneArgoApp(a));

      this.helmRepos = (sc.helmRepos || []).slice();
      this.releases = (sc.releases || []).map(r => ({
        name: r.name, chart: r.chart, revision: r.revision, depName: r.depName,
        history: (r.history || []).map(h => Object.assign({}, h)),
      }));
      this.charts = (sc.charts || []).map(c => ({ name: c.name, version: c.version || "0.1.0", packaged: !!c.packaged }));

      this.tf = {
        initialized: !!sc.tfInitialized,
        applied: !!sc.tfApplied,
        resources: (sc.tfResources || []).map(r => ({ addr: r.addr, desc: r.desc, provider: r.provider })),
        // installed/fetched leiten sich aus tfInitialized ab: ein gespeicherter
        // initialisierter Stand hat die Provider geladen und die Module geholt (#146).
        providers: (sc.tfProviders || []).map(p => ({ name: p.name, source: p.source, version: p.version, installed: !!sc.tfInitialized })),
        modules: (sc.tfModules || []).map(m => ({ name: m.name, source: m.source || "./modules/" + m.name, resources: (m.resources || []).slice(), fetched: !!sc.tfInitialized, available: m.available !== false })),
        backend: sc.tfBackend ? { type: sc.tfBackend.type, name: sc.tfBackend.name, locking: !!sc.tfBackend.locking } : null,
        outputs: (sc.tfOutputs || []).map(o => ({ name: o.name, value: o.value, sensitive: !!o.sensitive })),
        locked: !!sc.tfLocked,
        lockHolder: sc.tfLockHolder,
      };

      this.git = {
        initialized: !!sc.gitInitialized,
        branch: sc.gitBranch || "main",
        branches: (sc.gitBranches || ["main"]).slice(),
        staged: (sc.gitStaged || []).slice(),
        committed: (sc.gitCommitted || []).slice(),
        commits: (sc.gitCommits || []).map(c => Object.assign({}, c)),
        pushed: !!sc.gitPushed,
        remoteAhead: sc.gitRemoteAhead || 0,
        fetched: !!sc.gitFetched,
        // Aus einem gespeicherten Stand kommen pending/aktiver Konflikt direkt zurück
        // (gitConflict trägt hier das gespeicherte pendingConflict, nicht das Quest-„Scharfstellen“).
        conflict: sc.gitActiveConflict ? Object.assign({}, sc.gitActiveConflict) : null,
        pendingConflict: sc.gitConflict ? Object.assign({}, sc.gitConflict) : null,
      };

      this.ci = {
        pipelines: (sc.ciPipelines || []).map(p => ({
          id: p.id, ref: p.ref, status: p.status, created: p.created,
          stages: (p.stages || []).map(s => Object.assign({}, s)),
        })),
        deploy: sc.ciDeploy ? Object.assign({}, sc.ciDeploy) : null, // {name, image, replicas}, den die deploy-Stage ausrollt
      };

      this.lastDeletedPod = null;
      this.lastError = false;
      this._firingAlerts = new Set();
      this._resolvedAlerts = new Set();
      // Disk-Druck/Eviction einmal ableiten, damit ein frisch geladener Stand schon vor dem
      // ersten Befehl stimmig ist (DiskPressure/Evicted, #240). exec() rechnet danach laufend nach.
      this._evaluateEviction();
    }

    /** Ephemeral-Storage-Felder eines Deployments aus einer (lockeren) Eingabe-Spec setzen (#240):
     *  Node-Pin, emptyDir-Volume, ephemeral-storage-Limit und -Zusatznutzung. Geteilt von reset()
     *  und mergeScenario(). */
    _seedEphemeral(dep: Deployment, s: { node?: string; emptyDir?: { data?: string; usedMi?: number }; ephemeralLimit?: number; ephemeralUsedMi?: number }) {
      if (s.node !== undefined) dep.node = s.node;
      if (s.emptyDir) dep.emptyDir = { data: s.emptyDir.data || "", usedMi: s.emptyDir.usedMi || 0 };
      if (s.ephemeralLimit !== undefined) dep.ephemeralLimit = s.ephemeralLimit;
      if (s.ephemeralUsedMi !== undefined) dep.ephemeralUsedMi = s.ephemeralUsedMi;
    }

    _makeDeployment(name: string, image: string, replicas: number, broken?: Broken | null, envFrom?: { configMaps: string[]; secrets: string[] }, cpuHeavy?: boolean): Deployment {
      const d: Deployment = {
        name, image, replicas, created: this.clock, pods: [], broken: broken ? Object.assign({}, broken) : null,
        envFrom: { configMaps: (envFrom?.configMaps || []).slice(), secrets: (envFrom?.secrets || []).slice() },
        cpuHeavy: !!cpuHeavy,
      };
      // OOMKilled startet mit einem zu knappen Limit – das ist ja die Ursache.
      if (d.broken && d.broken.type === "oomkilled") d.memLimit = 64;
      for (let i = 0; i < replicas; i++) {
        d.pods.push({ name: makePodName(name), created: this.clock, restarts: 0 });
      }
      return d;
    }

    /* ---------- Ephemeral Storage & Eviction (#240) ---------- */
    // Die Mechanik liegt in ./sim/eviction.ts (pure Domäne, mutiert nur den Cluster-Zustand);
    // hier nur dünne Delegationen, damit kubectl sie über das KubectlHost-Interface erreicht.
    _depEphemeralUsed(d: Deployment): number { return depEphemeralUsed(d); }
    _nodeOf(d: Deployment): string { return nodeOf(this, d); }
    _nodeEphemeralUsed(nodeName: string): number { return nodeEphemeralUsed(this, nodeName); }
    _resetEphemeral(d: Deployment): void { resetEphemeral(d); }
    _evaluateEviction(): void { evaluateEviction(this); }

    /** Name der Default-StorageClass (oder "", wenn keine als Default markiert ist).
     *  Ein PVC ohne eigene StorageClass bekommt im echten Cluster genau diese. */
    _defaultStorageClassName(): string {
      const def = this.storageClasses.find(s => s.isDefault);
      return def ? def.name : "";
    }

    /** Bindet ein PVC an Speicher: erst dynamisch über seine StorageClass (legt on-demand
     *  ein passendes PV an), sonst statisch an ein vorhandenes freies PV – das aber zur
     *  Anforderung passen muss (gleiche StorageClass UND gleicher AccessMode; ein RWO-PV
     *  erfüllt keine RWX-Anforderung). Findet sich beides nicht, bleibt das PVC `Pending`
     *  – genau das Lehrbild „kein passender Speicher da". */
    _bindPvc(pvc: PvcRes) {
      if (pvc.status === "Bound" && pvc.volume) return;
      const sc = pvc.storageClass ? this.storageClasses.find(s => s.name === pvc.storageClass) : null;
      if (sc && sc.provisioner) {
        const pvName = "pvc-" + randSuffix(8);
        this.pvs.push({ name: pvName, capacity: pvc.capacity, status: "Bound", claim: "default/" + pvc.name, storageClass: sc.name, accessModes: pvc.accessModes, reclaimPolicy: sc.reclaimPolicy, created: this.clock });
        pvc.status = "Bound";
        pvc.volume = pvName;
        return;
      }
      const pv = this.pvs.find(p => p.status === "Available" && (!pvc.storageClass || p.storageClass === pvc.storageClass) && p.accessModes === pvc.accessModes);
      if (pv) {
        pv.status = "Bound";
        pv.claim = "default/" + pvc.name;
        pvc.status = "Bound";
        pvc.volume = pv.name;
        if (pv.capacity) pvc.capacity = pv.capacity;
      }
      // sonst: bleibt Pending (volume "")
    }

    /** Legt ein PVC an und bindet es sofort (siehe _bindPvc). Ohne StorageClass-Angabe
     *  greift die Default-StorageClass; ein leeres "" erzwingt statische Bindung. */
    _makePvc(name: string, storage: string, storageClass?: string, accessModes?: string): PvcRes {
      const pvc: PvcRes = {
        name,
        status: "Pending",
        volume: "",
        capacity: storage || "1Gi",
        storageClass: storageClass !== undefined ? storageClass : this._defaultStorageClassName(),
        accessModes: accessModes || "RWO",
        created: this.clock,
      };
      this._bindPvc(pvc);
      return pvc;
    }

    /** Baut ein StatefulSet: Pods mit STABILER Identität (<name>-0 …) plus je Replica
     *  ein PVC aus dem volumeClaimTemplate (<vct>-<name>-<ordinal>), das gleich gebunden wird. */
    _makeStatefulSet(spec: { name: string; image: string; replicas: number; serviceName?: string; volumeClaimName?: string; storage?: string; storageClass?: string }): StatefulSetRes {
      const vct = spec.volumeClaimName || "data";
      const sts: StatefulSetRes = {
        name: spec.name, image: spec.image, replicas: spec.replicas,
        serviceName: spec.serviceName || spec.name,
        volumeClaimName: vct,
        storage: spec.storage || "1Gi",
        storageClass: spec.storageClass,
        pods: [], created: this.clock,
      };
      for (let i = 0; i < spec.replicas; i++) {
        sts.pods.push({ name: spec.name + "-" + i, created: this.clock, restarts: 0 });
        const pvcName = vct + "-" + spec.name + "-" + i;
        if (!this.pvcs.some(p => p.name === pvcName)) {
          this.pvcs.push(this._makePvc(pvcName, sts.storage, spec.storageClass, "RWO"));
        }
      }
      return sts;
    }

    /** Baut einen Object-Store-Bucket aus einer (lockeren) Szenario-Spec (#241): Objekt-Größe
     *  aus dem Inhalt ableiten, wenn nicht explizit gesetzt. Geteilt von reset()/mergeScenario(). */
    _makeBucket(b: { name: string; objects?: Array<{ key: string; content?: string; size?: number }> }): S3Bucket {
      return {
        name: b.name,
        objects: (b.objects || []).map(o => ({ key: o.key, content: o.content || "", size: o.size !== undefined ? o.size : objectByteLength(o.content || ""), created: 0 })),
        created: 0,
      };
    }

    /** Pod-Status eines Deployments (für get/describe/logs). */
    _podStatus(d: Deployment): PodStatus {
      // Evicted überschreibt alles (#240): der kubelet hat den Pod wegen Disk-Druck oder
      // gesprengtem ephemeral-storage-Limit beendet – er läuft nicht und ist nicht bereit.
      if (d.evicted) return { status: "Evicted", ready: "0/1", restarts: 0 };
      if (!d.broken) return { status: "Running", ready: "1/1", restarts: 0 };
      if (d.broken.type === "imagepull") return { status: "ImagePullBackOff", ready: "0/1", restarts: 0 };
      if (d.broken.type === "crashloop") return { status: "CrashLoopBackOff", ready: "0/1", restarts: 5 };
      if (d.broken.type === "pending") return { status: "Pending", ready: "0/1", restarts: 0 };
      // oomkilled: Der Container sprengt sein memory-Limit, der Kernel killt ihn,
      // Kubernetes startet neu, er sprengt es wieder … RESTARTS klettern, READY 0/1.
      if (d.broken.type === "oomkilled") return { status: "OOMKilled", ready: "0/1", restarts: 4 };
      // notready: Container läuft (liveness ok) – aber die Readiness-Probe meldet
      // "noch nicht bereit", also Running mit READY 0/1 und kein Restart.
      if (d.broken.type === "notready") return { status: "Running", ready: "0/1", restarts: 0 };
      return { status: "Running", ready: "1/1", restarts: 0 };
    }

    /** Ein Pod ist bereit (zählt für den Service), wenn er läuft UND ready ist. */
    _podReady(d: Deployment): boolean {
      return this._podStatus(d).ready === "1/1";
    }

    /** Pending-Pods bekommen Platz, sobald genug Nodes da sind. */
    _reschedulePending() {
      if (this.nodes.length <= 3) return;
      for (const d of this.deployments) {
        if (d.broken && d.broken.type === "pending") d.broken = null;
      }
    }

    /** Readiness-Probe prüft fortlaufend: liegt das benötigte Secret vor, wird
     * der notready-Pod von selbst bereit – ganz ohne Neustart (anders als Crash). */
    _recheckReadiness() {
      for (const d of this.deployments) {
        if (d.broken && d.broken.type === "notready" &&
            (!d.broken.needsSecret || this.secrets.some(s => s.name === d.broken!.needsSecret))) {
          d.broken = null;
        }
      }
    }

    /** Ist das Image lokal verfügbar (gebaut oder gezogen)? Vergleicht mit UND ohne
     *  `:latest`-Tag, damit `werft-dienst` und `werft-dienst:latest` als dasselbe gelten
     *  – genau wie docker es behandelt (#164). */
    _imageAvailable(image: string): boolean {
      if (!image) return false;
      const full = image.includes(":") ? image : image + ":latest";
      return this.docker.pulled.includes(image) || this.docker.pulled.includes(full);
    }

    /** Der kubelet zieht ein fehlendes Image immer wieder neu: sobald das eigene Image
     *  lokal gebaut/gezogen ist, heilt der ImagePullBackOff von selbst (#164). Greift NUR
     *  bei Pods, die mangels gebautem Image kaputt sind (`broken.needsBuild`) – ein echter
     *  Tippfehler-ImagePull (nur `badImage`) bleibt unberührt. */
    _recheckImagePull() {
      for (const d of this.deployments) {
        if (d.broken && d.broken.type === "imagepull" && d.broken.needsBuild && this._imageAvailable(d.image)) {
          d.broken = null;
          d.pods = d.pods.map(() => ({ name: makePodName(d.name), created: this.clock, restarts: 0 }));
        }
      }
    }

    _age(created: number) {
      const secs = (this.clock - created) * 20 + 15;
      if (secs < 60) return secs + "s";
      const mins = Math.floor(secs / 60);
      if (mins < 60) return mins + "m";
      return Math.floor(mins / 60) + "h";
    }

    _allPods(): PodInstance[] {
      const pods: PodInstance[] = [];
      for (const d of this.deployments) for (const p of d.pods) pods.push(p);
      return pods;
    }

    _findDeploymentOfPod(podName: string): Deployment | undefined {
      return this.deployments.find(d => d.pods.some(p => p.name === podName));
    }

    /** Quest-Szenario in die laufende Welt mischen (Dateien, Aufträge, Beispiel-Pods …). */
    mergeScenario(sc: Scenario | null | undefined) {
      if (!sc) return;
      Object.assign(this.files, sc.files || {});
      Object.assign(this.applyEffects, sc.applyEffects || {});
      for (const s of sc.serviceMonitors || []) {
        if (!this.serviceMonitors.some(x => x.name === s.name)) this.serviceMonitors.push(Object.assign({}, s));
      }
      for (const r of sc.prometheusRules || []) {
        if (!this.prometheusRules.some(x => x.name === r.name)) this.prometheusRules.push(Object.assign({}, r));
      }
      for (const d of sc.grafanaDatasources || []) {
        if (!this.grafanaDatasources.some(x => x.name === d.name)) this.grafanaDatasources.push(Object.assign({}, d));
      }
      for (const d of sc.grafanaDashboards || []) {
        if (!this.grafanaDashboards.some(x => x.name === d.name)) this.grafanaDashboards.push(Object.assign({}, d));
      }
      // Speicher (#122) – Reihenfolge wie in reset(): StorageClass + PVs vor PVCs/StatefulSets.
      for (const s of sc.storageClasses || []) {
        if (!this.storageClasses.some(x => x.name === s.name)) this.storageClasses.push({ name: s.name, provisioner: s.provisioner || "rancher.io/local-path", reclaimPolicy: s.reclaimPolicy || "Delete", isDefault: !!s.isDefault, created: this.clock });
      }
      for (const p of sc.pvs || []) {
        if (!this.pvs.some(x => x.name === p.name)) this.pvs.push({ name: p.name, capacity: p.capacity || "1Gi", status: p.status || "Available", claim: p.claim || "", storageClass: p.storageClass || "", accessModes: p.accessModes || "RWO", reclaimPolicy: p.reclaimPolicy || "Retain", created: this.clock });
      }
      for (const p of sc.pvcs || []) {
        if (this.pvcs.some(x => x.name === p.name)) continue;
        const pvc = (p.status === "Bound" && p.volume)
          ? { name: p.name, status: "Bound" as const, volume: p.volume, capacity: p.storage || p.capacity || "1Gi", storageClass: p.storageClass || "", accessModes: p.accessModes || "RWO", created: this.clock }
          : this._makePvc(p.name, p.storage || p.capacity || "1Gi", p.storageClass, p.accessModes);
        if (p.data !== undefined) pvc.data = p.data; // Volume-Inhalt mitgeben (Backup/Restore #140)
        this.pvcs.push(pvc);
      }
      for (const s of sc.statefulSets || []) {
        if (!this.statefulSets.some(x => x.name === s.name)) this.statefulSets.push(this._makeStatefulSet(s));
      }
      for (const v of sc.volumeSnapshots || []) { // Backup/Restore (#140)
        if (!this.volumeSnapshots.some(x => x.name === v.name)) this.volumeSnapshots.push({ name: v.name, sourcePvc: v.sourcePvc, data: v.data || "", restoreSize: v.restoreSize || "1Gi", readyToUse: v.readyToUse !== false, created: this.clock });
      }
      for (const b of sc.s3Buckets || []) { // Object Store (#241) – additiv, ohne Doppler.
        if (!this.objectStore.buckets.some(x => x.name === b.name)) this.objectStore.buckets.push(this._makeBucket(b));
      }
      // RBAC / ServiceAccounts / Pod-Security (#126) – additiv, ohne Doppler.
      for (const name of sc.serviceAccounts || []) {
        if (!this.serviceAccounts.some(x => x.name === name)) this.serviceAccounts.push({ name, created: this.clock });
      }
      for (const r of sc.roles || []) {
        if (!this.roles.some(x => x.name === r.name && x.cluster === !!r.cluster)) this.roles.push({ name: r.name, cluster: !!r.cluster, rules: r.rules.map(rule => ({ verbs: rule.verbs.slice(), resources: rule.resources.slice() })), created: this.clock });
      }
      for (const b of sc.roleBindings || []) {
        if (!this.roleBindings.some(x => x.name === b.name && x.cluster === !!b.cluster)) this.roleBindings.push({ name: b.name, cluster: !!b.cluster, roleRef: { kind: b.roleRef.kind, name: b.roleRef.name }, subjects: b.subjects.map(s => Object.assign({}, s)), created: this.clock });
      }
      // Höhere enforce-Stufe gewinnt nicht automatisch – eine explizit gesetzte Stufe übernehmen.
      if (sc.podSecurity) this.podSecurity = sc.podSecurity;
      for (const a of sc.argoApps || []) {
        if (!this.argoApps.some(x => x.name === a.name)) this.argoApps.push(cloneArgoApp(a));
      }
      if (sc.tfResources) { this.tf.resources = sc.tfResources.map(r => ({ addr: r.addr, desc: r.desc, provider: r.provider })); this.tf.initialized = false; this.tf.applied = false; }
      // Neue Provider/Module/Backend-Config setzt den Init-Stand zurück (wie echtes `terraform`,
      // das nach Config-Änderung ein erneutes `init` verlangt, #146).
      if (sc.tfProviders) { this.tf.providers = sc.tfProviders.map(p => ({ name: p.name, source: p.source, version: p.version, installed: false })); this.tf.initialized = false; }
      if (sc.tfModules) { this.tf.modules = sc.tfModules.map(m => ({ name: m.name, source: m.source || "./modules/" + m.name, resources: (m.resources || []).slice(), fetched: false, available: m.available !== false })); this.tf.initialized = false; }
      if (sc.tfBackend !== undefined) { this.tf.backend = sc.tfBackend ? { type: sc.tfBackend.type, name: sc.tfBackend.name, locking: !!sc.tfBackend.locking } : null; this.tf.initialized = false; }
      if (sc.tfOutputs) { this.tf.outputs = sc.tfOutputs.map(o => ({ name: o.name, value: o.value, sensitive: !!o.sensitive })); }
      if (sc.tfLocked !== undefined) { this.tf.locked = !!sc.tfLocked; this.tf.lockHolder = sc.tfLockHolder; }
      for (const img of sc.dockerImages || []) {
        if (!this.docker.pulled.includes(img)) this.docker.pulled.push(img);
      }
      for (const d of sc.deployments || []) {
        if (!this.deployments.some(x => x.name === d.name)) {
          const dep = this._makeDeployment(d.name, d.image, d.replicas, d.broken, d.envFrom, d.cpuHeavy);
          if (d.containerPort !== undefined) dep.containerPort = d.containerPort; // #164
          this._seedEphemeral(dep, d); // node/emptyDir/ephemeral-storage (#240)
          this.deployments.push(dep);
        }
      }
      for (const cm of sc.configMaps || []) {
        if (!this.configMaps.some(x => x.name === cm.name)) this.configMaps.push(Object.assign({}, cm));
      }
      for (const repo of sc.helmRepos || []) {
        if (!this.helmRepos.includes(repo)) this.helmRepos.push(repo);
      }
      for (const c of sc.charts || []) {
        if (!this.charts.some(x => x.name === c.name)) this.charts.push({ name: c.name, version: c.version || "0.1.0", packaged: !!c.packaged });
      }
      // Services additiv einmischen (#337) – analog zu ingresses/networkPolicies. Ein
      // Quest-Szenario kann so einen vorhandenen Service voraussetzen (z.B. für nslookup),
      // ohne sich darauf zu verlassen, dass eine frühere Quest ihn schon exposed hat.
      for (const s of sc.services || []) {
        if (!this.services.some(x => x.name === s.name)) this.services.push(Object.assign({}, s));
      }
      for (const ing of sc.ingresses || []) {
        if (!this.ingresses.some(x => x.name === ing.name)) this.ingresses.push(Object.assign({}, ing));
      }
      for (const np of sc.networkPolicies || []) {
        if (!this.networkPolicies.some(x => x.name === np.name)) this.networkPolicies.push(Object.assign({}, np));
      }
      if (sc.ciDeploy) this.ci.deploy = Object.assign({}, sc.ciDeploy);
      // Kollaborations-Setup (origin voraus + scharf gestellter Konflikt) als EINHEIT
      // einmischen. game.ts re-merged beim Laden alle erreichten Szenarien – ein nacktes
      // `remoteAhead = N` würde dabei nach jedem Pull wieder auf N hochschnellen. Deshalb
      // hängt es am idempotenten Konflikt-Scharfstellen: nur wenn der Branch NEU ist.
      if (sc.gitConflict && !this.git.branches.includes(sc.gitConflict.branch)) {
        if (sc.gitRemoteAhead) this.git.remoteAhead = sc.gitRemoteAhead;
        this._armGitConflict(sc.gitConflict);
      } else if (sc.gitRemoteAhead && !sc.gitConflict) {
        // remoteAhead ohne Konflikt ist nicht reload-idempotent – nur für Tests/Drills,
        // die den Wert ohnehin direkt setzen und nicht über einen Spielstand neu laden.
        this.git.remoteAhead = sc.gitRemoteAhead;
      }
    }

    /** Stellt einen Merge-Konflikt scharf: legt den hereinkommenden Branch an und
     *  merkt sich, welche Datei beim nächsten `git merge <branch>` kollidiert.
     *  Idempotent über Reloads: existiert der Branch schon, wird nichts neu gemacht. */
    _armGitConflict(c?: GitPending | null) {
      if (!c || this.git.branches.includes(c.branch)) return;
      this.git.branches.push(c.branch);
      this.git.pendingConflict = { branch: c.branch, file: c.file, ours: c.ours, theirs: c.theirs };
      if (!this.files[c.file]) this.files[c.file] = c.ours; // unsere Version liegt im Arbeitsverzeichnis
    }

    /** Zustand als speicherbares Szenario ausgeben (für localStorage). */
    snapshot() {
      return {
        dockerImages: this.docker.pulled.slice(),
        dockerContainers: this.docker.containers.map(c => Object.assign({}, c)),
        nodes: this.nodes.map(n => Object.assign({}, n)),
        deployments: this.deployments.map(d => ({ name: d.name, image: d.image, replicas: d.replicas, broken: d.broken ? Object.assign({}, d.broken) : null, envFrom: { configMaps: d.envFrom.configMaps.slice(), secrets: d.envFrom.secrets.slice() }, cpuHeavy: !!d.cpuHeavy, containerPort: d.containerPort,
          // Ephemeral-Storage (#240): emptyDir/Limit/Nutzung/Node-Pin überleben den Reload; `evicted`
          // wird beim Laden ohnehin neu abgeleitet, daher nicht serialisiert.
          node: d.node, emptyDir: d.emptyDir ? Object.assign({}, d.emptyDir) : undefined, ephemeralLimit: d.ephemeralLimit, ephemeralUsedMi: d.ephemeralUsedMi })),
        services: this.services.map(s => Object.assign({}, s)),
        ingresses: this.ingresses.map(i => Object.assign({}, i)),
        networkPolicies: this.networkPolicies.map(n => Object.assign({}, n)),
        secrets: this.secrets.map(s => ({ name: s.name, keys: s.keys.slice() })),
        configMaps: this.configMaps.map(c => ({ name: c.name, keys: c.keys.slice() })),
        files: Object.assign({}, this.files),
        applyEffects: JSON.parse(JSON.stringify(this.applyEffects)),
        serviceMonitors: this.serviceMonitors.map(s => Object.assign({}, s)),
        prometheusRules: this.prometheusRules.map(r => Object.assign({}, r)),
        grafanaDatasources: this.grafanaDatasources.map(d => Object.assign({}, d)),
        grafanaDashboards: this.grafanaDashboards.map(d => Object.assign({}, d)),
        // Speicher (#122): PVCs gebunden serialisieren (volume + status), damit ein Reload
        // sie NICHT neu provisioniert; StatefulSets nur als Spezifikation – ihre Pods (stabile
        // Namen) und bereits vorhandene PVCs baut reset() deterministisch wieder auf.
        storageClasses: this.storageClasses.map(s => Object.assign({}, s)),
        pvs: this.pvs.map(p => Object.assign({}, p)),
        pvcs: this.pvcs.map(p => ({ name: p.name, storage: p.capacity, status: p.status, volume: p.volume, storageClass: p.storageClass, accessModes: p.accessModes, data: p.data })),
        statefulSets: this.statefulSets.map(s => ({ name: s.name, image: s.image, replicas: s.replicas, serviceName: s.serviceName, volumeClaimName: s.volumeClaimName, storage: s.storage, storageClass: s.storageClass })),
        // Backup/Restore (#140): VolumeSnapshots überleben Reloads als eigenständige Objekte.
        volumeSnapshots: this.volumeSnapshots.map(v => Object.assign({}, v)),
        // Object Store (#241): Buckets + Objekte (mit Inhalt) überleben den Reload – sie sind
        // off-cluster und damit das natürliche Backup-Ziel. `size` wird beim Laden neu abgeleitet.
        s3Buckets: this.objectStore.buckets.map(b => ({ name: b.name, objects: b.objects.map(o => ({ key: o.key, content: o.content, size: o.size })) })),
        // RBAC / ServiceAccounts / Pod-Security (#126). Die "default"-SA legt reset()
        // ohnehin wieder an – nur die selbst erstellten serialisieren.
        serviceAccounts: this.serviceAccounts.filter(s => s.name !== "default").map(s => s.name),
        roles: this.roles.map(r => ({ name: r.name, cluster: r.cluster, rules: r.rules.map(rule => ({ verbs: rule.verbs.slice(), resources: rule.resources.slice() })) })),
        roleBindings: this.roleBindings.map(b => ({ name: b.name, cluster: b.cluster, roleRef: { kind: b.roleRef.kind, name: b.roleRef.name }, subjects: b.subjects.map(s => Object.assign({}, s)) })),
        podSecurity: this.podSecurity,
        argoApps: this.argoApps.map(a => cloneArgoApp(a)),
        helmRepos: this.helmRepos.slice(),
        releases: this.releases.map(r => ({
          name: r.name, chart: r.chart, revision: r.revision, depName: r.depName,
          history: r.history.map(h => Object.assign({}, h)),
        })),
        charts: this.charts.map(c => Object.assign({}, c)),
        tfResources: this.tf.resources.map(r => ({ addr: r.addr, desc: r.desc, provider: r.provider })),
        tfInitialized: this.tf.initialized,
        tfApplied: this.tf.applied,
        tfProviders: this.tf.providers.map(p => ({ name: p.name, source: p.source, version: p.version })),
        tfModules: this.tf.modules.map(m => ({ name: m.name, source: m.source, resources: m.resources.slice(), available: m.available })),
        tfBackend: this.tf.backend ? { type: this.tf.backend.type, name: this.tf.backend.name, locking: this.tf.backend.locking } : null,
        tfOutputs: this.tf.outputs.map(o => ({ name: o.name, value: o.value, sensitive: o.sensitive })),
        tfLocked: this.tf.locked,
        tfLockHolder: this.tf.lockHolder,
        gitInitialized: this.git.initialized,
        gitBranch: this.git.branch,
        gitBranches: this.git.branches.slice(),
        gitStaged: this.git.staged.slice(),
        gitCommitted: this.git.committed.slice(),
        gitCommits: this.git.commits.map(c => Object.assign({}, c)),
        gitPushed: this.git.pushed,
        gitRemoteAhead: this.git.remoteAhead,
        gitFetched: this.git.fetched,
        // pendingConflict landet im gitConflict-Feld; _armGitConflict greift beim
        // Wieder-Einmischen nicht (Branch existiert bereits) -> kein Doppel-Scharfstellen.
        gitConflict: this.git.pendingConflict ? Object.assign({}, this.git.pendingConflict) : null,
        gitActiveConflict: this.git.conflict ? Object.assign({}, this.git.conflict) : null,
        ciPipelines: this.ci.pipelines.map(p => ({
          id: p.id, ref: p.ref, status: p.status, created: p.created,
          stages: p.stages.map(s => Object.assign({}, s)),
        })),
        ciDeploy: this.ci.deploy ? Object.assign({}, this.ci.deploy) : null,
      };
    }

    /** Führt eine Befehlszeile aus. Rückgabe: { output, error } */
    exec(line: string): ExecResult {
      this.clock++;
      // Argo CD reconciliert vor jeder Eingabe: Self-Heal-Apps drehen zwischenzeitlichen
      // Drift (z.B. ein `kubectl scale` aus dem letzten Befehl) von selbst auf den Git-Soll zurück.
      reconcileAutoSync(this);
      // Alert-Regeln gegen den (ggf. gerade reconcilten) Zustand auswerten, damit der
      // firing→resolved-Verlauf mitläuft, während gespielt wird (Observability #109).
      obsEvaluateAlerts(this);
      // Fehlende eigene Images zieht der kubelet nach: ein needsBuild-ImagePullBackOff
      // heilt, sobald das Image lokal gebaut/gezogen wurde (#164, Werft-Capstone).
      this._recheckImagePull();
      // Disk-Druck/Eviction gegen den aktuellen Zustand ableiten (#240): DiskPressure je Node,
      // Evicted je Pod (Limit gesprengt oder Node-Disk voll). Rein deterministisch, kein Zufall.
      this._evaluateEviction();
      this.lastError = false;
      const raw = line.trim();
      if (!raw) return { output: "", error: false };

      const tokens = raw.split(/\s+/);
      const cmd = tokens[0];

      let out: string;
      try {
        switch (cmd) {
          case "docker": out = dockerCommand(this, tokens, raw); break;
          case "kubectl": out = kubectlCommand(this, tokens, raw); break;
          case "helm": out = helmCommand(this, tokens, raw); break;
          case "terraform": out = terraformCommand(this, tokens, raw); break;
          case "git": out = gitCommand(this, tokens, raw); break;
          case "argocd": out = argocdCommand(this, tokens); break;
          case "glab": out = glabCommand(this, tokens); break;
          case "nslookup": out = nslookupCommand(this, tokens); break;
          case "curl": out = curlCommand(this, tokens); break;
          case "aws": out = awsCommand(this, tokens, raw); break;
          case "ls": out = this._ls(); break;
          case "cat": out = this._cat(tokens); break;
          case "clear": return { output: null, error: false, clear: true };
          case "help": out = this._help(); break;
          default: {
            const guess = this._suggest(cmd, ["docker", "kubectl", "helm", "terraform", "git", "argocd", "glab", "nslookup", "curl", "aws", "ls", "cat", "clear", "help"]);
            out = this._err("⚠️ Den Befehl '" + cmd + "' gibt es hier nicht.",
              guess ? "Meintest du '" + guess + "'? (Tippe 'help' für alle Befehle.)"
                    : "Tippe 'help' für eine Liste der Befehle, die hier funktionieren.");
          }
        }
      } catch (e) {
        this.lastError = true;
        out = "Hoppla, da ist im Simulator etwas schiefgegangen: " + (e instanceof Error ? e.message : String(e));
      }
      return { output: out, error: this.lastError };
    }

    _err(msg: string, tip?: string) {
      this.lastError = true;
      return msg + (tip ? "\n💡 " + tip : "");
    }

    /** Editierdistanz (Levenshtein) – für „Meintest du …?"-Vorschläge. */
    _editDistance(a: string, b: string) {
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
    _suggest(word: string, list: string[]): string | null {
      let best: string | null = null, bestD = Infinity;
      for (const cand of list) {
        const dist = this._editDistance(word.toLowerCase(), cand.toLowerCase());
        if (dist < bestD) { bestD = dist; best = cand; }
      }
      const limit = word.length <= 4 ? 1 : 2; // bei kurzen Wörtern strenger
      return bestD <= limit && bestD > 0 ? best : null;
    }

    /** Wert hinter einer Flag finden: unterstützt "-n wert" und "-n=wert". */
    _flagValue(tokens: string[], flag: string): string | null {
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === flag) return tokens[i + 1] || null;
        if (tokens[i].startsWith(flag + "=")) return tokens[i].slice(flag.length + 1);
      }
      return null;
    }

    /** Alle Werte eines (wiederholbaren UND kommagetrennten) Flags einsammeln, z.B.
     *  `--verb=get,list --verb=watch` → ["get","list","watch"]. Für RBAC-Befehle (#126). */
    _multiFlag(raw: string, flag: string): string[] {
      const re = new RegExp("--" + flag + "[=\\s]([^\\s]+)", "g");
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw)) !== null) {
        for (const part of m[1].split(",")) if (part) out.push(part);
      }
      return out;
    }

    _help() {
      return [
        "Verfügbare Befehle im Simulator:",
        "  docker     pull | build -t <name> . | tag <quelle> <ziel> | run | ps [-a] | images | stop | rm",
        "  kubectl    get pods|deployments|services|endpoints|ingress|networkpolicies|servicemonitors|prometheusrules|grafanadatasources|grafanadashboards|alerts|nodes|secrets|configmaps|serviceaccounts|roles|rolebindings | describe pod|node|ingress|networkpolicy|role|serviceaccount <name>",
        "             create deployment | create secret generic|tls | create configmap | create serviceaccount|role|clusterrole|rolebinding|clusterrolebinding | scale | expose | delete | apply -f <datei>",
        "             auth can-i <verb> <resource> [--as=…] | label namespace <ns> pod-security.kubernetes.io/enforce=<stufe>",
        "             logs [-f] [--previous] <pod> | top pods|nodes | set image deployment/<n> <c>=<img> | set env deployment/<n> --from=configmap|secret/<n> | set resources deployment/<n> --limits=memory=256Mi|ephemeral-storage=1Gi | rollout restart deployment <n>",
        "  helm       repo add|update | search repo | create | lint | package | install | list | upgrade | rollback | uninstall | status",
        "  terraform  init | plan | apply | destroy | state list",
        "  git        init | status | add <datei> | commit -m \"…\" | log | branch [<name>] | checkout [-b] <name> | merge <name> | push | fetch | pull",
        "  argocd     app list | app get <name> | app sync <name>  (Argo CD / GitOps – den Git-Soll in den Cluster ziehen)",
        "  glab       ci status | ci list  (Pipeline-Status in GitLab)",
        "  nslookup   <name>  (DNS: fragt CoreDNS nach der Adresse hinter einem Service-Namen)",
        "  curl       [http://]<service>[:port][/pfad]  (ruft einen Service ab – läuft mein Dienst und ist er erreichbar?)",
        "  aws s3     mb s3://<bucket> | rb s3://<bucket> [--force] | ls [s3://<bucket>] | cp <quelle> <ziel> | rm s3://<bucket>/<key>  (Object Store – off-cluster)",
        "  ls, cat <datei>, clear, help",
      ].join("\n");
    }

    // nslookup (#337) + curl (#164) liegen seit #164 in ./sim/net.ts (Erreichbarkeits-
    // Befehle, KEINE kubectl-Unterbefehle). `exec` ruft nslookupCommand/curlCommand(this, …);
    // die Sim-Klasse erfüllt das schmale NetHost-Interface über ihre Felder + Helfer.

    // Observability (#109/#110) liegt seit #384 in ./sim/observability.ts. Die öffentliche API
    // bleibt hier als dünne Delegation, damit Aufrufer (kubectl get/top über KubectlHost,
    // content/checks + content/drills, Tests) unverändert sim.podMetrics() & Co. nutzen.
    podMetrics(): Array<{ name: string; cpuMilli: number; memMi: number }> { return obsPodMetrics(this); }
    nodeMetrics(): NodeMetrics[] { return obsNodeMetrics(this); }
    scrapeTargets(): ScrapeTarget[] { return obsScrapeTargets(this); }
    alerts(): Alert[] { return obsAlerts(this); }

    // glab/CI (GitLab-CLI + Pipeline-Maschinerie) liegt seit #385 in ./sim/glab.ts –
    // die letzte Nicht-Befehls-Familie des sim.ts-Splits (#346). `exec` ruft
    // glabCommand(this, …); die Pipeline startet beim `git push` direkt aus sim/git.ts
    // (runPipeline), nicht mehr über eine Host-Methode hier.

    _ls() {
      const names = Object.keys(this.files);
      if (names.length === 0) return "(dieser Ordner ist leer)";
      return names.join("\n");
    }

    _cat(t: string[]) {
      const file = t[1];
      if (!file) return this._err("cat: Welche Datei?", "Mit 'ls' siehst du, was hier liegt.");
      if (!this.files[file]) return this._err("cat: " + file + ": Datei nicht gefunden", "Mit 'ls' siehst du, was hier liegt.");
      return this.files[file];
    }
  }

  export { Sim };
