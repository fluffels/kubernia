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
import { flagValueOf, notSimulated, positionals } from "./args";
import { resolveKind } from "./resources";

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


export function kubectlAuth(host: KubectlHost, t: string[], _raw: string) {
  if (t[2] !== "can-i") return notSimulated(host, "'kubectl auth " + (t[2] ?? "") + "'.", ["kubectl auth can-i <verb> <resource> [--as=…]"]);
  // can-i <verb> <resource>; den Wert von --as überspringt die Positions-Suche.
  const positional = positionals("auth", t, 3);
  const verb = positional[0];
  const resource = positional[1];
  if (!verb || !resource) return host._err("kubectl auth can-i: Es fehlt verb oder resource.", "Muster: kubectl auth can-i get pods --as=system:serviceaccount:default:deploy-bot");
  const subjectKey = asKey(flagValueOf(t, ["--as"]));
  return canI(host, verb, resource, subjectKey) ? "yes" : "no";
}

/* ---- Pod-Security-Admission (#126) ---- */

/** Setzt die durchgesetzte Stufe per Namespace-Label, z.B.
 *  `kubectl label namespace default pod-security.kubernetes.io/enforce=restricted`. */

export function kubectlLabel(host: KubectlHost, t: string[], raw: string) {
  const LABEL_USAGE = "kubectl label namespaces <ns> pod-security.kubernetes.io/enforce=<stufe>";
  if (resolveKind(t[2] ?? "")?.plural !== "namespaces") return notSimulated(host, "'kubectl label " + (t[2] ?? "") + "'.", [LABEL_USAGE]);
  const nsName = positionals("label", t, 3)[0];
  if (!nsName) return host._err("kubectl label namespace: Welcher Namespace?", "Muster: kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
  const m = raw.match(/pod-security\.kubernetes\.io\/enforce=(\S+)/);
  if (!m) return notSimulated(host, "dieses Label.", [LABEL_USAGE], "Nur 'pod-security.kubernetes.io/enforce=<stufe>' wertet der Simulator aus (z.B. baseline oder restricted).");
  const level = m[1];
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
