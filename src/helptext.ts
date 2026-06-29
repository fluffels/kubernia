/* ===== KubeQuest – help-Hilfetext: Katalog + gefiltertes Rendering (#358) =====
 * Reine Daten + Render-Funktion für die `help`-Ausgabe des Simulator-Terminals.
 * Bewusst ein eigenes Modul (kein Typ-Import → kein Zyklus, hält den Simulator-Kern
 * unter dem God-File-Budget #390): der Simulator delegiert sein `help` nur hierher,
 * die Freischalt-Mengen liefert cmdunlock.ts/die Anwendungsschicht.
 */

/** Eine help-Familie: Schlüssel (= erstes Befehls-Token, passend zur Freischalt-
 *  Ableitung in cmdunlock.ts) + ihre Hilfezeile(n). */
interface HelpFamily { key: string; lines: string[]; }

const HELP_FAMILIES: ReadonlyArray<HelpFamily> = [
  { key: "docker", lines: ["  docker     pull | build -t <name> . | tag <quelle> <ziel> | run | ps [-a] | images | stop | rm"] },
  { key: "kubectl", lines: [
    "  kubectl    get pods|deployments|services|endpoints|ingress|networkpolicies|servicemonitors|prometheusrules|grafanadatasources|grafanadashboards|alerts|nodes|secrets|configmaps|serviceaccounts|roles|rolebindings | describe pod|node|ingress|networkpolicy|role|serviceaccount <name>",
    "             create deployment | create secret generic|tls | create configmap | create serviceaccount|role|clusterrole|rolebinding|clusterrolebinding | scale | expose | delete | apply -f <datei>",
    "             auth can-i <verb> <resource> [--as=…] | label namespace <ns> pod-security.kubernetes.io/enforce=<stufe>",
    "             logs [-f] [--previous] <pod> | top pods|nodes | set image deployment/<n> <c>=<img> | set env deployment/<n> --from=configmap|secret/<n> | set resources deployment/<n> --limits=memory=256Mi|ephemeral-storage=1Gi | rollout restart deployment <n>",
  ] },
  { key: "kubeadm", lines: ["  kubeadm    init | join <token> | reset  (Cluster selbst aufbauen: Control-Plane hochziehen, Worker anschließen, abräumen)"] },
  { key: "helm", lines: ["  helm       repo add|update | search repo | create | lint | package | install | list | upgrade | rollback | uninstall | status"] },
  { key: "terraform", lines: ["  terraform  init | plan | apply | destroy | state list"] },
  { key: "git", lines: ["  git        init | status | add <datei> | commit -m \"…\" | log | branch [<name>] | checkout [-b] <name> | merge <name> | push | fetch | pull"] },
  { key: "argocd", lines: ["  argocd     app list | app get <name> | app sync <name>  (Argo CD / GitOps – den Git-Soll in den Cluster ziehen)"] },
  { key: "glab", lines: ["  glab       ci status | ci list  (Pipeline-Status in GitLab)"] },
  { key: "nslookup", lines: ["  nslookup   <name>  (DNS: fragt CoreDNS nach der Adresse hinter einem Service-Namen)"] },
  { key: "curl", lines: ["  curl       [http://]<service>[:port][/pfad]  (ruft einen Service ab – läuft mein Dienst und ist er erreichbar?)"] },
  { key: "aws", lines: ["  aws s3     mb s3://<bucket> | rb s3://<bucket> [--force] | ls [s3://<bucket>] | cp <quelle> <ziel> | rm s3://<bucket>/<key>  (Object Store – off-cluster)"] },
];

/**
 * Rendert den `help`-Text. Mit `available` werden nur freigeschaltete Familien
 * gelistet (#358: progressive Aufdeckung – zu Spielbeginn praktisch nur `help`
 * selbst). Ohne `available` (Tests/bare Sim) erscheinen wie bisher alle Befehle.
 */
export function renderHelp(available?: Set<string>): string {
  const has = available === undefined ? () => true : (k: string) => available.has(k);
  const out: string[] = ["Verfügbare Befehle im Simulator:"];
  for (const fam of HELP_FAMILIES) if (has(fam.key)) out.push(...fam.lines);
  // Meta-Zeile: nur freigeschaltete Hilfsbefehle; clear/help stehen immer offen.
  const meta: string[] = [];
  if (has("ls")) meta.push("ls");
  if (has("cat")) meta.push("cat <datei>");
  meta.push("clear", "help");
  out.push("  " + meta.join(", "));
  // Gefilterte Liste → Hinweis, dass weitere Befehle im Spielverlauf dazukommen (#358).
  if (available !== undefined) out.push("💡 Weitere Befehle schaltest du nach und nach frei, während du die Mission spielst.");
  return out.join("\n");
}
