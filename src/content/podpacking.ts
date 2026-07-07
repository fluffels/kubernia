/* ===== Inhalte: Minispiel „Pods auf Nodes packen" (#567) =====
 * Der Scheduler verteilt Pods auf Nodes nach requests (CPU/Speicher) und freier
 * Kapazität – als Packspiel greifbarer als als Quiz. Reine Domäne (kein Phaser,
 * unit-testbar): Rundendaten + der Platzier-/Kapazitäts-Kern, den `src/ui/podpacking.ts`
 * für Feedback und Rundenabschluss nutzt.
 */

/** Ein Node mit fester Gesamt-Kapazität (CPU in Millicores, Speicher in Mi). */
export interface PackingNode {
  name: string;
  cpu: number;
  memory: number;
}

/** Ein zu platzierender Pod mit seinen `requests`. */
export interface PackingPod {
  name: string;
  cpu: number;
  memory: number;
}

/** Ein platzierter Pod: welcher Pod liegt auf welchem Node. */
export interface PackingPlacement {
  pod: string;
  node: string;
}

export interface PackingRound {
  name: string;
  nodes: PackingNode[];
  pods: PackingPod[];
  /** HTML-Lektion zu requests/Kapazität/Pending, gezeigt nach geschaffter Runde. */
  tip: string;
}

/* Runden sind nach Schwierigkeit AUFSTEIGEND sortiert (Vorbild #218 STACK_ROUNDS):
 * erst ein Node ohne echte Wahl, dann Verteilen über mehrere Nodes, dann knapper
 * Platz (zwei Dimensionen zugleich beachten), zuletzt ein Pod, der auf KEINEM Node
 * passt – „Pending" ist hier die richtige Antwort, nicht ein Fehler. */
export const POD_PACKING_ROUNDS: PackingRound[] = [
  {
    name: "Erste Fracht",
    nodes: [{ name: "node-1", cpu: 1000, memory: 1024 }],
    pods: [
      { name: "web", cpu: 200, memory: 256 },
      { name: "cache", cpu: 300, memory: 256 },
    ],
    tip: "Ein Node hat eine feste <b>Kapazität</b> (CPU + Speicher). Jeder Pod bringt seine <b>requests</b> mit – so viel reserviert er sich fest. Solange die Summe der requests unter der Kapazität bleibt, passt alles drauf.",
  },
  {
    name: "Zwei Kais, drei Frachter",
    nodes: [
      { name: "node-1", cpu: 500, memory: 512 },
      { name: "node-2", cpu: 500, memory: 512 },
    ],
    pods: [
      { name: "api", cpu: 300, memory: 256 },
      { name: "worker", cpu: 300, memory: 256 },
      { name: "logger", cpu: 150, memory: 128 },
    ],
    tip: "<b>api</b> und <b>worker</b> zusammen brauchen 600m CPU – mehr, als EIN Node (500m) hergibt. Der Scheduler verteilt sie darum auf verschiedene Nodes. Genau das ist Bin-Packing: nicht alles auf den ersten freien Platz, sondern dahin, wo es wirklich passt.",
  },
  {
    name: "Knapper Platz",
    nodes: [
      { name: "node-1", cpu: 470, memory: 520 },
      { name: "node-2", cpu: 470, memory: 520 },
    ],
    pods: [
      { name: "db", cpu: 300, memory: 330 },
      { name: "search", cpu: 340, memory: 280 },
      { name: "sidecar", cpu: 130, memory: 130 },
    ],
    tip: "<b>db</b> und <b>search</b> passen NICHT auf denselben Node (300+340 = 640m CPU > 470m Kapazität) – zwei Dimensionen zählen, CPU UND Speicher. Der kleine <b>sidecar</b> findet dagegen auf beiden Nodes noch eine Lücke.",
  },
  {
    name: "Zu groß für den Hafen",
    nodes: [
      { name: "node-1", cpu: 500, memory: 512 },
      { name: "node-2", cpu: 500, memory: 512 },
    ],
    pods: [
      { name: "queue", cpu: 300, memory: 300 },
      { name: "metrics", cpu: 300, memory: 300 },
      { name: "monolith", cpu: 900, memory: 1200 },
    ],
    tip: "<b>monolith</b> verlangt mehr, als IRGENDEIN Node im Hafen überhaupt hat (900m/1200Mi gegen 500m/512Mi Kapazität) – egal wie du die anderen Pods verteilst, er passt nirgends. Genau das meint Kubernetes mit „insufficient capacity“: der Pod bleibt <b>Pending</b>, bis ein größerer Node dazukommt. Pending ist hier die richtige Antwort, kein Fehler.",
  },
];

/** Wie viel CPU/Speicher ein Node schon durch bereits platzierte Pods verbraucht. */
export function nodeUsage(nodeName: string, placements: PackingPlacement[], pods: PackingPod[]): { cpu: number; memory: number } {
  let cpu = 0, memory = 0;
  for (const p of placements) {
    if (p.node !== nodeName) continue;
    const pod = pods.find((x) => x.name === p.pod);
    if (!pod) continue;
    cpu += pod.cpu;
    memory += pod.memory;
  }
  return { cpu, memory };
}

/** Freie Kapazität eines Nodes nach Abzug der schon platzierten Pods. */
export function remainingCapacity(node: PackingNode, placements: PackingPlacement[], pods: PackingPod[]): { cpu: number; memory: number } {
  const used = nodeUsage(node.name, placements, pods);
  return { cpu: node.cpu - used.cpu, memory: node.memory - used.memory };
}

/** Passt der Pod JETZT auf diesen Node (unter Berücksichtigung schon platzierter Pods)? */
export function canPlacePod(pod: PackingPod, node: PackingNode, placements: PackingPlacement[], pods: PackingPod[]): boolean {
  const rem = remainingCapacity(node, placements, pods);
  return pod.cpu <= rem.cpu && pod.memory <= rem.memory;
}

/** Passt der Pod auf IRGENDEINEN Node dieser Runde – unabhängig von der aktuellen
 *  Belegung, allein gemessen an der GESAMT-Kapazität? `false` heißt: dieser Pod kann,
 *  egal wie die anderen verteilt werden, niemals laufen – „Pending" ist dann korrekt. */
export function podFitsAnyNode(pod: PackingPod, nodes: PackingNode[]): boolean {
  return nodes.some((n) => pod.cpu <= n.cpu && pod.memory <= n.memory);
}
