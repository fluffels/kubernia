/* Phase 6 – Wachturm-Quartier (#136): gezielte Tests für die RBAC-/Security-Drills
 * (Vidars Übungs-Pool) und ihr PRACTICE-Mapping, ergänzend zu den breiten
 * Durchspiel-/Struktur-Tests (quests.test.ts, content.test.ts).
 *
 * Schwerpunkte:
 *  1. Vidars Übungs-Pool ist sauber verdrahtet: NPC + Drills + after-Quests existieren.
 *  2. Jeder Vidar-Drill liefert eine lösbare Aufgabe – accept matcht solution, Sim ohne
 *     Fehler, auch über viele Zufallsziehungen (Zufallsnamen dürfen nie brechen).
 *  3. Kein Drill vergiftet die GETEILTE Sim: der ganze Pool läuft nacheinander gegen EINE
 *     Sim ohne Fehler – die enforce=restricted-Übung blockiert die spätere harden-Übung NICHT.
 *  4. Red-Green: bewusst falsche Eingaben werden NICHT akzeptiert.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { KQContent } from "../src/content";

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** Die Quests, nach denen Vidars Drills freigeschaltet werden. */
const VIDAR_QUESTS = ["k8s-serviceaccount", "k8s-rbac-role", "k8s-rbac-clusterrole", "k8s-pod-security"];

test("Vidar-Übungs-Pool ist sauber verdrahtet (NPC, Drills, after-Quests existieren)", () => {
  const pool = KQContent.PRACTICE.vidar;
  assert.ok(pool && pool.length > 0, "Vidar hat einen Übungs-Pool");
  assert.ok(KQContent.NPCS.vidar, "NPC vidar existiert");
  for (const { drill, after } of pool) {
    assert.ok(KQContent.DRILLS[drill], "Drill-Generator existiert: " + drill);
    assert.ok(VIDAR_QUESTS.includes(after), drill + ": after zeigt auf eine Wachturm-Quest, nicht " + after);
    assert.ok(KQContent.QUESTS.some(q => q.id === after), drill + ": after-Quest existiert: " + after);
  }
});

test("Phase 6: alle Vidar-Drills liefern lösbare Aufgaben (accept matcht solution, Sim ok)", () => {
  for (const { drill } of KQContent.PRACTICE.vidar) {
    const gen = KQContent.DRILLS[drill];
    assert.ok(gen, "Drill-Generator existiert: " + drill);
    // mehrfach erzeugen: Zufallsnamen/-paare dürfen die Lösbarkeit nie brechen
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

test("Phase 6: der ganze Vidar-Pool läuft gegen EINE geteilte Sim ohne Fehler (keine Vergiftung)", () => {
  // Wie quests.test.ts, aber gezielt: alle Vidar-Drills nacheinander gegen dieselbe,
  // akkumulierende Sim. Beweist, dass enforce=restricted die nachfolgende harden-Übung
  // (gehärteter Pod) nicht an der Admission scheitern lässt.
  const sim = new KQSim({});
  for (const { drill } of KQContent.PRACTICE.vidar) {
    const t = KQContent.DRILLS[drill](sim);
    const r = sim.exec(t.solution);
    assert.ok(!r.error, drill + " (geteilte Sim): Sim-Fehler: " + r.output);
  }
});

test("Phase 6: nach enforce=restricted wird ein GEHÄRTETER Pod zugelassen, ein ROHER abgewiesen", () => {
  const sim = new KQSim({});
  // enforce-Drill scharf schalten
  const enforce = KQContent.DRILLS["pod-security-enforce"](sim);
  assert.ok(!sim.exec(enforce.solution).error, "enforce-Befehl läuft fehlerfrei");
  assert.equal(sim.podSecurity, "restricted", "Stufe steht nach der Übung auf restricted");

  // harden-Drill: gehärteter Pod muss durchkommen
  const harden = KQContent.DRILLS["pod-security-harden"](sim);
  assert.ok(!sim.exec(harden.solution).error, "gehärteter Pod wird unter restricted zugelassen");

  // Gegenprobe: ein roher, imperativ erzeugter Pod wird unter restricted abgewiesen.
  const rough = sim.exec("kubectl create deployment roh-posten --image=nginx");
  assert.ok(rough.error, "roher Pod wird unter restricted abgewiesen");
});

test("Red-Green: Vidar-Drills lehnen falsche Eingaben ab", () => {
  const sim = new KQSim({});

  // enforce verlangt GENAU restricted – baseline/privileged dürfen nicht zählen
  const enforce = KQContent.DRILLS["pod-security-enforce"](sim);
  assert.ok(enforce.accept.some(re => re.test(norm(enforce.solution))), "restricted ist richtig");
  assert.ok(!enforce.accept.some(re => re.test("kubectl label namespace default pod-security.kubernetes.io/enforce=baseline")), "baseline darf hier NICHT zählen");

  // auth can-i: ein anderes Subjekt als gefragt darf nicht akzeptiert werden
  const cani = KQContent.DRILLS["rbac-can-i"](sim);
  assert.ok(cani.accept.some(re => re.test(norm(cani.solution))), "die gefragte can-i-Frage ist richtig");
  assert.ok(!cani.accept.some(re => re.test(norm(cani.solution).replace("wachdienst", "admin"))), "ein anderes Subjekt darf NICHT zählen");

  // apply-Drills sind dateigenau: die rolebinding-Datei zählt nicht für den role-Drill
  const role = KQContent.DRILLS["rbac-apply-role"](new KQSim({}));
  assert.ok(!role.accept.some(re => re.test("kubectl apply --filename rolebinding.yaml")), "rolebinding.yaml ist kein role.yaml");

  // create serviceaccount: ein nicht gelehrtes Extra-Flag (Superset) wird abgelehnt
  const sa = KQContent.DRILLS["rbac-sa-create"](new KQSim({}));
  assert.ok(sa.accept.some(re => re.test(norm(sa.solution))), "die Musterlösung gilt");
  assert.ok(!sa.accept.some(re => re.test(norm(sa.solution) + " --namespace=prod")), "ein zusätzliches --namespace wird abgelehnt");
});
