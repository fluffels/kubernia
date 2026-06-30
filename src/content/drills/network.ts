import type { Sim } from "../../sim";
import { pick, rnd, NETPOL_NAMES, NETPOL_APPS, DNS_SVC_NAMES, DNS_EXTERNAL_PAIRS, ensureNetworkPolicy, NETPOL_YAML, EXTERNALNAME_YAML } from "./shared";
import type { DrillTask } from "./shared";

export const NETWORK_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
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
    return { text: "Beschreibe die Hafenmauer <code>" + np.name + "</code> – wer darf rein?", accept: [new RegExp("^kubectl\\s+describe\\s+(networkpolicy|networkpolicies|netpol|netpols)\\s+" + np.name.replace(/[-]/g, "\\-") + "$")], solution: "kubectl describe networkpolicy " + np.name, hint: "kubectl describe networkpolicy &lt;name&gt; (die Kurzform netpol verdienst du dir durch Nutzung)", why: "describe zeigt die Details der Policy: wen sie schützt (podSelector) und wer durchdarf (from) – Muster: kubectl describe networkpolicy &lt;name&gt;." };
  },
  "k-delete-netpol": sim => {
    const np = ensureNetworkPolicy(sim);
    return { text: "Reiß die Hafenmauer <code>" + np.name + "</code> wieder ein.", accept: [new RegExp("^kubectl\\s+delete\\s+(networkpolicy|networkpolicies|netpol|netpols)\\s+" + np.name.replace(/[-]/g, "\\-") + "$")], solution: "kubectl delete networkpolicy " + np.name, hint: "kubectl delete networkpolicy &lt;name&gt; (die Kurzform netpol verdienst du dir durch Nutzung)", why: "delete entfernt die NetworkPolicy wieder – danach ist das Netzwerk an dieser Stelle wieder offen. Muster: kubectl delete networkpolicy &lt;name&gt;." };
  },
  "k-nslookup": sim => {
    const name = pick(DNS_SVC_NAMES);
    if (!sim.services.some(s => s.name === name)) {
      sim.mergeScenario({ services: [{ name, type: "ClusterIP", clusterIP: "10.96." + rnd(0, 250) + "." + rnd(1, 250), port: pick([80, 8080, 5432, 6379]) }] });
    }
    return { text: "Frag das Adressbuch (CoreDNS) nach der Adresse des Service <code>" + name + "</code>.", accept: [new RegExp("^nslookup\\s+" + name + "(\\.default(\\.svc\\.cluster\\.local)?)?$")], solution: "nslookup " + name, hint: "Muster: nslookup &lt;service&gt; (oder voll &lt;service&gt;.default.svc.cluster.local)", why: "nslookup fragt CoreDNS nach der Adresse hinter einem Namen. Ein Service ist über den kurzen Namen, &lt;service&gt;.&lt;namespace&gt; oder den vollen FQDN &lt;service&gt;.&lt;namespace&gt;.svc.cluster.local erreichbar – CoreDNS löst alle drei zur stabilen ClusterIP auf. So reden Pods über Namen, nicht über wechselnde Pod-IPs." };
  },
  "k-nslookup-external": sim => {
    const [name, ext] = pick(DNS_EXTERNAL_PAIRS);
    if (!sim.services.some(s => s.name === name)) {
      const file = "drill-externalname.yaml";
      sim.files[file] = EXTERNALNAME_YAML;
      sim.applyEffects[file] = { service: { name, externalName: ext, port: "" } };
      sim.exec("kubectl apply -f " + file);
    }
    return { text: "Löse den <b>ExternalName</b>-Service <code>" + name + "</code> auf – wohin zeigt sein CNAME?", accept: [new RegExp("^nslookup\\s+" + name + "(\\.default(\\.svc\\.cluster\\.local)?)?$")], solution: "nslookup " + name, hint: "Muster: nslookup &lt;service&gt; – hier " + name + ".", why: "Ein ExternalName-Service hat keine eigene ClusterIP – nslookup zeigt stattdessen einen CNAME auf den externen DNS-Namen, auf den er verweist. So sprechen Pods einen Dienst außerhalb des Clusters über den gewohnten Service-Namen an; ändert sich die externe Adresse, fasst man nur den Service an." };
  },
};
