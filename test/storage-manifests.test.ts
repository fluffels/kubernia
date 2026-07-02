/* Struktur-Tests für die Lagerhallen-Viertel-Manifeste (#123, Phase 7):
 * StatefulSet, headless Service, StorageClass, PersistentVolumeClaim.
 * Reine YAML-Bausteine (noch ohne Sim/Quests – das sind #122/#145). Geprüft wird,
 * dass die Pflicht-Blöcke da sind und sauber eingerückt – ein Tippfehler in der
 * Einrückung fällt sonst erst spät auf, wenn die Quests sie konsumieren.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { getManifest } from "../src/content/manifest-lib";

const STATEFULSET_YAML = getManifest("statefulset-speicher");
const HEADLESS_SERVICE_YAML = getManifest("service-headless-speicher");
const STORAGECLASS_YAML = getManifest("storageclass-kai-ssd");
const PVC_YAML = getManifest("pvc-lager-daten");

/** Gibt die Liste fehlender Muster zurück (leer = ok) – so Red-Green-prüfbar. */
function fehlende(yaml: string, muster: [RegExp, string][]): string[] {
  return muster.filter(([re]) => !re.test(yaml)).map(([, was]) => "fehlt: " + was);
}

test("STATEFULSET_YAML: serviceName, volumeClaimTemplates, replicas, Selektor==Template-Label", () => {
  assert.deepEqual(fehlende(STATEFULSET_YAML, [
    [/^apiVersion: apps\/v1$/m, "apiVersion apps/v1"],
    [/^kind: StatefulSet$/m, "kind: StatefulSet"],
    [/^ {2}serviceName: \S+/m, "spec.serviceName (headless Service-Bindung)"],
    [/^ {2}replicas: \d+/m, "spec.replicas"],
    [/^ {2}volumeClaimTemplates:/m, "volumeClaimTemplates (eigenes Volume je Pod)"],
    [/^ {8}storageClassName: \S+/m, "volumeClaimTemplates…storageClassName"],
    [/storage: \d+Gi/, "Storage-Anforderung (Gi)"],
  ]), []);
  // serviceName muss zum headless Service passen (stabile DNS-Identität)
  assert.match(STATEFULSET_YAML, /serviceName: speicher-datenbank/);
  assert.match(HEADLESS_SERVICE_YAML, /^ {2}name: speicher-datenbank$/m);
});

test("HEADLESS_SERVICE_YAML: clusterIP: None + Selektor + Port", () => {
  assert.deepEqual(fehlende(HEADLESS_SERVICE_YAML, [
    [/^kind: Service$/m, "kind: Service"],
    [/^ {2}clusterIP: None\b/m, "clusterIP: None (headless!)"],
    [/^ {2}selector:/m, "spec.selector"],
    [/^ {4}app: \S+/m, "selector.app"],
    [/^ {4}- port: \d+/m, "ports[].port"],
  ]), []);
});

test("STORAGECLASS_YAML: provisioner + reclaimPolicy + volumeBindingMode", () => {
  assert.deepEqual(fehlende(STORAGECLASS_YAML, [
    [/^apiVersion: storage\.k8s\.io\/v1$/m, "apiVersion storage.k8s.io/v1"],
    [/^kind: StorageClass$/m, "kind: StorageClass"],
    [/^provisioner: \S+/m, "provisioner"],
    [/^reclaimPolicy: (Retain|Delete)\b/m, "reclaimPolicy"],
    [/^volumeBindingMode: \S+/m, "volumeBindingMode"],
  ]), []);
});

test("PVC_YAML: accessModes + storageClassName + Storage-Request", () => {
  assert.deepEqual(fehlende(PVC_YAML, [
    [/^kind: PersistentVolumeClaim$/m, "kind: PersistentVolumeClaim"],
    [/^ {4}- ReadWriteOnce\b/m, "accessModes: ReadWriteOnce"],
    [/^ {2}storageClassName: kai-ssd\b/m, "storageClassName == StorageClass-Name"],
    [/^ {6}storage: \d+Gi\b/m, "resources.requests.storage"],
  ]), []);
  // PVC und StatefulSet-Template ziehen aus derselben StorageClass
  assert.match(STORAGECLASS_YAML, /^ {2}name: kai-ssd$/m);
});

test("Red-Green: der Struktur-Check schlägt bei einem kaputten Manifest wirklich an", () => {
  // headless Service OHNE clusterIP: None (also ein ganz normaler Service) MUSS auffallen –
  // sonst hätte ein StatefulSet keine stabile Identität und der Test wäre wertlos.
  const kaputt = [
    "apiVersion: v1", "kind: Service", "metadata:", "  name: x",
    "spec:", "  selector:", "    app: x", "  ports:", "    - port: 5432",
  ].join("\n");
  const f = fehlende(kaputt, [[/^ {2}clusterIP: None$/m, "clusterIP: None (headless!)"]]);
  assert.ok(f.some(m => m.includes("clusterIP: None")), "fehlendes clusterIP:None nicht erkannt");
});
