/* ===== Kubernia – RBAC-Identität (sim/rbac.ts) =====
 * Die EINE Stelle, die entscheidet, WORÜBER eine Role/ClusterRole bzw. ein RoleBinding/
 * ClusterRoleBinding identifiziert wird (#609, konzeptueller Kern hinter #578).
 *
 * In echtem Kubernetes sind Role (namespaced) und ClusterRole (cluster-weit)
 * VERSCHIEDENE Arten: denselben Namen als Role UND als ClusterRole zu vergeben ist
 * legal. Der Simulator führt beide in EINER Liste, per `.cluster` unterschieden
 * (ebenso RoleBinding/ClusterRoleBinding). Der Identitäts-Schlüssel ist deshalb
 * `(name, cluster)`, NICHT der Name allein.
 *
 * Vorher rieten Merge-Dedup (`sim.ts` `_mergeRbac`), die Eindeutigkeits-Invariante
 * (`sim/invariants.ts`), das create/apply-„already exists" (`sim/kubectl/lifecycle.ts`),
 * die describe-Suche (`sim/kubectl/inspect.ts`), die roleRef-Auflösung
 * (`sim/kubectl/security.ts`) und die Drill-Namensvergabe (`content/drills/*`) diese
 * Definition je EINZELN – sie standen nur zufällig im Einklang (die Merge/Invariante-
 * Divergenz war der Auslöser #578). Hier steht sie einmal; Stardew-Scope: eine neue
 * RBAC-Stelle nutzt diese Prädikate, statt den Schlüssel erneut zu erraten.
 *
 * Reine Domäne (Leaf): kein Import nötig, kein Laufzeit-Zustand, Phaser-frei, vom
 * Architektur-Wächter (#347) als Domäne geschützt und im Node-Test prüfbar.
 */

/** Ein RBAC-Objekt, das über `(name, cluster)` identifiziert wird – Role/ClusterRole
 *  ebenso wie RoleBinding/ClusterRoleBinding. `cluster` darf fehlen (rohe Szenario-/
 *  Effekt-Specs lassen es weg) und zählt dann als `false` (namespaced). */
export interface RbacIdentity {
  name: string;
  cluster?: boolean;
}

/** cluster-Flag → sichtbare Art. Groß geschrieben wie das K8s-`kind` (Role/ClusterRole);
 *  für die kleingeschriebenen API-Ressourcennamen (role/clusterrole) NICHT gedacht. */
export function roleKind(cluster?: boolean): "Role" | "ClusterRole" {
  return cluster ? "ClusterRole" : "Role";
}

/** Der EINE Identitäts-Schlüssel: Scope + Name. Eine Role und eine ClusterRole gleichen
 *  Namens ergeben verschiedene Schlüssel. Basis von Dedup, „already exists" und der
 *  Eindeutigkeits-Invariante. */
export function rbacKey(res: RbacIdentity): string {
  return roleKind(res.cluster) + " " + res.name;
}

/** Zwei RBAC-Objekte sind dasselbe (Dedup / „already exists" / Eindeutigkeit), wenn Name
 *  UND Scope übereinstimmen – geprüft über den EINEN Schlüssel. */
export function sameRbac(a: RbacIdentity, b: RbacIdentity): boolean {
  return rbacKey(a) === rbacKey(b);
}

/** Löst die `roleRef` einer (Cluster)RoleBinding auf ihre Rolle auf: `kind:"ClusterRole"`
 *  entspricht dem cluster-weiten Scope. Gleiche Schlüssel-Definition wie `sameRbac`. */
export function roleMatchesRef(role: RbacIdentity, ref: { kind: "Role" | "ClusterRole"; name: string }): boolean {
  return sameRbac(role, { name: ref.name, cluster: ref.kind === "ClusterRole" });
}
