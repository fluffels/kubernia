/* ===== Kubernia – kubectl Workload-Ops (sim/kubectl/ops.ts) =====
 * Befehle, die an einem BEREITS bestehenden Workload drehen (statt Ressourcen
 * anzulegen/zu löschen): `scale`, `expose`, `set image|env|resources`, `rollout
 * restart`. Inklusive der set-Unterhelfer (`kubectlSetEnv`/`kubectlSetImage`/
 * `kubectlSetResources`).
 *
 * Phaser-frei (pure Domäne): nutzt nur `makePodName` aus ../util und das
 * KubectlHost-Interface (./host). Aufgerufen aus dem kubectl-Dispatch (../kubectl.ts).
 */
import { changeImage, setMemoryLimit, setCpuLimit, healsOom, throttlesCpu, restoreRsTemplate, MEM_HEALED_NOTE, CPU_THROTTLED_NOTE } from "../workload";
import { maxRestartedAt, rolloutRevisions, undoTarget } from "../replicasets";
import type { Deployment } from "../state";
import type { KubectlHost } from "./host";
import { rollOut, scaleTo } from "./rollout";
import { notSimulated, parseFromRef, parseResourceList, replicasArg, type KubectlSub, type ResourceList } from "./args";
import { readTargets, targetOutcome } from "./targets";
import { subEntry, type Call } from "../cliargs";

/** Die NotFound-Zeile eines Deployments (ohne Fehlerrahmen: die Mehrfachziel-Befehle sammeln sie in `failed`). */
const deploymentNotFound = (name: string): string => 'Error from server (NotFound): deployments.apps "' + name + '" not found';

const DEPLOYMENTS_TIP = "Welche Deployments es gibt: 'kubectl get deployments'";

/** Die Deployment-Namen der Ziele, die scale/expose/set/rollout gemeinsam annehmen (`deploy/a deploy/b`, `deployment a b`;
 *  Zerlegung und Fehlertexte: ./targets). Eine andere Art als Deployment (`scale pods/x`) ist „nicht simuliert“ und
 *  lehnt den ganzen Befehl ab, bevor etwas geändert wird. Ohne Ziel ist die Liste leer. */
function deploymentNames(host: KubectlHost, sub: KubectlSub, args: readonly string[]): { names: string[] } | { error: string } {
  const parsed = readTargets(host, args);
  if ("error" in parsed) return parsed;
  const other = parsed.targets.find(t => t.kind.plural !== "deployments");
  if (other) return { error: notSimulated(host, "'kubectl " + sub + " " + other.kind.plural + "/<name>' – das geht nur für Deployments.", ["kubectl " + sub + " deployment <name> …"]) };
  return { names: parsed.targets.flatMap(t => t.names) };
}

/** Wie `deploymentNames`, aber für Befehle, die genau EIN Deployment ändern (expose, set): weitere Ziele lehnt die Sim ab,
 *  statt sie still zu ignorieren. `name` ist `null` ohne Ziel. */
function singleDeployment(host: KubectlHost, sub: KubectlSub, args: readonly string[]): { name: string | null } | { error: string } {
  const r = deploymentNames(host, sub, args);
  if ("error" in r) return r;
  if (r.names.length > 1) return { error: notSimulated(host, "mehrere Ziele bei 'kubectl " + sub + "'.", ["kubectl " + sub + " deployment <name> …"]) };
  return { name: r.names[0] ?? null };
}

/** Auf mehrere Deployments skalieren: je Name eine Zeile, ein fehlendes oder abgewiesenes Ziel stoppt die übrigen nicht. */
function scaleAll(host: KubectlHost, names: readonly string[], replicas: number): string {
  const ok: string[] = [];
  const failed: string[] = [];
  let missing = false;
  for (const name of names) {
    const dep = host.deployments.find(d => d.name === name);
    if (!dep) { failed.push(deploymentNotFound(name)); missing = true; continue; }
    const denied = scaleTo(host, dep, replicas);
    if (denied) failed.push(denied); else ok.push("deployment.apps/" + name + " scaled");
  }
  return targetOutcome(host, ok, failed, missing ? DEPLOYMENTS_TIP : undefined);
}

export function kubectlScale(host: KubectlHost, c: Call) {
  const dn = deploymentNames(host, "scale", c.args);
  if ("error" in dn) return dn.error;
  const rep = replicasArg(host, c);
  if ("error" in rep) return rep.error;
  if (dn.names.length === 0 || rep.replicas === null) return host._err("kubectl scale: So nicht ganz.", "Muster: 'kubectl scale deployment <name> --replicas=3'");
  if (rep.replicas < 0) return host._err("error: The --replicas=COUNT flag is required, and COUNT must be greater than or equal to 0");
  return scaleAll(host, dn.names, rep.replicas);
}


export function kubectlExpose(host: KubectlHost, c: Call) {
  const one = singleDeployment(host, "expose", c.args);
  if ("error" in one) return one.error;
  const name = one.name;
  const port = c.value("--port");
  if (!name) return host._err("kubectl expose: Welches Deployment?", "Muster: 'kubectl expose deployment <name> --port=80'");
  const dep = host.deployments.find(d => d.name === name);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + name + '" not found');
  if (!port) return host._err("error: couldn't find port via --port flag or introspection", "Häng '--port=80' an.");
  if (+port < 1 || +port > 65535) return host._err('The Service "' + name + '" is invalid: spec.ports[0].port: Invalid value: ' + +port + ": must be between 1 and 65535, inclusive");
  if (host.services.some(s => s.name === name)) return host._err('Error from server (AlreadyExists): services "' + name + '" already exists');
  // --target-port: an welchen Container-Port der Service weiterleitet (#164). Fehlt es,
  // gilt --port auch als Ziel (wie in echtem kubectl).
  const targetPort = c.value("--target-port");
  // #507: Service-Anlegen zentral über die Fabrik (DNS-1123-Prüfung inklusive).
  host.services.push(host._makeService({
    name,
    type: c.value("--type") || undefined,
    port: String(+port),
    ...(targetPort ? { targetPort } : {}),
  }));
  return "service/" + name + " exposed";
}

/** Die `set`-Aktionen (#1487): ein Eintrag je Aktion; `c.args` beginnt bei der Aktion (`image deployment/web web=nginx`). */
const SET_ACTIONS: Readonly<Record<string, (host: KubectlHost, c: Call) => string>> = {
  image: (host, c) => kubectlSetImage(host, c),
  env: (host, c) => kubectlSetEnv(host, c),
  resources: (host, c) => kubectlSetResources(host, c),
};

/** kubectl set image|env|resources – dispatcht über `SET_ACTIONS`. */
export function kubectlSet(host: KubectlHost, c: Call) {
  const action = c.args[0] ?? "";
  const run = subEntry(SET_ACTIONS, action);
  if (run) return run(host, c);
  return notSimulated(host, "'kubectl set " + action + "'.", Object.keys(SET_ACTIONS).map(a => "kubectl set " + a + " …"), "Muster: 'kubectl set env deployment/<name> --from=configmap/<name>'.");
}

/** kubectl set env deployment/<name> --from=configmap/<name> | --from=secret/<name>
 *  Bindet eine ConfigMap (harmlose Config) oder ein Secret (Vertrauliches) als
 *  Umgebungsvariablen in ein Deployment ein. */

function kubectlSetEnv(host: KubectlHost, c: Call) {
  const rest = c.args.slice(1);
  if (rest.some(x => x.includes("="))) return notSimulated(host, "'KEY=wert' bei 'kubectl set env'.", ["kubectl set env deployment/<name> --from=configmap/<name>|secret/<name>"]);
  const one = singleDeployment(host, "set", rest);
  if ("error" in one) return one.error;
  const depName = one.name;
  if (!depName) return host._err("kubectl set env: Welches Deployment?", "Muster: kubectl set env deployment/<name> --from=configmap/<name>");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err(deploymentNotFound(depName), DEPLOYMENTS_TIP);
  const from = c.value("--from");
  if (!from) return host._err("kubectl set env: Womit einbinden?", "Muster: kubectl set env deployment/<name> --from=configmap/<name> (oder --from=secret/<name>)");
  const ref = parseFromRef(host, from);
  if (typeof ref === "string") return ref;
  const refName = ref.name;
  if (ref.kind === "configmaps") {
    if (!host.configMaps.some(c => c.name === refName)) return host._err('error: configmaps "' + refName + '" not found', "Erst anlegen: kubectl create configmap " + refName + " --from-literal=k=v");
    if (!dep.envFrom.configMaps.includes(refName)) dep.envFrom.configMaps.push(refName);
  } else {
    if (!host.secrets.some(s => s.name === refName)) return host._err('error: secrets "' + refName + '" not found', "Erst anlegen: kubectl create secret generic " + refName + " --from-literal=k=v");
    if (!dep.envFrom.secrets.includes(refName)) dep.envFrom.secrets.push(refName);
  }
  return "deployment.apps/" + depName + " env updated";
}

/** kubectl set image deployment/<name> <container>=<image> */

function kubectlSetImage(host: KubectlHost, c: Call) {
  // Der Deployment-Name enthält nie ein "=": Tokens mit "=" sind <container>=<image>-Paare, die übrigen die Ziele.
  const rest = c.args.slice(1);
  const pairs = rest.filter(x => x.includes("="));
  if (pairs.length > 1) return notSimulated(host, "mehrere Container in 'kubectl set image'.", ["kubectl set image deployment/<name> <container>=<image>"]);
  const one = singleDeployment(host, "set", rest.filter(x => !x.includes("=")));
  if ("error" in one) return one.error;
  const depName = one.name;
  const kv = pairs[0];
  if (!depName || !kv) return host._err("kubectl set image: So nicht ganz.", "Muster: kubectl set image deployment/<name> <container>=<image>");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found');
  const newImage = kv.slice(kv.indexOf("=") + 1);
  const oldBad = dep.broken && dep.broken.type === "imagepull" ? dep.broken.badImage : null;
  // Anderes Image = neues Pod-Template = Rollout (Admission inklusive); gleiches Image: nichts.
  if (dep.image !== newImage) {
    const denied = rollOut(host, dep, () => { changeImage(dep, newImage); });
    if (denied) return denied;
  }
  return "deployment.apps/" + depName + " image updated" + (oldBad && newImage === oldBad ? "\n💡 Hmm – das ist exakt dasselbe (kaputte) Image. Schau nochmal genau auf den Namen!" : "");
}

/** Die validierten Limits von `set resources` (alles vor der ersten Mutation): `cpu` ist `null` ohne CPU-Limit. */
interface ResourcePlan { mem?: number; cpu: number | null; eph?: number }

/** Plan anwenden (reine Mutation, Admission/Rollout macht der Aufrufer). Die Notiz-Reihenfolge ist
 *  Speicher → CPU → ephemeral. Ephemeral analog memory (#240): reicht der PEAK (#485) jetzt, wird
 *  der Pod nicht mehr evictet. */
function applyResourcePlan(host: KubectlHost, dep: Deployment, plan: ResourcePlan, notes: string[]): void {
  const wasEvicted = !!dep.evicted;
  if (plan.mem !== undefined && setMemoryLimit(dep, plan.mem)) notes.push("\n" + MEM_HEALED_NOTE);
  if (plan.cpu !== null && setCpuLimit(dep, plan.cpu)) notes.push("\n" + CPU_THROTTLED_NOTE);
  if (plan.eph === undefined) return;
  dep.ephemeralLimit = plan.eph;
  if (wasEvicted && host._depEphemeralPeak(dep) <= plan.eph) {
    notes.push("\n💡 Genug ephemeral-storage! Der Pod wird nicht mehr evictet – prüfe mit 'kubectl get pods'.");
  }
}

/** Plan anwenden. Nur eine Heilung (OOM/CPU) rollt neue Pods aus – dann in EINEM Rollout mit
 *  Pod-Security-Admission. Fehlertext bei Ablehnung (dann unverändert), sonst `null`. */
function applyWithRollout(host: KubectlHost, dep: Deployment, plan: ResourcePlan, notes: string[]): string | null {
  const heals = (plan.mem !== undefined && healsOom(dep, plan.mem)) || (plan.cpu !== null && throttlesCpu(dep, plan.cpu));
  if (!heals) { applyResourcePlan(host, dep, plan, notes); return null; }
  return rollOut(host, dep, () => applyResourcePlan(host, dep, plan, notes));
}

/** Wurde überhaupt ein Limit oder Request angegeben? */
const anySpecGiven = (...lists: ResourceList[]): boolean => lists.some(l => Object.keys(l).length > 0);

/** kubectl set resources deployment/<name> --limits=memory=256Mi [--requests=memory=128Mi]
 *  Liest und validiert alle Dimensionen vor der ersten Mutation (memory-Limit + OOM-Heilung /
 *  CPU-Limit / ephemeral-storage-Limit); eine Heilung rollt über ./rollout aus. Die Notiz-Reihenfolge
 *  (Speicher → CPU → ephemeral) bleibt wie zuvor. `--requests` wird akzeptiert, ändert
 *  aber didaktisch nichts – es zählt nur mit, ob überhaupt etwas angegeben wurde. */
function kubectlSetResources(host: KubectlHost, c: Call) {
  const one = singleDeployment(host, "set", c.args.slice(1));
  if ("error" in one) return one.error;
  const depName = one.name;
  const limits = parseResourceList(host, c.value("--limits"));
  const requests = parseResourceList(host, c.value("--requests"));
  // Die Flag-Tabelle (checkedFlag) hat beide Werte schon geprüft; der Typ-Zweig ist nur die Verengung.
  if (typeof limits === "string") return limits;
  if (typeof requests === "string") return requests;
  if (!depName) return host._err("kubectl set resources: Welches Deployment?", "Muster: kubectl set resources deployment/<name> --limits=memory=256Mi --requests=memory=128Mi");
  if (!anySpecGiven(limits, requests)) return host._err("kubectl set resources: Kein Limit/Request angegeben.", "Häng z.B. '--limits=memory=256Mi --requests=memory=128Mi', '--limits=cpu=200m' oder '--limits=ephemeral-storage=1Gi' an.");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err(deploymentNotFound(depName), DEPLOYMENTS_TIP);
  const plan: ResourcePlan = { mem: limits.memory, cpu: limits.cpu ?? null, eph: limits.ephemeral };
  const notes: string[] = [];
  const denied = applyWithRollout(host, dep, plan, notes);
  if (denied) return denied;
  return "deployment.apps/" + depName + " resource requirements updated" + notes.join("");
}

/** Die `rollout`-Aktionen (#1487): ein Eintrag je Aktion. */
const ROLLOUT_ACTIONS: Readonly<Record<string, (host: KubectlHost, c: Call) => string>> = {
  restart: (host, c) => kubectlRolloutRestart(host, c),
  history: (host, c) => kubectlRolloutHistory(host, c),
  undo: (host, c) => kubectlRolloutUndo(host, c),
};

export function kubectlRollout(host: KubectlHost, c: Call) {
  const action = c.args[0] ?? "";
  const run = subEntry(ROLLOUT_ACTIONS, action);
  if (run) return run(host, c);
  return notSimulated(host, "'kubectl rollout " + action + "'.", Object.keys(ROLLOUT_ACTIONS).map(a => "kubectl rollout " + a + " deployment <name>"));
}

/** Das eine Deployment einer `rollout`-Aktion (history/undo: kein Mehrfachziel) – oder der fertige Fehlertext. */
function rolloutTarget(host: KubectlHost, c: Call, action: string): Deployment | string {
  const one = singleDeployment(host, "rollout", c.args.slice(1));
  if ("error" in one) return one.error;
  if (!one.name) return host._err("kubectl rollout " + action + ": Welches Deployment?", "Muster: kubectl rollout " + action + " deployment <name>");
  const name = one.name;
  return host.deployments.find(d => d.name === name) ?? host._err(deploymentNotFound(name), DEPLOYMENTS_TIP);
}

/** `--to-revision` kennt nur `undo`; bei `restart`/`history` ist es für kubectl ein unbekanntes Flag. */
function rejectToRevision(host: KubectlHost, c: Call): string | null {
  return c.has("--to-revision") ? host._err("error: unknown flag: --to-revision", "Ein bestimmtes Ziel kennt nur 'kubectl rollout undo deployment <name> --to-revision=<n>'.") : null;
}

/** Heilt frisch erzeugte Pods wie ein Neustart: ein Secret, das dem crashloop fehlte, ist inzwischen da; ein
 *  needsBuild-Image ist lokal gebaut (der klassische „force re-pull“-Griff, #164). `true` bei geheiltem Image. */
function freshPodHeal(host: KubectlHost, dep: Deployment): boolean {
  const broken = dep.broken;
  const secretHealed = !!broken && broken.type === "crashloop" && host.secrets.some(s => s.name === broken.needsSecret);
  const imageHealed = !!broken && broken.type === "imagepull" && !!broken.needsBuild && host._imageAvailable(dep.image);
  if (secretHealed || imageHealed) dep.broken = null;
  return imageHealed;
}

const IMAGE_FOUND_NOTE = "\n💡 Image gefunden – die Pods starten neu und laufen jetzt. Prüfe mit 'kubectl get pods'.";

/** Ein Deployment neu starten: die Erfolgszeile oder der Fehlertext der Pod-Security-Admission. */
function restartDeployment(host: KubectlHost, dep: Deployment): { ok: string } | { denied: string } {
  // Der Neustart gibt das flüchtige Scratch-Volume frei (#240) und läuft über den einen Rollout-Weg
  // (Pod-Security-Admission inklusive): bei Ablehnung bleibt auch die Heilung aus.
  // restartedAt: jeder Neustart ergibt einen neuen pod-template-hash, auch im selben Takt und gegenüber der Historie (#1468, #1471).
  let imageHealed = false;
  const denied = rollOut(host, dep, () => { dep.restartedAt = Math.max(host.clock, maxRestartedAt(dep) + 1); imageHealed = freshPodHeal(host, dep); });
  if (denied) return { denied };
  return { ok: "deployment.apps/" + dep.name + " restarted" + (imageHealed ? IMAGE_FOUND_NOTE : "") };
}

/** kubectl rollout restart deployment <name> [<name> …] – je Ziel eine Zeile, ein fehlendes Ziel stoppt die übrigen nicht. */
function kubectlRolloutRestart(host: KubectlHost, c: Call) {
  const unknown = rejectToRevision(host, c);
  if (unknown) return unknown;
  const dn = deploymentNames(host, "rollout", c.args.slice(1));
  if ("error" in dn) return dn.error;
  if (dn.names.length === 0) return host._err("kubectl rollout restart: Welches Deployment?", "Muster: kubectl rollout restart deployment <name>");
  const ok: string[] = [];
  const failed: string[] = [];
  let missing = false;
  for (const name of dn.names) {
    const dep = host.deployments.find(d => d.name === name);
    if (!dep) { failed.push(deploymentNotFound(name)); missing = true; continue; }
    const r = restartDeployment(host, dep);
    if ("ok" in r) ok.push(r.ok); else failed.push(r.denied);
  }
  return targetOutcome(host, ok, failed, missing ? DEPLOYMENTS_TIP : undefined);
}

/** kubectl rollout history deployment <name>: die Revisionen (ohne `--revision`-Detail, ohne CHANGE-CAUSE). */
function kubectlRolloutHistory(host: KubectlHost, c: Call) {
  const unknown = rejectToRevision(host, c);
  if (unknown) return unknown;
  const dep = rolloutTarget(host, c, "history");
  if (typeof dep === "string") return dep;
  const revs = rolloutRevisions(dep);
  const breite = Math.max("REVISION".length, ...revs.map(r => String(r).length)) + 2;
  return ["deployment.apps/" + dep.name, "REVISION".padEnd(breite) + "CHANGE-CAUSE", ...revs.map(r => String(r).padEnd(breite) + "<none>")].join("\n");
}

/** kubectl rollout undo deployment <name> [--to-revision=N]: das Template eines alten ReplicaSets zurückholen.
 *  Läuft über den einen Rollout-Weg; die Admission prüft das ALTE Template. */
function kubectlRolloutUndo(host: KubectlHost, c: Call) {
  const dep = rolloutTarget(host, c, "undo");
  if (typeof dep === "string") return dep;
  const raw = c.value("--to-revision");
  const target = undoTarget(dep, raw === null ? undefined : Number(raw));
  if ("error" in target) {
    return host._err(target.error === "keine-historie"
      ? 'error: no rollout history found for deployment "' + dep.name + '"'
      : "error: unable to find specified revision " + target.revision + " in history", "Die Revisionen zeigt 'kubectl rollout history deployment " + dep.name + "'.");
  }
  if ("skip" in target) return "deployment.apps/" + dep.name + " skipped rollback (current template already matches revision " + target.revision + ")";
  const tpl = target.record.template;
  const notes: string[] = [];
  let imageHealed = false;
  const denied = rollOut(host, dep, () => { notes.push(...restoreRsTemplate(dep, tpl)); imageHealed = freshPodHeal(host, dep); }, tpl.spec.securityContext ?? {});
  if (denied) return denied;
  return "deployment.apps/" + dep.name + " rolled back" + notes.join("") + (imageHealed ? IMAGE_FOUND_NOTE : "");
}
