/* help <familie> und die bewussten Vereinfachungen des Simulators (#1440). Über sim.exec, wie im Spiel. */
import { test, expect, describe } from "vitest";
import { freshSim } from "./sim/helpers";
import { simGrenzen, renderHelpTopic } from "../src/hud/helptext";

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

  test("Grenztexte bleiben kurz (Terminalbreite)", () => {
    for (const g of simGrenzen("kubectl")) expect(g.text.length, g.id).toBeLessThanOrEqual(110);
  });
});

describe("help <andere>", () => {
  test("Familie ohne Grenzen: keine Vereinfachungs-Rubrik", () => {
    const out = help("help docker").output!;
    expect(out).toMatch(/^docker:/);
    expect(out).not.toContain("vereinfacht");
  });

  test("unbekannte Familie: Fehler mit Hinweis", () => {
    const r = help("help quatsch");
    expect(r.error).toBe(true);
    expect(r.output).toContain("quatsch");
  });

  test("simGrenzen und renderHelpTopic: unbekannte Familie leer bzw. null", () => {
    expect(simGrenzen("docker")).toEqual([]);
    expect(simGrenzen("quatsch")).toEqual([]);
    expect(renderHelpTopic("quatsch")).toBeNull();
  });
});

describe("Fußzeile in help", () => {
  test("zeigt auf help kubectl, wenn kubectl sichtbar ist", () => {
    expect(help("help").output).toContain("'help kubectl'");
    expect(help("help", OFFEN).output).toContain("'help kubectl'");
  });

  test("ohne freigeschaltete Familie mit Grenzen keine Fußzeile und kein kubectl (#358)", () => {
    const out = help("help", new Set(["help", "clear", "docker"])).output!;
    expect(out).not.toContain("vereinfacht");
    expect(out).not.toMatch(/\bkubectl\b/);
  });
});
