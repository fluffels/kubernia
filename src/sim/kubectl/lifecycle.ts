/* ===== Kubernia – kubectl Lifecycle (sim/kubectl/lifecycle.ts) =====
 * Die Ressourcen-Lebenszyklus-Befehle: `create` (imperativ anlegen), `apply -f`
 * (deklarativ aus Manifest, größter Block: alle CRDs/Workloads/RBAC/Observability/
 * Storage) und `delete` (löschen, inkl. `-f`). Die drei teilen sich die
 * Pod-Security-Admission (`admitNewPods` aus ./rollout) und – beim `apply` einer
 * Argo-Application – das Reconcile aus ../argocd.
 *
 * Phaser-frei (pure Domäne): nutzt `makePodName` aus ../util, Domänentypen aus
 * ../state und das KubectlHost-Interface (./host). Aufgerufen aus dem
 * kubectl-Dispatch (../kubectl.ts).
 */
import { type ApplyEffect, type ArgoApp, type RbacSubject } from "../state";
import { addDeployment, removeDeployment, addStatefulSet, removeStatefulSet, replaceDeploymentPod, restartStatefulPod, statefulPodClaimName } from "../workload";
// Argo-CD-Reconcile/-Klon liegen seit #378 bei der argocd-Familie in ../argocd – `kubectl apply -f`
// einer Application zieht/kloniert den Soll direkt darüber (statt über eine Host-Methode).
import { findClusterPod } from "../pods";
import { argoReconcile, cloneChildSpec } from "../argocd";
import { assertNever } from "../../core/assert";
import { isResourceName, rfc1123ErrorText, RFC1123_TIP } from "../names";
import { sameRbac } from "../rbac";
import { admitNewPods } from "./rollout";
import { qualified, type ResourceKind, type ResourcePlural } from "./resources";
import { exactlyOneName, notSimulated, replicasArg } from "./args";
import { readTargets, targetOutcome, type Target } from "./targets";
import { subEntry, type Call } from "../cliargs";
import { applyDeployment } from "./apply-deployment";
import { fileEffects, type ManifestVerb } from "../manifest/registry";
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
 * Eintrag je Typ (Schlüssel = Plural aus ./resources) statt eines eigenen if-Zweigs; Aliase und die
 * qualifizierten Namen der NotFound-/„… deleted"-Zeilen kommen aus der Registry. Die Sonderfälle
 * (pod/deployment/statefulset/pvc) stehen in `DELETE_SPECIAL`. */
const SIMPLE_DELETABLE: ReadonlyMap<ResourcePlural, (host: KubectlHost) => { name: string }[]> = new Map<ResourcePlural, (host: KubectlHost) => { name: string }[]>([
  ["services", (h: KubectlHost) => h.services],
  ["configmaps", (h: KubectlHost) => h.configMaps],
  ["secrets", (h: KubectlHost) => h.secrets],
  ["ingresses", (h: KubectlHost) => h.ingresses],
  ["networkpolicies", (h: KubectlHost) => h.networkPolicies],
  ["persistentvolumes", (h: KubectlHost) => h.pvs],
  ["storageclasses", (h: KubectlHost) => h.storageClasses],
  ["volumesnapshots", (h: KubectlHost) => h.volumeSnapshots],
]);


/* ===== `kubectl create <typ> …` – ein Handler je Ressourcentyp (#543) =====
 * Der frühere Monolith (complexity 63, ein `if (t[2] === …)`-Block je Typ) ist in fokussierte
 * Handler zerlegt, verdrahtet über die `CREATE_HANDLERS`-Tabelle (dieselbe Registry-Idee wie
 * `applyHandlers` / `SIMPLE_DELETABLE`). Ein neuer create-fähiger Typ = ein Handler + ein
 * Tabellen-Eintrag; `kubectlCreate` selbst bleibt ein dünner Dispatcher (Stardew-Scope: wächst
 * nicht in der Komplexität, egal wie viele Ressourcentypen dazukommen). Alle Handler bekommen den
 * `Call` (#1487): `c.args` ist die Eingabe ab dem Typ (`deployment web`), Flags stehen überall. */
type CreateHandler = (host: KubectlHost, c: Call) => string;

/** Der EINE Namens-Vorspann aller create-Handler: genau ein NAME (sonst der echte kubectl-Text samt deutschem
 *  Muster) und gültig nach DNS-1123. `names` sind die Argumente hinter dem Typ; ein String ist die Fehlerausgabe. */
function createName(host: KubectlHost, names: readonly string[], kind: string, muster: string): { name: string } | string {
  const arity = exactlyOneName(host, names, muster);
  if (arity) return arity;
  return invalidNameError(host, kind, names[0]) ?? { name: names[0] };
}

/** Die `<schluessel>`-Teile der `--from-literal=<schluessel>=<wert>`-Angaben (die Form hat die Flag-Tabelle schon geprüft). */
const literalKeys = (c: Call): string[] => c.values("--from-literal").map(v => v.slice(0, v.indexOf("=")));

/** secret tls <name> --cert=<datei> --key=<datei> */
const SECRET_TLS_MUSTER = "Muster: kubectl create secret tls <name> --cert=tls.crt --key=tls.key";
function createSecretTls(host: KubectlHost, c: Call): string {
  const n = createName(host, c.args.slice(2), "Secret", SECRET_TLS_MUSTER);
  if (typeof n === "string") return n;
  if (!c.value("--cert") || !c.value("--key")) return host._err("error: key and cert must be specified", "Häng '--cert=tls.crt --key=tls.key' an.");
  if (host.secrets.some(s => s.name === n.name)) return host._err('error: secrets "' + n.name + '" already exists');
  host.secrets.push({ name: n.name, keys: ["tls.crt", "tls.key"], type: "kubernetes.io/tls", created: host.clock });
  return "secret/" + n.name + " created";
}

/** secret generic <name> --from-literal=schluessel=wert */
function createSecretGeneric(host: KubectlHost, c: Call): string {
  const n = createName(host, c.args.slice(2), "Secret", "Muster: kubectl create secret generic <name> --from-literal=schluessel=wert");
  if (typeof n === "string") return n;
  const literals = literalKeys(c);
  if (literals.length === 0) return host._err("error: at least one --from-literal is required", "Häng '--from-literal=passwort=geheim123' an.");
  if (host.secrets.some(s => s.name === n.name)) return host._err('error: secrets "' + n.name + '" already exists');
  host.secrets.push({ name: n.name, keys: literals, created: host.clock });
  return "secret/" + n.name + " created";
}

/** Die secret-Arten (`create secret <art> …`): ein Eintrag je Art, `CREATE_SECRET_KANN` leitet sich daraus ab. */
const SECRET_KINDS: Readonly<Record<string, CreateHandler>> = { generic: createSecretGeneric, tls: createSecretTls };
const CREATE_SECRET_KANN = ["kubectl create secret generic <name> --from-literal=k=v", "kubectl create secret tls <name> --cert=… --key=…"];

const createSecret: CreateHandler = (host, c) => {
  const sub = c.args[1] ?? "";
  const handler = subEntry(SECRET_KINDS, sub);
  return handler ? handler(host, c) : notSimulated(host, "'kubectl create secret " + sub + "'.", CREATE_SECRET_KANN);
};

// kubectl create configmap <name> --from-literal=schluessel=wert
const createConfigMap: CreateHandler = (host, c) => {
  const n = createName(host, c.args.slice(1), "ConfigMap", "Muster: kubectl create configmap <name> --from-literal=schluessel=wert");
  if (typeof n === "string") return n;
  const literals = literalKeys(c);
  if (literals.length === 0) return host._err("error: at least one --from-literal is required", "Häng '--from-literal=log_level=info' an.");
  if (host.configMaps.some(m => m.name === n.name)) return host._err('error: configmaps "' + n.name + '" already exists');
  host.configMaps.push({ name: n.name, keys: literals, created: host.clock });
  return "configmap/" + n.name + " created";
};

const createServiceAccount: CreateHandler = (host, c) => {
  const n = createName(host, c.args.slice(1), "ServiceAccount", "Muster: kubectl create serviceaccount <name>");
  if (typeof n === "string") return n;
  if (host.serviceAccounts.some(s => s.name === n.name)) return host._err('error: serviceaccounts "' + n.name + '" already exists');
  host.serviceAccounts.push({ name: n.name, created: host.clock });
  return "serviceaccount/" + n.name + " created";
};

/** Die Verben, die kubectl ohne Warnung annimmt (`validResourceVerbs` in `create_role.go`). Ein anderes Verb legt die
 *  Rolle trotzdem an (kubectl warnt seit v0.20 nur noch), die Sim zeigt dieselbe Warnung. */
const RESOURCE_VERBS = ["*", "get", "delete", "list", "create", "update", "patch", "watch", "proxy", "deletecollection", "use", "bind", "escalate", "impersonate"];

// kubectl create role|clusterrole <name> --verb=… --resource=… (cluster ergibt sich aus dem Typ)
const createRole: CreateHandler = (host, c) => {
  const typ = c.args[0];
  const cluster = typ === "clusterrole";
  const n = createName(host, c.args.slice(1), cluster ? "ClusterRole" : "Role", "Muster: kubectl create " + typ + " <name> --verb=get,list --resource=pods");
  if (typeof n === "string") return n;
  const verbs = c.list("--verb");
  const resources = c.list("--resource");
  if (verbs.length === 0) return host._err("error: at least one verb must be specified", "Häng z.B. '--verb=get,list' an.");
  if (resources.length === 0) return host._err("error: at least one resource must be specified", "Häng z.B. '--resource=pods' an.");
  const kind = cluster ? "clusterrole" : "role";
  if (host.roles.some(r => sameRbac(r, { name: n.name, cluster }))) return host._err('error: ' + kind + 's.rbac.authorization.k8s.io "' + n.name + '" already exists');
  host.roles.push({ name: n.name, cluster, rules: [{ verbs, resources }], created: host.clock });
  const warnings = verbs.filter(v => !RESOURCE_VERBS.includes(v)).map(v => "Warning: '" + v + "' is not a standard resource verb\n");
  return warnings.join("") + kind + ".rbac.authorization.k8s.io/" + n.name + " created";
};

/** Die `--user`/`--serviceaccount`-Subjekte eines RoleBindings einsammeln (`<ns>:<sa>`, die Form hat die Flag-Tabelle
 *  schon geprüft). Beide Flags sind StringArray: eine Angabe wird nicht an Kommas gesplittet. */
function collectRbacSubjects(c: Call): RbacSubject[] {
  const subjects: RbacSubject[] = c.values("--user").map(u => ({ kind: "User", name: u }));
  for (const sa of c.values("--serviceaccount")) {
    const [ns, name] = sa.split(":");
    subjects.push({ kind: "ServiceAccount", name, namespace: ns });
  }
  return subjects;
}

// kubectl create rolebinding|clusterrolebinding <name> --role=… --serviceaccount=…
const createRoleBinding: CreateHandler = (host, c) => {
  const typ = c.args[0];
  const cluster = typ === "clusterrolebinding";
  const n = createName(host, c.args.slice(1), cluster ? "ClusterRoleBinding" : "RoleBinding", "Muster: kubectl create " + typ + " <name> --role=<rolle> --serviceaccount=<ns>:<sa>");
  if (typeof n === "string") return n;
  const roleName = c.value("--role");
  const clusterRoleName = c.value("--clusterrole");
  // ClusterRoleBinding kann sich nur auf eine ClusterRole beziehen.
  if (cluster && roleName) return host._err("error: a ClusterRoleBinding can only reference a ClusterRole", "Nutze '--clusterrole=<name>' statt '--role'.");
  if (!roleName && !clusterRoleName) return host._err("error: exactly one of --role or --clusterrole must be specified", cluster ? "Häng '--clusterrole=<name>' an." : "Häng '--role=<name>' oder '--clusterrole=<name>' an.");
  const roleRef = clusterRoleName ? { kind: "ClusterRole" as const, name: clusterRoleName } : { kind: "Role" as const, name: roleName! };
  const subjects = collectRbacSubjects(c);
  if (subjects.length === 0) return host._err("error: at least one of --user or --serviceaccount must be specified", "Muster: '--serviceaccount=default:deploy-bot' oder '--user=alice'.");
  const kind = cluster ? "clusterrolebinding" : "rolebinding";
  if (host.roleBindings.some(b => sameRbac(b, { name: n.name, cluster }))) return host._err('error: ' + kind + 's.rbac.authorization.k8s.io "' + n.name + '" already exists');
  host.roleBindings.push({ name: n.name, cluster, roleRef, subjects, created: host.clock });
  return kind + ".rbac.authorization.k8s.io/" + n.name + " created";
};

// kubectl create deployment <name> --image=<image>
const createDeployment: CreateHandler = (host, c) => {
  const n = createName(host, c.args.slice(1), "Deployment", "z.B. 'kubectl create deployment kasse --image=nginx'");
  if (typeof n === "string") return n;
  const images = c.list("--image");
  if (images.length === 0) return host._err("error: required flag(s) \"image\" not set", "Häng '--image=nginx' an.");
  if (images.length > 1) return notSimulated(host, "mehrere Container (mehrfaches '--image').", ["kubectl create deployment <name> --image=<image>"], "Ein Deployment hat in der Sim genau einen Container.");
  const rep = replicasArg(host, c);
  if ("error" in rep) return rep.error;
  const replicas = rep.replicas ?? 1;
  if (replicas < 0) return host._err('error: invalid argument "' + replicas + '" for "--replicas" flag', "Die Replica-Zahl ist eine ganze Zahl ab 0, z.B. '--replicas=2'.");
  if (host.deployments.some(d => d.name === n.name)) return host._err('error: deployment "' + n.name + '" already exists');
  // Pod-Security-Admission: ein imperativ erzeugtes Deployment hat keinen securityContext.
  // Unter baseline/restricted wird es deshalb abgelehnt (privileged = keine Prüfung).
  const denied = admitNewPods(host, n.name, undefined);
  if (denied) return denied;
  addDeployment(host, host._makeDeployment(n.name, images[0], replicas));
  return "deployment.apps/" + n.name + " created";
};

/** Ressourcentyp (erstes Argument, inkl. Kurz-Aliase) → create-Handler. Reihenfolge egal (Lookup). */
const CREATE_HANDLERS: Readonly<Record<string, CreateHandler>> = {
  secret: createSecret,
  configmap: createConfigMap, cm: createConfigMap,
  serviceaccount: createServiceAccount, sa: createServiceAccount,
  role: createRole, clusterrole: createRole,
  rolebinding: createRoleBinding, clusterrolebinding: createRoleBinding,
  deployment: createDeployment, deploy: createDeployment,
};

export function kubectlCreate(host: KubectlHost, c: Call): string {
  const typ = c.args[0] ?? "";
  const handler = subEntry(CREATE_HANDLERS, typ);
  if (!handler) return notSimulated(host, "'kubectl create " + typ + "'.", ["kubectl create deployment|serviceaccount|role|clusterrole|rolebinding|clusterrolebinding …", ...CREATE_SECRET_KANN, "kubectl create configmap …"]);
  return handler(host, c);
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

/** Gemeinsamer Vorspann von `apply -f` und `delete -f`: die Datei lesen und zu Effekten auflösen.
 *  Der Dateiinhalt hat Vorrang (Mapper-Kinds); der hinterlegte Effekt dient als Rückfall und für
 *  Sim-Sonderfelder (#1299). Ein String ist die fertige Fehlerausgabe. */
function effectsOfFile(host: KubectlHost, file: string, verb: ManifestVerb): ApplyEffect[] | string {
  const content = host.files[file];
  if (typeof content !== "string") return host._err("error: the path \"" + file + "\" does not exist", "Mit 'ls' siehst du, welche Dateien hier liegen.");
  const effects = fileEffects(host.applyEffects[file], content, file, verb);
  return Array.isArray(effects) ? effects : host._err(effects.error, effects.hint);
}

/** `kubectl delete -f <datei>` – löscht alle Ressourcen, die das Manifest angelegt hat
 *  (über die `FILE_DELETABLE`-Tabelle). */
function deleteFromFile(host: KubectlHost, file: string): string {
  if (!file) return host._err("error: must specify one of -f or -k", "Muster: 'kubectl delete --filename deployment.yaml'");
  const effects = effectsOfFile(host, file, "delete");
  if (typeof effects === "string") return effects;
  const out: string[] = [];
  for (const eff of effects) {
    for (const d of FILE_DELETABLE) {
      const res = d.pick(eff);
      if (res && d.remove(host, res.name)) out.push(d.msg(res.name));
    }
  }
  return out.join("\n") || "nothing deleted";
}

/** Ein Löscher: `null` = es gibt kein Objekt dieses Namens, sonst die Erfolgszeile. */
type Deleter = (host: KubectlHost, name: string) => string | null;

/** `kubectl delete pod <name>` – Deployment-Pod (Self-Healing mit neuem Namen, #488; gibt das
 *  flüchtige emptyDir frei, #240) ODER StatefulSet-Pod (kommt mit GLEICHEM Namen + PVC zurück,
 *  Daten überleben, #122). `null`, wenn der Name zu keinem Workload gehört. */
function deletePod(host: KubectlHost, name: string): string | null {
  const c = findClusterPod(host, name);
  if (!c) return null;
  host.lastDeletedPod = name;
  switch (c.owner) {
    case "Deployment":
      host._resetEphemeral(c.dep);
      replaceDeploymentPod(c.dep, name, host.clock, host.rng);
      break;
    case "StatefulSet":
      restartStatefulPod(c.sts, name, host.clock);
      break;
    default:
      // Neue Workload-Art ⇒ Compile-Fehler hier statt still ohne Ersatz-Pod (#1414).
      return assertNever(c, "kubectl delete pod");
  }
  return 'pod "' + name + '" deleted';
}

/** `kubectl delete pvc <name>` – gibt das gebundene PV frei: Delete-Policy entfernt es,
 *  Retain hinterlässt es als "Released". */
function deletePvc(host: KubectlHost, name: string): string | null {
  const idx = host.pvcs.findIndex(p => p.name === name);
  if (idx === -1) return null;
  const [removed] = host.pvcs.splice(idx, 1);
  const pv = host.pvs.find(p => p.name === removed.volume);
  if (pv) {
    if (pv.reclaimPolicy === "Retain") { pv.status = "Released"; pv.claim = ""; }
    else { const j = host.pvs.findIndex(x => x.name === pv.name); if (j >= 0) host.pvs.splice(j, 1); }
  }
  return 'persistentvolumeclaim "' + name + '" deleted';
}

function deleteDeployment(host: KubectlHost, name: string): string | null {
  return removeDeployment(host, name) ? 'deployment.apps "' + name + '" deleted' : null;
}

function deleteStatefulSet(host: KubectlHost, name: string): string | null {
  // Die PVCs bleiben absichtlich erhalten – Kern der Datendauerhaftigkeit (#122).
  if (!removeStatefulSet(host, name)) return null;
  return 'statefulset.apps "' + name + '" deleted\n💡 Die PVCs bleiben bestehen – die Daten überleben das Löschen des StatefulSets. Skalierst du es wieder hoch, hängen die alten Volumes wieder dran.';
}

/** Die Sonderfälle mit Folgewirkung (Pod: Self-Healing, PVC: gibt sein PV frei, StatefulSet: behält die
 *  PVCs, Deployment: Pods) – Schlüssel = Plural aus ./resources. */
const DELETE_SPECIAL: Readonly<Partial<Record<ResourcePlural, Deleter>>> = {
  pods: deletePod,
  persistentvolumeclaims: deletePvc,
  deployments: deleteDeployment,
  statefulsets: deleteStatefulSet,
};

/** Der Löscher einer Art (#518: die schlicht löschbaren Typen über `SIMPLE_DELETABLE` statt je eines eigenen
 *  Zweigs); `undefined`, wenn die Sim die Art nicht löschen kann. */
function deleterOf(kind: ResourceKind): Deleter | undefined {
  const special = DELETE_SPECIAL[kind.plural];
  if (special) return special;
  const pick = SIMPLE_DELETABLE.get(kind.plural);
  if (!pick) return undefined;
  return (host, name) => (spliceByName(pick(host), name) ? qualified(kind, "singular") + ' "' + name + '" deleted' : null);
}

/** Die Löscher aller Ziele; eine Art, die die Sim nicht löschen kann, lehnt den ganzen Befehl ab (vor der ersten Löschung). */
function deletePlan(host: KubectlHost, targets: Target[]): Array<{ target: Target; del: Deleter }> | string {
  const plan: Array<{ target: Target; del: Deleter }> = [];
  for (const target of targets) {
    const del = deleterOf(target.kind);
    if (!del) return notSimulated(host, "'kubectl delete " + target.kind.plural + "'.", ["kubectl delete " + [...Object.keys(DELETE_SPECIAL), ...SIMPLE_DELETABLE.keys()].join("|") + " <name>"]);
    plan.push({ target, del });
  }
  return plan;
}

/** Je Ziel eine Zeile (kubectl `ContinueOnError`): ein fehlendes Objekt stoppt die übrigen Löschungen nicht, seine
 *  NotFound-Zeile steht erst hinter allen Erfolgen. */
function deleteAll(host: KubectlHost, plan: Array<{ target: Target; del: Deleter }>): string {
  const ok: string[] = [];
  const failed: string[] = [];
  let firstMissing: ResourceKind | null = null;
  for (const { target, del } of plan) {
    for (const name of target.names) {
      const done = del(host, name);
      if (done !== null) { ok.push(done); continue; }
      failed.push('Error from server (NotFound): ' + qualified(target.kind, "plural") + ' "' + name + '" not found');
      firstMissing ??= target.kind;
    }
  }
  return targetOutcome(host, ok, failed, "Namen siehst du mit 'kubectl get " + (firstMissing?.plural ?? "pods") + "'.");
}

/** Der Builder lehnt `-f` zusammen mit Art und Name ab (nichts wird gelöscht). */
const DELETE_FILE_AND_ARGS_ERROR = "error: when paths, URLs, or stdin is provided as input, you may not specify a resource by arguments as well";

export function kubectlDelete(host: KubectlHost, c: Call): string {
  const file = c.value("-f", "--filename");
  if (file !== null) {
    return c.args.length > 0 ? host._err(DELETE_FILE_AND_ARGS_ERROR, "Entweder '-f <datei>' oder Art und Name, nicht beides.") : deleteFromFile(host, file);
  }
  const parsed = readTargets(host, c.args);
  if ("error" in parsed) return parsed.error;
  if (parsed.targets.length === 0 || parsed.targets.some(t => t.names.length === 0)) {
    return host._err("kubectl delete: Was und wie heißt es?", "z.B. 'kubectl delete pod <pod-name>'");
  }
  const plan = deletePlan(host, parsed.targets);
  return typeof plan === "string" ? plan : deleteAll(host, plan);
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
  host.services.push(host._makeService(effSvc));
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
  out.push("💡 " + sts.replicas + " Pod(s) mit stabiler Identität (" + sts.name + "-0 …), jeder mit eigenem PVC '" + statefulPodClaimName(sts, { name: sts.name + "-0" }) + "' usw.");
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
  if (host.roles.some(r => sameRbac(r, { name: effRole.name, cluster }))) {
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
  if (host.roleBindings.some(b => sameRbac(b, { name: effRb.name, cluster }))) {
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

export function kubectlApply(host: KubectlHost, c: Call) {
  const file = c.value("-f", "--filename");
  if (!file) return host._err("error: must specify one of -f or -k", "Muster: 'kubectl apply --filename deployment.yaml'");
  const effects = effectsOfFile(host, file, "apply");
  if (typeof effects === "string") return effects;
  const out: string[] = [];
  for (const eff of effects) {
    for (const handler of applyHandlers) {
      // Ein Handler, der einen String zurückgibt, meldet einen Fehler mit früher Rückgabe
      // (Pod-Security-Admission, PVC-dataSource-/VolumeSnapshot-Quellen-Fehler) – exakt das
      // alte `return host._err(...)`-Verhalten: die Kette bricht ab, der Text ist das Ergebnis.
      const err = handler(host, eff, out);
      if (typeof err === "string") return err;
    }
  }
  return out.join("\n");
}
