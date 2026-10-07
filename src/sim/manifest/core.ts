/* ===== Kubernia – Manifest-Mapper für die Kern-API `v1` (sim/manifest/core.ts, #1139) =====
 * Übersetzt ein geparstes Service-Manifest in den `ApplyEffect`. Nur die Felder, die das
 * Sim-Modell kennt (Typ, Port, targetPort, externalName, headless `clusterIP: None`, #1301);
 * eine explizite ClusterIP, Port-Namen und Selector werden ignoriert. Weitere `v1`-Kinds (ConfigMap, Secret, …, #1142) kommen hierher. */
import { HEADLESS_CLUSTER_IP, isExternalNameService, type ApplyEffect } from "../state";
import { isResourceName, rfc1123ErrorText, RFC1123_TIP } from "../names";
import { Leaf, ManifestError } from "./fields";

type ServiceEffect = NonNullable<ApplyEffect["service"]>;

/** `spec.clusterIP: None` (headless, #1301). Wie im echten API ist das nur bei ClusterIP
 *  (bzw. ohne `type`) erlaubt; bei LoadBalancer/NodePort lehnt der Server es ab. */
function headlessOf(spec: Leaf, type: string | undefined): boolean {
  if (spec.key("clusterIP").str() !== HEADLESS_CLUSTER_IP) return false;
  if (type === "LoadBalancer" || type === "NodePort") {
    throw new ManifestError(spec.key("clusterIP").path + ": may not be set to 'None' for " + type + " services",
      "Ein headless Service (clusterIP: None) ist nur vom Typ ClusterIP möglich.");
  }
  return true;
}

/** `targetPort` ist eine Zahl oder ein Port-Name. */
function targetPortOf(port: Leaf): number | string | undefined {
  const leaf = port.key("targetPort");
  if (!leaf.present) return undefined;
  return typeof leaf.value === "number" ? leaf.int() : leaf.str();
}

export function mapService(doc: Leaf): ApplyEffect {
  const name = doc.key("metadata").key("name").reqStr();
  if (!isResourceName(name)) throw new ManifestError(rfc1123ErrorText(name, "Service"), RFC1123_TIP, true);
  const spec = doc.key("spec");
  const type = spec.key("type").str();
  const externalName = spec.key("externalName").str();
  if (isExternalNameService({ type }) && !externalName) throw new ManifestError(spec.key("externalName").path + ": Pflichtfeld fehlt bei type ExternalName");
  const ports = spec.key("ports").items();
  // Ein ExternalName-Service darf ohne Ports auskommen (reiner CNAME); sonst ist ein Port Pflicht.
  const first = isExternalNameService({ type }) && ports.length === 0 ? undefined : spec.key("ports").reqItems()[0];
  let port: number | string = "";
  if (first) {
    const p = first.key("port").int();
    if (p === undefined) throw new ManifestError(first.key("port").path + ": Pflichtfeld fehlt");
    port = p;
  }
  const svc: ServiceEffect = { name, port };
  if (type !== undefined) svc.type = type;
  if (externalName !== undefined) svc.externalName = externalName;
  if (headlessOf(spec, type)) svc.clusterIP = HEADLESS_CLUSTER_IP;
  const target = first ? targetPortOf(first) : undefined;
  if (target !== undefined) svc.targetPort = target;
  return { service: svc };
}
