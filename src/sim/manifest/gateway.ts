/* ===== Kubernia – Manifest-Mapper für `gateway.networking.k8s.io/v1` (sim/manifest/gateway.ts, #1664) =====
 * Übersetzt GatewayClass, Gateway und HTTPRoute (#1665: `parentRefs`, `hostnames`, je Regel ein `match` mit
 * `backendRefs`, Verweise nur im eigenen Namespace) in den `ApplyEffect`. Gelesen werden nur die Felder, die das Sim-Modell
 * kennt: `controllerName`, `description`, `gatewayClassName` und je Listener Name, Port, Protokoll,
 * `hostname` und das erste `tls.certificateRefs[].name`. Ein `status` im Manifest (z.B. aus `get -o yaml`)
 * wird ignoriert, der Status ist abgeleitet (../gateway).
 *
 * Die CEL-Regeln der echten API (Port 1–65535, HTTPS/TLS braucht `tls`, eindeutige Listener-Namen) lehnt der
 * Mapper mit dem Server-Wortlaut ab; ein Secret, das es nicht gibt, ist dagegen kein Apply-Fehler, sondern
 * eine Listener-Condition (`ResolvedRefs`, siehe ../gateway). */
import type { ApplyEffect } from "../state";
import { tlsRuleViolation, type GatewayListener, type HttpBackendRef, type HttpPathType, type HttpRouteRule } from "../gateway";
import { isResourceName, rfc1123ErrorText, RFC1123_TIP } from "../names";
import { Leaf, ManifestError } from "./fields";

const TLS_MODES = ["Terminate", "Passthrough"];

function nameOf(doc: Leaf, kind: string): string {
  const name = doc.key("metadata").key("name").reqStr();
  if (!isResourceName(name)) throw new ManifestError(rfc1123ErrorText(name, kind), RFC1123_TIP, true);
  return name;
}

export function mapGatewayClass(doc: Leaf): ApplyEffect {
  const name = nameOf(doc, "GatewayClass");
  const spec = doc.key("spec");
  const controllerName = spec.key("controllerName").reqStr();
  const description = spec.key("description").str();
  return { gatewayClass: { name, controllerName, ...(description !== undefined && { description }) } };
}

/** `tls.mode`: nur `Terminate` (Standard) wird abgebildet; ein unbekannter Wert wird wie vom Server abgelehnt. */
function checkTlsMode(tls: Leaf, gateway: string): void {
  const mode = tls.key("mode").str();
  if (mode !== undefined && !TLS_MODES.includes(mode)) {
    throw new ManifestError("The Gateway \"" + gateway + "\" is invalid: " + tls.path + ".mode: Unsupported value: \"" + mode + "\": supported values: "
      + TLS_MODES.map(m => "\"" + m + "\"").join(", "), "Gültige Modi: 'Terminate' (Standard) oder 'Passthrough'.", true);
  }
  if (mode === "Passthrough") {
    throw new ManifestError(tls.path + ".mode: Passthrough wird vom Simulator nicht abgebildet",
      "Nutze 'mode: Terminate' mit 'certificateRefs: [{name: <secret>}]'.", true);
  }
}

/** Die CEL-Regeln rund um `tls` (Server-Wortlaut) und das erste Zertifikat-Secret des Listeners. */
function tlsSecretOf(leaf: Leaf, protocol: string, gateway: string): string | undefined {
  const tls = leaf.key("tls");
  const invalid = (rest: string, tip: string): ManifestError =>
    new ManifestError("The Gateway \"" + gateway + "\" is invalid: " + leaf.path.replace(/\[\d+\]$/, "") + ": Invalid value: \"array\": " + rest, tip, true);
  const violation = tlsRuleViolation(protocol, tls.present);
  if (violation === "fehlt") {
    throw invalid("tls must be specified for protocols ['HTTPS', 'TLS']", "Ein HTTPS-Listener braucht 'tls: certificateRefs: [{name: <secret>}]'.");
  }
  if (violation === "verboten") {
    throw invalid("tls must not be specified for protocols ['HTTP', 'TCP', 'UDP']", "Nur HTTPS- und TLS-Listener tragen einen 'tls'-Block.");
  }
  if (!tls.present) return undefined;
  checkTlsMode(tls, gateway);
  const refs = tls.key("certificateRefs").items();
  if (refs.length === 0 && tls.key("options").present) {
    throw new ManifestError(tls.path + ".options: ohne certificateRefs wird vom Simulator nicht abgebildet",
      "Nutze 'certificateRefs: [{name: <secret>}]'; 'options' allein trägt kein Zertifikat.", true);
  }
  if (refs.length === 0) {
    throw invalid("certificateRefs or options must be specified when mode is Terminate", "Ein 'tls'-Block braucht 'certificateRefs: [{name: <secret>}]'.");
  }
  return refs[0].key("name").reqStr();
}

/** Ein Listener: Name, Port und Protokoll sind Pflicht; `tls` ist nur beim Zertifikat-Protokoll Pflicht (CEL). */
function listenerOf(leaf: Leaf, gateway: string): GatewayListener {
  const name = leaf.key("name").reqStr();
  const protocol = leaf.key("protocol").reqStr();
  const port = leaf.key("port").int();
  if (port === undefined) throw new ManifestError(leaf.key("port").path + ": Pflichtfeld fehlt");
  if (port < 1 || port > 65535) {
    throw new ManifestError("The Gateway \"" + gateway + "\" is invalid: " + leaf.key("port").path + ": Invalid value: " + port
      + ": " + leaf.key("port").path + " in body should be " + (port < 1 ? "greater than or equal to 1" : "less than or equal to 65535"),
    "Ein Listener-Port liegt zwischen 1 und 65535.", true);
  }
  const hostname = leaf.key("hostname").str();
  const tlsSecret = tlsSecretOf(leaf, protocol, gateway);
  return { name, port, protocol, ...(hostname !== undefined && { hostname }), ...(tlsSecret !== undefined && { tlsSecret }) };
}

export function mapGateway(doc: Leaf): ApplyEffect {
  const name = nameOf(doc, "Gateway");
  const spec = doc.key("spec");
  const className = spec.key("gatewayClassName").reqStr();
  const listeners = spec.key("listeners").reqItems().map(l => listenerOf(l, name));
  const seen = new Set<string>();
  for (const l of listeners) {
    if (seen.has(l.name)) {
      throw new ManifestError("The Gateway \"" + name + "\" is invalid: spec.listeners: Invalid value: \"array\": Listener name must be unique within the Gateway",
        "Jeder Listener eines Gateways braucht einen eigenen Namen.", true);
    }
    seen.add(l.name);
  }
  return { gateway: { name, className, listeners } };
}

const SAME_NS = "default";
const routeInvalid = (route: string, path: string, rest: string, tip: string): ManifestError =>
  new ManifestError("The HTTPRoute \"" + route + "\" is invalid: " + path + ": " + rest, tip, true);

/** Verweise gehen nur in den eigenen Namespace (kein ReferenceGrant im Simulator). */
function sameNamespace(leaf: Leaf, route: string): void {
  const ns = leaf.key("namespace").str();
  if (ns !== undefined && ns !== SAME_NS) {
    throw new ManifestError(leaf.key("namespace").path + ": Verweise über Namespaces hinweg (ReferenceGrant) bildet der Simulator nicht ab",
      "Lege die HTTPRoute in den Namespace des Verweisziels bzw. nutze nur Ziele im Namespace '" + SAME_NS + "' (Route '" + route + "').", true);
  }
}

function refKind(leaf: Leaf, expected: string): void {
  const kind = leaf.key("kind").str();
  if (kind !== undefined && kind !== expected) {
    throw new ManifestError(leaf.key("kind").path + ": nur kind '" + expected + "' wird abgebildet, gefunden '" + kind + "'",
      "Der Simulator kennt hier nur " + expected + ".", true);
  }
}

function parentRefOf(leaf: Leaf, route: string): string {
  sameNamespace(leaf, route);
  refKind(leaf, "Gateway");
  for (const k of ["sectionName", "port"]) {
    if (leaf.key(k).present) {
      throw new ManifestError(leaf.key(k).path + ": wird vom Simulator nicht abgebildet", "Die Route hängt am ganzen Gateway, nicht an einem einzelnen Listener.", true);
    }
  }
  return leaf.key("name").reqStr();
}

function backendOf(leaf: Leaf, route: string): HttpBackendRef {
  sameNamespace(leaf, route);
  refKind(leaf, "Service");
  const service = leaf.key("name").reqStr();
  const port = leaf.key("port").int();
  if (port === undefined) {
    throw routeInvalid(route, leaf.path, "Invalid value: \"object\": Must have port for Service reference", "Ein backendRef auf einen Service braucht 'port: <zahl>'.");
  }
  return { service, port };
}

/** Ein Match je Regel; ohne `matches` gilt der Default `PathPrefix /`. */
function matchOf(rule: Leaf, route: string): { path: string; pathType: HttpPathType } {
  const matches = rule.key("matches").items();
  if (matches.length > 1) {
    throw new ManifestError(rule.key("matches").path + ": mehr als ein match je Regel wird vom Simulator nicht abgebildet", "Teile die Regel in mehrere Regeln mit je einem match.", true);
  }
  const pathLeaf = matches.length ? matches[0].key("path") : new Leaf(undefined, rule.key("matches").path + "[0].path");
  const type = pathLeaf.key("type").str() ?? "PathPrefix";
  if (type === "RegularExpression") {
    throw new ManifestError(pathLeaf.key("type").path + ": RegularExpression wird vom Simulator nicht abgebildet", "Nutze 'PathPrefix' oder 'Exact'.", true);
  }
  if (type !== "PathPrefix" && type !== "Exact") {
    throw routeInvalid(route, pathLeaf.key("type").path, "Unsupported value: \"" + type + "\": supported values: \"Exact\", \"PathPrefix\", \"RegularExpression\"", "Der Pfad-Typ ist 'PathPrefix' oder 'Exact'.");
  }
  const path = pathLeaf.key("value").str() ?? "/";
  if (!path.startsWith("/")) {
    throw routeInvalid(route, pathLeaf.key("value").path, "Invalid value: \"" + path + "\": value must be an absolute path and start with '/' when type one of ['Exact', 'PathPrefix']", "Ein Pfad beginnt mit '/'.");
  }
  return { path, pathType: type };
}

function ruleOf(rule: Leaf, route: string): HttpRouteRule {
  const backends = rule.key("backendRefs").items().map(b => backendOf(b, route));
  return { ...matchOf(rule, route), backends };
}

export function mapHttpRoute(doc: Leaf): ApplyEffect {
  const name = nameOf(doc, "HTTPRoute");
  const spec = doc.key("spec");
  const parentRefs = spec.key("parentRefs").items().map(p => parentRefOf(p, name));
  const hostnames = spec.key("hostnames").items().map(h => h.reqStr());
  const rulesLeaf = spec.key("rules");
  // Ohne `rules` setzt die CRD genau eine Regel `PathPrefix /` (ohne Backends); `rules: []` bleibt leer.
  const rules = rulesLeaf.present ? rulesLeaf.items().map(r => ruleOf(r, name)) : [{ path: "/", pathType: "PathPrefix" as const, backends: [] }];
  return { httpRoute: { name, parentRefs, hostnames, rules } };
}
