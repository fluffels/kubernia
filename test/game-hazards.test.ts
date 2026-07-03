/* Tests für den szenen-neutralen Gefahren-Takt (game/hazards.ts, #540).
 *
 * Bis #540 lebten Zeitachse + Zustand der Zufalls-Gefahren in der WorldScene und waren nur
 * über den e2e-Smoke erreichbar. Jetzt tickt Game.hazardTick sie szenen-neutral – also im
 * Node-Test prüfbar: dass eine fällige Gefahr startet, den Cluster mutiert und ein STRUKTUR-
 * Event über den runtime-Sink meldet (die Präsentation, worldscene/events.ts, bleibt separat
 * browser-verifiziert). Bewusst mit Negativfällen: „System aus" und „UI beschäftigt".
 *
 * Der Hazard-Takt schaltet nach dem ersten Tick auf eine deterministische Erst-Terminierung
 * (scheduleHazards(60) → Pirat 60 s / Krake 150 s / Sturm 210 s, KEIN Zufall); wir „pumpen"
 * darum in 0,25-s-Frames vorwärts, bis die erwartete Gefahr fällig ist. */
import { test, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { stubWindowLocalStorage, loadGameStack } from "./support/browser-env";
import { setHazardSink, setUiBusyProbe } from "../src/runtime";
import { HAZARD_UNLOCK, type HazardEvent } from "../src/world/hazards";

let Game: typeof import("../src/game").Game;
let Sim: typeof import("../src/sim").Sim;

let captured: HazardEvent[] = [];

beforeAll(async () => {
  stubWindowLocalStorage();
  ({ Game, Sim } = await loadGameStack());
  setHazardSink(ev => captured.push(ev));
});

afterAll(() => { setHazardSink(null); setUiBusyProbe(null); });

beforeEach(() => {
  Game.reset();
  Game.sim = new Sim({});
  Game.resetHazards();
  setUiBusyProbe(null);
  captured = [];
  // Alle Gefahren freigeschaltet + System an (normal) als bekannte Basis.
  Game.state.completedQuests = [HAZARD_UNLOCK.storm, HAZARD_UNLOCK.pirate, HAZARD_UNLOCK.kraken];
  Game.setEventMode("normal");
});

/** Bis zum ersten Start-Event vorwärts takten (0,25 s je Frame, gedeckelt). */
function pumpUntilStart(cap = 1200): HazardEvent | undefined {
  for (let i = 0; i < cap; i++) {
    Game.hazardTick(250);
    const start = captured.find(e => e.type === "start");
    if (start) return start;
  }
  return undefined;
}

test("frisch: die ersten Frames starten noch nichts (Erst-Terminierung ~60 s)", () => {
  for (let i = 0; i < 10; i++) Game.hazardTick(16);
  expect(captured.some(e => e.type === "start")).toBe(false);
  expect(Game.hazardActive()).toBe(false);
});

test("fällige Gefahr startet, mutiert den Cluster und meldet ein start-Event", () => {
  Game.sim.exec("kubectl create deployment web --image=nginx");
  Game.sim.exec("kubectl scale deployment web --replicas=3"); // create ignoriert --replicas → hoch skalieren
  const start = pumpUntilStart();
  expect(start).toBeDefined();
  expect(Game.hazardActive()).toBe(true);
  // Der Pirat ist die früheste Gefahr (60 s) → er trifft zuerst; er klaut die Hälfte (1 von 3).
  expect(start).toMatchObject({ type: "start", info: { kind: "pirate", dep: "web", want: 3, left: 2 } });
  expect(Game.sim.deployments.find(d => d.name === "web")?.replicas).toBe(2);
  expect(Game.hazardState().pirate).not.toBeNull();
});

test("nur EINE Gefahr gleichzeitig: solange der Pirat läuft, startet keine zweite", () => {
  Game.sim.exec("kubectl create deployment web --image=nginx");
  Game.sim.exec("kubectl scale deployment web --replicas=3");
  pumpUntilStart();
  captured = [];
  for (let i = 0; i < 900; i++) Game.hazardTick(250); // weit über Krake(150)/Sturm(210) hinaus
  expect(captured.some(e => e.type === "start")).toBe(false); // keine zweite gestartet
});

test("Erfolg: repariert (zurückskaliert) → resolve-Event success, Gefahr weg", () => {
  Game.sim.exec("kubectl create deployment web --image=nginx");
  Game.sim.exec("kubectl scale deployment web --replicas=3");
  pumpUntilStart();
  Game.sim.exec("kubectl scale deployment web --replicas=3"); // Kopien wiederhergestellt
  Game.hazardTick(250);
  const resolve = captured.find(e => e.type === "resolve");
  expect(resolve).toMatchObject({ type: "resolve", kind: "pirate", success: true });
  expect(Game.hazardActive()).toBe(false);
});

test("nur der Sturm freigeschaltet → er startet (Cluster-Deployment geht kaputt)", () => {
  Game.state.completedQuests = [HAZARD_UNLOCK.storm]; // Pirat/Krake gated → Sturm ist dran
  Game.sim.exec("kubectl create deployment web --image=nginx");
  const start = pumpUntilStart();
  expect(start).toMatchObject({ type: "start", info: { kind: "storm", dep: "web" } });
  expect(Game.sim.deployments.find(d => d.name === "web")?.broken).toBeTruthy();
});

test("nur die Krake freigeschaltet → sie startet (kein Deployment nötig)", () => {
  Game.state.completedQuests = [HAZARD_UNLOCK.kraken];
  const start = pumpUntilStart();
  expect(start).toMatchObject({ type: "start", info: { kind: "kraken" } });
  expect(Game.hazardState().kraken).not.toBeNull();
});

test("System aus (events=off): keine Gefahr startet je", () => {
  Game.setEventMode("off");
  Game.sim.exec("kubectl create deployment web --image=nginx");
  const start = pumpUntilStart(400);
  expect(start).toBeUndefined();
  expect(Game.hazardActive()).toBe(false);
});

test("UI beschäftigt (Overlay offen): fällige Gefahr wird aufgeschoben, kein Start", () => {
  setUiBusyProbe(() => true); // simuliert ein offenes Modal
  Game.sim.exec("kubectl create deployment web --image=nginx");
  const start = pumpUntilStart(400);
  expect(start).toBeUndefined();
  expect(Game.hazardActive()).toBe(false);
  // resetHazards (in jedem beforeEach genutzt) leert den Zustand wieder.
  Game.resetHazards();
  expect(Game.hazardState()).toEqual({ pirate: null, kraken: null, storm: null });
});
