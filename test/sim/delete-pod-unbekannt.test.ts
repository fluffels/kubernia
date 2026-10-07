/* `kubectl delete pod` mit unbekannter Workload-Art (#1426): assertNever wirft, das exec-Fehlernetz
 * fängt es; es darf nie „deleted“ gemeldet oder ein Objekt statt eines Strings geliefert werden. */
import { describe, test, expect, vi } from "vitest";
import { KQSim } from "./helpers";

vi.mock("../../src/sim/pods", async (orig) => {
  const real = await orig<typeof import("../../src/sim/pods")>();
  return { ...real, findClusterPod: () => ({ owner: "DaemonSet", pod: { name: "x", created: 0, restarts: 0 } }) };
});

describe("kubectl delete pod: unbekannte Workload-Art", () => {
  test("Fehlerausgabe statt „deleted“", () => {
    const sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
    const r = sim.exec("kubectl delete pod x");
    expect(typeof r.output).toBe("string");
    expect(r.output).not.toContain("deleted");
    expect(r.output).toMatch(/kubectl delete pod: unbehandelte Variante/);
  });
});
