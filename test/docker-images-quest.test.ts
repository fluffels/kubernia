/* Docker-Images-Warenkunde-Quest (#448) – gezielte Tests für die neue Bo-Quest
 * `docker-common-images`, den Einstieg des Docker-Images-Arcs.
 *
 * Sie erklärt, WOFÜR die drei Standard-Images stehen, die Bo bisher nur kurz
 * erwähnte: BusyBox (winzige Allzweck-Kiste), Redis (In-Memory-Cache) und
 * Postgres (relationale Datenbank). Ergänzend zur breiten Durchspiel-Abdeckung
 * (quests.test.ts) wird hier abgesichert:
 *  1. Struktur: Geber/Thema/Platz in der Lernreihenfolge.
 *  2. Akzeptanzkriterien des Tickets: mind. ein `docker run`-Schritt pro Image,
 *     Drills + Quiz-Karten für die drei Images vorhanden.
 *  3. Jede Musterlösung matcht ihre accept-Regex UND läuft fehlerfrei in der Sim.
 *  4. Red-Green: ein falsches Image wird von den Image-Drills wirklich abgelehnt.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { KQContent } from "../src/content";

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
const QUEST = "docker-common-images";
const IMAGES = ["busybox", "redis", "postgres"];

test("#448 Warenkunde-Quest: Geber Bo, Thema docker, sauber verdrahtet", () => {
  const q = KQContent.QUESTS.find(x => x.id === QUEST);
  assert.ok(q, "Quest existiert: " + QUEST);
  assert.equal(q!.giver, "bo", "Geber ist Bo");
  assert.equal(q!.topic, "docker", "Thema ist docker");
  const choices = q!.steps.filter(s => s.type === "choice");
  assert.ok(choices.length >= 1, "hat mindestens eine Choice");
  for (const ch of choices) {
    if (ch.type !== "choice") continue;
    assert.equal(ch.options.filter(o => o.ok).length, 1, "jede Choice hat genau EINE richtige Antwort");
    assert.ok(KQContent.CRAB_QUIZ.some(c => c.id === ch.reviewId), "reviewId zeigt auf eine echte Quiz-Karte: " + ch.reviewId);
  }
});

test("#448 Warenkunde-Quest: steht in der Lernreihenfolge zwischen erster Kiste und Überblick", () => {
  const order = KQContent.QUESTS.map(q => q.id);
  const idx = (id: string) => order.indexOf(id);
  assert.ok(idx("docker-first-container") < idx(QUEST), "nach docker-first-container (docker run ist eingeführt)");
  assert.ok(idx(QUEST) < idx("docker-list-containers"), "vor docker-list-containers");
});

test("#448 AK: mind. ein `docker run`-Schritt pro Image (busybox/redis/postgres) – matcht + läuft", () => {
  const q = KQContent.QUESTS.find(x => x.id === QUEST)!;
  const sim = new KQSim({});
  const ranImages = new Set<string>();
  for (const step of q.steps) {
    if (step.type !== "teach") continue;
    const c = step.cmd;
    const sol = norm(c.solution);
    assert.ok(c.accept.some(re => re.test(sol)), QUEST + "/" + c.id + ": accept matcht solution nicht: " + sol);
    assert.ok(!sim.exec(c.solution).error, QUEST + "/" + c.id + ": Sim-Fehler bei " + c.solution);
    const m = sol.match(/^docker run (\S+)$/);
    if (m) ranImages.add(m[1].split(":")[0]);
  }
  for (const img of IMAGES) assert.ok(ranImages.has(img), "es gibt einen `docker run " + img + "`-Schritt");
});

test("#448 AK: Drills für die drei Images existieren, hängen an der Quest und akzeptieren ihre Lösung", () => {
  const drills = ["docker-run-busybox", "docker-run-redis", "docker-run-postgres"];
  const pool = KQContent.PRACTICE.bo;
  for (const d of drills) {
    const make = KQContent.DRILLS[d];
    assert.ok(make, "Drill existiert: " + d);
    const task = make(new KQSim({}));
    assert.ok(task.accept.some(re => re.test(norm(task.solution))), d + ": accept matcht eigene solution nicht");
    assert.ok(task.why, d + ": Begründung (why) fehlt");
    assert.ok(pool.some(p => p.drill === d && p.after === QUEST), d + ": fehlt in Bos Übungs-Pool nach " + QUEST);
  }
});

test("#448 Red-Green: Image-Drills lehnen ein falsches/anderes Image ab", () => {
  const wrong: Record<string, string> = {
    "docker-run-busybox": "docker run redis",
    "docker-run-redis": "docker run postgres",
    "docker-run-postgres": "docker run busybox",
  };
  for (const [drill, bad] of Object.entries(wrong)) {
    const task = KQContent.DRILLS[drill](new KQSim({}));
    assert.ok(!task.accept.some(re => re.test(norm(bad))), drill + ": falsches Image (" + bad + ") darf NICHT akzeptiert werden");
  }
});

test("#448 AK: Quiz-Karten für die drei Images vorhanden (Redis/Postgres/Matching)", () => {
  for (const id of ["q-ch1-11", "q-ch1-12", "q-ch1-13"]) {
    assert.ok(KQContent.CRAB_QUIZ.some(c => c.id === id), "Quiz-Karte existiert: " + id);
  }
  // q-ch1-11/12 hängen per chapter an der Quest, q-ch1-13 wird per reviewId erreicht.
  const byId = (id: string) => KQContent.CRAB_QUIZ.find(c => c.id === id)!;
  assert.equal(byId("q-ch1-11").chapter, QUEST, "q-ch1-11 (Redis) hängt an der Quest");
  assert.equal(byId("q-ch1-12").chapter, QUEST, "q-ch1-12 (Postgres) hängt an der Quest");
});
