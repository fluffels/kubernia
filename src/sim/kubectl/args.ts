/* ===== Kubernia – kubectl-Argumente: Flag-Tabelle je Unterbefehl (sim/kubectl/args.ts, #1444) =====
 * Die Eingabegrenze von `kubectl`: Welche Flags wertet die Sim je Unterbefehl aus? Alles andere wurde
 * früher still ignoriert (`get pods -l app=x` druckte die Tabelle) und wird jetzt ehrlich abgelehnt –
 * mit dem Lernhinweis, was der Simulator stattdessen kann. Parser und `notSimulated` sind seit #1459
 * generisch in ../cliargs (alle Familien); hier liegen nur die kubectl-Tabellen (re-exportiert).
 *
 * Die Tabelle nennt NUR Flags, die die Sim wirklich auswertet (echtes kubectl hat Hunderte; „was wir
 * können“ ist endlich und ehrlich). `-n/--namespace` gilt überall, die Semantik regelt namespace.ts.
 *
 * Blattmodul der kubectl-Mappe (pure Domäne): importiert den Host-Typ, die Registry (./resources) und das Blattmodul ../cliargs. */
import type { KubectlHost } from "./host";
import { flag, checkFlags, positionalArgs, type ArgSpec, type FlagSpec } from "../cliargs";
export { notSimulated, flagValueOf } from "../cliargs";
import { RESOURCE_KINDS } from "./resources";
import { OUTPUT_FLAG } from "./output";

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
  get: [NS, flag(false, "-A", "--all-namespaces"), OUTPUT_FLAG],
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
  "-o": "Ausgabeformate gibt es im Simulator nur bei 'kubectl get' (-o wide); Details zeigt 'kubectl describe'.",
  "--output": "Ausgabeformate gibt es im Simulator nur bei 'kubectl get' (-o wide); Details zeigt 'kubectl describe'.",
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

/** Die zwei Fehlertexte der Slash-Form `typ/name` – wörtlich wie `splitResourceTypeName` in kubectl. */
const SLASH_MULTI_ERROR = "error: arguments in resource/name form may not have more than one slash";
export const SLASH_SINGLE_ERROR = "error: arguments in resource/name form must have a single resource and name";

/** Die EINE Zerlegung der Slash-Form `typ/name`: `null` ohne Slash (kein Slash-Token), sonst Typ und Name
 *  oder der kubectl-Fehlertext (mehr als ein Slash; leerer Typ oder Name; mehrere Typen mit Komma). */
export function slashRef(tok: string): { typ: string; name: string } | { error: string } | null {
  if (!tok.includes("/")) return null;
  const seg = tok.split("/");
  if (seg.length !== 2) return { error: SLASH_MULTI_ERROR };
  const [typ, name] = seg;
  return !typ || !name || typ.includes(",") ? { error: SLASH_SINGLE_ERROR } : { typ, name };
}

/** Typ und Name aus den Argumenten: `pod <name>` oder die Slash-Form `pod/<name>`; eine kaputte Slash-Form
 *  liefert `error` (Text wie kubectl). */
export function typeAndName(pos: string[]): { typ?: string; name?: string; error?: string } {
  const ref = pos[0] === undefined ? null : slashRef(pos[0]);
  if (!ref) return { typ: pos[0], name: pos[1] };
  return "error" in ref ? { error: ref.error } : ref;
}

/** `error: the server doesn't have a resource type "x"` samt Hinweis auf die Typen, die die Sim kennt. */
export function unknownResourceType(host: Pick<KubectlHost, "_err">, token: string): string {
  const typen = RESOURCE_KINDS.filter(k => !k.pseudo).map(k => k.plural).join(", ");
  return host._err('error: the server doesn\'t have a resource type "' + token.toLowerCase() + '"', "Gemeint war vielleicht: " + typen + "?");
}
