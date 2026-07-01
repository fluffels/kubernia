/* ===== Inhalte: Scenario-Validierung (#494, Content-as-Data) =====
 * Ein `scenario` (die serialisierbare Sim-Eingabewelt, `Scenario` aus sim/state.ts)
 * ist das fehleranfälligste Content-Feld: es hat ~60 optionale Felder und wurde bis
 * #494 im Loader per `as Scenario` bzw. `as unknown as Scenario` ungeprüft durchgereicht.
 * Ein Tippfehler im Schlüssel (z.B. `deploymnets` statt `deployments`, `aplyEffects`)
 * fiel dadurch NICHT beim Laden auf, sondern erst still im Sim-Verhalten (das falsch
 * geschriebene Feld wurde ignoriert und `reset()` füllte den Default).
 *
 * `reviveScenario` schließt diese Lücke im Stil der Check-DSL (`check-dsl.ts`):
 * **geschlossene Allowlist + fail-fast**. Ein unbekannter Top-Level-Schlüssel scheitert
 * hart beim Laden – genau wie eine unbekannte Sammlung in der Check-DSL. Bewusst nur
 * STRUKTURELL (richtige JSON-Art je Feld), NICHT die tiefe Ressourcen-Semantik: die
 * Eingabe-Schreibweisen sind laut `Scenario`-Doku absichtlich locker, `reset()`/
 * `mergeScenario()` normalisieren sie, und die Sim-Semantik prüft der Sim selbst. Ein
 * neues Scenario-Feld braucht so eine bewusste Allowlist-Zeile (fail-fast-Weiche),
 * statt still akzeptiert zu werden – dieselbe Ehrlichkeit wie `ClusterState` ↔ Sim.
 *
 * Liegt bewusst als eigenes Leaf-Modul neben `loader.ts` (statt darin) – wie
 * `check-dsl.ts`: eine geschlossene Validierungs-DSL, die der Loader nur aufruft.
 * Pure Domäne, Phaser-frei, unit-getestet (`test/scenario-validate.test.ts`).
 */
import { fail, asRecord, asNonEmptyString, asBool, asInt } from "./parse";
import type { Scenario } from "../sim";

/** Erlaubte Schlüssel eines `applyEffect` (was ein `kubectl apply -f <datei>` erzeugt).
 *  Spiegelt die `ApplyEffect`-Felder aus sim/state.ts – ein Tippfehler hier fiele sonst
 *  still im Sim-Verhalten auf (die JSON sieht der Compiler nie). */
const APPLY_EFFECT_KEYS = new Set<string>([
  "deployment", "serviceAccount", "role", "roleBinding", "service", "ingress",
  "networkPolicy", "application", "serviceMonitor", "prometheusRule",
  "grafanaDatasource", "grafanaDashboard", "statefulSet", "pvc", "pv",
  "storageClass", "volumeSnapshot",
]);

type ScenarioFieldCheck = (v: unknown, path: string) => void;

const scArray: ScenarioFieldCheck = (v, p) => { if (!Array.isArray(v)) fail(p, "Array erwartet"); };
const scBool: ScenarioFieldCheck = (v, p) => { asBool(v, p); };
const scStr: ScenarioFieldCheck = (v, p) => { asNonEmptyString(v, p); };
const scInt: ScenarioFieldCheck = (v, p) => { asInt(v, p); };
/** Einzelnes Objekt (kein Array, nicht null) – z.B. controlPlane. */
const scObj: ScenarioFieldCheck = (v, p) => { asRecord(v, p); };
/** Objekt ODER null – die bewusst nullbaren Einzel-Felder (tfBackend, gitConflict …). */
const scObjOrNull: ScenarioFieldCheck = (v, p) => {
  if (v === null) return;
  asRecord(v, p);
};
/** `files`: Record<string,string> – die simulierten Datei-Inhalte (per `cat` lesbar). */
const scStringRecord: ScenarioFieldCheck = (v, p) => {
  const o = asRecord(v, p);
  for (const k of Object.keys(o)) {
    if (typeof o[k] !== "string") fail(`${p}["${k}"]`, "String erwartet");
  }
};
/** `applyEffects`: Record<dateiname, ApplyEffect>; jeder Effekt-Schlüssel gegen die Allowlist. */
const scApplyEffects: ScenarioFieldCheck = (v, p) => {
  const o = asRecord(v, p);
  for (const file of Object.keys(o)) {
    const eff = asRecord(o[file], `${p}["${file}"]`);
    for (const ek of Object.keys(eff)) {
      if (!APPLY_EFFECT_KEYS.has(ek)) {
        fail(`${p}["${file}"].${ek}`, `unbekannter applyEffect-Schlüssel „${ek}" (nicht in der ApplyEffect-Allowlist)`);
      }
    }
  }
};

/** Geschlossene Allowlist der `Scenario`-Top-Level-Felder → strukturelle Prüfung je Feld.
 *  Spiegelt `interface Scenario` (sim/state.ts). Ein hier fehlender Schlüssel scheitert
 *  beim Laden (fail-fast gegen Tippfehler); ein neues Scenario-Feld braucht eine Zeile hier. */
const SCENARIO_FIELDS: Record<string, ScenarioFieldCheck> = {
  // Ressourcen-Arrays (nur strukturell – Element-Semantik füllt/prüft reset()/die Sim)
  dockerImages: scArray, dockerContainers: scArray, nodes: scArray, deployments: scArray,
  services: scArray, ingresses: scArray, networkPolicies: scArray, secrets: scArray,
  configMaps: scArray, serviceMonitors: scArray, prometheusRules: scArray,
  grafanaDatasources: scArray, grafanaDashboards: scArray, statefulSets: scArray,
  pvcs: scArray, pvs: scArray, storageClasses: scArray, volumeSnapshots: scArray,
  s3Buckets: scArray, serviceAccounts: scArray, roles: scArray, roleBindings: scArray,
  argoApps: scArray, helmRepos: scArray, releases: scArray, charts: scArray,
  tfResources: scArray, tfProviders: scArray, tfModules: scArray, tfOutputs: scArray,
  gitBranches: scArray, gitStaged: scArray, gitCommitted: scArray, gitCommits: scArray,
  ciPipelines: scArray,
  // Record-Felder
  files: scStringRecord,
  applyEffects: scApplyEffects,
  // Booleans
  bareMetal: scBool, tfInitialized: scBool, tfApplied: scBool, tfLocked: scBool,
  gitInitialized: scBool, gitPushed: scBool, gitFetched: scBool,
  // Strings
  gitBranch: scStr, tfLockHolder: scStr, podSecurity: scStr,
  // Zahlen
  gitRemoteAhead: scInt,
  // Einzel-Objekte
  controlPlane: scObj,
  // Nullbare Einzel-Objekte
  tfBackend: scObjOrNull, gitConflict: scObjOrNull, gitActiveConflict: scObjOrNull, ciDeploy: scObjOrNull,
};

/** Validiert ein rohes Inline-`scenario` strukturell gegen die geschlossene Feld-Allowlist
 *  und gibt es typisiert zurück. Wirft `ContentValidationError` beim ersten Verstoß
 *  (unbekannter Schlüssel = Tippfehler, oder falsche JSON-Art eines bekannten Felds). */
export function reviveScenario(v: unknown, path: string): Scenario {
  const o = asRecord(v, path);
  for (const key of Object.keys(o)) {
    const check = SCENARIO_FIELDS[key];
    if (!check) fail(`${path}.${key}`, `unbekanntes Scenario-Feld „${key}" (Tippfehler? nicht in der Scenario-Allowlist)`);
    check(o[key], `${path}.${key}`);
  }
  return o as Scenario;
}

/** Die erlaubten Scenario-Feld-/ApplyEffect-Namen (für Doku/Tests). */
export const SCENARIO_FIELD_NAMES: readonly string[] = Object.keys(SCENARIO_FIELDS);
export const APPLY_EFFECT_KEY_NAMES: readonly string[] = [...APPLY_EFFECT_KEYS];
