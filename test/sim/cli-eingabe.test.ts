/* CLI-Eingabetreue der übrigen Familien (#1459): die gemeinsame Flag-Prüfung `sim/cliargs.ts` und ihre
 * Anwendung auf docker, helm, argocd, glab und terraform.
 *   (a) reine Tests der Parser (beide Stile: pflag/goflag, Ketten kurzer Flags, fehlender Wert, Hinweise),
 *   (b) je Familie: nicht ausgewertete Flags werden abgelehnt, ausgewertete bleiben gültig,
 *   (c) Inventur: JEDE Musterlösung der Befehlskarten, Quests und Drills läuft ohne „Nicht simuliert“. */
import { describe, test, expect } from "vitest";
import { freshSim, KQSim } from "./helpers";
import { KQContent } from "../../src/content";
import {
  flag, checkFlags, positionalArgs, flagValueOf, notSimulated, specOfSub, type ArgSpec,
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
  test("die Inventur ist nicht leer und enthält alle sechs Familien", () => {
    expect(lösungen.length).toBeGreaterThan(200);
    for (const cli of ["kubectl", "docker", "helm", "terraform", "argocd", "glab"]) {
      expect(lösungen.some(l => l.cmd.startsWith(cli + " ")), cli).toBe(true);
    }
  });
  test("keine Lösung wird als 'nicht simuliert' abgelehnt", () => {
    const abgelehnt = lösungen.filter(l => freshSim().exec(l.cmd).output?.includes(NS)).map(l => l.label + ": " + l.cmd);
    expect(abgelehnt).toEqual([]);
  });
});
