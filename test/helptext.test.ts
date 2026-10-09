/* help <familie> und die bewussten Vereinfachungen des Simulators (#1440). Über sim.exec, wie im Spiel. */
import { test, expect, describe } from "vitest";
import { freshSim } from "./sim/helpers";
import { simGrenzen, renderHelpTopic, familienMitGrenzen } from "../src/hud/helptext";

const OFFEN = new Set(["help", "clear", "kubectl", "docker"]);
const help = (cmd: string, av?: Set<string>) => freshSim().exec(cmd, av);

describe("help kubectl", () => {
  test("ungefiltert: alle kubectl-Zeilen und alle Grenztexte", () => {
    const out = help("help kubectl").output!;
    expect(out).toMatch(/^kubectl:/);
    expect(out).toContain("get <resource>");
    expect(out).toContain("label namespace <ns> <label>");
    expect(out).toContain("Was der Simulator vereinfacht:");
    for (const g of simGrenzen("kubectl")) expect(out).toContain("  - " + g.text);
  });

  test("freigeschaltet: wie ungefiltert", () => {
    expect(help("help kubectl", OFFEN).output).toBe(help("help kubectl").output);
  });

  test("Negativfall: ohne Freischaltung neutral wie unbekannt, ohne Grenztexte (#358)", () => {
    const r = help("help kubectl", new Set(["help", "clear"]));
    expect(r.error).toBe(true);
    expect(r.output).not.toMatch(/vereinfacht|get <resource>/);
    expect(r.output).toBe(help("help quatsch", new Set(["help", "clear"])).output!.replace("quatsch", "kubectl"));
  });

  test.each(familienMitGrenzen())("%s: Grenztexte bleiben kurz (Terminalbreite)", f => {
    for (const g of simGrenzen(f)) expect(g.text.length, g.id).toBeLessThanOrEqual(110);
  });

  test.each(familienMitGrenzen())("help %s zeigt alle Grenztexte (#1461)", f => {
    const out = help("help " + f).output!;
    for (const g of simGrenzen(f)) expect(out).toContain("  - " + g.text);
  });

  test("familienMitGrenzen: kubectl, kubeadm, curl und nslookup sind dabei, kubectl zuerst", () => {
    const fam = familienMitGrenzen();
    expect(fam[0]).toBe("kubectl");
    expect(fam).toEqual(expect.arrayContaining(["kubeadm", "curl", "nslookup"]));
    expect(fam).not.toContain("ls");
  });
});

describe("help kubeadm", () => {
  test("lehrt die echte join-Form mit Endpoint und --token, kein positionales Token", () => {
    const out = help("help kubeadm").output!;
    expect(out).toContain("join <endpoint> --token <token>");
    expect(out).not.toMatch(/join <token>/);
  });
});

describe("help <andere>", () => {
  test("Familie ohne Grenzen: keine Vereinfachungs-Rubrik", () => {
    const out = help("help ls").output!;
    expect(out).toMatch(/^ls:/);
    expect(out).not.toContain("vereinfacht");
  });

  test("unbekannte Familie: Fehler mit Hinweis", () => {
    const r = help("help quatsch");
    expect(r.error).toBe(true);
    expect(r.output).toContain("quatsch");
  });

  test("simGrenzen und renderHelpTopic: unbekannte Familie leer bzw. null", () => {
    expect(simGrenzen("ls")).toEqual([]);
    expect(simGrenzen("quatsch")).toEqual([]);
    expect(renderHelpTopic("quatsch")).toBeNull();
  });
});

describe("Fußzeile in help", () => {
  const FUSS = "💡 Was der Simulator vereinfacht: 'help <befehl>', z.B. 'help ";

  test("ungefiltert: ein Platzhalter-Satz mit der ersten Familie mit Grenzen als Beispiel", () => {
    expect(help("help").output).toContain(FUSS + "kubectl'.");
    expect(help("help", OFFEN).output).toContain(FUSS + "kubectl'.");
  });

  test("die Fußzeile wächst nicht mit der Familienzahl: genau eine Zeile", () => {
    const zeilen = help("help").output!.split("\n");
    expect(zeilen.filter(l => l.includes("Was der Simulator vereinfacht"))).toHaveLength(1);
  });

  test("Beispiel ist die erste freigeschaltete Familie mit Grenzen (auch ohne kubectl)", () => {
    expect(help("help", new Set(["help", "clear", "curl"])).output).toContain(FUSS + "curl'.");
    expect(help("help", new Set(["help", "clear", "nslookup", "curl"])).output).toContain(FUSS + "nslookup'.");
  });

  test("ohne freigeschaltete Familie mit Grenzen keine Fußzeile und kein kubectl (#358)", () => {
    const out = help("help", new Set(["help", "clear", "docker", "ls"])).output!;
    expect(out).not.toContain("vereinfacht");
    expect(out).not.toMatch(/\bkubectl\b/);
  });
});
