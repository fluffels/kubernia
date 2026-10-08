/* ===== Kubernia – kubectl get -o: Ausgabeformate prüfen (sim/kubectl/output.ts, #1466) =====
 * Der Wert von `-o/--output` wird an der Eingabegrenze geprüft (FlagSpec.check, ../cliargs), wie in
 * echtem kubectl (cli-runtime `PrintFlags`): ein leerer Wert ist die normale Tabelle, `wide` hängt Spalten
 * an, jedes andere bekannte Format kennt der Simulator nicht (`Nicht simuliert` samt Lernhinweis), ein
 * unbekannter Wert bekommt den echten Fehlertext samt der Liste der erlaubten Formate.
 *
 * Eine Formattabelle als Daten: ein weiteres Format (z.B. `yaml`, #1467) ist ein Schalter `simulated`.
 * Abweichung zu echtem kubectl: es baut den Printer erst NACH der Server-Anfrage (`r.Infos()`), die Sim prüft
 * vorher (vor dem Control-Plane-Gate), damit ein Tippfehler im Format nie hinter „connection refused“ verschwindet.
 *
 * Blattmodul der kubectl-Mappe (pure Domäne): importiert nur das Blattmodul ../cliargs. */
import { checkedFlag, flagValueOf, notSimulated, type ErrHost } from "../cliargs";

interface OutputFormat {
  readonly name: string;
  /** json, yaml, kyaml und name werden wie in kubectl kleingeschrieben verglichen, die übrigen exakt. */
  readonly ignoreCase?: boolean;
  /** Template-Familien tragen ihr Template hinter `=` (`jsonpath={.x}`); ohne Template ist die Sim ebenfalls „nicht simuliert“. */
  readonly template?: boolean;
  /** Wertet die Sim das Format aus? Nur `wide` (und später `yaml`, #1467). */
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
  plain("yaml", true),
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
  if (fmt) return notSimulated(host, "das Ausgabeformat '-o " + value + "'.", ["kubectl get <art> -o wide", "kubectl describe <art> <name>"]);
  return host._err(
    "error: unable to match a printer suitable for the output format " + JSON.stringify(value) + ", allowed formats are: " + OUTPUT_FORMATS.map(f => f.name).join(","),
    "Der Simulator kann -o wide; Details zeigt 'kubectl describe'.");
}

/** Das Flag `-o/--output` mit Wertprüfung (in der Flag-Tabelle von `get`). */
export const OUTPUT_FLAG = checkedFlag(checkOutputFormat, "-o", "--output");

/** Verlangt die Anfrage `-o wide`? (Nach `checkArgs` ist jeder andere Wert leer oder ausgewertet.) */
export function isWide(t: readonly string[]): boolean {
  return flagValueOf(t, OUTPUT_FLAG.names) === "wide";
}
