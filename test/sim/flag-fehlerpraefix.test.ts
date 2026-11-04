/* Familien-Präfix der Flag-Fehler (#2001): kubectl, kubeadm, git `error: `; helm, argocd `Error: `; docker, terraform ohne Präfix.
 * Belege je Familie stehen an der jeweiligen Dispatch-Tabelle (`fehlerPraefix`). */
import { describe, test, expect } from "vitest";
import { freshSim } from "./helpers";
import { ARGOCD } from "../../src/sim/argocd";

const erste = (cmd: string) => freshSim().exec(cmd).output?.split("\n")[0];

describe("Flag-Fehler tragen das Präfix ihrer Familie (#2001)", () => {
  test("kubectl: Bool-Parsefehler mit `error: `, auch in der Gruppe und vor dem Unterbefehl", () => {
    expect(erste("kubectl get pods -A=vielleicht")).toBe('error: invalid argument "vielleicht" for "-A, --all-namespaces" flag: strconv.ParseBool: parsing "vielleicht": invalid syntax');
    expect(erste("kubectl rollout undo deployment web --to-revision=abc")).toMatch(/^error: invalid argument/);
    expect(erste("kubectl -n")).toBe("error: flag needs an argument: 'n' in -n");
  });
  test("docker: erste Zeile ohne `error: ` (FlagErrorFunc liefert den rohen Fehler)", () => {
    const z = erste("docker run -d=x nginx");
    expect(z).toMatch(/^invalid argument "x" for "-d, --detach" flag: strconv.ParseBool/);
  });
  test("git: `error: ` vor Bool-Parsefehler und fehlendem Wert", () => {
    expect(erste("git add -A=x")).toMatch(/^error: invalid argument "x" for "-A, --all" flag: strconv.ParseBool/);
    expect(erste("git commit -m")).toMatch(/^error: flag needs an argument/);
  });
  test("kubeadm: `error: `", () => {
    expect(erste("kubeadm reset -f=x")).toMatch(/^error: invalid argument "x" for "-f, --force" flag: strconv.ParseBool/);
  });
  test("terraform (Go-Paket flag): Go-Text ohne Präfix", () => {
    expect(erste("terraform force-unlock -force=x 1")).toBe('invalid boolean value "x" for -force: parse error');
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
