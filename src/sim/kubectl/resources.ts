/* ===== Kubernia – Ressourcentyp-Registry von kubectl (sim/kubectl/resources.ts, #1444) =====
 * Die EINE Quelle, welche Ressourcentypen `kubectl` kennt: Plural, Singular, die ECHTEN Kurznamen
 * (SHORTNAMES aus `kubectl api-resources` bzw. den CRD-Manifesten), API-Gruppe, Namespace-Bindung und
 * die Kategorie `all`. get, describe, delete, top, scale/expose und label lösen Tokens darüber auf,
 * statt je eine eigene Alias-Liste zu pflegen (die Listen waren fünffach kopiert und drifteten:
 * erfundene Kürzel wie `rb`, `netpols`). Ein neuer Ressourcentyp = ein Eintrag hier.
 *
 * Blattmodul der kubectl-Mappe (pure Domäne): importiert nichts. */

export interface ResourceKind {
  /** Kleingeschriebener Plural, zugleich der Schlüssel des Typs. */
  readonly plural: string;
  readonly singular: string;
  /** Nur echte kubectl-Kurznamen. Kein Kurzname → leer (z.B. `secrets`, `roles`). */
  readonly short: readonly string[];
  /** API-Gruppe; leer = Core-Gruppe. */
  readonly group: string;
  /** Spalte NAMESPACED von `kubectl api-resources`. */
  readonly namespaced: boolean;
  /** Gehört zur Kategorie `all` (`kubectl get all`). */
  readonly inAll: boolean;
  /** Pseudoressource der Sim (`alerts`), gibt es in echtem kubectl nicht. */
  readonly pseudo?: boolean;
}

function kind(plural: string, singular: string, short: readonly string[], group: string, namespaced: boolean, inAll = false, pseudo = false): ResourceKind {
  return { plural, singular, short, group, namespaced, inAll, ...(pseudo ? { pseudo } : {}) };
}

const RBAC = "rbac.authorization.k8s.io";
const NETWORKING = "networking.k8s.io";
const MONITORING = "monitoring.coreos.com";
const GRAFANA = "grafana.integreatly.org";

/** Reihenfolge = Reihenfolge der Blöcke bei `get all` und bei `get a,b`. */
export const RESOURCE_KINDS: readonly ResourceKind[] = [
  kind("pods", "pod", ["po"], "", true, true),
  kind("services", "service", ["svc"], "", true, true),
  kind("deployments", "deployment", ["deploy"], "apps", true, true),
  kind("replicasets", "replicaset", ["rs"], "apps", true, true),
  kind("statefulsets", "statefulset", ["sts"], "apps", true, true),
  kind("endpoints", "endpoint", ["ep"], "", true),
  kind("nodes", "node", ["no"], "", false),
  kind("namespaces", "namespace", ["ns"], "", false),
  kind("secrets", "secret", [], "", true),
  kind("configmaps", "configmap", ["cm"], "", true),
  kind("ingresses", "ingress", ["ing"], NETWORKING, true),
  kind("networkpolicies", "networkpolicy", ["netpol"], NETWORKING, true),
  kind("servicemonitors", "servicemonitor", ["smon"], MONITORING, true),
  kind("prometheusrules", "prometheusrule", ["promrule"], MONITORING, true),
  // Die Grafana-CRDs tragen `categories: [all]` und haben keinen Kurznamen.
  kind("grafanadatasources", "grafanadatasource", [], GRAFANA, true, true),
  kind("grafanadashboards", "grafanadashboard", [], GRAFANA, true, true),
  kind("persistentvolumeclaims", "persistentvolumeclaim", ["pvc"], "", true),
  kind("persistentvolumes", "persistentvolume", ["pv"], "", false),
  kind("storageclasses", "storageclass", ["sc"], "storage.k8s.io", false),
  kind("volumesnapshots", "volumesnapshot", ["vs"], "snapshot.storage.k8s.io", true),
  kind("serviceaccounts", "serviceaccount", ["sa"], "", true),
  kind("roles", "role", [], RBAC, true),
  kind("clusterroles", "clusterrole", [], RBAC, false),
  kind("rolebindings", "rolebinding", [], RBAC, true),
  kind("clusterrolebindings", "clusterrolebinding", [], RBAC, false),
  kind("alerts", "alert", [], "", false, false, true),
];

const BY_TOKEN: ReadonlyMap<string, ResourceKind> = (() => {
  const m = new Map<string, ResourceKind>();
  for (const k of RESOURCE_KINDS) for (const n of [k.plural, k.singular, ...k.short]) m.set(n, k);
  return m;
})();

/** Ein Token (`pods`, `Po`, `deployment.apps`) zum Ressourcentyp, `null` bei unbekanntem Namen.
 *  Groß-/Kleinschreibung egal; die gruppenqualifizierte Form (`<name>.<gruppe>`) gilt nur mit der
 *  echten Gruppe des Typs. */
export function resolveKind(token: string): ResourceKind | null {
  const tok = token.toLowerCase();
  const direct = BY_TOKEN.get(tok);
  if (direct) return direct;
  const dot = tok.indexOf(".");
  if (dot < 0) return null;
  const k = BY_TOKEN.get(tok.slice(0, dot));
  return k && k.group !== "" && tok.slice(dot + 1) === k.group ? k : null;
}

/** Name mit Gruppe, wie kubectl ihn in Meldungen zeigt: `deployments.apps`, `pods`. */
export function qualified(k: ResourceKind, form: "plural" | "singular"): string {
  const base = form === "plural" ? k.plural : k.singular;
  return k.group ? base + "." + k.group : base;
}

/** Alle Typen der Kategorie `all`, in Anzeigereihenfolge. */
export function allKinds(): readonly ResourceKind[] {
  return RESOURCE_KINDS.filter(k => k.inAll);
}
