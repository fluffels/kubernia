/* ===== Inhalte: Quest-Mechanik-Sonderfälle (#348/#411, Content-as-Data) =====
 * Eine Quest-Aufgabe kann eine `check`-Bedingung gegen den Sim-Zustand tragen.
 * Seit #411 sind die ALLERMEISTEN Bedingungen **Daten**: eine deklarative Regel in
 * der Quest-JSON (existiert/heil/Anzahl/Flag …), die `content/check-dsl.ts` beim
 * Laden zu einem Prädikat kompiliert. Eine neue Standard-Quest braucht damit KEINEN
 * Code-Eintrag mehr – das war vorher der teure dritte Handgriff je Quest.
 *
 * Hier bleiben nur noch die **echten Sonderfälle**, die sich NICHT als deklarativer
 * Zustand ausdrücken lassen, sondern Code brauchen. Die Quest-JSON referenziert sie
 * weiterhin per String-Key (`<questId>/<task-id>`); der Loader (loader.ts,
 * `reviveCheck`) löst einen String-Key über diese Registry auf, ein Objekt dagegen
 * über die Check-DSL.
 *
 * **Wann ein Eintrag hierher gehört (statt in die DSL):** wenn die Bedingung keine
 * Eigenschaft des *deklarativen Cluster-Zustands* ist, sondern z.B. eine transiente
 * **Aktions-Markierung** (der Spieler hat gerade etwas getan). Im Zweifel: erst
 * prüfen, ob die DSL es kann (sie deckt Sammlungen inkl. der virtuellen `alerts()`,
 * Flags und Pfade ab) – nur was dort wirklich nicht passt, kommt hierher.
 */
import type { Sim } from "../sim";

export const QUEST_CHECKS: Record<string, (sim: Sim) => unknown> = {
  // Aktions-Marker, kein deklarativer Zustand: Im Selbstheilungs-Sturm soll der
  // Spieler aktiv EINEN Pod löschen. `lastDeletedPod` ist ein transienter
  // Sitzungs-Marker (kein Cluster-Feld), den der Sim beim `kubectl delete pod`
  // setzt – „der Spieler hat gerade gelöscht" lässt sich nicht als Zustandsregel
  // ausdrücken. Bleibt darum bewusst Code (#411).
  "k8s-self-healing/t-storm-3": (sim) => sim.lastDeletedPod !== null,
};
