import type { Sim } from "../../sim";
import { pick, rnd, NAMES, ensureDeployment, ensureBarePodAdmission } from "./shared";
import type { DrillTask } from "./shared";

export const KUBECTL_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "k-get-nodes": () => ({ text: "Zeig die Nodes des Clusters.", accept: [/^kubectl\s+get\s+(nodes|node|no)$/], solution: "kubectl get nodes", hint: "kubectl get &lt;ressourcentyp&gt;", why: "get listet Ressourcen eines Typs – Muster: kubectl get &lt;ressourcentyp&gt;, hier die Nodes (Server) des Clusters." }),
  "k-get-pods": () => ({ text: "Zeig alle Pods.", accept: [/^kubectl\s+get\s+(pods|pod|po)$/], solution: "kubectl get pods", hint: "kubectl get &lt;ressourcentyp&gt;", why: "Gleiches Muster wie bei nodes: kubectl get pods listet alle Pods." }),
  "k-get-svc": () => ({ text: "Zeig alle Services.", accept: [/^kubectl\s+get\s+(services|service|svc)$/], solution: "kubectl get services", hint: "Schreib es aus: kubectl get services (die Kurzform svc verdienst du dir durch Nutzung).", why: "kubectl get services listet die Services – die festen Adressen vor den Pods. Die Kurzform svc verdienst du dir, wenn du die Langform oft genug tippst." }),
  "k-describe": sim => {
    const d = ensureDeployment(sim);
    const pod = d.pods[0].name;
    return { text: "Beschreibe den Pod <code>" + pod + "</code> im Detail.", accept: [new RegExp("^kubectl\\s+describe\\s+pods?\\s+" + pod.replace(/[-]/g, "\\-") + "$")], solution: "kubectl describe pod " + pod, hint: "kubectl describe pod &lt;name&gt; – den Namen kannst du abtippen.", why: "describe zeigt die Detail-Akte eines Objekts inkl. Events – Muster: kubectl describe pod &lt;name&gt;." };
  },
  "k-get-pods-ns": () => ({ text: "Schau ins Maschinenherz: zeig die Pods im Namespace <code>kube-system</code>.", accept: [/^kubectl\s+get\s+(pods|pod|po)\s+(-n|--namespace)[=\s]?kube-system$/], solution: "kubectl get pods --namespace kube-system", hint: "kubectl get pods --namespace kube-system (die Kurzform -n verdienst du dir durch Nutzung).", why: "Ohne Namespace siehst du nur den aktuellen (default); --namespace &lt;name&gt; wählt einen anderen, z.B. kube-system, das Maschinenherz von Kubernetes. Die Kurzform -n verdienst du dir, wenn du die Langform oft genug tippst." }),
  "k-create": sim => {
    ensureBarePodAdmission(sim);
    let name = pick(NAMES);
    while (sim.deployments.some(d => d.name === name)) name = pick(NAMES) + rnd(2, 9);
    const img = pick(["redis", "httpd", "busybox", "postgres", "rabbitmq"]);
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
};
