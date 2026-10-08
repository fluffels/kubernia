// Namespace-Bewusstsein von `kubectl get`: welcher Namespace wurde verlangt, und liegt dort
// überhaupt etwas? Die Sim kennt nur `default` (plus kube-system für Pods), alles andere ist leer.

import { callOf, flagValueOf } from "./args";
import { DEFAULT_NAMESPACE } from "../state";

/** Der per `-n x`, `-nx`, `--namespace x` oder `-n=x` verlangte Namespace, sonst null. */
export function requestedNamespace(t: string[]): string | null {
  return flagValueOf(t, ["-n", "--namespace"]) || null;
}

/** `-A` / `--all-namespaces` gesetzt? Das Flag gibt es nur in der get-Tabelle; bei den anderen Unterbefehlen hat
 *  `checkArgs` es vorher abgelehnt, der Leser liest es dort nur nicht mit. */
export function allNamespaces(t: string[]): boolean {
  return callOf("get", t).has("-A", "--all-namespaces");
}

/** Der verlangte Namespace, falls die Ressource dort leer ausgeht, sonst null.
 *  Cluster-weite Ressourcen und `-A` ignorieren `-n`; `extra` nennt zusätzliche Namespaces,
 *  in denen die Ressource etwas zeigt (Pods: kube-system). */
export function foreignNamespace(t: string[], namespaced: boolean, extra: readonly string[] = []): string | null {
  if (!namespaced || allNamespaces(t)) return null;
  const ns = requestedNamespace(t);
  if (!ns || ns === DEFAULT_NAMESPACE || extra.includes(ns)) return null;
  return ns;
}
