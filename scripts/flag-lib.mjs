/* Flag-Parser der Skripte (#1789): ein gemeinsamer, purer Leser für die Kommandozeilen-Flags.
 *
 * Kein Shebang: Lib (Konvention #1398). Importiert nur `node:util`, gibt nichts aus und beendet nie den Prozess;
 * der Aufrufer entscheidet über Rahmen und Exit-Code (`AUFRUF_EXIT` für Aufruf-Fehler).
 *
 * Aufbau: `parseArgs` aus `node:util` im nicht-strikten Token-Modus, dazu eine eigene Token-Prüfung. Das erste
 * Problem in der Argumentreihenfolge gewinnt.
 */
import { parseArgs } from "node:util";

/** Exit-Code für einen Aufruf-Fehler (unbekanntes Flag, fehlender Wert, doppelt, fehlt). */
export const AUFRUF_EXIT = 2;

const STANDARD = {
  unbekannt: (flag) => `Unbekanntes Argument: ${flag}`,
  positional: (flag) => `Unbekanntes Argument: ${flag}`,
  "ohne-wert": (flag) => `${flag} braucht einen Wert`,
  doppelt: (flag) => `${flag} ist doppelt angegeben`,
  fehlt: (flag) => `${flag} fehlt`,
};

/**
 * Liest `argv` nach `optionen` (Format von `node:util`: `{ name: { type: "string"|"boolean", multiple? } }`).
 * Rückgabe `{ werte, positionale, tokens, fehler }`; `fehler` ist `null` oder `{ art, flag, text }` mit `art` aus
 * `unbekannt | ohne-wert | doppelt | positional | fehlt`. Ein Wert fehlt, wenn er am Ende fehlt, der nächste Token mit
 * `--` beginnt oder ein Inline-Wert (`--x=`) leer ist; negative Zahlen (`-5`) kommen als Wert durch.
 * `meldung(art, flag)` überschreibt den Standardtext (`undefined` = Standard).
 */
export function flagsLesen(argv, optionen, { positionale = false, pflicht = [], meldung } = {}) {
  for (const name of pflicht) if (!Object.hasOwn(optionen, name)) throw new Error(`flagsLesen: pflicht-Name ohne Option: ${name}`);
  const { values, positionals, tokens } = parseArgs({ args: argv, options: optionen, strict: false, allowPositionals: true, tokens: true });
  const werte = { ...values };
  const fehler = (art, flag) => ({ art, flag, text: meldung?.(art, flag) ?? STANDARD[art](flag) });
  const gesehen = new Set();
  for (const t of tokens) {
    if (t.kind === "positional") {
      if (!positionale) return { werte, positionale: positionals, tokens, fehler: fehler("positional", argv[t.index]) };
      continue;
    }
    if (t.kind !== "option") continue;
    if (!Object.hasOwn(optionen, t.name)) return { werte, positionale: positionals, tokens, fehler: fehler("unbekannt", argv[t.index]) };
    const opt = optionen[t.name];
    if (opt.type === "boolean" && t.value !== undefined) return { werte, positionale: positionals, tokens, fehler: fehler("unbekannt", argv[t.index]) };
    if (opt.type === "string") {
      const fehltWert = t.value === undefined || (t.inlineValue ? t.value === "" : t.value.startsWith("--"));
      if (fehltWert) return { werte, positionale: positionals, tokens, fehler: fehler("ohne-wert", t.rawName) };
    }
    if (!opt.multiple && gesehen.has(t.name)) return { werte, positionale: positionals, tokens, fehler: fehler("doppelt", t.rawName) };
    gesehen.add(t.name);
  }
  for (const name of pflicht) {
    if (werte[name] === undefined) return { werte, positionale: positionals, tokens, fehler: fehler("fehlt", `--${name}`) };
  }
  return { werte, positionale: positionals, tokens, fehler: null };
}
