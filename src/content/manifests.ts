/* ===== Inhalte: virtuelle Dateien =====
 * Fertige YAML-/Terraform-/CI-Schnipsel, die Quests dem Spieler im
 * simulierten Dateisystem hinlegen (zum Lesen, Anwenden, Reparieren).
 */

export const DEPLOYMENT_YAML = [
  "apiVersion: apps/v1", "kind: Deployment", "metadata:", "  name: lager", "spec:",
  "  replicas: 2", "  selector:", "    matchLabels:", "      app: lager", "  template:",
  "    metadata:", "      labels:", "        app: lager", "    spec:", "      containers:",
  "        - name: lager", "          image: redis:7", "          ports:", "            - containerPort: 6379",
].join("\n");

export const SERVICE_YAML = [
  "apiVersion: v1", "kind: Service", "metadata:", "  name: lager", "spec:",
  "  selector:", "    app: lager", "  ports:", "    - port: 6379",
].join("\n");

export const INGRESS_YAML = [
  "apiVersion: networking.k8s.io/v1", "kind: Ingress", "metadata:", "  name: hafentor", "spec:",
  "  ingressClassName: nginx", "  rules:", "    - host: hafen.de", "      http:", "        paths:",
  "          - path: /lager", "            pathType: Prefix", "            backend:",
  "              service:", "                name: lager", "                port:",
  "                  number: 6379",
].join("\n");

// Dasselbe Hafentor, jetzt mit TLS: spec.tls referenziert das Zertifikats-Secret,
// damit der Controller HTTPS für hafen.de terminiert (HTTP wird zu HTTPS).
export const INGRESS_TLS_YAML = [
  "apiVersion: networking.k8s.io/v1", "kind: Ingress", "metadata:", "  name: hafentor", "spec:",
  "  ingressClassName: nginx",
  "  tls:", "    - hosts:", "        - hafen.de", "      secretName: hafen-tls",
  "  rules:", "    - host: hafen.de", "      http:", "        paths:",
  "          - path: /lager", "            pathType: Prefix", "            backend:",
  "              service:", "                name: lager", "                port:",
  "                  number: 6379",
].join("\n");

// Hafenmauer um die Pods von app=lager: standardmäßig dicht, nur das Hafentor darf rein.
export const NETPOL_YAML = [
  "apiVersion: networking.k8s.io/v1", "kind: NetworkPolicy", "metadata:", "  name: hafenmauer", "spec:",
  "  podSelector:", "    matchLabels:", "      app: lager",
  "  policyTypes:", "    - Ingress",
  "  ingress:", "    - from:", "        - podSelector:", "            matchLabels:", "              app: hafentor",
].join("\n");

// Ein Deployment MIT Ressourcen-Angaben: requests = was der Scheduler reserviert
// (Platzbedarf), limits = Obergrenze, ab der der Kernel den Container killt (OOMKilled).
// Genau dieses Paar fehlte dem hungrigen Dienst – zu knapp = OOMKilled, zu üppig =
// verschwendete Dublonen. Richtig dimensioniert spart Geld und bleibt stabil.
export const RESOURCES_YAML = [
  "apiVersion: apps/v1", "kind: Deployment", "metadata:", "  name: kartograf", "spec:",
  "  replicas: 1", "  selector:", "    matchLabels:", "      app: kartograf", "  template:",
  "    metadata:", "      labels:", "        app: kartograf", "    spec:", "      containers:",
  "        - name: kartograf", "          image: nginx",
  "          resources:",
  "            requests:        # so viel reserviert der Scheduler fest",
  "              memory: 128Mi",
  "              cpu: 100m",
  "            limits:          # ab hier killt der Kernel den Container (OOMKilled)",
  "              memory: 256Mi",
  "              cpu: 250m",
].join("\n");

export const BOESE_CONFIG_YAML = [
  "apiVersion: v1", "kind: ConfigMap", "metadata:", "  name: kasse-config", "data:",
  "  datenbank_host: db.hafen.local", "  # AUTSCH – Passwort im Klartext! Krakenfutter!",
  "  datenbank_passwort: fisch123",
].join("\n");

export const MAIN_TF = [
  "terraform {", "  required_providers {", "    hafen = {", "      source = \"kubequest/hafen\"", "    }", "  }", "}",
  "", "# Ein neues Ost-Plateau für Port Kubernia",
  "resource \"hafen_plateau\" \"ost\" {", "  name   = \"ost-erweiterung\"", "  breite = 12", "}",
  "", "# Zwei Server für den wachsenden Cluster",
  "resource \"hafen_server\" \"worker\" {", "  count   = 2", "  name    = \"worker-${count.index + 3}\"", "  groesse = \"mittel\"", "}",
].join("\n");

export const GITLAB_CI_YML = [
  "stages:", "  - build", "  - test", "  - deploy", "",
  "build-image:        # baut aus dem Dockerfile ein Docker-Image",
  "  stage: build", "  script:", "    - docker build -t funkdienst:$CI_COMMIT_SHORT_SHA .", "",
  "unit-test:          # prueft den Code, BEVOR etwas live geht",
  "  stage: test", "  script:", "    - npm test", "",
  "deploy-cluster:     # rollt automatisch in den Cluster aus",
  "  stage: deploy", "  script:", "    - kubectl apply -f deployment.yaml",
  "  only:", "    - main          # nur vom main-Branch wird wirklich deployt",
].join("\n");

export const DOCKERFILE = [
  "FROM nginx:1.27", "COPY site/ /usr/share/nginx/html", "EXPOSE 80",
].join("\n");

// ===== GitOps-Archipel (Phase 4) =====
// Argo CD liest den Soll-Zustand aus einem Git-Repo (im Spiel: die „Seekarte") und
// segelt den Cluster selbsttätig dorthin – Pull statt Push. Eine `Application` ist
// der Auftrag „halte diesen Hafen so, wie ihn die Seekarte zeigt".
export const ARGO_APPLICATION_YAML = [
  "apiVersion: argoproj.io/v1alpha1", "kind: Application", "metadata:",
  "  name: hafen-lager", "  namespace: argocd", "spec:",
  "  project: default",
  "  source:                       # die Seekarte: Soll-Zustand im Git-Repo",
  "    repoURL: https://github.com/port-kubernia/seekarten.git",
  "    path: lager",
  "    targetRevision: main",
  "  destination:                  # wohin Argo den Soll-Zustand segelt",
  "    server: https://kubernetes.default.svc",
  "    namespace: hafen",
  "  syncPolicy:",
  "    automated:                  # Pull-Prinzip: Argo gleicht selbst ab",
  "      prune: true               # entfernt, was aus der Seekarte verschwand",
  "      selfHeal: true            # Drift am Cluster wird zurückgesetzt",
].join("\n");

// Dieselbe `Application`, aber OHNE `syncPolicy.automated`: Argo legt sie an und
// merkt den Drift, rollt den Git-Soll aber NICHT von selbst aus. Du ziehst ihn von
// Hand mit `argocd app sync` in den Cluster – das macht das Pull-Prinzip beim ersten
// Mal greifbar (die automatische Variante kommt danach, siehe ARGO_APPLICATION_YAML).
export const ARGO_APPLICATION_MANUAL_YAML = [
  "apiVersion: argoproj.io/v1alpha1", "kind: Application", "metadata:",
  "  name: hafen-lager", "  namespace: argocd", "spec:",
  "  project: default",
  "  source:                       # die Seekarte: Soll-Zustand im Git-Repo",
  "    repoURL: https://github.com/port-kubernia/seekarten.git",
  "    path: lager",
  "    targetRevision: main",
  "  destination:                  # wohin Argo den Soll-Zustand segelt",
  "    server: https://kubernetes.default.svc",
  "    namespace: hafen",
  "  # (noch) keine syncPolicy.automated → du synchronisierst von Hand:",
  "  #   argocd app sync hafen-lager",
].join("\n");

// Dieselbe Application wie ARGO_APPLICATION_MANUAL_YAML, diesmal MIT syncPolicy.automated +
// selfHeal: Argo gleicht den Cluster laufend mit dem Git-Soll ab und dreht manuellen Drift
// (z.B. kubectl scale) automatisch zurück – das Pull-Prinzip wird damit spürbar (#96).
export const ARGO_APPLICATION_SELFHEAL_YAML = [
  "apiVersion: argoproj.io/v1alpha1", "kind: Application", "metadata:",
  "  name: hafen-lager", "  namespace: argocd", "spec:",
  "  project: default",
  "  source:                       # die Seekarte: Soll-Zustand im Git-Repo",
  "    repoURL: https://github.com/port-kubernia/seekarten.git",
  "    path: lager",
  "    targetRevision: main",
  "  destination:                  # wohin Argo den Soll-Zustand segelt",
  "    server: https://kubernetes.default.svc",
  "    namespace: hafen",
  "  syncPolicy:",
  "    automated:                  # Pull-Prinzip: Argo gleicht selbst ab",
  "      prune: true               # entfernt, was aus der Seekarte verschwand",
  "      selfHeal: true            # Drift zurücksetzen: Git gewinnt immer",
].join("\n");

// ===== Monitoring-Leuchtturm (Phase 5) =====
// Der Observability-Stack als Manifeste, analog zu den übrigen oben. Sie werden vom
// Simulator per `kubectl apply -f` verstanden (#109/#110) und sind die Grundlage der
// Prometheus-/Grafana-/Alert-Quests (#113–#116).

// ServiceMonitor (Prometheus-Operator-CRD): sagt Prometheus, WELCHEN Service es scrapen
// soll. `selector.matchLabels` wählt den Service, `endpoints` den Port + das Intervall.
export const SERVICEMONITOR_YAML = [
  "apiVersion: monitoring.coreos.com/v1", "kind: ServiceMonitor", "metadata:",
  "  name: lager-monitor",
  "  labels:",
  "    release: prometheus        # über dieses Label findet Prometheus den ServiceMonitor",
  "spec:",
  "  selector:",
  "    matchLabels:",
  "      app: lager               # dieser Service wird gescrapt",
  "  endpoints:",
  "    - port: metrics            # benannter Port, unter dem /metrics liegt",
  "      path: /metrics",
  "      interval: 30s            # wie oft Prometheus scrapt",
].join("\n");

// PrometheusRule (Prometheus-Operator-CRD): eine Alert-Regel mit Schwelle. `expr` ist die
// Bedingung (PromQL), `for` die Dauer, die sie anhalten muss, bevor der Alarm feuert.
export const PROMETHEUSRULE_YAML = [
  "apiVersion: monitoring.coreos.com/v1", "kind: PrometheusRule", "metadata:",
  "  name: hafen-alarme",
  "  labels:",
  "    release: prometheus",
  "spec:",
  "  groups:",
  "    - name: hafen.rules",
  "      rules:",
  "        - alert: HighPodCPU                                     # Name des Alarms",
  "          expr: rate(container_cpu_usage_seconds_total[5m]) > 0.5   # Schwelle (PromQL)",
  "          for: 5m                                               # erst nach 5 min Dauerlast feuern",
  "          labels:",
  "            severity: warning",
  "          annotations:",
  "            summary: \"Pod zieht ungewöhnlich viel CPU\"",
].join("\n");

// GrafanaDatasource (Grafana-Operator-CRD): woher Grafana seine Zahlen zieht – hier der
// Prometheus im Cluster. Ohne Datenquelle bleiben die Dashboards leer.
export const GRAFANA_DATASOURCE_YAML = [
  "apiVersion: grafana.integreatly.org/v1beta1", "kind: GrafanaDatasource", "metadata:",
  "  name: prometheus-quelle",
  "spec:",
  "  datasource:",
  "    name: Prometheus",
  "    type: prometheus",
  "    access: proxy",
  "    url: http://prometheus-server.monitoring.svc:9090   # die Prometheus-Adresse im Cluster",
].join("\n");

// GrafanaDashboard (Grafana-Operator-CRD): das Dashboard selbst steckt als JSON im `json`-Feld
// (Grafana exportiert Dashboards genau so). Hier eine kleine Hafen-Übersicht mit drei Panels.
export const GRAFANA_DASHBOARD_YAML = [
  "apiVersion: grafana.integreatly.org/v1beta1", "kind: GrafanaDashboard", "metadata:",
  "  name: hafen-uebersicht",
  "spec:",
  "  resyncPeriod: 30s",
  "  datasources:",
  "    - inputName: DS_PROMETHEUS",
  "      datasourceName: Prometheus",
  "  json: |",
  "    {",
  "      \"title\": \"Hafen-Übersicht\",",
  "      \"panels\": [",
  "        { \"title\": \"CPU pro Pod (kubectl top)\", \"type\": \"timeseries\" },",
  "        { \"title\": \"Aktive Alerts\", \"type\": \"stat\" },",
  "        { \"title\": \"Scrape-Targets up/down\", \"type\": \"table\" }",
  "      ]",
  "    }",
].join("\n");

// App-of-Apps: eine `Application`, die selbst keine Dienste ausrollt, sondern nur auf
// einen Ordner voller weiterer `Application`s zeigt – eine „Flotte", die mit einem
// einzigen Auftrag den ganzen Archipel verwaltet. So skaliert GitOps über viele Häfen.
export const APP_OF_APPS_YAML = [
  "apiVersion: argoproj.io/v1alpha1", "kind: Application", "metadata:",
  "  name: hafen-flotte", "  namespace: argocd", "spec:",
  "  project: default",
  "  source:                       # zeigt nur auf einen Ordner voller weiterer Applications",
  "    repoURL: https://github.com/port-kubernia/seekarten.git",
  "    path: flotte",
  "    targetRevision: main",
  "  destination:",
  "    server: https://kubernetes.default.svc",
  "    namespace: argocd",
  "  syncPolicy:",
  "    automated:",
  "      prune: true",
  "      selfHeal: true",
].join("\n");

// ===== Lagerhallen-Viertel (#123, Phase 7): stateful Workloads & Datendauerhaftigkeit =====
// Vorlagen-Manifeste für die späteren Storage-Quests – reine Bausteine (keine Quests hier).

// StorageClass: das „Regal-Typ"-Schild im Lager. Sie sagt, WIE Volumes bereitgestellt
// werden (welcher Provisioner, welche Disk-Art). PVCs verweisen über storageClassName darauf.
export const STORAGECLASS_YAML = [
  "apiVersion: storage.k8s.io/v1", "kind: StorageClass", "metadata:",
  "  name: kai-ssd",
  "provisioner: kubernetes.io/aws-ebs   # Beispiel-Provisioner (je nach Cloud/Cluster anders)",
  "parameters:",
  "  type: gp3                          # schnelle SSD-Klasse",
  "reclaimPolicy: Retain                # Volume nach dem Löschen der PVC behalten (Daten schützen)",
  "volumeBindingMode: WaitForFirstConsumer   # erst binden, wenn ein Pod das Volume wirklich braucht",
].join("\n");

// PersistentVolumeClaim: die „Lager-Anforderung". Ein Pod sagt damit: ich brauche so viel
// dauerhaften Platz, von dieser StorageClass. Kubernetes besorgt (provisioniert) das Volume.
export const PVC_YAML = [
  "apiVersion: v1", "kind: PersistentVolumeClaim", "metadata:",
  "  name: lager-daten",
  "spec:",
  "  accessModes:",
  "    - ReadWriteOnce            # von genau einem Node les-/schreibbar (typisch für eine DB)",
  "  storageClassName: kai-ssd    # welches Regal: verweist auf die StorageClass oben",
  "  resources:",
  "    requests:",
  "      storage: 5Gi             # so viel dauerhafter Platz wird angefordert",
].join("\n");

// headless Service (clusterIP: None): KEINE gemeinsame Cluster-IP, sondern stabile DNS-Namen
// pro Pod (z.B. speicher-datenbank-0.speicher-datenbank). Genau das braucht ein StatefulSet,
// damit jede Kiste einzeln und verlässlich adressierbar bleibt.
export const HEADLESS_SERVICE_YAML = [
  "apiVersion: v1", "kind: Service", "metadata:",
  "  name: speicher-datenbank",
  "spec:",
  "  clusterIP: None              # headless: keine virtuelle IP -> ein DNS-Name je Pod",
  "  selector:",
  "    app: speicher-datenbank",
  "  ports:",
  "    - port: 5432",
  "      name: postgres",
].join("\n");

// StatefulSet: wie ein Deployment, aber für Workloads mit IDENTITÄT & eigenen Daten (z.B. eine
// Datenbank). Jeder Pod bekommt eine feste Nummer (…-0, …-1, …) und über volumeClaimTemplates
// sein EIGENES dauerhaftes Volume; serviceName bindet den headless Service für stabile DNS-Namen.
export const STATEFULSET_YAML = [
  "apiVersion: apps/v1", "kind: StatefulSet", "metadata:",
  "  name: speicher-datenbank",
  "spec:",
  "  serviceName: speicher-datenbank   # der headless Service für stabile Pod-DNS-Namen",
  "  replicas: 3",
  "  selector:",
  "    matchLabels:",
  "      app: speicher-datenbank",
  "  template:",
  "    metadata:",
  "      labels:",
  "        app: speicher-datenbank",
  "    spec:",
  "      containers:",
  "        - name: postgres",
  "          image: postgres:16",
  "          ports:",
  "            - containerPort: 5432",
  "              name: postgres",
  "          volumeMounts:",
  "            - name: daten",
  "              mountPath: /var/lib/postgresql/data",
  "  volumeClaimTemplates:               # jeder Pod erhält sein eigenes, dauerhaftes Volume",
  "    - metadata:",
  "        name: daten",
  "      spec:",
  "        accessModes:",
  "          - ReadWriteOnce",
  "        storageClassName: kai-ssd",
  "        resources:",
  "          requests:",
  "            storage: 10Gi",
].join("\n");

// VolumeSnapshot (Backup #140): ein Point-in-Time-Abzug des Volumes hinter einem PVC.
// Ein EIGENES Objekt – es überlebt das Löschen seiner Quelle. `source` nennt das gesicherte
// PVC, `volumeSnapshotClassName` den CSI-Treiber, der den Abzug anfertigt.
export const VOLUMESNAPSHOT_YAML = [
  "apiVersion: snapshot.storage.k8s.io/v1", "kind: VolumeSnapshot", "metadata:",
  "  name: lager-daten-snap",
  "spec:",
  "  volumeSnapshotClassName: kai-snapclass    # der CSI-Treiber, der den Abzug anfertigt",
  "  source:",
  "    persistentVolumeClaimName: lager-daten   # WAS gesichert wird: das Volume dieses PVC",
].join("\n");

// Restore (#140): ein neues PVC, das per spec.dataSource auf einen VolumeSnapshot zeigt.
// Statt eines leeren Volumes bekommt es den gesicherten Inhalt zurück. Der Snapshot muss
// existieren UND readyToUse sein.
export const PVC_RESTORE_YAML = [
  "apiVersion: v1", "kind: PersistentVolumeClaim", "metadata:",
  "  name: lager-daten             # gleicher Name: das verlorene Volume zurueckholen",
  "spec:",
  "  accessModes:",
  "    - ReadWriteOnce",
  "  storageClassName: kai-ssd",
  "  resources:",
  "    requests:",
  "      storage: 5Gi",
  "  dataSource:                    # HIER kommt das Backup ins Spiel:",
  "    name: lager-daten-snap       # aus diesem Snapshot wird der Inhalt wiederhergestellt",
  "    kind: VolumeSnapshot",
  "    apiGroup: snapshot.storage.k8s.io",
].join("\n");

/* ===== Wachturm-Quartier: RBAC / ServiceAccounts / Pod-Security (#128) =====
 * Vorlagen für Phase 6. Sie passen zu den Sim-Mechaniken aus #126:
 * `kubectl apply -f` legt SA/Role/RoleBinding/ClusterRole/ClusterRoleBinding an,
 * `kubectl auth can-i` wertet die Bindungen aus, und die Pod-Security-Stufe
 * (`pod-security.kubernetes.io/enforce`) prüft den securityContext beim Anlegen.
 */

// ServiceAccount: die Identität, unter der ein Pod im Cluster auftritt – Basis für
// Least Privilege (eigene SA statt der allmächtigen default-SA).
export const SERVICEACCOUNT_YAML = [
  "apiVersion: v1", "kind: ServiceAccount", "metadata:",
  "  name: deploy-bot          # eigene Identität fuer den Deploy-Automaten",
  "  namespace: default",
].join("\n");

// Role: ein Bündel Rechte INNERHALB eines Namespace. Hier: pods nur lesen
// (get/list/watch) – kein delete, kein create. Genau so viel, wie noetig.
export const ROLE_YAML = [
  "apiVersion: rbac.authorization.k8s.io/v1", "kind: Role", "metadata:",
  "  name: pod-leser",
  "  namespace: default",
  "rules:",
  "  - apiGroups: [\"\"]            # \"\" = die Kern-API-Gruppe (pods, services, …)",
  "    resources: [\"pods\"]",
  "    verbs: [\"get\", \"list\", \"watch\"]   # nur lesen, NICHT veraendern",
].join("\n");

// RoleBinding: verbindet ein Subjekt (hier die SA deploy-bot) mit einer Role.
// Erst die Bindung macht aus den Regeln ein echtes Recht fuer jemanden.
export const ROLEBINDING_YAML = [
  "apiVersion: rbac.authorization.k8s.io/v1", "kind: RoleBinding", "metadata:",
  "  name: pod-leser-binden",
  "  namespace: default",
  "subjects:",
  "  - kind: ServiceAccount",
  "    name: deploy-bot",
  "    namespace: default",
  "roleRef:",
  "  kind: Role                 # zeigt auf die Role oben",
  "  name: pod-leser",
  "  apiGroup: rbac.authorization.k8s.io",
].join("\n");

// ClusterRole: wie eine Role, aber CLUSTER-WEIT (z.B. fuer nicht-namespaced
// Ressourcen wie nodes). Hier: Knoten lesen duerfen.
export const CLUSTERROLE_YAML = [
  "apiVersion: rbac.authorization.k8s.io/v1", "kind: ClusterRole", "metadata:",
  "  name: knoten-leser         # ClusterRole hat KEINEN namespace",
  "rules:",
  "  - apiGroups: [\"\"]",
  "    resources: [\"nodes\"]",
  "    verbs: [\"get\", \"list\"]",
].join("\n");

// ClusterRoleBinding: bindet ein Subjekt cluster-weit an eine ClusterRole.
// Hier bekommt der User \"wache\" das Recht, Knoten im ganzen Cluster zu lesen.
export const CLUSTERROLEBINDING_YAML = [
  "apiVersion: rbac.authorization.k8s.io/v1", "kind: ClusterRoleBinding", "metadata:",
  "  name: knoten-leser-binden",
  "subjects:",
  "  - kind: User",
  "    name: wache",
  "    apiGroup: rbac.authorization.k8s.io",
  "roleRef:",
  "  kind: ClusterRole",
  "  name: knoten-leser",
  "  apiGroup: rbac.authorization.k8s.io",
].join("\n");

// Pod-Security: ein Workload, der die strenge \"restricted\"-Stufe besteht. Der
// securityContext sitzt im Pod-Template (runAsNonRoot) und am Container
// (allowPrivilegeEscalation: false, readOnlyRootFilesystem: true).
export const POD_SECURITY_YAML = [
  "apiVersion: apps/v1", "kind: Deployment", "metadata:",
  "  name: wachposten",
  "spec:",
  "  replicas: 1",
  "  selector:",
  "    matchLabels:",
  "      app: wachposten",
  "  template:",
  "    metadata:",
  "      labels:",
  "        app: wachposten",
  "    spec:",
  "      securityContext:                 # gilt fuer den ganzen Pod",
  "        runAsNonRoot: true             # NICHT als root laufen",
  "      containers:",
  "        - name: wachposten",
  "          image: nginx",
  "          securityContext:             # gilt fuer diesen Container",
  "            allowPrivilegeEscalation: false   # keine Rechte-Eskalation",
  "            readOnlyRootFilesystem: true      # Dateisystem nur lesbar",
].join("\n");
