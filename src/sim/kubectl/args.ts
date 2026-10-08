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
import { flag, checkedFlag, checkFlags, lenientCall, notSimulated, positionalArgs, subEntry, type ArgSpec, type Call, type FlagSpec } from "../cliargs";
export { notSimulated, flagValueOf } from "../cliargs";
import { parseMem, parseCpuMilli } from "../util";
import { RESOURCE_KINDS, resolveKind } from "./resources";
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
  expose: [NS, checkedFlag(checkPort, "--port"), flag(true, "--target-port"), flag(true, "--type")],
  create: [
    NS, checkedFlag(checkLiteral, "--from-literal"), checkedFlag(checkServiceAccount, "--serviceaccount"),
    ...["--image", "--replicas", "--cert", "--key", "--verb", "--resource", "--role", "--clusterrole", "--user"].map(n => flag(true, n)),
  ],
  set: [NS, checkedFlag(checkFromRef, "--from"), checkedFlag(checkResourceList, "--limits"), checkedFlag(checkResourceList, "--requests")],
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

/** Prüft alle Flags eines Unterbefehls: unbekannte (nicht simulierte), Wert-Flags ohne Wert, ungültige Bool-Werte und abgelehnte `check`-Werte (`-o`).
 *  `null` = alles bekannt; sonst die fertige Fehlerausgabe. */
export function checkArgs(host: Pick<KubectlHost, "_err">, sub: KubectlSub, t: string[]): string | null {
  return checkFlags(host, specFor(sub), t, 2);
}

/** Die ausgelesene Eingabe eines Unterbefehls (`has`/`value`/`values`/`args`, #1469): die EINE Stelle, an der kubectl
 *  Flags liest – nie per `t.includes` oder Regex auf der Rohzeile. Ohne Fehlerpfad, weil `checkArgs` vorher lief. */
export function callOf(sub: KubectlSub, t: string[]): Call {
  return lenientCall(specFor(sub), t, 2);
}

/** `--replicas`: `null` = nicht angegeben, sonst die ganze Zahl (auch negativ: den Wertebereich prüft der Aufrufer, die
 *  Meldung unterscheidet sich je Befehl). Keine ganze Zahl: der pflag-Fehler wie bei echtem kubectl. */
export function replicasArg(host: Pick<KubectlHost, "_err">, c: Call): { replicas: number | null } | { error: string } {
  const v = c.value("--replicas");
  if (v === null) return { replicas: null };
  if (!/^[+-]?\d+$/.test(v)) {
    return { error: host._err('error: invalid argument "' + v + '" for "--replicas" flag: strconv.ParseInt: parsing "' + v + '": invalid syntax', "Die Replica-Zahl ist eine ganze Zahl ab 0, z.B. '--replicas=2'.") };
  }
  return { replicas: parseInt(v, 10) };
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

/* ---- Wertprüfer der Flag-Tabelle (#1487): lehnen ungültige Werte ab, statt sie still zu verbiegen ---- */

type ErrOnly = Pick<KubectlHost, "_err">;

/** `--port`: ein String (kubectl `expose.go`), den `strconv.Atoi` je Eintrag der Komma-Liste liest; der Fehler wird
 *  unverändert durchgereicht. Mehrere Ports legt die Sim nicht an. Leer = nicht angegeben (der Handler meldet es). */
function checkPort(host: ErrOnly, v: string): string | null {
  if (v === "") return null;
  const parts = v.split(",");
  for (const p of parts) if (!/^[+-]?\d+$/.test(p)) return host._err('error: strconv.Atoi: parsing "' + p + '": invalid syntax', "Der Port ist eine ganze Zahl, z.B. '--port=80'.");
  return parts.length > 1 ? notSimulated(host, "mehrere Ports in '--port=" + v + "'.", ["kubectl expose deployment <name> --port=80"]) : null;
}

/** `--from-literal=<key>=<value>`: ohne `=` oder mit leerem Schlüssel lehnt kubectl die Angabe ab. */
function checkLiteral(host: ErrOnly, v: string): string | null {
  return v.indexOf("=") > 0 ? null : host._err("error: invalid literal source " + v + ", expected key=value", "Muster: '--from-literal=schluessel=wert'.");
}

/** `--serviceaccount=<namespace>:<name>`: genau zwei nicht-leere Teile. */
function checkServiceAccount(host: ErrOnly, v: string): string | null {
  const parts = v.split(":");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "" ? null : host._err("error: serviceaccount must be <namespace>:<name>", "Muster: '--serviceaccount=default:deploy-bot'.");
}

/** Die Dimensionen von `set resources`, die die Sim kennt: Mengen-Parser und Beispiel-Tipp je Schlüssel. */
const RESOURCE_KEYS: Readonly<Record<string, { parse: (v: string) => number | null; tip: string }>> = {
  memory: { parse: parseMem, tip: "Schreib die Menge z.B. als '256Mi' oder '1Gi'." },
  cpu: { parse: parseCpuMilli, tip: "Schreib die CPU z.B. als '200m' oder '0.5'." },
  "ephemeral-storage": { parse: parseMem, tip: "Schreib die Menge z.B. als '512Mi' oder '1Gi'." },
};

/** Die geparste Mengenliste von `--limits`/`--requests`: Memory und ephemeral-storage in Mi, CPU in Milli-Cores. */
export interface ResourceList { memory?: number; cpu?: number; ephemeral?: number }

/** `memory=256Mi,cpu=200m` wie `parseResourceList` in kubectl (`set_resources.go`): jede Angabe `<ressource>=<menge>`,
 *  sonst `invalid argument syntax`; eine ungültige Menge ist `invalid resource quantity`, eine unbekannte Ressource
 *  „nicht simuliert“. Leer/`null` = keine Angabe. Ein String ist die fertige Fehlerausgabe. */
export function parseResourceList(host: ErrOnly, spec: string | null): ResourceList | string {
  const out: ResourceList = {};
  if (!spec) return out;
  for (const stmt of spec.split(",")) {
    const parts = stmt.split("=");
    if (parts.length !== 2) return host._err("error: invalid argument syntax " + stmt + ", expected <resource>=<value>", "Muster: '--limits=memory=256Mi,cpu=200m'.");
    const [key, qty] = parts;
    const dim = subEntry(RESOURCE_KEYS, key);
    if (!dim) return notSimulated(host, "die Ressource '" + key + "' bei 'kubectl set resources'.", ["--limits/--requests mit " + Object.keys(RESOURCE_KEYS).join(", ")]);
    const n = dim.parse(qty);
    if (n === null) return host._err('error: invalid resource quantity "' + qty + '"', dim.tip);
    if (key === "memory") out.memory = n; else if (key === "cpu") out.cpu = n; else out.ephemeral = n;
  }
  return out;
}

function checkResourceList(host: ErrOnly, v: string): string | null {
  const r = parseResourceList(host, v);
  return typeof r === "string" ? r : null;
}

/** `set env --from=<art>/<name>`: nur configmap und secret (Kurz- und Pluralformen der Registry). */
export function parseFromRef(host: ErrOnly, v: string): { kind: "configmaps" | "secrets"; name: string } | string {
  const ref = slashRef(v);
  const kann = ["kubectl set env deployment/<name> --from=configmap/<name>|secret/<name>"];
  if (!ref) return notSimulated(host, "'--from=" + v + "' ohne Art.", kann, "Muster: kubectl set env deployment/<name> --from=configmap/<name>");
  if ("error" in ref) return host._err(ref.error);
  const plural = resolveKind(ref.typ)?.plural;
  if (plural !== "configmaps" && plural !== "secrets") return notSimulated(host, "'--from=" + ref.typ + "/…': nur configmap oder secret.", kann);
  return { kind: plural, name: ref.name };
}

function checkFromRef(host: ErrOnly, v: string): string | null {
  const r = parseFromRef(host, v);
  return typeof r === "string" ? r : null;
}

/** Genau ein NAME (`create deployment a b` → `error: exactly one NAME is required, got 2`); `null` = passt, sonst die
 *  fertige Fehlerausgabe mit dem deutschen Muster als Tipp. */
export function exactlyOneName(host: ErrOnly, names: readonly string[], muster: string): string | null {
  return names.length === 1 ? null : host._err("error: exactly one NAME is required, got " + names.length, muster);
}
