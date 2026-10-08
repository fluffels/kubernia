/* ReplicaSet-Historie, `kubectl rollout history|undo` (#1471): alte ReplicaSets 0/0/0 in get rs/get all, Revisionen,
 * Rollback auf das alte Template mit dem alten Hash, additive Persistenz (auch Alt-Stand und kaputte Historie),
 * Admission auf das alte Template, YAML und Invariante (10). Alles über `sim.exec` und die öffentlichen Exporte. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { deploymentYaml } from "../factories/manifests";
import { clusterInvariantViolations } from "../../src/sim/invariants";
import { currentReplicaSet, REVISION_HISTORY_LIMIT, replicaSetsOf, undoTarget } from "../../src/sim/replicasets";
import type { Scenario } from "../../src/sim/state";
import altStand from "../fixtures/savegame-v1-rich.json";

function neu(sc: Scenario = {}): KQSim {
  const sim = new KQSim(sc);
  expect(sim.exec("kubectl create deployment web --image=nginx --replicas=3").error).toBe(false);
  return sim;
}
const dep = (sim: KQSim, name = "web") => sim.deployments.find(d => d.name === name)!;
const out = (sim: KQSim, cmd: string) => sim.exec(cmd).output!;
const pods = (sim: KQSim) => dep(sim).pods.map(p => String(p.name));
const rsZeilen = (sim: KQSim) => out(sim, "kubectl get rs").split("\n").slice(1);
/** Die Revisionen aus `rollout history` (Zahlen der Zeilen unter der Kopfzeile). */
const revisionen = (sim: KQSim) => out(sim, "kubectl rollout history deployment/web").split("\n").slice(2).map(z => Number(z.split(/\s+/)[0]));
const setImage = (sim: KQSim, i: string) => expect(sim.exec("kubectl set image deployment/web nginx=" + i).error).toBe(false);
/** Zwei Rollouts: Revision 1 (nginx), 2 (nginx:2), 3 (nginx:3). */
function dreiRevisionen(): KQSim { const sim = neu(); setImage(sim, "nginx:2"); setImage(sim, "nginx:3"); return sim; }

describe("alte ReplicaSets bleiben sichtbar", () => {
  test("frisch: history zeigt nur Revision 1 mit <none>, im K8s-Format", () => {
    expect(out(neu(), "kubectl rollout history deployment/web")).toBe("deployment.apps/web\nREVISION  CHANGE-CAUSE\n1         <none>");
  });

  test("nach zwei set image: drei ReplicaSets, das aktuelle 3/3/3, zwei alte 0 0 0", () => {
    const sim = dreiRevisionen();
    const zeilen = rsZeilen(sim);
    expect(zeilen).toHaveLength(3);
    const aktuell = currentReplicaSet(dep(sim)).name;
    for (const z of zeilen) {
      const re = z.startsWith(aktuell + " ") ? /\s3\s+3\s+3\s/ : /\s0\s+0\s+0\s/;
      expect(z).toMatch(re);
    }
    expect(revisionen(sim)).toEqual([1, 2, 3]);
  });

  test("get rs -o wide: jedes ReplicaSet mit eigenem Image und eigenem Hash im SELECTOR", () => {
    const sim = dreiRevisionen();
    const zeilen = out(sim, "kubectl get rs -o wide").split("\n").slice(1);
    for (const z of zeilen) {
      const [name, , , , , , image, selector] = z.trim().split(/\s+/);
      expect(selector.endsWith("pod-template-hash=" + name.slice("web-".length))).toBe(true);
      expect(["nginx", "nginx:2", "nginx:3"]).toContain(image);
    }
    expect(new Set(zeilen.map(z => z.trim().split(/\s+/)[6]))).toEqual(new Set(["nginx", "nginx:2", "nginx:3"]));
  });

  test("get all zeigt auch die alten ReplicaSets", () => {
    const sim = dreiRevisionen();
    expect(out(sim, "kubectl get all").split("\n").filter(z => z.startsWith("replicaset.apps/web-"))).toHaveLength(3);
  });

  test("Deployment mit 0 Replicas: Revision 1 hält das alte Image", () => {
    const sim = neu();
    sim.exec("kubectl scale deployment/web --replicas=0");
    setImage(sim, "nginx:2");
    const rev1 = replicaSetsOf(dep(sim)).find(r => r.revision === 1)!;
    expect(rev1.image).toBe("nginx");
  });
});

describe("rollout undo", () => {
  test("holt das ReplicaSet der vorherigen Revision zurück: gleicher Name, gleicher Hash in den Pods, history 1,3", () => {
    const sim = neu(); setImage(sim, "nginx:2");
    const rev1 = replicaSetsOf(dep(sim)).find(r => r.revision === 1)!;
    expect(out(sim, "kubectl rollout undo deployment/web")).toBe("deployment.apps/web rolled back");
    expect(currentReplicaSet(dep(sim)).name).toBe(rev1.name);
    expect(dep(sim).image).toBe("nginx");
    for (const n of pods(sim)) expect(n.startsWith(rev1.name + "-")).toBe(true);
    expect(revisionen(sim)).toEqual([2, 3]);
    expect(rsZeilen(sim)).toHaveLength(2);
    expect(clusterInvariantViolations(sim)).toEqual([]);
  });

  test("zweimal undo geht hin und zurück; das ReplicaSet behält sein Alter", () => {
    const sim = neu(); sim.clock += 30; setImage(sim, "nginx:2");
    const ersteAge = replicaSetsOf(dep(sim)).find(r => r.revision === 1)!.created;
    sim.exec("kubectl rollout undo deployment/web");
    expect(dep(sim).image).toBe("nginx");
    expect(currentReplicaSet(dep(sim)).created).toBe(ersteAge);
    sim.exec("kubectl rollout undo deployment/web");
    expect(dep(sim).image).toBe("nginx:2");
    expect(revisionen(sim)).toEqual([3, 4]);
  });

  test("--to-revision=1 aus Revision 3", () => {
    const sim = dreiRevisionen();
    expect(out(sim, "kubectl rollout undo deployment/web --to-revision=1")).toBe("deployment.apps/web rolled back");
    expect(dep(sim).image).toBe("nginx");
    expect(revisionen(sim)).toEqual([2, 3, 4]);
  });

  test("--to-revision=<aktuelle> überspringt, Pods bleiben", () => {
    const sim = dreiRevisionen(); const vorher = pods(sim);
    expect(out(sim, "kubectl rollout undo deployment/web --to-revision=3")).toBe("deployment.apps/web skipped rollback (current template already matches revision 3)");
    expect(pods(sim)).toEqual(vorher);
    expect(revisionen(sim)).toEqual([1, 2, 3]);
  });

  test("restart nach undo ergibt ein NEUES ReplicaSet", () => {
    const sim = neu(); setImage(sim, "nginx:2");
    sim.exec("kubectl rollout undo deployment/web");
    const namen = new Set(replicaSetsOf(dep(sim)).map(r => r.name));
    sim.exec("kubectl rollout restart deployment/web");
    expect(namen.has(currentReplicaSet(dep(sim)).name)).toBe(false);
  });

  test("Template-Treue: jedes Feld inkl. doubleStage kommt zurück, ein neues Feld (memLimit) fällt weg", () => {
    const sim = new KQSim({ deployments: [{
      name: "web", image: "web:1", replicas: 2, envFrom: { configMaps: ["cfg"], secrets: [] },
      serviceAccountName: "sa", containerPort: 8080, cpuLimitMilli: 250, securityContext: { runAsNonRoot: true },
      node: "ahoi-worker-1", emptyDir: { data: "", usedMi: 0 }, ephemeralLimit: 64, initContainer: { fillsMi: 10, doubleStage: true },
    }], configMaps: [{ name: "cfg", keys: ["k"] }], serviceAccounts: ["sa"] });
    const vorher = JSON.parse(JSON.stringify(sim.snapshot().deployments[0])) as Record<string, unknown>;
    const h = currentReplicaSet(dep(sim)).hash;
    expect(sim.exec("kubectl set image deployment/web web=web:2").error).toBe(false);
    expect(sim.exec("kubectl set resources deployment/web --limits=memory=512Mi").error).toBe(false);
    expect(dep(sim).memLimit).toBe(512);
    expect(sim.exec("kubectl rollout undo deployment/web --to-revision=1").error).toBe(false);
    const nachher = JSON.parse(JSON.stringify(sim.snapshot().deployments[0])) as Record<string, unknown>;
    for (const k of Object.keys(vorher).filter(k => k !== "revision" && k !== "rsHistory")) expect(nachher[k], k).toEqual(vorher[k]);
    expect(nachher).not.toHaveProperty("memLimit");
    expect(dep(sim).initContainer?.doubleStage).toBe(true);
    expect(currentReplicaSet(dep(sim)).hash).toBe(h);
  });

  test("bewusste Abweichung (#1146): undo bringt das alte Template, nicht den Fehler (OOM bleibt geheilt, memLimit 64 zurück)", () => {
    const sim = new KQSim({ deployments: [{ name: "app", image: "app:1", replicas: 1, broken: { type: "oomkilled", memNeeded: 256 } }] });
    expect(sim.exec("kubectl set resources deployment/app --limits=memory=512Mi").error).toBe(false);
    expect(dep(sim, "app").broken).toBeNull();
    expect(sim.exec("kubectl rollout undo deployment/app").error).toBe(false);
    expect(dep(sim, "app").memLimit).toBe(64);
    expect(dep(sim, "app").broken).toBeNull();
  });
});

describe("Negativfälle", () => {
  test("undo ohne Historie: Fehler, nichts mutiert", () => {
    const sim = neu(); const vorher = pods(sim);
    const r = sim.exec("kubectl rollout undo deployment/web");
    expect(r.error).toBe(true);
    expect(r.output).toContain('error: no rollout history found for deployment "web"');
    expect(pods(sim)).toEqual(vorher);
    expect(rsZeilen(sim)).toHaveLength(1);
  });

  test.each(["9", "-1"])("--to-revision=%s ist unbekannt", rev => {
    const sim = dreiRevisionen(); const vorher = pods(sim);
    const r = sim.exec("kubectl rollout undo deployment/web --to-revision=" + rev);
    expect(r.error).toBe(true);
    expect(r.output).toContain("error: unable to find specified revision " + rev + " in history");
    expect(pods(sim)).toEqual(vorher);
  });

  test("--to-revision=abc: ParseInt-Fehler", () => {
    const r = dreiRevisionen().exec("kubectl rollout undo deployment/web --to-revision=abc");
    expect(r.error).toBe(true);
    expect(r.output).toContain('error: invalid argument "abc" for "--to-revision" flag: strconv.ParseInt: parsing "abc": invalid syntax');
  });

  test("unbekanntes Deployment, fehlender Name und StatefulSet", () => {
    const sim = neu({ statefulSets: [{ name: "db", image: "db:1", replicas: 1 }] });
    expect(out(sim, "kubectl rollout undo deployment/gibtsnicht")).toContain('deployments.apps "gibtsnicht" not found');
    expect(out(sim, "kubectl rollout history deployment/gibtsnicht")).toContain("NotFound");
    expect(out(sim, "kubectl rollout undo")).toContain("Welches Deployment?");
    expect(out(sim, "kubectl rollout history statefulset/db")).toContain("nur für Deployments");
    expect(out(sim, "kubectl rollout undo statefulset/db")).toContain("nur für Deployments");
  });

  test("--to-revision bei restart und history: unknown flag, nichts passiert", () => {
    const sim = dreiRevisionen(); const vorher = pods(sim);
    for (const a of ["restart", "history"]) {
      const r = sim.exec("kubectl rollout " + a + " deployment/web --to-revision=1");
      expect(r.error).toBe(true);
      expect(r.output).toContain("error: unknown flag: --to-revision");
    }
    expect(pods(sim)).toEqual(vorher);
  });

  test("--revision (history): ehrlich abgelehnt mit Hinweis", () => {
    const r = dreiRevisionen().exec("kubectl rollout history deployment/web --revision=2");
    expect(r.error).toBe(true);
    expect(r.output).toContain("kubectl get rs -o wide");
  });

  test("Historie über dem Limit: nur die letzten 10 alten ReplicaSets, die älteste Revision ist unbekannt", () => {
    const sim = neu();
    for (let i = 0; i < 12; i++) sim.exec("kubectl rollout restart deployment/web");
    expect(rsZeilen(sim)).toHaveLength(REVISION_HISTORY_LIMIT + 1);
    expect(revisionen(sim)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(out(sim, "kubectl rollout undo deployment/web --to-revision=2")).toContain("unable to find specified revision 2");
    expect(clusterInvariantViolations(sim)).toEqual([]);
  });

  test("undoTarget: Grenzen pur", () => {
    const sim = dreiRevisionen();
    expect(undoTarget(dep(sim), 0)).toHaveProperty("record");
    expect(undoTarget(dep(sim), 3)).toEqual({ skip: true, revision: 3 });
    expect(undoTarget(dep(sim), 7)).toEqual({ error: "unbekannt", revision: 7 });
    expect(undoTarget(neu().deployments[0])).toEqual({ error: "keine-historie" });
  });
});

describe("Pod-Security-Admission prüft das alte Template", () => {
  test("undo auf ein unsicheres Template unter restricted: Forbidden, Historie und Pods unverändert", () => {
    const sim = new KQSim({ files: { "web.yaml": deploymentYaml({ name: "web", replicas: 2 }) } });
    sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=privileged");
    sim.exec("kubectl apply -f web.yaml");
    sim.files["web.yaml"] = deploymentYaml({ name: "web", replicas: 2, securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false } });
    expect(sim.exec("kubectl apply -f web.yaml").error).toBe(false);
    sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=restricted --overwrite");
    const vorher = pods(sim); const revs = revisionen(sim);
    const r = sim.exec("kubectl rollout undo deployment/web");
    expect(r.error).toBe(true);
    expect(r.output).toMatch(/Forbidden/);
    expect(pods(sim)).toEqual(vorher);
    expect(revisionen(sim)).toEqual(revs);
    expect(dep(sim).securityContext?.runAsNonRoot).toBe(true);
  });

  test("undo auf ein Template OHNE securityContext wird nicht am aktuellen gehärteten gemessen", () => {
    const sim = new KQSim({ files: { "web.yaml": deploymentYaml({ name: "web", replicas: 1 }) } });
    sim.exec("kubectl apply -f web.yaml");
    sim.files["web.yaml"] = deploymentYaml({ name: "web", replicas: 1, securityContext: { privileged: true } });
    sim.exec("kubectl apply -f web.yaml");
    const r = sim.exec("kubectl rollout undo deployment/web");
    expect(r.error).toBe(false);
    expect(dep(sim).securityContext).toBeUndefined();
  });
});

describe("Persistenz ohne Save-Bump", () => {
  const laden = (sim: KQSim) => new KQSim(JSON.parse(JSON.stringify(sim.snapshot())) as Scenario);

  test("snapshot, neu laden: Revisionen und ReplicaSet-Namen gleich, undo nutzt den alten Hash", () => {
    const sim = dreiRevisionen();
    const namen = replicaSetsOf(dep(sim)).map(r => r.name);
    const geladen = laden(sim);
    expect(replicaSetsOf(dep(geladen)).map(r => r.name)).toEqual(namen);
    expect(revisionen(geladen)).toEqual([1, 2, 3]);
    expect(clusterInvariantViolations(geladen)).toEqual([]);
    const rev2 = replicaSetsOf(dep(geladen)).find(r => r.revision === 2)!;
    expect(geladen.exec("kubectl rollout undo deployment/web").error).toBe(false);
    expect(currentReplicaSet(dep(geladen)).name).toBe(rev2.name);
    for (const n of pods(geladen)) expect(n.startsWith(rev2.name + "-")).toBe(true);
  });

  test("Alt-Stand (v1-rich): history zeigt 1, undo meldet keine Historie, das Deployment trägt keine neuen Schlüssel", () => {
    const sim = new KQSim(JSON.parse(JSON.stringify(altStand.data.clusterSnapshot)) as Scenario);
    expect(revisionen(sim)).toEqual([1]);
    expect(out(sim, "kubectl rollout undo deployment/web")).toContain("no rollout history found");
    const eintrag = (sim.snapshot().deployments ?? []).find(d => d.name === "web");
    expect(eintrag).not.toHaveProperty("revision");
    expect(eintrag).not.toHaveProperty("rsHistory");
  });

  test("kaputte Historie: der Cluster lädt, höchstens 10 gültige Einträge, Invarianten heil", () => {
    const eintrag = (r: unknown, image: unknown = "img") => ({ revision: r, image });
    const viele = Array.from({ length: 15 }, (_, i) => eintrag(i + 1, "img:" + i));
    const faelle: Array<Record<string, unknown>> = [
      { rsHistory: "x" }, { revision: "a" }, { revision: -3, rsHistory: [eintrag(1)] }, { revision: 1.5, rsHistory: [eintrag(1)] },
      { revision: 5, rsHistory: [eintrag(2), eintrag(2, "andere")] }, { revision: 5, rsHistory: [eintrag(2), eintrag(3, "img")] },
      { revision: 3, rsHistory: [eintrag(3), eintrag(7)] }, { revision: 4, rsHistory: [eintrag(1, undefined), eintrag(2, "")] },
      { revision: 4, rsHistory: [null, 5, "x", eintrag("1")] }, { revision: 20, rsHistory: viele },
      { revision: 4, rsHistory: [{ revision: 1, image: "i", securityContext: "kaputt", emptyDir: 5 }] },
    ];
    for (const f of faelle) {
      const sim = new KQSim({ deployments: [{ name: "web", image: "web", replicas: 1, ...f }] });
      expect(replicaSetsOf(dep(sim)).length, JSON.stringify(f)).toBeLessThanOrEqual(REVISION_HISTORY_LIMIT + 1);
      expect(clusterInvariantViolations(sim), JSON.stringify(f)).toEqual([]);
    }
    const sim = new KQSim({ deployments: [{ name: "web", image: "web", replicas: 1, revision: 20, rsHistory: viele }] } as Scenario);
    expect(revisionen(sim)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20]);
    expect(new KQSim({ deployments: [{ name: "web", image: "web", replicas: 1, revision: 5, rsHistory: [eintrag(2), eintrag(2, "x")] }] } as Scenario).deployments[0].oldReplicaSets).toHaveLength(1);
  });

  test("Szenario mit vorbelegter rsHistory: undo funktioniert", () => {
    const sim = new KQSim({ deployments: [{ name: "web", image: "web:2", replicas: 2, revision: 2, rsHistory: [{ revision: 1, image: "web:1", memLimit: 128 }] }] });
    expect(revisionen(sim)).toEqual([1, 2]);
    expect(out(sim, "kubectl rollout undo deployment/web")).toBe("deployment.apps/web rolled back");
    expect(dep(sim).image).toBe("web:1");
    expect(dep(sim).memLimit).toBe(128);
    expect(revisionen(sim)).toEqual([2, 3]);
  });
});

describe("YAML und Invariante (10)", () => {
  test("get rs <alt> -o yaml: replicas 0, altes Image, Revisions-Annotation; die Liste hat alle ReplicaSets", () => {
    const sim = dreiRevisionen();
    const rev1 = replicaSetsOf(dep(sim)).find(r => r.revision === 1)!;
    const yaml = out(sim, "kubectl get rs " + rev1.name + " -o yaml");
    expect(yaml).toMatch(/deployment\.kubernetes\.io\/revision: "1"/);
    expect(yaml).toMatch(/^ {2}replicas: 0$/m);
    expect(yaml).toMatch(/image: nginx$/m);
    expect(yaml).not.toContain("nginx:2");
    const liste = out(sim, "kubectl get rs -o yaml");
    expect(liste.match(/kind: ReplicaSet/g)).toHaveLength(3);
  });

  test("Invariante (10) meldet eine verfälschte Historie", () => {
    const basis = () => dreiRevisionen();
    const meldungen = (mutiere: (d: ReturnType<typeof dep>) => void) => {
      const sim = basis(); mutiere(dep(sim));
      return clusterInvariantViolations(sim).join("\n");
    };
    expect(meldungen(() => undefined)).toBe("");
    expect(meldungen(d => { d.oldReplicaSets![1].hash = d.oldReplicaSets![0].hash; })).toContain("doppelte Hashes");
    expect(meldungen(d => { d.oldReplicaSets![0].revision = d.replicaSet!.revision; })).toContain("nicht unter der aktuellen");
    expect(meldungen(d => { d.oldReplicaSets![1].revision = d.oldReplicaSets![0].revision; })).toContain("doppelte Revisionen");
    expect(meldungen(d => { d.oldReplicaSets = Array.from({ length: 11 }, (_, i) => ({ ...d.oldReplicaSets![0], hash: "h" + i, revision: i })); })).toContain("höchstens 10");
    expect(meldungen(d => { d.oldReplicaSets![0].template.image = "anderes"; })).toContain("nicht zum Template passt");
  });
});
