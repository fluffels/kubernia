/* ===== KubeQuest – kubectl Workload-Ops (sim/kubectl/ops.ts) =====
 * Befehle, die an einem BEREITS bestehenden Workload drehen (statt Ressourcen
 * anzulegen/zu löschen): `scale`, `expose`, `set image|env|resources`, `rollout
 * restart`. Inklusive der set-Unterhelfer (`kubectlSetEnv`/`kubectlSetImage`/
 * `kubectlSetResources`) und des Speicher-Parsers `parseMem`.
 *
 * Phaser-frei (pure Domäne): nutzt nur `makePodName` aus ../util und das
 * KubectlHost-Interface (./host). Aufgerufen aus dem kubectl-Dispatch (../kubectl.ts).
 */
import { scaleDeployment, replacePods } from "../workload";
import type { Deployment } from "../state";
import type { KubectlHost } from "./host";

/** Den Deployment-Namen aus einer Referenz `deployment/<name>` (Slash) ODER
 *  `deployment <name>` (getrennt) ziehen – egal an welcher Token-Position sie steht.
 *  Deckt beide Schreibweisen ab, die scale/expose/set/rollout gemeinsam annehmen, und
 *  ersetzt so die früher 6× kopierte Ad-hoc-Zerlegung. `null`, wenn keine
 *  Deployment-Referenz dasteht. */
function resolveDeploymentRef(t: string[]): string | null {
  for (let i = 0; i < t.length; i++) {
    const tok = t[i];
    if (tok.startsWith("deployment/")) return tok.slice("deployment/".length) || null;
    if (tok === "deployment") return t[i + 1] && !t[i + 1].startsWith("-") ? t[i + 1] : null;
  }
  return null;
}


export function kubectlScale(host: KubectlHost, t: string[], raw: string) {
  const name = resolveDeploymentRef(t);
  const repMatch = raw.match(/--replicas[=\s]+(\d+)/);
  if (!name || !repMatch) return host._err("kubectl scale: So nicht ganz.", "Muster: 'kubectl scale deployment <name> --replicas=3'");
  const dep = host.deployments.find(d => d.name === name);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + name + '" not found', "Welche Deployments es gibt: 'kubectl get deployments'");
  const target = parseInt(repMatch[1], 10);
  scaleDeployment(dep, target, host.clock);
  return "deployment.apps/" + name + " scaled";
}


export function kubectlExpose(host: KubectlHost, t: string[], raw: string) {
  const name = resolveDeploymentRef(t);
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
  return host._err("Der Simulator kann 'kubectl set image …', 'kubectl set env …' und 'kubectl set resources …'.", "z.B. 'kubectl set env deployment/<name> --from=configmap/<name>'");
}

/** kubectl set env deployment/<name> --from=configmap/<name> | --from=secret/<name>
 *  Bindet eine ConfigMap (harmlose Config) oder ein Secret (Vertrauliches) als
 *  Umgebungsvariablen in ein Deployment ein. */

function kubectlSetEnv(host: KubectlHost, t: string[], raw: string) {
  const depName = resolveDeploymentRef(t);
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
  if (t[2] !== "image") return host._err("Der Simulator kann nur 'kubectl set image deployment/<name> <container>=<image>'.");
  const depName = resolveDeploymentRef(t);
  // Der Deployment-Name enthält nie ein "=", darum findet die kv-Suche ausschließlich das
  // <container>=<image>-Paar (kein Herausschneiden des Namens-Tokens mehr nötig).
  const kv = t.find(x => x.includes("=") && !x.startsWith("--"));
  if (!depName || !kv) return host._err("kubectl set image: So nicht ganz.", "Muster: kubectl set image deployment/<name> <container>=<image>");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found');
  const newImage = kv.split("=")[1];
  const oldBad = dep.broken && dep.broken.type === "imagepull" ? dep.broken.badImage : null;
  dep.image = newImage;
  if (oldBad && newImage !== oldBad) {
    dep.broken = null;
    replacePods(dep, host.clock);
  }
  return "deployment.apps/" + depName + " image updated" + (oldBad && newImage === oldBad ? "\n💡 Hmm – das ist exakt dasselbe (kaputte) Image. Schau nochmal genau auf den Namen!" : "");
}

/** Speicherangabe wie "256Mi", "1Gi", "512M" in Mi umrechnen (null bei Unsinn). */

function parseMem(spec: string): number | null {
  const m = spec.match(/^(\d+)(Mi|Gi|M|G)?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2] || "Mi";
  if (unit === "Gi" || unit === "G") return n * 1024;
  return n; // Mi / M ~ als Mi behandeln (didaktisch genau genug)
}

/** Ein Fehler einer Ressourcen-Dimension: [Meldung, Tipp] für `host._err`. `null` = ok. */
type ResourceError = readonly [msg: string, tip: string];

/** Das Memory-Limit setzen (#240). Ist der Dienst wegen OOMKilled kaputt und das neue Limit
 *  reicht (>= memNeeded), heilt er. Notiz landet in `notes`. */
function applyMemLimit(host: KubectlHost, dep: Deployment, spec: string | undefined, notes: string[]): ResourceError | null {
  if (!spec) return null;
  const newLimit = parseMem(spec);
  if (newLimit === null) return ['error: invalid resource quantity "' + spec + '"', "Schreib das Limit z.B. als '256Mi' oder '1Gi'."];
  dep.memLimit = newLimit;
  if (dep.broken && dep.broken.type === "oomkilled" && newLimit >= (dep.broken.memNeeded || 0)) {
    dep.broken = null;
    replacePods(dep, host.clock);
    notes.push("\n💡 Genug Speicher! Die Pods starten neu und bleiben diesmal stehen – kein OOMKilled mehr.");
  }
  return null;
}

/** Das CPU-Limit setzen: bei < 500 m wird cpuHeavy gelöscht und der HighPodCPU-Alert fällt
 *  auf resolved. `milli` ist das Limit in Milli-Cores (oder null, wenn keins angegeben). */
function applyCpuLimit(host: KubectlHost, dep: Deployment, milli: number | null, notes: string[]): void {
  if (milli !== null && milli < 500 && dep.cpuHeavy) {
    dep.cpuHeavy = false;
    replacePods(dep, host.clock);
    notes.push("\n💡 CPU-Limit gesetzt! Die Pods werden gedrosselt – der HighPodCPU-Alert fällt auf resolved.");
  }
}

/** Das ephemeral-storage-Limit setzen (#240): analog memory, gegen die flüchtige Disk-Nutzung
 *  des Pods. Die Eviction-Auswertung greift den neuen Wert beim nächsten Befehl auf – reicht der
 *  Platz jetzt, wird der Pod nicht mehr evictet. */
function applyEphemeralLimit(host: KubectlHost, dep: Deployment, spec: string | undefined, notes: string[]): ResourceError | null {
  if (!spec) return null;
  const newEph = parseMem(spec);
  if (newEph === null) return ['error: invalid resource quantity "' + spec + '"', "Schreib das Limit z.B. als '512Mi' oder '1Gi'."];
  const wasEvicted = !!dep.evicted;
  dep.ephemeralLimit = newEph;
  // Maßgeblich ist der PEAK (#485): reicht das Limit auch für den (evtl. doppelten) initContainer-Peak,
  // läuft der Pod wieder – sonst würde er beim nächsten Init erneut evictet.
  if (wasEvicted && host._depEphemeralPeak(dep) <= newEph) {
    notes.push("\n💡 Genug ephemeral-storage! Der Pod wird nicht mehr evictet – prüfe mit 'kubectl get pods'.");
  }
  return null;
}

/** Das `--limits=cpu=<N>[m]` in Milli-Cores ziehen (ohne `m` = ganze Cores → ×1000). */
function parseCpuLimitMilli(raw: string): number | null {
  const m = raw.match(/--limits[=\s][^\s]*cpu=([0-9]+)(m)?/);
  if (!m) return null;
  return m[2] ? parseInt(m[1], 10) : parseInt(m[1], 10) * 1000;
}

/** kubectl set resources deployment/<name> --limits=memory=256Mi [--requests=memory=128Mi]
 *  Dünner Dispatcher: parst die vier Dimensionen und delegiert je an ihren Applier
 *  (memory-Limit + OOM-Heilung / CPU-Limit / ephemeral-storage-Limit). Die Notiz-Reihenfolge
 *  (Speicher → CPU → ephemeral) bleibt wie zuvor. `--requests=memory` wird akzeptiert, ändert
 *  aber didaktisch nichts – es zählt nur mit, ob überhaupt etwas angegeben wurde. */
function kubectlSetResources(host: KubectlHost, t: string[], raw: string) {
  const depName = resolveDeploymentRef(t);
  const limitSpec = (raw.match(/--limits[=\s][^\s]*memory=([0-9]+(?:Mi|Gi|M|G)?)/) || [])[1];
  const requestSpec = (raw.match(/--requests[=\s][^\s]*memory=([0-9]+(?:Mi|Gi|M|G)?)/) || [])[1];
  const cpuLimitMilli = parseCpuLimitMilli(raw);
  const ephSpec = (raw.match(/--limits[=\s][^\s]*ephemeral-storage=([0-9]+(?:Mi|Gi|M|G)?)/) || [])[1];
  if (!depName) return host._err("kubectl set resources: Welches Deployment?", "Muster: kubectl set resources deployment/<name> --limits=memory=256Mi --requests=memory=128Mi");
  if (!limitSpec && !requestSpec && cpuLimitMilli === null && !ephSpec) return host._err("kubectl set resources: Kein Limit/Request angegeben.", "Häng z.B. '--limits=memory=256Mi --requests=memory=128Mi', '--limits=cpu=200m' oder '--limits=ephemeral-storage=1Gi' an.");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found', "Welche Deployments es gibt: 'kubectl get deployments'");
  const notes: string[] = [];
  const memErr = applyMemLimit(host, dep, limitSpec, notes);
  if (memErr) return host._err(memErr[0], memErr[1]);
  applyCpuLimit(host, dep, cpuLimitMilli, notes);
  const ephErr = applyEphemeralLimit(host, dep, ephSpec, notes);
  if (ephErr) return host._err(ephErr[0], ephErr[1]);
  return "deployment.apps/" + depName + " resource requirements updated" + notes.join("");
}

/** kubectl rollout restart deployment <name> */

export function kubectlRollout(host: KubectlHost, t: string[]) {
  if (t[2] !== "restart") return host._err("Der Simulator kann nur 'kubectl rollout restart deployment <name>'.");
  const depName = resolveDeploymentRef(t);
  if (!depName) return host._err("kubectl rollout restart: Welches Deployment?", "Muster: kubectl rollout restart deployment <name>");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found');
  const broken = dep.broken;
  if (broken && broken.type === "crashloop" && host.secrets.some(s => s.name === broken.needsSecret)) {
    dep.broken = null;
  }
  // Eigenes Image nachgebaut (#164): ein needsBuild-ImagePullBackOff heilt beim Neustart,
  // sobald das Image lokal verfügbar ist – der klassische „force re-pull"-Griff.
  let imageHealed = false;
  if (broken && broken.type === "imagepull" && broken.needsBuild && host._imageAvailable(dep.image)) {
    dep.broken = null;
    imageHealed = true;
  }
  // Pod-Neustart gibt das flüchtige Scratch-Volume frei (#240): emptyDir-Inhalt ist weg, die
  // ephemeral-Disk-Bilanz von Pod und Node fällt – ein evicteter Pod kann so wieder anlaufen.
  host._resetEphemeral(dep);
  replacePods(dep, host.clock);
  return "deployment.apps/" + depName + " restarted" +
    (imageHealed ? "\n💡 Image gefunden – die Pods starten neu und laufen jetzt. Prüfe mit 'kubectl get pods'." : "");
}
