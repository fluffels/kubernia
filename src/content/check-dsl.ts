/* ===== Inhalte: deklarative Quest-Check-DSL (#411, Content-as-Data) =====
 * Eine Quest-Aufgabe (`teach`/`terminal`) kann eine `check`-Bedingung tragen:
 * ein Prädikat gegen den Sim-Zustand („ist das Deployment jetzt heil?", „existiert
 * der Service?"). Bis #411 war jedes dieser Prädikate hartcodierter TS-Code in
 * `checks.ts` (eine Funktion je Aufgabe). Damit brauchte jede neue Quest mit
 * Prüfbedingung eine Code-Berührung – das Content-as-Data-Versprechen (ADR 0004→0007)
 * brach genau hier.
 *
 * Dieses Modul macht die häufigen Bedingungen zu **Daten**: in der Quest-JSON steht
 * statt eines undurchsichtigen Keys eine kleine deklarative Regel, z.B.
 *   "check": { "some": "services", "where": { "name": "kasse" } }
 *   "check": { "some": "deployments", "where": { "name": "leuchtfeuer", "broken": { "truthy": false } } }
 * `compileCheck` übersetzt sie beim Laden in genau dasselbe `(sim) => boolean`, das
 * der Quest-Runner (ui/radio.ts, quests.test.ts) ohnehin aufruft – es zählt nur die
 * Truthiness. Eine neue Standard-Quest mit Prüfbedingung kommt damit OHNE Code aus.
 *
 * **Warum bei Stardew-Scope tragfähig:** die Regeln referenzieren Sim-Sammlungen über
 * eine **geschlossene Allowlist** (`COLLECTIONS`). Eine unbekannte Sammlung scheitert
 * hart beim Laden (`ContentValidationError`), genau wie ein unbekannter check-Key
 * früher – die Regel ist also referenziell an den echten Sim-Zustand gebunden. Die
 * konkreten Ressourcen-*Namen* (z.B. „hafen-lager") lassen sich NICHT statisch prüfen:
 * sie werden vom Spieler erst beim Lösen der Quest angelegt – genau das verifiziert
 * der Check ja. Tippfehler in einem Namen/Pfad fallen daher im Story-Durchlauf
 * (`quests.test.ts`) auf: der Check bliebe fälschlich falsch → roter Test.
 *
 * **Echte Sonderfälle bleiben Code** (`checks.ts`): Bedingungen, die kein
 * *deklarativer Zustand*, sondern eine transiente Aktions-Markierung sind (z.B.
 * „der Spieler hat gerade einen Pod gelöscht", `sim.lastDeletedPod`). Die JSON darf
 * `check` weiterhin als String-Key schreiben; der Loader löst ihn über `QUEST_CHECKS` auf.
 *
 * Pure Domäne, Phaser-frei, unit-getestet (`test/check-dsl.test.ts`).
 */
import type { Sim } from "../sim";
import { ContentValidationError, fail, asRecord, asArray, asNonEmptyString, asNonEmptyStringArray } from "./parse";

/** Ein kompilierter Check: liest den Sim-Zustand, liefert eine Wahrheit. */
export type CompiledCheck = (sim: Sim) => boolean;

/* ----------------------------------------------------------------------------
 * Sammlungs-Allowlist: welche Sim-Listen eine Regel adressieren darf. Eine Regel
 * mit einem Namen, der hier nicht steht, scheitert beim Laden. `alerts` ist eine
 * *virtuelle* Sammlung (Methode `sim.alerts()`), kein Feld – die berechneten
 * Alarme sind aber legitimer, lesbarer Cluster-Zustand (Observability #109/#110).
 * -------------------------------------------------------------------------- */
const COLLECTIONS: Record<string, (sim: Sim) => readonly unknown[]> = {
  containers: (s) => s.docker.containers,
  services: (s) => s.services,
  ingresses: (s) => s.ingresses,
  networkPolicies: (s) => s.networkPolicies,
  deployments: (s) => s.deployments,
  nodes: (s) => s.nodes,
  releases: (s) => s.releases,
  argoApps: (s) => s.argoApps,
  serviceMonitors: (s) => s.serviceMonitors,
  prometheusRules: (s) => s.prometheusRules,
  grafanaDatasources: (s) => s.grafanaDatasources,
  grafanaDashboards: (s) => s.grafanaDashboards,
  statefulSets: (s) => s.statefulSets,
  pvcs: (s) => s.pvcs,
  pvs: (s) => s.pvs,
  storageClasses: (s) => s.storageClasses,
  volumeSnapshots: (s) => s.volumeSnapshots,
  serviceAccounts: (s) => s.serviceAccounts,
  roles: (s) => s.roles,
  roleBindings: (s) => s.roleBindings,
  alerts: (s) => s.alerts(),
};

/** Vergleichsoperatoren für `count`-Regeln. */
const CMP_OPS = [">", ">=", "==", "!=", "<", "<="] as const;
type Cmp = (typeof CMP_OPS)[number];

function compareNum(a: number, op: Cmp, b: number): boolean {
  switch (op) {
    case ">": return a > b;
    case ">=": return a >= b;
    case "==": return a === b;
    case "!=": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
  }
}

/** Liest das Feld `key` aus einem Sammlungs-Element (kein Objekt → undefined). */
function field(el: unknown, key: string): unknown {
  if (el === null || typeof el !== "object") return undefined;
  return (el as Record<string, unknown>)[key];
}

/** Folgt einem Daten-Pfad ab dem Sim-Objekt (fehlendes Segment → undefined).
 *  Der Pfad ist ein Array (kein gepunkteter String), damit Schlüssel mit Punkt
 *  – z.B. ein Dateiname `"seekarte.md"` in `sim.files` – sauber adressierbar sind. */
function readPath(sim: Sim, path: string[]): unknown {
  let cur: unknown = sim;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function asScalar(v: unknown, path: string): string | number | boolean {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return fail(path, "String, Zahl oder Boolean erwartet");
}

/* ----------------------------------------------------------------------------
 * Matcher: prüft EIN Sammlungs-Element gegen eine Feld→Bedingung-Map. Alle Felder
 * müssen passen (implizites UND). Eine Feld-Bedingung ist entweder ein Literal
 * (=== ) oder ein Objekt mit genau einer der Formen truthy/len/includes/has/match.
 * -------------------------------------------------------------------------- */
type ElPred = (el: unknown) => boolean;

function compileFieldMatch(key: string, spec: unknown, path: string): ElPred {
  // Literal: strikte Gleichheit (deckt Namen, Zahlen wie replicas, Booleans wie running ab).
  if (typeof spec === "string" || typeof spec === "number" || typeof spec === "boolean") {
    return (el) => field(el, key) === spec;
  }
  const o = asRecord(spec, path);
  const forms = ["truthy", "len", "includes", "has", "match"].filter((k) => k in o);
  if (forms.length !== 1) fail(path, `genau eine Matcher-Form erwartet (truthy/len/includes/has/match), gefunden: ${forms.join(",") || "keine"}`);
  const form = forms[0];
  switch (form) {
    case "truthy": {
      if (typeof o.truthy !== "boolean") fail(`${path}.truthy`, "Boolean erwartet");
      const want = o.truthy;
      return (el) => Boolean(field(el, key)) === want;
    }
    case "len": {
      if (typeof o.len !== "number" || !Number.isInteger(o.len) || o.len < 0) fail(`${path}.len`, "nicht-negative Ganzzahl erwartet");
      const want = o.len;
      return (el) => { const v = field(el, key); return Array.isArray(v) && v.length === want; };
    }
    case "includes": {
      const want = asScalar(o.includes, `${path}.includes`);
      return (el) => { const v = field(el, key); return Array.isArray(v) && v.includes(want); };
    }
    case "has": {
      const sub = compileMatcher(o.has, `${path}.has`);
      return (el) => { const v = field(el, key); return Array.isArray(v) && v.some(sub); };
    }
    case "match": {
      const sub = compileMatcher(o.match, `${path}.match`);
      return (el) => { const v = field(el, key); return typeof v === "object" && v !== null && sub(v); };
    }
    default:
      return fail(path, `unbekannte Matcher-Form: ${form}`);
  }
}

function compileMatcher(where: unknown, path: string): ElPred {
  const o = asRecord(where, path);
  const keys = Object.keys(o);
  if (keys.length === 0) fail(path, "nicht-leere where-Bedingung erwartet");
  const preds = keys.map((k) => compileFieldMatch(k, o[k], `${path}.${k}`));
  return (el) => preds.every((p) => p(el));
}

/* ----------------------------------------------------------------------------
 * Regeln: die booleschen Ausdrücke der DSL. Genau ein Regel-Schlüssel je Objekt.
 * -------------------------------------------------------------------------- */
const RULE_KEYS = ["all", "any", "not", "some", "none", "count", "flag", "includes"] as const;

function collectionReader(name: unknown, path: string): (sim: Sim) => readonly unknown[] {
  const key = asNonEmptyString(name, path);
  const reader = COLLECTIONS[key];
  if (!reader) fail(path, `unbekannte Sammlung „${key}" (nicht in der Check-DSL-Allowlist)`);
  return reader;
}

function compileRule(rule: unknown, path: string): CompiledCheck {
  const o = asRecord(rule, path);
  const present = RULE_KEYS.filter((k) => k in o);
  if (present.length !== 1) {
    fail(path, `genau ein Regel-Schlüssel erwartet (${RULE_KEYS.join("/")}), gefunden: ${present.join(",") || "keiner"}`);
  }
  const kind = present[0];
  switch (kind) {
    case "all": {
      const subs = asArray(o.all, `${path}.all`).map((r, i) => compileRule(r, `${path}.all[${i}]`));
      if (subs.length === 0) fail(`${path}.all`, "nicht-leere Regelliste erwartet");
      return (sim) => subs.every((s) => s(sim));
    }
    case "any": {
      const subs = asArray(o.any, `${path}.any`).map((r, i) => compileRule(r, `${path}.any[${i}]`));
      if (subs.length === 0) fail(`${path}.any`, "nicht-leere Regelliste erwartet");
      return (sim) => subs.some((s) => s(sim));
    }
    case "not": {
      const sub = compileRule(o.not, `${path}.not`);
      return (sim) => !sub(sim);
    }
    case "some": {
      const reader = collectionReader(o.some, `${path}.some`);
      const pred = o.where === undefined ? null : compileMatcher(o.where, `${path}.where`);
      return pred ? (sim) => reader(sim).some(pred) : (sim) => reader(sim).length > 0;
    }
    case "none": {
      const reader = collectionReader(o.none, `${path}.none`);
      const pred = o.where === undefined ? null : compileMatcher(o.where, `${path}.where`);
      return pred ? (sim) => !reader(sim).some(pred) : (sim) => reader(sim).length === 0;
    }
    case "count": {
      const reader = collectionReader(o.count, `${path}.count`);
      const pred = o.where === undefined ? null : compileMatcher(o.where, `${path}.where`);
      const op = asNonEmptyString(o.cmp, `${path}.cmp`);
      if (!(CMP_OPS as readonly string[]).includes(op)) fail(`${path}.cmp`, `unbekannter Operator „${op}" (erlaubt: ${CMP_OPS.join(" ")})`);
      if (typeof o.value !== "number") fail(`${path}.value`, "Zahl erwartet");
      const want = o.value;
      return (sim) => {
        const list = reader(sim);
        const n = pred ? list.filter(pred).length : list.length;
        return compareNum(n, op as Cmp, want);
      };
    }
    case "flag": {
      const segs = asNonEmptyStringArray(o.flag, `${path}.flag`);
      if (o.eq !== undefined) {
        const want = asScalar(o.eq, `${path}.eq`);
        return (sim) => readPath(sim, segs) === want;
      }
      return (sim) => Boolean(readPath(sim, segs));
    }
    case "includes": {
      const segs = asNonEmptyStringArray(o.includes, `${path}.includes`);
      const want = asScalar(o.value, `${path}.value`);
      return (sim) => { const v = readPath(sim, segs); return Array.isArray(v) && v.includes(want); };
    }
    default:
      return fail(path, `unbekannte Regel: ${kind}`);
  }
}

/**
 * Übersetzt eine deklarative `check`-Regel (aus der Quest-JSON) in ein
 * `(sim) => boolean`. Wirft `ContentValidationError` bei strukturell kaputten
 * Regeln oder unbekannten Sammlungen (referenzielle Bindung an den Sim-Zustand).
 * @param rule die rohe Regel (`unknown` aus JSON)
 * @param path menschenlesbarer Pfad für Fehlermeldungen
 */
export function compileCheck(rule: unknown, path: string): CompiledCheck {
  return compileRule(rule, path);
}

/** Die in Regeln adressierbaren Sammlungs-Namen (für Doku/Tests). */
export const CHECK_COLLECTIONS: readonly string[] = Object.keys(COLLECTIONS);

export { ContentValidationError };
