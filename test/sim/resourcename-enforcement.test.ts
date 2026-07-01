/* #507 – DNS-1123-Durchsetzung ZENTRAL an der Anlege-Grenze (die _make*-Fabriken).
 *
 * Vor #507 prüfte nur `kubectl create` (#489) den Namen; alle anderen Anlege-Wege
 * (helm install, kubectl apply -f, kubectl expose, StatefulSet/PVC) umgingen die Regel
 * und konnten still eine Ressource mit ungültigem Namen erzeugen. Diese Tests fahren
 * über die öffentliche `sim.exec`-API (Verhalten, nicht Interna) und beweisen, dass ein
 * ungültiger Name an JEDEM Weg als richtige kubectl-Meldung abgelehnt wird UND keine
 * Ressource entsteht. Red-Green: nimmt man die Fabrik-Prüfung heraus, werden diese Tests
 * rot (die Ressource entsteht dann doch). */
import { test, describe, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

/** Die zentrale Meldung enthält den beanstandeten Namen + den RFC-1123-Text. */
function assertRfc1123Error(out: string | null, badName: string) {
  assert.ok(out, "es sollte eine Ausgabe geben");
  assert.match(out!, new RegExp(badName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "nennt den beanstandeten Namen");
  assert.match(out!, /RFC 1123 subdomain/, "gibt die DNS-1123-Fehlermeldung");
}

describe("helm install – Release-Name aus Roh-Input", () => {
  test("lehnt einen DNS-1123-verletzenden Release-Namen ab und legt NICHTS an", () => {
    sim.exec("helm repo add bitnami https://charts.bitnami.com/bitnami");
    // "Web_Dienst" → depName "Web_Dienst-nginx" verletzt DNS-1123 (Großbuchstabe + Unterstrich).
    const res = sim.exec("helm install Web_Dienst bitnami/nginx");
    assert.equal(res.error, true, "der Befehl schlägt fehl");
    assertRfc1123Error(res.output, "Web_Dienst-nginx");
    assert.equal(sim.deployments.length, 0, "kein Deployment mit ungültigem Namen");
    assert.equal(sim.services.length, 0, "kein Service mit ungültigem Namen");
    assert.equal(sim.releases.length, 0, "kein Release angelegt");
  });

  test("ein gültiger Release-Name funktioniert weiterhin (kein False Positive)", () => {
    sim.exec("helm repo add bitnami https://charts.bitnami.com/bitnami");
    const res = sim.exec("helm install web bitnami/nginx");
    assert.equal(res.error, false);
    assert.equal(sim.deployments.length, 1);
    assert.equal(sim.services.length, 1, "der zugehörige Service entsteht über die Fabrik");
    assert.ok(sim.services[0].clusterIP.startsWith("10.96."), "Service bekommt eine ClusterIP");
  });
});

describe("kubectl apply -f – bisher völlig ungeprüft", () => {
  test("lehnt einen ungültigen Deployment-Namen aus dem Manifest ab und legt nichts an", () => {
    const s = new KQSim({
      files: { "app.yaml": "(deployment manifest)" },
      applyEffects: { "app.yaml": { deployment: { name: "Bad_Name", image: "nginx", replicas: 1 } } },
    });
    const res = s.exec("kubectl apply -f app.yaml");
    assert.equal(res.error, true);
    assertRfc1123Error(res.output, "Bad_Name");
    assert.equal(s.deployments.length, 0, "kein Deployment mit ungültigem Namen");
  });

  test("ein gültiges Manifest wird weiterhin angewandt", () => {
    const s = new KQSim({
      files: { "app.yaml": "(deployment manifest)" },
      applyEffects: { "app.yaml": { deployment: { name: "kasse", image: "nginx", replicas: 2 } } },
    });
    const res = s.exec("kubectl apply -f app.yaml");
    assert.equal(res.error, false);
    assert.equal(s.deployments.length, 1);
    assert.equal(s.deployments[0].pods.length, 2, "pods.length === replicas (Invariante bleibt)");
  });
});

describe("kubectl expose – Service über die Fabrik", () => {
  test("legt für ein gültiges Deployment einen Service mit ClusterIP an", () => {
    sim.exec("kubectl create deployment kasse --image=nginx");
    const res = sim.exec("kubectl expose deployment kasse --port=80");
    assert.equal(res.error, false);
    const svc = sim.services.find(s => s.name === "kasse");
    assert.ok(svc, "Service angelegt");
    assert.ok(svc!.clusterIP.startsWith("10.96."), "ClusterIP aus dem Namen abgeleitet");
  });
});

describe("kubectl create – #489 bleibt (pre-mutation-Prüfung, gleiche Meldung)", () => {
  test("lehnt einen ungültigen Deployment-Namen mit der DNS-1123-Meldung ab", () => {
    const res = sim.exec("kubectl create deployment Bad_Dep --image=nginx");
    assert.equal(res.error, true);
    assertRfc1123Error(res.output, "Bad_Dep");
    assert.equal(sim.deployments.length, 0);
  });
});
