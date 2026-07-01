/* ===== KubeQuest – kubectl Lifecycle (sim/kubectl/lifecycle.ts) =====
 * Die Ressourcen-Lebenszyklus-Befehle: `create` (imperativ anlegen), `apply -f`
 * (deklarativ aus Manifest, größter Block: alle CRDs/Workloads/RBAC/Observability/
 * Storage) und `delete` (löschen, inkl. `-f`). Die drei teilen sich die
 * Pod-Security-Admission (`admitPod` aus ./security) und – beim `apply` einer
 * Argo-Application – das Reconcile aus ../argocd.
 *
 * Phaser-frei (pure Domäne): nutzt `makePodName` aus ../util, Domänentypen aus
 * ../state und das KubectlHost-Interface (./host). Aufgerufen aus dem
 * kubectl-Dispatch (../kubectl.ts).
 */
import type { ArgoApp, RbacSubject } from "../state";
import { addDeployment, removeDeployment, replaceDeploymentPod, restartStatefulPod } from "../workload";
// Argo-CD-Reconcile/-Klon liegen seit #378 bei der argocd-Familie in ../argocd – `kubectl apply -f`
// einer Application zieht/kloniert den Soll direkt darüber (statt über eine Host-Methode).
import { argoReconcile, cloneChildSpec } from "../argocd";
import { isResourceName } from "../names";
import { admitPod } from "./security";
import type { KubectlHost } from "./host";

/** #489: Lehnt einen vom Spieler getippten Ressourcennamen ab, wenn er die DNS-1123-Regel
 *  verletzt – genau wie echtes kubectl (`… is invalid: metadata.name: Invalid value: …`).
 *  Die eine Regel lebt in `../names` (isResourceName, #479); hier verdrahten wir sie an der
 *  Nutzereingabe-Grenze `kubectl create`. Gibt die fertige Fehlermeldung (über `host._err`,
 *  setzt `error`) zurück oder `null`, wenn der Name gültig ist. `kind` ist der K8s-Objekttyp
 *  für die Meldung (z.B. "Deployment", "Secret"). */
function invalidNameError(host: KubectlHost, kind: string, name: string): string | null {
  if (isResourceName(name)) return null;
  return host._err(
    'The ' + kind + ' "' + name + '" is invalid: metadata.name: Invalid value: "' + name +
      "\": a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', " +
      "and must start and end with an alphanumeric character",
    "Kubernetes-Namen folgen der DNS-1123-Regel: nur Kleinbuchstaben, Ziffern und '-', " +
      "Anfang und Ende alphanumerisch (z.B. 'web-app' statt 'WebApp' oder 'web_app').",
  );
}

/** Den Dateinamen hinter `-f`/`--filename` herausziehen (beide Formen gleichwertig,
 *  wie echtes kubectl und wie die accept-Regex; #380). Unterstützt Leerzeichen
 *  (`-f datei`) und `=` (`--filename=datei`). `null`, wenn kein Filename-Flag dasteht. */
function filenameArg(t: string[]): string | null {
  for (let i = 0; i < t.length; i++) {
    const tok = t[i];
    if (tok === "-f" || tok === "--filename") return t[i + 1] ?? null;
    const m = /^(?:-f|--filename)=(.+)$/.exec(tok);
    if (m) return m[1];
  }
  return null;
}


export function kubectlCreate(host: KubectlHost, t: string[], raw: string) {
  if (t[2] === "secret") {
    // kubectl create secret tls <name> --cert=<datei> --key=<datei>
    if (t[3] === "tls") {
      const name = t[4];
      if (!name || name.startsWith("--")) return host._err("kubectl create secret tls: Der Name fehlt.", "Muster: kubectl create secret tls <name> --cert=tls.crt --key=tls.key");
      { const bad = invalidNameError(host, "Secret", name); if (bad) return bad; }
      const hasCert = /--cert[=\s]\S+/.test(raw);
      const hasKey = /--key[=\s]\S+/.test(raw);
      if (!hasCert || !hasKey) return host._err("error: a TLS secret needs --cert and --key", "Häng '--cert=tls.crt --key=tls.key' an.");
      if (host.secrets.some(s => s.name === name)) return host._err('error: secrets "' + name + '" already exists');
      host.secrets.push({ name, keys: ["tls.crt", "tls.key"], type: "kubernetes.io/tls", created: host.clock });
      return "secret/" + name + " created";
    }
    // kubectl create secret generic <name> --from-literal=schluessel=wert
    if (t[3] !== "generic") return host._err("Der Simulator kann nur 'kubectl create secret generic <name> --from-literal=k=v' und 'kubectl create secret tls <name> --cert=… --key=…'.");
    const name = t[4];
    if (!name || name.startsWith("--")) return host._err("kubectl create secret: Der Name fehlt.", "Muster: kubectl create secret generic <name> --from-literal=schluessel=wert");
    { const bad = invalidNameError(host, "Secret", name); if (bad) return bad; }
    const literals = [...raw.matchAll(/--from-literal[=\s]([\w.-]+)=(\S+)/g)].map(m => m[1]);
    if (literals.length === 0) return host._err("error: at least one --from-literal is required", "Häng '--from-literal=passwort=geheim123' an.");
    if (host.secrets.some(s => s.name === name)) return host._err('error: secrets "' + name + '" already exists');
    host.secrets.push({ name, keys: literals, created: host.clock });
    return "secret/" + name + " created";
  }
  if (t[2] === "configmap" || t[2] === "cm") {
    // kubectl create configmap <name> --from-literal=schluessel=wert
    const name = t[3];
    if (!name || name.startsWith("--")) return host._err("kubectl create configmap: Der Name fehlt.", "Muster: kubectl create configmap <name> --from-literal=schluessel=wert");
    { const bad = invalidNameError(host, "ConfigMap", name); if (bad) return bad; }
    const literals = [...raw.matchAll(/--from-literal[=\s]([\w.-]+)=(\S+)/g)].map(m => m[1]);
    if (literals.length === 0) return host._err("error: at least one --from-literal is required", "Häng '--from-literal=log_level=info' an.");
    if (host.configMaps.some(c => c.name === name)) return host._err('error: configmaps "' + name + '" already exists');
    host.configMaps.push({ name, keys: literals, created: host.clock });
    return "configmap/" + name + " created";
  }
  if (t[2] === "serviceaccount" || t[2] === "sa") {
    const name = t[3];
    if (!name || name.startsWith("--")) return host._err("kubectl create serviceaccount: Der Name fehlt.", "Muster: kubectl create serviceaccount <name>");
    { const bad = invalidNameError(host, "ServiceAccount", name); if (bad) return bad; }
    if (host.serviceAccounts.some(s => s.name === name)) return host._err('error: serviceaccounts "' + name + '" already exists');
    host.serviceAccounts.push({ name, created: host.clock });
    return "serviceaccount/" + name + " created";
  }
  if (t[2] === "role" || t[2] === "clusterrole") {
    const cluster = t[2] === "clusterrole";
    const name = t[3];
    if (!name || name.startsWith("--")) return host._err("kubectl create " + t[2] + ": Der Name fehlt.", "Muster: kubectl create " + t[2] + " <name> --verb=get,list --resource=pods");
    { const bad = invalidNameError(host, cluster ? "ClusterRole" : "Role", name); if (bad) return bad; }
    const verbs = host._multiFlag(raw, "verb");
    const resources = host._multiFlag(raw, "resource");
    if (verbs.length === 0) return host._err("error: at least one --verb must be specified", "Häng z.B. '--verb=get,list' an.");
    if (resources.length === 0) return host._err("error: at least one --resource must be specified", "Häng z.B. '--resource=pods' an.");
    const kind = cluster ? "clusterrole" : "role";
    if (host.roles.some(r => r.cluster === cluster && r.name === name)) return host._err('error: ' + kind + 's.rbac.authorization.k8s.io "' + name + '" already exists');
    host.roles.push({ name, cluster, rules: [{ verbs, resources }], created: host.clock });
    return kind + ".rbac.authorization.k8s.io/" + name + " created";
  }
  if (t[2] === "rolebinding" || t[2] === "clusterrolebinding") {
    const cluster = t[2] === "clusterrolebinding";
    const name = t[3];
    if (!name || name.startsWith("--")) return host._err("kubectl create " + t[2] + ": Der Name fehlt.", "Muster: kubectl create " + t[2] + " <name> --role=<rolle> --serviceaccount=<ns>:<sa>");
    { const bad = invalidNameError(host, cluster ? "ClusterRoleBinding" : "RoleBinding", name); if (bad) return bad; }
    const roleName = host._flagValue(t, "--role");
    const clusterRoleName = host._flagValue(t, "--clusterrole");
    // ClusterRoleBinding kann sich nur auf eine ClusterRole beziehen.
    if (cluster && roleName) return host._err("error: a ClusterRoleBinding can only reference a ClusterRole", "Nutze '--clusterrole=<name>' statt '--role'.");
    if (!roleName && !clusterRoleName) return host._err("error: exactly one of --role or --clusterrole must be specified", cluster ? "Häng '--clusterrole=<name>' an." : "Häng '--role=<name>' oder '--clusterrole=<name>' an.");
    const roleRef = clusterRoleName ? { kind: "ClusterRole" as const, name: clusterRoleName } : { kind: "Role" as const, name: roleName! };
    const subjects: RbacSubject[] = [];
    for (const u of host._multiFlag(raw, "user")) subjects.push({ kind: "User", name: u });
    for (const sa of host._multiFlag(raw, "serviceaccount")) {
      const [ns, n] = sa.includes(":") ? sa.split(":") : ["default", sa];
      subjects.push({ kind: "ServiceAccount", name: n, namespace: ns });
    }
    if (subjects.length === 0) return host._err("error: at least one of --user or --serviceaccount must be specified", "Muster: '--serviceaccount=default:deploy-bot' oder '--user=alice'.");
    const kind = cluster ? "clusterrolebinding" : "rolebinding";
    if (host.roleBindings.some(b => b.cluster === cluster && b.name === name)) return host._err('error: ' + kind + 's.rbac.authorization.k8s.io "' + name + '" already exists');
    host.roleBindings.push({ name, cluster, roleRef, subjects, created: host.clock });
    return kind + ".rbac.authorization.k8s.io/" + name + " created";
  }
  if (t[2] !== "deployment") return host._err("Der Simulator kann nur 'kubectl create deployment|serviceaccount|role|clusterrole|rolebinding|clusterrolebinding …', 'kubectl create secret generic|tls …' und 'kubectl create configmap …'.");
  const name = t[3];
  const imgMatch = raw.match(/--image[=\s]+(\S+)/);
  if (!name || name.startsWith("--")) return host._err("kubectl create deployment: Der Name fehlt.", "z.B. 'kubectl create deployment kasse --image=nginx'");
  { const bad = invalidNameError(host, "Deployment", name); if (bad) return bad; }
  if (!imgMatch) return host._err("error: required flag(s) \"image\" not set", "Häng '--image=nginx' an.");
  if (host.deployments.some(d => d.name === name)) return host._err('error: deployment "' + name + '" already exists');
  // Pod-Security-Admission: ein imperativ erzeugtes Deployment hat keinen securityContext.
  // Unter baseline/restricted wird es deshalb abgelehnt (privileged = keine Prüfung).
  const denied = admitPod(host, name, undefined);
  if (denied) return host._err(denied, "Setz die Stufe mit 'kubectl label namespace default pod-security.kubernetes.io/enforce=privileged' herab oder liefere einen passenden securityContext per Manifest.");
  addDeployment(host, host._makeDeployment(name, imgMatch[1], 1));
  return "deployment.apps/" + name + " created";
}


export function kubectlDelete(host: KubectlHost, t: string[]) {
  const what = (t[2] || "").toLowerCase();
  const name = t[3];

  if (what === "-f" || what === "--filename" || /^(?:-f|--filename)=/.test(what)) {
    const file = filenameArg(t);
    if (!file) return host._err("error: must specify one of -f or -k", "Muster: 'kubectl delete --filename deployment.yaml'");
    const eff = host.applyEffects[file];
    if (!eff || !host.files[file]) return host._err("error: the path \"" + file + "\" does not exist", "Mit 'ls' siehst du, welche Dateien hier liegen.");
    const out: string[] = [];
    const effDep = eff.deployment;
    if (effDep) {
      if (removeDeployment(host, effDep.name)) out.push('deployment.apps "' + effDep.name + '" deleted');
    }
    const effSvc = eff.service;
    if (effSvc) {
      const i = host.services.findIndex(s => s.name === effSvc.name);
      if (i >= 0) { host.services.splice(i, 1); out.push('service "' + effSvc.name + '" deleted'); }
    }
    const effIng = eff.ingress;
    if (effIng) {
      const i = host.ingresses.findIndex(x => x.name === effIng.name);
      if (i >= 0) { host.ingresses.splice(i, 1); out.push('ingress.networking.k8s.io "' + effIng.name + '" deleted'); }
    }
    const effNp = eff.networkPolicy;
    if (effNp) {
      const i = host.networkPolicies.findIndex(x => x.name === effNp.name);
      if (i >= 0) { host.networkPolicies.splice(i, 1); out.push('networkpolicy.networking.k8s.io "' + effNp.name + '" deleted'); }
    }
    const effStsDel = eff.statefulSet;
    if (effStsDel) {
      const i = host.statefulSets.findIndex(x => x.name === effStsDel.name);
      if (i >= 0) { host.statefulSets.splice(i, 1); out.push('statefulset.apps "' + effStsDel.name + '" deleted'); } // PVCs bleiben absichtlich (#122)
    }
    const effPvcDel = eff.pvc;
    if (effPvcDel) {
      const i = host.pvcs.findIndex(x => x.name === effPvcDel.name);
      if (i >= 0) { host.pvcs.splice(i, 1); out.push('persistentvolumeclaim "' + effPvcDel.name + '" deleted'); }
    }
    const effPvDel = eff.pv;
    if (effPvDel) {
      const i = host.pvs.findIndex(x => x.name === effPvDel.name);
      if (i >= 0) { host.pvs.splice(i, 1); out.push('persistentvolume "' + effPvDel.name + '" deleted'); }
    }
    const effScDel = eff.storageClass;
    if (effScDel) {
      const i = host.storageClasses.findIndex(x => x.name === effScDel.name);
      if (i >= 0) { host.storageClasses.splice(i, 1); out.push('storageclass.storage.k8s.io "' + effScDel.name + '" deleted'); }
    }
    const effVsDel = eff.volumeSnapshot;
    if (effVsDel) {
      const i = host.volumeSnapshots.findIndex(x => x.name === effVsDel.name);
      if (i >= 0) { host.volumeSnapshots.splice(i, 1); out.push('volumesnapshot.snapshot.storage.k8s.io "' + effVsDel.name + '" deleted'); }
    }
    return out.join("\n") || "nothing deleted";
  }

  if (!name) return host._err("kubectl delete: Was und wie heißt es?", "z.B. 'kubectl delete pod <pod-name>'");

  if (["pod", "pods", "po"].includes(what)) {
    const dep = host._findDeploymentOfPod(name);
    if (dep) {
      host.lastDeletedPod = name;
      // Pod-Neustart gibt das flüchtige emptyDir frei (#240): der Ersatz-Pod startet mit leerem
      // Scratch-Volume – „weg, sobald der Pod weg ist". (PVCs überleben dagegen, siehe StatefulSet.)
      host._resetEphemeral(dep);
      // Self-Healing: das Deployment ersetzt den Pod sofort – mit NEUEM Zufallsnamen (hält die
      // Pod-Anzahl konstant, #488).
      replaceDeploymentPod(dep, name, host.clock);
      return 'pod "' + name + '" deleted';
    }
    // StatefulSet-Pod (#122): kommt mit GLEICHEM Namen und GLEICHEM PVC zurück –
    // die Daten überleben. Das PVC wird bewusst NICHT angefasst; stabile Identität
    // (gleicher Name, gleiche Ordinalposition) hält restartStatefulPod (#488).
    const sts = host.statefulSets.find(s => s.pods.some(p => p.name === name));
    if (sts) {
      host.lastDeletedPod = name;
      restartStatefulPod(sts, name, host.clock);
      return 'pod "' + name + '" deleted';
    }
    return host._err('Error from server (NotFound): pods "' + name + '" not found', "Pod-Namen siehst du mit 'kubectl get pods'.");
  }

  if (["deployment", "deployments", "deploy"].includes(what)) {
    if (!removeDeployment(host, name)) return host._err('Error from server (NotFound): deployments.apps "' + name + '" not found');
    return 'deployment.apps "' + name + '" deleted';
  }

  if (["service", "services", "svc"].includes(what)) {
    const idx = host.services.findIndex(s => s.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): services "' + name + '" not found');
    host.services.splice(idx, 1);
    return 'service "' + name + '" deleted';
  }

  if (["configmap", "configmaps", "cm"].includes(what)) {
    const idx = host.configMaps.findIndex(c => c.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): configmaps "' + name + '" not found');
    host.configMaps.splice(idx, 1);
    return 'configmap "' + name + '" deleted';
  }

  if (["secret", "secrets"].includes(what)) {
    const idx = host.secrets.findIndex(s => s.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): secrets "' + name + '" not found');
    host.secrets.splice(idx, 1);
    return 'secret "' + name + '" deleted';
  }

  if (["ingress", "ingresses", "ing"].includes(what)) {
    const idx = host.ingresses.findIndex(i => i.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): ingresses.networking.k8s.io "' + name + '" not found');
    host.ingresses.splice(idx, 1);
    return 'ingress.networking.k8s.io "' + name + '" deleted';
  }

  if (["networkpolicy", "networkpolicies", "netpol", "netpols"].includes(what)) {
    const idx = host.networkPolicies.findIndex(n => n.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): networkpolicies.networking.k8s.io "' + name + '" not found');
    host.networkPolicies.splice(idx, 1);
    return 'networkpolicy.networking.k8s.io "' + name + '" deleted';
  }

  if (["statefulset", "statefulsets", "sts"].includes(what)) {
    const idx = host.statefulSets.findIndex(s => s.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): statefulsets.apps "' + name + '" not found');
    host.statefulSets.splice(idx, 1);
    // Die PVCs bleiben absichtlich erhalten – Kern der Datendauerhaftigkeit (#122).
    return 'statefulset.apps "' + name + '" deleted\n💡 Die PVCs bleiben bestehen – die Daten überleben das Löschen des StatefulSets. Skalierst du es wieder hoch, hängen die alten Volumes wieder dran.';
  }

  if (["pvc", "persistentvolumeclaim", "persistentvolumeclaims"].includes(what)) {
    const idx = host.pvcs.findIndex(p => p.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): persistentvolumeclaims "' + name + '" not found');
    const [removed] = host.pvcs.splice(idx, 1);
    // Gebundenes PV freigeben: Delete-Policy entfernt es, Retain hinterlässt es als "Released".
    const pv = host.pvs.find(p => p.name === removed.volume);
    if (pv) {
      if (pv.reclaimPolicy === "Retain") { pv.status = "Released"; pv.claim = ""; }
      else { const j = host.pvs.findIndex(x => x.name === pv.name); if (j >= 0) host.pvs.splice(j, 1); }
    }
    return 'persistentvolumeclaim "' + name + '" deleted';
  }

  if (["pv", "persistentvolume", "persistentvolumes"].includes(what)) {
    const idx = host.pvs.findIndex(p => p.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): persistentvolumes "' + name + '" not found');
    host.pvs.splice(idx, 1);
    return 'persistentvolume "' + name + '" deleted';
  }

  if (["storageclass", "storageclasses", "sc"].includes(what)) {
    const idx = host.storageClasses.findIndex(s => s.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): storageclasses.storage.k8s.io "' + name + '" not found');
    host.storageClasses.splice(idx, 1);
    return 'storageclass.storage.k8s.io "' + name + '" deleted';
  }

  if (["volumesnapshot", "volumesnapshots", "vs"].includes(what)) {
    const idx = host.volumeSnapshots.findIndex(v => v.name === name);
    if (idx === -1) return host._err('Error from server (NotFound): volumesnapshots.snapshot.storage.k8s.io "' + name + '" not found');
    host.volumeSnapshots.splice(idx, 1);
    return 'volumesnapshot.snapshot.storage.k8s.io "' + name + '" deleted';
  }

  return host._err("kubectl delete: Ressourcentyp '" + what + "' kennt der Simulator nicht.");
}


export function kubectlApply(host: KubectlHost, t: string[]) {
  const file = filenameArg(t);
  if (!file) return host._err("error: must specify one of -f or -k", "Muster: 'kubectl apply --filename deployment.yaml'");
  if (!host.files[file]) return host._err("error: the path \"" + file + "\" does not exist", "Mit 'ls' siehst du, welche Dateien hier liegen.");
  const eff = host.applyEffects[file];
  if (!eff) return host._err("error: unable to decode " + file);
  const out: string[] = [];
  const effDep = eff.deployment;
  if (effDep) {
    const existing = host.deployments.find(d => d.name === effDep.name);
    if (existing) {
      // Deklarativ: eine geänderte SA-Zuordnung (spec.serviceAccountName, #132) wird
      // beim erneuten apply übernommen ("configured") – sonst bleibt es "unchanged".
      if (effDep.serviceAccountName && existing.serviceAccountName !== effDep.serviceAccountName) {
        existing.serviceAccountName = effDep.serviceAccountName;
        out.push("deployment.apps/" + effDep.name + " configured");
      } else {
        out.push("deployment.apps/" + effDep.name + " unchanged");
      }
    } else {
      // Pod-Security-Admission (#126): unsichere Pods werden unter baseline/restricted
      // schon beim Anlegen abgewiesen – der Rest des Manifests wird nicht angewandt.
      const denied = admitPod(host, effDep.name, effDep.securityContext);
      if (denied) return host._err(denied, "Ergänze im Manifest einen passenden securityContext (z.B. runAsNonRoot: true) oder senke die enforce-Stufe.");
      const dep = host._makeDeployment(effDep.name, effDep.image, effDep.replicas);
      // ServiceAccount-Identität aus dem Pod-Template übernehmen (#132); fehlt sie, bleibt
      // es die default-SA (Feld undefined).
      if (effDep.serviceAccountName) dep.serviceAccountName = effDep.serviceAccountName;
      // Container-Port aus dem Pod-Template (#164): nötig für den targetPort-Abgleich beim curl.
      if (effDep.containerPort !== undefined) dep.containerPort = effDep.containerPort;
      // Ephemeral-Storage aus dem Pod-Template (#240): emptyDir-Volume, Limit, Zusatznutzung, Node-Pin.
      if (effDep.node !== undefined) dep.node = effDep.node;
      if (effDep.emptyDir) dep.emptyDir = { data: effDep.emptyDir.data || "", usedMi: effDep.emptyDir.usedMi || 0 };
      if (effDep.ephemeralLimit !== undefined) dep.ephemeralLimit = effDep.ephemeralLimit;
      if (effDep.ephemeralUsedMi !== undefined) dep.ephemeralUsedMi = effDep.ephemeralUsedMi;
      // Eigenes Image (#164, Werft-Capstone): ist es noch nicht lokal gebaut/gezogen, landet
      // der Pod im ImagePullBackOff – genau wie im echten Cluster. needsBuild markiert: heilt
      // von selbst, sobald 'docker build'/'docker pull' das Image bereitstellt.
      if (effDep.requireBuiltImage && !host._imageAvailable(effDep.image)) {
        dep.broken = { type: "imagepull", badImage: effDep.image, needsBuild: true };
      }
      addDeployment(host, dep);
      out.push("deployment.apps/" + effDep.name + " created");
      if (dep.broken) out.push("💡 Pod im ImagePullBackOff: das Image '" + effDep.image + "' gibt es noch nicht. Erst 'docker build -t " + effDep.image + " .', dann 'kubectl rollout restart deployment " + effDep.name + "'.");
    }
  }
  const effSvc = eff.service;
  if (effSvc) {
    const existing = host.services.find(s => s.name === effSvc.name);
    if (existing) {
      out.push("service/" + effSvc.name + " unchanged");
    } else if (effSvc.externalName) {
      // ExternalName-Service (#337): kein ClusterIP, sondern ein CNAME auf einen externen
      // DNS-Namen. So bekommen Pods einen cluster-internen Namen für einen Dienst außerhalb.
      host.services.push({
        name: effSvc.name, type: "ExternalName", clusterIP: "<none>",
        port: effSvc.port, externalName: effSvc.externalName, created: host.clock,
      });
      out.push("service/" + effSvc.name + " created");
    } else {
      host.services.push({
        name: effSvc.name, type: effSvc.type || "ClusterIP",
        clusterIP: "10.96." + Math.floor(Math.random() * 250) + "." + Math.floor(Math.random() * 250),
        port: effSvc.port,
        ...(effSvc.targetPort !== undefined ? { targetPort: effSvc.targetPort } : {}), // #164
        created: host.clock,
      });
      out.push("service/" + effSvc.name + " created");
    }
  }
  const effIng = eff.ingress;
  if (effIng) {
    const existing = host.ingresses.find(i => i.name === effIng.name);
    if (existing) {
      // TLS am bestehenden Hafentor nachrüsten: aus HTTP wird HTTPS ("configured").
      if (effIng.tls && !existing.tls) {
        existing.tls = { secretName: effIng.tls.secretName };
        out.push("ingress.networking.k8s.io/" + effIng.name + " configured");
      } else {
        out.push("ingress.networking.k8s.io/" + effIng.name + " unchanged");
      }
    } else {
      host.ingresses.push({
        name: effIng.name, className: effIng.className || "nginx",
        host: effIng.host, path: effIng.path || "/",
        service: effIng.service, port: effIng.port,
        ...(effIng.tls ? { tls: { secretName: effIng.tls.secretName } } : {}),
        created: host.clock,
      });
      out.push("ingress.networking.k8s.io/" + effIng.name + " created");
    }
  }
  const effNp = eff.networkPolicy;
  if (effNp) {
    const existing = host.networkPolicies.find(n => n.name === effNp.name);
    if (existing) {
      out.push("networkpolicy.networking.k8s.io/" + effNp.name + " unchanged");
    } else {
      host.networkPolicies.push({
        name: effNp.name, podSelector: effNp.podSelector || "",
        allowFrom: effNp.allowFrom || "", created: host.clock,
      });
      out.push("networkpolicy.networking.k8s.io/" + effNp.name + " created");
    }
  }
  const effApp = eff.application;
  if (effApp) {
    const existing = host.argoApps.find(a => a.name === effApp.name);
    if (existing) {
      // kubectl apply ist idempotent: ändert sich autoSync/selfHeal, ist das ein "configure"-Vorgang
      // (genau wie bei echtem kubectl, das "configured" statt "unchanged" zurückgibt, wenn sich etwas ändert).
      const newAutoSync = !!effApp.autoSync;
      const newSelfHeal = !!effApp.selfHeal;
      if (existing.autoSync !== newAutoSync || existing.selfHeal !== newSelfHeal) {
        existing.autoSync = newAutoSync;
        existing.selfHeal = newSelfHeal;
        out.push("application.argoproj.io/" + effApp.name + " configured");
        if (existing.autoSync) {
          argoReconcile(host, existing);
          out.push("💡 Sync-Policy 'Automated'" + (existing.selfHeal ? " + Self-Heal" : "") + " aktiv – Argo gleicht den Cluster laufend mit dem Git-Soll ab.");
        }
      } else {
        out.push("application.argoproj.io/" + effApp.name + " unchanged");
      }
    } else {
      const isAppOfApps = !!effApp.childApps && effApp.childApps.length > 0;
      const app: ArgoApp = {
        name: effApp.name,
        repo: effApp.repo || "https://git.hafen.de/apps.git",
        path: effApp.path || effApp.name + "/",
        autoSync: !!effApp.autoSync,
        selfHeal: !!effApp.selfHeal,
        created: host.clock,
        ...(isAppOfApps
          ? { childApps: effApp.childApps!.map(c => cloneChildSpec(c)) }
          : { desired: {
              deployment: Object.assign({}, effApp.deployment!),
              ...(effApp.service ? { service: Object.assign({}, effApp.service) } : {}),
            } }),
      };
      host.argoApps.push(app);
      out.push("application.argoproj.io/" + effApp.name + " created");
      // Mit auto-sync zieht Argo den Git-Soll sofort in den Cluster (Pull ohne manuelles 'argocd app sync').
      if (app.autoSync) {
        argoReconcile(host, app);
        out.push(isAppOfApps
          ? "💡 App-of-Apps: Argo legt aus dem '" + app.path + "'-Ordner gleich die ganze Flotte an. Schau mit 'argocd app list'."
          : "💡 Sync-Policy 'Automated' – Argo rollt den deklarierten Stand sofort aus. Schau mit 'argocd app get " + app.name + "'.");
      } else {
        out.push("💡 Die App ist angelegt, aber noch OutOfSync. Zieh den Git-Soll mit 'argocd app sync " + app.name + "' in den Cluster.");
      }
    }
  }
  // Observability-CRDs (#110): legen Monitoring-Objekte an, idempotent wie die übrigen.
  const effSm = eff.serviceMonitor;
  if (effSm) {
    if (host.serviceMonitors.some(s => s.name === effSm.name)) {
      out.push("servicemonitor.monitoring.coreos.com/" + effSm.name + " unchanged");
    } else {
      host.serviceMonitors.push({ name: effSm.name, selector: effSm.selector, port: effSm.port || "metrics", interval: effSm.interval || "30s", created: host.clock });
      out.push("servicemonitor.monitoring.coreos.com/" + effSm.name + " created");
    }
  }
  const effPr = eff.prometheusRule;
  if (effPr) {
    if (host.prometheusRules.some(r => r.name === effPr.name)) {
      out.push("prometheusrule.monitoring.coreos.com/" + effPr.name + " unchanged");
    } else {
      host.prometheusRules.push({ name: effPr.name, alert: effPr.alert, expr: effPr.expr || "", forDuration: effPr.forDuration || "5m", severity: effPr.severity || "warning", created: host.clock });
      out.push("prometheusrule.monitoring.coreos.com/" + effPr.name + " created");
    }
  }
  const effDs = eff.grafanaDatasource;
  if (effDs) {
    if (host.grafanaDatasources.some(d => d.name === effDs.name)) {
      out.push("grafanadatasource.grafana.integreatly.org/" + effDs.name + " unchanged");
    } else {
      host.grafanaDatasources.push({ name: effDs.name, dsType: effDs.dsType || "prometheus", url: effDs.url || "", created: host.clock });
      out.push("grafanadatasource.grafana.integreatly.org/" + effDs.name + " created");
    }
  }
  const effGd = eff.grafanaDashboard;
  if (effGd) {
    if (host.grafanaDashboards.some(d => d.name === effGd.name)) {
      out.push("grafanadashboard.grafana.integreatly.org/" + effGd.name + " unchanged");
    } else {
      host.grafanaDashboards.push({ name: effGd.name, title: effGd.title, panels: effGd.panels || 0, created: host.clock });
      out.push("grafanadashboard.grafana.integreatly.org/" + effGd.name + " created");
    }
  }
  // Stateful-Workload-CRDs (#122). Reihenfolge: StorageClass + PV vor PVC/StatefulSet,
  // damit das Binden im selben apply schon greift.
  const effSc = eff.storageClass;
  if (effSc) {
    if (host.storageClasses.some(s => s.name === effSc.name)) {
      out.push("storageclass.storage.k8s.io/" + effSc.name + " unchanged");
    } else {
      host.storageClasses.push({ name: effSc.name, provisioner: effSc.provisioner || "rancher.io/local-path", reclaimPolicy: effSc.reclaimPolicy || "Delete", isDefault: !!effSc.isDefault, created: host.clock });
      out.push("storageclass.storage.k8s.io/" + effSc.name + " created");
    }
  }
  const effPv = eff.pv;
  if (effPv) {
    if (host.pvs.some(p => p.name === effPv.name)) {
      out.push("persistentvolume/" + effPv.name + " unchanged");
    } else {
      host.pvs.push({ name: effPv.name, capacity: effPv.capacity || "1Gi", status: "Available", claim: "", storageClass: effPv.storageClass || "", accessModes: effPv.accessModes || "RWO", reclaimPolicy: effPv.reclaimPolicy || "Retain", created: host.clock });
      out.push("persistentvolume/" + effPv.name + " created");
    }
  }
  const effPvc = eff.pvc;
  if (effPvc) {
    if (host.pvcs.some(p => p.name === effPvc.name)) {
      out.push("persistentvolumeclaim/" + effPvc.name + " unchanged");
    } else {
      // Restore aus einem VolumeSnapshot (#140): spec.dataSource zeigt auf einen Snapshot.
      // Der muss existieren UND readyToUse sein – sonst bekäme das PVC stillschweigend ein
      // leeres Volume statt der gesicherten Daten (genau der Fehler, den die Quest vermeidet).
      let restored: string | undefined;
      if (effPvc.dataSource) {
        const snap = host.volumeSnapshots.find(v => v.name === effPvc.dataSource);
        if (!snap) return host._err('error: the dataSource VolumeSnapshot "' + effPvc.dataSource + '" was not found', "Aus einem Snapshot stellst du wieder her – schau mit 'kubectl get volumesnapshot', welche es gibt.");
        if (!snap.readyToUse) return host._err('error: the VolumeSnapshot "' + effPvc.dataSource + '" is not readyToUse yet', "Ein Snapshot kann erst wiederhergestellt werden, wenn er fertig ist (READYTOUSE true).");
        restored = snap.data;
      }
      const pvc = host._makePvc(effPvc.name, effPvc.storage || "1Gi", effPvc.storageClass, effPvc.accessModes);
      // Volume-Inhalt setzen: aus dem Snapshot wiederhergestellt, sonst frisch geseedet, sonst leer.
      if (restored !== undefined) pvc.data = restored;
      else if (effPvc.data !== undefined) pvc.data = effPvc.data;
      host.pvcs.push(pvc);
      out.push("persistentvolumeclaim/" + effPvc.name + " created");
      if (restored !== undefined) {
        out.push("💡 PVC '" + pvc.name + "' aus Snapshot '" + effPvc.dataSource + "' wiederhergestellt – die gesicherten Daten sind zurück auf dem Volume.");
      } else {
        out.push(pvc.status === "Bound"
          ? "💡 PVC '" + pvc.name + "' ist Bound – es hat Speicher bekommen (PV " + pvc.volume + ")."
          : "💡 PVC '" + pvc.name + "' ist Pending – kein passendes PV da und keine StorageClass, die eins anlegt.");
      }
    }
  }
  // Backup/Restore (#140): VolumeSnapshot eines Quell-PVC. Der Snapshot friert den
  // aktuellen Volume-Inhalt ein und ist ab dann ein eigenständiges Objekt – er überlebt
  // das Löschen der Quelle (das ist der Sinn eines Backups).
  const effVs = eff.volumeSnapshot;
  if (effVs) {
    if (host.volumeSnapshots.some(v => v.name === effVs.name)) {
      out.push("volumesnapshot.snapshot.storage.k8s.io/" + effVs.name + " unchanged");
    } else {
      const src = host.pvcs.find(p => p.name === effVs.sourcePvc);
      if (!src) return host._err('error: the source PVC "' + effVs.sourcePvc + '" does not exist', "Eine VolumeSnapshot braucht ein vorhandenes Quell-PVC. Schau mit 'kubectl get pvc'.");
      host.volumeSnapshots.push({ name: effVs.name, sourcePvc: src.name, data: src.data || "", restoreSize: src.capacity, readyToUse: true, created: host.clock });
      out.push("volumesnapshot.snapshot.storage.k8s.io/" + effVs.name + " created");
      out.push("💡 Snapshot '" + effVs.name + "' sichert den Stand von PVC '" + src.name + "' (readyToUse). Er ist ein eigenes Objekt und überlebt das Löschen der Quelle.");
    }
  }
  const effSts = eff.statefulSet;
  if (effSts) {
    if (host.statefulSets.some(s => s.name === effSts.name)) {
      out.push("statefulset.apps/" + effSts.name + " unchanged");
    } else {
      const sts = host._makeStatefulSet(effSts);
      host.statefulSets.push(sts);
      out.push("statefulset.apps/" + effSts.name + " created");
      out.push("💡 " + sts.replicas + " Pod(s) mit stabiler Identität (" + sts.name + "-0 …), jeder mit eigenem PVC '" + sts.volumeClaimName + "-" + sts.name + "-0' usw.");
    }
  }
  // RBAC-CRDs (#128): SA / Role(+Cluster) / RoleBinding(+Cluster) deklarativ anlegen,
  // idempotent wie alles andere. Genau diese Objekte wertet `kubectl auth can-i` aus.
  const effSa = eff.serviceAccount;
  if (effSa) {
    if (host.serviceAccounts.some(s => s.name === effSa.name)) {
      out.push("serviceaccount/" + effSa.name + " unchanged");
    } else {
      host.serviceAccounts.push({ name: effSa.name, created: host.clock });
      out.push("serviceaccount/" + effSa.name + " created");
    }
  }
  const effRole = eff.role;
  if (effRole) {
    const cluster = !!effRole.cluster;
    const kind = cluster ? "clusterrole" : "role";
    if (host.roles.some(r => r.name === effRole.name && r.cluster === cluster)) {
      out.push(kind + ".rbac.authorization.k8s.io/" + effRole.name + " unchanged");
    } else {
      host.roles.push({ name: effRole.name, cluster, rules: effRole.rules.map(rule => ({ verbs: rule.verbs.slice(), resources: rule.resources.slice() })), created: host.clock });
      out.push(kind + ".rbac.authorization.k8s.io/" + effRole.name + " created");
    }
  }
  const effRb = eff.roleBinding;
  if (effRb) {
    const cluster = !!effRb.cluster;
    const kind = cluster ? "clusterrolebinding" : "rolebinding";
    if (host.roleBindings.some(b => b.name === effRb.name && b.cluster === cluster)) {
      out.push(kind + ".rbac.authorization.k8s.io/" + effRb.name + " unchanged");
    } else {
      host.roleBindings.push({ name: effRb.name, cluster, roleRef: { kind: effRb.roleRef.kind, name: effRb.roleRef.name }, subjects: effRb.subjects.map(s => Object.assign({}, s)), created: host.clock });
      out.push(kind + ".rbac.authorization.k8s.io/" + effRb.name + " created");
    }
  }
  return out.join("\n");
}
