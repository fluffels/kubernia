/* ===== Kubernia – Ressourcentyp-Registry von kubectl (sim/kubectl/resources.ts, #1444) =====
 * Die EINE Quelle, welche Ressourcentypen `kubectl` kennt: Plural, Singular, die ECHTEN Kurznamen
 * (SHORTNAMES aus `kubectl api-resources` bzw. den CRD-Manifesten), API-Gruppe, Namespace-Bindung und
 * die Kategorie `all`. get, describe, delete, top, scale/expose und label lösen Tokens darüber auf,
 * statt je eine eigene Alias-Liste zu pflegen (die Listen waren fünffach kopiert und drifteten:
 * erfundene Kürzel wie `rb`, `netpols`). Ein neuer Ressourcentyp = ein Eintrag hier.
 *
 * Blattmodul der kubectl-Mappe (pure Domäne): importiert nichts. */

/** Die Felder eines Ressourcentyps; `P` ist der Plural als Literal (so leitet sich `ResourcePlural` aus der Registry ab). */
interface KindOf<P extends string> {
  /** Kleingeschriebener Plural, zugleich der Schlüssel des Typs. */
  readonly plural: P;
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
  /** Abkündigung, die der API-Server als `Warning:`-Zeile vor die Antwort setzt (nur der Text). Ausgewertet nur von `kubectl get` (`serverWarnings`); weitere Befehle, die die Art unterstützen, müssen sie ebenfalls vorn anhängen. */
  readonly deprecationWarning?: string;
}

function kind<P extends string>(plural: P, singular: string, short: readonly string[], group: string, namespaced: boolean, inAll = false, pseudo = false): KindOf<P> {
  return { plural, singular, short, group, namespaced, inAll, ...(pseudo ? { pseudo } : {}) };
}

const RBAC = "rbac.authorization.k8s.io";
const NETWORKING = "networking.k8s.io";
const MONITORING = "monitoring.coreos.com";
const GRAFANA = "grafana.integreatly.org";

/** Reihenfolge = Reihenfolge der Blöcke bei `get all` und bei `get a,b`. */
const KINDS = [
  kind("pods", "pod", ["po"], "", true, true),
  kind("services", "service", ["svc"], "", true, true),
  kind("deployments", "deployment", ["deploy"], "apps", true, true),
  kind("replicasets", "replicaset", ["rs"], "apps", true, true),
  kind("statefulsets", "statefulset", ["sts"], "apps", true, true),
  // KEP-4974: ab v1.33 warnt der API-Server bei jeder Anfrage auf v1 Endpoints (die Sim simuliert >= v1.33, ./nodes).
  { ...kind("endpoints", "endpoint", ["ep"], "", true), deprecationWarning: "v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice" },
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

/** Die Plurale der Registry als Literal-Union: Tabellen, die nach Typ schlüsseln (Renderer, Löschen), tippen
 *  ihre Schlüssel damit – ein Tippfehler im Plural ist ein Typfehler statt eines stillen Nichttreffers. */
export type ResourcePlural = typeof KINDS[number]["plural"];
export type ResourceKind = KindOf<ResourcePlural>;
export const RESOURCE_KINDS: readonly ResourceKind[] = KINDS;

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

/** Die `Warning:`-Zeilen, die der API-Server vor die Antwort auf eine Anfrage dieser Typen setzt (ohne Doppelte). */
export function serverWarnings(kinds: readonly ResourceKind[]): string[] {
  const texts = kinds.flatMap(k => (k.deprecationWarning ? [k.deprecationWarning] : []));
  return [...new Set(texts)].map(t => "Warning: " + t);
}
