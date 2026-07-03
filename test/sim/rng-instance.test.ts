/* Instanz-seedbarer Zufall des Simulators (#580).
 *
 * Vor #580 zog `randSuffix` (Pod-Namen-Suffixe, Container-/PVC-/Token-IDs) aus dem
 * EINEN globalen RNG-Strom (`nextRandom`). Zwei `Sim`-Instanzen teilten damit denselben
 * Strom: die Namen einer Instanz hingen an der Ausführungsreihenfolge (was sonst noch aus
 * dem Strom gezogen hatte) statt nur an der Instanz selbst. Determinismus war nur „pro
 * Prozess-Reihenfolge" gegeben – Tests mussten global seeden, und bei Stardew-Scope (mehrere
 * Cluster/Welten gleichzeitig) hätte eine Instanz die Namen der anderen verschoben.
 *
 * #580 gibt jeder `Sim` ihren EIGENEN, in `reset()` frisch geseedeten Strom (`sim.rng`).
 * Diese Tests sichern die Instanz-Isolation und die Reproduzierbarkeit ab – sie wären vor
 * dem Fix rot (zwei Instanzen lieferten verschiedene Namen). */
import { describe, test, expect } from "vitest";
import { Sim } from "../../src/sim";
import { makeRng, seedGlobalRng, nextRandom } from "../../src/core/rng";
import { randSuffix } from "../../src/sim/util";

const SC = { deployments: [{ name: "web", image: "nginx:1", replicas: 3 }] };
const podNames = (s: Sim) => s.deployments[0].pods.map(p => p.name);

describe("makeRng – frischer, unabhängiger Strom (#580)", () => {
  test("gleicher Seed → identische Folge, unabhängig vom globalen Strom", () => {
    const a = makeRng(0xABCDEF);
    // globalen Strom dazwischen bewegen – darf den Instanz-Strom NICHT beeinflussen
    nextRandom(); nextRandom();
    const b = makeRng(0xABCDEF);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  test("randSuffix(len, rng) ist über den gegebenen Strom reproduzierbar & vom globalen isoliert", () => {
    const s1 = randSuffix(10, makeRng(42));
    nextRandom(); nextRandom(); nextRandom(); // globalen Strom verschieben
    const s2 = randSuffix(10, makeRng(42));
    expect(s2).toBe(s1);
    expect(s1).toHaveLength(10);
    expect(s1).toMatch(/^[a-z0-9]+$/);
  });
});

describe("Sim – pro-Instanz-Seed (#580)", () => {
  test("zwei Instanzen mit gleichem Szenario liefern IDENTISCHE Pod-Namen (Reihenfolge-unabhängig)", () => {
    const a = new Sim(SC);
    // Zwischen den Konstruktionen den globalen Strom kräftig bewegen: vor #580 hätte
    // das die Namen von `b` verschoben (geteilter Strom), jetzt nicht mehr.
    for (let i = 0; i < 50; i++) nextRandom();
    const b = new Sim(SC);
    expect(podNames(b)).toEqual(podNames(a));
    expect(podNames(a)).toHaveLength(3);
  });

  test("Pod-Namen sind unabhängig vom vorher gesetzten globalen Seed", () => {
    seedGlobalRng(1);
    const a = new Sim(SC);
    seedGlobalRng(999999);
    const b = new Sim(SC);
    expect(podNames(b)).toEqual(podNames(a));
  });

  test("reset() seedet den Instanz-Strom neu → reproduzierbare Namen nach Zustandsänderung", () => {
    const s = new Sim(SC);
    const before = podNames(s);
    // Befehle ausführen, die den Instanz-Strom weiterdrehen (Rollout zieht neue Pod-Namen)
    s.exec("kubectl rollout restart deployment/web");
    expect(podNames(s)).not.toEqual(before); // Strom hat sich bewegt
    s.reset();
    expect(podNames(s)).toEqual(before); // reset re-seedet → Ausgangsnamen zurück
  });

  test("expliziter Seed erlaubt zwei UNTERSCHIEDLiche, je reproduzierbare Instanzen", () => {
    const x1 = new Sim(SC, 111);
    const x2 = new Sim(SC, 111);
    const y = new Sim(SC, 222);
    expect(podNames(x2)).toEqual(podNames(x1)); // gleicher Seed → gleich
    expect(podNames(y)).not.toEqual(podNames(x1)); // anderer Seed → anders
  });
});
