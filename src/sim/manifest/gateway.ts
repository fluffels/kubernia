/* ===== Kubernia – Manifest-Mapper für `gateway.networking.k8s.io/v1` (sim/manifest/gateway.ts, #1664) =====
 * Übersetzt GatewayClass und Gateway in den `ApplyEffect`. Gelesen werden nur die Felder, die das Sim-Modell
 * kennt: `controllerName`, `description`, `gatewayClassName` und je Listener Name, Port, Protokoll,
 * `hostname` und das erste `tls.certificateRefs[].name`. Ein `status` im Manifest (z.B. aus `get -o yaml`)
 * wird ignoriert, der Status ist abgeleitet (../gateway).
 *
 * Die CEL-Regeln der echten API (Port 1–65535, HTTPS/TLS braucht `tls`, eindeutige Listener-Namen) lehnt der
 * Mapper mit dem Server-Wortlaut ab; ein Secret, das es nicht gibt, ist dagegen kein Apply-Fehler, sondern
 * eine Listener-Condition (`ResolvedRefs`, siehe ../gateway). */
import type { ApplyEffect } from "../state";
import { TLS_PROTOCOLS, type GatewayListener } from "../gateway";
import { isResourceName, rfc1123ErrorText, RFC1123_TIP } from "../names";
import { Leaf, ManifestError } from "./fields";

const NO_TLS_PROTOCOLS = ["HTTP", "TCP", "UDP"];

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
  const tls = leaf.key("tls");
  if (!tls.present && TLS_PROTOCOLS.includes(protocol)) {
    throw new ManifestError("The Gateway \"" + gateway + "\" is invalid: " + leaf.path.replace(/\[\d+\]$/, "")
      + ": Invalid value: \"array\": tls must be specified for protocols ['HTTPS', 'TLS']",
    "Ein HTTPS-Listener braucht 'tls: certificateRefs: [{name: <secret>}]'.", true);
  }
  if (tls.present && NO_TLS_PROTOCOLS.includes(protocol)) {
    throw new ManifestError("The Gateway \"" + gateway + "\" is invalid: " + leaf.path.replace(/\[\d+\]$/, "")
      + ": Invalid value: \"array\": tls must not be specified for protocols ['HTTP', 'TCP', 'UDP']",
    "Nur HTTPS- und TLS-Listener tragen einen 'tls'-Block.", true);
  }
  if (tls.present && tls.key("mode").str() === "Passthrough") {
    throw new ManifestError(tls.path + ".mode: Passthrough wird vom Simulator nicht abgebildet",
      "Nutze 'mode: Terminate' mit 'certificateRefs: [{name: <secret>}]'.", true);
  }
  const refs = tls.key("certificateRefs").items();
  if (tls.present && refs.length === 0) {
    throw new ManifestError("The Gateway \"" + gateway + "\" is invalid: " + leaf.path.replace(/\[\d+\]$/, "")
      + ": Invalid value: \"array\": certificateRefs or options must be specified when mode is Terminate",
    "Ein 'tls'-Block braucht 'certificateRefs: [{name: <secret>}]'.", true);
  }
  const tlsSecret = refs[0]?.key("name").reqStr();
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
