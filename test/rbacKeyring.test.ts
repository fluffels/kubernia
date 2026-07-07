/* RBAC-Schlüsselbund-Minispiel (#571): Domänen-Tests für den Grant-/Breite-Kern. */
import { test, expect, describe } from "vitest";
import {
  RBAC_KEYRING_ROUNDS,
  ruleGrants,
  optionGrants,
  optionBreadth,
  checkKeyringChoice,
  type RbacKeyringOption,
  type RbacKeyringRule,
} from "../src/content/rbacKeyring";

const rule = (verbs: string[], resources: string[]): RbacKeyringRule => ({ verbs, resources });
const option = (name: string, cluster: boolean, rules: RbacKeyringRule[]): RbacKeyringOption => ({ name, cluster, rules });

describe("ruleGrants", () => {
  test("passt, wenn Verb UND Ressource exakt in der Rule stehen", () => {
    expect(ruleGrants(rule(["get", "list"], ["pods"]), "get", "pods")).toBe(true);
  });

  test("passt NICHT bei falschem Verb", () => {
    expect(ruleGrants(rule(["get", "list"], ["pods"]), "delete", "pods")).toBe(false);
  });

  test("passt NICHT bei falscher Ressource", () => {
    expect(ruleGrants(rule(["get"], ["pods"]), "get", "secrets")).toBe(false);
  });

  test("Wildcard-Verb '*' erlaubt jedes Verb", () => {
    expect(ruleGrants(rule(["*"], ["pods"]), "delete", "pods")).toBe(true);
  });

  test("Wildcard-Ressource '*' erlaubt jede Ressource", () => {
    expect(ruleGrants(rule(["get"], ["*"]), "get", "secrets")).toBe(true);
  });
});

describe("optionGrants", () => {
  test("eine Role gewährt eine passende namespaced Aufgabe", () => {
    const role = option("pod-leser", false, [rule(["get"], ["pods"])]);
    expect(optionGrants(role, { subject: "s", verb: "get", resource: "pods" })).toBe(true);
  });

  test("Red-Green: eine Role mit PASSENDEN Verben/Ressourcen gewährt eine clusterOnly-Aufgabe TROTZDEM NICHT — der Scope-Check muss wirklich greifen", () => {
    const role = option("pod-leser", false, [rule(["get", "list", "watch"], ["nodes"])]);
    expect(optionGrants(role, { subject: "s", verb: "get", resource: "nodes", clusterOnly: true })).toBe(false);
    // Gegenprobe: ohne den clusterOnly-Scope-Check (nur Verb+Ressource) würde es fälschlich passen.
    const naiveGrant = role.rules.some((r) => ruleGrants(r, "get", "nodes"));
    expect(naiveGrant).toBe(true);
  });

  test("eine ClusterRole gewährt eine clusterOnly-Aufgabe mit passenden Verben/Ressourcen", () => {
    const clusterRole = option("knoten-spaeher", true, [rule(["get", "list"], ["nodes"])]);
    expect(optionGrants(clusterRole, { subject: "s", verb: "list", resource: "nodes", clusterOnly: true })).toBe(true);
  });

  test("keine Rule der Option passt zu Verb/Ressource -> kein Grant", () => {
    const role = option("nur-schreiben", false, [rule(["create", "delete"], ["pods"])]);
    expect(optionGrants(role, { subject: "s", verb: "get", resource: "pods" })).toBe(false);
  });
});

describe("optionBreadth", () => {
  test("mehr Verben/Ressourcen sind breiter als weniger", () => {
    const eng = option("eng", false, [rule(["get"], ["pods"])]);
    const weit = option("weit", false, [rule(["get", "list", "watch"], ["pods"])]);
    expect(optionBreadth(weit)).toBeGreaterThan(optionBreadth(eng));
  });

  test("eine Wildcard-Ressource ist breiter als eine einzelne, sonst gleiche Rule", () => {
    const einzeln = option("einzeln", false, [rule(["get"], ["pods"])]);
    const alles = option("alles", false, [rule(["get"], ["*"])]);
    expect(optionBreadth(alles)).toBeGreaterThan(optionBreadth(einzeln));
  });

  test("eine ClusterRole ist breiter als eine Role mit IDENTISCHEN rules (cluster-weiter Scope zählt zusätzlich)", () => {
    const rules = [rule(["get", "list"], ["nodes"])];
    const role = option("r", false, rules);
    const clusterRole = option("cr", true, rules);
    expect(optionBreadth(clusterRole)).toBeGreaterThan(optionBreadth(role));
  });
});

describe("checkKeyringChoice", () => {
  const options = [
    option("pod-leser", false, [rule(["get", "list", "watch"], ["pods"])]),
    option("alles-leser", false, [rule(["get", "list", "watch"], ["*"])]),
    option("schreibrecht", false, [rule(["create", "delete"], ["pods"])]),
  ];
  const task = { subject: "spaehposten", verb: "get", resource: "pods" };

  test("korrekt: die kleinste Option, die die Aufgabe erfüllt", () => {
    expect(checkKeyringChoice(options, task, 0).ok).toBe(true);
  });

  test("zu wenig: eine Option, die die Aufgabe gar nicht erfüllt, scheitert mit can-i-Begründung", () => {
    const result = checkKeyringChoice(options, task, 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/can-i/);
  });

  test("zu breit: eine passende, aber unnötig weite Option scheitert mit Verweis auf die schmalere Alternative", () => {
    const result = checkKeyringChoice(options, task, 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/pod-leser/);
  });

  test("Red-Green-Kontrolle: ohne den Breite-Vergleich würde JEDE passende Option (auch die zu breite) als korrekt durchgehen", () => {
    const naiveCheck = (idx: number) => optionGrants(options[idx], task);
    expect(naiveCheck(1)).toBe(true); // alles-leser passt technisch
    expect(checkKeyringChoice(options, task, 1).ok).toBe(false); // ist aber zu breit
  });
});

describe("RBAC_KEYRING_ROUNDS (Content)", () => {
  test("mindestens 3 Runden mit Schlüsselbund und Aufgaben", () => {
    expect(RBAC_KEYRING_ROUNDS.length).toBeGreaterThanOrEqual(3);
    for (const r of RBAC_KEYRING_ROUNDS) {
      expect(r.options.length).toBeGreaterThanOrEqual(2);
      expect(r.tasks.length).toBeGreaterThanOrEqual(1);
      expect(r.tip.trim().length).toBeGreaterThan(0);
    }
  });

  test("erste Runde hat noch KEINE cluster-weite Aufgabe (aufsteigend: erst nur namespaced Roles)", () => {
    expect(RBAC_KEYRING_ROUNDS[0].tasks.every((t) => !t.clusterOnly)).toBe(true);
  });

  test("mindestens eine spätere Runde führt eine clusterOnly-Aufgabe ein (ClusterRole nötig)", () => {
    expect(RBAC_KEYRING_ROUNDS.some((r) => r.tasks.some((t) => t.clusterOnly))).toBe(true);
  });

  test("jede Aufgabe hat GENAU EINE korrekte Option im Schlüsselbund (eindeutige Antwort, kein Rätsel mit mehreren Lösungen)", () => {
    for (const r of RBAC_KEYRING_ROUNDS) {
      for (const task of r.tasks) {
        const okIdxs = r.options.map((_, i) => i).filter((i) => checkKeyringChoice(r.options, task, i).ok);
        expect(okIdxs.length, `Runde „${r.name}“, Aufgabe „${task.subject}: ${task.verb} ${task.resource}“ hat ${okIdxs.length} korrekte Optionen (${okIdxs.map((i) => r.options[i].name).join(", ")}), erwartet genau 1`).toBe(1);
      }
    }
  });

  test("jede Aufgabe hat MINDESTENS eine passende Option im Schlüsselbund (kein unlösbares Rätsel)", () => {
    for (const r of RBAC_KEYRING_ROUNDS) {
      for (const task of r.tasks) {
        expect(r.options.some((o) => optionGrants(o, task)), `Runde „${r.name}“, Aufgabe „${task.subject}: ${task.verb} ${task.resource}“ hat keine passende Option`).toBe(true);
      }
    }
  });
});
