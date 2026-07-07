/* YAML-Bausteine-Minispiel (#568): Domänen-Tests für Zeilen-Zerlegung + Struktur-Prüfung. */
import { test, expect, describe } from "vitest";
import {
  YAML_STRUCT_ROUNDS,
  yamlStructLines,
  checkYamlOrder,
  checkYamlDepth,
  TAB_INDENT,
  type YamlLine,
} from "../src/content/yamlstruct";

describe("yamlStructLines", () => {
  test("zerlegt den flachen Pod korrekt in Zeilen + Tiefe", () => {
    expect(yamlStructLines("pod-leuchtfeuer")).toEqual([
      { text: "apiVersion: v1", depth: 0 },
      { text: "kind: Pod", depth: 0 },
      { text: "metadata:", depth: 0 },
      { text: "name: leuchtfeuer", depth: 1 },
      { text: "spec:", depth: 0 },
      { text: "containers:", depth: 1 },
      { text: "- name: leuchtfeuer", depth: 2 },
      { text: "image: nginx:1.27", depth: 3 },
    ]);
  });

  test("erkennt die tiefe Verschachtelung des Deployments (containers unter spec.template.spec)", () => {
    const lines = yamlStructLines("deployment-lager");
    // "spec:" kommt im Deployment ZWEIMAL vor (äußeres spec + Pod-Template-spec) – ein
    // textbasiertes Lookup wäre also mehrdeutig; "template:"/"containers:" sind eindeutig.
    const byText = new Map(lines.map((l) => [l.text, l.depth]));
    expect(byText.get("template:")).toBe(1);
    expect(byText.get("containers:")).toBe(3);
    expect(byText.get("template:") === byText.get("containers:")).toBe(false); // Red-Green: Tiefe unterscheidet wirklich
  });

  test("Deployment hat ZWEI verschiedene 'spec:'-Zeilen auf unterschiedlichen Ebenen (äußeres vs. Pod-Template-spec)", () => {
    const lines = yamlStructLines("deployment-lager");
    const specDepths = lines.filter((l) => l.text === "spec:").map((l) => l.depth);
    expect(specDepths).toEqual([0, 2]);
  });

  test("Leerzeilen fallen weg (keine eigene Bau-Aufgabe für nichts)", () => {
    for (const round of YAML_STRUCT_ROUNDS) {
      const lines = yamlStructLines(round.manifestId);
      expect(lines.every((l) => l.text.length > 0)).toBe(true);
    }
  });
});

describe("checkYamlOrder", () => {
  const target: YamlLine[] = [
    { text: "apiVersion: v1", depth: 0 },
    { text: "kind: Pod", depth: 0 },
  ];

  test("Happy Path: die fällige Zeile wird akzeptiert", () => {
    expect(checkYamlOrder(target, 0, "apiVersion: v1")).toEqual({ ok: true });
  });

  test("falsche Reihenfolge: eine spätere Zeile wird VOR ihrer Zeit abgelehnt", () => {
    const result = checkYamlOrder(target, 0, "kind: Pod");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/apiVersion: v1/);
  });

  test("schon vollständig: keine weitere Zeile fällig", () => {
    const result = checkYamlOrder(target, target.length, "apiVersion: v1");
    expect(result.ok).toBe(false);
  });

  test("Red-Green-Kontrolle: eine Zeile, die im Manifest gar nicht vorkommt, wird ebenfalls abgelehnt", () => {
    expect(checkYamlOrder(target, 0, "erfunden: ja").ok).toBe(false);
  });
});

describe("checkYamlDepth", () => {
  test("Happy Path: die erwartete Ebene wird akzeptiert", () => {
    expect(checkYamlDepth(2, 2)).toEqual({ ok: true });
  });

  test("zu wenig eingerückt (Ebene zu niedrig)", () => {
    const result = checkYamlDepth(2, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/innen/);
  });

  test("zu tief eingerückt (Ebene zu hoch)", () => {
    const result = checkYamlDepth(0, 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/außen/);
  });

  test("Tab statt Leerzeichen ist IMMER falsch, unabhängig von der erwarteten Ebene (#568-Kernfall)", () => {
    for (const expectedDepth of [0, 1, 2, 6]) {
      const result = checkYamlDepth(expectedDepth, TAB_INDENT);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Tab/);
    }
  });

  test("Red-Green-Kontrolle: TAB_INDENT ist kein gültiger Tiefenwert, der zufällig mit einer Ebene übereinstimmt", () => {
    expect(TAB_INDENT).toBeLessThan(0);
  });
});

describe("YAML_STRUCT_ROUNDS (Content)", () => {
  test("mindestens 2 Runden, jede mit auflösbarer Manifest-ID und Lektion", () => {
    expect(YAML_STRUCT_ROUNDS.length).toBeGreaterThanOrEqual(2);
    for (const round of YAML_STRUCT_ROUNDS) {
      expect(() => yamlStructLines(round.manifestId)).not.toThrow();
      expect(yamlStructLines(round.manifestId).length).toBeGreaterThan(0);
      expect(round.tip.trim().length).toBeGreaterThan(0);
    }
  });

  test("Schwierigkeit steigt: weder Zeilenzahl noch maximale Verschachtelungstiefe sind je absteigend", () => {
    const stats = YAML_STRUCT_ROUNDS.map((r) => {
      const lines = yamlStructLines(r.manifestId);
      return { count: lines.length, maxDepth: Math.max(...lines.map((l) => l.depth)) };
    });
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i].count).toBeGreaterThanOrEqual(stats[i - 1].count);
      expect(stats[i].maxDepth).toBeGreaterThanOrEqual(stats[i - 1].maxDepth);
    }
  });

  test("erste Runde ist flach (Pod), letzte Runde zeigt echte Verschachtelung (Deployment)", () => {
    const erste = yamlStructLines(YAML_STRUCT_ROUNDS[0].manifestId);
    const letzte = yamlStructLines(YAML_STRUCT_ROUNDS[YAML_STRUCT_ROUNDS.length - 1].manifestId);
    expect(Math.max(...erste.map((l) => l.depth))).toBeLessThan(Math.max(...letzte.map((l) => l.depth)));
  });

  test("jede Runde ist tatsächlich spielbar: Order- + Depth-Check zusammen führen Schritt für Schritt zum Ziel", () => {
    for (const round of YAML_STRUCT_ROUNDS) {
      const target = yamlStructLines(round.manifestId);
      for (let placed = 0; placed < target.length; placed++) {
        const line = target[placed];
        expect(checkYamlOrder(target, placed, line.text).ok, `Runde „${round.name}", Zeile ${placed}: Reihenfolge`).toBe(true);
        expect(checkYamlDepth(line.depth, line.depth).ok, `Runde „${round.name}", Zeile ${placed}: Tiefe`).toBe(true);
      }
    }
  });
});
