/* ===== KubeQuest – glab/CI (sim/glab.ts) =====
 * Folge zum sim.ts-Datei-Split (Epic #346, ADR 0004): die letzte kohärente
 * Nicht-Befehls-Familie, die nach den 7 Befehls-Splits (#372–#378) + der
 * Observability-Auslagerung (#384) noch im Sim-Kern lag (#385).
 *
 * Hier liegt die `glab`-Befehlsfamilie (GitLab-CLI: `glab ci status|list`) UND
 * die CI-Pipeline-Maschinerie `runPipeline` – also die Stelle, an der eine
 * .gitlab-ci.yml beim `git push` ihre Pipeline (build → test → deploy) laufen
 * lässt und die deploy-Stage auf `main` automatisch ausrollt. Wie bei den
 * Befehls-Splits (#373–#378) als freie Funktionen ausgelagert, die die Sim-
 * Instanz über das schmale `GlabHost`-Interface bekommen.
 *
 * `runPipeline` war bis hierher ein „bleibt bei glab in sim.ts"-Sonderfall im
 * Kern und wurde von `git push` (sim/git.ts) über die Host-Methode `_runPipeline`
 * angestoßen. Mit diesem Split landet sie an ihrem fachlich richtigen Ort
 * (CI/GitLab): `sim/git.ts` importiert `runPipeline` jetzt DIREKT von hier (kein
 * Umweg mehr über `GitHost._runPipeline`, die Methode fällt aus `GitHost` raus).
 *
 * Phaser-frei (pure Domäne): die Tabellen-/Spalten-Ausgabe kommt aus ./util, die
 * Domänentypen aus ./state – kein Rückimport nach sim.ts (kein Zyklus). Abgedeckt
 * durch die glab/CI-Tests in test/sim.test.ts (über `exec` bzw. `git push`).
 */
import type { ClusterState, Pipeline, Broken, Deployment } from "./state";
import { pad, table } from "./util";
import { addDeployment } from "./workload";

/** Was die glab/CI-Funktionen vom Simulator brauchen (von der `Sim`-Klasse
 *  erfüllt). Bewusst ein schmales Interface statt der ganzen `Sim`-Klasse: es
 *  dokumentiert die Kopplung von CI an den Cluster-Zustand und vermeidet einen
 *  Import-Zyklus glab ↔ sim. Statt des ganzen `ClusterState` (Leaky Abstraction
 *  #516) nur die berührten Daten-Felder per `Pick` (ISP): `ci`/`git`/`deployments`/
 *  `clock`; die Feld-Typen bleiben so an die SSOT (sim/state.ts, #372) gebunden.
 *  Hinzu kommen die in `sim.ts` verbleibenden Helfer: Fehlerausgabe (`glab`) und die
 *  Deployment-Fabrik (`runPipeline` rollt die deploy-Stage auf `main` darüber aus). */
export interface GlabHost extends Pick<ClusterState, "ci" | "git" | "deployments" | "clock"> {
  _err(msg: string, tip?: string): string;
  _makeDeployment(name: string, image: string, replicas: number, broken?: Broken | null, envFrom?: { configMaps: string[]; secrets: string[] }, cpuHeavy?: boolean): Deployment;
}

/** Baut eine Pipeline für den aktuellen Branch und lässt ihre Stages laufen.
 *  Wird beim `git push` (sim/git.ts) angestoßen, wenn eine .gitlab-ci.yml im Repo
 *  liegt. Die deploy-Stage rollt den Dienst nur auf `main` automatisch aus. */
export function runPipeline(host: GlabHost): Pipeline {
  const g = host.git;
  const onMain = g.branch === "main";
  const stages = [
    { name: "build", status: "passed" },
    { name: "test", status: "passed" },
    { name: "deploy", status: onMain ? "passed" : "skipped" }, // 'only: main' – Feature-Branches werden nicht ausgerollt
  ];
  const p: Pipeline = { id: 1001 + host.ci.pipelines.length, ref: g.branch, status: "passed", stages, created: host.clock };
  host.ci.pipelines.push(p);
  // Die deploy-Stage rollt den Dienst automatisch in den Cluster (nur auf main).
  if (host.ci.deploy && onMain) {
    const d = host.ci.deploy;
    if (!host.deployments.some(x => x.name === d.name)) {
      addDeployment(host, host._makeDeployment(d.name, d.image, d.replicas));
    }
  }
  return p;
}

/* ===================== glab (GitLab CLI) ===================== */
export function glabCommand(host: GlabHost, t: string[]): string {
  if (t[1] !== "ci") return host._err("Der Simulator kann nur 'glab ci ...'.", "z.B. 'glab ci status' oder 'glab ci list'.");
  const action = t[2];

  if (action === "status" || action === "view") {
    const p = host.ci.pipelines[host.ci.pipelines.length - 1];
    if (!p) return host._err("Keine Pipeline gefunden.", "Eine Pipeline entsteht beim 'git push' – wenn eine .gitlab-ci.yml im Repo liegt.");
    const icon = (s: string) => (s === "passed" ? "✓" : s === "skipped" ? "–" : "•");
    const lines = [
      "Pipeline #" + p.id + "  (Branch " + p.ref + ")   Status: " + (p.status === "passed" ? "passed ✅" : p.status),
    ];
    for (const s of p.stages) lines.push("  " + icon(s.status) + " " + pad(s.name, 8) + s.status);
    if (p.stages.some(s => s.name === "deploy" && s.status === "passed")) {
      lines.push("🚀 Die deploy-Stage hat den Dienst automatisch ausgerollt – schau mit 'kubectl get pods'.");
    } else if (p.ref !== "main") {
      lines.push("ℹ️  deploy übersprungen ('only: main') – auf diesem Branch wird gebaut & getestet, aber nicht deployt.");
    }
    return lines.join("\n");
  }

  if (action === "list") {
    if (!host.ci.pipelines.length) return "Keine Pipelines. (Entstehen beim 'git push' mit .gitlab-ci.yml im Repo.)";
    return table(["ID", "BRANCH", "STATUS"],
      host.ci.pipelines.slice().reverse().map(p => ["#" + p.id, p.ref, p.status]));
  }

  return host._err("glab ci: unbekannte Aktion '" + (action || "") + "'", "z.B. 'glab ci status' oder 'glab ci list'.");
}
