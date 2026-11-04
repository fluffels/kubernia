/* Flag-Fehler im Wortlaut ihres Werkzeugs (#2001, #2006): das Präfix der Familie (kubectl, kubeadm, git `error: `; helm, argocd `Error: `),
 * die eigenen Parser von git, aws s3 und curl und die Zusatzzeilen von docker, kubeadm und terraform. Belege je Werkzeug: Kopf von
 * `src/sim/flag-fehlertexte.ts`. Dazu die kubectl-Texte aus #2006 (scale ohne Ressource, create deployment mit Aggregat). */
import { describe, test, expect } from "vitest";
import { freshSim, KQSim } from "./helpers";
import { ARGOCD } from "../../src/sim/argocd";
import { parseCall, dispatchSub, flag, type ArgSpec, type Dispatch, type ErrHost, type SubEntry } from "../../src/sim/cliargs";
import { AWS_ARGPARSE, CURL_GETPARAM, dockerFehler, GIT_PARSE_OPTIONS, type FlagFehlerTexte } from "../../src/sim/flag-fehlertexte";

const NS = "Nicht simuliert";
const out = (cmd: string) => freshSim().exec(cmd).output;
const erste = (cmd: string) => out(cmd)?.split("\n")[0];
/** Die Ausgabe ohne den deutschen Tipp (`💡 …`) und ohne Leerzeilen: so steht der Wortlaut des Werkzeugs da. */
const werkzeug = (cmd: string) => (out(cmd) ?? "").split("\n").filter(z => z !== "" && !z.startsWith("💡")).join("\n");

describe("Flag-Fehler tragen das Präfix ihrer Familie (#2001)", () => {
  test("kubectl: Bool-Parsefehler mit `error: `, auch in der Gruppe und vor dem Unterbefehl", () => {
    expect(erste("kubectl get pods -A=vielleicht")).toBe('error: invalid argument "vielleicht" for "-A, --all-namespaces" flag: strconv.ParseBool: parsing "vielleicht": invalid syntax');
    expect(erste("kubectl rollout undo deployment web --to-revision=abc")).toMatch(/^error: invalid argument/);
    expect(erste("kubectl -n")).toBe("error: flag needs an argument: 'n' in -n");
  });
  test("kubeadm: `error: ` vor dem pflag-Text", () => {
    expect(erste("kubeadm reset -f=x")).toMatch(/^error: invalid argument "x" for "-f, --force" flag: strconv.ParseBool/);
  });
  test("helm und argocd: cobra-Standard `Error: `", () => {
    expect(erste("helm install web -f")).toMatch(/^Error: flag needs an argument/);
    // argocd hat heute kein Wert- und kein Bool-Flag: der Fehlerweg ist nicht erreichbar, die Tabelle trägt den belegten Wert.
    expect(ARGOCD.fehlerPraefix).toBe("Error: ");
  });
  test("gültige Bool-Schreibweisen bleiben gültig (keine neue Ablehnung)", () => {
    for (const cmd of ["kubectl get pods -A", "kubectl get pods -A=true", "kubectl get pods --all-namespaces=false"]) {
      expect(freshSim().exec(cmd).error, cmd).toBe(false);
    }
  });
});

describe("git: parse-options statt pflag (#2006)", () => {
  test("Kurz- und Lang-Flag ohne Wert nennen `switch` bzw. `option`", () => {
    expect(werkzeug("git commit -m")).toBe("error: switch `m' requires a value");
    expect(werkzeug("git commit --message")).toBe("error: option `message' requires a value");
  });
  test("Bool-Flag mit ungültigem Wert: lang `takes no value`, kurz liest git das `=` als Schalter", () => {
    expect(werkzeug("git add --all=x")).toBe("error: option `all' takes no value");
    expect(werkzeug("git add -A=x")).toBe("error: unknown switch `='");
  });
  test("ohne Beleg gilt der Stil-Text: ein unbekannter Fehler-Typ (`pflicht`) bleibt `null`", () => {
    expect(GIT_PARSE_OPTIONS.wortlaut?.({ kind: "pflicht", namen: ["x"] }, "git add")).toBeNull();
    expect(GIT_PARSE_OPTIONS.wortlaut?.({ kind: "unknown", name: "--nope" }, "git add")).toBe("error: unknown option `nope'");
    expect(GIT_PARSE_OPTIONS.wortlaut?.({ kind: "unknown", name: "-x", shorthands: "x" }, "git add")).toBe("error: unknown switch `x'");
  });
});

describe("aws s3: argparse mit Usage-Block (#2006)", () => {
  const USAGE = "usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]\nTo see help text, you can run:\n  aws help\n  aws <command> help\n  aws <command> <subcommand> help";
  test("Bool-Flag mit Wert: Usage, dann `aws: error: argument --x: ignored explicit argument`", () => {
    expect(werkzeug("aws s3 ls --recursive=x")).toBe(USAGE + "\naws: error: argument --recursive: ignored explicit argument 'x'");
  });
  test("der Dialekt der Ebene `aws` erbt in die Gruppe `aws s3` (jeder Befehl darunter)", () => {
    expect(werkzeug("aws s3 rb --force=x s3://b")).toBe(USAGE + "\naws: error: argument --force: ignored explicit argument 'x'");
  });
});

describe("aws: Grenze für unbekannte Optionen (#2006)", () => {
  test("`Unknown options` ist ein eigener Pfad von aws (Text nicht belegt): der Rahmen lässt ihn unberührt, der Wortlaut ist `null`", () => {
    expect(AWS_ARGPARSE.rahmen?.("t", "aws s3 ls", "unknown")).toBe("t");
    expect(AWS_ARGPARSE.wortlaut?.({ kind: "unknown", name: "--x" }, "aws s3 ls")).toBeNull();
    expect(AWS_ARGPARSE.rahmen?.("t", "aws s3 ls", "missing")).toContain("aws: error: t");
  });
});

describe("curl: tool_getparam statt pflag (#2006)", () => {
  const TRY = "curl: try 'curl --help' or 'curl --manual' for more information";
  test("Wert-Flag ohne Wert: `requires parameter` plus Hilfe-Verweis", () => {
    expect(out("curl -o")).toBe("curl: option -o: requires parameter\n" + TRY);
    expect(out("curl -H")).toBe("curl: option -H: requires parameter\n" + TRY);
  });
  test("ein Bool-Flag mit beliebigem Wert ist kein Fehler: curl nimmt `--silent=x` an und ignoriert den Wert (`boolWertEgal`)", () => {
    expect(out("curl --silent=x web")).not.toMatch(/invalid argument|ParseBool/);
    expect(out("curl --silent=x web")).not.toContain(TRY);
  });
});

describe("docker: Usage-Block der FlagErrorFunc (#2006)", () => {
  test("docker run: Fehler, Usage mit dem `Use` von run, Verweis auf `docker run --help`", () => {
    expect(out("docker run -d=x nginx")).toBe('invalid argument "x" for "-d, --detach" flag: strconv.ParseBool: parsing "x": invalid syntax\n\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nRun \'docker run --help\' for more information');
  });
  test("jeder Befehl nennt sein eigenes `Use` (nicht das der Wurzel)", () => {
    expect(werkzeug("docker ps -a=x")).toContain("Usage:  docker ps [OPTIONS]\nRun 'docker ps --help' for more information");
    expect(werkzeug("docker run --name")).toContain("Usage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]");
  });
  test("ein Pflicht-Flag geht nicht durch die FlagErrorFunc: kein Usage-Block", () => {
    expect(dockerFehler("[OPTIONS]").rahmen?.("required flag(s) \"x\" not set", "docker x", "pflicht")).toBe("required flag(s) \"x\" not set");
    expect(dockerFehler("[OPTIONS]").rahmen?.("t", "docker x", "bool")).toContain("Usage:  docker x [OPTIONS]");
  });
  test("docker build ist der buildx-Alias: Stil-Text ohne Usage-Block (Grenze)", () => {
    expect(out("docker build -t")).not.toContain("Usage:");
  });
});

describe("kubeadm: Stacktrace-Zeile hinter dem Fehler (#2006)", () => {
  test("Flag-Fehler: Zeile 2 ist der Hinweis, Zeile 1 bleibt der pflag-Text mit Präfix", () => {
    expect(out("kubeadm init --pod-network-cidr")).toBe("error: flag needs an argument: --pod-network-cidr\nTo see the stack trace of this error execute with --v=5 or higher");
    expect(out("kubeadm reset -f=x")?.split("\n")[1]).toBe("To see the stack trace of this error execute with --v=5 or higher");
  });
});

describe("terraform: Diagnose „Failed to parse command-line flags“ (#2006)", () => {
  test("apply und plan: Diagnose, Go-Text, Hilfe-Verweis des Befehls", () => {
    expect(werkzeug("terraform apply -auto-approve=x")).toBe('Error: Failed to parse command-line flags\ninvalid boolean value "x" for -auto-approve: parse error\nFor more help on using this command, run:\n  terraform apply -help');
    expect(werkzeug("terraform plan -var-file")).toBe("Error: Failed to parse command-line flags\nflag needs an argument: -var-file\nFor more help on using this command, run:\n  terraform plan -help");
    expect(werkzeug("terraform destroy -auto-approve=x")).toContain("terraform destroy -help");
  });
  test("force-unlock: die Diagnose ohne Hilfe-Verweis", () => {
    expect(werkzeug("terraform force-unlock -force=x 1")).toBe('Error: Failed to parse command-line flags\ninvalid boolean value "x" for -force: parse error');
  });
  test("Grenze: andere Befehle haben heute keinen erreichbaren Flag-Fehler (keine Flags, kein realFlags), der Rahmen gilt nur für plan, apply, destroy, force-unlock", () => {
    expect(erste("terraform output -json=x")).toContain(NS);
  });
});

describe("glab, nslookup: kein belegter Text, kein erfundener (#2006)", () => {
  test("glab hat heute keinen erreichbaren Flag-Fehler; ein synthetischer Spec ohne `fehlerTexte` meldet weiter den Stil-Text", () => {
    const host: ErrHost = { _err: m => m };
    const spec: ArgSpec = { cmd: "glab ci x", flags: [flag(true, "--ref")], maxArgs: 0 };
    expect(parseCall(host, spec, ["--ref"], 0)).toBe("flag needs an argument: --ref");
  });
  test("ein synthetischer Spec mit `fehlerTexte` nutzt `wortlaut` und `rahmen` (nicht erreichbare Arten, Tabellenwert)", () => {
    const host: ErrHost = { _err: m => m };
    const fehlerTexte: FlagFehlerTexte = { wortlaut: f => f.kind === "missing" ? "W:" + f.name : null, rahmen: (t, cmd, k) => "[" + cmd + "|" + k + "] " + t };
    const spec: ArgSpec = { cmd: "tool x", flags: [flag(true, "--ref")], fehlerTexte, maxArgs: 0 };
    expect(parseCall(host, spec, ["--ref"], 0)).toBe("[tool x|missing] W:--ref");
  });
  test("ein fehlendes Pflicht-Flag läuft durch `fehlerTexte` (`wortlaut` und `rahmen` mit Art `pflicht`)", () => {
    const host: ErrHost = { _err: m => m };
    const fehlerTexte: FlagFehlerTexte = { wortlaut: f => f.kind === "pflicht" ? "P:" + f.namen.join(",") : null, rahmen: (t, cmd, k) => "[" + cmd + "|" + k + "] " + t };
    const spec: ArgSpec = { cmd: "tool x", flags: [flag(true, "--aa")], requiredFlags: ["--aa"], fehlerTexte, maxArgs: 0 };
    expect(parseCall(host, spec, [], 0)).toBe("[tool x|pflicht] P:aa");
  });
});

describe("Wortlaut-Tabellen: jede Art, auch die ohne Weg durch die heutige Flag-Tabelle (#2006)", () => {
  const int = { kind: "int", name: "--n", label: "-n, --n", value: "x", tip: "t" } as const;
  const bool = { kind: "bool", name: "--all", label: "-A, --all", value: "x" } as const;
  const pflicht = { kind: "pflicht", namen: ["b", "a"] } as const;
  test("git: Ganzzahl nennt `expects a numerical value`, kurz mit `switch`, lang mit `option`", () => {
    expect(GIT_PARSE_OPTIONS.wortlaut?.(int, "git x")).toBe("error: option `n' expects a numerical value");
    expect(GIT_PARSE_OPTIONS.wortlaut?.({ ...int, name: "-n" }, "git x")).toBe("error: switch `n' expects a numerical value");
    expect(GIT_PARSE_OPTIONS.wortlaut?.(bool, "git x")).toBe("error: option `all' takes no value");
  });
  test("aws: fehlender Wert, Ganzzahl und Pflicht-Argumente im argparse-Wortlaut", () => {
    expect(AWS_ARGPARSE.wortlaut?.({ kind: "missing", name: "--x" }, "aws s3 ls")).toBe("argument --x: expected one argument");
    expect(AWS_ARGPARSE.wortlaut?.(int, "aws s3 ls")).toBe("argument -n/--n: invalid int value: 'x'");
    expect(AWS_ARGPARSE.wortlaut?.(pflicht, "aws s3 ls")).toBe("the following arguments are required: --b, --a");
  });
  test("curl: unbekannt und Ganzzahl nennen das Token, ein Bool-Wert und Pflicht-Flags haben keinen curl-Text", () => {
    expect(CURL_GETPARAM.wortlaut?.({ kind: "unknown", name: "--x" }, "curl")).toBe("curl: option --x: is unknown");
    expect(CURL_GETPARAM.wortlaut?.(int, "curl")).toBe("curl: option --n: expected a proper numerical parameter");
    expect(CURL_GETPARAM.wortlaut?.(bool, "curl")).toBeNull();
    expect(CURL_GETPARAM.wortlaut?.(pflicht, "curl")).toBeNull();
  });
  test("curl: der Rahmen hängt den `--manual`-Verweis nur an Arten mit curl-Text, nicht an Bool und Pflicht", () => {
    expect(CURL_GETPARAM.rahmen?.("t", "curl", "pflicht")).toBe("t");
    expect(CURL_GETPARAM.rahmen?.("t", "curl", "bool")).toBe("t");
    expect(CURL_GETPARAM.rahmen?.("t", "curl", "missing")).toContain("curl: try");
  });
  test("aws: ein Bool-Flag nennt Kurz- und Langform mit Schrägstrich", () => {
    expect(AWS_ARGPARSE.wortlaut?.(bool, "aws s3 ls")).toBe("argument -A/--all: ignored explicit argument 'x'");
  });
});

describe("Vererbung von `fehlerTexte` über die Dispatch-Ebenen (#2006)", () => {
  const host: ErrHost = { _err: m => m };
  const run = () => "";
  const ebene: FlagFehlerTexte = { rahmen: t => "EBENE " + t };
  const eintrag: FlagFehlerTexte = { rahmen: t => "EINTRAG " + t };
  const gruppeTexte: FlagFehlerTexte = { rahmen: t => "GRUPPE " + t };
  const d = (eigen?: FlagFehlerTexte, gruppe?: FlagFehlerTexte): Dispatch<SubEntry<() => string>> => ({
    cmd: "t", fehlerTexte: ebene, flags: [flag(true, "--p")], realFlags: ["--real"], table: { x: { run, maxArgs: 0, flags: [flag(true, "--a")], fehlerTexte: eigen }, g: { group: { cmd: "t g", fehlerTexte: gruppe, table: { y: { run, maxArgs: 0, flags: [flag(true, "--a")] } } } } },
  });
  test("der Eintrag gewinnt gegen die Ebene, ohne eigenen Wert gilt der der Ebene", () => {
    expect(dispatchSub(host, d(eintrag), ["t", "x", "--a"], 1)).toBe("EINTRAG flag needs an argument: --a");
    expect(dispatchSub(host, d(), ["t", "x", "--a"], 1)).toBe("EBENE flag needs an argument: --a");
  });
  test("eine Gruppe erbt den Wert der Ebene darüber, ein eigener Wert der Gruppe gewinnt", () => {
    expect(dispatchSub(host, d(), ["t", "g", "y", "--a"], 1)).toBe("EBENE flag needs an argument: --a");
    expect(dispatchSub(host, d(undefined, gruppeTexte), ["t", "g", "y", "--a"], 1)).toBe("GRUPPE flag needs an argument: --a");
  });
  test("vor dem Unterbefehl gilt der Wert der Ebene (ohne Wert und unbekanntes Flag der geschlossenen Welt)", () => {
    expect(dispatchSub(host, d(), ["t", "--p"], 1)).toBe("EBENE flag needs an argument: --p");
    expect(dispatchSub(host, d(), ["t", "--zzz", "x"], 1)).toBe("EBENE unknown flag: --zzz");
  });
});

describe("gültige Eingaben bleiben gültig (keine neue Ablehnung, #2006)", () => {
  test.each([
    "git add -A", "git add --all=true", "aws s3 ls --recursive", "aws s3 ls --recursive=true", "docker run -d nginx", "docker ps -a", "kubeadm reset -f", "kubectl create deployment web --image=x --replicas=0",
  ])("%s", cmd => {
    const s = freshSim();
    s.exec("git init");
    expect(s.exec(cmd).output ?? "", cmd).not.toMatch(/requires a value|takes no value|requires parameter|ignored explicit|Failed to parse|Usage:|stack trace|resource\(s\) were provided/);
  });
});

describe("gültige Eingaben, die ein erreichbares Ziel brauchen (keine neue Ablehnung, #2006)", () => {
  const szenario = () => new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1 }], services: [{ name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.20", port: 80 }] });
  test.each(["curl -s kasse", "curl --silent=true kasse", "curl -o datei kasse"])("%s kommt an", cmd => {
    const r = szenario().exec(cmd);
    expect(r.error, cmd).toBeFalsy();
  });
  test.each(["curl --silent=yes kasse", "curl --head=no kasse", "curl --include=x kasse", "curl -s --silent=0 kasse"])("%s: curl nimmt an einem Bool-Flag jeden Wert an (tool_getparam.c) und ignoriert ihn", cmd => {
    const r = szenario().exec(cmd);
    expect(r.error, cmd).toBeFalsy();
    expect(r.output ?? "", cmd).not.toMatch(/invalid argument|ParseBool/);
  });
  test("der Wert eines Bool-Flags wird ignoriert, auch bei der Auswertung: `--silent=0` und `--silent=yes` bleiben still wie `-s`", () => {
    const still = szenario().exec("curl -s -o f kasse").output;
    for (const cmd of ["curl --silent=0 -o f kasse", "curl --silent=yes -o f kasse", "curl -s --silent=0 -o f kasse"]) expect(szenario().exec(cmd).output, cmd).toBe(still);
  });
  test("die Kurzform `-s=x` bleibt von `boolWertEgal` unberührt (Grenze: nur lange Flags)", () => {
    expect(szenario().exec("curl -s=x kasse").output).toMatch(/invalid argument/);
  });
  test("ohne `boolWertEgal` bleibt ein ungültiger Bool-Wert ein Fehler (git add --all=x wird weiter abgelehnt)", () => {
    const s = szenario();
    s.exec("git init");
    expect(s.exec("git add --all=x").output).toContain("takes no value");
    const host: ErrHost = { _err: m => m };
    const spec: ArgSpec = { cmd: "t", flags: [flag(false, "--b")], fehlerTexte: { boolWertEgal: true }, maxArgs: 0 };
    expect(typeof parseCall(host, spec, ["--b=x"], 0)).not.toBe("string");
    expect(parseCall(host, { ...spec, fehlerTexte: undefined }, ["--b=x"], 0)).toMatch(/invalid argument/);
  });
  test("kubectl scale mit Ressource und Replicas skaliert", () => {
    const s = szenario();
    expect(s.exec("kubectl scale deployment kasse --replicas=2").output).toBe("deployment.apps/kasse scaled");
  });
  test("terraform apply -auto-approve wird angenommen (kein Flag-Fehler)", () => {
    const s = szenario();
    s.exec("terraform init");
    expect(s.exec("terraform apply -auto-approve").output ?? "").not.toMatch(/Failed to parse|invalid boolean/);
  });
});

describe("kubectl scale: Builder-Fehler statt „So nicht ganz“ (#2006, scale.go)", () => {
  const MUSTER = "Muster: 'kubectl scale deployment <name> --replicas=3'";
  test("ohne Ressource: der Builder-Text `NoResourceError`, Muster bleibt der Tipp", () => {
    const r = freshSim().exec("kubectl scale --replicas=2");
    expect(r.error).toBe(true);
    expect(r.output).toContain("error: You must provide one or more resources by argument or filename.\nExample resource specifications include:\n   '-f rsrc.yaml'");
    expect(r.output).toContain(MUSTER);
  });
  test("Typ ohne Namen: `resource(s) were provided, but no name was specified`", () => {
    const r = freshSim().exec("kubectl scale deployment --replicas=2");
    expect(r.output?.split("\n")[0]).toBe("error: resource(s) were provided, but no name was specified");
    expect(r.output).toContain(MUSTER);
  });
  test("Reihenfolge: `Validate` (Replicas) kommt vor dem Builder, auch ohne Ressource", () => {
    expect(erste("kubectl scale --replicas=-1")).toBe("error: The --replicas=COUNT flag is required, and COUNT must be greater than or equal to 0");
  });
  test("ein Ziel mit Namen skaliert weiter (nichts verändert sich für gültige Eingaben)", () => {
    const s = freshSim();
    s.exec("kubectl create deployment web --image=nginx");
    expect(s.exec("kubectl scale deployment web --replicas=3").output).toBe("deployment.apps/web scaled");
  });
});

describe("kubectl create deployment: der apiserver nennt alle Ursachen zusammen (#2006)", () => {
  const NAME = 'metadata.name: Invalid value: "Web": a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, \'-\' or \'.\', and must start and end with an alphanumeric character';
  const REPLICAS = "spec.replicas: Invalid value: -1: must be greater than or equal to 0";
  const kopf = 'error: failed to create deployment: Deployment.apps "Web" is invalid: ';
  test("ungültiger Name und negative Replicas: `[metadata.name…, spec.replicas…]` in dieser Reihenfolge", () => {
    const s = freshSim();
    const r = s.exec("kubectl create deployment Web --image=x --replicas=-1");
    expect(r.error).toBe(true);
    expect(r.output?.split("\n")[0]).toBe(kopf + "[" + NAME + ", " + REPLICAS + "]");
    expect(r.output).toContain("DNS-1123");
    expect(s.exec("kubectl get deployments").output).not.toContain("Web");
  });
  test("nur ein ungültiger Name: eine Ursache ohne Klammer, mit DNS-Tipp", () => {
    const r = freshSim().exec("kubectl create deployment Web --image=x");
    expect(r.output?.split("\n")[0]).toBe(kopf + NAME);
    expect(r.output).toContain("DNS-1123");
  });
  test("ungültiger Name und leeres Image: zwei Ursachen", () => {
    const r = freshSim().exec("kubectl create deployment Web --image=");
    expect(r.output?.split("\n")[0]).toBe(kopf + "[" + NAME + ", spec.template.spec.containers: Required value]");
  });
  test("gültiger Name und negative Replicas: nur die Replicas, nichts angelegt", () => {
    const s = freshSim();
    const r = s.exec("kubectl create deployment web --image=x --replicas=-1");
    expect(r.output?.split("\n")[0]).toBe('error: failed to create deployment: Deployment.apps "web" is invalid: ' + REPLICAS);
    expect(s.exec("kubectl get deployments").output).not.toContain("web");
  });
});
