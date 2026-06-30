import type { Sim } from "../../sim";
import { pick, rnd, ensureDeployment, SERVICEMONITOR_YAML, PROMETHEUSRULE_YAML } from "./shared";
import type { DrillTask } from "./shared";

export const OBSERVABILITY_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "obs-top-pods": sim => {
    ensureDeployment(sim);
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
};
