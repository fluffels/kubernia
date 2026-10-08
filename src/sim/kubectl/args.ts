/* ===== Kubernia – kubectl-Argumente: Flag-Tabelle je Unterbefehl (sim/kubectl/args.ts, #1444) =====
 * Die Eingabegrenze von `kubectl`: Welche Flags wertet die Sim je Unterbefehl aus? Alles andere wurde
 * früher still ignoriert (`get pods -o yaml` druckte die Tabelle) und wird jetzt ehrlich abgelehnt –
 * mit dem Lernhinweis, was der Simulator stattdessen kann. Parser und `notSimulated` sind seit #1459
 * generisch in ../cliargs (alle Familien); hier liegen nur die kubectl-Tabellen (re-exportiert).
 *
 * Die Tabelle nennt NUR Flags, die die Sim wirklich auswertet (echtes kubectl hat Hunderte; „was wir
 * können“ ist endlich und ehrlich). `-n/--namespace` gilt überall, die Semantik regelt namespace.ts.
 *
 * Blattmodul der kubectl-Mappe (pure Domäne): importiert nur den Host-Typ und die Registry (./resources). */
import type { KubectlHost } from "./host";
import { flag, checkFlags, positionalArgs, type ArgSpec, type FlagSpec } from "../cliargs";
export { notSimulated, flagValueOf } from "../cliargs";
import { RESOURCE_KINDS } from "./resources";

/** Die Unterbefehle, die die Sim implementiert (Schlüssel der Dispatch-Tabelle in ../kubectl.ts). */
export const KUBECTL_SUBS = ["get", "describe", "create", "scale", "expose", "delete", "apply", "logs", "top", "set", "rollout", "auth", "label"] as const;
export type KubectlSub = typeof KUBECTL_SUBS[number];

export function isKubectlSub(sub: string): sub is KubectlSub {
  return (KUBECTL_SUBS as readonly string[]).includes(sub);
}

/** Top-Level-Befehle von echtem kubectl: sie gibt es, die Sim kann sie nur (noch) nicht. */
export const REAL_KUBECTL_COMMANDS: readonly string[] = [
  "create", "expose", "run", "set", "explain", "get", "edit", "delete", "rollout", "scale", "autoscale",
  "certificate", "cluster-info", "top", "cordon", "uncordon", "drain", "taint", "describe", "logs", "attach",
  "exec", "port-forward", "proxy", "cp", "auth", "debug", "events", "diff", "apply", "patch", "replace", "wait",
  "kustomize", "label", "annotate", "completion", "alpha", "api-resources", "api-versions", "config", "plugin",
  "version", "help",
];

const NS = flag(true, "-n", "--namespace");
const FILE = flag(true, "-f", "--filename");

/** Die ausgewerteten Flags je Unterbefehl. */
const KNOWN_FLAGS: Readonly<Record<KubectlSub, readonly FlagSpec[]>> = {
  get: [NS, flag(false, "-A", "--all-namespaces")],
  describe: [NS],
  top: [NS],
  rollout: [NS],
  label: [NS, flag(false, "--overwrite")],
  auth: [NS, flag(true, "--as")],
  logs: [NS, flag(false, "-f", "--follow"), flag(false, "-p", "--previous")],
  delete: [NS, FILE],
  apply: [NS, FILE],
  scale: [NS, flag(true, "--replicas")],
  expose: [NS, flag(true, "--port"), flag(true, "--target-port"), flag(true, "--type")],
  create: [NS, ...["--image", "--replicas", "--from-literal", "--cert", "--key", "--verb", "--resource", "--role", "--clusterrole", "--serviceaccount", "--user"].map(n => flag(true, n))],
  set: [NS, flag(true, "--from"), flag(true, "--limits"), flag(true, "--requests")],
};

/** Lernhinweise zu den Flags, die Spieler aus dem echten kubectl kennen. */
const FLAG_HINTS: Readonly<Record<string, string>> = {
  "-o": "Ausgabeformate wie yaml, json oder wide gibt es im Simulator nicht – lies die Tabelle, Details zeigt 'kubectl describe'.",
  "--output": "Ausgabeformate wie yaml, json oder wide gibt es im Simulator nicht – lies die Tabelle, Details zeigt 'kubectl describe'.",
  "-w": "Live-Beobachtung gibt es nicht – wiederhole den Befehl einfach.",
  "--watch": "Live-Beobachtung gibt es nicht – wiederhole den Befehl einfach.",
  "-l": "Label-Selektoren gibt es nicht – filtere über den Namen, z.B. 'kubectl get pods <name>'.",
  "--selector": "Label-Selektoren gibt es nicht – filtere über den Namen, z.B. 'kubectl get pods <name>'.",
  "--show-labels": "Labels zeigt der Simulator nicht an.",
  "--sort-by": "Sortieren kann der Simulator nicht – die Liste kommt in fester Reihenfolge.",
  "--dry-run": "Trockenläufe gibt es nicht; der Befehl legt sonst wirklich etwas an, darum lehnt der Simulator ihn ab.",
};

/** Die Prüf-Tabelle eines Unterbefehls (Flags + Lernhinweise) für die gemeinsame Eingabegrenze. */
const specFor = (sub: KubectlSub): ArgSpec => ({ cmd: "kubectl " + sub, flags: KNOWN_FLAGS[sub], hints: FLAG_HINTS });

/** Prüft alle Flags eines Unterbefehls: unbekannte (nicht simulierte) und Wert-Flags ohne Wert.
 *  `null` = alles bekannt; sonst die fertige Fehlerausgabe. */
export function checkArgs(host: Pick<KubectlHost, "_err">, sub: KubectlSub, t: string[]): string | null {
  return checkFlags(host, specFor(sub), t, 2);
}

/** Die Nicht-Flag-Tokens ab `from` (ohne die Werte der Wert-Flags). */
export function positionals(sub: KubectlSub, t: string[], from = 2): string[] {
  return positionalArgs(specFor(sub), t, from);
}

/** Typ und Name aus den Argumenten: `pod <name>` oder die Slash-Form `pod/<name>`. */
export function typeAndName(pos: string[]): { typ: string | undefined; name: string | undefined } {
  const slash = pos[0]?.indexOf("/") ?? -1;
  if (slash > 0) return { typ: pos[0].slice(0, slash), name: pos[0].slice(slash + 1) || undefined };
  return { typ: pos[0], name: pos[1] };
}

/** `error: the server doesn't have a resource type "x"` samt Hinweis auf die Typen, die die Sim kennt. */
export function unknownResourceType(host: Pick<KubectlHost, "_err">, token: string): string {
  const typen = RESOURCE_KINDS.filter(k => !k.pseudo).map(k => k.plural).join(", ");
  return host._err('error: the server doesn\'t have a resource type "' + token.toLowerCase() + '"', "Gemeint war vielleicht: " + typen + "?");
}
