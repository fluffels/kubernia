/* Sim-Tests (#1139): `kubectl apply -f` / `delete -f` lesen den Datei-Inhalt, wenn kein
 * `applyEffects`-Eintrag hinterlegt ist. Fahren über sim.exec, Fixtures in ./helpers. */
import { test, beforeEach, expect } from "vitest";
import { KQSim, freshSim } from "./helpers";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

const dep = (replicas: number, extra = "") => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: ${replicas}
  template:
    spec:
      containers:
        - name: web
          image: nginx:1.27${extra}
`;

const SVC = `apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  ports:
    - port: 80
      targetPort: 8080
`;

const podCount = (): number => sim.deployments.find(d => d.name === "web")?.pods.length ?? 0;

test("apply -f legt replicas Pods an", () => {
  sim.files["web.yaml"] = dep(3);
  const r = sim.exec("kubectl apply -f web.yaml");
  expect(r.error).toBeFalsy();
  expect(r.output).toBe("deployment.apps/web created");
  expect(podCount()).toBe(3);
  expect(sim.deployments.find(d => d.name === "web")?.image).toBe("nginx:1.27");
});

test("apply -f: Änderung auf 5 ist configured, erneutes apply unchanged", () => {
  sim.files["web.yaml"] = dep(3);
  sim.exec("kubectl apply -f web.yaml");
  sim.files["web.yaml"] = dep(5);
  expect(sim.exec("kubectl apply -f web.yaml").output).toBe("deployment.apps/web configured");
  expect(podCount()).toBe(5);
  const pods = sim.deployments[0].pods.map(p => p.name);
  expect(sim.exec("kubectl apply -f web.yaml").output).toBe("deployment.apps/web unchanged");
  expect(sim.deployments[0].pods.map(p => p.name)).toStrictEqual(pods);
  sim.files["web.yaml"] = dep(2);
  expect(sim.exec("kubectl apply -f web.yaml").output).toBe("deployment.apps/web configured");
  expect(podCount()).toBe(2);
});

test("kaputtes YAML: Fehler mit Zeile, die Sim bleibt unverändert", () => {
  sim.exec("kubectl create deployment alt --image=nginx");
  sim.files["kaputt.yaml"] = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n\tname: web\n";
  const before = JSON.stringify(sim.snapshot());
  const r = sim.exec("kubectl apply -f kaputt.yaml");
  expect(r.error).toBeTruthy();
  expect(r.output).toMatch(/error: error parsing kaputt\.yaml: yaml: line 4: /);
  expect(JSON.stringify(sim.snapshot())).toBe(before);
});

test("unbekanntes kind, Dockerfile-Inhalt und leere Datei: Fehler, Sim unverändert", () => {
  sim.files["cm.yaml"] = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n";
  sim.files["Dockerfile"] = "FROM node:20\nCOPY . .\n";
  sim.files["leer.yaml"] = "# nur Kommentar\n";
  const before = JSON.stringify(sim.snapshot());
  const unknown = sim.exec("kubectl apply -f cm.yaml");
  expect(unknown.error).toBeTruthy();
  expect(unknown.output).toMatch(/no matches for kind "ConfigMap" in version "v1"/);
  expect(sim.exec("kubectl apply -f Dockerfile").error).toBeTruthy();
  expect(sim.exec("kubectl apply -f leer.yaml").output).toMatch(/no objects passed to apply/);
  expect(JSON.stringify(sim.snapshot())).toBe(before);
});

test("Datei fehlt: weiter 'does not exist'", () => {
  expect(sim.exec("kubectl apply -f gibtsnicht.yaml").output).toMatch(/the path "gibtsnicht\.yaml" does not exist/);
  expect(sim.exec("kubectl delete -f gibtsnicht.yaml").output).toMatch(/does not exist/);
});

test("Multi-Dokument: Deployment + Service anlegen und per delete -f löschen", () => {
  sim.files["app.yaml"] = dep(2) + "---\n" + SVC;
  expect(sim.exec("kubectl apply -f app.yaml").output).toBe("deployment.apps/web created\nservice/web created");
  expect(podCount()).toBe(2);
  const svc = sim.services.find(s => s.name === "web");
  expect(svc?.port).toBe(80);
  expect(svc?.targetPort).toBe(8080);
  expect(sim.exec("kubectl delete -f app.yaml").output).toBe('deployment.apps "web" deleted\nservice "web" deleted');
  expect(sim.deployments.find(d => d.name === "web")).toBeUndefined();
  expect(sim.services.find(s => s.name === "web")).toBeUndefined();
});

test("Multi-Dokument mit Fehler im zweiten Dokument legt nichts an (alles oder nichts)", () => {
  sim.files["app.yaml"] = dep(2) + "---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web\nspec:\n  selector: {}\n";
  const r = sim.exec("kubectl apply -f app.yaml");
  expect(r.error).toBeTruthy();
  expect(sim.deployments.find(d => d.name === "web")).toBeUndefined();
});

test("delete -f mit kaputtem YAML meldet den Parse-Fehler und löscht nichts", () => {
  sim.files["web.yaml"] = dep(1);
  sim.exec("kubectl apply -f web.yaml");
  sim.files["web.yaml"] = "a: [\n";
  const r = sim.exec("kubectl delete -f web.yaml");
  expect(r.error).toBeTruthy();
  expect(r.output).toMatch(/error parsing web\.yaml/);
  expect(podCount()).toBe(1);
});

test("Datei mit applyEffects-Eintrag verhält sich wie bisher (Vorrang, Inhalt egal)", () => {
  sim.files["app.yaml"] = "kaputt: [";
  sim.applyEffects["app.yaml"] = { deployment: { name: "lager", image: "redis", replicas: 2 } };
  expect(sim.exec("kubectl apply -f app.yaml").output).toBe("deployment.apps/lager created");
  expect(sim.exec("kubectl apply -f app.yaml").output).toBe("deployment.apps/lager unchanged");
  expect(sim.exec("kubectl delete -f app.yaml").output).toBe('deployment.apps "lager" deleted');
});

test("Pod-Security-Ablehnung (Handler-Fehler) bleibt auch bei gemappten Dateien ein Fehler", () => {
  sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
  sim.files["web.yaml"] = dep(1, "\n          securityContext:\n            privileged: true");
  const r = sim.exec("kubectl apply -f web.yaml");
  expect(r.error).toBeTruthy();
  expect(sim.deployments.find(d => d.name === "web")).toBeUndefined();
});

test("apply: geänderte serviceAccountName bei gleicher Replikazahl ist configured", () => {
  sim.files["web.yaml"] = dep(1);
  sim.exec("kubectl apply -f web.yaml");
  sim.files["web.yaml"] = dep(1).replace("    spec:\n", "    spec:\n      serviceAccountName: wachdienst\n");
  expect(sim.exec("kubectl apply -f web.yaml").output).toBe("deployment.apps/web configured");
  expect(sim.deployments[0].serviceAccountName).toBe("wachdienst");
});

test("hinterlegter Effekt: apply nach scale setzt auf den Manifest-Wert zurück (configured)", () => {
  sim.files["app.yaml"] = "x";
  sim.applyEffects["app.yaml"] = { deployment: { name: "lager", image: "redis", replicas: 2 } };
  sim.exec("kubectl apply -f app.yaml");
  sim.exec("kubectl scale deployment lager --replicas=5");
  expect(sim.exec("kubectl apply -f app.yaml").output).toBe("deployment.apps/lager configured");
  expect(sim.deployments.find(d => d.name === "lager")?.pods.length).toBe(2);
});

test("gemapptes Deployment mit initContainers wird ohne fillsMi angelegt (kein NaN)", () => {
  sim.files["web.yaml"] = dep(1).replace("      containers:", "      initContainers:\n        - name: i\n          image: busybox\n      containers:");
  expect(sim.exec("kubectl apply -f web.yaml").error).toBeFalsy();
  expect(sim.deployments[0].initContainer).toStrictEqual({ fillsMi: 0, doubleStage: false });
});
