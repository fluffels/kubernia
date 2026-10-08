/* ===== Kubernia – kubectl Workload-Ops (sim/kubectl/ops.ts) =====
 * Befehle, die an einem BEREITS bestehenden Workload drehen (statt Ressourcen
 * anzulegen/zu löschen): `scale`, `expose`, `set image|env|resources`, `rollout
 * restart`. Inklusive der set-Unterhelfer (`kubectlSetEnv`/`kubectlSetImage`/
 * `kubectlSetResources`).
 *
 * Phaser-frei (pure Domäne): nutzt nur `makePodName` aus ../util und das
 * KubectlHost-Interface (./host). Aufgerufen aus dem kubectl-Dispatch (../kubectl.ts).
 */
import { changeImage, setMemoryLimit, setCpuLimit, healsOom, throttlesCpu, MEM_HEALED_NOTE, CPU_THROTTLED_NOTE } from "../workload";
import { parseMem, parseCpuMilli } from "../util";
import type { Deployment } from "../state";
import type { KubectlHost } from "./host";
import { rollOut, scaleTo } from "./rollout";
import { resolveKind, type ResourceKind } from "./resources";
import { positionals, notSimulated, replicasArg, slashRef, type KubectlSub } from "./args";

/** Eine Objekt-Referenz `<typ>/<name>` (Slash) ODER `<typ> <name>` (getrennt) – egal an welcher Position
 *  sie steht. Der Typ löst über die Registry auf (`deploy`, `deployments`, `Deployment` …); Tokens, die
 *  kein Typ sind (z.B. `web=nginx:1`), werden übersprungen. `null`, wenn keine Referenz dasteht. */
function resolveRef(sub: KubectlSub, t: string[], from: number): { kind: ResourceKind; name: string } | { error: string } | null {
  const pos = positionals(sub, t, from);
  for (let i = 0; i < pos.length; i++) {
    const ref = slashRef(pos[i]);
    // Ein Token mit kaputter Slash-Form ist nur dann ein Fehler, wenn es mit einem Typ beginnt
    // (`deploy/a/b`); `web=reg/img:1` ist keine Referenz und wird übersprungen.
    if (ref && "error" in ref && !resolveKind(pos[i].split("/")[0])) continue;
    if (ref && "error" in ref) return ref;
    const kind = resolveKind(ref ? ref.typ : pos[i]);
    if (!kind) continue;
    const name = ref ? ref.name : pos[i + 1];
    return name ? { kind, name } : null;
  }
  return null;
}

/** Den Deployment-Namen aus der Referenz ziehen, die scale/expose/set/rollout gemeinsam annehmen
 *  (ersetzt die früher 6× kopierte Ad-hoc-Zerlegung). `name` ist null, wenn keine Referenz dasteht;
 *  eine andere Art als Deployment (`scale pods/x`) ergibt den „nicht simuliert“-Fehler in `error`. */
function resolveDeploymentRef(host: KubectlHost, sub: KubectlSub, t: string[], from: number): { name: string | null; error?: string } {
  const ref = resolveRef(sub, t, from);
  if (!ref) return { name: null };
  if ("error" in ref) return { name: null, error: host._err(ref.error) };
  if (ref.kind.plural === "deployments") return { name: ref.name };
  return { name: null, error: notSimulated(host, "'kubectl " + sub + " " + ref.kind.plural + "/<name>' – das geht nur für Deployments.", ["kubectl " + sub + " deployment <name> …"]) };
}


export function kubectlScale(host: KubectlHost, t: string[]) {
  const { name, error } = resolveDeploymentRef(host, "scale", t, 2);
  if (error) return error;
  const rep = replicasArg(host, "scale", t);
  if ("error" in rep) return rep.error;
  if (!name || rep.replicas === null) return host._err("kubectl scale: So nicht ganz.", "Muster: 'kubectl scale deployment <name> --replicas=3'");
  const dep = host.deployments.find(d => d.name === name);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + name + '" not found', "Welche Deployments es gibt: 'kubectl get deployments'");
  if (rep.replicas < 0) return host._err("error: The --replicas=COUNT flag is required, and COUNT must be greater than or equal to 0");
  const denied = scaleTo(host, dep, rep.replicas);
  if (denied) return denied;
  return "deployment.apps/" + name + " scaled";
}


export function kubectlExpose(host: KubectlHost, t: string[], raw: string) {
  const { name, error } = resolveDeploymentRef(host, "expose", t, 2);
  if (error) return error;
  const portMatch = raw.match(/--port[=\s]+(\d+)/);
  if (!name) return host._err("kubectl expose: Welches Deployment?", "Muster: 'kubectl expose deployment <name> --port=80'");
  const dep = host.deployments.find(d => d.name === name);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + name + '" not found');
  if (!portMatch) return host._err("error: couldn't find port via --port flag or introspection", "Häng '--port=80' an.");
  if (host.services.some(s => s.name === name)) return host._err('Error from server (AlreadyExists): services "' + name + '" already exists');
  const typeMatch = raw.match(/--type[=\s]+(\S+)/);
  // --target-port: an welchen Container-Port der Service weiterleitet (#164). Fehlt es,
  // gilt --port auch als Ziel (wie in echtem kubectl).
  const targetMatch = raw.match(/--target-port[=\s]+(\S+)/);
  // #507: Service-Anlegen zentral über die Fabrik (DNS-1123-Prüfung inklusive).
  host.services.push(host._makeService({
    name,
    type: typeMatch ? typeMatch[1] : undefined,
    port: portMatch[1],
    ...(targetMatch ? { targetPort: targetMatch[1] } : {}),
  }));
  return "service/" + name + " exposed";
}

/** kubectl set image|env|resources – dispatcht in die jeweilige set-Unterfamilie. */

export function kubectlSet(host: KubectlHost, t: string[], raw: string) {
  if (t[2] === "image") return kubectlSetImage(host, t);
  if (t[2] === "env") return kubectlSetEnv(host, t, raw);
  if (t[2] === "resources") return kubectlSetResources(host, t, raw);
  return notSimulated(host, "'kubectl set " + (t[2] ?? "") + "'.", ["kubectl set image …", "kubectl set env …", "kubectl set resources …"], "Muster: 'kubectl set env deployment/<name> --from=configmap/<name>'.");
}

/** kubectl set env deployment/<name> --from=configmap/<name> | --from=secret/<name>
 *  Bindet eine ConfigMap (harmlose Config) oder ein Secret (Vertrauliches) als
 *  Umgebungsvariablen in ein Deployment ein. */

function kubectlSetEnv(host: KubectlHost, t: string[], raw: string) {
  const { name: depName, error } = resolveDeploymentRef(host, "set", t, 3);
  if (error) return error;
  if (!depName) return host._err("kubectl set env: Welches Deployment?", "Muster: kubectl set env deployment/<name> --from=configmap/<name>");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found', "Welche Deployments es gibt: 'kubectl get deployments'");
  const m = raw.match(/--from[=\s](configmap|secret)\/(\S+)/);
  if (!m) return host._err("kubectl set env: Womit einbinden?", "Muster: kubectl set env deployment/<name> --from=configmap/<name> (oder --from=secret/<name>)");
  const kind = m[1];
  const refName = m[2];
  if (kind === "configmap") {
    if (!host.configMaps.some(c => c.name === refName)) return host._err('error: configmaps "' + refName + '" not found', "Erst anlegen: kubectl create configmap " + refName + " --from-literal=k=v");
    if (!dep.envFrom.configMaps.includes(refName)) dep.envFrom.configMaps.push(refName);
  } else {
    if (!host.secrets.some(s => s.name === refName)) return host._err('error: secrets "' + refName + '" not found', "Erst anlegen: kubectl create secret generic " + refName + " --from-literal=k=v");
    if (!dep.envFrom.secrets.includes(refName)) dep.envFrom.secrets.push(refName);
  }
  return "deployment.apps/" + depName + " env updated";
}

/** kubectl set image deployment/<name> <container>=<image> */

function kubectlSetImage(host: KubectlHost, t: string[]) {
  const { name: depName, error } = resolveDeploymentRef(host, "set", t, 3);
  if (error) return error;
  // Der Deployment-Name enthält nie ein "=", darum findet die kv-Suche ausschließlich das
  // <container>=<image>-Paar (kein Herausschneiden des Namens-Tokens mehr nötig).
  const kv = t.find(x => x.includes("=") && !x.startsWith("--"));
  if (!depName || !kv) return host._err("kubectl set image: So nicht ganz.", "Muster: kubectl set image deployment/<name> <container>=<image>");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found');
  const newImage = kv.split("=")[1];
  const oldBad = dep.broken && dep.broken.type === "imagepull" ? dep.broken.badImage : null;
  // Anderes Image = neues Pod-Template = Rollout (Admission inklusive); gleiches Image: nichts.
  if (dep.image !== newImage) {
    const denied = rollOut(host, dep, () => { changeImage(dep, newImage); });
    if (denied) return denied;
  }
  return "deployment.apps/" + depName + " image updated" + (oldBad && newImage === oldBad ? "\n💡 Hmm – das ist exakt dasselbe (kaputte) Image. Schau nochmal genau auf den Namen!" : "");
}

/** Ein Fehler einer Ressourcen-Dimension: [Meldung, Tipp] für `host._err`. `null` = ok. */
type ResourceError = readonly [msg: string, tip: string];

/** Geparste, validierte Ressourcen-Angaben von `set resources` (alles vor der ersten Mutation). */
interface ResourcePlan { mem?: number; cpu: number | null; eph?: number }

/** Memory- und ephemeral-Limit parsen (CPU kommt schon als Milli-Cores). Fehler → [Meldung, Tipp]. */
function parseResourcePlan(memSpec: string | undefined, cpu: number | null, ephSpec: string | undefined): ResourcePlan | ResourceError {
  const plan: ResourcePlan = { cpu };
  if (memSpec) {
    const mem = parseMem(memSpec);
    if (mem === null) return ['error: invalid resource quantity "' + memSpec + '"', "Schreib das Limit z.B. als '256Mi' oder '1Gi'."];
    plan.mem = mem;
  }
  if (ephSpec) {
    const eph = parseMem(ephSpec);
    if (eph === null) return ['error: invalid resource quantity "' + ephSpec + '"', "Schreib das Limit z.B. als '512Mi' oder '1Gi'."];
    plan.eph = eph;
  }
  return plan;
}

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

/** Das `--limits=cpu=<N>` als Text ziehen (`250m`, `1`, `0.5`); `undefined`, wenn keins angegeben ist. */
function cpuLimitSpec(raw: string): string | undefined {
  return raw.match(/--limits[=\s][^\s]*cpu=([0-9.]+m?)/)?.[1];
}

/** Wurde überhaupt ein Limit/Request angegeben (Memory-/Request-/ephemeral-Text oder ein CPU-Limit)? */
function anySpecGiven(texts: (string | undefined)[], cpuLimitMilli: number | null): boolean {
  return cpuLimitMilli !== null || texts.some(s => !!s);
}

/** kubectl set resources deployment/<name> --limits=memory=256Mi [--requests=memory=128Mi]
 *  Parst und validiert alle Dimensionen vor der ersten Mutation (memory-Limit + OOM-Heilung /
 *  CPU-Limit / ephemeral-storage-Limit); eine Heilung rollt über ./rollout aus. Die Notiz-Reihenfolge
 *  (Speicher → CPU → ephemeral) bleibt wie zuvor. `--requests=memory` wird akzeptiert, ändert
 *  aber didaktisch nichts – es zählt nur mit, ob überhaupt etwas angegeben wurde. */
function kubectlSetResources(host: KubectlHost, t: string[], raw: string) {
  const { name: depName, error } = resolveDeploymentRef(host, "set", t, 3);
  if (error) return error;
  const limitSpec = (raw.match(/--limits[=\s][^\s]*memory=([0-9]+(?:Mi|Gi|M|G)?)/) || [])[1];
  const requestSpec = (raw.match(/--requests[=\s][^\s]*memory=([0-9]+(?:Mi|Gi|M|G)?)/) || [])[1];
  const cpuSpec = cpuLimitSpec(raw);
  const cpuLimitMilli = cpuSpec === undefined ? null : parseCpuMilli(cpuSpec);
  const ephSpec = (raw.match(/--limits[=\s][^\s]*ephemeral-storage=([0-9]+(?:Mi|Gi|M|G)?)/) || [])[1];
  if (!depName) return host._err("kubectl set resources: Welches Deployment?", "Muster: kubectl set resources deployment/<name> --limits=memory=256Mi --requests=memory=128Mi");
  if (cpuSpec !== undefined && cpuLimitMilli === null) return host._err('error: invalid resource quantity "' + cpuSpec + '"', "Schreib das CPU-Limit z.B. als '200m' oder '0.5'.");
  if (!anySpecGiven([limitSpec, requestSpec, ephSpec], cpuLimitMilli)) return host._err("kubectl set resources: Kein Limit/Request angegeben.", "Häng z.B. '--limits=memory=256Mi --requests=memory=128Mi', '--limits=cpu=200m' oder '--limits=ephemeral-storage=1Gi' an.");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found', "Welche Deployments es gibt: 'kubectl get deployments'");
  const plan = parseResourcePlan(limitSpec, cpuLimitMilli, ephSpec);
  if (!("cpu" in plan)) return host._err(plan[0], plan[1]);
  const notes: string[] = [];
  const denied = applyWithRollout(host, dep, plan, notes);
  if (denied) return denied;
  return "deployment.apps/" + depName + " resource requirements updated" + notes.join("");
}

/** kubectl rollout restart deployment <name> */

export function kubectlRollout(host: KubectlHost, t: string[]) {
  if (t[2] !== "restart") return notSimulated(host, "'kubectl rollout " + (t[2] ?? "") + "'.", ["kubectl rollout restart deployment <name>"]);
  const { name: depName, error } = resolveDeploymentRef(host, "rollout", t, 3);
  if (error) return error;
  if (!depName) return host._err("kubectl rollout restart: Welches Deployment?", "Muster: kubectl rollout restart deployment <name>");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found');
  const broken = dep.broken;
  const secretHealed = !!broken && broken.type === "crashloop" && host.secrets.some(s => s.name === broken.needsSecret);
  // Eigenes Image nachgebaut (#164): ein needsBuild-ImagePullBackOff heilt beim Neustart,
  // sobald das Image lokal verfügbar ist – der klassische „force re-pull"-Griff.
  const imageHealed = !!broken && broken.type === "imagepull" && !!broken.needsBuild && host._imageAvailable(dep.image);
  // Der Neustart gibt das flüchtige Scratch-Volume frei (#240) und läuft über den einen Rollout-Weg
  // (Pod-Security-Admission inklusive): bei Ablehnung bleibt auch die Heilung aus.
  // restartedAt: jeder Neustart ergibt einen neuen pod-template-hash, auch im selben Takt (#1468).
  const denied = rollOut(host, dep, () => { dep.restartedAt = Math.max(host.clock, (dep.restartedAt ?? -1) + 1); if (secretHealed || imageHealed) dep.broken = null; });
  if (denied) return denied;
  return "deployment.apps/" + depName + " restarted" +
    (imageHealed ? "\n💡 Image gefunden – die Pods starten neu und laufen jetzt. Prüfe mit 'kubectl get pods'." : "");
}
