/* ===== KubeQuest – Simulator-Zustand & Domänentypen (sim/state.ts) =====
 * Schritt 1/7 des sim.ts-Datei-Splits (#372, aus Epic #346, ADR 0004).
 *
 * Hier liegt der **gemeinsame Cluster-Zustand** als Typen: alle Interfaces der
 * simulierten Ressourcen (Pod, Deployment, Service, Secret, ConfigMap, Node …),
 * die serialisierbare `Scenario`-Form und die aggregierende `ClusterState`-
 * Schnittstelle (ganz unten). `sim.ts` importiert von hier und re-exportiert alles
 * als Barrel, damit bestehende `import … from "../sim"` unverändert weiterlaufen.
 *
 * Warum zuerst: die Folge-Schritte (#373 docker, #374 kubectl … #378 argocd) lagern
 * die Befehls-Handler in eigene Module aus – die brauchen genau diese Typen + den
 * State-Vertrag als gemeinsame Basis. Reine Typen, kein Laufzeit-Code → Phaser-frei,
 * importfrei, vom Architektur-Wächter (#347) automatisch als Domäne geschützt.
 *
 * Echte Interfaces für die simulierten Ressourcen (Pod/Deployment/Service …) statt
 * `any`. Sie sichern Felder + Mutationen im ganzen Simulator ab.
 */

/** Ergebnis einer simulierten Befehlszeile (`Sim.exec`). Lebt hier (Sim-Domänentyp)
 *  und nicht in `types.ts`, damit `sim.ts` nicht zurück auf `types.ts` zeigen muss –
 *  das vermeidet den Import-Zyklus types ↔ sim (#390, keine-zyklen-Regel). */
export interface ExecResult {
  output: string | null;
  error: boolean;
  clear?: boolean;
}

/** Art einer absichtlich kaputten Workload (für die Troubleshooting-Quests). */
export interface Broken {
  type: string; // "imagepull" | "crashloop" | "pending" | "notready" | "oomkilled"
  badImage?: string;
  // Bei "imagepull": der Pod scheitert NICHT an einem Tippfehler, sondern weil das
  // (richtig benannte) eigene Image noch nicht lokal gebaut/gezogen ist (#164, Werft-
  // Capstone). Anders als ein echter Tippfehler heilt das von selbst, sobald
  // `docker build`/`docker pull` das Image bereitstellt (der kubelet zieht es nach).
  needsBuild?: boolean;
  // Fehlendes Secret, das die App braucht. Bei "crashloop" stirbt sie ohne es,
  // bei "notready" läuft sie zwar (liveness ok), meldet sich aber erst als
  // bereit, sobald das Secret da ist (readiness). Sobald es existiert, heilt
  // crashloop per `rollout restart`, notready ganz von selbst (Probe prüft weiter).
  needsSecret?: string;
  // Bei "oomkilled": So viel Speicher (in Mi) braucht die App wirklich. Solange
  // das memory-Limit darunter liegt, killt der Kernel den Container immer wieder
  // (OOMKilled). Wird das Limit per `kubectl set resources` auf >= memNeeded
  // angehoben, heilt der Dienst. Diagnose nur über `describe` (Last State /
  // Reason: OOMKilled) – die App-Logs verraten den OOM-Kill NICHT.
  memNeeded?: number;
}
/** Eine einzelne Pod-Instanz eines Deployments. */
export interface PodInstance {
  name: string;
  created: number;
  restarts: number;
}
export interface Deployment {
  name: string;
  image: string;
  replicas: number;
  created: number;
  pods: PodInstance[];
  broken: Broken | null;
  /** ServiceAccount-Identität der Pods (`spec.serviceAccountName`, #132). Fehlt das
   *  Feld, laufen die Pods unter der `default`-SA des Namespaces – genau wie in echtem
   *  Kubernetes. Wird per `kubectl apply` aus dem Pod-Template gesetzt. */
  serviceAccountName?: string;
  /** Aktuelles memory-Limit in Mi (per `kubectl set resources` gesetzt). Laufzeit-Feld,
   *  nicht serialisiert – relevant nur für die OOMKilled-Diagnose innerhalb einer Sitzung. */
  memLimit?: number;
  /** Eingebundene Config/Geheimnisse (via `kubectl set env --from=…`).
   *  configMaps = harmlose Einstellungen, secrets = Vertrauliches. */
  envFrom: { configMaps: string[]; secrets: string[] };
  /** Port, auf dem der Container im Pod lauscht (`spec.containers[].ports[].containerPort`,
   *  #164). Aus dem Manifest beim `kubectl apply`. Stimmt er nicht mit dem `targetPort`
   *  des Service überein, hat der Service zwar Endpoints, aber `curl` läuft ins Leere –
   *  die klassische Verdrahtungsfalle. Fehlt das Feld, wird der Port nicht geprüft. */
  containerPort?: number;
  /** Dauerlast-Markierung: die Pods dieses Deployments ziehen ungewöhnlich viel CPU
   *  (Observability #109). Treibt `kubectl top` über die Schwelle und lässt den
   *  HighPodCPU-Alert feuern – die Spiel-Ursache für „warum brennt mein Cluster?". */
  cpuHeavy?: boolean;
  /** Knoten, auf dem die Pods laufen (#240, Ephemeral-Storage). Undefiniert = deterministische
   *  Default-Platzierung über die Worker (round-robin per `_nodeOf`). Relevant für die
   *  Node-Disk-Bilanz: emptyDir + Writable-Layer der hier laufenden Pods zählen auf die Disk
   *  dieses Knotens. */
  node?: string;
  /** Flüchtiges Scratch-Volume am Pod (`emptyDir`, #240): lebt MIT dem Pod und ist nach einem
   *  Pod-Neustart leer (`data` ""). Direkter Gegensatz zum PVC (#122/#129), das den Pod überlebt.
   *  `usedMi` = belegter Platz; zählt auf die ephemeral-storage-Bilanz von Pod UND Node. */
  emptyDir?: { data: string; usedMi: number };
  /** `ephemeral-storage`-Limit des Containers in Mi (#240, analog `memLimit` für memory). Reißt die
   *  tatsächliche ephemeral-Nutzung dieses Limit, evictet der kubelet den Pod (Status `Evicted`). */
  ephemeralLimit?: number;
  /** Zusätzliche ephemeral-Nutzung neben `emptyDir` in Mi (#240): Container-Writable-Layer + Logs.
   *  Wird – wie emptyDir – bei Pod-Neustart freigegeben. */
  ephemeralUsedMi?: number;
  /** Gesetzt, wenn der Pod evicted wurde (#240): entweder Disk-Druck am Node (`DiskPressure`) oder
   *  das eigene ephemeral-storage-Limit gesprengt. Rein abgeleitet (`_evaluateEviction` rechnet es
   *  bei jedem Befehl neu): fällt der Grund weg (Limit erhöht / Disk freigegeben / Pod neugestartet),
   *  verschwindet die Markierung wieder. */
  evicted?: { reason: string } | null;
}
export interface ServiceRes {
  name: string;
  type: string;
  clusterIP: string;
  port: string | number;
  /** Ziel-Port hinter dem Service (`spec.ports[].targetPort`, #164): an welchen
   *  Container-Port der Service weiterleitet. Fehlt er, gilt `port` auch als Ziel
   *  (wie in echtem Kubernetes). Passt er nicht zum `containerPort` des Deployments,
   *  läuft `curl` ins Leere – sichtbar nur beim Abfragen, nicht an den Endpoints. */
  targetPort?: string | number;
  /** Ziel-DNS-Name eines ExternalName-Service (#337): statt einer ClusterIP zeigt der
   *  Service per CNAME auf einen externen Namen (z.B. api.bank.example.com). Nur dann
   *  gesetzt; `type` ist dann "ExternalName" und `clusterIP` ist "<none>". */
  externalName?: string;
  created?: number;
}
/** Hafentor: leitet eine Außen-Adresse (host/pfad) an einen Service im Cluster. */
export interface IngressRes {
  name: string;
  className: string;      // z.B. "nginx" – welcher Ingress-Controller zuständig ist
  host: string;          // z.B. "hafen.de"
  path: string;          // z.B. "/kasse"
  service: string;       // Ziel-Service im Cluster
  port: string | number; // Ziel-Port des Services
  tls?: { secretName: string }; // verschlüsseltes Hafentor: TLS-Terminierung mit diesem Secret
  created?: number;
}
/** Hafenmauer: regelt, welche Pods überhaupt zu einem Ziel-Pod durchdürfen (Firewall im Cluster). */
export interface NetworkPolicyRes {
  name: string;
  podSelector: string;   // app-Label der geschützten Pods ("" = alle Pods im Namespace)
  allowFrom: string;     // app-Label der einzigen erlaubten Quelle ("" = niemand: default-deny)
  created?: number;
}
export interface Secret {
  name: string;
  keys: string[];
  type?: string;         // z.B. "kubernetes.io/tls" für TLS-Secrets; sonst "Opaque"
  created?: number;
}
/** ConfigMap: harmlose Einstellungen im Klartext (DB-Host, Log-Level …).
 *  Gegenstück zum Secret – ConfigMaps gehören NIE Vertrauliches. */
export interface ConfigMap {
  name: string;
  keys: string[];
  created?: number;
}
export interface ClusterNode {
  name: string;
  status: string;
  roles: string;
  version: string;
  /** Lokale Disk-Kapazität für ephemeral storage in Mi (#240): emptyDir + Writable-Layer der
   *  hier laufenden Pods zählen darauf. Undefiniert = unbegrenzt (klassischer Cluster ohne
   *  Disk-Druck) – so bleiben alle Alt-Szenarien unberührt und bekommen nie DiskPressure. */
  ephemeralCapacityMi?: number;
  /** Von System/Images/Logs belegte Disk-Baseline in Mi (#240), unabhängig von Workloads. */
  ephemeralBaseMi?: number;
  /** Abgeleitet (`_evaluateEviction`): Disk über der Kapazitätsschwelle → der kubelet setzt
   *  die Node-Condition `DiskPressure` und evictet Pods, bis wieder Platz ist (#240). */
  diskPressure?: boolean;
}
export interface Container {
  name: string;
  image: string;
  running: boolean;
  created: number;
  id: string;
}
export interface HistoryEntry {
  revision: number;
  replicas: number;
}
export interface Release {
  name: string;
  chart: string;
  revision: number;
  depName: string;
  history: HistoryEntry[];
}
/** Ein lokal mit `helm create` gerüstetes Chart (Werft-Ausbau, Issue #27). */
export interface Chart {
  name: string;
  version: string;
  packaged: boolean;
}
export interface TfResource {
  addr: string;
  desc: string;
  /** Lokaler Name des `provider`-Blocks, der diese Ressource anlegt (#146). Fehlt das
   *  Feld, nimmt Terraform den Default-Provider. Verweist es auf einen NICHT deklarierten
   *  Provider, scheitern plan/apply (Fehlerfall „unbekannter Provider"). */
  provider?: string;
}
/** Ein deklarierter `provider`-Block (provider.tf, #146): erlaubt Ressourcen bei einem
 *  bestimmten Anbieter („Insel-Provider A/B"). `terraform init` lädt das Plugin (`installed`). */
export interface TfProvider {
  name: string;        // lokaler Name, z.B. "insel-a"
  source?: string;     // Registry-Quelle, z.B. "hashicorp/aws"
  version?: string;    // z.B. "5.40.0"
  installed: boolean;  // von `terraform init` geladen (Plugin liegt lokal)
}
/** Ein referenzierter `module`-Block (#146): ein wiederverwendbarer Baustein, der MEHRERE
 *  Ressourcen als Einheit erzeugt. `terraform get`/`init` holt ihn (`fetched`); danach
 *  expandiert er in `module.<name>.<res>`-Adressen in plan/apply/state. */
export interface TfModule {
  name: string;            // module "<name>" { … }
  source: string;          // source = "./modules/hafen-anlage" o.ä.
  resources: string[];     // Ressourcen, die der Baustein erzeugt (relative Adressen)
  fetched: boolean;        // von init/get geholt
  /** false = Quelle nicht auflösbar → init/get scheitern (Fehlerfall „unbekanntes Modul").
   *  Fehlt das Feld, gilt der Baustein als auffindbar. */
  available?: boolean;
}
/** Ein `backend`-Block (#146): verlagert den State weg vom lokalen Ordner in ein
 *  geteiltes „Flotten-Lager" (S3-artig). null = lokaler State. `locking` macht das
 *  State-Locking-Konzept greifbar: nur EINE Crew darf den geteilten State zugleich ändern. */
export interface TfBackend {
  type: string;            // z.B. "s3"
  name?: string;           // z.B. Bucket-/Container-Name ("flotten-lager")
  locking?: boolean;       // unterstützt der Backend-Typ State-Locking?
}
/** Ein deklarierter `output`-Block (#146): ein Wert, den `terraform output` nach dem
 *  Apply ausgibt (z.B. eine erzeugte Adresse). `sensitive` verbirgt ihn in der Liste. */
export interface TfOutput {
  name: string;
  value: string;
  sensitive?: boolean;
}
export interface GitCommit {
  hash: string;
  msg: string;
  branch: string;
  files: string[];
}
/** Ein aktiver, noch nicht aufgelöster Merge-Konflikt in genau einer Datei.
 *  `ours` = die Version deines aktuellen Branches, `theirs` = die hereinkommende. */
export interface GitConflict {
  file: string;
  ours: string;
  theirs: string;
  from: string; // Branch, der den Konflikt mitbrachte
}
/** Scharf gestellter Konflikt: bricht los, sobald `git merge <branch>` den
 *  passenden Branch hereinholt. So lässt sich ein Konflikt didaktisch planen. */
export interface GitPending {
  branch: string;
  file: string;
  ours: string;
  theirs: string;
}
export interface PipelineStage {
  name: string;
  status: string;
}
export interface Pipeline {
  id: number;
  ref: string;
  status: string;
  stages: PipelineStage[];
  created: number;
}
export interface CiDeploy {
  name: string;
  image: string;
  replicas: number;
}
/** Soll-Zustand einer Argo-Application: was die Manifeste im „Git"-Repo deklarieren. */
export interface ArgoDesired {
  deployment: { name: string; image: string; replicas: number };
  service?: { name: string; type?: string; port: string | number };
}
/** Eine Kind-Application im App-of-Apps-Muster: was im `flotte/`-Ordner liegt und von
 *  der Wurzel-Application beim Sync angelegt wird. Jede ist selbst eine ganz normale
 *  Argo-App (eigenes Deployment), nur erzeugt sie nicht der Mensch, sondern die Wurzel. */
export interface ArgoChildSpec {
  name: string;
  path?: string;       // Pfad im Repo (Default: <name>/)
  deployment: { name: string; image: string; replicas: number };
  service?: { name: string; type?: string; port: string | number };
}
/** Eine von Argo CD verwaltete Application – das Herzstück von GitOps.
 *  Argo vergleicht den im Git deklarierten Soll-Zustand (`desired`) laufend mit dem
 *  Cluster und gleicht ihn per **Pull** an: manuell (`argocd app sync`) oder automatisch
 *  (`autoSync`). `selfHeal` dreht manuellen Drift (z.B. `kubectl scale`) von selbst zurück
 *  – so wird das Pull-Prinzip spürbar: Git ist die Quelle der Wahrheit, nicht der Cluster.
 *  Eine **App-of-Apps-Wurzel** rollt kein eigenes Deployment aus (`desired` fehlt), sondern
 *  zeigt über `childApps` auf einen Ordner voller weiterer Applications und legt diese beim
 *  Sync an – so verwaltet eine einzige Wurzel die ganze „Flotte" (#97). */
export interface ArgoApp {
  name: string;
  repo: string;        // Quell-Repo, in dem die Manifeste liegen
  path: string;        // Pfad im Repo
  autoSync: boolean;   // synchronisiert von selbst (kein manuelles `argocd app sync` nötig)
  selfHeal: boolean;   // korrigiert manuellen Drift automatisch auf den Git-Soll zurück
  desired?: ArgoDesired;        // Soll-Workload – entfällt bei einer App-of-Apps-Wurzel
  childApps?: ArgoChildSpec[];  // App-of-Apps: die Applications im `path`-Ordner
  created: number;
}
/** Wirkung eines `kubectl apply -f <datei>` (was die Datei im Cluster erzeugt). */
export interface ApplyEffect {
  deployment?: { name: string; image: string; replicas: number; securityContext?: SecurityContext; serviceAccountName?: string; containerPort?: number;
    // #164 (Werft-Capstone): das eigene Image muss vorher lokal gebaut/gezogen sein,
    // sonst landet der Pod im ImagePullBackOff (statt – wie sonst im Sim – einfach zu laufen).
    requireBuiltImage?: boolean;
    // Ephemeral-Storage aus dem Pod-Template (#240): emptyDir-Volume + ephemeral-storage-Limit/-Nutzung.
    node?: string; emptyDir?: { data?: string; usedMi?: number }; ephemeralLimit?: number; ephemeralUsedMi?: number };
  // RBAC-CRDs (#128): vom `kubectl apply -f` der Wachturm-Manifeste angelegt. `cluster`
  // unterscheidet Role/ClusterRole bzw. RoleBinding/ClusterRoleBinding (wie in roles/roleBindings).
  serviceAccount?: { name: string };
  role?: { name: string; cluster?: boolean; rules: PolicyRule[] };
  roleBinding?: { name: string; cluster?: boolean; roleRef: { kind: "Role" | "ClusterRole"; name: string }; subjects: RbacSubject[] };
  // `externalName` macht den Service zu einem ExternalName-Service (#337): kein ClusterIP,
  // sondern ein CNAME auf den genannten externen DNS-Namen. `port` darf dann "" sein.
  service?: { name: string; type?: string; port: string | number; externalName?: string; targetPort?: string | number };
  ingress?: { name: string; host: string; path?: string; service: string; port: string | number; className?: string; tls?: { secretName: string } };
  networkPolicy?: { name: string; podSelector?: string; allowFrom?: string };
  // Eine Argo-Application-CRD: legt beim `kubectl apply -f` eine Argo-App im Sim-State an.
  // `childApps` macht sie zur App-of-Apps-Wurzel (verwaltet nur weitere Applications, kein eigenes Deployment).
  application?: { name: string; repo?: string; path?: string; autoSync?: boolean; selfHeal?: boolean; deployment?: { name: string; image: string; replicas: number }; service?: { name: string; type?: string; port: string | number }; childApps?: ArgoChildSpec[] };
  // Observability-CRDs (#110): vom `kubectl apply -f` der Monitoring-Manifeste angelegt.
  serviceMonitor?: { name: string; selector: string; port?: string; interval?: string };
  prometheusRule?: { name: string; alert: string; severity?: string; expr?: string; forDuration?: string };
  grafanaDatasource?: { name: string; dsType?: string; url?: string };
  grafanaDashboard?: { name: string; title: string; panels?: number };
  // Stateful-Workload-CRDs (#122): vom `kubectl apply -f` der Lagerhallen-Manifeste angelegt.
  statefulSet?: { name: string; image: string; replicas: number; serviceName?: string; volumeClaimName?: string; storage?: string; storageClass?: string };
  // `data` seedet den Volume-Inhalt beim Anlegen (Backup/Restore #140); `dataSource` stellt
  // den Inhalt aus einem VolumeSnapshot wieder her (spec.dataSource → kind: VolumeSnapshot).
  pvc?: { name: string; storage?: string; storageClass?: string; accessModes?: string; data?: string; dataSource?: string };
  pv?: { name: string; capacity?: string; storageClass?: string; accessModes?: string; reclaimPolicy?: string };
  storageClass?: { name: string; provisioner?: string; reclaimPolicy?: string; isDefault?: boolean };
  // Backup/Restore-CRD (#140): VolumeSnapshot eines Quell-PVC.
  volumeSnapshot?: { name: string; sourcePvc: string };
}

/* ---------- Observability-Manifeste als Cluster-Objekte (#110) ---------- */

/** ServiceMonitor: legt fest, welchen Service Prometheus scrapt. */
export interface ServiceMonitorRes {
  name: string;
  selector: string;   // app-Label des gescrapten Service
  port: string;       // benannter Port / Portnummer des /metrics-Endpunkts
  interval: string;   // Scrape-Intervall, z.B. "30s"
  created?: number;
}
/** PrometheusRule: eine Alert-Regel samt Schwelle. */
export interface PrometheusRuleRes {
  name: string;
  alert: string;       // Name des Alarms, z.B. "HighPodCPU"
  expr: string;        // Bedingung (PromQL-artig)
  forDuration: string; // Dauer vor dem Feuern, z.B. "5m"
  severity: string;    // "warning" | "critical"
  created?: number;
}
/** GrafanaDatasource: woher Grafana die Metriken zieht. */
export interface GrafanaDatasourceRes {
  name: string;
  dsType: string;      // z.B. "prometheus"
  url: string;
  created?: number;
}
/** GrafanaDashboard: ein deklaratives Dashboard (Titel + Panel-Anzahl). */
export interface GrafanaDashboardRes {
  name: string;
  title: string;
  panels: number;
  created?: number;
}
/* ---------- Stateful Workloads & Speicher (#122, Phase 7) ---------- */

/** StatefulSet: Workload mit STABILER Identität. Anders als ein Deployment heißen
 *  die Pods nicht zufällig, sondern fest `<name>-0`, `<name>-1`, … und jeder bekommt
 *  über `volumeClaimTemplates` ein eigenes, dauerhaftes PVC. */
export interface StatefulSetRes {
  name: string;
  image: string;
  replicas: number;
  serviceName: string;       // zugehöriger (headless) Service, der die stabilen Netzwerk-IDs vergibt
  volumeClaimName: string;   // Name des volumeClaimTemplate → PVC heißt "<vct>-<name>-<ordinal>"
  storage: string;           // angeforderte Größe je Replica, z.B. "1Gi"
  storageClass?: string;     // welche StorageClass die PVCs provisioniert (leer/undefiniert = Default)
  pods: PodInstance[];       // stabile Namen <name>-0 …
  created: number;
}
/** PersistentVolumeClaim: der Antrag eines Pods auf dauerhaften Speicher. Bindet an
 *  ein PV (statisch) bzw. wird über eine StorageClass dynamisch provisioniert. */
export interface PvcRes {
  name: string;
  status: "Pending" | "Bound"; // Pending = noch kein Speicher gefunden, Bound = hat ein PV
  volume: string;              // Name des gebundenen PV ("" solange Pending)
  capacity: string;            // angeforderte/gebundene Größe, z.B. "1Gi"
  storageClass: string;        // genutzte StorageClass ("" = statische Bindung an vorhandenes PV)
  accessModes: string;         // z.B. "RWO" (ReadWriteOnce)
  data?: string;               // Inhalt des Volumes (Backup/Restore #140): Platzhalter-Marke für die
                               // gespeicherten Daten. Ein VolumeSnapshot sichert genau diese Marke; ein
                               // Restore aus dem Snapshot setzt sie wieder. Undefiniert/"" = leeres Volume.
  created: number;
}
/** PersistentVolume: das konkrete Speicherstück im Cluster (statisch angelegt oder
 *  dynamisch von einer StorageClass erzeugt). */
export interface PvRes {
  name: string;
  capacity: string;
  status: "Available" | "Bound" | "Released"; // frei / an ein PVC gebunden / PVC weg, noch nicht recycelt
  claim: string;               // gebundenes PVC ("default/<name>", "" solange Available)
  storageClass: string;
  accessModes: string;
  reclaimPolicy: string;       // "Delete" | "Retain" – was beim Freigeben passiert
  created: number;
}
/** StorageClass: die Vorlage, nach der PVCs dynamisch ein PV bekommen. */
export interface StorageClassRes {
  name: string;
  provisioner: string;         // wer das PV anlegt, z.B. "rancher.io/local-path"
  reclaimPolicy: string;       // "Delete" | "Retain"
  isDefault: boolean;          // greift, wenn ein PVC keine StorageClass nennt
  created: number;
}
/** VolumeSnapshot (CSI, #140): ein Point-in-Time-Abzug des Volumes hinter einem PVC.
 *  Ein EIGENSTÄNDIGES Objekt – es überlebt das Löschen seiner Quelle, genau das ist
 *  der Sinn eines Backups. Aus einem readyToUse-Snapshot stellt man wieder her, indem
 *  man ein neues PVC mit `dataSource` darauf zeigt (siehe ApplyEffect.pvc.dataSource). */
export interface VolumeSnapshotRes {
  name: string;
  sourcePvc: string;           // spec.source.persistentVolumeClaimName – das gesicherte PVC
  data: string;                // der zum Snapshot-Zeitpunkt eingefrorene Volume-Inhalt (Kopie)
  restoreSize: string;         // status.restoreSize – Größe der Quelle zum Snapshot-Zeitpunkt
  readyToUse: boolean;         // status.readyToUse – erst dann ist ein Restore möglich
  created: number;
}
/* === Wachturm-Quartier: RBAC / ServiceAccounts / Pod-Security (#126) === */
/** ServiceAccount: die Identität, unter der ein Pod im Cluster auftritt. Jeder
 *  Namespace hat von Haus aus die "default"-SA; eigene legt man für Least-Privilege an. */
export interface ServiceAccountRes {
  name: string;
  created: number;
}
/** Eine Berechtigungs-Regel: welche `verbs` auf welche `resources` (je `*` = alles). */
export interface PolicyRule {
  verbs: string[];
  resources: string[];
}
/** Role (namespaced) bzw. ClusterRole (cluster-weit) – ein Bündel von Regeln.
 *  `cluster=true` markiert die ClusterRole; ausgewertet werden beide gleich. */
export interface RoleRes {
  name: string;
  cluster: boolean;
  rules: PolicyRule[];
  created: number;
}
/** Subjekt einer Bindung – wer die Rechte bekommt (User oder ServiceAccount). */
export interface RbacSubject {
  kind: "User" | "ServiceAccount";
  name: string;
  namespace?: string;   // nur bei ServiceAccount
}
/** RoleBinding / ClusterRoleBinding: verbindet ein/mehrere Subjekte mit genau einer Rolle. */
export interface RoleBindingRes {
  name: string;
  cluster: boolean;     // true = ClusterRoleBinding
  roleRef: { kind: "Role" | "ClusterRole"; name: string };
  subjects: RbacSubject[];
  created: number;
}
/** securityContext eines Pods – die für die Pod-Security-Admission relevanten Felder. */
export interface SecurityContext {
  runAsNonRoot?: boolean;
  privileged?: boolean;
  readOnlyRootFilesystem?: boolean;
  allowPrivilegeEscalation?: boolean;
}
/** Durchgesetzte Pod-Security-Standards-Stufe (Namespace-Label `pod-security.kubernetes.io/enforce`). */
export type PodSecurityLevel = "privileged" | "baseline" | "restricted";
/** Berechneter Anzeige-Status eines Pods (für get/describe). */
export interface PodStatus {
  status: string;
  ready: string;
  restarts: number;
}

/* ---------- Observability (#109) ---------- */

/** Momentane Ressourcen-Last eines Pods (Grundlage für `kubectl top` + Prometheus). */
export interface PodMetrics {
  cpuMilli: number; // CPU in Millicores (m)
  memMi: number;    // Arbeitsspeicher in Mi
}
/** Aggregierte Node-Last inkl. Auslastung in Prozent der (vereinfachten) Kapazität. */
export interface NodeMetrics {
  name: string;
  cpuMilli: number;
  cpuPct: number;
  memMi: number;
  memPct: number;
}
/** Ein Prometheus-Scrape-Ziel: was abgegrast wird und ob es erreichbar ist. */
export interface ScrapeTarget {
  job: string;            // Prometheus-Job (z.B. "kubelet" oder ein Service-Name)
  instance: string;       // konkrete Adresse, die gescrapt wird
  health: "up" | "down";  // antwortet das Ziel?
}
/** Ein Alert aus dem (simulierten) Alertmanager. */
export interface Alert {
  name: string;                    // Regel-Name, z.B. "KubePodCrashLooping"
  severity: "warning" | "critical";
  state: "firing" | "resolved";    // brennt gerade / war mal an, Ursache behoben
  summary: string;                 // kurze Erklärung fürs Spiel
}

/** Eingabe-Szenario einer Quest-Welt. Alle Felder optional – reset() füllt Defaults. */
export interface Scenario {
  dockerImages?: string[];
  dockerContainers?: Container[];
  nodes?: ClusterNode[];
  deployments?: Array<{ name: string; image: string; replicas: number; broken?: Broken | null; envFrom?: { configMaps: string[]; secrets: string[] }; cpuHeavy?: boolean; containerPort?: number;
    // Ephemeral-Storage (#240). Eingabe-Schreibweisen locker – reset()/merge füllen Defaults.
    node?: string; emptyDir?: { data?: string; usedMi?: number }; ephemeralLimit?: number; ephemeralUsedMi?: number }>;
  services?: ServiceRes[];
  ingresses?: IngressRes[];
  networkPolicies?: NetworkPolicyRes[];
  secrets?: Secret[];
  configMaps?: ConfigMap[];
  files?: Record<string, string>;
  applyEffects?: Record<string, ApplyEffect>;
  serviceMonitors?: ServiceMonitorRes[];
  prometheusRules?: PrometheusRuleRes[];
  grafanaDatasources?: GrafanaDatasourceRes[];
  grafanaDashboards?: GrafanaDashboardRes[];
  // Stateful Workloads & Speicher (#122). Eingabe-Schreibweisen bewusst locker –
  // reset()/_makeStatefulSet füllen Defaults und binden PVCs.
  statefulSets?: Array<{ name: string; image: string; replicas: number; serviceName?: string; volumeClaimName?: string; storage?: string; storageClass?: string }>;
  pvcs?: Array<{ name: string; storage?: string; capacity?: string; storageClass?: string; accessModes?: string; status?: "Pending" | "Bound"; volume?: string; data?: string }>;
  pvs?: Array<{ name: string; capacity?: string; storageClass?: string; accessModes?: string; reclaimPolicy?: string; status?: "Available" | "Bound" | "Released"; claim?: string }>;
  storageClasses?: Array<{ name: string; provisioner?: string; reclaimPolicy?: string; isDefault?: boolean }>;
  volumeSnapshots?: Array<{ name: string; sourcePvc: string; data?: string; restoreSize?: string; readyToUse?: boolean }>;
  // RBAC / ServiceAccounts / Pod-Security (#126). Strukturiert vorgegeben –
  // die imperativen `kubectl create …`-Handler bauen zur Laufzeit dieselben Formen.
  serviceAccounts?: string[];
  roles?: Array<{ name: string; cluster?: boolean; rules: PolicyRule[] }>;
  roleBindings?: Array<{ name: string; cluster?: boolean; roleRef: { kind: "Role" | "ClusterRole"; name: string }; subjects: RbacSubject[] }>;
  podSecurity?: PodSecurityLevel;
  argoApps?: ArgoApp[];
  helmRepos?: string[];
  releases?: Array<{ name: string; chart: string; revision: number; depName: string; history?: HistoryEntry[] }>;
  charts?: Array<{ name: string; version?: string; packaged?: boolean }>;
  tfInitialized?: boolean;
  tfApplied?: boolean;
  tfResources?: TfResource[];
  // Module/Remote-State/Provider/Outputs (#146). Eingabe-Schreibweisen locker –
  // reset() füllt Defaults (installed/fetched leiten sich aus tfInitialized ab).
  tfProviders?: Array<{ name: string; source?: string; version?: string }>;
  tfModules?: Array<{ name: string; source?: string; resources?: string[]; available?: boolean }>;
  tfBackend?: { type: string; name?: string; locking?: boolean } | null;
  tfOutputs?: TfOutput[];
  tfLocked?: boolean;          // hält gerade eine andere Crew den geteilten State-Lock? (Locking-Konzept)
  tfLockHolder?: string;       // wer ihn hält (Anzeige im Lock-Fehler)
  gitInitialized?: boolean;
  gitBranch?: string;
  gitBranches?: string[];
  gitStaged?: string[];
  gitCommitted?: string[];
  gitCommits?: GitCommit[];
  gitPushed?: boolean;
  gitRemoteAhead?: number;        // Commits, die auf origin/<branch> warten (für fetch/pull)
  gitFetched?: boolean;           // wurde origin schon geholt (fetch), aber noch nicht eingefügt?
  gitConflict?: GitPending | null;     // scharf gestellter Konflikt (löst beim merge aus)
  gitActiveConflict?: GitConflict | null; // laufender, noch offener Konflikt (für Speichern)
  ciPipelines?: Pipeline[];
  ciDeploy?: CiDeploy | null;
}

/** Der veränderliche Cluster-Zustand, den der Simulator hält und die Befehls-Handler
 *  (docker/kubectl/helm … – Folge-Schritte #373–#378) lesen und mutieren. `class Sim
 *  implements ClusterState` (sim.ts) hält diese Beschreibung ehrlich: ändert sich ein
 *  Feld der Sim-Klasse, zwingt der Compiler dazu, es hier nachzuziehen. Bewusst OHNE
 *  die rein transienten Sitzungs-Marker der Sim (`_firingAlerts`/`_resolvedAlerts`,
 *  `lastError`, `lastDeletedPod`) – die sind kein Cluster-Zustand, sondern
 *  Laufzeit-Buchhaltung; `implements` erlaubt der Klasse solche Zusatzfelder. */
export interface ClusterState {
  scenario: Scenario;
  clock: number;
  docker: { pulled: string[]; containers: Container[] };
  nodes: ClusterNode[];
  deployments: Deployment[];
  services: ServiceRes[];
  ingresses: IngressRes[];
  networkPolicies: NetworkPolicyRes[];
  secrets: Secret[];
  configMaps: ConfigMap[];
  files: Record<string, string>;
  applyEffects: Record<string, ApplyEffect>;
  serviceMonitors: ServiceMonitorRes[];
  prometheusRules: PrometheusRuleRes[];
  grafanaDatasources: GrafanaDatasourceRes[];
  grafanaDashboards: GrafanaDashboardRes[];
  statefulSets: StatefulSetRes[];
  pvcs: PvcRes[];
  pvs: PvRes[];
  storageClasses: StorageClassRes[];
  volumeSnapshots: VolumeSnapshotRes[];
  serviceAccounts: ServiceAccountRes[];
  roles: RoleRes[];
  roleBindings: RoleBindingRes[];
  podSecurity: PodSecurityLevel;
  argoApps: ArgoApp[];
  helmRepos: string[];
  releases: Release[];
  charts: Chart[];
  tf: { initialized: boolean; applied: boolean; resources: TfResource[]; providers: TfProvider[]; modules: TfModule[]; backend: TfBackend | null; outputs: TfOutput[]; locked: boolean; lockHolder?: string };
  git: { initialized: boolean; branch: string; branches: string[]; staged: string[]; committed: string[]; commits: GitCommit[]; pushed: boolean; remoteAhead: number; fetched: boolean; conflict: GitConflict | null; pendingConflict: GitPending | null };
  ci: { pipelines: Pipeline[]; deploy: CiDeploy | null };
}
