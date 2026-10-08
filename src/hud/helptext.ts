/* ===== Kubernia – help-Hilfetext: Katalog + gefiltertes Rendering (#358/#359) =====
 * Reine Daten + Render-Funktion für die `help`-Ausgabe des Simulator-Terminals.
 * Bewusst ein eigenes Modul (kein Typ-Import → kein Zyklus, hält den Simulator-Kern
 * unter dem God-File-Budget #390): der Simulator delegiert sein `help` nur hierher,
 * die Freischalt-Mengen liefert cmdunlock.ts/die Anwendungsschicht.
 *
 * #359: Format wie eine echte CLI-Hilfe – EIN Befehl pro Zeile, Beschreibung in einer
 * ausgerichteten Spalte (statt der früheren dichten `a|b|c`-Pipe-Listen). Die Spalten
 * werden über die TATSÄCHLICH gezeigten Zeilen ausgerichtet, damit auch die gefilterte
 * Liste (#358) sauber bündig steht. Voraussetzung: das Terminal rendert monospace.
 */

/** Eine Zeile der Hilfe: Aufruf (Unterbefehl + Argumente) + Kurzbeschreibung. */
interface HelpRow { use: string; desc: string; }
/** Eine bewusste Vereinfachung des Simulators (#1440). Die `id` verweist aus der Treue-Matrix
 *  (docs/sim-treue/kubectl.json) auf den Text; ein Test hält beide in Einklang. */
interface HelpLimit { id: string; text: string; }
/** Eine Befehlsfamilie: Schlüssel (= erstes Befehls-Token, passend zur Freischalt-
 *  Ableitung in cmdunlock.ts) + ihre Zeilen. Der Anzeigename ist der Schlüssel.
 *  `grenzen`: was der Simulator gegenüber dem echten Werkzeug vereinfacht (`help <familie>`). */
interface HelpFamily { key: string; rows: HelpRow[]; grenzen?: HelpLimit[]; }

const HELP_FAMILIES: ReadonlyArray<HelpFamily> = [
  { key: "docker", rows: [
    { use: "pull <image>", desc: "Image aus der Registry laden" },
    { use: "build -t <name> .", desc: "Image aus dem Dockerfile bauen" },
    { use: "tag <quelle> <ziel>", desc: "Image zusätzlich benennen" },
    { use: "run -d --name <n> <image>", desc: "Container im Hintergrund starten" },
    { use: "ps [-a]", desc: "laufende [alle] Container zeigen" },
    { use: "images", desc: "lokale Images zeigen" },
    { use: "stop <n>", desc: "Container stoppen" },
    { use: "rm <n>", desc: "Container entfernen" },
  ] },
  { key: "kubectl", rows: [
    { use: "get <resource> [-o wide|yaml]", desc: "Ressourcen auflisten (pods, deployments, services, nodes …), wide mit Zusatzspalten, yaml als Objekt" },
    { use: "describe <resource> [<name>]", desc: "Details einer Ressource zeigen" },
    { use: "create <art> <name>", desc: "Ressource anlegen (deployment, secret, configmap, role …)" },
    { use: "apply -f <datei>", desc: "Manifest anwenden (deklarativer Soll-Zustand)" },
    { use: "delete <resource> <name>", desc: "Ressource löschen" },
    { use: "scale <deploy> --replicas=<n>", desc: "Anzahl der Replikas ändern" },
    { use: "expose <deploy> --port=<p>", desc: "Deployment als Service veröffentlichen" },
    { use: "set image|env|resources <deploy>", desc: "Felder eines Deployments ändern" },
    { use: "rollout restart deployment <n>", desc: "Pods neu ausrollen" },
    { use: "logs [-f] <pod>", desc: "Logs eines Pods zeigen [folgen]" },
    { use: "top pods|nodes", desc: "Ressourcenverbrauch zeigen" },
    { use: "auth can-i <verb> <resource>", desc: "Recht prüfen (RBAC)" },
    { use: "label namespace <ns> <label>", desc: "Pod-Security-Stufe setzen" },
  ], grenzen: [
    { id: "ein-namespace", text: "Es gibt nur die Namespaces default und kube-system; -n und -A greifen nur dort." },
    { id: "keine-ausgabeformate", text: "Flags wie -l, -w, --show-labels, --sort-by und Formate wie -o json lehnt der Simulator ab." },
    { id: "yaml-auswahl", text: "-o yaml gibt es für pods, deployments, replicasets, services, statefulsets und pvcs; die System-Pods fehlen." },
    { id: "yaml-gekuerzt", text: "-o yaml zeigt nur die modellierten Felder und einen Status-Auszug, ohne uid, Zeitstempel und managedFields." },
    { id: "wide-auswahl", text: "-o wide zeigt Zusatzspalten nur bei pods, deployments, services, statefulsets; sonst die normale Tabelle." },
    { id: "rs-nur-aktuell", text: "get rs und get all zeigen je Deployment nur das aktuelle ReplicaSet, keine alten aus früheren Rollouts." },
    { id: "apply-umfang", text: "apply -f liest nur Deployment und Service aus der Datei; andere Arten wirken wie im Spiel hinterlegt." },
    { id: "describe-gekuerzt", text: "describe kennt nur wenige Arten und zeigt gekürzte Abschnitte." },
    { id: "selektor-ueber-namen", text: "Selektoren gibt es nicht: ein Service wählt Pods über den Namen; describe zeigt das als app=<name>." },
    { id: "arten-auswahl", text: "create, delete und scale kennen nur die Arten aus der Hilfe; secret nur generic und tls." },
    { id: "spalten-gekuerzt", text: "Spalten bei Storage- und Monitoring-Ressourcen sind zum Lernen gewählt, nicht die echten." },
    { id: "nur-sim-alerts", text: "get alerts gibt es nur im Simulator (echt: Prometheus und Alertmanager)." },
    { id: "nodes-diskpressure", text: "get nodes hängt DiskPressure an STATUS an; AGE ist fest." },
    { id: "lernhinweise", text: "Zeilen mit 💡 sind Lernhilfen des Spiels und stehen so nicht in echtem kubectl." },
    { id: "rbac-vereinfacht", text: "RBAC: nur selbst angelegte Rollen, keine System-Rollen; get roles zeigt AGE statt CREATED AT." },
    { id: "nur-deployments", text: "scale, expose, set und rollout arbeiten nur mit Deployments, logs: Pods und deploy/<name>." },
    { id: "label-nur-namespace", text: "label setzt nur die Pod-Security-Stufe an einem Namespace." },
    { id: "logs-follow", text: "logs -f läuft nicht live weiter, der Strom endet nach dem aktuellen Stand." },
  ] },
  { key: "kubeadm", rows: [
    { use: "init [--pod-network-cidr <cidr>]", desc: "Control-Plane hochziehen" },
    { use: "join <token>", desc: "Worker-Knoten anschließen" },
    { use: "reset [-f]", desc: "Cluster abräumen (zurück auf bare metal)" },
  ] },
  { key: "helm", rows: [
    { use: "repo add <name> <url>", desc: "Chart-Repository hinzufügen" },
    { use: "repo update", desc: "Repo-Index aktualisieren" },
    { use: "search repo <begriff>", desc: "Charts im Repo suchen" },
    { use: "create <name>", desc: "Chart-Gerüst anlegen" },
    { use: "lint <pfad>", desc: "Chart auf Fehler prüfen" },
    { use: "package <pfad>", desc: "Chart paketieren (.tgz)" },
    { use: "install <name> <chart>", desc: "Release installieren" },
    { use: "list", desc: "installierte Releases zeigen" },
    { use: "upgrade <name> <chart>", desc: "Release aktualisieren" },
    { use: "rollback <name> <rev>", desc: "Release auf eine Revision zurückrollen" },
    { use: "uninstall <name>", desc: "Release entfernen" },
    { use: "status <name>", desc: "Status eines Releases zeigen" },
  ] },
  { key: "terraform", rows: [
    { use: "init", desc: "Arbeitsverzeichnis vorbereiten" },
    { use: "plan", desc: "geplante Änderungen zeigen" },
    { use: "apply", desc: "Änderungen ausführen" },
    { use: "destroy", desc: "verwaltete Ressourcen abbauen" },
    { use: "state list", desc: "verwaltete Ressourcen auflisten" },
  ] },
  { key: "git", rows: [
    { use: "init", desc: "aus dem Ordner ein Repository machen" },
    { use: "status", desc: "aktuellen Stand zeigen" },
    { use: "add <datei>|.|-A", desc: "Änderung vormerken (Staging)" },
    { use: "commit -m \"…\"", desc: "Vorgemerktes als Schnappschuss festhalten" },
    { use: "log", desc: "Commit-Historie zeigen" },
    { use: "branch [<name>]", desc: "Branches zeigen / einen anlegen" },
    { use: "checkout [-b] <name>", desc: "Branch wechseln / [neu anlegen]" },
    { use: "merge <name>", desc: "einen Branch zusammenführen" },
    { use: "fetch", desc: "vom Server holen, ohne einzufügen" },
    { use: "pull [origin [<branch>]]", desc: "holen und einfügen (fetch + merge)" },
    { use: "push [-u] [origin [<branch>]]", desc: "eigene Commits zum Server hochladen" },
  ] },
  { key: "argocd", rows: [
    { use: "app list", desc: "GitOps-Apps zeigen" },
    { use: "app get <name>", desc: "Details einer App zeigen" },
    { use: "app sync <name>", desc: "Git-Soll in den Cluster ziehen" },
  ] },
  { key: "glab", rows: [
    { use: "ci status", desc: "Pipeline des aktuellen Branches zeigen" },
    { use: "ci list", desc: "Pipelines auflisten" },
  ] },
  { key: "nslookup", rows: [
    { use: "<name>", desc: "DNS: Adresse hinter einem Service-Namen (CoreDNS)" },
  ] },
  { key: "curl", rows: [
    { use: "[http://]<service>[:port][/pfad]", desc: "Service abrufen – läuft er und ist er erreichbar?" },
  ] },
  { key: "aws", rows: [
    { use: "s3 mb s3://<bucket>", desc: "Bucket anlegen (Object Store, off-cluster)" },
    { use: "s3 rb s3://<bucket> [--force]", desc: "Bucket löschen" },
    { use: "s3 ls [--recursive] [s3://<bucket>]", desc: "Buckets bzw. Objekte auflisten" },
    { use: "s3 cp <quelle> <ziel>", desc: "Objekt kopieren" },
    { use: "s3 rm s3://<bucket>/<key>", desc: "Objekt entfernen" },
  ] },
  // Meta-/Hilfsbefehle. ls/cat sind freischaltpflichtig (werden im Spiel eingeführt),
  // clear/help stehen immer offen (siehe ALWAYS_AVAILABLE_COMMANDS in cmdunlock.ts).
  { key: "ls", rows: [{ use: "", desc: "Dateien im aktuellen Ordner zeigen" }] },
  { key: "cat", rows: [{ use: "<datei>", desc: "Inhalt einer Datei anzeigen" }] },
  { key: "clear", rows: [{ use: "", desc: "Terminal leeren" }] },
  { key: "help", rows: [{ use: "", desc: "diese Hilfe anzeigen" }] },
];

function isUnlocked(available?: Set<string>): (key: string) => boolean {
  return available === undefined ? () => true : (k: string) => available.has(k);
}

/** Die bewussten Vereinfachungen einer Familie (leer, wenn sie keine nennt). Die Treue-Matrix
 *  (docs/sim-treue/) verweist auf diese IDs. */
export function simGrenzen(familie: string): ReadonlyArray<HelpLimit> {
  return HELP_FAMILIES.find(f => f.key === familie)?.grenzen ?? [];
}

/** Eine fertig zusammengesetzte Zeile (Familienname nur in der ersten Zeile der
 *  Familie) vor dem Ausrichten. */
interface RenderRow { name: string; use: string; desc: string; }

/**
 * Rendert den `help`-Text im CLI-Stil (#359): ein Befehl pro Zeile, Beschreibungen
 * in einer ausgerichteten Spalte. Mit `available` werden nur freigeschaltete Familien
 * gelistet (#358: progressive Aufdeckung – zu Spielbeginn praktisch nur `help` selbst).
 * Ohne `available` (Tests/bare Sim) erscheinen wie bisher alle Befehle.
 */
export function renderHelp(available?: Set<string>): string {
  const has = isUnlocked(available);

  // 1) Sichtbare Zeilen einsammeln (Familienname nur in der ersten Zeile je Familie).
  const rows: RenderRow[] = [];
  for (const fam of HELP_FAMILIES) {
    if (!has(fam.key)) continue;
    fam.rows.forEach((r, i) => rows.push({ name: i === 0 ? fam.key : "", use: r.use, desc: r.desc }));
  }

  // 2) Spaltenbreiten über die tatsächlich gezeigten Zeilen bestimmen (bündig).
  const nameW = Math.max(0, ...rows.map(r => r.name.length)) + 2;
  const useW = Math.max(0, ...rows.map(r => r.use.length)) + 2;

  // 3) Ausrichten. Leere use-Spalte (z.B. `ls`) wird nicht künstlich aufgefüllt,
  //    wenn keine Beschreibung mehr folgt – hier folgt aber immer eine.
  const out: string[] = ["Verfügbare Befehle im Simulator:"];
  for (const r of rows) {
    out.push("  " + r.name.padEnd(nameW) + r.use.padEnd(useW) + r.desc);
  }
  // Hinweis auf die Einzelansicht, solange eine sichtbare Familie Grenzen nennt (#1440).
  const mitGrenzen = HELP_FAMILIES.find(f => has(f.key) && f.grenzen);
  if (mitGrenzen) out.push("💡 Was der Simulator vereinfacht: 'help " + mitGrenzen.key + "'.");
  // Gefilterte Liste → Hinweis, dass weitere Befehle im Spielverlauf dazukommen (#358).
  if (available !== undefined) out.push("💡 Weitere Befehle schaltest du nach und nach frei, während du die Mission spielst.");
  return out.join("\n");
}

/**
 * `help <familie>` (#1440): die Zeilen einer Familie plus ihre bewussten Vereinfachungen.
 * `null` bei unbekannter oder noch nicht freigeschalteter Familie (neutral, verrät nichts, #358).
 */
export function renderHelpTopic(topic: string, available?: Set<string>): string | null {
  const fam = HELP_FAMILIES.find(f => f.key === topic);
  if (!fam || !isUnlocked(available)(fam.key)) return null;
  const useW = Math.max(0, ...fam.rows.map(r => r.use.length)) + 2;
  const out = [fam.key + ":"];
  for (const r of fam.rows) out.push("  " + r.use.padEnd(useW) + r.desc);
  if (fam.grenzen) {
    out.push("Was der Simulator vereinfacht:");
    for (const g of fam.grenzen) out.push("  - " + g.text);
  }
  return out.join("\n");
}
