/* ===== Inhalte: Minispiel „RBAC-Schlüsselbund" (#571) =====
 * RBAC als Schlüssel-passt-ins-Schloss-Puzzle: zu jedem Subjekt + Aufgabe (Verb×Ressource)
 * den KLEINSTEN passenden Schlüssel (Role/ClusterRole) aus dem Bund wählen – Least Privilege
 * greifbar statt trocken. Reine Domäne (kein Phaser, unit-testbar): Rundendaten + der
 * Grant-/Breite-Kern, den `src/ui/rbaskeyring.ts` für Sofort-Feedback nutzt.
 */

/** Eine PolicyRule wie im Simulator (`src/sim/state.ts`): verbs/resources, "*" = alles. */
export interface RbacKeyringRule {
  verbs: string[];
  resources: string[];
}

/** Ein wählbarer Schlüssel: Role (namespaced) oder ClusterRole (`cluster: true`). */
export interface RbacKeyringOption {
  name: string;
  cluster: boolean;
  rules: RbacKeyringRule[];
}

/** Die Aufgabe eines Subjekts: braucht `verb` auf `resource`. `clusterOnly` markiert eine
 *  NICHT-namespaced Ressource (z.B. nodes) – die kann NUR eine ClusterRole abdecken,
 *  unabhängig davon, was ihre `rules` erlauben. */
export interface RbacKeyringTask {
  subject: string;
  verb: string;
  resource: string;
  clusterOnly?: boolean;
}

export interface RbacKeyringRound {
  name: string;
  /** Der Schlüsselbund dieser Runde – dieselben Optionen gelten für alle `tasks`. */
  options: RbacKeyringOption[];
  tasks: RbacKeyringTask[];
  /** HTML-Lektion, gezeigt nach geschaffter Runde. */
  tip: string;
}

/* Runden sind nach Schwierigkeit AUFSTEIGEND sortiert (Vorbild #218 STACK_ROUNDS): erst eine
 * namespaced Role, dann eine cluster-weite Ressource (nur eine ClusterRole kann sie abdecken),
 * zuletzt eine Falle mit einer Option, die zwar auch passt, aber unnötig mehr erlaubt als
 * die Aufgabe braucht. */
export const RBAC_KEYRING_ROUNDS: RbacKeyringRound[] = [
  {
    name: "Erster Schlüssel",
    options: [
      { name: "pod-leser", cluster: false, rules: [{ verbs: ["get", "list", "watch"], resources: ["pods"] }] },
      { name: "alles-leser", cluster: false, rules: [{ verbs: ["get", "list", "watch"], resources: ["*"] }] },
      { name: "schreibrecht", cluster: false, rules: [{ verbs: ["create", "delete"], resources: ["pods"] }] },
    ],
    tasks: [
      { subject: "spaehposten", verb: "get", resource: "pods" },
      { subject: "kontrolleur", verb: "create", resource: "pods" },
    ],
    tip: "<b>pod-leser</b> erlaubt GENAU <code>get/list/watch</code> auf <code>pods</code> – nicht mehr. <b>alles-leser</b> hätte auch gereicht, deckt aber JEDE Ressource ab – unnötig breit. <b>schreibrecht</b> passt nur für andere Verben.",
  },
  {
    name: "Rundblick nötig",
    options: [
      { name: "pod-leser", cluster: false, rules: [{ verbs: ["get", "list", "watch"], resources: ["nodes"] }] },
      { name: "knoten-spaeher", cluster: true, rules: [{ verbs: ["get", "list", "watch"], resources: ["nodes"] }] },
      { name: "admin-clusterrole", cluster: true, rules: [{ verbs: ["*"], resources: ["*"] }] },
    ],
    tasks: [
      { subject: "wachdienst", verb: "list", resource: "nodes", clusterOnly: true },
      { subject: "wachdienst", verb: "get", resource: "nodes", clusterOnly: true },
    ],
    tip: "<b>nodes</b> gehören KEINEM Namespace – eine Role kann sie nie abdecken, auch nicht mit den richtigen Verben (<b>pod-leser</b> ist hier eine Role, keine ClusterRole). <b>knoten-spaeher</b> ist die kleinste ClusterRole, die passt. <b>admin-clusterrole</b> würde auch reichen, ist aber grenzenlos breit.",
  },
  {
    name: "Trichter zu weit",
    options: [
      { name: "secret-leser", cluster: false, rules: [{ verbs: ["get", "list"], resources: ["secrets"] }] },
      { name: "secret-verwalter", cluster: false, rules: [{ verbs: ["get", "list", "create", "update", "delete"], resources: ["secrets"] }] },
      { name: "cluster-admin", cluster: true, rules: [{ verbs: ["*"], resources: ["*"] }] },
    ],
    tasks: [
      { subject: "spaehposten", verb: "get", resource: "secrets" },
      { subject: "kontrolleur", verb: "delete", resource: "secrets" },
    ],
    tip: "Alle drei Optionen hätten so manche Aufgabe erfüllt – aber <b>secret-verwalter</b> erlaubt zusätzlich löschen/ändern, <b>cluster-admin</b> so gut wie alles überall. Nur weil eine Option auch passt, ist sie noch nicht die richtige Wahl: die KLEINSTE passende gewinnt.",
  },
];

/** Erfüllt EINE PolicyRule (verbs/resources, "*" = Wildcard) den Verb+Ressource der Aufgabe? */
export function ruleGrants(rule: RbacKeyringRule, verb: string, resource: string): boolean {
  const verbOk = rule.verbs.includes("*") || rule.verbs.includes(verb);
  const resOk = rule.resources.includes("*") || rule.resources.includes(resource);
  return verbOk && resOk;
}

/** Erfüllt die Option (Role/ClusterRole) die Aufgabe? Bei `clusterOnly` reicht der
 *  Verb/Ressourcen-Treffer allein NICHT – nur eine ClusterRole (`cluster: true`) kann eine
 *  nicht-namespaced Ressource überhaupt abdecken, unabhängig von ihren `rules`. */
export function optionGrants(option: RbacKeyringOption, task: RbacKeyringTask): boolean {
  if (task.clusterOnly && !option.cluster) return false;
  return option.rules.some((r) => ruleGrants(r, task.verb, task.resource));
}

/** Wie "breit" eine Option ist – je größer, desto mehr über eine einzelne Aufgabe hinaus
 *  erlaubt sie. Wildcard-Verben/-Ressourcen zählen groß (100), eine ClusterRole zusätzlich
 *  als cluster-weiter Sprung (+1000) gegenüber einer gleich formulierten Role. Rein zum
 *  ORDNEN der Optionen untereinander gedacht, kein Sicherheits-Score. */
export function optionBreadth(option: RbacKeyringOption): number {
  const rulesBreadth = option.rules.reduce((sum, r) => {
    const v = r.verbs.includes("*") ? 100 : r.verbs.length;
    const res = r.resources.includes("*") ? 100 : r.resources.length;
    return sum + v * res;
  }, 0);
  return rulesBreadth + (option.cluster ? 1000 : 0);
}

export interface RbacKeyringCheck {
  ok: boolean;
  reason?: string;
}

/** Prüft eine gewählte Option gegen die Aufgabe: NICHT ok, wenn sie zu wenig erlaubt (die
 *  Aufgabe schlägt fehl, wie ein `can-i` = no) ODER wenn eine ANDERE Option desselben
 *  Schlüsselbunds dieselbe Aufgabe mit weniger Breite erfüllt (zu viel Recht – kein Least
 *  Privilege, auch wenn es technisch funktioniert hätte). */
export function checkKeyringChoice(options: RbacKeyringOption[], task: RbacKeyringTask, chosenIdx: number): RbacKeyringCheck {
  const chosen = options[chosenIdx];
  if (!optionGrants(chosen, task)) {
    return { ok: false, reason: `<b>${chosen.name}</b> reicht nicht – <code>kubectl auth can-i ${task.verb} ${task.resource}</code> würde mit <b>no</b> antworten.` };
  }
  const narrower = options.find((o, i) => i !== chosenIdx && optionGrants(o, task) && optionBreadth(o) < optionBreadth(chosen));
  if (narrower) {
    return { ok: false, reason: `<b>${chosen.name}</b> würde zwar reichen, ist aber zu breit – <b>${narrower.name}</b> erfüllt dieselbe Aufgabe mit weniger Rechten (Least Privilege).` };
  }
  return { ok: true };
}
