/* Factories für echtes Manifest-YAML in Tests (#1299). `kind: Deployment` als Platzhalter reicht
 * nicht mehr: der Dateiinhalt ist die Wahrheit, der Mapper liest ihn. Jede Ausgabe endet mit `\n`,
 * damit Multi-Dokument per `a + "---\n" + b` geht. */

export interface DeploymentYamlOpts {
  name: string;
  image?: string;
  replicas?: number;
  serviceAccountName?: string;
  containerPort?: number;
  nodeName?: string;
  /** Container-`securityContext` (nur die vier modellierten Felder). */
  securityContext?: { runAsNonRoot?: boolean; privileged?: boolean; readOnlyRootFilesystem?: boolean; allowPrivilegeEscalation?: boolean };
  ephemeralLimitMi?: number;
  /** `resources.limits.memory` als Text (z.B. "256Mi"). */
  memoryLimit?: string;
  /** `resources.limits.cpu` als Text ("250m") oder YAML-Zahl (0.5). */
  cpuLimit?: string | number;
  emptyDir?: boolean;
  initContainer?: boolean;
}

export function deploymentYaml(o: DeploymentYamlOpts): string {
  const pod: string[] = [];
  if (o.serviceAccountName !== undefined) pod.push(`      serviceAccountName: ${o.serviceAccountName}`);
  if (o.nodeName !== undefined) pod.push(`      nodeName: ${o.nodeName}`);
  if (o.initContainer) pod.push("      initContainers:", "        - name: init", "          image: busybox");
  const c: string[] = [`        - name: ${o.name}`, `          image: ${o.image ?? "nginx"}`];
  if (o.containerPort !== undefined) c.push("          ports:", `            - containerPort: ${o.containerPort}`);
  if (o.securityContext) {
    c.push("          securityContext:");
    for (const [k, v] of Object.entries(o.securityContext)) c.push(`            ${k}: ${String(v)}`);
  }
  const limits: string[] = [];
  if (o.memoryLimit !== undefined) limits.push(`              memory: ${o.memoryLimit}`);
  if (o.cpuLimit !== undefined) limits.push(`              cpu: ${String(o.cpuLimit)}`);
  if (o.ephemeralLimitMi !== undefined) limits.push(`              ephemeral-storage: ${o.ephemeralLimitMi}Mi`);
  if (limits.length > 0) c.push("          resources:", "            limits:", ...limits);
  if (o.emptyDir) c.push("          volumeMounts:", "            - name: scratch", "              mountPath: /scratch");
  const tail = o.emptyDir ? ["      volumes:", "        - name: scratch", "          emptyDir: {}"] : [];
  return [
    "apiVersion: apps/v1", "kind: Deployment", "metadata:", `  name: ${o.name}`,
    "spec:", `  replicas: ${o.replicas ?? 1}`, "  selector:", "    matchLabels:", `      app: ${o.name}`,
    "  template:", "    metadata:", "      labels:", `        app: ${o.name}`, "    spec:",
    ...pod, "      containers:", ...c, ...tail,
  ].join("\n") + "\n";
}

export interface ServiceYamlOpts { name: string; port: number; targetPort?: number; type?: string; externalName?: string }

export function serviceYaml(o: ServiceYamlOpts): string {
  const lines = ["apiVersion: v1", "kind: Service", "metadata:", `  name: ${o.name}`, "spec:"];
  if (o.type !== undefined) lines.push(`  type: ${o.type}`);
  if (o.externalName !== undefined) lines.push(`  externalName: ${o.externalName}`);
  else lines.push("  selector:", `    app: ${o.name}`);
  if (o.externalName === undefined) {
    lines.push("  ports:", `    - port: ${o.port}`);
    if (o.targetPort !== undefined) lines.push(`      targetPort: ${o.targetPort}`);
  }
  return lines.join("\n") + "\n";
}
