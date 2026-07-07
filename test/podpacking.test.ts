/* Pod-Packspiel (#567): Domänen-Tests für den Platzier-/Kapazitäts-Kern. */
import { test, expect, describe } from "vitest";
import {
  POD_PACKING_ROUNDS,
  nodeUsage,
  remainingCapacity,
  canPlacePod,
  podFitsAnyNode,
  type PackingNode,
  type PackingPod,
  type PackingPlacement,
} from "../src/content/podpacking";

const node = (cpu: number, memory: number, name = "n1"): PackingNode => ({ name, cpu, memory });
const pod = (cpu: number, memory: number, name = "p1"): PackingPod => ({ name, cpu, memory });

describe("nodeUsage / remainingCapacity", () => {
  test("ein Node ohne Platzierungen ist voll frei", () => {
    expect(nodeUsage("n1", [], [])).toEqual({ cpu: 0, memory: 0 });
    expect(remainingCapacity(node(1000, 1024), [], [])).toEqual({ cpu: 1000, memory: 1024 });
  });

  test("mehrere platzierte Pods auf demselben Node summieren sich", () => {
    const pods = [pod(200, 256, "a"), pod(300, 128, "b")];
    const placements: PackingPlacement[] = [{ pod: "a", node: "n1" }, { pod: "b", node: "n1" }];
    expect(nodeUsage("n1", placements, pods)).toEqual({ cpu: 500, memory: 384 });
  });

  test("Pods auf einem ANDEREN Node zählen nicht mit", () => {
    const pods = [pod(200, 256, "a")];
    const placements: PackingPlacement[] = [{ pod: "a", node: "n2" }];
    expect(nodeUsage("n1", placements, pods)).toEqual({ cpu: 0, memory: 0 });
  });
});

describe("canPlacePod", () => {
  test("passt, wenn beide Dimensionen unter der Kapazität bleiben (Happy Path)", () => {
    expect(canPlacePod(pod(200, 256), node(1000, 1024), [], [])).toBe(true);
  });

  test("passt NICHT, wenn nur die CPU knapp ist, obwohl Speicher reicht", () => {
    expect(canPlacePod(pod(900, 100), node(500, 1024), [], [])).toBe(false);
  });

  test("passt NICHT, wenn nur der Speicher knapp ist, obwohl CPU reicht", () => {
    expect(canPlacePod(pod(100, 900), node(500, 512), [], [])).toBe(false);
  });

  test("berücksichtigt schon platzierte Pods (Node wird durch Vorbelegung eng)", () => {
    const pods = [pod(400, 400, "erster"), pod(200, 200, "zweiter")];
    const placements: PackingPlacement[] = [{ pod: "erster", node: "n1" }];
    // n1 hat 500/500 Kapazität, "erster" belegt schon 400/400 -> nur noch 100/100 frei.
    expect(canPlacePod(pods[1], node(500, 500), placements, pods)).toBe(false);
  });

  test("Grenzfall: passt exakt (== Kapazität ist erlaubt, nicht nur <)", () => {
    expect(canPlacePod(pod(500, 500), node(500, 500), [], [])).toBe(true);
  });
});

describe("podFitsAnyNode", () => {
  test("ein zu großer Pod passt auf KEINEN Node der Runde (Pending ist korrekt)", () => {
    const nodes = [node(500, 512, "n1"), node(500, 512, "n2")];
    expect(podFitsAnyNode(pod(900, 1200), nodes)).toBe(false);
  });

  test("ein Pod, der auf mindestens einen leeren Node passt, ist NICHT pending-würdig", () => {
    const nodes = [node(500, 512, "n1"), node(200, 200, "n2")];
    // passt nicht auf n2, aber auf n1 -> insgesamt schedulierbar, Pending wäre falsch.
    expect(podFitsAnyNode(pod(300, 300), nodes)).toBe(true);
  });

  test("Red-Green-Kontrolle: ohne den Kapazitäts-Vergleich (>=0 immer wahr) würde der Test nicht zwischen fitting/zu groß unterscheiden", () => {
    const nodes = [node(500, 512, "n1")];
    const zuGross = pod(9999, 9999);
    const passtGut = pod(10, 10);
    expect(podFitsAnyNode(zuGross, nodes)).toBe(false);
    expect(podFitsAnyNode(passtGut, nodes)).toBe(true);
  });
});

describe("POD_PACKING_ROUNDS (Content)", () => {
  test("mindestens 4 Runden mit je einem Node und mind. 2 Pods", () => {
    expect(POD_PACKING_ROUNDS.length).toBeGreaterThanOrEqual(4);
    for (const r of POD_PACKING_ROUNDS) {
      expect(r.nodes.length).toBeGreaterThanOrEqual(1);
      expect(r.pods.length).toBeGreaterThanOrEqual(2);
      expect(r.tip.trim().length).toBeGreaterThan(0);
    }
  });

  test("Schwierigkeit steigt: die Gesamt-CPU-Anforderung je Runde ist nie absteigend", () => {
    const totals = POD_PACKING_ROUNDS.map((r) => r.pods.reduce((s, p) => s + p.cpu, 0));
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1]);
    }
  });

  test("erste Runde hat noch KEINEN unmöglichen Pod (Pending kommt erst später dran)", () => {
    const erste = POD_PACKING_ROUNDS[0];
    for (const p of erste.pods) expect(podFitsAnyNode(p, erste.nodes)).toBe(true);
  });

  test("mindestens eine spätere Runde lehrt den Pending-Fall (ein Pod passt auf keinen Node)", () => {
    const hatPendingFall = POD_PACKING_ROUNDS.some((r) => r.pods.some((p) => !podFitsAnyNode(p, r.nodes)));
    expect(hatPendingFall).toBe(true);
  });

  test("jede Runde ist tatsächlich lösbar: es gibt eine gültige Zuordnung ohne Overflow für alle NICHT-pending Pods", () => {
    // Naiver Greedy-Solver reicht als Existenzbeweis: schedulierbare Pods (größte zuerst)
    // auf den ersten Node packen, der noch Platz hat. Schlägt das fehl, ist die Runde
    // als Lernaufgabe kaputt (Spieler könnte NIE gewinnen).
    for (const round of POD_PACKING_ROUNDS) {
      const schedulable = round.pods.filter((p) => podFitsAnyNode(p, round.nodes));
      const sorted = [...schedulable].sort((a, b) => b.cpu + b.memory - (a.cpu + a.memory));
      const placements: PackingPlacement[] = [];
      for (const p of sorted) {
        const target = round.nodes.find((n) => canPlacePod(p, n, placements, round.pods));
        expect(target, `Runde „${round.name}": Pod „${p.name}" findet keinen Platz (Runde nicht lösbar)`).toBeDefined();
        if (target) placements.push({ pod: p.name, node: target.name });
      }
    }
  });
});
