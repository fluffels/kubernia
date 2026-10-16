/* ===== Kubernia – kubectl apply für GatewayClass und Gateway (sim/kubectl/apply-gateway.ts, #1664) =====
 * Die apply-Handler für `kind: GatewayClass` und `kind: Gateway` (Gruppe `gateway.networking.k8s.io`):
 * neu anlegen (`created`), ein bestehendes Objekt abgleichen (`configured`, wenn sich ein Feld
 * geändert hat, sonst `unchanged`). Der Datei-Inhalt ist die Wahrheit (Mapper ../manifest/gateway), der Status
 * ist abgeleitet (../gateway) und wird hier nie geschrieben.
 *
 * Wie in der echten API ist `spec.controllerName` einer vorhandenen GatewayClass unveränderlich; ein Gateway
 * auf eine (noch) unbekannte Klasse wird trotzdem angelegt und bleibt `Unknown`.
 *
 * Phaser-frei (pure Domäne). Aufgerufen aus ./lifecycle (apply-Handler-Registry). */
import type { ApplyEffect } from "../state";
import { GATEWAY_GROUP, type GatewayListener, type HttpRouteRes } from "../gateway";
import type { KubectlHost } from "./host";

const classLine = (name: string, verb: string): string => "gatewayclass." + GATEWAY_GROUP + "/" + name + " " + verb;
const gatewayLine = (name: string, verb: string): string => "gateway." + GATEWAY_GROUP + "/" + name + " " + verb;

const routeLine = (name: string, verb: string): string => "httproute." + GATEWAY_GROUP + "/" + name + " " + verb;

/** Die Route in fester Feldform (ohne `created`), damit der Vergleich nicht an der Schlüssel-Reihenfolge hängt. */
const normalizedRoute = (r: Omit<HttpRouteRes, "created">): string => JSON.stringify({
  parentRefs: r.parentRefs, hostnames: r.hostnames,
  rules: r.rules.map(x => ({ path: x.path, pathType: x.pathType, backends: x.backends.map(b => ({ service: b.service, port: b.port })) })),
});

/** Ein Listener in fester Feldform, damit der Vergleich nicht an der Schlüssel-Reihenfolge hängt. */
function normalized(l: GatewayListener): GatewayListener {
  return {
    name: l.name, port: l.port, protocol: l.protocol,
    ...(l.hostname !== undefined && { hostname: l.hostname }),
    ...(l.tlsSecret !== undefined && { tlsSecret: l.tlsSecret }),
  };
}

const sameListeners = (a: readonly GatewayListener[], b: readonly GatewayListener[]): boolean =>
  JSON.stringify(a.map(normalized)) === JSON.stringify(b.map(normalized));

export function applyGatewayClass(host: KubectlHost, eff: ApplyEffect, out: string[]): string | void {
  const effCls = eff.gatewayClass;
  if (!effCls) return;
  const existing = host.gatewayClasses.find(c => c.name === effCls.name);
  if (!existing) {
    host.gatewayClasses.push({
      name: effCls.name, controllerName: effCls.controllerName,
      ...(effCls.description !== undefined && { description: effCls.description }),
      created: host.clock,
    });
    out.push(classLine(effCls.name, "created"));
    return;
  }
  if (existing.controllerName !== effCls.controllerName) {
    return host._err('The GatewayClass "' + effCls.name + '" is invalid: spec.controllerName: Invalid value: "' + effCls.controllerName + '": Value is immutable',
      "Der controllerName einer GatewayClass lässt sich nicht ändern. Lösche die Klasse mit 'kubectl delete gatewayclass " + effCls.name + "' und lege sie neu an.");
  }
  if (existing.description === effCls.description) {
    out.push(classLine(effCls.name, "unchanged"));
    return;
  }
  if (effCls.description === undefined) delete existing.description;
  else existing.description = effCls.description;
  out.push(classLine(effCls.name, "configured"));
}

export function applyGateway(host: KubectlHost, eff: ApplyEffect, out: string[]): string | void {
  const effGw = eff.gateway;
  if (!effGw) return;
  const listeners = effGw.listeners.map(normalized);
  const existing = host.gateways.find(g => g.name === effGw.name);
  if (!existing) {
    host.gateways.push({ name: effGw.name, className: effGw.className, listeners, created: host.clock });
    out.push(gatewayLine(effGw.name, "created"));
    return;
  }
  if (existing.className === effGw.className && sameListeners(existing.listeners, listeners)) {
    out.push(gatewayLine(effGw.name, "unchanged"));
    return;
  }
  existing.className = effGw.className;
  existing.listeners = listeners;
  out.push(gatewayLine(effGw.name, "configured"));
}

export function applyHttpRoute(host: KubectlHost, eff: ApplyEffect, out: string[]): string | void {
  const effRoute = eff.httpRoute;
  if (!effRoute) return;
  const copyRules = (rules: HttpRouteRes["rules"]): HttpRouteRes["rules"] => rules.map(r => ({ ...r, backends: r.backends.map(b => ({ ...b })) }));
  const existing = host.httpRoutes.find(r => r.name === effRoute.name);
  if (!existing) {
    host.httpRoutes.push({
      name: effRoute.name, parentRefs: [...effRoute.parentRefs], hostnames: [...effRoute.hostnames],
      rules: copyRules(effRoute.rules), created: host.clock,
    });
    out.push(routeLine(effRoute.name, "created"));
    return;
  }
  if (normalizedRoute(existing) === normalizedRoute(effRoute)) {
    out.push(routeLine(effRoute.name, "unchanged"));
    return;
  }
  // Nur zuweisen, nie in place ändern: der Szenario-Klon ist flach.
  existing.parentRefs = [...effRoute.parentRefs];
  existing.hostnames = [...effRoute.hostnames];
  existing.rules = copyRules(effRoute.rules);
  out.push(routeLine(effRoute.name, "configured"));
}
