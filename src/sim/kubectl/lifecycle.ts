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
import type { ApplyEffect, ArgoApp, Deployment, RbacSubject } from "../state";
import { addDeployment, removeDeployment, addStatefulSet, removeStatefulSet, replaceDeploymentPod, restartStatefulPod } from "../workload";
// Argo-CD-Reconcile/-Klon liegen seit #378 bei der argocd-Familie in ../argocd – `kubectl apply -f`
// einer Application zieht/kloniert den Soll direkt darüber (statt über eine Host-Methode).
import { argoReconcile, cloneChildSpec } from "../argocd";
import { isResourceName, rfc1123ErrorText, RFC1123_TIP } from "../names";
import { flagValue, multiFlag } from "../util"; // clusterIP entfällt: Service läuft jetzt über host._makeService (#507)
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
  // Meldungstext + Tipp liegen zentral in ../names (#507), damit create, apply, expose
  // und helm bei einem ungültigen Namen exakt dieselbe Meldung geben.
  return host._err(rfc1123ErrorText(name, kind), RFC1123_TIP);
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

/** Ein benanntes Element aus einer Ressourcen-Liste entfernen; `true`, wenn es da war.
 *  Bündelt das früher ~13× kopierte `findIndex → splice` (#518). */
function spliceByName(arr: { name: string }[], name: string): boolean {
  const i = arr.findIndex(r => r.name === name);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}

/* ===== `kubectl delete <typ> <name>` – Tabelle der schlicht löschbaren Ressourcen (#518) =====
 * Alle Ressourcentypen, deren Löschen genau „finde per Name → splice → melde" ist (keine
 * Folgewirkung wie das PV-Freigeben beim PVC oder das PVC-Behalten beim StatefulSet). Ein
 * Eintrag je Typ statt eines eigenen if-Zweigs. `notFoundKind` ist der voll qualifizierte
 * Plural für die NotFound-Meldung (echtes kubectl), `deletedKind` das qualifizierte Objekt
 * für die „… deleted"-Zeile. Die Sonderfälle (pod/deployment/statefulset/pvc) bleiben
 * bewusst eigene Zweige. */
const SIMPLE_DELETABLE: readonly {
  aliases: string[];
  pick: (host: KubectlHost) => { name: string }[];
  notFoundKind: string;
  deletedKind: string;
}[] = [
  { aliases: ["service", "services", "svc"], pick: h => h.services, notFoundKind: "services", deletedKind: "service" },
  { aliases: ["configmap", "configmaps", "cm"], pick: h => h.configMaps, notFoundKind: "configmaps", deletedKind: "configmap" },
  { aliases: ["secret", "secrets"], pick: h => h.secrets, notFoundKind: "secrets", deletedKind: "secret" },
  { aliases: ["ingress", "ingresses", "ing"], pick: h => h.ingresses, notFoundKind: "ingresses.networking.k8s.io", deletedKind: "ingress.networking.k8s.io" },
  { aliases: ["networkpolicy", "networkpolicies", "netpol", "netpols"], pick: h => h.networkPolicies, notFoundKind: "networkpolicies.networking.k8s.io", deletedKind: "networkpolicy.networking.k8s.io" },
  { aliases: ["pv", "persistentvolume", "persistentvolumes"], pick: h => h.pvs, notFoundKind: "persistentvolumes", deletedKind: "persistentvolume" },
  { aliases: ["storageclass", "storageclasses", "sc"], pick: h => h.storageClasses, notFoundKind: "storageclasses.storage.k8s.io", deletedKind: "storageclass.storage.k8s.io" },
  { aliases: ["volumesnapshot", "volumesnapshots", "vs"], pick: h => h.volumeSnapshots, notFoundKind: "volumesnapshots.snapshot.storage.k8s.io", deletedKind: "volumesnapshot.snapshot.storage.k8s.io" },
];


/* ===== `kubectl create <typ> …` – ein Handler je Ressourcentyp (#543) =====
 * Der frühere Monolith (complexity 63, ein `if (t[2] === …)`-Block je Typ) ist in fokussierte
 * Handler zerlegt, verdrahtet über die `CREATE_HANDLERS`-Tabelle (dieselbe Registry-Idee wie
 * `applyHandlers` / `SIMPLE_DELETABLE`). Ein neuer create-fähiger Typ = ein Handler + ein
 * Tabellen-Eintrag; `kubectlCreate` selbst bleibt ein dünner Dispatcher (Stardew-Scope: wächst
 * nicht in der Komplexität, egal wie viele Ressourcentypen dazukommen). Alle Handler teilen die
 * Signatur (host, t, raw); wer `raw` nicht braucht, ignoriert es. */
type CreateHandler = (host: KubectlHost, t: string[], raw: string) => string;

// kubectl create secret tls <name> --cert=<datei> --key=<datei>
function createSecretTls(host: KubectlHost, t: string[], raw: string): string {
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
function createSecretGeneric(host: KubectlHost, t: string[], raw: string): string {
  const name = t[4];
  if (!name || name.startsWith("--")) return host._err("kubectl create secret: Der Name fehlt.", "Muster: kubectl create secret generic <name> --from-literal=schluessel=wert");
  { const bad = invalidNameError(host, "Secret", name); if (bad) return bad; }
  const literals = [...raw.matchAll(/--from-literal[=\s]([\w.-]+)=(\S+)/g)].map(m => m[1]);
  if (literals.length === 0) return host._err("error: at least one --from-literal is required", "Häng '--from-literal=passwort=geheim123' an.");
  if (host.secrets.some(s => s.name === name)) return host._err('error: secrets "' + name + '" already exists');
  host.secrets.push({ name, keys: literals, created: host.clock });
  return "secret/" + name + " created";
}

const createSecret: CreateHandler = (host, t, raw) => {
  if (t[3] === "tls") return createSecretTls(host, t, raw);
  if (t[3] === "generic") return createSecretGeneric(host, t, raw);
  return host._err("Der Simulator kann nur 'kubectl create secret generic <name> --from-literal=k=v' und 'kubectl create secret tls <name> --cert=… --key=…'.");
};

// kubectl create configmap <name> --from-literal=schluessel=wert
const createConfigMap: CreateHandler = (host, t, raw) => {
  const name = t[3];
  if (!name || name.startsWith("--")) return host._err("kubectl create configmap: Der Name fehlt.", "Muster: kubectl create configmap <name> --from-literal=schluessel=wert");
  { const bad = invalidNameError(host, "ConfigMap", name); if (bad) return bad; }
  const literals = [...raw.matchAll(/--from-literal[=\s]([\w.-]+)=(\S+)/g)].map(m => m[1]);
  if (literals.length === 0) return host._err("error: at least one --from-literal is required", "Häng '--from-literal=log_level=info' an.");
  if (host.configMaps.some(c => c.name === name)) return host._err('error: configmaps "' + name + '" already exists');
  host.configMaps.push({ name, keys: literals, created: host.clock });
  return "configmap/" + name + " created";
};

const createServiceAccount: CreateHandler = (host, t) => {
  const name = t[3];
  if (!name || name.startsWith("--")) return host._err("kubectl create serviceaccount: Der Name fehlt.", "Muster: kubectl create serviceaccount <name>");
  { const bad = invalidNameError(host, "ServiceAccount", name); if (bad) return bad; }
  if (host.serviceAccounts.some(s => s.name === name)) return host._err('error: serviceaccounts "' + name + '" already exists');
  host.serviceAccounts.push({ name, created: host.clock });
  return "serviceaccount/" + name + " created";
};

// kubectl create role|clusterrole <name> --verb=… --resource=… (cluster ergibt sich aus t[2])
const createRole: CreateHandler = (host, t, raw) => {
  const cluster = t[2] === "clusterrole";
  const name = t[3];
  if (!name || name.startsWith("--")) return host._err("kubectl create " + t[2] + ": Der Name fehlt.", "Muster: kubectl create " + t[2] + " <name> --verb=get,list --resource=pods");
  { const bad = invalidNameError(host, cluster ? "ClusterRole" : "Role", name); if (bad) return bad; }
  const verbs = multiFlag(raw, "verb");
  const resources = multiFlag(raw, "resource");
  if (verbs.length === 0) return host._err("error: at least one --verb must be specified", "Häng z.B. '--verb=get,list' an.");
  if (resources.length === 0) return host._err("error: at least one --resource must be specified", "Häng z.B. '--resource=pods' an.");
  const kind = cluster ? "clusterrole" : "role";
  if (host.roles.some(r => r.cluster === cluster && r.name === name)) return host._err('error: ' + kind + 's.rbac.authorization.k8s.io "' + name + '" already exists');
  host.roles.push({ name, cluster, rules: [{ verbs, resources }], created: host.clock });
  return kind + ".rbac.authorization.k8s.io/" + name + " created";
};

/** Die `--user`/`--serviceaccount`-Subjekte eines RoleBindings einsammeln (`<ns>:<sa>` oder
 *  `<sa>` → Namespace `default`). Ausgelagert aus `createRoleBinding`, damit der Dispatcher
 *  unter der Komplexitätsschwelle bleibt. */
function collectRbacSubjects(raw: string): RbacSubject[] {
  const subjects: RbacSubject[] = [];
  for (const u of multiFlag(raw, "user")) subjects.push({ kind: "User", name: u });
  for (const sa of multiFlag(raw, "serviceaccount")) {
    const [ns, n] = sa.includes(":") ? sa.split(":") : ["default", sa];
    subjects.push({ kind: "ServiceAccount", name: n, namespace: ns });
  }
  return subjects;
}

// kubectl create rolebinding|clusterrolebinding <name> --role=… --serviceaccount=…
const createRoleBinding: CreateHandler = (host, t, raw) => {
  const cluster = t[2] === "clusterrolebinding";
  const name = t[3];
  if (!name || name.startsWith("--")) return host._err("kubectl create " + t[2] + ": Der Name fehlt.", "Muster: kubectl create " + t[2] + " <name> --role=<rolle> --serviceaccount=<ns>:<sa>");
  { const bad = invalidNameError(host, cluster ? "ClusterRoleBinding" : "RoleBinding", name); if (bad) return bad; }
  const roleName = flagValue(t, "--role");
  const clusterRoleName = flagValue(t, "--clusterrole");
  // ClusterRoleBinding kann sich nur auf eine ClusterRole beziehen.
  if (cluster && roleName) return host._err("error: a ClusterRoleBinding can only reference a ClusterRole", "Nutze '--clusterrole=<name>' statt '--role'.");
  if (!roleName && !clusterRoleName) return host._err("error: exactly one of --role or --clusterrole must be specified", cluster ? "Häng '--clusterrole=<name>' an." : "Häng '--role=<name>' oder '--clusterrole=<name>' an.");
  const roleRef = clusterRoleName ? { kind: "ClusterRole" as const, name: clusterRoleName } : { kind: "Role" as const, name: roleName! };
  const subjects = collectRbacSubjects(raw);
  if (subjects.length === 0) return host._err("error: at least one of --user or --serviceaccount must be specified", "Muster: '--serviceaccount=default:deploy-bot' oder '--user=alice'.");
  const kind = cluster ? "clusterrolebinding" : "rolebinding";
  if (host.roleBindings.some(b => b.cluster === cluster && b.name === name)) return host._err('error: ' + kind + 's.rbac.authorization.k8s.io "' + name + '" already exists');
  host.roleBindings.push({ name, cluster, roleRef, subjects, created: host.clock });
  return kind + ".rbac.authorization.k8s.io/" + name + " created";
};

// kubectl create deployment <name> --image=<image>
const createDeployment: CreateHandler = (host, t, raw) => {
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
};

/** Ressourcentyp (t[2], inkl. Kurz-Aliase) → create-Handler. Reihenfolge egal (Lookup). */
const CREATE_HANDLERS: Readonly<Record<string, CreateHandler>> = {
  secret: createSecret,
  configmap: createConfigMap, cm: createConfigMap,
  serviceaccount: createServiceAccount, sa: createServiceAccount,
  role: createRole, clusterrole: createRole,
  rolebinding: createRoleBinding, clusterrolebinding: createRoleBinding,
  deployment: createDeployment,
};

export function kubectlCreate(host: KubectlHost, t: string[], raw: string): string {
  const handler = CREATE_HANDLERS[t[2]];
  if (!handler) return host._err("Der Simulator kann nur 'kubectl create deployment|serviceaccount|role|clusterrole|rolebinding|clusterrolebinding …', 'kubectl create secret generic|tls …' und 'kubectl create configmap …'.");
  return handler(host, t, raw);
}


/* ===== `kubectl delete -f <datei>` – Tabelle der aus einem Manifest löschbaren Ressourcen (#543) =====
 * Ein Eintrag je Ressourcentyp, den ein `apply -f` anlegen kann, in derselben Reihenfolge wie die
 * Ausgabe zuvor. `pick` holt das Effekt-Feld (oder undefined), `remove` entfernt es (Deployment/
 * StatefulSet über ihre Aggregat-Entferner mit Folgewirkung: Pods, beim StatefulSet bewusst OHNE
 * PVCs #122; der Rest ist schlicht „splice per Name", #518) und `msg` liefert die „… deleted"-Zeile.
 * Ein neuer apply-fähiger Typ = ein Eintrag hier (Stardew-Scope: der Löscher wächst nicht in der
 * Komplexität). */
const FILE_DELETABLE: readonly {
  pick: (eff: ApplyEffect) => { name: string } | undefined;
  remove: (host: KubectlHost, name: string) => boolean;
  msg: (name: string) => string;
}[] = [
  { pick: e => e.deployment, remove: (h, n) => !!removeDeployment(h, n), msg: n => 'deployment.apps "' + n + '" deleted' },
  { pick: e => e.service, remove: (h, n) => spliceByName(h.services, n), msg: n => 'service "' + n + '" deleted' },
  { pick: e => e.ingress, remove: (h, n) => spliceByName(h.ingresses, n), msg: n => 'ingress.networking.k8s.io "' + n + '" deleted' },
  { pick: e => e.networkPolicy, remove: (h, n) => spliceByName(h.networkPolicies, n), msg: n => 'networkpolicy.networking.k8s.io "' + n + '" deleted' },
  { pick: e => e.statefulSet, remove: (h, n) => !!removeStatefulSet(h, n), msg: n => 'statefulset.apps "' + n + '" deleted' },
  { pick: e => e.pvc, remove: (h, n) => spliceByName(h.pvcs, n), msg: n => 'persistentvolumeclaim "' + n + '" deleted' },
  { pick: e => e.pv, remove: (h, n) => spliceByName(h.pvs, n), msg: n => 'persistentvolume "' + n + '" deleted' },
  { pick: e => e.storageClass, remove: (h, n) => spliceByName(h.storageClasses, n), msg: n => 'storageclass.storage.k8s.io "' + n + '" deleted' },
  { pick: e => e.volumeSnapshot, remove: (h, n) => spliceByName(h.volumeSnapshots, n), msg: n => 'volumesnapshot.snapshot.storage.k8s.io "' + n + '" deleted' },
];

/** `kubectl delete -f <datei>` – löscht alle Ressourcen, die das Manifest angelegt hat
 *  (über die `FILE_DELETABLE`-Tabelle). */
function deleteFromFile(host: KubectlHost, t: string[]): string {
  const file = filenameArg(t);
  if (!file) return host._err("error: must specify one of -f or -k", "Muster: 'kubectl delete --filename deployment.yaml'");
  const eff = host.applyEffects[file];
  if (!eff || !host.files[file]) return host._err("error: the path \"" + file + "\" does not exist", "Mit 'ls' siehst du, welche Dateien hier liegen.");
  const out: string[] = [];
  for (const d of FILE_DELETABLE) {
    const res = d.pick(eff);
    if (res && d.remove(host, res.name)) out.push(d.msg(res.name));
  }
  return out.join("\n") || "nothing deleted";
}

/** `kubectl delete pod <name>` – Deployment-Pod (Self-Healing mit neuem Namen, #488; gibt das
 *  flüchtige emptyDir frei, #240) ODER StatefulSet-Pod (kommt mit GLEICHEM Namen + PVC zurück,
 *  Daten überleben, #122). NotFound, wenn der Name zu keinem Workload gehört. */
function deletePod(host: KubectlHost, name: string): string {
  const dep = host._findDeploymentOfPod(name);
  if (dep) {
    host.lastDeletedPod = name;
    host._resetEphemeral(dep);
    replaceDeploymentPod(dep, name, host.clock);
    return 'pod "' + name + '" deleted';
  }
  const sts = host.statefulSets.find(s => s.pods.some(p => p.name === name));
  if (sts) {
    host.lastDeletedPod = name;
    restartStatefulPod(sts, name, host.clock);
    return 'pod "' + name + '" deleted';
  }
  return host._err('Error from server (NotFound): pods "' + name + '" not found', "Pod-Namen siehst du mit 'kubectl get pods'.");
}

/** `kubectl delete pvc <name>` – gibt das gebundene PV frei: Delete-Policy entfernt es,
 *  Retain hinterlässt es als "Released". */
function deletePvc(host: KubectlHost, name: string): string {
  const idx = host.pvcs.findIndex(p => p.name === name);
  if (idx === -1) return host._err('Error from server (NotFound): persistentvolumeclaims "' + name + '" not found');
  const [removed] = host.pvcs.splice(idx, 1);
  const pv = host.pvs.find(p => p.name === removed.volume);
  if (pv) {
    if (pv.reclaimPolicy === "Retain") { pv.status = "Released"; pv.claim = ""; }
    else { const j = host.pvs.findIndex(x => x.name === pv.name); if (j >= 0) host.pvs.splice(j, 1); }
  }
  return 'persistentvolumeclaim "' + name + '" deleted';
}

export function kubectlDelete(host: KubectlHost, t: string[]) {
  const what = (t[2] || "").toLowerCase();
  const name = t[3];

  if (what === "-f" || what === "--filename" || /^(?:-f|--filename)=/.test(what)) return deleteFromFile(host, t);

  if (!name) return host._err("kubectl delete: Was und wie heißt es?", "z.B. 'kubectl delete pod <pod-name>'");

  if (["pod", "pods", "po"].includes(what)) return deletePod(host, name);
  if (["pvc", "persistentvolumeclaim", "persistentvolumeclaims"].includes(what)) return deletePvc(host, name);

  if (["deployment", "deployments", "deploy"].includes(what)) {
    if (!removeDeployment(host, name)) return host._err('Error from server (NotFound): deployments.apps "' + name + '" not found');
    return 'deployment.apps "' + name + '" deleted';
  }

  // #518: Alle schlicht löschbaren Typen (finde per Name → splice → melde) über die
  // SIMPLE_DELETABLE-Tabelle statt je eines eigenen if-Zweigs. Die Sonderfälle mit
  // Folgewirkung (statefulset behält PVCs, pvc gibt sein PV frei) bleiben eigene Zweige.
  const simple = SIMPLE_DELETABLE.find(s => s.aliases.includes(what));
  if (simple) {
    if (!spliceByName(simple.pick(host), name)) return host._err('Error from server (NotFound): ' + simple.notFoundKind + ' "' + name + '" not found');
    return simple.deletedKind + ' "' + name + '" deleted';
  }

  if (["statefulset", "statefulsets", "sts"].includes(what)) {
    // Die PVCs bleiben absichtlich erhalten – Kern der Datendauerhaftigkeit (#122).
    if (!removeStatefulSet(host, name)) return host._err('Error from server (NotFound): statefulsets.apps "' + name + '" not found');
    return 'statefulset.apps "' + name + '" deleted\n💡 Die PVCs bleiben bestehen – die Daten überleben das Löschen des StatefulSets. Skalierst du es wieder hoch, hängen die alten Volumes wieder dran.';
  }

  return host._err("kubectl delete: Ressourcentyp '" + what + "' kennt der Simulator nicht.");
}


/* ===== apply-Handler-Registry (#538) =====
 * Der frühere `kubectlApply`-Monolith (~18 sequenzielle `if (eff.<typ>)`-Blöcke) ist in
 * eine ORDNUNGSBEWAHRENDE Handler-Liste zerlegt (iSAQB Open-Closed, analog zur
 * Resource-Registry aus #499): ein neuer apply-fähiger Ressourcentyp = ein neuer Eintrag,
 * `kubectlApply` selbst bleibt unangetastet. Die Reihenfolge der Liste IST die
 * Anwendungsreihenfolge – sie zählt an einer Stelle: StorageClass + PV müssen vor
 * PVC/StatefulSet stehen, damit das Binden im selben apply schon greift.
 *
 * Jeder Handler bekommt (host, eff, out). Er ist NUR zuständig, wenn sein Feld gesetzt ist
 * (`if (!eff.<typ>) return;` als erster Schritt) und meldet Ergebniszeilen über `out.push`.
 * Ein Handler, der `string` zurückgibt, signalisiert einen FEHLER mit früher Rückgabe –
 * `kubectlApply` bricht dann ab und gibt genau diesen Text zurück (bewahrt das alte
 * `return host._err(...)`-Verhalten der PVC-dataSource-, VolumeSnapshot-Quellen- und
 * Pod-Security-Sonderfälle). Gibt er `void`/`undefined` zurück, läuft die Kette weiter.
 */
type ApplyHandler = (host: KubectlHost, eff: ApplyEffect, out: string[]) => string | void;

/** Ein bereits bestehendes Deployment deklarativ nach-konfigurieren (idempotentes apply).
 *  Nur eine geänderte SA-Zuordnung (spec.serviceAccountName, #132) ist heute „configured",
 *  sonst „unchanged". */
function reconfigureDeployment(existing: Deployment, effDep: NonNullable<ApplyEffect["deployment"]>, out: string[]): void {
  if (effDep.serviceAccountName && existing.serviceAccountName !== effDep.serviceAccountName) {
    existing.serviceAccountName = effDep.serviceAccountName;
    out.push("deployment.apps/" + effDep.name + " configured");
  } else {
    out.push("deployment.apps/" + effDep.name + " unchanged");
  }
}

/** Ein neues Deployment aus dem Manifest bauen und die optionalen Pod-Template-Felder
 *  (SA / Container-Port / Ephemeral-Storage / eigenes Image) übernehmen. Gibt bei
 *  Pod-Security-Abweisung (#126) den Fehlertext zurück (early return in `kubectlApply`). */
function createDeploymentFromManifest(host: KubectlHost, effDep: NonNullable<ApplyEffect["deployment"]>, out: string[]): string | void {
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
  // initContainer aus dem Pod-Template (#485): füllt beim Ausrollen das emptyDir vor; der (bei
  // Doppelablage doppelte) Vorbereitungs-Peak entscheidet über die ephemeral-storage-Eviction.
  if (effDep.initContainer) dep.initContainer = { fillsMi: effDep.initContainer.fillsMi, doubleStage: !!effDep.initContainer.doubleStage };
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

const applyDeployment: ApplyHandler = (host, eff, out) => {
  const effDep = eff.deployment;
  if (!effDep) return;
  const existing = host.deployments.find(d => d.name === effDep.name);
  // Deklarativ: bestehendes Deployment nach-konfigurieren, sonst neu aus dem Manifest bauen.
  if (existing) return reconfigureDeployment(existing, effDep, out);
  return createDeploymentFromManifest(host, effDep, out);
};

const applyService: ApplyHandler = (host, eff, out) => {
  const effSvc = eff.service;
  if (!effSvc) return;
  const existing = host.services.find(s => s.name === effSvc.name);
  if (existing) {
    out.push("service/" + effSvc.name + " unchanged");
    return;
  }
  // #507: Service-Anlegen zentral über die Fabrik (DNS-1123-Prüfung inklusive).
  // ExternalName (#337) → CNAME statt ClusterIP; sonst abgeleitete ClusterIP + optionaler
  // targetPort (#164). Die Fallunterscheidung macht jetzt _makeService.
  host.services.push(host._makeService({
    name: effSvc.name, type: effSvc.type,
    port: effSvc.port,
    ...(effSvc.targetPort !== undefined ? { targetPort: effSvc.targetPort } : {}),
    ...(effSvc.externalName ? { externalName: effSvc.externalName } : {}),
  }));
  out.push("service/" + effSvc.name + " created");
};

const applyIngress: ApplyHandler = (host, eff, out) => {
  const effIng = eff.ingress;
  if (!effIng) return;
  const existing = host.ingresses.find(i => i.name === effIng.name);
  if (existing) {
    // TLS am bestehenden Hafentor nachrüsten: aus HTTP wird HTTPS ("configured").
    if (effIng.tls && !existing.tls) {
      existing.tls = { secretName: effIng.tls.secretName };
      out.push("ingress.networking.k8s.io/" + effIng.name + " configured");
    } else {
      out.push("ingress.networking.k8s.io/" + effIng.name + " unchanged");
    }
    return;
  }
  host.ingresses.push({
    name: effIng.name, className: effIng.className || "nginx",
    host: effIng.host, path: effIng.path || "/",
    service: effIng.service, port: effIng.port,
    ...(effIng.tls ? { tls: { secretName: effIng.tls.secretName } } : {}),
    created: host.clock,
  });
  out.push("ingress.networking.k8s.io/" + effIng.name + " created");
};

const applyNetworkPolicy: ApplyHandler = (host, eff, out) => {
  const effNp = eff.networkPolicy;
  if (!effNp) return;
  const existing = host.networkPolicies.find(n => n.name === effNp.name);
  if (existing) {
    out.push("networkpolicy.networking.k8s.io/" + effNp.name + " unchanged");
    return;
  }
  host.networkPolicies.push({
    name: effNp.name, podSelector: effNp.podSelector || "",
    allowFrom: effNp.allowFrom || "", created: host.clock,
  });
  out.push("networkpolicy.networking.k8s.io/" + effNp.name + " created");
};

const applyApplication: ApplyHandler = (host, eff, out) => {
  const effApp = eff.application;
  if (!effApp) return;
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
    return;
  }
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
};

// Observability-CRDs (#110): legen Monitoring-Objekte an, idempotent wie die übrigen.
const applyServiceMonitor: ApplyHandler = (host, eff, out) => {
  const effSm = eff.serviceMonitor;
  if (!effSm) return;
  if (host.serviceMonitors.some(s => s.name === effSm.name)) {
    out.push("servicemonitor.monitoring.coreos.com/" + effSm.name + " unchanged");
    return;
  }
  host.serviceMonitors.push({ name: effSm.name, selector: effSm.selector, port: effSm.port || "metrics", interval: effSm.interval || "30s", created: host.clock });
  out.push("servicemonitor.monitoring.coreos.com/" + effSm.name + " created");
};

const applyPrometheusRule: ApplyHandler = (host, eff, out) => {
  const effPr = eff.prometheusRule;
  if (!effPr) return;
  if (host.prometheusRules.some(r => r.name === effPr.name)) {
    out.push("prometheusrule.monitoring.coreos.com/" + effPr.name + " unchanged");
    return;
  }
  host.prometheusRules.push({ name: effPr.name, alert: effPr.alert, expr: effPr.expr || "", forDuration: effPr.forDuration || "5m", severity: effPr.severity || "warning", created: host.clock });
  out.push("prometheusrule.monitoring.coreos.com/" + effPr.name + " created");
};

const applyGrafanaDatasource: ApplyHandler = (host, eff, out) => {
  const effDs = eff.grafanaDatasource;
  if (!effDs) return;
  if (host.grafanaDatasources.some(d => d.name === effDs.name)) {
    out.push("grafanadatasource.grafana.integreatly.org/" + effDs.name + " unchanged");
    return;
  }
  host.grafanaDatasources.push({ name: effDs.name, dsType: effDs.dsType || "prometheus", url: effDs.url || "", created: host.clock });
  out.push("grafanadatasource.grafana.integreatly.org/" + effDs.name + " created");
};

const applyGrafanaDashboard: ApplyHandler = (host, eff, out) => {
  const effGd = eff.grafanaDashboard;
  if (!effGd) return;
  if (host.grafanaDashboards.some(d => d.name === effGd.name)) {
    out.push("grafanadashboard.grafana.integreatly.org/" + effGd.name + " unchanged");
    return;
  }
  host.grafanaDashboards.push({ name: effGd.name, title: effGd.title, panels: effGd.panels || 0, created: host.clock });
  out.push("grafanadashboard.grafana.integreatly.org/" + effGd.name + " created");
};

// Stateful-Workload-CRDs (#122). Reihenfolge (siehe applyHandlers): StorageClass + PV
// vor PVC/StatefulSet, damit das Binden im selben apply schon greift.
const applyStorageClass: ApplyHandler = (host, eff, out) => {
  const effSc = eff.storageClass;
  if (!effSc) return;
  if (host.storageClasses.some(s => s.name === effSc.name)) {
    out.push("storageclass.storage.k8s.io/" + effSc.name + " unchanged");
    return;
  }
  host.storageClasses.push({ name: effSc.name, provisioner: effSc.provisioner || "rancher.io/local-path", reclaimPolicy: effSc.reclaimPolicy || "Delete", isDefault: !!effSc.isDefault, created: host.clock });
  out.push("storageclass.storage.k8s.io/" + effSc.name + " created");
};

const applyPv: ApplyHandler = (host, eff, out) => {
  const effPv = eff.pv;
  if (!effPv) return;
  if (host.pvs.some(p => p.name === effPv.name)) {
    out.push("persistentvolume/" + effPv.name + " unchanged");
    return;
  }
  host.pvs.push({ name: effPv.name, capacity: effPv.capacity || "1Gi", status: "Available", claim: "", storageClass: effPv.storageClass || "", accessModes: effPv.accessModes || "RWO", reclaimPolicy: effPv.reclaimPolicy || "Retain", created: host.clock });
  out.push("persistentvolume/" + effPv.name + " created");
};

const applyPvc: ApplyHandler = (host, eff, out) => {
  const effPvc = eff.pvc;
  if (!effPvc) return;
  if (host.pvcs.some(p => p.name === effPvc.name)) {
    out.push("persistentvolumeclaim/" + effPvc.name + " unchanged");
    return;
  }
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
};

// Backup/Restore (#140): VolumeSnapshot eines Quell-PVC. Der Snapshot friert den
// aktuellen Volume-Inhalt ein und ist ab dann ein eigenständiges Objekt – er überlebt
// das Löschen der Quelle (das ist der Sinn eines Backups).
const applyVolumeSnapshot: ApplyHandler = (host, eff, out) => {
  const effVs = eff.volumeSnapshot;
  if (!effVs) return;
  if (host.volumeSnapshots.some(v => v.name === effVs.name)) {
    out.push("volumesnapshot.snapshot.storage.k8s.io/" + effVs.name + " unchanged");
    return;
  }
  const src = host.pvcs.find(p => p.name === effVs.sourcePvc);
  if (!src) return host._err('error: the source PVC "' + effVs.sourcePvc + '" does not exist', "Eine VolumeSnapshot braucht ein vorhandenes Quell-PVC. Schau mit 'kubectl get pvc'.");
  host.volumeSnapshots.push({ name: effVs.name, sourcePvc: src.name, data: src.data || "", restoreSize: src.capacity, readyToUse: true, created: host.clock });
  out.push("volumesnapshot.snapshot.storage.k8s.io/" + effVs.name + " created");
  out.push("💡 Snapshot '" + effVs.name + "' sichert den Stand von PVC '" + src.name + "' (readyToUse). Er ist ein eigenes Objekt und überlebt das Löschen der Quelle.");
};

const applyStatefulSet: ApplyHandler = (host, eff, out) => {
  const effSts = eff.statefulSet;
  if (!effSts) return;
  if (host.statefulSets.some(s => s.name === effSts.name)) {
    out.push("statefulset.apps/" + effSts.name + " unchanged");
    return;
  }
  const sts = host._makeStatefulSet(effSts);
  addStatefulSet(host, sts);
  out.push("statefulset.apps/" + effSts.name + " created");
  out.push("💡 " + sts.replicas + " Pod(s) mit stabiler Identität (" + sts.name + "-0 …), jeder mit eigenem PVC '" + sts.volumeClaimName + "-" + sts.name + "-0' usw.");
};

// RBAC-CRDs (#128): SA / Role(+Cluster) / RoleBinding(+Cluster) deklarativ anlegen,
// idempotent wie alles andere. Genau diese Objekte wertet `kubectl auth can-i` aus.
const applyServiceAccount: ApplyHandler = (host, eff, out) => {
  const effSa = eff.serviceAccount;
  if (!effSa) return;
  if (host.serviceAccounts.some(s => s.name === effSa.name)) {
    out.push("serviceaccount/" + effSa.name + " unchanged");
    return;
  }
  host.serviceAccounts.push({ name: effSa.name, created: host.clock });
  out.push("serviceaccount/" + effSa.name + " created");
};

const applyRole: ApplyHandler = (host, eff, out) => {
  const effRole = eff.role;
  if (!effRole) return;
  const cluster = !!effRole.cluster;
  const kind = cluster ? "clusterrole" : "role";
  if (host.roles.some(r => r.name === effRole.name && r.cluster === cluster)) {
    out.push(kind + ".rbac.authorization.k8s.io/" + effRole.name + " unchanged");
    return;
  }
  host.roles.push({ name: effRole.name, cluster, rules: effRole.rules.map(rule => ({ verbs: rule.verbs.slice(), resources: rule.resources.slice() })), created: host.clock });
  out.push(kind + ".rbac.authorization.k8s.io/" + effRole.name + " created");
};

const applyRoleBinding: ApplyHandler = (host, eff, out) => {
  const effRb = eff.roleBinding;
  if (!effRb) return;
  const cluster = !!effRb.cluster;
  const kind = cluster ? "clusterrolebinding" : "rolebinding";
  if (host.roleBindings.some(b => b.name === effRb.name && b.cluster === cluster)) {
    out.push(kind + ".rbac.authorization.k8s.io/" + effRb.name + " unchanged");
    return;
  }
  host.roleBindings.push({ name: effRb.name, cluster, roleRef: { kind: effRb.roleRef.kind, name: effRb.roleRef.name }, subjects: effRb.subjects.map(s => Object.assign({}, s)), created: host.clock });
  out.push(kind + ".rbac.authorization.k8s.io/" + effRb.name + " created");
};

/** Die apply-Handler in ANWENDUNGSREIHENFOLGE. Die Reihenfolge ist bewusst identisch
 *  zur früheren Block-Reihenfolge des Monolithen; kritisch ist nur, dass StorageClass + PV
 *  vor PVC/StatefulSet stehen (Binden im selben apply). Neuer apply-Typ = ein Eintrag hier
 *  (+ ein `applyX`-Handler + das Feld in `ApplyEffect`). */
const applyHandlers: readonly ApplyHandler[] = [
  applyDeployment,
  applyService,
  applyIngress,
  applyNetworkPolicy,
  applyApplication,
  applyServiceMonitor,
  applyPrometheusRule,
  applyGrafanaDatasource,
  applyGrafanaDashboard,
  applyStorageClass,
  applyPv,
  applyPvc,
  applyVolumeSnapshot,
  applyStatefulSet,
  applyServiceAccount,
  applyRole,
  applyRoleBinding,
];

export function kubectlApply(host: KubectlHost, t: string[]) {
  const file = filenameArg(t);
  if (!file) return host._err("error: must specify one of -f or -k", "Muster: 'kubectl apply --filename deployment.yaml'");
  if (!host.files[file]) return host._err("error: the path \"" + file + "\" does not exist", "Mit 'ls' siehst du, welche Dateien hier liegen.");
  const eff = host.applyEffects[file];
  if (!eff) return host._err("error: unable to decode " + file);
  const out: string[] = [];
  for (const handler of applyHandlers) {
    // Ein Handler, der einen String zurückgibt, meldet einen Fehler mit früher Rückgabe
    // (Pod-Security-Admission, PVC-dataSource-/VolumeSnapshot-Quellen-Fehler) – exakt das
    // alte `return host._err(...)`-Verhalten: die Kette bricht ab, der Text ist das Ergebnis.
    const err = handler(host, eff, out);
    if (typeof err === "string") return err;
  }
  return out.join("\n");
}
