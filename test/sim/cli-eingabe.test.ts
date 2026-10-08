/* CLI-Eingabetreue der übrigen Familien (#1459): die gemeinsame Flag-Prüfung `sim/cliargs.ts` und ihre
 * Anwendung auf docker, helm, argocd, glab und terraform.
 *   (a) reine Tests der Parser (beide Stile: pflag/goflag, Ketten kurzer Flags, fehlender Wert, Hinweise),
 *   (b) je Familie: nicht ausgewertete Flags werden abgelehnt, ausgewertete bleiben gültig,
 *   (c) Inventur: JEDE Musterlösung der Befehlskarten, Quests und Drills läuft ohne „Nicht simuliert“. */
import { describe, test, expect } from "vitest";
import { freshSim, KQSim } from "./helpers";
import { KQContent } from "../../src/content";
import {
  flag, checkFlags, positionalArgs, flagValueOf, parseCall, shellTokens, subEntry, notSimulated, specOfSub, type ArgSpec,
} from "../../src/sim/cliargs";

const NS = "Nicht simuliert:";
const host = { _err: (m: string, tip?: string) => m + (tip ? "\n" + tip : "") };

const PF: ArgSpec = {
  cmd: "x run", flags: [flag(true, "-n", "--namespace"), flag(false, "-a", "--all"), flag(false, "-d", "--detach")],
  hints: { "-o": "Format gibt es nicht." },
};
const GO: ArgSpec = { cmd: "tf apply", style: "goflag", flags: [flag(true, "-var-file"), flag(false, "-auto-approve")] };

describe("cliargs: pflag-Stil", () => {
  test.each([
    [["x", "run", "-n", "a"]], [["x", "run", "-n=a"]], [["x", "run", "-na"]], [["x", "run", "--namespace", "a"]],
    [["x", "run", "--namespace=a"]], [["x", "run", "-ad"]], [["x", "run", "-adn", "a"]], [["x", "run", "-da"]], [["x", "run", "-a=true"]],
  ])("gültig: %j", (t) => { expect(checkFlags(host, PF, t, 2)).toBeNull(); });

  test("unbekanntes Flag: voller Text, Liste und Hinweis", () => {
    const r = checkFlags(host, PF, ["x", "run", "-o", "wide"], 2)!;
    expect(r).toContain("Nicht simuliert: das Flag '-o' bei 'x run'. Format gibt es nicht.");
    expect(r).toContain("Der Simulator kann: Flags: -n/--namespace <wert>, -a/--all, -d/--detach");
  });
  test("Kette kurzer Flags prüft jedes Zeichen (-aq lehnt -q ab, -ax lehnt -x ab)", () => {
    expect(checkFlags(host, PF, ["x", "run", "-aq"], 2)).toContain("das Flag '-q'");
    expect(checkFlags(host, PF, ["x", "run", "-da", "-x"], 2)).toContain("das Flag '-x'");
  });
  test("langes unbekanntes Flag mit Wert: Name ohne =", () => {
    expect(checkFlags(host, PF, ["x", "run", "--output=json"], 2)).toContain("das Flag '--output'");
  });
  test("Wert-Flag ohne Wert: Fehler, kurz und lang", () => {
    expect(checkFlags(host, PF, ["x", "run", "-n"], 2)).toContain("flag needs an argument: 'n' in -n");
    expect(checkFlags(host, PF, ["x", "run", "--namespace"], 2)).toContain("flag needs an argument: --namespace");
    expect(checkFlags(host, PF, ["x", "run", "-ad"], 2)).toBeNull();
  });
  test("Wert eines Flags wird nicht als Flag geprüft (-n -o ist der Wert '-o')", () => {
    expect(checkFlags(host, PF, ["x", "run", "-n", "-o"], 2)).toBeNull();
  });
  test("-h/--help bekommt den Hinweis auf 'help <cli>'", () => {
    expect(checkFlags(host, PF, ["x", "run", "--help"], 2)).toContain("'help x'");
    expect(checkFlags(host, PF, ["x", "run", "-h"], 2)).toContain("'help x'");
  });
  test("leere Tabelle: 'ohne Flags'", () => {
    expect(checkFlags(host, { cmd: "x list", flags: [] }, ["x", "list", "-q"], 2)).toContain("Der Simulator kann: 'x list' ohne Flags");
  });
  test("Flags vor `from` werden nicht geprüft", () => {
    expect(checkFlags(host, PF, ["x", "-q", "run"], 3)).toBeNull();
  });
  test("stopAtPositional: nach dem ersten Nicht-Flag ist alles Container-Befehl", () => {
    const run: ArgSpec = { ...PF, stopAtPositional: true };
    expect(checkFlags(host, run, ["x", "run", "-d", "img", "--wirr", "-q"], 2)).toBeNull();
    expect(checkFlags(host, run, ["x", "run", "-q", "img"], 2)).toContain("'-q'");
    expect(positionalArgs(run, ["x", "run", "-d", "img", "--wirr", "-q"], 2)).toEqual(["img", "--wirr", "-q"]);
  });
  test("positionalArgs: ohne Flags und Flag-Werte, auch bei Ketten", () => {
    expect(positionalArgs(PF, ["x", "run", "-n", "ns", "a", "-ad", "b", "--namespace=c", "d"], 2)).toEqual(["a", "b", "d"]);
    expect(positionalArgs(PF, ["x", "run", "-adn", "ns", "a"], 2)).toEqual(["a"]);
    expect(positionalArgs(PF, ["x", "run", "-"], 2)).toEqual(["-"]);
  });
});

describe("cliargs: goflag-Stil (terraform)", () => {
  test.each([
    [["tf", "apply", "-var-file=x"]], [["tf", "apply", "-var-file", "x"]], [["tf", "apply", "--var-file=x"]],
    [["tf", "apply", "-auto-approve"]], [["tf", "apply", "--auto-approve"]], [["tf", "apply", "-auto-approve=true"]],
  ])("gültig: %j", (t) => { expect(checkFlags(host, GO, t, 2)).toBeNull(); });

  test("der Name ist alles vor dem '=': -out=plan ist -out, nicht -o", () => {
    expect(checkFlags(host, GO, ["tf", "apply", "-out=plan"], 2)).toContain("das Flag '-out'");
    expect(checkFlags(host, GO, ["tf", "apply", "--out", "plan"], 2)).toContain("das Flag '-out'");
  });
  test("bool-Flag nimmt nie das nächste Token, Wert-Flag ohne '=' schon", () => {
    expect(positionalArgs(GO, ["tf", "apply", "-auto-approve", "x"], 2)).toEqual(["x"]);
    expect(positionalArgs(GO, ["tf", "apply", "-var-file", "f", "x"], 2)).toEqual(["x"]);
  });
  test("Wert-Flag ohne Wert: Go-Text", () => {
    expect(checkFlags(host, GO, ["tf", "apply", "-var-file"], 2)).toContain("flag needs an argument: -var-file");
  });
});

describe("cliargs: flagValueOf und Helfer", () => {
  test.each([
    [["a", "-n", "x"], "x"], [["a", "-n=x"], "x"], [["a", "-nx"], "x"], [["a", "--namespace", "x"], "x"],
    [["a", "--namespace=x"], "x"], [["a", "-n"], null], [["a"], null],
  ])("pflag %j → %j", (t, erwartet) => { expect(flagValueOf(t, ["-n", "--namespace"])).toBe(erwartet); });
  test("pflag: kurzes Flag mit angeklebtem Wert", () => { expect(flagValueOf(["docker", "build", "-tname:1", "."], ["-t", "--tag"])).toBe("name:1"); });
  test("goflag: -var-file=x und -var-file x", () => {
    expect(flagValueOf(["tf", "-var-file=x"], ["-var-file"], "goflag")).toBe("x");
    expect(flagValueOf(["tf", "--var-file", "x"], ["-var-file"], "goflag")).toBe("x");
    expect(flagValueOf(["tf", "-var-file"], ["-var-file"], "goflag")).toBeNull();
  });
  test("notSimulated: Meldung, Hinweis und Liste", () => {
    expect(notSimulated(host, "'a b'.", ["a c", "a d"], "Hinweis.")).toBe("Nicht simuliert: 'a b'. Hinweis.\nDer Simulator kann: a c · a d");
  });
  test("Wert-Flag mit angeklebtem Wert in einer Kette schluckt kein nächstes Token", () => {
    expect(checkFlags(host, PF, ["x", "run", "-adnfoo"], 2)).toBeNull();
    expect(positionalArgs(PF, ["x", "run", "-adnfoo", "a"], 2)).toEqual(["a"]);
    expect(positionalArgs(PF, ["x", "run", "-adn", "foo", "a"], 2)).toEqual(["a"]);
  });
  test("subEntry: eigene Schlüssel ja, Prototyp-Schlüssel nein", () => {
    expect(subEntry({ a: 1 }, "a")).toBe(1);
    expect(subEntry({ a: 1 }, "constructor")).toBeUndefined();
    expect(subEntry({ a: 1 }, "toString")).toBeUndefined();
  });
  test("specOfSub: Eintrag ohne Flags wird zur leeren Tabelle", () => {
    expect(specOfSub("x y", { run: () => "" }).flags).toEqual([]);
  });
});

/* ---------- je Familie ---------- */
const lauf = (cmd: string, sim: KQSim = freshSim()) => { const r = sim.exec(cmd); return { out: r.output ?? "", error: r.error, sim }; };

describe("docker", () => {
  test("ausgewertete Flags bleiben gültig", () => {
    expect(lauf("docker run -d --name web nginx").out).not.toContain(NS);
    expect(lauf("docker run --detach --name web nginx").error).toBe(false);
    expect(lauf("docker ps -a").out).not.toContain(NS);
    expect(lauf("docker build -tname:1 .").out).not.toContain(NS);
  });
  test("docker ps -q und -aq: abgelehnt mit Hinweis", () => {
    const r = lauf("docker ps -q");
    expect(r.error).toBe(true);
    expect(r.out).toContain("Nicht simuliert: das Flag '-q' bei 'docker ps'.");
    expect(r.out).toContain("Nur die IDs");
    expect(lauf("docker ps -aq").out).toContain("das Flag '-q'");
  });
  test("docker run -p/-e/-v: abgelehnt, -e A=b macht A=b nicht mehr zum Image", () => {
    expect(lauf("docker run -d -p 8080:80 nginx").out).toContain("Port-Weiterleitung");
    const r = lauf("docker run -e A=b nginx");
    expect(r.out).toContain("das Flag '-e' bei 'docker run'");
    expect(r.sim.docker.containers).toHaveLength(0);
    expect(lauf("docker run -v a:b nginx").error).toBe(true);
  });
  test("docker run: Flag NACH dem Image bleibt der bisherige Reihenfolge-Fehler", () => {
    const r = lauf("docker run nginx -d -q");
    expect(r.out).toContain("Optionen wie -d/--name müssen VOR das Image");
    expect(r.out).not.toContain(NS);
  });
  test("docker build -f liest die genannte Datei, nicht immer 'Dockerfile'", () => {
    const sim = new KQSim({ files: { "Dockerfile": "FROM nginx", "App.dockerfile": "FROM redis" } });
    expect(lauf("docker build -t a -f App.dockerfile .", sim).out).toContain("FROM redis");
    const fehlt = lauf("docker build -t a --file=nix .", sim);
    expect(fehlt.error).toBe(true);
    expect(fehlt.out).toContain("open nix: no such file");
  });
  test("docker run: --name=web und -a=true gelten wirklich (nicht nur durchgelassen)", () => {
    const r = lauf("docker run --name=web nginx");
    expect(r.error).toBe(false);
    expect(r.sim.docker.containers.map(c => c.name)).toEqual(["web"]);
    r.sim.exec("docker stop web");
    expect(r.sim.exec("docker ps -a=true").output).toContain("web");
    expect(r.sim.exec("docker ps --all").output).toContain("web");
    expect(r.sim.exec("docker ps").output).not.toContain("web");
  });
  test("docker run: ein Wert-Flag, der wie das Image heißt, ist nicht das Image", () => {
    const r = lauf("docker run --name nginx nginx");
    expect(r.sim.docker.containers.map(c => c.name)).toEqual(["nginx"]);
  });
  test("docker build -f ohne Build-Kontext: der Wert von -f ist nicht der Kontext", () => {
    const sim = new KQSim({ files: { "App.dockerfile": "FROM redis" } });
    const r = lauf("docker build -t a -f App.dockerfile", sim);
    expect(r.error).toBe(true);
    expect(r.out).toContain("requires exactly 1 argument");
  });
  test("docker build -f: die Ausgabe nennt die gelesene Datei", () => {
    const sim = new KQSim({ files: { "App.dockerfile": "FROM redis" } });
    expect(lauf("docker build -t a -f App.dockerfile .", sim).out).toContain("load build definition from App.dockerfile");
  });
  test("andere Unterbefehle: jedes Flag abgelehnt", () => {
    for (const c of ["docker images -q", "docker pull -a nginx", "docker stop -t 1 x", "docker rm -f x", "docker tag -x a b"]) {
      expect(lauf(c).out, c).toContain(NS);
    }
  });
});

describe("helm", () => {
  const sim = () => new KQSim({ helmRepos: [{ name: "bitnami", url: "https://charts.bitnami.com/bitnami" }] });
  test("--set und --values/-f bleiben gültig, beides in beiden Schreibweisen", () => {
    expect(lauf("helm install web bitnami/nginx --values a.yaml -f b.yaml", sim()).out).not.toContain(NS);
    const s = sim();
    lauf("helm install web bitnami/nginx", s);
    expect(lauf("helm upgrade web bitnami/nginx --set replicaCount=3", s).out).not.toContain(NS);
    expect(s.deployments.find(d => d.name.startsWith("web"))?.replicas).toBe(3);
    lauf("helm upgrade web bitnami/nginx --set=replicaCount=4", s);
    expect(s.deployments.find(d => d.name.startsWith("web"))?.replicas).toBe(4);
  });
  test("Flags vor den Positionsargumenten verschieben Release und Chart nicht", () => {
    const s = sim();
    expect(lauf("helm install --set replicaCount=2 web bitnami/nginx", s).error).toBe(false);
    expect(s.releases.map(r => r.name)).toEqual(["web"]);
  });
  test("helm list -A und helm template --set: abgelehnt", () => {
    expect(lauf("helm list -A").out).toContain("Nicht simuliert: das Flag '-A' bei 'helm list'.");
    const r = lauf("helm template --set a=b vorlage");
    expect(r.error).toBe(true);
    expect(r.out).toContain("das Flag '--set' bei 'helm template'");
    expect(lauf("helm install web bitnami/nginx --wait", sim()).out).toContain("das Flag '--wait' bei 'helm install'");
  });
  test("Alias teilen den Eintrag: helm ls -A trägt denselben Hinweis wie helm list -A", () => {
    expect(lauf("helm ls -A").out).toContain("Der Simulator kennt nur einen Namespace");
    expect(lauf("helm delete x -q").out).toContain("das Flag '-q' bei 'helm delete'");
  });
  test("--set ohne Wert", () => {
    expect(lauf("helm upgrade web bitnami/nginx --set").out).toContain("flag needs an argument: --set");
  });
});

describe("argocd und glab", () => {
  test("Flags abgelehnt, mit vollem Text", () => {
    expect(lauf("argocd app list -o wide").out).toContain("Nicht simuliert: das Flag '-o' bei 'argocd app list'.");
    expect(lauf("argocd app list -o wide").out).toContain("'argocd app list' ohne Flags");
    expect(lauf("argocd app sync kasse --dry-run").out).toContain("das Flag '--dry-run' bei 'argocd app sync'");
    expect(lauf("glab ci status --branch x").out).toContain("Nicht simuliert: das Flag '--branch' bei 'glab ci status'.");
  });
  test("nicht unterstützte Unterbefehle: ein gemeinsamer Text mit Liste", () => {
    const a = lauf("argocd cluster list");
    expect(a.error).toBe(true);
    expect(a.out).toContain("Nicht simuliert: 'argocd cluster'.");
    expect(a.out).toContain("Der Simulator kann: argocd app list · argocd app get <name> · argocd app sync <name>");
    expect(lauf("argocd app delete x").out).toContain("Nicht simuliert: 'argocd app delete'.");
    expect(lauf("glab mr list").out).toContain("Nicht simuliert: 'glab mr'.");
    expect(lauf("glab ci wackelpudding").out).toContain("Der Simulator kann: glab ci status · glab ci list");
  });
  test("fehlender Unterbefehl/Aktion: eigener Fehler, kein 'nicht simuliert'", () => {
    for (const c of ["argocd", "argocd app", "glab", "glab ci"]) {
      const r = lauf(c);
      expect(r.error, c).toBe(true);
      expect(r.out, c).toContain("fehlt");
      expect(r.out, c).not.toContain(NS);
    }
  });
  test("Namen wie Object-Prototyp-Schlüssel sind für docker und helm unbekannte Unterbefehle, kein Absturz", () => {
    for (const c of ["docker constructor", "docker toString", "helm constructor", "helm toString"]) {
      const r = lauf(c);
      expect(r.error, c).toBe(true);
      expect(r.out, c).toContain("unbekannter Unterbefehl");
      expect(r.out, c).not.toContain("Hoppla");
    }
  });
  test("Namen wie Object-Prototyp-Schlüssel sind keine Aktionen", () => {
    expect(lauf("argocd app constructor").out).toContain("Nicht simuliert: 'argocd app constructor'.");
    expect(lauf("glab ci toString").out).toContain("Nicht simuliert: 'glab ci toString'.");
  });
});

describe("terraform", () => {
  const initSim = (files: Record<string, string> = {}) => {
    const s = new KQSim({ files });
    s.exec("terraform init");
    return s;
  };
  test("ausgewertete Flags bleiben gültig, beide Strichzahlen", () => {
    expect(lauf("terraform apply -auto-approve", initSim()).out).not.toContain(NS);
    expect(lauf("terraform destroy --auto-approve", initSim()).out).not.toContain(NS);
    expect(lauf("terraform plan -var-file=v.tfvars", initSim({ "v.tfvars": "a=1" })).out).not.toContain(NS);
  });
  test("-var-file: vorhandene Datei gilt, fehlende bricht wie echtes Terraform ab", () => {
    expect(lauf("terraform apply -var-file=v.tfvars", initSim({ "v.tfvars": "a=1" })).error).toBe(false);
    const r = lauf("terraform apply -var-file x.tfvars", initSim());
    expect(r.error).toBe(true);
    expect(r.out).toContain("Error: Failed to read variables file");
    expect(r.out).toContain("Given variables file x.tfvars does not exist.");
  });
  test("terraform plan -var-file mit fehlender Datei bricht ebenfalls ab", () => {
    const r = lauf("terraform plan -var-file=fehlt.tfvars", initSim());
    expect(r.error).toBe(true);
    expect(r.out).toContain("Error: Failed to read variables file");
    expect(r.out).toContain("Given variables file fehlt.tfvars does not exist.");
  });
  test("-var-file ohne Init: zuerst der Init-Wächter", () => {
    expect(lauf("terraform apply -var-file=x").out).toContain("Backend initialization required");
  });
  test("unbekannte Flags: -out, -raw/-json mit Hinweis, -force nur bei force-unlock", () => {
    expect(lauf("terraform plan -out=plan").out).toContain("Nicht simuliert: das Flag '-out' bei 'terraform plan'.");
    expect(lauf("terraform output -raw x").out).toContain("kommt im Simulator schon roh");
    expect(lauf("terraform output -json").out).toContain("das Flag '-json'");
    expect(lauf("terraform init -upgrade").out).toContain("das Flag '-upgrade' bei 'terraform init'");
    expect(lauf("terraform apply -force").out).toContain("das Flag '-force' bei 'terraform apply'");
  });
  test("force-unlock: ID über die Positionsargumente, -force angenommen", () => {
    const s = new KQSim({ tfBackend: { type: "remote", locking: true }, tfLocked: true });
    s.exec("terraform init");
    const r = lauf("terraform force-unlock -force LOCK9", s);
    expect(r.out).toContain("Unlocked ID: LOCK9");
  });
  test("terraform state: Aktion fehlt oder nicht unterstützt", () => {
    expect(lauf("terraform state show x").out).toContain("Nicht simuliert: 'terraform state show'.");
    expect(lauf("terraform state show x").out).toContain("Der Simulator kann: terraform state list");
    expect(lauf("terraform state").out).toContain("Unterbefehl fehlt");
    expect(lauf("terraform state list").out).not.toContain(NS);
  });
  test("unbekannter Unterbefehl und Prototyp-Schlüssel", () => {
    expect(lauf("terraform wirr").out).toContain("unbekannter Unterbefehl 'wirr'");
    expect(lauf("terraform constructor").out).toContain("unbekannter Unterbefehl 'constructor'");
  });
});

/* ---------- #1469: Scanner (`parseCall`), Shell-Tokens, Prototyp-Schlüssel, Positionsargumente hinter `--` ---------- */
const call = (spec: ArgSpec, ...t: string[]) => {
  const c = parseCall(host, spec, ["x", "run", ...t], 2);
  if (typeof c === "string") throw new Error(c);
  return c;
};
const FOLLOW: ArgSpec = { cmd: "x logs", flags: [flag(true, "-n", "--namespace"), flag(false, "-f", "--follow"), flag(false, "-p", "--previous")] };

describe("parseCall: Scanner", () => {
  test("`--` beendet die Flags: alles danach ist positional, auch ein -x", () => {
    expect(call(PF, "-a", "--", "-x", "--y", "z").args).toEqual(["-x", "--y", "z"]);
    expect(call(PF, "-a", "--", "-x").has("-a")).toBe(true);
    expect(checkFlags(host, PF, ["x", "run", "--", "-x"], 2)).toBeNull();
    expect(positionalArgs(PF, ["x", "run", "--", "-x"], 2)).toEqual(["-x"]);
  });
  test("has: Ketten, =true/=false, Aliase; der letzte Treffer gewinnt", () => {
    expect(call(FOLLOW, "-fp").has("-f")).toBe(true);
    expect(call(FOLLOW, "-fp").has("-p", "--previous")).toBe(true);
    expect(call(FOLLOW, "--follow=false").has("-f", "--follow")).toBe(false);
    expect(call(FOLLOW, "--follow=true").has("--follow")).toBe(true);
    expect(call(FOLLOW, "-f=0").has("-f")).toBe(false);
    expect(call(FOLLOW, "-f", "--follow=false").has("-f")).toBe(false);
    expect(call(FOLLOW).has("-f")).toBe(false);
  });
  test("ein Wert-Flag in der Kette schluckt den Rest: -nfoo setzt kein -f", () => {
    const c = call(FOLLOW, "-nfoo");
    expect(c.has("-f")).toBe(false);
    expect(c.value("-n")).toBe("foo");
    expect(call(FOLLOW, "-fn", "foo").value("--namespace")).toBe("foo");
    expect(call(FOLLOW, "-fn", "foo").has("-f")).toBe(true);
  });
  test("value: der letzte Wert gewinnt, values liefert alle in Reihenfolge, Aliase zählen gleich", () => {
    const c = call(FOLLOW, "-n", "a", "--namespace=b", "-nc");
    expect(c.value("-n")).toBe("c");
    expect(c.values("--namespace", "-n")).toEqual(["a", "b", "c"]);
    expect(call(FOLLOW).value("-n")).toBeNull();
    expect(call(FOLLOW).values("-n")).toEqual([]);
  });
  test("ungültiger Bool-Wert: pflag-artiger Fehler; unbekanntes Flag und fehlender Wert bleiben Fehler", () => {
    expect(parseCall(host, FOLLOW, ["x", "logs", "--follow=maybe"], 2)).toContain('invalid argument "maybe" for "-f, --follow" flag: strconv.ParseBool: parsing "maybe": invalid syntax');
    expect(parseCall(host, FOLLOW, ["x", "logs", "-o"], 2)).toContain("das Flag '-o'");
    expect(parseCall(host, FOLLOW, ["x", "logs", "-n"], 2)).toContain("flag needs an argument");
    expect(checkFlags(host, FOLLOW, ["x", "logs", "-f=zwei"], 2)).toContain('invalid argument "zwei"');
  });
  test("goflag: `--` und -x=false", () => {
    const tf: ArgSpec = { cmd: "tf x", style: "goflag", flags: [flag(false, "-force"), flag(true, "-var-file")] };
    const c = parseCall(host, tf, ["tf", "x", "-force=false", "-var-file", "a", "--", "-b"], 2) as ReturnType<typeof call>;
    expect(c.has("-force")).toBe(false);
    expect(c.value("-var-file")).toBe("a");
    expect(c.args).toEqual(["-b"]);
  });
  test("stopAtPositional: Flags hinter dem ersten Positionsargument werden nicht gelesen", () => {
    const run: ArgSpec = { ...PF, stopAtPositional: true };
    const c = call(run, "-a", "img", "-d", "--wirr");
    expect(c.args).toEqual(["img", "-d", "--wirr"]);
    expect(c.has("-d")).toBe(false);
  });
  test("specOfSub: Familien-Stil als Default, ein Eintrag überschreibt ihn", () => {
    expect(specOfSub("x y", { run: () => "" }, "goflag").style).toBe("goflag");
    expect(specOfSub("x y", { run: () => "", style: "pflag" }, "goflag").style).toBe("pflag");
    expect(specOfSub("x y", { run: () => "" }).style).toBe("pflag");
  });
});

describe("shellTokens", () => {
  test.each([
    ['git commit -m "zwei Worte"', ["git", "commit", "-m", "zwei Worte"]],
    ["git commit -m 'a  b'", ["git", "commit", "-m", "a  b"]],
    ['a "" b', ["a", "", "b"]],
    ["a   b\t c", ["a", "b", "c"]],
    ['x "sagt \\"hi\\" \\\\"', ["x", 'sagt "hi" \\']],
    ["x --set=a=\"b c\"", ["x", "--set=a=b c"]],
    ["kubeadm join 1.2.3.4:6443 --token t \\ --hash h", ["kubeadm", "join", "1.2.3.4:6443", "--token", "t", "--hash", "h"]],
    ["x a\\ b", ["x", "a", "b"]], // `\` vor Leerraum = Zeilenfortsetzung (gedruckter kubeadm-Join-Befehl), kein maskiertes Leerzeichen
    ['x a\\"b', ["x", 'a"b']],
    ["x a\\", ["x", "a"]],
    ["'in \"doppelt\"'", ['in "doppelt"']],
  ])("%s", (raw, expected) => { expect(shellTokens(raw)).toEqual(expected); });
  test.each(['git commit -m "offen', "x 'offen", 'x "a\\"'])("unbalancierte Quotes: %s → null", (raw) => { expect(shellTokens(raw)).toBeNull(); });
  test("exec meldet unbalancierte Quotes im bash-Stil statt zu raten", () => {
    const r = freshSim().exec('git commit -m "offen');
    expect(r.error).toBe(true);
    expect(r.output).toContain("unexpected EOF while looking for matching quote");
  });
});

describe("Prototyp-Schlüssel: kein Wurf, ein Fehler (Dispatch-Tabellen über subEntry)", () => {
  const keys = ["constructor", "toString", "__proto__", "hasOwnProperty"];
  const prefixes = ["", "git ", "helm ", "docker ", "terraform ", "argocd app ", "glab ci ", "kubeadm ", "aws s3 ", "kubectl create ", "kubectl "];
  test.each(prefixes.flatMap(p => keys.map(k => [p + k] as const)))("%s", (cmd) => {
    const s = freshSim();
    s.exec("git init");
    const r = s.exec(cmd);
    expect(typeof r.output).toBe("string");
    expect(r.error, cmd).toBe(true);
  });
});

describe("Positionsargumente stehen hinter `--` (kein Handler liest feste Token-Indizes)", () => {
  const helmSim = () => {
    const s = new KQSim({ helmRepos: [{ name: "bitnami", url: "u" }] });
    s.exec("helm install r bitnami/nginx");
    s.exec("helm upgrade r bitnami/nginx --set replicaCount=2");
    return s;
  };
  test("helm status/rollback/uninstall", () => {
    const s = helmSim();
    expect(s.exec("helm status -- r").output).toContain("NAME: r");
    expect(s.exec("helm rollback -- r 1").output).toContain("Rollback was a success");
    expect(s.exec("helm uninstall -- r").output).toContain('release "r" uninstalled');
    expect(s.releases).toEqual([]);
  });
  test("helm lint/package/create/repo/search/dependency", () => {
    const s = helmSim();
    expect(s.exec("helm create -- mein").output).toContain("Creating mein");
    expect(s.exec("helm lint -- mein").output).toContain("1 chart(s) linted");
    expect(s.exec("helm package -- mein").output).toContain("Successfully packaged");
    expect(s.exec("helm dependency update -- ./mein").output).toContain("Chart.lock updated");
    expect(s.exec("helm repo add -- extra https://x.test").output).toContain('"extra" has been added');
    expect(s.exec("helm template -- r2 mein").output).toContain("name: r2-mein");
  });
  test("docker stop/rm/pull/tag", () => {
    const s = freshSim();
    s.exec("docker run -d --name c nginx");
    expect(s.exec("docker pull -- nginx").output).toContain("nginx");
    expect(s.exec("docker tag -- nginx mein:1").error).toBe(false);
    expect(s.exec("docker stop -- c").error).toBe(false);
    expect(s.exec("docker rm -- c").output).toBe("c");
  });
  test("docker run -- IMAGE", () => {
    const s = freshSim();
    expect(s.exec("docker run -- nginx").error).toBe(false);
    expect(s.docker.containers[0].image).toBe("nginx:latest");
  });
  test("argocd app get/sync", () => {
    const s = freshSim();
    s.files["kasse-app.yaml"] = "kind: Application …";
    s.applyEffects["kasse-app.yaml"] = { application: { name: "kasse", repo: "https://git.hafen.de/apps.git", path: "kasse/", deployment: { name: "kasse", image: "nginx", replicas: 3 }, service: { name: "kasse", port: "80" } } };
    s.exec("kubectl apply -f kasse-app.yaml");
    expect(s.exec("argocd app get -- kasse").output).toContain("kasse");
    expect(s.exec("argocd app get -- kasse").output).not.toContain("Welche Application");
    expect(s.exec("argocd app sync -- kasse").error).toBe(false);
  });
  test("terraform output/state/force-unlock", () => {
    const s = new KQSim({ tfOutputs: [{ name: "n", value: "v" }] });
    s.exec("terraform init");
    s.exec("terraform apply");
    expect(s.exec("terraform output -- n").output).toBe("v");
    expect(s.exec("terraform state -- list").output).not.toContain(NS);
  });
});

describe("helm --set: Flag-Leser statt Regex auf der Rohzeile", () => {
  const sim = () => {
    const s = new KQSim({ helmRepos: [{ name: "bitnami", url: "u" }] });
    s.exec("helm install web bitnami/nginx");
    return s;
  };
  const replicas = (s: KQSim) => s.deployments.find(d => d.name.startsWith("web"))?.replicas;
  test("3.5 wird abgelehnt: kein Lesen als 3, die Revision zählt nicht hoch", () => {
    const s = sim();
    const r = lauf("helm upgrade web bitnami/nginx --set replicaCount=3.5", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("Error: UPGRADE FAILED:");
    expect(s.releases[0].revision).toBe(1);
    expect(replicas(s)).toBe(1);
  });
  test("0 ist erlaubt (nicht `|| 1`), negativ und Text nicht", () => {
    const s = sim();
    expect(lauf("helm upgrade web bitnami/nginx --set replicaCount=0", s).error).toBe(false);
    expect(replicas(s)).toBe(0);
    expect(lauf("helm upgrade web bitnami/nginx --set replicaCount=-1", s).out).toContain("must be greater than or equal to 0");
    expect(lauf("helm upgrade web bitnami/nginx --set replicaCount=abc", s).error).toBe(true);
    expect(s.releases[0].revision).toBe(2);
  });
  test("install mit 0: Deployment mit 0 Replicas; ungültiger Wert legt nichts an", () => {
    const s = new KQSim({ helmRepos: [{ name: "bitnami", url: "u" }] });
    expect(lauf("helm install z bitnami/redis --set replicaCount=0", s).error).toBe(false);
    expect(s.deployments.find(d => d.name.startsWith("z"))?.replicas).toBe(0);
    const t = new KQSim({ helmRepos: [{ name: "bitnami", url: "u" }] });
    const r = lauf("helm install y bitnami/redis --set replicaCount=3.5", t);
    expect(r.out).toContain("INSTALLATION FAILED");
    expect(t.releases).toEqual([]);
    expect(t.deployments).toEqual([]);
  });
  test("Key ohne =, fremder Key, Komma-Liste, mehrfaches --set (der letzte gewinnt)", () => {
    const s = sim();
    expect(lauf("helm upgrade web bitnami/nginx --set replicaCount", s).out).toContain('failed parsing --set data: key "replicaCount" has no value');
    const fremd = lauf("helm upgrade web bitnami/nginx --set image.tag=x", s);
    expect(fremd.out).toContain(NS);
    expect(fremd.out).toContain("--set replicaCount=<zahl>");
    expect(lauf("helm upgrade web bitnami/nginx --set replicaCount=4,image.tag=x", s).out).toContain(NS);
    expect(s.releases[0].revision).toBe(1);
    lauf("helm upgrade web bitnami/nginx --set replicaCount=2 --set replicaCount=5", s);
    expect(replicas(s)).toBe(5);
    lauf("helm upgrade web bitnami/nginx --set=replicaCount=6,replicaCount=7", s);
    expect(replicas(s)).toBe(7);
  });
  test("ein Wert in Anführungszeichen wird gelesen", () => {
    const s = sim();
    lauf('helm upgrade web bitnami/nginx --set "replicaCount=4"', s);
    expect(replicas(s)).toBe(4);
  });
});

describe("terraform: goflag ist der Familien-Default, destroy nimmt -var-file", () => {
  test.each(["get", "init", "plan", "apply", "destroy", "state", "output", "force-unlock", "fmt", "validate"])("%s --bogus meldet '-bogus'", (sub) => {
    expect(lauf("terraform " + sub + " --bogus").out).toContain("das Flag '-bogus' bei 'terraform " + sub + "'");
  });
  test("destroy -var-file: vorhandene Datei ok, fehlende ein Fehler", () => {
    const s = new KQSim({ files: { "prod.tfvars": "x = 1" }, tfResources: [{ addr: "local_file.n", desc: "x" }] });
    s.exec("terraform init");
    s.exec("terraform apply");
    expect(lauf("terraform destroy -var-file=prod.tfvars", s).out).not.toContain(NS);
    expect(lauf("terraform destroy -var-file=prod.tfvars", s).error).toBe(false);
    const r = lauf("terraform destroy -var-file=fehlt.tfvars", s);
    expect(r.error).toBe(true);
    expect(r.out).toContain("Failed to read variables file");
  });
});

describe("docker: Bool-Werte werden ausgewertet", () => {
  test("ps --all=false zeigt nur laufende Container, ps -a=true auch gestoppte", () => {
    const s = freshSim();
    s.exec("docker run -d --name a nginx");
    s.exec("docker run -d --name b nginx");
    s.exec("docker stop b");
    expect(s.exec("docker ps --all=false").output).not.toContain("Exited");
    expect(s.exec("docker ps --all=true").output).toContain("Exited");
    expect(s.exec("docker ps -a=false").output).not.toContain("Exited");
  });
});

/* ---------- #1469, Review-Runde 1: Grenzfälle des Scanners ---------- */
describe("cliargs: Grenzfälle (Review R1)", () => {
  test("flagValueOf: der letzte Treffer gewinnt, der Wert-Token wird übersprungen", () => {
    expect(flagValueOf(["a", "-n", "x", "-n", "y"], ["-n"])).toBe("y");
    expect(flagValueOf(["a", "-n", "-n", "x"], ["-n"])).toBe("-n");
    expect(flagValueOf(["a", "--namespace=x", "-n", "y"], ["-n", "--namespace"])).toBe("y");
    expect(flagValueOf(["a", "-n", "y", "--namespace=x"], ["-n", "--namespace"])).toBe("x");
  });
  test("kubectl get pods -n a -n b: der letzte Namespace gilt", () => {
    const s = freshSim();
    const sys = s.exec("kubectl get pods -n kube-system").output;
    expect(sys).not.toBe(s.exec("kubectl get pods -n default").output);
    expect(s.exec("kubectl get pods -n default -n kube-system").output).toBe(sys);
    expect(s.exec("kubectl get pods -n kube-system -n default").output).toBe(s.exec("kubectl get pods -n default").output);
  });
  test("mehrere Fehler: der ERSTE wird gemeldet, nicht der letzte", () => {
    const r = parseCall(host, FOLLOW, ["x", "logs", "-o", "-q"], 2) as string;
    expect(r).toContain("das Flag '-o'");
    expect(r).not.toContain("das Flag '-q'");
    expect(lauf("git push --force --rebase", freshSim()).out).not.toContain("--rebase");
  });
  test.each(["1", "t", "T", "TRUE", "true", "True"])("Bool-Wert %s ist wahr", (v) => {
    expect(call(FOLLOW, "--follow=" + v).has("-f")).toBe(true);
  });
  test.each(["0", "f", "F", "FALSE", "false", "False"])("Bool-Wert %s ist falsch", (v) => {
    expect(call(FOLLOW, "-f", "--follow=" + v).has("-f")).toBe(false);
  });
  test.each(["yes", "", "2", "tRuE", "on"])("Bool-Wert '%s' ist ungültig", (v) => {
    expect(parseCall(host, FOLLOW, ["x", "logs", "--follow=" + v], 2)).toContain("strconv.ParseBool");
  });
  test("Call: has() auf einem Wert-Flag ist true, value() auf einem Bool-Flag null", () => {
    expect(call(FOLLOW, "-n", "x").has("-n")).toBe(true);
    expect(call(FOLLOW, "-f").value("-f")).toBeNull();
    expect(call(FOLLOW, "-f").values("-f")).toEqual([]);
  });
  test("shellTokens: in einfachen Quotes gilt kein Escape", () => {
    expect(shellTokens("x 'a\\\"b'")).toEqual(["x", 'a\\"b']);
    expect(shellTokens("x 'a\\\\b'")).toEqual(["x", "a\\\\b"]);
  });
});

describe("Review R1: Einzelfälle der Familien", () => {
  test("docker tag ohne Ziel: Fehler, auch hinter `--`", () => {
    for (const c of ["docker tag nginx", "docker tag -- nginx", "docker tag"]) {
      const r = lauf(c);
      expect(r.error, c).toBe(true);
      expect(r.out, c).toContain("Quelle und Ziel fehlen");
    }
  });
  test("doppeltes git init ist nur ein Hinweis, das Repo bleibt", () => {
    const s = freshSim();
    s.exec("git init");
    expect(s.exec("git init").output).toContain("schon ein Git-Repository");
    expect(s.git.initialized).toBe(true);
  });
  test("das Ticket-Beispiel: Flags vor den Positionsargumenten verschieben Release und Chart nicht", () => {
    const s = new KQSim({ helmRepos: [{ name: "bitnami", url: "u" }] });
    s.exec("helm install web bitnami/nginx");
    const r = lauf("helm upgrade --set replicaCount=3 web bitnami/nginx", s);
    expect(r.error).toBe(false);
    expect(r.out).not.toContain("has no deployed releases");
    expect(s.deployments.find(d => d.name.startsWith("web"))?.replicas).toBe(3);
  });
  test("helm install mit Repo und replicaCount=0 legt ein Deployment mit 0 Replicas an", () => {
    const s = new KQSim({ helmRepos: [{ name: "bitnami", url: "u" }] });
    expect(lauf("helm install z bitnami/redis --set replicaCount=0", s).error).toBe(false);
    expect(s.deployments.find(d => d.name.startsWith("z"))?.replicas).toBe(0);
  });
});

/* ---------- Inventur: keine Musterlösung darf an der Flag-Prüfung scheitern ---------- */
describe("Inventur: jede Lösung aus Karten, Quests und Drills läuft ohne 'Nicht simuliert'", () => {
  const lösungen: { label: string; cmd: string }[] = [];
  for (const c of KQContent.CMD_CARDS) lösungen.push({ label: "Karte " + c.id, cmd: c.solution });
  for (const q of KQContent.QUESTS) {
    for (const st of q.steps) {
      if (st.type === "teach") lösungen.push({ label: q.id + "/" + st.cmd.id, cmd: st.cmd.solution });
      if (st.type === "terminal") for (const t of st.tasks) lösungen.push({ label: q.id + "/" + t.id, cmd: t.solution });
    }
  }
  for (const [id, gen] of Object.entries(KQContent.DRILLS)) {
    for (let i = 0; i < 5; i++) lösungen.push({ label: "Drill " + id + " #" + i, cmd: gen(freshSim()).solution });
  }
  test("die Inventur ist nicht leer und enthält alle neun Familien", () => {
    expect(lösungen.length).toBeGreaterThan(200);
    for (const cli of ["kubectl", "docker", "helm", "terraform", "argocd", "glab", "kubeadm", "git", "aws"]) {
      expect(lösungen.some(l => l.cmd.startsWith(cli + " ")), cli).toBe(true);
    }
  });
  test("keine Lösung wird als 'nicht simuliert' abgelehnt", () => {
    const abgelehnt = lösungen.filter(l => freshSim().exec(l.cmd).output?.includes(NS)).map(l => l.label + ": " + l.cmd);
    expect(abgelehnt).toEqual([]);
  });
});
