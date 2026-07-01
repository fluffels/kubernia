/* ===== KubeQuest – kubectl Security (sim/kubectl/security.ts) =====
 * RBAC-Auswertung (#126) + Pod-Security-Admission (#128): die beiden Sicherheits-
 * Mechaniken der kubectl-Familie an EINEM Ort.
 *  - `kubectl auth can-i` (RBAC): `subjectKeyOf`/`asKey`/`canI` + `kubectlAuth`.
 *  - Pod-Security-Stufe per Namespace-Label setzen (`kubectlLabel`) und Pods dagegen
 *    prüfen (`admitPod`). `admitPod` wird aus der lifecycle-Familie (create/apply)
 *    gerufen – darum exportiert.
 *
 * Phaser-frei (pure Domäne): hängt nur an den Domänentypen aus ../state und am
 * KubectlHost-Interface (./host). Kein Rückimport (kein Zyklus).
 */
import type { RbacSubject, SecurityContext } from "../state";
import { flagValue } from "../util";
import type { KubectlHost } from "./host";

/* ---- RBAC-Auswertung (#126) ---- */

/** Subjekt → stabiler Schlüssel, damit Bindungs-Subjekt und `--as`-Anfrage vergleichbar sind.
 *  User → "user:<name>", ServiceAccount → "sa:<ns>:<name>". */

function subjectKeyOf(host: KubectlHost, s: RbacSubject): string {
  return s.kind === "ServiceAccount" ? "sa:" + (s.namespace || "default") + ":" + s.name : "user:" + s.name;
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
    const role = host.roles.find(r => r.name === b.roleRef.name && r.cluster === (b.roleRef.kind === "ClusterRole"));
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
  if (t[2] !== "can-i") return host._err("Der Simulator kann nur 'kubectl auth can-i <verb> <resource> [--as=…]'.");
  // can-i <verb> <resource>; --as ignorieren wir bei der Positions-Suche.
  const positional = t.slice(3).filter(tok => !tok.startsWith("-"));
  const verb = positional[0];
  const resource = positional[1];
  if (!verb || !resource) return host._err("kubectl auth can-i: Es fehlt verb oder resource.", "Muster: kubectl auth can-i get pods --as=system:serviceaccount:default:deploy-bot");
  const subjectKey = asKey(flagValue(t, "--as"));
  return canI(host, verb, resource, subjectKey) ? "yes" : "no";
}

/* ---- Pod-Security-Admission (#126) ---- */

/** Setzt die durchgesetzte Stufe per Namespace-Label, z.B.
 *  `kubectl label namespace default pod-security.kubernetes.io/enforce=restricted`. */

export function kubectlLabel(host: KubectlHost, t: string[], raw: string) {
  if (t[2] !== "namespace" && t[2] !== "ns") return host._err("Der Simulator kann nur 'kubectl label namespace <ns> pod-security.kubernetes.io/enforce=<stufe>'.");
  const nsName = t[3];
  if (!nsName || nsName.startsWith("-")) return host._err("kubectl label namespace: Welcher Namespace?", "Muster: kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
  const m = raw.match(/pod-security\.kubernetes\.io\/enforce=(\S+)/);
  if (!m) return host._err("Der Simulator versteht hier nur das Label 'pod-security.kubernetes.io/enforce=<stufe>'.", "z.B. '…/enforce=baseline' oder '…/enforce=restricted'.");
  const level = m[1];
  if (level !== "privileged" && level !== "baseline" && level !== "restricted") {
    return host._err('error: unbekannte Pod-Security-Stufe "' + level + '"', "Erlaubt sind: privileged, baseline, restricted.");
  }
  host.podSecurity = level;
  return "namespace/" + nsName + " labeled";
}

/** Prüft einen Pod gegen die durchgesetzte Stufe. Rückgabe: null = zugelassen,
 *  sonst die (deutsche) Ablehnungs-Begründung. privileged = nie ablehnen. */

export function admitPod(host: KubectlHost, name: string, sc: SecurityContext | undefined): string | null {
  const level = host.podSecurity;
  if (level === "privileged") return null;
  const ctx = sc || {};
  const violations: string[] = [];
  // baseline UND restricted: keine privilegierten Container.
  if (ctx.privileged === true) violations.push("privileged=true ist verboten");
  if (level === "restricted") {
    // restricted verlangt zusätzlich nicht-root + keine Rechte-Eskalation.
    if (ctx.runAsNonRoot !== true) violations.push("runAsNonRoot muss true sein");
    if (ctx.allowPrivilegeEscalation !== false) violations.push("allowPrivilegeEscalation muss false sein");
  }
  if (violations.length === 0) return null;
  return 'Error from server (Forbidden): admission webhook "pod-security" denied the request: '
    + "Pod '" + name + "' verletzt die Pod-Security-Stufe '" + level + "': " + violations.join(", ") + ".";
}
