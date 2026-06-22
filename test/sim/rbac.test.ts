/* Unit-Tests: RBAC / ServiceAccounts / Pod-Security (#126) + Security-Manifeste via
 * kubectl apply (#128) – Teil des sim.test.ts-Splits (#383). Eigener Schnitt aus der
 * kubectl-Familie, weil das Wachturm-Quartier (RBAC/PSA) ein abgegrenztes Lernthema
 * mit eigenen Manifest-Fixtures ist. Fahren über sim.exec("…"); Fixtures in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";
import { KQContent } from "../../src/content";
import {
  SERVICEACCOUNT_YAML, ROLE_YAML, ROLEBINDING_YAML,
  CLUSTERROLE_YAML, CLUSTERROLEBINDING_YAML, POD_SECURITY_YAML,
} from "../../src/content/manifests";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

/* ===================== Wachturm-Quartier: RBAC / ServiceAccounts / Pod-Security (#126) ===================== */

test("#126 ServiceAccount: anlegen, Default-SA da, auflisten, Duplikat-Fehler", () => {
  // Jeder Namespace hat von Haus aus die "default"-SA – wie im echten Cluster.
  assert.match(sim.exec("kubectl get serviceaccounts").output!, /default/, "die default-SA existiert von Anfang an");
  const r = sim.exec("kubectl create serviceaccount deploy-bot");
  assert.ok(!r.error, "SA anlegen geht durch");
  assert.match(r.output!, /serviceaccount\/deploy-bot created/);
  // Alias 'sa' beim get
  assert.match(sim.exec("kubectl get sa").output!, /deploy-bot/, "die neue SA taucht in der Liste auf");
  // Doppelt anlegen ist ein Fehler, keine zweite SA
  const dup = sim.exec("kubectl create serviceaccount deploy-bot");
  assert.ok(dup.error, "zweimal dieselbe SA muss scheitern");
  assert.match(dup.output!, /already exists/);
});

/* ===================== #132 ServiceAccounts: Identität für Pods (Deployment ↔ SA) ===================== */

test("#132 apply: Deployment-Manifest mit serviceAccountName verknüpft die SA", () => {
  sim.exec("kubectl create serviceaccount wachdienst");
  sim.files["wp.yaml"] = "kind: Deployment";
  sim.applyEffects["wp.yaml"] = { deployment: { name: "wachposten", image: "nginx", replicas: 1, serviceAccountName: "wachdienst" } };
  const r = sim.exec("kubectl apply -f wp.yaml");
  assert.ok(!r.error, "apply geht durch");
  assert.match(r.output!, /deployment\.apps\/wachposten created/);
  const dep = sim.deployments.find(d => d.name === "wachposten")!;
  assert.equal(dep.serviceAccountName, "wachdienst", "die SA-Zuordnung steht am Deployment");
  // describe pod beweist die Zuordnung: die Service-Account-Zeile nennt die gesetzte SA.
  const pod = dep.pods[0].name;
  assert.match(sim.exec("kubectl describe pod " + pod).output!, /Service Account:\s*wachdienst/, "describe pod zeigt die zugeordnete SA");
});

test("#132 describe pod: ohne serviceAccountName läuft der Pod unter der default-SA", () => {
  sim.exec("kubectl create deployment ohne-sa --image=nginx");
  const pod = sim.deployments.find(d => d.name === "ohne-sa")!.pods[0].name;
  assert.match(sim.exec("kubectl describe pod " + pod).output!, /Service Account:\s*default/, "Default-SA, wenn keine gesetzt ist");
});

test("#132 apply idempotent: gleiche SA → unchanged, geänderte SA → configured", () => {
  sim.files["wp.yaml"] = "kind: Deployment";
  sim.applyEffects["wp.yaml"] = { deployment: { name: "wp", image: "nginx", replicas: 1, serviceAccountName: "alt" } };
  assert.match(sim.exec("kubectl apply -f wp.yaml").output!, /created/);
  assert.match(sim.exec("kubectl apply -f wp.yaml").output!, /unchanged/, "gleiche SA → unchanged");
  sim.applyEffects["wp.yaml"] = { deployment: { name: "wp", image: "nginx", replicas: 1, serviceAccountName: "neu" } };
  assert.match(sim.exec("kubectl apply -f wp.yaml").output!, /configured/, "geänderte SA → configured");
  assert.equal(sim.deployments.find(d => d.name === "wp")!.serviceAccountName, "neu");
});

test("#126 RBAC: Role + RoleBinding an SA → can-i liefert deterministisch yes/no", () => {
  sim.exec("kubectl create serviceaccount deploy-bot");
  sim.exec("kubectl create role pod-reader --verb=get,list,watch --resource=pods");
  sim.exec("kubectl create rolebinding read-pods --role=pod-reader --serviceaccount=default:deploy-bot");

  const sub = "--as=system:serviceaccount:default:deploy-bot";
  assert.equal(sim.exec("kubectl auth can-i get pods " + sub).output, "yes", "gebundenes verb/resource → yes");
  assert.equal(sim.exec("kubectl auth can-i list pods " + sub).output, "yes");
  // NICHT gebundenes verb → no (Negativfall)
  assert.equal(sim.exec("kubectl auth can-i delete pods " + sub).output, "no", "ungebundenes verb → no");
  // NICHT gebundene resource → no
  assert.equal(sim.exec("kubectl auth can-i get secrets " + sub).output, "no", "ungebundene resource → no");
  // Ohne Binding (fremde SA) → no
  sim.exec("kubectl create serviceaccount andere");
  assert.equal(sim.exec("kubectl auth can-i get pods --as=system:serviceaccount:default:andere").output, "no", "SA ohne Binding darf nichts");
});

test("#126 RBAC: ohne --as fragt man als Admin → immer yes", () => {
  assert.equal(sim.exec("kubectl auth can-i delete deployments").output, "yes", "Admin (kein --as) darf alles");
  assert.equal(sim.exec("kubectl auth can-i create pods").output, "yes");
});

test("#126 RBAC: ClusterRole + ClusterRoleBinding an User; Wildcards", () => {
  sim.exec("kubectl create clusterrole node-reader --verb=get,list --resource=nodes");
  sim.exec("kubectl create clusterrolebinding read-nodes --clusterrole=node-reader --user=alice");
  assert.equal(sim.exec("kubectl auth can-i get nodes --as=alice").output, "yes", "User mit ClusterRoleBinding darf");
  assert.equal(sim.exec("kubectl auth can-i delete nodes --as=alice").output, "no", "nur gebundene verbs");
  assert.equal(sim.exec("kubectl auth can-i get nodes --as=bob").output, "no", "fremder User darf nicht");

  // Wildcard-ClusterRole: alles erlaubt
  sim.exec("kubectl create clusterrole superuser --verb=* --resource=*");
  sim.exec("kubectl create clusterrolebinding su --clusterrole=superuser --user=root");
  assert.equal(sim.exec("kubectl auth can-i delete secrets --as=root").output, "yes", "Wildcard verb+resource → alles yes");
});

test("#126 RBAC: fehlende Pflicht-Flags geben klare Fehler", () => {
  assert.ok(sim.exec("kubectl create role x --resource=pods").error, "Role ohne --verb scheitert");
  assert.ok(sim.exec("kubectl create role x --verb=get").error, "Role ohne --resource scheitert");
  assert.ok(sim.exec("kubectl create rolebinding rb --serviceaccount=default:deploy-bot").error, "Binding ohne Rolle scheitert");
});

test("#126 RBAC: describe role zeigt die Regeln (Lern-Einblick)", () => {
  sim.exec("kubectl create role pod-reader --verb=get,list --resource=pods");
  const d = sim.exec("kubectl describe role pod-reader").output!;
  assert.match(d, /pods/);
  assert.match(d, /get/);
  assert.match(d, /list/);
});

test("#126 Pod-Security: restricted lehnt unsicheren Pod beim Anlegen ab, sicherer kommt durch", () => {
  sim.files["unsafe.yaml"] = "apiVersion: apps/v1\nkind: Deployment";
  sim.files["safe.yaml"] = "apiVersion: apps/v1\nkind: Deployment";
  sim.applyEffects["unsafe.yaml"] = { deployment: { name: "wild", image: "nginx", replicas: 1 } };
  sim.applyEffects["safe.yaml"] = { deployment: { name: "brav", image: "nginx", replicas: 1, securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false } } };

  // Default (privileged): keine Einschränkung – unsafe geht durch
  const beforeLabel = sim.exec("kubectl apply -f unsafe.yaml");
  assert.ok(!beforeLabel.error, "ohne enforce-Label gilt privileged: alles erlaubt");
  assert.ok(sim.deployments.some(d => d.name === "wild"), "Deployment ist da");

  // Stufe auf restricted setzen
  const lbl = sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
  assert.ok(!lbl.error, "Label setzen geht durch");
  assert.match(lbl.output!, /labeled/);

  // Unsicheres Deployment (kein securityContext) wird jetzt abgelehnt
  sim.applyEffects["unsafe.yaml"] = { deployment: { name: "wild2", image: "nginx", replicas: 1 } };
  const rej = sim.exec("kubectl apply -f unsafe.yaml");
  assert.ok(rej.error, "restricted lehnt unsicheren Pod ab");
  assert.match(rej.output!, /restricted|runAsNonRoot|Pod Security/i, "klare Begründung in der Fehlermeldung");
  assert.ok(!sim.deployments.some(d => d.name === "wild2"), "abgelehntes Deployment darf NICHT entstehen");

  // Sicheres Deployment kommt durch
  const ok = sim.exec("kubectl apply -f safe.yaml");
  assert.ok(!ok.error, "sicherer Pod (runAsNonRoot, keine Eskalation) wird zugelassen");
  assert.ok(sim.deployments.some(d => d.name === "brav"), "sicheres Deployment entsteht");
});

test("#126 Pod-Security: baseline blockt nur privileged, sonst frei", () => {
  sim.files["priv.yaml"] = "kind: Deployment";
  sim.files["plain.yaml"] = "kind: Deployment";
  sim.applyEffects["priv.yaml"] = { deployment: { name: "root-pod", image: "nginx", replicas: 1, securityContext: { privileged: true } } };
  sim.applyEffects["plain.yaml"] = { deployment: { name: "normal-pod", image: "nginx", replicas: 1 } };
  sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=baseline");

  const rej = sim.exec("kubectl apply -f priv.yaml");
  assert.ok(rej.error, "baseline verbietet privileged");
  assert.match(rej.output!, /privileged/i);
  // ein normaler Pod ohne runAsNonRoot ist unter baseline (anders als restricted) erlaubt
  assert.ok(!sim.exec("kubectl apply -f plain.yaml").error, "baseline lässt normalen Pod durch");
});

test("#126 Pod-Security: ungültige Stufe wird abgelehnt", () => {
  const r = sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=quatsch");
  assert.ok(r.error, "unbekannte Stufe ist ein Fehler");
});

test("#126 Serialisierung: SA/Rollen/Bindings/PSA überleben snapshot→reset", () => {
  sim.exec("kubectl create serviceaccount deploy-bot");
  sim.exec("kubectl create role pod-reader --verb=get --resource=pods");
  sim.exec("kubectl create rolebinding read-pods --role=pod-reader --serviceaccount=default:deploy-bot");
  sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");

  const snap = sim.snapshot();
  const wieder = new KQSim(snap);
  assert.match(wieder.exec("kubectl get sa").output!, /deploy-bot/, "SA überlebt das Speichern");
  assert.equal(wieder.exec("kubectl auth can-i get pods --as=system:serviceaccount:default:deploy-bot").output, "yes", "RBAC-Recht überlebt das Speichern");
  // restricted-Stufe überlebt: ein unsicherer Pod wird nach dem Reload weiter abgelehnt
  wieder.files["u.yaml"] = "kind: Deployment";
  wieder.applyEffects["u.yaml"] = { deployment: { name: "x", image: "nginx", replicas: 1 } };
  assert.ok(wieder.exec("kubectl apply -f u.yaml").error, "PSA-Stufe überlebt das Speichern");
});

/* ===================== Wachturm-Quartier: RBAC/Security-Manifeste via kubectl apply (#128) ===================== */

test("#128 Manifeste: alle Vorlagen sind nicht-leere YAML-Strings mit korrektem kind", () => {
  const cases: Array<[string, string]> = [
    [SERVICEACCOUNT_YAML, "kind: ServiceAccount"],
    [ROLE_YAML, "kind: Role"],
    [ROLEBINDING_YAML, "kind: RoleBinding"],
    [CLUSTERROLE_YAML, "kind: ClusterRole"],
    [CLUSTERROLEBINDING_YAML, "kind: ClusterRoleBinding"],
    [POD_SECURITY_YAML, "securityContext"],
  ];
  for (const [yaml, needle] of cases) {
    assert.ok(typeof yaml === "string" && yaml.length > 0, "Manifest leer: " + needle);
    assert.ok(yaml.includes(needle), "Manifest enthält '" + needle + "' nicht");
    assert.ok(yaml.includes("apiVersion"), "Manifest ohne apiVersion: " + needle);
  }
  // RoleBinding-kind matcht nicht versehentlich auf ClusterRoleBinding und umgekehrt.
  assert.ok(!/kind: ClusterRole\b/.test(ROLE_YAML), "ROLE_YAML darf keine ClusterRole sein");
  assert.ok(/kind: ClusterRole\b/.test(CLUSTERROLE_YAML), "CLUSTERROLE_YAML muss kind: ClusterRole sein");
});

test("#128 apply: ServiceAccount-Manifest legt die SA an (idempotent)", () => {
  sim.files["sa.yaml"] = SERVICEACCOUNT_YAML;
  sim.applyEffects["sa.yaml"] = { serviceAccount: { name: "deploy-bot" } };
  const r = sim.exec("kubectl apply -f sa.yaml");
  assert.ok(!r.error);
  assert.match(r.output!, /serviceaccount\/deploy-bot created/);
  assert.match(sim.exec("kubectl get sa").output!, /deploy-bot/);
  // zweites apply = unchanged, keine zweite SA
  assert.match(sim.exec("kubectl apply -f sa.yaml").output!, /unchanged/);
  assert.equal(sim.serviceAccounts.filter(s => s.name === "deploy-bot").length, 1);
});

test("#128 apply: Role + RoleBinding via Manifest → can-i wird yes (Negativfall bleibt no)", () => {
  sim.files["sa.yaml"] = SERVICEACCOUNT_YAML;
  sim.files["role.yaml"] = ROLE_YAML;
  sim.files["rb.yaml"] = ROLEBINDING_YAML;
  sim.applyEffects["sa.yaml"] = { serviceAccount: { name: "deploy-bot" } };
  sim.applyEffects["role.yaml"] = { role: { name: "pod-leser", rules: [{ verbs: ["get", "list", "watch"], resources: ["pods"] }] } };
  sim.applyEffects["rb.yaml"] = { roleBinding: { name: "pod-leser-binden", roleRef: { kind: "Role", name: "pod-leser" }, subjects: [{ kind: "ServiceAccount", name: "deploy-bot", namespace: "default" }] } };

  const sub = "--as=system:serviceaccount:default:deploy-bot";
  assert.equal(sim.exec("kubectl auth can-i get pods " + sub).output, "no", "vor dem Binden: kein Recht");
  sim.exec("kubectl apply -f sa.yaml");
  assert.match(sim.exec("kubectl apply -f role.yaml").output!, /role\.rbac\.authorization\.k8s\.io\/pod-leser created/);
  assert.match(sim.exec("kubectl apply -f rb.yaml").output!, /rolebinding\.rbac\.authorization\.k8s\.io\/pod-leser-binden created/);
  assert.equal(sim.exec("kubectl auth can-i get pods " + sub).output, "yes", "nach dem Binden: darf pods lesen");
  assert.equal(sim.exec("kubectl auth can-i delete pods " + sub).output, "no", "aber nur die gebundenen verbs");
});

test("#128 apply: ClusterRole + ClusterRoleBinding via Manifest → can-i für User", () => {
  sim.files["cr.yaml"] = CLUSTERROLE_YAML;
  sim.files["crb.yaml"] = CLUSTERROLEBINDING_YAML;
  sim.applyEffects["cr.yaml"] = { role: { name: "knoten-leser", cluster: true, rules: [{ verbs: ["get", "list"], resources: ["nodes"] }] } };
  sim.applyEffects["crb.yaml"] = { roleBinding: { name: "knoten-leser-binden", cluster: true, roleRef: { kind: "ClusterRole", name: "knoten-leser" }, subjects: [{ kind: "User", name: "wache" }] } };
  assert.match(sim.exec("kubectl apply -f cr.yaml").output!, /clusterrole\.rbac\.authorization\.k8s\.io\/knoten-leser created/);
  assert.match(sim.exec("kubectl apply -f crb.yaml").output!, /clusterrolebinding\.rbac\.authorization\.k8s\.io\/knoten-leser-binden created/);
  assert.equal(sim.exec("kubectl auth can-i get nodes --as=wache").output, "yes");
  assert.equal(sim.exec("kubectl auth can-i delete nodes --as=wache").output, "no");
});

test("#134 Quest k8s-rbac-clusterrole: namespaced Role reicht nicht für Nodes, ClusterRole + ClusterRoleBinding schon", () => {
  // Spiegelt die Quest-Kette: wachdienst hat aus der Vorquest eine namespaced Role (pods).
  sim.exec("kubectl create serviceaccount wachdienst");
  sim.exec("kubectl create role pod-leser --verb=get,list,watch --resource=pods");
  sim.exec("kubectl create rolebinding wachdienst-darf-lesen --role=pod-leser --serviceaccount=default:wachdienst");
  const sub = "--as=system:serviceaccount:default:wachdienst";

  // Gegenprobe: die namespaced Role kommt an die cluster-weiten Nodes NICHT heran.
  assert.equal(sim.exec("kubectl auth can-i list nodes " + sub).output, "no", "namespaced Role deckt keine Nodes ab");
  assert.equal(sim.exec("kubectl auth can-i get pods " + sub).output, "yes", "Pods darf wachdienst weiterhin lesen");

  // Genau die applyEffects der Quest-Szenario-Dateien.
  sim.files["clusterrole.yaml"] = "kind: ClusterRole";
  sim.files["clusterrolebinding.yaml"] = "kind: ClusterRoleBinding";
  sim.applyEffects["clusterrole.yaml"] = { role: { name: "knoten-spaeher", cluster: true, rules: [{ verbs: ["get", "list", "watch"], resources: ["nodes"] }] } };
  sim.applyEffects["clusterrolebinding.yaml"] = { roleBinding: { name: "wachdienst-rundblick", cluster: true, roleRef: { kind: "ClusterRole", name: "knoten-spaeher" }, subjects: [{ kind: "ServiceAccount", name: "wachdienst", namespace: "default" }] } };

  assert.match(sim.exec("kubectl apply -f clusterrole.yaml").output!, /clusterrole\.rbac\.authorization\.k8s\.io\/knoten-spaeher created/);
  // Die ClusterRole allein gewährt noch nichts – erst das Binding macht sie scharf.
  assert.equal(sim.exec("kubectl auth can-i list nodes " + sub).output, "no", "ClusterRole ohne Binding bleibt wirkungslos");
  assert.match(sim.exec("kubectl apply -f clusterrolebinding.yaml").output!, /clusterrolebinding\.rbac\.authorization\.k8s\.io\/wachdienst-rundblick created/);

  // Jetzt der Rundblick – aber nur lesen (Least Privilege).
  assert.equal(sim.exec("kubectl auth can-i list nodes " + sub).output, "yes", "nach dem ClusterRoleBinding: Nodes lesen erlaubt");
  assert.equal(sim.exec("kubectl auth can-i delete nodes " + sub).output, "no", "löschen bleibt verboten (nur gebundene verbs)");
  // describe clusterrole zeigt die Regeln im Klartext.
  const d = sim.exec("kubectl describe clusterrole knoten-spaeher").output!;
  assert.match(d, /nodes/);
  assert.match(d, /get list watch/);
});

test("#128 apply: securityContext-Manifest besteht restricted, plain wird abgelehnt", () => {
  sim.files["secure.yaml"] = POD_SECURITY_YAML;
  sim.applyEffects["secure.yaml"] = { deployment: { name: "wachposten", image: "nginx", replicas: 1, securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true } } };
  sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
  const ok = sim.exec("kubectl apply -f secure.yaml");
  assert.ok(!ok.error, "der sichere Workload kommt unter restricted durch");
  assert.ok(sim.deployments.some(d => d.name === "wachposten"));
  // Gegenprobe: ein plain Deployment ohne securityContext wird abgelehnt
  sim.files["plain.yaml"] = "kind: Deployment";
  sim.applyEffects["plain.yaml"] = { deployment: { name: "barfuss", image: "nginx", replicas: 1 } };
  assert.ok(sim.exec("kubectl apply -f plain.yaml").error, "unsicherer Workload bleibt abgelehnt");
});

test("#135 Quest k8s-pod-security: roh läuft unter privileged, restricted weist ihn ab, gehärtet kommt durch", () => {
  // Genau die applyEffects der Quest-Szenario-Dateien (roh = kein securityContext, gehärtet = mit).
  const roh = { deployment: { name: "spaehposten", image: "wachturm-spaeher:1.0", replicas: 1 } };
  const safe = { deployment: { name: "spaehposten", image: "wachturm-spaeher:1.0", replicas: 1, securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true } } };
  sim.files["spaehposten-roh.yaml"] = "kind: Deployment";
  sim.files["spaehposten.yaml"] = "kind: Deployment";

  // Schritt 1: roh unter privileged (Default) -> läuft (genau das Risiko).
  sim.applyEffects["spaehposten-roh.yaml"] = roh;
  assert.ok(!sim.exec("kubectl apply -f spaehposten-roh.yaml").error, "unter privileged kommt der ungehärtete Posten durch");
  assert.ok(sim.deployments.some(d => d.name === "spaehposten"), "der rohe Posten läuft");

  // Schritt 2: restricted scharf schalten + abräumen.
  sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
  assert.equal(sim.podSecurity, "restricted", "die enforce-Stufe steht");
  sim.exec("kubectl delete deployment spaehposten");
  assert.ok(!sim.deployments.some(d => d.name === "spaehposten"), "der rohe Posten ist abgeräumt");

  // Gegenprobe: derselbe ROHE Posten würde unter restricted jetzt ABGEWIESEN
  // (das ist die Ablehnung, die die Quest im Intro zitiert, aber als Task nicht ausführen kann).
  const rej = sim.exec("kubectl apply -f spaehposten-roh.yaml");
  assert.ok(rej.error, "unter restricted weist das Tor den ungehärteten Posten ab");
  assert.match(rej.output!, /restricted|runAsNonRoot|Forbidden|Pod Security/i, "klare Ablehnungs-Begründung");
  assert.ok(!sim.deployments.some(d => d.name === "spaehposten"), "der abgewiesene Posten entsteht NICHT");

  // Schritt 3: der GEHÄRTETE Posten kommt unter restricted durch.
  sim.applyEffects["spaehposten.yaml"] = safe;
  const ok = sim.exec("kubectl apply -f spaehposten.yaml");
  assert.ok(!ok.error, "der gehärtete Posten (runAsNonRoot + keine Eskalation) wird zugelassen");
  assert.ok(sim.deployments.some(d => d.name === "spaehposten"), "der gehärtete Posten läuft");
});

/* ===================== #139 Quest-Arc (content-driven): die ECHTEN Vidar-Quests
 * erzeugen die richtigen can-i-/Admission-Ausgänge =====================
 * Anders als die Tests oben (die Befehle hand-nachbauen) fährt dieser Test die echten
 * `solution`/`scenario`-Daten aus KQContent (vidar.json) in Story-Reihenfolge durch.
 * Damit fängt er Regressionen in der Quest-DATEI selbst (accept/applyEffects/solution),
 * die der generische Durchspiel-Test (quests.test.ts) NICHT sieht: die can-i-Gegenproben-
 * Schritte tragen bewusst KEIN check(), ihre Ausgabe wird sonst nirgends geprüft. */

/** Ersetzt den `<...>`-Platzhalter (nur k8s-serviceaccount: `describe pod <wachposten-pod>`)
 *  durch einen echten Pod-Namen aus dem laufenden Sim. */
function resolveWachposten(cmd: string, s: KQSim): string {
  if (!cmd.includes("<")) return cmd;
  const dep = s.deployments.find(d => d.name === "wachposten") || s.deployments[0];
  return cmd.replace(/<[^>]+>/, dep.pods[0].name);
}

/** Spielt die vier Wachturm-Quests in Story-Reihenfolge gegen EINEN Sim durch (wie im
 *  echten Spiel) und sammelt die Ausgabe jedes terminal/teach-Befehls nach Task-ID ein. */
function playWachturmArc() {
  const s = freshSim();
  const out: Record<string, string | null | undefined> = {};
  const run = (task: { id: string; accept: RegExp[]; solution: string }) => {
    const cmd = resolveWachposten(task.solution, s);
    const norm = cmd.trim().replace(/\s+/g, " ");
    const r = s.exec(cmd);
    assert.ok(task.accept.some(re => re.test(norm)), task.id + ": Lösung matcht accept nicht: " + norm);
    assert.ok(!r.error, task.id + ": Sim-Fehler: " + r.output);
    out[task.id] = r.output;
  };
  for (const id of ["k8s-serviceaccount", "k8s-rbac-role", "k8s-rbac-clusterrole", "k8s-pod-security"]) {
    const quest = KQContent.QUESTS.find(q => q.id === id);
    assert.ok(quest, id + " fehlt in QUESTS");
    for (const step of quest!.steps) {
      if (step.scenario) s.mergeScenario(step.scenario);
      if (step.type === "teach") run(step.cmd);
      else if (step.type === "terminal") for (const t of step.tasks) run(t);
    }
  }
  return { sim: s, out };
}

test("#139 Quest-Arc: auth can-i wandert mit den echten Quest-Daten von 'no' auf 'yes' (RBAC-Lernbogen)", () => {
  const { sim: s, out } = playWachturmArc();
  // Role/RoleBinding (k8s-rbac-role): vor dem Binden no, nach dem Binden yes, löschen bleibt no.
  assert.equal(out["t-rb-cant"], "no", "vor Role+Binding darf wachdienst keine pods lesen");
  assert.equal(out["t-rb-can"], "yes", "nach Role+RoleBinding darf wachdienst pods lesen");
  assert.equal(out["t-rb-cant-delete"], "no", "Least Privilege: pods löschen bleibt verboten");
  // ClusterRole (k8s-rbac-clusterrole): namespaced Role erreicht Nodes nicht, ClusterRoleBinding schon.
  assert.equal(out["t-cr-cant"], "no", "namespaced Role erreicht die cluster-weiten Nodes nicht");
  assert.equal(out["t-cr-can"], "yes", "nach ClusterRole+ClusterRoleBinding darf wachdienst Nodes lesen");
  assert.equal(out["t-cr-cant-delete"], "no", "Least Privilege: Nodes löschen bleibt verboten");
  // Endzustand: die enforce-Stufe steht, der gehärtete spaehposten läuft.
  assert.equal(s.podSecurity, "restricted", "die Quest hat die enforce-Stufe scharf geschaltet");
  assert.ok(s.deployments.some(d => d.name === "spaehposten"), "der gehärtete Posten läuft nach dem Arc");
});

test("#139 Red-Green: ohne den RoleBinding-Schritt bleibt can-i 'no' (der Arc-Test hat Zähne)", () => {
  // Beweist, dass das 'yes' im Arc-Test wirklich vom Binding kommt (und nicht zufällig
  // immer 'yes' wäre): dieselbe Quest, aber der Übergabe-Schritt wird ausgelassen.
  const s = freshSim();
  s.exec("kubectl create serviceaccount wachdienst"); // Voraussetzung aus Quest 1
  const quest = KQContent.QUESTS.find(q => q.id === "k8s-rbac-role")!;
  for (const step of quest.steps) {
    if (step.scenario) s.mergeScenario(step.scenario);
    if (step.type === "teach") {
      if (step.cmd.id === "t-rb-apply-binding") continue; // genau die Schlüsselübergabe weglassen
      s.exec(step.cmd.solution);
    } else if (step.type === "terminal") {
      for (const t of step.tasks) s.exec(t.solution);
    }
  }
  assert.equal(
    s.exec("kubectl auth can-i get pods --as=system:serviceaccount:default:wachdienst").output,
    "no",
    "ohne RoleBinding darf wachdienst NICHT lesen – sonst wäre das 'yes' im Arc bedeutungslos",
  );
});
