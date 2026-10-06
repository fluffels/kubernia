/* Fitness-Test (#1139): Jede YAML-Datei, die Quests im Szenario hinlegen, und jedes Manifest der
 * Bibliothek, das ein Kubernetes-Objekt beschreibt (`kind:`), muss der Sim-Parser fehlerfrei lesen.
 * Fängt Content-Drift (Tab, doppelter Key, nicht unterstützte Syntax) beim Pflegen der Daten. */
import { describe, it, expect } from "vitest";
import { KQContent } from "../src/content";
import { getManifests } from "../src/content/manifest-lib";
import { parseYamlDocuments } from "../src/sim/yaml";

function questYamls(): [string, string][] {
  const out: [string, string][] = [];
  for (const q of KQContent.QUESTS) {
    q.steps.forEach((s, i) => {
      for (const [file, text] of Object.entries(s.scenario?.files ?? {})) {
        if (/\.ya?ml$/.test(file)) out.push([q.id + " #" + i + " " + file, text]);
      }
    });
  }
  return out;
}

describe("Content-YAML parst fehlerfrei", () => {
  const quests = questYamls();
  const libs = getManifests().filter(m => /^kind:/m.test(m.yaml)).map((m): [string, string] => ["Bibliothek " + m.id, m.yaml]);

  it("es gibt Material zum Prüfen", () => {
    expect(quests.length).toBeGreaterThan(5);
    expect(libs.length).toBeGreaterThan(5);
  });

  it.each([...quests, ...libs])("%s", (_n, text) => {
    expect(() => parseYamlDocuments(text)).not.toThrow();
  });
});
