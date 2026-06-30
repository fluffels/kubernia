import type { Sim } from "../../sim";
import { pick, rnd, ARGO_APP_NAMES, ensureArgoApp, ARGO_APPLICATION_MANUAL_YAML } from "./shared";
import type { DrillTask } from "./shared";

export const GITOPS_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "argo-apply": sim => {
    let name = pick(ARGO_APP_NAMES);
    while (sim.argoApps.some(a => a.name === name)) name = pick(ARGO_APP_NAMES) + rnd(2, 99);
    const file = "drill-application.yaml";
    sim.files[file] = ARGO_APPLICATION_MANUAL_YAML;
    sim.applyEffects[file] = { application: { name, repo: "https://github.com/port-kubernia/seekarten.git", path: name, autoSync: false, selfHeal: false, deployment: { name, image: "nginx:1.27", replicas: 2 } } };
    return { text: "Eine Argo-<b>Application</b> ist ein ganz normales Manifest: wende die Seekarte <code>" + file + "</code> deklarativ an, damit Argo den neuen Auftrag kennt.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+drill-application\.yaml$/], solution: "kubectl apply --filename " + file, hint: "Der vertraute Befehl: kubectl apply --filename &lt;datei&gt;", why: "Eine Argo-Application ist selbst nur ein Manifest – mit dem vertrauten kubectl apply --filename &lt;datei&gt; machst du Argo den Soll-Zustand bekannt." };
  },
  "argo-app-list": sim => {
    ensureArgoApp(sim);
    return { text: "Verschaff dir den Flotten-Überblick: zeig alle <b>Argo-Applications</b> mit ihrem Sync- und Health-Status.", accept: [/^argocd\s+app\s+(list|ls)$/], solution: "argocd app list", hint: "Schreib es aus: argocd app list (die Kurzform ls verdienst du dir durch Nutzung).", why: "argocd app list zeigt alle Applications mit ihrem Sync- (Synced/OutOfSync) und Health-Status auf einen Blick. Die Kurzform ls verdienst du dir, wenn du die Langform oft genug tippst." };
  },
  "argo-app-get": sim => {
    const app = ensureArgoApp(sim);
    return { text: "Öffne die Akte der Application <code>" + app.name + "</code> – lies Sync Status und Health.", accept: [new RegExp("^argocd\\s+app\\s+get\\s+" + app.name.replace(/[-]/g, "\\-") + "$")], solution: "argocd app get " + app.name, hint: "Muster: argocd app get &lt;name&gt; – die Namen zeigt 'argocd app list'.", why: "argocd app get &lt;name&gt; öffnet die Akte einer einzelnen Application (Sync Status, Health, Details); die Namen liefert vorher argocd app list." };
  },
  "argo-app-sync": sim => {
    const app = ensureArgoApp(sim, true);
    return { text: "Die Application <code>" + app.name + "</code> ist <b>OutOfSync</b>. Zieh den im Git deklarierten Soll-Zustand in den Cluster (Pull-Prinzip).", accept: [new RegExp("^argocd\\s+app\\s+sync\\s+" + app.name.replace(/[-]/g, "\\-") + "$")], solution: "argocd app sync " + app.name, hint: "Muster: argocd app sync &lt;name&gt;", why: "OutOfSync heißt: Cluster-Ist und Git-Soll klaffen auseinander. sync zieht den im Git deklarierten Stand per Pull in den Cluster – Muster: argocd app sync &lt;name&gt;." };
  },
};
