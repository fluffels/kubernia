/* Unit-Tests für den Cluster-Simulator – Kern / Dispatcher.
 * Die befehlsfamilien-spezifischen Tests liegen seit #383 (sim.test.ts-Split zu #346)
 * gespiegelt zu den sim/-Modulen in test/sim/<familie>.test.ts (docker, kubectl, rbac,
 * helm, git, terraform, argocd, glab); gemeinsame Fixtures in test/sim/helpers.ts.
 * Hier bleiben nur dispatcher-/familienübergreifende Fälle: unbekannter Befehl,
 * Anfängerfehler quer über mehrere Werkzeuge (#19), Sim-Fehler-Signal (#307) und
 * der vollständige Snapshot/Restore über alle Ressourcen. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./sim/helpers";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

test("unbekannter Befehl bekommt einen 'Meintest du?'-Vorschlag", () => {
  const r = sim.exec("kubctl get pods");
  assert.ok(r.error);
  assert.match(r.output!, /kubectl/);
});

test("häufige Anfängerfehler werden auch bei kubectl/helm/git abgefangen – Fehler + Hinweis (Issue #19)", () => {
  // kubectl: Pflicht-Flag fehlt
  const noImg = sim.exec("kubectl create deployment kasse");
  assert.ok(noImg.error, "create deployment ohne --image muss meckern");
  assert.match(noImg.output!, /image/i);
  assert.ok(!sim.deployments.some(d => d.name === "kasse"), "ohne --image wird KEIN Deployment angelegt");
  // kubectl: unbekannte Ressource -> Vorschlag
  const bad = sim.exec("kubectl get bananen");
  assert.ok(bad.error && /pods|deployments|services|nodes/i.test(bad.output!), "unbekannte Ressource wird erklärt");

  // helm: Chart fehlt
  assert.ok(sim.exec("helm install meinrelease").error, "helm install ohne Chart muss meckern");

  // git: ohne init kein Repo
  assert.ok(sim.exec("git status").error, "ohne 'git init' ist es kein Repo");
  sim.exec("git init");
  // git commit ohne -m wird erklärt
  const noMsg = sim.exec("git commit");
  assert.ok(noMsg.error && /Commit-Nachricht/i.test(noMsg.output!), "commit ohne -m wird erklärt");
  // git add ohne Datei wird erklärt
  assert.ok(sim.exec("git add").error, "git add ohne Datei muss meckern");
});

test("help ohne Freischalt-Set listet wie bisher alle Befehle (#358)", () => {
  const out = sim.exec("help").output!;
  for (const cmd of ["docker", "kubectl", "helm", "terraform", "git", "argocd", "glab", "curl", "aws"]) {
    assert.match(out, new RegExp(cmd), `help sollte ${cmd} listen`);
  }
});

test("help mit Freischalt-Set zeigt NUR freigeschaltete Befehle + Hinweis (#358)", () => {
  // Spielbeginn: nur die Meta-Befehle.
  const start = sim.exec("help", new Set(["help", "clear"])).output!;
  assert.match(start, /clear, help/, "Meta-Befehle stehen immer offen");
  assert.doesNotMatch(start, /\bdocker\b/, "docker noch nicht freigeschaltet → nicht gelistet");
  assert.doesNotMatch(start, /\bkubectl\b/, "kubectl noch nicht freigeschaltet → nicht gelistet");
  assert.match(start, /frei/, "Hinweis auf weitere freischaltbare Befehle");
});

test("help mit Freischalt-Set zeigt freigeschaltete, blendet andere aus (#358)", () => {
  const out = sim.exec("help", new Set(["help", "clear", "docker", "ls", "cat"])).output!;
  assert.match(out, /\bdocker\b/, "docker ist freigeschaltet → gelistet");
  assert.match(out, /ls, cat <datei>, clear, help/, "ls/cat freigeschaltet → in der Meta-Zeile");
  assert.doesNotMatch(out, /\bkubectl\b/, "kubectl NICHT freigeschaltet → ausgeblendet");
  assert.doesNotMatch(out, /\bhelm\b/, "helm NICHT freigeschaltet → ausgeblendet");
});

test("snapshot/restore erhält den kompletten Zustand", () => {
  sim.exec("kubectl create deployment kasse --image=nginx");
  sim.exec("kubectl create secret generic db --from-literal=pw=x");
  sim.exec("helm repo add bitnami https://charts.bitnami.com/bitnami");
  sim.exec("helm install web bitnami/nginx");
  const restored = new KQSim(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.match(restored.exec("kubectl get pods").output!, /kasse/);
  assert.match(restored.exec("kubectl get secrets").output!, /db/);
  assert.match(restored.exec("helm list").output!, /web/);
});

// #307: Drill-Feedback verstummt, wenn die Eingabe einen Sim-Fehler produziert.
// Die UI-Bedingung `!result.error` blockierte das Anzeigen des `why`-Hinweises.
// Dieser Test beweist das Sim-Verhalten, das den Bug auslöst:
// Ein falscher Befehl (docker build ohne Dockerfile) während einer docker-run-Drill
// liefert error:true → der Drill-Hinweis muss dennoch erscheinen (#307 fix in ui.ts).
test("#307 Szenario: falscher Befehl produziert Sim-Fehler (error:true)", () => {
  // Ohne Dockerfile schlägt docker build fehl – das ist der Auslöser für das Verstummen
  const r = sim.exec("docker build .");
  assert.ok(r.error, "docker build ohne Dockerfile liefert error:true");
  // Gleichzeitig würde cmdOk für eine docker-run-Aufgabe false sein → Bug: UI zeigte nichts
  // Die zugehörige UI-Korrektur steht in src/ui.ts (else-if entfernt !result.error)
});

test("#307 Szenario: Subcommand-Vertauscher produziert Sim-Fehler", () => {
  // docker stop auf nicht-existenten Container → error:true, aber cmdOk für docker-run-Task = false
  const r = sim.exec("docker stop nicht-vorhanden");
  assert.ok(r.error, "docker stop auf unbekannten Container liefert error:true");
});
