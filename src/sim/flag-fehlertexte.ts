/* ===== Kubernia – Flag-Fehlertexte je Werkzeug (sim/flag-fehlertexte.ts, #2006) =====
 * Welche Bibliothek ein Werkzeug zum Lesen der Flags nutzt, bestimmt den Wortlaut des Flag-Fehlers: kubectl, helm, docker, argocd,
 * glab und kubeadm nutzen cobra/pflag (der Stil `pflag` in cliargs), terraform das Go-Paket `flag` (`goflag`). git, aws s3 und curl
 * haben eigene Parser und melden eigene Texte. Dieses Blattmodul (ohne Importe, kein Zyklus mit cliargs) hält die Texte als Tabellenwerte:
 * ein neues Werkzeug ist ein Wert hier und eine Zeile `fehlerTexte` an seiner Dispatch-Tabelle, die Vererbung läuft über cliargs.
 *
 * `wortlaut` ersetzt den Text einer Art komplett (`null` = es gilt der Stil-Text samt `fehlerPraefix`), `rahmen` legt die Zusatzzeilen
 * des Werkzeugs um den fertigen Text. Der deutsche Tipp bleibt in cliargs.
 *
 * Belege (gegen die Quelle gelesen, #2006):
 *  - git `parse-options.c`: `get_arg` („%s requires a value“), `do_get_value` („%s takes no value“, „%s expects a numerical value“),
 *    `parse_options` („unknown option `%s'“, „unknown switch `%c'“), `optname` („option `x'“ lang, „switch `x'“ kurz). `error()` setzt `error: `.
 *    Ein Kurz-Flag liest `=` nicht als Trenner (`-A=x` → `unknown switch `='`). Nur der Unbekannt-Fehler ruft danach `usage_with_options`.
 *  - aws `awscli/argparser.py` (v2.15.0, `CLIArgParser.error`): `<usage>\n` + `aws: error: <argparse-Text>`; `USAGE` + `HELP_BLURB` fest.
 *    Neuere Versionen (`errorformat.py`) drucken `aws: [ERROR]: …` und stellen den Usage-Block hinter die Meldung.
 *  - curl `tool_getparam.c` (`getparameter`, Ausgabe `helpf("option %s: %s", …)`), `tool_helpers.c` (`param2text`), `tool_msgs.c` (`helpf`).
 *  - docker `cli/cobra.go` `FlagErrorFunc`: `%s\n\nUsage:  %s\n\nRun '%s --help' for more information` (`UseLine` = Elternpfad + `Use`).
 *  - kubeadm `cmd/kubeadm/app/util/errors/errors.go` `handleError`/`exitWithCode`: `error: <Text>\nTo see the stack trace of this error execute with --v=5 or higher`.
 *  - terraform `internal/command/arguments/{plan,apply,unlock}.go` (Diagnose „Failed to parse command-line flags“), `views/view.go` `HelpPrompt`. `unlock.go` gibt es nur auf `main`; im Release v1.17.1 meldet force-unlock `Error parsing command-line flags` ohne Diagnose.
 *
 * Bekannte Grenzen: git zeigt nach `unknown option` den Optionen-Block des Befehls (nicht simuliert); curl nennt das ganze Token
 * (`-sSo`, `--x=v`) statt des Flag-Namens; aws kennt für unbekannte Optionen einen eigenen Pfad (`Unknown options: …`, Text nicht belegt: Stil-Text);
 * aws, git und curl lehnen ein Bool-Flag mit Wert unterschiedlich ab (git immer, aws immer, curl nie), die Sim lehnt bei curl an langen Flags nie ab (`boolWertEgal`, `tool_getparam.c`), die Kurzform `-s=x` meldet `curl: option -s=x: is unknown` (die Sim erkennt das nur bei ungültigen Bool-Werten, `-s=true` nimmt sie an, curl nicht), sonst nur ungültige Bool-Werte;
 * docker `build` (buildx-Alias) behält den Stil-Text; glab ebenso (fang `DefaultErrorHandler`: ohne TTY nur der Text, also der Stil-Text, mit TTY gestylt mit `ERROR`-Kopf, nicht nachgebildet; `NewGitLabErrorHandler` nicht geprüft);
 * kubeadm hängt die Stacktrace-Zeile hier nur an Flag-Fehler, echtes kubeadm hängt sie in `handleError` an jeden Fehler. */

/** Ein Fehler beim Lesen der Flags (der Scan von cliargs; `pflicht` kommt nach dem Scan, aus `requiredFlags`). */
export type ScanFehler =
  | { kind: "unknown"; name: string; shorthands?: string }
  | { kind: "missing"; name: string }
  | { kind: "bool"; name: string; label: string; value: string }
  | { kind: "int"; name: string; label: string; value: string; tip: string };
export type FlagFehler = ScanFehler | { kind: "pflicht"; namen: readonly string[] };
export type FlagFehlerArt = FlagFehler["kind"];

export interface FlagFehlerTexte {
  /** Der volle Text des Werkzeugs für diesen Fehler oder `null` (Stil-Text). `cmd` ist der Befehl für Meldungen (`docker run`). */
  readonly wortlaut?: (f: FlagFehler, cmd: string) => string | null;
  /** Die Zusatzzeilen des Werkzeugs um den fertigen Text (Usage-Block, Hilfe-Verweis, Diagnose-Rahmen). */
  readonly rahmen?: (text: string, cmd: string, kind: FlagFehlerArt) => string;
  /** Das Werkzeug nimmt an einem langen Bool-Flag jeden angeklebten Wert an (`--x=wert`) und ignoriert ihn, auch bei der Auswertung: kein Bool-Fehler (curl). Die Kurzform `-s=x` bleibt davon unberührt (Bool-Fehler, bei curl `is unknown`). */
  readonly boolWertEgal?: boolean;
}

/* ----- git: parse-options ----- */
const gitName = (name: string) => name.startsWith("--") ? "option `" + name.slice(2) + "'" : "switch `" + name.slice(1) + "'";

function gitWortlaut(f: FlagFehler): string | null {
  switch (f.kind) {
    case "unknown": return "error: " + (f.name.startsWith("--") ? "unknown option `" + f.name.slice(2) : "unknown switch `" + f.name[1]) + "'";
    case "missing": return "error: " + gitName(f.name) + " requires a value";
    case "int": return "error: " + gitName(f.name) + " expects a numerical value";
    // Lang: `takes no value`; kurz liest git das `=` als nächsten Schalter der Kette.
    case "bool": return f.name.startsWith("--") ? "error: " + gitName(f.name) + " takes no value" : "error: unknown switch `='";
    case "pflicht": return null;
  }
}
export const GIT_PARSE_OPTIONS: FlagFehlerTexte = { wortlaut: gitWortlaut };

/* ----- aws: argparse ----- */
const AWS_USAGE = "usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]\nTo see help text, you can run:\n\n  aws help\n  aws <command> help\n  aws <command> <subcommand> help\n";

function awsWortlaut(f: FlagFehler): string | null {
  switch (f.kind) {
    case "missing": return "argument " + f.name + ": expected one argument";
    case "bool": return "argument " + f.label.replace(", ", "/") + ": ignored explicit argument '" + f.value + "'";
    case "int": return "argument " + f.label.replace(", ", "/") + ": invalid int value: '" + f.value + "'";
    case "pflicht": return "the following arguments are required: " + f.namen.map(n => "--" + n).join(", ");
    case "unknown": return null;
  }
}
export const AWS_ARGPARSE: FlagFehlerTexte = {
  wortlaut: awsWortlaut,
  rahmen: (text, _cmd, kind) => kind === "unknown" ? text : AWS_USAGE + "\naws: error: " + text,
};

/* ----- curl: tool_getparam ----- */
const CURL_TRY = "curl: try 'curl --help' or 'curl --manual' for more information";

function curlWortlaut(f: FlagFehler): string | null {
  switch (f.kind) {
    case "unknown": return "curl: option " + f.name + ": is unknown";
    case "missing": return "curl: option " + f.name + ": requires parameter";
    case "int": return "curl: option " + f.name + ": expected a proper numerical parameter";
    case "bool": return "curl: option " + f.name + "=" + f.value + ": is unknown"; // nur die Kurzform `-s=x` (`findshortopt('=')`); an langen Flags nimmt curl jeden Wert an (`boolWertEgal`)
    case "pflicht": return null; // Pflicht-Flags gibt es bei curl nicht
  }
}
export const CURL_GETPARAM: FlagFehlerTexte = {
  boolWertEgal: true,
  wortlaut: curlWortlaut,
  rahmen: (text, _cmd, kind) => kind === "pflicht" ? text : text + "\n" + CURL_TRY,
};

/* ----- docker: FlagErrorFunc ----- */
/** `use` ist das `Use` des Befehls ohne seinen Namen (`[OPTIONS] IMAGE [COMMAND] [ARG...]`); ein Pflicht-Flag geht nicht durch die FlagErrorFunc. */
export const dockerFehler = (use: string): FlagFehlerTexte => ({
  rahmen: (text, cmd, kind) => kind === "pflicht" ? text : text + "\n\nUsage:  " + cmd + " " + use + "\n\nRun '" + cmd + " --help' for more information",
});

/* ----- kubeadm: handleError ----- */
export const KUBEADM_FEHLER: FlagFehlerTexte = {
  rahmen: text => text + "\nTo see the stack trace of this error execute with --v=5 or higher",
};

/* ----- terraform: Diagnose „Failed to parse command-line flags“ ----- */
/** `hilfe` ist der Befehl im Verweis `terraform <hilfe> -help` (plan, apply, destroy); `null` = der Befehl druckt keinen (force-unlock). Plain-Form ohne Kasten, wie die übrigen Fehler der Sim. */
export const tfDiagnose = (hilfe: string | null): FlagFehlerTexte => ({
  rahmen: text => "Error: Failed to parse command-line flags\n\n" + text + (hilfe ? "\n\nFor more help on using this command, run:\n  terraform " + hilfe + " -help" : ""),
});
