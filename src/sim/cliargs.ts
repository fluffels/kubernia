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
 * Blattmodul (pure Domäne, importfrei): jede Familie darf es importieren, ohne Zyklus. */

/** Was die Prüfung vom Host braucht: die Fehlerausgabe. */
export interface ErrHost { _err(msg: string, tip?: string): string }

export type FlagStyle = "pflag" | "goflag";

export interface FlagSpec { readonly names: readonly string[]; readonly takesValue: boolean }

/** Ein Flag der Tabelle (`flag(true, "-n", "--namespace")`). */
export const flag = (takesValue: boolean, ...names: string[]): FlagSpec => ({ names, takesValue });

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

/** Der Wert, der direkt am Token klebt (`--type=x`, `-n=x`, `-nx`, goflag `-out=x`), sonst null. */
function attachedValueOf(tok: string, style: FlagStyle): string | null {
  const eq = tok.indexOf("=");
  if (style === "goflag" || tok.startsWith("--")) return eq < 0 ? null : tok.slice(eq + 1);
  const rest = tok.slice(2);
  if (!rest) return null;
  return rest.startsWith("=") ? rest.slice(1) : rest;
}

/** Wert eines Flags mit seinen Schreibweisen (`-n x`, `-n=x`, `-nx`, `--namespace x`, `--namespace=x`; goflag
 *  `-var-file=x`, `-var-file x`). `null` = Flag fehlt oder ohne Wert. */
export function flagValueOf(t: readonly string[], names: readonly string[], style: FlagStyle = "pflag"): string | null {
  for (let i = 0; i < t.length; i++) {
    const tok = t[i];
    if (!isFlagToken(tok) || !names.includes(flagNameOf(tok, style))) continue;
    return attachedValueOf(tok, style) ?? t[i + 1] ?? null;
  }
  return null;
}

function findSpec(specs: readonly FlagSpec[], name: string): FlagSpec | undefined {
  return specs.find(s => s.names.includes(name));
}

interface Scan { unknown: string | null; needsNext: boolean; name: string }

/** Kette kurzer Flags (`-aq`): jedes Zeichen muss ein bekanntes Bool-Flag sein; ein Wert-Flag schluckt den Rest. */
function scanShortChain(specs: readonly FlagSpec[], tok: string): Scan {
  const first = flagNameOf(tok, "pflag");
  const spec = findSpec(specs, first);
  if (!spec) return { unknown: first, needsNext: false, name: first };
  if (spec.takesValue) return { unknown: null, needsNext: attachedValueOf(tok, "pflag") === null, name: first };
  const rest = tok.slice(2);
  for (let k = 0; k < rest.length; k++) {
    if (k === 0 && rest[0] === "=") return { unknown: null, needsNext: false, name: first };
    const name = "-" + rest[k];
    const s = findSpec(specs, name);
    if (!s) return { unknown: name, needsNext: false, name };
    if (s.takesValue) return { unknown: null, needsNext: k === rest.length - 1, name };
  }
  return { unknown: null, needsNext: false, name: first };
}

function scanToken(specs: readonly FlagSpec[], tok: string, style: FlagStyle): Scan {
  if (style === "pflag" && !tok.startsWith("--")) return scanShortChain(specs, tok);
  const name = flagNameOf(tok, style);
  const spec = findSpec(specs, name);
  if (!spec) return { unknown: name, needsNext: false, name };
  return { unknown: null, needsNext: spec.takesValue && attachedValueOf(tok, style) === null, name };
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

/** Prüft alle Flags eines Unterbefehls ab Token `from`: unbekannte (nicht simulierte) und Wert-Flags ohne Wert.
 *  `null` = alles bekannt; sonst die fertige Fehlerausgabe. */
export function checkFlags(host: ErrHost, spec: ArgSpec, t: readonly string[], from: number): string | null {
  const style = styleOf(spec);
  for (let i = from; i < t.length; i++) {
    const tok = t[i];
    if (!isFlagToken(tok)) { if (spec.stopAtPositional) break; continue; }
    const scan = scanToken(spec.flags, tok, style);
    if (scan.unknown) return rejectFlag(host, spec, scan.unknown);
    if (!scan.needsNext) continue;
    if (t[i + 1] === undefined) return missingValue(host, scan.name, style);
    i++; // der Wert gehört zum Flag
  }
  return null;
}

/** Die Nicht-Flag-Tokens ab `from` mit ihrem Index (ohne die Werte der Wert-Flags). Mit `stopAtPositional`
 *  gehört alles ab dem ersten Nicht-Flag dazu (der Container-Befehl hinter dem Image). */
function positionalEntries(spec: ArgSpec, t: readonly string[], from: number): { tok: string; at: number }[] {
  const style = styleOf(spec);
  const out: { tok: string; at: number }[] = [];
  for (let i = from; i < t.length; i++) {
    const tok = t[i];
    if (!isFlagToken(tok)) {
      if (spec.stopAtPositional) { for (let k = i; k < t.length; k++) out.push({ tok: t[k], at: k }); break; }
      out.push({ tok, at: i });
      continue;
    }
    const scan = scanToken(spec.flags, tok, style);
    if (!scan.unknown && scan.needsNext) i++;
  }
  return out;
}

/** Die Nicht-Flag-Tokens ab `from` (ohne die Werte der Wert-Flags). */
export function positionalArgs(spec: ArgSpec, t: readonly string[], from: number): string[] {
  return positionalEntries(spec, t, from).map(e => e.tok);
}

/** Der Index des ersten Nicht-Flag-Tokens ab `from` (ohne Flag-Werte), `-1` ohne eines. */
export function firstPositionalIndex(spec: ArgSpec, t: readonly string[], from: number): number {
  return positionalEntries(spec, t, from)[0]?.at ?? -1;
}

/** Steht ein Bool-Flag (`-a`/`--all`, auch `-a=true`, in einer Kette `-ad`)? Nur für Tabellen ohne Wert-Flag
 *  vor dem Zeichen gedacht (z.B. `docker ps`). */
export function hasFlag(t: readonly string[], names: readonly string[]): boolean {
  return t.some(tok => {
    if (!isFlagToken(tok)) return false;
    if (tok.startsWith("--")) return names.includes(flagNameOf(tok, "pflag"));
    return names.some(n => n.length === 2 && tok.slice(1).split("=")[0].includes(n[1]));
  });
}

/** Der Eintrag einer Dispatch-Tabelle zu `key` – ohne Treffer auf Prototyp-Schlüsseln (`constructor`, `toString`). */
export function subEntry<E>(table: Readonly<Record<string, E>>, key: string): E | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Ein Eintrag einer Dispatch-Tabelle: Handler + Flag-Tabelle. Ein neuer Unterbefehl bleibt EIN Eintrag. */
export interface SubEntry<H> extends Omit<ArgSpec, "cmd" | "flags"> { readonly run: H; readonly flags?: readonly FlagSpec[] }

/** Die Flag-Tabelle eines Dispatch-Eintrags als `ArgSpec` (`cmd` = der volle Befehl für Meldungen). */
export function specOfSub(cmd: string, e: SubEntry<unknown>): ArgSpec {
  return { cmd, flags: e.flags ?? [], style: e.style, hints: e.hints, stopAtPositional: e.stopAtPositional };
}
