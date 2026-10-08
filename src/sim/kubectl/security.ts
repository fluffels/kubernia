/* ===== Kubernia – kubectl Security (sim/kubectl/security.ts) =====
 * RBAC-Auswertung (#126) + Pod-Security-Admission (#128): die beiden Sicherheits-
 * Mechaniken der kubectl-Familie an EINEM Ort.
 *  - `kubectl auth can-i` (RBAC): `subjectKeyOf`/`asKey`/`canI` + `kubectlAuth`.
 *  - Pod-Security-Stufe per Namespace-Label setzen (`kubectlLabel`) und Pods dagegen
 *    prüfen (`admitPod`, Kern `podSecurityViolations`). `admitPod` ruft nur ./rollout.
 *
 * Phaser-frei (pure Domäne): hängt nur an den Domänentypen aus ../state und am
 * KubectlHost-Interface (./host). Kein Rückimport (kein Zyklus).
 */
import { DEFAULT_NAMESPACE, type PodSecurityLevel, type RbacSubject, type SecurityContext } from "../state";
import { roleMatchesRef } from "../rbac";
import type { KubectlHost } from "./host";
import { notSimulated } from "./args";
import { resolveKind } from "./resources";
import { subEntry, type Call } from "../cliargs";

/* ---- RBAC-Auswertung (#126) ---- */

/** Subjekt → stabiler Schlüssel, damit Bindungs-Subjekt und `--as`-Anfrage vergleichbar sind.
 *  User → "user:<name>", ServiceAccount → "sa:<ns>:<name>". */

function subjectKeyOf(host: KubectlHost, s: RbacSubject): string {
  return s.kind === "ServiceAccount" ? "sa:" + (s.namespace || DEFAULT_NAMESPACE) + ":" + s.name : "user:" + s.name;
}

/** `--as`-Wert (oder null) in einen Subjekt-Schlüssel übersetzen.
 *  Akzeptiert "system:serviceaccount:<ns>:<sa>" (SA) und sonst "<user>" (User). */

function asKey(as: string | null): string | null {
  if (!as) return null;
  const m = as.match(/^system:serviceaccount:([^:]+):(.+)$/);
  if (m) return "sa:" + m[1] + ":" + m[2];
  return "user:" + as;
}

/** Darf das Subjekt (Schlüssel) `verb` auf `resource`? null = Admin (kein --as) → alles erlaubt. */

function canI(host: KubectlHost, verb: string, resource: string, subjectKey: string | null): boolean {
  if (subjectKey === null) return true; // ohne --as fragt man die eigenen (Admin-)Rechte ab
  for (const b of host.roleBindings) {
    if (!b.subjects.some(s => subjectKeyOf(host, s) === subjectKey)) continue;
    const role = host.roles.find(r => roleMatchesRef(r, b.roleRef));
    if (!role) continue; // baumelnde Referenz: gewährt nichts
    for (const rule of role.rules) {
      const verbOk = rule.verbs.includes("*") || rule.verbs.includes(verb);
      const resOk = rule.resources.includes("*") || rule.resources.includes(resource);
      if (verbOk && resOk) return true;
    }
  }
  return false;
}


/** `kubectl auth can-i <verb> <resource>` – genau zwei Argumente wie in kubectl (`cani.go`); `<resource>/<name>` wertet nur
 *  den Typ aus (die Sim-Rollen kennen keine `resourceNames`), ein führendes `/` ist eine Non-Resource-URL. */
function authCanI(host: KubectlHost, c: Call): string {
  const [verb, target] = c.args.slice(1);
  if (c.args.length !== 3) return host._err("error: you must specify two arguments: verb resource or verb resource/resourceName.", "Muster: kubectl auth can-i get pods --as=system:serviceaccount:default:deploy-bot");
  if (target.startsWith("/")) return notSimulated(host, "'kubectl auth can-i " + verb + " " + target + "' (Non-Resource-URL).", ["kubectl auth can-i <verb> <resource>[/<name>] [--as=…]"]);
  const resource = target.split("/")[0];
  return canI(host, verb, resource, asKey(c.value("--as"))) ? "yes" : "no";
}

/** Die `auth`-Aktionen (#1487): ein Eintrag je Aktion; `c.args` beginnt bei der Aktion. */
const AUTH_ACTIONS: Readonly<Record<string, (host: KubectlHost, c: Call) => string>> = { "can-i": authCanI };

export function kubectlAuth(host: KubectlHost, c: Call) {
  const action = c.args[0] ?? "";
  const run = subEntry(AUTH_ACTIONS, action);
  return run ? run(host, c) : notSimulated(host, "'kubectl auth " + action + "'.", ["kubectl auth can-i <verb> <resource> [--as=…]"]);
}

/* ---- Pod-Security-Admission (#126) ---- */

/** Das einzige Label, das die Sim auswertet (samt `=`). */
const ENFORCE_LABEL = "pod-security.kubernetes.io/enforce=";

/** Setzt die durchgesetzte Stufe per Namespace-Label, z.B.
 *  `kubectl label namespace default pod-security.kubernetes.io/enforce=restricted`. */

export function kubectlLabel(host: KubectlHost, c: Call) {
  const LABEL_USAGE = "kubectl label namespaces <ns> pod-security.kubernetes.io/enforce=<stufe>";
  if (resolveKind(c.args[0] ?? "")?.plural !== "namespaces") return notSimulated(host, "'kubectl label " + (c.args[0] ?? "") + "'.", [LABEL_USAGE]);
  const nsName = c.args[1];
  if (!nsName) return host._err("kubectl label namespace: Welcher Namespace?", "Muster: kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
  const label = c.args.slice(2).find(a => a.startsWith(ENFORCE_LABEL));
  if (label === undefined) return notSimulated(host, "dieses Label.", [LABEL_USAGE], "Nur 'pod-security.kubernetes.io/enforce=<stufe>' wertet der Simulator aus (z.B. baseline oder restricted).");
  const level = label.slice(ENFORCE_LABEL.length);
  if (level !== "privileged" && level !== "baseline" && level !== "restricted") {
    return host._err('error: unbekannte Pod-Security-Stufe "' + level + '"', "Erlaubt sind: privileged, baseline, restricted.");
  }
  host.podSecurity = level;
  return "namespace/" + nsName + " labeled";
}

/** Der pure Kern der Pod-Security-Prüfung: die Verstöße eines securityContext gegen eine Stufe
 *  (leer = zugelassen). privileged = nie ein Verstoß. */
export function podSecurityViolations(level: PodSecurityLevel, sc: SecurityContext | undefined): string[] {
  if (level === "privileged") return [];
  const ctx = sc || {};
  const violations: string[] = [];
  // baseline UND restricted: keine privilegierten Container.
  if (ctx.privileged === true) violations.push("privileged=true ist verboten");
  if (level === "restricted") {
    // restricted verlangt zusätzlich nicht-root + keine Rechte-Eskalation.
    if (ctx.runAsNonRoot !== true) violations.push("runAsNonRoot muss true sein");
    if (ctx.allowPrivilegeEscalation !== false) violations.push("allowPrivilegeEscalation muss false sein");
  }
  return violations;
}

/** Prüft einen Pod gegen die durchgesetzte Stufe. Rückgabe: null = zugelassen,
 *  sonst die (deutsche) Ablehnungs-Begründung. Nur aus ./rollout gerufen (der eine Weg „neue Pods“). */

export function admitPod(host: Pick<KubectlHost, "podSecurity">, name: string, sc: SecurityContext | undefined): string | null {
  const level = host.podSecurity;
  const violations = podSecurityViolations(level, sc);
  if (violations.length === 0) return null;
  return 'Error from server (Forbidden): admission webhook "pod-security" denied the request: '
    + "Pod '" + name + "' verletzt die Pod-Security-Stufe '" + level + "': " + violations.join(", ") + ".";
}
