/* ===== KubeQuest – Gefahren-Entscheidungskern (hazards.ts) =====
 * Pure Domäne (kein Phaser/UI/Game), damit die *spielentscheidende* Logik der
 * Zufalls-Gefahren (Piraten/Krake/Sturm) im Node-Test prüfbar ist (#512). Die
 * Präsentation (`src/scenes/worldscene/events.ts`) führt nur noch die Effekte
 * aus (Boot spawnen, Alarm zeigen, Belohnung/Strafe buchen) und fragt hier, WAS
 * zu tun ist.
 *
 * Vorher steckten Belohnung/Strafe (Kraken-Fail → Dublonen-Klau, Sturm behoben →
 * Bonus) untrennbar zwischen `scene.rain.start()`/`cameras.flash`/`UI.showAlarm`
 * und waren nur über den e2e-Smoke erreichbar – der NPC-Nähe-Flows bewusst
 * ausspart. Der reine Kern hier macht genau die Entscheidungen testbar:
 *   - welche Gefahr *startet* (Freischalt-Gate + „nur eine gleichzeitig")
 *   - welches Deployment eine Gefahr überhaupt treffen *kann* (Opfer-Eignung)
 *   - welche laufende Gefahr sich *auflöst* (Erfolg/Deadline) bzw. nur tickt
 *
 * Bewusst import-frei mit eigenen, minimalen Sichten (`ActiveHazards`/
 * `HazardClusterView`) statt Kopplung an die Sim-/Szenen-Typen – ein Leaf ohne
 * Zyklus-Risiko. Die konkreten Szenen-/Sim-Objekte erfüllen diese Sichten
 * strukturell (sie tragen nur zusätzliche Phaser-Felder).
 */

export type HazardKind = "pirate" | "kraken" | "storm";

/** Quest-ID, die eine Gefahr freischaltet – vorher taucht sie nie auf. EINE
 *  Quelle für das Freischalt-Gate (vorher je Gefahr inline in tryStart…). */
export const HAZARD_UNLOCK: Record<HazardKind, string> = {
  storm: "k8s-node-capacity",
  pirate: "k8s-self-healing",
  kraken: "kraken-boss",
};

/** Laufende Gefahren-Sicht, die der Entscheidungskern braucht – die konkreten
 *  `Hazards`-Felder der Szene tragen zusätzlich Phaser-Objekte (boat/kraken),
 *  erfüllen diese schmalere Sicht aber strukturell. */
export interface ActiveHazards {
  pirate: { dep: string; want: number; until: number } | null;
  kraken: { baseline: number; until: number } | null;
  storm: { dep: string; until: number } | null;
}

/** Cluster-Sicht, die der Kern braucht (statt der ganzen Sim). */
export interface HazardClusterView {
  deployments: readonly { name: string; replicas: number; broken: unknown }[];
  secretCount: number;
}

/** Was die Präsentation nach einem Tick tun soll: eine Gefahr auflösen
 *  (Erfolg/Misserfolg) oder nur den Alarm-Countdown weiterzählen. */
export type HazardAction =
  | { kind: HazardKind; type: "resolve"; success: boolean }
  | { kind: HazardKind; type: "tick"; secondsLeft: number };

/** Darf eine Gefahr gerade starten? Freigeschaltet (Quest erledigt), das
 *  Gefahren-System aktiv (Spiel-Feel #71) und keine andere Gefahr aktiv
 *  („nur eine gleichzeitig"). */
export function hazardStartable(
  kind: HazardKind,
  gate: { enabled: boolean; anyActive: boolean; completedQuests: readonly string[] },
): boolean {
  return gate.enabled && !gate.anyActive && gate.completedQuests.includes(HAZARD_UNLOCK[kind]);
}

/** Deployments, die der Sturm treffen kann: die (noch) nicht kaputten. */
export function stormVictims<T extends { broken: unknown }>(deployments: readonly T[]): T[] {
  return deployments.filter(d => !d.broken);
}

/** Deployments, die die Piraten überfallen können: mit >= 2 Repliken (damit
 *  überhaupt etwas zu klauen bleibt). */
export function pirateVictims<T extends { replicas: number }>(deployments: readonly T[]): T[] {
  return deployments.filter(d => d.replicas >= 2);
}

/** Der Kern: entscheidet pro laufender Gefahr, ob sie sich auflöst (Erfolg oder
 *  abgelaufene Deadline) oder nur weitertickt. Reihenfolge Sturm→Piraten→Krake
 *  wie im früheren inline-Block; da nur eine Gefahr gleichzeitig aktiv ist,
 *  liefert er praktisch höchstens eine Aktion.
 *
 *  - Sturm: behoben, sobald sein Deployment weg oder repariert ist.
 *  - Piraten: besiegt, sobald das Deployment wieder auf `want` Repliken ist.
 *  - Krake: vertrieben, sobald ein neues Secret existiert (secrets > baseline).
 *  Sonst: abgelaufene Deadline → Misserfolg; andernfalls nur Countdown ticken.
 */
export function resolveHazardTick(
  active: ActiveHazards,
  view: HazardClusterView,
  now: number,
): HazardAction[] {
  const actions: HazardAction[] = [];

  const storm = active.storm;
  if (storm) {
    const dep = view.deployments.find(d => d.name === storm.dep);
    if (!dep || !dep.broken) actions.push({ kind: "storm", type: "resolve", success: true });
    else if (now > storm.until) actions.push({ kind: "storm", type: "resolve", success: false });
    else actions.push({ kind: "storm", type: "tick", secondsLeft: Math.ceil(storm.until - now) });
  }

  const pirate = active.pirate;
  if (pirate) {
    const dep = view.deployments.find(d => d.name === pirate.dep);
    if (dep && dep.replicas >= pirate.want) actions.push({ kind: "pirate", type: "resolve", success: true });
    else if (now > pirate.until) actions.push({ kind: "pirate", type: "resolve", success: false });
    else actions.push({ kind: "pirate", type: "tick", secondsLeft: Math.ceil(pirate.until - now) });
  }

  const kraken = active.kraken;
  if (kraken) {
    if (view.secretCount > kraken.baseline) actions.push({ kind: "kraken", type: "resolve", success: true });
    else if (now > kraken.until) actions.push({ kind: "kraken", type: "resolve", success: false });
    else actions.push({ kind: "kraken", type: "tick", secondsLeft: Math.ceil(kraken.until - now) });
  }

  return actions;
}
