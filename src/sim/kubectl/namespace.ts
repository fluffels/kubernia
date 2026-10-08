// Namespace-Bewusstsein von `kubectl get`: welcher Namespace wurde verlangt, und liegt dort
// überhaupt etwas? Die Sim kennt nur `default` (plus kube-system für Pods), alles andere ist leer.
// Alle Leser lesen den `Call` ihres eigenen Unterbefehls (#1488), nie die Rohzeile.

import type { Call } from "../cliargs";
import { DEFAULT_NAMESPACE } from "../state";

/** Der per `-n x`, `-nx`, `--namespace x` oder `-n=x` verlangte Namespace, sonst null. */
export function requestedNamespace(c: Call): string | null {
  return c.value("-n", "--namespace") || null;
}

/** `-A` / `--all-namespaces` gesetzt? Das Flag kennt nur die get-Tabelle; bei den anderen Unterbefehlen
 *  lehnt der Parse es vorher ab und der `Call` kennt es nicht. */
export function allNamespaces(c: Call): boolean {
  return c.has("-A", "--all-namespaces");
}

/** Der verlangte Namespace, falls die Ressource dort leer ausgeht, sonst null.
 *  Cluster-weite Ressourcen und `-A` ignorieren `-n`; `extra` nennt zusätzliche Namespaces,
 *  in denen die Ressource etwas zeigt (Pods: kube-system). */
export function foreignNamespace(c: Call, namespaced: boolean, extra: readonly string[] = []): string | null {
  if (!namespaced || allNamespaces(c)) return null;
  const ns = requestedNamespace(c);
  if (!ns || ns === DEFAULT_NAMESPACE || extra.includes(ns)) return null;
  return ns;
}
