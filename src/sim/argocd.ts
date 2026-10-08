/* ===== Kubernia – argocd-Befehle (sim/argocd.ts) =====
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
import type { ClusterState, ArgoApp, ArgoChildSpec, Deployment, ServiceRes, ServiceSpec, Broken } from "./state";
import { HEADLESS_CLUSTER_IP } from "./state";
import { InvalidSpecError, resourceName } from "./names";
import { table } from "./util";
import { addDeployment, scaleDeployment } from "./workload";
import { notSimulated, parseCall, specOfSub, subEntry, type Call, type SubEntry } from "./cliargs";

/** Was die argocd-Befehle/Reconcile vom Simulator brauchen (von der `Sim`-Klasse
 *  erfüllt). Bewusst ein schmales Interface statt der ganzen `Sim`-Klasse: es
 *  dokumentiert die Kopplung von Argo CD an den Cluster-Zustand und vermeidet einen
 *  Import-Zyklus argocd ↔ sim. Statt des ganzen `ClusterState` (Leaky Abstraction
 *  #516) nur die berührten Daten-Felder per `Pick` (ISP): `argoApps`/`deployments`/
 *  `services`/`clock`; die Feld-Typen bleiben so an die SSOT (sim/state.ts, #372)
 *  gebunden. Hinzu kommen die in `sim.ts` verbleibenden Helfer, die Argo ruft:
 *  Fehlerausgabe, Pod-Readiness und die Deployment-Fabrik. */
export interface ArgocdHost extends Pick<ClusterState, "argoApps" | "deployments" | "services" | "clock"> {
  rng: () => number; // Instanz-eigener Zufallsstrom (#580): scaleDeployment im Reconcile zieht Pod-Namen darüber
  _err(msg: string, tip?: string): string;
  _podReady(d: Deployment): boolean;
  _makeDeployment(name: string, image: string, replicas: number, broken?: Broken | null, envFrom?: { configMaps: string[]; secrets: string[] }, cpuHeavy?: boolean): Deployment;
  _makeService(spec: ServiceSpec): ServiceRes;
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

/** Strukturprüfung einer Workload-Spezifikation (Name/Image String, Replikas Zahl). */
function isWorkloadSpec(w: unknown): boolean {
  const d = w as { name?: unknown; image?: unknown; replicas?: unknown } | null | undefined;
  return !!d && typeof d.name === "string" && typeof d.image === "string" && typeof d.replicas === "number";
}

/** Ein optionaler Soll-Service muss ein Objekt mit String-Namen sein. */
function isServiceShape(sv: unknown): boolean {
  return sv === undefined || (!!sv && typeof (sv as { name?: unknown }).name === "string");
}

/** Eingangsgrenze für Argo-Apps aus Szenario/Spielstand (#1418): lehnt eine strukturell kaputte App
 *  ab, statt sie in den Cluster zu lassen und jeden Befehl mit „Hoppla“ enden zu lassen. Gültig ist
 *  eine Wurzel (Kind-Apps mit Name + Workload) oder eine Leaf-App mit `desired.deployment`. */
export function buildArgoApp(a: ArgoApp): ArgoApp {
  const kinder = a?.childApps;
  const kinderOk = Array.isArray(kinder) && kinder.every(c => typeof c?.name === "string" && isWorkloadSpec(c.deployment) && isServiceShape(c.service));
  const leafOk = !!a?.desired && isWorkloadSpec(a.desired.deployment) && isServiceShape(a.desired.service);
  if (typeof a?.name !== "string" || !(Array.isArray(kinder) ? kinderOk : leafOk)) {
    throw new Error("Kaputte Argo-App '" + String(a?.name) + "': weder Kind-Apps noch ein gültiger Soll (desired.deployment)");
  }
  return cloneArgoApp(a);
}

/** Tipp im GitOps-Kontext: die Wahrheit liegt im Git-Manifest, nicht im Cluster. */
function gitManifestTip(app: ArgoApp): string {
  return "Bei GitOps ist Git die Quelle der Wahrheit: korrigiere das Manifest im Repo " + app.repo + " (Pfad " + app.path +
    "), die Meldung oben nennt das Feld. Danach zieht Argo den Soll von selbst in den Cluster.";
}

/** Vergleichbare Sicht auf einen Service. Der Record-Typ über `keyof ServiceSpec` bricht beim
 *  Typecheck, sobald ein neues ServiceSpec-Feld nicht mitverglichen wird. */
function specView(svc: ServiceRes): Record<Exclude<keyof ServiceSpec, "name">, string> {
  return {
    type: svc.type,
    port: String(svc.port),
    targetPort: String(svc.targetPort ?? svc.port), // Kubernetes setzt targetPort auf port, wenn er fehlt
    externalName: svc.externalName || "",
    clusterIP: svc.clusterIP === HEADLESS_CLUSTER_IP ? HEADLESS_CLUSTER_IP : "", // die vergebene ClusterIP gehört dem Cluster
  };
}

/** Service, der angewendet werden muss (fehlt oder weicht in der Spec ab), sonst null. Wirft
 *  InvalidSpecError, wenn die Fabrik den Soll ablehnt. */
function serviceToApply(host: ArgocdHost, app: ArgoApp): ServiceRes | null {
  const spec = app.desired!.service;
  if (!spec) return null;
  const want = host._makeService(spec);
  const live = host.services.find(x => x.name === want.name);
  if (!live) return want;
  const a = specView(want), b = specView(live);
  return (Object.keys(a) as (keyof typeof a)[]).some(k => a[k] !== b[k]) ? want : null;
}

/** Dry-Run einer Leaf-App ohne Mutation (wie `argocd app sync --dry-run`). Neue Prüfungen in
 *  `_makeDeployment` hier mitziehen. Ein abgelehnter Soll wird mit dem Git-Tipp neu geworfen. */
function planLeaf(host: ArgocdHost, app: ArgoApp): { svc: ServiceRes | null } {
  try {
    const d = app.desired!.deployment;
    if (!host.deployments.some(x => x.name === d.name)) resourceName(d.name);
    return { svc: serviceToApply(host, app) };
  } catch (e) { throw e instanceof InvalidSpecError ? new InvalidSpecError(e.message, gitManifestTip(app)) : e; }
}

/** Sync-Fehler einer Leaf-App (abgelehnter Soll), sonst null. Wurzeln haben keinen eigenen. */
function argoSyncError(host: ArgocdHost, app: ArgoApp): InvalidSpecError | null {
  if (app.childApps) return null;
  try { planLeaf(host, app); return null; } catch (e) { if (e instanceof InvalidSpecError) return e; throw e; }
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
  if (argoSyncError(host, app)) return "OutOfSync"; // abgelehnter Soll
  return planLeaf(host, app).svc ? "OutOfSync" : "Synced"; // Service fehlt oder driftet
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
      tryReconcile(host, child); // Soll-Workload der Kind-App in den Cluster ziehen (ein kaputtes Kind stoppt die Flotte nicht)
    }
    return;
  }
  const d = app.desired!.deployment;
  // Atomar: den Plan VOR jeder Mutation bauen. Lehnt die Fabrik die Soll-Spezifikation ab
  // (InvalidSpecError, mit Git-Tipp), bleibt der Cluster unangetastet (wie ein Argo-Dry-Run).
  const { svc } = planLeaf(host, app);
  const dep = host.deployments.find(x => x.name === d.name);
  if (!dep) {
    addDeployment(host, host._makeDeployment(d.name, d.image, d.replicas));
  } else {
    dep.image = d.image;
    scaleDeployment(dep, d.replicas, host.clock, host.rng);
    dep.broken = null; // ein gesundes Git-Manifest heilt auch eine kaputte Workload
  }
  // #518/#1409: Service zentral über die Fabrik, mit der ganzen Spec (ExternalName, targetPort).
  if (svc) {
    const i = host.services.findIndex(x => x.name === svc.name);
    if (i < 0) host.services.push(svc);
    else host.services[i] = { ...svc, created: host.services[i].created }; // Patch-Semantik: Alter bleibt
  }
}

/** Abgleich, der eine abgelehnte Soll-Spezifikation (InvalidSpecError) schluckt: die App bleibt
 *  OutOfSync, der Self-Heal und die Flotte laufen weiter, es gibt keinen Dauerfehler vor jedem
 *  Befehl. Das manuelle `argocd app sync` ruft `argoReconcile` direkt und meldet den Fehler. Andere
 *  Fehlertypen sind Sim-Bugs und werden weitergeworfen. */
function tryReconcile(host: ArgocdHost, app: ArgoApp): void {
  try { argoReconcile(host, app); } catch (e) { if (!(e instanceof InvalidSpecError)) throw e; }
}

/** Self-Heal-Schleife: läuft vor jeder Eingabe und korrigiert bei auto-sync-Apps mit
 *  self-heal jeden manuellen Drift automatisch zurück (das spürbare Pull-Prinzip). */
export function reconcileAutoSync(host: ArgocdHost): void {
  if (!host.argoApps) return; // exec() kann theoretisch vor reset() laufen
  for (const app of host.argoApps) {
    if (app.autoSync && app.selfHeal && argoSyncStatus(host, app) === "OutOfSync") {
      tryReconcile(host, app);
    }
  }
}

/** Ein `argocd app <action>`-Handler: bekommt Host + Tokens, gibt die Ausgabe. */
type ArgocdAppHandler = (host: ArgocdHost, c: Call) => string;

/** Löst die von `get`/`sync` benötigte Application auf (gemeinsame „welche App?"-Wache),
 *  oder liefert die passende Fehlermeldung. Bündelt die drei sonst duplizierten Fälle
 *  (fehlender Name / Flag statt Name / unbekannter Name). */
function resolveArgoApp(host: ArgocdHost, action: string, name: string | undefined): ArgoApp | string {
  if (!name) return host._err("argocd app " + action + ": Welche Application?", "Die Namen siehst du mit 'argocd app list'.");
  const app = host.argoApps.find(a => a.name === name);
  if (!app) return host._err('Error: rpc error: code = NotFound desc = applications.argoproj.io "' + name + '" not found', "Die Namen siehst du mit 'argocd app list'.");
  return app;
}

/** `argocd app list|ls` – alle Applications mit Sync-/Health-Status. */
function argoAppList(host: ArgocdHost): string {
  if (host.argoApps.length === 0) return "Keine Argo-Applications. (Lege eine an: 'kubectl apply -f <application>.yaml'.)";
  return table(["NAME", "SYNC STATUS", "HEALTH STATUS", "REPO", "PATH"],
    host.argoApps.map(a => [a.name, argoSyncStatus(host, a), argoHealth(host, a), a.repo, a.path]));
}

/** Zeile einer Kind-App in der Wurzel-Ansicht, mit SyncError-Marke bei abgelehntem Soll. */
function childLine(host: ArgocdHost, name: string): string {
  const child = host.argoApps.find(a => a.name === name);
  if (!child) return "  • " + name + "  OutOfSync/Missing";
  return "  • " + name + "  " + argoSyncStatus(host, child) + "/" + argoHealth(host, child) + (argoSyncError(host, child) ? "  ❌ SyncError" : "");
}

/** Namen der Kind-Apps einer Wurzel, deren Sync an einem abgelehnten Soll scheitert. */
function failedChildren(host: ArgocdHost, app: ArgoApp): { name: string; err: InvalidSpecError }[] {
  const out: { name: string; err: InvalidSpecError }[] = [];
  for (const c of app.childApps || []) {
    const child = host.argoApps.find(a => a.name === c.name);
    const err = child && argoSyncError(host, child);
    if (err) out.push({ name: c.name, err });
  }
  return out;
}

/** Hinweis unter einer OutOfSync-App: Fehler im Git-Manifest, Self-Heal oder manueller Sync. */
function outOfSyncHint(host: ArgocdHost, app: ArgoApp): string {
  const err = argoSyncError(host, app);
  if (err) return "▸ Der Sync scheitert am Git-Manifest selbst, Self-Heal und ein erneutes 'argocd app sync' helfen hier nicht. " + gitManifestTip(app);
  const failed = failedChildren(host, app);
  if (failed.length > 0) {
    return "▸ Kind-App(s) " + failed.map(f => "'" + f.name + "'").join(", ") + " scheitern am Git-Manifest, Details: 'argocd app get " + failed[0].name + "'.";
  }
  return app.autoSync && app.selfHeal
    ? "▸ Self-Heal ist an – Argo dreht den Drift beim nächsten Abgleich von selbst auf den Git-Stand zurück."
    : "▸ Bring den Cluster auf den Git-Soll: 'argocd app sync " + app.name + "'. (Git ist die Quelle der Wahrheit, nicht der Cluster.)";
}

/** `argocd app get <name>` – Detailansicht einer Application (inkl. App-of-Apps-Kinder). */
function argoAppGet(host: ArgocdHost, c: Call): string {
  const app = resolveArgoApp(host, "get", c.args[0]);
  if (typeof app === "string") return app;
  const sync = argoSyncStatus(host, app);
  const err = argoSyncError(host, app);
  const lines = [
    "Name:               " + app.name,
    "Project:            default",
    "Source Repo:        " + app.repo,
    "Source Path:        " + app.path,
    "Sync Policy:        " + (app.autoSync ? "Automated" + (app.selfHeal ? " (self-heal)" : "") : "<none> (manuell)"),
    "Sync Status:        " + sync + (sync === "Synced" ? " ✅" : " ⚠️  (der Cluster weicht vom Git-Soll ab)"),
    "Health Status:      " + argoHealth(host, app),
  ];
  if (err) lines.push("Conditions:         SyncError ❌ one or more objects failed to apply, reason: " + err.message);
  if (app.childApps) {
    lines.push("Managed Apps:       " + app.childApps.length + " (App-of-Apps – eine Wurzel verwaltet die ganze Flotte)");
    for (const c of app.childApps) lines.push(childLine(host, c.name));
  }
  if (sync === "OutOfSync") lines.push(outOfSyncHint(host, app));
  return lines.join("\n");
}

/** Fehlerausgabe eines Wurzel-Syncs, dessen Kinder am Git-Manifest scheitern. */
function rootSyncFailure(host: ArgocdHost, app: ArgoApp, failed: { name: string; err: InvalidSpecError }[]): string {
  const total = app.childApps!.length;
  const head = [
    "Synchronisiere Application '" + app.name + "' …",
    "Sync Status: OutOfSync ⚠️   Health: " + argoHealth(host, app),
    "❌ " + failed.length + " von " + total + " Kind-Apps konnten nicht synchronisiert werden:",
    ...failed.map(f => "  • " + f.name + ": " + f.err.message),
  ].join("\n");
  return host._err(head, "Details mit 'argocd app get " + failed[0].name + "'.");
}

/** `argocd app sync <name>` – zieht den Git-Soll in den Cluster (Pull-Prinzip). */
function argoAppSync(host: ArgocdHost, c: Call): string {
  const app = resolveArgoApp(host, "sync", c.args[0]);
  if (typeof app === "string") return app;
  const before = argoSyncStatus(host, app);
  argoReconcile(host, app);
  if (before === "Synced") {
    return "Application '" + app.name + "' ist bereits Synced ✅ – Cluster und Git-Soll stimmen überein, nichts zu tun. 🧘";
  }
  const failed = failedChildren(host, app);
  if (failed.length > 0) return rootSyncFailure(host, app, failed);
  const after = argoSyncStatus(host, app);
  return [
    "Synchronisiere Application '" + app.name + "' …",
    app.childApps
      ? "App-of-Apps: Argo legt aus dem '" + app.path + "'-Ordner jede Kind-Application an (eine Wurzel → die ganze Flotte)."
      : "Argo zieht den im Git deklarierten Soll-Zustand in den Cluster (Pull-Prinzip).",
    "Sync Status: " + after + (after === "Synced" ? " ✅" : " ⚠️") + "   Health: " + argoHealth(host, app),
    app.childApps
      ? "▸ Schau mit 'argocd app list' – die ganze Flotte ist jetzt da."
      : "▸ Schau mit 'kubectl get deployments' – der Cluster entspricht jetzt wieder dem Git-Stand.",
  ].join("\n");
}

/** Alias → Eintrag (Handler + Flag-Tabelle, #1459: die Sim wertet bei `argocd app` keine Flags aus). Ein neuer
 *  `argocd app`-Verb ist ein Eintrag hier + eine Funktion oben – der Dispatcher (`argocdCommand`) bleibt dünn
 *  und wächst nicht mit dem Befehlssatz. */
const LIST: SubEntry<ArgocdAppHandler> = { run: argoAppList };
const ARGOCD_APP_ACTIONS: Record<string, SubEntry<ArgocdAppHandler>> = {
  list: LIST,
  ls: LIST,
  get: { run: argoAppGet },
  sync: { run: argoAppSync },
};

const ARGOCD_KANN = ["argocd app list", "argocd app get <name>", "argocd app sync <name>"];

export function argocdCommand(host: ArgocdHost, t: string[]): string {
  if (!t[1]) return host._err("argocd: Unterbefehl fehlt.", "z.B. 'argocd app list'.");
  if (t[1] !== "app") return notSimulated(host, "'argocd " + t[1] + "'.", ARGOCD_KANN);
  const action = t[2];
  if (!action) return host._err("argocd app: Aktion fehlt.", "z.B. 'argocd app list', 'argocd app get <name>' oder 'argocd app sync <name>'.");
  const entry = subEntry(ARGOCD_APP_ACTIONS, action);
  if (!entry) return notSimulated(host, "'argocd app " + action + "'.", ARGOCD_KANN);
  const call = parseCall(host, specOfSub("argocd app " + action, entry), t, 3);
  return typeof call === "string" ? call : entry.run(host, call);
}
