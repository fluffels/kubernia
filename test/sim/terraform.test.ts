/* Unit-Tests: terraform-Befehlsfamilie (sim/terraform.ts) – Teil des sim.test.ts-Splits (#383).
 * init→plan→apply→destroy + das terraform-getriebene Einplanen von Pending-Pods
 * (neue Nodes). Seit #146 zusätzlich: Module (wiederverwendbare Bausteine), Remote State
 * (backend + State-Locking) und Provider sowie deklarierte Outputs – inkl. Fehlerfälle
 * (Backend nicht initialisiert, unbekannter Provider/Modul, gesperrter State).
 * Fahren über sim.exec("…"); gemeinsame Fixtures in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";
import { KQContent } from "../../src/content";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

test("terraform: Zyklus init→plan→apply→destroy, apply fügt Nodes hinzu", () => {
  sim.tf.resources = [{ addr: "hafen_server.worker[0]", desc: "x" }];
  assert.match(sim.exec("terraform plan").output!, /init/i, "plan ohne init wird abgelehnt");
  sim.exec("terraform init");
  assert.match(sim.exec("terraform plan").output!, /1 to add/);
  sim.exec("terraform apply");
  assert.equal(sim.nodes.length, 5, "neue Server werden Cluster-Nodes");
  assert.match(sim.exec("terraform plan").output!, /No changes/);
  sim.exec("terraform destroy");
  assert.equal(sim.nodes.length, 3);
});

test("troubleshooting: Pending heilt durch neue Nodes (Terraform)", () => {
  sim.mergeScenario({
    deployments: [{ name: "app", image: "nginx", replicas: 1, broken: { type: "pending" } }],
    tfResources: [{ addr: "hafen_server.worker[0]", desc: "x" }],
  });
  assert.match(sim.exec("kubectl get pods").output!, /Pending/);
  sim.exec("terraform init");
  sim.exec("terraform apply");
  assert.equal(sim.deployments[0].broken, null, "mit neuen Nodes wird der Pod eingeplant");
});

/* ===== Module – wiederverwendbarer Baustein erzeugt mehrere Ressourcen (#146) ===== */

test("terraform: Modul wird von init geholt und expandiert zu mehreren Ressourcen", () => {
  sim.mergeScenario({
    tfModules: [{ name: "hafen-anlage", source: "./modules/hafen", resources: ["kran", "lager", "kai"] }],
  });
  // Vor init ist das Modul noch nicht geholt.
  assert.equal(sim.tf.modules[0].fetched, false);
  const init = sim.exec("terraform init").output!;
  assert.match(init, /Initializing modules/);
  assert.match(init, /hafen-anlage in \.\/modules\/hafen/);
  assert.equal(sim.tf.modules[0].fetched, true, "init holt das Modul");
  // plan zählt alle drei Modul-Ressourcen.
  const plan = sim.exec("terraform plan").output!;
  assert.match(plan, /module\.hafen-anlage\.kran/);
  assert.match(plan, /3 to add/);
  // apply legt sie an, state list führt sie auf.
  sim.exec("terraform apply");
  const list = sim.exec("terraform state list").output!;
  assert.match(list, /module\.hafen-anlage\.lager/);
  assert.match(list, /module\.hafen-anlage\.kai/);
});

test("terraform get: holt Module separat (ohne vollen init)", () => {
  sim.mergeScenario({ tfModules: [{ name: "netz", source: "./modules/netz", resources: ["vpc"] }] });
  const out = sim.exec("terraform get").output!;
  assert.match(out, /netz in \.\/modules\/netz/);
  assert.equal(sim.tf.modules[0].fetched, true);
});

test("terraform: unbekanntes Modul (Quelle nicht auflösbar) lässt init/get scheitern", () => {
  sim.mergeScenario({
    tfModules: [{ name: "geisterinsel", source: "./modules/weg", resources: ["x"], available: false }],
  });
  const get = sim.exec("terraform get");
  assert.equal(get.error, true, "get meldet einen Fehler");
  assert.match(get.output!, /geisterinsel/);
  assert.match(get.output!, /not found/i);
  const init = sim.exec("terraform init");
  assert.equal(init.error, true, "init scheitert ebenfalls am fehlenden Modul");
  assert.equal(sim.tf.initialized, false, "init bleibt unvollständig");
});

/* ===== Provider – mehrere Anbieter, von init geladen (#146) ===== */

test("terraform init: deklarierte Provider werden gelistet und installiert", () => {
  sim.mergeScenario({
    tfProviders: [
      { name: "insel-a", source: "hashicorp/aws", version: "5.40.0" },
      { name: "insel-b", source: "hashicorp/google", version: "5.20.0" },
    ],
  });
  assert.equal(sim.tf.providers[0].installed, false);
  const init = sim.exec("terraform init").output!;
  assert.match(init, /Installing hashicorp\/aws v5\.40\.0/);
  assert.match(init, /Installing hashicorp\/google v5\.20\.0/);
  assert.equal(sim.tf.providers[0].installed, true, "init lädt die Provider-Plugins");
});

test("terraform: Ressource bei deklariertem Provider läuft durch", () => {
  sim.mergeScenario({
    tfProviders: [{ name: "insel-a", source: "hashicorp/aws" }],
    tfResources: [{ addr: "aws_bucket.lager", desc: "bucket", provider: "insel-a" }],
  });
  sim.exec("terraform init");
  const plan = sim.exec("terraform plan");
  assert.equal(plan.error, false);
  assert.match(plan.output!, /1 to add/);
});

test("terraform: unbekannter Provider blockt plan/apply", () => {
  sim.mergeScenario({
    tfProviders: [{ name: "insel-a", source: "hashicorp/aws" }],
    tfResources: [{ addr: "gcp_bucket.lager", desc: "bucket", provider: "insel-x" }],
  });
  sim.exec("terraform init");
  const plan = sim.exec("terraform plan");
  assert.equal(plan.error, true, "plan lehnt den unbekannten Provider ab");
  assert.match(plan.output!, /insel-x/);
  const apply = sim.exec("terraform apply");
  assert.equal(apply.error, true);
  assert.equal(sim.tf.applied, false, "nichts wird angelegt, solange der Provider fehlt");
});

/* ===== Remote State + Locking – mehrere Crews teilen denselben State (#146) ===== */

test("terraform init: backend-Block initialisiert den Remote-State", () => {
  sim.mergeScenario({
    tfBackend: { type: "s3", name: "flotten-lager", locking: true },
    tfResources: [{ addr: "local_file.notiz", desc: "x" }],
  });
  const init = sim.exec("terraform init").output!;
  assert.match(init, /Initializing the backend \(s3: "flotten-lager"\)/);
});

test("terraform apply: gesperrter Remote-State blockt, force-unlock löst ihn", () => {
  sim.mergeScenario({
    tfBackend: { type: "s3", name: "flotten-lager", locking: true },
    tfResources: [{ addr: "local_file.notiz", desc: "x" }],
    tfLocked: true,
    tfLockHolder: "crew-b",
  });
  sim.exec("terraform init");
  const blocked = sim.exec("terraform apply");
  assert.equal(blocked.error, true, "der Lock einer anderen Crew blockt das apply");
  assert.match(blocked.output!, /state lock/i);
  assert.match(blocked.output!, /crew-b/);
  assert.equal(sim.tf.applied, false);
  // Lock lösen, dann geht es.
  const unlock = sim.exec("terraform force-unlock LOCK123");
  assert.equal(unlock.error, false);
  assert.match(unlock.output!, /successfully unlocked/i);
  assert.equal(sim.tf.locked, false);
  const ok = sim.exec("terraform apply");
  assert.equal(ok.error, false, "nach force-unlock läuft apply durch");
  assert.equal(sim.tf.applied, true);
});

test("terraform force-unlock: ohne Lock bzw. ohne sperrbares Backend ist es ein Fehler", () => {
  // Kein Backend → kein Lock-Mechanismus.
  assert.equal(sim.exec("terraform force-unlock x").error, true);
  // Backend mit Locking, aber nicht gesperrt → nichts zu lösen.
  sim.mergeScenario({ tfBackend: { type: "s3", name: "lager", locking: true } });
  const out = sim.exec("terraform force-unlock x");
  assert.equal(out.error, true);
  assert.match(out.output!, /nicht gesperrt/);
});

/* ===== Outputs – deklarierte Werte nach dem Apply (#146) ===== */

test("terraform output: erst nach apply, sensible Werte verdeckt, gezielter Abruf roh", () => {
  sim.mergeScenario({
    tfResources: [{ addr: "local_file.notiz", desc: "x" }],
    tfOutputs: [
      { name: "kai_adresse", value: "kai-7.flotte.local" },
      { name: "zugangs_token", value: "geheim-42", sensitive: true },
    ],
  });
  sim.exec("terraform init");
  // Vor apply: noch keine Outputs.
  const before = sim.exec("terraform output");
  assert.equal(before.error, true);
  assert.match(before.output!, /nach 'terraform apply'/);
  // apply zeigt die Outputs am Ende, sensible verdeckt.
  const apply = sim.exec("terraform apply").output!;
  assert.match(apply, /kai_adresse = "kai-7\.flotte\.local"/);
  assert.match(apply, /zugangs_token = <sensitive>/);
  // terraform output listet sie, ebenfalls verdeckt.
  const list = sim.exec("terraform output").output!;
  assert.match(list, /kai_adresse = "kai-7\.flotte\.local"/);
  assert.match(list, /zugangs_token = <sensitive>/);
  // Gezielter Abruf gibt den Rohwert (auch sensibel).
  assert.equal(sim.exec("terraform output zugangs_token").output, "geheim-42");
  // Unbekannter Output → Fehler.
  const unknown = sim.exec("terraform output gibts_nicht");
  assert.equal(unknown.error, true);
  assert.match(unknown.output!, /not found/i);
});

/* ===== Persistenz – Config überlebt snapshot→reset (#146) ===== */

test("terraform: Module/Provider/Backend/Outputs überstehen snapshot→reset", () => {
  sim.mergeScenario({
    tfProviders: [{ name: "insel-a", source: "hashicorp/aws", version: "5.40.0" }],
    tfModules: [{ name: "hafen", source: "./modules/hafen", resources: ["kran", "kai"] }],
    tfBackend: { type: "s3", name: "flotten-lager", locking: true },
    tfOutputs: [{ name: "adresse", value: "kai-7" }],
    tfResources: [{ addr: "aws_bucket.lager", desc: "x", provider: "insel-a" }],
  });
  sim.exec("terraform init");
  sim.exec("terraform apply");
  const snap = sim.snapshot();
  const sim2 = new KQSim(snap);
  // Initialisierter Stand kommt zurück: Provider geladen, Modul geholt.
  assert.equal(sim2.tf.providers[0].installed, true);
  assert.equal(sim2.tf.modules[0].fetched, true);
  assert.equal(sim2.tf.backend?.name, "flotten-lager");
  assert.equal(sim2.tf.outputs[0].value, "kai-7");
  // Und die Outputs sind ohne erneutes apply abrufbar (applied=true im Snapshot).
  assert.equal(sim2.exec("terraform output adresse").output, "kai-7");
});

/* ===== Content-Szenario der Remote-State-Quest (#151) ===== */

test("Remote-State-Quest: Alt-State aus der Modul-Quest leckt nicht ins Lager (#151)", () => {
  // mergeScenario ist additiv – die Modul-Quest (flotte-modul) davor hinterlässt
  // Module + Outputs im tf-State. Das echte Quest-Szenario muss sie leeren,
  // sonst zeigt `state list`/`apply` Alt-Anleger (dieselbe #150-Lektion).
  sim.mergeScenario({
    tfModules: [{ name: "nordanleger", source: "./modules/anleger", resources: ["hafen_kai.kai", "hafen_poller.poller"] }],
    tfOutputs: [{ name: "nordanleger_adresse", value: "nord-kai.flotte.local" }],
    tfResources: [],
  });
  sim.exec("terraform init");
  sim.exec("terraform apply");
  // Die echte Remote-State-Quest lädt ihr Szenario (scenarioRef → flotte-remote-state).
  const quest = KQContent.QUESTS.find(q => q.id === "terraform-remote-state");
  assert.ok(quest, "Quest terraform-remote-state existiert");
  const step = quest.steps.find(s => s.type === "terminal" && s.scenario);
  assert.ok(step?.scenario, "Remote-State-Quest hat ein Terminal-Szenario");
  sim.mergeScenario(step.scenario);
  sim.exec("terraform init");
  const apply = sim.exec("terraform apply").output!;
  assert.doesNotMatch(apply, /nordanleger/, "kein Alt-Output aus der Modul-Quest im apply");
  const list = sim.exec("terraform state list").output!;
  assert.equal(list, "hafen_leuchtfeuer.einfahrt", "nur die Remote-State-Ressource, keine Alt-Module");
});

/* ===== Content-Szenario der Provider-Quest (#152) ===== */

test("Provider-Quest: lädt genau die zwei Anbieter, baut beide Inseln (#152)", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "terraform-provider");
  assert.ok(quest, "Quest terraform-provider existiert");
  const step = quest.steps.find(s => s.type === "terminal" && s.scenario);
  assert.ok(step?.scenario, "Provider-Quest hat ein Terminal-Szenario");
  sim.mergeScenario(step.scenario);
  const init = sim.exec("terraform init").output!;
  assert.match(init, /nordwind/, "init holt den nordwind-Provider");
  assert.match(init, /passat/, "init holt den passat-Provider");
  sim.exec("terraform apply");
  const list = sim.exec("terraform state list").output!.split("\n").sort();
  assert.deepEqual(list, ["nordwind_insel.ost", "passat_insel.west"], "beide Inseln im State");
});

test("Provider-Quest: Alt-State aus Modul-/Remote-State-Quest leckt nicht durch (#152)", () => {
  // mergeScenario ist additiv: die Quests davor hinterlassen Module, Outputs und
  // einen s3-Backend im tf-State. Das Provider-Szenario muss sie leeren, sonst zeigt
  // `state list` Alt-Anleger und `apply` einen Alt-Backend (dieselbe #150/#151-Lektion).
  sim.mergeScenario({
    tfModules: [{ name: "nordanleger", source: "./modules/anleger", resources: ["hafen_kai.kai"] }],
    tfOutputs: [{ name: "nordanleger_adresse", value: "nord-kai.flotte.local" }],
    tfBackend: { type: "s3", name: "flotten-lager", locking: true },
    tfResources: [],
  });
  sim.exec("terraform init");
  sim.exec("terraform apply");
  const quest = KQContent.QUESTS.find(q => q.id === "terraform-provider");
  const step = quest!.steps.find(s => s.type === "terminal" && s.scenario);
  sim.mergeScenario(step!.scenario);
  sim.exec("terraform init");
  const apply = sim.exec("terraform apply").output!;
  assert.doesNotMatch(apply, /nordanleger/, "kein Alt-Output aus der Modul-Quest");
  assert.equal(sim.tf.backend, null, "kein Alt-Backend aus der Remote-State-Quest");
  const list = sim.exec("terraform state list").output!.split("\n").sort();
  assert.deepEqual(list, ["nordwind_insel.ost", "passat_insel.west"], "nur die zwei Provider-Inseln, keine Alt-Module");
});

/* ===== Content-Szenario der Variablen-&-Outputs-Quest (#153) ===== */

test("Variablen-Quest: Outputs sind nach apply abrufbar, sensible nur gezielt im Klartext (#153)", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "terraform-variablen-outputs");
  assert.ok(quest, "Quest terraform-variablen-outputs existiert");
  const step = quest.steps.find(s => s.type === "terminal" && s.scenario);
  assert.ok(step?.scenario, "Variablen-Quest hat ein Terminal-Szenario");
  sim.mergeScenario(step.scenario);
  sim.exec("terraform init");
  const apply = sim.exec("terraform apply").output!;
  // Im apply-Output erscheinen die Outputs – das Geheimnis aber nur als <sensitive>.
  assert.match(apply, /flotten_groesse = "5"/, "die offene Output-Zahl steht im apply");
  assert.match(apply, /lager_schluessel = <sensitive>/, "das Geheimnis ist in der Übersicht verborgen");
  assert.doesNotMatch(apply, /werft-geheim/, "der Klartext des Geheimnisses steht NICHT in der Übersicht");
  // Gezielt abgefragt gibt Terraform den Rohwert heraus – auch den sensiblen.
  assert.equal(sim.exec("terraform output anleger_adresse").output, "kubernia-expedition.flotte.local");
  assert.equal(sim.exec("terraform output lager_schluessel").output, "werft-geheim-2347", "gezielter Abruf liefert den Rohwert");
});

test("Variablen-Quest: Alt-State aus den Vorquests (Module/Provider/Backend) leckt nicht durch (#153)", () => {
  // mergeScenario ist additiv: Modul-/Provider-/Remote-State-Quest davor hinterlassen
  // Module, Provider und einen Backend im tf-State. Das Variablen-Szenario muss sie leeren,
  // sonst zeigt `init` Alt-Provider und `state list` Alt-Anleger (dieselbe #150–#152-Lektion).
  sim.mergeScenario({
    tfModules: [{ name: "nordanleger", source: "./modules/anleger", resources: ["hafen_kai.kai"] }],
    tfProviders: [{ name: "nordwind", source: "kubequest/nordwind", version: "1.4.0" }],
    tfBackend: { type: "s3", name: "flotten-lager", locking: true },
    tfResources: [],
  });
  sim.exec("terraform init");
  sim.exec("terraform apply");
  const quest = KQContent.QUESTS.find(q => q.id === "terraform-variablen-outputs");
  const step = quest!.steps.find(s => s.type === "terminal" && s.scenario);
  sim.mergeScenario(step!.scenario);
  const init = sim.exec("terraform init").output!;
  assert.doesNotMatch(init, /nordwind/, "kein Alt-Provider aus der Provider-Quest im init");
  assert.equal(sim.tf.backend, null, "kein Alt-Backend aus der Remote-State-Quest");
  const apply = sim.exec("terraform apply").output!;
  assert.doesNotMatch(apply, /nordanleger/, "kein Alt-Output aus der Modul-Quest");
  const list = sim.exec("terraform state list").output!.split("\n").sort();
  assert.deepEqual(list, ["hafen_flotte.expedition"], "nur die Variablen-Quest-Ressource, kein Alt-State");
});

/* ===== Content-Szenario der Modul-Quest (#150, erste Quest des Arcs) =====
 * Die übrigen drei Quests (#151/#152/#153) haben oben je einen Szenario-Test;
 * #150 fehlte noch. Kern der Quest: ZWEI Modul-Aufrufe (nord/sued) aus EINEM
 * Bauplan → VIER Ressourcen (je Kai + Poller), plus der durchgereichte Output. */
test("Modul-Quest: zwei Modul-Aufrufe ergeben vier Ressourcen + durchgereichter Output (#150)", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "terraform-modul");
  assert.ok(quest, "Quest terraform-modul existiert");
  const step = quest.steps.find(s => s.type === "terminal" && s.scenario);
  assert.ok(step?.scenario, "Modul-Quest hat ein Terminal-Szenario (scenarioRef → flotte-modul)");
  sim.mergeScenario(step.scenario);
  // Zwei Modul-Blöcke (nord + sued), beide vor init noch nicht geholt.
  assert.equal(sim.tf.modules.length, 2, "zwei Modul-Aufrufe im Szenario");
  assert.ok(sim.tf.modules.every(m => m.fetched === false), "vor init ist kein Modul geholt");
  // init holt BEIDE Module.
  const init = sim.exec("terraform init").output!;
  assert.match(init, /Initializing modules/);
  assert.match(init, /nordanleger in \.\/modules\/anleger/);
  assert.match(init, /suedanleger in \.\/modules\/anleger/);
  assert.ok(sim.tf.modules.every(m => m.fetched === true), "init holt beide Module");
  // plan: aus 2 Aufrufen × je 2 Ressourcen werden 4 – das ist die Wiederverwendung.
  const plan = sim.exec("terraform plan").output!;
  assert.match(plan, /4 to add/, "zwei Modul-Aufrufe ergeben vier Ressourcen");
  // apply + state list führen genau die vier modul-expandierten Adressen.
  sim.exec("terraform apply");
  const list = sim.exec("terraform state list").output!.split("\n").sort();
  assert.deepEqual(list, [
    "module.nordanleger.hafen_kai.kai",
    "module.nordanleger.hafen_poller.poller",
    "module.suedanleger.hafen_kai.kai",
    "module.suedanleger.hafen_poller.poller",
  ], "beide Anleger als Einheit im State – kein Copy-Paste");
  // Das Modul reicht seinen Output nach oben durch (Wurzel-Konfig macht ihn sichtbar).
  assert.equal(sim.exec("terraform output nordanleger_adresse").output, "nord-kai.flotte.local");
});

/* ===== Weitere Fehler-/Grenzfälle (Red-Green, #157) =====
 * Der Ticket-Auftrag nennt „State leer" ausdrücklich; dazu die leeren Pendants
 * von get/output, die im Spiel auftreten können (Spieler tippt zu früh). */
test("terraform state list: vor apply ist der State leer und wird abgelehnt (#157)", () => {
  sim.mergeScenario({ tfResources: [{ addr: "local_file.notiz", desc: "x" }] });
  sim.exec("terraform init");
  // Noch kein apply → der State ist leer, state list meldet das als Fehler.
  const before = sim.exec("terraform state list");
  assert.equal(before.error, true, "state list vor apply ist ein Fehler (State leer)");
  assert.match(before.output!, /Noch nichts im State/);
  // Nach apply liefert dieselbe Abfrage die Ressource.
  sim.exec("terraform apply");
  const after = sim.exec("terraform state list");
  assert.equal(after.error, false);
  assert.equal(after.output, "local_file.notiz");
});

test("terraform get: ohne referenziertes Modul gibt es nichts zu holen (#157)", () => {
  const out = sim.exec("terraform get");
  assert.equal(out.error, false, "kein Fehler – nur nichts zu tun");
  assert.match(out.output!, /Kein Modul referenziert/);
});

test("terraform output: nach apply ohne deklarierte Outputs ist die Ausgabe leer (#157)", () => {
  sim.mergeScenario({ tfResources: [{ addr: "local_file.notiz", desc: "x" }], tfOutputs: [] });
  sim.exec("terraform init");
  sim.exec("terraform apply");
  const out = sim.exec("terraform output");
  assert.equal(out.error, false, "ohne output-Blöcke ist es kein Fehler");
  assert.equal(out.output, "", "echtes Terraform gibt ohne Outputs nichts aus");
});
