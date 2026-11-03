/* Verschachtelte Unterbefehle: jedes Ziel hat seine EIGENEN Flags (#1491).
 * Ein Flag, das nur ein Geschwister-Ziel kennt, wird abgelehnt statt still angenommen (`create deployment web --verb=get`);
 * `-n` gilt als persistentes Flag der Ebene in jedem Ziel. Geprüft über `sim.exec`. */
import { describe, test, expect } from "vitest";
import { freshSim, KQSim } from "./helpers";
import { kannOf, type Dispatch, type FlagSpec } from "../../src/sim/cliargs";
import { KUBECTL } from "../../src/sim/kubectl";
import type { KubectlEntry } from "../../src/sim/kubectl/namespace";

const NS = "Nicht simuliert:";
const lauf = (cmd: string, sim: KQSim = freshSim()) => { const r = sim.exec(cmd); return { out: r.output ?? "", error: r.error, sim }; };
const zustand = (sim: KQSim) => JSON.stringify(sim.snapshot());

describe("kubectl create/set/auth: ein Flag eines anderen Ziels wird abgelehnt, der Zustand bleibt", () => {
  // [Befehl, abgelehntes Flag, Ziel in der Meldung]
  const FREMD: [string, string, string][] = [
    ["kubectl create deployment web --image=nginx --verb=get", "--verb", "kubectl create deployment"],
    ["kubectl create serviceaccount bot --image=nginx", "--image", "kubectl create serviceaccount"],
    ["kubectl create role leser --verb=get --resource=pods --role=x", "--role", "kubectl create role"],
    ["kubectl create clusterrole leser --verb=get --resource=pods --user=alice", "--user", "kubectl create clusterrole"],
    ["kubectl create rolebinding b --role=leser --user=alice --verb=get", "--verb", "kubectl create rolebinding"],
    ["kubectl create configmap c --from-literal=a=b --image=nginx", "--image", "kubectl create configmap"],
    ["kubectl create secret generic s --from-literal=a=b --cert=x", "--cert", "kubectl create secret generic"],
    ["kubectl create secret tls t --cert=a --key=b --from-literal=a=b", "--from-literal", "kubectl create secret tls"],
    ["kubectl set image deployment/web nginx=nginx:2 --limits=memory=1Gi", "--limits", "kubectl set image"],
    ["kubectl set env deployment/web --from=configmap/c --limits=memory=1Gi", "--limits", "kubectl set env"],
    ["kubectl set resources deployment/web --limits=memory=1Gi --from=configmap/c", "--from", "kubectl set resources"],
    ["kubectl auth can-i get pods --image=nginx", "--image", "kubectl auth can-i"],
    ["kubectl rollout restart deployment web --to-revision=1", "--to-revision", "kubectl rollout restart"],
    ["kubectl rollout history deployment web --to-revision=1", "--to-revision", "kubectl rollout history"],
  ];
  test.each(FREMD)("%s", (cmd, name, ziel) => {
    const sim = freshSim();
    lauf("kubectl create deployment web --image=nginx", sim);
    const vorher = zustand(sim);
    const r = lauf(cmd, sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain(NS + " das Flag '" + name + "' bei '" + ziel + "'");
    expect(zustand(sim)).toBe(vorher);
  });

  test("create clusterrolebinding --role: echter pflag-Text, kein „Nicht simuliert“, Zustand unverändert", () => {
    const sim = freshSim();
    const vorher = zustand(sim);
    const r = lauf("kubectl create clusterrolebinding b --clusterrole=leser --user=alice --role=x", sim);
    expect(r.error).toBe(true);
    expect(r.out.split("\n")[0]).toBe("error: unknown flag: --role");
    expect(r.out).not.toContain(NS);
    expect(zustand(sim)).toBe(vorher);
  });

  test("create deployment web --image=x --verb=get legt nichts an, ohne --verb schon", () => {
    const sim = freshSim();
    lauf("kubectl create deployment web --image=nginx --verb=get", sim);
    expect(sim.snapshot().deployments.some(d => d.name === "web")).toBe(false);
    expect(lauf("kubectl create deployment web --image=nginx", sim).out).toBe("deployment.apps/web created");
  });
  test("set image mit --limits ändert das Image nicht", () => {
    const sim = freshSim();
    lauf("kubectl create deployment web --image=nginx", sim);
    lauf("kubectl set image deployment/web nginx=nginx:2 --limits=memory=1Gi", sim);
    expect(sim.snapshot().deployments.find(d => d.name === "web")?.image).toBe("nginx");
    expect(lauf("kubectl set image deployment/web nginx=nginx:2", sim).error).toBe(false);
  });
  test("clusterrolebinding kennt --role nicht: der Hinweis nennt --clusterrole", () => {
    const r = lauf("kubectl create clusterrolebinding b --role=x --user=alice");
    expect(r.out).toContain("nutze '--clusterrole=<name>'");
  });
  test("set env/resources: der Hinweis zu --from nennt die Quelle", () => {
    expect(lauf("kubectl set resources deployment/web --limits=memory=1Gi --from=configmap/c").out).toContain("Eine Quelle für Variablen kennt nur");
  });
  test("rollout restart/history: der Hinweis nennt undo", () => {
    expect(lauf("kubectl rollout restart deployment web --to-revision=1").out).toContain("kubectl rollout undo deployment <name> --to-revision=<n>");
  });
});

describe("kubectl: Flags vor und hinter dem Ziel, Aliase, Tippfehler", () => {
  test("-n gilt als persistentes Flag der Ebene: vor dem Ziel, vor dem Gruppen-Namen, hinter dem Ziel", () => {
    for (const cmd of [
      "kubectl create -n default secret tls t1 --cert=a --key=b",
      "kubectl create secret -n default tls t2 --cert=a --key=b",
      "kubectl create secret tls t3 --cert=a --key=b -n default",
      "kubectl create --namespace default deployment d1 --image=nginx",
      "kubectl set -n default image deployment/web nginx=nginx:3",
    ]) {
      const sim = freshSim();
      lauf("kubectl create deployment web --image=nginx", sim);
      const r = lauf(cmd, sim);
      expect(r.error, cmd).toBe(false);
    }
  });
  test("ein Flag des Ziels VOR dem Ziel bleibt „vor dem Unterbefehl“ (nicht persistent)", () => {
    const r = lauf("kubectl create --image=nginx deployment web");
    expect(r.out).toContain(NS + " das Flag '--image' vor dem Unterbefehl");
    expect(lauf("kubectl create -f x.yaml").out).toContain("kubectl apply -f <datei>");
  });
  test("Aliase deploy, sa, cm teilen den Eintrag mit dem vollen Namen", () => {
    const sim = freshSim();
    expect(lauf("kubectl create deploy web --image=nginx --replicas=2", sim).out).toBe("deployment.apps/web created");
    expect(lauf("kubectl create sa bot", sim).out).toBe("serviceaccount/bot created");
    expect(lauf("kubectl create cm c --from-literal=a=b", sim).out).toBe("configmap/c created");
    expect(lauf("kubectl create deploy x --image=nginx --verb=get", sim).out).toContain("das Flag '--verb' bei 'kubectl create deploy'");
  });
  test("echte, nicht simulierte Ziele: Nicht simuliert; Tippfehler mit Vorschlag; Ziel fehlt", () => {
    expect(lauf("kubectl create job x").out).toContain(NS + " 'kubectl create job'.");
    expect(lauf("kubectl create secret docker-registry x").out).toContain(NS + " 'kubectl create secret docker-registry'.");
    expect(lauf("kubectl create deploymnet x").out).toContain("Meintest du 'kubectl create deployment'?");
    expect(lauf("kubectl create").out).toContain("kubectl create: Unterbefehl fehlt.");
    expect(lauf("kubectl rollout status deployment web").out).toContain(NS + " 'kubectl rollout status'.");
    expect(lauf("kubectl auth whoami").out).toContain(NS + " 'kubectl auth whoami'.");
  });
  test("ein Befehl hinter `--` nennt den vollen Namen des Ziels", () => {
    expect(lauf("kubectl create deploy web --image=nginx -- sleep 1").out).toContain("ein Befehl hinter '--' bei 'kubectl create deployment'");
  });
});

describe("helm dependency und helm search: Ziele mit eigener Tabelle", () => {
  test("dependency update/up/build mit Chart; list und hub sind echt, aber nicht simuliert", () => {
    const sim = freshSim();
    lauf("helm create mein", sim);
    for (const cmd of ["helm dependency update ./mein", "helm dep up ./mein", "helm dependency build ./mein"]) {
      expect(lauf(cmd, sim).out, cmd).toContain("Chart.lock updated");
    }
    expect(lauf("helm dep up ./mein a2", sim).out).toContain("das weitere Argument 'a2' bei 'helm dependency up'");
    expect(lauf("helm dependency list ./mein", sim).out).toContain(NS + " 'helm dependency list'.");
    expect(lauf("helm dependency", sim).out).toContain("helm dependency: Unterbefehl fehlt.");
    expect(lauf("helm dependency updat ./mein", sim).out).toContain("Meintest du 'helm dependency update'?");
    expect(lauf("helm search hub x", sim).out).toContain(NS + " 'helm search hub'.");
    expect(lauf("helm search", sim).out).toContain("helm search: Unterbefehl fehlt.");
  });
  test("dependency: Chart-Pfad fehlt, unbekannter Pfad, Zustand bleibt", () => {
    const sim = freshSim();
    const vorher = zustand(sim);
    expect(lauf("helm dependency update", sim).out).toContain("helm dependency update: Chart-Pfad fehlt.");
    expect(lauf("helm dep build ./gibtsnicht", sim).out).toContain('Error: path "./gibtsnicht" not found');
    expect(zustand(sim)).toBe(vorher);
  });
  test("dependency und search lehnen Flags anderer Befehle ab", () => {
    const sim = freshSim();
    lauf("helm create mein", sim);
    expect(lauf("helm dependency update ./mein --set x=1", sim).out).toContain("das Flag '--set' bei 'helm dependency update'");
    expect(lauf("helm search repo nginx --set x=1", sim).out).toContain("das Flag '--set' bei 'helm search repo'");
  });
});

describe("(c) übrige Familien: ein Flag eines Geschwister-Ziels wird abgelehnt", () => {
  test.each([
    ["aws s3 ls s3://b --force", "--force", "aws s3 ls"],
    ["aws s3 rb s3://b --recursive", "--recursive", "aws s3 rb"],
    ["helm repo add a https://u --set x=1", "--set", "helm repo add"],
    ["terraform state list -var-file=x", "-var-file", "terraform state list"],
    ["argocd app list --refresh", "--refresh", "argocd app list"],
    ["argocd app get web --revision=x", "--revision", "argocd app get"],
    ["argocd app sync web --prune", "--prune", "argocd app sync"],
    ["glab ci status --branch=x", "--branch", "glab ci status"],
    ["glab ci list --output=json", "--output", "glab ci list"],
  ])("%s", (cmd, name, ziel) => {
    const r = lauf(cmd);
    expect(r.error).toBe(true);
    expect(r.out).toContain(NS + " das Flag '" + name + "' bei '" + ziel + "'");
  });
});

/* ---------- -n als persistentes Wurzel-Flag und die Namespace-Wache (#1720) ---------- */
type Tab = Dispatch<KubectlEntry<unknown>>;
/** Alle kubectl-Blätter (Gruppen rekursiv): Befehlsname, Eintrag und die Tokens bis zum Blatt. */
function kubectlBlaetter(d: Tab, pfad: string[] = []): { cmd: string; entry: KubectlEntry<unknown>; tokens: string[] }[] {
  return Object.entries(d.table).flatMap(([key, e]) => "group" in e
    ? kubectlBlaetter(e.group, [...pfad, key])
    : [{ cmd: d.cmd + " " + key, entry: e, tokens: [...pfad, key] }]);
}
/** Eine Dispatch-Ebene und alle Gruppen darunter. */
const ebenen = (d: Tab): Tab[] => [d, ...Object.values(d.table).flatMap(e => "group" in e ? ebenen(e.group) : [])];
const BLAETTER = kubectlBlaetter(KUBECTL);
/** Aliase teilen den Eintrag: je Eintrag ein Blatt genügt. */
const EINDEUTIG = BLAETTER.filter((b, i) => BLAETTER.findIndex(o => o.entry === b.entry) === i);
const istNs = (f: FlagSpec) => f.names.includes("-n") || f.names.includes("--namespace");

describe("kubectl -n: persistentes Flag der Wurzel (#1720)", () => {
  test("-n steht nur an der Wurzel, in keiner Gruppe und an keinem Blatt", () => {
    expect(KUBECTL.flags?.filter(istNs)).toHaveLength(1);
    const andere = [...ebenen(KUBECTL).slice(1).flatMap(g => g.flags ?? []), ...BLAETTER.flatMap(b => b.entry.flags ?? [])];
    expect(andere.filter(istNs)).toEqual([]);
  });
  test("-n vor dem Unterbefehl, in allen Schreibweisen, wirkt wie dahinter", () => {
    const basis = lauf("kubectl get pods").out;
    for (const zeile of ["kubectl -n default get pods", "kubectl --namespace default get pods", "kubectl --namespace=default get pods",
      "kubectl -ndefault get pods", "kubectl get pods -n default"]) expect(lauf(zeile).out, zeile).toBe(basis);
    expect(lauf("kubectl -n prod get pods").out).toBe("No resources found in prod namespace.");
    for (const zeile of ["kubectl -n default create deployment d1 --image=nginx", "kubectl -n default rollout restart deployment web",
      "kubectl -n default auth can-i get pods", "kubectl -n default set image deployment/web nginx=nginx:3"]) {
      const sim = freshSim();
      lauf("kubectl create deployment web --image=nginx", sim);
      expect(lauf(zeile, sim).error, zeile).toBe(false);
    }
  });
  test("ein anderes Flag vor dem Unterbefehl bleibt abgelehnt", () => {
    for (const [zeile, name] of [["kubectl --image=x get pods", "--image"], ["kubectl -A get pods", "-A"], ["kubectl -o wide get pods", "-o"]]) {
      const r = lauf(zeile);
      expect(r.error, zeile).toBe(true);
      expect(r.out, zeile).toContain(NS + " das Flag '" + name + "' vor dem Unterbefehl.");
    }
  });
  test("-n ohne Wert und ohne Unterbefehl; der Wert wird nicht als Unterbefehl gelesen", () => {
    expect(lauf("kubectl -n").out).toContain("flag needs an argument");
    expect(lauf("kubectl -n prod").out).toContain("Unterbefehl fehlt");
    expect(lauf("kubectl -n get pods").out).toContain('unknown command "pods"');
  });
  test("(d) jedes Blatt nennt -n/--namespace genau einmal und vor den eigenen Flags; die Ansicht „kann“ bleibt", () => {
    for (const b of EINDEUTIG) {
      const out = lauf("kubectl " + b.tokens.join(" ") + " --gibtsnicht").out;
      expect(out.match(/-n\/--namespace/g), b.cmd).toHaveLength(1);
      expect(out, b.cmd).toContain("Flags: -n/--namespace <wert>");
    }
    expect(kannOf(KUBECTL)).toEqual([
      "kubectl get, describe, scale, expose, delete, apply, logs, top, label",
      "kubectl create deployment, serviceaccount, role, clusterrole, rolebinding, clusterrolebinding, configmap",
      "kubectl create secret generic, tls",
      "kubectl set image, env, resources",
      "kubectl rollout restart, history, undo",
      "kubectl auth can-i",
    ]);
  });
});

describe("Namespace-Wache: -n <fremd> wird nie still auf default angewendet (#1720)", () => {
  const FREMD = "Nicht simuliert: der Namespace 'prod' bei '";
  test.each(EINDEUTIG.map(b => [b.cmd, b.tokens, b.entry.namespace] as const))("%s (Markierung: %s)", (cmd, tokens, bezug) => {
    const out = lauf("kubectl " + tokens.join(" ") + " -n prod").out;
    expect(out.includes(FREMD + cmd + "'.")).toBe(!bezug);
    expect(out.includes(FREMD)).toBe(!bezug);
    expect(lauf("kubectl " + tokens.join(" ") + " -n default").out).not.toContain(FREMD);
  });
  test("nur die Handler, die -n selbst lesen oder clusterweit sind, tragen eine Markierung", () => {
    expect(EINDEUTIG.filter(b => b.entry.namespace).map(b => b.cmd + ":" + b.entry.namespace).sort()).toEqual([
      "kubectl create clusterrole:cluster", "kubectl create clusterrolebinding:cluster", "kubectl get:liest", "kubectl label:cluster", "kubectl rollout restart:liest",
    ]);
  });
  test("der Zustand bleibt unverändert", () => {
    for (const zeile of ["kubectl scale deployment web --replicas=5 -n prod", "kubectl create deployment neu --image=nginx -n prod",
      "kubectl delete deployment web -n prod", "kubectl set image deployment/web nginx=nginx:9 -n prod", "kubectl rollout restart deployment web -n prod"]) {
      const sim = freshSim();
      lauf("kubectl create deployment web --image=nginx", sim);
      const vorher = zustand(sim);
      lauf(zeile, sim);
      expect(zustand(sim), zeile).toBe(vorher);
    }
    const sim = freshSim();
    lauf("kubectl create deployment web --image=nginx", sim);
    expect(lauf("kubectl rollout restart deployment web -n prod", sim).out).toContain('deployments.apps "web" not found');
    expect(lauf("kubectl rollout restart deployment web -n default", sim).out).toContain("restarted");
  });
  test("clusterweite Ziele ignorieren -n wie kubectl", () => {
    const sim = freshSim();
    expect(lauf("kubectl create clusterrole cr --verb=get --resource=nodes -n prod", sim).out).toBe("clusterrole.rbac.authorization.k8s.io/cr created");
    expect(lauf("kubectl label namespace default pod-security.kubernetes.io/enforce=baseline -n prod", sim).error).toBe(false);
  });
  test("ohne Control-Plane kommt der Verbindungsfehler vor der Wache", () => {
    const out = lauf("kubectl describe pod x -n prod", new KQSim({ bareMetal: true })).out;
    expect(out).toContain("refused");
    expect(out).not.toContain(FREMD);
  });
});
