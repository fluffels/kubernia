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
}
/** Felder, die `ClusterState` übernimmt. */
export interface GatewayClusterFields {
  gatewayClasses: GatewayClassRes[];
  gateways: GatewayRes[];
}
/** Felder, die `ApplyEffect` übernimmt (der Mapper setzt sie, `created` vergibt der Handler). */
export interface GatewayApplyFields {
  gatewayClass?: Omit<GatewayClassRes, "created">;
  gateway?: Omit<GatewayRes, "created">;
}

export type ConditionStatus = "True" | "False" | "Unknown";
export interface GatewayCondition {
  type: string;
  status: ConditionStatus;
  reason: string;
  message: string;
}

const accepted = (message: string): GatewayCondition => ({ type: "Accepted", status: "True", reason: "Accepted", message });
const pendingAccepted = (message: string): GatewayCondition => ({ type: "Accepted", status: "Unknown", reason: "Pending", message });

/** Ob der simulierte Controller die Klasse annimmt. */
export function isClassAccepted(cls: GatewayClassRes): boolean {
  return cls.controllerName === SIM_GATEWAY_CONTROLLER;
}

export function gatewayClassConditions(cls: GatewayClassRes): GatewayCondition[] {
  return [isClassAccepted(cls) ? accepted("Valid GatewayClass") : pendingAccepted("Waiting for controller")];
}

/** Die Adresse eines Gateways: stabil aus dem Namen, `203.0.113.20` bis `.99`. */
export function gatewayAddress(name: string): string {
  return "203.0.113." + (20 + (hashStr(name) % 80));
}

export interface GatewayStatus {
  conditions: GatewayCondition[];
  /** Die zugewiesene Adresse; `null`, solange keine akzeptierte Klasse das Gateway trägt. */
  address: string | null;
  /** Ob die Klasse existiert und angenommen ist (der Rest hängt daran). */
  classAccepted: boolean;
}

export function gatewayStatus(gw: GatewayRes, classes: readonly GatewayClassRes[]): GatewayStatus {
  const cls = classes.find(c => c.name === gw.className);
  if (!cls || !isClassAccepted(cls)) {
    return {
      classAccepted: false,
      address: null,
      conditions: [
        pendingAccepted("Waiting for controller"),
        { type: "Programmed", status: "Unknown", reason: "Pending", message: "Waiting for controller" },
      ],
    };
  }
  return {
    classAccepted: true,
    address: gatewayAddress(gw.name),
    conditions: [
      accepted("The Gateway has been scheduled by Envoy Gateway"),
      { type: "Programmed", status: "True", reason: "Programmed", message: "Address assigned to the Gateway" },
    ],
  };
}

/** Das Secret, das ein Listener-Zertifikat liefern soll: nur Name und (optional) Typ zählen. */
export interface CertSecret { name: string; type?: string }

/** Braucht der Listener ein gültiges Zertifikat und hat es keins (Secret fehlt oder falscher Typ)? */
export function hasInvalidCertificateRef(l: GatewayListener, secrets: readonly CertSecret[]): boolean {
  if (!TLS_PROTOCOLS.includes(l.protocol)) return false;
  const secret = l.tlsSecret ? secrets.find(s => s.name === l.tlsSecret) : undefined;
  return !secret || (secret.type !== undefined && secret.type !== TLS_SECRET_TYPE);
}

export function listenerConditions(l: GatewayListener, secrets: readonly CertSecret[]): GatewayCondition[] {
  if (hasInvalidCertificateRef(l, secrets)) {
    return [
      { type: "Programmed", status: "False", reason: "Invalid", message: "Listener is invalid, see other Conditions for details." },
      { type: "ResolvedRefs", status: "False", reason: "InvalidCertificateRef", message: "Secret " + (l.tlsSecret ?? "<none>") + " does not exist or is not of type " + TLS_SECRET_TYPE + "." },
    ];
  }
  return [
    { type: "Programmed", status: "True", reason: "Programmed", message: "Successfully programmed" },
    { type: "ResolvedRefs", status: "True", reason: "ResolvedRefs", message: "Listeners' references are resolved" },
  ];
}
