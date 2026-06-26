/* Phase 10 – Heimat-Werft (#172): gezielte Tests für die Capstone-Quest (Greta) +
 * ihren Übungs-Pool, ergänzend zu den breiten Durchspiel-/Struktur-Tests
 * (quests.test.ts, content.test.ts) und der reinen Werft-Sim-Mechanik
 * (test/sim/werft.test.ts). Vorbild: storage-drills.test.ts (Phase 7), wie #157 für Phase 9.
 *
 * Schwerpunkte:
 *  1. Gretas Übungs-Pool ist sauber verdrahtet: NPC + Drills + after-Quest existieren.
 *  2. Jeder Greta-Drill liefert eine lösbare Aufgabe – auch über viele Zufallsziehungen.
 *  3. Kein Drill vergiftet die GETEILTE Sim: der ganze Pool läuft nacheinander gegen EINE Sim.
 *  4. Der Diagnose-Drill werft-deploy-imagepull lässt wirklich einen ImagePullBackOff-Pod
 *     zurück (echter Negativfall) – sonst wäre der „kein Fehler"-Lauf ein False Positive.
 *  5. Der Capstone-Quest-Arc (werft-eigener-dienst) spielt komplett durch und pinnt den
 *     End-Zustand: Image gebaut → Deployment heil & Running → Service davor → curl 200.
 *  6. Red-Green: bewusst falsche Eingaben werden NICHT akzeptiert.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { KQContent } from "../src/content";

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** Die Quest, nach der Gretas Capstone-Drills freigeschaltet werden. */
const GRETA_QUEST = "werft-eigener-dienst";

test("Greta-Übungs-Pool ist sauber verdrahtet (NPC, Drills, after-Quest existieren)", () => {
  const pool = KQContent.PRACTICE.greta;
  assert.ok(pool && pool.length > 0, "Greta hat einen Übungs-Pool");
  assert.ok(KQContent.NPCS.greta, "NPC greta existiert");
  for (const { drill, after } of pool) {
    assert.ok(KQContent.DRILLS[drill], "Drill-Generator existiert: " + drill);
    assert.equal(after, GRETA_QUEST, drill + ": after zeigt auf die Capstone-Quest, nicht " + after);
    assert.ok(KQContent.QUESTS.some(q => q.id === after), drill + ": after-Quest existiert: " + after);
  }
});

test("Phase 10: alle Greta-Drills liefern lösbare Aufgaben (accept matcht solution, Sim ok)", () => {
  for (const { drill } of KQContent.PRACTICE.greta) {
    const gen = KQContent.DRILLS[drill];
    assert.ok(gen, "Drill-Generator existiert: " + drill);
    // mehrfach erzeugen: die Zufallsnamen (freeWerftName) dürfen die Lösbarkeit nie brechen
    for (let i = 0; i < 8; i++) {
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

test("Phase 10: der ganze Greta-Pool läuft gegen EINE geteilte Sim ohne Fehler (keine Vergiftung)", () => {
  // Wie quests.test.ts, aber gezielt: alle Greta-Drills nacheinander gegen dieselbe,
  // akkumulierende Sim. Beweist u.a., dass freeWerftName auch im geteilten Sim
  // kollisionsfreie Namen zieht (ein früher gebauter Dienst blockiert keinen späteren).
  const sim = new KQSim({});
  for (const { drill } of KQContent.PRACTICE.greta) {
    const t = KQContent.DRILLS[drill](sim);
    const r = sim.exec(t.solution);
    assert.ok(!r.error, drill + " (geteilte Sim): Sim-Fehler: " + r.output);
  }
});

test("Phase 10: der Diagnose-Drill werft-deploy-imagepull lässt wirklich einen ImagePullBackOff zurück (echter Negativfall)", () => {
  // Sonst wäre der „kein Fehler"-Lauf oben ein False Positive: die Übung soll genau das
  // ImagePullBackOff erzeugen, das der Spieler über die STATUS-Spalte diagnostiziert –
  // weil das EIGENE Image noch nicht gebaut ist (nicht ein fremdes fehlt).
  const sim = new KQSim({});
  const before = sim.deployments.length;
  const t = KQContent.DRILLS["werft-deploy-imagepull"](sim);
  assert.ok(!sim.exec(t.solution).error, "kubectl apply selbst darf nicht fehlschlagen");
  assert.equal(sim.deployments.length, before + 1, "genau ein zusätzliches Deployment angelegt");
  const dep = sim.deployments[sim.deployments.length - 1];
  assert.ok(dep.broken, "das Deployment ist kaputt (Image fehlt) – sonst wäre die Diagnose-Übung sinnlos");
  assert.equal(dep.broken!.type, "imagepull", "und zwar als ImagePullBackOff");
  assert.match(sim.exec("kubectl get pods").output!, new RegExp(dep.name + "-\\S+\\s+0/1\\s+ImagePullBackOff"));
});

/** Spielt eine Quest Schritt für Schritt gegen die laufende Sim und prüft dabei, dass
 *  Geber/Thema stimmen, jede Musterlösung akzeptiert + fehlerfrei läuft, ihr `check`
 *  erfüllt ist und jede Choice genau eine richtige Antwort hat. */
function playQuest(sim: KQSim, questId: string) {
  const quest = KQContent.QUESTS.find(q => q.id === questId);
  assert.ok(quest, "Quest existiert: " + questId);
  assert.equal(quest!.giver, "greta", questId + ": Geber ist Greta");
  assert.equal(quest!.topic, "capstone", questId + ": Thema ist capstone");
  for (const step of quest!.steps) {
    if (step.scenario) sim.mergeScenario(step.scenario);
    if (step.type === "teach") {
      const c = step.cmd;
      assert.ok(c.accept.some(re => re.test(norm(c.solution))), questId + "/" + c.id + ": accept matcht solution nicht: " + norm(c.solution));
      assert.ok(!sim.exec(c.solution).error, questId + "/" + c.id + ": Sim-Fehler");
      assert.ok(!c.check || c.check(sim), questId + "/" + c.id + ": check() nicht erfüllt");
    } else if (step.type === "terminal") {
      for (const task of step.tasks) {
        assert.ok(task.accept.some(re => re.test(norm(task.solution))), questId + "/" + task.id + ": accept matcht solution nicht: " + norm(task.solution));
        assert.ok(!sim.exec(task.solution).error, questId + "/" + task.id + ": Sim-Fehler");
        assert.ok(!task.check || task.check(sim), questId + "/" + task.id + ": check() nicht erfüllt");
      }
    } else if (step.type === "choice") {
      assert.equal(step.options.filter(o => o.ok).length, 1, questId + ": jede Choice hat genau EINE richtige Antwort");
      for (const o of step.options) assert.ok(o.t && o.reply, questId + ": jede Option hat Text + Antwort");
    }
    // dialog/minigame: hier nichts auszuführen
  }
}

test("Phase 10: der Capstone-Quest-Arc spielt durch und pinnt den End-Zustand (gebaut → deployt → erreichbar)", () => {
  const sim = new KQSim({});
  playQuest(sim, GRETA_QUEST);

  // Am Ende der Kette: das EIGENE Image ist gebaut, das Deployment läuft heil, der Service
  // steht davor – und der Klopftest liefert die 200. Genau der Capstone-Bogen.
  const dep = sim.deployments.find(d => d.name === "werft-dienst");
  assert.ok(dep, "Deployment werft-dienst existiert nach der Quest");
  assert.equal(dep!.broken, null, "kein ImagePullBackOff mehr – das Image wurde gebaut und nachgezogen");
  assert.match(sim.exec("kubectl get pods").output!, /werft-dienst-\S+\s+1\/1\s+Running/);

  const svc = sim.services.find(s => s.name === "werft-dienst");
  assert.ok(svc, "Service werft-dienst steht vor dem Dienst");

  const c = sim.exec("curl http://werft-dienst");
  assert.ok(!c.error, "der eigene Dienst ist erreichbar");
  assert.match(c.output!, /200 OK/);
});

test("Red-Green: Greta-Drills lehnen falsche Eingaben ab", () => {
  // werft-build: ein docker pull (fremdes Image holen) ist KEIN docker build (eigenes bauen).
  const build = KQContent.DRILLS["werft-build"](new KQSim({}));
  const buildSol = norm(build.solution); // "docker build --tag <name>:1.0 ."
  assert.ok(build.accept.some(re => re.test(buildSol)), "die werft-build-Musterlösung gilt");
  assert.ok(!build.accept.some(re => re.test(buildSol.replace(/\s+\.$/, ""))), "ohne den Build-Kontext-Punkt zählt es NICHT");
  assert.ok(!build.accept.some(re => re.test("docker pull " + buildSol.split(/\s+/)[3])), "docker pull ist kein docker build");

  // werft-deploy-imagepull ist dateigenau: ein get statt apply darf NICHT zählen.
  const deploy = KQContent.DRILLS["werft-deploy-imagepull"](new KQSim({}));
  assert.ok(deploy.accept.some(re => re.test(norm(deploy.solution))), "die werft-deploy-Musterlösung gilt");
  assert.ok(!deploy.accept.some(re => re.test("kubectl get pods")), "get pods ist kein apply");

  // werft-rollout-heal: ein anderer Dienst-Name darf NICHT akzeptiert werden.
  const heal = KQContent.DRILLS["werft-rollout-heal"](new KQSim({}));
  const healSol = norm(heal.solution); // "kubectl rollout restart deployment <name>"
  assert.ok(heal.accept.some(re => re.test(healSol)), "der gefragte Dienst ist richtig");
  assert.ok(!heal.accept.some(re => re.test(healSol.replace(/\S+$/, "fremder-dienst"))), "ein anderer Dienst-Name zählt NICHT");

  // werft-curl: curl auf einen anderen Service-Namen darf NICHT zählen.
  const curl = KQContent.DRILLS["werft-curl"](new KQSim({}));
  const curlSol = norm(curl.solution); // "curl http://<name>"
  assert.ok(curl.accept.some(re => re.test(curlSol)), "die werft-curl-Musterlösung gilt");
  assert.ok(!curl.accept.some(re => re.test("curl http://gibtsnicht")), "ein anderer Service-Name zählt NICHT");
});
