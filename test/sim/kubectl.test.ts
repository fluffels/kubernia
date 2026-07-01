/* Unit-Tests: kubectl-Befehlsfamilie (sim/kubectl.ts) – Teil des sim.test.ts-Splits (#383).
 * Deckt get/create/scale/expose/apply/describe/delete/set/rollout sowie die
 * kubectl-verwalteten Ressourcen (Secrets, ConfigMaps, Ingress, TLS, NetworkPolicy,
 * Readiness/Endpoints, Troubleshooting) ab. RBAC/Pod-Security (#126/#128) liegen
 * bewusst in rbac.test.ts. Fahren über sim.exec("…"); Fixtures in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

test("kubectl: create, scale, self-healing nach delete", () => {
  sim.exec("kubectl create deployment kasse --image=nginx");
  sim.exec("kubectl scale deployment kasse --replicas=3");
  const dep = sim.deployments.find(d => d.name === "kasse")!;
  assert.equal(dep.pods.length, 3);
  const victim = dep.pods[0].name;
  sim.exec("kubectl delete pod " + victim);
  assert.equal(dep.pods.length, 3, "Self-Healing: Pod wird sofort ersetzt");
  assert.ok(!dep.pods.some(p => p.name === victim), "der gelöschte Pod ist wirklich weg");
});

test("kubectl: expose erzeugt Service mit fester IP", () => {
  sim.exec("kubectl create deployment kasse --image=nginx");
  sim.exec("kubectl expose deployment kasse --port=80");
  assert.match(sim.exec("kubectl get services").output!, /kasse.*10\.96\./);
});

test("kubectl apply ist idempotent", () => {
  sim.files["app.yaml"] = "kind: Deployment …";
  sim.applyEffects["app.yaml"] = { deployment: { name: "lager", image: "redis", replicas: 2 } };
  assert.match(sim.exec("kubectl apply -f app.yaml").output!, /created/);
  assert.match(sim.exec("kubectl apply -f app.yaml").output!, /unchanged/);
  assert.equal(sim.deployments.filter(d => d.name === "lager").length, 1);
});

test("secrets: create, get (ohne Inhalt!), delete", () => {
  sim.exec("kubectl create secret generic db --from-literal=pw=geheim123");
  const out = sim.exec("kubectl get secrets").output!;
  assert.match(out, /db.*Opaque/);
  assert.doesNotMatch(out, /geheim123/, "Secret-Werte tauchen NIE in der Liste auf");
  sim.exec("kubectl delete secret db");
  assert.match(sim.exec("kubectl get secrets").output!, /No resources/);
});

test("configmaps: create, get, delete – und Duplikat/leer werden abgelehnt (Negativfälle)", () => {
  const created = sim.exec("kubectl create configmap app-config --from-literal=db_host=hafen-db");
  assert.ok(!created.error);
  assert.match(created.output!, /configmap\/app-config created/);
  assert.match(sim.exec("kubectl get configmaps").output!, /app-config.*1/);
  // Negativ: ohne --from-literal legt nichts an
  const leer = sim.exec("kubectl create configmap leer");
  assert.ok(leer.error, "ConfigMap ohne Daten wird abgelehnt");
  assert.equal(sim.configMaps.length, 1, "fehlgeschlagenes create legt nichts an");
  // Negativ: Duplikat
  const doppelt = sim.exec("kubectl create configmap app-config --from-literal=x=y");
  assert.ok(doppelt.error, "doppelte ConfigMap wird abgelehnt");
  assert.equal(sim.configMaps.filter(c => c.name === "app-config").length, 1);
  sim.exec("kubectl delete configmap app-config");
  assert.match(sim.exec("kubectl get configmaps").output!, /No resources/);
});

test("set env: bindet ConfigMap UND Secret in ein Deployment ein", () => {
  sim.mergeScenario({ deployments: [{ name: "passagierliste", image: "nginx", replicas: 1 }] });
  sim.exec("kubectl create configmap pc --from-literal=db_host=hafen-db");
  sim.exec("kubectl create secret generic pg --from-literal=db_passwort=tiefsee42");
  assert.ok(!sim.exec("kubectl set env deployment/passagierliste --from=configmap/pc").error);
  assert.ok(!sim.exec("kubectl set env deployment/passagierliste --from=secret/pg").error);
  const dep = sim.deployments.find(d => d.name === "passagierliste")!;
  assert.deepEqual(dep.envFrom.configMaps, ["pc"]);
  assert.deepEqual(dep.envFrom.secrets, ["pg"]);
  // idempotent: zweimal dieselbe Quelle bindet nicht doppelt
  sim.exec("kubectl set env deployment/passagierliste --from=configmap/pc");
  assert.deepEqual(dep.envFrom.configMaps, ["pc"], "doppelte Bindung bleibt einmalig");
});

test("set env: Negativfälle – fehlendes Deployment, fehlende Quelle, keine Bindung bei Fehler", () => {
  sim.mergeScenario({ deployments: [{ name: "passagierliste", image: "nginx", replicas: 1 }] });
  // unbekanntes Deployment
  const keinDep = sim.exec("kubectl set env deployment/gibtsnicht --from=configmap/pc");
  assert.ok(keinDep.error);
  assert.match(keinDep.output!, /not found/);
  // ConfigMap existiert noch nicht -> Fehler, nichts gebunden
  const keineCm = sim.exec("kubectl set env deployment/passagierliste --from=configmap/pc");
  assert.ok(keineCm.error, "nicht existierende ConfigMap wird abgelehnt");
  const dep = sim.deployments.find(d => d.name === "passagierliste")!;
  assert.deepEqual(dep.envFrom.configMaps, [], "fehlgeschlagene Bindung verändert nichts");
  // Secret existiert noch nicht -> Fehler
  assert.ok(sim.exec("kubectl set env deployment/passagierliste --from=secret/pg").error);
  assert.deepEqual(dep.envFrom.secrets, []);
});

test("envFrom übersteht snapshot/restore", () => {
  sim.mergeScenario({ deployments: [{ name: "passagierliste", image: "nginx", replicas: 1 }] });
  sim.exec("kubectl create configmap pc --from-literal=db_host=hafen-db");
  sim.exec("kubectl create secret generic pg --from-literal=db_passwort=x");
  sim.exec("kubectl set env deployment/passagierliste --from=configmap/pc");
  sim.exec("kubectl set env deployment/passagierliste --from=secret/pg");
  const restored = new KQSim(sim.snapshot());
  const dep = restored.deployments.find(d => d.name === "passagierliste")!;
  assert.deepEqual(dep.envFrom.configMaps, ["pc"]);
  assert.deepEqual(dep.envFrom.secrets, ["pg"]);
  assert.match(restored.exec("kubectl get configmaps").output!, /pc/);
});

test("troubleshooting: ImagePullBackOff via set image heilen", () => {
  sim.mergeScenario({ deployments: [{ name: "app", image: "ngnix", replicas: 1, broken: { type: "imagepull", badImage: "ngnix" } }] });
  assert.match(sim.exec("kubectl get pods").output!, /ImagePullBackOff/);
  const pod = sim.deployments[0].pods[0].name;
  assert.match(sim.exec("kubectl describe pod " + pod).output!, /Failed to pull image/);
  // dasselbe kaputte Image heilt NICHT
  sim.exec("kubectl set image deployment/app app=ngnix");
  assert.ok(sim.deployments[0].broken, "gleiches Image = weiter kaputt");
  sim.exec("kubectl set image deployment/app app=nginx");
  assert.equal(sim.deployments[0].broken, null);
  assert.match(sim.exec("kubectl get pods").output!, /Running/);
});

test("troubleshooting: CrashLoop heilt nur mit Secret + rollout restart", () => {
  sim.mergeScenario({ deployments: [{ name: "app", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } }] });
  const pod = sim.deployments[0].pods[0].name;
  assert.match(sim.exec("kubectl logs " + pod).output!, /Secret 'key' nicht gefunden/);
  sim.exec("kubectl rollout restart deployment app");
  assert.ok(sim.deployments[0].broken, "Restart ohne Secret bringt nichts");
  sim.exec("kubectl create secret generic key --from-literal=k=v");
  sim.exec("kubectl rollout restart deployment app");
  assert.equal(sim.deployments[0].broken, null);
});

test("troubleshooting: OOMKilled heilt erst, wenn das memory-Limit reicht (set resources)", () => {
  sim.mergeScenario({ deployments: [{ name: "kartograf", image: "nginx", replicas: 1, broken: { type: "oomkilled", memNeeded: 256 } }] });
  // get pods zeigt das Fehlerbild
  assert.match(sim.exec("kubectl get pods").output!, /OOMKilled/);
  const pod = sim.deployments[0].pods[0].name;
  // describe ist die EINZIGE Diagnosequelle: Last State / Reason / Limit
  const desc = sim.exec("kubectl describe pod " + pod).output!;
  assert.match(desc, /Reason:\s+OOMKilled/);
  assert.match(desc, /memory:\s+64Mi/, "zu knappes Limit steht im describe");
  // Logs verraten den OOM-Kill bewusst NICHT
  assert.doesNotMatch(sim.exec("kubectl logs " + pod).output!, /OOM/i);
  // Negativfall: ein zu knappes neues Limit heilt NICHT
  sim.exec("kubectl set resources deployment/kartograf --limits=memory=128Mi --requests=memory=64Mi");
  assert.ok(sim.deployments[0].broken, "128Mi < 256Mi benötigt -> weiter OOMKilled");
  assert.match(sim.exec("kubectl get pods").output!, /OOMKilled/);
  // Ausreichendes Limit heilt
  sim.exec("kubectl set resources deployment/kartograf --limits=memory=256Mi --requests=memory=128Mi");
  assert.equal(sim.deployments[0].broken, null, "256Mi >= 256Mi benötigt -> geheilt");
  assert.match(sim.exec("kubectl get pods").output!, /Running/);
});

test("set resources: Gi wird zu Mi umgerechnet, Unsinn wird abgelehnt (Negativfall)", () => {
  sim.exec("kubectl create deployment app --image=nginx");
  // 1Gi = 1024Mi -> als Limit gesetzt
  const ok = sim.exec("kubectl set resources deployment/app --limits=memory=1Gi");
  assert.ok(!ok.error);
  assert.equal(sim.deployments.find(d => d.name === "app")!.memLimit, 1024);
  // krummer Wert -> klarer Fehler, kein stilles Durchwinken
  const bad = sim.exec("kubectl set resources deployment/app --limits=memory=foo");
  assert.ok(bad.error, "ungültige Speicherangabe ist ein Fehler");
  // gar kein Limit/Request -> Fehler
  assert.ok(sim.exec("kubectl set resources deployment/app").error);
  // unbekanntes Deployment -> NotFound
  assert.match(sim.exec("kubectl set resources deployment/gibtsnicht --limits=memory=128Mi").output!, /NotFound/);
});

test("set resources: CPU-Limit unter Schwelle räumt cpuHeavy aus und löst HighPodCPU-Alert auf", () => {
  sim.mergeScenario({ deployments: [{ name: "containergrill", image: "nginx", replicas: 1, cpuHeavy: true }] });
  // Alert muss initial feuern
  const firingBefore = sim.alerts().some(a => a.name === "HighPodCPU" && a.state === "firing");
  assert.ok(firingBefore, "HighPodCPU-Alert soll feuern, bevor das Limit gesetzt ist");
  // CPU-Limit setzen -> cpuHeavy wird gelöscht
  const r = sim.exec("kubectl set resources deployment/containergrill --limits=cpu=200m");
  assert.ok(!r.error, "set resources --limits=cpu=200m soll kein Fehler sein");
  assert.ok(!sim.deployments[0].cpuHeavy, "cpuHeavy muss nach CPU-Limit-Setzung falsch sein");
  // Alert muss jetzt resolved sein
  const resolvedAfter = sim.alerts().some(a => a.name === "HighPodCPU" && a.state === "resolved");
  assert.ok(resolvedAfter, "HighPodCPU-Alert soll resolved sein, nachdem CPU unter die Schwelle fällt");
  // kein Limit/Request überhaupt -> Fehler (auch ohne cpu-Flag)
  assert.ok(sim.exec("kubectl set resources deployment/containergrill").error, "kein Limit -> Fehler");
});

/* ===================== Ingress (Hafentor) – Issue #15 ===================== */

// Kleiner Helfer: ein Ingress-Manifest in die Welt legen, so wie es eine Quest täte.
function legeIngressManifest(s: KQSim, datei = "ingress.yaml") {
  s.files[datei] = "kind: Ingress …";
  s.applyEffects[datei] = { ingress: { name: "hafentor", host: "hafen.de", path: "/kasse", service: "kasse", port: "80", className: "nginx" } };
}

test("ingress: get zeigt 'No resources', solange keins existiert", () => {
  // Negativfall: Tor noch nicht aufgestellt -> kein Eintrag, kein Crash.
  const r = sim.exec("kubectl get ingress");
  assert.ok(!r.error, "leere Ingress-Liste ist kein Fehler");
  assert.match(r.output!, /No resources found/);
});

test("ingress: apply -f erzeugt das Hafentor, get zeigt Host/Class/Adresse", () => {
  legeIngressManifest(sim);
  const created = sim.exec("kubectl apply -f ingress.yaml");
  assert.match(created.output!, /ingress\.networking\.k8s\.io\/hafentor created/);
  assert.equal(sim.ingresses.length, 1, "genau ein Ingress angelegt");

  const get = sim.exec("kubectl get ingress");
  assert.match(get.output!, /hafentor/);
  assert.match(get.output!, /hafen\.de/, "HOSTS-Spalte zeigt den Host");
  assert.match(get.output!, /nginx/, "CLASS-Spalte zeigt den Ingress-Controller");
  assert.match(get.output!, /203\.0\.113\.10/, "ADDRESS-Spalte zeigt die Controller-Adresse");
  // Kurzform 'ing' liefert dasselbe.
  assert.match(sim.exec("kubectl get ing").output!, /hafentor/);
});

test("ingress: apply ist idempotent (zweites apply -> unchanged, kein Duplikat)", () => {
  legeIngressManifest(sim);
  assert.match(sim.exec("kubectl apply -f ingress.yaml").output!, /created/);
  assert.match(sim.exec("kubectl apply -f ingress.yaml").output!, /unchanged/);
  assert.equal(sim.ingresses.filter(i => i.name === "hafentor").length, 1, "kein doppeltes Tor");
});

test("ingress: delete per Name und per -f entfernt das Tor; Unbekanntes meldet NotFound", () => {
  legeIngressManifest(sim);
  sim.exec("kubectl apply -f ingress.yaml");

  // Negativfall: löschen, was es nicht gibt.
  const miss = sim.exec("kubectl delete ingress gibtsnicht");
  assert.ok(miss.error, "unbekanntes Ingress -> Fehler");
  assert.match(miss.output!, /NotFound/);
  assert.equal(sim.ingresses.length, 1, "fehlgeschlagenes delete fasst Bestand nicht an");

  // per Name löschen
  assert.match(sim.exec("kubectl delete ingress hafentor").output!, /hafentor" deleted/);
  assert.equal(sim.ingresses.length, 0);

  // erneut anlegen und diesmal per -f löschen
  sim.exec("kubectl apply -f ingress.yaml");
  assert.equal(sim.ingresses.length, 1);
  assert.match(sim.exec("kubectl delete -f ingress.yaml").output!, /hafentor" deleted/);
  assert.equal(sim.ingresses.length, 0);
});

test("ingress: describe zeigt Backend – und warnt, wenn der Ziel-Service fehlt", () => {
  // Tor zeigt auf Service 'kasse', den es (noch) NICHT gibt -> Lern-Warnung.
  legeIngressManifest(sim);
  sim.exec("kubectl apply -f ingress.yaml");
  const ohneSvc = sim.exec("kubectl describe ingress hafentor");
  assert.match(ohneSvc.output!, /hafen\.de/);
  assert.match(ohneSvc.output!, /kasse:80/, "Backend Service:Port wird gezeigt");
  assert.match(ohneSvc.output!, /lotst ins Leere/, "fehlender Service wird angewarnt");

  // Service anlegen -> Warnung verschwindet.
  sim.exec("kubectl create deployment kasse --image=nginx");
  sim.exec("kubectl expose deployment kasse --port=80");
  const mitSvc = sim.exec("kubectl describe ingress hafentor");
  assert.doesNotMatch(mitSvc.output!, /lotst ins Leere/);

  // Negativfall: describe auf nicht existierendes Tor.
  const miss = sim.exec("kubectl describe ingress geist");
  assert.ok(miss.error);
  assert.match(miss.output!, /NotFound/);
});

test("ingress: Szenario-Seeding + snapshot/restore erhalten das Tor", () => {
  // Über das Szenario vorbelegt (wie eine Quest-Welt).
  const seeded = new KQSim({ ingresses: [{ name: "tor-1", className: "nginx", host: "alt.de", path: "/", service: "alt", port: "80" }] });
  assert.match(seeded.exec("kubectl get ingress").output!, /tor-1/);

  // mergeScenario fügt ein zweites hinzu, ohne das erste zu doppeln.
  seeded.mergeScenario({ ingresses: [{ name: "tor-1", className: "nginx", host: "alt.de", path: "/", service: "alt", port: "80" }, { name: "tor-2", className: "nginx", host: "neu.de", path: "/", service: "neu", port: "80" }] });
  assert.equal(seeded.ingresses.length, 2, "Duplikat wird nicht erneut angelegt");

  // snapshot/restore behält beide Tore.
  const restored = new KQSim(JSON.parse(JSON.stringify(seeded.snapshot())));
  assert.match(restored.exec("kubectl get ingress").output!, /tor-1/);
  assert.match(restored.exec("kubectl get ingress").output!, /tor-2/);
});

/* ===================== TLS-Terminierung am Hafentor – Issue #64 ===================== */

// Helfer: Ingress-Manifest MIT TLS in die Welt legen (verschlüsseltes Tor).
function legeTlsIngressManifest(s: KQSim, datei = "ingress-tls.yaml") {
  s.files[datei] = "kind: Ingress … spec.tls …";
  s.applyEffects[datei] = { ingress: { name: "hafentor", host: "hafen.de", path: "/lager", service: "lager", port: "6379", className: "nginx", tls: { secretName: "hafen-tls" } } };
}

test("secret tls: create legt ein TLS-Secret an, get zeigt Typ kubernetes.io/tls", () => {
  const created = sim.exec("kubectl create secret tls hafen-tls --cert=tls.crt --key=tls.key");
  assert.ok(!created.error);
  assert.match(created.output!, /secret\/hafen-tls created/);
  const get = sim.exec("kubectl get secrets").output!;
  assert.match(get, /hafen-tls/);
  assert.match(get, /kubernetes\.io\/tls/, "TYPE-Spalte zeigt den TLS-Typ, nicht Opaque");
  assert.match(get, /\b2\b/, "DATA zeigt 2 Schlüssel (tls.crt + tls.key)");
});

test("secret tls: fehlende --cert/--key und Duplikat werden abgelehnt (Negativfälle)", () => {
  const ohneFlags = sim.exec("kubectl create secret tls hafen-tls");
  assert.ok(ohneFlags.error, "ohne --cert/--key -> Fehler");
  assert.match(ohneFlags.output!, /--cert.*--key|--key/);
  assert.equal(sim.secrets.length, 0, "fehlgeschlagenes create legt nichts an");

  const nurCert = sim.exec("kubectl create secret tls hafen-tls --cert=tls.crt");
  assert.ok(nurCert.error, "nur --cert reicht nicht");

  sim.exec("kubectl create secret tls hafen-tls --cert=tls.crt --key=tls.key");
  const doppelt = sim.exec("kubectl create secret tls hafen-tls --cert=tls.crt --key=tls.key");
  assert.ok(doppelt.error, "gleicher Name zweimal -> Fehler");
  assert.match(doppelt.output!, /already exists/);
  assert.equal(sim.secrets.filter(s => s.name === "hafen-tls").length, 1, "kein doppeltes Secret");
});

test("ingress TLS: apply rüstet das bestehende Tor auf HTTPS nach (configured), get zeigt 443", () => {
  // Erst das normale Tor, dann TLS nachrüsten – wie in der Quest (secrets-encrypted).
  legeIngressManifest(sim, "ingress.yaml");
  // legeIngressManifest zeigt auf service 'kasse'; für secrets-encrypted-Optik egal, wir prüfen nur TLS.
  sim.exec("kubectl apply -f ingress.yaml");
  assert.match(sim.exec("kubectl get ingress").output!, /\b80\b/);
  assert.doesNotMatch(sim.exec("kubectl get ingress").output!, /443/, "vor TLS kein 443");

  legeTlsIngressManifest(sim);
  const configured = sim.exec("kubectl apply -f ingress-tls.yaml");
  assert.match(configured.output!, /hafentor configured/, "bestehendes Tor wird umkonfiguriert, nicht 'unchanged'");
  assert.equal(sim.ingresses.filter(i => i.name === "hafentor").length, 1, "kein doppeltes Tor");
  assert.ok(sim.ingresses[0].tls && sim.ingresses[0].tls.secretName === "hafen-tls");

  assert.match(sim.exec("kubectl get ingress").output!, /80, 443/, "PORTS zeigt jetzt 80, 443");

  // Erneutes apply ist wieder idempotent (TLS schon da -> unchanged).
  assert.match(sim.exec("kubectl apply -f ingress-tls.yaml").output!, /unchanged/);
});

test("ingress TLS: apply auf neues Tor legt es direkt mit TLS an", () => {
  legeTlsIngressManifest(sim);
  const created = sim.exec("kubectl apply -f ingress-tls.yaml");
  assert.match(created.output!, /hafentor created/);
  assert.ok(sim.ingresses[0].tls?.secretName === "hafen-tls");
});

test("ingress TLS: describe zeigt den TLS-Block und warnt bei fehlendem Zertifikats-Secret", () => {
  legeTlsIngressManifest(sim);
  sim.exec("kubectl apply -f ingress-tls.yaml");

  // Secret existiert noch nicht -> describe warnt.
  const ohneSecret = sim.exec("kubectl describe ingress hafentor");
  assert.match(ohneSecret.output!, /TLS:/);
  assert.match(ohneSecret.output!, /hafen-tls terminates hafen\.de/);
  assert.match(ohneSecret.output!, /HTTPS bleibt zu/, "fehlendes TLS-Secret wird angewarnt");

  // Secret anlegen -> Warnung verschwindet.
  sim.exec("kubectl create secret tls hafen-tls --cert=tls.crt --key=tls.key");
  assert.doesNotMatch(sim.exec("kubectl describe ingress hafentor").output!, /HTTPS bleibt zu/);
});

test("ingress ohne TLS: describe zeigt KEINEN TLS-Block (kein False Positive)", () => {
  legeIngressManifest(sim);
  sim.exec("kubectl apply -f ingress.yaml");
  assert.doesNotMatch(sim.exec("kubectl describe ingress hafentor").output!, /TLS:/);
});

test("ingress TLS: snapshot/restore erhält die TLS-Konfiguration", () => {
  legeTlsIngressManifest(sim);
  sim.exec("kubectl apply -f ingress-tls.yaml");
  const restored = new KQSim(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.ok(restored.ingresses[0].tls?.secretName === "hafen-tls", "TLS übersteht snapshot/restore");
  assert.match(restored.exec("kubectl get ingress").output!, /80, 443/);
});

/* ===================== NetworkPolicy (Hafenmauer) – Issue #20 ===================== */

// Kleiner Helfer: ein NetworkPolicy-Manifest in die Welt legen, so wie es eine Quest täte.
function legeNetpolManifest(s: KQSim, datei = "netpol.yaml") {
  s.files[datei] = "kind: NetworkPolicy …";
  s.applyEffects[datei] = { networkPolicy: { name: "hafenmauer", podSelector: "lager", allowFrom: "hafentor" } };
}

test("networkpolicy: get zeigt 'No resources', solange keine existiert", () => {
  // Negativfall: noch keine Mauer -> kein Eintrag, kein Crash.
  const r = sim.exec("kubectl get networkpolicies");
  assert.ok(!r.error, "leere Liste ist kein Fehler");
  assert.match(r.output!, /No resources found/);
});

test("networkpolicy: apply -f zieht die Hafenmauer hoch, get zeigt Name + Selektor", () => {
  legeNetpolManifest(sim);
  const created = sim.exec("kubectl apply -f netpol.yaml");
  assert.match(created.output!, /networkpolicy\.networking\.k8s\.io\/hafenmauer created/);
  assert.equal(sim.networkPolicies.length, 1, "genau eine NetworkPolicy angelegt");

  const get = sim.exec("kubectl get networkpolicies");
  assert.match(get.output!, /hafenmauer/);
  assert.match(get.output!, /app=lager/, "POD-SELECTOR-Spalte zeigt das geschützte Label");
  // Kurzformen liefern dasselbe.
  assert.match(sim.exec("kubectl get netpol").output!, /hafenmauer/);
  assert.match(sim.exec("kubectl get networkpolicy").output!, /hafenmauer/);
});

test("networkpolicy: apply ist idempotent (zweites apply -> unchanged, kein Duplikat)", () => {
  legeNetpolManifest(sim);
  assert.match(sim.exec("kubectl apply -f netpol.yaml").output!, /created/);
  assert.match(sim.exec("kubectl apply -f netpol.yaml").output!, /unchanged/);
  assert.equal(sim.networkPolicies.filter(n => n.name === "hafenmauer").length, 1, "keine doppelte Mauer");
});

test("networkpolicy: describe nennt Selektor + erlaubte Quelle; Unbekanntes meldet NotFound", () => {
  legeNetpolManifest(sim);
  sim.exec("kubectl apply -f netpol.yaml");
  const d = sim.exec("kubectl describe networkpolicy hafenmauer");
  assert.ok(!d.error);
  assert.match(d.output!, /PodSelector:\s+app=lager/);
  assert.match(d.output!, /Allowing ingress traffic/);
  assert.match(d.output!, /app=hafentor/, "die erlaubte Quelle steht in den from-Regeln");

  // Negativfall: describe auf nicht existierende Mauer.
  const miss = sim.exec("kubectl describe netpol geistermauer");
  assert.ok(miss.error);
  assert.match(miss.output!, /NotFound/);
});

test("networkpolicy: default-deny – eine Policy ganz ohne erlaubte Quelle macht dicht", () => {
  // allowFrom leer = niemand darf rein (default-deny), describe macht das transparent.
  sim.files["deny.yaml"] = "kind: NetworkPolicy …";
  sim.applyEffects["deny.yaml"] = { networkPolicy: { name: "abriegelung", podSelector: "kasse" } };
  sim.exec("kubectl apply -f deny.yaml");
  const d = sim.exec("kubectl describe networkpolicy abriegelung");
  assert.match(d.output!, /default-deny/);
});

test("networkpolicy: delete per Name und per -f entfernt die Mauer; Unbekanntes meldet NotFound", () => {
  legeNetpolManifest(sim);
  sim.exec("kubectl apply -f netpol.yaml");

  // per Name (inkl. Kurzform).
  assert.match(sim.exec("kubectl delete netpol hafenmauer").output!, /hafenmauer" deleted/);
  assert.equal(sim.networkPolicies.length, 0);

  // per -f.
  sim.exec("kubectl apply -f netpol.yaml");
  assert.match(sim.exec("kubectl delete -f netpol.yaml").output!, /hafenmauer" deleted/);
  assert.equal(sim.networkPolicies.length, 0);

  // Negativfall: Unbekanntes löschen.
  const miss = sim.exec("kubectl delete networkpolicy geistermauer");
  assert.ok(miss.error);
  assert.match(miss.output!, /NotFound/);
});

test("networkpolicy: Szenario-Seeding + snapshot/restore erhalten die Mauer", () => {
  const seeded = new KQSim({ networkPolicies: [{ name: "wall-1", podSelector: "db", allowFrom: "api" }] });
  assert.match(seeded.exec("kubectl get netpol").output!, /wall-1/);

  // mergeScenario fügt eine zweite hinzu, ohne die erste zu doppeln.
  seeded.mergeScenario({ networkPolicies: [{ name: "wall-1", podSelector: "db", allowFrom: "api" }, { name: "wall-2", podSelector: "web", allowFrom: "lb" }] });
  assert.equal(seeded.networkPolicies.length, 2, "Duplikat wird nicht erneut angelegt");

  // snapshot/restore behält beide Mauern.
  const restored = new KQSim(JSON.parse(JSON.stringify(seeded.snapshot())));
  assert.match(restored.exec("kubectl get netpol").output!, /wall-1/);
  assert.match(restored.exec("kubectl get netpol").output!, /wall-2/);
});

/* ===================== Health-Checks: Readiness/Liveness – Issue #67 ===================== */

// Kleiner Helfer: ein Deployment, das läuft, aber wegen fehlender Readiness
// (es fehlt ihm sein Secret) nicht bereit ist – plus Service davor.
function legeNotreadyDeployment(s: KQSim, name = "kombuese", secret = "kombuese-menue") {
  s.mergeScenario({ deployments: [{ name, image: "nginx", replicas: 1, broken: { type: "notready", needsSecret: secret } }] });
  s.exec("kubectl expose deployment " + name + " --port=80");
}

test("readiness: notready-Pod läuft (Running), ist aber READY 0/1 ohne Restarts", () => {
  legeNotreadyDeployment(sim);
  const pods = sim.exec("kubectl get pods");
  assert.ok(!pods.error);
  // Genau das Lehrbild: STATUS Running, aber READY 0/1 – kein Crash, keine Restarts.
  assert.match(pods.output!, /kombuese-\S+\s+0\/1\s+Running\s+0\b/);
  assert.doesNotMatch(pods.output!, /CrashLoopBackOff/);
});

test("readiness: get endpoints zeigt <none>, solange der Pod nicht bereit ist", () => {
  legeNotreadyDeployment(sim);
  const ep = sim.exec("kubectl get endpoints kombuese");
  assert.ok(!ep.error, "leere Endpoints sind kein Fehler");
  assert.match(ep.output!, /kombuese\s+<none>/, "nicht-bereiter Pod fehlt im Service");
  // Kurzform 'ep' liefert dasselbe.
  assert.match(sim.exec("kubectl get ep kombuese").output!, /<none>/);
});

test("readiness: describe pod nennt die fehlgeschlagene Readiness-Probe + Ready: 0/1", () => {
  legeNotreadyDeployment(sim);
  const podName = sim.deployments.find(d => d.name === "kombuese")!.pods[0].name;
  const d = sim.exec("kubectl describe pod " + podName);
  assert.ok(!d.error);
  assert.match(d.output!, /Readiness probe failed/);
  assert.match(d.output!, /Ready:\s+0\/1/);
  // Es LÄUFT trotzdem – Status bleibt Running (liveness ok).
  assert.match(d.output!, /Status:\s+Running/);
});

test("readiness: Secret anlegen macht den Pod von SELBST bereit – ohne rollout restart", () => {
  legeNotreadyDeployment(sim);
  // Ursache beheben: das Secret, an dem die Readiness-Probe hängt.
  assert.match(sim.exec("kubectl create secret generic kombuese-menue --from-literal=menue=fisch").output!, /created/);
  // KEIN Neustart! Allein das nächste Abfragen lässt die Probe durchgehen.
  const ep = sim.exec("kubectl get endpoints kombuese");
  assert.match(ep.output!, /kombuese\s+10\.244\.1\.20:80/, "bereiter Pod taucht als Endpoint auf");
  assert.match(sim.exec("kubectl get pods").output!, /kombuese-\S+\s+1\/1\s+Running/);
  assert.equal(sim.deployments.find(d => d.name === "kombuese")!.broken, null, "notready ist geheilt");
});

test("readiness: das FALSCHE Secret heilt NICHT (kein False Positive)", () => {
  legeNotreadyDeployment(sim);
  sim.exec("kubectl create secret generic irgendwas-anderes --from-literal=k=v");
  // Solange das benötigte Secret fehlt, bleibt der Pod draußen.
  assert.match(sim.exec("kubectl get endpoints kombuese").output!, /<none>/);
  assert.match(sim.exec("kubectl get pods").output!, /kombuese-\S+\s+0\/1\s+Running/);
  assert.ok(sim.deployments.find(d => d.name === "kombuese")!.broken, "notready besteht weiter");
});

test("readiness: ein GESUNDES Deployment liefert echte Endpoints (Gegenprobe)", () => {
  sim.exec("kubectl create deployment kantine --image=nginx");
  sim.exec("kubectl expose deployment kantine --port=80");
  const ep = sim.exec("kubectl get endpoints kantine");
  assert.match(ep.output!, /kantine\s+10\.244\.1\.20:80/, "gesunder Pod ist sofort Endpoint");
  assert.doesNotMatch(ep.output!, /<none>/);
});

test("endpoints: unbekannter Service meldet NotFound", () => {
  const miss = sim.exec("kubectl get endpoints gibtsnicht");
  assert.ok(miss.error);
  assert.match(miss.output!, /NotFound/);
});

test("deployments-Liste spiegelt Readiness: notready zeigt 0/1, geheilt 1/1", () => {
  legeNotreadyDeployment(sim);
  assert.match(sim.exec("kubectl get deployments").output!, /kombuese\s+0\/1/);
  sim.exec("kubectl create secret generic kombuese-menue --from-literal=menue=fisch");
  assert.match(sim.exec("kubectl get deployments").output!, /kombuese\s+1\/1/);
});

// ── #489: Ressourcen-Namen an der create-Befehlsgrenze validieren (DNS-1123, Forts. #479) ──
// Der Spieler tippt bei `kubectl create <kind> <name>` den Namen selbst – das ist die echte
// Nutzereingabe-Grenze. Ungültige Namen (Großbuchstaben, '_', führender '-' …) werden wie im
// echten kubectl abgelehnt, statt stillschweigend eine Ressource mit illegalem Namen anzulegen.

test("#489 create deployment: Großbuchstaben-Name wird abgelehnt (wie echtes kubectl), legt nichts an", () => {
  const r = sim.exec("kubectl create deployment WebApp --image=nginx");
  assert.ok(r.error, "ungültiger Name muss einen Fehler geben");
  assert.match(r.output!, /Invalid value: "WebApp"/, "kubectl-typische Fehlermeldung mit dem echten Namen");
  assert.match(r.output!, /RFC 1123|DNS-1123|Kleinbuchstaben/, "erklärt die Namensregel");
  assert.equal(sim.deployments.filter(d => d.name === "WebApp").length, 0, "kein Deployment angelegt");
  assert.equal(sim.deployments.length, 0, "gar nichts angelegt");
});

test("#489 create deployment: Unterstrich und führender Bindestrich sind ungültig", () => {
  assert.ok(sim.exec("kubectl create deployment web_app --image=nginx").error, "'_' ist verboten");
  assert.ok(sim.exec("kubectl create deployment -kasse --image=nginx").error, "führender '-' ist verboten");
  assert.equal(sim.deployments.length, 0, "kein Deployment aus ungültigen Namen");
});

test("#489 create deployment: gültiger DNS-1123-Name funktioniert weiter (Gegenprobe)", () => {
  const r = sim.exec("kubectl create deployment web-app --image=nginx");
  assert.ok(!r.error, "gültiger Name darf nicht abgelehnt werden");
  assert.match(r.output!, /deployment\.apps\/web-app created/);
  assert.equal(sim.deployments.filter(d => d.name === "web-app").length, 1);
});

test("#489 create: auch secret/configmap/serviceaccount lehnen ungültige Namen ab", () => {
  const sec = sim.exec("kubectl create secret generic DB_Zugang --from-literal=pw=geheim123");
  assert.ok(sec.error, "Secret-Name mit Großbuchstaben/'_' abgelehnt");
  assert.match(sec.output!, /Invalid value/);
  assert.equal(sim.secrets.length, 0);

  const cm = sim.exec("kubectl create configmap App.Config --from-literal=k=v");
  // 'App.Config' hat Großbuchstaben → ungültig
  assert.ok(cm.error, "ConfigMap-Name mit Großbuchstaben abgelehnt");
  assert.equal(sim.configMaps.length, 0);

  const sa = sim.exec("kubectl create serviceaccount Wachdienst");
  assert.ok(sa.error, "ServiceAccount-Name mit Großbuchstaben abgelehnt");
  assert.equal(sim.serviceAccounts.filter(s => s.name === "Wachdienst").length, 0, "kein SA mit ungültigem Namen");
});
