/* ===== Kubernia – Cluster-DNS-Auflösung (sim/dns.ts) =====
 * Die EINE CoreDNS-Auflösung von Service-Namen (#1403) für `nslookup` und `curl` (sim/net.ts):
 * Suchpfad-Formen, Namespace und ExternalName-CNAME. Rein und ohne Host, nur Domänentypen. */
import { DEFAULT_NAMESPACE, isExternalNameService, type ServiceRes } from "./state";
import { externalIP } from "./util";

/** `<svc>[.<ns>[.svc[.cluster.local]]]` (auch mit Schlusspunkt) → Service, Namespace und FQDN; sonst `null`. */
export function parseServiceName(query: string): { svc: string; ns: string; fqdn: string } | null {
  const labels = query.replace(/\.$/, "").split(".");
  const [svc, ns = DEFAULT_NAMESPACE, ...suffix] = labels;
  if (labels.some(l => !l)) return null;
  const rest = suffix.join(".");
  if (rest !== "" && rest !== "svc" && rest !== "svc.cluster.local") return null;
  return { svc, ns, fqdn: svc + "." + ns + ".svc.cluster.local" };
}

export type ServiceAnswer =
  | { ok: true; svc: ServiceRes; fqdn: string; cname?: { name: string; ip: string } }
  | { ok: false; fqdn: string; tip: string };

/** Löst einen Service-Namen auf: gefunden nur im Namespace `default`; ExternalName liefert den CNAME samt eigener IP. */
export function resolveService(services: ServiceRes[], query: string): ServiceAnswer {
  const p = parseServiceName(query);
  const fqdn = p?.fqdn ?? query.replace(/\.$/, "");
  const svc = p && services.find(s => s.name === p.svc);
  if (!p || !svc) {
    return { ok: false, fqdn, tip: "Prüfe mit 'kubectl get services', ob der Service existiert." };
  }
  if (p.ns !== DEFAULT_NAMESPACE) {
    return { ok: false, fqdn, tip: "'" + svc.name + "' liegt im Namespace '" + DEFAULT_NAMESPACE + "', nicht in '" + p.ns + "'." };
  }
  if (!isExternalNameService(svc)) return { ok: true, svc, fqdn };
  if (!svc.externalName) {
    return { ok: false, fqdn, tip: "ExternalName-Service '" + svc.name + "' ohne spec.externalName." };
  }
  const name = svc.externalName.replace(/\.$/, "");
  return { ok: true, svc, fqdn, cname: { name, ip: externalIP(name) } };
}
