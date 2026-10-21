/* Flag-Parser der Skripte (#1789): ein gemeinsamer, purer Leser für die Kommandozeilen-Flags.
 *
 * Kein Shebang: Lib (Konvention #1398). Importiert nur `node:util`, die Leser (`flagsLesen`, `befehlLesen`) geben nichts aus und
 * beenden nie den Prozess; der Aufrufer entscheidet über Rahmen und Exit-Code (`AUFRUF_EXIT` für Aufruf-Fehler). Nur
 * `direktaufruf` schreibt (über eine austauschbare `ausgabe`) und setzt `process.exitCode`.
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
  terminator: (flag) => `Unbekanntes Argument: ${flag}`,
  befehl: (name) => `unbekannter Befehl ${name === undefined ? "(keiner)" : `„${name}“`}`,
  "ohne-wert": (flag) => `${flag} braucht einen Wert`,
  doppelt: (flag) => `${flag} ist doppelt angegeben`,
  fehlt: (flag) => `${flag} fehlt`,
};

/** Text einer Überschreibung: Funktion `(art, flag) => text`, oder Objekt `{ art: text | (flag) => text }`; `undefined` = Standard. */
function meldungText(meldung, art, flag) {
  if (typeof meldung === "function") return meldung(art, flag);
  if (!meldung || !Object.hasOwn(meldung, art)) return undefined;
  const eintrag = meldung[art];
  return typeof eintrag === "function" ? eintrag(flag) : eintrag;
}

/**
 * Liest `argv` nach `optionen` (Format von `node:util`: `{ name: { type: "string"|"boolean", multiple? } }`).
 * Rückgabe `{ werte, positionale, tokens, fehler }`; `fehler` ist `null` oder `{ art, flag, text }` mit `art` aus
 * `unbekannt | ohne-wert | doppelt | positional | terminator | fehlt`; der Options-Terminator `--` ist immer ein Fehler
 * (`terminator`), kein Skript nimmt ihn an. Ein Wert fehlt, wenn er am Ende fehlt, der nächste Token mit
 * `--` beginnt oder ein Inline-Wert (`--x=`) leer ist; negative Zahlen (`-5`) kommen als Wert durch.
 * `meldung` überschreibt den Standardtext: als Objekt `{ art: text | (flag) => text }` (fehlende Art = Standard) oder als
 * Funktion `(art, flag) => text` (`undefined` = Standard).
 */
export function flagsLesen(argv, optionen, { positionale = false, pflicht = [], meldung } = {}) {
  for (const name of pflicht) if (!Object.hasOwn(optionen, name)) throw new Error(`flagsLesen: pflicht-Name ohne Option: ${name}`);
  const { values, positionals, tokens } = parseArgs({ args: argv, options: optionen, strict: false, allowPositionals: true, tokens: true });
  const werte = { ...values };
  const fehler = (art, flag) => ({ art, flag, text: meldungText(meldung, art, flag) ?? STANDARD[art](flag) });
  const gesehen = new Set();
  for (const t of tokens) {
    if (t.kind === "positional") {
      if (!positionale) return { werte, positionale: positionals, tokens, fehler: fehler("positional", argv[t.index]) };
      continue;
    }
    if (t.kind === "option-terminator") return { werte, positionale: positionals, tokens, fehler: fehler("terminator", "--") };
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

/**
 * Liest einen Aufruf mit Unterbefehl: das erste Argument wählt aus `befehle` (`{ name: { optionen, positionale } }`, `positionale` =
 * Höchstzahl der Positionsargumente, 0 = keine); der Rest läuft durch `flagsLesen` mit den Optionen dieses Befehls. Rückgabe wie
 * `flagsLesen` plus `befehl`; `fehler.art` zusätzlich `befehl` (unbekannt oder fehlend, `flag` = der Name oder `undefined`) und
 * `positional` für mehr Positionsargumente als erlaubt. `meldung` wie bei `flagsLesen` (Art `befehl` bekommt den Namen).
 */
export function befehlLesen(argv, befehle, { meldung } = {}) {
  const [name, ...rest] = argv;
  if (typeof name !== "string" || !Object.hasOwn(befehle, name)) {
    const flag = name;
    return { befehl: undefined, werte: {}, positionale: [], tokens: [], fehler: { art: "befehl", flag, text: meldungText(meldung, "befehl", flag) ?? STANDARD.befehl(flag) } };
  }
  const { optionen, positionale: hoechst } = befehle[name];
  const r = flagsLesen(rest, optionen, { positionale: hoechst > 0, meldung });
  if (r.fehler) return { befehl: name, ...r };
  if (r.positionale.length > hoechst) {
    const flag = r.positionale[hoechst];
    return { befehl: name, ...r, fehler: { art: "positional", flag, text: meldungText(meldung, "positional", flag) ?? STANDARD.positional(flag) } };
  }
  return { befehl: name, ...r };
}

/**
 * Rahmen des Direktaufrufs eines Skripts mit Ergebnis-Vertrag `{ code, out, err }`: erst `pruefe(argv)` (pur, liefert `{ fehler }` bei
 * einem Aufruf-Fehler); bei Fehler nur `fehlerErgebnis(argv, vorab)`, weder `vorbereiten` noch `io` laufen (kein I/O vor dem Fehler).
 * Sonst `vorbereiten?.()`, dann `fuehreAus(argv, io())` (`io` als Funktion, erst hier aufgerufen, oder als Objekt). `ausgabe` (Standard:
 * Prozess-Streams, `process.exitCode`) bekommt `out`, `err` und `code`; Rückgabe ist das Ergebnis.
 */
export function direktaufruf(argv, { pruefe, fehlerErgebnis, vorbereiten, io, fuehreAus, ausgabe = {} }) {
  const senke = {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    exit: (c) => {
      process.exitCode = c;
    },
    ...ausgabe,
  };
  const vorab = pruefe(argv);
  let ergebnis;
  if (vorab.fehler) {
    ergebnis = fehlerErgebnis(argv, vorab);
  } else {
    vorbereiten?.();
    ergebnis = fuehreAus(argv, typeof io === "function" ? io() : io);
  }
  senke.out(ergebnis.out);
  senke.err(ergebnis.err);
  senke.exit(ergebnis.code);
  return ergebnis;
}
