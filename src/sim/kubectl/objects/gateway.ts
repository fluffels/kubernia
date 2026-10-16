/* ===== Kubernia – YAML-Bausteine der Gruppe gateway.networking.k8s.io/v1 (sim/kubectl/objects/gateway.ts, #1664) =====
 * Die Objekte für `kubectl get gatewayclass|gateway -o yaml`. Gespiegelt wird das Mapper-Paar in
 * ../../manifest/gateway.ts: was der Mapper aus einem Manifest liest, schreibt dieser Baustein wieder hin
 * (Round-Trip-Test `apply -f` → `get -o yaml` → `effectsFromManifest`).
 *
 * Der Status ist die Teilmenge, die `get` und `describe` schon zeigen (Conditions, Adresse, Listener-Conditions
 * erst bei akzeptierter Klasse); Grenze `yaml-gekuerzt`. Alle Werte stammen aus den puren Funktionen in ../../gateway.
 *
 * Phaser-frei (pure Domäne); importiert nie ./get-yaml oder ../get (kein Zyklus). */
import type { YamlMap } from "../../yaml-emit";
import {
  GATEWAY_API_VERSION, gatewayClassConditions, gatewayStatus, listenerConditions,
  type GatewayClassRes, type GatewayCondition, type GatewayListener, type GatewayRes,
} from "../../gateway";
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
  const st = gatewayStatus(gw, host.gatewayClasses);
  return {
    apiVersion: GATEWAY_API_VERSION, kind: "Gateway", metadata: metaOf(gw.name),
    spec: { gatewayClassName: gw.className, listeners: gw.listeners.map(listenerObject) },
    status: compact({
      addresses: st.address === null ? undefined : [{ type: "IPAddress", value: st.address }],
      conditions: st.conditions.map(conditionObject),
      listeners: st.classAccepted
        ? gw.listeners.map(l => ({ conditions: listenerConditions(l, host.secrets).map(conditionObject), name: l.name }))
        : undefined,
    }),
  };
}

export const gatewayClassObjects: ObjectsOf = host => new Map(host.gatewayClasses.map(c => [c.name, gatewayClassObject(c)]));
export const gatewayObjects: ObjectsOf = host => new Map(host.gateways.map(g => [g.name, gatewayObject(host, g)]));
