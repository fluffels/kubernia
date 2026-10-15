/* Lern-Texte je Broken-Typ (#1509): Events (describe pod), Logs, Metriken und Alerts entscheiden für JEDEN Typ ausdrücklich.
 * Die Erwartungstabellen sind `Record<Broken["type"], …>`: ein neuer Typ bricht den Typecheck, und die Tests laufen zur Laufzeit
 * über `Object.keys(BROKEN_POD)`. Alles über die öffentliche Sim-API (`exec`, `podMetrics`, `alerts`). */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { BROKEN_POD } from "../../src/sim/podstatus";
import type { Broken } from "../../src/sim/state";

type Typ = Broken["type"];
const TYPEN = Object.keys(BROKEN_POD) as Typ[];
const dep = (type: Typ, extra: object = {}) => ({ name: "web", image: "nginx:1", replicas: 1, broken: { type, needsSecret: "sek", ...(type === "oomkilled" ? { memNeeded: 400 } : {}) }, ...extra });
const sim = (type: Typ) => new KQSim({ deployments: [dep(type)] });
const podName = (s: KQSim): string => s.exec("kubectl get pods").output!.split("\n")[1].split(/\s+/)[0];
const kubectl = (s: KQSim, cmd: string): string => s.exec("kubectl " + cmd).output ?? "";

const EVENT_GRUND: Record<Typ, string> = {
  imagepull: "Failed",
  crashloop: "BackOff",
  pending: "FailedScheduling",
  notready: "Unhealthy",
  oomkilled: "BackOff",
};

describe("describe pod: Events je Broken-Typ", () => {
  test.each(TYPEN)("%s: mindestens eine Warning-Zeile mit dem Grund unter Events:", type => {
    const s = sim(type);
    const events = kubectl(s, "describe pod " + podName(s)).split("Events:\n")[1].split("\n");
    expect(events.some(l => l.startsWith("  Warning  " + EVENT_GRUND[type] + " ")), type).toBe(true);
  });

  test("gesunder Pod: nur Normal-Events, keine Warning", () => {
    const s = new KQSim({ deployments: [{ name: "web", image: "nginx:1", replicas: 1 }] });
    const events = kubectl(s, "describe pod " + podName(s)).split("Events:\n")[1];
    expect(events).not.toContain("Warning");
    expect(events).toContain("Started");
  });
});

type LogArt = "nicht-gestartet" | "absturz" | "normal";
const LOGS: Record<Typ, LogArt> = {
  imagepull: "nicht-gestartet",
  crashloop: "absturz",
  pending: "nicht-gestartet",
  notready: "normal",
  oomkilled: "absturz",
};

describe("kubectl logs je Broken-Typ", () => {
  test.each(TYPEN)("%s: logs und logs -p folgen der ausdrücklichen Entscheidung", type => {
    const s = sim(type);
    const n = podName(s);
    const jetzt = kubectl(s, "logs " + n);
    const davor = kubectl(s, "logs -p " + n);
    switch (LOGS[type]) {
      case "nicht-gestartet":
        expect(jetzt).toContain("BadRequest");
        expect(davor).toContain("BadRequest");
        expect(davor).not.toContain("previous terminated");
        break;
      case "absturz":
        expect(jetzt).toContain("[start]");
        expect(davor).toBe(jetzt);
        expect(davor).not.toContain("Error from server");
        break;
      case "normal":
        expect(jetzt).toContain("GET /gesundheit");
        expect(davor).toContain("previous terminated container");
        break;
    }
  });

  test("crashloop nennt das fehlende Secret, oomkilled bricht ohne Fehler ab", () => {
    expect(kubectl(sim("crashloop"), "logs -p " + podName(sim("crashloop")))).toContain("Secret 'sek' nicht gefunden");
    const o = sim("oomkilled");
    expect(kubectl(o, "logs -p " + podName(o))).toContain("Log endet hier abrupt");
  });

  test("gesunder Pod: normaler Log, kein Absturz-Log", () => {
    const s = new KQSim({ deployments: [{ name: "web", image: "nginx:1", replicas: 1 }] });
    const n = podName(s);
    expect(kubectl(s, "logs " + n)).toContain("GET /gesundheit");
    expect(kubectl(s, "logs -p " + n)).toContain("previous terminated container");
  });
});

type Metrik = "keine" | "grund" | "speicher";
const METRIK: Record<Typ, Metrik> = {
  imagepull: "keine",
  crashloop: "grund",
  pending: "keine",
  notready: "grund",
  oomkilled: "speicher",
};
const ALERT: Record<Typ, string | null> = {
  imagepull: null,
  crashloop: "KubePodCrashLooping",
  pending: null,
  notready: null,
  oomkilled: "KubePodOOMKilled",
};

describe("Metriken und Alerts je Broken-Typ", () => {
  test.each(TYPEN)("%s: Metriken", type => {
    const s = sim(type);
    const m = s.podMetrics().find(p => p.name === podName(s));
    switch (METRIK[type]) {
      case "keine": expect(m).toBeUndefined(); break;
      case "grund": expect(m).toBeDefined(); expect(m!.memMi).toBeLessThan(64); break;
      case "speicher": expect(m?.memMi).toBe(400); break;
    }
  });

  test.each(TYPEN)("%s: firing-Alerts", type => {
    const firing = sim(type).alerts().filter(a => a.state === "firing" && a.name.startsWith("KubePod")).map(a => a.name);
    expect(firing).toEqual(ALERT[type] === null ? [] : [ALERT[type]]);
  });

  test("oomkilled ohne memNeeded: Speicher klettert auf 256Mi", () => {
    const s = new KQSim({ deployments: [{ name: "web", image: "nginx:1", replicas: 1, broken: { type: "oomkilled" } }] });
    expect(s.podMetrics()[0].memMi).toBe(256);
  });

  test("gesunder Pod: keine Pod-Alerts", () => {
    const s = new KQSim({ deployments: [{ name: "web", image: "nginx:1", replicas: 1 }] });
    expect(s.alerts().filter(a => a.state === "firing" && a.name.startsWith("KubePod"))).toEqual([]);
  });
});
