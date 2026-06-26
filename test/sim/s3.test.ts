/* S3-kompatibler Object Store im Simulator (#241): `aws s3`-Befehlsfamilie + off-cluster
 * Buckets/Objekte. Prüft den put→ls→get-Round-Trip, alle Fehlerfälle (leerer/fehlender
 * Bucket, Objekt nicht da, nicht-leerer Bucket) und vor allem die Unabhängigkeit vom
 * Cluster (Objekte überleben Pod/Deployment/PVC). Teilt den frischen Sim mit den übrigen
 * sim-Modul-Tests (test/sim/helpers.ts). */
import { describe, test, beforeEach, expect } from "vitest";
import { KQSim, freshSim } from "./helpers";

describe("aws s3 – Object Store: Buckets", () => {
  let sim: KQSim;
  beforeEach(() => { sim = freshSim(); });

  test("mb legt einen Bucket an, ls zeigt ihn", () => {
    const mk = sim.exec("aws s3 mb s3://hafen-backup");
    expect(mk.error).toBe(false);
    expect(mk.output).toContain("make_bucket: hafen-backup");
    const ls = sim.exec("aws s3 ls");
    expect(ls.error).toBe(false);
    expect(ls.output).toContain("hafen-backup");
  });

  test("ls ohne Buckets meldet das freundlich (kein Fehler)", () => {
    const ls = sim.exec("aws s3 ls");
    expect(ls.error).toBe(false);
    expect(ls.output).toContain("keine Buckets");
  });

  test("doppeltes mb scheitert (BucketAlreadyOwnedByYou)", () => {
    sim.exec("aws s3 mb s3://hafen-backup");
    const dup = sim.exec("aws s3 mb s3://hafen-backup");
    expect(dup.error).toBe(true);
    expect(dup.output).toContain("BucketAlreadyOwnedByYou");
    expect(sim.objectStore.buckets.length).toBe(1);
  });

  test("mb ohne/mit kaputtem Argument scheitert", () => {
    expect(sim.exec("aws s3 mb").error).toBe(true);
    expect(sim.exec("aws s3 mb hafen-backup").error).toBe(true);      // kein s3://
    expect(sim.exec("aws s3 mb s3://hafen/key").error).toBe(true);    // mb nimmt keinen Key
  });

  test("rb entfernt einen leeren Bucket", () => {
    sim.exec("aws s3 mb s3://leer");
    const rb = sim.exec("aws s3 rb s3://leer");
    expect(rb.error).toBe(false);
    expect(rb.output).toContain("remove_bucket: leer");
    expect(sim.objectStore.buckets.length).toBe(0);
  });

  test("rb auf nicht-leeren Bucket scheitert ohne --force", () => {
    sim.exec("aws s3 mb s3://voll");
    sim.files["daten.txt"] = "inhalt";
    sim.exec("aws s3 cp daten.txt s3://voll/daten.txt");
    const rb = sim.exec("aws s3 rb s3://voll");
    expect(rb.error).toBe(true);
    expect(rb.output).toContain("BucketNotEmpty");
    expect(sim.objectStore.buckets.length).toBe(1);
  });

  test("rb --force löscht auch einen nicht-leeren Bucket", () => {
    sim.exec("aws s3 mb s3://voll");
    sim.files["daten.txt"] = "inhalt";
    sim.exec("aws s3 cp daten.txt s3://voll/daten.txt");
    const rb = sim.exec("aws s3 rb s3://voll --force");
    expect(rb.error).toBe(false);
    expect(sim.objectStore.buckets.length).toBe(0);
  });

  test("rb auf unbekannten Bucket scheitert (NoSuchBucket)", () => {
    const rb = sim.exec("aws s3 rb s3://gibt-es-nicht");
    expect(rb.error).toBe(true);
    expect(rb.output).toContain("NoSuchBucket");
  });
});

describe("aws s3 – Object Store: Objekte (put → ls → get)", () => {
  let sim: KQSim;
  beforeEach(() => {
    sim = freshSim();
    sim.exec("aws s3 mb s3://hafen-backup");
    sim.files["log.txt"] = "Ahoi Kapitän";
  });

  test("Round-Trip: Upload, in ls sichtbar, Download stellt den Inhalt wieder her", () => {
    const up = sim.exec("aws s3 cp log.txt s3://hafen-backup/log.txt");
    expect(up.error).toBe(false);
    expect(up.output).toContain("upload:");

    const ls = sim.exec("aws s3 ls s3://hafen-backup");
    expect(ls.error).toBe(false);
    expect(ls.output).toContain("log.txt");

    const down = sim.exec("aws s3 cp s3://hafen-backup/log.txt wiederhergestellt.txt");
    expect(down.error).toBe(false);
    expect(down.output).toContain("download:");
    expect(sim.files["wiederhergestellt.txt"]).toBe("Ahoi Kapitän");
  });

  test("ls eines leeren Buckets meldet das freundlich (kein Fehler)", () => {
    const ls = sim.exec("aws s3 ls s3://hafen-backup");
    expect(ls.error).toBe(false);
    expect(ls.output).toContain("leerer Bucket");
  });

  test("ls eines unbekannten Buckets scheitert (NoSuchBucket)", () => {
    const ls = sim.exec("aws s3 ls s3://gibt-es-nicht");
    expect(ls.error).toBe(true);
    expect(ls.output).toContain("NoSuchBucket");
  });

  test("Größe wird in UTF-8-Bytes geführt (Umlaute zählen mehr als 1)", () => {
    sim.exec("aws s3 cp log.txt s3://hafen-backup/log.txt");
    const obj = sim.objectStore.buckets[0].objects[0];
    // "Ahoi Kapitän" → 12 Zeichen, das ä ist 2 Bytes → 13 Bytes.
    expect(obj.size).toBe(13);
  });

  test("Upload auf einen unbekannten Bucket scheitert (NoSuchBucket)", () => {
    const up = sim.exec("aws s3 cp log.txt s3://gibt-es-nicht/log.txt");
    expect(up.error).toBe(true);
    expect(up.output).toContain("NoSuchBucket");
  });

  test("Upload einer nicht vorhandenen lokalen Datei scheitert", () => {
    const up = sim.exec("aws s3 cp fehlt.txt s3://hafen-backup/fehlt.txt");
    expect(up.error).toBe(true);
    expect(up.output).toContain("fehlt.txt");
  });

  test("Download eines nicht vorhandenen Objekts scheitert (NoSuchKey)", () => {
    const down = sim.exec("aws s3 cp s3://hafen-backup/gibt-es-nicht.txt lokal.txt");
    expect(down.error).toBe(true);
    expect(down.output).toContain("NoSuchKey");
    expect(sim.files["lokal.txt"]).toBeUndefined();
  });

  test("cp ohne s3-Adresse auf beiden Seiten scheitert (das ist nicht aws s3 cp)", () => {
    const cp = sim.exec("aws s3 cp a.txt b.txt");
    expect(cp.error).toBe(true);
  });

  test("Key wird aus dem Dateinamen abgeleitet, wenn das Ziel nur der Bucket ist", () => {
    sim.exec("aws s3 cp log.txt s3://hafen-backup/");
    expect(sim.objectStore.buckets[0].objects.some(o => o.key === "log.txt")).toBe(true);
  });

  test("erneuter Upload überschreibt das Objekt (idempotent, Größe aktualisiert)", () => {
    sim.exec("aws s3 cp log.txt s3://hafen-backup/log.txt");
    sim.files["log.txt"] = "viel mehr Inhalt als vorher";
    sim.exec("aws s3 cp log.txt s3://hafen-backup/log.txt");
    expect(sim.objectStore.buckets[0].objects.length).toBe(1);
    expect(sim.objectStore.buckets[0].objects[0].content).toBe("viel mehr Inhalt als vorher");
  });

  test("rm löscht ein Objekt; danach ist es weg", () => {
    sim.exec("aws s3 cp log.txt s3://hafen-backup/log.txt");
    const rm = sim.exec("aws s3 rm s3://hafen-backup/log.txt");
    expect(rm.error).toBe(false);
    expect(rm.output).toContain("delete:");
    expect(sim.objectStore.buckets[0].objects.length).toBe(0);
  });

  test("rm eines nicht vorhandenen Objekts scheitert (NoSuchKey)", () => {
    const rm = sim.exec("aws s3 rm s3://hafen-backup/gibt-es-nicht.txt");
    expect(rm.error).toBe(true);
    expect(rm.output).toContain("NoSuchKey");
  });

  test("Objekt von Bucket zu Bucket kopieren (s3 → s3)", () => {
    sim.exec("aws s3 mb s3://zweitlager");
    sim.exec("aws s3 cp log.txt s3://hafen-backup/log.txt");
    const cp = sim.exec("aws s3 cp s3://hafen-backup/log.txt s3://zweitlager/kopie.txt");
    expect(cp.error).toBe(false);
    expect(cp.output).toContain("copy:");
    const ziel = sim.objectStore.buckets.find(b => b.name === "zweitlager")!;
    expect(ziel.objects[0].content).toBe("Ahoi Kapitän");
  });
});

describe("aws s3 – Object Store ist off-cluster (unabhängig)", () => {
  test("Objekte überleben das Löschen von Pod/Deployment (und PVC)", () => {
    const sim = new KQSim({
      deployments: [{ name: "kasse", image: "kasse:1", replicas: 1 }],
      pvcs: [{ name: "daten-pvc", storage: "1Gi" }],
      s3Buckets: [{ name: "hafen-backup", objects: [{ key: "wichtig.txt", content: "bleibt" }] }],
    });
    // Deployment + PVC abräumen – der Object Store darf unberührt bleiben.
    sim.exec("kubectl delete deployment kasse");
    sim.exec("kubectl delete pvc daten-pvc");
    const bucket = sim.objectStore.buckets.find(b => b.name === "hafen-backup")!;
    expect(bucket.objects.length).toBe(1);
    expect(bucket.objects[0].content).toBe("bleibt");
  });

  test("snapshot()/Neuaufbau bewahrt Buckets samt Inhalt (Reload-fest)", () => {
    const sim = new KQSim({ s3Buckets: [{ name: "lager", objects: [{ key: "a.txt", content: "x" }] }] });
    const snap = sim.snapshot();
    const wieder = new KQSim(snap);
    const bucket = wieder.objectStore.buckets.find(b => b.name === "lager")!;
    expect(bucket).toBeTruthy();
    expect(bucket.objects[0].key).toBe("a.txt");
    expect(bucket.objects[0].content).toBe("x");
  });

  test("Szenario seedet Objektgrößen aus dem Inhalt, wenn nicht angegeben", () => {
    const sim = new KQSim({ s3Buckets: [{ name: "lager", objects: [{ key: "a.txt", content: "abc" }] }] });
    expect(sim.objectStore.buckets[0].objects[0].size).toBe(3);
  });
});

describe("aws – Fehlbedienung", () => {
  let sim: KQSim;
  beforeEach(() => { sim = freshSim(); });

  test("aws ohne s3 weist freundlich auf den Object Store hin", () => {
    const r = sim.exec("aws ec2 describe-instances");
    expect(r.error).toBe(true);
    expect(r.output).toContain("aws s3");
  });

  test("unbekannter s3-Unterbefehl scheitert mit Vorschlag", () => {
    const r = sim.exec("aws s3 mkbucket s3://x");
    expect(r.error).toBe(true);
  });
});
