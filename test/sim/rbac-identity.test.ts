/* Unit-Tests: RBAC-Identitäts-SSOT (src/sim/rbac.ts, #609). Der konzeptuelle Kern hinter
 * #578: der Identitäts-Schlüssel einer Role/ClusterRole (bzw. deren Binding) ist
 * `(name, cluster)`, NICHT der Name allein. Diese Datei sichert die EINE Definition ab,
 * die Merge/Invariante/create-apply/describe/roleRef/Drills jetzt gemeinsam nutzen. */
import { test } from "vitest";
import assert from "node:assert/strict";
import { rbacKey, sameRbac, roleKind, roleMatchesRef } from "../../src/sim/rbac";

test("#609 roleKind: cluster-Flag → sichtbare Art (fehlend = Role)", () => {
  assert.equal(roleKind(true), "ClusterRole");
  assert.equal(roleKind(false), "Role");
  assert.equal(roleKind(undefined), "Role", "fehlendes cluster zählt als namespaced");
});

test("#609 rbacKey: Scope ist Teil des Schlüssels – Role und ClusterRole gleichen Namens verschieden", () => {
  assert.equal(rbacKey({ name: "leser", cluster: false }), "Role leser");
  assert.equal(rbacKey({ name: "leser", cluster: true }), "ClusterRole leser");
  assert.notEqual(
    rbacKey({ name: "leser", cluster: false }),
    rbacKey({ name: "leser", cluster: true }),
    "GENAU der Bug hinter #578: gleicher Name, anderer Scope → andere Identität",
  );
  // fehlendes cluster == cluster:false (rohe Szenario-Specs lassen es weg)
  assert.equal(rbacKey({ name: "leser" }), rbacKey({ name: "leser", cluster: false }));
});

test("#609 sameRbac: gleicher Name UND Scope = dasselbe Objekt", () => {
  assert.ok(sameRbac({ name: "leser", cluster: false }, { name: "leser" }), "cluster undefined ≙ false");
  assert.ok(sameRbac({ name: "spaeher", cluster: true }, { name: "spaeher", cluster: true }));
});

test("#609 sameRbac (Negativfall): Name gleich, Scope verschieden ⇒ NICHT dasselbe", () => {
  assert.ok(!sameRbac({ name: "leser", cluster: false }, { name: "leser", cluster: true }),
    "eine Role und eine ClusterRole gleichen Namens dürfen koexistieren – kein Duplikat");
  assert.ok(!sameRbac({ name: "leser" }, { name: "schreiber" }), "verschiedene Namen sind verschieden");
});

test("#609 roleMatchesRef: kind:ClusterRole entspricht cluster-weitem Scope", () => {
  const nsRole = { name: "pod-leser", cluster: false };
  const clusterRole = { name: "knoten-leser", cluster: true };
  assert.ok(roleMatchesRef(nsRole, { kind: "Role", name: "pod-leser" }));
  assert.ok(roleMatchesRef(clusterRole, { kind: "ClusterRole", name: "knoten-leser" }));
});

test("#609 roleMatchesRef (Negativfall): Scope-Mismatch löst NICHT auf", () => {
  const nsRole = { name: "pod-leser", cluster: false };
  assert.ok(!roleMatchesRef(nsRole, { kind: "ClusterRole", name: "pod-leser" }),
    "eine namespaced Role erfüllt keinen ClusterRole-roleRef, auch bei gleichem Namen");
  assert.ok(!roleMatchesRef({ name: "knoten-leser", cluster: true }, { kind: "ClusterRole", name: "anders" }),
    "anderer Name matcht nicht");
});
