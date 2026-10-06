/* Äquivalenz-Test (#1139): Für jede Quest-Datei mit reinem Deployment-/Service-Effekt ergeben
 * Parser + Mapper dieselbe Wirkung wie der in den Quest-Daten hinterlegte `applyEffects`-Eintrag
 * (ohne die Sim-Sonderfelder, die kein YAML-Feld sind). Driftet YAML und Effekt auseinander, wird
 * der Datensatz korrigiert, nicht der Mapper aufgeweicht. Drills folgen in #1299. */
import { describe, it, expect } from "vitest";
import { KQContent } from "../src/content";
import { effectsFromManifest } from "../src/sim/manifest/registry";
import type { ApplyEffect } from "../src/sim";

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
    expect(all.length).toBeGreaterThanOrEqual(10);
  });
  it.each(all)("%s", (_n, text, eff) => {
    const mapped = effectsFromManifest(text, "datei.yaml");
    expect(mapped).toStrictEqual([projected(eff)]);
  });
});
