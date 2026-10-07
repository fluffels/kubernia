/* Äquivalenz-Test (#1139): Für jede Quest-Datei mit reinem Deployment-/Service-Effekt ergeben
 * Parser + Mapper dieselbe Wirkung wie der in den Quest-Daten hinterlegte `applyEffects`-Eintrag
 * (ohne die Sim-Sonderfelder, die kein YAML-Feld sind). Driftet YAML und Effekt auseinander, wird
 * der Datensatz korrigiert, nicht der Mapper aufgeweicht. Drills: siehe unten. */
import { describe, it, expect } from "vitest";
import { KQContent } from "../src/content";
import { effectsFromManifest } from "../src/sim/manifest/registry";
import type { ApplyEffect } from "../src/sim";
import { freshSim } from "./factories/sim";
import { renamedManifest } from "../src/content/drills/shared";

type Dep = NonNullable<ApplyEffect["deployment"]>;

/** Der hinterlegte Effekt ohne Sim-Sonderfelder (kein YAML-Feld): Build-Pflicht, Ephemeral-Nutzung,
 *  Inhalt/Nutzung des emptyDir und die Füllmenge des initContainers. `{}` bleibt als „vorhanden". */
function projected(eff: ApplyEffect): ApplyEffect {
  if (!eff.deployment) return eff;
  const { requireBuiltImage: _r, ephemeralUsedMi: _e, emptyDir, initContainer, ...rest } = eff.deployment;
  const dep: Dep = { ...rest };
  if (emptyDir) dep.emptyDir = {};
  if (initContainer) dep.initContainer = {};
  return { deployment: dep };
}

function cases(): [string, string, ApplyEffect][] {
  const out: [string, string, ApplyEffect][] = [];
  for (const q of KQContent.QUESTS) {
    q.steps.forEach((s, i) => {
      for (const [file, eff] of Object.entries(s.scenario?.applyEffects ?? {})) {
        const keys = Object.keys(eff);
        const text = s.scenario?.files?.[file];
        if (keys.length === 1 && (keys[0] === "deployment" || keys[0] === "service") && text !== undefined) {
          out.push([q.id + " #" + i + " " + file, text, eff]);
        }
      }
    });
  }
  return out;
}

describe("Parser + Mapper == hinterlegter Effekt (Quests)", () => {
  const all = cases();
  it("es gibt Quest-Dateien zu prüfen", () => {
    expect(all.length).toBeGreaterThanOrEqual(7);
  });
  it.each(all)("%s", (_n, text, eff) => {
    const mapped = effectsFromManifest(text, "datei.yaml");
    expect(mapped).toStrictEqual([projected(eff)]);
  });
});

/** Drill auf frischer Sim ausführen, dann alle reinen Deployment-/Service-Dateien einsammeln. */
function drillCases(): [string, string, string, ApplyEffect][] {
  const out: [string, string, string, ApplyEffect][] = [];
  for (const id of Object.keys(KQContent.DRILLS)) {
    for (let i = 0; i < 12; i++) { // Zufallsnamen: mehrere Läufe je Drill
      const sim = freshSim();
      KQContent.DRILLS[id](sim);
      for (const [file, eff] of Object.entries(sim.applyEffects)) {
        const keys = Object.keys(eff);
        const text = sim.files[file];
        if (keys.length === 1 && (keys[0] === "deployment" || keys[0] === "service") && text !== undefined && !out.some(c => c[0] === id && c[2] === text)) out.push([id, file, text, eff]);
      }
    }
  }
  return out;
}

describe("Parser + Mapper == hinterlegter Effekt (Drills)", () => {
  const all = drillCases();
  it("alle fünf Drills mit Deployment-/Service-Datei sind dabei", () => {
    const ids = new Set(all.map(c => c[0]));
    for (const id of ["k-apply", "werft-deploy-imagepull", "werft-expose", "pod-security-harden", "k-nslookup-external"]) expect(ids.has(id), id).toBe(true);
  });
  it.each(all)("%s %s", (_id, file, text, eff) => {
    expect(effectsFromManifest(text, file)).toStrictEqual([projected(eff)]);
  });
});

describe("renamedManifest", () => {
  it("ersetzt alle Vorkommen eines Tokens", () => {
    const yaml = renamedManifest("deployment-werft-dienst", { "werft-dienst": "x-dienst" });
    expect(yaml).not.toMatch(/werft-dienst/);
    expect(yaml.match(/x-dienst/g)!.length).toBeGreaterThan(2);
  });
  it("bricht laut ab, wenn ein Quell-Token fehlt", () => {
    expect(() => renamedManifest("deployment-werft-dienst", { "gibt-es-nicht": "y" })).toThrow(/gibt-es-nicht/);
  });
});

describe("Sonderfeld-Quelle: initContainer-Effekte tragen fillsMi (sonst würde die Füllmenge still 0)", () => {
  it("jeder hinterlegte initContainer in Quests und Drills hat ein numerisches fillsMi", () => {
    const effs: ApplyEffect[] = [];
    for (const q of KQContent.QUESTS) for (const s of q.steps) effs.push(...Object.values(s.scenario?.applyEffects ?? {}));
    for (const id of Object.keys(KQContent.DRILLS)) {
      const sim = freshSim();
      KQContent.DRILLS[id](sim);
      effs.push(...Object.values(sim.applyEffects));
    }
    const withInit = effs.filter(e => e.deployment?.initContainer);
    expect(withInit.length).toBeGreaterThan(0);
    for (const e of withInit) expect(typeof e.deployment!.initContainer!.fillsMi).toBe("number");
  });
});
