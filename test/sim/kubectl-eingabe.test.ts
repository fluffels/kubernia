/* kubectl-Eingabetreue (#1444): Flags, Objektnamen, Kurznamen und Fehlertexte wie das echte kubectl.
 *   (a) nicht simulierte Flags werden mit Lernhinweis abgelehnt (statt still ignoriert),
 *   (b) `get <typ> <name>` filtert, (c) `get a,b` und `get all`, (d) nur echte Kurznamen,
 *   (e) fehlende Aliase, (f) EIN „nicht simuliert“-Text, (g) `expose --type` wird geprüft.
 * Tabellengetrieben; jede Gruppe hat ihre Negativfälle. */
import { describe, test, expect } from "vitest";
import { KQSim, freshSim } from "./helpers";
import { RESOURCE_KINDS, resolveKind, qualified, allKinds, type ResourcePlural } from "../../src/sim/kubectl/resources";
import { checkArgs, positionals, flagValueOf, typeAndName, slashRef } from "../../src/sim/kubectl/args";
import { GET_RENDERERS } from "../../src/sim/kubectl/inspect";
import type { Scenario } from "../../src/sim/state";

const NICHT_SIMULIERT = "Nicht simuliert:";

function szenario(): Scenario {
  return {
    deployments: [{ name: "web", image: "nginx", replicas: 2 }, { name: "api", image: "api:1", replicas: 1 }],
    services: [{ name: "web", type: "ClusterIP", clusterIP: "10.96.0.7", port: 80 }],
    secrets: [{ name: "geheim", keys: ["k"] }],
    storageClasses: [{ name: "standard", isDefault: true }, { name: "schnell" }],
    statefulSets: [{ name: "db", image: "db:1", replicas: 1 }],
    pvcs: [{ name: "daten", storage: "1Gi" }],
    grafanaDashboards: [{ name: "hafen", title: "Hafen", panels: 3 }],
  };
}

function lauf(cmd: string, sim: KQSim = new KQSim(szenario())) {
  const r = sim.exec(cmd);
  return { out: r.output ?? "", error: r.error, sim };
}

/* ---------- Registry (SSOT) ---------- */
describe("Registry: nur echte Kurznamen (kubectl api-resources / CRD-Manifeste)", () => {
  const ECHT: Record<string, string[]> = {
    pods: ["po"], deployments: ["deploy"], replicasets: ["rs"], services: ["svc"], endpoints: ["ep"], nodes: ["no"], namespaces: ["ns"],
    configmaps: ["cm"], ingresses: ["ing"], networkpolicies: ["netpol"], statefulsets: ["sts"],
    persistentvolumeclaims: ["pvc"], persistentvolumes: ["pv"], storageclasses: ["sc"], volumesnapshots: ["vs"],
    serviceaccounts: ["sa"], servicemonitors: ["smon"], prometheusrules: ["promrule"],
  };
  test.each(RESOURCE_KINDS.map(k => [k.plural, k.short] as const))("%s: %j", (plural, short) => {
    expect([...short]).toEqual(ECHT[plural] ?? []);
  });
  test("Typen ohne Kurznamen: secrets, roles, clusterroles, rolebindings, clusterrolebindings, Grafana", () => {
    for (const n of ["secrets", "roles", "clusterroles", "rolebindings", "clusterrolebindings", "grafanadatasources", "grafanadashboards"]) {
      expect(resolveKind(n)?.short, n).toEqual([]);
    }
  });
  test.each(["rb", "crb", "netpols", "promrules", "grafanadash", "grafanadatasrc", "unfug", ""])("%j ist kein Ressourcentyp", tok => {
    expect(resolveKind(tok)).toBeNull();
  });
  test("Plural, Singular, Kurzname und Gruppenform lösen auf, unabhängig von Groß/Klein", () => {
    for (const tok of ["deployments", "Deployment", "DEPLOY", "deployment.apps", "deploy.apps"]) expect(resolveKind(tok)?.plural, tok).toBe("deployments");
    expect(resolveKind("deployment.falsch")).toBeNull();
    expect(resolveKind("pods.apps")).toBeNull();   // pods liegen in der Core-Gruppe
  });
  test("qualified liefert die Formen mit Gruppe", () => {
    const dep = resolveKind("deploy")!;
    expect(qualified(dep, "plural")).toBe("deployments.apps");
    expect(qualified(dep, "singular")).toBe("deployment.apps");
    expect(qualified(resolveKind("po")!, "plural")).toBe("pods");
  });
  test("Kategorie all: Pods, Services, Deployments, ReplicaSets, StatefulSets und die Grafana-CRDs", () => {
    expect(allKinds().map(k => k.plural)).toEqual(["pods", "services", "deployments", "replicasets", "statefulsets", "grafanadatasources", "grafanadashboards"]);
  });
  test("jeder Typ außer namespaces hat einen get-Renderer (Registry und Renderer driften nicht)", () => {
    expect(RESOURCE_KINDS.filter(k => !GET_RENDERERS.has(k.plural)).map(k => k.plural)).toEqual(["namespaces"]);
    for (const k of GET_RENDERERS.keys()) expect(resolveKind(k), k).not.toBeNull();
  });
});

/* ---------- (d) erfundene Kurznamen ---------- */
describe("(d) erfundene Kurznamen sind weg, echte gehen weiter", () => {
  test.each(["rb", "crb", "netpols", "promrules", "grafanadash", "grafanadatasrc"])("get %s → unbekannter Ressourcentyp", tok => {
    const r = lauf("kubectl get " + tok);
    expect(r.error).toBe(true);
    expect(r.out).toContain(`the server doesn't have a resource type "${tok}"`);
  });
  test.each(["describe", "delete"])("%s netpols x → unbekannter Ressourcentyp", verb => {
    const r = lauf(`kubectl ${verb} netpols x`);
    expect(r.error).toBe(true);
    expect(r.out).toContain("doesn't have a resource type");
  });
  test.each(["po", "svc", "deploy", "rs", "ep", "cm", "ing", "netpol", "sts", "pvc", "pv", "sc", "vs", "sa", "smon", "promrule", "no"])("get %s geht", tok => {
    const r = lauf("kubectl get " + tok);
    expect(r.out).not.toContain("doesn't have a resource type");
  });
});

/* ---------- (a) nicht simulierte Flags ---------- */
describe("(a) nicht simulierte Flags werden abgelehnt", () => {
  test.each([
    ["get pods -l app=web", "-l"], ["get pods --selector=app=web", "--selector"], ["get pods -w", "-w"],
    ["get pods --watch", "--watch"], ["get pods --show-labels", "--show-labels"], ["get pods --sort-by=.metadata.name", "--sort-by"],
    ["describe pod x -o yaml", "-o"], ["logs web-x -c app", "-c"], ["delete pod web-x --force", "--force"], ["describe pod x --show-events", "--show-events"],
    ["create deployment x --image=nginx --dry-run=client", "--dry-run"], ["scale deployment web --replicas=2 --timeout=5s", "--timeout"],
  ])("kubectl %s → Nicht simuliert (%s)", (cmd, flag) => {
    const r = lauf("kubectl " + cmd);
    expect(r.error).toBe(true);
    expect(r.out).toContain(NICHT_SIMULIERT);
    expect(r.out).toContain("'" + flag + "'");
    expect(r.out).toContain("Der Simulator kann:");
  });
  test("-o bei anderen Unterbefehlen liefert den Lernhinweis, was stattdessen geht", () => {
    expect(lauf("kubectl describe pod x -o json").out).toContain("-o wide");
    expect(lauf("kubectl describe pod x -o json").out).toContain("kubectl describe");
  });
  // Die Formate bei get prüfen die Tests in kubectl-ausgabe.test.ts; -o yaml dreht #1467 um.
  test("-o yaml ist (bis #1467) nicht simuliert und druckt keine Tabelle", () => {
    const r = lauf("kubectl get pods -o yaml");
    expect(r.out).toContain(NICHT_SIMULIERT);
    expect(r.out).not.toContain("READY");
  });
  test("NEGATIV: --dry-run legt NICHTS an", () => {
    const sim = freshSim();
    sim.exec("kubectl create deployment x --image=nginx --dry-run=client");
    expect(sim.deployments.map(d => d.name)).not.toContain("x");
  });
  test.each([
    "get pods -o wide", "get pods -o=wide", "get pods -owide", "get pods --output wide", "get pods --output=wide", "get -o wide pods",
    "get pods -n kube-system", "get pods -nkube-system", "get pods -n=kube-system", "get pods --namespace=default",
    "get pods -A", "get pods --all-namespaces", "logs web-x -f", "logs web-x --follow", "logs web-x -p",
    "scale deployment web --replicas 3", "scale deployment web --replicas=3", "create deployment z --image=nginx --replicas=2",
    "set image deployment/web web=nginx:2", "auth can-i get pods --as=system:serviceaccount:default:x",
  ])("kubectl %s bleibt erlaubt", cmd => {
    expect(lauf("kubectl " + cmd).out).not.toContain(NICHT_SIMULIERT);
  });
  test("-nkube-system zeigt die System-Pods", () => {
    expect(lauf("kubectl get pods -nkube-system").out).toContain("coredns");
  });
  test.each([
    ["get pods -n", "error: flag needs an argument: 'n' in -n"],
    ["scale deployment web --replicas", "error: flag needs an argument: --replicas"],
    ["apply -f", "error: flag needs an argument: 'f' in -f"],
  ])("kubectl %s → fehlender Flag-Wert", (cmd, msg) => {
    const r = lauf("kubectl " + cmd);
    expect(r.error).toBe(true);
    expect(r.out).toContain(msg);
  });
  test("die Flag-Prüfung greift VOR dem Control-Plane-Gate (clientseitig wie in echtem kubectl)", () => {
    const sim = new KQSim({ ...szenario(), controlPlane: { up: false } });
    expect(sim.exec("kubectl get pods -o json").output).toContain(NICHT_SIMULIERT);
    expect(sim.exec("kubectl get pods -o foo").output).toContain("unable to match a printer");
    expect(sim.exec("kubectl get pods -o wide").output).toContain("connection to the server");
    expect(sim.exec("kubectl get pods").output).toContain("connection to the server");
  });
});

describe("Unterbefehle: echte kubectl-Befehle sind „nicht simuliert“, Tippfehler sind unbekannt", () => {
  test.each(["exec", "run", "edit", "port-forward", "api-resources", "version", "events", "patch"])("kubectl %s", sub => {
    const r = lauf("kubectl " + sub + " x");
    expect(r.error).toBe(true);
    expect(r.out).toContain(NICHT_SIMULIERT);
    expect(r.out).toContain("kubectl get");
  });
  test("describe ohne Typ → Fehlertext statt Absturz", () => {
    const r = lauf("kubectl describe");
    expect(r.error).toBe(true);
    expect(r.out).toContain("You must specify the type of resource to describe");
  });
  test("kubectl frobnicate → unknown command", () => {
    const r = lauf("kubectl frobnicate");
    expect(r.error).toBe(true);
    expect(r.out).toContain('error: unknown command "frobnicate" for "kubectl"');
    expect(r.out).not.toContain(NICHT_SIMULIERT);
  });
  test("Flag vor dem Unterbefehl ist nicht simuliert", () => {
    expect(lauf("kubectl -n kube-system get pods").out).toContain(NICHT_SIMULIERT);
  });
  test("ohne Unterbefehl bleibt der Hinweis", () => {
    expect(lauf("kubectl").out).toContain("Unterbefehl fehlt");
  });
});

/* ---------- (f) EIN Text für „nicht simuliert“ ---------- */
describe("(f) alle früheren Fundstellen nutzen den einen Helfer", () => {
  test.each([
    "describe configmap web", "create frobnicate x", "create secret docker-registry x", "set frobnicate x", "rollout undo deployment web",
    "auth reconcile", "label pods x a=b", "label namespaces default foo=bar", "delete nodes x", "logs statefulset/db",
    "scale pods/x --replicas=2", "expose pods/x --port=80",
  ])("kubectl %s", cmd => {
    const r = lauf("kubectl " + cmd);
    expect(r.error).toBe(true);
    expect(r.out).toContain(NICHT_SIMULIERT);
    expect(r.out).toContain("Der Simulator kann:");
  });
  test("top kennt nur pods und nodes (echter Text)", () => {
    const r = lauf("kubectl top secrets");
    expect(r.error).toBe(true);
    expect(r.out).toContain('error: unknown command "secrets" for "kubectl top"');
  });
  test("ein unbekannter Typ ist ein Typ-Fehler, nicht „nicht simuliert“", () => {
    for (const cmd of ["describe frob x", "delete frob x", "get frob"]) {
      const r = lauf("kubectl " + cmd);
      expect(r.out, cmd).toContain(`the server doesn't have a resource type "frob"`);
      expect(r.out, cmd).not.toContain(NICHT_SIMULIERT);
    }
  });
});

/* ---------- (b) Namensfilter ---------- */
describe("(b) get <typ> <name> filtert nach dem Namen", () => {
  test("get deploy web zeigt nur diese Zeile", () => {
    const r = lauf("kubectl get deploy web");
    expect(r.error).toBe(false);
    expect(r.out).toContain("web");
    expect(r.out).not.toMatch(/^api\b/m);
  });
  test("fehlender Name → NotFound mit qualifiziertem Typ", () => {
    const r = lauf("kubectl get deploy gibtsnicht");
    expect(r.error).toBe(true);
    expect(r.out).toContain('Error from server (NotFound): deployments.apps "gibtsnicht" not found');
    expect(r.out).not.toContain("READY");
  });
  test("get pods a b: gefundene Zeilen plus NotFound für den fehlenden", () => {
    const sim = new KQSim(szenario());
    const pod = sim.exec("kubectl get pods").output!.split("\n")[1].split(/\s+/)[0];
    const r = lauf(`kubectl get pods ${pod} fehlt`, sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain(pod);
    expect(r.out).toContain('Error from server (NotFound): pods "fehlt" not found');
  });
  test("Namen kommen in Eingabereihenfolge", () => {
    const out = lauf("kubectl get deploy web api").out;
    expect(out.indexOf("web")).toBeLessThan(out.indexOf("api\n") >= 0 ? out.indexOf("api\n") : out.lastIndexOf("api"));
    const umgekehrt = lauf("kubectl get deploy api web").out;
    expect(umgekehrt.indexOf("api")).toBeLessThan(umgekehrt.lastIndexOf("web"));
  });
  test("StorageClass: Name ohne den Zusatz „(default)“ filtert, die Zelle zeigt ihn weiter", () => {
    const r = lauf("kubectl get sc standard");
    expect(r.error).toBe(false);
    expect(r.out).toContain("standard (default)");
    expect(r.out).not.toContain("schnell");
  });
  test("Slash-Form get pod/<name> ohne Präfix", () => {
    const sim = new KQSim(szenario());
    const pod = sim.exec("kubectl get pods").output!.split("\n")[1].split(/\s+/)[0];
    const out = lauf(`kubectl get pod/${pod}`, sim).out;
    expect(out).toContain(pod);
    expect(out).not.toContain("pod/" + pod);
  });
  test("get nodes mit Namen und mit unbekanntem Namen", () => {
    const sim = new KQSim(szenario());
    const node = sim.exec("kubectl get nodes").output!.split("\n")[1].split(/\s+/)[0];
    expect(lauf("kubectl get nodes " + node, sim).error).toBe(false);
    const r = lauf("kubectl get nodes zz", sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain('Error from server (NotFound): nodes "zz" not found');
  });
  test("-A mit Namen ist ein Fehler", () => {
    const r = lauf("kubectl get pods -A web");
    expect(r.error).toBe(true);
    expect(r.out).toContain("a resource cannot be retrieved by name across all namespaces");
  });
  test("Name im fremden Namespace → NotFound", () => {
    const r = lauf("kubectl get deploy web -n anderer-ns");
    expect(r.error).toBe(true);
    expect(r.out).toContain('deployments.apps "web" not found');
  });
});

/* ---------- (c) Komma-Liste, all ---------- */
describe("(c) get a,b und get all", () => {
  test("get pods,svc: Präfixe, Leerzeile zwischen den Blöcken", () => {
    const r = lauf("kubectl get pods,svc");
    expect(r.error).toBe(false);
    expect(r.out).toMatch(/^pod\//m);
    expect(r.out).toContain("service/kubernetes");
    expect(r.out).toContain("\n\nNAME");
  });
  test("get deploy,sts trägt die Gruppe im Präfix", () => {
    const out = lauf("kubectl get deploy,sts").out;
    expect(out).toContain("deployment.apps/web");
    expect(out).toContain("statefulset.apps/db");
  });
  test("get all: pod/service/deployment, aber KEIN Secret", () => {
    const out = lauf("kubectl get all").out;
    expect(out).toMatch(/^pod\//m);
    expect(out).toContain("service/web");
    expect(out).toContain("deployment.apps/web");
    expect(out).toContain("grafanadashboard.grafana.integreatly.org/hafen");
    expect(out).not.toContain("geheim");
  });
  test("get all -n anderer-ns → Leermeldung", () => {
    expect(lauf("kubectl get all -n anderer-ns").out).toBe("No resources found in anderer-ns namespace.");
  });
  test("get pods,unfug → Typ-Fehler ohne Tabelle", () => {
    const r = lauf("kubectl get pods,unfug");
    expect(r.error).toBe(true);
    expect(r.out).toContain(`the server doesn't have a resource type "unfug"`);
    expect(r.out).not.toContain("READY");
  });
  test("leere Segmente in der Komma-Liste werden übergangen", () => {
    for (const cmd of ["kubectl get deploy,", "kubectl get ,deploy"]) {
      const r = lauf(cmd);
      expect(r.error, cmd).toBe(false);
      expect(r.out, cmd).toMatch(/^web /m);
      expect(r.out, cmd).not.toContain("deployment.apps/");
    }
  });
  test("ALL und Typ-Großschreibung; gleiche Typen in Slash-Form bilden einen Block ohne Präfix", () => {
    expect(lauf("kubectl get ALL").out).toContain("deployment.apps/web");
    expect(lauf("kubectl get FROB").out).toContain('resource type "frob"');
    const out = lauf("kubectl get deploy/web deploy/api").out;
    expect(out).not.toContain("deployment.apps/");
    expect(out).toMatch(/^web /m);
    expect(out).toMatch(/^api /m);
  });
  test("doppelte Typen erscheinen einmal", () => {
    const out = lauf("kubectl get deploy,deployments").out;
    expect(out.split(/\r?\n/).filter(l => l.startsWith("web "))).toHaveLength(1);
    expect(out).not.toContain("deployment.apps/");
  });
  test("get ns → nicht simuliert (Registry kennt den Typ, es gibt keinen Renderer)", () => {
    const r = lauf("kubectl get ns");
    expect(r.error).toBe(true);
    expect(r.out).toContain(NICHT_SIMULIERT);
  });
  test("Typ-Liste mit Namen ist mehrdeutig (echter Fehler)", () => {
    expect(lauf("kubectl get pods,svc web").out).toContain("you may only specify a single resource type");
  });
  test("gemischte Slash-Formen ergeben die echten Fehler", () => {
    expect(lauf("kubectl get deploy deploy/web").out).toContain("there is no need to specify a resource type as a separate argument");
    expect(lauf("kubectl get deploy/web api").out).toContain("arguments in resource/name form must have a single resource and name");
  });
  test("verschiedene Typen in Slash-Form bekommen Präfixe", () => {
    const out = lauf("kubectl get deploy/web svc/web").out;
    expect(out).toContain("deployment.apps/web");
    expect(out).toContain("service/web");
  });
  test("bisherige Einzelausgaben bleiben tabellengleich (kein Präfix bei einem Typ)", () => {
    expect(lauf("kubectl get deploy").out).not.toContain("deployment.apps/");
    expect(lauf("kubectl get secrets").out).toMatch(/^geheim\s+Opaque/m);
  });
  test("leerer Typ: Leermeldung wie zuvor", () => {
    expect(lauf("kubectl get cm").out).toBe("No resources found in default namespace.");
    expect(lauf("kubectl get pv", freshSim()).out).toBe("No resources found.");
  });
});

/* ---------- (e) fehlende Aliase ---------- */
describe("(e) Aliase: describe/scale/expose/logs/label", () => {
  const pod = (sim: KQSim) => sim.exec("kubectl get pods").output!.split("\n")[1].split(/\s+/)[0];
  test("describe po <pod> und describe pod/<pod>", () => {
    const sim = new KQSim(szenario());
    const p = pod(sim);
    expect(lauf(`kubectl describe po ${p}`, sim).out).toContain("Name:         " + p);
    expect(lauf(`kubectl describe pod/${p}`, sim).out).toContain("Name:         " + p);
  });
  test("describe roles / clusterroles (Plural)", () => {
    const sim = freshSim();
    sim.exec("kubectl create role leser --verb=get --resource=pods");
    sim.exec("kubectl create clusterrole cleser --verb=get --resource=nodes");
    expect(sim.exec("kubectl describe roles leser").output).toContain("Name:         leser");
    expect(sim.exec("kubectl describe clusterroles cleser").output).toContain("Name:         cleser");
    expect(sim.exec("kubectl describe role nix").output).toContain("roles.rbac.authorization.k8s.io");
    expect(sim.exec("kubectl describe clusterrole nix").output).toContain("clusterroles.rbac.authorization.k8s.io");
  });
  test.each(["deploy", "deployments", "deployment", "Deployment"])("scale %s/web", typ => {
    const sim = new KQSim(szenario());
    const r = lauf(`kubectl scale ${typ}/web --replicas=3`, sim);
    expect(r.error).toBe(false);
    expect(sim.deployments.find(d => d.name === "web")!.replicas).toBe(3);
  });
  test("scale deploy web (getrennt) und expose deploy/api", () => {
    const sim = new KQSim(szenario());
    expect(lauf("kubectl scale deploy web --replicas=1", sim).error).toBe(false);
    const r = lauf("kubectl expose deploy/api --port=80", sim);
    expect(r.error).toBe(false);
    expect(sim.services.some(s => s.name === "api")).toBe(true);
  });
  test("set image und rollout restart über Kurzname", () => {
    const sim = new KQSim(szenario());
    expect(lauf("kubectl set image deploy/web web=nginx:2", sim).out).toContain("image updated");
    expect(lauf("kubectl rollout restart deploy web", sim).out).toContain("restarted");
  });
  test("logs deploy/<n>: erster Pod, bei mehreren die Found-N-Zeile", () => {
    const sim = new KQSim(szenario());
    const r = lauf("kubectl logs deploy/web", sim);
    expect(r.error).toBe(false);
    expect(r.out).toMatch(/^Found 2 pods, using pod\/web-/);
    expect(r.out).toContain("GET /");
    expect(lauf("kubectl logs deploy/api", sim).out).not.toContain("Found");
    expect(lauf("kubectl logs deployment/api", sim).error).toBe(false);
  });
  test("logs deploy/<unbekannt> → NotFound; ohne Pods → timed out", () => {
    const sim = new KQSim(szenario());
    expect(lauf("kubectl logs deploy/zz", sim).out).toContain('deployments.apps "zz" not found');
    sim.exec("kubectl scale deploy/api --replicas=0");
    const r = lauf("kubectl logs deploy/api", sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain("error: timed out waiting for the condition");
  });
  test("logs pod/<n> und Typ-Fehler", () => {
    const sim = new KQSim(szenario());
    expect(lauf(`kubectl logs pod/${pod(sim)}`, sim).error).toBe(false);
    expect(lauf("kubectl logs frob/x", sim).out).toContain("doesn't have a resource type");
  });
  test("label namespaces / namespace / ns", () => {
    for (const typ of ["namespaces", "namespace", "ns"]) {
      const sim = freshSim();
      const r = sim.exec(`kubectl label ${typ} default pod-security.kubernetes.io/enforce=baseline`);
      expect(r.error, typ).toBe(false);
      expect(sim.podSecurity).toBe("baseline");
    }
  });
  test("NEGATIV: scale pods/x und expose pods/x lehnen ab", () => {
    expect(lauf("kubectl scale pods/x --replicas=1").out).toContain(NICHT_SIMULIERT);
    expect(lauf("kubectl expose pods/x --port=80").out).toContain(NICHT_SIMULIERT);
  });
  test("label --overwrite wird akzeptiert", () => {
    const sim = freshSim();
    expect(sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=baseline --overwrite").error).toBe(false);
  });
});

/* ---------- create --replicas ---------- */
describe("create deployment --replicas", () => {
  test("legt die gewünschte Zahl Pods an", () => {
    const sim = freshSim();
    sim.exec("kubectl create deploy web --image=nginx --replicas=2");
    expect(sim.deployments[0].pods).toHaveLength(2);
  });
  test.each(["abc", "-1", "1.5", ""])("--replicas=%j ist ungültig und legt nichts an", v => {
    const sim = freshSim();
    const r = sim.exec(`kubectl create deployment web --image=nginx --replicas=${v}`);
    expect(r.error).toBe(true);
    expect(r.output).toContain('invalid argument "' + v + '" for "--replicas" flag');
    expect(sim.deployments).toHaveLength(0);
  });
});

/* ---------- (g) expose --type ---------- */
describe("(g) expose --type prüft den Service-Typ", () => {
  test.each(["Foo", "nodeport", "clusterip", "loadbalancer"])("--type=%s wird abgelehnt und legt nichts an", typ => {
    const sim = new KQSim(szenario());
    const r = sim.exec(`kubectl expose deploy/api --port=80 --type=${typ}`);
    expect(r.error).toBe(true);
    expect(r.output).toContain(`The Service "api" is invalid: spec.type: Unsupported value: "${typ}": supported values: "ClusterIP", "ExternalName", "LoadBalancer", "NodePort"`);
    expect(sim.services.some(s => s.name === "api")).toBe(false);
  });
  test.each(["ClusterIP", "NodePort", "LoadBalancer"])("--type=%s geht", typ => {
    const sim = new KQSim(szenario());
    expect(sim.exec(`kubectl expose deploy/api --port=80 --type=${typ}`).error).toBe(false);
    expect(sim.services.find(s => s.name === "api")!.type).toBe(typ);
  });
  test("ein apply-Manifest mit type: Foo wird abgelehnt", () => {
    const sim = freshSim();
    sim.mergeScenario({ files: { "s.yaml": "apiVersion: v1\nkind: Service\nmetadata:\n  name: s\nspec:\n  type: Foo\n  ports:\n    - port: 80\n" } });
    const r = sim.exec("kubectl apply -f s.yaml");
    expect(r.error).toBe(true);
    expect(sim.services.some(s => s.name === "s")).toBe(false);
  });
});

/* ---------- Parser-Bausteine ---------- */
describe("args: positionals / flagValueOf / checkArgs / typeAndName", () => {
  const host = { _err: (m: string) => m };
  test("positionals überspringt Flags samt Wert, nicht aber Boolean-Flags", () => {
    expect(positionals("get", ["kubectl", "get", "-n", "x", "pods", "-A", "web"])).toEqual(["pods", "web"]);
    expect(positionals("get", ["kubectl", "get", "-nx", "pods", "--namespace=y"])).toEqual(["pods"]);
    expect(positionals("logs", ["kubectl", "logs", "-f", "pod"])).toEqual(["pod"]);
  });
  test("flagValueOf kennt alle Schreibweisen", () => {
    for (const t of [["-n", "x"], ["-n=x"], ["-nx"], ["--namespace", "x"], ["--namespace=x"]]) expect(flagValueOf(["kubectl", "get", ...t], ["-n", "--namespace"])).toBe("x");
    expect(flagValueOf(["kubectl", "get", "pods"], ["-n"])).toBeNull();
    expect(flagValueOf(["kubectl", "get", "-n"], ["-n"])).toBeNull();
  });
  test("checkArgs: bekannt → null, unbekannt → Text, Wert fehlt → Text", () => {
    expect(checkArgs(host, "get", ["kubectl", "get", "pods", "-A"])).toBeNull();
    expect(checkArgs(host, "get", ["kubectl", "get", "pods", "-x"])).toContain(NICHT_SIMULIERT);
    expect(checkArgs(host, "get", ["kubectl", "get", "-n"])).toContain("flag needs an argument");
    expect(checkArgs(host, "get", ["kubectl", "get", "-n", "x", "pods"])).toBeNull();
  });
  test("typeAndName: Slash-Form und getrennt", () => {
    expect(typeAndName(["pod/x"])).toEqual({ typ: "pod", name: "x" });
    expect(typeAndName(["pod", "x"])).toEqual({ typ: "pod", name: "x" });
    expect(typeAndName([])).toEqual({ typ: undefined, name: undefined });
  });
});

/* ---------- #1459: die Slash-Form `typ/name` wird an EINER Stelle zerlegt ---------- */
describe("slashRef: eine Zerlegung für get, describe, delete, scale/expose/set/rollout und logs", () => {
  const MEHR = "error: arguments in resource/name form may not have more than one slash";
  const EINZEL = "error: arguments in resource/name form must have a single resource and name";

  test("slashRef: kein Slash → null, gültig → Typ und Name, kaputt → kubectl-Text", () => {
    expect(slashRef("pods")).toBeNull();
    expect(slashRef("pod/x")).toEqual({ typ: "pod", name: "x" });
    expect(slashRef("a/b/c")).toEqual({ error: MEHR });
    for (const bad of ["pod/", "/x", "/", "pods,svc/x"]) expect(slashRef(bad), bad).toEqual({ error: EINZEL });
  });
  test("typeAndName reicht den Fehler durch", () => {
    expect(typeAndName(["pod/a/b"])).toEqual({ error: MEHR });
    expect(typeAndName(["pod/"])).toEqual({ error: EINZEL });
  });
  test.each([
    ["kubectl describe pod/", EINZEL],
    ["kubectl describe pod/a/b", MEHR],
    ["kubectl delete pod/", EINZEL],
    ["kubectl delete pod/a/b", MEHR],
    ["kubectl get pods/", EINZEL],
    ["kubectl get pods/a/b", MEHR],
    ["kubectl scale deploy/a/b --replicas=1", MEHR],
    ["kubectl scale deploy/ --replicas=1", EINZEL],
    ["kubectl logs /x", EINZEL],
    ["kubectl logs pod/a/b", MEHR],
  ])("%s → Fehler, nichts angefasst", (cmd, text) => {
    const sim = new KQSim(szenario());
    const vorher = JSON.stringify(sim.snapshot());
    const r = lauf(cmd, sim);
    expect(r.error, cmd).toBe(true);
    expect(r.out).toContain(text);
    expect(JSON.stringify(sim.snapshot()), cmd).toBe(vorher);
  });
  test("gültige Slash-Formen bleiben unverändert", () => {
    expect(lauf("kubectl describe node/ahoi-control").error).toBe(false);
    expect(lauf("kubectl scale deploy/web --replicas=3").out).toContain("scaled");
    expect(lauf("kubectl get deploy/web").error).toBe(false);
    expect(lauf("kubectl set image deployment/web nginx=reg.io/img:1").error).toBe(false);
    // Ein Image-Token mit mehreren Slashes VOR der Referenz ist keine Referenz, sondern wird übersprungen.
    const r = lauf("kubectl set image nginx=ghcr.io/org/img:1 deployment/web");
    expect(r.out).not.toContain("more than one slash");
    expect(r.error).toBe(false);
  });
});

/* ---------- #1459: Plural-Schlüssel der Renderer-Tabellen sind eine Literal-Union ---------- */
describe("ResourcePlural: getippte Schlüssel statt freier Strings", () => {
  test("Tippfehler im Plural ist ein Typfehler (@ts-expect-error), ein echter Plural nicht", () => {
    const ok: ResourcePlural = "deployments";
    // @ts-expect-error – "deploymnets" ist kein Plural der Registry
    const bad: ResourcePlural = "deploymnets";
    expect([ok, bad]).toHaveLength(2);
  });
});

/* ---------- #1469: Flags über den Flag-Leser statt `t.includes`/Regex auf der Rohzeile ---------- */
describe("kubectl: logs -f/-p, -A, --replicas über cliargs", () => {
  const withPod = () => {
    const s = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
    return { s, pod: s.exec("kubectl get pods").output!.split("\n")[1].split(/\s+/)[0] };
  };
  test("logs: Ketten (-fp), =true/=false, Flags vor und hinter dem Pod", () => {
    const { s, pod } = withPod();
    const plain = s.exec("kubectl logs " + pod).output!;
    const follow = s.exec("kubectl logs -f " + pod).output!;
    expect(follow).not.toBe(plain);
    expect(s.exec("kubectl logs -fp " + pod).output).toBe(s.exec("kubectl logs -f -p " + pod).output);
    expect(s.exec("kubectl logs --follow=true " + pod).output).toBe(follow);
    expect(s.exec("kubectl logs --follow=false " + pod).output).toBe(plain);
    expect(s.exec("kubectl logs -fn default " + pod).output).toBe(follow);
    expect(s.exec("kubectl logs " + pod + " --follow").output).toBe(follow);
  });
  test("logs: ein ungültiger Bool-Wert ist ein Fehler, nicht still true", () => {
    const { s, pod } = withPod();
    const r = s.exec("kubectl logs --follow=vielleicht " + pod);
    expect(r.error).toBe(true);
    expect(r.output).toContain('invalid argument "vielleicht" for "-f, --follow" flag');
  });
  test("get -A: =false schaltet es ab, =true und die Kette gelten", () => {
    const s = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
    expect(s.exec("kubectl get pods -A=false").output).not.toContain("NAMESPACE");
    expect(s.exec("kubectl get pods --all-namespaces=false").output).not.toContain("NAMESPACE");
    expect(s.exec("kubectl get pods --all-namespaces=true").output).toContain("NAMESPACE");
    expect(s.exec("kubectl get pods -A").output).toContain("NAMESPACE");
  });
  test("scale --replicas: Zahl, nicht 3.5 → 3; Text und negativ sind Fehler; Schreibweisen", () => {
    const s = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
    const rep = () => s.deployments.find(d => d.name === "web")!.replicas;
    expect(s.exec("kubectl scale deployment web --replicas 3").error).toBe(false);
    expect(rep()).toBe(3);
    expect(s.exec("kubectl scale --replicas=2 deployment web").error).toBe(false);
    expect(rep()).toBe(2);
    const frac = s.exec("kubectl scale deployment web --replicas=3.5");
    expect(frac.error).toBe(true);
    expect(frac.output).toContain('invalid argument "3.5" for "--replicas" flag: strconv.ParseInt: parsing "3.5": invalid syntax');
    expect(s.exec("kubectl scale deployment web --replicas=abc").error).toBe(true);
    expect(s.exec("kubectl scale deployment web --replicas=-1").output).toContain("The --replicas=COUNT flag is required, and COUNT must be greater than or equal to 0");
    expect(rep()).toBe(2);
    expect(s.exec("kubectl scale deployment web --replicas=0").error).toBe(false);
    expect(rep()).toBe(0);
    expect(s.exec("kubectl scale deployment web").output).toContain("So nicht ganz");
  });
  test("create deployment --replicas: gleicher Parser, 3.5 und Text abgelehnt, nichts angelegt", () => {
    const s = freshSim();
    expect(s.exec("kubectl create deployment a --image=nginx --replicas=3.5").output).toContain("strconv.ParseInt");
    expect(s.exec("kubectl create deployment a --image=nginx --replicas=abc").error).toBe(true);
    expect(s.exec("kubectl create deployment a --image=nginx --replicas=-1").error).toBe(true);
    expect(s.deployments.some(d => d.name === "a")).toBe(false);
    expect(s.exec("kubectl create deployment a --image=nginx --replicas=2").error).toBe(false);
  });
});
