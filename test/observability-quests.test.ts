/* Phase 5 – Monitoring-Leuchtturm (#120): gezielte Tests für die Observability-Quests
 * (observability-metrics–observability-alerts) und die Monitoring-Sim, ergänzend zu den breiten Durchspiel-/Struktur-Tests
 * (quests.test.ts, content.test.ts, sim.test.ts, observability.test.ts).
 *
 * Schwerpunkte hier:
 *  1. `kubectl get alerts` – der Befehlspfad selbst (firing/resolved-Tabelle), bisher nur
 *     die zugrunde liegende alerts()-Methode getestet.
 *  2. Quest-Integrität der vier Phase-5-Quests: Geber Lumi, Belohnungen gesetzt, jede
 *     accept-Regex matcht ihre eigene solution, jede Choice hat genau eine richtige Antwort.
 *  3. Red-Green: bewusst FALSCHE Eingaben dürfen NICHT akzeptiert werden.
 *  4. Die Lumi-Übungs-Drills liefern lösbare Aufgaben.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { KQContent } from "../src/content";
import type { Quest, QuestTask } from "../src/types";

const PHASE5 = ["observability-metrics", "observability-grafana", "observability-logs", "observability-alerts"];

function phase5Quests() {
  return KQContent.QUESTS.filter(q => PHASE5.includes(q.id));
}

/** Alle ausführbaren Aufgaben (teach-cmd + terminal-tasks) einer Quest mit Quest-Bezug.
 *  TeachCommand erweitert QuestTask, daher ist QuestTask der gemeinsame Rückgabetyp. */
function execTasks(quest: Quest): QuestTask[] {
  const out: QuestTask[] = [];
  for (const step of quest.steps) {
    if (step.type === "teach") out.push(step.cmd);
    else if (step.type === "terminal") for (const t of step.tasks) out.push(t);
  }
  return out;
}

/** Platzhalter wie <signalgeber-pod> durch einen realistischen Pod-Namen ersetzen,
 *  damit die accept-Regex (…-\S+) gegen die solution geprüft werden kann. */
function resolveSolution(sol: string): string {
  return sol.replace(/<([a-z]+)-pod>/g, "$1-abc12-xyz12");
}
function norm(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ");
}

/* ===================== 1. kubectl get alerts (Befehlspfad) ===================== */

test("kubectl get alerts: gesunder Cluster meldet 'No alerts firing' (kein Fehler)", () => {
  const sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
  const r = sim.exec("kubectl get alerts");
  assert.ok(!r.error, "gesunder Cluster -> kein Fehler");
  assert.match(r.output!, /No alerts firing/i);
});

test("kubectl get alerts: HighPodCPU erscheint als firing mit Schweregrad", () => {
  const sim = new KQSim({ deployments: [{ name: "rechenknecht", image: "python", replicas: 1, cpuHeavy: true }] });
  const r = sim.exec("kubectl get alerts");
  assert.ok(!r.error);
  assert.match(r.output!, /HighPodCPU/, "der Alert taucht in der Tabelle auf");
  assert.match(r.output!, /firing/, "Status firing");
  assert.match(r.output!, /warning/, "Schweregrad steht dabei");
  assert.match(r.output!, /NAME|SEVERITY|STATE/, "Tabellenkopf vorhanden");
});

test("kubectl get alerts: nach Behebung (scale 0) steht der Alert auf resolved", () => {
  const sim = new KQSim({ deployments: [{ name: "rechenknecht", image: "python", replicas: 1, cpuHeavy: true }] });
  assert.match(sim.exec("kubectl get alerts").output!, /HighPodCPU[\s\S]*firing/, "zuerst firing");
  const scale = sim.exec("kubectl scale deployment rechenknecht --replicas=0");
  assert.ok(!scale.error, "scale auf 0 ist kein Fehler");
  const after = sim.exec("kubectl get alerts");
  assert.ok(!after.error);
  assert.match(after.output!, /HighPodCPU[\s\S]*resolved/, "Bedingung weg -> resolved");
});

test("kubectl get alert (Singular) funktioniert wie der Plural", () => {
  const sim = new KQSim({ deployments: [{ name: "rechenknecht", image: "python", replicas: 1, cpuHeavy: true }] });
  const r = sim.exec("kubectl get alert");
  assert.ok(!r.error, "Singular wird akzeptiert");
  assert.match(r.output!, /HighPodCPU/);
});

/* ===================== 2. Quest-Integrität observability-metrics–observability-alerts ===================== */

test("Phase 5: genau vier Quests, alle von Lumi, mit gesetzten Belohnungen", () => {
  const qs = phase5Quests();
  assert.equal(qs.length, 4, "observability-metrics–observability-alerts sind vorhanden");
  for (const q of qs) {
    assert.equal(q.giver, "lumi", q.id + ": Geber ist Lumi");
    assert.ok(q.rewardXp > 0, q.id + ": rewardXp gesetzt");
    assert.ok(q.rewardCoins > 0, q.id + ": rewardCoins gesetzt");
    assert.ok(typeof q.title === "string" && q.title.length > 0, q.id + ": Titel vorhanden");
  }
});

test("Phase 5: jede accept-Regex matcht ihre eigene solution (teach + terminal)", () => {
  for (const q of phase5Quests()) {
    for (const t of execTasks(q)) {
      const cmd = norm(resolveSolution(t.solution));
      assert.ok(
        t.accept.some(re => re.test(cmd)),
        q.id + "/" + t.id + ": keine accept-Regex matcht die solution „" + cmd + "“",
      );
    }
  }
});

test("Phase 5: jede Choice-Frage hat genau eine richtige Antwort + bekannte reviewId", () => {
  const quizIds = new Set(KQContent.CRAB_QUIZ.map(c => c.id));
  for (const q of phase5Quests()) {
    for (const step of q.steps) {
      if (step.type !== "choice") continue;
      const richtige = step.options.filter((o) => o.ok).length;
      assert.equal(richtige, 1, q.id + "/" + step.reviewId + ": genau eine richtige Antwort");
      // reviewId ist auf ChoiceStep optional; `?? ""` hält das Verhalten von vorher
      // (ein fehlender reviewId ist kein Treffer → Assertion schlägt fehl).
      assert.ok(quizIds.has(step.reviewId ?? ""), q.id + ": reviewId „" + step.reviewId + "“ existiert in CRAB_QUIZ");
    }
  }
});

test("Phase 5: die Musterlösungen laufen gegen die Sim ohne Fehler durch", () => {
  // wie quests.test.ts, aber fokussiert auf observability-metrics–observability-alerts: Szenarien mergen, solution ausführen,
  // check() prüfen. Platzhalter werden über die echten Pod-Namen der Sim aufgelöst.
  const sim = new KQSim({});
  const resolvePod = (cmd: string) => cmd.replace(/<([a-z]+)-pod>/, (_m, dep) => {
    const d = sim.deployments.find(x => x.name === dep) || sim.deployments[0];
    return d.pods[0].name;
  });
  // Vorlauf: bis zur ersten Phase-5-Quest die Szenarien aller vorherigen Quests anwenden,
  // damit der Cluster-Zustand stimmt (Deployments etc.).
  for (const quest of KQContent.QUESTS) {
    for (const step of quest.steps) {
      if (step.scenario) sim.mergeScenario(step.scenario);
      if (!PHASE5.includes(quest.id)) continue;
      if (step.type === "teach") {
        const cmd = resolvePod(step.cmd.solution);
        const r = sim.exec(cmd);
        assert.ok(!r.error, quest.id + "/" + step.cmd.id + ": Sim-Fehler: " + r.output);
        assert.ok(!step.cmd.check || step.cmd.check(sim), quest.id + "/" + step.cmd.id + ": check() nicht erfüllt");
      } else if (step.type === "terminal") {
        for (const t of step.tasks) {
          const cmd = resolvePod(t.solution);
          const r = sim.exec(cmd);
          assert.ok(!r.error, quest.id + "/" + t.id + ": Sim-Fehler: " + r.output);
          assert.ok(!t.check || t.check(sim), quest.id + "/" + t.id + ": check() nicht erfüllt");
        }
      }
    }
  }
});

/* ===================== 3. Red-Green: falsche Eingaben werden abgelehnt ===================== */

/** Findet eine Aufgabe (teach-cmd oder terminal-task) per id in den Phase-5-Quests. */
function task(id: string) {
  for (const q of phase5Quests()) {
    const t = execTasks(q).find(x => x.id === id);
    if (t) return t;
  }
  throw new Error("Aufgabe nicht gefunden: " + id);
}

test("Red-Green: scale-auf-0 (observability-alerts) akzeptiert NICHT --replicas=1", () => {
  const t = task("t-scale-zero");
  assert.ok(t.accept.some(re => re.test("kubectl scale deployment rechenknecht --replicas=0")), "0 ist richtig");
  assert.ok(!t.accept.some(re => re.test("kubectl scale deployment rechenknecht --replicas=1")), "1 darf NICHT akzeptiert werden");
  assert.ok(!t.accept.some(re => re.test("kubectl scale deployment rechenknecht --replicas=10")), "10 ebenfalls nicht");
});

test("Red-Green: logs-basic (observability-logs) verlangt einen Pod-Namen", () => {
  const t = task("t-logs-basic");
  assert.ok(t.accept.some(re => re.test("kubectl logs signalgeber-abc12-xyz12")), "mit Pod ist richtig");
  assert.ok(!t.accept.some(re => re.test("kubectl logs")), "ohne Pod-Namen NICHT akzeptiert");
  assert.ok(!t.accept.some(re => re.test("kubectl describe pod signalgeber-abc12-xyz12")), "describe ist kein logs");
});

test("Red-Green: logs --previous (observability-logs) verlangt das Flag", () => {
  const t = task("t-logs-previous");
  assert.ok(t.accept.some(re => re.test("kubectl logs --previous bakenbote-abc12-xyz12")), "mit --previous richtig");
  assert.ok(t.accept.some(re => re.test("kubectl logs -p bakenbote-abc12-xyz12")), "Kurzform -p richtig");
  assert.ok(!t.accept.some(re => re.test("kubectl logs bakenbote-abc12-xyz12")), "ohne --previous NICHT akzeptiert");
});

test("Red-Green: alerts-get (observability-alerts) akzeptiert NICHT 'kubectl get pods'", () => {
  const t = task("t-alerts-get");
  assert.ok(t.accept.some(re => re.test("kubectl get alerts")), "get alerts ist richtig");
  assert.ok(!t.accept.some(re => re.test("kubectl get pods")), "get pods ist falsch");
  assert.ok(!t.accept.some(re => re.test("kubectl get")), "get ohne Ressource ist falsch");
});

test("Red-Green: kubectl get auf einen Unsinns-Typ ist ein Sim-Fehler", () => {
  const sim = new KQSim({});
  const r = sim.exec("kubectl get alerz");
  assert.ok(r.error, "unbekannter Ressourcentyp -> Fehler");
});

/* ===================== 4. Lumi-Übungs-Drills ===================== */

test("Phase 5: alle Lumi-Drills liefern lösbare Aufgaben (accept matcht solution, Sim ok)", () => {
  const pool = KQContent.PRACTICE.lumi;
  assert.ok(pool && pool.length > 0, "Lumi hat einen Übungs-Pool");
  for (const { drill } of pool) {
    const gen = KQContent.DRILLS[drill];
    assert.ok(gen, "Drill-Generator existiert: " + drill);
    // mehrfach erzeugen: Zufallsnamen dürfen die Lösbarkeit nie brechen
    for (let i = 0; i < 5; i++) {
      const sim = new KQSim({});
      const t = gen(sim);
      assert.ok(t.text && t.solution && t.hint && t.why, drill + ": Pflichtfelder fehlen");
      const cmd = norm(t.solution);
      assert.ok(t.accept.some(re => re.test(cmd)), drill + " #" + i + ": accept matcht solution nicht: " + cmd);
      const r = sim.exec(t.solution);
      assert.ok(!r.error, drill + " #" + i + ": Sim-Fehler: " + r.output);
    }
  }
});

test("Red-Green: ein Lumi-Drill akzeptiert eine falsche Eingabe NICHT", () => {
  const sim = new KQSim({});
  const topPods = KQContent.DRILLS["obs-top-pods"](sim);
  assert.ok(topPods.accept.some(re => re.test("kubectl top pods")), "top pods ist richtig");
  assert.ok(!topPods.accept.some(re => re.test("kubectl top nodes")), "top nodes darf hier NICHT zählen");
  assert.ok(!topPods.accept.some(re => re.test("kubectl get pods")), "get pods ist kein top pods");

  const alerts = KQContent.DRILLS["obs-alerts"](sim);
  assert.ok(alerts.accept.some(re => re.test("kubectl get alerts")), "get alerts ist richtig");
  assert.ok(!alerts.accept.some(re => re.test("kubectl get pods")), "get pods ist falsch");
});
