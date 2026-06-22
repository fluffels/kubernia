/* ===== Inhalte: Drills (Zufalls-Übungen) =====
 * Jede Drill-Funktion bekommt den Simulator und liefert eine frische Aufgabe
 * (ggf. mit Vorbereitung der Welt). PRACTICE ordnet die Drills den NPCs zu.
 */
import type { Sim, Deployment, NetworkPolicyRes, ArgoApp } from "../sim";
import { pick, rnd } from "./util";
import { NETPOL_YAML, DOCKERFILE, ARGO_APPLICATION_MANUAL_YAML, SERVICEMONITOR_YAML, PROMETHEUSRULE_YAML, ROLE_YAML, ROLEBINDING_YAML, CLUSTERROLE_YAML, CLUSTERROLEBINDING_YAML, POD_SECURITY_YAML } from "./manifests";

const IMAGES = ["redis", "httpd", "busybox", "postgres", "rabbitmq"];
const NAMES = ["leuchtfeuer", "fischtheke", "lotsenfunk", "ankerwinde", "kombuese", "seekiste"];
/** Gültige (kleingeschriebene) Image-Namen für die eigenen Bau-Übungen (#66). */
const BUILD_NAMES = ["hafenwache", "funkdienst", "lotsenbild", "kombuese-app", "kaiapp", "ankerdienst"];

/** Sorgt dafür, dass ein Dockerfile im Sim-Dateisystem liegt (für docker build/tag). */
function ensureDockerfile(sim: Sim) {
  if (!sim.files["Dockerfile"]) sim.files["Dockerfile"] = DOCKERFILE;
}

function ensureDeployment(sim: Sim): Deployment {
  let d = sim.deployments.find(d => !["kantine"].includes(d.name)) || sim.deployments[0];
  if (!d) {
    const name = pick(NAMES);
    sim.exec("kubectl create deployment " + name + " --image=nginx");
    d = sim.deployments.find(x => x.name === name)!;
  }
  return d;
}

function ensureGit(sim: Sim) {
  if (!sim.git.initialized) sim.exec("git init");
}

/** Gültige Chart-Namen (klein, mit Bindestrich) für die Werft-Übungen (#27). */
const CHART_NAMES = ["funkdienst", "hafenkarte", "lotsen-app", "moewenruf", "kombuese-api", "ankerwerk"];

/** Sorgt dafür, dass ein selbst gebautes Chart existiert, und gibt seinen Namen zurück. */
function ensureChart(sim: Sim): string {
  if (sim.charts.length === 0) {
    let name = pick(CHART_NAMES);
    while (sim.charts.some(c => c.name === name)) name = pick(CHART_NAMES) + rnd(2, 99);
    sim.exec("helm create " + name);
  }
  return sim.charts[0].name;
}

/** Namen & geschützte Apps für die Hafenmauer-Übungen (#20). */
const NETPOL_NAMES = ["hafenmauer", "kaimauer", "wellenbrecher", "bollwerk", "schutzwall", "palisade"];
const NETPOL_APPS = ["kasse", "lager", "funkdienst", "lotsen", "leuchtfeuer", "kombuese"];

/** Sorgt dafür, dass mindestens eine Hafenmauer (NetworkPolicy) existiert, und gibt sie zurück. */
function ensureNetworkPolicy(sim: Sim): NetworkPolicyRes {
  if (sim.networkPolicies.length === 0) {
    let name = pick(NETPOL_NAMES);
    while (sim.networkPolicies.some(n => n.name === name)) name = pick(NETPOL_NAMES) + rnd(2, 99);
    const file = "uebung-netpol.yaml";
    sim.files[file] = NETPOL_YAML;
    sim.applyEffects[file] = { networkPolicy: { name, podSelector: pick(NETPOL_APPS), allowFrom: "hafentor" } };
    sim.exec("kubectl apply -f " + file);
  }
  return sim.networkPolicies[0];
}

/** Namen für die GitOps-/Argo-Übungen (#98) – klein, mit Bindestrich, eigene Seekarten-Welt. */
const ARGO_APP_NAMES = ["kai-speicher", "lotsen-funk", "anker-dienst", "moewen-app", "flotten-karte", "leuchtturm-wache"];

/** Sorgt dafür, dass eine Argo-Application existiert, und gibt sie zurück.
 *  Mit `fresh` immer eine NEU angelegte (also garantiert noch <code>OutOfSync</code>) –
 *  das braucht die Sync-Übung, damit es wirklich etwas zu synchronisieren gibt. */
function ensureArgoApp(sim: Sim, fresh = false): ArgoApp {
  if (!fresh && sim.argoApps.length > 0) return sim.argoApps[0];
  let name = pick(ARGO_APP_NAMES);
  while (sim.argoApps.some(a => a.name === name)) name = pick(ARGO_APP_NAMES) + rnd(2, 99);
  const file = "ensure-application.yaml";
  sim.files[file] = ARGO_APPLICATION_MANUAL_YAML;
  // autoSync:false → Argo kennt den Soll-Zustand, hat ihn aber noch nicht gezogen (OutOfSync).
  sim.applyEffects[file] = { application: { name, repo: "https://github.com/port-kubernia/seekarten.git", path: name, autoSync: false, selfHeal: false, deployment: { name, image: "nginx:1.27", replicas: 2 } } };
  sim.exec("kubectl apply -f " + file);
  return sim.argoApps.find(a => a.name === name)!;
}

/* ---- Wachturm-Quartier (#136, Phase 6): RBAC / ServiceAccounts / Pod-Security ---- */
/** Eigene SA-Namen für die Ausweis-Übungen (klein, mit Bindestrich). */
const SA_NAMES = ["torwache", "deploy-bot", "spaehtrupp", "kontrolleur", "schliessdienst", "nachtwache"];
/** Role-Namen (namespaced) für die Schlüssellisten-Übungen. */
const ROLE_NAMES = ["pod-leser", "dienst-spaeher", "wacht-leser", "log-leser", "kai-leser"];
/** ClusterRole-Namen (cluster-weit, z.B. für nodes). */
const CLUSTERROLE_NAMES = ["knoten-spaeher", "rundblick-leser", "cluster-wache", "knoten-leser"];
/** (verb, resource)-Paare für die auth-can-i-Übung – Mix aus namespaced & cluster-weit. */
const CANI_PAIRS: [string, string][] = [["get", "pods"], ["list", "pods"], ["watch", "pods"], ["list", "nodes"], ["get", "services"], ["create", "deployments"], ["delete", "secrets"]];

/** Sorgt dafür, dass eine (Cluster-)Role mit diesem Namen existiert (für die describe-Übung). */
function ensureRole(sim: Sim, name: string, cluster: boolean) {
  if (sim.roles.some(r => r.name === name && r.cluster === cluster)) return;
  const file = "ensure-" + (cluster ? "clusterrole" : "role") + ".yaml";
  sim.files[file] = cluster ? CLUSTERROLE_YAML : ROLE_YAML;
  sim.applyEffects[file] = { role: { name, cluster, rules: [{ verbs: ["get", "list", "watch"], resources: [cluster ? "nodes" : "pods"] }] } };
  sim.exec("kubectl apply -f " + file);
}

/** Eine generierte Übungsaufgabe (Drill).
 *  `why` begründet bei falscher Eingabe das Prinzip (nicht nur die Musterlösung) –
 *  „verstehen statt auswendig" (#233). Pflichtfeld: jeder Drill trägt eine Begründung. */
export type DrillTask = { text: string; accept: RegExp[]; solution: string; hint: string; why: string; diag?: (input: string) => string | null };

export const DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "docker-pull": _sim => {
    const img = pick(IMAGES);
    return { text: "Lade das Image <code>" + img + "</code> aus der Registry.", accept: [new RegExp("^docker\\s+pull\\s+" + img + "(:\\S+)?$")], solution: "docker pull " + img, hint: "Muster: docker pull &lt;image&gt;", why: "pull holt ein fertiges Image aus der Registry auf deinen Rechner – Muster: docker pull &lt;image&gt;." };
  },
  "docker-run": _sim => {
    const img = pick(IMAGES);
    return { text: "Starte einen Container aus dem Image <code>" + img + "</code> (ohne Extras).", accept: [new RegExp("^docker\\s+run\\s+" + img + "(:\\S+)?$")], solution: "docker run " + img, hint: "Muster: docker run &lt;image&gt;", why: "run startet aus einem Image einen laufenden Container – Muster: docker run &lt;image&gt;." };
  },
  "docker-run-named": sim => {
    const img = pick(IMAGES);
    let name = pick(NAMES);
    while (sim.docker.containers.some(c => c.name === name && c.running)) name = pick(NAMES) + rnd(2, 99);
    return { text: "Starte aus <code>" + img + "</code> einen Container im Hintergrund mit dem Namen <code>" + name + "</code>.", accept: [new RegExp("^docker\\s+run\\s+(?:(?:-d|--detach)\\s+--name\\s+" + name + "|--name\\s+" + name + "\\s+(?:-d|--detach))\\s+" + img + "(:\\S+)?$")], solution: "docker run --detach --name " + name + " " + img, hint: "Genau dieser Befehl, keine weiteren Optionen (die kommen später) – Muster: docker run --detach --name &lt;name&gt; &lt;image&gt; (statt --detach geht auch die Kurzform -d)", why: "Die Reihenfolge der Optionen ist frei (--detach --name oder --name --detach, beides gilt; statt --detach geht auch die Kurzform -d), nur: erst alle Optionen, dann das Image ganz zuletzt – und KEINE zusätzlichen Flags, hier zählt nur der gefragte Befehl. Muster: docker run --detach --name &lt;name&gt; &lt;image&gt;.", diag: (input: string): string | null => {
      const nameM = input.match(/--name\s+(\S+)/);
      if (!nameM) return null; // kein --name → Strukturfehler, why passt
      const givenName = nameM[1];
      const parts = input.trim().split(/\s+/);
      const givenImg = parts[parts.length - 1];
      const baseGivenImg = givenImg.split(":")[0];
      const nameMismatch = givenName !== name;
      const imgMismatch = baseGivenImg !== img;
      if (nameMismatch && !imgMismatch) return "Der Name stimmt nicht – erwartet <code>" + name + "</code>, getippt <code>" + givenName + "</code>. Tippfehler?";
      if (imgMismatch && !nameMismatch) return "Das Image stimmt nicht – erwartet <code>" + img + "</code>, getippt <code>" + givenImg + "</code>. Tippfehler?";
      if (nameMismatch && imgMismatch) return "Name und Image stimmen nicht – erwartet <code>--name " + name + " " + img + "</code>.";
      return null; // Name und Image stimmen, anderer Grund → why passt
    } };
  },
  "docker-ps": () => ({ text: "Zeig alle <b>laufenden</b> Container.", accept: [/^docker\s+ps$/], solution: "docker ps", hint: "Zwei Buchstaben nach docker.", why: "ps zeigt nur die laufenden Container; mit -a kämen auch die gestoppten dazu." }),
  "docker-ps-a": () => ({ text: "Zeig <b>alle</b> Container – auch gestoppte.", accept: [/^docker\s+ps\s+(-a|--all)$/], solution: "docker ps --all", hint: "docker ps + die ausgeschriebene Flag für „alle“ (--all).", why: "Ohne --all siehst du nur laufende Container; --all zeigt auch die gestoppten." }),
  "docker-stop": sim => {
    let c = sim.docker.containers.find(c => c.running);
    if (!c) { const name = pick(NAMES); sim.exec("docker run -d --name " + name + " nginx"); c = sim.docker.containers.find(x => x.name === name)!; }
    return { text: "Stoppe den Container <code>" + c.name + "</code>.", accept: [new RegExp("^docker\\s+stop\\s+" + c.name + "$")], solution: "docker stop " + c.name, hint: "Muster: docker stop &lt;name&gt;", why: "stop hält einen laufenden Container an seinem Namen an – Muster: docker stop &lt;name&gt;." };
  },
  "docker-build": sim => {
    ensureDockerfile(sim);
    const name = pick(BUILD_NAMES);
    const tag = pick(["1.0", "2.0", "0.1", "dev", "stable"]);
    return { text: "Bau aus dem <code>Dockerfile</code> ein eigenes Image <code>" + name + ":" + tag + "</code> (Punkt am Ende!).", accept: [new RegExp("^docker\\s+build\\s+(?:-t|--tag)\\s+" + name + ":" + tag.replace(/\./g, "\\.") + "\\s+\\.$")], solution: "docker build --tag " + name + ":" + tag + " .", hint: "Muster: docker build --tag &lt;name&gt;:&lt;tag&gt; . (statt --tag geht auch die Kurzform -t)", why: "build schichtet aus dem Dockerfile ein Image – aber nicht im Terminal, sondern in der <b>Docker-Engine</b>, die deine Ordner nicht sieht. Der Punkt ist der <b>Build-Kontext</b>: der Ordner (<code>.</code> = der aktuelle), den du der Engine als Paket übergibst – die <b>Kiste mit Baumaterial</b> für die Werft. Docker sucht darin das Dockerfile; alles, was <code>COPY</code> holt, muss drin liegen. <code>--tag</code> vergibt den ganzen Namen <code>name:tag</code> (Kurzform <code>-t</code>, beides gilt) – der Teil hinter dem <code>:</code> ist der Versions-Tag, und <code>docker tag</code> ist nochmal ein eigener Befehl für einen nachträglichen Zweitnamen." };
  },
  "docker-tag": sim => {
    ensureDockerfile(sim);
    const name = pick(BUILD_NAMES);
    sim.exec("docker build -t " + name + ":1.0 ."); // sorgt für ein vorhandenes Quell-Image
    const newTag = pick(["latest", "stable", "prod", "v2"]);
    return { text: "Gib deinem Image <code>" + name + ":1.0</code> zusätzlich das Etikett <code>" + name + ":" + newTag + "</code>.", accept: [new RegExp("^docker\\s+tag\\s+" + name + ":1\\.0\\s+" + name + ":" + newTag + "$")], solution: "docker tag " + name + ":1.0 " + name + ":" + newTag, hint: "Muster: docker tag &lt;quelle&gt; &lt;ziel&gt;", why: "tag hängt einem vorhandenen Image einen zweiten Namen an. Reihenfolge ist Quelle → Ziel – wie beim Umetikettieren: erst die vorhandene Kiste (" + name + ":1.0), dann das neue Schild (" + name + ":" + newTag + ")." };
  },
  "k-get-nodes": () => ({ text: "Zeig die Nodes des Clusters.", accept: [/^kubectl\s+get\s+(nodes|node|no)$/], solution: "kubectl get nodes", hint: "kubectl get &lt;ressourcentyp&gt;", why: "get listet Ressourcen eines Typs – Muster: kubectl get &lt;ressourcentyp&gt;, hier die Nodes (Server) des Clusters." }),
  "k-get-pods": () => ({ text: "Zeig alle Pods.", accept: [/^kubectl\s+get\s+(pods|pod|po)$/], solution: "kubectl get pods", hint: "kubectl get &lt;ressourcentyp&gt;", why: "Gleiches Muster wie bei nodes: kubectl get pods listet alle Pods." }),
  "k-get-svc": () => ({ text: "Zeig alle Services.", accept: [/^kubectl\s+get\s+(services|service|svc)$/], solution: "kubectl get services", hint: "Schreib es aus: kubectl get services (die Kurzform svc verdienst du dir durch Nutzung).", why: "kubectl get services listet die Services – die festen Adressen vor den Pods. Die Kurzform svc verdienst du dir, wenn du die Langform oft genug tippst." }),
  "k-describe": sim => {
    const d = ensureDeployment(sim);
    const pod = d.pods[0].name;
    return { text: "Beschreibe den Pod <code>" + pod + "</code> im Detail.", accept: [new RegExp("^kubectl\\s+describe\\s+pods?\\s+" + pod.replace(/[-]/g, "\\-") + "$")], solution: "kubectl describe pod " + pod, hint: "kubectl describe pod &lt;name&gt; – den Namen kannst du abtippen.", why: "describe zeigt die Detail-Akte eines Objekts inkl. Events – Muster: kubectl describe pod &lt;name&gt;." };
  },
  // Übt die --namespace-Langform, damit man sich die Kurzform -n durch Nutzung verdient (#380).
  "k-get-pods-ns": () => ({ text: "Schau ins Maschinenherz: zeig die Pods im Namespace <code>kube-system</code>.", accept: [/^kubectl\s+get\s+(pods|pod|po)\s+(-n|--namespace)[=\s]?kube-system$/], solution: "kubectl get pods --namespace kube-system", hint: "kubectl get pods --namespace kube-system (die Kurzform -n verdienst du dir durch Nutzung).", why: "Ohne Namespace siehst du nur den aktuellen (default); --namespace &lt;name&gt; wählt einen anderen, z.B. kube-system, das Maschinenherz von Kubernetes. Die Kurzform -n verdienst du dir, wenn du die Langform oft genug tippst." }),
  "k-create": sim => {
    let name = pick(NAMES);
    while (sim.deployments.some(d => d.name === name)) name = pick(NAMES) + rnd(2, 9);
    const img = pick(IMAGES);
    return { text: "Erstelle ein Deployment <code>" + name + "</code> mit dem Image <code>" + img + "</code>.", accept: [new RegExp("^kubectl\\s+create\\s+deployment\\s+" + name + "\\s+--image[=\\s]" + img + "(:\\S+)?$")], solution: "kubectl create deployment " + name + " --image=" + img, hint: "Muster: kubectl create deployment &lt;name&gt; --image=&lt;image&gt;", why: "create deployment legt den Dauerauftrag an; --image bestimmt, welches Image die Pods fahren – Muster: kubectl create deployment &lt;name&gt; --image=&lt;image&gt;." };
  },
  "k-scale": sim => {
    const d = ensureDeployment(sim);
    let n = rnd(2, 5);
    if (n === d.replicas) n++;
    return { text: "Skaliere das Deployment <code>" + d.name + "</code> auf <b>" + n + "</b> Kopien. (Blick zum Dock!)", accept: [new RegExp("^kubectl\\s+scale\\s+deployment\\s+" + d.name + "\\s+--replicas[=\\s]" + n + "$")], solution: "kubectl scale deployment " + d.name + " --replicas=" + n, hint: "Muster: kubectl scale deployment &lt;name&gt; --replicas=&lt;zahl&gt;", why: "scale ändert die Soll-Zahl der Kopien; Kubernetes zieht das Ist sofort nach – Muster: kubectl scale deployment &lt;name&gt; --replicas=&lt;zahl&gt;." };
  },
  "k-delete-pod": sim => {
    const d = ensureDeployment(sim);
    const pod = d.pods[0].name;
    return { text: "Versenke den Pod <code>" + pod + "</code> – und beobachte das Self-Healing am Dock!", accept: [new RegExp("^kubectl\\s+delete\\s+pods?\\s+" + pod.replace(/[-]/g, "\\-") + "$")], solution: "kubectl delete pod " + pod, hint: "kubectl delete pod &lt;name&gt;", why: "Einen vom Deployment verwalteten Pod ersetzt Kubernetes nach dem Löschen sofort (Self-Healing) – das Soll bleibt erhalten. Muster: kubectl delete pod &lt;name&gt;." };
  },
  "k-expose": sim => {
    const d = ensureDeployment(sim);
    if (sim.services.some(s => s.name === d.name)) sim.exec("kubectl delete service " + d.name);
    const port = pick([80, 8080, 3000, 5432]);
    return { text: "Stelle einen Service vor <code>" + d.name + "</code>, Port <b>" + port + "</b>.", accept: [new RegExp("^kubectl\\s+expose\\s+deployment\\s+" + d.name + "\\s+--port[=\\s]" + port + "$")], solution: "kubectl expose deployment " + d.name + " --port=" + port, hint: "Muster: kubectl expose deployment &lt;name&gt; --port=&lt;port&gt;", why: "expose stellt einen Service als feste Adresse vor das Deployment; --port ist der Port, unter dem er erreichbar ist – Muster: kubectl expose deployment &lt;name&gt; --port=&lt;port&gt;." };
  },
  "k-apply": sim => {
    sim.files["uebung.yaml"] = "# Übungs-Manifest\nkind: Deployment\n…";
    sim.applyEffects["uebung.yaml"] = { deployment: { name: "uebung", image: "nginx", replicas: 1 } };
    if (sim.deployments.some(d => d.name === "uebung")) sim.exec("kubectl delete deployment uebung");
    return { text: "Wende die Datei <code>uebung.yaml</code> deklarativ an.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+uebung\.yaml$/], solution: "kubectl apply --filename uebung.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "apply gleicht den Cluster an die Datei an – deklarativ und idempotent (zweimal apply schadet nicht). Muster: kubectl apply --filename &lt;datei&gt;." };
  },
  "helm-install": sim => {
    if (!sim.helmRepos.includes("bitnami")) sim.exec("helm repo add bitnami https://charts.bitnami.com/bitnami");
    let rel = pick(NAMES);
    while (sim.releases.some(r => r.name === rel)) rel = pick(NAMES) + rnd(2, 9);
    const chart = pick(["nginx", "redis"]);
    return { text: "Installiere <code>bitnami/" + chart + "</code> als Release <code>" + rel + "</code>.", accept: [new RegExp("^helm\\s+install\\s+" + rel + "\\s+bitnami\\/" + chart + "$")], solution: "helm install " + rel + " bitnami/" + chart, hint: "Muster: helm install &lt;release&gt; &lt;repo&gt;/&lt;chart&gt;", why: "install rollt ein Chart als benanntes Release aus – der Release-Name kommt vor dem Chart: helm install &lt;release&gt; &lt;repo&gt;/&lt;chart&gt;." };
  },
  "helm-list": () => ({ text: "Zeig alle installierten Releases.", accept: [/^helm\s+(list|ls)$/], solution: "helm list", hint: "Schreib es aus: helm list (Englisch für „auflisten“; die Kurzform ls verdienst du dir durch Nutzung).", why: "helm list zeigt alle installierten Releases mit Revision und Status. Die Kurzform ls verdienst du dir, wenn du die Langform oft genug tippst." }),
  "helm-upgrade": sim => {
    let r = sim.releases[0];
    if (!r) { sim.exec("helm repo add bitnami https://charts.bitnami.com/bitnami"); sim.exec("helm install uebung bitnami/nginx"); r = sim.releases[0]; }
    const n = rnd(2, 4);
    return { text: "Stelle das Release <code>" + r.name + "</code> per <code>--set replicaCount=" + n + "</code> um.", accept: [new RegExp("^helm\\s+upgrade\\s+" + r.name + "\\s+" + r.chart.replace("/", "\\/") + "\\s+--set\\s+replicaCount=" + n + "$")], solution: "helm upgrade " + r.name + " " + r.chart + " --set replicaCount=" + n, hint: "Muster: helm upgrade &lt;release&gt; &lt;chart&gt; --set replicaCount=&lt;n&gt;", why: "upgrade ändert ein laufendes Release; --set überschreibt einzelne Werte, ohne eine neue values-Datei zu brauchen – Muster: helm upgrade &lt;release&gt; &lt;chart&gt; --set &lt;schlüssel&gt;=&lt;wert&gt;." };
  },
  "helm-rollback": sim => {
    let r = sim.releases.find(r => r.revision > 1);
    if (!r) {
      r = sim.releases[0];
      if (!r) { sim.exec("helm repo add bitnami https://charts.bitnami.com/bitnami"); sim.exec("helm install uebung bitnami/nginx"); r = sim.releases[0]; }
      sim.exec("helm upgrade " + r.name + " " + r.chart + " --set replicaCount=2");
    }
    return { text: "Hoppla, das Upgrade von <code>" + r.name + "</code> war ein Fehler – rolle auf Revision <b>1</b> zurück!", accept: [new RegExp("^helm\\s+rollback\\s+" + r.name + "\\s+1$")], solution: "helm rollback " + r.name + " 1", hint: "Muster: helm rollback &lt;release&gt; &lt;revision&gt;", why: "Helm führt pro Release eine Revisions-Historie; rollback setzt auf eine frühere Revision zurück – Muster: helm rollback &lt;release&gt; &lt;revision&gt;." };
  },
  "helm-create": sim => {
    let name = pick(CHART_NAMES);
    while (sim.charts.some(c => c.name === name)) name = pick(CHART_NAMES) + rnd(2, 99);
    return { text: "Bau ein eigenes Chart-Gerüst namens <code>" + name + "</code>.", accept: [new RegExp("^helm\\s+create\\s+" + name + "$")], solution: "helm create " + name, hint: "Muster: helm create &lt;chart-name&gt;", why: "create legt das Chart-Gerüst an (Chart.yaml als Steckbrief, values.yaml als Drehknöpfe, templates/ als Vorlagen) – Muster: helm create &lt;chart-name&gt;." };
  },
  "helm-lint": sim => {
    const name = ensureChart(sim);
    return { text: "Prüfe dein Chart <code>" + name + "</code> auf Fehler.", accept: [new RegExp("^helm\\s+lint\\s+(\\.\\/)?" + name + "$")], solution: "helm lint " + name, hint: "Muster: helm lint &lt;chart&gt;", why: "lint ist die Generalprobe fürs Chart: es prüft Struktur und Stil, bevor du es ausrollst oder teilst – Muster: helm lint &lt;chart&gt;." };
  },
  "helm-package": sim => {
    const name = ensureChart(sim);
    return { text: "Pack dein Chart <code>" + name + "</code> in ein verteilbares Archiv.", accept: [new RegExp("^helm\\s+package\\s+(\\.\\/)?" + name + "$")], solution: "helm package " + name, hint: "Muster: helm package &lt;chart&gt;", why: "package schnürt das Chart in ein versioniertes .tgz-Archiv – genau das, was in Chart-Repos liegt und sich teilen lässt. Muster: helm package &lt;chart&gt;." };
  },
  "helm-install-local": sim => {
    const name = ensureChart(sim);
    let rel = pick(NAMES);
    while (sim.releases.some(r => r.name === rel)) rel = pick(NAMES) + rnd(2, 99);
    return { text: "Installiere aus deinem eigenen Chart <code>./" + name + "</code> ein Release <code>" + rel + "</code>.", accept: [new RegExp("^helm\\s+install\\s+" + rel + "\\s+\\.\\/" + name + "$")], solution: "helm install " + rel + " ./" + name, hint: "Muster: helm install &lt;release&gt; ./&lt;chart&gt;", why: "Aus einem lokalen Chart-Ordner installierst du über den Pfad statt über &lt;repo&gt;/&lt;chart&gt; – Muster: helm install &lt;release&gt; ./&lt;chart&gt;." };
  },
  // Übt die --values-Langform, damit man sich die Kurzform -f durch Nutzung verdient (#381).
  "helm-upgrade-values": sim => {
    const name = ensureChart(sim);
    let rel = sim.releases.find(r => r.chart === "./" + name || r.chart === name);
    if (!rel) {
      let rn = pick(NAMES);
      while (sim.releases.some(r => r.name === rn)) rn = pick(NAMES) + rnd(2, 99);
      sim.exec("helm install " + rn + " ./" + name);
      rel = sim.releases.find(r => r.name === rn)!;
    }
    return { text: "Upgrade das Release <code>" + rel.name + "</code> mit der Werte-Datei <code>" + name + "/values.yaml</code>.", accept: [new RegExp("^helm\\s+upgrade\\s+" + rel.name + "\\s+(\\.\\/)?" + name + "\\s+(?:--values|-f)\\s+" + name + "\\/values\\.yaml$")], solution: "helm upgrade " + rel.name + " ./" + name + " --values " + name + "/values.yaml", hint: "Muster: helm upgrade &lt;release&gt; &lt;chart&gt; --values &lt;datei&gt; (die Kurzform -f verdienst du dir durch Nutzung)", why: "--values gibt eine eigene Werte-Datei mit, die die Defaults aus values.yaml überschreibt – Muster: helm upgrade &lt;release&gt; &lt;chart&gt; --values &lt;datei&gt;. Die Kurzform -f verdienst du dir durch Nutzung." };
  },
  // Übt die dependency-Langform, damit man sich die Kurzform dep durch Nutzung verdient (#381).
  "helm-dep-update": sim => {
    const name = ensureChart(sim);
    return { text: "Hol die Subcharts von <code>" + name + "</code> – schreibt <code>Chart.lock</code> fest.", accept: [new RegExp("^helm\\s+(dependency|dep)\\s+(update|up)\\s+(\\.\\/)?" + name + "$")], solution: "helm dependency update " + name, hint: "Muster: helm dependency update &lt;chart&gt; (die Kurzform dep verdienst du dir durch Nutzung)", why: "dependency update zieht die in Chart.yaml deklarierten Subcharts und zurrt sie in Chart.lock fest (reproduzierbar) – Muster: helm dependency update &lt;chart&gt;. Die Kurzform dep verdienst du dir durch Nutzung." };
  },
  "tf-plan": sim => {
    if (!sim.tf.initialized) sim.tf.initialized = true; // Übung setzt ein initialisiertes Projekt voraus
    return { text: "Zeig, was Terraform tun WÜRDE – ohne es zu tun.", accept: [/^terraform\s+plan$/], solution: "terraform plan", hint: "Die Generalprobe.", why: "plan ist die Generalprobe: es zeigt, was sich ändern würde – ohne es wirklich zu tun. Erst plan lesen, dann apply." };
  },
  "tf-state": sim => {
    if (!sim.tf.applied) { sim.tf.initialized = true; sim.exec("terraform apply"); }
    return { text: "Wirf einen Blick in Terraforms Gedächtnis.", accept: [/^terraform\s+state\s+list$/], solution: "terraform state list", hint: "terraform state …", why: "Der State ist Terraforms Gedächtnis; state list zeigt, welche Ressourcen es bereits verwaltet." };
  },
  "k-secret": sim => {
    let name = pick(["schatzkarte", "funkcode", "kombuesen-rezept"]) + rnd(2, 99);
    while (sim.secrets.some(s => s.name === name)) name = "funkcode" + rnd(100, 9999);
    return { text: "Lege ein Secret <code>" + name + "</code> mit <code>--from-literal=passwort=geheim" + rnd(10, 99) + "x</code> an. (Wert frei wählbar!)", accept: [new RegExp("^kubectl\\s+create\\s+secret\\s+generic\\s+" + name + "\\s+--from-literal[=\\s][\\w.-]+=\\S+$")], solution: "kubectl create secret generic " + name + " --from-literal=passwort=geheim123", hint: "Muster: kubectl create secret generic &lt;name&gt; --from-literal=schluessel=wert", why: "Secrets halten Vertrauliches – statt Klartext in YAML; --from-literal=&lt;schlüssel&gt;=&lt;wert&gt; setzt einen Wert direkt. Muster: kubectl create secret generic &lt;name&gt; --from-literal=&lt;schlüssel&gt;=&lt;wert&gt;." };
  },
  "k-get-secrets": () => ({ text: "Zeig alle Secrets an.", accept: [/^kubectl\s+get\s+(secrets|secret)$/], solution: "kubectl get secrets", hint: "kubectl get …", why: "Gleiches get-Muster: kubectl get secrets listet die Secrets des Namespaces." }),
  "k-secret-tls": sim => {
    let name = pick(["hafen-tls", "kasse-tls", "lager-tls"]);
    while (sim.secrets.some(s => s.name === name)) name = "tor-tls-" + rnd(100, 9999);
    return { text: "Lege ein TLS-Secret <code>" + name + "</code> aus <code>tls.crt</code> und <code>tls.key</code> an.", accept: [new RegExp("^kubectl\\s+create\\s+secret\\s+tls\\s+" + name + "\\s+(?:--cert[=\\s]\\S+\\s+--key[=\\s]\\S+|--key[=\\s]\\S+\\s+--cert[=\\s]\\S+)$")], solution: "kubectl create secret tls " + name + " --cert=tls.crt --key=tls.key", hint: "Muster: kubectl create secret tls &lt;name&gt; --cert=tls.crt --key=tls.key", why: "Ein TLS-Secret bündelt Zertifikat und Schlüssel; --cert zeigt auf die .crt-, --key auf die .key-Datei – Muster: kubectl create secret tls &lt;name&gt; --cert=tls.crt --key=tls.key." };
  },
  "k-get-ingress": () => ({ text: "Zeig alle Hafentore (Ingresses) an.", accept: [/^kubectl\s+get\s+(ingress|ingresses|ing)$/], solution: "kubectl get ingress", hint: "Schreib es aus: kubectl get ingress (die Kurzform ing verdienst du dir durch Nutzung).", why: "kubectl get ingress zeigt die Hafentore – die Routen von außen ins Cluster. Die Kurzform ing verdienst du dir, wenn du die Langform oft genug tippst." }),
  "k-logs": sim => {
    const d = ensureDeployment(sim);
    const pod = d.pods[0].name;
    return { text: "Lies die Logs des Pods <code>" + pod + "</code>.", accept: [new RegExp("^kubectl\\s+logs\\s+" + pod.replace(/[-]/g, "\\-") + "$")], solution: "kubectl logs " + pod, hint: "kubectl logs &lt;pod-name&gt; – Name per get pods holen.", why: "logs zeigt die Ausgabe der App im Pod (die App-Sicht) – Muster: kubectl logs &lt;pod-name&gt;; den Namen holst du dir per get pods." };
  },
  "k-rollout": sim => {
    const d = ensureDeployment(sim);
    return { text: "Starte alle Pods von <code>" + d.name + "</code> sauber neu (Rolling Restart).", accept: [new RegExp("^kubectl\\s+rollout\\s+restart\\s+deployment[\\/\\s]" + d.name + "$")], solution: "kubectl rollout restart deployment " + d.name, hint: "Muster: kubectl rollout restart deployment &lt;name&gt;", why: "rollout restart ersetzt alle Pods rollierend (z.B. nachdem die Ursache eines Fehlers behoben ist) – Muster: kubectl rollout restart deployment &lt;name&gt;." };
  },
  "k-set-resources": sim => {
    const d = ensureDeployment(sim);
    const lim = pick([128, 256, 512]);
    const req = lim / 2;
    return { text: "Setz dem Deployment <code>" + d.name + "</code> ein memory-Limit von <b>" + lim + "Mi</b> und einen Request von <b>" + req + "Mi</b>.", accept: [new RegExp("^kubectl\\s+set\\s+resources\\s+deployment[\\/\\s]" + d.name + "\\s+(?:--limits[=\\s][^\\s]*memory=" + lim + "Mi\\s+--requests[=\\s][^\\s]*memory=" + req + "Mi|--requests[=\\s][^\\s]*memory=" + req + "Mi\\s+--limits[=\\s][^\\s]*memory=" + lim + "Mi)$")], solution: "kubectl set resources deployment/" + d.name + " --limits=memory=" + lim + "Mi --requests=memory=" + req + "Mi", hint: "Muster: kubectl set resources deployment/&lt;name&gt; --limits=memory=&lt;X&gt;Mi --requests=memory=&lt;Y&gt;Mi", why: "requests reservieren Platz auf dem Node, limits sind die Obergrenze im Betrieb (Speicher drüber → OOMKilled) – beide setzt du mit kubectl set resources deployment/&lt;name&gt; --limits=memory=&lt;X&gt;Mi --requests=memory=&lt;Y&gt;Mi." };
  },
  "git-status": sim => {
    ensureGit(sim);
    return { text: "Zeig den aktuellen Stand deines Repos (Branch + Änderungen).", accept: [/^git\s+status$/], solution: "git status", hint: "git + ein Wort für „Stand“.", why: "status zeigt den aktuellen Branch und welche Änderungen vorgemerkt bzw. noch offen sind – der Lagebericht vor jedem Commit." };
  },
  "git-add": sim => {
    ensureGit(sim);
    const fn = "seekarte-" + sim.clock + "-" + rnd(100, 9999) + ".md";
    sim.files[fn] = "# Karte";
    return { text: "Merke die neue Datei <code>" + fn + "</code> zum Commit vor.", accept: [new RegExp("^git\\s+add\\s+" + fn.replace(/[.-]/g, "\\$&") + "$")], solution: "git add " + fn, hint: "Muster: git add &lt;datei&gt;", why: "add merkt eine Datei für den nächsten Commit vor (Staging) – erst auswählen, dann mit commit festhalten. Muster: git add &lt;datei&gt;." };
  },
  "git-commit": sim => {
    ensureGit(sim);
    const fn = "notiz-" + sim.clock + "-" + rnd(100, 9999) + ".md";
    sim.files[fn] = "x"; sim.exec("git add " + fn);
    const msg = pick(["Seekarte ergänzt", "Tippfehler behoben", "Route aktualisiert", "Hafen kartiert"]);
    return { text: "Halte die vorgemerkten Änderungen fest – Commit-Nachricht: <code>" + msg + "</code>.", accept: [new RegExp('^git\\s+commit\\s+(?:-m|--message)\\s+"' + msg + '"$')], solution: 'git commit --message "' + msg + '"', hint: 'Muster: git commit --message "Nachricht" (statt --message geht auch die Kurzform -m)', why: 'commit hält die vorgemerkten Änderungen als Schnappschuss mit Nachricht fest (lokal); hochgeladen wird erst mit push. Muster: git commit --message "Nachricht" – die Kurzform -m verdienst du dir durch Nutzung.' };
  },
  "git-branch": sim => {
    ensureGit(sim);
    let name = "karte-" + rnd(2, 99);
    while (sim.git.branches.includes(name)) name = "karte-" + rnd(100, 9999);
    return { text: "Lege einen neuen Branch <code>" + name + "</code> an (nur anlegen, nicht wechseln).", accept: [new RegExp("^git\\s+branch\\s+" + name + "$")], solution: "git branch " + name, hint: "Muster: git branch &lt;name&gt;", why: "branch legt einen neuen Zweig an, ohne dorthin zu wechseln (das täte checkout) – Muster: git branch &lt;name&gt;." };
  },
  "git-checkout": sim => {
    ensureGit(sim);
    let name = "feature-" + rnd(2, 99);
    while (sim.git.branches.includes(name)) name = "feature-" + rnd(100, 9999);
    return { text: "Lege den Branch <code>" + name + "</code> an UND wechsle direkt hinein.", accept: [new RegExp("^git\\s+checkout\\s+-b\\s+" + name + "$")], solution: "git checkout -b " + name, hint: "Muster: git checkout -b &lt;name&gt;", why: "checkout -b macht beides in einem Schritt: Branch anlegen UND direkt hineinwechseln – Muster: git checkout -b &lt;name&gt;." };
  },
  "git-add-all": sim => {
    ensureGit(sim);
    const fn = "aenderung-" + sim.clock + "-" + rnd(100, 9999) + ".md";
    sim.files[fn] = "# Notiz";
    return { text: "Merke <b>alle</b> Änderungen auf einmal zum Commit vor (mit dem Punkt-Kürzel).", accept: [/^git\s+add\s+\.$/], solution: "git add .", hint: "git add + ein einzelner Punkt = alles.", why: "Der Punkt steht für den aktuellen Ordner – git add . merkt damit alle Änderungen auf einmal vor, statt jede Datei einzeln." };
  },
  "ci-status": sim => {
    ensureGit(sim);
    if (!sim.files[".gitlab-ci.yml"]) sim.files[".gitlab-ci.yml"] = "stages: [build, test, deploy]";
    const fn = "auslieferung-" + sim.clock + "-" + rnd(100, 9999) + ".txt";
    sim.files[fn] = "x"; sim.exec("git add " + fn); sim.exec('git commit -m "Auslieferung"'); sim.exec("git push");
    return { text: "Schau nach, ob die letzte Pipeline durchgelaufen ist.", accept: [/^glab\s+ci\s+status$/], solution: "glab ci status", hint: "glab ci &lt;unterbefehl&gt; – der Befehl fürs Nachschauen.", why: "Ein Push löst die Pipeline aus; glab ci status zeigt, ob sie durchlief – kein Mensch klickt das an." };
  },
  // Git-Team-Alltag (#69). Bewusst NACH "ci-status" (das pusht) und vor den k8s-Drills,
  // damit kein folgender Drill von einem offenen Konflikt überrascht wird.
  "git-pull": sim => {
    ensureGit(sim);
    sim.git.conflict = null; // Reste aufräumen, sonst lehnt pull ab
    sim.git.remoteAhead = rnd(1, 3);
    return { text: "Das Team hat gepusht: hol die neuen Commits in deinen Branch (holen + zusammenführen).", accept: [/^git\s+pull$/], solution: "git pull", hint: "git + ein Wort fürs „herziehen“.", why: "„Erst holen, dann pushen“: pull holt die neuen Commits des Teams und führt sie zusammen – so vermeidest du abgewiesene Pushes und die meisten Konflikte." };
  },
  "git-resolve": sim => {
    ensureGit(sim);
    // Jeden Durchlauf frisch starten: einen evtl. offenen Konflikt vorher wegräumen.
    sim.git.conflict = null;
    sim.git.pendingConflict = null;
    let br = "kollege-" + rnd(2, 99);
    while (sim.git.branches.includes(br)) br = "kollege-" + rnd(100, 99999);
    const fn = "route-" + sim.clock + "-" + rnd(100, 9999) + ".md";
    sim.mergeScenario({ gitConflict: { branch: br, file: fn, ours: "Route A (deine)", theirs: "Route B (von " + br + ")" } });
    sim.exec("git merge " + br); // löst den Konflikt aus – jetzt steckt er in fn
    const side = pick(["--ours", "--theirs"]);
    const wer = side === "--ours" ? "<b>eigene</b>" : "<b>hereinkommende</b>";
    return { text: "Merge-Konflikt in <code>" + fn + "</code>: übernimm die " + wer + " Version.", accept: [new RegExp("^git\\s+checkout\\s+" + side + "\\s+" + fn.replace(/[.-]/g, "\\$&") + "$")], solution: "git checkout " + side + " " + fn, hint: "Muster: git checkout --ours/--theirs &lt;datei&gt;", why: "Im Konflikt wählst du eine Seite: --ours ist deine, --theirs die hereinkommende Version. Hier ist die " + wer + " gefragt – Muster: git checkout " + side + " &lt;datei&gt;." };
  },
  "k-get-netpol": sim => {
    ensureNetworkPolicy(sim);
    return { text: "Zeig alle Hafenmauern (NetworkPolicies) im Cluster.", accept: [/^kubectl\s+get\s+(networkpolicies|networkpolicy|netpol|netpols)$/], solution: "kubectl get networkpolicies", hint: "Schreib es aus: kubectl get networkpolicies (die Kurzform netpol verdienst du dir durch Nutzung).", why: "Gleiches get-Muster: kubectl get networkpolicies listet die Hafenmauern – wer mit wem reden darf. Die Kurzform netpol verdienst du dir, wenn du die Langform oft genug tippst." };
  },
  "k-apply-netpol": sim => {
    let name = pick(NETPOL_NAMES);
    while (sim.networkPolicies.some(n => n.name === name)) name = pick(NETPOL_NAMES) + rnd(2, 99);
    const file = "drill-netpol.yaml";
    sim.files[file] = NETPOL_YAML;
    sim.applyEffects[file] = { networkPolicy: { name, podSelector: pick(NETPOL_APPS), allowFrom: "hafentor" } };
    return { text: "Wende die Hafenmauer-Karte <code>" + file + "</code> deklarativ an.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+drill-netpol\.yaml$/], solution: "kubectl apply --filename " + file, hint: "kubectl apply --filename &lt;datei&gt;", why: "Auch eine NetworkPolicy ist ein ganz normales Manifest – mit kubectl apply --filename &lt;datei&gt; wird sie deklarativ angewandt." };
  },
  "k-describe-netpol": sim => {
    const np = ensureNetworkPolicy(sim);
    return { text: "Beschreibe die Hafenmauer <code>" + np.name + "</code> – wer darf rein?", accept: [new RegExp("^kubectl\\s+describe\\s+(networkpolicy|networkpolicies|netpol|netpols)\\s+" + np.name.replace(/[-]/g, "\\-") + "$")], solution: "kubectl describe networkpolicies " + np.name, hint: "kubectl describe networkpolicies &lt;name&gt; (die Kurzformen netpol/networkpolicy verdienst du dir durch Nutzung)", why: "describe zeigt die Details der Policy: wen sie schützt (podSelector) und wer durchdarf (from) – Muster: kubectl describe networkpolicies &lt;name&gt;." };
  },
  "k-delete-netpol": sim => {
    const np = ensureNetworkPolicy(sim);
    return { text: "Reiß die Hafenmauer <code>" + np.name + "</code> wieder ein.", accept: [new RegExp("^kubectl\\s+delete\\s+(networkpolicy|networkpolicies|netpol|netpols)\\s+" + np.name.replace(/[-]/g, "\\-") + "$")], solution: "kubectl delete networkpolicies " + np.name, hint: "kubectl delete networkpolicies &lt;name&gt; (die Kurzformen netpol/networkpolicy verdienst du dir durch Nutzung)", why: "delete entfernt die NetworkPolicy wieder – danach ist das Netzwerk an dieser Stelle wieder offen. Muster: kubectl delete networkpolicies &lt;name&gt;." };
  },
  // GitOps-Archipel (#98): Üben mit Argo CD – Application anlegen, Überblick, Akte lesen, Soll ziehen.
  "argo-apply": sim => {
    // Frische Seekarte: bei jedem Aufruf ein neuer, noch unbekannter Auftrag (sonst „unchanged“).
    let name = pick(ARGO_APP_NAMES);
    while (sim.argoApps.some(a => a.name === name)) name = pick(ARGO_APP_NAMES) + rnd(2, 99);
    const file = "drill-application.yaml";
    sim.files[file] = ARGO_APPLICATION_MANUAL_YAML;
    sim.applyEffects[file] = { application: { name, repo: "https://github.com/port-kubernia/seekarten.git", path: name, autoSync: false, selfHeal: false, deployment: { name, image: "nginx:1.27", replicas: 2 } } };
    return { text: "Eine Argo-<b>Application</b> ist ein ganz normales Manifest: wende die Seekarte <code>" + file + "</code> deklarativ an, damit Argo den neuen Auftrag kennt.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+drill-application\.yaml$/], solution: "kubectl apply --filename " + file, hint: "Der vertraute Befehl: kubectl apply --filename &lt;datei&gt;", why: "Eine Argo-Application ist selbst nur ein Manifest – mit dem vertrauten kubectl apply --filename &lt;datei&gt; machst du Argo den Soll-Zustand bekannt." };
  },
  "argo-app-list": sim => {
    ensureArgoApp(sim);
    return { text: "Verschaff dir den Flotten-Überblick: zeig alle <b>Argo-Applications</b> mit ihrem Sync- und Health-Status.", accept: [/^argocd\s+app\s+(list|ls)$/], solution: "argocd app list", hint: "Schreib es aus: argocd app list (die Kurzform ls verdienst du dir durch Nutzung).", why: "argocd app list zeigt alle Applications mit ihrem Sync- (Synced/OutOfSync) und Health-Status auf einen Blick. Die Kurzform ls verdienst du dir, wenn du die Langform oft genug tippst." };
  },
  "argo-app-get": sim => {
    const app = ensureArgoApp(sim);
    return { text: "Öffne die Akte der Application <code>" + app.name + "</code> – lies Sync Status und Health.", accept: [new RegExp("^argocd\\s+app\\s+get\\s+" + app.name.replace(/[-]/g, "\\-") + "$")], solution: "argocd app get " + app.name, hint: "Muster: argocd app get &lt;name&gt; – die Namen zeigt 'argocd app list'.", why: "argocd app get &lt;name&gt; öffnet die Akte einer einzelnen Application (Sync Status, Health, Details); die Namen liefert vorher argocd app list." };
  },
  "argo-app-sync": sim => {
    const app = ensureArgoApp(sim, true); // garantiert OutOfSync: es gibt echt etwas zu ziehen
    return { text: "Die Application <code>" + app.name + "</code> ist <b>OutOfSync</b>. Zieh den im Git deklarierten Soll-Zustand in den Cluster (Pull-Prinzip).", accept: [new RegExp("^argocd\\s+app\\s+sync\\s+" + app.name.replace(/[-]/g, "\\-") + "$")], solution: "argocd app sync " + app.name, hint: "Muster: argocd app sync &lt;name&gt;", why: "OutOfSync heißt: Cluster-Ist und Git-Soll klaffen auseinander. sync zieht den im Git deklarierten Stand per Pull in den Cluster – Muster: argocd app sync &lt;name&gt;." };
  },
  // Monitoring-Leuchtturm (#117, Phase 5): Observability üben – Metriken (top), Scrape-Aufträge
  // (ServiceMonitor), Logs (--previous), Alert-Status & Alert-Regeln (PrometheusRule). NPC: lumi.
  "obs-top-pods": sim => {
    ensureDeployment(sim); // damit es laufende Pods mit Last gibt
    return { text: "Wirf den schnellen Blick auf den Verbrauch: zeig CPU und Speicher aller laufenden Pods.", accept: [/^kubectl\s+top\s+(pods|pod|po)$/], solution: "kubectl top pods", hint: "kubectl top pods (Kurzform po).", why: "top pods ist der Live-Blick auf den Verbrauch je laufendem Pod (CPU in m, Speicher in Mi) – ideal, um den heißen Pod zu finden. Den Status zeigt get pods, die Logs logs." };
  },
  "obs-top-nodes": () => ({ text: "Zeig die Auslastung der Nodes (Server) des Clusters.", accept: [/^kubectl\s+top\s+(nodes|node|no)$/], solution: "kubectl top nodes", hint: "kubectl top nodes (Kurzform no).", why: "top nodes zeigt CPU- und Speicher-Auslastung je Node – so siehst du, ob ein ganzer Server an die Grenze kommt, nicht nur ein einzelner Pod." }),
  "obs-sm-apply": sim => {
    let name = pick(["lager-monitor", "kasse-monitor", "funk-monitor", "lotsen-monitor"]);
    while (sim.serviceMonitors.some(s => s.name === name)) name = "monitor-" + rnd(100, 9999);
    const file = "drill-servicemonitor.yaml";
    sim.files[file] = SERVICEMONITOR_YAML;
    sim.applyEffects[file] = { serviceMonitor: { name, selector: pick(["lager", "kasse", "funkdienst", "lotsen"]), port: "metrics", interval: "30s" } };
    return { text: "Ein <b>ServiceMonitor</b> ist ein ganz normales Manifest: wende <code>" + file + "</code> deklarativ an, damit Prometheus den Service scrapt.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+drill-servicemonitor\.yaml$/], solution: "kubectl apply --filename " + file, hint: "kubectl apply --filename &lt;datei&gt;", why: "Ein ServiceMonitor ist der deklarative Scrape-Auftrag für Prometheus – mit dem vertrauten kubectl apply --filename &lt;datei&gt; angewandt; selector wählt den Service, endpoints legen Port und Intervall fest." };
  },
  "obs-sm-get": sim => {
    if (sim.serviceMonitors.length === 0) {
      const file = "ensure-sm.yaml";
      sim.files[file] = SERVICEMONITOR_YAML;
      sim.applyEffects[file] = { serviceMonitor: { name: "lager-monitor", selector: "lager" } };
      sim.exec("kubectl apply -f " + file);
    }
    return { text: "Zeig alle <b>ServiceMonitors</b> – welche Services grast Prometheus ab?", accept: [/^kubectl\s+get\s+(servicemonitors|servicemonitor|smon)$/], solution: "kubectl get servicemonitors", hint: "Kurzform smon geht auch.", why: "kubectl get servicemonitors (Kurzform smon) listet die Scrape-Aufträge – welchen Service Prometheus mit welchem Intervall abgrast." };
  },
  "obs-logs-previous": sim => {
    let name = pick(["bakenbote", "signalgeber", "funkfeuer", "nebelhorn"]);
    while (sim.deployments.some(d => d.name === name)) name = name + rnd(2, 99);
    sim.mergeScenario({ deployments: [{ name, image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "config" } }] });
    const dep = sim.deployments.find(d => d.name === name)!;
    const pod = dep.pods[0].name;
    return { text: "Der Dienst <code>" + name + "</code> ist im <b>CrashLoop</b>. Lies den Absturz-Log des Vorgängers: <code>kubectl logs --previous &lt;pod&gt;</code>.", accept: [new RegExp("^kubectl\\s+logs\\s+(?:--previous|-p)\\s+" + pod.replace(/[-]/g, "\\-") + "$"), new RegExp("^kubectl\\s+logs\\s+" + pod.replace(/[-]/g, "\\-") + "\\s+(?:--previous|-p)$")], solution: "kubectl logs --previous " + pod, hint: "kubectl logs --previous &lt;pod&gt; – oder -p als Kurzform.", why: "--previous (Kurzform -p) zeigt die Logs des zuletzt abgestürzten Containers – genau das, was er kurz vor dem Crash ausgegeben hat. Ohne das Flag siehst du nur den frisch gestarteten (oft noch leeren) Container." };
  },
  "obs-alerts": sim => {
    // Für einen sichtbaren Alert sorgen: ein CPU-hungriger Dienst lässt HighPodCPU feuern.
    if (!sim.alerts().some(a => a.state === "firing")) {
      let name = pick(["rechenknecht", "mahlwerk", "dampfwinde", "kesseltreiber"]);
      while (sim.deployments.some(d => d.name === name)) name = name + rnd(2, 99);
      sim.mergeScenario({ deployments: [{ name, image: "python", replicas: 1, cpuHeavy: true }] });
    }
    return { text: "Was brennt gerade? Zeig alle aktiven <b>Alerts</b> mit ihrem Status (firing/resolved).", accept: [/^kubectl\s+get\s+alerts$/], solution: "kubectl get alerts", hint: "kubectl get alerts", why: "kubectl get alerts zeigt, welche Alert-Regeln gerade feuern (firing) oder schon wieder gelöst sind (resolved) – der schnelle Blick, ob der Cluster ruft." };
  },
  "obs-pr-apply": sim => {
    let name = pick(["hafen-alarme", "klippen-regeln", "sturm-warnung", "wacht-regeln"]);
    while (sim.prometheusRules.some(r => r.name === name)) name = "alarme-" + rnd(100, 9999);
    const file = "drill-prometheusrule.yaml";
    sim.files[file] = PROMETHEUSRULE_YAML;
    sim.applyEffects[file] = { prometheusRule: { name, alert: "HighPodCPU", expr: "rate(container_cpu_usage_seconds_total[5m]) > 0.5", forDuration: "5m", severity: "warning" } };
    return { text: "Eine <b>PrometheusRule</b> ist ein ganz normales Manifest: wende <code>" + file + "</code> an, damit Prometheus die Alert-Regel prüft.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+drill-prometheusrule\.yaml$/], solution: "kubectl apply --filename " + file, hint: "kubectl apply --filename &lt;datei&gt;", why: "Eine PrometheusRule deklariert eine Alert-Regel (expr als Bedingung, for als Wartezeit) – mit dem vertrauten kubectl apply --filename &lt;datei&gt; bringt Prometheus sie in Kraft." };
  },
  // Wachturm-Quartier (#136, Phase 6): RBAC / ServiceAccounts / Pod-Security – übt das bei
  // Vidar Gelernte: Ausweis (SA) ausstellen, Rechte schreiben (Role/RoleBinding,
  // ClusterRole/ClusterRoleBinding), Rechte prüfen (auth can-i) und Pods härten.
  // NPC: vidar. Alle Drills sind bewusst admission-neutral: keiner legt einen ROHEN
  // (ungehärteten) Pod an, sodass die enforce-Übung keine spätere create-Übung blockiert.
  "rbac-sa-create": sim => {
    let name = pick(SA_NAMES);
    while (sim.serviceAccounts.some(s => s.name === name)) name = pick(SA_NAMES) + rnd(2, 99);
    return { text: "Stell einen eigenen Dienst-Ausweis aus: einen <b>ServiceAccount</b> namens <code>" + name + "</code>.", accept: [new RegExp("^kubectl\\s+create\\s+(serviceaccount|sa)\\s+" + name + "$")], solution: "kubectl create serviceaccount " + name, hint: "Muster: kubectl create serviceaccount &lt;name&gt;", why: "Ein ServiceAccount ist die Identität, unter der ein Pod ans Cluster-API klopft – statt der allmächtigen default-SA bekommt jeder Dienst seinen eigenen, knappen Ausweis (Least Privilege). Muster: kubectl create serviceaccount &lt;name&gt;." };
  },
  "rbac-sa-get": () => ({ text: "Kontrolliere, welche <b>ServiceAccounts</b> (Ausweise) im Namespace ausliegen.", accept: [/^kubectl\s+get\s+(serviceaccounts|serviceaccount|sa)$/], solution: "kubectl get serviceaccounts", hint: "kubectl get serviceaccounts (Kurzform sa geht auch).", why: "Gleiches get-Muster wie sonst: kubectl get serviceaccounts listet die Ausweise des Namespaces – die default-SA ist immer dabei, eigene kommen dazu." }),
  "rbac-can-i": _sim => {
    const [verb, res] = pick(CANI_PAIRS);
    return { text: "Frag das Tor – ohne zu raten: Darf der ServiceAccount <code>wachdienst</code> <b>" + verb + "</b> auf <b>" + res + "</b>? Nutz <code>--as</code>.", accept: [new RegExp("^kubectl\\s+auth\\s+can-i\\s+" + verb + "\\s+" + res + "\\s+--as=system:serviceaccount:default:wachdienst$")], solution: "kubectl auth can-i " + verb + " " + res + " --as=system:serviceaccount:default:wachdienst", hint: "Muster: kubectl auth can-i &lt;verb&gt; &lt;ressource&gt; --as=system:serviceaccount:default:&lt;sa&gt;", why: "auth can-i beantwortet eine Rechte-Frage verbindlich mit yes/no, statt sie zu erraten; --as stellt die Frage aus Sicht eines anderen Subjekts (hier der SA wachdienst, geschrieben als system:serviceaccount:&lt;ns&gt;:&lt;name&gt;). Muster: kubectl auth can-i &lt;verb&gt; &lt;ressource&gt; --as=&lt;subjekt&gt;." };
  },
  "rbac-apply-role": sim => {
    let name = pick(ROLE_NAMES);
    while (sim.roles.some(r => !r.cluster && r.name === name)) name = pick(ROLE_NAMES) + rnd(2, 99);
    const file = "role.yaml";
    sim.files[file] = ROLE_YAML;
    sim.applyEffects[file] = { role: { name, rules: [{ verbs: ["get", "list", "watch"], resources: ["pods"] }] } };
    return { text: "Leg die <b>Schlüsselliste</b> an: wende die Role-Karte <code>role.yaml</code> deklarativ an.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+role\.yaml$/], solution: "kubectl apply --filename role.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Eine Role bündelt erlaubte Verben × Ressourcen in EINEM Namespace – allein bewirkt sie nichts, sie ist die Liste, noch nicht der Schlüssel in einer Hand. Angewandt wird sie wie jedes Manifest: kubectl apply --filename &lt;datei&gt;." };
  },
  "rbac-apply-rolebinding": sim => {
    let name = pick(ROLE_NAMES) + "-binden";
    while (sim.roleBindings.some(b => !b.cluster && b.name === name)) name = "binden-" + rnd(2, 999);
    const file = "rolebinding.yaml";
    sim.files[file] = ROLEBINDING_YAML;
    sim.applyEffects[file] = { roleBinding: { name, roleRef: { kind: "Role", name: "pod-leser" }, subjects: [{ kind: "ServiceAccount", name: "wachdienst", namespace: "default" }] } };
    return { text: "Übergib den <b>Schlüssel</b>: wende die RoleBinding-Karte <code>rolebinding.yaml</code> an – erst sie macht aus der Role ein echtes Recht.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+rolebinding\.yaml$/], solution: "kubectl apply --filename rolebinding.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Das RoleBinding ist die Übergabe: es klebt die Role (das WAS) an ein Subjekt (das WER, z.B. einen ServiceAccount). Ohne Binding liegt die Role nur folgenlos herum. Angewandt: kubectl apply --filename &lt;datei&gt;." };
  },
  "rbac-describe-role": sim => {
    const name = pick(ROLE_NAMES);
    ensureRole(sim, name, false);
    return { text: "Sieh die Schlüsselliste im Klartext: beschreibe die Role <code>" + name + "</code> (Resources & Verbs).", accept: [new RegExp("^kubectl\\s+describe\\s+role\\s+" + name + "$")], solution: "kubectl describe role " + name, hint: "Muster: kubectl describe role &lt;name&gt;", why: "describe role zeigt die PolicyRule im Klartext – welche Resources mit welchen Verbs erlaubt sind. So prüfst du, ob eine Role wirklich nur so viel kann wie nötig (Least Privilege). Muster: kubectl describe role &lt;name&gt;." };
  },
  "rbac-apply-clusterrole": sim => {
    let name = pick(CLUSTERROLE_NAMES);
    while (sim.roles.some(r => r.cluster && r.name === name)) name = pick(CLUSTERROLE_NAMES) + rnd(2, 99);
    const file = "clusterrole.yaml";
    sim.files[file] = CLUSTERROLE_YAML;
    sim.applyEffects[file] = { role: { name, cluster: true, rules: [{ verbs: ["get", "list", "watch"], resources: ["nodes"] }] } };
    return { text: "Leg eine <b>cluster-weite</b> Schlüsselliste an: wende <code>clusterrole.yaml</code> an (für nicht-namespaced Dinge wie Nodes).", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+clusterrole\.yaml$/], solution: "kubectl apply --filename clusterrole.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Eine ClusterRole ist wie eine Role, aber OHNE Namespace-Grenze – nur sie kann cluster-weite Ressourcen wie nodes abdecken. Angewandt wie jedes Manifest: kubectl apply --filename &lt;datei&gt;." };
  },
  "rbac-apply-clusterrolebinding": sim => {
    let name = pick(CLUSTERROLE_NAMES) + "-binden";
    while (sim.roleBindings.some(b => b.cluster && b.name === name)) name = "rundblick-" + rnd(2, 999);
    const file = "clusterrolebinding.yaml";
    sim.files[file] = CLUSTERROLEBINDING_YAML;
    sim.applyEffects[file] = { roleBinding: { name, cluster: true, roleRef: { kind: "ClusterRole", name: "knoten-spaeher" }, subjects: [{ kind: "ServiceAccount", name: "wachdienst", namespace: "default" }] } };
    return { text: "Übergib den <b>Rundblick</b> cluster-weit: wende <code>clusterrolebinding.yaml</code> an.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+clusterrolebinding\.yaml$/], solution: "kubectl apply --filename clusterrolebinding.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Ein ClusterRoleBinding übergibt eine ClusterRole cluster-weit an ein Subjekt – es kann nur eine ClusterRole binden (keine Role). Erst danach gilt das Recht über alle Namespaces. Angewandt: kubectl apply --filename &lt;datei&gt;." };
  },
  "pod-security-enforce": sim => {
    sim.podSecurity = "privileged"; // jede Übung startet sauber, egal was vorher lief
    return { text: "Schalt das Tor scharf: setz im Namespace <code>default</code> die strengste Pod-Security-Stufe (<b>restricted</b>) durch – per Namespace-Label.", accept: [/^kubectl\s+label\s+(?:namespace|ns)\s+default\s+pod-security\.kubernetes\.io\/enforce=restricted$/], solution: "kubectl label namespace default pod-security.kubernetes.io/enforce=restricted", hint: "kubectl label namespace default pod-security.kubernetes.io/enforce=restricted", why: "Die Pod-Security-Stufe setzt du als Namespace-Label pod-security.kubernetes.io/enforce=&lt;stufe&gt;. restricted verlangt von jedem NEU ausgerollten Pod: non-root und keine Rechte-Eskalation – ein ungehärteter wird am Tor abgewiesen. So schrumpft der Schaden, falls doch mal einer reinkommt." };
  },
  "pod-security-harden": sim => {
    let name = pick(["spaehposten", "wachposten", "torwaechter", "zinnenwache"]);
    while (sim.deployments.some(d => d.name === name)) name = name + rnd(2, 99);
    const file = "spaehposten.yaml";
    sim.files[file] = POD_SECURITY_YAML;
    sim.applyEffects[file] = { deployment: { name, image: "nginx", replicas: 1, securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true } } };
    return { text: "Roll einen <b>gehärteten</b> Posten aus: wende <code>spaehposten.yaml</code> an – mit securityContext kommt er auch unter <code>restricted</code> durchs Tor.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+spaehposten\.yaml$/], solution: "kubectl apply --filename spaehposten.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Der securityContext im Manifest (runAsNonRoot, allowPrivilegeEscalation: false, readOnlyRootFilesystem) härtet den Pod – genau das verlangt die restricted-Stufe, darum wird er zugelassen, während ein roher Pod abgewiesen würde. Angewandt: kubectl apply --filename &lt;datei&gt;." };
  },
};

/* Übungs-Pools pro NPC: freigeschaltet nach bestimmter Quest */
export const PRACTICE: Record<string, { drill: string; after: string }[]> = {
  bo:   [{ drill: "docker-pull", after: "docker-first-container" }, { drill: "docker-run", after: "docker-first-container" }, { drill: "docker-ps", after: "docker-list-containers" }, { drill: "docker-stop", after: "docker-list-containers" }, { drill: "docker-ps-a", after: "docker-list-containers" }, { drill: "docker-run-named", after: "docker-run-options" }, { drill: "docker-build", after: "docker-build-image" }, { drill: "docker-tag", after: "docker-build-image" }],
  ole:  [{ drill: "k-get-nodes", after: "k8s-first-deployment" }, { drill: "k-get-pods", after: "k8s-first-deployment" }, { drill: "k-describe", after: "k8s-inspect-pods" }, { drill: "k-get-pods-ns", after: "k8s-inspect-pods" }, { drill: "k-create", after: "k8s-service" }, { drill: "k-scale", after: "k8s-service" }, { drill: "k-delete-pod", after: "k8s-self-healing" }, { drill: "k-expose", after: "k8s-self-healing" }, { drill: "k-get-svc", after: "k8s-self-healing" }, { drill: "k-secret", after: "kraken-boss" }, { drill: "k-get-secrets", after: "kraken-boss" }],
  ada:  [{ drill: "k-apply", after: "k8s-apply-manifests" }, { drill: "git-status", after: "git-version-control" }, { drill: "git-add", after: "git-version-control" }, { drill: "git-commit", after: "git-version-control" }, { drill: "git-branch", after: "git-feature-branch" }, { drill: "git-checkout", after: "git-feature-branch" }, { drill: "git-add-all", after: "git-pipeline" }, { drill: "ci-status", after: "git-pipeline" }, { drill: "git-pull", after: "git-merge-branches" }, { drill: "git-resolve", after: "git-merge-branches" }, { drill: "k-secret-tls", after: "secrets-encrypted" }, { drill: "k-get-ingress", after: "secrets-encrypted" }],
  runa: [{ drill: "helm-install", after: "helm-release-install" }, { drill: "helm-list", after: "helm-release-install" }, { drill: "helm-upgrade", after: "helm-upgrade-rollback" }, { drill: "helm-rollback", after: "helm-upgrade-rollback" }, { drill: "helm-create", after: "helm-umbrella-chart" }, { drill: "helm-lint", after: "helm-umbrella-chart" }, { drill: "helm-package", after: "helm-umbrella-chart" }, { drill: "helm-install-local", after: "helm-umbrella-chart" }, { drill: "helm-upgrade-values", after: "helm-umbrella-chart" }, { drill: "helm-dep-update", after: "helm-umbrella-chart" }],
  theo: [{ drill: "tf-plan", after: "terraform-intro" }, { drill: "tf-state", after: "terraform-state-destroy" }],
  juno: [{ drill: "k-logs", after: "k8s-debug-crashloop" }, { drill: "k-describe", after: "k8s-debug-imagepull" }, { drill: "k-rollout", after: "k8s-debug-crashloop" }, { drill: "k-apply-netpol", after: "network-policy" }, { drill: "k-get-netpol", after: "network-policy" }, { drill: "k-describe-netpol", after: "network-policy" }, { drill: "k-delete-netpol", after: "network-policy" }, { drill: "k-set-resources", after: "k8s-resource-limits" }],
  argo: [{ drill: "argo-apply", after: "gitops-self-sync" }, { drill: "argo-app-list", after: "gitops-self-sync" }, { drill: "argo-app-get", after: "gitops-self-sync" }, { drill: "argo-app-sync", after: "gitops-self-sync" }],
  lumi: [{ drill: "obs-top-pods", after: "observability-metrics" }, { drill: "obs-top-nodes", after: "observability-metrics" }, { drill: "obs-sm-apply", after: "observability-metrics" }, { drill: "obs-sm-get", after: "observability-metrics" }, { drill: "k-logs", after: "observability-logs" }, { drill: "obs-logs-previous", after: "observability-logs" }, { drill: "obs-alerts", after: "observability-alerts" }, { drill: "obs-pr-apply", after: "observability-alerts" }],
  vidar: [{ drill: "rbac-sa-create", after: "k8s-serviceaccount" }, { drill: "rbac-sa-get", after: "k8s-serviceaccount" }, { drill: "rbac-can-i", after: "k8s-rbac-role" }, { drill: "rbac-apply-role", after: "k8s-rbac-role" }, { drill: "rbac-apply-rolebinding", after: "k8s-rbac-role" }, { drill: "rbac-describe-role", after: "k8s-rbac-role" }, { drill: "rbac-apply-clusterrole", after: "k8s-rbac-clusterrole" }, { drill: "rbac-apply-clusterrolebinding", after: "k8s-rbac-clusterrole" }, { drill: "pod-security-enforce", after: "k8s-pod-security" }, { drill: "pod-security-harden", after: "k8s-pod-security" }],
};
