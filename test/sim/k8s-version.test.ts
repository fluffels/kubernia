/* Versionsabhängiges Serververhalten der simulierten Kubernetes-Version (#1496): was sich zwischen v1.30 und v1.37
 * an der Ausgabe von `kubectl get` geändert hat. Die Warnung für v1 Endpoints steht in kubectl-ausgabe.test.ts (d),
 * die Knoten-Version in nodes.test.ts. Alles über `sim.exec`, mit Gegenfällen. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { resolveKind, serverWarnings, type ResourceKind } from "../../src/sim/kubectl/resources";
import type { StorageClassRes } from "../../src/sim/state";

const kopf = (out: string) => out.split("\n")[0].trim().split(/\s{2,}/);
const sc = (name: string, isDefault: boolean, created: number): StorageClassRes => ({ name, provisioner: "x", reclaimPolicy: "Delete", isDefault, created });
/** Namen mit „(default)“-Markierung in `get sc`. */
const markiert = (sim: KQSim) => (sim.exec("kubectl get sc").output ?? "").split("\n").slice(1).filter(l => l.includes("(default)")).map(l => l.split(/\s+/)[0]);

describe("get serviceaccounts: SECRETS-Spalte entfällt ab v1.35 (#117160)", () => {
  test("nur NAME und AGE", () => {
    const out = new KQSim({}).exec("kubectl get sa").output ?? "";
    expect(kopf(out)).toEqual(["NAME", "AGE"]);
    expect(out).toMatch(/^default\s+\S+$/m);
  });
  test("mehrere ServiceAccounts: je eine Zeile ohne Secret-Zählung", () => {
    const sim = new KQSim({});
    sim.exec("kubectl create serviceaccount deploy-bot");
    const zeilen = (sim.exec("kubectl get sa").output ?? "").split("\n").slice(1);
    expect(zeilen.map(l => l.trim().split(/\s+/).length)).toEqual(zeilen.map(() => 2));
    expect(zeilen.some(l => l.startsWith("deploy-bot"))).toBe(true);
  });
});

describe("get storageclasses: „(default)“ nur an der effektiven Default-Klasse (v1.37, #135964)", () => {
  test("zwei Defaults: nur die zuletzt angelegte ist markiert", () => {
    const sim = new KQSim({});
    sim.storageClasses.length = 0;
    sim.storageClasses.push(sc("alt", true, 100), sc("neu", true, 200), sc("andere", false, 300));
    expect(markiert(sim)).toEqual(["neu"]);
  });
  test("gleicher Zeitstempel: der kleinere Name gewinnt, unabhängig von der Reihenfolge", () => {
    const sim = new KQSim({});
    sim.storageClasses.length = 0;
    sim.storageClasses.push(sc("zebra", true, 100), sc("alpha", true, 100));
    expect(markiert(sim)).toEqual(["alpha"]);
  });
  test("ein einzelner Default bleibt markiert, eine Nicht-Default-Klasse nie", () => {
    const sim = new KQSim({});
    sim.storageClasses.length = 0;
    sim.storageClasses.push(sc("eins", true, 100), sc("zwei", false, 900));
    expect(markiert(sim)).toEqual(["eins"]);
  });
  test("ein PVC ohne storageClassName bindet an genau die Klasse, die get sc als Default zeigt", () => {
    const sim = new KQSim({});
    sim.storageClasses.length = 0;
    sim.storageClasses.push(sc("alt", true, 100), sc("neu", true, 200));
    sim.mergeScenario({ pvcs: [{ name: "daten" }] });
    expect(markiert(sim)).toEqual(["neu"]);
    expect(sim.pvcs.find(p => p.name === "daten")?.storageClass).toBe("neu");
  });
  test("kein Default: keine Markierung", () => {
    const sim = new KQSim({});
    sim.storageClasses.length = 0;
    sim.storageClasses.push(sc("eins", false, 100));
    expect(markiert(sim)).toEqual([]);
  });
});

describe("serverWarnings (Registry)", () => {
  const art = (t: string) => resolveKind(t) as ResourceKind;
  test("nur Arten mit deprecationWarning liefern eine Zeile, jede Zeile nur einmal", () => {
    expect(serverWarnings([art("pods"), art("svc")])).toEqual([]);
    expect(serverWarnings([art("ep")])).toEqual(["Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice"]);
    expect(serverWarnings([art("ep"), art("pods"), art("endpoints")])).toHaveLength(1);
  });
});
