/* ===== Kubernia – kubectl: der EINE Ziel-Leser (sim/kubectl/targets.ts, #1488) =====
 * Zerlegt die Ziele eines Befehls (`pods`, `pods web db`, `pod/a svc/b`, `pods,svc web`, `all`) in Arten mit
 * Namen – für get, describe, delete, scale und rollout restart. Er folgt dem Builder von kubectl
 * (cli-runtime `resource/builder.go`) in dieser Reihenfolge:
 *   1. `normalizeMultipleResourcesArgs`: zerfällt das erste Argument per Komma in mehr als eine Art
 *      (`pods,svc web`), wird daraus das Kreuzprodukt `pods/web svc/web`;
 *   2. `hasCombinedTypeArgs`: tragen nur einige der Argumente einen Slash (`pod pod/a`, `pod/a b`), ist das ein Fehler;
 *   3. tragen alle einen Slash, sind es `typ/name`-Paare (auch gemischte Arten, je Art gruppiert);
 *   4. sonst ist das erste Argument die Art (oder die Kategorie `all`), der Rest sind Namen.
 * Mehrere Namen bei mehreren Arten (`get all web`) lehnt der Builder mit `you must specify only one resource` ab.
 *
 * Blattmodul der kubectl-Mappe (pure Domäne): importiert nur ./resources, ./args und den Typ aus ../cliargs – nie get,
 * inspect, describe, lifecycle oder ops (sonst Zyklus, check:arch). */
import type { ErrHost } from "../cliargs";
import { allKinds, resolveKind, type ResourceKind } from "./resources";
import { SLASH_SINGLE_ERROR, slashRef, unknownResourceType } from "./args";

/** Ein Ziel: eine Art mit den (möglicherweise leeren = alle) gewünschten Namen. */
export interface Target { kind: ResourceKind; names: string[] }


export const NO_TYPE_NEEDED_ERROR = "error: there is no need to specify a resource type as a separate argument when passing arguments in resource/name form (e.g. 'kubectl get resource/<resource_name>' instead of 'kubectl get resource resource/<resource_name>'";
const ONLY_ONE_ERROR = "error: you must specify only one resource";

/** Die Arten einer Komma-Liste (`pods,svc`, `all`), ohne Doppelte und leere Einträge, in Eingabereihenfolge. */
function expandTypes(host: ErrHost, list: string): ResourceKind[] | string {
  const out: ResourceKind[] = [];
  for (const tok of list.split(",").filter(s => s !== "")) {
    const kinds = tok.toLowerCase() === "all" ? allKinds() : [resolveKind(tok)];
    for (const k of kinds) {
      if (!k) return unknownResourceType(host, tok);
      if (!out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** Schritt 1: `pods,svc web db` → `pods/web pods/db svc/web svc/db` (Doppelte und leere Arten fallen weg). */
function crossProduct(args: readonly string[]): readonly string[] {
  if (args.length < 2) return args;
  const seen = new Set<ResourceKind | string>();   // Kurzname und Plural derselben Art zählen einmal
  const types = args[0].split(",").filter(s => {
    const key = s === "" ? null : resolveKind(s) ?? s;
    return key !== null && !seen.has(key) && !!seen.add(key);
  });
  return types.length > 1 ? types.flatMap(typ => args.slice(1).map(name => typ + "/" + name)) : args;
}

/** Schritt 3: die Slash-Form `typ/name …` (auch gemischte Arten), je Art gruppiert. */
function readPairs(host: ErrHost, args: readonly string[]): { targets: Target[] } | { error: string } {
  const targets: Target[] = [];
  for (const tok of args) {
    const ref = slashRef(tok) ?? { error: SLASH_SINGLE_ERROR }; // jedes Token trägt hier einen Slash
    if ("error" in ref) return { error: host._err(ref.error) };
    const kind = resolveKind(ref.typ);
    if (!kind) return { error: unknownResourceType(host, ref.typ) };
    const existing = targets.find(r => r.kind === kind);
    if (existing) existing.names.push(ref.name); else targets.push({ kind, names: [ref.name] });
  }
  return { targets };
}

/** Die Ziele eines Befehls (`c.args`): leere Eingabe ergibt `{ targets: [] }`, sonst die Arten mit Namen oder der
 *  fertige Fehlertext (über `host._err`). */
export function readTargets(host: ErrHost, args: readonly string[]): { targets: Target[] } | { error: string } {
  if (args.length === 0) return { targets: [] };
  const norm = crossProduct(args);
  const slashes = norm.filter(a => a.includes("/")).length;
  if (slashes > 0 && slashes < norm.length) return { error: host._err(NO_TYPE_NEEDED_ERROR) };
  if (slashes > 0) return readPairs(host, norm);
  const kinds = expandTypes(host, norm[0]);
  if (typeof kinds === "string") return { error: kinds };
  const names = norm.slice(1);
  if (names.length > 0 && kinds.length > 1) return { error: host._err(ONLY_ONE_ERROR) };
  return { targets: kinds.map(kind => ({ kind, names: [...names] })) };
}

/** Das Ergebnis eines Befehls mit mehreren Zielen (kubectl `ContinueOnError`): erst alle Erfolgszeilen, dann die
 *  Fehlerzeilen. Gibt es Fehler, ist die Ausgabe ein Fehler (`host._err`, mit dem Tipp, falls einer da ist), sonst reiner Text. */
export function targetOutcome(host: ErrHost, ok: readonly string[], failed: readonly string[], tip?: string): string {
  const text = [...ok, ...failed].join("\n");
  return failed.length > 0 ? host._err(text, tip) : text;
}
