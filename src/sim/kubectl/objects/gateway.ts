/* ===== Kubernia – YAML-Bausteine der Gruppe gateway.networking.k8s.io/v1 (sim/kubectl/objects/gateway.ts, #1664) =====
 * Die Objekte für `kubectl get gatewayclass|gateway|httproute -o yaml`. Gespiegelt wird das Mapper-Paar in
 * ../../manifest/gateway.ts: was der Mapper aus einem Manifest liest, schreibt dieser Baustein wieder hin
 * (Round-Trip-Test `apply -f` → `get -o yaml` → `effectsFromManifest`).
 *
 * Der Status ist die Teilmenge, die `get` und `describe` schon zeigen (Conditions, Adresse, Listener-Conditions
 * erst bei akzeptierter Klasse); Grenze `yaml-gekuerzt`. Alle Werte stammen aus den puren Funktionen in ../../gateway.
 *
 * Phaser-frei (pure Domäne); importiert nie ./get-yaml oder ../get (kein Zyklus). */
import type { YamlMap } from "../../yaml-emit";
import {
  GATEWAY_API_VERSION, GATEWAY_GROUP, gatewayClassConditions, gatewayStatus, httpRouteStatus,
  type GatewayClassRes, type GatewayCondition, type GatewayListener, type GatewayRes, type HttpRouteRes, type HttpRouteRule,
} from "../../gateway";
import { servicesWithDefault } from "../../endpoints";
import type { KubectlHost } from "../host";
import { compact, metaOf, type ObjectsOf } from "./core";

const conditionObject = (c: GatewayCondition): YamlMap => ({ message: c.message, reason: c.reason, status: c.status, type: c.type });

function gatewayClassObject(cls: GatewayClassRes): YamlMap {
  return {
    apiVersion: GATEWAY_API_VERSION, kind: "GatewayClass",
    // Cluster-weit: kein Namespace in den Metadaten.
    metadata: { name: cls.name },
    spec: compact({ controllerName: cls.controllerName, description: cls.description }),
    status: { conditions: gatewayClassConditions(cls).map(conditionObject) },
  };
}

function listenerObject(l: GatewayListener): YamlMap {
  return compact({
    hostname: l.hostname,
    name: l.name,
    port: l.port,
    protocol: l.protocol,
    tls: l.tlsSecret === undefined ? undefined : { certificateRefs: [{ kind: "Secret", name: l.tlsSecret }], mode: "Terminate" },
  });
}

function gatewayObject(host: KubectlHost, gw: GatewayRes): YamlMap {
  const st = gatewayStatus(gw, host);
  return {
    apiVersion: GATEWAY_API_VERSION, kind: "Gateway", metadata: metaOf(gw.name),
    spec: { gatewayClassName: gw.className, listeners: gw.listeners.map(listenerObject) },
    status: compact({
      addresses: st.address === null ? undefined : [{ type: "IPAddress", value: st.address }],
      conditions: st.conditions.map(conditionObject),
      listeners: st.listeners?.map(l => ({ attachedRoutes: l.attachedRoutes, conditions: l.conditions.map(conditionObject), name: l.name })),
    }),
  };
}

function ruleObject(r: HttpRouteRule): YamlMap {
  return {
    backendRefs: r.backends.map(b => ({ group: "", kind: "Service", name: b.service, port: b.port, weight: 1 })),
    matches: [{ path: { type: r.pathType, value: r.path } }],
  };
}

function httpRouteObject(host: KubectlHost, route: HttpRouteRes): YamlMap {
  const st = httpRouteStatus(route, host.gateways, host.gatewayClasses, servicesWithDefault(host));
  return {
    apiVersion: GATEWAY_API_VERSION, kind: "HTTPRoute", metadata: metaOf(route.name),
    spec: compact({
      hostnames: route.hostnames.length ? route.hostnames : undefined,
      parentRefs: route.parentRefs.length ? route.parentRefs.map(n => ({ group: GATEWAY_GROUP, kind: "Gateway", name: n })) : undefined,
      rules: route.rules.map(ruleObject),
    }),
    status: { parents: st.parents.map(p => ({
      conditions: p.conditions.map(conditionObject), controllerName: p.controllerName,
      parentRef: { group: GATEWAY_GROUP, kind: "Gateway", name: p.gateway },
    })) },
  };
}

export const gatewayClassObjects: ObjectsOf = host => new Map(host.gatewayClasses.map(c => [c.name, gatewayClassObject(c)]));
export const gatewayObjects: ObjectsOf = host => new Map(host.gateways.map(g => [g.name, gatewayObject(host, g)]));
export const httpRouteObjects: ObjectsOf = host => new Map(host.httpRoutes.map(r => [r.name, httpRouteObject(host, r)]));
