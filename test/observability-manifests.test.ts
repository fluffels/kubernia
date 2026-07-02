/* Tests für die Observability-Manifeste (#110): ServiceMonitor, PrometheusRule,
 * Grafana-Datasource/-Dashboard. Zwei Ebenen:
 *  1. Struktur der YAML-Schnipsel (Manifest-Bibliothek data/manifests via manifest-lib, #514).
 *  2. Der Simulator verarbeitet sie per `kubectl apply -f` und listet sie via `kubectl get`.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { getManifest } from "../src/content/manifest-lib";

const SERVICEMONITOR_YAML = getManifest("servicemonitor-lager");
const PROMETHEUSRULE_YAML = getManifest("prometheusrule-hafen");
const GRAFANA_DATASOURCE_YAML = getManifest("grafana-datasource-prometheus");
const GRAFANA_DASHBOARD_YAML = getManifest("grafana-dashboard-hafen");

/* ===================== 1. Struktur der Manifeste ===================== */

/** Sucht eine Liste von Pflicht-Mustern in einem Manifest und meldet die fehlenden.
 *  Leere Rückgabe = alles da. Bewusst über regex auf Zeilen, damit auch die Einrückung zählt. */
function fehlendeMuster(yaml: string, muster: Array<[RegExp, string]>): string[] {
  return muster.filter(([re]) => !re.test(yaml)).map(([, was]) => "fehlt: " + was);
}

test("SERVICEMONITOR_YAML: gültiger ServiceMonitor mit Selector + Endpoint", () => {
  assert.deepEqual(fehlendeMuster(SERVICEMONITOR_YAML, [
    [/^apiVersion: monitoring\.coreos\.com\/v1$/m, "apiVersion monitoring.coreos.com/v1"],
    [/^kind: ServiceMonitor$/m, "kind: ServiceMonitor"],
    [/^ {2}name: \S+/m, "metadata.name"],
    [/^ {2}selector:/m, "spec.selector"],
    [/^ {6}app: \S+/m, "selector.matchLabels.app (welcher Service)"],
    [/^ {2}endpoints:/m, "spec.endpoints"],
    [/interval: \S+/m, "endpoints.interval (Scrape-Intervall)"],
  ]), []);
});

test("PROMETHEUSRULE_YAML: gültige Alert-Regel mit expr + for + severity", () => {
  assert.deepEqual(fehlendeMuster(PROMETHEUSRULE_YAML, [
    [/^apiVersion: monitoring\.coreos\.com\/v1$/m, "apiVersion"],
    [/^kind: PrometheusRule$/m, "kind: PrometheusRule"],
    [/alert: \S+/m, "rules.alert (Alert-Name)"],
    [/expr: .+/m, "rules.expr (Schwelle)"],
    [/for: \S+/m, "rules.for (Dauer vor dem Feuern)"],
    [/severity: \S+/m, "labels.severity"],
  ]), []);
});

test("GRAFANA_DATASOURCE_YAML: zeigt auf Prometheus", () => {
  assert.deepEqual(fehlendeMuster(GRAFANA_DATASOURCE_YAML, [
    [/^kind: GrafanaDatasource$/m, "kind: GrafanaDatasource"],
    [/type: prometheus/m, "datasource.type: prometheus"],
    [/url: \S+/m, "datasource.url"],
  ]), []);
});

test("GRAFANA_DASHBOARD_YAML: hat Titel + Panels", () => {
  assert.deepEqual(fehlendeMuster(GRAFANA_DASHBOARD_YAML, [
    [/^kind: GrafanaDashboard$/m, "kind: GrafanaDashboard"],
    [/"title":/m, "Dashboard-Titel im json"],
    [/"panels":/m, "panels-Liste im json"],
  ]), []);
});

test("Red-Green: der Struktur-Check schlägt bei einem kaputten Manifest an", () => {
  // Ohne kind + ohne endpoints MUSS fehlendeMuster anschlagen – sonst hätte er keine Zähne.
  const kaputt = ["apiVersion: monitoring.coreos.com/v1", "metadata:", "  name: x", "spec:"].join("\n");
  const fehler = fehlendeMuster(kaputt, [
    [/^kind: ServiceMonitor$/m, "kind: ServiceMonitor"],
    [/^ {2}endpoints:/m, "spec.endpoints"],
  ]);
  assert.ok(fehler.some(f => f.includes("kind: ServiceMonitor")), "fehlendes kind nicht gemeldet");
  assert.ok(fehler.some(f => f.includes("endpoints")), "fehlende endpoints nicht gemeldet");
});

/* ===================== 2. Verarbeitung durch den Simulator ===================== */

/** Ein Szenario, das alle vier Manifeste als Dateien + passende apply-Wirkungen bereitstellt –
 *  genau so, wie es später eine Quest tut. */
function monitoringSzenario() {
  return new KQSim({
    files: {
      "servicemonitor.yaml": SERVICEMONITOR_YAML,
      "prometheusrule.yaml": PROMETHEUSRULE_YAML,
      "grafana-datasource.yaml": GRAFANA_DATASOURCE_YAML,
      "grafana-dashboard.yaml": GRAFANA_DASHBOARD_YAML,
    },
    applyEffects: {
      "servicemonitor.yaml": { serviceMonitor: { name: "lager-monitor", selector: "lager", port: "metrics", interval: "30s" } },
      "prometheusrule.yaml": { prometheusRule: { name: "hafen-alarme", alert: "HighPodCPU", severity: "warning", expr: "rate(cpu[5m]) > 0.5", forDuration: "5m" } },
      "grafana-datasource.yaml": { grafanaDatasource: { name: "prometheus-quelle", dsType: "prometheus", url: "http://prometheus-server.monitoring.svc:9090" } },
      "grafana-dashboard.yaml": { grafanaDashboard: { name: "hafen-uebersicht", title: "Hafen-Übersicht", panels: 3 } },
    },
  });
}

test("kubectl apply: ServiceMonitor wird angelegt, gelistet und ist idempotent", () => {
  const sim = monitoringSzenario();
  const created = sim.exec("kubectl apply -f servicemonitor.yaml");
  assert.ok(!created.error);
  assert.match(created.output!, /servicemonitor.*created/i);
  // get listet ihn (inkl. Kurzform smon)
  assert.match(sim.exec("kubectl get servicemonitors").output!, /lager-monitor/);
  assert.match(sim.exec("kubectl get smon").output!, /lager-monitor/);
  assert.match(sim.exec("kubectl get servicemonitors").output!, /lager/, "der gescrapte Service steht dabei");
  // erneut anwenden -> unchanged, kein Duplikat
  assert.match(sim.exec("kubectl apply -f servicemonitor.yaml").output!, /unchanged/);
  assert.equal(sim.serviceMonitors.length, 1, "kein Duplikat beim zweiten apply");
});

test("kubectl apply: PrometheusRule wird angelegt und gelistet (Alert-Name + Schwelle)", () => {
  const sim = monitoringSzenario();
  assert.match(sim.exec("kubectl apply -f prometheusrule.yaml").output!, /prometheusrule.*created/i);
  const out = sim.exec("kubectl get prometheusrules").output!;
  assert.match(out, /hafen-alarme/);
  assert.match(out, /HighPodCPU/, "der definierte Alert taucht auf");
  assert.match(sim.exec("kubectl get promrule").output!, /hafen-alarme/, "Kurzform promrule");
});

test("kubectl apply: Grafana-Datasource und -Dashboard werden angelegt und gelistet", () => {
  const sim = monitoringSzenario();
  assert.match(sim.exec("kubectl apply -f grafana-datasource.yaml").output!, /grafanadatasource.*created/i);
  assert.match(sim.exec("kubectl apply -f grafana-dashboard.yaml").output!, /grafanadashboard.*created/i);
  assert.match(sim.exec("kubectl get grafanadatasources").output!, /prometheus-quelle/);
  const dash = sim.exec("kubectl get grafanadashboards").output!;
  assert.match(dash, /hafen-uebersicht/);
  assert.match(dash, /Hafen-Übersicht/, "der Dashboard-Titel steht dabei");
});

test("Serialisierung: angewendete Monitoring-Objekte überleben snapshot/reload", () => {
  const sim = monitoringSzenario();
  sim.exec("kubectl apply -f servicemonitor.yaml");
  sim.exec("kubectl apply -f prometheusrule.yaml");
  sim.exec("kubectl apply -f grafana-datasource.yaml");
  sim.exec("kubectl apply -f grafana-dashboard.yaml");
  const wieder = new KQSim(sim.snapshot());
  assert.match(wieder.exec("kubectl get servicemonitors").output!, /lager-monitor/);
  assert.match(wieder.exec("kubectl get prometheusrules").output!, /hafen-alarme/);
  assert.match(wieder.exec("kubectl get grafanadatasources").output!, /prometheus-quelle/);
  assert.match(wieder.exec("kubectl get grafanadashboards").output!, /hafen-uebersicht/);
});

test("kubectl get: leere Monitoring-Listen melden 'No resources found' (kein Fehler)", () => {
  const sim = new KQSim({});
  for (const what of ["servicemonitors", "prometheusrules", "grafanadatasources", "grafanadashboards"]) {
    const r = sim.exec("kubectl get " + what);
    assert.ok(!r.error, what + " ohne Objekte darf kein Fehler sein");
    assert.match(r.output!, /No resources found/);
  }
});
