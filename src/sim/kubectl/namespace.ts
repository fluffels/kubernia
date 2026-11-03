// Namespace-Bewusstsein von `kubectl get`: welcher Namespace wurde verlangt, und liegt dort
// überhaupt etwas? Die Sim kennt nur `default` (plus kube-system für Pods), alles andere ist leer.
// Alle Leser lesen den `Call` ihres eigenen Unterbefehls (#1488), nie die Rohzeile.

import { notSimulated, type Call, type ErrHost, type SubEntry } from "../cliargs";
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

/** Wie ein kubectl-Eintrag mit `-n <fremd>` umgeht (#1720). `liest`: der Handler liest `-n` selbst (leere Liste oder NotFound im
 *  fremden Namespace). `cluster`: das Ziel ist clusterweit, `-n` bleibt wie in kubectl ohne Wirkung. Ohne Markierung kennt der
 *  Simulator nur `default`: die Wache (`namespaceWache`) lehnt jeden anderen Namespace ab, statt ihn still auf `default` anzuwenden. */
export type NamespaceBezug = "liest" | "cluster";

/** Ein kubectl-Eintrag samt Namespace-Markierung. */
export interface KubectlEntry<H> extends SubEntry<H> { readonly namespace?: NamespaceBezug }

/** Die fail-closed Wache vor jedem kubectl-Handler: ein Eintrag ohne Markierung bekommt `-n <fremd>` nie zu sehen. `null` = durchlassen. */
export function namespaceWache(host: ErrHost, cmd: string, entry: KubectlEntry<unknown>, c: Call): string | null {
  if (entry.namespace) return null;
  const ns = foreignNamespace(c, true);
  if (ns === null) return null;
  return notSimulated(host, "der Namespace '" + ns + "' bei '" + cmd + "'.", ["'" + cmd + "' im Namespace default"],
    "Außer bei 'kubectl get' kennt der Simulator nur den Namespace default: lass -n weg.");
}
