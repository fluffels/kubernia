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

const LOG_ERWARTUNG: Record<LogArt, { jetztFehler: boolean; davorFehler: boolean; davorNieNeugestartet: boolean; jetztStart: boolean; gleich: boolean }> = {
  "nicht-gestartet": { jetztFehler: true, davorFehler: true, davorNieNeugestartet: false, jetztStart: false, gleich: true },
  absturz: { jetztFehler: false, davorFehler: false, davorNieNeugestartet: false, jetztStart: true, gleich: true },
  normal: { jetztFehler: false, davorFehler: true, davorNieNeugestartet: true, jetztStart: false, gleich: false },
};

describe("kubectl logs je Broken-Typ", () => {
  test.each(TYPEN)("%s: logs und logs -p folgen der ausdrücklichen Entscheidung", type => {
    const s = sim(type);
    const n = podName(s);
    const jetzt = kubectl(s, "logs " + n);
    const davor = kubectl(s, "logs -p " + n);
    expect({
      jetztFehler: jetzt.includes("BadRequest"),
      davorFehler: davor.includes("BadRequest"),
      davorNieNeugestartet: davor.includes("previous terminated"),
      jetztStart: jetzt.includes("[start]"),
      gleich: davor === jetzt,
    }).toEqual(LOG_ERWARTUNG[LOGS[type]]);
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
    expect(m === undefined ? "keine" : m.memMi === 400 ? "speicher" : m.memMi < 64 ? "grund" : "unerwartet").toBe(METRIK[type]);
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

describe("Evicted gewinnt überall (#1648)", () => {
  const evictedSim = (type: Typ) => new KQSim({ deployments: [dep(type, { ephemeralLimit: 512, emptyDir: { data: "riesig", usedMi: 600 } })] });
  const podAlerts = (s: KQSim) => s.alerts().filter(a => a.state === "firing" && a.name.startsWith("KubePod")).map(a => a.name);

  test.each(TYPEN)("%s + evicted: Evicted in get pods, kein Pod-Alert, keine Metriken", type => {
    const s = evictedSim(type);
    expect(kubectl(s, "get pods")).toContain("Evicted");
    expect(podAlerts(s)).toEqual([]);
    expect(s.podMetrics()).toEqual([]);
  });

  test.each(TYPEN)("%s + evicted: describe pod nennt Evicted samt Grund in den Events, kein Broken-Ereignis", type => {
    const s = evictedSim(type);
    const out = kubectl(s, "describe pod " + podName(s));
    const events = out.slice(out.indexOf("Events:"));
    expect(events).toMatch(/Warning {2}Evicted {4}\S+ {3}Pod ephemeral local storage usage exceeds/);
    expect(events).toContain("Killing");
    expect(events).not.toContain("Warning  " + EVENT_GRUND[type]);
  });

  test.each(TYPEN)("%s + evicted: logs und logs -p liefern denselben Fehler, weder Absturz- noch Normal-Log", type => {
    const s = evictedSim(type);
    const n = podName(s);
    const jetzt = kubectl(s, "logs " + n);
    const davor = kubectl(s, "logs -p " + n);
    expect(jetzt).toContain("BadRequest");
    expect(jetzt).toContain("is terminated");
    expect(jetzt).not.toContain("[start]");
    expect(jetzt).not.toContain("GET /");
    expect(davor).toBe(jetzt);
  });

  test("gesunder evicteter Pod: logs liefert den Fehler statt des Normal-Logs", () => {
    const s = new KQSim({ deployments: [{ name: "web", image: "nginx:1", replicas: 1, ephemeralLimit: 512, emptyDir: { data: "riesig", usedMi: 600 } }] });
    const out = kubectl(s, "logs " + podName(s));
    expect(out).toContain("is terminated");
    expect(out).not.toContain("GET /");
  });

  test("Vorrang ist abgeleitet: fällt die Eviction weg, kehren Alert und Absturz-Log zurück", () => {
    const s = evictedSim("crashloop");
    expect(podAlerts(s)).toEqual([]);
    s.exec("kubectl delete pod " + podName(s));
    expect(kubectl(s, "get pods")).not.toContain("Evicted");
    expect(podAlerts(s)).toEqual(["KubePodCrashLooping"]);
    expect(kubectl(s, "logs -p " + podName(s))).toContain("Secret 'sek' nicht gefunden");
  });
});
