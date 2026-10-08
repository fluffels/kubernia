/* ===== Kubernia – YAML-Bausteine der Gruppe apps/v1 (sim/kubectl/objects/apps.ts, #1467) =====
 * Die Objekte für `kubectl get <typ> -o yaml`: Deployment, ReplicaSet (abgeleitet, ../../replicasets.ts) und
 * StatefulSet. Gespiegelt wird das Mapper-Paar in ../../manifest/apps.ts (Round-Trip-Test), das Pod-Template
 * kommt aus `deploymentPodSpec` (./core). Regeln wie dort: nur modellierte Felder, keine Laufzeit-Ids; die
 * Status-Zähler folgen den `omitempty`-Tags aus k8s.io/api (apps/v1): beim Deployment fehlt eine 0,
 * `replicas` am ReplicaSet und StatefulSet bleibt auch als 0 stehen.
 *
 * Phaser-frei (pure Domäne); importiert nie ./get-yaml oder ../get (kein Zyklus). */
import type { YamlValue } from "../../yaml";
import type { YamlMap } from "../../yaml-emit";
import type { KubectlHost } from "../host";
import type { Deployment, StatefulSetRes } from "../../state";
import { currentReplicaSet, podTemplateLabels } from "../../replicasets";
import { workloadLabels, type Labels } from "../../util";
import { clusterPods } from "../../pods";
import { clusterPodStatus } from "../../podstatus";
import { availableReplicas } from "../inspect";
import { accessModesLong, compact, deploymentPodSpec, metaOf, type ObjectsOf } from "./core";

/** Ein Zähler, der bei 0 fehlt (`omitempty`). */
const omitZero = (n: number): number | undefined => (n === 0 ? undefined : n);

const matchLabels = (labels: Labels): YamlMap => ({ matchLabels: labels });
const template = (labels: Labels, spec: YamlValue): YamlMap => ({ metadata: { labels }, spec });

// ===== Deployment =====

function deploymentObject(host: KubectlHost, d: Deployment): YamlMap {
  const labels = workloadLabels(d.name);
  const available = availableReplicas(host, d);
  const total = d.pods.length;
  return {
    apiVersion: "apps/v1", kind: "Deployment", metadata: metaOf(d.name, labels),
    spec: { replicas: d.replicas, selector: matchLabels(labels), template: template(labels, deploymentPodSpec(d)) },
    status: compact({
      availableReplicas: omitZero(available),
      readyReplicas: omitZero(available),
      replicas: omitZero(total),
      unavailableReplicas: omitZero(Math.max(0, d.replicas - available)),
      updatedReplicas: omitZero(total),
    }),
  };
}

export const deploymentObjects: ObjectsOf = host => new Map(host.deployments.map(d => [d.name, deploymentObject(host, d)]));

// ===== ReplicaSet =====

function replicaSetObject(host: KubectlHost, d: Deployment): YamlMap {
  const rs = currentReplicaSet(d);
  const labels = podTemplateLabels(d);
  const ready = availableReplicas(host, d);
  return {
    apiVersion: "apps/v1", kind: "ReplicaSet", metadata: metaOf(rs.name, labels),
    spec: { replicas: d.replicas, selector: matchLabels(labels), template: template(labels, deploymentPodSpec(d)) },
    status: compact({
      availableReplicas: omitZero(ready),
      fullyLabeledReplicas: omitZero(d.pods.length),
      readyReplicas: omitZero(ready),
      replicas: d.pods.length,
    }),
  };
}

export const replicaSetObjects: ObjectsOf = host => new Map(host.deployments.map(d => {
  const o = replicaSetObject(host, d);
  return [currentReplicaSet(d).name, o];
}));

// ===== StatefulSet =====

function statefulSetObject(host: KubectlHost, s: StatefulSetRes): YamlMap {
  const labels = workloadLabels(s.name);
  const running = clusterPods(host).filter(c => c.owner === "StatefulSet" && c.sts.name === s.name && clusterPodStatus(host, c).status === "Running").length;
  const claim = compact({
    accessModes: accessModesLong("RWO"),
    resources: { requests: { storage: s.storage } },
    storageClassName: s.storageClass,
  });
  return {
    apiVersion: "apps/v1", kind: "StatefulSet", metadata: metaOf(s.name, labels),
    spec: {
      replicas: s.replicas,
      selector: matchLabels(labels),
      serviceName: s.serviceName,
      template: template(labels, { containers: [{ image: s.image, name: s.name }] }),
      volumeClaimTemplates: [{ apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: { name: s.volumeClaimName }, spec: claim }],
    },
    status: compact({
      availableReplicas: running,
      currentReplicas: omitZero(s.pods.length),
      readyReplicas: omitZero(running),
      replicas: s.pods.length,
      updatedReplicas: omitZero(s.pods.length),
    }),
  };
}

export const statefulSetObjects: ObjectsOf = host => new Map(host.statefulSets.map(s => [s.name, statefulSetObject(host, s)]));
