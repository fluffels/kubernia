/* Unit-Tests der deklarativen Quest-Check-DSL (#411).
 * Deckt die Regel- und Matcher-Formen positiv UND negativ ab und sichert die
 * Validierung Red-Green ab: eine Regel, die auch bei kaputter Struktur still
 * durchginge, wäre wertlos. Die Sim wird hier bewusst als schlankes Fake-Objekt
 * gestellt (präzise Kontrolle je Fall) – der echte Sim-Durchlauf ist in
 * quests.test.ts abgedeckt (spielt die Story und prüft jeden check gegen den
 * realen Zustand). */
import { test } from "vitest";
import assert from "node:assert/strict";
import { compileCheck, ContentValidationError, CHECK_COLLECTIONS } from "../src/content/check-dsl";
import type { Sim } from "../src/sim";

/** Baut ein minimales Sim-Fake aus den Feldern, die eine Regel anfasst. */
function fakeSim(state: Record<string, unknown>): Sim {
  return state as unknown as Sim;
}

/** Compiliert eine Regel und wertet sie gegen ein Fake-Sim aus. */
function evalRule(rule: unknown, state: Record<string, unknown>): boolean {
  return compileCheck(rule, "test")(fakeSim(state));
}

/* ===================== some / none / count ===================== */

test("some: Sammlung enthält ein Element mit passendem Feld", () => {
  const rule = { some: "services", where: { name: "kasse" } };
  assert.equal(evalRule(rule, { services: [{ name: "kasse" }] }), true);
  assert.equal(evalRule(rule, { services: [{ name: "andere" }] }), false);
  assert.equal(evalRule(rule, { services: [] }), false);
});

test("some ohne where: Sammlung ist nicht leer", () => {
  const rule = { some: "releases" };
  assert.equal(evalRule(rule, { releases: [{ name: "x" }] }), true);
  assert.equal(evalRule(rule, { releases: [] }), false);
});

test("none: kein Element passt (Abwesenheit)", () => {
  const rule = { none: "deployments", where: { name: "datenbank" } };
  assert.equal(evalRule(rule, { deployments: [{ name: "andere" }] }), true);
  assert.equal(evalRule(rule, { deployments: [{ name: "datenbank" }] }), false);
});

test("count: Anzahl der Elemente verglichen", () => {
  assert.equal(evalRule({ count: "nodes", cmp: ">", value: 3 }, { nodes: [1, 2, 3, 4] }), true);
  assert.equal(evalRule({ count: "nodes", cmp: ">", value: 3 }, { nodes: [1, 2, 3] }), false);
  assert.equal(evalRule({ count: "releases", cmp: ">", value: 0 }, { releases: [{}] }), true);
  // mit where: nur passende zählen
  const rule = { count: "deployments", where: { broken: { truthy: false } }, cmp: "==", value: 2 };
  assert.equal(evalRule(rule, { deployments: [{ broken: null }, { broken: null }, { broken: { type: "x" } }] }), true);
  assert.equal(evalRule(rule, { deployments: [{ broken: null }] }), false); // nur 1 heil ≠ 2
});

/* ===================== Matcher-Formen ===================== */

test("matcher truthy:false – deployment heil (broken null/false)", () => {
  const rule = { some: "deployments", where: { name: "leuchtfeuer", broken: { truthy: false } } };
  assert.equal(evalRule(rule, { deployments: [{ name: "leuchtfeuer", broken: null }] }), true);
  assert.equal(evalRule(rule, { deployments: [{ name: "leuchtfeuer", broken: { type: "imagepull" } }] }), false);
  // falscher Name → kein Treffer
  assert.equal(evalRule(rule, { deployments: [{ name: "andere", broken: null }] }), false);
});

test("matcher truthy:true – Feld vorhanden (tls/childApps)", () => {
  const rule = { some: "ingresses", where: { name: "hafentor", tls: { truthy: true } } };
  assert.equal(evalRule(rule, { ingresses: [{ name: "hafentor", tls: { secretName: "s" } }] }), true);
  assert.equal(evalRule(rule, { ingresses: [{ name: "hafentor" }] }), false);
});

test("matcher len – Array-Länge exakt", () => {
  const rule = { some: "argoApps", where: { name: "hafen-flotte", childApps: { len: 3 } } };
  assert.equal(evalRule(rule, { argoApps: [{ name: "hafen-flotte", childApps: [1, 2, 3] }] }), true);
  assert.equal(evalRule(rule, { argoApps: [{ name: "hafen-flotte", childApps: [1, 2] }] }), false);
  assert.equal(evalRule(rule, { argoApps: [{ name: "hafen-flotte" }] }), false);
});

test("matcher has – Sub-Array enthält passendes Element (StatefulSet-Pods)", () => {
  const rule = { some: "statefulSets", where: { name: "speicher-datenbank", pods: { has: { name: "speicher-datenbank-0" } } } };
  assert.equal(evalRule(rule, { statefulSets: [{ name: "speicher-datenbank", pods: [{ name: "speicher-datenbank-0" }] }] }), true);
  assert.equal(evalRule(rule, { statefulSets: [{ name: "speicher-datenbank", pods: [{ name: "speicher-datenbank-1" }] }] }), false);
  assert.equal(evalRule(rule, { statefulSets: [{ name: "speicher-datenbank", pods: [] }] }), false);
});

test("matcher match – verschachteltes Objekt + includes (envFrom)", () => {
  const rule = {
    some: "deployments",
    where: {
      name: "passagierliste",
      envFrom: { match: { configMaps: { includes: "passagier-config" }, secrets: { includes: "passagier-geheim" } } },
    },
  };
  assert.equal(evalRule(rule, { deployments: [{ name: "passagierliste", envFrom: { configMaps: ["passagier-config"], secrets: ["passagier-geheim"] } }] }), true);
  assert.equal(evalRule(rule, { deployments: [{ name: "passagierliste", envFrom: { configMaps: ["passagier-config"], secrets: [] } }] }), false);
});

test("matcher Literal-Zahl – replicas exakt", () => {
  const rule = { some: "deployments", where: { name: "hafen-lager", replicas: 0 } };
  assert.equal(evalRule(rule, { deployments: [{ name: "hafen-lager", replicas: 0 }] }), true);
  assert.equal(evalRule(rule, { deployments: [{ name: "hafen-lager", replicas: 2 }] }), false);
});

test("matcher Literal-Boolean – container running:false", () => {
  const rule = { some: "containers", where: { running: false } };
  assert.equal(evalRule(rule, { docker: { containers: [{ running: false }] } }), true);
  assert.equal(evalRule(rule, { docker: { containers: [{ running: true }] } }), false);
});

/* ===================== flag / includes (Skalar-Pfade) ===================== */

test("flag ohne eq: Pfad-Wert truthy", () => {
  assert.equal(evalRule({ flag: ["tf", "applied"] }, { tf: { applied: true } }), true);
  assert.equal(evalRule({ flag: ["tf", "applied"] }, { tf: { applied: false } }), false);
  assert.equal(evalRule({ flag: ["git", "conflict"] }, { git: { conflict: { file: "x" } } }), true);
  assert.equal(evalRule({ flag: ["git", "conflict"] }, { git: { conflict: null } }), false);
});

test("flag mit eq: strikte Gleichheit (auch Zahl 0)", () => {
  assert.equal(evalRule({ flag: ["git", "remoteAhead"], eq: 0 }, { git: { remoteAhead: 0 } }), true);
  assert.equal(evalRule({ flag: ["git", "remoteAhead"], eq: 0 }, { git: { remoteAhead: 2 } }), false);
});

test("flag mit Punkt-Schlüssel (Dateiname in sim.files)", () => {
  const rule = { flag: ["files", "seekarte.md"], eq: "Nordpassage" };
  assert.equal(evalRule(rule, { files: { "seekarte.md": "Nordpassage" } }), true);
  assert.equal(evalRule(rule, { files: { "seekarte.md": "anders" } }), false);
  assert.equal(evalRule(rule, { files: {} }), false);
});

test("includes: Array unter Pfad enthält Wert (git.staged)", () => {
  const rule = { includes: ["git", "staged"], value: "seekarte.md" };
  assert.equal(evalRule(rule, { git: { staged: ["seekarte.md"] } }), true);
  assert.equal(evalRule(rule, { git: { staged: ["andere.md"] } }), false);
  assert.equal(evalRule(rule, { git: { staged: [] } }), false);
});

/* ===================== Kombinatoren all / any / not ===================== */

test("all: alle Teilregeln müssen gelten (UND)", () => {
  const rule = { all: [{ flag: ["tf", "applied"] }, { some: "services", where: { name: "kasse" } }] };
  assert.equal(evalRule(rule, { tf: { applied: true }, services: [{ name: "kasse" }] }), true);
  assert.equal(evalRule(rule, { tf: { applied: false }, services: [{ name: "kasse" }] }), false);
});

test("any: mindestens eine Teilregel (ODER)", () => {
  const rule = { any: [{ flag: ["tf", "applied"] }, { some: "services", where: { name: "kasse" } }] };
  assert.equal(evalRule(rule, { tf: { applied: false }, services: [{ name: "kasse" }] }), true);
  assert.equal(evalRule(rule, { tf: { applied: false }, services: [] }), false);
});

test("not: Negation", () => {
  const rule = { not: { flag: ["git", "conflict"] } };
  assert.equal(evalRule(rule, { git: { conflict: null } }), true);
  assert.equal(evalRule(rule, { git: { conflict: { file: "x" } } }), false);
});

test("verschachtelt: all aus some + none (app-of-apps-Muster)", () => {
  const rule = {
    all: [
      { some: "argoApps", where: { name: "hafen-flotte", childApps: { truthy: true } } },
      { some: "argoApps", where: { name: "flotte-lager" } },
    ],
  };
  assert.equal(evalRule(rule, { argoApps: [{ name: "hafen-flotte", childApps: [1] }, { name: "flotte-lager" }] }), true);
  assert.equal(evalRule(rule, { argoApps: [{ name: "hafen-flotte", childApps: [1] }] }), false);
});

/* ===================== virtuelle Sammlung alerts() ===================== */

test("alerts: virtuelle Sammlung über sim.alerts()", () => {
  const rule = { some: "alerts", where: { name: "HighPodCPU", state: "firing" } };
  assert.equal(evalRule(rule, { alerts: () => [{ name: "HighPodCPU", state: "firing" }] }), true);
  assert.equal(evalRule(rule, { alerts: () => [{ name: "HighPodCPU", state: "resolved" }] }), false);
  assert.equal(evalRule(rule, { alerts: () => [] }), false);
});

/* ===================== Red-Green: Validierung wirft ===================== */

test("Red-Green: unbekannte Sammlung wirft ContentValidationError", () => {
  assert.throws(
    () => compileCheck({ some: "gibtsnicht", where: { name: "x" } }, "p"),
    (e: unknown) => e instanceof ContentValidationError && /gibtsnicht/.test((e as Error).message),
  );
});

test("Red-Green: unbekannter Regel-Schlüssel wirft", () => {
  assert.throws(
    () => compileCheck({ irgendwas: 1 }, "p"),
    (e: unknown) => e instanceof ContentValidationError && /Regel-Schlüssel/.test((e as Error).message),
  );
});

test("Red-Green: mehrere Regel-Schlüssel gleichzeitig werfen", () => {
  assert.throws(
    () => compileCheck({ some: "services", flag: ["tf", "applied"] }, "p"),
    ContentValidationError,
  );
});

test("Red-Green: unbekannter cmp-Operator wirft", () => {
  assert.throws(
    () => compileCheck({ count: "nodes", cmp: "≈", value: 3 }, "p"),
    (e: unknown) => e instanceof ContentValidationError && /Operator/.test((e as Error).message),
  );
});

test("Red-Green: count ohne numerischen value wirft", () => {
  assert.throws(() => compileCheck({ count: "nodes", cmp: ">", value: "drei" }, "p"), ContentValidationError);
});

test("Red-Green: leeres where wirft", () => {
  assert.throws(() => compileCheck({ some: "services", where: {} }, "p"), ContentValidationError);
});

test("Red-Green: unbekannte/mehrdeutige Matcher-Form wirft", () => {
  assert.throws(
    () => compileCheck({ some: "services", where: { name: { quatsch: 1 } } }, "p"),
    (e: unknown) => e instanceof ContentValidationError && /Matcher-Form/.test((e as Error).message),
  );
  // zwei Formen gleichzeitig → ebenfalls ungültig
  assert.throws(() => compileCheck({ some: "services", where: { x: { truthy: true, len: 1 } } }, "p"), ContentValidationError);
});

test("Red-Green: leere all-Liste wirft", () => {
  assert.throws(() => compileCheck({ all: [] }, "p"), ContentValidationError);
});

test("Red-Green: flag mit leerem Pfad wirft", () => {
  assert.throws(() => compileCheck({ flag: [] }, "p"), ContentValidationError);
});

test("Allowlist enthält die erwarteten Kern-Sammlungen", () => {
  for (const c of ["services", "deployments", "argoApps", "pvcs", "alerts"]) {
    assert.ok(CHECK_COLLECTIONS.includes(c), "Allowlist fehlt: " + c);
  }
});
