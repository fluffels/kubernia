# Quest-Landkarte (generiert)

> Regionen-/Quest-Graph aus den Content-Daten: je Region ein Diagramm. Quelle sind `src/content/data/quests/*.json`, `quest-order.json` (Lernpfad), `entities.json` (Standplatz des Gebers, daraus die Region) und `npcs.json` (Namen). Der Abschnitt entsteht mit `npm run docs:gen`; `npm run check:docgen` ist rot, sobald er veraltet. Fehlt eine Quest in `quest-order.json` oder hat ein Geber keinen Standplatz, meldet der Generator das statt ein Loch zu zeichnen. Gestrichelte Pfeile sind `requires` (Voraussetzung), durchgezogene der Lernpfad. Zur Content-Schicht: [content.md](content.md).

<!-- GEN:quest-graph START -->
<!-- Generiert von npm run docs:gen – nicht von Hand ändern. -->

## Überblick

```mermaid
---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---
flowchart TB
  start(["Start"])
  r_harbor["harbor<br/>45 Quests · Ole, Bo, Ada, Runa, Theo, Juno"]
  r_archipel["archipel<br/>5 Quests · Argo"]
  r_lighthouse["lighthouse<br/>4 Quests · Lumi"]
  r_warehouse["warehouse<br/>8 Quests · Knut"]
  r_watchtower["watchtower<br/>5 Quests · Vidar"]
  r_flotte["flotte<br/>6 Quests · Saga"]
  r_werft["werft<br/>1 Quest · Greta"]
  start --> r_harbor
  r_harbor --> r_archipel
  r_archipel --> r_lighthouse
  r_lighthouse --> r_warehouse
  r_warehouse --> r_watchtower
  r_watchtower --> r_flotte
  r_flotte --> r_werft
  r_werft --> r_harbor
```

## Regionen

### Region `harbor`

45 Quests · Geber: Ole, Bo, Ada, Runa, Theo, Juno

#### Teil 1 von 2 (30 Quests)

```mermaid
---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---
flowchart TB
  q_onboarding_sign_on["Anheuern in Port Kubernia<br/>Ole"]
  q_docker_first_container["Die erste Kiste<br/>Bo"]
  q_docker_common_images["Warenkunde: nginx, BusyBox, Redis, Postgres<br/>Bo"]
  q_docker_list_containers["Den Überblick behalten<br/>Bo"]
  q_docker_stack_minigame["Bos Stapel-Spiel<br/>Bo"]
  q_docker_run_options["Namen und Hintergrund<br/>Bo"]
  q_docker_build_image["Dein eigener Bauplan<br/>Bo"]
  q_docker_registry["Woher die Baupläne kommen<br/>Bo"]
  q_docker_rabbitmq["Die Posthalle am Kai<br/>Bo"]
  q_k8s_first_deployment["Der Hafen wird ein Cluster<br/>Ole"]
  q_k8s_inspect_pods["Genauer hinsehen<br/>Ole"]
  q_k8s_service["Der Dauerauftrag<br/>Ole"]
  q_k8s_self_healing["Der Sturm-Test<br/>Ole"]
  q_k8s_apply_manifests["Adas Seekarten<br/>Ada"]
  q_k8s_configmap_secret["Truhe trifft Kombüse<br/>Ole"]
  q_k8s_yaml_struct_minigame["Adas Bausteine<br/>Ada"]
  q_helm_intro["Das Steuerrad<br/>Runa"]
  q_helm_release_install["Flagge hissen<br/>Runa"]
  q_helm_upgrade_rollback["Auf und ab<br/>Runa"]
  q_terraform_intro["Neues Land<br/>Theo"]
  q_terraform_state_destroy["Gedächtnis und Abriss<br/>Theo"]
  q_kraken_boss["Die Hacker-Krake<br/>Ole"]
  q_k8s_debug_imagepull["Sturmwarnung am Leuchtturm<br/>Juno"]
  q_k8s_debug_crashloop["Das Flackern<br/>Juno"]
  q_k8s_node_capacity["Kein Platz im Hafen<br/>Juno"]
  q_git_version_control["Seekarten versionieren<br/>Ada"]
  q_git_feature_branch["Ein eigener Zweig<br/>Ada"]
  q_git_pipeline["Die Pipeline-Passage<br/>Ada"]
  q_git_merge_branches["Zwei Karten, eine Linie<br/>Ada"]
  q_helm_umbrella_chart["Werft-Ausbau: dein eigenes Chart<br/>Runa"]
  nach_harbor__Teil_2(["weiter nach harbor, Teil 2"])
  q_onboarding_sign_on --> q_docker_first_container
  q_docker_first_container --> q_docker_common_images
  q_docker_common_images --> q_docker_list_containers
  q_docker_list_containers --> q_docker_stack_minigame
  q_docker_stack_minigame --> q_docker_run_options
  q_docker_run_options --> q_docker_build_image
  q_docker_build_image --> q_docker_registry
  q_docker_registry --> q_docker_rabbitmq
  q_docker_rabbitmq --> q_k8s_first_deployment
  q_k8s_first_deployment --> q_k8s_inspect_pods
  q_k8s_inspect_pods --> q_k8s_service
  q_k8s_service --> q_k8s_self_healing
  q_k8s_self_healing --> q_k8s_apply_manifests
  q_k8s_apply_manifests --> q_k8s_configmap_secret
  q_k8s_configmap_secret --> q_k8s_yaml_struct_minigame
  q_k8s_yaml_struct_minigame --> q_helm_intro
  q_helm_intro --> q_helm_release_install
  q_helm_release_install --> q_helm_upgrade_rollback
  q_helm_upgrade_rollback --> q_terraform_intro
  q_terraform_intro --> q_terraform_state_destroy
  q_terraform_state_destroy --> q_kraken_boss
  q_kraken_boss --> q_k8s_debug_imagepull
  q_k8s_debug_imagepull --> q_k8s_debug_crashloop
  q_k8s_debug_crashloop --> q_k8s_node_capacity
  q_k8s_node_capacity --> q_git_version_control
  q_git_version_control --> q_git_feature_branch
  q_git_feature_branch --> q_git_pipeline
  q_git_pipeline --> q_git_merge_branches
  q_git_merge_branches --> q_helm_umbrella_chart
  q_helm_umbrella_chart --> nach_harbor__Teil_2
  q_helm_intro -. requires .-> q_helm_umbrella_chart
```

#### Teil 2 von 2 (15 Quests)

```mermaid
---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---
flowchart TB
  q_helm_templates["Hinter die Vorlagen schauen<br/>Runa"]
  q_network_policy["Die Hafenmauer<br/>Juno"]
  q_secrets_encrypted["Das verschlüsselte Hafentor<br/>Ada"]
  q_security_cert_manager["Das Tor erneuert sich selbst<br/>Ada"]
  q_dns_service_discovery["Das Adressbuch des Hafens<br/>Ada"]
  q_k8s_routing_lotse_minigame["Der Routing-Lotse<br/>Ada"]
  q_k8s_service_endpoints["Läuft – bedient aber niemanden<br/>Juno"]
  q_k8s_resource_limits["Der hungrige Kartograf<br/>Juno"]
  q_k8s_pod_packing["Der Scheduler in Aktion<br/>Juno"]
  q_aufbau_sturm["Der große Sturm: Port Kubernia in Trümmern<br/>Ole"]
  q_aufbau_control_plane["Die Kommandobrücke: Control-Plane hochziehen<br/>Ole"]
  q_aufbau_worker_join["Stege ans Wasser: Worker-Knoten anschließen<br/>Ole"]
  q_aufbau_dienste["Fracht zurück an Bord: Dienste wieder ausbringen<br/>Ole"]
  q_aufbau_cluster_als_code["Nie wieder von Hand: Cluster als Code<br/>Ole"]
  q_platform_addons_overview["Das große Ganze: was einen echten Cluster ausmacht<br/>Ole"]
  aus_harbor__Teil_1(["aus harbor, Teil 1"])
  nach_archipel(["weiter nach archipel"])
  aus_werft(["aus werft"])
  ext_q_helm_umbrella_chart(["Werft-Ausbau: dein eigenes Chart (harbor, Teil 1)"])
  aus_harbor__Teil_1 --> q_helm_templates
  q_helm_templates --> q_network_policy
  q_network_policy --> q_secrets_encrypted
  q_secrets_encrypted --> q_security_cert_manager
  q_security_cert_manager --> q_dns_service_discovery
  q_dns_service_discovery --> q_k8s_routing_lotse_minigame
  q_k8s_routing_lotse_minigame --> q_k8s_service_endpoints
  q_k8s_service_endpoints --> q_k8s_resource_limits
  q_k8s_resource_limits --> q_k8s_pod_packing
  q_k8s_pod_packing --> nach_archipel
  aus_werft --> q_aufbau_sturm
  q_aufbau_sturm --> q_aufbau_control_plane
  q_aufbau_control_plane --> q_aufbau_worker_join
  q_aufbau_worker_join --> q_aufbau_dienste
  q_aufbau_dienste --> q_aufbau_cluster_als_code
  q_aufbau_cluster_als_code --> q_platform_addons_overview
  ext_q_helm_umbrella_chart -. requires .-> q_helm_templates
```

### Region `archipel`

5 Quests · Geber: Argo

```mermaid
---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---
flowchart TB
  q_gitops_argocd_intro["Das Logbuch der Insel<br/>Argo"]
  q_gitops_self_sync["Die selbstsegelnde Seekarte<br/>Argo"]
  q_gitops_drift_detection["Der stille Wächter<br/>Argo"]
  q_gitops_driftheal_minigame["Soll statt Stückzahl<br/>Argo"]
  q_gitops_app_of_apps["Die Flotte aus einer Hand<br/>Argo"]
  aus_harbor__Teil_2(["aus harbor, Teil 2"])
  nach_lighthouse(["weiter nach lighthouse"])
  aus_harbor__Teil_2 --> q_gitops_argocd_intro
  q_gitops_argocd_intro --> q_gitops_self_sync
  q_gitops_self_sync --> q_gitops_drift_detection
  q_gitops_drift_detection --> q_gitops_driftheal_minigame
  q_gitops_driftheal_minigame --> q_gitops_app_of_apps
  q_gitops_app_of_apps --> nach_lighthouse
```

### Region `lighthouse`

4 Quests · Geber: Lumi

```mermaid
---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---
flowchart TB
  q_observability_metrics["Licht ins Dunkel: die ersten Metriken<br/>Lumi"]
  q_observability_grafana["Zahlen in Bilder: das Grafana-Dashboard<br/>Lumi"]
  q_observability_logs["Was die App zu sagen hat: kubectl logs<br/>Lumi"]
  q_observability_alerts["Der Cluster ruft: Alerts #amp; PrometheusRule<br/>Lumi"]
  aus_archipel(["aus archipel"])
  nach_warehouse(["weiter nach warehouse"])
  aus_archipel --> q_observability_metrics
  q_observability_metrics --> q_observability_grafana
  q_observability_grafana --> q_observability_logs
  q_observability_logs --> q_observability_alerts
  q_observability_alerts --> nach_warehouse
```

### Region `warehouse`

8 Quests · Geber: Knut

```mermaid
---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---
flowchart TB
  q_storage_statefulset["Stabile Lager: das StatefulSet<br/>Knut"]
  q_storage_pvc["Speicher anfordern: PVC, PV #amp; StorageClass<br/>Knut"]
  q_storage_ephemeral["Flüchtiger Speicher: emptyDir, Node-Disk #amp; Eviction<br/>Knut"]
  q_storage_init["Der Vorbereiter: initContainer #amp; der Peak beim Befüllen<br/>Knut"]
  q_storage_backup_restore["Backup #amp; Restore: Daten sichern und zurückholen<br/>Knut"]
  q_storage_object_store["Object Storage #amp; Buckets: wann S3 statt Volume<br/>Knut"]
  q_storage_object_backup["Backup ins Object Storage (S3): off-cluster sichern (3-2-1)<br/>Knut"]
  q_storage_prod_db_decision["Prod-DB im Cluster: ja oder nein?<br/>Knut"]
  aus_lighthouse(["aus lighthouse"])
  nach_watchtower(["weiter nach watchtower"])
  aus_lighthouse --> q_storage_statefulset
  q_storage_statefulset --> q_storage_pvc
  q_storage_pvc --> q_storage_ephemeral
  q_storage_ephemeral --> q_storage_init
  q_storage_init --> q_storage_backup_restore
  q_storage_backup_restore --> q_storage_object_store
  q_storage_object_store --> q_storage_object_backup
  q_storage_object_backup --> q_storage_prod_db_decision
  q_storage_prod_db_decision --> nach_watchtower
```

### Region `watchtower`

5 Quests · Geber: Vidar

```mermaid
---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---
flowchart TB
  q_k8s_serviceaccount["ServiceAccounts: ein Ausweis für jeden Pod<br/>Vidar"]
  q_k8s_rbac_role["Rechte vergeben: Role #amp; RoleBinding<br/>Vidar"]
  q_k8s_rbac_clusterrole["Cluster-weite Rechte: ClusterRole #amp; auth can-i<br/>Vidar"]
  q_k8s_rbac_keyring_minigame["Der Schlüsselbund: Least Privilege üben<br/>Vidar"]
  q_k8s_pod_security["Wer darf rein: Pod-Security #amp; SecurityContext<br/>Vidar"]
  aus_warehouse(["aus warehouse"])
  nach_flotte(["weiter nach flotte"])
  aus_warehouse --> q_k8s_serviceaccount
  q_k8s_serviceaccount --> q_k8s_rbac_role
  q_k8s_rbac_role --> q_k8s_rbac_clusterrole
  q_k8s_rbac_clusterrole --> q_k8s_rbac_keyring_minigame
  q_k8s_rbac_keyring_minigame --> q_k8s_pod_security
  q_k8s_pod_security --> nach_flotte
```

### Region `flotte`

6 Quests · Geber: Saga

```mermaid
---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---
flowchart TB
  q_terraform_modul["Ein Bauplan, viele Anleger<br/>Saga"]
  q_terraform_remote_state["Das Gedächtnis der Flotte<br/>Saga"]
  q_terraform_provider["Zwei Inseln, zwei Anbieter<br/>Saga"]
  q_terraform_variablen_outputs["Die Stellschrauben der Flotte<br/>Saga"]
  q_terraform_echte_provider["Provider für alles<br/>Saga"]
  q_terraform_configs_umgebung["Eine Konfig, viele Umgebungen<br/>Saga"]
  aus_watchtower(["aus watchtower"])
  nach_werft(["weiter nach werft"])
  aus_watchtower --> q_terraform_modul
  q_terraform_modul --> q_terraform_remote_state
  q_terraform_remote_state --> q_terraform_provider
  q_terraform_provider --> q_terraform_variablen_outputs
  q_terraform_variablen_outputs --> q_terraform_echte_provider
  q_terraform_echte_provider --> q_terraform_configs_umgebung
  q_terraform_configs_umgebung --> nach_werft
```

### Region `werft`

1 Quest · Geber: Greta

```mermaid
---
config:
  theme: base
  look: classic
  layout: dagre
  themeVariables:
    lineColor: "#8b949e"
    primaryColor: "#f3e3c3"
    primaryTextColor: "#2b2118"
    primaryBorderColor: "#8a6a3f"
---
flowchart TB
  q_werft_eigener_dienst["Vom Stapel gelassen: dein eigener Dienst<br/>Greta"]
  aus_flotte(["aus flotte"])
  nach_harbor__Teil_2(["weiter nach harbor, Teil 2"])
  aus_flotte --> q_werft_eigener_dienst
  q_werft_eigener_dienst --> nach_harbor__Teil_2
```

<!-- GEN:quest-graph END -->
