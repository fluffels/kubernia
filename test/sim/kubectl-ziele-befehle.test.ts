/* kubectl-Mehrfachziele (#1488): describe, delete, scale und rollout restart arbeiten mehrere Ziele ab (je Ziel eine
 * Zeile, ein fehlendes Ziel stoppt die übrigen nicht, die NotFound-Zeilen stehen zuletzt); expose und set lehnen
 * weitere Ziele ab, statt sie still zu ignorieren. Jeder Fehlerfall prüft per Snapshot, dass nichts angefasst wurde.
 * Der Ziel-Leser selbst: kubectl-ziele.test.ts. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import type { Scenario } from "../../src/sim/state";

const NO_TYPE = "there is no need to specify a resource type as a separate argument";
const EINZEL = "error: arguments in resource/name form must have a single resource and name";
const MEHR = "error: arguments in resource/name form may not have more than one slash";

function szenario(): Scenario {
  return {
    deployments: [{ name: "web", image: "nginx", replicas: 2 }, { name: "api", image: "api:1", replicas: 1 }],
    services: [
      { name: "web", type: "ClusterIP", clusterIP: "10.96.0.7", port: 80 },
      { name: "a", type: "ClusterIP", clusterIP: "10.96.0.8", port: 80 },
      { name: "b", type: "ClusterIP", clusterIP: "10.96.0.9", port: 80 },
    ],
    statefulSets: [{ name: "db", image: "db:1", replicas: 1 }],
  };
}

function lauf(cmd: string, sim: KQSim = new KQSim(szenario())) {
  const r = sim.exec(cmd);
  return { out: r.output ?? "", error: r.error, sim };
}

/** Der Befehl scheitert, ohne etwas zu ändern. */
function ablehnen(cmd: string, text: string): void {
  const sim = new KQSim(szenario());
  const vorher = JSON.stringify(sim.snapshot());
  const r = lauf(cmd, sim);
  expect(r.error, cmd).toBe(true);
  expect(r.out, cmd).toContain(text);
  expect(JSON.stringify(sim.snapshot()), cmd).toBe(vorher);
}

/** Die Namen der Pods aus `kubectl get pods` (erste Spalte ohne Kopf). */
function podNamen(sim: KQSim): string[] {
  return sim.exec("kubectl get pods").output!.split("\n").slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
}

describe("describe: Mehrfachziele", () => {
  test("zwei Pods in Slash-Form: beide beschrieben", () => {
    const sim = new KQSim(szenario());
    const [a, b] = podNamen(sim);
    const r = lauf(`kubectl describe pod/${a} pod/${b}`, sim);
    expect(r.error).toBe(false);
    expect(r.out).toMatch(new RegExp("^Name:\\s+" + a + "$", "m"));
    expect(r.out).toMatch(new RegExp("^Name:\\s+" + b + "$", "m"));
    expect(r.out.indexOf(a)).toBeLessThan(r.out.indexOf(b));
  });

  test("gemischte Arten: Pod und Deployment", () => {
    const sim = new KQSim(szenario());
    const [a] = podNamen(sim);
    const r = lauf(`kubectl describe pod/${a} deploy/api`, sim);
    expect(r.error).toBe(false);
    expect(r.out).toMatch(new RegExp("^Name:\\s+" + a + "$", "m"));
    expect(r.out).toMatch(/^Name:\s+api$/m);
  });

  test("fehlendes Ziel mitten in der Liste: Gefundene gerendert, NotFound am Ende", () => {
    const sim = new KQSim(szenario());
    const [a, b] = podNamen(sim);
    const r = lauf(`kubectl describe pod/${a} pod/fehlt pod/${b}`, sim);
    expect(r.error).toBe(true);
    expect(r.out).toMatch(new RegExp("^Name:\\s+" + b + "$", "m"));
    const zeilen = r.out.split("\n");
    expect(zeilen[zeilen.length - 2]).toContain('Error from server (NotFound): pods "fehlt" not found');
  });

  test("Art ohne Renderer lehnt vor jedem Rendern ab", () => {
    const sim = new KQSim(szenario());
    const [a] = podNamen(sim);
    const r = lauf(`kubectl describe pod/${a} replicaset/x`, sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain("Nicht simuliert:");
    expect(r.out).not.toContain("Name:");
  });

  test("Komma-Liste mit Name: Kreuzprodukt, jede Art exakt", () => {
    const r = lauf("kubectl describe deploy,svc web");
    expect(r.error).toBe(false);
    expect(r.out.match(/^Name:\s+web$/gm)).toHaveLength(2);
  });

  test("ohne Namen: alle Objekte mehrerer Arten", () => {
    const r = lauf("kubectl describe deploy,svc");
    expect(r.error).toBe(false);
    expect(r.out).toMatch(/^Name:\s+api$/m);
    expect(r.out).toMatch(/^Name:\s+b$/m);
    expect(r.out.match(/^Name:\s+web$/gm)).toHaveLength(2);
  });

  test("Regression: `typ name` ist eine Präfix-Suche, die Slash-Form nur exakt", () => {
    const sim = new KQSim(szenario());
    const praefix = lauf("kubectl describe pod web-", sim);
    expect(praefix.error).toBe(false);
    expect(praefix.out.match(/^Name:\s+web-/gm)).toHaveLength(2);
    const exakt = lauf("kubectl describe deploy/we", sim);
    expect(exakt.error).toBe(true);
    expect(exakt.out).toContain('Error from server (NotFound): deployments.apps "we" not found');
  });

  test.each([
    ["kubectl describe pod pod/x", NO_TYPE],
    ["kubectl describe pod/ svc/web", EINZEL],
    ["kubectl describe pod/a/b", MEHR],
    ["kubectl describe frob/x", "resource type"],
  ])("%s → Fehler, nichts angefasst", (cmd, text) => { ablehnen(cmd, text); });
});

describe("delete: Mehrfachziele", () => {
  test("`svc a b`: je Ziel eine Zeile", () => {
    const r = lauf("kubectl delete svc a b");
    expect(r.error).toBe(false);
    expect(r.out).toBe('service "a" deleted\nservice "b" deleted');
    expect(r.sim.services.map(s => s.name)).toEqual(["web"]);
  });

  test("gemischte Arten: Pod und Service", () => {
    const sim = new KQSim(szenario());
    const [pod] = podNamen(sim);
    const r = lauf(`kubectl delete pod/${pod} svc/web`, sim);
    expect(r.error).toBe(false);
    expect(r.out).toBe(`pod "${pod}" deleted\nservice "web" deleted`);
    expect(sim.services.some(s => s.name === "web")).toBe(false);
    expect(podNamen(sim)).not.toContain(pod);
  });

  test("fehlendes Ziel mitten in der Liste: die übrigen werden gelöscht, NotFound steht zuletzt", () => {
    const r = lauf("kubectl delete svc a fehlt b");
    expect(r.error).toBe(true);
    expect(r.out.split("\n").slice(0, 3)).toEqual(['service "a" deleted', 'service "b" deleted', 'Error from server (NotFound): services "fehlt" not found']);
    expect(r.out).toContain("kubectl get services");
    expect(r.sim.services.map(s => s.name)).toEqual(["web"]);
  });

  test("lauter fehlende Ziele: nur NotFound-Zeilen", () => {
    const r = lauf("kubectl delete svc x y");
    expect(r.error).toBe(true);
    expect(r.out).toContain('services "x" not found\nError from server (NotFound): services "y" not found');
  });

  test.each([
    ["kubectl delete pod pod/a", NO_TYPE],
    ["kubectl delete svc/a b", NO_TYPE],
    ["kubectl delete svc/a svc/", EINZEL],
    ["kubectl delete svc/a svc/b/c", MEHR],
    ["kubectl delete svc/a frob/x", "resource type"],
    ["kubectl delete svc/a replicaset/x", "Nicht simuliert:"],
    ["kubectl delete svc", "Was und wie heißt es?"],
    ["kubectl delete svc/a all", NO_TYPE],
  ])("%s → Fehler, nichts gelöscht", (cmd, text) => { ablehnen(cmd, text); });

  test("`-f` zusammen mit Art und Name: der Builder-Fehler, nichts gelöscht", () => {
    const sim = new KQSim(szenario());
    sim.files["x.yaml"] = "apiVersion: v1\nkind: Service\nmetadata:\n  name: web\nspec:\n  ports:\n    - port: 80\n";
    const vorher = JSON.stringify(sim.snapshot());
    const r = lauf("kubectl delete -f x.yaml svc web", sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain("you may not specify a resource by arguments as well");
    expect(JSON.stringify(sim.snapshot())).toBe(vorher);
  });

  test.each(["-f x.yaml", "-fx.yaml", "-f=x.yaml", "--filename x.yaml", "--filename=x.yaml"])("apply und delete lesen die Datei aus `%s`", flag => {
    const sim = new KQSim(szenario());
    sim.files["x.yaml"] = "apiVersion: v1\nkind: Service\nmetadata:\n  name: neu\nspec:\n  ports:\n    - port: 80\n";
    expect(lauf("kubectl apply " + flag, sim).out).toBe("service/neu created");
    expect(lauf("kubectl delete " + flag, sim).out).toBe('service "neu" deleted');
  });
});

describe("scale und rollout restart: Mehrfachziele", () => {
  test("scale: zwei Deployments, je eine Zeile", () => {
    const r = lauf("kubectl scale deployment web api --replicas=3");
    expect(r.error).toBe(false);
    expect(r.out).toBe("deployment.apps/web scaled\ndeployment.apps/api scaled");
    expect(r.sim.deployments.map(d => d.replicas)).toEqual([3, 3]);
  });

  test("scale: fehlendes Ziel mitten in der Liste, die übrigen skalieren, NotFound zuletzt", () => {
    const r = lauf("kubectl scale deployment web fehlt api --replicas=4");
    expect(r.error).toBe(true);
    expect(r.out.split("\n").slice(0, 3)).toEqual(["deployment.apps/web scaled", "deployment.apps/api scaled", 'Error from server (NotFound): deployments.apps "fehlt" not found']);
    expect(r.out).toContain("kubectl get deployments");
    expect(r.sim.deployments.map(d => d.replicas)).toEqual([4, 4]);
  });

  test("scale in Slash-Form", () => {
    const r = lauf("kubectl scale deploy/web deploy/api --replicas=0");
    expect(r.out).toBe("deployment.apps/web scaled\ndeployment.apps/api scaled");
  });

  test.each([
    ["kubectl scale deploy/web sts/db --replicas=1", "Nicht simuliert:"],
    ["kubectl scale deploy/web deploy/ --replicas=1", EINZEL],
    ["kubectl scale deploy/web api --replicas=1", NO_TYPE],
    ["kubectl scale deployment fehlt --replicas=-1", "COUNT must be greater than or equal to 0"],
    ["kubectl scale deployment web api --replicas=x", "invalid argument"],
    ["kubectl scale deployment web api", "So nicht ganz"],
    ["kubectl scale --replicas=2", "So nicht ganz"],
  ])("%s → Fehler, nichts angefasst", (cmd, text) => { ablehnen(cmd, text); });

  test("rollout restart: zwei Deployments", () => {
    const r = lauf("kubectl rollout restart deployment/web deployment/api");
    expect(r.error).toBe(false);
    expect(r.out).toBe("deployment.apps/web restarted\ndeployment.apps/api restarted");
  });

  test("rollout restart: fehlendes Ziel mitten in der Liste", () => {
    const r = lauf("kubectl rollout restart deployment web fehlt api");
    expect(r.error).toBe(true);
    expect(r.out.split("\n").slice(0, 3)).toEqual(["deployment.apps/web restarted", "deployment.apps/api restarted", 'Error from server (NotFound): deployments.apps "fehlt" not found']);
    expect(r.out).toContain("kubectl get deployments");
  });

  test.each([
    ["kubectl rollout restart deployment/web statefulset/db", "Nicht simuliert:"],
    ["kubectl rollout restart deployment/web api", NO_TYPE],
    ["kubectl rollout restart", "Welches Deployment?"],
  ])("%s → Fehler, nichts angefasst", (cmd, text) => { ablehnen(cmd, text); });
});

describe("expose und set: weitere Ziele werden abgelehnt, nie still ignoriert", () => {
  test.each([
    ["kubectl expose deployment web api --port=80", "mehrere Ziele bei 'kubectl expose'"],
    ["kubectl expose deploy/web deploy/api --port=80", "mehrere Ziele bei 'kubectl expose'"],
    ["kubectl set image deployment/web deployment/api web=x", "mehrere Ziele bei 'kubectl set'"],
    ["kubectl set image deploy/web a=x b=y", "mehrere Container"],
    ["kubectl set env deployment/web FOO=bar --from=configmap/c", "'KEY=wert'"],
    ["kubectl set env deployment/web deployment/api --from=configmap/c", "mehrere Ziele bei 'kubectl set'"],
    ["kubectl set resources deployment/web deployment/api --limits=memory=1Gi", "mehrere Ziele bei 'kubectl set'"],
  ])("%s → Fehler, nichts angefasst", (cmd, text) => { ablehnen(cmd, text); });

  test("ein Ziel, Paar vor der Referenz: weiter gültig", () => {
    const r = lauf("kubectl set image nginx=ghcr.io/org/img:1 deployment/web");
    expect(r.error).toBe(false);
    expect(r.out).toBe("deployment.apps/web image updated");
  });
});
