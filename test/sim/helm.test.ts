/* Unit-Tests: helm-Befehlsfamilie (sim/helm.ts) – Teil des sim.test.ts-Splits (#383).
 * Fahren wie gehabt über sim.exec("…"); gemeinsame Fixtures in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

test("helm: install, upgrade, rollback stellt Replicas wieder her", () => {
  sim.exec("helm repo add bitnami https://charts.bitnami.com/bitnami");
  sim.exec("helm install web bitnami/nginx");
  sim.exec("helm upgrade web bitnami/nginx --set replicaCount=3");
  const rel = sim.releases[0];
  assert.equal(rel.revision, 2);
  const dep = sim.deployments.find(d => d.name === rel.depName)!;
  assert.equal(dep.replicas, 3);
  sim.exec("helm rollback web 1");
  assert.equal(rel.revision, 3, "Rollback erzeugt eine NEUE Revision");
  assert.equal(dep.replicas, 1, "Replicas zurück auf Revision-1-Stand");
});

/* ---------- Werft-Ausbau: eigene Charts schreiben (Issue #27) ---------- */

test("helm create: legt ein Chart samt Gerüst-Dateien an", () => {
  const out = sim.exec("helm create funkdienst").output!;
  assert.match(out, /Creating funkdienst/);
  assert.equal(sim.charts.length, 1);
  assert.equal(sim.charts[0].name, "funkdienst");
  // Das Gerüst muss als anschaubare Dateien existieren (ls/cat im Spiel).
  const ls = sim.exec("ls").output!;
  assert.match(ls, /funkdienst\/Chart\.yaml/);
  assert.match(ls, /funkdienst\/values\.yaml/);
  assert.match(sim.exec("cat funkdienst/Chart.yaml").output!, /name: funkdienst/);
  assert.match(sim.exec("cat funkdienst/values.yaml").output!, /replicaCount/);
});

test("helm create: zweimal derselbe Name wird abgelehnt (Negativfall)", () => {
  assert.ok(!sim.exec("helm create funkdienst").error);
  const dup = sim.exec("helm create funkdienst");
  assert.ok(dup.error, "doppelter Chart-Name muss meckern");
  assert.match(dup.output!, /already exists/);
  assert.equal(sim.charts.length, 1, "kein doppeltes Chart angelegt");
});

test("helm create: ohne Namen meckert es", () => {
  const r = sim.exec("helm create");
  assert.ok(r.error);
  assert.match(r.output!, /Chart-Name fehlt/);
});

test("helm lint: prüft nur existierende Charts (positiv + negativ)", () => {
  sim.exec("helm create funkdienst");
  const ok = sim.exec("helm lint funkdienst").output!;
  assert.match(ok, /0 chart\(s\) failed/);
  assert.ok(!sim.exec("helm lint ./funkdienst").error, "Pfad-Schreibweise ./chart geht auch");
  const miss = sim.exec("helm lint gibtsnicht");
  assert.ok(miss.error, "lint auf unbekanntes Chart muss meckern");
  assert.match(miss.output!, /not found/);
});

test("helm package: erzeugt ein .tgz und markiert das Chart als gepackt", () => {
  sim.exec("helm create funkdienst");
  const out = sim.exec("helm package funkdienst").output!;
  assert.match(out, /funkdienst-0\.1\.0\.tgz/);
  assert.equal(sim.charts[0].packaged, true);
  assert.match(sim.exec("ls").output!, /funkdienst-0\.1\.0\.tgz/);
  const miss = sim.exec("helm package gibtsnicht");
  assert.ok(miss.error && /not found/.test(miss.output!), "package auf unbekanntes Chart meckert");
});

test("helm install aus lokalem Chart: ./chart erzeugt ein echtes Release + Pods", () => {
  sim.exec("helm create funkdienst");
  const out = sim.exec("helm install mein-funk ./funkdienst").output!;
  assert.match(out, /STATUS: deployed/);
  assert.ok(sim.releases.some(r => r.name === "mein-funk"), "Release angelegt");
  assert.match(sim.exec("kubectl get pods").output!, /mein-funk-funkdienst/);
  // Negativfall: lokaler Pfad auf ein Chart, das es nicht gibt
  const miss = sim.exec("helm install rel ./gibtsnicht");
  assert.ok(miss.error, "Install aus fehlendem lokalem Chart muss scheitern");
  assert.match(miss.output!, /not found/);
});

test("helm install: bekannter Bruchfall bleibt – Repo-Chart ohne Repo meckert weiter", () => {
  // Sicherstellen, dass die neue Lokal-Logik den Repo-Pfad nicht aufweicht (Red-Green).
  const r = sim.exec("helm install web bitnami/nginx");
  assert.ok(r.error && /repo bitnami not found/.test(r.output!), "ohne 'helm repo add' kein Repo-Install");
});

/* ---------- Vorlagen lesen & rendern (Issue #273) ---------- */

test("helm create: legt lesbare Template-Dateien mit echter Go-Syntax an", () => {
  sim.exec("helm create vorlage");
  const deploy = sim.exec("cat vorlage/templates/deployment.yaml").output!;
  // Die Kernkonzepte des Tickets müssen in der Vorlage wirklich auftauchen.
  assert.match(deploy, /\{\{ \.Values\.replicaCount \}\}/, "{{ .Values… }} vorhanden");
  assert.match(deploy, /include "vorlage\.fullname"/, "include eines _helpers-Schnipsels");
  assert.match(deploy, /\{\{- if \.Values\.env \}\}/, "if-Block");
  assert.match(deploy, /\{\{- range \.Values\.env \}\}/, "range-Schleife");
  assert.match(deploy, /toYaml \.Values\.resources/, "toYaml-Einbettung");
  const helpers = sim.exec("cat vorlage/templates/_helpers.tpl").output!;
  assert.match(helpers, /define "vorlage\.fullname"/, "_helpers.tpl definiert Schnipsel");
  assert.match(helpers, /\.Release\.Name/, "Kontext-Variable .Release.Name");
});

test("helm template: rendert Vorlage + Werte zu einem fertigen Manifest", () => {
  sim.exec("helm create vorlage");
  const out = sim.exec("helm template vorlage").output!;
  assert.match(out, /kind: Deployment/);
  // Platzhalter sind ersetzt: .Release.Name (Default) + .Chart.Name + .Values.replicaCount.
  assert.match(out, /name: release-name-vorlage/, ".Release.Name + .Chart.Name eingesetzt");
  assert.match(out, /replicas: 1/, ".Values.replicaCount gerendert");
  assert.match(out, /image: "nginx:latest"/, ".Values.image gerendert");
  // Der if-Block (env) fehlt, weil kein env gesetzt ist – genau das soll man sehen.
  assert.doesNotMatch(out, /env:/, "if-Block ohne Wert verschwindet beim Rendern");
  // Kein roher Platzhalter darf im gerenderten Manifest übrig bleiben.
  assert.doesNotMatch(out, /\{\{/, "keine ungerenderten {{ }} im Ergebnis");
});

test("helm template: optionaler Release-Name vor dem Chart wird benutzt", () => {
  sim.exec("helm create vorlage");
  const out = sim.exec("helm template mein-release vorlage").output!;
  assert.match(out, /name: mein-release-vorlage/);
});

test("helm template: unbekanntes Chart meckert (Negativfall)", () => {
  const miss = sim.exec("helm template gibtsnicht");
  assert.ok(miss.error, "template auf unbekanntes Chart muss meckern");
  assert.match(miss.output!, /not found/);
  const none = sim.exec("helm template");
  assert.ok(none.error && /Welches Chart/.test(none.output!), "template ohne Argument meckert");
});

test("snapshot/restore erhält selbst gebaute Charts", () => {
  sim.exec("helm create funkdienst");
  sim.exec("helm package funkdienst");
  const restored = new KQSim(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.equal(restored.charts.length, 1);
  assert.equal(restored.charts[0].packaged, true);
  // und das wiederhergestellte Chart ist sofort wieder installierbar
  assert.ok(!restored.exec("helm install w ./funkdienst").error);
});
