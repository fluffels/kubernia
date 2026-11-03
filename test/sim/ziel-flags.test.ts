/* Verschachtelte Unterbefehle: jedes Ziel hat seine EIGENEN Flags (#1491).
 * Ein Flag, das nur ein Geschwister-Ziel kennt, wird abgelehnt statt still angenommen (`create deployment web --verb=get`);
 * `-n` gilt als persistentes Flag der Ebene in jedem Ziel. Geprüft über `sim.exec`. */
import { describe, test, expect } from "vitest";
import { freshSim, KQSim } from "./helpers";

const NS = "Nicht simuliert:";
const lauf = (cmd: string, sim: KQSim = freshSim()) => { const r = sim.exec(cmd); return { out: r.output ?? "", error: r.error, sim }; };
const zustand = (sim: KQSim) => JSON.stringify(sim.snapshot());

describe("kubectl create/set/auth: ein Flag eines anderen Ziels wird abgelehnt, der Zustand bleibt", () => {
  // [Befehl, abgelehntes Flag]: das echte kubectl kennt das Flag an diesem Ziel nicht (#1989, gegen die kubectl-Quellen geprüft)
  const UNBEKANNT: [string, string][] = [
    ["kubectl create deployment web --image=nginx --verb=get", "--verb"],
    ["kubectl create serviceaccount bot --image=nginx", "--image"],
    ["kubectl create role leser --verb=get --resource=pods --role=x", "--role"],
    ["kubectl create rolebinding b --role=leser --user=alice --verb=get", "--verb"],
    ["kubectl create configmap c --from-literal=a=b --image=nginx", "--image"],
    ["kubectl create secret generic s --from-literal=a=b --cert=x", "--cert"],
    ["kubectl create secret tls t --cert=a --key=b --from-literal=a=b", "--from-literal"],
    ["kubectl set image deployment/web nginx=nginx:2 --limits=memory=1Gi", "--limits"],
    ["kubectl set env deployment/web --from=configmap/c --limits=memory=1Gi", "--limits"],
    ["kubectl set resources deployment/web --limits=memory=1Gi --from=configmap/c", "--from"],
    ["kubectl auth can-i get pods --image=nginx", "--image"],
    ["kubectl rollout restart deployment web --to-revision=1", "--to-revision"],
    ["kubectl rollout history deployment web --to-revision=1", "--to-revision"],
  ];
  test.each(UNBEKANNT)("%s: echter pflag-Text, kein „Nicht simuliert“, Zustand unverändert", (cmd, name) => {
    const sim = freshSim();
    lauf("kubectl create deployment web --image=nginx", sim);
    const vorher = zustand(sim);
    const r = lauf(cmd, sim);
    expect(r.error).toBe(true);
    expect(r.out.split("\n")[0]).toBe("error: unknown flag: " + name);
    expect(r.out).not.toContain(NS);
    expect(zustand(sim)).toBe(vorher);
  });

  test("create clusterrole --user: ein globales kubectl-Flag, kein „unknown flag“ (erfundener Text), Hinweis auf kubeconfig", () => {
    const sim = freshSim();
    const vorher = zustand(sim);
    const r = lauf("kubectl create clusterrole leser --verb=get --resource=pods --user=alice", sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain(NS + " das Flag '--user' bei 'kubectl create clusterrole'");
    expect(r.out).toContain("kubeconfig");
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
    expect(lauf("kubectl create deploy x --image=nginx --verb=get", sim).out.split("\n")[0]).toBe("error: unknown flag: --verb");
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

describe("Reihenfolge der Prüfungen wie kubectl (#1989): Pflicht-Flag, Validate, Builder", () => {
  const erste = (cmd: string, sim: KQSim = freshSim()) => lauf(cmd, sim).out.split("\n")[0];
  const unveraendert = (cmd: string, sim: KQSim = freshSim()) => {
    const vorher = zustand(sim);
    const r = lauf(cmd, sim);
    expect(zustand(sim), cmd).toBe(vorher);
    return r;
  };

  test("create deployment ohne --image: Pflicht-Flag vor der Namensprüfung (cobra), mit und ohne Namen", () => {
    expect(erste("kubectl create deployment")).toBe('error: required flag(s) "image" not set');
    expect(erste("kubectl create deployment web")).toBe('error: required flag(s) "image" not set');
    expect(erste("kubectl create deployment Web!")).toBe('error: required flag(s) "image" not set');
    expect(lauf("kubectl create deployment --image=nginx").out).not.toContain("required flag");
  });
  test("create deployment: leeres --image= zählt als gesetzt, der apiserver verlangt einen Container, nichts wird angelegt", () => {
    const r = unveraendert("kubectl create deployment w --image=");
    expect(r.error).toBe(true);
    expect(r.out.split("\n")[0]).toBe('error: failed to create deployment: Deployment.apps "w" is invalid: spec.template.spec.containers: Required value');
  });

  test("rolebinding: --serviceaccount im falschen Format erst NACH der Prüfung role/clusterrole", () => {
    expect(unveraendert("kubectl create rolebinding rb --serviceaccount=bad").out.split("\n")[0]).toBe("error: exactly one of clusterrole or role must be specified");
    expect(unveraendert("kubectl create rolebinding rb --role=r --serviceaccount=bad").out.split("\n")[0]).toBe("error: serviceaccount must be <namespace>:<name>");
  });
  test("rolebinding ohne Namen: die Namensprüfung kommt vor dem Format des Subjekts", () => {
    const r = unveraendert("kubectl create rolebinding --role=r --serviceaccount=bad");
    expect(r.out).not.toContain("serviceaccount must be");
    expect(r.error).toBe(true);
  });
  test("clusterrolebinding: Pflicht-Flag vor dem Format; mit leerem --clusterrole= zuerst das Format, dann der apiserver", () => {
    expect(unveraendert("kubectl create clusterrolebinding crb --serviceaccount=bad").out.split("\n")[0]).toBe('error: required flag(s) "clusterrole" not set');
    expect(unveraendert("kubectl create clusterrolebinding crb --clusterrole= --serviceaccount=bad").out.split("\n")[0]).toBe("error: serviceaccount must be <namespace>:<name>");
    expect(unveraendert("kubectl create clusterrolebinding crb --clusterrole=").out).toContain("roleRef.name: Required value");
  });
  test("clusterrolebinding ohne Namen: das Muster nennt --clusterrole, nicht --role", () => {
    const r = unveraendert("kubectl create clusterrolebinding --clusterrole=view");
    expect(r.out).toContain("--clusterrole=<rolle>");
    expect(r.out).not.toContain("--role=<rolle>");
    expect(unveraendert("kubectl create rolebinding --role=r").out).toContain("--role=<rolle>");
  });

  const MISSING = "error: You must provide one or more resources by argument or filename.\nExample resource specifications include:\n   '-f rsrc.yaml'\n   '--filename=rsrc.json'\n   '<resource> <name>'\n   '<resource>'";
  const web = () => { const s = freshSim(); lauf("kubectl create deployment web --image=nginx", s); return s; };
  test("set image: der Builder löst die Ressource VOR Validate auf (NotFound, Art ohne Namen, keine Ressource)", () => {
    expect(unveraendert("kubectl set image deployment/web", web()).out).toContain("error: at least one image update is required");
    expect(erste("kubectl set image deployment/fehlt", web())).toBe('Error from server (NotFound): deployments.apps "fehlt" not found');
    expect(erste("kubectl set image deployment", web())).toBe("error: resource(s) were provided, but no name was specified");
    expect(unveraendert("kubectl set image nginx=nginx:2", web()).out).toContain(MISSING);
    expect(unveraendert("kubectl set image", web()).out).toContain(MISSING);
  });
  test("set image: ohne Ressource steht der Builder-Text nicht in einer Validate-Liste", () => {
    expect(lauf("kubectl set image").out).not.toContain("[");
  });
});
