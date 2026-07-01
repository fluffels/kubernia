/* ===== KubeQuest – Value Objects für Ressourcen-Namen (sim/names.ts) =====
 * Schrittweise Value-Object-Einführung (#479, DDD); auf ALLE Ressourcennamen
 * verallgemeinert (#507).
 *
 * Ein Ressourcen-/Pod-Name ist im echten Kubernetes KEIN beliebiger String,
 * sondern folgt der DNS-1123-Regel – Deployment, Service, Secret, StatefulSet, PVC …
 * teilen sie alle. Bisher wurde der Name überall als nackter `string` geführt:
 * verwechselbar (jeder String passt in jedes Namensfeld) und ungeprüft (die Regel
 * lebte nur an EINER Call-Site, `kubectl create`, #489 – alle anderen Anlege-Wege
 * umgingen sie). Hier bündeln wir Regel + prüfenden Constructor an EINER Stelle,
 * damit illegale Namen an der Anlege-Grenze nicht mehr durchrutschen.
 *
 * `ResourceName` ist der allgemeine Wert (jede DNS-1123-Ressource); `PodName` ist
 * derselbe Wert unter sprechendem Namen für Pod-Instanzen (die im Simulator am
 * meisten „wandern": scale/rollout/restart erzeugen sie ständig neu).
 *
 * **Branded Type:** zur Laufzeit ist ein `ResourceName`/`PodName` ein ganz normaler
 * String – kein Overhead, und er serialisiert unverändert (Spielstände bleiben
 * unberührt, #350). Der Compiler unterscheidet ihn aber von einem beliebigen
 * `string` und zwingt so jede Herkunft durch die Fabriken hier.
 *
 * **Zwei Fabriken, ein Zweck:** `resourceName()` prüft (für Namen aus Nutzer-/
 * Content-Quelle, wirft `InvalidResourceNameError`), `asResourceName()`/`asPodName()`
 * branden ungeprüft (für vertrauenswürdige, intern erzeugte Namen). Die _make*-
 * Fabriken in `sim.ts` (#507) rufen `resourceName()` und machen die Grenze damit
 * zentral statt pro Call-Site.
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

/** Die kubectl-Server-Fehlermeldung für einen DNS-1123-verletzenden Namen (englischer
 *  Wortlaut wie echtes kubectl). `kind` optional – ist der K8s-Objekttyp bekannt
 *  (z.B. "Deployment"), kommt die volle `metadata.name`-Form, sonst die knappe. Die
 *  EINE Quelle dieses Textes: `kubectl create` (#489) und die _make*-Fabriken (#507)
 *  teilen sie, damit ein ungültiger Name überall dieselbe Meldung ergibt. */
export function rfc1123ErrorText(raw: string, kind?: string): string {
  const subject = kind ? 'The ' + kind + ' "' + raw + '" is invalid: metadata.name' : '"' + raw + '" is invalid';
  return subject + ': Invalid value: "' + raw +
    "\": a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', " +
    "and must start and end with an alphanumeric character";
}

/** Der deutsche Erklär-Tipp zur DNS-1123-Regel (fürs `_err`-Hint der Aufrufer). */
export const RFC1123_TIP =
  "Kubernetes-Namen folgen der DNS-1123-Regel: nur Kleinbuchstaben, Ziffern und '-', " +
  "Anfang und Ende alphanumerisch (z.B. 'web-app' statt 'WebApp' oder 'web_app').";

/** Fehler des prüfenden Smart-Constructors: der Wert verletzt die DNS-1123-Regel.
 *  Trägt den rohen Namen (`raw`), damit die Aggregat-Grenze (`Sim.exec`) daraus die
 *  richtige kubectl-Meldung bauen kann, statt eines generischen „Hoppla". */
export class InvalidResourceNameError extends Error {
  constructor(public readonly raw: string) {
    super(rfc1123ErrorText(raw));
    this.name = "InvalidResourceNameError";
  }
}

/** Der allgemeine, geprüfte Ressourcen-Namen-Typ. Branded: zur Laufzeit ein String,
 *  für den Compiler ein eigener Typ, den nur die Fabriken unten erzeugen. */
export type ResourceName = string & { readonly __brand: "ResourceName" };

/** Ein Pod-Name IST ein Ressourcenname (#507) – eigener Name nur zur Lesbarkeit an den
 *  Pod-Instanzen (`PodInstance.name`). */
export type PodName = ResourceName;

/** Prüfender Smart-Constructor: brandet `raw` als `ResourceName` oder wirft
 *  `InvalidResourceNameError`, wenn er die DNS-1123-Regel verletzt. Für Namen aus
 *  unsicherer Quelle (Nutzereingaben an der Anlege-Grenze, Content-JSON). Die
 *  _make*-Fabriken in `sim.ts` rufen ihn – so lebt die Prüfung zentral (#507). */
export function resourceName(raw: string): ResourceName {
  if (!isResourceName(raw)) throw new InvalidResourceNameError(raw);
  return raw as ResourceName;
}

/** Ungeprüfte Brand-Fabrik für **vertrauenswürdige, intern erzeugte** Namen. Bewusst
 *  ohne Prüfung: der Aufrufer garantiert die Herkunft. */
export function asResourceName(raw: string): ResourceName {
  return raw as ResourceName;
}

/** Ungeprüfte Brand-Fabrik für **intern erzeugte** Pod-Namen (z.B. aus `makePodName`,
 *  oder die stabilen StatefulSet-Namen `<sts>-<ordinal>`, deren Basis-Name bereits an
 *  der Fabrik-Grenze geprüft wurde). Ein Wurf mitten in der Zustandsmutation wäre
 *  schlechter als ein (per Konstruktion gültiger) Pod-Name. */
export function asPodName(raw: string): PodName {
  return raw as PodName;
}
