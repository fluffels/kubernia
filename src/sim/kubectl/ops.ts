/* ===== KubeQuest – kubectl Workload-Ops (sim/kubectl/ops.ts) =====
 * Befehle, die an einem BEREITS bestehenden Workload drehen (statt Ressourcen
 * anzulegen/zu löschen): `scale`, `expose`, `set image|env|resources`, `rollout
 * restart`. Inklusive der set-Unterhelfer (`kubectlSetEnv`/`kubectlSetImage`/
 * `kubectlSetResources`) und des Speicher-Parsers `parseMem`.
 *
 * Phaser-frei (pure Domäne): nutzt nur `makePodName` aus ../util und das
 * KubectlHost-Interface (./host). Aufgerufen aus dem kubectl-Dispatch (../kubectl.ts).
 */
import { makePodName } from "../util";
import type { KubectlHost } from "./host";


export function kubectlScale(host: KubectlHost, t: string[], raw: string) {
  const name = t[3] === "deployment" ? t[4] : (t[2] === "deployment" ? t[3] : null);
  const repMatch = raw.match(/--replicas[=\s]+(\d+)/);
  if (!name || !repMatch) return host._err("kubectl scale: So nicht ganz.", "Muster: 'kubectl scale deployment <name> --replicas=3'");
  const dep = host.deployments.find(d => d.name === name);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + name + '" not found', "Welche Deployments es gibt: 'kubectl get deployments'");
  const target = parseInt(repMatch[1], 10);
  while (dep.pods.length < target) dep.pods.push({ name: makePodName(dep.name), created: host.clock, restarts: 0 });
  while (dep.pods.length > target) dep.pods.pop();
  dep.replicas = target;
  return "deployment.apps/" + name + " scaled";
}


export function kubectlExpose(host: KubectlHost, t: string[], raw: string) {
  const name = t[3] === "deployment" ? t[4] : (t[2] === "deployment" ? t[3] : null);
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
  host.services.push({
    name,
    type: typeMatch ? typeMatch[1] : "ClusterIP",
    clusterIP: "10.96." + Math.floor(Math.random() * 250) + "." + Math.floor(Math.random() * 250),
    port: portMatch[1],
    ...(targetMatch ? { targetPort: targetMatch[1] } : {}),
    created: host.clock,
  });
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
  let depName: string | null = null;
  if (t[3] && t[3].startsWith("deployment/")) depName = t[3].split("/")[1];
  else if (t[3] === "deployment") depName = t[4];
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
  let depName: string | null = null;
  if (t[3] && t[3].startsWith("deployment/")) depName = t[3].split("/")[1];
  else if (t[3] === "deployment") { depName = t[4]; t = t.slice(0, 4).concat(t.slice(5)); }
  const kv = t.find(x => x.includes("=") && !x.startsWith("--"));
  if (!depName || !kv) return host._err("kubectl set image: So nicht ganz.", "Muster: kubectl set image deployment/<name> <container>=<image>");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found');
  const newImage = kv.split("=")[1];
  const oldBad = dep.broken && dep.broken.type === "imagepull" ? dep.broken.badImage : null;
  dep.image = newImage;
  if (oldBad && newImage !== oldBad) {
    dep.broken = null;
    dep.pods = dep.pods.map(() => ({ name: makePodName(dep.name), created: host.clock, restarts: 0 }));
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

/** kubectl set resources deployment/<name> --limits=memory=256Mi [--requests=memory=128Mi]
 *  Setzt das memory-Limit. Ist der Dienst wegen OOMKilled kaputt und das neue Limit
 *  reicht (>= memNeeded), heilt er. Setzt auch --limits=cpu=<N>m: bei ≤ 499 m wird
 *  cpuHeavy gelöscht und der HighPodCPU-Alert fällt auf resolved. */

function kubectlSetResources(host: KubectlHost, t: string[], raw: string) {
  let depName: string | null = null;
  if (t[3] && t[3].startsWith("deployment/")) depName = t[3].split("/")[1];
  else if (t[3] === "deployment") depName = t[4];
  const limitSpec = (raw.match(/--limits[=\s][^\s]*memory=([0-9]+(?:Mi|Gi|M|G)?)/) || [])[1];
  const requestSpec = (raw.match(/--requests[=\s][^\s]*memory=([0-9]+(?:Mi|Gi|M|G)?)/) || [])[1];
  const cpuMatch = raw.match(/--limits[=\s][^\s]*cpu=([0-9]+)(m)?/);
  const cpuLimitMilli = cpuMatch ? (cpuMatch[2] ? parseInt(cpuMatch[1], 10) : parseInt(cpuMatch[1], 10) * 1000) : null;
  if (!depName) return host._err("kubectl set resources: Welches Deployment?", "Muster: kubectl set resources deployment/<name> --limits=memory=256Mi --requests=memory=128Mi");
  if (!limitSpec && !requestSpec && cpuLimitMilli === null) return host._err("kubectl set resources: Kein Limit/Request angegeben.", "Häng z.B. '--limits=memory=256Mi --requests=memory=128Mi' oder '--limits=cpu=200m' an.");
  const dep = host.deployments.find(d => d.name === depName);
  if (!dep) return host._err('Error from server (NotFound): deployments.apps "' + depName + '" not found', "Welche Deployments es gibt: 'kubectl get deployments'");
  const newLimit = limitSpec ? parseMem(limitSpec) : null;
  if (limitSpec && newLimit === null) return host._err('error: invalid resource quantity "' + limitSpec + '"', "Schreib das Limit z.B. als '256Mi' oder '1Gi'.");
  if (newLimit !== null) dep.memLimit = newLimit;
  let healed = false;
  if (dep.broken && dep.broken.type === "oomkilled" && newLimit !== null && newLimit >= (dep.broken.memNeeded || 0)) {
    dep.broken = null;
    dep.pods = dep.pods.map(() => ({ name: makePodName(dep.name), created: host.clock, restarts: 0 }));
    healed = true;
  }
  let cpuThrottled = false;
  if (cpuLimitMilli !== null && cpuLimitMilli < 500 && dep.cpuHeavy) {
    dep.cpuHeavy = false;
    dep.pods = dep.pods.map(() => ({ name: makePodName(dep.name), created: host.clock, restarts: 0 }));
    cpuThrottled = true;
  }
  return "deployment.apps/" + depName + " resource requirements updated" +
    (healed ? "\n💡 Genug Speicher! Die Pods starten neu und bleiben diesmal stehen – kein OOMKilled mehr." : "") +
    (cpuThrottled ? "\n💡 CPU-Limit gesetzt! Die Pods werden gedrosselt – der HighPodCPU-Alert fällt auf resolved." : "");
}

/** kubectl rollout restart deployment <name> */

export function kubectlRollout(host: KubectlHost, t: string[]) {
  if (t[2] !== "restart") return host._err("Der Simulator kann nur 'kubectl rollout restart deployment <name>'.");
  let depName: string | null = null;
  if (t[3] && t[3].startsWith("deployment/")) depName = t[3].split("/")[1];
  else if (t[3] === "deployment") depName = t[4];
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
  dep.pods = dep.pods.map(() => ({ name: makePodName(dep.name), created: host.clock, restarts: 0 }));
  return "deployment.apps/" + depName + " restarted" +
    (imageHealed ? "\n💡 Image gefunden – die Pods starten neu und laufen jetzt. Prüfe mit 'kubectl get pods'." : "");
}
