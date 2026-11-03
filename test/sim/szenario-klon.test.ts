/* Szenario, Zustand und Snapshot teilen keine verschachtelten Objekte (#1686): `reset()` und
 * `mergeScenario()` kopieren die einfachen Ressourcen-Listen tief. Ein Eingriff in den Zustand
 * (z.B. ein Listener per `apply`) darf das Szenario nicht verändern, sonst stellt `reset()` den
 * veränderten Stand wieder her. */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KQSim } from "./helpers";
import type { Scenario } from "../../src/sim/state";
import { SIM_GATEWAY_CONTROLLER } from "../../src/sim/gateway";
import { KQContent } from "../../src/content";

const szenario = (): Scenario => ({
  gatewayClasses: [{ name: "envoy", controllerName: SIM_GATEWAY_CONTROLLER }],
  gateways: [{ name: "tor", className: "envoy", listeners: [{ name: "http", port: 80, protocol: "HTTP" }] }],
  ingresses: [{ name: "web", className: "nginx", host: "a.de", path: "/", service: "web", port: 80, tls: { secretName: "x" } }],
});

describe("tiefe Kopie der einfachen Ressourcen", () => {
  test("reset: ein Eingriff in den Zustand ändert das Szenario nicht (Gateway-Listener, Ingress-tls)", () => {
    const sc = szenario();
    const sim = new KQSim(sc);
    sim.gateways[0].listeners.push({ name: "neu", port: 81, protocol: "HTTP" });
    sim.ingresses[0].tls!.secretName = "y";
    expect(sc).toEqual(szenario());
    sim.reset();
    expect(sim.gateways[0].listeners.map(l => l.name)).toEqual(["http"]);
    expect(sim.ingresses[0].tls?.secretName).toBe("x");
  });
  test("snapshot: eine spätere Zustandsänderung verändert den Snapshot nicht", () => {
    const sim = new KQSim(szenario());
    const snap = sim.snapshot();
    const vorher = JSON.stringify(snap);
    sim.gateways[0].listeners.push({ name: "neu", port: 81, protocol: "HTTP" });
    sim.ingresses[0].tls!.secretName = "y";
    expect(JSON.stringify(snap)).toBe(vorher);
  });
  test("mergeScenario: das gemergte Szenario teilt nichts mit dem Zustand", () => {
    const sim = new KQSim({});
    const sc = szenario();
    sim.mergeScenario(sc);
    sim.gateways[0].listeners.push({ name: "neu", port: 81, protocol: "HTTP" });
    sim.ingresses[0].tls!.secretName = "y";
    expect(sc).toEqual(szenario());
  });
  test("der Snapshot bleibt per structuredClone kopierbar (nur Daten, keine Funktionen)", () => {
    const sim = new KQSim(szenario());
    expect(() => structuredClone(sim.snapshot())).not.toThrow();
  });
});

/* #1751: auch Secret-/ConfigMap-Keys und applyEffects sind tief entkoppelt. */
const reich = (): Scenario => ({
  secrets: [{ name: "s", keys: ["a"] }],
  configMaps: [{ name: "c", keys: ["a"] }],
  applyEffects: { "a.yaml": { deployment: { name: "web", image: "nginx", replicas: 2 } } },
});

describe("tiefe Kopie: Keys und applyEffects", () => {
  test("reset: Eingriffe in secrets-/configMaps-Keys und applyEffects ändern das Szenario nicht", () => {
    const sc = reich();
    const sim = new KQSim(sc);
    sim.secrets[0].keys.push("x");
    sim.configMaps[0].keys.push("x");
    sim.applyEffects["a.yaml"].deployment!.replicas = 9;
    expect(sc).toEqual(reich());
    sim.reset();
    expect(sim.applyEffects["a.yaml"].deployment!.replicas).toBe(2);
    expect(sim.secrets[0].keys).toEqual(["a"]);
  });
  test("mergeScenario: das gemergte Szenario teilt configMaps-Keys und applyEffects nicht mit dem Zustand", () => {
    const sim = new KQSim({});
    const sc = reich();
    sim.mergeScenario(sc);
    sim.configMaps[0].keys.push("x");
    sim.secrets[0].keys.push("x");
    sim.applyEffects["a.yaml"].deployment!.replicas = 9;
    expect(sc).toEqual(reich());
  });
  test("mergeScenario: secrets werden additiv per Name gemischt (#1985)", () => {
    const sim = new KQSim({});
    sim.mergeScenario({ secrets: [{ name: "s", keys: ["a"] }] });
    expect(sim.secrets.map(s => s.name)).toEqual(["s"]);
    sim.mergeScenario({ secrets: [{ name: "s", keys: ["a"] }] });
    expect(sim.secrets).toHaveLength(1);
  });
  test("mergeScenario: ein vorhandenes gleichnamiges Secret bleibt unverändert", () => {
    const sim = new KQSim({ secrets: [{ name: "s", keys: ["alt"] }] });
    sim.mergeScenario({ secrets: [{ name: "s", keys: ["neu"] }, { name: "t", keys: ["b"] }] });
    expect(sim.secrets.map(s => s.name)).toEqual(["s", "t"]);
    expect(sim.secrets[0].keys).toEqual(["alt"]);
  });
  test("snapshot: spätere Änderungen an Keys und applyEffects verändern den Snapshot nicht", () => {
    const sim = new KQSim(reich());
    const snap = sim.snapshot();
    const vorher = JSON.stringify(snap);
    sim.secrets[0].keys.push("x");
    sim.applyEffects["a.yaml"].deployment!.replicas = 9;
    expect(JSON.stringify(snap)).toBe(vorher);
  });
});

/* #1985: Argo-Apps und per apply angelegte Application/RoleBinding teilen nichts mit Szenario,
 * Snapshot und applyEffects (Kopierstellen in sim/argocd.ts und sim/kubectl/lifecycle.ts). */
const argoSzenario = (): Scenario => ({
  argoApps: [
    { name: "kasse", repo: "r", path: "kasse/", autoSync: false, selfHeal: false, created: 0,
      desired: { deployment: { name: "kasse", image: "nginx", replicas: 3 }, service: { name: "kasse", port: "80" } } },
    { name: "flotte", repo: "r", path: "flotte/", autoSync: false, selfHeal: false, created: 0,
      childApps: [{ name: "kind", deployment: { name: "kind", image: "nginx", replicas: 1 }, service: { name: "kind", port: "80" } }] },
  ],
});

describe("tiefe Kopie: Argo-Apps und apply von Application/RoleBinding", () => {
  test("reset: Eingriffe in desired und childApps ändern das Szenario nicht", () => {
    const sc = argoSzenario();
    const sim = new KQSim(sc);
    sim.argoApps[0].desired!.deployment.replicas = 9;
    sim.argoApps[0].desired!.service!.port = "81";
    sim.argoApps[1].childApps![0].deployment.replicas = 9;
    sim.argoApps[1].childApps![0].service!.port = "81";
    expect(sc).toEqual(argoSzenario());
    sim.reset();
    expect(sim.argoApps[0].desired!.deployment.replicas).toBe(3);
    expect(sim.argoApps[1].childApps![0].deployment.replicas).toBe(1);
  });
  test("snapshot: spätere Änderungen an desired und childApps verändern den Snapshot nicht", () => {
    const sim = new KQSim(argoSzenario());
    const snap = sim.snapshot();
    const vorher = JSON.stringify(snap);
    sim.argoApps[0].desired!.deployment.replicas = 9;
    sim.argoApps[0].desired!.service!.port = "81";
    sim.argoApps[1].childApps![0].deployment.replicas = 9;
    sim.argoApps[1].childApps![0].service!.port = "81";
    expect(JSON.stringify(snap)).toBe(vorher);
  });
  test("apply einer Application: der Live-Zustand teilt nichts mit applyEffects", () => {
    const sim = new KQSim({});
    sim.files["a.yaml"] = "kind: Application";
    const eff = {
      application: { name: "kasse", deployment: { name: "kasse", image: "nginx", replicas: 3 }, service: { name: "kasse", port: "80" } },
    };
    sim.applyEffects["a.yaml"] = structuredClone(eff);
    sim.exec("kubectl apply -f a.yaml");
    const app = sim.argoApps.find(x => x.name === "kasse")!;
    app.desired!.deployment.replicas = 9;
    app.desired!.service!.port = "81";
    expect(sim.applyEffects["a.yaml"]).toEqual(eff);
  });
  test("apply einer App-of-Apps und Sync: Kind-Apps teilen nichts mit der Wurzel", () => {
    const sim = new KQSim({});
    sim.files["w.yaml"] = "kind: Application";
    sim.applyEffects["w.yaml"] = { application: { name: "flotte", childApps: [
      { name: "kind", deployment: { name: "kind", image: "nginx", replicas: 1 }, service: { name: "kind", port: "80" } },
    ] } };
    sim.exec("kubectl apply -f w.yaml");
    const wurzel = sim.argoApps.find(x => x.name === "flotte")!;
    const vorher = structuredClone(wurzel.childApps);
    sim.exec("argocd app sync flotte");
    const kind = sim.argoApps.find(x => x.name === "kind")!;
    expect(kind).toBeDefined();
    kind.desired!.deployment.replicas = 9;
    kind.desired!.service!.port = "81";
    expect(wurzel.childApps).toEqual(vorher);
  });
  test("apply einer RoleBinding: die Subjects teilen nichts mit applyEffects", () => {
    const sim = new KQSim({});
    sim.files["rb.yaml"] = "kind: RoleBinding";
    const eff = { roleBinding: { name: "rb", roleRef: { kind: "Role" as const, name: "r" }, subjects: [{ kind: "ServiceAccount" as const, name: "bot", namespace: "default" }] } };
    sim.applyEffects["rb.yaml"] = structuredClone(eff);
    sim.exec("kubectl apply -f rb.yaml");
    const rb = sim.roleBindings.find(b => b.name === "rb")!;
    expect(rb).toBeDefined();
    rb.subjects[0].name = "anders";
    expect(sim.applyEffects["rb.yaml"]).toEqual(eff);
  });
});

/* #1985: Aufrufer (Quest-Replay, Savegame-Restore) übergeben `step.scenario` ohne Außenkopie;
 * `mergeScenario` darf das Szenario deshalb nie verändern. */
function tiefEinfrieren<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) tiefEinfrieren(v);
    Object.freeze(o);
  }
  return o;
}

describe("mergeScenario verändert das übergebene Szenario nie", () => {
  test("alle Quest-Szenarien lassen sich tief eingefroren der Reihe nach mischen", () => {
    const sim = new KQSim({});
    let n = 0;
    for (const quest of KQContent.QUESTS) {
      for (const step of quest.steps) {
        if (!step.scenario) continue;
        n++;
        expect(() => sim.mergeScenario(tiefEinfrieren(structuredClone(step.scenario)))).not.toThrow();
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

/* Fitness (#1751, #1985): `src/sim.ts` und `src/sim/**` kopieren Ressourcen mit EINER Strategie
 * (`structuredClone`). Der Wächter ist zeilenbasiert und kennt eine geschlossene Musterliste:
 * `Object.assign({}` und `JSON.parse(JSON.stringify(`; Kommentarzeilen sind ausgenommen.
 * Grenze (nicht erfasst): Spread-Kopien, `.slice()`, feldweise Kopien mit Normalisierung,
 * Merge-Into (`Object.assign(ziel, quelle)`) und mehrzeilige Aufrufe; deren Entkopplung sichert
 * das Verhaltens-Set oben. */
const FLACHE_KOPIE = [/Object\.assign\(\s*\{\s*\}/, /JSON\.parse\(\s*JSON\.stringify\(/];
export function flacheKopien(quelltext: string): string[] {
  return quelltext.split("\n")
    .map((z, i) => ({ z: z.trim(), n: i + 1 }))
    .filter(({ z }) => !/^(\/\/|\/\*|\*)/.test(z) && FLACHE_KOPIE.some(re => re.test(z)))
    .map(({ z, n }) => `${n}: ${z.slice(0, 80)}`);
}

/** `sim.ts` plus alle `*.ts` unter `sim/`, rekursiv, Pfade relativ zu `srcWurzel` (POSIX). */
export function simQuellen(srcWurzel: string): string[] {
  const unterSim = readdirSync(join(srcWurzel, "sim"), { recursive: true })
    .map(p => String(p).replace(/\\/g, "/"))
    .filter(p => p.endsWith(".ts"))
    .map(p => `sim/${p}`);
  return ["sim.ts", ...unterSim].sort();
}

export function flacheKopienUnter(srcWurzel: string): string[] {
  return simQuellen(srcWurzel).flatMap(rel =>
    flacheKopien(readFileSync(join(srcWurzel, rel), "utf8")).map(z => `${rel}:${z}`));
}

describe("Fitness: eine Klon-Strategie in src/sim.ts und src/sim/**", () => {
  const src = join(__dirname, "../../src");
  test("keine flache Kopie (Object.assign({}, …), JSON-Rundreise) unter src/sim.ts und src/sim/**", () => {
    expect(flacheKopienUnter(src)).toEqual([]);
  });
  test("der Wächter erfasst src/sim.ts und src/sim/** (läuft nicht leer)", () => {
    expect(simQuellen(src)).toEqual(expect.arrayContaining(["sim.ts", "sim/argocd.ts", "sim/kubectl/lifecycle.ts"]));
  });
  test("Negativfall: ein neues Object.assign({}, x) in src/sim/** macht den Wächter rot", () => {
    const wurzel = mkdtempSync(join(tmpdir(), "klon-"));
    try {
      mkdirSync(join(wurzel, "sim", "kubectl"), { recursive: true });
      writeFileSync(join(wurzel, "sim.ts"), "const ok = structuredClone(x);\n");
      writeFileSync(join(wurzel, "sim", "kubectl", "neu.ts"), "const k = Object.assign({}, x);\n");
      expect(flacheKopienUnter(wurzel)).toEqual(["sim/kubectl/neu.ts:1: const k = Object.assign({}, x);"]);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });
  test("Selbsttest: Code-Treffer mit Zeile, Kommentarzeilen nicht", () => {
    const beispiel = [
      "// Object.assign({}, x) im Kommentar",
      " * JSON.parse(JSON.stringify(x))",
      "const a = Object.assign({}, x);",
      "const b = JSON.parse(JSON.stringify(x));",
      "Object.assign(ziel, quelle);",
      "const c = structuredClone(x);",
    ].join("\n");
    expect(flacheKopien(beispiel)).toEqual([
      "3: const a = Object.assign({}, x);",
      "4: const b = JSON.parse(JSON.stringify(x));",
    ]);
  });
});
