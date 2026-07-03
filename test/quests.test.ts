/* Durchspiel-Test: spielt ALLE Quest-Schritte (teach/drill/terminal) in
 * Story-Reihenfolge gegen eine dauerhafte Welt – wie im echten Spiel.
 * Ausführen mit:  node --test test/
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { KQContent } from "../src/content";
import { freshSim } from "./factories/sim";

function resolvePlaceholder(cmd: string, sim: KQSim) {
  if (!cmd.includes("<")) return cmd;
  const findPod = (prefix: string) => {
    const dep = sim.deployments.find(d => d.name === prefix) || sim.deployments[0];
    return dep.pods[0].name;
  };
  if (/leuchtfeuer/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("leuchtfeuer"));
  if (/funkboje/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("funkboje"));
  if (/frachtplaner/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("frachtplaner"));
  if (/kombuese/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("kombuese"));
  if (/kartograf/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("kartograf"));
  if (/signalgeber/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("signalgeber"));
  if (/bakenbote/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("bakenbote"));
  if (/wachposten/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("wachposten"));
  if (/zwischenlager/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("zwischenlager"));
  if (/wildwuchs/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("wildwuchs"));
  if (/vorbereiter/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("vorbereiter")); // #485 initContainer
  if (/doppelt/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("doppelt"));         // #485 Doppelablage
  if (/direkt/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("direkt"));           // #485 direkt ins emptyDir
  if (/describe/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("kantine"));
  if (/delete pod/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("kasse"));
  if (/docker stop/.test(cmd)) {
    const c = sim.docker.containers.find(c => c.running);
    return cmd.replace(/<[^>]+>/, c ? c.name : "fehlt");
  }
  return cmd;
}

/** Gemeinsamer Nenner aus Teach-Befehl, Terminal-Aufgabe und Drill-Aufgabe –
 *  genau die Felder, die runTask braucht (check ist nur bei Quest-Aufgaben da). */
type RunnableTask = { accept: RegExp[]; solution: string; check?: (sim: KQSim) => unknown };

function runTask(sim: KQSim, task: RunnableTask, label: string) {
  const cmd = resolvePlaceholder(task.solution, sim);
  const norm = cmd.trim().replace(/\s+/g, " ");
  const result = sim.exec(cmd);
  assert.ok(task.accept.some((re: RegExp) => re.test(norm)), label + ": Lösung matcht Regex nicht: " + norm);
  assert.ok(!result.error, label + ": Simulator-Fehler: " + result.output);
  assert.ok(!task.check || task.check(sim), label + ": check() nicht erfüllt");
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** #603: Aus einer *aufgelösten, gültigen* Musterlösung eine Handvoll naheliegender,
 *  fachlich FALSCHER Eingaben ableiten – minimal-invasiv (nur die Aktion bzw. ein Wert
 *  wird falsch, alles andere bleibt gültig), damit die Ablehnung eindeutig an der
 *  Verfälschung hängt und nicht an einem Nebeneffekt. Der Kern ist die Aktion (Verb):
 *  `delete` statt `get`, `--ours` statt `--theirs` usw. – genau die Verwechslungen, die
 *  eine zu weite accept-Regex durchwinken würde. */
function plausibleWrong(cmd: string): { id: string; variant: string }[] {
  const out: { id: string; variant: string }[] = [];
  const add = (id: string, variant: string) => {
    if (variant && variant !== cmd) out.push({ id, variant });
  };

  // 1) Falsche Werte bei gleicher Befehlsform (fachlich falsch, syntaktisch nah).
  const rep = cmd.match(/--replicas[=\s](\d+)/);
  if (rep) add("replicas-wert", cmd.replace(/--replicas([=\s])\d+/, (_m, s: string) => `--replicas${s}${rep[1] === "0" ? "3" : "0"}`));
  if (/--port[=\s]\d+/.test(cmd)) add("port-wert", cmd.replace(/--port([=\s])\d+/, (_m, s: string) => `--port${s}9999`));
  if (/--image[=\s]\S+/.test(cmd)) add("image-falsch", cmd.replace(/--image([=\s])\S+/, (_m, s: string) => `--image${s}mysql`));
  if (/--from[=\s]secret\//.test(cmd)) add("from-configmap", cmd.replace(/--from([=\s])secret\//, (_m, s: string) => `--from${s}configmap/`));
  if (/\bgit checkout --theirs\b/.test(cmd)) add("theirs->ours", cmd.replace("--theirs", "--ours"));

  // 2) Falsche Aktion (Verb) – der Kern des Tickets ("delete statt get").
  const KVERB: Record<string, string> = {
    get: "delete", describe: "delete", apply: "delete", create: "delete", logs: "delete",
    delete: "get", expose: "get", scale: "get", set: "get", top: "get",
  };
  const kv = cmd.match(/^kubectl\s+(get|describe|apply|create|delete|expose|scale|set|top|logs)\b/);
  if (kv && KVERB[kv[1]]) add("kubectl-verb", cmd.replace(new RegExp("^kubectl\\s+" + kv[1] + "\\b"), "kubectl " + KVERB[kv[1]]));
  if (/^kubectl\s+auth\s+can-i\s+(get|list|create|delete|watch)\b/.test(cmd)) {
    add("cani-verb", cmd.replace(/(auth\s+can-i\s+)(get|list|create|delete|watch)\b/, (_m, p: string, v: string) => p + (v === "get" ? "delete" : "get")));
  }
  if (/^kubectl\s+rollout\s+(restart|status|undo|history|pause|resume)\b/.test(cmd)) {
    add("rollout-verb", cmd.replace(/(rollout\s+)(restart|status|undo|history|pause|resume)\b/, (_m, p: string, v: string) => p + (v === "restart" ? "status" : "restart")));
  }
  if (/^docker\s+build\b/.test(cmd)) add("docker-build->run", cmd.replace(/^docker\s+build\b/, "docker run"));
  if (/^git\s+status\b/.test(cmd)) add("git-status->log", cmd.replace(/^git\s+status\b/, "git log"));
  if (/^git\s+add\b/.test(cmd)) add("git-add->rm", cmd.replace(/^git\s+add\b/, "git rm"));
  if (/^git\s+commit\b/.test(cmd)) add("git-commit-ohne-msg", "git commit");
  if (/^terraform\s+state\s+list\b/.test(cmd)) add("tf-state-list->rm", cmd.replace(/^terraform\s+state\s+list\b/, "terraform state rm"));
  else if (/^terraform\s+output\b/.test(cmd)) add("tf-output->plan", cmd.replace(/^terraform\s+output\b/, "terraform plan"));
  else if (/^terraform\s+(plan|init|apply)\b/.test(cmd)) add("tf-verb->destroy", cmd.replace(/^terraform\s+(plan|init|apply)\b/, "terraform destroy"));
  if (/^argocd\s+app\s+(get|list|ls)\b/.test(cmd)) add("argocd-verb", cmd.replace(/^argocd\s+app\s+(get|list|ls)\b/, "argocd app delete"));
  if (/^aws\s+s3\s+ls\b/.test(cmd)) add("s3-ls->rm", cmd.replace(/^aws\s+s3\s+ls\b/, "aws s3 rm"));
  if (/^nslookup\s+\S+/.test(cmd)) add("nslookup-host", cmd.replace(/^nslookup\s+\S+/, "nslookup nichtvorhanden"));
  if (/^cat\s+\S+$/.test(cmd)) add("cat-falsche-datei", "cat falsche-datei.xyz");
  if (/^ls$/.test(cmd)) add("ls-extra", "ls -la");

  return out;
}

test("Komplette Story ist mit den Musterlösungen durchspielbar", () => {
  const sim = new KQSim({});
  for (const quest of KQContent.QUESTS) {
    for (const step of quest.steps) {
      if (step.scenario) sim.mergeScenario(step.scenario);
      if (step.type === "teach") {
        runTask(sim, step.cmd, quest.id + "/" + step.cmd.id);
      } else if (step.type === "terminal") {
        for (const task of step.tasks) runTask(sim, task, quest.id + "/" + task.id);
      } else if (step.type === "drill") {
        for (let i = 0; i < step.count; i++) {
          const drillId = step.pool[i % step.pool.length];
          runTask(sim, KQContent.DRILLS[drillId](sim), quest.id + "/drill:" + drillId);
        }
      }
    }
  }
});

test("Alle Drill-Generatoren liefern lösbare Zufallsaufgaben (je 5x)", () => {
  const sim = new KQSim({});
  sim.exec("kubectl create deployment kantine --image=nginx");
  for (const [id, gen] of Object.entries(KQContent.DRILLS)) {
    for (let i = 0; i < 5; i++) {
      const task = gen(sim);
      assert.ok(task.text && task.hint && task.solution, "Drill " + id + ": Felder fehlen");
      runTask(sim, task, "DRILL " + id + " #" + i);
    }
  }
});

test("Sturm-Szenario: Buchstabendreher-Image lässt sich immer heilen", () => {
  // simuliert, was das Sturm-Event im Spiel anrichtet
  for (const img of ["nginx", "redis", "httpd", "postgres", "rabbitmq", "aa", "abba"]) {
    const sim = new KQSim({});
    sim.exec("kubectl create deployment app --image=" + img);
    const dep = sim.deployments[0];
    const bad = KQContent.corruptImage(img);
    dep.broken = { type: "imagepull", badImage: bad };
    dep.image = bad;
    assert.notEqual(bad, img, img + ": der Buchstabendreher verändert den Namen wirklich");
    sim.exec("kubectl set image deployment/app app=" + img);
    assert.equal(dep.broken, null, img + ": Heilung klappt");
  }
});

/* #603: Gegenstück zum Positiv-Durchspiel oben. Der Durchspiel-Test beweist, dass die
 * Musterlösung akzeptiert wird; hier beweisen wir SYSTEMATISCH JE TERMINAL-AUFGABE, dass
 * eine naheliegende, fachlich falsche Eingabe ABGELEHNT wird (z.B. `delete` statt `get`).
 * So fällt eine zu weite accept-Regex auf, die versehentlich auch eine falsche Aktion
 * durchwinkt (die Superset-Stichprobe in content.test.ts deckt nur einzelne Fälle ab).
 * Die Story wird wie im Durchspiel real durchlaufen, damit die verfälschte Eingabe sich
 * nur in der Aktion/dem Wert von der AUFGELÖSTEN, sonst gültigen Lösung unterscheidet. */
test("Jede Quest-Terminal-Aufgabe lehnt eine naheliegende Falscheingabe ab (#603)", () => {
  // freshSim() seedet den globalen Zufallsstrom fest (#492) → Node-Platzierung/Eviction
  // reproduzierbar und von der Testreihenfolge unabhängig (sonst evictet direkt zufällig).
  const sim = freshSim();
  const uncovered: string[] = [];
  const fehler: string[] = [];
  for (const quest of KQContent.QUESTS) {
    for (const step of quest.steps) {
      if (step.scenario) sim.mergeScenario(step.scenario);
      if (step.type === "teach") {
        runTask(sim, step.cmd, quest.id + "/" + step.cmd.id);
      } else if (step.type === "drill") {
        for (let i = 0; i < step.count; i++) {
          const drillId = step.pool[i % step.pool.length];
          runTask(sim, KQContent.DRILLS[drillId](sim), quest.id + "/drill:" + drillId);
        }
      } else if (step.type === "terminal") {
        for (const task of step.tasks) {
          const label = quest.id + "/" + task.id;
          const cmd = norm(resolvePlaceholder(task.solution, sim));
          // Sanity: die aufgelöste Lösung gilt (sonst wäre die Verfälschung nicht aussagekräftig).
          assert.ok(task.accept.some(re => re.test(cmd)), label + ": Lösung matcht Regex nicht: " + cmd);
          // Negativ: jede naheliegende Falscheingabe muss abgelehnt werden.
          const variants = plausibleWrong(cmd);
          if (variants.length === 0) uncovered.push(label + ": " + cmd);
          for (const v of variants) {
            if (task.accept.some(re => re.test(norm(v.variant)))) {
              fehler.push(`${label}: „${v.variant}" (${v.id}) wird zu Unrecht akzeptiert (Lösung: „${cmd}")`);
            }
          }
          // Weltzustand wie im echten Spiel fortschreiben.
          const result = sim.exec(cmd);
          assert.ok(!result.error, label + ": Simulator-Fehler: " + result.output);
          assert.ok(!task.check || task.check(sim), label + ": check() nicht erfüllt");
        }
      }
    }
  }
  // Keine stille Lücke: jede Terminal-Aufgabe braucht mindestens eine Falsch-Variante,
  // sonst wächst neuer Content unbemerkt ohne Negativ-Netz (Stardew-Scope). Neue
  // Befehlsform → neuen Mutator in plausibleWrong ergänzen.
  assert.deepEqual(uncovered, [], "Terminal-Aufgaben ohne Negativ-Abdeckung (Mutator ergänzen):\n" + uncovered.join("\n"));
  assert.deepEqual(fehler, [], "Zu weite accept-Regex – naheliegende Falscheingabe durchgewunken:\n" + fehler.join("\n"));
});

test("#603 Negativ-Netz ist scharf: es unterscheidet zu-weit von scharf (Red-Green)", () => {
  // Ein Netz, das auch bei einer kaputten (zu weiten) Regex grün bliebe, wäre wertlos.
  const variants = plausibleWrong("kubectl get pods").map(v => v.variant);
  assert.ok(variants.includes("kubectl delete pods"), "erwartete Falscheingabe fehlt: " + variants.join(", "));
  // Eine zu weite Regex (Verb egal) würde die Falscheingabe akzeptieren → das Netz meldet es.
  const zuWeit = [/^kubectl\s+\w+\s+pods$/];
  assert.ok(variants.some(v => zuWeit.some(re => re.test(v))), "zu weite Regex müsste getroffen werden");
  // Die echte, scharfe Regex akzeptiert KEINE der Falscheingaben.
  const scharf = [/^kubectl\s+get\s+(pods|pod|po)$/];
  assert.ok(variants.every(v => !scharf.some(re => re.test(v))), "scharfe Regex darf keine Falscheingabe akzeptieren");
});
