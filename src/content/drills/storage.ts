import type { Sim } from "../../sim";
import { pick, rnd, STS_NAMES, SC_NAMES, PVC_NAMES, SNAP_NAMES, ensureStorageClass, ensurePvc, ensureStatefulSet, STATEFULSET_YAML, STORAGECLASS_YAML, PVC_YAML, VOLUMESNAPSHOT_YAML, PVC_RESTORE_YAML } from "./shared";
import type { DrillTask } from "./shared";

export const STORAGE_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "sts-apply": sim => {
    const sc = ensureStorageClass(sim);
    let name = pick(STS_NAMES);
    while (sim.statefulSets.some(s => s.name === name)) name = pick(STS_NAMES) + rnd(2, 99);
    const file = "statefulset.yaml";
    sim.files[file] = STATEFULSET_YAML;
    sim.applyEffects[file] = { statefulSet: { name, image: "postgres:16", replicas: 3, serviceName: name, volumeClaimName: "daten", storage: "10Gi", storageClass: sc } };
    return { text: "Roll ein <b>StatefulSet</b> aus: wende die Karte <code>statefulset.yaml</code> deklarativ an.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+statefulset\.yaml$/], solution: "kubectl apply --filename statefulset.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Ein StatefulSet ist auch nur ein Manifest – mit dem vertrauten kubectl apply --filename &lt;datei&gt; angewandt. Anders als ein Deployment gibt es seinen Pods feste Namen (…-0, …-1) und je Pod über volumeClaimTemplates ein eigenes, dauerhaftes Volume." };
  },
  "sts-get": sim => {
    ensureStatefulSet(sim);
    return { text: "Zeig alle <b>StatefulSets</b> – Spalte READY nennt z.B. <code>3/3</code>.", accept: [/^kubectl\s+get\s+(statefulsets|statefulset|sts)$/], solution: "kubectl get statefulset", hint: "kubectl get statefulset (Kurzform sts geht auch).", why: "Gleiches get-Muster wie sonst: kubectl get statefulset (Kurzform sts) listet die StatefulSets mit ihrem READY-Stand – wie viele der fest nummerierten Pods schon laufen." };
  },
  "sts-delete-pod": sim => {
    const name = ensureStatefulSet(sim);
    const sts = sim.statefulSets.find(s => s.name === name)!;
    const pod = sts.pods[0].name;
    return { text: "Beweis der stabilen Identität: versenke den Pod <code>" + pod + "</code> – und beobachte, dass er mit GLEICHEM Namen zurückkommt.", accept: [new RegExp("^kubectl\\s+delete\\s+pods?\\s+" + pod.replace(/[-]/g, "\\-") + "$")], solution: "kubectl delete pod " + pod, hint: "kubectl delete pod &lt;name&gt; – nimm " + pod + ".", why: "Anders als beim Deployment (Ersatz-Pod mit neuem Zufallsnamen und leerem Volume) kommt ein StatefulSet-Pod mit EXAKT demselben Namen (…-0) und demselben PVC zurück – seine Daten überleben. Genau das ist der Sinn stabiler Identität. Muster: kubectl delete pod &lt;name&gt;." };
  },
  "sc-apply": sim => {
    let name = pick(SC_NAMES);
    while (sim.storageClasses.some(s => s.name === name)) name = pick(SC_NAMES) + rnd(2, 99);
    const file = "storageclass.yaml";
    sim.files[file] = STORAGECLASS_YAML;
    sim.applyEffects[file] = { storageClass: { name, provisioner: "kubernetes.io/aws-ebs", reclaimPolicy: "Retain" } };
    return { text: "Stell ein <b>Regal-System</b> bereit: wende die <code>storageclass.yaml</code> deklarativ an.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+storageclass\.yaml$/], solution: "kubectl apply --filename storageclass.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Die StorageClass ist die Vorlage, nach der ein PVC dynamisch sein PV bekommt (Provisioner, Disk-Art, reclaimPolicy) – selbst noch kein Speicher. Angewandt wie jedes Manifest: kubectl apply --filename &lt;datei&gt;." };
  },
  "pvc-apply": sim => {
    const sc = ensureStorageClass(sim);
    let name = pick(PVC_NAMES);
    while (sim.pvcs.some(p => p.name === name)) name = pick(PVC_NAMES) + rnd(2, 99);
    const file = "pvc.yaml";
    sim.files[file] = PVC_YAML;
    sim.applyEffects[file] = { pvc: { name, storage: "5Gi", storageClass: sc, accessModes: "RWO" } };
    return { text: "Fordere dauerhaften Speicher an: wende die <code>pvc.yaml</code> an – das PVC wird <b>Bound</b>.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+pvc\.yaml$/], solution: "kubectl apply --filename pvc.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Das PVC ist die Anforderung „so viel Platz, von dieser Klasse“. Beim Anwenden provisioniert die StorageClass ein passendes PV und bindet beide: Status Pending → Bound. Muster: kubectl apply --filename &lt;datei&gt;." };
  },
  "pvc-get": sim => {
    ensurePvc(sim);
    return { text: "Zeig alle <b>PVCs</b> – Spalte STATUS sollte <code>Bound</code> zeigen.", accept: [/^kubectl\s+get\s+(pvc|persistentvolumeclaim|persistentvolumeclaims)$/], solution: "kubectl get pvc", hint: "kubectl get pvc", why: "kubectl get pvc listet die Speicher-Anforderungen mit STATUS (Bound = hat Speicher, Pending = wartet noch), CAPACITY, ACCESS MODES und STORAGECLASS." };
  },
  "pv-get": sim => {
    ensurePvc(sim);
    return { text: "Zeig die echten <b>PersistentVolumes</b> – die Regalfächer hinter den Anforderungen.", accept: [/^kubectl\s+get\s+(pv|persistentvolume|persistentvolumes)$/], solution: "kubectl get pv", hint: "kubectl get pv", why: "Das PVC ist die Anforderung, das PV das echte Volume. kubectl get pv zeigt CAPACITY, RECLAIM POLICY, STATUS (Available/Bound/Released) und in CLAIM, an welches PVC ein PV gebunden ist." };
  },
  "pvc-pending": sim => {
    let name = pick(["verwaiste-daten", "lager-ohne-regal", "haengender-antrag"]);
    while (sim.pvcs.some(p => p.name === name)) name = "antrag-" + rnd(100, 9999);
    sim.mergeScenario({ pvcs: [{ name, storageClass: "gibt-es-nicht", storage: "5Gi", accessModes: "RWO" }] });
    return { text: "Ein Antrag hängt fest: das PVC <code>" + name + "</code> wird nicht <b>Bound</b>. Sieh dir den Status an, um den Grund zu finden.", accept: [/^kubectl\s+get\s+(pvc|persistentvolumeclaim|persistentvolumeclaims)$/], solution: "kubectl get pvc", hint: "kubectl get pvc – schau in die STATUS-Spalte.", why: "STATUS <b>Pending</b> heißt: Kubernetes hat (noch) keinen Speicher gefunden. Häufigste Ursachen: die in storageClassName genannte StorageClass gibt es gar nicht (Tippfehler), oder es existiert keine, die dynamisch provisioniert, und auch kein passendes freies PV (richtige Größe/AccessMode). Pending ist also keine Fehlermeldung, sondern „ich warte auf passenden Speicher“ – prüf zuerst die StorageClass." };
  },
  "snap-apply": sim => {
    const pvc = ensurePvc(sim);
    let name = pick(SNAP_NAMES);
    while (sim.volumeSnapshots.some(v => v.name === name)) name = pick(SNAP_NAMES) + rnd(2, 99);
    const file = "snapshot.yaml";
    sim.files[file] = VOLUMESNAPSHOT_YAML;
    sim.applyEffects[file] = { volumeSnapshot: { name, sourcePvc: pvc } };
    return { text: "Sichere ein Volume: wende die <code>snapshot.yaml</code> an – ein <b>VolumeSnapshot</b> des PVC <code>" + pvc + "</code>.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+snapshot\.yaml$/], solution: "kubectl apply --filename snapshot.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Ein VolumeSnapshot ist ein Point-in-Time-Abzug des Volumes hinter einem PVC – ein EIGENES Objekt, das den Verlust der Quelle überlebt. Angewandt wie jedes Manifest: kubectl apply --filename &lt;datei&gt;; danach ist er readyToUse." };
  },
  "snap-get": sim => {
    const pvc = ensurePvc(sim);
    if (sim.volumeSnapshots.length === 0) {
      const file = "ensure-snapshot.yaml";
      sim.files[file] = VOLUMESNAPSHOT_YAML;
      sim.applyEffects[file] = { volumeSnapshot: { name: "lager-snap", sourcePvc: pvc } };
      sim.exec("kubectl apply -f " + file);
    }
    return { text: "Zeig deine <b>VolumeSnapshots</b> – Spalte READYTOUSE sollte <code>true</code> sein.", accept: [/^kubectl\s+get\s+(volumesnapshot|volumesnapshots|vs)$/], solution: "kubectl get volumesnapshot", hint: "kubectl get volumesnapshot (Kurzform vs geht auch).", why: "kubectl get volumesnapshot (Kurzform vs) listet deine Backups mit READYTOUSE (fertig zum Wiederherstellen?) und SOURCEPVC (welches Volume gesichert wurde)." };
  },
  "snap-restore": sim => {
    let snap = pick(SNAP_NAMES);
    while (sim.volumeSnapshots.some(v => v.name === snap)) snap = pick(SNAP_NAMES) + rnd(2, 99);
    sim.mergeScenario({ volumeSnapshots: [{ name: snap, sourcePvc: "kai-datenbank", data: "stammkundenverzeichnis", readyToUse: true }] });
    const sc = ensureStorageClass(sim);
    let pvcName = pick(PVC_NAMES);
    while (sim.pvcs.some(p => p.name === pvcName)) pvcName = pick(PVC_NAMES) + rnd(2, 99);
    const file = "restore.yaml";
    sim.files[file] = PVC_RESTORE_YAML;
    sim.applyEffects[file] = { pvc: { name: pvcName, storage: "5Gi", storageClass: sc, accessModes: "RWO", dataSource: snap } };
    return { text: "Das Volume ist weg, aber dein Snapshot <code>" + snap + "</code> lebt: stell die Daten wieder her – wende die <code>restore.yaml</code> an.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+restore\.yaml$/], solution: "kubectl apply --filename restore.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Wiederherstellen heißt: ein neues PVC anlegen, das per spec.dataSource auf den Snapshot zeigt – statt eines leeren Volumes bekommst du den gesicherten Inhalt zurück. Der Snapshot muss dafür existieren und readyToUse sein. Muster: kubectl apply --filename &lt;datei&gt;." };
  },
};
