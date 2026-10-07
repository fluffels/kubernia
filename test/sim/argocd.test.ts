/* Unit-Tests: argocd-Befehlsfamilie + GitOps-Reconcile (sim/argocd.ts) – Teil des
 * sim.test.ts-Splits (#383). app list/get/sync, Drift/Self-Heal und das
 * App-of-Apps-Muster (#90/#96/#97). Fahren über sim.exec("…"); Fixtures in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";
import type { ServiceSpec } from "../../src/sim/state";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

/* ===================== argocd / GitOps (Issue #90) ===================== */

// Legt eine Argo-Application-CRD als apply-Effekt an (manuelle Sync-Policy, falls nicht anders gesagt).
function legeArgoApp(s: KQSim, opts: { autoSync?: boolean; selfHeal?: boolean } = {}) {
  s.files["kasse-app.yaml"] = "kind: Application …";
  s.applyEffects["kasse-app.yaml"] = {
    application: {
      name: "kasse", repo: "https://git.hafen.de/apps.git", path: "kasse/",
      autoSync: opts.autoSync, selfHeal: opts.selfHeal,
      deployment: { name: "kasse", image: "nginx", replicas: 3 },
      service: { name: "kasse", port: "80" },
    },
  };
}

test("argocd: apply einer Application-CRD legt eine Argo-App an – erst OutOfSync/Missing", () => {
  legeArgoApp(sim);
  const r = sim.exec("kubectl apply -f kasse-app.yaml");
  assert.match(r.output!, /application\.argoproj\.io\/kasse created/);
  assert.equal(sim.argoApps.length, 1, "App liegt im Sim-State");
  // Noch nichts ausgerollt: Deployment fehlt -> OutOfSync, Health Missing
  assert.equal(sim.deployments.length, 0, "ohne sync wird nichts materialisiert");
  const get = sim.exec("argocd app get kasse");
  assert.match(get.output!, /Sync Status:\s+OutOfSync/);
  assert.match(get.output!, /Health Status:\s+Missing/);
});

test("argocd: app sync zieht den Git-Soll in den Cluster (Pull) -> Synced/Healthy", () => {
  legeArgoApp(sim);
  sim.exec("kubectl apply -f kasse-app.yaml");
  const sync = sim.exec("argocd app sync kasse");
  assert.ok(!sync.error);
  assert.match(sync.output!, /Synced/);
  const dep = sim.deployments.find(d => d.name === "kasse");
  assert.ok(dep, "Deployment wurde materialisiert");
  assert.equal(dep!.replicas, 3, "Replikas wie im Git deklariert");
  assert.equal(dep!.image, "nginx");
  assert.ok(sim.services.some(s => s.name === "kasse"), "Service wurde mit angelegt");
  assert.match(sim.exec("argocd app get kasse").output!, /Sync Status:\s+Synced/);
  assert.match(sim.exec("argocd app get kasse").output!, /Health Status:\s+Healthy/);
});

test("argocd: list zeigt Sync- und Health-Status", () => {
  legeArgoApp(sim);
  sim.exec("kubectl apply -f kasse-app.yaml");
  assert.match(sim.exec("argocd app list").output!, /kasse\s+OutOfSync\s+Missing/);
  sim.exec("argocd app sync kasse");
  assert.match(sim.exec("argocd app list").output!, /kasse\s+Synced\s+Healthy/);
});

test("argocd: Drift durch kubectl scale macht OutOfSync, erneutes sync dreht ihn zurück", () => {
  legeArgoApp(sim); // manuelle Policy, kein self-heal
  sim.exec("kubectl apply -f kasse-app.yaml");
  sim.exec("argocd app sync kasse");
  // manueller Eingriff am Cluster -> weicht vom Git-Soll ab
  sim.exec("kubectl scale deployment kasse --replicas=7");
  assert.equal(sim.deployments.find(d => d.name === "kasse")!.replicas, 7, "Drift bleibt zunächst stehen (kein self-heal)");
  assert.match(sim.exec("argocd app get kasse").output!, /Sync Status:\s+OutOfSync/);
  // Pull bringt den Cluster wieder auf den deklarierten Stand
  sim.exec("argocd app sync kasse");
  assert.equal(sim.deployments.find(d => d.name === "kasse")!.replicas, 3, "Sync stellt den Git-Soll wieder her");
  assert.match(sim.exec("argocd app get kasse").output!, /Sync Status:\s+Synced/);
});

test("argocd: Drift durch set image macht OutOfSync, sync setzt das Image zurück", () => {
  legeArgoApp(sim);
  sim.exec("kubectl apply -f kasse-app.yaml");
  sim.exec("argocd app sync kasse");
  sim.exec("kubectl set image deployment/kasse kasse=redis");
  assert.match(sim.exec("argocd app get kasse").output!, /OutOfSync/);
  sim.exec("argocd app sync kasse");
  assert.equal(sim.deployments.find(d => d.name === "kasse")!.image, "nginx", "Git-Image gewinnt");
});

test("argocd: gelöschtes Deployment macht OutOfSync/Missing, sync legt es neu an", () => {
  legeArgoApp(sim);
  sim.exec("kubectl apply -f kasse-app.yaml");
  sim.exec("argocd app sync kasse");
  sim.exec("kubectl delete deployment kasse");
  const get = sim.exec("argocd app get kasse");
  assert.match(get.output!, /OutOfSync/);
  assert.match(get.output!, /Missing/);
  sim.exec("argocd app sync kasse");
  assert.ok(sim.deployments.some(d => d.name === "kasse"), "sync materialisiert die fehlende Ressource neu");
});

test("argocd: auto-sync rollt den Soll beim apply sofort aus (kein manuelles sync nötig)", () => {
  legeArgoApp(sim, { autoSync: true, selfHeal: true });
  const r = sim.exec("kubectl apply -f kasse-app.yaml");
  assert.match(r.output!, /Automated/);
  assert.ok(sim.deployments.some(d => d.name === "kasse"), "auto-sync materialisiert sofort");
  assert.match(sim.exec("argocd app get kasse").output!, /Sync Status:\s+Synced/);
});

test("argocd: self-heal dreht manuellen Drift beim nächsten Tick automatisch zurück (Pull spürbar)", () => {
  legeArgoApp(sim, { autoSync: true, selfHeal: true });
  sim.exec("kubectl apply -f kasse-app.yaml");
  sim.exec("kubectl scale deployment kasse --replicas=9");
  // direkt nach dem Scale steht der Drift noch (reconcile läuft VOR dem nächsten Befehl)
  assert.equal(sim.deployments.find(d => d.name === "kasse")!.replicas, 9);
  // der nächste Befehl tickt die Self-Heal-Schleife -> Drift weg
  const get = sim.exec("argocd app get kasse");
  assert.equal(sim.deployments.find(d => d.name === "kasse")!.replicas, 3, "self-heal hat zurückgedreht");
  assert.match(get.output!, /Sync Status:\s+Synced/);
});

test("argocd: ohne self-heal bleibt der Drift bei auto-sync stehen (Gegenprobe)", () => {
  legeArgoApp(sim, { autoSync: true, selfHeal: false });
  sim.exec("kubectl apply -f kasse-app.yaml");
  sim.exec("kubectl scale deployment kasse --replicas=9");
  sim.exec("argocd app get kasse"); // Tick – darf NICHT heilen
  assert.equal(sim.deployments.find(d => d.name === "kasse")!.replicas, 9, "ohne self-heal kein Auto-Zurückdrehen");
  assert.match(sim.exec("argocd app get kasse").output!, /OutOfSync/);
});

test("argocd: Snapshot/Reset bewahrt Argo-Apps inkl. Sync-Status", () => {
  legeArgoApp(sim, { autoSync: true, selfHeal: true });
  sim.exec("kubectl apply -f kasse-app.yaml");
  const snap = sim.snapshot();
  const wieder = new KQSim(snap);
  assert.equal(wieder.argoApps.length, 1, "App überlebt das Speichern");
  assert.equal(wieder.argoApps[0].name, "kasse");
  assert.equal(wieder.argoApps[0].autoSync, true);
  assert.match(wieder.exec("argocd app get kasse").output!, /Synced/);
});

test("argocd: Fehlerfälle – unbekannter Unterbefehl, fehlende/unbekannte App", () => {
  assert.ok(sim.exec("argocd cluster list").error, "nur 'argocd app ...' wird unterstützt");
  assert.ok(sim.exec("argocd app get").error, "Name fehlt");
  const miss = sim.exec("argocd app get gibtsnicht");
  assert.ok(miss.error);
  assert.match(miss.output!, /NotFound/);
  assert.ok(sim.exec("argocd app sync gibtsnicht").error, "sync auf unbekannte App ist Fehler");
  assert.ok(sim.exec("argocd app huh kasse").error, "unbekannte Aktion");
});

test("argocd: doppeltes apply ist idempotent (unchanged, keine zweite App)", () => {
  legeArgoApp(sim);
  assert.match(sim.exec("kubectl apply -f kasse-app.yaml").output!, /created/);
  assert.match(sim.exec("kubectl apply -f kasse-app.yaml").output!, /unchanged/);
  assert.equal(sim.argoApps.length, 1);
});

test("argocd: apply mit neuen selfHeal/autoSync-Einstellungen gibt 'configured' zurück (#96)", () => {
  // Erst ohne selfHeal anlegen
  legeArgoApp(sim, { autoSync: false, selfHeal: false });
  sim.exec("kubectl apply -f kasse-app.yaml");
  sim.exec("argocd app sync kasse");
  assert.equal(sim.argoApps[0].selfHeal, false, "selfHeal ist initial aus");

  // Update-YAML: selfHeal und autoSync einschalten
  sim.files["kasse-selfheal.yaml"] = "kind: Application (selfHeal)";
  sim.applyEffects["kasse-selfheal.yaml"] = {
    application: {
      name: "kasse", repo: "https://git.hafen.de/apps.git", path: "kasse/",
      autoSync: true, selfHeal: true,
      deployment: { name: "kasse", image: "nginx", replicas: 3 },
    },
  };
  const r = sim.exec("kubectl apply -f kasse-selfheal.yaml");
  assert.match(r.output!, /configured/, "apply mit geänderter Policy gibt 'configured' zurück");
  assert.equal(sim.argoApps.length, 1, "keine zweite App angelegt");
  assert.equal(sim.argoApps[0].selfHeal, true, "selfHeal ist jetzt aktiv");
  assert.equal(sim.argoApps[0].autoSync, true, "autoSync ist jetzt aktiv");
});

test("argocd: nach selfHeal-Aktivierung per apply dreht Self-Heal Drift zurück (#96)", () => {
  // Anlegen ohne selfHeal, synced
  legeArgoApp(sim, { autoSync: false, selfHeal: false });
  sim.exec("kubectl apply -f kasse-app.yaml");
  sim.exec("argocd app sync kasse");

  // selfHeal via zweites apply aktivieren
  sim.files["kasse-selfheal.yaml"] = "kind: Application (selfHeal)";
  sim.applyEffects["kasse-selfheal.yaml"] = {
    application: {
      name: "kasse", repo: "https://git.hafen.de/apps.git", path: "kasse/",
      autoSync: true, selfHeal: true,
      deployment: { name: "kasse", image: "nginx", replicas: 3 },
    },
  };
  sim.exec("kubectl apply -f kasse-selfheal.yaml");

  // manueller Drift
  sim.exec("kubectl scale deployment kasse --replicas=0");
  assert.equal(sim.deployments.find(d => d.name === "kasse")!.replicas, 0, "Drift erzeugt");

  // nächster Befehl → reconcileAutoSync dreht zurück
  sim.exec("kubectl get deployments");
  assert.equal(sim.deployments.find(d => d.name === "kasse")!.replicas, 3, "selfHeal stellt Git-Soll wieder her");
});

test("argocd: 'argcd' bekommt einen Meintest-du-Vorschlag", () => {
  const r = sim.exec("argcd app list");
  assert.ok(r.error);
  assert.match(r.output!, /argocd/);
});

/* ----- App-of-Apps-Muster (#97) ----- */

// Legt eine App-of-Apps-Wurzel als apply-Effekt an: eine Application, die selbst nichts
// ausrollt, sondern nur auf einen Ordner voller weiterer Applications zeigt (#97).
function legeAppOfApps(s: KQSim, opts: { autoSync?: boolean; selfHeal?: boolean } = {}) {
  s.files["flotte.yaml"] = "kind: Application (App-of-Apps) …";
  s.applyEffects["flotte.yaml"] = {
    application: {
      name: "hafen-flotte", repo: "https://git.hafen.de/seekarten.git", path: "flotte",
      autoSync: opts.autoSync, selfHeal: opts.selfHeal,
      childApps: [
        { name: "flotte-lager", path: "flotte/lager", deployment: { name: "flotte-lager", image: "nginx:1.27", replicas: 2 } },
        { name: "flotte-funk",  path: "flotte/funk",  deployment: { name: "flotte-funk",  image: "nginx:1.27", replicas: 2 } },
        { name: "flotte-kran",  path: "flotte/kran",  deployment: { name: "flotte-kran",  image: "nginx:1.27", replicas: 1 } },
      ],
    },
  };
}

test("App-of-Apps: ein apply der Wurzel legt die ganze Flotte an (eine Wurzel → n Apps)", () => {
  legeAppOfApps(sim, { autoSync: true, selfHeal: true });
  const r = sim.exec("kubectl apply -f flotte.yaml");
  assert.match(r.output!, /application\.argoproj\.io\/hafen-flotte created/);
  // Wurzel + drei Kind-Apps
  assert.equal(sim.argoApps.length, 4, "Wurzel plus drei Kind-Apps");
  for (const n of ["flotte-lager", "flotte-funk", "flotte-kran"]) {
    assert.ok(sim.argoApps.some(a => a.name === n), n + " als Kind-App angelegt");
    assert.ok(sim.deployments.some(d => d.name === n), n + " Deployment ausgerollt");
  }
  // Gegenprobe: die Wurzel selbst rollt KEIN eigenes Deployment aus
  assert.ok(!sim.deployments.some(d => d.name === "hafen-flotte"), "die Wurzel verwaltet nur, sie deployt selbst nichts");
  // Replikas wie in den Kind-Specs deklariert
  assert.equal(sim.deployments.find(d => d.name === "flotte-lager")!.replicas, 2);
  assert.equal(sim.deployments.find(d => d.name === "flotte-kran")!.replicas, 1);
});

test("App-of-Apps: 'argocd app get' der Wurzel listet die verwalteten Kind-Apps und ist Synced/Healthy", () => {
  legeAppOfApps(sim, { autoSync: true, selfHeal: true });
  sim.exec("kubectl apply -f flotte.yaml");
  const get = sim.exec("argocd app get hafen-flotte");
  assert.match(get.output!, /Managed Apps:\s+3/);
  assert.match(get.output!, /flotte-lager/);
  assert.match(get.output!, /Sync Status:\s+Synced/);
  assert.match(get.output!, /Health Status:\s+Healthy/);
  // list zeigt Wurzel UND Kinder
  const list = sim.exec("argocd app list").output!;
  assert.match(list, /hafen-flotte/);
  assert.match(list, /flotte-funk\s+Synced\s+Healthy/);
});

test("App-of-Apps: ohne auto-sync ist die Wurzel erst OutOfSync, 'app sync' zieht dann die ganze Flotte", () => {
  legeAppOfApps(sim, { autoSync: false, selfHeal: false });
  sim.exec("kubectl apply -f flotte.yaml");
  // nur die Wurzel, noch keine Kinder, nichts ausgerollt
  assert.equal(sim.argoApps.length, 1, "nur die Wurzel angelegt");
  assert.equal(sim.deployments.length, 0, "ohne sync wird nichts materialisiert");
  assert.match(sim.exec("argocd app get hafen-flotte").output!, /Sync Status:\s+OutOfSync/);
  // Pull der Wurzel legt die ganze Flotte an
  const sync = sim.exec("argocd app sync hafen-flotte");
  assert.match(sync.output!, /Flotte/);
  assert.equal(sim.argoApps.length, 4, "Wurzel + drei Kinder nach dem Sync");
  assert.ok(sim.deployments.some(d => d.name === "flotte-funk"), "Kind-Dienst ist jetzt ausgerollt");
  assert.match(sim.exec("argocd app get hafen-flotte").output!, /Sync Status:\s+Synced/);
});

test("App-of-Apps: ausgefallener Kind-Dienst macht die Wurzel OutOfSync; vererbtes Self-Heal stellt ihn wieder her", () => {
  legeAppOfApps(sim, { autoSync: true, selfHeal: true });
  sim.exec("kubectl apply -f flotte.yaml");
  // ein Dienst der Flotte fällt aus -> Wurzel weicht vom Git-Soll ab
  sim.exec("kubectl delete deployment flotte-funk");
  assert.ok(!sim.deployments.some(d => d.name === "flotte-funk"), "Drift: Dienst weg");
  // der nächste Befehl tickt die Self-Heal-Schleife (Kind erbt Self-Heal von der Wurzel)
  sim.exec("kubectl get deployments");
  assert.ok(sim.deployments.some(d => d.name === "flotte-funk"), "Self-Heal hat den Dienst neu angelegt");
  assert.match(sim.exec("argocd app get hafen-flotte").output!, /Sync Status:\s+Synced/);
});

test("App-of-Apps: Snapshot/Reset bewahrt die Wurzel inkl. Kind-Apps", () => {
  legeAppOfApps(sim, { autoSync: true, selfHeal: true });
  sim.exec("kubectl apply -f flotte.yaml");
  const wieder = new KQSim(sim.snapshot());
  const root = wieder.argoApps.find(a => a.name === "hafen-flotte");
  assert.ok(root, "Wurzel überlebt das Speichern");
  assert.equal(root!.childApps!.length, 3, "Kind-Apps bleiben im Snapshot erhalten");
  assert.ok(wieder.argoApps.some(a => a.name === "flotte-lager"), "Kind-App überlebt das Speichern");
  assert.match(wieder.exec("argocd app get hafen-flotte").output!, /Synced/);
});

/* ===================== Soll-Service als ServiceSpec (#1409) ===================== */

function legeSollApp(s: KQSim, service: ServiceSpec, name = "bank", extra: object = {}) {
  s.files[name + "-app.yaml"] = "kind: Application …";
  s.applyEffects[name + "-app.yaml"] = {
    application: {
      name, repo: "https://git.hafen.de/apps.git", path: name + "/", autoSync: true, selfHeal: true,
      deployment: { name, image: "nginx", replicas: 2 }, service, ...extra,
    },
  };
  return s.exec("kubectl apply -f " + name + "-app.yaml");
}
const sollKaputt: ServiceSpec = { name: "bank", type: "ExternalName", port: "" };

test("argocd (#1409): ExternalName-Soll samt externalName landet im Cluster und wird per Self-Heal wiederhergestellt", () => {
  legeSollApp(sim, { name: "bank", type: "ExternalName", port: "", externalName: "api.bank.example.com" });
  sim.exec("kubectl get pods");
  const svc = sim.services.find(x => x.name === "bank")!;
  assert.equal(svc.type, "ExternalName");
  assert.equal(svc.clusterIP, "<none>");
  assert.equal(svc.externalName, "api.bank.example.com");
  assert.match(sim.exec("nslookup bank").output!, /canonical name = api\.bank\.example\.com\./);
  sim.exec("kubectl delete service bank");
  sim.exec("kubectl get pods");
  assert.equal(sim.services.find(x => x.name === "bank")?.externalName, "api.bank.example.com", "Self-Heal stellt den ExternalName-Service wieder her");
});

test("argocd (#1409): targetPort aus dem Soll bleibt erhalten", () => {
  legeSollApp(sim, { name: "bank", port: 80, targetPort: 8080 });
  sim.exec("kubectl get pods");
  assert.equal(sim.services.find(x => x.name === "bank")?.targetPort, 8080);
});

test("argocd (#1409): abgelehnter Soll-Service ist im Self-Heal kein Dauerfehler und lässt den Cluster unangetastet", () => {
  legeSollApp(sim, sollKaputt);
  sim.exec("argocd app sync bank"); // manuell: meldet bewusst (siehe unten)
  sim.deployments.length = 0;
  sim.services.length = 0;
  sim.argoApps[0].desired!.deployment.replicas = 5;
  sim.exec("kubectl create deployment web --image=nginx");
  sim.exec("kubectl scale deployment web --replicas=4");
  for (let i = 0; i < 2; i++) {
    const r = sim.exec("kubectl get pods");
    assert.equal(r.error, false, "Durchlauf " + i);
    assert.doesNotMatch(r.output!, /Hoppla|invalid/);
  }
  assert.equal(sim.deployments.find(d => d.name === "bank"), undefined, "atomar: kein Deployment ohne Service");
  assert.equal(sim.deployments.find(d => d.name === "web")!.replicas, 4, "fremde Workload unangetastet");
  assert.match(sim.exec("argocd app get bank").output!, /Sync Status:\s+OutOfSync/);
});

test("argocd (#1409): atomar – ein gedrifteter Replica-Wert bleibt bei abgelehntem Soll-Service stehen", () => {
  legeSollApp(sim, { name: "bank", port: 80 });
  sim.exec("kubectl get pods");
  sim.argoApps[0].desired!.service = sollKaputt;
  sim.services.length = 0;
  sim.exec("kubectl scale deployment bank --replicas=7");
  const r = sim.exec("kubectl get pods");
  assert.equal(r.error, false);
  assert.equal(sim.deployments.find(d => d.name === "bank")!.replicas, 7, "kein Teil-Abgleich");
});

test("argocd (#1409): eine gesunde Self-Heal-App heilt trotz einer kaputten Nachbarin", () => {
  legeSollApp(sim, sollKaputt, "bank");
  legeSollApp(sim, { name: "kasse", port: 80 }, "kasse");
  sim.exec("kubectl get pods");
  sim.exec("kubectl scale deployment kasse --replicas=9");
  const r = sim.exec("kubectl get pods");
  assert.equal(r.error, false);
  assert.equal(sim.deployments.find(d => d.name === "kasse")!.replicas, 2, "gesunde App heilt im selben Lauf");
});

test("argocd (#1409): App-of-Apps – ein kaputtes Kind stoppt die Flotte nicht", () => {
  sim.files["wurzel.yaml"] = "kind: Application …";
  sim.applyEffects["wurzel.yaml"] = {
    application: {
      name: "wurzel", repo: "r", path: "flotte/", autoSync: false,
      childApps: [
        { name: "bank", deployment: { name: "bank", image: "nginx", replicas: 1 }, service: sollKaputt },
        { name: "kasse", deployment: { name: "kasse", image: "nginx", replicas: 1 } },
      ],
    },
  };
  sim.exec("kubectl apply -f wurzel.yaml");
  const r = sim.exec("argocd app sync wurzel");
  assert.equal(r.error, false, "Wurzel-Sync wirft nicht ins Terminal");
  assert.ok(sim.deployments.some(d => d.name === "kasse"), "Kind 2 ist ausgerollt");
  assert.ok(sim.argoApps.some(a => a.name === "bank"), "Kind 1 existiert als App");
  assert.match(sim.exec("argocd app get bank").output!, /OutOfSync/);
});

test("argocd (#1409): manueller Sync meldet die abgelehnte Spezifikation samt Tipp (A4)", () => {
  legeSollApp(sim, sollKaputt);
  sim.exec("kubectl get pods");
  const r = sim.exec("argocd app sync bank");
  assert.equal(r.error, true);
  assert.match(r.output!, /spec\.externalName: Required value/);
  assert.match(r.output!, /💡 Setze spec\.externalName/);
});

test("argocd (#1409): kubectl apply einer Auto-Sync-App mit abgelehntem Soll meldet den Fehler, die App bleibt angelegt", () => {
  const r = legeSollApp(sim, sollKaputt);
  assert.equal(r.error, true);
  assert.match(r.output!, /spec\.externalName: Required value/);
  assert.ok(sim.argoApps.some(a => a.name === "bank"));
  assert.equal(sim.deployments.some(d => d.name === "bank"), false, "atomar: kein Deployment");
});

test("argocd (#1409): ein anderer Fehler als InvalidSpecError im Self-Heal wird nicht verschluckt", () => {
  legeSollApp(sim, { name: "bank", port: 80 });
  sim.exec("kubectl delete service bank");
  sim._makeService = () => { throw new TypeError("Sim-Bug"); };
  const r = sim.exec("kubectl get pods");
  assert.equal(r.error, true);
  assert.match(r.output!, /Hoppla.*Sim-Bug/);
});

test("Fehlernetz in exec (#1409): ein kaputter Argo-Zustand im Vorlauf wirft nicht, sondern meldet Hoppla", () => {
  const s = new KQSim({ argoApps: [{ name: "kaputt", repo: "r", path: "p/", autoSync: true, selfHeal: true, created: 0 }] });
  const r = s.exec("kubectl get pods");
  assert.equal(r.error, true);
  assert.match(r.output!, /Hoppla/);
  assert.doesNotThrow(() => s.exec(""));
});
