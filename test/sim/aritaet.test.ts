/* Zentrale Arität (`maxArgs`) und Mehrfachziele in allen CLI-Familien (#1490): überzählige Positionsargumente werden
 * nirgends mehr still ignoriert. Pro Eintrag der Tabellen: 0 Argumente, genau maxArgs, maxArgs+1 (abgelehnt mit dem
 * zentralen Text). Dazu die Mehrfachziele (docker stop/rm, helm uninstall) mit einem fehlenden Ziel und die Gruppen
 * `terraform state` / `helm repo`. Prüft über `sim.exec`, nicht über die Interna von `cliargs`. */
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { KQSim, freshSim } from "./helpers";
import { type Aritaet, type Dispatch, type SubEntry, IM_HANDLER, OFFENE_LISTE, dispatchSub, flag } from "../../src/sim/cliargs";
import { KUBECTL } from "../../src/sim/kubectl";
import { GIT } from "../../src/sim/git";
import { DOCKER } from "../../src/sim/docker";
import { HELM } from "../../src/sim/helm";
import { ARGOCD } from "../../src/sim/argocd";
import { GLAB } from "../../src/sim/glab";
import { KUBEADM } from "../../src/sim/kubeadm";
import { AWS } from "../../src/sim/s3";
import { TERRAFORM } from "../../src/sim/terraform";
import { CURL_ARGS, NSLOOKUP_ARGS } from "../../src/sim/net";

const WEITERES = "Nicht simuliert: das weitere Argument";
const lauf = (cmd: string, sim: KQSim = freshSim()) => { const r = sim.exec(cmd); return { out: r.output ?? "", error: r.error, sim }; };

/** Die Wurzeln aller CLI-Familien. Ein neuer Dispatch-Kopf in `src/sim` muss hier stehen (Wächter unten). */
const WURZELN: Readonly<Record<string, Dispatch<SubEntry<unknown>>>> = { KUBECTL, GIT, DOCKER, HELM, ARGOCD, GLAB, KUBEADM, AWS, TERRAFORM };

/** Alle Blätter einer Dispatch-Tabelle mit ihrer Arität, Gruppen rekursiv (Befehlsname wie in den Meldungen). */
function blaetter(d: Dispatch<SubEntry<unknown>>): [string, Aritaet][] {
  return Object.entries(d.table).flatMap(([key, e]): [string, Aritaet][] =>
    "group" in e ? blaetter(e.group) : [[d.cmd + " " + key, e.maxArgs]]);
}
const ALLE_BLAETTER: [string, Aritaet][] = [
  ...Object.values(WURZELN).flatMap(blaetter),
  ["curl", CURL_ARGS.maxArgs], ["nslookup", NSLOOKUP_ARGS.maxArgs],
];
/** Eintrag: Befehl ohne Argumente + seine Höchstzahl, aus den Dispatch-Tabellen abgeleitet (ohne Marker-Einträge). */
const GRENZEN: [string, number][] = ALLE_BLAETTER.filter((e): e is [string, number] => typeof e[1] === "number");

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

describe("Wächter: Marker und Vollständigkeit der Tabellen", () => {
  test("jedes Blatt hat eine Höchstzahl (ganze Zahl ab 0) oder einen der beiden Marker, nie Infinity oder NaN", () => {
    expect(ALLE_BLAETTER.length).toBeGreaterThan(60);
    for (const [cmd, m] of ALLE_BLAETTER) {
      const gueltig = m === OFFENE_LISTE || m === IM_HANDLER || (typeof m === "number" && Number.isSafeInteger(m) && m >= 0);
      expect(gueltig, cmd + ": " + String(m)).toBe(true);
    }
  });
  test("die abgeleitete Liste kennt Gruppen-Blätter und lässt Marker-Einträge aus", () => {
    const namen = GRENZEN.map(g => g[0]);
    expect(namen).toContain("terraform state list");
    expect(namen).toContain("helm repo add");
    expect(namen).not.toContain("docker stop");
    expect(namen).not.toContain("kubectl scale");
  });
  test("jeder Dispatch-Kopf und jeder parseCall-Kopf in src/sim steht in den Wurzeln (kein Wächter ohne neue Familie)", () => {
    const dateien = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? dateien(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []);
    const quelle = dateien(path.resolve(__dirname, "../../src/sim")).map(f => fs.readFileSync(f, "utf8")).join("\n");
    const gefunden = new Set([
      ...[...quelle.matchAll(/dispatchSub\(\w+,\s*([A-Z_]+),/g)].map(m => m[1]),
      ...[...quelle.matchAll(/parseCall\(\w+,\s*([A-Z_]+)/g)].map(m => m[1]),
    ]);
    expect([...gefunden].sort()).toEqual([...Object.keys(WURZELN), "CURL_ARGS", "NSLOOKUP_ARGS"].sort());
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
  test("argocd app get a b, curl a b, nslookup a 10.96.0.10 x", () => {
    expect(lauf("argocd app get a b").out).toContain(WEITERES + " 'b' bei 'argocd app get'");
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
  test("docker rm a b mit zwei laufenden: beide Fehler, der Tipp kommt vom ersten", () => {
    const r = lauf("docker rm a b", zwei());
    expect(r.error).toBe(true);
    expect(r.out.match(/Error: Container läuft noch\./g)).toHaveLength(2);
    expect(r.out).toContain("Erst 'docker stop a'");
    expect(r.out).not.toContain("Erst 'docker stop b'");
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
    for (const art of ["deployment", "serviceaccount", "clusterrole", "kubectl create secret generic, tls", "configmap"]) expect(out).toContain(art);
    expect(out).not.toMatch(/\b(cm|sa|deploy)\b/);
  });
});

describe("kubectl rollout/set/auth als Gruppen (#1667 a): Flags vor dem Blatt, Blatt-Flags, Blatt-Arität", () => {
  const web = () => new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 2 }] });
  const pods = (s: KQSim) => s.deployments[0].pods.map(p => p.name);

  test("ein Gruppen-Flag steht vor dem Blatt (cobra Persistent Flags) und läuft weiter", () => {
    const s = web();
    expect(lauf("kubectl rollout -n default restart deployment web", s).out).toBe("deployment.apps/web restarted");
    expect(lauf("kubectl set -n default image deployment/web web=nginx:2", s).out).toContain("image updated");
    expect(lauf("kubectl set --namespace=default resources deployment/web --limits=memory=256Mi", s).out).toContain("resource requirements updated");
    expect(lauf("kubectl auth -n default can-i get pods", s).out).toBe("yes");
  });
  test("ein unbekanntes Flag vor dem Blatt wird abgelehnt, nichts passiert", () => {
    const s = web(); const vorher = pods(s);
    const r = lauf("kubectl rollout --bogus restart deployment web", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("das Flag '--bogus' vor dem Unterbefehl");
    expect(pods(s)).toEqual(vorher);
  });
  test("ein Flag vor dem Blatt ohne Wert: flag needs an argument; `--` vor dem Blatt wird abgelehnt", () => {
    expect(lauf("kubectl rollout -n").out).toContain("flag needs an argument: 'n' in -n");
    const s = web(); const vorher = pods(s);
    const r = lauf("kubectl rollout -- restart deployment web", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("vor dem Unterbefehl");
    expect(pods(s)).toEqual(vorher);
  });
  test("ein Gruppen-Flag ohne Blatt: Unterbefehl fehlt; ohne alles ebenso", () => {
    expect(lauf("kubectl set -n default").out).toContain("kubectl set: Unterbefehl fehlt.");
    expect(lauf("kubectl rollout").out).toContain("kubectl rollout: Unterbefehl fehlt.");
    expect(lauf("kubectl auth").out).toContain("kubectl auth: Unterbefehl fehlt.");
  });
  test("Blatt-Flags: --from nur bei set env, --limits nicht bei set env, --to-revision nur bei undo", () => {
    const s = web();
    const a = lauf("kubectl set image deployment/web web=nginx:2 --from=configmap/x", s);
    expect(a.error).toBe(true);
    expect(a.out).toContain("das Flag '--from' bei 'kubectl set image'");
    expect(s.deployments[0].image).toBe("nginx");
    expect(lauf("kubectl set env deployment/web --from=configmap/x --limits=memory=1Gi", s).out).toContain("das Flag '--limits' bei 'kubectl set env'");
    const vorher = pods(s);
    const r = lauf("kubectl rollout restart deployment web --to-revision=1", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("das Flag '--to-revision' bei 'kubectl rollout restart'");
    expect(r.out).toContain("kubectl rollout undo deployment <name> --to-revision=<n>");
    expect(pods(s)).toEqual(vorher);
    expect(lauf("kubectl rollout history deployment web --to-revision=1", s).out).toContain("das Flag '--to-revision' bei 'kubectl rollout history'");
    s.exec("kubectl set image deployment/web web=nginx:2");
    expect(lauf("kubectl rollout undo deployment web --to-revision=1", s).out).toContain("rolled back");
  });
  test("echte, nicht simulierte Aktionen und Tippfehler je Gruppe", () => {
    const status = lauf("kubectl rollout status deployment web");
    expect(status.out).toContain("Nicht simuliert: 'kubectl rollout status'.");
    expect(status.out).toContain("kubectl rollout restart, history, undo");
    expect(lauf("kubectl rollout restrat deployment web").out).toContain("Meintest du 'kubectl rollout restart'?");
    expect(lauf("kubectl rollout constructor deployment web").out).toContain('error: unknown command "constructor"');
    expect(lauf("kubectl auth whoami").out).toContain("Nicht simuliert: 'kubectl auth whoami'.");
    expect(lauf("kubectl set selector x").out).toContain("Nicht simuliert: 'kubectl set selector'.");
    expect(lauf("kubectl set selector x").out).toContain("kubectl set image, env, resources");
  });
});

describe("kubectl rollout restart deployment ohne Namen (#1667 b): alle Deployments, sortiert", () => {
  // Absichtlich in umgekehrter Namensreihenfolge angelegt: die Ausgabe ist nach Namen sortiert.
  const zwei = () => new KQSim({ deployments: [{ name: "zeta", image: "nginx", replicas: 1 }, { name: "alpha", image: "nginx", replicas: 1 }] });
  const podNamen = (s: KQSim) => s.deployments.flatMap(d => d.pods.map(p => p.name));

  test("startet alle Deployments neu, je Deployment eine Zeile nach Namen sortiert", () => {
    const s = zwei(); const vorher = podNamen(s);
    const r = lauf("kubectl rollout restart deployment", s);
    expect(r.error).toBe(false);
    expect(r.out.split("\n")).toEqual(["deployment.apps/alpha restarted", "deployment.apps/zeta restarted"]);
    expect(podNamen(s).filter(n => vorher.includes(n))).toEqual([]);
  });
  test("ohne Deployments: No resources found, kein Fehler", () => {
    const r = lauf("kubectl rollout restart deployment");
    expect(r.error).toBe(false);
    expect(r.out).toBe("No resources found in default namespace.");
  });
  test("-n prod: die Meldung des fremden Namespace, nichts wird neu gestartet", () => {
    const s = zwei(); const vorher = podNamen(s);
    const r = lauf("kubectl rollout restart deployment -n prod", s);
    expect(r.error).toBe(false);
    expect(r.out).toBe("No resources found in prod namespace.");
    expect(podNamen(s)).toEqual(vorher);
  });
  test("die Admission weist ab: Fehler, nichts wird neu gestartet", () => {
    const s = new KQSim({ deployments: [{ name: "a", image: "nginx", replicas: 1 }, { name: "b", image: "nginx", replicas: 1 }] });
    s.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
    const vorher = podNamen(s);
    const r = lauf("kubectl rollout restart deployment", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("pod-security");
    expect(podNamen(s)).toEqual(vorher);
  });
  test("ganz ohne Argument bleibt die Rückfrage; ein benanntes Deployment startet nur dieses neu", () => {
    const s = zwei();
    expect(lauf("kubectl rollout restart", s).out).toContain("kubectl rollout restart: Welches Deployment?");
    const alpha = s.deployments.find(d => d.name === "alpha")!.pods.map(p => p.name);
    const zeta = s.deployments.find(d => d.name === "zeta")!.pods.map(p => p.name);
    expect(lauf("kubectl rollout restart deployment alpha", s).out).toBe("deployment.apps/alpha restarted");
    expect(s.deployments.find(d => d.name === "zeta")!.pods.map(p => p.name)).toEqual(zeta);
    expect(s.deployments.find(d => d.name === "alpha")!.pods.map(p => p.name)).not.toEqual(alpha);
  });
});

describe("kubectl create hinter `--`: genau ein NAME davor (#1667 Z4)", () => {
  test("create deployment --image=nginx -- web: kein Name vor dem `--`, nichts angelegt", () => {
    const s = freshSim();
    const r = lauf("kubectl create deployment --image=nginx -- web", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("error: exactly one NAME is required, got 0");
    expect(s.deployments).toHaveLength(0);
  });
  test("create deployment a b --image=nginx -- sleep: zwei Namen davor", () => {
    expect(lauf("kubectl create deployment a b --image=nginx -- sleep").out).toContain("error: exactly one NAME is required, got 2");
  });
  test("secret generic: Art und Unterart zählen nicht als Name", () => {
    expect(lauf("kubectl create secret generic -- x").out).toContain("got 0");
    expect(lauf("kubectl create secret generic s --from-literal=a=b -- x").out).toContain("ein Befehl hinter '--' bei 'kubectl create secret generic'");
  });
});

describe("argocd app sync mit mehreren Apps (#1667 c): Abbruch beim ersten Fehler", () => {
  const app = (s: KQSim, n: string) => {
    s.files[n + ".yaml"] = "kind: Application";
    s.applyEffects[n + ".yaml"] = { application: { name: n, repo: "https://git.hafen.de/apps.git", path: n + "/", deployment: { name: n, image: "nginx", replicas: 1 }, service: { name: n, port: "80" } } };
    s.exec("kubectl apply -f " + n + ".yaml");
  };
  const zwei = () => { const s = freshSim(); app(s, "a"); app(s, "b"); return s; };

  test("argocd app sync a b synchronisiert beide, je App ein Block", () => {
    const s = zwei();
    const r = lauf("argocd app sync a b", s);
    expect(r.error).toBe(false);
    expect(r.out.match(/Synchronisiere Application/g)).toHaveLength(2);
    expect(s.deployments.map(d => d.name).sort()).toEqual(["a", "b"]);
  });
  test("sync a fehlt b: a ist synchronisiert, dann Abbruch beim Fehler, b bleibt unberührt", () => {
    const s = zwei();
    const r = lauf("argocd app sync a fehlt b", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("Synchronisiere Application 'a'");
    expect(r.out).toContain('applications.argoproj.io "fehlt" not found');
    expect(s.deployments.map(d => d.name)).toEqual(["a"]);
  });
  test("ohne Namen die Rückfrage, ein Name wie bisher", () => {
    const s = zwei();
    expect(lauf("argocd app sync", s).error).toBe(true);
    expect(lauf("argocd app sync a", s).out).toContain("Synchronisiere Application 'a'");
  });
});

describe("git add mit mehreren Pfaden (#1667 d): erst prüfen, dann vormerken", () => {
  const repo = () => { const s = freshSim(); s.exec("git init"); s.files["a.md"] = "a"; s.files["b.md"] = "b"; s.files["c.md"] = "c"; return s; };

  test("git add a.md b.md merkt beide vor, ein Pfad bleibt wie bisher wortgleich", () => {
    const s = repo();
    expect(lauf("git add a.md b.md", s).out).toBe("Vorgemerkt: a.md, b.md (bereit zum Commit).");
    expect(s.git.staged).toEqual(["a.md", "b.md"]);
    expect(lauf("git add c.md", s).out).toBe("Vorgemerkt: c.md (bereit zum Commit).");
  });
  test("ein fehlender Pfad: Fehler, NICHTS vorgemerkt (auch git add constructor)", () => {
    const s = repo();
    const r = lauf("git add a.md fehlt b.md", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("Die Datei 'fehlt' gibt es hier nicht.");
    expect(s.git.staged).toEqual([]);
    expect(lauf("git add constructor", s).out).toContain("Die Datei 'constructor' gibt es hier nicht.");
  });
  test("`.` mit weiteren Pfaden: jede Datei einmal; -A mit Pfad beschränkt sich auf den Pfad", () => {
    const s = repo();
    expect(lauf("git add . a.md", s).out).toBe("Vorgemerkt: a.md, b.md, c.md (bereit zum Commit).");
    expect(s.git.staged).toEqual(["a.md", "b.md", "c.md"]);
    const t = repo();
    expect(lauf("git add -A b.md", t).out).toBe("Vorgemerkt: b.md (bereit zum Commit).");
    expect(t.git.staged).toEqual(["b.md"]);
  });
  const konflikt = () => {
    const s = freshSim();
    s.exec("git init");
    s.files["seekarte.md"] = "deine Zeile"; s.exec("git add seekarte.md"); s.exec('git commit -m "start"');
    s.mergeScenario({ gitConflict: { branch: "kollege", file: "seekarte.md", ours: "deine Zeile", theirs: "fremde Zeile" } });
    s.exec("git merge kollege");
    s.files["neu.md"] = "neu";
    return s;
  };
  test("im Konflikt mit Markern: Fehler, nichts vorgemerkt, der Konflikt bleibt offen", () => {
    const s = konflikt();
    const r = lauf("git add seekarte.md neu.md", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("Konfliktmarker");
    expect(s.git.staged).toEqual([]);
    expect(s.git.conflict).not.toBeNull();
  });
  test("im Konflikt ohne Marker: löst und merkt beides vor", () => {
    const s = konflikt();
    s.exec("git checkout --theirs seekarte.md");
    const r = lauf("git add seekarte.md neu.md", s);
    expect(r.error).toBe(false);
    expect(r.out).toContain("Konflikt in 'seekarte.md' als gelöst markiert");
    expect(r.out).toContain("Vorgemerkt: neu.md (bereit zum Commit).");
    expect(s.git.staged).toEqual(expect.arrayContaining(["seekarte.md", "neu.md"]));
    expect(s.git.conflict).toBeNull();
  });
  test("der Quest-Schritt: git add <konfliktdatei> allein liefert genau die eine Zeile", () => {
    const s = konflikt();
    s.exec("git checkout --theirs seekarte.md");
    const r = lauf("git add seekarte.md", s);
    expect(r.error).toBe(false);
    expect(r.out).toBe("Konflikt in 'seekarte.md' als gelöst markiert (vorgemerkt). ▸ Schließe den Merge jetzt mit 'git commit --message \"…\"' ab.");
  });
  test("im Konflikt mit Markern: git add . bricht ab, nichts vorgemerkt, der Konflikt bleibt offen", () => {
    const s = konflikt();
    const r = lauf("git add .", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("Konfliktmarker");
    expect(s.git.staged).toEqual([]);
    expect(s.git.conflict).not.toBeNull();
  });
  test("im Konflikt ohne Marker: git add . löst und merkt das Unversionierte mit vor; ohne Neues nur die Konfliktzeile", () => {
    const s = konflikt();
    s.exec("git checkout --theirs seekarte.md");
    const r = lauf("git add .", s);
    expect(r.out).toBe("Konflikt in 'seekarte.md' als gelöst markiert (vorgemerkt). ▸ Schließe den Merge jetzt mit 'git commit --message \"…\"' ab.\nVorgemerkt: neu.md (bereit zum Commit).");
    expect(s.git.conflict).toBeNull();
    const t = konflikt();
    delete t.files["neu.md"];
    t.exec("git checkout --theirs seekarte.md");
    expect(lauf("git add .", t).out).toBe("Konflikt in 'seekarte.md' als gelöst markiert (vorgemerkt). ▸ Schließe den Merge jetzt mit 'git commit --message \"…\"' ab.");
  });
  test.each(["git add route.md", "git add ."])("eine nie committete Konfliktdatei (Drill-Zustand) steht bei %s nur einmal in der Ausgabe", befehl => {
    const zeile = "Konflikt in 'route.md' als gelöst markiert (vorgemerkt). ▸ Schließe den Merge jetzt mit 'git commit --message \"…\"' ab.";
    const s = freshSim();
    s.exec("git init");
    s.mergeScenario({ gitConflict: { branch: "k", file: "route.md", ours: "a", theirs: "b" } });
    s.exec("git merge k");
    s.exec("git checkout --theirs route.md");
    expect(lauf(befehl, s).out).toBe(zeile);
  });
  test("fehlt die Konfliktdatei im Ordner, löst git add <konfliktdatei> den Konflikt trotzdem (keine „gibt es hier nicht“-Meldung)", () => {
    const s = konflikt();
    s.exec("git checkout --theirs seekarte.md");
    delete s.files["seekarte.md"];
    const r = lauf("git add seekarte.md", s);
    expect(r.error).toBe(false);
    expect(r.out).not.toContain("gibt es hier nicht");
    expect(s.git.conflict).toBeNull();
    expect(s.git.staged).toContain("seekarte.md");
  });
  test("mitten im Konflikt scheitert ein ANDERER fehlender Pfad weiter: nichts vorgemerkt, der Konflikt bleibt offen", () => {
    const s = konflikt();
    s.exec("git checkout --theirs seekarte.md");
    const r = lauf("git add seekarte.md fehlt.md", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("Die Datei 'fehlt.md' gibt es hier nicht.");
    expect(s.git.staged).toEqual([]);
    expect(s.git.conflict).not.toBeNull();
  });
});

describe("persistentFlags: der Wert kommt beim Blatt an, auch über verschachtelte Gruppen", () => {
  test("kubectl rollout -n prod restart deployment: der Namespace prod gilt (nicht der Standard)", () => {
    const s = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
    const vorher = s.deployments[0].pods.map(p => p.name);
    expect(lauf("kubectl rollout -n prod restart deployment", s).out).toBe("No resources found in prod namespace.");
    expect(lauf("kubectl rollout --namespace=prod restart deployment", s).out).toBe("No resources found in prod namespace.");
    expect(s.deployments[0].pods.map(p => p.name)).toEqual(vorher);
  });
  test("eine Untergruppe erbt die persistentFlags der Eltern und ergänzt die eigenen (synthetische Tabelle)", () => {
    const run = () => "";
    const innen: Dispatch<SubEntry<unknown>> = { cmd: "x g i", flags: [flag(true, "--inner")], table: { blatt: { run, maxArgs: OFFENE_LISTE } } };
    const wurzel: Dispatch<SubEntry<unknown>> = { cmd: "x", flags: [flag(true, "--outer")], table: { g: { group: { cmd: "x g", table: { i: { group: innen } } } } } };
    const r = dispatchSub(freshSim(), wurzel, ["x", "--outer", "1", "g", "i", "--inner", "2", "blatt", "ziel"], 1);
    expect(typeof r).toBe("object");
    if (typeof r === "string") return;
    expect(r.sub).toBe("blatt");
    expect(r.call.value("--outer")).toBe("1");
    expect(r.call.value("--inner")).toBe("2");
    expect(r.call.args).toEqual(["ziel"]);
  });
});

describe("git checkout -- <datei> (#1667 e): der Pfad ist kein Branch", () => {
  test("wird ehrlich abgelehnt, der Branch bleibt", () => {
    const s = freshSim();
    s.exec("git init");
    const r = lauf("git checkout -- seekarte.md", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("Nicht simuliert: 'git checkout -- seekarte.md'");
    expect(s.git.branch).toBe("main");
  });
  test("ein Branch vor dem `--` wechselt weiter", () => {
    const s = freshSim();
    s.exec("git init");
    s.exec("git checkout -b dev");
    expect(lauf("git checkout main --", s).out).toContain("Gewechselt zu Branch 'main'");
  });
});

describe("Sollwert der Arität: unabhängig von den Tabellen", () => {
  test("jedes Blatt mit seiner Höchstzahl (ändert jemand maxArgs, ist das ein sichtbarer Diff hier)", () => {
    expect(ALLE_BLAETTER.map(([cmd, m]) => cmd + ": " + String(m))).toMatchInlineSnapshot(`
      [
        "kubectl get: offene-liste",
        "kubectl describe: offene-liste",
        "kubectl create deployment: im-handler",
        "kubectl create deploy: im-handler",
        "kubectl create serviceaccount: im-handler",
        "kubectl create sa: im-handler",
        "kubectl create role: im-handler",
        "kubectl create clusterrole: im-handler",
        "kubectl create rolebinding: im-handler",
        "kubectl create clusterrolebinding: im-handler",
        "kubectl create configmap: im-handler",
        "kubectl create cm: im-handler",
        "kubectl create secret generic: im-handler",
        "kubectl create secret tls: im-handler",
        "kubectl scale: offene-liste",
        "kubectl expose: im-handler",
        "kubectl delete: offene-liste",
        "kubectl apply: 0",
        "kubectl logs: 1",
        "kubectl top: 2",
        "kubectl set image: im-handler",
        "kubectl set env: im-handler",
        "kubectl set resources: im-handler",
        "kubectl rollout restart: offene-liste",
        "kubectl rollout history: im-handler",
        "kubectl rollout undo: im-handler",
        "kubectl auth can-i: im-handler",
        "kubectl label: im-handler",
        "git init: 0",
        "git status: 0",
        "git add: offene-liste",
        "git commit: im-handler",
        "git log: 0",
        "git branch: 1",
        "git checkout: 1",
        "git merge: 1",
        "git push: 2",
        "git fetch: 2",
        "git pull: 2",
        "docker pull: 1",
        "docker build: 1",
        "docker tag: 2",
        "docker images: 0",
        "docker run: offene-liste",
        "docker ps: 0",
        "docker stop: offene-liste",
        "docker rm: offene-liste",
        "helm repo add: 2",
        "helm repo update: 0",
        "helm repo list: 0",
        "helm search repo: 1",
        "helm create: 1",
        "helm template: 2",
        "helm lint: 1",
        "helm package: 1",
        "helm install: 2",
        "helm list: 0",
        "helm ls: 0",
        "helm upgrade: 2",
        "helm rollback: 2",
        "helm uninstall: offene-liste",
        "helm delete: offene-liste",
        "helm status: 1",
        "helm dependency update: 1",
        "helm dependency up: 1",
        "helm dependency build: 1",
        "helm dependency update: 1",
        "helm dependency up: 1",
        "helm dependency build: 1",
        "argocd app list: 0",
        "argocd app ls: 0",
        "argocd app get: 1",
        "argocd app sync: offene-liste",
        "glab ci status: 0",
        "glab ci view: 0",
        "glab ci list: 0",
        "kubeadm init: 0",
        "kubeadm join: im-handler",
        "kubeadm reset: 0",
        "aws s3 mb: 1",
        "aws s3 rb: 1",
        "aws s3 ls: 1",
        "aws s3 cp: 2",
        "aws s3 rm: 1",
        "terraform get: 0",
        "terraform init: 0",
        "terraform plan: 0",
        "terraform apply: 0",
        "terraform destroy: 0",
        "terraform state list: 0",
        "terraform output: 1",
        "terraform force-unlock: 1",
        "terraform fmt: 0",
        "terraform validate: 0",
        "curl: 1",
        "nslookup: 2",
      ]
    `);
  });
});
