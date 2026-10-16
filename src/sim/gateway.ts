/* ===== Kubernia – Gateway API: GatewayClass und Gateway (sim/gateway.ts, #1664) =====
 * Die Domänentypen der Gruppe `gateway.networking.k8s.io/v1` und der **abgeleitete Status**. Der Status
 * (Accepted, Programmed, Adresse, Listener-Conditions) wird nie gespeichert, sondern bei jedem `get`,
 * `describe` und `-o yaml` aus Klasse, Gateway und Secrets berechnet; so kann er nicht veralten.
 *
 * Ein simulierter Controller (`SIM_GATEWAY_CONTROLLER`, passend zu `bitnami/envoy-gateway` in ./helm) nimmt
 * jede GatewayClass mit genau diesem `controllerName` sofort an; eine Klasse mit fremdem Controller bleibt
 * `Unknown` (Grenze `gateway-sofort` in docs/sim-treue/kubectl.json). Die Gateway-Adresse ist aus dem
 * Namen abgeleitet und liegt im TEST-NET-3 (`.20–.99`; `.10` gehört dem Ingress, ab `.100` den
 * ExternalName-Services).
 *
 * Phaser-frei (pure Domäne). Importiert nur `../core/rng`, nie ./state oder ./kubectl/* (state.ts importiert
 * die Typen von hier: ein Rückweg wäre ein Zyklus). */
import { hashStr } from "../core/rng";

export const GATEWAY_GROUP = "gateway.networking.k8s.io";
export const GATEWAY_API_VERSION = GATEWAY_GROUP + "/v1";
/** Der eine simulierte Controller (Envoy Gateway). */
export const SIM_GATEWAY_CONTROLLER = "gateway.envoyproxy.io/gatewayclass-controller";
/** Die Protokolle, die ein Zertifikat am Listener brauchen (CEL-Regel der echten API). */
export const TLS_PROTOCOLS: readonly string[] = ["HTTPS", "TLS"];
/** Die Protokolle, die keinen `tls`-Block tragen dürfen (CEL-Regel der echten API). */
export const NO_TLS_PROTOCOLS: readonly string[] = ["HTTP", "TCP", "UDP"];
/**
 * Die eine TLS-Regel (Mapper und Szenario-Validierung teilen sie): HTTPS/TLS braucht ein Zertifikat (`"fehlt"`),
 * HTTP/TCP/UDP darf keins tragen (`"verboten"`), ein eigenes Protokoll ist frei (`null`).
 */
export function tlsRuleViolation(protocol: string, hasTls: boolean): "fehlt" | "verboten" | null {
  if (hasTls) return NO_TLS_PROTOCOLS.includes(protocol) ? "verboten" : null;
  return TLS_PROTOCOLS.includes(protocol) ? "fehlt" : null;
}
/** Secret-Typ, den ein `certificateRef` verlangt. */
export const TLS_SECRET_TYPE = "kubernetes.io/tls";

/** Ein Listener eines Gateways. */
export interface GatewayListener {
  name: string;
  port: number;
  protocol: string;
  hostname?: string;
  tlsSecret?: string;
}

export interface GatewayClassRes {
  name: string;
  controllerName: string;
  description?: string;
  created?: number;
}

export interface GatewayRes {
  name: string;
  className: string;
  listeners: GatewayListener[];
  created?: number;
}

/** Felder, die `Scenario` übernimmt (alles optional). */
export interface GatewayScenarioFields {
  gatewayClasses?: GatewayClassRes[];
  gateways?: GatewayRes[];
  httpRoutes?: HttpRouteRes[];
}
/** Felder, die `ClusterState` übernimmt. */
export interface GatewayClusterFields {
  gatewayClasses: GatewayClassRes[];
  gateways: GatewayRes[];
  httpRoutes: HttpRouteRes[];
}
/** Felder, die `ApplyEffect` übernimmt (der Mapper setzt sie, `created` vergibt der Handler). */
export interface GatewayApplyFields {
  gatewayClass?: Omit<GatewayClassRes, "created">;
  gateway?: Omit<GatewayRes, "created">;
  httpRoute?: Omit<HttpRouteRes, "created">;
}

export type ConditionStatus = "True" | "False" | "Unknown";
export interface GatewayCondition {
  type: string;
  status: ConditionStatus;
  reason: string;
  message: string;
}

const cond = (type: string, status: ConditionStatus, reason: string, message: string): GatewayCondition => ({ type, status, reason, message });
const accepted = (message: string): GatewayCondition => cond("Accepted", "True", "Accepted", message);
const pendingAccepted = (message: string): GatewayCondition => cond("Accepted", "Unknown", "Pending", message);

/** Ob der simulierte Controller die Klasse annimmt. */
export function isClassAccepted(cls: GatewayClassRes): boolean {
  return cls.controllerName === SIM_GATEWAY_CONTROLLER;
}

export function gatewayClassConditions(cls: GatewayClassRes): GatewayCondition[] {
  return [isClassAccepted(cls) ? accepted("Valid GatewayClass") : pendingAccepted("Waiting for controller")];
}

/**
 * Die Adresse eines Gateways: stabil aus dem Namen, `203.0.113.20` bis `.99`. Bei mehreren Gateways können zwei
 * Namen dieselbe Adresse bekommen (80 Werte); der Simulator weist das nicht aus (Grenze `gateway-sofort`).
 * Routet künftig `curl`/`nslookup` über Gateway-Adressen, ist die Kollision neu zu entscheiden.
 */
export function gatewayAddress(name: string): string {
  return "203.0.113." + (20 + (hashStr(name) % 80));
}

/** Der Status eines Listeners (nur bei akzeptierter Klasse). */
export interface ListenerStatus { name: string; attachedRoutes: number; conditions: GatewayCondition[] }

export interface GatewayStatus {
  conditions: GatewayCondition[];
  /** Die zugewiesene Adresse; `null`, solange keine akzeptierte Klasse das Gateway trägt. */
  address: string | null;
  /** Listener-Status; `null`, solange keine akzeptierte Klasse das Gateway trägt. */
  listeners: ListenerStatus[] | null;
}

/** Was `gatewayStatus` aus dem Cluster braucht (`KubectlHost` erfüllt es strukturell). */
export interface GatewayStatusEnv {
  gatewayClasses: readonly GatewayClassRes[];
  secrets: readonly CertSecret[];
  httpRoutes: readonly HttpRouteRes[];
}

/** Ob die Klasse des Gateways existiert und der simulierte Controller sie angenommen hat. */
export function gatewayClassAccepted(gw: GatewayRes, classes: readonly GatewayClassRes[]): boolean {
  const cls = classes.find(c => c.name === gw.className);
  return cls !== undefined && isClassAccepted(cls);
}

/** Gateway-`Accepted` bei angenommener Klasse (wie Envoy Gateway): ungültige Listener stehen in `ListenersNotValid`. */
function acceptedByListeners(listeners: readonly ListenerStatus[]): GatewayCondition {
  const bad = listeners.filter(l => l.conditions.some(c => c.status === "False")).map(l => l.name).sort();
  if (bad.length === 0) return accepted("The Gateway has been scheduled by Envoy Gateway");
  const all = bad.length === listeners.length;
  return cond("Accepted", all ? "False" : "True", "ListenersNotValid", (all ? "No listeners are valid: " : "Listeners not valid: ") + bad.join(", "));
}

export function gatewayStatus(gw: GatewayRes, env: GatewayStatusEnv): GatewayStatus {
  if (!gatewayClassAccepted(gw, env.gatewayClasses)) {
    return {
      listeners: null,
      address: null,
      conditions: [
        pendingAccepted("Waiting for controller"),
        cond("Programmed", "Unknown", "Pending", "Waiting for controller"),
      ],
    };
  }
  const listeners = gw.listeners.map(l => ({
    name: l.name, attachedRoutes: attachedRoutes(gw, l, env.httpRoutes), conditions: listenerConditions(l, env.secrets),
  }));
  return {
    listeners,
    address: gatewayAddress(gw.name),
    conditions: [
      acceptedByListeners(listeners),
      cond("Programmed", "True", "Programmed", "Address assigned to the Gateway"),
    ],
  };
}

/** Das Secret, das ein Listener-Zertifikat liefern soll: nur Name und (optional) Typ zählen. */
export interface CertSecret { name: string; type?: string }

/** Braucht der Listener ein gültiges Zertifikat und hat es keins (Secret fehlt oder falscher Typ)? */
export function hasInvalidCertificateRef(l: GatewayListener, secrets: readonly CertSecret[]): boolean {
  if (!l.tlsSecret && !TLS_PROTOCOLS.includes(l.protocol)) return false;
  const secret = l.tlsSecret ? secrets.find(s => s.name === l.tlsSecret) : undefined;
  return !secret || (secret.type !== undefined && secret.type !== TLS_SECRET_TYPE);
}

export function listenerConditions(l: GatewayListener, secrets: readonly CertSecret[]): GatewayCondition[] {
  if (hasInvalidCertificateRef(l, secrets)) {
    return [
      cond("Programmed", "False", "Invalid", "Listener is invalid, see other Conditions for details."),
      cond("ResolvedRefs", "False", "InvalidCertificateRef", "Secret " + (l.tlsSecret ?? "<none>") + " does not exist or is not of type " + TLS_SECRET_TYPE + "."),
    ];
  }
  return [
    cond("Programmed", "True", "Programmed", "Successfully programmed"),
    cond("ResolvedRefs", "True", "ResolvedRefs", "Listeners' references are resolved"),
  ];
}

/** Die Protokolle, an die sich eine HTTPRoute hängen kann. */
export const ROUTE_PROTOCOLS: readonly string[] = ["HTTP", "HTTPS"];

export type HttpPathType = "PathPrefix" | "Exact";
export interface HttpBackendRef { service: string; port: number }
export interface HttpRouteRule {
  path: string;
  pathType: HttpPathType;
  backends: HttpBackendRef[];
}
/** Eine HTTPRoute: Gateways im selben Namespace (`parentRefs`), Hostnamen und Regeln (ein Match je Regel). */
export interface HttpRouteRes {
  name: string;
  parentRefs: string[];
  hostnames: string[];
  rules: HttpRouteRule[];
  created?: number;
}

/** Passen zwei Hostnamen zusammen? Ein Wildcard `*.x` deckt jedes Suffix `.x` ab (nicht `x` selbst), in beide Richtungen. */
function hostMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith("*.") && b.endsWith(a.slice(1))) return true;
  return b.startsWith("*.") && a.endsWith(b.slice(1));
}

/** Schneiden sich Listener-Hostname und Route-Hostnamen? Ein fehlender Hostname (Listener oder Route) passt auf alles. */
export function hostnamesIntersect(listenerHost: string | undefined, routeHosts: readonly string[]): boolean {
  if (!listenerHost || routeHosts.length === 0) return true;
  return routeHosts.some(h => hostMatches(listenerHost, h));
}

/** Wie viele Routen am Listener hängen: Routen, deren parentRefs das Gateway nennen, nur bei HTTP-/HTTPS-Listenern. */
export function attachedRoutes(gw: GatewayRes, listener: GatewayListener, routes: readonly HttpRouteRes[]): number {
  if (!ROUTE_PROTOCOLS.includes(listener.protocol)) return 0;
  return routes.filter(r => r.parentRefs.includes(gw.name)).length;
}

export interface RouteParentStatus {
  gateway: string;
  controllerName: string;
  conditions: GatewayCondition[];
}
/** Ein parentRef, der keinen Status bekommt: das Gateway fehlt oder seine Klasse ist nicht angenommen. */
export interface UnattachedParent { gateway: string; reason: "NotFound" | "NoController" }
export interface HttpRouteStatus {
  parents: RouteParentStatus[];
  unattached: UnattachedParent[];
}

function acceptedForGateway(gw: GatewayRes, route: HttpRouteRes): GatewayCondition {
  const matching = gw.listeners.filter(l => ROUTE_PROTOCOLS.includes(l.protocol));
  if (matching.length === 0) {
    return cond("Accepted", "False", "NotAllowedByListeners", "No listener of Gateway " + gw.name + " accepts HTTP routes (HTTP or HTTPS).");
  }
  if (!matching.some(l => hostnamesIntersect(l.hostname, route.hostnames))) {
    return cond("Accepted", "False", "NoMatchingListenerHostname", "No listener hostname of Gateway " + gw.name + " matches the hostnames of the route.");
  }
  return cond("Accepted", "True", "Accepted", "Route is accepted");
}

function resolvedRefs(route: HttpRouteRes, services: readonly { name: string }[]): GatewayCondition {
  for (const [ri, rule] of route.rules.entries()) {
    for (const [bi, b] of rule.backends.entries()) {
      if (!services.some(s => s.name === b.service)) {
        return cond("ResolvedRefs", "False", "BackendNotFound", "Service " + b.service + " not found (rule " + (ri + 1) + ", backendRef " + (bi + 1) + ")");
      }
    }
  }
  return cond("ResolvedRefs", "True", "ResolvedRefs", "Resolved all the Object references for the Route");
}

/** Der abgeleitete Status einer HTTPRoute je parentRef (nie gespeichert). */
export function httpRouteStatus(
  route: HttpRouteRes, gateways: readonly GatewayRes[], classes: readonly GatewayClassRes[], services: readonly { name: string }[],
): HttpRouteStatus {
  const parents: RouteParentStatus[] = [];
  const unattached: UnattachedParent[] = [];
  for (const ref of route.parentRefs) {
    const gw = gateways.find(g => g.name === ref);
    if (!gw) { unattached.push({ gateway: ref, reason: "NotFound" }); continue; }
    if (!gatewayClassAccepted(gw, classes)) { unattached.push({ gateway: ref, reason: "NoController" }); continue; }
    parents.push({ gateway: ref, controllerName: SIM_GATEWAY_CONTROLLER, conditions: [acceptedForGateway(gw, route), resolvedRefs(route, services)] });
  }
  return { parents, unattached };
}
