/* ===== Kubernia – kubectl get -o yaml: die Objekt-Bausteine (sim/kubectl/get-yaml.ts, #1467) =====
 * `kubectl get <typ> [<name>] -o yaml` druckt Objekte im kubectl-Stil, und zwar so, dass der Parser der Sim
 * (`yaml.ts`) sie wieder einliest (`yaml-emit.ts`). Diese Datei ist die Registry: je Art ein Baustein, der alle
 * Objekte der Art als Mapping liefert (./objects/core.ts für `v1`, ./objects/apps.ts für `apps/v1`). Eine neue
 * Art ist ein Registry-Eintrag plus ein Baustein in der Datei ihrer API-Gruppe; ein neuer Mapper ohne Baustein
 * macht den Fitness-Test rot (Wächter Mapper ↔ Ausgabe).
 *
 * Ausgabe vollständig oder ehrlich abgelehnt, nie still gekürzt: eine Art ohne Baustein ist nur erlaubt, solange
 * sie leer ist (`get all -o yaml` ohne Grafana-Objekte geht), mit Objekten lehnt `get.ts` mit `notSimulated` ab.
 * Das Zusammensetzen (Einzelobjekt gegen `kind: List`, NotFound-Zeilen) macht `get.ts` über `yamlObjects` und
 * `yamlList`; die Namen kommen aus derselben Tabelle wie bei der normalen Ausgabe.
 *
 * Phaser-frei (pure Domäne); importiert nie ./get (kein Zyklus). */
import type { YamlValue } from "../yaml";
import type { YamlMap } from "../yaml-emit";
import type { KubectlHost } from "./host";
import { RESOURCE_KINDS, type ResourceKind, type ResourcePlural } from "./resources";
import { podObjects, serviceObjects, pvcObjects, type ObjectsOf } from "./objects/core";
import { deploymentObjects, replicaSetObjects, statefulSetObjects } from "./objects/apps";

/** Der Baustein je Art (Schlüssel = Plural aus ./resources). */
export const YAML_BAUSTEINE: ReadonlyMap<ResourcePlural, ObjectsOf> = new Map<ResourcePlural, ObjectsOf>([
  ["pods", podObjects],
  ["services", serviceObjects],
  ["deployments", deploymentObjects],
  ["replicasets", replicaSetObjects],
  ["statefulsets", statefulSetObjects],
  ["persistentvolumeclaims", pvcObjects],
]);

/** Die Arten mit Baustein, als Singular (für den Hinweistext). */
export function yamlKinds(): string[] {
  return RESOURCE_KINDS.filter(k => YAML_BAUSTEINE.has(k.plural)).map(k => k.singular);
}

/** Die Objekte der gezeigten Namen einer Art in dieser Reihenfolge. `null`, wenn `-o yaml` sie nicht
 *  vollständig abbilden kann: die Art hat keinen Baustein (und ist nicht leer), oder ein Name hat kein Objekt
 *  (die System-Pods von kube-system stehen nur in der Tabelle). */
export function yamlObjects(host: KubectlHost, kind: ResourceKind, names: readonly string[]): YamlMap[] | null {
  if (names.length === 0) return [];
  const objects = YAML_BAUSTEINE.get(kind.plural)?.(host);
  if (!objects) return null;
  const out: YamlMap[] = [];
  for (const n of names) {
    const o = objects.get(n);
    if (!o) return null;
    out.push(o);
  }
  return out;
}

/** Die `kind: List` um die Objekte; ohne Objekte `items: []` (wie kubectl, samt leerer `resourceVersion`). */
export function yamlList(items: readonly YamlValue[]): YamlMap {
  return { apiVersion: "v1", items: [...items], kind: "List", metadata: { resourceVersion: "" } };
}
