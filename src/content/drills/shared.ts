/* ===== Geteilte Helfer + Name-Pools für alle Drill-Module =====
 * Alles, was mehrere Drill-Dateien brauchen, lebt hier:
 * ensure*-Helfer, Name-Pools, Konstanten und der DrillTask-Typ.
 */
import type { Sim, Deployment, NetworkPolicyRes, ArgoApp } from "../../sim";
import { pick, rnd } from "../util";
// Manifeste kommen seit #514 aus der EINEN Quelle (data/manifests via manifest-lib), nicht
// mehr aus einem TS-Konstanten-Monolithen. Die vertrauten Namen bleiben als lokale Konstanten
// erhalten (aus der Bibliothek aufgelöst) + re-exportiert – die Drill-Module ändern sich nicht.
import { getManifest } from "../manifest-lib";

const NETPOL_YAML = getManifest("networkpolicy-hafenmauer");
const EXTERNALNAME_YAML = getManifest("service-externalname-bank");
const DOCKERFILE = getManifest("dockerfile-nginx");
const ARGO_APPLICATION_MANUAL_YAML = getManifest("argo-application-manual");
const SERVICEMONITOR_YAML = getManifest("servicemonitor-lager");
const PROMETHEUSRULE_YAML = getManifest("prometheusrule-hafen");
const ROLE_YAML = getManifest("role-pod-leser");
const ROLEBINDING_YAML = getManifest("rolebinding-pod-leser");
const CLUSTERROLE_YAML = getManifest("clusterrole-knoten-leser");
const CLUSTERROLEBINDING_YAML = getManifest("clusterrolebinding-knoten-leser");
const POD_SECURITY_YAML = getManifest("deployment-wachposten-restricted");
const STATEFULSET_YAML = getManifest("statefulset-speicher");
const STORAGECLASS_YAML = getManifest("storageclass-kai-ssd");
const PVC_YAML = getManifest("pvc-lager-daten");
const VOLUMESNAPSHOT_YAML = getManifest("volumesnapshot-lager");
const PVC_RESTORE_YAML = getManifest("pvc-restore-lager");

export const IMAGES = ["redis", "httpd", "busybox", "postgres", "rabbitmq"];
export const NAMES = ["leuchtfeuer", "fischtheke", "lotsenfunk", "ankerwinde", "kombuese", "seekiste"];
/** Gültige (kleingeschriebene) Image-Namen für die eigenen Bau-Übungen (#66). */
export const BUILD_NAMES = ["hafenwache", "funkdienst", "lotsenbild", "kombuese-app", "kaiapp", "ankerdienst"];
/** Gültige Chart-Namen (klein, mit Bindestrich) für die Werft-Übungen (#27). */
export const CHART_NAMES = ["funkdienst", "hafenkarte", "lotsen-app", "moewenruf", "kombuese-api", "ankerwerk"];
/** Namen & geschützte Apps für die Hafenmauer-Übungen (#20). */
export const NETPOL_NAMES = ["hafenmauer", "kaimauer", "wellenbrecher", "bollwerk", "schutzwall", "palisade"];
export const NETPOL_APPS = ["kasse", "lager", "funkdienst", "lotsen", "leuchtfeuer", "kombuese"];
/** Service-Namen für die DNS-/Adressbuch-Übungen (#337) – eigene, kollisionsfreie Namen. */
export const DNS_SVC_NAMES = ["buchhaltung", "navigation", "wetterstation", "zollkontor", "proviantamt", "steuerrad"];
/** ExternalName-Paare (interner Name → externer DNS-Name) für die CNAME-Übung (#337). */
export const DNS_EXTERNAL_PAIRS: [string, string][] = [
  ["bank-extern", "api.bank.example.com"],
  ["mail-extern", "mail.partner.example.net"],
  ["wetter-api", "wetter.dienst.example.org"],
  ["zoll-api", "api.zoll.example.com"],
];
/** Namen für die GitOps-/Argo-Übungen (#98). */
export const ARGO_APP_NAMES = ["kai-speicher", "lotsen-funk", "anker-dienst", "moewen-app", "flotten-karte", "leuchtturm-wache"];
/** SA-Namen für die Ausweis-Übungen. */
export const SA_NAMES = ["torwache", "deploy-bot", "spaehtrupp", "kontrolleur", "schliessdienst", "nachtwache"];
/** Role-Namen (namespaced) für die Schlüssellisten-Übungen. */
export const ROLE_NAMES = ["pod-leser", "dienst-spaeher", "wacht-leser", "log-leser", "kai-leser"];
/** ClusterRole-Namen (cluster-weit). */
export const CLUSTERROLE_NAMES = ["knoten-spaeher", "rundblick-leser", "cluster-wache", "knoten-leser"];
/** (verb, resource)-Paare für die auth-can-i-Übung. */
export const CANI_PAIRS: [string, string][] = [["get", "pods"], ["list", "pods"], ["watch", "pods"], ["list", "nodes"], ["get", "services"], ["create", "deployments"], ["delete", "secrets"]];
/** StatefulSet-Namen für die Speicher-Übungen. */
export const STS_NAMES = ["speicher-datenbank", "kai-archiv", "log-speicher", "stamm-db", "tresor-db"];
/** StorageClass-Namen. */
export const SC_NAMES = ["kai-ssd", "kai-archiv-hdd", "schnell-ssd", "lager-standard"];
/** PVC-Namen. */
export const PVC_NAMES = ["lager-daten", "kai-volumen", "stamm-daten", "archiv-platz", "tresor-daten"];
/** VolumeSnapshot-Namen. */
export const SNAP_NAMES = ["lager-snap", "kai-backup", "stamm-snap", "tresor-sicherung"];
/** Werft-Dienst-Namen für die Capstone-Drills (#169). */
export const WERFT_NAMES = ["kombuese-dienst", "lotsen-dienst", "kai-dienst", "anker-dienst", "funk-dienst", "moewen-dienst"];
/** Outputs der Übungs-Flotte (einer wird als sensibel markiert). */
export const TF_FLOTTE_OUTPUTS: { name: string; value: string }[] = [
  { name: "anleger_adresse", value: "nordkai.flotte.local" },
  { name: "flotten_groesse", value: "7" },
];

/** Eine generierte Übungsaufgabe (Drill).
 *  `why` begründet bei falscher Eingabe das Prinzip (nicht nur die Musterlösung) –
 *  „verstehen statt auswendig" (#233). Pflichtfeld: jeder Drill trägt eine Begründung. */
export type DrillTask = { text: string; accept: RegExp[]; solution: string; hint: string; why: string; diag?: (input: string) => string | null };

/** Sorgt dafür, dass ein Dockerfile im Sim-Dateisystem liegt (für docker build/tag). */
export function ensureDockerfile(sim: Sim) {
  if (!sim.files["Dockerfile"]) sim.files["Dockerfile"] = DOCKERFILE;
}

/** #444: Normalisiert den Sandbox-Cluster auf permissive Pod-Security, damit Übungen, die
 *  ein rohes Deployment anlegen, nicht an der Phase-6-Härtung scheitern. */
export function ensureBarePodAdmission(sim: Sim) {
  sim.podSecurity = "privileged";
}

export function ensureDeployment(sim: Sim): Deployment {
  let d = sim.deployments.find(d => !["kantine"].includes(d.name)) || sim.deployments[0];
  if (!d) {
    const name = pick(NAMES);
    ensureBarePodAdmission(sim);
    sim.exec("kubectl create deployment " + name + " --image=nginx");
    d = sim.deployments.find(x => x.name === name)!;
  }
  return d;
}

export function ensureGit(sim: Sim) {
  if (!sim.git.initialized) sim.exec("git init");
}

/** Sorgt dafür, dass ein selbst gebautes Chart existiert, und gibt seinen Namen zurück. */
export function ensureChart(sim: Sim): string {
  if (sim.charts.length === 0) {
    let name = pick(CHART_NAMES);
    while (sim.charts.some(c => c.name === name)) name = pick(CHART_NAMES) + rnd(2, 99);
    sim.exec("helm create " + name);
  }
  return sim.charts[0].name;
}

/** Sorgt dafür, dass mindestens eine NetworkPolicy existiert, und gibt sie zurück. */
export function ensureNetworkPolicy(sim: Sim): NetworkPolicyRes {
  if (sim.networkPolicies.length === 0) {
    let name = pick(NETPOL_NAMES);
    while (sim.networkPolicies.some(n => n.name === name)) name = pick(NETPOL_NAMES) + rnd(2, 99);
    const file = "uebung-netpol.yaml";
    sim.files[file] = NETPOL_YAML;
    sim.applyEffects[file] = { networkPolicy: { name, podSelector: pick(NETPOL_APPS), allowFrom: "hafentor" } };
    sim.exec("kubectl apply -f " + file);
  }
  return sim.networkPolicies[0];
}

/** Sorgt dafür, dass eine Argo-Application existiert, und gibt sie zurück.
 *  Mit `fresh` immer eine NEU angelegte (OutOfSync). */
export function ensureArgoApp(sim: Sim, fresh = false): ArgoApp {
  if (!fresh && sim.argoApps.length > 0) return sim.argoApps[0];
  let name = pick(ARGO_APP_NAMES);
  while (sim.argoApps.some(a => a.name === name)) name = pick(ARGO_APP_NAMES) + rnd(2, 99);
  const file = "ensure-application.yaml";
  sim.files[file] = ARGO_APPLICATION_MANUAL_YAML;
  sim.applyEffects[file] = { application: { name, repo: "https://github.com/port-kubernia/seekarten.git", path: name, autoSync: false, selfHeal: false, deployment: { name, image: "nginx:1.27", replicas: 2 } } };
  sim.exec("kubectl apply -f " + file);
  return sim.argoApps.find(a => a.name === name)!;
}

/** Sorgt dafür, dass eine (Cluster-)Role mit diesem Namen existiert. */
export function ensureRole(sim: Sim, name: string, cluster: boolean) {
  if (sim.roles.some(r => r.name === name && r.cluster === cluster)) return;
  const file = "ensure-" + (cluster ? "clusterrole" : "role") + ".yaml";
  sim.files[file] = cluster ? CLUSTERROLE_YAML : ROLE_YAML;
  sim.applyEffects[file] = { role: { name, cluster, rules: [{ verbs: ["get", "list", "watch"], resources: [cluster ? "nodes" : "pods"] }] } };
  sim.exec("kubectl apply -f " + file);
}

/** Sorgt für eine StorageClass mit Provisioner und gibt ihren Namen zurück. */
export function ensureStorageClass(sim: Sim): string {
  const existing = sim.storageClasses.find(s => s.provisioner);
  if (existing) return existing.name;
  const file = "ensure-storageclass.yaml";
  sim.files[file] = STORAGECLASS_YAML;
  sim.applyEffects[file] = { storageClass: { name: "kai-ssd", provisioner: "kubernetes.io/aws-ebs", reclaimPolicy: "Retain" } };
  sim.exec("kubectl apply -f " + file);
  return "kai-ssd";
}

/** Sorgt für ein gebundenes PVC und gibt seinen Namen zurück. */
export function ensurePvc(sim: Sim): string {
  const bound = sim.pvcs.find(p => p.status === "Bound");
  if (bound) return bound.name;
  const sc = ensureStorageClass(sim);
  let name = pick(PVC_NAMES);
  while (sim.pvcs.some(p => p.name === name)) name = pick(PVC_NAMES) + rnd(2, 99);
  const file = "ensure-pvc.yaml";
  sim.files[file] = PVC_YAML;
  sim.applyEffects[file] = { pvc: { name, storage: "5Gi", storageClass: sc, accessModes: "RWO", data: "lagerbestand" } };
  sim.exec("kubectl apply -f " + file);
  return name;
}

/** Sorgt für ein StatefulSet und gibt seinen Namen zurück. */
export function ensureStatefulSet(sim: Sim): string {
  if (sim.statefulSets.length > 0) return sim.statefulSets[0].name;
  const sc = ensureStorageClass(sim);
  let name = pick(STS_NAMES);
  while (sim.statefulSets.some(s => s.name === name)) name = pick(STS_NAMES) + rnd(2, 99);
  const file = "ensure-statefulset.yaml";
  sim.files[file] = STATEFULSET_YAML;
  sim.applyEffects[file] = { statefulSet: { name, image: "postgres:16", replicas: 3, serviceName: name, volumeClaimName: "daten", storage: "10Gi", storageClass: sc } };
  sim.exec("kubectl apply -f " + file);
  return name;
}

/** Sorgt für einen applizierten Flotten-State mit Outputs. */
export function ensureTfOutputs(sim: Sim) {
  sim.mergeScenario({
    tfResources: [{ addr: "hafen_flotte.expedition", desc: 'name = "kubernia-expedition"' }],
    tfModules: [], tfProviders: [], tfBackend: null,
    tfOutputs: [...TF_FLOTTE_OUTPUTS, { name: "lager_schluessel", value: "werft-geheim", sensitive: true }],
  });
  sim.tf.initialized = true;
  sim.exec("terraform apply");
}

/** Zieht einen Werft-Dienst-Namen, der in Deployments UND Services noch frei ist (#164). */
export function freeWerftName(sim: Sim): string {
  let name = pick(WERFT_NAMES);
  while (sim.deployments.some(d => d.name === name) || sim.services.some(s => s.name === name)) name = pick(WERFT_NAMES) + "-" + rnd(2, 99);
  return name;
}

// Re-export EXTERNALNAME_YAML und VOLUMESNAPSHOT_YAML für Drill-Dateien
export { NETPOL_YAML, EXTERNALNAME_YAML, ARGO_APPLICATION_MANUAL_YAML, SERVICEMONITOR_YAML, PROMETHEUSRULE_YAML, ROLE_YAML, ROLEBINDING_YAML, CLUSTERROLE_YAML, CLUSTERROLEBINDING_YAML, POD_SECURITY_YAML, STATEFULSET_YAML, STORAGECLASS_YAML, PVC_YAML, VOLUMESNAPSHOT_YAML, PVC_RESTORE_YAML };
export { pick, rnd };
