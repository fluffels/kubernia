/* ===== Kubernia – Manifest-Mapper für `apps/v1` (sim/manifest/apps.ts, #1139) =====
 * Übersetzt ein geparstes Deployment-Manifest in den `ApplyEffect`, den die apply-Handler
 * verstehen. Nur Felder, die das Sim-Modell kennt, werden gesetzt (und nur, wenn sie im YAML
 * stehen); alles Übrige (selector, labels, probes, …) wird ignoriert. Weitere `apps/v1`-Kinds
 * (StatefulSet, #1141) kommen als zusätzlicher Mapper in diese Datei. */
import { SECURITY_CONTEXT_KEYS, type ApplyEffect, type SecurityContext } from "../state";
import { isResourceName, rfc1123ErrorText, RFC1123_TIP } from "../names";
import { parseCpuMilli, parseMem } from "../util";
import { Leaf, ManifestError } from "./fields";

type DeploymentEffect = NonNullable<ApplyEffect["deployment"]>;

/** Pod- und Container-`securityContext` zusammenführen (Container gewinnt), nur bekannte Felder. */
function securityOf(pod: Leaf, container: Leaf): SecurityContext | undefined {
  const out: SecurityContext = {};
  for (const sc of [pod.key("securityContext"), container.key("securityContext")]) {
    for (const k of SECURITY_CONTEXT_KEYS) {
      const v = sc.key(k).bool();
      if (v !== undefined) out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Ein Mengen-Limit unter `resources.limits.<key>` in Mi (memory, ephemeral-storage); ungültig → ManifestError. */
function memoryLimitOf(container: Leaf, key: string): number | undefined {
  const leaf = container.key("resources").key("limits").key(key);
  const raw = leaf.str();
  if (raw === undefined) return undefined;
  const mi = parseMem(raw);
  if (mi === null) throw new ManifestError(leaf.path + ': ungültige Mengenangabe "' + raw + '" (erwartet z.B. 256Mi)');
  return mi;
}

/** `resources.limits.cpu` in Milli-Cores: als Text ("250m", "0.5") oder als YAML-Zahl (0.5, 2). */
function cpuLimitOf(container: Leaf): number | undefined {
  const leaf = container.key("resources").key("limits").key("cpu");
  if (!leaf.present) return undefined;
  const raw = typeof leaf.value === "number" ? String(leaf.value) : leaf.str();
  const milli = raw === undefined ? null : parseCpuMilli(raw);
  if (milli === null) throw new ManifestError(leaf.path + ': ungültige Mengenangabe "' + String(raw) + '" (erwartet z.B. 250m oder 0.5)');
  return milli;
}

/** Pod-Template-Felder: SA, Port, Node, Limits (memory/cpu/ephemeral-storage; `requests` bleiben ignoriert), emptyDir, initContainer, securityContext. */
function podTemplateFields(pod: Leaf, container: Leaf): Partial<DeploymentEffect> {
  const out: Partial<DeploymentEffect> = {};
  const sa = pod.key("serviceAccountName").str();
  if (sa !== undefined) out.serviceAccountName = sa;
  const port = container.key("ports").items()[0]?.key("containerPort").int();
  if (port !== undefined) out.containerPort = port;
  const node = pod.key("nodeName").str();
  if (node !== undefined) out.node = node;
  const eph = memoryLimitOf(container, "ephemeral-storage");
  if (eph !== undefined) out.ephemeralLimit = eph;
  const mem = memoryLimitOf(container, "memory");
  if (mem !== undefined) out.memLimit = mem;
  const cpu = cpuLimitOf(container);
  if (cpu !== undefined) out.cpuLimitMilli = cpu;
  if (pod.key("volumes").items().some(v => v.has("emptyDir"))) out.emptyDir = {};
  if (pod.key("initContainers").items().length > 0) out.initContainer = {};
  const sec = securityOf(pod, container);
  if (sec) out.securityContext = sec;
  return out;
}

export function mapDeployment(doc: Leaf): ApplyEffect {
  const nameLeaf = doc.key("metadata").key("name");
  const name = nameLeaf.reqStr();
  if (!isResourceName(name)) throw new ManifestError(rfc1123ErrorText(name, "Deployment"), RFC1123_TIP, true);
  const spec = doc.key("spec");
  const replicas = spec.key("replicas").int() ?? 1;
  const pod = spec.key("template").key("spec");
  const container = pod.key("containers").reqItems()[0];
  const image = container.key("image").reqStr();
  return { deployment: { name, image, replicas, ...podTemplateFields(pod, container) } };
}
