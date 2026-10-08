/* ===== Kubernia – kubectl get -o: Ausgabeformate prüfen (sim/kubectl/output.ts, #1466) =====
 * Der Wert von `-o/--output` wird an der Eingabegrenze geprüft (FlagSpec.check, ../cliargs), wie in
 * echtem kubectl (cli-runtime `PrintFlags`): ein leerer Wert ist die normale Tabelle, `wide` hängt Spalten
 * an, `yaml` druckt die Objekte (./get-yaml), jedes andere bekannte Format kennt der Simulator nicht (`Nicht simuliert` samt Lernhinweis), ein
 * unbekannter Wert bekommt den echten Fehlertext samt der Liste der erlaubten Formate.
 *
 * Eine Formattabelle als Daten: ein weiteres Format ist ein Schalter `simulated` (`wide` und `yaml` sind es).
 * Abweichung zu echtem kubectl: es baut den Printer erst NACH der Server-Anfrage (`r.Infos()`), die Sim prüft
 * vorher (vor dem Control-Plane-Gate), damit ein Tippfehler im Format nie hinter „connection refused“ verschwindet.
 *
 * Blattmodul der kubectl-Mappe (pure Domäne): importiert nur das Blattmodul ../cliargs. */
import { checkedFlag, notSimulated, type Call, type ErrHost } from "../cliargs";

interface OutputFormat {
  readonly name: string;
  /** json, yaml, kyaml und name werden wie in kubectl kleingeschrieben verglichen, die übrigen exakt. */
  readonly ignoreCase?: boolean;
  /** Template-Familien tragen ihr Template hinter `=` (`jsonpath={.x}`); ohne Template ist die Sim ebenfalls „nicht simuliert“. */
  readonly template?: boolean;
  /** Wertet die Sim das Format aus? Nur `wide` und `yaml` (Objekt-Bausteine in ./get-yaml). */
  readonly simulated: boolean;
}

const plain = (name: string, ignoreCase = false): OutputFormat => ({ name, ignoreCase, simulated: false });
const templated = (name: string): OutputFormat => ({ name, template: true, simulated: false });

/** Alle Formate von `kubectl get -o`, in der Reihenfolge der Fehlermeldung von kubectl (alphabetisch). */
export const OUTPUT_FORMATS: readonly OutputFormat[] = [
  templated("custom-columns"), templated("custom-columns-file"), templated("go-template"), templated("go-template-file"),
  plain("json", true), templated("jsonpath"), templated("jsonpath-as-json"), templated("jsonpath-file"),
  plain("kyaml", true), plain("name", true), templated("template"), templated("templatefile"),
  { name: "wide", simulated: true },
  { name: "yaml", ignoreCase: true, simulated: true },
];

function formatOf(value: string): OutputFormat | undefined {
  return OUTPUT_FORMATS.find(f => {
    const v = f.ignoreCase ? value.toLowerCase() : value;
    return v === f.name || (f.template === true && v.startsWith(f.name + "="));
  });
}

/** Die Prüfung des `-o`-Werts: `null` = gültig (leer, `wide`), sonst die fertige Fehlerausgabe. */
export function checkOutputFormat(host: ErrHost, value: string): string | null {
  if (value === "") return null;
  const fmt = formatOf(value);
  if (fmt?.simulated) return null;
  if (fmt) return notSimulated(host, "das Ausgabeformat '-o " + value + "'.", ["kubectl get <art> -o wide", "kubectl get <art> -o yaml", "kubectl describe <art> <name>"]);
  return host._err(
    "error: unable to match a printer suitable for the output format " + JSON.stringify(value) + ", allowed formats are: " + OUTPUT_FORMATS.map(f => f.name).join(","),
    "Der Simulator kann -o wide und -o yaml; Details zeigt 'kubectl describe'.");
}

/** Das Flag `-o/--output` mit Wertprüfung (in der Flag-Tabelle von `get`). */
export const OUTPUT_FLAG = checkedFlag(checkOutputFormat, "-o", "--output");

/** Verlangt die Anfrage `-o wide`? (Nach `checkArgs` ist jeder andere Wert leer oder ausgewertet.) */
export function isWide(c: Call): boolean {
  return c.value(...OUTPUT_FLAG.names) === "wide";
}

/** Verlangt die Anfrage `-o yaml`? Wie kubectl ohne Rücksicht auf Groß-/Kleinschreibung (`-o YAML`). */
export function isYaml(c: Call): boolean {
  return c.value(...OUTPUT_FLAG.names)?.toLowerCase() === "yaml";
}
