/* ===== Kubernia – gemeinsame CLI-Eingabegrenze: Flag-Tabellen, Parser, „nicht simuliert“ (sim/cliargs.ts, #1459) =====
 * Die EINE Stelle, an der jede Befehlsfamilie (kubectl, docker, helm, argocd, glab, terraform) prüft, welche
 * Flags die Sim je Unterbefehl auswertet. Alles andere wurde früher still ignoriert (`docker ps -q` druckte
 * die Tabelle, `docker run -e A=b nginx` machte `A=b` zum Image) und wird jetzt ehrlich abgelehnt – mit dem
 * Lernhinweis, was der Simulator stattdessen kann. Ein einheitlicher Helfer `notSimulated` ersetzt die
 * verschiedenen „nicht simuliert“-Texte der Familien.
 *
 * Die Tabelle nennt NUR Flags, die die Sim wirklich auswertet (echte CLIs haben Hunderte; „was wir können“
 * ist endlich und ehrlich). Ausnahmen sind im Tabellen-Eintrag kommentiert.
 *
 * Zwei Schreibweisen-Stile: `pflag` (kubectl, docker, helm, argocd, glab: `--x=v`, `--x v`, kurz `-xv`,
 * Ketten kurzer Bool-Flags `-aq`) und `goflag` (terraform, Go-Paket `flag`: `-x=v`, `-x v`, `--x` ≙ `-x`,
 * der Name ist alles vor dem `=`, also `-out=plan` ≠ `-o`).
 *
 * Ein Scanner (`walk`) speist alles: `checkFlags` (Prüfung), `positionalArgs`, `parseCall` (Prüfung + `Call` mit
 * `args`/`has`/`value`/`values`/`list`, #1469: kein Handler indiziert mehr feste Tokens). Regeln:
 * `--` beendet die Flags, Bool-Flags werten `=true|false` aus (`strconv.ParseBool`), Ketten `-fp` werden je Zeichen
 * gelesen, ein Wert-Flag in der Kette schluckt den Rest (`-nfoo` setzt kein `-f`), der LETZTE Wert gewinnt.
 *
 * Blattmodul (pure Domäne, importfrei): jede Familie darf es importieren, ohne Zyklus. */

/** Was die Prüfung vom Host braucht: die Fehlerausgabe. */
export interface ErrHost { _err(msg: string, tip?: string): string }

export type FlagStyle = "pflag" | "goflag";

export interface FlagSpec {
  readonly names: readonly string[];
  readonly takesValue: boolean;
  /** Wertprüfung (#1466): `null` = Wert gültig, sonst die fertige Fehlerausgabe. Läuft in `checkFlags`/`parseCall`
   *  mit dem Wert in jeder Schreibweise (`-o x`, `-o=x`, `-ox`, `--output=x`, in einer Kette `-Ao wide`). */
  readonly check?: (host: ErrHost, value: string) => string | null;
}

/** Ein Flag der Tabelle (`flag(true, "-n", "--namespace")`). */
export const flag = (takesValue: boolean, ...names: string[]): FlagSpec => ({ names, takesValue });

/** Ein Wert-Flag mit Wertprüfung. */
export const checkedFlag = (check: NonNullable<FlagSpec["check"]>, ...names: string[]): FlagSpec => ({ names, takesValue: true, check });

/** Die Flag-Tabelle EINES Unterbefehls. */
export interface ArgSpec {
  /** Der Befehl für Meldungen, z.B. `argocd app list`. */
  readonly cmd: string;
  readonly flags: readonly FlagSpec[];
  readonly style?: FlagStyle;
  /** Lernhinweise je Flag-Name (`-o`) für Flags, die Spieler aus dem echten Werkzeug kennen. */
  readonly hints?: Readonly<Record<string, string>>;
  /** Das erste Nicht-Flag beendet die Prüfung (`docker run IMAGE BEFEHL …`: danach gehört alles dem Container). */
  readonly stopAtPositional?: boolean;
}

/** Der EINE Text für „das kann der Simulator nicht“: Meldung + Liste, was er stattdessen kann. */
export function notSimulated(host: ErrHost, was: string, kann: readonly string[], hint?: string): string {
  return host._err("Nicht simuliert: " + was + (hint ? " " + hint : ""), "Der Simulator kann: " + kann.join(" · "));
}

export function isFlagToken(tok: string): boolean {
  return tok.length > 1 && tok.startsWith("-");
}

const styleOf = (spec: Pick<ArgSpec, "style">): FlagStyle => spec.style ?? "pflag";

/** Das Flag eines Tokens (pflag: `--type=x` → `--type`, `-nkube-system` → `-n`; goflag: `--out=x` → `-out`). */
function flagNameOf(tok: string, style: FlagStyle): string {
  if (style === "goflag") {
    const body = tok.replace(/^--?/, "");
    const eq = body.indexOf("=");
    return "-" + (eq < 0 ? body : body.slice(0, eq));
  }
  if (tok.startsWith("--")) { const eq = tok.indexOf("="); return eq < 0 ? tok : tok.slice(0, eq); }
  return tok.slice(0, 2);
}

/** `strconv.ParseBool`: die sechs wahren und sechs falschen Schreibweisen, sonst `null`. */
export function parseBool(v: string): boolean | null {
  if (["1", "t", "T", "TRUE", "true", "True"].includes(v)) return true;
  if (["0", "f", "F", "FALSE", "false", "False"].includes(v)) return false;
  return null;
}

function findSpec(specs: readonly FlagSpec[], name: string): FlagSpec | undefined {
  return specs.find(s => s.names.includes(name));
}

interface Hit { readonly spec: FlagSpec; readonly value: string | null }
type ScanError =
  | { kind: "unknown"; name: string }
  | { kind: "missing"; name: string }
  | { kind: "bool"; label: string; value: string };
interface Walk { hits: Hit[]; entries: { tok: string; at: number }[]; error: ScanError | null }
interface Step { used: boolean; error: ScanError | null }

/** Ein benanntes Flag lesen: Wert-Flags nehmen den angeklebten Wert oder den nächsten Token, Bool-Flags nur `=bool`. */
function take(flags: readonly FlagSpec[], name: string, attached: string | null, next: string | undefined, w: Walk): Step {
  const s = findSpec(flags, name);
  if (!s) return { used: false, error: { kind: "unknown", name } };
  if (s.takesValue) {
    const v = attached ?? next;
    if (v === undefined) return { used: false, error: { kind: "missing", name } };
    w.hits.push({ spec: s, value: v });
    return { used: attached === null, error: null };
  }
  if (attached !== null && parseBool(attached) === null) return { used: false, error: { kind: "bool", label: s.names.join(", "), value: attached } };
  w.hits.push({ spec: s, value: attached });
  return { used: false, error: null };
}

/** Kette kurzer Flags (`-aq`, pflag): jedes Zeichen ist ein Flag; ein Wert-Flag schluckt den Rest (`-nfoo` setzt kein `-f`). */
function scanChain(flags: readonly FlagSpec[], tok: string, next: string | undefined, w: Walk): Step {
  for (let k = 1; k < tok.length; k++) {
    const name = "-" + tok[k];
    const s = findSpec(flags, name);
    if (!s) return { used: false, error: { kind: "unknown", name } };
    const rest = tok.slice(k + 1);
    if (s.takesValue || rest === "" || rest.startsWith("=")) {
      const attached = rest === "" ? null : rest.startsWith("=") ? rest.slice(1) : rest;
      return take(flags, name, attached, next, w);
    }
    w.hits.push({ spec: s, value: null });
  }
  return { used: false, error: null };
}

/** Der EINE Scanner hinter Prüfung und Auslesen. `--` beendet die Flags; mit `stopAtPositional` gehört alles ab
 *  dem ersten Nicht-Flag (der Container-Befehl hinter dem Image) zu den Positionsargumenten. Der erste Fehler wird
 *  gemerkt, der Scan läuft weiter (so bleiben die Positionsargumente auch bei einem unbekannten Flag lesbar). */
function walk(spec: ArgSpec, t: readonly string[], from: number): Walk {
  const style = styleOf(spec);
  const w: Walk = { hits: [], entries: [], error: null };
  for (let i = from; i < t.length; i++) {
    const tok = t[i];
    const rest = tok === "--" ? i + 1 : !isFlagToken(tok) && spec.stopAtPositional ? i : -1;
    if (rest >= 0) { for (let k = rest; k < t.length; k++) w.entries.push({ tok: t[k], at: k }); break; }
    if (!isFlagToken(tok)) { w.entries.push({ tok, at: i }); continue; }
    const step = style === "pflag" && !tok.startsWith("--")
      ? scanChain(spec.flags, tok, t[i + 1], w)
      : take(spec.flags, flagNameOf(tok, style), tok.includes("=") ? tok.slice(tok.indexOf("=") + 1) : null, t[i + 1], w);
    if (step.error) { w.error ??= step.error; if (step.error.kind === "missing") break; continue; }
    if (step.used) i++;
  }
  return w;
}

function missingValue(host: ErrHost, name: string, style: FlagStyle): string {
  if (style === "goflag") return host._err("flag needs an argument: " + name);
  return host._err("error: flag needs an argument: " + (name.startsWith("--") ? name : "'" + name.slice(1) + "' in " + name));
}

function flagList(specs: readonly FlagSpec[]): string[] {
  return specs.map(s => s.names.join("/") + (s.takesValue ? " <wert>" : ""));
}

function rejectFlag(host: ErrHost, spec: ArgSpec, name: string): string {
  const cli = spec.cmd.split(" ")[0];
  const hint = spec.hints?.[name] ?? (name === "-h" || name === "--help" ? "Hilfe zeigt der Simulator mit 'help " + cli + "'." : undefined);
  const kann = spec.flags.length ? "Flags: " + flagList(spec.flags).join(", ") : "'" + spec.cmd + "' ohne Flags";
  return notSimulated(host, "das Flag '" + name + "' bei '" + spec.cmd + "'.", [kann], hint);
}

function scanErrorText(host: ErrHost, spec: ArgSpec, e: ScanError): string {
  if (e.kind === "unknown") return rejectFlag(host, spec, e.name);
  if (e.kind === "missing") return missingValue(host, e.name, styleOf(spec));
  return host._err('invalid argument "' + e.value + '" for "' + e.label + '" flag: strconv.ParseBool: parsing "' + e.value + '": invalid syntax');
}

/** Der erste Fehler des Scans (unbekannt, ohne Wert, ungültiger Bool) oder der erste Wertprüfer, der anschlägt. */
function firstError(host: ErrHost, spec: ArgSpec, w: Walk): string | null {
  if (w.error) return scanErrorText(host, spec, w.error);
  for (const h of w.hits) {
    const invalid = h.value !== null && h.spec.check?.(host, h.value);
    if (invalid) return invalid;
  }
  return null;
}

/** Prüft alle Flags eines Unterbefehls ab Token `from`: unbekannte (nicht simulierte), Wert-Flags ohne Wert,
 *  ungültige Bool-Werte und Werte, die eine `check`-Funktion ablehnt. `null` = alles bekannt; sonst die fertige
 *  Fehlerausgabe. */
export function checkFlags(host: ErrHost, spec: ArgSpec, t: readonly string[], from: number): string | null {
  return firstError(host, spec, walk(spec, t, from));
}

/** Die Nicht-Flag-Tokens ab `from` (ohne die Werte der Wert-Flags; hinter `--` alles). */
export function positionalArgs(spec: ArgSpec, t: readonly string[], from: number): string[] {
  return walk(spec, t, from).entries.map(e => e.tok);
}

/** Die ausgelesene Eingabe EINES Unterbefehls: Positionsargumente und Flag-Werte (alle Aliase eines Flags zählen
 *  gleich). Kein Handler liest Tokens per Index oder Flags per Regex aus der Rohzeile. */
export interface Call {
  /** Die Nicht-Flag-Argumente in Eingabereihenfolge. */
  readonly args: readonly string[];
  /** Ist das Flag gesetzt (Bool-Flags werten `=true|false` aus; der letzte Treffer gewinnt)? */
  has(...names: string[]): boolean;
  /** Der Wert eines Wert-Flags; bei mehrfacher Angabe der letzte (pflag), `null` ohne das Flag. */
  value(...names: string[]): string | null;
  /** Alle Werte eines Wert-Flags in Eingabereihenfolge (`--set a=1 --set b=2`). */
  values(...names: string[]): string[];
  /** Ein pflag-StringSlice-Flag (`--verb=get,list --verb=watch`): jede Angabe wird an Kommas gesplittet, ein leerer Wert
   *  ergibt keinen Eintrag, `a,,b` behält das leere Feld; ohne das Flag `[]`. StringArray-Flags (`--user`) lesen `values`. */
  list(...names: string[]): string[];
}

function makeCall(w: Walk): Call {
  const match = (names: string[]) => w.hits.filter(h => h.spec.names.some(n => names.includes(n)));
  return {
    args: w.entries.map(e => e.tok),
    has: (...names) => {
      const last = match(names).pop();
      if (!last) return false;
      return last.spec.takesValue || last.value === null ? true : parseBool(last.value) === true;
    },
    value: (...names) => match(names).filter(h => h.spec.takesValue).pop()?.value ?? null,
    values: (...names) => match(names).filter(h => h.spec.takesValue).map(h => h.value ?? ""),
    list: (...names) => match(names).filter(h => h.spec.takesValue).flatMap(h => (h.value ?? "") === "" ? [] : (h.value ?? "").split(",")),
  };
}

/** Prüft die Flags (wie `checkFlags`) und liest dann die Eingabe: `Call` oder die fertige Fehlerausgabe. */
export function parseCall(host: ErrHost, spec: ArgSpec, t: readonly string[], from: number): Call | string {
  const w = walk(spec, t, from);
  return firstError(host, spec, w) ?? makeCall(w);
}

/** Zerlegt eine Eingabezeile wie die Shell: `"…"` und `'…'` gruppieren (in `"…"` gelten `\"` und `\\`), `\x` außerhalb
 *  von Quotes ist `x`, ein alleinstehendes `\` (Zeilenfortsetzung) fällt weg. `null` bei unbalancierten Quotes. */
export function shellTokens(raw: string): string[] | null {
  const out: string[] = [];
  let cur = "", open = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"' || c === "'") {
      const q = scanQuoted(raw, i + 1, c);
      if (!q) return null;
      cur += q.text; i = q.end; open = true;
    } else if (/\s/.test(c)) {
      if (open) { out.push(cur); cur = ""; open = false; }
    } else if (c === "\\") {
      if (i + 1 < raw.length && !/\s/.test(raw[i + 1])) { cur += raw[++i]; open = true; }
    } else { cur += c; open = true; }
  }
  if (open) out.push(cur);
  return out;
}

/** Der Inhalt eines Quote-Paars ab `from` (hinter dem öffnenden Zeichen): Text und Index des schließenden Zeichens,
 *  `null` ohne schließendes. In `"…"` gelten `\"` und `\\`, in `'…'` nichts. */
function scanQuoted(raw: string, from: number, quote: string): { text: string; end: number } | null {
  let text = "";
  for (let i = from; i < raw.length; i++) {
    const c = raw[i];
    if (c === quote) return { text, end: i };
    if (quote === '"' && c === "\\" && (raw[i + 1] === '"' || raw[i + 1] === "\\")) text += raw[++i];
    else text += c;
  }
  return null;
}

/** Der Eintrag einer Dispatch-Tabelle zu `key` – ohne Treffer auf Prototyp-Schlüsseln (`constructor`, `toString`). */
export function subEntry<E>(table: Readonly<Record<string, E>>, key: string): E | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Ein Eintrag einer Dispatch-Tabelle: Handler + Flag-Tabelle. Ein neuer Unterbefehl bleibt EIN Eintrag. */
export interface SubEntry<H> extends Omit<ArgSpec, "cmd" | "flags"> { readonly run: H; readonly flags?: readonly FlagSpec[] }

/** Die Flag-Tabelle eines Dispatch-Eintrags als `ArgSpec` (`cmd` = der volle Befehl für Meldungen); `defaultStyle`
 *  ist der Familien-Stil (terraform: `goflag`), ein Eintrag mit eigenem `style` überschreibt ihn. */
export function specOfSub(cmd: string, e: SubEntry<unknown>, defaultStyle: FlagStyle = "pflag"): ArgSpec {
  return { cmd, flags: e.flags ?? [], style: e.style ?? defaultStyle, hints: e.hints, stopAtPositional: e.stopAtPositional };
}
