/* ===== KubeQuest – Value Objects für Ressourcen-Namen (sim/names.ts) =====
 * Erster Schritt der schrittweisen Value-Object-Einführung (#479, DDD).
 *
 * Ein Ressourcen-/Pod-Name ist im echten Kubernetes KEIN beliebiger String,
 * sondern folgt der DNS-1123-Regel. Bisher wurde er überall als nackter `string`
 * geführt: verwechselbar (jeder String passt in jedes Namensfeld) und ungeprüft
 * (die Regel lebte nirgends). Hier bündeln wir beides an EINER Stelle hinter einer
 * stabilen API – der Anfang davon, illegale Namen langfristig un-repräsentierbar zu
 * machen. `PodName` ist die erste konkrete Ausprägung (Pod-Namen „wandern" im
 * Simulator am meisten: sie werden bei scale/rollout/restart ständig neu erzeugt).
 *
 * **Branded Type:** zur Laufzeit ist ein `PodName` ein ganz normaler String – kein
 * Overhead, und er serialisiert unverändert (Spielstände bleiben unberührt, #350).
 * Der Compiler unterscheidet ihn aber von einem beliebigen `string` und zwingt so
 * jede Herkunft durch die Fabriken hier: ein roher String landet nicht mehr
 * versehentlich in einem Pod-Namensfeld.
 *
 * Pure Domäne, importfrei – vom Architektur-Wächter (#347) als Domäne geschützt.
 */

/** DNS-1123-Subdomain (RFC 1123), wie Kubernetes Objektnamen fordert: Labels aus
 *  Kleinbuchstaben/Ziffern/Bindestrich (Anfang & Ende alphanumerisch), durch Punkte
 *  getrennt. Ein einzelnes Label ohne Punkt (der Normalfall für Pods) ist inbegriffen. */
const LABEL = "[a-z0-9]([-a-z0-9]*[a-z0-9])?";
const RESOURCE_NAME_RE = new RegExp("^" + LABEL + "(\\." + LABEL + ")*$");
const MAX_LEN = 253;

/** Die EINE Regel: Ist `raw` ein gültiger Kubernetes-Ressourcenname (DNS-1123)? */
export function isResourceName(raw: string): boolean {
  return raw.length >= 1 && raw.length <= MAX_LEN && RESOURCE_NAME_RE.test(raw);
}

/** Fehler eines prüfenden Smart-Constructors: der Wert verletzt die DNS-1123-Regel. */
export class InvalidResourceNameError extends Error {
  constructor(raw: string) {
    super('Invalid value: "' + raw + '": ein Ressourcenname muss der DNS-1123-Regel folgen ' +
      "(Kleinbuchstaben, Ziffern und '-', Anfang und Ende alphanumerisch).");
    this.name = "InvalidResourceNameError";
  }
}

/** Der stabile Pod-Namen-Typ. Branded: zur Laufzeit ein String, für den Compiler
 *  ein eigener Typ, den nur die Fabriken unten erzeugen. */
export type PodName = string & { readonly __brand: "PodName" };

/** Prüfender Smart-Constructor: brandet `raw` als `PodName` oder wirft, wenn er die
 *  DNS-1123-Regel verletzt. Für Namen aus unsicherer Quelle (später: Nutzereingaben
 *  an der Befehlsgrenze). */
export function podName(raw: string): PodName {
  if (!isResourceName(raw)) throw new InvalidResourceNameError(raw);
  return raw as PodName;
}

/** Ungeprüfte Brand-Fabrik für **vertrauenswürdige, intern erzeugte** Namen (z.B. aus
 *  `makePodName`, oder die stabilen StatefulSet-Namen `<sts>-<ordinal>`). Bewusst ohne
 *  Prüfung: der Aufrufer garantiert die Herkunft, und ein Wurf mitten in der
 *  Zustandsmutation wäre schlechter als ein (per Konstruktion gültiger) Name. */
export function asPodName(raw: string): PodName {
  return raw as PodName;
}
