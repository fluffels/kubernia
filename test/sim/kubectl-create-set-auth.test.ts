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
