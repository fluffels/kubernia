/* ===== Inhalte: Minispiel „Routing-Lotse" (#569) =====
 * Wie eine Anfrage von außen beim richtigen Pod landet – Ingress → Service
 * (Label-Selector) → Pod – bleibt als Quiz abstrakt. Als Lotsen-Spiel wird der
 * Weg (und die Rolle der Labels) greifbar. Reine Domäne (kein Phaser, unit-
 * testbar): Rundendaten + der Match-/Routing-Kern, den `src/ui/routing.ts`
 * für Sofort-Feedback nutzt.
 */

/** Ein Pod mit seinen Labels. */
export interface RoutingPod {
  name: string;
  labels: Record<string, string>;
}

/** Ein Service mit seinem Selector (Kubernetes-Semantik: ALLE Paare müssen ein
 *  Pod-Label exakt treffen, sonst gehört der Pod nicht zum Service). */
export interface RoutingService {
  name: string;
  selector: Record<string, string>;
}

/** Eine Ingress-Regel: exakter Pfad → Ziel-Service (kein Prefix-Matching, bewusst
 *  einfach gehalten wie `pathType: Exact`). */
export interface RoutingIngressRule {
  path: string;
  service: string;
}

/** Eine einzelne Anfrage dieser Runde: entweder direkt an einen Service adressiert
 *  (Runden ohne Ingress-Ebene) oder über einen Pfad, der erst per Ingress-Regel
 *  aufgelöst werden muss. Genau eines von beiden ist gesetzt. */
export interface RoutingRequest {
  label: string;
  path?: string;
  service?: string;
}

export interface RoutingRound {
  name: string;
  /** Leer = diese Runde hat noch keine Ingress-Ebene (nur Service→Pod). */
  ingressRules: RoutingIngressRule[];
  services: RoutingService[];
  pods: RoutingPod[];
  requests: RoutingRequest[];
  /** HTML-Lektion, gezeigt nach geschaffter Runde. */
  tip: string;
}

/* Runden sind nach Komplexität AUFSTEIGEND sortiert (Vorbild #218 STACK_ROUNDS):
 * erst nur Service→Pod (Label-Match), dann der leere-Endpoints-Fall, dann Ingress
 * davor, zuletzt mehrere Services/Pods mit einem Label-Near-Miss als Ablenkung. */
export const ROUTING_ROUNDS: RoutingRound[] = [
  {
    name: "Nur der Dienst",
    ingressRules: [],
    services: [
      { name: "kasse", selector: { app: "kasse" } },
      { name: "lager", selector: { app: "lager" } },
    ],
    pods: [
      { name: "kasse-1", labels: { app: "kasse" } },
      { name: "lager-1", labels: { app: "lager" } },
      { name: "funk-1", labels: { app: "funk" } },
    ],
    requests: [
      { label: "Anfrage an kasse", service: "kasse" },
      { label: "Anfrage an lager", service: "lager" },
    ],
    tip: "Ein <b>Service</b> findet seine Pods nie über den Namen der Anfrage, sondern über <b>Labels</b>: Er schickt Traffic an jeden Pod, dessen Labels seinen <b>Selector</b> vollständig erfüllen.",
  },
  {
    name: "Leere Endpoints",
    ingressRules: [],
    services: [
      { name: "kasse", selector: { app: "kasse" } },
      { name: "warteschlange", selector: { app: "warteschlange" } },
    ],
    pods: [
      { name: "kasse-1", labels: { app: "kasse" } },
      { name: "lager-1", labels: { app: "lager" } },
    ],
    requests: [
      { label: "Anfrage an kasse", service: "kasse" },
      { label: "Anfrage an warteschlange", service: "warteschlange" },
    ],
    tip: "Passt <b>kein</b> Pod-Label zum Selector, hat der Service <b>keine Endpoints</b> – die Anfrage läuft ins Leere. Kein Absturz, nur „niemand da“ (genau das würde <code>kubectl get endpoints</code> mit <code>&lt;none&gt;</code> zeigen).",
  },
  {
    name: "Vor die Tür gestellt",
    ingressRules: [
      { path: "/shop", service: "kasse" },
      { path: "/wiki", service: "logbuch" },
    ],
    services: [
      { name: "kasse", selector: { app: "kasse" } },
      { name: "logbuch", selector: { app: "logbuch" } },
    ],
    pods: [
      { name: "kasse-1", labels: { app: "kasse" } },
      { name: "logbuch-1", labels: { app: "logbuch" } },
    ],
    requests: [
      { label: "GET /shop", path: "/shop" },
      { label: "GET /wiki", path: "/wiki" },
    ],
    tip: "Vor dem Service steht oft ein <b>Ingress</b>: Er schaut nur auf den <b>Pfad</b> der Anfrage und reicht sie an den passenden Service weiter. Ab da gilt wieder dieselbe Regel: Service-Selector → Pod-Label.",
  },
  {
    name: "Viele Weichen",
    ingressRules: [
      { path: "/kasse", service: "kasse" },
      { path: "/lager", service: "lager" },
    ],
    services: [
      { name: "kasse", selector: { app: "kasse", tier: "prod" } },
      { name: "lager", selector: { app: "lager" } },
    ],
    pods: [
      { name: "kasse-prod-1", labels: { app: "kasse", tier: "prod" } },
      { name: "kasse-test-1", labels: { app: "kasse", tier: "test" } },
      { name: "lager-1", labels: { app: "lager" } },
    ],
    requests: [
      { label: "GET /kasse", path: "/kasse" },
      { label: "GET /lager", path: "/lager" },
    ],
    tip: "Ein Selector mit <b>mehreren</b> Label-Paaren muss ALLE zugleich treffen – <code>kasse-test-1</code> trägt zwar <code>app=kasse</code>, aber <code>tier=test</code> statt <code>tier=prod</code>. Schon EIN falsches Paar reicht, damit der Pod NICHT zum Service gehört.",
  },
];

/** Prüft, ob ein Pod den Selector eines Service erfüllt: JEDES Selector-Label-Paar
 *  muss am Pod mit demselben Wert vorkommen (Kubernetes-Semantik: der Selector ist
 *  eine UND-verknüpfte Teilmengen-Bedingung, keine reine Schlüssel-Existenzprüfung –
 *  zusätzliche, vom Selector nicht verlangte Pod-Labels stören nicht). */
export function podMatchesSelector(pod: RoutingPod, selector: Record<string, string>): boolean {
  return Object.entries(selector).every(([k, v]) => pod.labels[k] === v);
}

/** Alle Pods, die dem Selector eines Service entsprechen – die „Endpoints". Leer =
 *  der Service hat aktuell niemanden, der bedient. */
export function matchingPods(pods: RoutingPod[], selector: Record<string, string>): RoutingPod[] {
  return pods.filter((p) => podMatchesSelector(p, selector));
}

export interface RoutingCheck {
  ok: boolean;
  reason?: string;
}

/** Prüft die gewählte Ingress-Regel gegen den tatsächlichen Pfad der Anfrage. */
export function checkIngressChoice(requestPath: string, chosenRulePath: string): RoutingCheck {
  if (chosenRulePath !== requestPath) {
    return { ok: false, reason: `„${chosenRulePath}“ ist die falsche Route – die Anfrage kam über den Pfad „${requestPath}“ rein.` };
  }
  return { ok: true };
}

/** Prüft, ob der gewählte Pod tatsächlich zum Selector des Ziel-Service passt. */
export function checkPodChoice(pods: RoutingPod[], selector: Record<string, string>, chosenPodName: string): RoutingCheck {
  const pod = pods.find((p) => p.name === chosenPodName);
  if (!pod) return { ok: false, reason: "Unbekannter Pod." };
  if (!podMatchesSelector(pod, selector)) {
    const mismatch = Object.entries(selector).find(([k, v]) => pod.labels[k] !== v)!;
    const have = pod.labels[mismatch[0]] ?? "fehlt";
    return {
      ok: false,
      reason: `<b>${pod.name}</b> passt nicht – Label <code>${mismatch[0]}=${have}</code>, der Selector will aber <code>${mismatch[0]}=${mismatch[1]}</code>.`,
    };
  }
  return { ok: true };
}

/** Prüft, ob „keine passenden Endpoints" für diesen Selector WIRKLICH korrekt ist. */
export function checkNoEndpoints(pods: RoutingPod[], selector: Record<string, string>): RoutingCheck {
  if (matchingPods(pods, selector).length > 0) {
    return { ok: false, reason: "Nicht ganz – es gibt tatsächlich einen passenden Pod. Schau nochmal genau auf die Labels." };
  }
  return { ok: true };
}
