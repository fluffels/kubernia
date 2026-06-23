/* Phase 7 – Lagerhallen-Viertel (#145): gezielte Tests für die stateful-Workload-/
 * Speicher-Quests (Knut) + seinen Übungs-Pool, ergänzend zu den breiten Durchspiel-/
 * Struktur-Tests (quests.test.ts, content.test.ts) und der reinen Sim-Mechanik
 * (stateful.test.ts). Vorbild: rbac-drills.test.ts (Phase 6).
 *
 * Schwerpunkte:
 *  1. Knuts Übungs-Pool ist sauber verdrahtet: NPC + Drills + after-Quests existieren.
 *  2. Jeder Knut-Drill liefert eine lösbare Aufgabe – auch über viele Zufallsziehungen.
 *  3. Kein Drill vergiftet die GETEILTE Sim: der ganze Pool läuft nacheinander gegen EINE Sim.
 *  4. Der Diagnose-Drill pvc-pending lässt wirklich ein Pending-PVC zurück (echter Negativfall).
 *  5. Der Storage-Quest-Arc spielt komplett durch und pinnt den End-Zustand
 *     (StatefulSet stabil, PVC Bound, Backup überlebt den Verlust, Restore bringt Daten zurück).
 *  6. Red-Green: bewusst falsche Eingaben werden NICHT akzeptiert.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { KQContent } from "../src/content";

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** Die Quests, nach denen Knuts Drills freigeschaltet werden. */
const KNUT_QUESTS = ["storage-statefulset", "storage-pvc", "storage-backup-restore"];

test("Knut-Übungs-Pool ist sauber verdrahtet (NPC, Drills, after-Quests existieren)", () => {
  const pool = KQContent.PRACTICE.knut;
  assert.ok(pool && pool.length > 0, "Knut hat einen Übungs-Pool");
  assert.ok(KQContent.NPCS.knut, "NPC knut existiert");
  for (const { drill, after } of pool) {
    assert.ok(KQContent.DRILLS[drill], "Drill-Generator existiert: " + drill);
    assert.ok(KNUT_QUESTS.includes(after), drill + ": after zeigt auf eine Storage-Quest, nicht " + after);
    assert.ok(KQContent.QUESTS.some(q => q.id === after), drill + ": after-Quest existiert: " + after);
  }
});

test("Phase 7: alle Knut-Drills liefern lösbare Aufgaben (accept matcht solution, Sim ok)", () => {
  for (const { drill } of KQContent.PRACTICE.knut) {
    const gen = KQContent.DRILLS[drill];
    assert.ok(gen, "Drill-Generator existiert: " + drill);
    // mehrfach erzeugen: Zufallsnamen dürfen die Lösbarkeit nie brechen
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

test("Phase 7: der ganze Knut-Pool läuft gegen EINE geteilte Sim ohne Fehler (keine Vergiftung)", () => {
  // Wie quests.test.ts, aber gezielt: alle Knut-Drills nacheinander gegen dieselbe,
  // akkumulierende Sim. Beweist u.a., dass der pvc-pending-Negativfall (ein hängendes PVC)
  // die nachfolgenden get-/apply-Übungen NICHT scheitern lässt.
  const sim = new KQSim({});
  for (const { drill } of KQContent.PRACTICE.knut) {
    const t = KQContent.DRILLS[drill](sim);
    const r = sim.exec(t.solution);
    assert.ok(!r.error, drill + " (geteilte Sim): Sim-Fehler: " + r.output);
  }
});

test("Phase 7: der Diagnose-Drill pvc-pending lässt wirklich ein Pending-PVC zurück (echter Negativfall)", () => {
  // Sonst wäre der „kein Fehler"-Lauf oben ein False Positive: die Übung soll ein hängendes
  // PVC erzeugen, das der Spieler über die STATUS-Spalte als Pending diagnostiziert.
  const sim = new KQSim({});
  const before = sim.pvcs.length;
  const t = KQContent.DRILLS["pvc-pending"](sim);
  assert.ok(!sim.exec(t.solution).error, "kubectl get pvc selbst darf nicht fehlschlagen");
  const pending = sim.pvcs.filter(p => p.status === "Pending");
  assert.equal(sim.pvcs.length, before + 1, "genau ein zusätzliches (hängendes) PVC angelegt");
  assert.equal(pending.length, 1, "und das ist Pending – sonst wäre die Diagnose-Übung sinnlos");
  assert.equal(pending[0].volume, "", "kein Volume gebunden");
  assert.match(sim.exec("kubectl get pvc").output!, new RegExp(pending[0].name + "\\s+Pending"));
});

/** Spielt eine Storage-Quest Schritt für Schritt gegen die laufende Sim und prüft dabei,
 *  dass Geber/Thema stimmen, jede Musterlösung akzeptiert + fehlerfrei läuft, ihr `check`
 *  erfüllt ist und jede Choice genau eine richtige Antwort hat. */
function playQuest(sim: KQSim, questId: string) {
  const quest = KQContent.QUESTS.find(q => q.id === questId);
  assert.ok(quest, "Quest existiert: " + questId);
  assert.equal(quest!.giver, "knut", questId + ": Geber ist Knut");
  assert.equal(quest!.topic, "storage", questId + ": Thema ist storage");
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

test("Phase 7: der Storage-Quest-Arc spielt durch und pinnt den End-Zustand", () => {
  const sim = new KQSim({});

  // StatefulSet-Quest: am Ende ein StatefulSet mit stabilen, durchnummerierten Pods.
  playQuest(sim, "storage-statefulset");
  const sts = sim.statefulSets.find(s => s.name === "speicher-datenbank");
  assert.ok(sts, "StatefulSet speicher-datenbank existiert nach der Quest");
  assert.ok(sts!.pods.some(p => p.name === "speicher-datenbank-0"), "stabiler Pod -0 ist da (auch nach dem Lösch-Beweis)");
  assert.ok(sim.pvcs.some(p => p.name.startsWith("daten-speicher-datenbank-") && p.status === "Bound"), "je Replica ein gebundenes PVC");

  // PVC-Quest: am Ende ist lager-daten Bound und überlebt den Workload-Abriss.
  playQuest(sim, "storage-pvc");
  const lager = sim.pvcs.find(p => p.name === "lager-daten");
  assert.ok(lager && lager.status === "Bound", "PVC lager-daten ist Bound");
  assert.ok(!sim.deployments.some(d => d.name === "datenbank"), "der Workload wurde wieder abgerissen – die Daten blieben");

  // Backup & Restore: nach dem Ernstfall ist kai-datenbank wiederhergestellt, der Snapshot überlebte.
  playQuest(sim, "storage-backup-restore");
  const restored = sim.pvcs.find(p => p.name === "kai-datenbank");
  assert.ok(restored, "kai-datenbank ist nach dem Restore wieder da");
  assert.equal(restored!.data, "stammkundenverzeichnis", "die gesicherten Daten sind zurück");
  assert.ok(sim.volumeSnapshots.some(v => v.name === "kai-datenbank-snap" && v.readyToUse), "der Snapshot überlebte den Verlust des Quell-PVC");

  // Die reine Entscheidungs-Quest: nur Struktur (Choices), keine Sim-Aktion.
  playQuest(sim, "storage-prod-db-decision");
});

test("Red-Green: Knut-Drills lehnen falsche Eingaben ab", () => {
  // sts-apply ist dateigenau: eine andere Manifest-Datei zählt nicht.
  const sts = KQContent.DRILLS["sts-apply"](new KQSim({}));
  assert.ok(sts.accept.some(re => re.test(norm(sts.solution))), "die sts-apply-Musterlösung gilt");
  assert.ok(!sts.accept.some(re => re.test("kubectl apply --filename pvc.yaml")), "pvc.yaml ist kein statefulset.yaml");

  // pvc-apply: ein get statt apply darf NICHT zählen.
  const pvc = KQContent.DRILLS["pvc-apply"](new KQSim({}));
  assert.ok(pvc.accept.some(re => re.test(norm(pvc.solution))), "die pvc-apply-Musterlösung gilt");
  assert.ok(!pvc.accept.some(re => re.test("kubectl get pvc")), "get pvc ist kein apply");

  // sts-delete-pod: ein anderer Pod-Index darf NICHT akzeptiert werden.
  const del = KQContent.DRILLS["sts-delete-pod"](new KQSim({}));
  const sol = norm(del.solution); // "kubectl delete pod <name>-0"
  assert.ok(del.accept.some(re => re.test(sol)), "der gefragte Pod (-0) ist richtig");
  assert.ok(!del.accept.some(re => re.test(sol.replace(/-0$/, "-1"))), "ein anderer Pod-Index (-1) zählt NICHT");

  // snap-restore ist dateigenau: das Backup-Manifest ist kein Restore-Manifest.
  const restore = KQContent.DRILLS["snap-restore"](new KQSim({}));
  assert.ok(restore.accept.some(re => re.test(norm(restore.solution))), "die snap-restore-Musterlösung gilt");
  assert.ok(!restore.accept.some(re => re.test("kubectl apply --filename snapshot.yaml")), "snapshot.yaml ist kein restore.yaml");
});
