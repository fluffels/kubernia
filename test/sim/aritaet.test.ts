/* Zentrale Arität (`maxArgs`) und Mehrfachziele in allen CLI-Familien (#1490): überzählige Positionsargumente werden
 * nirgends mehr still ignoriert. Pro Eintrag der Tabellen: 0 Argumente, genau maxArgs, maxArgs+1 (abgelehnt mit dem
 * zentralen Text). Dazu die Mehrfachziele (docker stop/rm, helm uninstall) mit einem fehlenden Ziel und die Gruppen
 * `terraform state` / `helm repo`. Prüft über `sim.exec`, nicht über die Interna von `cliargs`. */
import { describe, test, expect } from "vitest";
import { KQSim, freshSim } from "./helpers";

const WEITERES = "Nicht simuliert: das weitere Argument";
const lauf = (cmd: string, sim: KQSim = freshSim()) => { const r = sim.exec(cmd); return { out: r.output ?? "", error: r.error, sim }; };

/** Eintrag: Befehl ohne Argumente + seine Höchstzahl (bewusst hier noch einmal aufgeschrieben: ändert jemand `maxArgs`, rot). */
const GRENZEN: readonly [string, number][] = [
  ["git init", 0], ["git status", 0], ["git add", 1], ["git log", 0], ["git branch", 1], ["git checkout", 1],
  ["git merge", 1], ["git push", 2], ["git fetch", 2], ["git pull", 2],
  ["docker pull", 1], ["docker build", 1], ["docker tag", 2], ["docker images", 0], ["docker ps", 0],
  ["helm search", 2], ["helm create", 1], ["helm template", 2], ["helm lint", 1], ["helm package", 1], ["helm install", 2],
  ["helm list", 0], ["helm ls", 0], ["helm upgrade", 2], ["helm rollback", 2], ["helm status", 1], ["helm dependency", 2], ["helm dep", 2],
  ["helm repo add", 2], ["helm repo update", 0], ["helm repo list", 0],
  ["aws s3 mb", 1], ["aws s3 rb", 1], ["aws s3 ls", 1], ["aws s3 cp", 2], ["aws s3 rm", 1],
  ["argocd app list", 0], ["argocd app ls", 0], ["argocd app get", 1], ["argocd app sync", 1],
  ["glab ci status", 0], ["glab ci view", 0], ["glab ci list", 0],
  ["kubeadm init", 0], ["kubeadm reset", 0],
  ["terraform get", 0], ["terraform init", 0], ["terraform plan", 0], ["terraform apply", 0], ["terraform destroy", 0],
  ["terraform state list", 0], ["terraform output", 1], ["terraform force-unlock", 1], ["terraform fmt", 0], ["terraform validate", 0],
  ["kubectl apply", 0], ["kubectl logs", 1], ["kubectl top", 2],
  ["curl", 1], ["nslookup", 2],
];

const args = (n: number) => Array.from({ length: n }, (_, i) => "a" + (i + 1)).join(" ");

describe("maxArgs je Eintrag: 0 Argumente, genau maxArgs, maxArgs+1", () => {
  test.each(GRENZEN)("%s (höchstens %i)", (cmd, max) => {
    expect(lauf(cmd).out).not.toContain(WEITERES);
    expect(lauf(cmd + " " + args(max)).out).not.toContain(WEITERES);
    const zuviel = lauf(cmd + " " + args(max + 1));
    expect(zuviel.error).toBe(true);
    expect(zuviel.out).toContain(WEITERES + " 'a" + (max + 1) + "' bei '" + cmd + "'.");
    expect(zuviel.out).toContain("Der Simulator kann: '" + cmd + "' " + (max === 0 ? "ohne Argumente" : "mit höchstens " + max + (max === 1 ? " Argument" : " Argumenten")));
  });
});

describe("Ablehnungen aus dem Ticket (b) ändern nichts", () => {
  test("git status x, git merge a b", () => {
    const s = freshSim();
    s.exec("git init");
    expect(lauf("git status x", s).out).toContain("das weitere Argument 'x' bei 'git status'");
    expect(lauf("git merge a b", s).out).toContain("das weitere Argument 'b' bei 'git merge'");
  });
  test("aws s3 mb s3://a s3://b legt keinen Bucket an", () => {
    const s = freshSim();
    expect(lauf("aws s3 mb s3://a s3://b", s).out).toContain("das weitere Argument 's3://b' bei 'aws s3 mb'");
    expect(s.objectStore.buckets).toHaveLength(0);
  });
  test("argocd app sync a b, argocd app get a b, git add a b, curl a b, nslookup a 10.96.0.10 x", () => {
    expect(lauf("argocd app sync a b").out).toContain(WEITERES + " 'b' bei 'argocd app sync'");
    expect(lauf("argocd app get a b").out).toContain(WEITERES + " 'b' bei 'argocd app get'");
    const s = freshSim();
    s.exec("git init");
    expect(lauf("git add a b", s).out).toContain(WEITERES + " 'b' bei 'git add'");
    expect(lauf("curl a b").out).toContain(WEITERES + " 'b' bei 'curl'");
    expect(lauf("nslookup a 10.96.0.10 x").out).toContain(WEITERES + " 'x' bei 'nslookup'");
  });
  test("docker images nginx, kubectl apply -f f x, kubectl logs p c, glab ci status x", () => {
    expect(lauf("docker images nginx").out).toContain(WEITERES + " 'nginx' bei 'docker images'");
    expect(lauf("kubectl apply -f f x").out).toContain(WEITERES + " 'x' bei 'kubectl apply'");
    expect(lauf("kubectl logs p c").out).toContain(WEITERES + " 'c' bei 'kubectl logs'");
    expect(lauf("glab ci status x").out).toContain(WEITERES + " 'x' bei 'glab ci status'");
  });
  test("kubeadm join a b behält den cobra-Wortlaut, docker run mit Container-Befehl läuft weiter", () => {
    expect(lauf("kubeadm join a b").out).toContain("accepts at most 1 arg(s), received 2");
    expect(lauf("kubeadm join a b").out).not.toContain(WEITERES);
    const r = lauf("docker run nginx sleep 1");
    expect(r.out).not.toContain(WEITERES);
    expect(r.sim.docker.containers).toHaveLength(1);
  });
});

describe("docker stop/rm: Mehrfachziele, je Ziel eine Zeile", () => {
  const zwei = () => { const s = freshSim(); s.exec("docker run -d --name a nginx"); s.exec("docker run -d --name b nginx"); return s; };

  test("docker stop a b hält beide an, je Ziel eine Zeile", () => {
    const s = zwei();
    const r = lauf("docker stop a b", s);
    expect(r.error).toBe(false);
    expect(r.out.split("\n")).toEqual(["a", "b"]);
    expect(s.docker.containers.map(c => c.running)).toEqual([false, false]);
  });
  test("docker stop a fehlt b: a und b laufen durch, der Fehler steht zuletzt mit Tipp", () => {
    const s = zwei();
    const r = lauf("docker stop a fehlt b", s);
    expect(r.error).toBe(true);
    expect(r.out.split("\n").slice(0, 3)).toEqual(["a", "b", "Error: No such container: fehlt"]);
    expect(r.out).toContain("Mit 'docker ps'");
    expect(s.docker.containers.map(c => c.running)).toEqual([false, false]);
  });
  test("docker rm a b: beide weg; docker rm a fehlt b: a und b weg, Fehler zuletzt", () => {
    const s = zwei();
    s.exec("docker stop a b");
    const r = lauf("docker rm a fehlt b", s);
    expect(r.error).toBe(true);
    expect(r.out.split("\n").slice(0, 3)).toEqual(["a", "b", "Error: No such container: fehlt"]);
    expect(s.docker.containers).toHaveLength(0);
  });
  test("docker rm a b mit laufendem b: a weg, b bleibt, Fehler mit Tipp", () => {
    const s = zwei();
    s.exec("docker stop a");
    const r = lauf("docker rm a b", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("a\nError: Container läuft noch.");
    expect(r.out).toContain("Erst 'docker stop b'");
    expect(s.docker.containers.map(c => c.name)).toEqual(["b"]);
  });
  test("ohne Ziel: die bisherige Rückfrage", () => {
    expect(lauf("docker stop").out).toContain("docker stop: Welcher Container?");
    expect(lauf("docker rm").out).toContain("docker rm: Welcher Container?");
  });
});

describe("helm uninstall: Mehrfachziele, Abbruch beim ersten Fehler wie das echte helm", () => {
  const zwei = () => {
    const s = new KQSim({ helmRepos: [{ name: "bitnami", url: "https://charts.bitnami.com/bitnami" }] });
    s.exec("helm install a bitnami/nginx");
    s.exec("helm install b bitnami/nginx");
    return s;
  };

  test("helm uninstall a b entfernt beide, je Release eine Zeile", () => {
    const s = zwei();
    const r = lauf("helm uninstall a b", s);
    expect(r.error).toBe(false);
    expect(r.out.split("\n")).toEqual(['release "a" uninstalled', 'release "b" uninstalled']);
    expect(s.releases).toHaveLength(0);
  });
  test("helm uninstall a fehlt b: a ist weg, dann Abbruch, b bleibt installiert", () => {
    const s = zwei();
    const r = lauf("helm uninstall a fehlt b", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain('release "a" uninstalled');
    expect(r.out).toContain("Release not loaded: fehlt");
    expect(r.out).not.toContain('release "b" uninstalled');
    expect(s.releases.map(x => x.name)).toEqual(["b"]);
  });
  test("helm delete ist derselbe Eintrag; ohne Namen die bisherige Fehlermeldung", () => {
    const s = zwei();
    expect(lauf("helm delete a b", s).out.split("\n")).toHaveLength(2);
    expect(lauf("helm uninstall").out).toContain("Release not loaded: ?");
  });
});

describe("Gruppen terraform state und helm repo", () => {
  test("terraform state list ok, mit Argument abgelehnt, show ist echt aber nicht simuliert, ohne Unterbefehl ein Fehler", () => {
    const s = freshSim();
    s.exec("terraform init");
    s.exec("terraform apply");
    expect(lauf("terraform state list", s).error).toBe(false);
    expect(lauf("terraform state list x", s).out).toContain("das weitere Argument 'x' bei 'terraform state list'");
    expect(lauf("terraform state show x", s).out).toContain("Nicht simuliert: 'terraform state show'.");
    expect(lauf("terraform state", s).out).toContain("terraform state: Unterbefehl fehlt.");
  });
  test("terraform state erbt den goflag-Stil: `-out` heißt `-out`, nicht `-o`", () => {
    expect(lauf("terraform state list -out=x").out).toContain("das Flag '-out' bei 'terraform state list'");
  });
  test("helm repo: add/update/list, Argumente begrenzt, Tippfehler mit Vorschlag", () => {
    const s = freshSim();
    expect(lauf("helm repo add bitnami https://charts.bitnami.com/bitnami", s).out).toBe('"bitnami" has been added to your repositories');
    expect(lauf("helm repo list", s).out).toContain("bitnami");
    expect(lauf("helm repo update", s).out).toContain("Update Complete");
    expect(lauf("helm repo list x", s).out).toContain("das weitere Argument 'x' bei 'helm repo list'");
    expect(lauf("helm repo add a u x", s).out).toContain("das weitere Argument 'x' bei 'helm repo add'");
    expect(lauf("helm repo ad", s).out).toContain("Meintest du 'helm repo add'?");
    expect(lauf("helm repo remove x", s).out).toContain("Nicht simuliert: 'helm repo remove'.");
    expect(lauf("helm repo add nurname", s).out).toContain("helm repo add: Name und URL fehlen.");
  });
});

describe("kubectl: create hinter `--`, label, Liste der create-Arten", () => {
  test("create deployment … -- cmd wird abgelehnt und legt nichts an, ohne `--` läuft es", () => {
    const s = freshSim();
    const r = lauf("kubectl create deployment web --image=nginx -- sleep 1", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("ein Befehl hinter '--' bei 'kubectl create deployment'");
    expect(s.deployments.some(d => d.name === "web")).toBe(false);
    expect(lauf("kubectl create deployment web --image=nginx", s).out).toBe("deployment.apps/web created");
    expect(lauf("kubectl create deployment web2 --image=nginx --", s).out).toBe("deployment.apps/web2 created");
  });
  test("create <art> -- cmd gilt zentral für jede Art (configmap)", () => {
    expect(lauf("kubectl create configmap c --from-literal=a=b -- x").out).toContain("ein Befehl hinter '--' bei 'kubectl create configmap'");
  });
  test("kubectl create foo: die Liste der Arten kommt aus der Tabelle, ohne Kurzformen", () => {
    const out = lauf("kubectl create foo").out;
    for (const art of ["deployment", "serviceaccount", "clusterrole", "secret generic", "secret tls", "configmap"]) expect(out).toContain(art);
    expect(out).not.toMatch(/\b(cm|sa|deploy)\b/);
  });
});
