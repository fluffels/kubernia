/* Unit-Tests: RBAC / ServiceAccounts / Pod-Security (#126) + Security-Manifeste via
 * kubectl apply (#128) – Teil des sim.test.ts-Splits (#383). Eigener Schnitt aus der
 * kubectl-Familie, weil das Wachturm-Quartier (RBAC/PSA) ein abgegrenztes Lernthema
 * mit eigenen Manifest-Fixtures ist. Fahren über sim.exec("…"); Fixtures in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";
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
