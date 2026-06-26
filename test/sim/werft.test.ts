/* Heimat-Werft – Capstone-Sim-Grundlage (#164, Phase 10).
 * Der ganze Bogen „eigenen Service bauen → per Manifest deployen → erreichbar":
 *   - `curl` als Erreichbarkeits-Befehl (HTTP 200 vs. Connection refused),
 *   - Image-fehlt-Haken (ImagePullBackOff, heilt nach `docker build`),
 *   - falscher Port (in der URL UND targetPort≠containerPort im Manifest),
 *   - CrashLoop als bestehendes Fehlerbild über curl sichtbar.
 * Negativfälle bewusst mitgetestet (Red-Green), damit kein False Positive durchrutscht. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";

let sim: ReturnType<typeof freshSim>;
beforeEach(() => { sim = freshSim(); });

/** Werft-Manifest: Deployment (eigenes Image, containerPort) + passender Service. */
function werftSzenario(opts: { containerPort?: number; targetPort?: number } = {}) {
  const containerPort = opts.containerPort ?? 8080;
  const targetPort = opts.targetPort ?? 8080;
  return {
    files: {
      "Dockerfile": "FROM nginx:alpine\nCOPY . /app",
      "werft.yaml": "kind: Deployment\nname: werft-dienst",
    },
    applyEffects: {
      "werft.yaml": {
        deployment: { name: "werft-dienst", image: "werft-dienst:1.0", replicas: 1, requireBuiltImage: true, containerPort },
        service: { name: "werft-dienst", port: 80, targetPort },
      },
    },
  };
}

test("Capstone-Happy-Path: bauen → deployen → erreichbar (curl 200)", () => {
  sim.mergeScenario(werftSzenario());
  assert.match(sim.exec("docker build -t werft-dienst:1.0 .").output ?? "", /Successfully tagged werft-dienst:1\.0/);
  const ap = sim.exec("kubectl apply -f werft.yaml");
  assert.ok(!ap.error, "apply ok");
  assert.match(ap.output!, /deployment\.apps\/werft-dienst created/);
  // Pod läuft (Image war vor dem apply schon gebaut → kein ImagePullBackOff).
  assert.match(sim.exec("kubectl get pods").output!, /werft-dienst-\S+\s+1\/1\s+Running/);
  const c = sim.exec("curl http://werft-dienst");
  assert.ok(!c.error, "erreichbar = kein Fehler");
  assert.match(c.output!, /200 OK/);
  assert.match(c.output!, /erreichbar/);
});

test("Image fehlt: apply ohne docker build → ImagePullBackOff, curl refused, heilt nach Build", () => {
  sim.mergeScenario(werftSzenario());
  // Kein `docker build` → das eigene Image gibt es noch nicht.
  const ap = sim.exec("kubectl apply -f werft.yaml");
  assert.ok(!ap.error, "apply selbst ist kein Fehler – der Pod scheitert erst beim Starten");
  assert.match(sim.exec("kubectl get pods").output!, /werft-dienst-\S+\s+0\/1\s+ImagePullBackOff/);
  const broken = sim.exec("curl http://werft-dienst");
  assert.ok(broken.error);
  assert.match(broken.output!, /Connection refused/);
  // Ursache beheben: Image bauen. Der kubelet zieht es nach → der nächste Befehl heilt.
  assert.match(sim.exec("docker build -t werft-dienst:1.0 .").output!, /Successfully/);
  assert.match(sim.exec("kubectl get pods").output!, /werft-dienst-\S+\s+1\/1\s+Running/);
  assert.equal(sim.deployments.find(d => d.name === "werft-dienst")!.broken, null, "ImagePullBackOff geheilt");
  assert.match(sim.exec("curl werft-dienst").output!, /200 OK/);
});

test("Image fehlt: describe pod nennt ImagePullBackOff (Diagnose)", () => {
  sim.mergeScenario(werftSzenario());
  sim.exec("kubectl apply -f werft.yaml");
  const pod = sim.deployments.find(d => d.name === "werft-dienst")!.pods[0].name;
  const d = sim.exec("kubectl describe pod " + pod);
  assert.match(d.output!, /ImagePullBackOff/);
});

test("Image fehlt: rollout restart heilt, sobald das Image gebaut ist", () => {
  sim.mergeScenario(werftSzenario());
  sim.exec("kubectl apply -f werft.yaml");
  sim.exec("docker build -t werft-dienst:1.0 .");
  const r = sim.exec("kubectl rollout restart deployment werft-dienst");
  assert.match(r.output!, /restarted/);
  assert.equal(sim.deployments.find(d => d.name === "werft-dienst")!.broken, null);
});

test("Image-Recheck rührt klassischen Tippfehler-ImagePull NICHT an (kein False Positive)", () => {
  // badImage ohne needsBuild = echter Tippfehler – heilt NICHT von selbst, auch wenn
  // zufällig ein Image desselben Namens vorliegt.
  sim.mergeScenario({ dockerImages: ["app:latest"], deployments: [{ name: "app", image: "app", replicas: 1, broken: { type: "imagepull", badImage: "app" } }] });
  sim.exec("kubectl get pods");
  assert.ok(sim.deployments.find(d => d.name === "app")!.broken, "Tippfehler-ImagePull besteht weiter");
});

test("Falscher Port in der URL: Service lauscht woanders → refused mit Hinweis", () => {
  sim.mergeScenario(werftSzenario());
  sim.exec("docker build -t werft-dienst:1.0 .");
  sim.exec("kubectl apply -f werft.yaml");
  const c = sim.exec("curl http://werft-dienst:9999");
  assert.ok(c.error);
  assert.match(c.output!, /Connection refused/);
  assert.match(c.output!, /Port 80/, "nennt den richtigen Service-Port");
});

test("Falscher Port im Manifest: targetPort ≠ containerPort → Endpoints da, aber refused", () => {
  // Service leitet auf 8080, Container lauscht auf 3000 – die klassische Verdrahtungsfalle.
  sim.mergeScenario(werftSzenario({ containerPort: 3000, targetPort: 8080 }));
  sim.exec("docker build -t werft-dienst:1.0 .");
  sim.exec("kubectl apply -f werft.yaml");
  // Pod IST bereit → der Service HAT Endpoints (genau das macht den Fehler tückisch).
  assert.match(sim.exec("kubectl get endpoints werft-dienst").output!, /werft-dienst\s+10\.244/);
  const c = sim.exec("curl http://werft-dienst");
  assert.ok(c.error);
  assert.match(c.output!, /Connection refused/);
  assert.match(c.output!, /targetPort 8080/);
  assert.match(c.output!, /containerPort 3000/);
});

test("Gegenprobe: passende Ports (targetPort = containerPort) sind erreichbar", () => {
  sim.mergeScenario(werftSzenario({ containerPort: 3000, targetPort: 3000 }));
  sim.exec("docker build -t werft-dienst:1.0 .");
  sim.exec("kubectl apply -f werft.yaml");
  assert.match(sim.exec("curl http://werft-dienst").output!, /200 OK/);
});

test("CrashLoop ist über curl sichtbar (refused, Verweis auf describe/logs)", () => {
  sim.mergeScenario({
    deployments: [{ name: "kombuese", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "menue" } }],
    services: [{ name: "kombuese", type: "ClusterIP", clusterIP: "10.96.0.5", port: 80 }],
  });
  const c = sim.exec("curl http://kombuese");
  assert.ok(c.error);
  assert.match(c.output!, /Connection refused/);
  assert.match(c.output!, /describe pod/);
});

test("curl: unbekannter Service → Could not resolve host", () => {
  const c = sim.exec("curl http://gibtsnicht");
  assert.ok(c.error);
  assert.match(c.output!, /Could not resolve host/);
  assert.match(c.output!, /kubectl get services/);
});

test("curl: Service ohne Deployment dahinter → keine Endpoints → refused", () => {
  sim.mergeScenario({ services: [{ name: "leer", type: "ClusterIP", clusterIP: "10.96.0.9", port: 80 }] });
  const c = sim.exec("curl leer");
  assert.ok(c.error);
  assert.match(c.output!, /Connection refused/);
  assert.match(c.output!, /keine Endpoints/i);
});

test("curl ohne Adresse → freundliche Hilfe statt Absturz", () => {
  const c = sim.exec("curl");
  assert.ok(c.error);
  assert.match(c.output!, /Adresse/);
});

test("get endpoints zeigt den targetPort (nicht den Service-Port)", () => {
  sim.mergeScenario(werftSzenario({ containerPort: 8080, targetPort: 8080 }));
  sim.exec("docker build -t werft-dienst:1.0 .");
  sim.exec("kubectl apply -f werft.yaml");
  assert.match(sim.exec("kubectl get endpoints werft-dienst").output!, /:8080/);
});

test("expose --target-port setzt den targetPort des Service", () => {
  sim.exec("kubectl create deployment web --image=nginx");
  sim.exec("kubectl expose deployment web --port=80 --target-port=8080");
  assert.equal(sim.services.find(s => s.name === "web")!.targetPort, "8080");
});

test("help listet curl", () => {
  assert.match(sim.exec("help").output!, /curl/);
});

test("snapshot/reload bewahrt containerPort & targetPort", () => {
  sim.mergeScenario(werftSzenario({ containerPort: 5000, targetPort: 5000 }));
  sim.exec("docker build -t werft-dienst:1.0 .");
  sim.exec("kubectl apply -f werft.yaml");
  const restored = new KQSim(sim.snapshot());
  assert.equal(restored.deployments.find(d => d.name === "werft-dienst")!.containerPort, 5000);
  assert.equal(restored.services.find(s => s.name === "werft-dienst")!.targetPort, 5000);
  // Und nach dem Reload weiter erreichbar.
  assert.match(restored.exec("curl werft-dienst").output!, /200 OK/);
});
