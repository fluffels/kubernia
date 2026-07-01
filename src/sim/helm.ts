/* ===== KubeQuest – helm-Befehle (sim/helm.ts) =====
 * Schritt 4/7 des sim.ts-Datei-Splits (#375, aus Epic #346, ADR 0004).
 *
 * Hier liegt die komplette `helm`-Befehlsfamilie (repo add|update|list, search,
 * create, template, lint, package, install, list, upgrade, rollback, uninstall,
 * status, dependency) plus der helm-eigene `--set <key>=<n>`-Parser (`setValue`, früher
 * `_setValue` – wird nur von helm install/upgrade gebraucht). Aus `sim.ts`
 * ausgelagert als freie Funktionen, die die Sim-Instanz als `HelmHost` bekommen –
 * so bleibt der Cluster-Zustand in EINER Hand (die `Sim`-Klasse), die helm-Logik
 * aber in einer eigenen, testbaren Datei. Aufgerufen aus dem `exec`-Dispatch in
 * `sim.ts` per `helmCommand(this, …)`.
 *
 * Phaser-frei (pure Domäne): die geteilten Ausgabe-/Pod-Namen-Helfer kommen aus
 * ./util, die Domänentypen aus ./state – kein Rückimport nach sim.ts (kein Zyklus).
 */
import type { ClusterState, Deployment, ServiceRes, Broken } from "./state";
import { table } from "./util";
import { addDeployment, scaleDeployment } from "./workload";

/** Was die helm-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt).
 *  Bewusst ein schmales Interface statt der ganzen `Sim`-Klasse: es dokumentiert
 *  die Kopplung von helm an den Cluster-Zustand und vermeidet einen Import-Zyklus
 *  helm ↔ sim. Die Daten-Felder (helmRepos/charts/releases/deployments/services/
 *  files/clock) kommen über `extends ClusterState` (sim/state.ts, #372); hinzu
 *  kommen die in `sim.ts` verbleibenden Helfer, die helm ruft. */
export interface HelmHost extends ClusterState {
  _err(msg: string, tip?: string): string;
  _makeDeployment(name: string, image: string, replicas: number, broken?: Broken | null, envFrom?: { configMaps: string[]; secrets: string[] }, cpuHeavy?: boolean): Deployment;
  _makeService(spec: { name: string; type?: string; port: string | number; targetPort?: string | number; externalName?: string }): ServiceRes;
}

/** Liest `--set <key>=<zahl>` aus der rohen Eingabe (helm install/upgrade). */
export function setValue(raw: string, key: string): number | null {
  const m = raw.match(new RegExp("--set\\s+" + key + "=(\\d+)"));
  return m ? parseInt(m[1], 10) : null;
}

export function helmCommand(host: HelmHost, t: string[], raw: string): string {
  const sub = t[1];
  if (!sub) return host._err("helm: Unterbefehl fehlt.", "Probier z.B. 'helm list'.");

  if (sub === "repo") {
    const action = t[2];
    if (action === "add") {
      const name = t[3], url = t[4];
      if (!name || !url) return host._err("helm repo add: Name und URL fehlen.", "z.B. 'helm repo add bitnami https://charts.bitnami.com/bitnami'");
      if (!host.helmRepos.includes(name)) host.helmRepos.push(name);
      return '"' + name + '" has been added to your repositories';
    }
    if (action === "update") {
      if (host.helmRepos.length === 0) return host._err("Error: no repositories found.", "Erst ein Repo hinzufügen: 'helm repo add ...'");
      return "Hang tight while we grab the latest from your chart repositories...\n" +
        host.helmRepos.map(r => '...Successfully got an update from the "' + r + '" chart repository').join("\n") +
        "\nUpdate Complete. ⎈Happy Helming!⎈";
    }
    if (action === "list") {
      if (host.helmRepos.length === 0) return "Error: no repositories to show";
      return table(["NAME", "URL"], host.helmRepos.map(r => [r, "https://charts.bitnami.com/" + r]));
    }
    return host._err("helm repo: unbekannte Aktion '" + (action || "") + "'");
  }

  if (sub === "search") {
    const term = t[3] || "";
    if (host.helmRepos.length === 0) return host._err("Error: no repositories configured", "Erst 'helm repo add bitnami https://charts.bitnami.com/bitnami'");
    const charts = [
      ["bitnami/nginx", "18.1.0", "1.27.0", "NGINX – der beliebte Webserver"],
      ["bitnami/nginx-ingress-controller", "11.3.1", "1.11.1", "Ingress Controller auf NGINX-Basis"],
      ["bitnami/redis", "19.5.2", "7.2.5", "Redis – In-Memory-Datenbank"],
      ["bitnami/postgresql", "15.5.1", "16.3.0", "PostgreSQL-Datenbank"],
    ].filter(c => !term || c[0].includes(term) || c[3].toLowerCase().includes(term.toLowerCase()));
    if (charts.length === 0) return "No results found";
    return table(["NAME", "CHART VERSION", "APP VERSION", "DESCRIPTION"], charts);
  }

  if (sub === "create") {
    const name = t[2];
    if (!name || name.startsWith("-")) return host._err("helm create: Chart-Name fehlt.", "Muster: 'helm create <mein-chart>'");
    if (host.charts.some(c => c.name === name)) return host._err('Error: file "' + name + '" already exists', "Den Namen gibt es schon. Nimm einen anderen.");
    host.charts.push({ name, version: "0.1.0", packaged: false });
    // Das Gerüst, das echtes 'helm create' anlegt – als virtuelle Dateien zum Anschauen (ls/cat).
    host.files[name + "/Chart.yaml"] = [
      "apiVersion: v2", "name: " + name, "description: Ein Helm-Chart für Kubernetes",
      "type: application", "version: 0.1.0", "appVersion: \"1.16.0\"",
    ].join("\n");
    host.files[name + "/values.yaml"] = [
      "# Drehknöpfe des Charts – hier ohne die Vorlage zu ändern einstellbar.",
      "replicaCount: 1", "image:", "  repository: nginx", "  tag: \"latest\"",
      "service:", "  type: ClusterIP", "  port: 80",
    ].join("\n");
    // Echte Go-Template-Syntax zum Lesen (#273): {{ .Values… }}, include/_helpers,
    // if/range, toYaml. 'helm template <chart>' rendert das mit den Werten oben.
    host.files[name + "/templates/deployment.yaml"] = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  # include zieht einen Schnipsel aus _helpers.tpl ein (kein Copy-Paste).",
      "  name: {{ include \"" + name + ".fullname\" . }}",
      "  labels:",
      "    {{- include \"" + name + ".labels\" . | nindent 4 }}",
      "spec:",
      "  # .Values.* wird beim Rendern aus values.yaml (bzw. -f-Override) gefüllt.",
      "  replicas: {{ .Values.replicaCount }}",
      "  selector:",
      "    matchLabels:",
      "      {{- include \"" + name + ".selectorLabels\" . | nindent 6 }}",
      "  template:",
      "    metadata:",
      "      labels:",
      "        {{- include \"" + name + ".selectorLabels\" . | nindent 8 }}",
      "    spec:",
      "      containers:",
      "        - name: {{ .Chart.Name }}",
      "          image: \"{{ .Values.image.repository }}:{{ .Values.image.tag }}\"",
      "          ports:",
      "            - containerPort: {{ .Values.service.port }}",
      "          # if rendert den Block nur, wenn der Wert gesetzt ist; range schleift über eine Liste.",
      "          {{- if .Values.env }}",
      "          env:",
      "            {{- range .Values.env }}",
      "            - name: {{ .name }}",
      "              value: {{ .value | quote }}",
      "            {{- end }}",
      "          {{- end }}",
      "          # toYaml bettet einen ganzen Wertblock ein (häufige Einrückungs-Falle).",
      "          resources:",
      "            {{- toYaml .Values.resources | nindent 12 }}",
    ].join("\n");
    host.files[name + "/templates/service.yaml"] = [
      "apiVersion: v1",
      "kind: Service",
      "metadata:",
      "  name: {{ include \"" + name + ".fullname\" . }}",
      "spec:",
      "  type: {{ .Values.service.type }}",
      "  ports:",
      "    - port: {{ .Values.service.port }}",
    ].join("\n");
    // _helpers.tpl: einmal definierte, per include wiederverwendbare Schnipsel.
    host.files[name + "/templates/_helpers.tpl"] = [
      "{{/* Wiederverwendbare Bausteine – einmal definiert, überall per include eingebunden. */}}",
      "{{- define \"" + name + ".fullname\" -}}",
      "{{ .Release.Name }}-{{ .Chart.Name }}",
      "{{- end -}}",
      "",
      "{{- define \"" + name + ".labels\" -}}",
      "app.kubernetes.io/name: {{ .Chart.Name }}",
      "app.kubernetes.io/instance: {{ .Release.Name }}",
      "{{- end -}}",
      "",
      "{{- define \"" + name + ".selectorLabels\" -}}",
      "app.kubernetes.io/name: {{ .Chart.Name }}",
      "{{- end -}}",
    ].join("\n");
    return "Creating " + name;
  }

  if (sub === "template") {
    // 'helm template [RELEASE] <chart>' rendert die Vorlagen mit den Werten zu
    // fertigen Manifesten und zeigt sie nur an – OHNE zu installieren (#273).
    const args = t.slice(2).filter(a => !a.startsWith("-"));
    if (args.length === 0) return host._err("helm template: Welches Chart?", "Muster: 'helm template <chart>' – z.B. das von 'helm create'.");
    const ref = args[args.length - 1];
    const release = args.length >= 2 ? args[0] : "release-name";
    const name = ref.replace(/^\.?\.?\//, "").replace(/\/+$/, "");
    if (!host.charts.some(c => c.name === name)) return host._err('Error: path "' + ref + '" not found', "Erst 'helm create " + name + "' – oder den Pfad prüfen.");
    // Gerendert mit den Default-Werten aus values.yaml (replicaCount 1, nginx:latest, Port 80).
    // .Release.Name/.Chart.Name/.Values.* sind eingesetzt, der if-Block (env) ist weg,
    // weil kein env gesetzt ist – genau das macht 'Template + Values → Manifest' sichtbar.
    return [
      "---",
      "# Source: " + name + "/templates/service.yaml",
      "apiVersion: v1",
      "kind: Service",
      "metadata:",
      "  name: " + release + "-" + name,
      "spec:",
      "  type: ClusterIP",
      "  ports:",
      "    - port: 80",
      "---",
      "# Source: " + name + "/templates/deployment.yaml",
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: " + release + "-" + name,
      "  labels:",
      "    app.kubernetes.io/name: " + name,
      "    app.kubernetes.io/instance: " + release,
      "spec:",
      "  replicas: 1",
      "  selector:",
      "    matchLabels:",
      "      app.kubernetes.io/name: " + name,
      "  template:",
      "    metadata:",
      "      labels:",
      "        app.kubernetes.io/name: " + name,
      "    spec:",
      "      containers:",
      "        - name: " + name,
      "          image: \"nginx:latest\"",
      "          ports:",
      "            - containerPort: 80",
      "          resources: {}",
    ].join("\n");
  }

  if (sub === "lint") {
    const ref = t[2];
    if (!ref) return host._err("helm lint: Welches Chart?", "Muster: 'helm lint <chart>' – z.B. das von 'helm create'.");
    const name = ref.replace(/^\.?\.?\//, "").replace(/\/+$/, "");
    if (!host.charts.some(c => c.name === name)) return host._err('Error: path "' + ref + '" not found', "Erst 'helm create " + name + "' – oder den Pfad prüfen.");
    return [
      "==> Linting " + ref,
      "[INFO] Chart.yaml: icon is recommended",
      "",
      "1 chart(s) linted, 0 chart(s) failed",
    ].join("\n");
  }

  if (sub === "package") {
    const ref = t[2];
    if (!ref) return host._err("helm package: Welches Chart?", "Muster: 'helm package <chart>'.");
    const name = ref.replace(/^\.?\.?\//, "").replace(/\/+$/, "");
    const chart = host.charts.find(c => c.name === name);
    if (!chart) return host._err('Error: path "' + ref + '" not found', "Erst 'helm create " + name + "' – oder den Pfad prüfen.");
    chart.packaged = true;
    const tgz = name + "-" + chart.version + ".tgz";
    host.files[tgz] = "(gepacktes Chart-Archiv – bereit zum Teilen oder Installieren)";
    return "Successfully packaged chart and saved it to: /werft/" + tgz;
  }

  if (sub === "install") {
    const release = t[2], chart = t[3];
    if (!release || !chart || release.startsWith("-")) return host._err("helm install: Release-Name und Chart fehlen.", "Muster: 'helm install <mein-name> bitnami/nginx' oder '<mein-name> ./<eigenes-chart>'");
    // Lokales Chart (eigenes, mit 'helm create' gebautes) vs. Repo-Chart unterscheiden.
    const localName = chart.replace(/^\.?\.?\//, "").replace(/\/+$/, "");
    const isLocal = chart.startsWith(".") || chart.startsWith("/") || host.charts.some(c => c.name === localName);
    if (isLocal) {
      if (!host.charts.some(c => c.name === localName)) return host._err('Error: path "' + chart + '" not found', "Erst mit 'helm create " + localName + "' ein Chart anlegen – oder den Pfad prüfen.");
    } else if (chart.includes("/") && !host.helmRepos.includes(chart.split("/")[0])) {
      return host._err("Error: repo " + chart.split("/")[0] + " not found", "Erst 'helm repo add ...' ausführen.");
    }
    if (host.releases.some(r => r.name === release)) return host._err("Error: INSTALLATION FAILED: cannot re-use a name that is still in use", "Der Release-Name ist schon vergeben. Nimm 'helm upgrade' oder einen anderen Namen.");
    const replicas = setValue(raw, "replicaCount") || 1;
    const chartShort = isLocal ? localName : (chart.split("/").pop() || chart);
    const depName = release + "-" + chartShort.split(":")[0];
    addDeployment(host, host._makeDeployment(depName, chartShort + ":latest", replicas));
    host.services.push(host._makeService({ name: depName, port: "80" })); // #507: zentral über die Fabrik

    host.releases.push({ name: release, chart, revision: 1, depName, history: [{ revision: 1, replicas }] });
    return [
      "NAME: " + release,
      "LAST DEPLOYED: heute",
      "NAMESPACE: default",
      "STATUS: deployed",
      "REVISION: 1",
      "NOTES:",
      "Das Chart wurde installiert! Schau mit 'kubectl get pods' nach,",
      "welche Pods es für dich erzeugt hat. ⎈",
    ].join("\n");
  }

  if (sub === "list" || sub === "ls") {
    if (host.releases.length === 0) return "NAME   NAMESPACE   REVISION   STATUS   CHART";
    return table(["NAME", "NAMESPACE", "REVISION", "STATUS", "CHART"],
      host.releases.map(r => [r.name, "default", String(r.revision), "deployed", (r.chart.split("/").pop() || r.chart) + "-18.1.0"]));
  }

  if (sub === "upgrade") {
    const release = t[2], chart = t[3];
    if (!release || !chart) return host._err("helm upgrade: Release und Chart fehlen.", "Muster: 'helm upgrade <release> bitnami/nginx --set replicaCount=3'");
    const rel = host.releases.find(r => r.name === release);
    if (!rel) return host._err('Error: UPGRADE FAILED: "' + release + '" has no deployed releases', "Welche Releases es gibt: 'helm list'");
    const replicas = setValue(raw, "replicaCount");
    rel.revision++;
    const newReplicas = replicas || rel.history[rel.history.length - 1].replicas;
    rel.history.push({ revision: rel.revision, replicas: newReplicas });
    const dep = host.deployments.find(d => d.name === rel.depName);
    if (dep && replicas) scaleDeployment(dep, replicas, host.clock);
    return 'Release "' + release + '" has been upgraded. Happy Helming!\nREVISION: ' + rel.revision;
  }

  if (sub === "rollback") {
    const release = t[2];
    const targetRev = t[3] ? parseInt(t[3], 10) : null;
    const rel = host.releases.find(r => r.name === release);
    if (!rel) return host._err("Error: release: not found", "Welche Releases es gibt: 'helm list'");
    const target = targetRev
      ? rel.history.find(h => h.revision === targetRev)
      : rel.history[rel.history.length - 2];
    if (!target) return host._err("Error: revision not found", "Verfügbare Revisionen: 1 bis " + rel.revision);
    rel.revision++;
    rel.history.push({ revision: rel.revision, replicas: target.replicas });
    const dep = host.deployments.find(d => d.name === rel.depName);
    if (dep) scaleDeployment(dep, target.replicas, host.clock);
    return "Rollback was a success! Happy Helming!";
  }

  if (sub === "uninstall" || sub === "delete") {
    const release = t[2];
    const idx = host.releases.findIndex(r => r.name === release);
    if (idx === -1) return host._err("Error: uninstall: Release not loaded: " + (release || "?") + ": release: not found", "Welche Releases es gibt: 'helm list'");
    const rel = host.releases[idx];
    host.deployments = host.deployments.filter(d => d.name !== rel.depName);
    host.services = host.services.filter(s => s.name !== rel.depName);
    host.releases.splice(idx, 1);
    return 'release "' + release + '" uninstalled';
  }

  if (sub === "status") {
    const release = t[2];
    const rel = host.releases.find(r => r.name === release);
    if (!rel) return host._err("Error: release: not found");
    return ["NAME: " + rel.name, "NAMESPACE: default", "STATUS: deployed", "REVISION: " + rel.revision].join("\n");
  }

  if (sub === "dependency" || sub === "dep") {
    const action = t[2];
    const ref = t[3];
    if (action === "update" || action === "build" || action === "up") {
      if (!ref) return host._err("helm dependency " + action + ": Chart-Pfad fehlt.", "z.B. 'helm dependency update ./mein-chart'");
      const name = ref.replace(/^\.?\.?\//, "").replace(/\/+$/, "");
      if (!host.charts.some(c => c.name === name)) return host._err('Error: path "' + ref + '" not found', "Chart erst mit 'helm create " + name + "' anlegen.");
      return [
        "Hang tight while we grab the latest from your chart repositories...",
        "Saving " + name + " to " + ref + "/charts",
        "Deleting outdated charts",
        "",
        "Successfully got an update from your chart repositories.",
        "Chart.lock updated.",
      ].join("\n");
    }
    return host._err("helm dependency: unbekannte Aktion '" + (action || "") + "'", "Gültig: update, build, up");
  }

  return host._err("helm: unbekannter Unterbefehl '" + sub + "'", "Tippe 'help' für alle Befehle.");
}
