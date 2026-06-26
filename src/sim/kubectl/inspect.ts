/* ===== KubeQuest – kubectl Inspect (sim/kubectl/inspect.ts) =====
 * Die lesenden kubectl-Befehle (kein Cluster-Zustand wird verändert): `get` (alle
 * Ressourcen-Listen), `describe` (Detail zu Pod/Ingress/NetworkPolicy/Role/SA),
 * `top` (Pod-/Node-Metriken, #109) und `logs` (#…). Die eigentliche
 * Observability-Mechanik (podMetrics/nodeMetrics/alerts) liegt bewusst in sim.ts –
 * `top`/`get` lesen sie nur über das Host-Interface.
 *
 * Phaser-frei (pure Domäne): Tabellen-Ausgabe aus ../util, Zustand über das
 * KubectlHost-Interface (./host). Aufgerufen aus dem kubectl-Dispatch (../kubectl.ts).
 */
import { table } from "../util";
import type { KubectlHost } from "./host";

// Alle Ingresses teilen sich die Adresse des einen Ingress-Controllers (wie im echten
// Cluster). Nur die kubectl-Ausgaben (get/describe ingress) brauchen sie, darum hier.
const INGRESS_ADDRESS = "203.0.113.10";


export function kubectlGet(host: KubectlHost, t: string[]) {
  const what = (t[2] || "").toLowerCase();
  const ns = host._flagValue(t, "-n") || host._flagValue(t, "--namespace");
  const allNs = t.includes("-A") || t.includes("--all-namespaces");
  host._recheckReadiness();

  if (["pods", "pod", "po"].includes(what)) {
    if (ns === "kube-system" || allNs) {
      const sysPods = [
        ["coredns-7db6d8ff4d-x2x9p", "1/1", "Running", "0", "3d"],
        ["etcd-ahoi-control", "1/1", "Running", "0", "3d"],
        ["kube-apiserver-ahoi-control", "1/1", "Running", "0", "3d"],
        ["kube-scheduler-ahoi-control", "1/1", "Running", "0", "3d"],
      ];
      const rows = allNs
        ? sysPods.map(r => ["kube-system"].concat(r)).concat(host._allPods().map(p => ["default", p.name, "1/1", "Running", String(p.restarts), host._age(p.created)]))
        : sysPods;
      return table(allNs ? ["NAMESPACE", "NAME", "READY", "STATUS", "RESTARTS", "AGE"] : ["NAME", "READY", "STATUS", "RESTARTS", "AGE"], rows);
    }
    host._reschedulePending();
    const rows: (string | number)[][] = [];
    for (const d of host.deployments) {
      const st = host._podStatus(d);
      for (const p of d.pods) rows.push([p.name, st.ready, st.status, String(st.restarts || p.restarts), host._age(p.created)]);
    }
    // StatefulSet-Pods (#122): stabile Namen <sts>-0, immer Running/ready.
    for (const s of host.statefulSets) {
      for (const p of s.pods) rows.push([p.name, "1/1", "Running", String(p.restarts), host._age(p.created)]);
    }
    if (rows.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "READY", "STATUS", "RESTARTS", "AGE"], rows);
  }

  if (["deployments", "deployment", "deploy"].includes(what)) {
    if (host.deployments.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"],
      host.deployments.map(d => {
        const ready = host._podReady(d) ? d.pods.length : 0;
        return [d.name, ready + "/" + d.replicas, String(d.replicas), String(ready), host._age(d.created)];
      }));
  }

  if (["services", "service", "svc"].includes(what)) {
    const rows = [["kubernetes", "ClusterIP", "10.96.0.1", "<none>", "443/TCP", "3d"]];
    for (const s of host.services) {
      // ExternalName-Service (#337): keine ClusterIP, dafür der externe DNS-Name in
      // EXTERNAL-IP – genau so zeigt echtes kubectl einen ExternalName-Service.
      const isExt = s.type === "ExternalName";
      rows.push([
        s.name, s.type,
        isExt ? "<none>" : s.clusterIP,
        isExt ? (s.externalName || "<none>") : "<none>",
        isExt ? "<none>" : (s.port + "/TCP"),
        host._age(s.created || 0),
      ]);
    }
    return table(["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"], rows);
  }

  if (["endpoints", "endpoint", "ep"].includes(what)) {
    // Endpoints = die IPs der BEREITEN Pods hinter einem Service. Genau hier
    // wird die Readiness-Probe sichtbar: ein nicht-bereiter Pod fehlt in der
    // Liste, der Service leitet keinen Verkehr an ihn weiter.
    const wantName = t[3] && !t[3].startsWith("-") ? t[3] : null;
    const svcs = wantName ? host.services.filter(s => s.name === wantName) : host.services.slice();
    if (wantName && svcs.length === 0) {
      return host._err('Error from server (NotFound): endpoints "' + wantName + '" not found', "Service-Namen siehst du mit 'kubectl get services'.");
    }
    if (svcs.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "ENDPOINTS", "AGE"], svcs.map(s => {
      const dep = host.deployments.find(d => d.name === s.name);
      // Endpoints zeigen den Ziel-Port (targetPort), an den weitergeleitet wird – fehlt er,
      // gilt der Service-Port (#164). So bleibt der Port-Abgleich auch hier sichtbar.
      const epPort = s.targetPort !== undefined ? s.targetPort : s.port;
      const ips = dep && host._podReady(dep)
        ? dep.pods.map((_, i) => "10.244.1." + (20 + i) + ":" + epPort)
        : [];
      return [s.name, ips.length ? ips.join(",") : "<none>", host._age(s.created || 0)];
    }));
  }

  if (["nodes", "node", "no"].includes(what)) {
    // Echtes `kubectl get nodes` zeigt unter Disk-Druck weiter STATUS "Ready" (DiskPressure ist eine
    // eigene Condition, sichtbar erst per describe). Im Lernspiel hängen wir sie sichtbar an die
    // STATUS-Spalte, damit der Druck im Überblick auffällt – Detail dann in `describe node` (#240).
    return table(["NAME", "STATUS", "ROLES", "AGE", "VERSION"],
      host.nodes.map(n => [n.name, n.diskPressure ? n.status + ",DiskPressure" : n.status, n.roles, "3d", n.version]));
  }

  if (["secrets", "secret"].includes(what)) {
    if (host.secrets.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "TYPE", "DATA", "AGE"],
      host.secrets.map(s => [s.name, s.type || "Opaque", String(s.keys.length), host._age(s.created || 0)]));
  }

  if (["configmaps", "configmap", "cm"].includes(what)) {
    if (host.configMaps.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "DATA", "AGE"],
      host.configMaps.map(c => [c.name, String(c.keys.length), host._age(c.created || 0)]));
  }

  if (["ingress", "ingresses", "ing"].includes(what)) {
    if (host.ingresses.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "CLASS", "HOSTS", "ADDRESS", "PORTS", "AGE"],
      host.ingresses.map(i => [i.name, i.className, i.host, INGRESS_ADDRESS, i.tls ? "80, 443" : "80", host._age(i.created || 0)]));
  }

  if (["networkpolicies", "networkpolicy", "netpol", "netpols"].includes(what)) {
    if (host.networkPolicies.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "POD-SELECTOR", "AGE"],
      host.networkPolicies.map(n => [n.name, n.podSelector ? "app=" + n.podSelector : "<none>", host._age(n.created || 0)]));
  }

  if (["servicemonitors", "servicemonitor", "smon"].includes(what)) {
    if (host.serviceMonitors.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "SELECTOR", "ENDPOINT", "AGE"],
      host.serviceMonitors.map(s => [s.name, "app=" + s.selector, s.port + " @ " + s.interval, host._age(s.created || 0)]));
  }

  if (["prometheusrules", "prometheusrule", "promrule", "promrules"].includes(what)) {
    if (host.prometheusRules.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "ALERT", "SEVERITY", "AGE"],
      host.prometheusRules.map(r => [r.name, r.alert, r.severity, host._age(r.created || 0)]));
  }

  if (["grafanadatasources", "grafanadatasource", "grafanadatasrc"].includes(what)) {
    if (host.grafanaDatasources.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "TYPE", "AGE"],
      host.grafanaDatasources.map(d => [d.name, d.dsType, host._age(d.created || 0)]));
  }

  if (["grafanadashboards", "grafanadashboard", "grafanadash"].includes(what)) {
    if (host.grafanaDashboards.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "TITLE", "PANELS", "AGE"],
      host.grafanaDashboards.map(d => [d.name, d.title, String(d.panels), host._age(d.created || 0)]));
  }

  if (["statefulsets", "statefulset", "sts"].includes(what)) {
    if (host.statefulSets.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "READY", "AGE"],
      host.statefulSets.map(s => [s.name, s.pods.length + "/" + s.replicas, host._age(s.created)]));
  }

  if (["persistentvolumeclaims", "persistentvolumeclaim", "pvc"].includes(what)) {
    if (host.pvcs.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "STATUS", "VOLUME", "CAPACITY", "ACCESS MODES", "STORAGECLASS", "AGE"],
      host.pvcs.map(p => [p.name, p.status, p.volume || "", p.status === "Bound" ? p.capacity : "", p.accessModes, p.storageClass || "", host._age(p.created)]));
  }

  if (["persistentvolumes", "persistentvolume", "pv"].includes(what)) {
    if (host.pvs.length === 0) return "No resources found.";
    return table(["NAME", "CAPACITY", "ACCESS MODES", "RECLAIM POLICY", "STATUS", "CLAIM", "STORAGECLASS", "AGE"],
      host.pvs.map(p => [p.name, p.capacity, p.accessModes, p.reclaimPolicy, p.status, p.claim || "", p.storageClass || "", host._age(p.created)]));
  }

  if (["storageclasses", "storageclass", "sc"].includes(what)) {
    if (host.storageClasses.length === 0) return "No resources found.";
    return table(["NAME", "PROVISIONER", "RECLAIMPOLICY", "AGE"],
      host.storageClasses.map(s => [s.name + (s.isDefault ? " (default)" : ""), s.provisioner, s.reclaimPolicy, host._age(s.created)]));
  }

  if (["volumesnapshots", "volumesnapshot", "vs"].includes(what)) {
    if (host.volumeSnapshots.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "READYTOUSE", "SOURCEPVC", "RESTORESIZE", "AGE"],
      host.volumeSnapshots.map(v => [v.name, String(v.readyToUse), v.sourcePvc, v.restoreSize, host._age(v.created)]));
  }

  if (["serviceaccounts", "serviceaccount", "sa"].includes(what)) {
    return table(["NAME", "SECRETS", "AGE"],
      host.serviceAccounts.map(s => [s.name, "0", host._age(s.created)]));
  }

  if (["roles", "role"].includes(what)) {
    const rs = host.roles.filter(r => !r.cluster);
    if (rs.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "AGE"], rs.map(r => [r.name, host._age(r.created)]));
  }

  if (["clusterroles", "clusterrole"].includes(what)) {
    const rs = host.roles.filter(r => r.cluster);
    if (rs.length === 0) return "No resources found.";
    return table(["NAME", "AGE"], rs.map(r => [r.name, host._age(r.created)]));
  }

  if (["rolebindings", "rolebinding", "rb"].includes(what)) {
    const bs = host.roleBindings.filter(b => !b.cluster);
    if (bs.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "ROLE", "AGE"], bs.map(b => [b.name, b.roleRef.kind + "/" + b.roleRef.name, host._age(b.created)]));
  }

  if (["clusterrolebindings", "clusterrolebinding", "crb"].includes(what)) {
    const bs = host.roleBindings.filter(b => b.cluster);
    if (bs.length === 0) return "No resources found.";
    return table(["NAME", "ROLE", "AGE"], bs.map(b => [b.name, b.roleRef.kind + "/" + b.roleRef.name, host._age(b.created)]));
  }

  if (["alerts", "alert"].includes(what)) {
    const active = host.alerts();
    if (active.length === 0) return "No alerts firing.";
    return table(["NAME", "SEVERITY", "STATE", "SUMMARY"],
      active.map(a => [a.name, a.severity, a.state, a.summary]));
  }

  if (!what) return host._err("kubectl get: Was möchtest du sehen?", "z.B. 'kubectl get pods' oder 'kubectl get nodes'");
  return host._err('error: the server doesn\'t have a resource type "' + what + '"', "Gemeint war vielleicht: pods, deployments, services, endpoints, ingress, networkpolicies, servicemonitors, prometheusrules, grafanadashboards, alerts, secrets, configmaps, serviceaccounts, roles, rolebindings, pvc, pv, storageclasses, volumesnapshots oder nodes?");
}


export function kubectlDescribe(host: KubectlHost, t: string[]) {
  const what = (t[2] || "").toLowerCase();
  const name = t[3];
  if (["node", "nodes", "no"].includes(what)) {
    if (!name) return host._err("kubectl describe node: Welcher Knoten?", "Die Namen siehst du mit 'kubectl get nodes'.");
    const node = host.nodes.find(n => n.name === name);
    if (!node) return host._err('Error from server (NotFound): nodes "' + name + '" not found', "Tipp: Namen aus 'kubectl get nodes' kopieren.");
    const lines = [
      "Name:               " + node.name,
      "Roles:              " + node.roles,
      "Conditions:",
      "  Type             Status",
      "  ----             ------",
      "  MemoryPressure   False",
      // DiskPressure ist die Lern-Pointe (#240): True = der kubelet evictet Pods, um Disk zu schaffen.
      "  DiskPressure     " + (node.diskPressure ? "True" : "False"),
      "  Ready            True",
    ];
    // Ephemeral-Storage-Bilanz nur zeigen, wenn der Knoten eine Kapazität hat (sonst „unbegrenzt").
    if (node.ephemeralCapacityMi !== undefined) {
      const used = host._nodeEphemeralUsed(node.name);
      lines.push(
        "Capacity:",
        "  ephemeral-storage:  " + node.ephemeralCapacityMi + "Mi",
        "Allocated resources:",
        "  Resource           Used",
        "  --------           ----",
        "  ephemeral-storage  " + used + "Mi" + (node.diskPressure ? "  (über der Schwelle – DiskPressure!)" : ""),
      );
    }
    // Evictete Pods dieses Knotens auflisten – so wird sichtbar, wen der Druck getroffen hat.
    const evicted = host.deployments.filter(d => d.evicted && host._nodeOf(d) === node.name);
    if (evicted.length) {
      lines.push("Evicted pods:");
      for (const d of evicted) for (const p of d.pods) lines.push("  " + p.name + "  (" + d.evicted!.reason + ")");
    }
    return lines.join("\n");
  }
  if (["ingress", "ingresses", "ing"].includes(what)) {
    if (!name) return host._err("kubectl describe ingress: Welches Hafentor?", "Die Namen siehst du mit 'kubectl get ingress'.");
    const ing = host.ingresses.find(i => i.name === name);
    if (!ing) return host._err('Error from server (NotFound): ingresses.networking.k8s.io "' + name + '" not found', "Tipp: Namen aus 'kubectl get ingress' kopieren.");
    const svcExists = host.services.some(s => s.name === ing.service);
    const secretExists = ing.tls ? host.secrets.some(s => s.name === ing.tls!.secretName) : true;
    return [
      "Name:             " + ing.name,
      "Namespace:        default",
      "Address:          " + INGRESS_ADDRESS,
      "Ingress Class:    " + ing.className,
      ...(ing.tls ? [
        "TLS:",
        "  " + ing.tls.secretName + " terminates " + ing.host +
          (secretExists ? "" : "  (⚠ Secret '" + ing.tls.secretName + "' gibt es nicht – HTTPS bleibt zu!)"),
      ] : []),
      "Rules:",
      "  Host        Path  Backends",
      "  ----        ----  --------",
      "  " + ing.host + "  " + ing.path + "   " + ing.service + ":" + ing.port +
        (svcExists ? "" : "  (⚠ Service '" + ing.service + "' gibt es nicht – das Tor lotst ins Leere!)"),
    ].join("\n");
  }
  if (["networkpolicy", "networkpolicies", "netpol", "netpols"].includes(what)) {
    if (!name) return host._err("kubectl describe networkpolicy: Welche Hafenmauer?", "Die Namen siehst du mit 'kubectl get networkpolicies'.");
    const np = host.networkPolicies.find(n => n.name === name);
    if (!np) return host._err('Error from server (NotFound): networkpolicies.networking.k8s.io "' + name + '" not found', "Tipp: Namen aus 'kubectl get networkpolicies' kopieren.");
    return [
      "Name:         " + np.name,
      "Namespace:    default",
      "PodSelector:  " + (np.podSelector ? "app=" + np.podSelector : "<none> (gilt für alle Pods im Namespace)"),
      "PolicyTypes:  Ingress",
      "Allowing ingress traffic:",
      np.allowFrom
        ? "  From: Pods mit Label app=" + np.allowFrom
        : "  <none> (default-deny: niemand darf rein, bis du eine Quelle erlaubst)",
    ].join("\n");
  }
  if (["role", "clusterrole"].includes(what)) {
    const cluster = what === "clusterrole";
    if (!name) return host._err("kubectl describe " + what + ": Welche Rolle?", "Die Namen siehst du mit 'kubectl get " + what + "s'.");
    const role = host.roles.find(r => r.name === name && r.cluster === cluster);
    if (!role) return host._err('Error from server (NotFound): ' + what + 's.rbac.authorization.k8s.io "' + name + '" not found', "Tipp: Namen aus 'kubectl get " + what + "s' kopieren.");
    const lines = [
      "Name:         " + role.name,
      ...(cluster ? [] : ["Namespace:    default"]),
      "PolicyRule:",
      "  Resources  Verbs",
      "  ---------  -----",
    ];
    for (const rule of role.rules) lines.push("  " + rule.resources.join(",") + "  [" + rule.verbs.join(" ") + "]");
    return lines.join("\n");
  }
  if (["serviceaccount", "serviceaccounts", "sa"].includes(what)) {
    if (!name) return host._err("kubectl describe serviceaccount: Welche SA?", "Die Namen siehst du mit 'kubectl get sa'.");
    const acc = host.serviceAccounts.find(s => s.name === name);
    if (!acc) return host._err('Error from server (NotFound): serviceaccounts "' + name + '" not found', "Tipp: Namen aus 'kubectl get sa' kopieren.");
    return ["Name:         " + acc.name, "Namespace:    default", "Mountable secrets:  <none>"].join("\n");
  }
  if (!["pod", "pods"].includes(what)) return host._err("Der Simulator kann nur 'kubectl describe pod|node|ingress|networkpolicy|role|clusterrole|serviceaccount <name>'.");
  if (!name) return host._err("kubectl describe pod: Welcher Pod?", "Die Namen siehst du mit 'kubectl get pods'.");
  const pod = host._allPods().find(p => p.name === name);
  if (!pod) return host._err('Error from server (NotFound): pods "' + name + '" not found', "Tipp: Pod-Namen kannst du aus 'kubectl get pods' kopieren.");
  // Pod wurde via _allPods() gefunden -> sein Deployment existiert garantiert.
  const dep = host._findDeploymentOfPod(name)!;
  const st = host._podStatus(dep);
  const events = ["  Type    Reason     Age   Message", "  ----    ------     ----  -------"];
  if (dep.evicted) {
    // Evicted (#240): der kubelet hat den Pod beendet, um Disk freizugeben bzw. weil er sein
    // ephemeral-storage-Limit gesprengt hat. Der Grund steht – wie in echtem K8s – im Event.
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned default/" + pod.name);
    events.push("  Warning  Evicted    " + host._age(pod.created) + "   " + dep.evicted.reason);
    events.push("  Normal   Killing    " + host._age(pod.created) + "   Stopping container " + dep.name);
  } else if (!dep.broken) {
    events.push("  Normal  Scheduled  " + host._age(pod.created) + "   Successfully assigned default/" + pod.name);
    events.push("  Normal  Pulled     " + host._age(pod.created) + "   Container image \"" + dep.image + "\" already present");
    events.push("  Normal  Started    " + host._age(pod.created) + "   Started container " + dep.name);
  } else if (dep.broken.type === "imagepull") {
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned default/" + pod.name);
    events.push("  Warning  Failed     " + host._age(pod.created) + "   Failed to pull image \"" + dep.image + "\": repository does not exist or may require authorization");
    events.push("  Warning  Failed     " + host._age(pod.created) + "   Error: ImagePullBackOff");
  } else if (dep.broken.type === "crashloop") {
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned default/" + pod.name);
    events.push("  Normal   Started    " + host._age(pod.created) + "   Started container " + dep.name);
    events.push("  Warning  BackOff    " + host._age(pod.created) + "   Back-off restarting failed container (Tipp: kubectl logs " + pod.name + ")");
  } else if (dep.broken.type === "pending") {
    events.push("  Warning  FailedScheduling  " + host._age(pod.created) + "   0/" + host.nodes.length + " nodes are available: insufficient capacity.");
  } else if (dep.broken.type === "notready") {
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned default/" + pod.name);
    events.push("  Normal   Started    " + host._age(pod.created) + "   Started container " + dep.name);
    events.push("  Warning  Unhealthy  " + host._age(pod.created) + "   Readiness probe failed: HTTP probe returned statuscode 503 (Liveness probe ok – der Pod LÄUFT, ist aber nicht bereit)");
  } else if (dep.broken.type === "oomkilled") {
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned default/" + pod.name);
    events.push("  Normal   Pulled     " + host._age(pod.created) + "   Container image \"" + dep.image + "\" already present");
    events.push("  Warning  BackOff    " + host._age(pod.created) + "   Back-off restarting failed container (zuletzt OOMKilled – Limit zu knapp)");
  }
  // OOMKilled zeigt sich NICHT im State (der ist gerade wieder Waiting), sondern im
  // Last State + Reason und am memory-Limit – genau das ist die Lern-Pointe.
  const oom = !!dep.broken && dep.broken.type === "oomkilled";
  const containerBlock = [
    "  " + dep.name + ":",
    "    Image:        " + dep.image,
    "    State:        " + (oom ? "Waiting (CrashLoopBackOff)" : st.status),
    ...(oom ? [
      "    Last State:   Terminated",
      "      Reason:     OOMKilled",
      "      Exit Code:  137",
      "    Limits:",
      "      memory:     " + (dep.memLimit || 64) + "Mi",
    ] : []),
    // ephemeral-storage-Limit (#240): macht sichtbar, woran ein Evicted-Pod sein Limit gesprengt hat.
    ...(dep.ephemeralLimit !== undefined ? [
      "    Limits:",
      "      ephemeral-storage:  " + dep.ephemeralLimit + "Mi",
      "    ephemeral-storage verbraucht: " + host._depEphemeralUsed(dep) + "Mi",
    ] : []),
    "    Restart Count: " + (st.restarts || pod.restarts),
  ];
  // Volumes-Abschnitt (#240): zeigt das flüchtige emptyDir-Scratch-Volume samt belegtem Platz.
  // Der Inhalt ist nach einem Pod-Neustart weg – genau das ist die emptyDir-Lern-Pointe.
  const volumeBlock = dep.emptyDir ? [
    "Volumes:",
    "  scratch:",
    "    Type:     EmptyDir (a temporary directory that shares a pod's lifetime)",
    "    Used:     " + dep.emptyDir.usedMi + "Mi",
    "    Content:  " + (dep.emptyDir.data || "(leer)"),
  ] : [];
  // Evictete Pods melden Status Failed / Reason: Evicted – genau so zeigt es echtes Kubernetes (#240).
  const statusLine = dep.evicted ? "Failed" : (st.status === "Running" ? "Running" : st.status === "Pending" ? "Pending" : "Waiting (" + st.status + ")");
  return [
    "Name:         " + pod.name,
    "Namespace:    default",
    "Node:         " + (dep.broken && dep.broken.type === "pending" ? "<none>" : host._nodeOf(dep)),
    "Status:       " + statusLine,
    ...(dep.evicted ? ["Reason:       Evicted", "Message:      " + dep.evicted.reason] : []),
    "Ready:        " + st.ready,
    "IP:           " + (dep.broken && dep.broken.type === "pending" ? "<none>" : "10.244.1." + (10 + Math.floor(Math.random() * 200))),
    "Controlled By: ReplicaSet/" + dep.name,
    // ServiceAccount-Identität des Pods (#132): die per spec.serviceAccountName gesetzte SA,
    // sonst die default-SA des Namespaces – genau wie in echtem `kubectl describe pod`.
    "Service Account: " + (dep.serviceAccountName || "default"),
    "Containers:",
    ...containerBlock,
    ...volumeBlock,
    "Events:",
  ].concat(events).join("\n");
}


export function kubectlTop(host: KubectlHost, t: string[]) {
  const what = (t[2] || "").toLowerCase();
  const name = t[3] && !t[3].startsWith("-") ? t[3] : null;
  host._reschedulePending();
  host._recheckReadiness();

  if (["pods", "pod", "po"].includes(what)) {
    let rows = host.podMetrics();
    if (name) {
      rows = rows.filter(r => r.name === name);
      if (rows.length === 0) {
        const exists = host._allPods().some(p => p.name === name);
        return exists
          ? host._err("error: Metrics not available for pod default/" + name, "Metriken gibt es nur für laufende Pods – Status prüfen mit 'kubectl get pods'.")
          : host._err('Error from server (NotFound): pods "' + name + '" not found', "Pod-Namen siehst du mit 'kubectl get pods'.");
      }
    }
    if (rows.length === 0) return "No resources found in default namespace.";
    return table(["NAME", "CPU(cores)", "MEMORY(bytes)"], rows.map(r => [r.name, r.cpuMilli + "m", r.memMi + "Mi"]));
  }

  if (["nodes", "node", "no"].includes(what)) {
    let nodes = host.nodeMetrics();
    if (name) {
      nodes = nodes.filter(nd => nd.name === name);
      if (nodes.length === 0) return host._err('Error from server (NotFound): nodes "' + name + '" not found', "Node-Namen siehst du mit 'kubectl get nodes'.");
    }
    return table(["NAME", "CPU(cores)", "CPU%", "MEMORY(bytes)", "MEMORY%"],
      nodes.map(nd => [nd.name, nd.cpuMilli + "m", nd.cpuPct + "%", nd.memMi + "Mi", nd.memPct + "%"]));
  }

  if (!what) return host._err("kubectl top: pods oder nodes?", "z.B. 'kubectl top pods' oder 'kubectl top nodes'");
  return host._err("kubectl top kennt nur 'pods' und 'nodes'.", "z.B. 'kubectl top nodes'");
}


export function kubectlLogs(host: KubectlHost, t: string[]) {
  // Flags können vor oder hinter dem Pod-Namen stehen: -f/--follow (live folgen),
  // -p/--previous (Logs des abgestürzten Vorgänger-Containers).
  const args = t.slice(2);
  const follow = args.includes("-f") || args.includes("--follow");
  const previous = args.includes("-p") || args.includes("--previous");
  const name = args.find(a => !a.startsWith("-"));
  if (!name) return host._err("kubectl logs: Welcher Pod?", "Pod-Namen siehst du mit 'kubectl get pods'.");
  const pod = host._allPods().find(p => p.name === name);
  if (!pod) return host._err('Error from server (NotFound): pods "' + name + '" not found');
  // Pod via _allPods() gefunden -> Deployment existiert garantiert.
  const dep = host._findDeploymentOfPod(name)!;
  // Nie gestartete Container haben weder aktuelle noch vorherige Logs.
  if (dep.broken && dep.broken.type === "imagepull") {
    return host._err('Error from server (BadRequest): container "' + dep.name + '" in pod "' + name + '" is waiting to start: trying and failing to pull image',
      "Keine Logs ohne Image! Die Ursache steht in den Events: kubectl describe pod " + name);
  }
  if (dep.broken && dep.broken.type === "pending") {
    return host._err('Error from server (BadRequest): pod "' + name + '" is not scheduled yet', "Der Pod wartet auf einen freien Node. Schau in die Events: kubectl describe pod " + name);
  }

  const crashLog = [
    "[start] Dienst " + dep.name + " startet …",
    "[start] Lese Konfiguration …",
    "FATAL: Secret '" + (dep.broken ? dep.broken.needsSecret : "") + "' nicht gefunden – Dienst kann nicht starten!",
    "[exit] Prozess beendet mit Code 1",
  ].join("\n");
  // Tückisch: Die App-Logs sehen normal aus und brechen einfach ab – den OOM-Kill
  // macht der Kernel von außen, die App schreibt dazu nichts. Die Wahrheit steht
  // in 'kubectl describe pod' (Last State: Terminated, Reason: OOMKilled).
  const oomLog = [
    "[start] Dienst " + dep.name + " startet …",
    "[info]  Lade Datensätze in den Arbeitsspeicher …",
    "[info]  Baue Index auf …",
    "(Log endet hier abrupt – kein Fehler, kein Stacktrace.)",
  ].join("\n");

  if (previous) {
    // --previous zeigt die Logs des ABGESTÜRZTEN Vorgänger-Containers.
    // Nur sinnvoll, wenn der Pod überhaupt schon neugestartet ist.
    if (dep.broken && dep.broken.type === "crashloop") return crashLog;
    if (dep.broken && dep.broken.type === "oomkilled") return oomLog;
    return host._err('Error from server (BadRequest): previous terminated container "' + dep.name + '" in pod "' + name + '" not found',
      "--previous zeigt den abgestürzten Vorgänger-Container – dieser Pod ist aber nie neugestartet.");
  }

  let out: string;
  if (dep.broken && dep.broken.type === "crashloop") out = crashLog;
  else if (dep.broken && dep.broken.type === "oomkilled") out = oomLog;
  else out = [
    "10.244.1.1 - - [12/Jun/2026:09:14:02 +0000] \"GET / HTTP/1.1\" 200 615",
    "10.244.1.1 - - [12/Jun/2026:09:14:05 +0000] \"GET /gesundheit HTTP/1.1\" 200 2",
    "10.244.2.7 - - [12/Jun/2026:09:14:11 +0000] \"GET /favicon.ico HTTP/1.1\" 404 153",
  ].join("\n");
  // -f würde im echten Cluster live weiterlaufen; im Simulator endet der Strom hier.
  if (follow) out += "\n^C  (--follow würde live weiterlaufen; im Simulator endet der Stream hier.)";
  return out;
}
