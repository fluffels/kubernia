/* Sim-Tests (#1334): `kubectl describe pod` zeigt gesetzte Limits (cpu, ephemeral-storage, memory)
 * in EINEM `Limits:`-Block und den securityContext – und erfindet nichts, wenn nichts gesetzt ist. */
import { test, beforeEach, expect } from "vitest";
import { KQSim, freshSim } from "./helpers";
import type { Scenario } from "../../src/sim/state";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

type Dep = NonNullable<Scenario["deployments"]>[number];
const describePod = (d: Partial<Dep>) => {
  sim.mergeScenario({ deployments: [{ name: "web", image: "nginx", replicas: 1, ...d }] });
  return sim.exec("kubectl describe pod " + sim.deployments.find(x => x.name === "web")!.pods[0].name).output!;
};
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test("cpu-Limit wird angezeigt", () => {
  expect(describePod({ cpuLimitMilli: 250 })).toMatch(/cpu:\s+250m/);
});

test("memory-Limit erscheint auch bei einem gesunden Pod", () => {
  expect(describePod({ memLimit: 128 })).toMatch(/memory:\s+128Mi/);
});

test("securityContext: nur gesetzte Schlüssel", () => {
  const out = describePod({ securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false } });
  expect(out).toContain("Security Context:");
  expect(out).toMatch(/runAsNonRoot:\s+true/);
  expect(out).toMatch(/allowPrivilegeEscalation:\s+false/);
  expect(out).not.toMatch(/privileged:/);
  expect(out).not.toMatch(/readOnlyRootFilesystem:/);
});

test("OOM plus ephemeral-Limit: genau EIN Limits-Block, beide Werte darin", () => {
  const out = describePod({ broken: { type: "oomkilled", memNeeded: 256 }, ephemeralLimit: 512 });
  expect(count(out, /^\s*Limits:/gm)).toBe(1);
  expect(out).toMatch(/ephemeral-storage:\s+512Mi/);
  expect(out).toMatch(/memory:\s+64Mi/);
});

test("OOM mit explizitem memLimit zeigt diesen Wert", () => {
  expect(describePod({ broken: { type: "oomkilled", memNeeded: 256 }, memLimit: 100 })).toMatch(/memory:\s+100Mi/);
});

test("nackter Pod: keine erfundenen Limits oder Security-Angaben", () => {
  const out = describePod({});
  expect(out).not.toMatch(/Limits:/);
  expect(out).not.toMatch(/cpu:/);
  expect(out).not.toMatch(/memory:/);
  expect(out).not.toMatch(/Security Context:/);
});

test("leerer securityContext {} erzeugt keine Kopfzeile", () => {
  expect(describePod({ securityContext: {} })).not.toMatch(/Security Context:/);
});
