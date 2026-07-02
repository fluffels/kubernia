import { describe, it, expect } from "vitest";
import {
  HAZARD_UNLOCK,
  hazardStartable,
  stormVictims,
  pirateVictims,
  resolveHazardTick,
  type ActiveHazards,
  type HazardClusterView,
} from "../src/world/hazards";

// Reiner Entscheidungskern der Zufalls-Gefahren (#512). Vorher steckten die
// spielentscheidenden Bedingungen (Belohnung/Strafe, Deadline, „besiegt wann")
// untrennbar zwischen Phaser/UI/Game und waren nur über den e2e-Smoke erreichbar
// (der NPC-Nähe-Flows bewusst ausspart). Hier sichern wir genau die Logik ab –
// inkl. Negativ-/Grenzfällen. Die Phaser-/UI-Effekt-Ausführung in
// scenes/worldscene/events.ts bleibt Präsentation (browser-verifiziert).

const KEINE: ActiveHazards = { pirate: null, kraken: null, storm: null };
const LEER: HazardClusterView = { deployments: [], secretCount: 0 };

describe("hazardStartable — Start-Gate (#512)", () => {
  const gate = (over: Partial<{ enabled: boolean; anyActive: boolean; completedQuests: string[] }> = {}) => ({
    enabled: true,
    anyActive: false,
    completedQuests: [HAZARD_UNLOCK.storm, HAZARD_UNLOCK.pirate, HAZARD_UNLOCK.kraken],
    ...over,
  });

  it("startet nur, wenn freigeschaltet, aktiv und keine andere Gefahr läuft", () => {
    expect(hazardStartable("storm", gate())).toBe(true);
    expect(hazardStartable("pirate", gate())).toBe(true);
    expect(hazardStartable("kraken", gate())).toBe(true);
  });

  it("bleibt gesperrt, solange die freischaltende Quest fehlt", () => {
    // Gegenprobe: exakt die eine Quest der Gefahr fehlt → kein Start.
    expect(hazardStartable("storm", gate({ completedQuests: [HAZARD_UNLOCK.pirate, HAZARD_UNLOCK.kraken] }))).toBe(false);
    expect(hazardStartable("pirate", gate({ completedQuests: [HAZARD_UNLOCK.storm] }))).toBe(false);
    expect(hazardStartable("kraken", gate({ completedQuests: [] }))).toBe(false);
  });

  it("startet nie bei ausgeschaltetem System oder schon laufender Gefahr", () => {
    expect(hazardStartable("storm", gate({ enabled: false }))).toBe(false);
    expect(hazardStartable("storm", gate({ anyActive: true }))).toBe(false);
  });

  it("jede Gefahr hat eine eigene, distinkte Freischalt-Quest", () => {
    const ids = Object.values(HAZARD_UNLOCK);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Opfer-Eignung (#512)", () => {
  it("Sturm trifft nur (noch) nicht kaputte Deployments", () => {
    const deps = [
      { name: "a", replicas: 3, broken: null },
      { name: "b", replicas: 1, broken: { type: "imagepull" } },
      { name: "c", replicas: 2, broken: null },
    ];
    expect(stormVictims(deps).map(d => d.name)).toEqual(["a", "c"]);
  });

  it("Piraten überfallen nur Deployments mit >= 2 Repliken", () => {
    const deps = [
      { name: "a", replicas: 1 },
      { name: "b", replicas: 2 },
      { name: "c", replicas: 5 },
    ];
    expect(pirateVictims(deps).map(d => d.name)).toEqual(["b", "c"]);
  });

  it("keine geeigneten Opfer → leere Liste (kein Start möglich)", () => {
    expect(stormVictims([{ name: "x", broken: { type: "crashloop" } }])).toEqual([]);
    expect(pirateVictims([{ name: "x", replicas: 1 }])).toEqual([]);
  });
});

describe("resolveHazardTick — Sturm (#512)", () => {
  const active = (until: number): ActiveHazards => ({ ...KEINE, storm: { dep: "web", until } });

  it("behoben, sobald das Deployment repariert (broken=null) ist", () => {
    const view: HazardClusterView = { deployments: [{ name: "web", replicas: 2, broken: null }], secretCount: 0 };
    expect(resolveHazardTick(active(999), view, 10)).toEqual([{ kind: "storm", type: "resolve", success: true }]);
  });

  it("behoben, wenn das Deployment ganz verschwunden ist", () => {
    expect(resolveHazardTick(active(999), LEER, 10)).toEqual([{ kind: "storm", type: "resolve", success: true }]);
  });

  it("Misserfolg, wenn die Deadline abläuft, während es kaputt bleibt", () => {
    const view: HazardClusterView = { deployments: [{ name: "web", replicas: 2, broken: { type: "imagepull" } }], secretCount: 0 };
    expect(resolveHazardTick(active(5), view, 10)).toEqual([{ kind: "storm", type: "resolve", success: false }]);
  });

  it("tickt nur den Countdown, solange kaputt und Deadline nicht erreicht", () => {
    const view: HazardClusterView = { deployments: [{ name: "web", replicas: 2, broken: { type: "imagepull" } }], secretCount: 0 };
    // until=20, now=10.4 → aufgerundet 10 s Restzeit.
    expect(resolveHazardTick(active(20), view, 10.4)).toEqual([{ kind: "storm", type: "tick", secondsLeft: 10 }]);
  });
});

describe("resolveHazardTick — Piraten (#512)", () => {
  const active = (until: number): ActiveHazards => ({ ...KEINE, pirate: { dep: "web", want: 4, until } });

  it("besiegt, sobald die Repliken wieder auf `want` sind", () => {
    const view: HazardClusterView = { deployments: [{ name: "web", replicas: 4, broken: null }], secretCount: 0 };
    expect(resolveHazardTick(active(999), view, 10)).toEqual([{ kind: "pirate", type: "resolve", success: true }]);
  });

  it("besiegt auch bei Über-Skalierung (>= want)", () => {
    const view: HazardClusterView = { deployments: [{ name: "web", replicas: 6, broken: null }], secretCount: 0 };
    expect(resolveHazardTick(active(999), view, 10)).toEqual([{ kind: "pirate", type: "resolve", success: true }]);
  });

  it("Misserfolg bei abgelaufener Deadline, solange zu wenige Repliken", () => {
    const view: HazardClusterView = { deployments: [{ name: "web", replicas: 2, broken: null }], secretCount: 0 };
    expect(resolveHazardTick(active(5), view, 10)).toEqual([{ kind: "pirate", type: "resolve", success: false }]);
  });

  it("ein verschwundenes Deployment zählt NICHT als Sieg (nur Deadline entscheidet)", () => {
    // Anders als beim Sturm: fehlt das Deployment, kann `want` nie erreicht
    // werden → es läuft auf die Deadline zu, kein Erfolg.
    expect(resolveHazardTick(active(20), LEER, 10)).toEqual([{ kind: "pirate", type: "tick", secondsLeft: 10 }]);
  });
});

describe("resolveHazardTick — Krake (#512)", () => {
  const active = (until: number): ActiveHazards => ({ ...KEINE, kraken: { baseline: 2, until } });

  it("vertrieben, sobald ein neues Secret existiert (secrets > baseline)", () => {
    expect(resolveHazardTick(active(999), { deployments: [], secretCount: 3 }, 10))
      .toEqual([{ kind: "kraken", type: "resolve", success: true }]);
  });

  it("gleich viele Secrets wie baseline zählt NICHT (Grenzfall)", () => {
    // Red-Green-Falle: > baseline, nicht >=. Genau baseline darf nicht gewinnen.
    expect(resolveHazardTick(active(20), { deployments: [], secretCount: 2 }, 10))
      .toEqual([{ kind: "kraken", type: "tick", secondsLeft: 10 }]);
  });

  it("Misserfolg (Dublonen-Klau in der Präsentation), wenn die Deadline abläuft", () => {
    expect(resolveHazardTick(active(5), { deployments: [], secretCount: 2 }, 10))
      .toEqual([{ kind: "kraken", type: "resolve", success: false }]);
  });
});

describe("resolveHazardTick — allgemein (#512)", () => {
  it("ohne aktive Gefahr passiert nichts", () => {
    expect(resolveHazardTick(KEINE, LEER, 10)).toEqual([]);
  });

  it("Erfolg schlägt Deadline: repariert UND abgelaufen → trotzdem Erfolg", () => {
    // Reihenfolge der Prüfung: erst Erfolg, dann Deadline. Wer in derselben
    // Sekunde repariert, in der die Zeit ausläuft, gewinnt.
    const view: HazardClusterView = { deployments: [{ name: "web", replicas: 2, broken: null }], secretCount: 0 };
    const active: ActiveHazards = { ...KEINE, storm: { dep: "web", until: 5 } };
    expect(resolveHazardTick(active, view, 10)).toEqual([{ kind: "storm", type: "resolve", success: true }]);
  });
});
