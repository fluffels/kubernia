/* ===== KubeQuest – argocd-Befehle (sim/argocd.ts) =====
 * Schritt 7/7 (letzter) des sim.ts-Datei-Splits (#378, aus Epic #346, ADR 0004).
 * Danach ist `sim.ts` ein schlankes Barrel + der Sim-Kern (State/Dispatch/
 * Observability/glab), aber keine Befehlsfamilie mehr.
 *
 * Hier liegt die komplette `argocd`-Befehlsfamilie (GitOps / Argo CD:
 * app list/get/sync) samt der GitOps-Reconcile-Logik. Wie bei den
 * Vorgänger-Splits (#373–#377) als freie Funktionen ausgelagert, die die
 * Sim-Instanz über das schmale `ArgocdHost`-Interface bekommen – so bleibt der
 * Cluster-Zustand in EINER Hand (die `Sim`-Klasse), die GitOps-Logik aber in
 * einer eigenen, testbaren Datei.
 *
 * Anders als die übrigen Familien ist Argo CD verzahnt: die Reconcile-Funktionen
 * werden NICHT nur vom `argocd`-Befehl gebraucht, sondern auch von anderen
 * Modulen. Darum sind sie hier EXPORTIERT statt modul-privat:
 *  - `reconcileAutoSync` läuft vor jeder Eingabe (Self-Heal-Schleife) → von `exec` in sim.ts.
 *  - `argoReconcile` + `cloneChildSpec` zieht/kloniert beim `kubectl apply` einer
 *    Application den Soll in den Cluster → direkt von `sim/kubectl.ts` importiert.
 *  - `cloneArgoApp` tieft-kopiert Apps für reset/snapshot/serialize → von sim.ts.
 * So bleibt die GitOps-Logik an einer Stelle, ohne sie über Host-Methoden
 * zurück durch `sim.ts` zu schleifen (das wäre wieder ein verstecktes Geflecht).
 *
 * Phaser-frei (pure Domäne): Tabellen-Ausgabe + Pod-Namen kommen aus ./util, die
 * Domänentypen aus ./state – kein Rückimport nach sim.ts (kein Zyklus).
 */
import type { ClusterState, ArgoApp, ArgoChildSpec, Deployment, Broken } from "./state";
import { table } from "./util";
import { addDeployment, scaleDeployment } from "./workload";

/** Was die argocd-Befehle/Reconcile vom Simulator brauchen (von der `Sim`-Klasse
 *  erfüllt). Bewusst ein schmales Interface statt der ganzen `Sim`-Klasse: es
 *  dokumentiert die Kopplung von Argo CD an den Cluster-Zustand und vermeidet einen
 *  Import-Zyklus argocd ↔ sim. Die Daten-Felder (`argoApps`/`deployments`/`services`/
 *  `clock`) kommen über `extends ClusterState` (sim/state.ts, #372); hinzu kommen
 *  die in `sim.ts` verbleibenden Helfer, die Argo ruft: Fehlerausgabe,
 *  Pod-Readiness und die Deployment-Fabrik. */
export interface ArgocdHost extends ClusterState {
  _err(msg: string, tip?: string): string;
  _podReady(d: Deployment): boolean;
  _makeDeployment(name: string, image: string, replicas: number, broken?: Broken | null, envFrom?: { configMaps: string[]; secrets: string[] }, cpuHeavy?: boolean): Deployment;
}

/** Tiefe Kopie einer Kind-App-Spezifikation (App-of-Apps). */
export function cloneChildSpec(c: ArgoChildSpec): ArgoChildSpec {
  return {
    name: c.name,
    ...(c.path ? { path: c.path } : {}),
    deployment: Object.assign({}, c.deployment),
    ...(c.service ? { service: Object.assign({}, c.service) } : {}),
  };
}

/** Tiefe Kopie einer Argo-App (für reset/snapshot/mergeScenario). */
export function cloneArgoApp(a: ArgoApp): ArgoApp {
  return {
    name: a.name, repo: a.repo, path: a.path,
    autoSync: !!a.autoSync, selfHeal: !!a.selfHeal,
    created: a.created || 0,
    ...(a.desired ? { desired: {
      deployment: Object.assign({}, a.desired.deployment),
      ...(a.desired.service ? { service: Object.assign({}, a.desired.service) } : {}),
    } } : {}),
    ...(a.childApps ? { childApps: a.childApps.map(c => cloneChildSpec(c)) } : {}),
  };
}

/** Sync-Status: stimmt der Cluster mit dem im Git deklarierten Soll überein?
 *  Wird IMMER live aus dem Cluster-Zustand berechnet – ein manuelles `kubectl scale`
 *  (Drift) oder ein gelöschtes Deployment macht die App damit sofort OutOfSync. */
function argoSyncStatus(host: ArgocdHost, app: ArgoApp): "Synced" | "OutOfSync" {
  // App-of-Apps-Wurzel: Synced, sobald jede Kind-App existiert UND selbst Synced ist.
  if (app.childApps) {
    return app.childApps.every(c => {
      const child = host.argoApps.find(a => a.name === c.name);
      return !!child && argoSyncStatus(host, child) === "Synced";
    }) ? "Synced" : "OutOfSync";
  }
  const d = app.desired!.deployment;
  const dep = host.deployments.find(x => x.name === d.name);
  if (!dep) return "OutOfSync";                 // Soll-Ressource fehlt im Cluster
  if (dep.image !== d.image || dep.replicas !== d.replicas) return "OutOfSync"; // Drift
  if (app.desired!.service && !host.services.some(s => s.name === app.desired!.service!.name)) return "OutOfSync";
  return "Synced";
}

/** Health-Status: läuft die ausgerollte Workload gesund? */
function argoHealth(host: ArgocdHost, app: ArgoApp): "Healthy" | "Progressing" | "Degraded" | "Missing" {
  // App-of-Apps-Wurzel: aggregiert die Gesundheit aller Kind-Apps.
  if (app.childApps) {
    const children = app.childApps.map(c => host.argoApps.find(a => a.name === c.name));
    if (children.some(c => !c)) return "Missing";               // noch nicht ausgerollt
    const healths = children.map(c => argoHealth(host, c!));
    if (healths.includes("Degraded")) return "Degraded";
    if (healths.includes("Missing")) return "Missing";
    if (healths.includes("Progressing")) return "Progressing";
    return "Healthy";
  }
  const dep = host.deployments.find(x => x.name === app.desired!.deployment.name);
  if (!dep) return "Missing";
  if (dep.broken) return "Degraded";
  return host._podReady(dep) ? "Healthy" : "Progressing";
}

/** Pull: zieht den im Git deklarierten Soll-Zustand in den Cluster – legt fehlende
 *  Ressourcen an und dreht Drift (falsches Image/abweichende Replikas) zurück. */
export function argoReconcile(host: ArgocdHost, app: ArgoApp): void {
  // App-of-Apps-Wurzel: legt aus dem `flotte/`-Ordner jede Kind-Application an
  // (eine Wurzel → die ganze Flotte) und gleicht bestehende Kinder gleich mit ab.
  if (app.childApps) {
    for (const c of app.childApps) {
      let child = host.argoApps.find(a => a.name === c.name);
      if (!child) {
        child = {
          name: c.name,
          repo: app.repo,
          path: c.path || c.name + "/",
          autoSync: true,            // von der Flotte verwaltet → läuft mit
          selfHeal: app.selfHeal,    // erbt die Self-Heal-Politik der Wurzel
          desired: {
            deployment: Object.assign({}, c.deployment),
            ...(c.service ? { service: Object.assign({}, c.service) } : {}),
          },
          created: host.clock,
        };
        host.argoApps.push(child);
      }
      argoReconcile(host, child); // Soll-Workload der Kind-App in den Cluster ziehen
    }
    return;
  }
  const d = app.desired!.deployment;
  const dep = host.deployments.find(x => x.name === d.name);
  if (!dep) {
    addDeployment(host, host._makeDeployment(d.name, d.image, d.replicas));
  } else {
    dep.image = d.image;
    scaleDeployment(dep, d.replicas, host.clock);
    dep.broken = null; // ein gesundes Git-Manifest heilt auch eine kaputte Workload
  }
  const s = app.desired!.service;
  if (s && !host.services.some(x => x.name === s.name)) {
    host.services.push({
      name: s.name, type: s.type || "ClusterIP",
      clusterIP: "10.96." + Math.floor(Math.random() * 250) + "." + Math.floor(Math.random() * 250),
      port: s.port, created: host.clock,
    });
  }
}

/** Self-Heal-Schleife: läuft vor jeder Eingabe und korrigiert bei auto-sync-Apps mit
 *  self-heal jeden manuellen Drift automatisch zurück (das spürbare Pull-Prinzip). */
export function reconcileAutoSync(host: ArgocdHost): void {
  if (!host.argoApps) return; // exec() kann theoretisch vor reset() laufen
  for (const app of host.argoApps) {
    if (app.autoSync && app.selfHeal && argoSyncStatus(host, app) === "OutOfSync") {
      argoReconcile(host, app);
    }
  }
}

export function argocdCommand(host: ArgocdHost, t: string[]): string {
  if (t[1] !== "app") return host._err("Der Simulator kann nur 'argocd app ...'.", "z.B. 'argocd app list', 'argocd app get <name>' oder 'argocd app sync <name>'.");
  const action = t[2];

  if (action === "list" || action === "ls") {
    if (host.argoApps.length === 0) return "Keine Argo-Applications. (Lege eine an: 'kubectl apply -f <application>.yaml'.)";
    return table(["NAME", "SYNC STATUS", "HEALTH STATUS", "REPO", "PATH"],
      host.argoApps.map(a => [a.name, argoSyncStatus(host, a), argoHealth(host, a), a.repo, a.path]));
  }

  if (action === "get") {
    const name = t[3];
    if (!name || name.startsWith("-")) return host._err("argocd app get: Welche Application?", "Die Namen siehst du mit 'argocd app list'.");
    const app = host.argoApps.find(a => a.name === name);
    if (!app) return host._err('Error: rpc error: code = NotFound desc = applications.argoproj.io "' + name + '" not found', "Die Namen siehst du mit 'argocd app list'.");
    const sync = argoSyncStatus(host, app);
    const lines = [
      "Name:               " + app.name,
      "Project:            default",
      "Source Repo:        " + app.repo,
      "Source Path:        " + app.path,
      "Sync Policy:        " + (app.autoSync ? "Automated" + (app.selfHeal ? " (self-heal)" : "") : "<none> (manuell)"),
      "Sync Status:        " + sync + (sync === "Synced" ? " ✅" : " ⚠️  (der Cluster weicht vom Git-Soll ab)"),
      "Health Status:      " + argoHealth(host, app),
    ];
    if (app.childApps) {
      lines.push("Managed Apps:       " + app.childApps.length + " (App-of-Apps – eine Wurzel verwaltet die ganze Flotte)");
      for (const c of app.childApps) {
        const child = host.argoApps.find(a => a.name === c.name);
        lines.push("  • " + c.name + "  " + (child ? argoSyncStatus(host, child) + "/" + argoHealth(host, child) : "OutOfSync/Missing"));
      }
    }
    if (sync === "OutOfSync") {
      lines.push(app.autoSync && app.selfHeal
        ? "▸ Self-Heal ist an – Argo dreht den Drift beim nächsten Abgleich von selbst auf den Git-Stand zurück."
        : "▸ Bring den Cluster auf den Git-Soll: 'argocd app sync " + app.name + "'. (Git ist die Quelle der Wahrheit, nicht der Cluster.)");
    }
    return lines.join("\n");
  }

  if (action === "sync") {
    const name = t[3];
    if (!name || name.startsWith("-")) return host._err("argocd app sync: Welche Application?", "Die Namen siehst du mit 'argocd app list'.");
    const app = host.argoApps.find(a => a.name === name);
    if (!app) return host._err('Error: rpc error: code = NotFound desc = applications.argoproj.io "' + name + '" not found', "Die Namen siehst du mit 'argocd app list'.");
    const before = argoSyncStatus(host, app);
    argoReconcile(host, app);
    if (before === "Synced") {
      return "Application '" + app.name + "' ist bereits Synced ✅ – Cluster und Git-Soll stimmen überein, nichts zu tun. 🧘";
    }
    return [
      "Synchronisiere Application '" + app.name + "' …",
      app.childApps
        ? "App-of-Apps: Argo legt aus dem '" + app.path + "'-Ordner jede Kind-Application an (eine Wurzel → die ganze Flotte)."
        : "Argo zieht den im Git deklarierten Soll-Zustand in den Cluster (Pull-Prinzip).",
      "Sync Status: Synced ✅   Health: " + argoHealth(host, app),
      app.childApps
        ? "▸ Schau mit 'argocd app list' – die ganze Flotte ist jetzt da."
        : "▸ Schau mit 'kubectl get deployments' – der Cluster entspricht jetzt wieder dem Git-Stand.",
    ].join("\n");
  }

  return host._err("argocd app: unbekannte Aktion '" + (action || "") + "'", "z.B. 'argocd app list', 'argocd app get <name>' oder 'argocd app sync <name>'.");
}
