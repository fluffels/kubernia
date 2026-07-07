/* ===== Inhalte: Minispiel „Wunschzustand einstellen – der Cluster zieht nach" (#570) =====
 * Deklarativ statt imperativ: der Spieler deklariert einen Soll-Zustand (Replicas) und
 * erlebt, wie ein Drift-Ereignis (Ausfall/Hand-Änderung) ihn stört – und dass nur der
 * eingeschaltete Reconcile-Loop den Soll-Zustand dauerhaft hält, eine Hand-Reparatur
 * dagegen nur bis zum nächsten Drift. Reine Domäne (kein Phaser, unit-testbar):
 * Rundendaten + der Reconcile-Kern, den `src/ui/driftheal.ts` für Feedback und
 * Rundenabschluss nutzt. Vorbild für den Reconcile-Gedanken: `argoSyncStatus`/
 * `argoReconcile` in `src/sim/argocd.ts`.
 */

/** Ein Drift-Ereignis: der Ist-Zustand weicht (ohne aktiven Loop) um `delta` vom Soll ab. */
export interface DriftEvent {
  label: string;
  delta: number;
}

export interface DriftHealRound {
  name: string;
  /** Soll-Zustand (Replicas), den der Spieler NICHT einzeln nachzählt, sondern deklariert. */
  desired: number;
  /** Drift-Ereignisse dieser Runde, der Reihe nach. */
  driftEvents: DriftEvent[];
  /** Button-Text der imperativen (falschen) Reaktion. */
  imperativeLabel: string;
  /** Button-Text der deklarativen (richtigen) Reaktion. */
  declarativeLabel: string;
  /** HTML-Lektion, gezeigt nach geschaffter Runde. */
  tip: string;
}

/* Runden sind nach Schwierigkeit AUFSTEIGEND sortiert (Vorbild #218 STACK_ROUNDS): erst
 * EIN Drift-Ereignis (Replica-Self-Heal, analog `k8s-self-healing`), dann ZWEI Ereignisse
 * in Folge (GitOps-Drift, analog `gitops-drift-detection`/`gitops-self-sync`) – wer beim
 * ersten Ereignis imperativ statt deklarativ reagiert, erlebt am zweiten Ereignis, dass
 * die Abweichung wiederkehrt (der Loop wurde ja nie eingeschaltet). */
export const DRIFT_HEAL_ROUNDS: DriftHealRound[] = [
  {
    name: "Erster Ausfall",
    desired: 3,
    driftEvents: [{ label: "Ein Container-Fass stürzt über Bord – nur noch 2 von 3 laufen.", delta: -1 }],
    imperativeLabel: "🔧 Von Hand ein Ersatzfass ranrollen",
    declarativeLabel: "🔁 Soll-Zustand (3 Fässer) erneut durchsetzen",
    tip: "Ein <b>Wunschzustand</b> ist deklarativ: du sagst <i>„3 Fässer“</i>, nicht <i>„lege genau DIESES eine nach“</i>. Ein <b>Reconcile-Loop</b> vergleicht Soll und Ist ständig und stellt den Soll-Zustand von selbst wieder her – das ist <b>Self-Healing</b>.",
  },
  {
    name: "Handpatch am GitOps-Kai",
    desired: 4,
    driftEvents: [
      { label: "Jemand ändert das Deployment von Hand direkt im Cluster – nur noch 3 von 4 Fässern.", delta: -1 },
      { label: "Kurz danach kippt ein weiteres Fass über Bord – wieder nur 3 von 4.", delta: -1 },
    ],
    imperativeLabel: "🔧 Direkt im Cluster nachpatchen",
    declarativeLabel: "📝 Mit der Git-Quelle synchronisieren (Reconcile)",
    tip: "Nur das <b>Symptom</b> von Hand zu reparieren hilft nicht dauerhaft: die Ursache (kein aktiver Abgleich) bleibt, der nächste Drift trifft dich genauso hart. Erst wenn der Soll-Zustand aus der <b>Git-Quelle</b> aktiv durchgesetzt wird (Reconcile/Sync), hält er auch gegen wiederholten Drift – der Kern von <b>GitOps Self-Heal</b>.",
  },
];

export interface DriftHealState {
  current: number;
  /** Läuft der Reconcile-Loop schon (Spieler hat deklarativ reagiert)? Erst dann heilt
   *  jeder weitere Drift automatisch – ohne den Loop hält eine Hand-Reparatur nur bis
   *  zum nächsten Ereignis. */
  enforced: boolean;
}

/** Runden-Start: Ist == Soll, Loop noch AUS (nichts wurde bisher deklariert). */
export function startState(round: DriftHealRound): DriftHealState {
  return { current: round.desired, enforced: false };
}

/** Wendet ein Drift-Ereignis an. Läuft der Reconcile-Loop schon (`enforced`), hält der
 *  Cluster den Soll-Zustand von selbst – das Ereignis passiert zwar, wird aber sofort
 *  automatisch behoben (kein erneuter Ist-Einbruch). */
export function applyDriftEvent(state: DriftHealState, event: DriftEvent, round: DriftHealRound): DriftHealState {
  if (state.enforced) return { ...state, current: round.desired };
  return { ...state, current: state.current + event.delta };
}

/** Behebt nur das Symptom: Ist wieder gleich Soll, aber der Reconcile-Loop bleibt AUS –
 *  die Ursache ist nicht deklariert weg, der nächste Drift trifft ungebremst wieder. */
export function applyImperativeFix(_state: DriftHealState, round: DriftHealRound): DriftHealState {
  return { current: round.desired, enforced: false };
}

/** Deklariert den Soll-Zustand und schaltet den Reconcile-Loop EIN – ab jetzt hält der
 *  Cluster jeden weiteren Drift von selbst, ohne dass der Spieler nochmal eingreift. */
export function applyDeclarativeFix(_state: DriftHealState, round: DriftHealRound): DriftHealState {
  return { current: round.desired, enforced: true };
}

/** Ob Ist und Soll gerade übereinstimmen. */
export function isSynced(state: DriftHealState, round: DriftHealRound): boolean {
  return state.current === round.desired;
}

/** Löst EIN Drift-Ereignis auf: der Spieler wählt imperativ oder deklarativ, direkt
 *  danach schlägt dasselbe Ereignis noch einmal zu (Vorbild `reconcileAutoSync` in
 *  `sim/argocd.ts`, das vor jeder Eingabe erneut prüft) – deklarativ hält (Loop läuft,
 *  das Ereignis heilt sich selbst); imperativ hält NICHT (Ursache bleibt, das Ereignis
 *  drückt den Ist-Wert erneut unter den Soll). */
export function resolveChoice(
  state: DriftHealState,
  event: DriftEvent,
  round: DriftHealRound,
  choice: "imperative" | "declarative",
): DriftHealState {
  const fixed = choice === "declarative" ? applyDeclarativeFix(state, round) : applyImperativeFix(state, round);
  return applyDriftEvent(fixed, event, round);
}
