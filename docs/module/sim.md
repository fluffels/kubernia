# Tiefendoc: Simulator (`src/sim.ts` + `src/sim/*`)

> On-demand-Detail zum Cluster-Simulator. Der schlanke Always-Index steht in [CLAUDE.md](../../CLAUDE.md); hier liegt die ausführliche Historie + die Interface-Details, die man nur beim Arbeiten am Simulator braucht. Pfade sind repo-relativ als Inline-Code geschrieben (keine Links), damit dieses tief liegende Doc nicht bei jeder Verschiebung Linkpflege braucht.

## Worum es geht

Der Simulator ist das **pure-Domäne-Herz** des Spiels: die Spielwelt _ist_ der Cluster. Er ist **Phaser-frei und voll im Node-Test prüfbar**. Er versteht die Befehlsfamilien `docker`, `kubectl` (inkl. `top`/`logs -f`/`--previous`), `helm`, `terraform`, `git`, `argocd`/GitOps und `glab` (GitLab-CI) plus die Observability-Schicht.

## Aufbau nach dem sim.ts-Split (#346, Schritte #372–#385)

Ursprünglich war alles ein großes `sim.ts`. Mit #346 wurde es in einen **Kern** + **eine Datei je Befehlsfamilie** unter `src/sim/` aufgeteilt. Leitidee des Splits:

- **`src/sim.ts` (Kern):** State/reset/Fabriken (`_makeDeployment` u.a.)/geteilte Pod-Helfer/`exec`-Dispatch/`snapshot`. `class Sim implements ClusterState`. Re-exportiert `src/sim/state.ts` als **Barrel**, damit bestehende Importe (`from "./sim"`) unverändert bleiben.
- **Je Befehlsfamilie eine freie Funktion** `xCommand(host, …)` in `src/sim/<x>.ts`. Der `exec`-Dispatch im Kern ruft sie (`dockerCommand(this, …)` usw.).
- **Schmales Host-Interface je Familie** (`DockerHost`, `KubectlHost`, …): `extends ClusterState` + genau die Sim-Helfer, die die Familie nutzt. So bekommt die Familie die Sim-Instanz, **ohne Import-Zyklus**.
- **Öffentliche API bleibt stabil** auf der `Sim`-Klasse / dem Barrel → Aufrufer (content/checks, content/drills) und Tests rufen unverändert `sim.X()`.

### Die Module im Einzelnen

| Modul | Schritt | Inhalt |
|---|---|---|
| `src/sim/state.ts` | #372 (1/7) | Simulator-Zustand & Domänentypen: alle Ressourcen-Interfaces (Pod/Deployment/Service/Secret/ConfigMap/Node …), die serialisierbare `Scenario`-Form und die aggregierende `ClusterState`-Schnittstelle. Reine Typen, kein Laufzeit-Code. Gemeinsame Basis aller Folge-Schritte. |
| `src/sim/util.ts` | #373 ff. | Geteilte, **zustandslose** pure Helfer: Zufalls-IDs (`randSuffix`), Pod-Namen im K8s-Stil (`makePodName`, #374), monospace-Tabellen (`pad`/`table`) für `docker ps`/`kubectl get`/`scale`. Von `sim.ts` UND den Befehls-Modulen importiert (vermeidet Rückimport-Zyklus). |
| `src/sim/docker.ts` | #373 (2/7) | docker-Befehlsfamilie: `dockerCommand(sim, …)` (pull/build/tag/images/run/ps/stop/rm) + Tippfehler-Hilfe (`checkImageTypo` + `KNOWN_IMAGES`). Über `DockerHost`. |
| `src/sim/kubectl.ts` | #374 (3/7), Split #397 | kubectl-Befehlsfamilie — war **der größte Block** (1220 LOC) und ist seit #397 ein **dünner Dispatch-Barrel**: `kubectlCommand(host, …)` reicht nach Unterbefehl an die Unterfamilien unter `src/sim/kubectl/*` weiter und re-exportiert `KubectlHost`. Kein Verhalten geändert, nur aufgeteilt (Befund #390, Budget 800 LOC). |
| `src/sim/kubectl/host.ts` | #397 | Das (große) `KubectlHost`-Interface — was die kubectl-Befehle von der `Sim`-Klasse brauchen. Leaf-Modul (nur Domänentypen aus `state.ts`), von allen Unterfamilien + dem Barrel importiert → kein Import-Zyklus. |
| `src/sim/kubectl/inspect.ts` | #397 | **Lesende** kubectl-Befehle (kein State-Write): `get` (alle Ressourcen-Listen), `describe`, `top` (#109), `logs` + die geteilte `INGRESS_ADDRESS`. |
| `src/sim/kubectl/lifecycle.ts` | #397 | **Ressourcen-Lebenszyklus**: `create` (imperativ), `apply -f` (deklarativ, größter Block: alle CRDs/Workloads/RBAC/Observability/Storage) und `delete`. Ruft `admitPod` (security) und beim Application-`apply` `argoReconcile`/`cloneChildSpec` (argocd). |
| `src/sim/kubectl/ops.ts` | #397 | **Laufende Workloads tunen**: `scale`, `expose`, `set image\|env\|resources` (+ `parseMem`), `rollout restart`. |
| `src/sim/kubectl/security.ts` | #397 | **RBAC `can-i`** (`subjectKeyOf`/`asKey`/`canI` + `kubectlAuth`, #126) + **Pod-Security-Admission** (`kubectlLabel` setzt die enforce-Stufe, `admitPod` prüft — exportiert, weil lifecycle es ruft, #128). |
| `src/sim/helm.ts` | #375 (4/7) | helm-Befehlsfamilie: `helmCommand(host, …)` (repo add/update/list, search, create, lint, package, install, list, upgrade, rollback, uninstall, status, dependency) + `--set <key>=<n>`-Parser (`setValue`). Über `HelmHost` (`+ _err`/`_makeDeployment`). |
| `src/sim/terraform.ts` | #376 (5/7), erweitert #146 | terraform-Befehlsfamilie: `terraformCommand(host, …)` (init/get/plan/apply/destroy/state list/output/force-unlock/fmt/validate). Über `TerraformHost` (`+ _err`/`_reschedulePending`). Seit #146 (Phase 9) auch **Module** (`tf.modules`: ein Baustein expandiert zu mehreren `module.<name>.<res>`-Adressen, von init/get geholt), **Remote State** (`tf.backend` verlagert den State; `tf.locked`/`lockHolder` = State-Locking-Konzept, `force-unlock` löst), **Provider** (`tf.providers`: mehrere Anbieter, von init geladen; eine Ressource mit `provider` auf einen nicht deklarierten Block lässt plan/apply scheitern) und deklarierte **Outputs** (`tf.outputs`, erst nach apply, `sensitive` verdeckt). Config kommt als Szenario-Daten (`tfModules`/`tfProviders`/`tfBackend`/`tfOutputs`/`tfLocked`); Fehlerfälle deterministisch testbar (Backend nicht initialisiert, unbekannter Provider/Modul, gesperrter State). |
| `src/sim/git.ts` | #377 (6/7) | git-Befehlsfamilie: `gitCommand(host, …)` (init/status/add/commit/log/branch/checkout/merge/push/fetch/pull) + Helfer für unversionierte Dateien (`gitUntracked`). Über `GitHost` (`+ _err`/`_suggest`/`_makeDeployment`). **`git push` stößt die CI-Pipeline an** — `runPipeline` wird seit #385 direkt aus `src/sim/glab.ts` importiert. |
| `src/sim/argocd.ts` | #378 (7/7, letzter) | argocd-Befehlsfamilie + **GitOps-Reconcile**: `argocdCommand(host, …)` (app list/get/sync). Verzahnter als die anderen, darum bewusst **exportierte** Funktionen: `reconcileAutoSync` (Self-Heal vor jeder Eingabe → vom `exec` des Kerns), `argoReconcile` + `cloneChildSpec` (Pull/Klon beim `kubectl apply` einer Application → direkt von `src/sim/kubectl/lifecycle.ts`), `cloneArgoApp` (Tiefkopie für reset/snapshot/serialize → von `sim.ts`). Über `ArgocdHost` (`+ _err`/`_podReady`/`_makeDeployment`). |
| `src/sim/observability.ts` | #384 | Observability-Familie (#109/#110): deterministische Pod-/Node-Metriken (`podMetrics`/`nodeMetrics`, **kein `Math.random`** → `kubectl top` stabil), Prometheus-Scrape-Targets (`scrapeTargets`), Alert-Regeln (`alertRules`) + firing→resolved-Verlauf (`evaluateAlerts`/`alerts`) des simulierten Alertmanagers. Aus `sim.ts` ausgelagert, aber die **öffentliche API bleibt als dünne Delegation auf der Sim-Klasse** (`Sim.podMetrics()` & Co.), damit kubectl get/top, content/checks + content/drills und Tests unverändert `sim.X()` rufen. `exec` ruft vor jeder Eingabe `evaluateAlerts(this)`. Über `ObservabilityHost` (`+ _podReady` + transienter Alert-Sitzungszustand `_firingAlerts`/`_resolvedAlerts`). |
| `src/sim/glab.ts` | #385 (letzter Split) | glab/CI-Familie: `glabCommand(host, …)` (GitLab-CLI `glab ci status\|list`) UND die **CI-Pipeline-Maschinerie** `runPipeline(host)` — eine `.gitlab-ci.yml` startet beim `git push` ihre Pipeline build → test → deploy, die deploy-Stage rollt auf `main` automatisch aus. Über `GlabHost` (`+ _err`/`_makeDeployment`). |

Damit bleibt in `sim.ts` nur noch der **Sim-Kern** — keine Befehls- oder CI-Familie mehr.

## Observability & Monitoring-CRDs (#109/#110)

Die Observability-Grundlage (#109) liefert Pod-/Node-Metriken, Alert-State (firing→resolved) und Prometheus-Scrape-Targets über `podMetrics()`/`nodeMetrics()`/`alerts()`/`scrapeTargets()`. Monitoring-CRDs (ServiceMonitor/PrometheusRule/Grafana, #110) laufen über `kubectl apply`/`get`; die Manifest-Vorlagen liegen in `src/content/manifests.ts`.

## RBAC / ServiceAccounts / Pod-Security (#126/#128)

In `src/sim/kubectl/` (seit Split #397): ServiceAccounts + Role/ClusterRole + RoleBinding/ClusterRoleBinding via `kubectl create` (`lifecycle.ts`); `kubectl auth can-i <verb> <resource> [--as=…]` (deterministisch yes/no) + Pod-Security-Admission-Stufe via `kubectl label namespace … pod-security.kubernetes.io/enforce=<stufe>` (lehnt unsichere Pods beim Anlegen ab) in `security.ts`. RBAC-Objekte zusätzlich deklarativ via `kubectl apply -f` (`lifecycle.ts`, #128, Manifest-Vorlagen in `src/content/manifests.ts`).

**Pod-Security bleibt nach Phase 6 dauerhaft gehärtet (#444).** Die Wachturm-Quest `k8s-pod-security` schaltet im teach-Schritt `enforce=restricted` an der **geteilten** `Game.sim` scharf; das ist narrativ bewusst dauerhaft („an diesem Tor kommt sie nicht durch") und wird **nicht** zurückgenommen. Folge: ein danach **imperativ** (ohne securityContext) angelegtes Deployment wird abgewiesen – im freien Funken ist das gewolltes, selbsterklärendes Verhalten (die Fehlermeldung nennt den Ausweg). Damit aber **Übungs-Drills**, die genau so ein rohes Deployment anlegen (Oles `k-create`, dazu alles über `ensureDeployment`), nicht unlösbar werden, normalisieren sie ihren Sandbox-Cluster in der Drill-Vorbereitung auf `privileged` (`ensureBarePodAdmission` in `src/content/drills.ts`) – wie der `pod-security-enforce`-Drill schon „jede Übung startet sauber". Die Cluster-Härtung selbst rührt das nicht an. Test: `test/podsecurity-leftover.test.ts`.

## Tests

- `test/sim.test.ts` — Kern/`exec`-Dispatch.
- `test/sim/*` — die Befehlsfamilien gespiegelt zu den `sim/`-Modulen (docker/kubectl/helm/terraform/git/argocd/glab), gemeinsame Fixtures in `test/sim/helpers.ts` (Split #383); RBAC/Pod-Security (#126/#128) als eigener Schnitt in `test/sim/rbac.test.ts`. Geprüft wird durchweg **über `exec`** (Verhalten der echten Eingabe), nicht die internen Funktionen.
- `test/observability.test.ts` — Observability-Familie (Metriken/Scrape-Targets/Alerts).
