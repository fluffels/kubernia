import type { Sim } from "../../sim";
import { pick, rnd, NAMES, ensureChart } from "./shared";
import type { DrillTask } from "./shared";

export const HELM_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
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
    let name = pick(["funkdienst", "hafenkarte", "lotsen-app", "moewenruf", "kombuese-api", "ankerwerk"]);
    while (sim.charts.some(c => c.name === name)) name = name + rnd(2, 99);
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
  "helm-dep-update": sim => {
    const name = ensureChart(sim);
    return { text: "Hol die Subcharts von <code>" + name + "</code> – schreibt <code>Chart.lock</code> fest.", accept: [new RegExp("^helm\\s+(dependency|dep)\\s+(update|up)\\s+(\\.\\/)?" + name + "$")], solution: "helm dependency update " + name, hint: "Muster: helm dependency update &lt;chart&gt; (die Kurzform dep verdienst du dir durch Nutzung)", why: "dependency update zieht die in Chart.yaml deklarierten Subcharts und zurrt sie in Chart.lock fest (reproduzierbar) – Muster: helm dependency update &lt;chart&gt;. Die Kurzform dep verdienst du dir durch Nutzung." };
  },
  "helm-template": sim => {
    const name = ensureChart(sim);
    return { text: "Rendere dein Chart <code>" + name + "</code> lokal zu Manifesten – ohne zu installieren.", accept: [new RegExp("^helm\\s+template\\s+(\\.\\/)?" + name + "$")], solution: "helm template " + name, hint: "Muster: helm template &lt;chart&gt;", why: "template rendert die Vorlagen (templates/) mit den Werten (values.yaml) zu fertigen Manifesten und zeigt sie nur an – ganz ohne Cluster-Zugriff. So prüfst du, was install ausrollen WÜRDE. Muster: helm template &lt;chart&gt;." };
  },
};
