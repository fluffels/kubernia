/* Storage-Lernpfad-Arc (#246) – gezielte End-Zustands-Tests für die drei NEUEN
 * Knut-Storage-Quests:
 *   #242 storage-ephemeral      (emptyDir, Node-Disk, DiskPressure-Eviction)
 *   #243 storage-object-store   (Bucket-Round-Trip, Object vs. Block/File)
 *   #244 storage-object-backup  (off-cluster-Backup nach 3-2-1, Verlust + Restore)
 *
 * Gegenstück zu storage-drills.test.ts (#145), das die ERSTEN drei Storage-Quests
 * pinnt. Hier wird ergänzend zur breiten Durchspiel-Abdeckung (quests.test.ts) und
 * zur reinen Sim-Mechanik (ephemeral.test.ts, sim/s3.test.ts) abgesichert:
 *  1. Struktur: Geber/Thema/Choices der neuen Quests sind sauber verdrahtet.
 *  2. End-Zustand: jede Quest hinterlässt genau den gelehrten Zustand
 *     (DiskPressure → Erholung; Bucket-Round-Trip; off-site-Backup überlebt den
 *     Cluster-Verlust und der Restore bringt die Daten zurück).
 *  3. Die vom Ticket #246 benannten Negativ-/Grenzfälle als Integration:
 *     - emptyDir wird NIE Bound/persistent (taucht nie als PVC auf).
 *     - Restore (Download) OHNE vorheriges S3-Backup scheitert sauber.
 *  4. Red-Green: bewusst verfälschte Erwartungen/Eingaben fallen wirklich auf.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { KQContent } from "../src/content";

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** Die drei neuen Quests dieses Arcs, in Lernreihenfolge. */
const NEW_STORAGE_QUESTS = ["storage-ephemeral", "storage-object-store", "storage-object-backup"];

/** Ersetzt Pod-Platzhalter (<zwischenlager-pod>, <wildwuchs-pod>) durch den echten,
 *  zufälligen Pod-Namen des gleichnamigen Deployments – wie es der Spieler nach
 *  `kubectl get pods` täte. */
function resolve(cmd: string, sim: KQSim): string {
  return cmd.replace(/<([a-z]+)-pod>/g, (_m, prefix: string) => {
    const dep = sim.deployments.find(d => d.name === prefix);
    return dep && dep.pods[0] ? dep.pods[0].name : prefix;
  });
}

/** Spielt eine Quest Schritt für Schritt gegen die laufende Sim und prüft dabei,
 *  dass Geber/Thema stimmen, jede Musterlösung akzeptiert + fehlerfrei läuft, ihr
 *  `check` erfüllt ist und jede Choice genau eine richtige Antwort hat. */
function playQuest(sim: KQSim, questId: string) {
  const quest = KQContent.QUESTS.find(q => q.id === questId);
  assert.ok(quest, "Quest existiert: " + questId);
  assert.equal(quest!.giver, "knut", questId + ": Geber ist Knut");
  assert.equal(quest!.topic, "storage", questId + ": Thema ist storage");
  for (const step of quest!.steps) {
    if (step.scenario) sim.mergeScenario(step.scenario);
    if (step.type === "teach") {
      const c = step.cmd;
      const sol = resolve(c.solution, sim);
      assert.ok(c.accept.some(re => re.test(norm(sol))), questId + "/" + c.id + ": accept matcht solution nicht: " + norm(sol));
      assert.ok(!sim.exec(sol).error, questId + "/" + c.id + ": Sim-Fehler");
      assert.ok(!c.check || c.check(sim), questId + "/" + c.id + ": check() nicht erfüllt");
    } else if (step.type === "terminal") {
      for (const task of step.tasks) {
        const sol = resolve(task.solution, sim);
        assert.ok(task.accept.some(re => re.test(norm(sol))), questId + "/" + task.id + ": accept matcht solution nicht: " + norm(sol));
        assert.ok(!sim.exec(sol).error, questId + "/" + task.id + ": Sim-Fehler");
        assert.ok(!task.check || task.check(sim), questId + "/" + task.id + ": check() nicht erfüllt");
      }
    } else if (step.type === "choice") {
      assert.equal(step.options.filter(o => o.ok).length, 1, questId + ": jede Choice hat genau EINE richtige Antwort");
      for (const o of step.options) assert.ok(o.t && o.reply, questId + ": jede Option hat Text + Antwort");
    }
    // dialog/minigame: hier nichts auszuführen
  }
}

/* ===================== Struktur ===================== */

test("Storage-Arc: die drei neuen Quests sind sauber verdrahtet (Geber/Thema/Choices)", () => {
  for (const id of NEW_STORAGE_QUESTS) {
    const q = KQContent.QUESTS.find(x => x.id === id);
    assert.ok(q, "Quest existiert: " + id);
    assert.equal(q!.giver, "knut", id + ": Geber ist Knut");
    assert.equal(q!.topic, "storage", id + ": Thema ist storage");
    const choices = q!.steps.filter(s => s.type === "choice");
    assert.ok(choices.length >= 1, id + ": hat mindestens eine Choice");
    for (const ch of choices) {
      if (ch.type !== "choice") continue;
      assert.equal(ch.options.filter(o => o.ok).length, 1, id + ": jede Choice hat genau EINE richtige Antwort");
    }
  }
});

test("Storage-Arc: die neuen Quests stehen in der Lernreihenfolge (quest-order)", () => {
  const order = KQContent.QUESTS.map(q => q.id);
  const idx = (id: string) => order.indexOf(id);
  // ephemeral kommt nach dem PVC-Grundlagen-Teil, die Object-Quests bauen aufeinander auf.
  assert.ok(idx("storage-pvc") < idx("storage-ephemeral"), "ephemeral nach storage-pvc");
  assert.ok(idx("storage-object-store") < idx("storage-object-backup"), "object-store vor object-backup");
  assert.ok(idx("storage-object-backup") < idx("storage-prod-db-decision"), "object-backup vor der Abschluss-Entscheidung");
});

/* ===================== #242 storage-ephemeral: End-Zustand ===================== */

test("#242 storage-ephemeral: spielt durch und hinterlässt DiskPressure→Erholung korrekt", () => {
  const sim = new KQSim({});
  playQuest(sim, "storage-ephemeral");

  // Der Schmierzettel-Pod existiert, sein emptyDir ist nach dem rollout restart leer (flüchtig).
  const zl = sim.deployments.find(d => d.name === "zwischenlager");
  assert.ok(zl, "zwischenlager-Deployment existiert nach der Quest");
  assert.equal(zl!.emptyDir!.data, "", "emptyDir ist nach dem Neustart leer – flüchtig, nicht persistent");
  assert.equal(zl!.ephemeralLimit, 512, "das gesetzte ephemeral-storage-Limit blieb erhalten");

  // Nach der Erholung (rollout restart wildwuchs) steht KEIN Knoten mehr unter DiskPressure …
  assert.ok(!sim.nodes.some(n => n.diskPressure), "am Ende kein Knoten unter DiskPressure (Druck ist weg)");
  // … und der zuvor evictete BestEffort-Pod läuft wieder, der disziplinierte lief durchgehend.
  const wild = sim.deployments.find(d => d.name === "wildwuchs");
  const prot = sim.deployments.find(d => d.name === "protokoll");
  assert.ok(wild && !wild.evicted, "wildwuchs ist nach der Erholung nicht mehr evicted");
  assert.ok(prot && !prot.evicted, "protokoll (mit Limit) wurde nie evictet");
  assert.equal(wild!.emptyDir!.usedMi, 0, "wildwuchs hat seinen Schmierzettel freigegeben (0Mi)");
});

test("#242 (Negativfall): emptyDir wird NIE Bound/persistent – taucht nie als PVC auf", () => {
  // Der Kernkontrast zum PVC-Arc: ein emptyDir ist flüchtiger Pod-Speicher, KEIN
  // persistenter Anspruch. Es darf nach der ganzen Quest kein einziges PVC geben.
  const sim = new KQSim({});
  playQuest(sim, "storage-ephemeral");

  assert.equal(sim.pvcs.length, 0, "emptyDir erzeugt KEIN PVC");
  const pvc = sim.exec("kubectl get pvc");
  assert.ok(!pvc.error, "get pvc selbst läuft fehlerfrei");
  assert.match(pvc.output!, /No resources found/, "kein PVC, also keine Bound-Zeile");
  assert.doesNotMatch(pvc.output!, /zwischenlager|wildwuchs|protokoll|Bound/, "kein emptyDir-Deployment erscheint als gebundenes Volume");
});

test("#242 Red-Green: ein falscher Limit-Wert wird vom set-resources-Schritt NICHT akzeptiert", () => {
  // Sonst wäre die accept-Prüfung im Durchspiel ein False Positive.
  const q = KQContent.QUESTS.find(x => x.id === "storage-ephemeral")!;
  const setStep = q.steps.find(s => s.type === "teach" && s.cmd.id === "t-eph-setlimit");
  assert.ok(setStep && setStep.type === "teach");
  const cmd = setStep.type === "teach" ? setStep.cmd : null;
  assert.ok(cmd!.accept.some(re => re.test(norm(cmd!.solution))), "die Musterlösung (512Mi) gilt");
  assert.ok(!cmd!.accept.some(re => re.test("kubectl set resources deployment/zwischenlager --limits=ephemeral-storage=256Mi")),
    "ein anderer Limit-Wert (256Mi) zählt NICHT");
});

/* ===================== #243 storage-object-store: End-Zustand ===================== */

test("#243 storage-object-store: Bucket-Round-Trip (put → ls → get) hinterlässt den richtigen Zustand", () => {
  const sim = new KQSim({});
  playQuest(sim, "storage-object-store");

  const bucket = sim.objectStore.buckets.find(b => b.name === "hafen-backup");
  assert.ok(bucket, "Bucket hafen-backup wurde angelegt");
  const obj = bucket!.objects.find(o => o.key === "manifeste/frachtliste.txt");
  assert.ok(obj, "das Objekt liegt unter dem vollen (flachen) Key – Schrägstrich ist kein Ordner");

  // Round-Trip: der Download hat dieselbe Fracht lokal wiederhergestellt.
  assert.ok(sim.files["wiederhergestellt.txt"] !== undefined, "Download legte die lokale Datei an");
  assert.equal(sim.files["wiederhergestellt.txt"], obj!.content, "der heruntergeladene Inhalt ist identisch zum Objekt");
});

/* ===================== #244 storage-object-backup: End-Zustand ===================== */

test("#244 storage-object-backup: off-site-Backup überlebt den Cluster-Verlust, Restore bringt die Daten zurück", () => {
  const sim = new KQSim({});
  playQuest(sim, "storage-object-backup");

  // Das Backup liegt im off-cluster-Eimer – es hat den simulierten Totalverlust überlebt.
  const bucket = sim.objectStore.buckets.find(b => b.name === "hafen-offsite");
  assert.ok(bucket, "Off-site-Eimer hafen-offsite existiert");
  assert.ok(bucket!.objects.some(o => o.key === "backups/kai-stammdaten-2024-01-01.dump"),
    "das off-site-Backup liegt nach dem PVC-Verlust immer noch im Eimer");

  // Der heruntergeladene Dump ist lokal wieder da …
  assert.ok(sim.files["wiederhergestellt.dump"] !== undefined, "der Dump wurde aus S3 zurückgeholt");
  // … und das frisch befüllte Volume trägt wieder die Stammkundendaten.
  const pvc = sim.pvcs.find(p => p.name === "kai-stammdaten");
  assert.ok(pvc, "kai-stammdaten wurde aus dem Backup neu angelegt");
  assert.equal(pvc!.status, "Bound", "das wiederhergestellte Volume ist Bound");
  assert.equal(pvc!.data, "stammkundenverzeichnis", "die gesicherten Daten sind zurück");
});

test("#244 (Negativfall): Restore-Download OHNE vorheriges Backup scheitert sauber", () => {
  // Genau der Ernstfall-Fehlgriff: man versucht aus dem Eimer zu restoren, hat aber nie
  // gesichert. Das muss sauber fehlschlagen und darf KEINE lokale Datei hinterlassen.
  const sim = new KQSim({});

  // (a) Eimer existiert gar nicht → NoSuchBucket.
  const ohneBucket = sim.exec("aws s3 cp s3://hafen-offsite/backups/kai-stammdaten-2024-01-01.dump wiederhergestellt.dump");
  assert.ok(ohneBucket.error, "ohne Eimer muss der Download scheitern");
  assert.match(ohneBucket.output!, /NoSuchBucket/, "klare Fehlermeldung: kein solcher Bucket");
  assert.equal(sim.files["wiederhergestellt.dump"], undefined, "kein halber Restore: keine lokale Datei angelegt");

  // (b) Eimer da, aber das Backup-Objekt fehlt → NoSuchKey.
  sim.exec("aws s3 mb s3://hafen-offsite");
  const ohneObjekt = sim.exec("aws s3 cp s3://hafen-offsite/backups/kai-stammdaten-2024-01-01.dump wiederhergestellt.dump");
  assert.ok(ohneObjekt.error, "ohne gesichertes Objekt muss der Download scheitern");
  assert.match(ohneObjekt.output!, /NoSuchKey/, "klare Fehlermeldung: kein solches Objekt");
  assert.equal(sim.files["wiederhergestellt.dump"], undefined, "weiterhin keine lokale Datei aus dem Nichts");
});

test("#244 Red-Green: der off-site-Negativtest ist scharf – MIT Backup klappt der Download", () => {
  // Beweist, dass der Negativfall oben nicht generell alles ablehnt (sonst False Positive).
  const sim = new KQSim({});
  sim.exec("aws s3 mb s3://hafen-offsite");
  sim.files["kai-stammdaten.dump"] = "INSERT INTO kunden VALUES ('Knut', 'Westkai 1');";
  sim.exec("aws s3 cp kai-stammdaten.dump s3://hafen-offsite/backups/kai-stammdaten-2024-01-01.dump");
  const ok = sim.exec("aws s3 cp s3://hafen-offsite/backups/kai-stammdaten-2024-01-01.dump wiederhergestellt.dump");
  assert.ok(!ok.error, "mit vorhandenem Backup gelingt der Download");
  assert.equal(sim.files["wiederhergestellt.dump"], sim.files["kai-stammdaten.dump"], "Inhalt korrekt zurückgeholt");
});

/* ===================== Arc gesamt: alle drei nacheinander gegen EINE Sim ===================== */

test("Storage-Arc: alle drei neuen Quests laufen nacheinander gegen EINE geteilte Sim (keine Vergiftung)", () => {
  // Wie im echten Spielverlauf: derselbe Cluster akkumuliert über die ganze Lehre.
  const sim = new KQSim({});
  for (const id of NEW_STORAGE_QUESTS) playQuest(sim, id);
  // Endkontrolle: der Cluster ist konsistent (get läuft fehlerfrei, off-site-Backup da).
  assert.ok(!sim.exec("kubectl get pods").error, "get pods am Ende fehlerfrei");
  assert.ok(!sim.exec("aws s3 ls").error, "aws s3 ls am Ende fehlerfrei");
  assert.ok(sim.objectStore.buckets.some(b => b.name === "hafen-offsite"), "der off-site-Eimer steht am Ende");
});
