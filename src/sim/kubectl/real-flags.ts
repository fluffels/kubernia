/* ===== Kubernia – echte, nicht simulierte kubectl-Flags je Ziel (sim/kubectl/real-flags.ts, #1996) =====
 * Daten für `realFlags` (cliargs.ts): welche Flags das echte kubectl an einem Ziel kennt, die die Sim nicht auswertet.
 * Mit der Liste ist das Ziel eine geschlossene Welt: diese Flags sind „Nicht simuliert“, jedes andere Flag meldet
 * `error: unknown flag`. Die Liste nennt NICHT die Flags, die die Sim auswertet (`flags` des Ziels) und enthält
 * die Familien-Flags nur einmal (`KUBECTL_OPTIONS`, gelten an jedem Ziel).
 *
 * Quelle: kubernetes/kubernetes, Tag v1.37.1 (staging/src/k8s.io): `kubectl/pkg/cmd/{create,set,rollout,auth}/*.go` (die
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

/** Die globalen kubectl-Flags (`kubectl options`, persistente Flags der Wurzel): gelten an jedem Ziel. */
export const KUBECTL_OPTIONS: readonly string[] = [
  "--as", "--as-group", "--as-uid", "--as-user-extra", "--cache-dir", "--certificate-authority", "--client-certificate", "--client-key",
  "--cluster", "--context", "--disable-compression", "--insecure-skip-tls-verify", "--kubeconfig", "--kuberc", "--log-flush-frequency",
  "--match-server-version", "--password", "--profile", "--profile-output", "--proxy-url", "--request-timeout", "-s", "--server",
  "--tls-server-name", "--token", "--user", "--username", "-v", "--v", "--vmodule", "--warnings-as-errors",
];

/** Der Drucker (`PrintFlags.AddFlags`: Ausgabeformat, JSON/YAML, go-template). */
const PRINT = ["-o", "--output", "--show-managed-fields", "--template", "--allow-missing-template-keys"];
/** `AddFilenameOptionFlags`. */
const FILENAME = ["-f", "--filename", "-R", "--recursive", "-k", "--kustomize"];
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
