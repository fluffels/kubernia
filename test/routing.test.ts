/* Routing-Lotse-Minispiel (#569): Domänen-Tests für den Match-/Routing-Kern. */
import { test, expect, describe } from "vitest";
import {
  ROUTING_ROUNDS,
  podMatchesSelector,
  matchingPods,
  checkIngressChoice,
  checkPodChoice,
  checkNoEndpoints,
  type RoutingPod,
} from "../src/content/routing";

const pod = (name: string, labels: Record<string, string>): RoutingPod => ({ name, labels });

describe("podMatchesSelector", () => {
  test("passt, wenn der Pod jedes Selector-Label exakt trägt (Happy Path)", () => {
    expect(podMatchesSelector(pod("p", { app: "kasse" }), { app: "kasse" })).toBe(true);
  });

  test("passt NICHT, wenn ein Selector-Label am Pod fehlt", () => {
    expect(podMatchesSelector(pod("p", { app: "kasse" }), { app: "kasse", tier: "prod" })).toBe(false);
  });

  test("passt NICHT, wenn ein Selector-Label einen anderen Wert hat", () => {
    expect(podMatchesSelector(pod("p", { app: "kasse", tier: "test" }), { app: "kasse", tier: "prod" })).toBe(false);
  });

  test("zusätzliche Pod-Labels, die der Selector gar nicht verlangt, stören nicht", () => {
    expect(podMatchesSelector(pod("p", { app: "kasse", extra: "egal" }), { app: "kasse" })).toBe(true);
  });

  test("Red-Green-Kontrolle: ohne den Wertvergleich (nur Schlüssel prüfen) würde tier=test fälschlich matchen", () => {
    const naiveKeyOnlyMatch = (p: RoutingPod, sel: Record<string, string>) => Object.keys(sel).every((k) => k in p.labels);
    expect(naiveKeyOnlyMatch(pod("p", { app: "kasse", tier: "test" }), { app: "kasse", tier: "prod" })).toBe(true);
    expect(podMatchesSelector(pod("p", { app: "kasse", tier: "test" }), { app: "kasse", tier: "prod" })).toBe(false);
  });
});

describe("matchingPods", () => {
  test("liefert nur die Pods, die ALLE Selector-Paare erfüllen", () => {
    const pods = [pod("a", { app: "kasse" }), pod("b", { app: "lager" }), pod("c", { app: "kasse", tier: "prod" })];
    expect(matchingPods(pods, { app: "kasse" }).map((p) => p.name)).toEqual(["a", "c"]);
  });

  test("liefert eine leere Liste, wenn kein Pod passt (leere Endpoints)", () => {
    const pods = [pod("a", { app: "kasse" }), pod("b", { app: "lager" })];
    expect(matchingPods(pods, { app: "warteschlange" })).toEqual([]);
  });
});

describe("checkIngressChoice", () => {
  test("korrekt, wenn die gewählte Regel den Pfad der Anfrage trifft", () => {
    expect(checkIngressChoice("/shop", "/shop").ok).toBe(true);
  });

  test("falsch, wenn die gewählte Regel einen anderen Pfad hat, plus erklärender Grund", () => {
    const result = checkIngressChoice("/shop", "/wiki");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/\/wiki/);
    expect(result.reason).toMatch(/\/shop/);
  });
});

describe("checkPodChoice", () => {
  const pods = [pod("kasse-1", { app: "kasse" }), pod("lager-1", { app: "lager" })];

  test("korrekt, wenn der gewählte Pod den Selector erfüllt", () => {
    expect(checkPodChoice(pods, { app: "kasse" }, "kasse-1").ok).toBe(true);
  });

  test("falsch, wenn der gewählte Pod NICHT zum Selector passt, mit Begründung des abweichenden Labels", () => {
    const result = checkPodChoice(pods, { app: "kasse" }, "lager-1");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/lager-1/);
  });

  test("ein unbekannter Pod-Name scheitert (kann bei validem Content nicht vorkommen, muss aber sicher behandelt werden)", () => {
    expect(checkPodChoice(pods, { app: "kasse" }, "geist-1").ok).toBe(false);
  });
});

describe("checkNoEndpoints", () => {
  const pods = [pod("kasse-1", { app: "kasse" }), pod("lager-1", { app: "lager" })];

  test("korrekt, wenn wirklich kein Pod zum Selector passt", () => {
    expect(checkNoEndpoints(pods, { app: "warteschlange" }).ok).toBe(true);
  });

  test("falsch, wenn tatsächlich ein Pod passen würde (nicht vorschnell 'keine Endpoints' klicken)", () => {
    expect(checkNoEndpoints(pods, { app: "kasse" }).ok).toBe(false);
  });
});

describe("ROUTING_ROUNDS (Content)", () => {
  test("mindestens 4 Runden mit Services, Pods und mindestens 2 Anfragen", () => {
    expect(ROUTING_ROUNDS.length).toBeGreaterThanOrEqual(4);
    for (const r of ROUTING_ROUNDS) {
      expect(r.services.length).toBeGreaterThanOrEqual(1);
      expect(r.pods.length).toBeGreaterThanOrEqual(2);
      expect(r.requests.length).toBeGreaterThanOrEqual(2);
      expect(r.tip.trim().length).toBeGreaterThan(0);
    }
  });

  test("erste Runde hat noch KEINE Ingress-Ebene (aufsteigend: erst nur Service→Pod)", () => {
    expect(ROUTING_ROUNDS[0].ingressRules.length).toBe(0);
  });

  test("mindestens eine spätere Runde führt Ingress-Regeln ein", () => {
    expect(ROUTING_ROUNDS.some((r) => r.ingressRules.length > 0)).toBe(true);
  });

  test("mindestens eine Runde lehrt den 'leere Endpoints'-Fall (Anfrage ohne passenden Pod)", () => {
    const hatLeereEndpoints = ROUTING_ROUNDS.some((r) =>
      r.requests.some((req) => {
        const svcName = req.service ?? r.ingressRules.find((ir) => ir.path === req.path)?.service;
        const svc = r.services.find((s) => s.name === svcName);
        return svc && matchingPods(r.pods, svc.selector).length === 0;
      }),
    );
    expect(hatLeereEndpoints).toBe(true);
  });

  test("jede Anfrage referenziert entweder einen direkten Service ODER einen Pfad mit passender Ingress-Regel", () => {
    for (const r of ROUTING_ROUNDS) {
      for (const req of r.requests) {
        if (r.ingressRules.length > 0) {
          expect(req.path, `Runde „${r.name}“: Anfrage „${req.label}“ braucht einen Pfad (Ingress-Runde)`).toBeDefined();
          const rule = r.ingressRules.find((ir) => ir.path === req.path);
          expect(rule, `Runde „${r.name}“: kein Ingress-Rule für Pfad „${req.path}“`).toBeDefined();
          expect(r.services.some((s) => s.name === rule!.service)).toBe(true);
        } else {
          expect(req.service, `Runde „${r.name}“: Anfrage „${req.label}“ braucht einen direkten Service (keine Ingress-Runde)`).toBeDefined();
          expect(r.services.some((s) => s.name === req.service)).toBe(true);
        }
      }
    }
  });

  test("jede Anfrage hat höchstens EINEN passenden Pod (eindeutige richtige Antwort, kein Rätsel mit mehreren Lösungen)", () => {
    for (const r of ROUTING_ROUNDS) {
      for (const req of r.requests) {
        const svcName = req.service ?? r.ingressRules.find((ir) => ir.path === req.path)!.service;
        const svc = r.services.find((s) => s.name === svcName)!;
        expect(matchingPods(r.pods, svc.selector).length).toBeLessThanOrEqual(1);
      }
    }
  });
});
