/* kubectl create, set und auth prüfen ihre Eingaben wie kubectl (#1530, Befunde aus #1487):
 *   Container-Modell, (a) Container-Name bei set image, (b) Paare hinter den Ressourcen, (c) Kurznamen bei role/can-i,
 *   (d) Literal-Schlüssel, (e) Secret/ConfigMap ohne Literal, (f) rolebinding mit role UND clusterrole. */
import { describe, test, expect } from "vitest";
import { KQSim, freshSim } from "./helpers";
import { containerNameFromImage } from "../../src/sim/util";
import { containerNameOf } from "../../src/sim/workload";
import type { Scenario } from "../../src/sim/state";

const lauf = (cmd: string, sim: KQSim = freshSim()) => { const r = sim.exec(cmd); return { out: r.output ?? "", error: r.error, sim }; };

/** Eine Sim mit den Befehlen nacheinander ausgeführt (der Zustand bleibt). */
function mit(...cmds: string[]): KQSim {
  const sim = freshSim();
  for (const c of cmds) sim.exec(c);
  return sim;
}

describe("Container-Modell: create deployment benennt den Container nach dem Image", () => {
  test("describe deployment zeigt den Image-Namen als Container", () => {
    const sim = mit("kubectl create deployment web --image=nginx:1.28");
    const out = lauf("kubectl describe deployment web", sim).out;
    expect(out).toContain("   nginx:\n    Image:  nginx:1.28");
    expect(out).not.toContain("   web:\n");
  });
  test.each([
    ["reg.io:5000/org/app@sha256:ab", "app"],
    ["localhost:5000/app:1", "app"],
    ["nginx", "nginx"],
  ])("containerNameFromImage(%s) = %s", (image, name) => {
    expect(containerNameFromImage(image, () => 0.5)).toBe(name);
  });
  test("Unterstrich und Punkt werden zu '-' plus 5-stelligem Suffix", () => {
    expect(containerNameFromImage("my_app.v2", () => 0.5)).toMatch(/^my-app-v2-[a-z0-9]{5}$/);
    const sim = mit("kubectl create deployment web --image=my_app.v2");
    expect(lauf("kubectl get deploy -o wide", sim).out).toMatch(/my-app-v2-[a-z0-9]{5}\s+my_app\.v2/);
  });
  test("Szenario-Deployment ohne Feld: Container = Deployment-Name", () => {
    const sc: Scenario = { deployments: [{ name: "kasse", image: "nginx", replicas: 1 }] };
    expect(lauf("kubectl describe deployment kasse", new KQSim(sc)).out).toContain("   kasse:\n    Image:  nginx");
  });
  test("apply -f übernimmt containers[0].name", () => {
    const sim = freshSim();
    sim.files["d.yaml"] = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 1\n  template:\n    spec:\n      containers:\n        - name: haupt\n          image: nginx\n";
    expect(lauf("kubectl apply -f d.yaml", sim).out).toContain("created");
    expect(lauf("kubectl describe deployment web", sim).out).toContain("   haupt:\n    Image:  nginx");
  });
  test("Snapshot und Laden behalten das Feld", () => {
    const sim = mit("kubectl create deployment web --image=nginx");
    const snap = sim.snapshot();
    expect(snap.deployments?.[0].containerName).toBe("nginx");
    const neu = new KQSim(JSON.parse(JSON.stringify(snap)) as Scenario);
    expect(lauf("kubectl describe deployment web", neu).out).toContain("   nginx:\n");
  });
  test("containerNameOf fällt bei kaputtem Feld auf den Deployment-Namen zurück", () => {
    expect(containerNameOf({ name: "web", containerName: 42 })).toBe("web");
    expect(containerNameOf({ name: "web", containerName: "" })).toBe("web");
    expect(containerNameOf({ name: "web", containerName: "x" })).toBe("x");
  });
});

describe("(b) set image und set env: Ressourcen vor den Paaren", () => {
  const web = () => mit("kubectl create deployment web --image=nginx:1.28");
  test("set image: Paar vor der Ressource ist ein Reihenfolge-Fehler, nichts ändert sich", () => {
    const sim = web();
    const r = lauf("kubectl set image nginx=nginx:9 deployment/web", sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain("error: all resources must be specified before image changes: deployment/web");
    expect(sim.deployments[0].image).toBe("nginx:1.28");
  });
  test("set env: alle Positionsargumente stehen im Fehler", () => {
    const r = lauf("kubectl set env FOO=bar deployment/web", web());
    expect(r.error).toBe(true);
    expect(r.out).toContain("error: all resources must be specified before environment changes: FOO=bar deployment/web");
  });
  test("set env: KEY- zählt als Env-Argument, ein einzelnes '-' ebenfalls", () => {
    expect(lauf("kubectl set env FOO- deployment/web", web()).out).toContain("environment changes: FOO- deployment/web");
  });
  test("set env: Paar hinter der Ressource bleibt 'nicht simuliert'", () => {
    const r = lauf("kubectl set env deployment/web FOO=bar", web());
    expect(r.out).toContain("Nicht simuliert");
    expect(r.out).not.toContain("all resources must");
  });
  test("set image: '=' am Anfang ist kein Paar (bleibt Ressourcen-Token)", () => {
    const r = lauf("kubectl set image deployment/web =x web=nginx:2", web());
    expect(r.out).not.toContain("all resources must be specified before");
  });
  test("set image: ohne Paar und ohne Ressource die Validate-Texte von kubectl", () => {
    const sim = web();
    expect(lauf("kubectl set image deployment/web", sim).out).toContain("error: at least one image update is required");
    expect(lauf("kubectl set image nginx=nginx:2", sim).out).toContain("error: one or more resources must be specified as <resource> <name> or <resource>/<name>");
    expect(lauf("kubectl set image", sim).out).toContain("error: [one or more resources must be specified as <resource> <name> or <resource>/<name>, at least one image update is required]");
  });
  test("set image: Paar ohne '=' (foo-) ist 'invalid image format'", () => {
    const r = lauf("kubectl set image deployment/web foo-", web());
    expect(r.out).toContain("error: invalid image format: foo-");
  });
  test("set image: '*' mit weiteren Paaren ist ein Fehler", () => {
    const r = lauf("kubectl set image deployment/web *=a a=b", web());
    expect(r.out).toContain("all containers are already specified by *, but saw more than one container_name=container_image pairs");
  });
});

describe("(a) set image prüft den Container-Namen", () => {
  const web = () => mit("kubectl create deployment web --image=nginx:1.28");
  test("Deployment-Name als Container bei einem per create angelegten Deployment: Fehler, nichts ändert sich", () => {
    const sim = web();
    const rev = sim.deployments[0].replicaSet?.revision;
    const pods = sim.deployments[0].pods.map(p => p.name);
    const r = lauf("kubectl set image deployment/web web=nginx:9", sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain('error: unable to find container named "web"');
    expect(sim.deployments[0].image).toBe("nginx:1.28");
    expect(sim.deployments[0].replicaSet?.revision).toBe(rev);
    expect(sim.deployments[0].pods.map(p => p.name)).toEqual(pods);
  });
  test("der echte Container-Name wirkt, ebenso '*'", () => {
    const sim = web();
    expect(lauf("kubectl set image deployment/web nginx=nginx:2", sim).out).toBe("deployment.apps/web image updated");
    expect(sim.deployments[0].image).toBe("nginx:2");
    expect(lauf("kubectl set image deployment/web *=nginx:3", sim).error).toBe(false);
    expect(sim.deployments[0].image).toBe("nginx:3");
  });
  test("Szenario-Deployment: der Deployment-Name ist der Container-Name", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1 }] });
    expect(lauf("kubectl set image deployment/kasse nginx=x", sim).out).toContain('unable to find container named "nginx"');
    expect(lauf("kubectl set image deployment/kasse kasse=x", sim).out).toBe("deployment.apps/kasse image updated");
  });
  test("initContainer 'vorbereiter' ist nicht simuliert", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1, initContainer: { fillsMi: 10 } }] });
    const r = lauf("kubectl set image deployment/kasse vorbereiter=x", sim);
    expect(r.out).toContain("Nicht simuliert");
    expect(sim.deployments[0].image).toBe("nginx");
  });
  test("unbekanntes Deployment bleibt NotFound vor der Container-Prüfung", () => {
    const r = lauf("kubectl set image deployment/gibtsnicht x=y", web());
    expect(r.out).toContain('deployments.apps "gibtsnicht" not found');
    expect(r.out).not.toContain("unable to find container");
  });
  test("nach set image und rollout undo trägt das alte ReplicaSet den Container-Namen weiter", () => {
    const sim = web();
    sim.exec("kubectl set image deployment/web nginx=nginx:2");
    expect(lauf("kubectl rollout undo deployment/web", sim).error).toBe(false);
    expect(lauf("kubectl set image deployment/web nginx=nginx:3", sim).out).toBe("deployment.apps/web image updated");
    expect(lauf("kubectl get rs -o wide", sim).out).toMatch(/nginx\s+nginx:/);
  });
});

describe("(c) create role und auth can-i lösen Kurznamen über die Registry auf", () => {
  const SA = "system:serviceaccount:default:bot";
  const rolle = (sim: KQSim) => sim.roles.find(r => r.name === "r")!.rules[0].resources;
  test("create role speichert die Plurale; Gruppen-Form und Doppelte bleiben erhalten", () => {
    const sim = freshSim();
    expect(lauf("kubectl create role r --verb=get --resource=po,deploy,svc,deployments.apps", sim).out).toBe("role.rbac.authorization.k8s.io/r created");
    expect(rolle(sim)).toEqual(["pods", "deployments", "services", "deployments"]);
  });
  test("'*' bleibt, eine Subressource löst nur den Teil vor dem '/' auf", () => {
    const sim = freshSim();
    lauf("kubectl create role r --verb=get --resource=*,po/log", sim);
    expect(rolle(sim)).toEqual(["*", "pods/log"]);
  });
  test("unbekannte Ressource: no matches, die Rolle entsteht nicht", () => {
    const sim = freshSim();
    const r = lauf("kubectl create role r --verb=get --resource=foo", sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain("error: no matches for /, Resource=foo");
    expect(sim.roles).toHaveLength(0);
    expect(lauf("kubectl create role r --verb=get --resource=foo.bar", sim).out).toContain("error: no matches for bar/, Resource=foo");
    expect(lauf("kubectl create role r --verb=get --resource=deployments.falsch", sim).out).toContain("no matches for falsch/, Resource=deployments");
  });
  const mitBinding = (): KQSim => mit(
    "kubectl create role r --verb=get --resource=po,deploy",
    "kubectl create rolebinding rb --role=r --serviceaccount=default:bot",
  );
  test("can-i löst den Kurznamen auf", () => {
    const sim = mitBinding();
    expect(lauf("kubectl auth can-i get po --as=" + SA, sim).out).toBe("yes");
    expect(lauf("kubectl auth can-i get pods --as=" + SA, sim).out).toBe("yes");
    expect(lauf("kubectl auth can-i get deployments.apps --as=" + SA, sim).out).toBe("yes");
    expect(lauf("kubectl auth can-i get svc --as=" + SA, sim).out).toBe("no");
  });
  test("unbekannte Ressource: Warnzeile, dann Auswertung mit dem Rohwert", () => {
    const sim = mitBinding();
    expect(lauf("kubectl auth can-i get foo --as=" + SA, sim).out).toBe("Warning: the server doesn't have a resource type 'foo'\nno");
    expect(lauf("kubectl auth can-i get foo.bar --as=" + SA, sim).out).toBe("Warning: the server doesn't have a resource type 'foo' in group 'bar'\nno");
  });
  test("users, groups und '*' warnen nicht", () => {
    const sim = mitBinding();
    for (const r of ["users", "groups", "*"]) expect(lauf("kubectl auth can-i get " + r + " --as=" + SA, sim).out).not.toContain("Warning");
  });
  test("Altstand: eine Rolle mit gespeichertem Kurznamen 'po' erlaubt can-i get pods und get po", () => {
    const sim = mitBinding();
    sim.roles[0].rules[0].resources = ["po"];
    expect(lauf("kubectl auth can-i get pods --as=" + SA, sim).out).toBe("yes");
    expect(lauf("kubectl auth can-i get po --as=" + SA, sim).out).toBe("yes");
    expect(lauf("kubectl auth can-i get secrets --as=" + SA, sim).out).toBe("no");
  });
});
