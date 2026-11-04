/* ===== Kubernia – echte, nicht simulierte kubectl-Flags je Ziel (sim/kubectl/real-flags.ts, #1996) =====
 * Daten für `realFlags` (cliargs.ts): welche Flags das echte kubectl an einem Ziel kennt, die die Sim nicht auswertet.
 * Mit der Liste ist das Ziel eine geschlossene Welt: diese Flags sind „Nicht simuliert“, jedes andere Flag meldet
 * `error: unknown flag`. Die Liste nennt NICHT die Flags, die die Sim auswertet (`flags` des Ziels) und enthält
 * die Familien-Flags nur einmal (`KUBECTL_OPTIONS`, gelten an jedem Ziel).
 *
 * Quelle: kubernetes/kubernetes, Tag v1.37.1 (staging/src/k8s.io): `kubectl/pkg/cmd/{create,set,rollout,auth,get,describe,scale,expose,delete,apply,logs,top,label}/*.go` (die
 * `cmd.Flags()`-Aufrufe je Befehl), `kubectl/pkg/cmd/util/helpers.go` (AddDryRunFlag, AddValidateFlags,
 * AddFieldManagerFlagVar, AddApplyAnnotationFlags, AddFilenameOptionFlags, AddLabelSelectorFlagVar),
 * `cli-runtime/pkg/genericclioptions/{print_flags,json_yaml_flags,template_flags,record_flags}.go` und für die globalen
 * Flags `cli-runtime/.../config_flags.go` (AddFlags), `kubectl/pkg/cmd/cmd.go` (PersistentFlags), `component-base/logs`.
 * Der Konsistenztest `test/sim/flag-tabellen.test.ts` führt die Listen unabhängig von hier gegen die Quelle.
 *
 * Grenze: die Listen nennen nur Namen, nicht ob ein Flag einen Wert nimmt: der Wert eines echten Wert-Flags (`-o yaml`) wird im
 * Scan als Positionsargument gelesen. Folgenlos, weil das echte Flag vor `tooMany` und dem Handler als „Nicht simuliert“ gemeldet wird.
 *
 * Reines Datenmodul (pure Domäne, keine Imports). */

/** Die globalen kubectl-Flags (`kubectl options`, persistente Flags der Wurzel): gelten an jedem Ziel und vor dem Unterbefehl (#1998: dort „Nicht simuliert“, nie `unknown flag`). */
export const KUBECTL_OPTIONS: readonly string[] = [
  "--as", "--as-group", "--as-uid", "--as-user-extra", "--cache-dir", "--certificate-authority", "--client-certificate", "--client-key",
  "--cluster", "--context", "--disable-compression", "--insecure-skip-tls-verify", "--kubeconfig", "--kuberc", "--log-flush-frequency",
  "--match-server-version", "--password", "--profile", "--profile-output", "--proxy-url", "--request-timeout", "-s", "--server",
  "--tls-server-name", "--token", "--user", "--username", "-v", "--v", "--vmodule", "--warnings-as-errors",
];

/** Der Drucker ohne Ausgabeformat (JSON/YAML, go-template). */
const PRINT_REST = ["--show-managed-fields", "--template", "--allow-missing-template-keys"];
/** Der Drucker (`PrintFlags.AddFlags`: Ausgabeformat, JSON/YAML, go-template). */
const PRINT = ["-o", "--output", ...PRINT_REST];
/** `AddFilenameOptionFlags` ohne `-f/--filename` (das werten delete und apply aus). */
const FILENAME_REST = ["-R", "--recursive", "-k", "--kustomize"];
/** `AddFilenameOptionFlags`. */
const FILENAME = ["-f", "--filename", ...FILENAME_REST];
/** `AddLabelSelectorFlagVar`. */
const SELECTOR = ["-l", "--selector"];
/** Der Rumpf der `create`-Befehle: Drucker, `--save-config`, `--validate`, `--dry-run`, `--field-manager`. */
const CREATE_BASIS = [...PRINT, "--save-config", "--validate", "--dry-run", "--field-manager"];
/** Der Rumpf von `set image` und `set resources` (dazu je die veralteten RecordFlags `--record`). */
const SET_BASIS = [...PRINT, ...FILENAME, ...SELECTOR, "--all", "--local", "--dry-run", "--field-manager"];

export const REAL_CREATE_DEPLOYMENT = [...CREATE_BASIS, "--port"];
export const REAL_CREATE_SERVICEACCOUNT = CREATE_BASIS;
export const REAL_CREATE_ROLE = [...CREATE_BASIS, "--resource-name"];
export const REAL_CREATE_CLUSTERROLE = [...CREATE_BASIS, "--non-resource-url", "--resource-name", "--aggregation-rule"];
export const REAL_CREATE_ROLEBINDING = [...CREATE_BASIS, "--group"];
export const REAL_CREATE_CLUSTERROLEBINDING = [...CREATE_BASIS, "--group"];
export const REAL_CREATE_CONFIGMAP = [...CREATE_BASIS, "--from-file", "--from-env-file", "--append-hash"];
export const REAL_CREATE_SECRET_GENERIC = [...CREATE_BASIS, "--from-file", "--from-env-file", "--type", "--append-hash"];
export const REAL_CREATE_SECRET_TLS = [...CREATE_BASIS, "--append-hash"];

export const REAL_SET_IMAGE = [...SET_BASIS, "--record"];
export const REAL_SET_ENV = [...PRINT, ...FILENAME, ...SELECTOR, "-c", "--containers", "--prefix", "-e", "--env", "--keys", "--list", "--resolve", "--local", "--all", "--overwrite", "--dry-run", "--field-manager"];
export const REAL_SET_RESOURCES = [...SET_BASIS, "--record", "-c", "--containers"];

export const REAL_ROLLOUT_RESTART = [...PRINT, ...FILENAME, ...SELECTOR, "--field-manager"];
export const REAL_ROLLOUT_HISTORY = [...PRINT, ...FILENAME, ...SELECTOR, "--revision"];
export const REAL_ROLLOUT_UNDO = [...PRINT, ...FILENAME, ...SELECTOR, "--dry-run"];

export const REAL_AUTH_CANI = ["-A", "--all-namespaces", "-q", "--quiet", "--subresource", "--list", "--no-headers"];

/* Die Top-Level-Ziele (ohne die Flags, die die Sim auswertet: get -A/-o, scale --replicas, expose --port/--target-port/--type,
 * delete und apply -f, logs -f/-p, label --overwrite). `top` ist EIN Ziel der Sim für `top pods` und `top nodes`: die Vereinigung
 * beider Befehle (top_pod.go, top_node.go); die Sim trennt pods und nodes bei den Flags nicht. `--applyset` (apply) gibt es nur
 * mit dem Feature-Gate KUBECTL_APPLYSET und steht deshalb nicht hier. */
export const REAL_GET = [...PRINT_REST, "--show-labels", "--sort-by", "-L", "--label-columns", "--show-kind", "--no-headers", "--raw", "-w", "--watch", "--watch-only", "--output-watch-events", "--ignore-not-found", "--field-selector", ...FILENAME, "--chunk-size", ...SELECTOR, "--subresource", "--server-print"];
export const REAL_DESCRIBE = [...FILENAME, ...SELECTOR, "-A", "--all-namespaces", "--show-events", "--chunk-size"];
export const REAL_SCALE = [...PRINT, "--record", "--all", "--resource-version", "--current-replicas", "--timeout", ...FILENAME, "--dry-run", ...SELECTOR];
export const REAL_EXPOSE = [...PRINT, "--record", "--protocol", "--selector", "-l", "--labels", "--external-ip", "--load-balancer-ip", "--name", "--session-affinity", "--cluster-ip", "--field-manager", "--dry-run", "--save-config", "--overrides", "--override-type", ...FILENAME];
export const REAL_DELETE = [...FILENAME_REST, ...SELECTOR, "--field-selector", "--all", "-A", "--all-namespaces", "--force", "--cascade", "--now", "--grace-period", "--timeout", "--ignore-not-found", "--wait", "-o", "--output", "--raw", "-i", "--interactive", "--dry-run"];
export const REAL_APPLY = [...FILENAME_REST, "--cascade", "--grace-period", "--force", "--timeout", "--wait", "--record", ...PRINT, "--validate", "--dry-run", "--server-side", "--force-conflicts", "--field-manager", ...SELECTOR, "--prune-allowlist", "--all", "--prune", "--overwrite", "--openapi-patch", "--subresource"];
export const REAL_LOGS = ["--all-pods", "--all-containers", "--timestamps", "--limit-bytes", "--tail", "--ignore-errors", "--since-time", "--since", "-c", "--container", "--insecure-skip-tls-verify-backend", "--pod-running-timeout", ...SELECTOR, "--max-log-requests", "--prefix"];
export const REAL_TOP = [...SELECTOR, "--field-selector", "--sort-by", "--containers", "-A", "--all-namespaces", "--no-headers", "--use-protocol-buffers", "--sum", "--show-swap", "--show-capacity"];
export const REAL_LABEL = [...PRINT, "--record", "--list", "--local", "--field-selector", "--all", "-A", "--all-namespaces", "--resource-version", ...FILENAME, "--dry-run", "--field-manager", ...SELECTOR];
